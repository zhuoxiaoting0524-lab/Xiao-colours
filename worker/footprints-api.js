import { nowIso, randomToken, sha256Hex } from "./crypto-util.js";
import { requireDb } from "./db.js";
import { assertSameOrigin, errorJson, json, readJsonBody } from "./http.js";
import { assertCsrf, loadSession } from "./sessions.js";

const STATUSES = new Set(["visited", "wish"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GEOCODE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const GEOCODE_GAP_MS = 1_100;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeSearchQuery(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function publicSearchResult(item) {
  const longitude = Number(item.lon);
  const latitude = Number(item.lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const address = item.address || {};
  const name = String(
    item.name
      || address.city
      || address.town
      || address.village
      || address.municipality
      || String(item.display_name || "").split(",")[0]
      || "未命名地点",
  ).slice(0, 140);
  return {
    name,
    label: String(item.display_name || name).slice(0, 500),
    longitude,
    latitude,
    sourceId: `${String(item.osm_type || "osm")}:${String(item.osm_id || item.place_id || "")}`.slice(0, 140),
    type: String(item.type || item.addresstype || "place").slice(0, 80),
  };
}

async function searchNominatim(db, query) {
  const normalized = query.toLocaleLowerCase("en-US");
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
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("limit", "5");
  endpoint.searchParams.set("addressdetails", "1");
  endpoint.searchParams.set("accept-language", "zh-CN,zh,en");

  let response;
  try {
    response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "User-Agent": "XiaoColour-Footprints/1.0 (+https://xiao-colours.zhuoxiaoting0524.workers.dev/)",
        Referer: "https://xiao-colours.zhuoxiaoting0524.workers.dev/",
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
          `SELECT * FROM footprints WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 500`,
        ).bind(session.user.id).all()
        : await db.prepare(
          `SELECT * FROM footprints WHERE user_id = ? AND status = ? ORDER BY updated_at DESC, id DESC LIMIT 500`,
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
           longitude, latitude, geocoder, source_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        timestamp,
        timestamp,
      ).run();
      const row = await db.prepare(
        `SELECT * FROM footprints WHERE id = ? AND user_id = ?`,
      ).bind(id, session.user.id).first();
      return json({ ok: true, footprint: publicFootprint(row) }, 201);
    }

    const match = path.match(/^\/api\/me\/footprints\/([^/]+)$/);
    if (!match) return null;
    const id = decodeURIComponent(match[1]);
    const existing = await db.prepare(
      `SELECT * FROM footprints WHERE id = ? AND user_id = ?`,
    ).bind(id, session.user.id).first();
    if (!existing) return errorJson(404, "not_found", "足迹不存在");

    if (request.method === "PATCH") {
      const changes = cleanFootprint(await readJsonBody(request), { partial: true });
      const updatedAt = nowIso();
      await db.prepare(
        `UPDATE footprints
         SET name = ?, location_label = ?, status = ?, visited_date = ?, note = ?,
             longitude = ?, latitude = ?, geocoder = ?, source_id = ?, updated_at = ?
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
        updatedAt,
        id,
        session.user.id,
      ).run();
      const row = await db.prepare(
        `SELECT * FROM footprints WHERE id = ? AND user_id = ?`,
      ).bind(id, session.user.id).first();
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
    if (/no such table: (footprints|geocode_cache|geocode_rate_state)/.test(String(error?.message || ""))) {
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
