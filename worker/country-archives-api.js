import { nowIso, randomToken } from "./crypto-util.js";
import { requireDb } from "./db.js";
import { assertSameOrigin, errorJson, json, readJsonBody } from "./http.js";
import { assertCsrf, loadSession } from "./sessions.js";

const EXPERIENCE_CATEGORIES = new Set(["food", "cafe", "sight", "shopping", "stay", "entertainment", "other"]);
const EXPENSE_CATEGORIES = new Set(["food", "stay", "transport", "activity", "shopping", "other"]);
const ROUTE_TYPES = new Set(["planned", "actual"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 700 * 1024;

async function requireSession(db, request) {
  const session = await loadSession(db, request);
  if (!session) throw Object.assign(new Error("未登录"), { code: "unauthorized", status: 401 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    assertSameOrigin(request);
    assertCsrf(request, session);
  }
  return session;
}

function countryCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw Object.assign(new Error("国家代码无效"), { code: "invalid_country", status: 400 });
  return code;
}

function dateValue(value) {
  if (value == null || value === "") return null;
  const text = String(value);
  if (!DATE_RE.test(text)) throw Object.assign(new Error("日期格式无效"), { code: "invalid_date", status: 400 });
  return text;
}

function text(value, max = 500, required = false) {
  const result = String(value || "").trim().slice(0, max);
  if (required && !result) throw Object.assign(new Error("请填写名称"), { code: "invalid_name", status: 400 });
  return result;
}

function coordinate(value, min, max) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw Object.assign(new Error("坐标无效"), { code: "invalid_coordinate", status: 400 });
  return number;
}

function minorAmount(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw Object.assign(new Error("金额无效，最多保留两位小数"), { code: "invalid_amount", status: 400 });
  const [whole, fraction = ""] = raw.split(".");
  const amount = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(amount) || amount < 0) throw Object.assign(new Error("金额超出范围"), { code: "invalid_amount", status: 400 });
  return amount;
}

function currency(value) {
  const result = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) throw Object.assign(new Error("货币代码无效"), { code: "invalid_currency", status: 400 });
  return result;
}

async function archiveFor(db, userId, code) {
  return db.prepare("SELECT * FROM country_archives WHERE user_id = ? AND country_code = ?").bind(userId, code).first();
}

