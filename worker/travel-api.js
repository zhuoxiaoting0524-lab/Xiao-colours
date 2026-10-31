import { nowIso, randomToken } from "./crypto-util.js";
import { requireDb } from "./db.js";
import { assertSameOrigin, errorJson, json, readJsonBody } from "./http.js";
import { assertCsrf, loadSession } from "./sessions.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const URL_RE = /^https:\/\//i;
const TRIP_STYLES = new Set(["classic", "nature", "food", "shopping", "art", "history", "photo", "relax", "hidden", "family"]);
const BUDGET_LEVELS = new Set(["economy", "moderate", "comfortable", "premium", "custom"]);
const PACES = new Set(["relaxed", "moderate", "compact"]);
const TRANSPORTS = new Set(["walk", "transit", "drive", "mixed"]);
const ACTIVITY_TYPES = new Set(["place", "food", "rest", "transport", "custom"]);
const EXPENSE_TYPES = new Set(["stay", "transport", "food", "activity", "shopping", "other"]);
const CHECKLIST_SECTIONS = new Set(["before", "during", "return"]);
const SAVED_CATEGORIES = new Set(["attraction", "restaurant", "cafe", "hotel", "shopping", "other"]);
const INFO_TYPES = new Set(["stay", "transport", "booking", "note", "link"]);

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

async function requireSession(db, request, { csrf = false } = {}) {
  const session = await loadSession(db, request);
  if (!session) fail(401, "unauthorized", "未登录");
  if (csrf && request.method !== "GET" && request.method !== "HEAD") {
    assertSameOrigin(request);
    assertCsrf(request, session);
  }
  return session;
}

function validDate(value, label) {
  const text = String(value || "");
  if (!DATE_RE.test(text) || Number.isNaN(new Date(`${text}T00:00:00Z`).valueOf())) fail(400, "invalid_date", `${label}无效`);
  return text;
}

