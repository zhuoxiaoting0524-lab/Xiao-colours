import { nowIso, randomToken } from "./crypto-util.js";
import { requireDb } from "./db.js";
import { assertSameOrigin, errorJson, json, readJsonBody } from "./http.js";
import { assertCsrf, loadSession } from "./sessions.js";

const COLORS = new Set(["ivory", "sage", "blue", "rose"]);
const SORTS = new Set(["updated_desc", "created_desc", "created_asc"]);

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

function publicNote(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    color: row.color,
    pinned: Boolean(row.is_pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cleanNote(body, { partial = false } = {}) {
  const data = {};
  if (!partial || Object.hasOwn(body, "title")) {
    data.title = String(body.title ?? "").trim().slice(0, 120);
  }
  if (!partial || Object.hasOwn(body, "body")) {
    data.body = String(body.body ?? "").slice(0, 6000);
  }
  if (!partial || Object.hasOwn(body, "color")) {
    const color = String(body.color || "ivory");
    if (!COLORS.has(color)) {
      const error = new Error("便签颜色无效");
      error.code = "invalid_color";
      error.status = 400;
      throw error;
    }
    data.color = color;
  }
  if (!partial || Object.hasOwn(body, "pinned")) {
    data.pinned = body.pinned ? 1 : 0;
  }
  return data;
}

export async function handleNotesApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/me/notes")) return null;
  const db = requireDb(env);

  try {
    if (path === "/api/me/notes" && request.method === "GET") {
      const session = await requireSession(db, request);
      const search = String(url.searchParams.get("search") || "").trim().slice(0, 120);
      const sort = SORTS.has(url.searchParams.get("sort"))
        ? url.searchParams.get("sort")
        : "updated_desc";
      const order = sort === "created_asc"
        ? "created_at ASC"
        : sort === "created_desc" ? "created_at DESC" : "updated_at DESC";
      let rows;
      if (search) {
        const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
        rows = await db.prepare(
          `SELECT * FROM personal_notes
           WHERE user_id = ? AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')
           ORDER BY is_pinned DESC, ${order}, id DESC
           LIMIT 300`,
        ).bind(session.user.id, pattern, pattern).all();
      } else {
        rows = await db.prepare(
          `SELECT * FROM personal_notes
           WHERE user_id = ?
           ORDER BY is_pinned DESC, ${order}, id DESC
           LIMIT 300`,
        ).bind(session.user.id).all();
      }
      return json({ ok: true, notes: (rows.results || []).map(publicNote) });
    }

    if (path === "/api/me/notes" && request.method === "POST") {
      const session = await requireSession(db, request, { csrf: true });
      const body = cleanNote(await readJsonBody(request));
      const id = randomToken(12);
      const timestamp = nowIso();
      await db.prepare(
        `INSERT INTO personal_notes
          (id, user_id, title, body, color, is_pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        session.user.id,
        body.title || "Untitled note",
        body.body,
        body.color,
        body.pinned,
        timestamp,
        timestamp,
      ).run();
      const row = await db.prepare(
        `SELECT * FROM personal_notes WHERE id = ? AND user_id = ?`,
      ).bind(id, session.user.id).first();
      return json({ ok: true, note: publicNote(row) }, 201);
    }

    const match = path.match(/^\/api\/me\/notes\/([^/]+)$/);
    if (match && request.method === "PATCH") {
      const session = await requireSession(db, request, { csrf: true });
      const id = decodeURIComponent(match[1]);
      const changes = cleanNote(await readJsonBody(request), { partial: true });
      const existing = await db.prepare(
        `SELECT * FROM personal_notes WHERE id = ? AND user_id = ?`,
      ).bind(id, session.user.id).first();
      if (!existing) return errorJson(404, "not_found", "便签不存在");
      const updatedAt = nowIso();
      await db.prepare(
        `UPDATE personal_notes
         SET title = ?, body = ?, color = ?, is_pinned = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      ).bind(
        changes.title ?? existing.title,
        changes.body ?? existing.body,
        changes.color ?? existing.color,
        changes.pinned ?? existing.is_pinned,
        updatedAt,
        id,
        session.user.id,
      ).run();
      const row = await db.prepare(
        `SELECT * FROM personal_notes WHERE id = ? AND user_id = ?`,
      ).bind(id, session.user.id).first();
      return json({ ok: true, note: publicNote(row) });
    }

    if (match && request.method === "DELETE") {
      const session = await requireSession(db, request, { csrf: true });
      const id = decodeURIComponent(match[1]);
      const result = await db.prepare(
        `DELETE FROM personal_notes WHERE id = ? AND user_id = ?`,
      ).bind(id, session.user.id).run();
      if (!result.meta?.changes) return errorJson(404, "not_found", "便签不存在");
      return json({ ok: true });
    }

    return null;
  } catch (error) {
    if (String(error?.message || "").includes("no such table: personal_notes")) {
      return errorJson(
        503,
        "schema_missing",
        "Little Notes 数据表尚未初始化。请由管理员完成第二阶段数据库迁移后重试。",
      );
    }
    const status = error.status || (error.code === "db_unavailable" ? 503 : 400);
    if (error.code === "unauthorized") return errorJson(401, error.code, error.message);
    if (error.code === "csrf" || error.code === "csrf_origin") {
      return errorJson(403, error.code, error.message);
    }
    console.error(JSON.stringify({ event: "notes_api_error", code: error.code, message: error.message }));
    return errorJson(status, error.code || "notes_error", error.message || "便签请求失败");
  }
}