async function ensureArchive(db, userId, code, names = {}) {
  let archive = await archiveFor(db, userId, code);
  if (archive) return archive;
  const id = randomToken(12);
  const now = nowIso();
  await db.prepare(`INSERT INTO country_archives
    (id,user_id,country_code,name_zh,name_en,start_date,end_date,note,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, userId, code, text(names.nameZh, 100) || null, text(names.nameEn, 100) || null, null, null, "", now, now).run();
  return archiveFor(db, userId, code);
}

async function ownedFootprint(db, userId, id, code, { actual = false } = {}) {
  if (!id) return null;
  const row = await db.prepare("SELECT * FROM footprints WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!row || (row.country_code && row.country_code !== code)) throw Object.assign(new Error("关联地点不存在或不属于该国家"), { code: "invalid_footprint", status: 400 });
  if (actual && row.status !== "visited") throw Object.assign(new Error("实际足迹只能添加已明确标记为去过的地点"), { code: "not_visited", status: 400 });
  return row;
}

function photoUrl(code, experienceId, photoId) {
  return `/api/me/country-archives/${encodeURIComponent(code)}/experiences/${encodeURIComponent(experienceId)}/photos/${encodeURIComponent(photoId)}`;
}

async function archivePayload(db, userId, archive) {
  const [footprints, experiences, expenses, days, items, photos] = await Promise.all([
    db.prepare(`SELECT f.*, p.id AS photo_id FROM footprints f LEFT JOIN footprint_photos p ON p.footprint_id=f.id AND p.user_id=f.user_id WHERE f.user_id=? AND f.country_code=? ORDER BY f.updated_at DESC`).bind(userId, archive.country_code).all(),
    db.prepare("SELECT * FROM country_experiences WHERE user_id=? AND archive_id=? ORDER BY COALESCE(experience_date,'') DESC, created_at DESC").bind(userId, archive.id).all(),
    db.prepare("SELECT * FROM country_expenses WHERE user_id=? AND archive_id=? ORDER BY COALESCE(expense_date,'') DESC, created_at DESC").bind(userId, archive.id).all(),
    db.prepare("SELECT * FROM country_route_days WHERE user_id=? AND archive_id=? ORDER BY route_type, day_number").bind(userId, archive.id).all(),
    db.prepare("SELECT * FROM country_route_items WHERE user_id=? AND archive_id=? ORDER BY route_day_id, sort_order, created_at").bind(userId, archive.id).all(),
    db.prepare(`SELECT p.id,p.experience_id,p.sort_order,p.created_at FROM country_experience_photos p JOIN country_experiences e ON e.id=p.experience_id WHERE p.user_id=? AND e.archive_id=? ORDER BY p.sort_order,p.created_at`).bind(userId, archive.id).all(),
  ]);
  const photoRows = photos.results || [];
  const expenseRows = expenses.results || [];
  const totals = {};
  const categories = {};
  for (const row of expenseRows) {
    totals[row.currency] = (totals[row.currency] || 0) + Number(row.amount_minor || 0);
    categories[row.currency] ||= {};
    categories[row.currency][row.category] = (categories[row.currency][row.category] || 0) + Number(row.amount_minor || 0);
  }
  const mappedExperiences = (experiences.results || []).map((row) => ({
    ...row,
    photos: photoRows.filter((p) => p.experience_id === row.id).map((p) => ({ ...p, url: photoUrl(archive.country_code, row.id, p.id) })),
    expense: expenseRows.find((expense) => expense.experience_id === row.id) || null,
  }));
  const itemRows = items.results || [];
  const mappedDays = (days.results || []).map((day) => ({ ...day, items: itemRows.filter((item) => item.route_day_id === day.id) }));
  return {
    archive,
    footprints: footprints.results || [],
    experiences: mappedExperiences,
    expenses: expenseRows,
    routes: mappedDays,
    totals,
    categories,
    stats: {
      visited: (footprints.results || []).filter((item) => item.status === "visited").length,
      wishlist: (footprints.results || []).filter((item) => item.status === "wish").length,
      photos: (footprints.results || []).filter((item) => item.photo_id).length + photoRows.length,
    },
  };
}

async function listArchives(db, userId) {
  const rows = await db.prepare(`SELECT country_code, MAX(name_zh) AS name_zh, MAX(name_en) AS name_en,
    SUM(CASE WHEN status='visited' THEN 1 ELSE 0 END) AS visited_count,
    SUM(CASE WHEN status='wish' THEN 1 ELSE 0 END) AS wish_count
    FROM footprints WHERE user_id=? AND country_code IS NOT NULL GROUP BY country_code ORDER BY visited_count DESC, country_code`).bind(userId).all();
  const archives = await db.prepare("SELECT * FROM country_archives WHERE user_id=?").bind(userId).all();
  const byCode = new Map((archives.results || []).map((row) => [row.country_code, row]));
  return (rows.results || []).map((row) => ({ ...row, archive: byCode.get(row.country_code) || null }));
}

export async function handleCountryArchivesApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/me/country-archives")) return null;
  const db = requireDb(env);
  try {
    const session = await requireSession(db, request);
    const userId = session.user.id;
    if (path === "/api/me/country-archives" && request.method === "GET") return json({ ok: true, countries: await listArchives(db, userId) });

    const base = path.match(/^\/api\/me\/country-archives\/([A-Za-z]{2})$/);
    if (base) {
      const code = countryCode(base[1]);
      if (request.method === "GET") {
        const archive = await archiveFor(db, userId, code);
        if (!archive) return errorJson(404, "not_found", "国家旅行档案尚未创建");
        return json({ ok: true, ...(await archivePayload(db, userId, archive)) });
      }
      if (request.method === "POST") {
        const body = await readJsonBody(request);
        const archive = await ensureArchive(db, userId, code, body);
        return json({ ok: true, ...(await archivePayload(db, userId, archive)) }, 201);
      }
      if (request.method === "PATCH") {
        const archive = await archiveFor(db, userId, code);
        if (!archive) return errorJson(404, "not_found", "国家旅行档案不存在");
        const body = await readJsonBody(request);
        await db.prepare(`UPDATE country_archives SET name_zh=?,name_en=?,start_date=?,end_date=?,note=?,updated_at=? WHERE id=? AND user_id=?`).bind(
          text(body.nameZh ?? archive.name_zh, 100) || null, text(body.nameEn ?? archive.name_en, 100) || null,
          Object.hasOwn(body,"startDate") ? dateValue(body.startDate) : archive.start_date,
          Object.hasOwn(body,"endDate") ? dateValue(body.endDate) : archive.end_date,
          text(body.note ?? archive.note, 2000), nowIso(), archive.id, userId,
        ).run();
        return json({ ok: true, ...(await archivePayload(db, userId, await archiveFor(db, userId, code))) });
      }
    }

    const experienceCollection = path.match(/^\/api\/me\/country-archives\/([A-Za-z]{2})\/experiences$/);
    if (experienceCollection && request.method === "POST") {
      const code = countryCode(experienceCollection[1]);
      const archive = await ensureArchive(db, userId, code);
      const body = await readJsonBody(request);
      const category = String(body.category || "other");
      if (!EXPERIENCE_CATEGORIES.has(category)) throw Object.assign(new Error("记录分类无效"), { code: "invalid_category", status: 400 });
      const footprint = await ownedFootprint(db, userId, body.footprintId, code);
      const id = randomToken(12); const now = nowIso();
      await db.prepare(`INSERT INTO country_experiences (id,archive_id,user_id,footprint_id,name,category,city,longitude,latitude,experience_date,rating,note,revisit,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        id, archive.id, userId, footprint?.id || null, text(body.name, 140, true), category, text(body.city, 140) || null,
        coordinate(body.longitude ?? footprint?.longitude, -180, 180), coordinate(body.latitude ?? footprint?.latitude, -90, 90), dateValue(body.date),
        body.rating ? Math.max(1, Math.min(5, Number(body.rating))) : null, text(body.note, 3000), body.revisit == null ? null : (body.revisit ? 1 : 0), now, now,
      ).run();
      if (body.amount !== undefined && String(body.amount).trim() !== "") {
        const expenseCategory = category === "food" || category === "cafe" ? "food" : category === "stay" ? "stay" : category === "shopping" ? "shopping" : category === "sight" || category === "entertainment" ? "activity" : "other";
        await db.prepare(`INSERT INTO country_expenses (id,archive_id,user_id,experience_id,footprint_id,category,title,amount_minor,currency,expense_date,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          randomToken(12), archive.id, userId, id, footprint?.id || null, expenseCategory, text(body.name,140,true), minorAmount(body.amount), currency(body.currency || "CNY"), dateValue(body.date), "", now, now,
        ).run();
      }
      return json({ ok: true, ...(await archivePayload(db, userId, archive)) }, 201);
    }

    const experienceItem = path.match(/^\/api\/me\/country-archives\/([A-Za-z]{2})\/experiences\/([^/]+)$/);
    if (experienceItem) {
      const code = countryCode(experienceItem[1]); const id = decodeURIComponent(experienceItem[2]);
      const archive = await archiveFor(db,userId,code);
      const existing = archive && await db.prepare("SELECT * FROM country_experiences WHERE id=? AND user_id=? AND archive_id=?").bind(id,userId,archive.id).first();
      if (!existing) return errorJson(404,"not_found","记录不存在");
      if (request.method === "DELETE") { await db.prepare("DELETE FROM country_experiences WHERE id=? AND user_id=?").bind(id,userId).run(); return json({ok:true,...(await archivePayload(db,userId,archive))}); }
      if (request.method === "PATCH") {
        const body=await readJsonBody(request); const category=String(body.category ?? existing.category);
        if(!EXPERIENCE_CATEGORIES.has(category)) throw Object.assign(new Error("记录分类无效"),{code:"invalid_category",status:400});
        const footprint=body.footprintId===undefined ? null : await ownedFootprint(db,userId,body.footprintId,code);
        await db.prepare(`UPDATE country_experiences SET footprint_id=?,name=?,category=?,city=?,longitude=?,latitude=?,experience_date=?,rating=?,note=?,revisit=?,updated_at=? WHERE id=? AND user_id=?`).bind(
          body.footprintId===undefined?existing.footprint_id:(footprint?.id||null), text(body.name??existing.name,140,true), category, text(body.city??existing.city,140)||null,
          body.longitude===undefined?existing.longitude:coordinate(body.longitude,-180,180), body.latitude===undefined?existing.latitude:coordinate(body.latitude,-90,90),
          body.date===undefined?existing.experience_date:dateValue(body.date), body.rating===undefined?existing.rating:(body.rating?Math.max(1,Math.min(5,Number(body.rating))):null),
          text(body.note??existing.note,3000), body.revisit===undefined?existing.revisit:(body.revisit==null?null:(body.revisit?1:0)),nowIso(),id,userId).run();
        if(body.amount!==undefined){
          if(String(body.amount).trim()==="") await db.prepare("DELETE FROM country_expenses WHERE experience_id=? AND user_id=?").bind(id,userId).run();
          else {
            const now=nowIso(); const expCategory=category==="food"||category==="cafe"?"food":category==="stay"?"stay":category==="shopping"?"shopping":category==="sight"||category==="entertainment"?"activity":"other";
            await db.prepare(`INSERT INTO country_expenses (id,archive_id,user_id,experience_id,footprint_id,category,title,amount_minor,currency,expense_date,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(experience_id) DO UPDATE SET category=excluded.category,title=excluded.title,amount_minor=excluded.amount_minor,currency=excluded.currency,expense_date=excluded.expense_date,updated_at=excluded.updated_at WHERE country_expenses.user_id=excluded.user_id`).bind(randomToken(12),archive.id,userId,id,existing.footprint_id,expCategory,text(body.name??existing.name,140,true),minorAmount(body.amount),currency(body.currency||"CNY"),body.date===undefined?existing.experience_date:dateValue(body.date),"",now,now).run();
          }
        }
        return json({ok:true,...(await archivePayload(db,userId,archive))});
      }
    }

    const photoMatch=path.match(/^\/api\/me\/country-archives\/([A-Za-z]{2})\/experiences\/([^/]+)\/photos(?:\/([^/]+))?$/);
    if(photoMatch){
      const code=countryCode(photoMatch[1]); const experienceId=decodeURIComponent(photoMatch[2]); const photoId=photoMatch[3]?decodeURIComponent(photoMatch[3]):null;
      const archive=await archiveFor(db,userId,code); const experience=archive&&await db.prepare("SELECT * FROM country_experiences WHERE id=? AND user_id=? AND archive_id=?").bind(experienceId,userId,archive.id).first();
      if(!experience) return errorJson(404,"not_found","记录不存在");
      if(request.method==="POST"&&!photoId){
        const count=await db.prepare("SELECT COUNT(*) AS count FROM country_experience_photos WHERE experience_id=? AND user_id=?").bind(experienceId,userId).first();
        if(Number(count.count)>=12) return errorJson(400,"photo_limit","每条记录最多保存 12 张照片");
        const contentType=(request.headers.get("content-type")||"").split(";")[0].toLowerCase(); if(!PHOTO_TYPES.has(contentType)) return errorJson(400,"invalid_photo_type","仅支持 JPEG、PNG 或 WebP");
        const bytes=new Uint8Array(await request.arrayBuffer()); if(!bytes.byteLength||bytes.byteLength>MAX_PHOTO_BYTES) return errorJson(400,"photo_too_large","压缩后的照片不能超过 700KB");
        const id=randomToken(12); await db.prepare("INSERT INTO country_experience_photos (id,experience_id,user_id,content_type,byte_size,image_data,sort_order,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(id,experienceId,userId,contentType,bytes.byteLength,bytes,Number(count.count),nowIso()).run();
        return json({ok:true,photo:{id,url:photoUrl(code,experienceId,id)}},201);
      }
      if(photoId&&request.method==="GET"){
        const photo=await db.prepare("SELECT content_type,image_data FROM country_experience_photos WHERE id=? AND experience_id=? AND user_id=?").bind(photoId,experienceId,userId).first(); if(!photo)return errorJson(404,"not_found","照片不存在");
        return new Response(photo.image_data,{headers:{"content-type":photo.content_type,"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
      }
      if(photoId&&request.method==="DELETE"){await db.prepare("DELETE FROM country_experience_photos WHERE id=? AND experience_id=? AND user_id=?").bind(photoId,experienceId,userId).run();return json({ok:true});}
    }

    const expenseCollection=path.match(/^\/api\/me\/country-archives\/([A-Za-z]{2})\/expenses$/);
    if(expenseCollection&&request.method==="POST"){
      const code=countryCode(expenseCollection[1]); const archive=await ensureArchive(db,userId,code); const body=await readJsonBody(request); const category=String(body.category||"other");
      if(!EXPENSE_CATEGORIES.has(category))throw Object.assign(new Error("费用分类无效"),{code:"invalid_category",status:400}); const footprint=await ownedFootprint(db,userId,body.footprintId,code); const now=nowIso();
      await db.prepare(`INSERT INTO country_expenses (id,archive_id,user_id,experience_id,footprint_id,category,title,amount_minor,currency,expense_date,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(randomToken(12),archive.id,userId,null,footprint?.id||null,category,text(body.title,140,true),minorAmount(body.amount),currency(body.currency),dateValue(body.date),text(body.note,1000),now,now).run();
      return json({ok:true,...(await archivePayload(db,userId,archive))},201);
    }
    const expenseItem=path.match(/^\/api\/me\/country-archives\/([A-Za-z]{2})\/expenses\/([^/]+)$/);
    if(expenseItem){const code=countryCode(expenseItem[1]);const id=decodeURIComponent(expenseItem[2]);const archive=await archiveFor(db,userId,code);const existing=archive&&await db.prepare("SELECT * FROM country_expenses WHERE id=? AND user_id=? AND archive_id=?").bind(id,userId,archive.id).first();if(!existing)return errorJson(404,"not_found","费用不存在");
      if(request.method==="DELETE"){await db.prepare("DELETE FROM country_expenses WHERE id=? AND user_id=?").bind(id,userId).run();return json({ok:true,...(await archivePayload(db,userId,archive))});}
      if(request.method==="PATCH"){const body=await readJsonBody(request);const category=String(body.category??existing.category);if(!EXPENSE_CATEGORIES.has(category))throw Object.assign(new Error("费用分类无效"),{code:"invalid_category",status:400});await db.prepare("UPDATE country_expenses SET category=?,title=?,amount_minor=?,currency=?,expense_date=?,note=?,updated_at=? WHERE id=? AND user_id=?").bind(category,text(body.title??existing.title,140,true),body.amount===undefined?existing.amount_minor:minorAmount(body.amount),body.currency===undefined?existing.currency:currency(body.currency),body.date===undefined?existing.expense_date:dateValue(body.date),text(body.note??existing.note,1000),nowIso(),id,userId).run();return json({ok:true,...(await archivePayload(db,userId,archive))});}
    }

    const routeDays=path.match(/^\/api\/me\/country-archives\/([A-Za-z]{2})\/routes$/);
    if(routeDays&&request.method==="POST"){
      const code=countryCode(routeDays[1]);const archive=await ensureArchive(db,userId,code);const body=await readJsonBody(request);const type=String(body.routeType||"planned");if(!ROUTE_TYPES.has(type))throw Object.assign(new Error("路线类型无效"),{code:"invalid_route",status:400});const day=Math.max(1,Math.floor(Number(body.dayNumber)||1));const now=nowIso();
      await db.prepare(`INSERT INTO country_route_days (id,archive_id,user_id,route_type,day_number,route_date,title,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(archive_id,route_type,day_number) DO UPDATE SET route_date=excluded.route_date,title=excluded.title,updated_at=excluded.updated_at WHERE country_route_days.user_id=excluded.user_id`).bind(randomToken(12),archive.id,userId,type,day,dateValue(body.date),text(body.title,140),now,now).run();return json({ok:true,...(await archivePayload(db,userId,archive))},201);
    }
    const routeItems=path.match(/^\/api\/me\/country-archives\/([A-Za-z]{2})\/routes\/([^/]+)\/items$/);
    if(routeItems&&request.method==="POST"){
      const code=countryCode(routeItems[1]);const dayId=decodeURIComponent(routeItems[2]);const archive=await archiveFor(db,userId,code);const day=archive&&await db.prepare("SELECT * FROM country_route_days WHERE id=? AND user_id=? AND archive_id=?").bind(dayId,userId,archive.id).first();if(!day)return errorJson(404,"not_found","路线日期不存在");const body=await readJsonBody(request);const footprint=await ownedFootprint(db,userId,body.footprintId,code,{actual:day.route_type==="actual"});const longitude=coordinate(body.longitude??footprint?.longitude,-180,180);const latitude=coordinate(body.latitude??footprint?.latitude,-90,90);if(longitude==null||latitude==null)throw Object.assign(new Error("路线地点需要真实坐标"),{code:"invalid_coordinate",status:400});const max=await db.prepare("SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM country_route_items WHERE route_day_id=? AND user_id=?").bind(dayId,userId).first();const now=nowIso();
      await db.prepare("INSERT INTO country_route_items (id,route_day_id,archive_id,user_id,footprint_id,name,location_label,longitude,latitude,sort_order,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(randomToken(12),dayId,archive.id,userId,footprint?.id||null,text(body.name??footprint?.name,140,true),text(body.locationLabel??footprint?.location_label,500),longitude,latitude,Number(max.next),text(body.note,1000),now,now).run();return json({ok:true,...(await archivePayload(db,userId,archive))},201);
    }
    const routeItem=path.match(/^\/api\/me\/country-archives\/([A-Za-z]{2})\/route-items\/([^/]+)$/);
    if(routeItem){const code=countryCode(routeItem[1]);const id=decodeURIComponent(routeItem[2]);const archive=await archiveFor(db,userId,code);const existing=archive&&await db.prepare("SELECT * FROM country_route_items WHERE id=? AND user_id=? AND archive_id=?").bind(id,userId,archive.id).first();if(!existing)return errorJson(404,"not_found","路线地点不存在");if(request.method==="DELETE"){await db.prepare("DELETE FROM country_route_items WHERE id=? AND user_id=?").bind(id,userId).run();return json({ok:true,...(await archivePayload(db,userId,archive))});}if(request.method==="PATCH"){const body=await readJsonBody(request);await db.prepare("UPDATE country_route_items SET sort_order=?,note=?,updated_at=? WHERE id=? AND user_id=?").bind(body.sortOrder===undefined?existing.sort_order:Math.max(0,Math.floor(Number(body.sortOrder)||0)),text(body.note??existing.note,1000),nowIso(),id,userId).run();return json({ok:true,...(await archivePayload(db,userId,archive))});}}
    return null;
  } catch (error) {
    if (/no such table: country_/.test(String(error?.message || ""))) return errorJson(503,"schema_missing","国家旅行档案数据表尚未初始化");
    const status=error.status||(error.code==="db_unavailable"?503:400);
    if(error.code==="unauthorized")return errorJson(401,error.code,error.message);
    if(error.code==="csrf"||error.code==="csrf_origin")return errorJson(403,error.code,error.message);
    console.error(JSON.stringify({event:"country_archives_api_error",code:error.code,message:error.message}));
    return errorJson(status,error.code||"country_archive_error",error.message||"国家旅行档案请求失败");
  }
}