function cleanText(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function safeJson(value, fallback = []) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function daysBetween(start, end) {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function addDays(date, amount) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}

function tripStatus(row, today = new Date().toISOString().slice(0, 10)) {
  if (today > row.end_date) return "finished";
  if (today >= row.start_date) return "traveling";
  const until = daysBetween(today, row.start_date) - 1;
  return until <= 30 ? "upcoming" : "planning";
}

function publicTrip(row) {
  return {
    id: row.id,
    name: row.name,
    destinationName: row.destination_name,
    destinationLabel: row.destination_label,
    destinationTimezone: row.destination_timezone,
    countryCode: row.country_code,
    longitude: row.longitude == null ? null : Number(row.longitude),
    latitude: row.latitude == null ? null : Number(row.latitude),
    startDate: row.start_date,
    endDate: row.end_date,
    dayCount: daysBetween(row.start_date, row.end_date),
    nightCount: Math.max(0, daysBetween(row.start_date, row.end_date) - 1),
    travelers: Number(row.travelers),
    budgetLevel: row.budget_level,
    budgetAmount: row.budget_amount == null ? null : Number(row.budget_amount),
    currency: row.currency,
    styles: safeJson(row.styles_json),
    pace: row.pace,
    transport: row.transport,
    preferences: row.preferences,
    coverUrl: row.cover_url,
    status: tripStatus(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cleanTrip(body, { partial = false } = {}) {
  const out = {};
  if (!partial || Object.hasOwn(body, "name")) {
    out.name = cleanText(body.name, 120);
    if (!out.name) fail(400, "invalid_name", "请填写旅行名称");
  }
  if (!partial || Object.hasOwn(body, "destinationName")) {
    out.destinationName = cleanText(body.destinationName, 160);
    if (!out.destinationName) fail(400, "invalid_destination", "请选择旅行目的地");
  }
  if (!partial || Object.hasOwn(body, "destinationLabel")) out.destinationLabel = cleanText(body.destinationLabel, 500);
  if (!partial || Object.hasOwn(body, "destinationTimezone")) out.destinationTimezone = cleanText(body.destinationTimezone, 80) || null;
  if (!partial || Object.hasOwn(body, "countryCode")) out.countryCode = /^[A-Z]{2}$/.test(String(body.countryCode || "").toUpperCase()) ? String(body.countryCode).toUpperCase() : null;
  if (!partial || Object.hasOwn(body, "longitude")) out.longitude = body.longitude == null || body.longitude === "" ? null : Number(body.longitude);
  if (!partial || Object.hasOwn(body, "latitude")) out.latitude = body.latitude == null || body.latitude === "" ? null : Number(body.latitude);
  if (out.longitude != null && (!Number.isFinite(out.longitude) || out.longitude < -180 || out.longitude > 180)) fail(400, "invalid_coordinate", "目的地经度无效");
  if (out.latitude != null && (!Number.isFinite(out.latitude) || out.latitude < -90 || out.latitude > 90)) fail(400, "invalid_coordinate", "目的地纬度无效");
  if (!partial || Object.hasOwn(body, "startDate")) out.startDate = validDate(body.startDate, "出发日期");
  if (!partial || Object.hasOwn(body, "endDate")) out.endDate = validDate(body.endDate, "返回日期");
  if (out.startDate && out.endDate && out.endDate < out.startDate) fail(400, "invalid_range", "返回日期不能早于出发日期");
  if (!partial || Object.hasOwn(body, "travelers")) {
    out.travelers = Math.trunc(Number(body.travelers || 1));
    if (out.travelers < 1 || out.travelers > 99) fail(400, "invalid_travelers", "旅行人数无效");
  }
  if (!partial || Object.hasOwn(body, "budgetLevel")) out.budgetLevel = BUDGET_LEVELS.has(body.budgetLevel) ? body.budgetLevel : "moderate";
  if (!partial || Object.hasOwn(body, "budgetAmount")) out.budgetAmount = body.budgetAmount === "" || body.budgetAmount == null ? null : Math.max(0, Math.round(Number(body.budgetAmount) * 100));
  if (!partial || Object.hasOwn(body, "currency")) out.currency = /^[A-Z]{3}$/.test(String(body.currency || "EUR").toUpperCase()) ? String(body.currency || "EUR").toUpperCase() : "EUR";
  if (!partial || Object.hasOwn(body, "styles")) out.styles = [...new Set((Array.isArray(body.styles) ? body.styles : []).filter((item) => TRIP_STYLES.has(item)))];
  if (!partial || Object.hasOwn(body, "pace")) out.pace = PACES.has(body.pace) ? body.pace : "moderate";
  if (!partial || Object.hasOwn(body, "transport")) out.transport = TRANSPORTS.has(body.transport) ? body.transport : "mixed";
  if (!partial || Object.hasOwn(body, "preferences")) out.preferences = cleanText(body.preferences, 2000);
  return out;
}

async function ownedTrip(db, userId, tripId) {
  const row = await db.prepare("SELECT * FROM travel_trips WHERE id = ? AND user_id = ?").bind(tripId, userId).first();
  if (!row) fail(404, "trip_not_found", "旅行不存在");
  return row;
}

async function tripPayload(db, userId, tripId) {
  const trip = await ownedTrip(db, userId, tripId);
  const [days, activities, saved, info, expenses, checklist, versions] = await Promise.all([
    db.prepare("SELECT * FROM travel_days WHERE trip_id = ? AND user_id = ? ORDER BY day_number").bind(tripId, userId).all(),
    db.prepare("SELECT * FROM travel_activities WHERE trip_id = ? AND user_id = ? ORDER BY day_id, sort_order, start_time").bind(tripId, userId).all(),
    db.prepare("SELECT * FROM travel_saved_places WHERE trip_id = ? AND user_id = ? ORDER BY created_at DESC").bind(tripId, userId).all(),
    db.prepare("SELECT * FROM travel_info_items WHERE trip_id = ? AND user_id = ? ORDER BY created_at DESC").bind(tripId, userId).all(),
    db.prepare("SELECT * FROM travel_expenses WHERE trip_id = ? AND user_id = ? ORDER BY expense_date, created_at").bind(tripId, userId).all(),
    db.prepare("SELECT * FROM travel_checklist_items WHERE trip_id = ? AND user_id = ? ORDER BY section, sort_order, created_at").bind(tripId, userId).all(),
    db.prepare("SELECT id, scope, source, summary, created_at FROM travel_versions WHERE trip_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 20").bind(tripId, userId).all(),
  ]);
  return {
    trip: publicTrip(trip),
    days: (days.results || []).map((row) => ({ id: row.id, date: row.day_date, dayNumber: row.day_number, title: row.title, note: row.note })),
    activities: (activities.results || []).map((row) => ({
      id: row.id, dayId: row.day_id, sortOrder: row.sort_order, startTime: row.start_time, durationMinutes: row.duration_minutes,
      type: row.activity_type, name: row.name, description: row.description, note: row.note, locationLabel: row.place_label,
      source: row.place_source, sourceId: row.place_source_id, longitude: row.longitude, latitude: row.latitude,
      verification: row.verification_status, websiteUrl: row.website_url, updatedAt: row.updated_at,
    })),
    savedPlaces: saved.results || [],
    infoItems: info.results || [],
    expenses: (expenses.results || []).map((row) => ({ ...row, amount: row.amount_minor / 100 })),
    checklist: (checklist.results || []).map((row) => ({ ...row, completed: Boolean(row.is_completed) })),
    versions: versions.results || [],
  };
}

async function createTrip(db, userId, body) {
  const data = cleanTrip(body);
  if (data.endDate < data.startDate) fail(400, "invalid_range", "返回日期不能早于出发日期");
  const count = daysBetween(data.startDate, data.endDate);
  if (count > 60) fail(400, "trip_too_long", "单次旅行最多支持 60 天");
  const id = randomToken(18);
  const now = nowIso();
  const statements = [db.prepare(
    `INSERT INTO travel_trips (id,user_id,name,destination_name,destination_label,destination_timezone,country_code,longitude,latitude,start_date,end_date,travelers,budget_level,budget_amount,currency,styles_json,pace,transport,preferences,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(id, userId, data.name, data.destinationName, data.destinationLabel, data.destinationTimezone, data.countryCode, data.longitude, data.latitude, data.startDate, data.endDate, data.travelers, data.budgetLevel, data.budgetAmount, data.currency, JSON.stringify(data.styles), data.pace, data.transport, data.preferences, now, now)];
  for (let index = 0; index < count; index += 1) {
    statements.push(db.prepare(
      "INSERT INTO travel_days (id,trip_id,user_id,day_date,day_number,title,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).bind(randomToken(18), id, userId, addDays(data.startDate, index), index + 1, "", "", now, now));
  }
  await db.batch(statements);
  return tripPayload(db, userId, id);
}

function cleanActivity(body, { partial = false } = {}) {
  const data = {};
  if (!partial || Object.hasOwn(body, "dayId")) data.dayId = cleanText(body.dayId, 100);
  if (!partial || Object.hasOwn(body, "name")) {
    data.name = cleanText(body.name, 160);
    if (!data.name) fail(400, "invalid_activity", "请填写活动名称");
  }
  if (!partial || Object.hasOwn(body, "startTime")) data.startTime = body.startTime ? (TIME_RE.test(body.startTime) ? body.startTime : fail(400, "invalid_time", "时间无效")) : null;
  if (!partial || Object.hasOwn(body, "durationMinutes")) data.durationMinutes = body.durationMinutes === "" || body.durationMinutes == null ? null : Math.max(0, Math.min(1440, Math.round(Number(body.durationMinutes))));
  if (!partial || Object.hasOwn(body, "type")) data.type = ACTIVITY_TYPES.has(body.type) ? body.type : "place";
  if (!partial || Object.hasOwn(body, "description")) data.description = cleanText(body.description, 1200);
  if (!partial || Object.hasOwn(body, "note")) data.note = cleanText(body.note, 2000);
  if (!partial || Object.hasOwn(body, "locationLabel")) data.locationLabel = cleanText(body.locationLabel, 500);
  if (!partial || Object.hasOwn(body, "source")) data.source = cleanText(body.source, 50) || null;
  if (!partial || Object.hasOwn(body, "sourceId")) data.sourceId = cleanText(body.sourceId, 160) || null;
  if (!partial || Object.hasOwn(body, "longitude")) data.longitude = body.longitude === "" || body.longitude == null ? null : Number(body.longitude);
  if (!partial || Object.hasOwn(body, "latitude")) data.latitude = body.latitude === "" || body.latitude == null ? null : Number(body.latitude);
  if (!partial || Object.hasOwn(body, "verification")) data.verification = ["verified", "suggested", "unverified"].includes(body.verification) ? body.verification : "unverified";
  if (!partial || Object.hasOwn(body, "websiteUrl")) data.websiteUrl = URL_RE.test(String(body.websiteUrl || "")) ? String(body.websiteUrl).slice(0, 1000) : null;
  if (!partial || Object.hasOwn(body, "sortOrder")) data.sortOrder = Math.max(0, Math.round(Number(body.sortOrder || 0)));
  return data;
}

async function dayOwned(db, userId, tripId, dayId) {
  const row = await db.prepare("SELECT * FROM travel_days WHERE id = ? AND trip_id = ? AND user_id = ?").bind(dayId, tripId, userId).first();
  if (!row) fail(404, "day_not_found", "旅行日期不存在");
  return row;
}

async function saveVersion(db, userId, tripId, scope, summary) {
  const current = await tripPayload(db, userId, tripId);
  await db.prepare("INSERT INTO travel_versions (id,trip_id,user_id,scope,source,summary,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(randomToken(18), tripId, userId, scope, "manual", summary, JSON.stringify({ days: current.days, activities: current.activities }), nowIso()).run();
}

async function handleActivity(request, db, session, tripId, activityId) {
  const method = request.method;
  await ownedTrip(db, session.user.id, tripId);
  if (method === "POST" && !activityId) {
    const body = cleanActivity(await readJsonBody(request));
    await dayOwned(db, session.user.id, tripId, body.dayId);
    const now = nowIso();
    const id = randomToken(18);
    await db.prepare(
      `INSERT INTO travel_activities (id,trip_id,day_id,user_id,sort_order,start_time,duration_minutes,activity_type,name,description,note,place_label,place_source,place_source_id,longitude,latitude,verification_status,website_url,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(id, tripId, body.dayId, session.user.id, body.sortOrder, body.startTime, body.durationMinutes, body.type, body.name, body.description, body.note, body.locationLabel, body.source, body.sourceId, body.longitude, body.latitude, body.verification, body.websiteUrl, now, now).run();
    return json({ ok: true, id }, 201);
  }
  const row = await db.prepare("SELECT * FROM travel_activities WHERE id = ? AND trip_id = ? AND user_id = ?").bind(activityId, tripId, session.user.id).first();
  if (!row) fail(404, "activity_not_found", "行程项目不存在");
  if (method === "DELETE") {
    await saveVersion(db, session.user.id, tripId, `day:${row.day_id}`, "删除活动前自动保存");
    await db.prepare("DELETE FROM travel_activities WHERE id = ? AND user_id = ?").bind(activityId, session.user.id).run();
    return json({ ok: true });
  }
  if (method === "PATCH") {
    const body = cleanActivity(await readJsonBody(request), { partial: true });
    const next = { dayId: body.dayId ?? row.day_id, name: body.name ?? row.name, startTime: Object.hasOwn(body, "startTime") ? body.startTime : row.start_time, durationMinutes: Object.hasOwn(body, "durationMinutes") ? body.durationMinutes : row.duration_minutes, type: body.type ?? row.activity_type, description: body.description ?? row.description, note: body.note ?? row.note, locationLabel: body.locationLabel ?? row.place_label, source: Object.hasOwn(body, "source") ? body.source : row.place_source, sourceId: Object.hasOwn(body, "sourceId") ? body.sourceId : row.place_source_id, longitude: Object.hasOwn(body, "longitude") ? body.longitude : row.longitude, latitude: Object.hasOwn(body, "latitude") ? body.latitude : row.latitude, verification: body.verification ?? row.verification_status, websiteUrl: Object.hasOwn(body, "websiteUrl") ? body.websiteUrl : row.website_url, sortOrder: body.sortOrder ?? row.sort_order };
    await dayOwned(db, session.user.id, tripId, next.dayId);
    await db.prepare(
      `UPDATE travel_activities SET day_id=?,name=?,start_time=?,duration_minutes=?,activity_type=?,description=?,note=?,place_label=?,place_source=?,place_source_id=?,longitude=?,latitude=?,verification_status=?,website_url=?,sort_order=?,updated_at=? WHERE id=? AND user_id=?`,
    ).bind(next.dayId, next.name, next.startTime, next.durationMinutes, next.type, next.description, next.note, next.locationLabel, next.source, next.sourceId, next.longitude, next.latitude, next.verification, next.websiteUrl, next.sortOrder, nowIso(), activityId, session.user.id).run();
    return json({ ok: true });
  }
  return null;
}

async function handleExpense(request, db, session, tripId, id) {
  await ownedTrip(db, session.user.id, tripId);
  if (request.method === "POST" && !id) {
    const body = await readJsonBody(request);
    const category = EXPENSE_TYPES.has(body.category) ? body.category : "other";
    const title = cleanText(body.title, 160);
    if (!title) fail(400, "invalid_expense", "请填写费用名称");
    const amount = Math.max(0, Math.round(Number(body.amount || 0) * 100));
    const currency = /^[A-Z]{3}$/.test(String(body.currency || "").toUpperCase()) ? String(body.currency).toUpperCase() : "EUR";
    await db.prepare("INSERT INTO travel_expenses (id,trip_id,user_id,category,title,amount_minor,currency,expense_date,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(randomToken(18), tripId, session.user.id, category, title, amount, currency, body.date ? validDate(body.date, "费用日期") : null, cleanText(body.note, 1000), nowIso(), nowIso()).run();
    return json({ ok: true }, 201);
  }
  if (request.method === "DELETE" && id) {
    await db.prepare("DELETE FROM travel_expenses WHERE id=? AND trip_id=? AND user_id=?").bind(id, tripId, session.user.id).run();
    return json({ ok: true });
  }
  return null;
}

async function handleChecklist(request, db, session, tripId, id) {
  await ownedTrip(db, session.user.id, tripId);
  if (request.method === "POST" && !id) {
    const body = await readJsonBody(request);
    const title = cleanText(body.title, 200);
    if (!title) fail(400, "invalid_checklist", "请填写清单事项");
    const section = CHECKLIST_SECTIONS.has(body.section) ? body.section : "before";
    await db.prepare("INSERT INTO travel_checklist_items (id,trip_id,user_id,section,title,is_completed,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(randomToken(18), tripId, session.user.id, section, title, 0, Number(body.sortOrder || 0), nowIso(), nowIso()).run();
    return json({ ok: true }, 201);
  }
  const row = id ? await db.prepare("SELECT * FROM travel_checklist_items WHERE id=? AND trip_id=? AND user_id=?").bind(id, tripId, session.user.id).first() : null;
  if (id && !row) fail(404, "checklist_not_found", "清单事项不存在");
  if (request.method === "PATCH") {
    const body = await readJsonBody(request);
    const completed = Object.hasOwn(body, "completed") ? Boolean(body.completed) : Boolean(row.is_completed);
    await db.prepare("UPDATE travel_checklist_items SET title=?,section=?,is_completed=?,completed_at=?,updated_at=? WHERE id=? AND user_id=?")
      .bind(cleanText(body.title ?? row.title, 200) || row.title, CHECKLIST_SECTIONS.has(body.section) ? body.section : row.section, completed ? 1 : 0, completed ? nowIso() : null, nowIso(), id, session.user.id).run();
    return json({ ok: true });
  }
  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM travel_checklist_items WHERE id=? AND user_id=?").bind(id, session.user.id).run();
    return json({ ok: true });
  }
  return null;
}

async function handleSimpleItem(request, db, session, tripId, kind, id) {
  await ownedTrip(db, session.user.id, tripId);
  const body = request.method === "POST" || request.method === "PATCH" ? await readJsonBody(request) : {};
  if (kind === "saved") {
    if (request.method === "POST") {
      const name = cleanText(body.name, 160); if (!name) fail(400, "invalid_place", "请填写地点名称");
      await db.prepare("INSERT INTO travel_saved_places (id,trip_id,user_id,category,name,location_label,source_id,longitude,latitude,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(randomToken(18), tripId, session.user.id, SAVED_CATEGORIES.has(body.category) ? body.category : "other", name, cleanText(body.locationLabel, 500), cleanText(body.sourceId, 160) || null, body.longitude ?? null, body.latitude ?? null, cleanText(body.note, 1000), nowIso(), nowIso()).run();
      return json({ ok: true }, 201);
    }
    if (request.method === "DELETE") { await db.prepare("DELETE FROM travel_saved_places WHERE id=? AND trip_id=? AND user_id=?").bind(id, tripId, session.user.id).run(); return json({ ok: true }); }
  }
  if (kind === "info") {
    if (request.method === "POST") {
      const title = cleanText(body.title, 180); if (!title) fail(400, "invalid_info", "请填写信息标题");
      const url = URL_RE.test(String(body.url || "")) ? String(body.url).slice(0, 1000) : null;
      await db.prepare("INSERT INTO travel_info_items (id,trip_id,user_id,item_type,title,details,start_at,end_at,url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(randomToken(18), tripId, session.user.id, INFO_TYPES.has(body.type) ? body.type : "note", title, cleanText(body.details, 3000), cleanText(body.startAt, 40) || null, cleanText(body.endAt, 40) || null, url, nowIso(), nowIso()).run();
      return json({ ok: true }, 201);
    }
    if (request.method === "DELETE") { await db.prepare("DELETE FROM travel_info_items WHERE id=? AND trip_id=? AND user_id=?").bind(id, tripId, session.user.id).run(); return json({ ok: true }); }
  }
  return null;
}

export async function handleTravelApi(request, env) {
  const db = requireDb(env);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/me\/travel\/?/, "");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);

  try {
    const session = await requireSession(db, request, { csrf: request.method !== "GET" && request.method !== "HEAD" });
    if (!parts.length) {
      if (request.method === "GET") {
        const rows = await db.prepare("SELECT * FROM travel_trips WHERE user_id=? ORDER BY start_date DESC, updated_at DESC").bind(session.user.id).all();
        return json({ trips: (rows.results || []).map(publicTrip) });
      }
      if (request.method === "POST") return json(await createTrip(db, session.user.id, await readJsonBody(request)), 201);
    }

    const [tripId, resource, resourceId] = parts;
    if (tripId && !resource) {
      if (request.method === "GET") return json(await tripPayload(db, session.user.id, tripId));
      if (request.method === "DELETE") {
        const result = await db.prepare("DELETE FROM travel_trips WHERE id=? AND user_id=?").bind(tripId, session.user.id).run();
        if (!result.meta?.changes) fail(404, "trip_not_found", "旅行不存在");
        return json({ ok: true });
      }
      if (request.method === "PATCH") {
        const row = await ownedTrip(db, session.user.id, tripId);
        const body = cleanTrip(await readJsonBody(request), { partial: true });
        const next = { name: body.name ?? row.name, destinationName: body.destinationName ?? row.destination_name, destinationLabel: body.destinationLabel ?? row.destination_label, destinationTimezone: Object.hasOwn(body, "destinationTimezone") ? body.destinationTimezone : row.destination_timezone, countryCode: Object.hasOwn(body, "countryCode") ? body.countryCode : row.country_code, longitude: Object.hasOwn(body, "longitude") ? body.longitude : row.longitude, latitude: Object.hasOwn(body, "latitude") ? body.latitude : row.latitude, startDate: body.startDate ?? row.start_date, endDate: body.endDate ?? row.end_date, travelers: body.travelers ?? row.travelers, budgetLevel: body.budgetLevel ?? row.budget_level, budgetAmount: Object.hasOwn(body, "budgetAmount") ? body.budgetAmount : row.budget_amount, currency: body.currency ?? row.currency, styles: body.styles ?? safeJson(row.styles_json), pace: body.pace ?? row.pace, transport: body.transport ?? row.transport, preferences: body.preferences ?? row.preferences };
        if (next.endDate < next.startDate) fail(400, "invalid_range", "返回日期不能早于出发日期");
        if (next.startDate !== row.start_date || next.endDate !== row.end_date) fail(409, "date_change_requires_rebuild", "已有旅行暂不支持直接改动日期范围，请新建旅行以保护行程数据");
        await db.prepare("UPDATE travel_trips SET name=?,destination_name=?,destination_label=?,destination_timezone=?,country_code=?,longitude=?,latitude=?,travelers=?,budget_level=?,budget_amount=?,currency=?,styles_json=?,pace=?,transport=?,preferences=?,updated_at=? WHERE id=? AND user_id=?")
          .bind(next.name, next.destinationName, next.destinationLabel, next.destinationTimezone, next.countryCode, next.longitude, next.latitude, next.travelers, next.budgetLevel, next.budgetAmount, next.currency, JSON.stringify(next.styles), next.pace, next.transport, next.preferences, nowIso(), tripId, session.user.id).run();
        return json({ ok: true });
      }
    }

    if (resource === "activities") return await handleActivity(request, db, session, tripId, resourceId);
    if (resource === "expenses") return await handleExpense(request, db, session, tripId, resourceId);
    if (resource === "checklist") return await handleChecklist(request, db, session, tripId, resourceId);
    if (resource === "saved") return await handleSimpleItem(request, db, session, tripId, "saved", resourceId);
    if (resource === "info") return await handleSimpleItem(request, db, session, tripId, "info", resourceId);
    if (resource === "ai") {
      await ownedTrip(db, session.user.id, tripId);
      return errorJson(503, "ai_not_configured", "AI 服务尚未配置。手动规划、地图、预算和清单仍可正常使用。");
    }
    return null;
  } catch (error) {
    if (error.status) return errorJson(error.status, error.code || "travel_error", error.message);
    throw error;
  }
}
