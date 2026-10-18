/**
 * Private Journal page APIs.
 * Every query is scoped by session.user.id — client-supplied userId is ignored.
 */
import { nowIso, randomToken } from "./crypto-util.js";
import { requireDb } from "./db.js";
import {
  assertSameOrigin,
  errorJson,
  json,
  readJsonBody,
} from "./http.js";
import { assertCsrf, loadSession } from "./sessions.js";

/** Canonical page coordinate space for future collage editor (paper-relative). */
export const PAGE_COORD = Object.freeze({
  space: "page",
  unit: "normalized",
  origin: "top-left",
  width: 1000,
  height: 1400,
});

export function blankContentJson() {
  return JSON.stringify({
    version: 1,
    coord: PAGE_COORD,
    background: { paper: "ruled" },
    layers: [],
  });
}

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

function parseContent(raw) {
  try {
    const data = JSON.parse(raw || "{}");
    if (!data.coord) data.coord = PAGE_COORD;
    if (!Array.isArray(data.layers)) data.layers = [];
    if (!data.version) data.version = 1;
    return data;
  } catch {
    return { version: 1, coord: PAGE_COORD, background: { paper: "ruled" }, layers: [] };
  }
}

function publicPage(row) {
  return {
    id: row.id,
    journalId: row.journal_id,
    position: row.position,
    year: row.year,
    title: row.title || "",
    content: parseContent(row.content_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getOwnJournal(db, userId) {
  return db.prepare(
    `SELECT id, user_id, created_at, updated_at FROM journals WHERE user_id = ?`,
  ).bind(userId).first();
}

async function insertPageWithRetry(db, { journalId, userId, year, title }) {
  const createdAt = nowIso();
  const contentJson = blankContentJson();
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const maxRow = await db.prepare(
      `SELECT COALESCE(MAX(position), 0) AS m
       FROM journal_pages
       WHERE journal_id = ? AND user_id = ?`,
    ).bind(journalId, userId).first();
    const position = Number(maxRow?.m || 0) + 1;
    const id = randomToken(12);
    try {
      await db.prepare(
        `INSERT INTO journal_pages
          (id, journal_id, user_id, position, year, title, content_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        journalId,
        userId,
        position,
        year,
        title,
        contentJson,
        createdAt,
        createdAt,
      ).run();
      return { id, position, createdAt };
    } catch (error) {
      lastError = error;
      if (!String(error?.message || "").includes("UNIQUE")) throw error;
    }
  }
  const err = new Error("创建页面冲突，请重试");
  err.code = "conflict";
  err.status = 409;
  err.cause = lastError;
  throw err;
}

async function renumberPositions(db, journalId, userId) {
  const rows = await db.prepare(
    `SELECT id FROM journal_pages
     WHERE journal_id = ? AND user_id = ?
     ORDER BY position ASC, created_at ASC, id ASC`,
  ).bind(journalId, userId).all();
  const list = rows.results || [];
  if (!list.length) return;
  const toNegative = list.map((row, index) =>
    db.prepare(
      `UPDATE journal_pages SET position = ? WHERE id = ? AND user_id = ?`,
    ).bind(-(index + 1), row.id, userId),
  );
  const toFinal = list.map((row, index) =>
    db.prepare(
      `UPDATE journal_pages SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).bind(index + 1, nowIso(), row.id, userId),
  );
  await db.batch([...toNegative, ...toFinal]);
}

export async function handleJournalApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/me/journal")) return null;

  const db = requireDb(env);

  try {
    if (path === "/api/me/journal/pages" && request.method === "GET") {
      const session = await requireSession(db, request);
      const yearParam = url.searchParams.get("year");
      const year = yearParam ? Number(yearParam) : null;
      let rows;
      if (year && Number.isFinite(year)) {
        rows = await db.prepare(
          `SELECT * FROM journal_pages
           WHERE user_id = ? AND year = ?
           ORDER BY position ASC, created_at ASC, id ASC`,
        ).bind(session.user.id, year).all();
      } else {
        rows = await db.prepare(
          `SELECT * FROM journal_pages
           WHERE user_id = ?
           ORDER BY position ASC, created_at ASC, id ASC`,
        ).bind(session.user.id).all();
      }
      const years = await db.prepare(
        `SELECT DISTINCT year FROM journal_pages WHERE user_id = ? ORDER BY year DESC`,
      ).bind(session.user.id).all();
      return json({
        ok: true,
        userId: session.user.id,
        coord: PAGE_COORD,
        years: (years.results || []).map((r) => r.year),
        pages: (rows.results || []).map(publicPage),
      });
    }

    if (path === "/api/me/journal/pages" && request.method === "POST") {
      const session = await requireSession(db, request, { csrf: true });
      const body = await readJsonBody(request);
      const journal = await getOwnJournal(db, session.user.id);
      if (!journal) return errorJson(404, "not_found", "Journal 不存在");

      const now = new Date();
      const year = Number.isFinite(Number(body.year))
        ? Math.trunc(Number(body.year))
        : now.getUTCFullYear();
      if (year < 1970 || year > 2100) {
        return errorJson(400, "invalid_year", "年份无效");
      }
      const title = String(body.title || "").slice(0, 120);

      const inserted = await insertPageWithRetry(db, {
        journalId: journal.id,
        userId: session.user.id,
        year,
        title,
      });

      await db.prepare(
        `UPDATE journals SET updated_at = ? WHERE id = ? AND user_id = ?`,
      ).bind(inserted.createdAt, journal.id, session.user.id).run();

      const row = await db.prepare(
        `SELECT * FROM journal_pages WHERE id = ? AND user_id = ?`,
      ).bind(inserted.id, session.user.id).first();

      return json({ ok: true, page: publicPage(row) }, 201);
    }

    // GET /api/me/journal/pages/:id
    const pageMatch = path.match(/^\/api\/me\/journal\/pages\/([^/]+)$/);
    if (pageMatch && request.method === "GET") {
      const session = await requireSession(db, request);
      const pageId = decodeURIComponent(pageMatch[1]);
      const row = await db.prepare(
        `SELECT * FROM journal_pages WHERE id = ? AND user_id = ?`,
      ).bind(pageId, session.user.id).first();
      if (!row) return errorJson(404, "not_found", "页面不存在");
      return json({ ok: true, page: publicPage(row) });
    }

    if (pageMatch && request.method === "DELETE") {
      const session = await requireSession(db, request, { csrf: true });
      const pageId = decodeURIComponent(pageMatch[1]);
      const existing = await db.prepare(
        `SELECT id, journal_id FROM journal_pages WHERE id = ? AND user_id = ?`,
      ).bind(pageId, session.user.id).first();
      if (!existing) return errorJson(404, "not_found", "页面不存在");

      const del = await db.prepare(
        `DELETE FROM journal_pages WHERE id = ? AND user_id = ?`,
      ).bind(pageId, session.user.id).run();
      if (!del.meta?.changes) return errorJson(404, "not_found", "页面不存在");

      await renumberPositions(db, existing.journal_id, session.user.id);
      await db.prepare(
        `UPDATE journals SET updated_at = ? WHERE id = ? AND user_id = ?`,
      ).bind(nowIso(), existing.journal_id, session.user.id).run();

      return json({ ok: true, deletedId: pageId });
    }

    return null;
  } catch (error) {
    const msg = String(error?.message || "");
    if (/no such table:\s*journal_pages/i.test(msg)) {
      return errorJson(
        503,
        "schema_missing",
        "Journal 数据表尚未迁移，请联系管理员执行 0002_journal_pages",
      );
    }
    const status = error.status || (error.code === "db_unavailable" ? 503 : 400);
    if (error.code === "unauthorized") return errorJson(401, error.code, error.message);
    if (error.code === "forbidden" || error.code === "csrf" || error.code === "csrf_origin") {
      return errorJson(403, error.code, error.message);
    }
    if (error.code === "conflict") return errorJson(409, error.code, error.message);
    console.error(JSON.stringify({ event: "journal_api_error", code: error.code, message: error.message }));
    return errorJson(status, error.code || "error", error.message || "请求失败");
  }
}
