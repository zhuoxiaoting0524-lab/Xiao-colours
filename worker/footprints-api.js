import { nowIso, randomToken, sha256Hex } from "./crypto-util.js";
import { requireDb } from "./db.js";
import { assertSameOrigin, errorJson, json, readJsonBody } from "./http.js";
import { assertCsrf, loadSession } from "./sessions.js";

const STATUSES = new Set(["visited", "wish"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GEOCODE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const GEOCODE_GAP_MS = 1_100;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MAX_PHOTO_BYTES = 700 * 1024;
const MAX_PHOTOS_PER_PLACE = 20;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SEARCH_ALIASES = new Map([
  ["日本", "Japan"], ["japan", "Japan"],
  ["中国", "China"], ["china", "China"],
  ["美国", "United States"], ["美國", "United States"], ["usa", "United States"], ["us", "United States"], ["united states", "United States"],
  ["英国", "United Kingdom"], ["英國", "United Kingdom"], ["uk", "United Kingdom"], ["united kingdom", "United Kingdom"],
  ["法国", "France"], ["法國", "France"], ["france", "France"],
  ["巴黎", "Paris, France"], ["paris", "Paris, France"],
  ["东京", "Tokyo, Japan"], ["東京", "Tokyo, Japan"], ["tokyo", "Tokyo, Japan"],
  ["巴塞罗那", "Barcelona, Spain"], ["巴塞羅那", "Barcelona, Spain"], ["barcelona", "Barcelona, Spain"],
]);

async function requireSession(db, request, { csrf = false } = {}) {
  const session = await loadSession(db, request);
  if (!session) {
    const error = new Error("未登录");
    error.code = "unauthorized";
    error.status = 401;
    throw error;
  }
  if (csrf && request.method !== "GET" && request.method !== "HEAD") {
    assertSameOrigin(request);
    assertCsrf(request, session);
  }
  return session;
}

function finiteCoordinate(value, min, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    const error = new Error(`${label}无效`);
    error.code = "invalid_coordinate";
    error.status = 400;
    throw error;
  }
  return number;
}

function validDate(value) {
  if (!value) return null;
  if (!DATE_RE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function cleanFootprint(body, { partial = false } = {}) {
  const data = {};
  if (!partial || Object.hasOwn(body, "name")) {
    const name = String(body.name || "").trim().slice(0, 140);
    if (!name) {
      const error = new Error("请填写地点名称");
      error.code = "invalid_name";
      error.status = 400;
      throw error;
    }
    data.name = name;
  }
  if (!partial || Object.hasOwn(body, "locationLabel")) {
    data.locationLabel = String(body.locationLabel || "").trim().slice(0, 500);
  }
  if (!partial || Object.hasOwn(body, "status")) {
    const status = String(body.status || "wish");
    if (!STATUSES.has(status)) {
      const error = new Error("足迹状态无效");
      error.code = "invalid_status";
      error.status = 400;
      throw error;
    }
    data.status = status;
  }
  if (!partial || Object.hasOwn(body, "date")) {
    const date = String(body.date || "").trim();
    if (date && !validDate(date)) {
      const error = new Error("足迹日期无效");
      error.code = "invalid_date";
      error.status = 400;
      throw error;
    }
    data.date = date || null;
  }
  if (!partial || Object.hasOwn(body, "note")) {
    data.note = String(body.note || "").slice(0, 2000);
  }
  if (!partial || Object.hasOwn(body, "longitude")) {
    data.longitude = finiteCoordinate(body.longitude, -180, 180, "经度");
  }
  if (!partial || Object.hasOwn(body, "latitude")) {
    data.latitude = finiteCoordinate(body.latitude, -90, 90, "纬度");
  }
  if (!partial || Object.hasOwn(body, "geocoder")) {
    data.geocoder = String(body.geocoder || "nominatim").trim().slice(0, 40) || "nominatim";
  }
  if (!partial || Object.hasOwn(body, "sourceId")) {
    data.sourceId = String(body.sourceId || "").trim().slice(0, 140) || null;
  }
  if (!partial || Object.hasOwn(body, "nameZh")) {
    data.nameZh = String(body.nameZh || "").trim().slice(0, 140) || null;
  }
  if (!partial || Object.hasOwn(body, "nameEn")) {
    data.nameEn = String(body.nameEn || "").trim().slice(0, 140) || null;
  }
  if (!partial || Object.hasOwn(body, "countryCode")) {
    const countryCode = String(body.countryCode || "").trim().toUpperCase();
    data.countryCode = /^[A-Z]{2}$/.test(countryCode) ? countryCode : null;
  }
  if (!partial || Object.hasOwn(body, "placeType")) {
    data.placeType = String(body.placeType || "place").trim().slice(0, 80) || "place";
  }
  return data;
}

function publicFootprint(row) {
  return {
    id: row.id,
    name: row.name,
    locationLabel: row.location_label,
    status: row.status,
    date: row.visited_date,
    note: row.note,
    longitude: Number(row.longitude),
    latitude: Number(row.latitude),
    geocoder: row.geocoder,
    sourceId: row.source_id,
    nameZh: row.name_zh || null,
    nameEn: row.name_en || null,
    countryCode: row.country_code || null,
    placeType: row.place_type || "place",
    photoId: row.photo_id || null,
    photoCount: Number(row.photo_count || (row.photo_id ? 1 : 0)),
    imageUrl: row.photo_id
      ? `/api/me/footprints/${encodeURIComponent(row.id)}/photo?v=${encodeURIComponent(row.photo_updated_at || row.updated_at || "")}`
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicPhoto(row) {
  return {
    id: row.id,
    footprintId: row.footprint_id,
    contentType: row.content_type,
    byteSize: Number(row.byte_size || 0),
    originalName: row.original_name || null,
    caption: row.caption || "",
    position: Number(row.position || 0),
    isCover: Boolean(row.is_cover),
    imageUrl: `/api/me/footprints/${encodeURIComponent(row.footprint_id)}/photos/${encodeURIComponent(row.id)}?v=${encodeURIComponent(row.updated_at || "")}`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeSearchQuery(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function canonicalSearchQuery(value) {
  const query = normalizeSearchQuery(value);
  return SEARCH_ALIASES.get(query.toLocaleLowerCase("en-US")) || query;
}

function publicSearchResult(item) {
  const longitude = Number(item.lon);
  const latitude = Number(item.lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const address = item.address || {};
  const names = item.namedetails || {};
  const nameZh = String(names["name:zh-Hans"] || names["name:zh"] || "").trim().slice(0, 140) || null;
  const nameEn = String(names["name:en"] || "").trim().slice(0, 140) || null;
  const name = String(
    nameZh
      || nameEn
      || item.name
      || address.city
      || address.town
      || address.village
      || address.municipality
      || String(item.display_name || "").split(",")[0]
      || "未命名地点",
  ).slice(0, 140);
  return {
    name,
    nameZh,
    nameEn,
    label: String(item.display_name || name).slice(0, 500),
    longitude,
    latitude,
    sourceId: `${String(item.osm_type || "osm")}:${String(item.osm_id || item.place_id || "")}`.slice(0, 140),
    type: String(item.addresstype || item.type || "place").slice(0, 80),
    countryCode: String(address.country_code || "").toUpperCase().slice(0, 2) || null,
  };
}

async function searchNominatim(db, query) {
  const canonicalQuery = canonicalSearchQuery(query);
  const normalized = canonicalQuery.toLocaleLowerCase("en-US");
  const queryHash = await sha256Hex(normalized);
  const cached = await db.prepare(
    `SELECT response_json, fetched_at FROM geocode_cache WHERE query_hash = ?`,
  ).bind(queryHash).first();
  if (cached && Date.now() - new Date(cached.fetched_at).valueOf() < GEOCODE_CACHE_MS) {
    try {
      return { results: JSON.parse(cached.response_json), cached: true, updatedAt: cached.fetched_at };
    } catch {
      // Ignore corrupt cache entries and replace them with a fresh validated result.
    }
  }

  const requestedAt = nowIso();
  const allowedBefore = new Date(Date.now() - GEOCODE_GAP_MS).toISOString();
  const reservation = await db.prepare(
    `INSERT INTO geocode_rate_state (id, last_request_at)
     VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET last_request_at = excluded.last_request_at
     WHERE geocode_rate_state.last_request_at <= ?`,
  ).bind(requestedAt, allowedBefore).run();
  if (!reservation.meta?.changes) {
    const error = new Error("地点搜索过于频繁，请稍后再试");
    error.code = "geocode_rate_limited";
    error.status = 429;
    error.retryAfterMs = GEOCODE_GAP_MS;
    throw error;
  }

  const endpoint = new URL(NOMINATIM_URL);
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("q", canonicalQuery);
  endpoint.searchParams.set("limit", "5");
  endpoint.searchParams.set("addressdetails", "1");
  endpoint.searchParams.set("namedetails", "1");
  endpoint.searchParams.set("accept-language", "zh-CN,zh,en");

  let response;
  try {
    response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "User-Agent": "XiaoColour-Footprints/1.0 (+https://colours.xiaocolour.workers.dev/)",
        Referer: "https://colours.xiaocolour.workers.dev/",
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (cause) {
    const error = new Error(cause?.name === "TimeoutError" ? "地点搜索响应超时" : "地点搜索服务暂不可用");
    error.code = "geocode_unavailable";
    error.status = 503;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`地点搜索服务返回 HTTP ${response.status}`);
    error.code = "geocode_upstream_error";
    error.status = 503;
    throw error;
  }

  const payload = await response.json();
  const results = Array.isArray(payload)
    ? payload.map(publicSearchResult).filter(Boolean).slice(0, 5)
    : [];
  await db.prepare(
    `INSERT INTO geocode_cache (query_hash, response_json, fetched_at)
     VALUES (?, ?, ?)
     ON CONFLICT(query_hash) DO UPDATE
       SET response_json = excluded.response_json, fetched_at = excluded.fetched_at`,
  ).bind(queryHash, JSON.stringify(results), requestedAt).run();
  return { results, cached: false, updatedAt: requestedAt };
}

async function footprintRow(db, userId, id) {
  return db.prepare(
    `SELECT f.*, p.id AS photo_id, p.updated_at AS photo_updated_at,
            (SELECT COUNT(*) FROM footprint_photos pc WHERE pc.footprint_id = f.id AND pc.user_id = f.user_id) AS photo_count
     FROM footprints f
     LEFT JOIN footprint_photos p ON p.footprint_id = f.id AND p.user_id = f.user_id AND p.is_cover = 1
     WHERE f.id = ? AND f.user_id = ?`,
  ).bind(id, userId).first();
}

async function readPhoto(request) {
  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!PHOTO_TYPES.has(contentType)) {
    const error = new Error("足迹照片仅支持 JPEG、PNG 或 WebP");
    error.code = "invalid_photo_type";
    error.status = 400;
    throw error;
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES) {
    const error = new Error("压缩后的足迹照片不能超过 700KB");
    error.code = bytes.byteLength ? "photo_too_large" : "empty_photo";
    error.status = 400;
    throw error;
  }
  return { bytes, contentType };
}

export async function handleFootprintsApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/me/footprints")) return null;
  const db = requireDb(env);

  try {
    const csrf = request.method !== "GET" && request.method !== "HEAD";
    const session = await requireSession(db, request, { csrf });

    if (path === "/api/me/footprints/search" && request.method === "GET") {
      const query = normalizeSearchQuery(url.searchParams.get("q"));
      if (query.length < 2) return errorJson(400, "invalid_query", "请至少输入两个字符");
      const result = await searchNominatim(db, query);
      return json({ ok: true, ...result, attribution: "© OpenStreetMap contributors · Nominatim" });
    }

    if (path === "/api/me/footprints" && request.method === "GET") {
      const status = String(url.searchParams.get("status") || "all");
      if (status !== "all" && !STATUSES.has(status)) {
        return errorJson(400, "invalid_status", "足迹筛选无效");
      }
      const rows = status === "all"
        ? await db.prepare(
          `SELECT f.*, p.id AS photo_id, p.updated_at AS photo_updated_at,
                  (SELECT COUNT(*) FROM footprint_photos pc WHERE pc.footprint_id = f.id AND pc.user_id = f.user_id) AS photo_count
           FROM footprints f
           LEFT JOIN footprint_photos p ON p.footprint_id = f.id AND p.user_id = f.user_id AND p.is_cover = 1
           WHERE f.user_id = ? ORDER BY f.updated_at DESC, f.id DESC LIMIT 500`,
        ).bind(session.user.id).all()
        : await db.prepare(
          `SELECT f.*, p.id AS photo_id, p.updated_at AS photo_updated_at,
                  (SELECT COUNT(*) FROM footprint_photos pc WHERE pc.footprint_id = f.id AND pc.user_id = f.user_id) AS photo_count
           FROM footprints f
           LEFT JOIN footprint_photos p ON p.footprint_id = f.id AND p.user_id = f.user_id AND p.is_cover = 1
           WHERE f.user_id = ? AND f.status = ? ORDER BY f.updated_at DESC, f.id DESC LIMIT 500`,
        ).bind(session.user.id, status).all();
      return json({ ok: true, footprints: (rows.results || []).map(publicFootprint) });
    }

    if (path === "/api/me/footprints" && request.method === "POST") {
      const body = cleanFootprint(await readJsonBody(request));
      const id = randomToken(12);
      const timestamp = nowIso();
      await db.prepare(
        `INSERT INTO footprints
          (id, user_id, name, location_label, status, visited_date, note,
           longitude, latitude, geocoder, source_id, name_zh, name_en,
           country_code, place_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        session.user.id,
        body.name,
        body.locationLabel,
        body.status,
        body.date,
        body.note,
        body.longitude,
        body.latitude,
        body.geocoder,
        body.sourceId,
        body.nameZh,
        body.nameEn,
        body.countryCode,
        body.placeType,
        timestamp,
        timestamp,
      ).run();
      const row = await footprintRow(db, session.user.id, id);
      return json({ ok: true, footprint: publicFootprint(row) }, 201);
    }

    const albumMatch = path.match(/^\/api\/me\/footprints\/([^/]+)\/photos$/);
    if (albumMatch) {
      const footprintId = decodeURIComponent(albumMatch[1]);
      const footprint = await footprintRow(db, session.user.id, footprintId);
      if (!footprint) return errorJson(404, "not_found", "足迹不存在");
      if (request.method === "GET") {
        const result = await db.prepare(
          `SELECT id, footprint_id, content_type, byte_size, original_name, caption,
                  position, is_cover, created_at, updated_at
           FROM footprint_photos
           WHERE footprint_id = ? AND user_id = ?
           ORDER BY is_cover DESC, position ASC, created_at ASC`,
        ).bind(footprintId, session.user.id).all();
        return json({ ok: true, photos: (result.results || []).map(publicPhoto) });
      }
      if (request.method === "POST") {
        const count = await db.prepare(
          `SELECT COUNT(*) AS total FROM footprint_photos WHERE footprint_id = ? AND user_id = ?`,
        ).bind(footprintId, session.user.id).first();
        if (Number(count?.total || 0) >= MAX_PHOTOS_PER_PLACE) {
          return errorJson(400, "photo_limit", `每个地点最多保存 ${MAX_PHOTOS_PER_PLACE} 张照片`);
        }
        const photo = await readPhoto(request);
        const id = randomToken(12);
        const timestamp = nowIso();
        const isCover = Number(count?.total || 0) === 0 ? 1 : 0;
        const originalName = String(url.searchParams.get("name") || "").trim().slice(0, 180) || null;
        const caption = String(url.searchParams.get("caption") || "").trim().slice(0, 500) || null;
        const position = Number(count?.total || 0);
        await db.prepare(
          `INSERT INTO footprint_photos
            (id, footprint_id, user_id, content_type, byte_size, image_data,
             original_name, caption, position, is_cover, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, footprintId, session.user.id, photo.contentType, photo.bytes.byteLength, photo.bytes, originalName, caption, position, isCover, timestamp, timestamp).run();
        const saved = await db.prepare(`SELECT * FROM footprint_photos WHERE id = ? AND user_id = ?`).bind(id, session.user.id).first();
        return json({ ok: true, photo: publicPhoto(saved), footprint: publicFootprint(await footprintRow(db, session.user.id, footprintId)) }, 201);
      }
      return null;
    }

    const albumPhotoMatch = path.match(/^\/api\/me\/footprints\/([^/]+)\/photos\/([^/]+)$/);
    if (albumPhotoMatch) {
      const footprintId = decodeURIComponent(albumPhotoMatch[1]);
      const photoId = decodeURIComponent(albumPhotoMatch[2]);
      const photo = await db.prepare(
        `SELECT * FROM footprint_photos WHERE id = ? AND footprint_id = ? AND user_id = ?`,
      ).bind(photoId, footprintId, session.user.id).first();
      if (!photo) return errorJson(404, "not_found", "照片不存在");
      if (request.method === "GET") {
        return new Response(photo.image_data, { headers: {
          "content-type": photo.content_type,
          "cache-control": "private, no-cache",
          "content-security-policy": "default-src 'none'; sandbox",
          "x-content-type-options": "nosniff",
        } });
      }
      if (request.method === "PATCH") {
        const body = await readJsonBody(request);
        const targetId = String(body.footprintId || footprintId);
        const target = await footprintRow(db, session.user.id, targetId);
        if (!target) return errorJson(404, "target_not_found", "目标足迹不存在");
        const caption = Object.hasOwn(body, "caption") ? String(body.caption || "").slice(0, 500) : photo.caption;
        const makeCover = body.isCover === true || (targetId !== footprintId && !(await db.prepare(
          `SELECT id FROM footprint_photos WHERE footprint_id = ? AND user_id = ? AND is_cover = 1`,
        ).bind(targetId, session.user.id).first()));
        const timestamp = nowIso();
        const statements = [];
        if (makeCover) statements.push(db.prepare(
          `UPDATE footprint_photos SET is_cover = 0, updated_at = ? WHERE footprint_id = ? AND user_id = ?`,
        ).bind(timestamp, targetId, session.user.id));
        statements.push(db.prepare(
          `UPDATE footprint_photos SET footprint_id = ?, caption = ?, is_cover = ?, updated_at = ?
           WHERE id = ? AND footprint_id = ? AND user_id = ?`,
        ).bind(targetId, caption, makeCover ? 1 : 0, timestamp, photoId, footprintId, session.user.id));
        if (photo.is_cover && targetId !== footprintId) statements.push(db.prepare(
          `UPDATE footprint_photos SET is_cover = 1, updated_at = ?
           WHERE id = (SELECT id FROM footprint_photos WHERE footprint_id = ? AND user_id = ? ORDER BY position ASC, created_at ASC LIMIT 1)`,
        ).bind(timestamp, footprintId, session.user.id));
        await db.batch(statements);
        const saved = await db.prepare(`SELECT * FROM footprint_photos WHERE id = ? AND user_id = ?`).bind(photoId, session.user.id).first();
        return json({ ok: true, photo: publicPhoto(saved) });
      }
      if (request.method === "DELETE") {
        await db.prepare(`DELETE FROM footprint_photos WHERE id = ? AND footprint_id = ? AND user_id = ?`).bind(photoId, footprintId, session.user.id).run();
        if (photo.is_cover) await db.prepare(
          `UPDATE footprint_photos SET is_cover = 1, updated_at = ?
           WHERE id = (SELECT id FROM footprint_photos WHERE footprint_id = ? AND user_id = ? ORDER BY position ASC, created_at ASC LIMIT 1)`,
        ).bind(nowIso(), footprintId, session.user.id).run();
        return json({ ok: true, footprint: publicFootprint(await footprintRow(db, session.user.id, footprintId)) });
      }
      return null;
    }

    const photoMatch = path.match(/^\/api\/me\/footprints\/([^/]+)\/photo$/);
    if (photoMatch) {
      const id = decodeURIComponent(photoMatch[1]);
      const existing = await footprintRow(db, session.user.id, id);
      if (!existing) return errorJson(404, "not_found", "足迹不存在");

      if (request.method === "GET") {
        const photo = await db.prepare(
          `SELECT content_type, image_data FROM footprint_photos
           WHERE footprint_id = ? AND user_id = ?
           ORDER BY is_cover DESC, position ASC LIMIT 1`,
        ).bind(id, session.user.id).first();
        if (!photo) return errorJson(404, "not_found", "足迹照片不存在");
        return new Response(photo.image_data, {
          headers: {
            "content-type": photo.content_type,
            "cache-control": "private, no-cache",
            "content-security-policy": "default-src 'none'; sandbox",
            "x-content-type-options": "nosniff",
          },
        });
      }

      if (request.method === "PUT") {
        const photo = await readPhoto(request);
        const timestamp = nowIso();
        const photoId = existing.photo_id || randomToken(12);
        if (existing.photo_id) {
          await db.prepare(
            `UPDATE footprint_photos SET content_type = ?, byte_size = ?, image_data = ?, updated_at = ?
             WHERE id = ? AND footprint_id = ? AND user_id = ?`,
          ).bind(photo.contentType, photo.bytes.byteLength, photo.bytes, timestamp, photoId, id, session.user.id).run();
        } else {
          await db.prepare(
            `INSERT INTO footprint_photos
              (id, footprint_id, user_id, content_type, byte_size, image_data,
               original_name, caption, position, is_cover, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, 1, ?, ?)`,
          ).bind(photoId, id, session.user.id, photo.contentType, photo.bytes.byteLength, photo.bytes, timestamp, timestamp).run();
        }
        const row = await footprintRow(db, session.user.id, id);
        return json({ ok: true, footprint: publicFootprint(row) });
      }

      if (request.method === "DELETE") {
        if (existing.photo_id) {
          await db.prepare(`DELETE FROM footprint_photos WHERE id = ? AND footprint_id = ? AND user_id = ?`).bind(existing.photo_id, id, session.user.id).run();
          await db.prepare(
            `UPDATE footprint_photos SET is_cover = 1, updated_at = ?
             WHERE id = (SELECT id FROM footprint_photos WHERE footprint_id = ? AND user_id = ? ORDER BY position ASC, created_at ASC LIMIT 1)`,
          ).bind(nowIso(), id, session.user.id).run();
        }
        return json({ ok: true });
      }
      return null;
    }

    const match = path.match(/^\/api\/me\/footprints\/([^/]+)$/);
    if (!match) return null;
    const id = decodeURIComponent(match[1]);
    const existing = await footprintRow(db, session.user.id, id);
    if (!existing) return errorJson(404, "not_found", "足迹不存在");

    if (request.method === "PATCH") {
      const changes = cleanFootprint(await readJsonBody(request), { partial: true });
      const updatedAt = nowIso();
      await db.prepare(
        `UPDATE footprints
         SET name = ?, location_label = ?, status = ?, visited_date = ?, note = ?,
             longitude = ?, latitude = ?, geocoder = ?, source_id = ?,
             name_zh = ?, name_en = ?, country_code = ?, place_type = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      ).bind(
        changes.name ?? existing.name,
        changes.locationLabel ?? existing.location_label,
        changes.status ?? existing.status,
        Object.hasOwn(changes, "date") ? changes.date : existing.visited_date,
        changes.note ?? existing.note,
        changes.longitude ?? existing.longitude,
        changes.latitude ?? existing.latitude,
        changes.geocoder ?? existing.geocoder,
        Object.hasOwn(changes, "sourceId") ? changes.sourceId : existing.source_id,
        Object.hasOwn(changes, "nameZh") ? changes.nameZh : existing.name_zh,
        Object.hasOwn(changes, "nameEn") ? changes.nameEn : existing.name_en,
        Object.hasOwn(changes, "countryCode") ? changes.countryCode : existing.country_code,
        changes.placeType ?? existing.place_type,
        updatedAt,
        id,
        session.user.id,
      ).run();
      const row = await footprintRow(db, session.user.id, id);
      return json({ ok: true, footprint: publicFootprint(row) });
    }

    if (request.method === "DELETE") {
      await db.prepare(
        `DELETE FROM footprints WHERE id = ? AND user_id = ?`,
      ).bind(id, session.user.id).run();
      return json({ ok: true });
    }
    return null;
  } catch (error) {
    if (/no such (table|column): (footprints|footprint_photos|geocode_cache|geocode_rate_state|name_zh)/.test(String(error?.message || ""))) {
      return errorJson(503, "schema_missing", "Footprints 数据表尚未初始化，请先完成第三阶段数据库迁移。");
    }
    const status = error.status || (error.code === "db_unavailable" ? 503 : 400);
    if (error.code === "unauthorized") return errorJson(401, error.code, error.message);
    if (error.code === "csrf" || error.code === "csrf_origin") {
      return errorJson(403, error.code, error.message);
    }
    if (error.code === "geocode_rate_limited") {
      return errorJson(429, error.code, error.message, { retryAfterMs: error.retryAfterMs });
    }
    console.error(JSON.stringify({ event: "footprints_api_error", code: error.code, message: error.message }));
    return errorJson(status, error.code || "footprints_error", error.message || "足迹请求失败");
  }
}
