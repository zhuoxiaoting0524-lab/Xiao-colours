/**
 * Private Journal page + media APIs.
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

/** Canonical page coordinate space for collage editor (paper-relative). */
export const PAGE_COORD = Object.freeze({
  space: "page",
  unit: "normalized",
  origin: "top-left",
  width: 1000,
  height: 1400,
});

const MAX_LAYERS = 80;
const MAX_TEXT_LEN = 4000;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

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

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function sanitizeContent(input) {
  const coord = {
    ...PAGE_COORD,
    ...(input?.coord && typeof input.coord === "object" ? {
      width: PAGE_COORD.width,
      height: PAGE_COORD.height,
      space: "page",
      unit: "normalized",
      origin: "top-left",
    } : {}),
  };
  const rawLayers = Array.isArray(input?.layers) ? input.layers : [];
  if (rawLayers.length > MAX_LAYERS) {
    const error = new Error(`图层过多（最多 ${MAX_LAYERS}）`);
    error.code = "too_many_layers";
    error.status = 400;
    throw error;
  }
  const layers = [];
  for (const layer of rawLayers) {
    if (!layer || typeof layer !== "object") continue;
    const type = layer.type === "photo" ? "photo" : layer.type === "text" ? "text" : null;
    if (!type) continue;
    const id = String(layer.id || randomToken(10)).slice(0, 40);
    const t = layer.transform || {};
    const transform = {
      x: clamp(Number(t.x) || 0, -200, coord.width + 200),
      y: clamp(Number(t.y) || 0, -200, coord.height + 200),
      w: clamp(Number(t.w) || 100, 40, coord.width * 1.5),
      h: clamp(Number(t.h) || 100, 40, coord.height * 1.5),
      rotate: clamp(Number(t.rotate) || 0, -180, 180),
    };
    const z = clamp(Math.trunc(Number(layer.z) || 1), 1, 10_000);
    const payload = {};
    if (type === "text") {
      payload.text = String(layer.payload?.text ?? "文字").slice(0, MAX_TEXT_LEN);
      payload.fontSize = clamp(Number(layer.payload?.fontSize) || 36, 16, 120);
      payload.color = String(layer.payload?.color || "#2a2418").slice(0, 32);
    } else {
      const mediaId = String(layer.payload?.mediaId || "").slice(0, 40);
      const r2Key = String(layer.payload?.r2Key || "").slice(0, 240);
      if (!mediaId || !r2Key) continue;
      payload.mediaId = mediaId;
      payload.r2Key = r2Key;
    }
    layers.push({ id, type, z, transform, payload });
  }
  return {
    version: 1,
    coord,
    background: { paper: "ruled" },
    layers,
  };
}

function parseContent(raw) {
  try {
    const data = JSON.parse(raw || "{}");
    return sanitizeContent(data);
  } catch {
    return {
      version: 1,
      coord: { ...PAGE_COORD },
      background: { paper: "ruled" },
      layers: [],
    };
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

function requireMediaBucket(env) {
  if (!env?.MEDIA) {
    const error = new Error("R2 尚未绑定（env.MEDIA）。请创建私有 bucket xiao-colours-media 并重新部署。");
    error.code = "r2_unavailable";
    error.status = 503;
    throw error;
  }
  return env.MEDIA;
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
        media: { storage: env.MEDIA ? "r2" : "r2_unconfigured", prefix: `users/${session.user.id}/` },
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

    // POST /api/me/journal/media — private R2 upload
    if (path === "/api/me/journal/media" && request.method === "POST") {
      const session = await requireSession(db, request, { csrf: true });
      const bucket = requireMediaBucket(env);
      const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
        return errorJson(400, "invalid_type", "仅支持 JPEG / PNG / WebP / GIF");
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.byteLength) return errorJson(400, "empty", "空文件");
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        return errorJson(400, "too_large", "图片不能超过 5MB");
      }
      const id = randomToken(12);
      const ext = contentType === "image/png" ? "png"
        : contentType === "image/webp" ? "webp"
          : contentType === "image/gif" ? "gif" : "jpg";
      const r2Key = `users/${session.user.id}/journal/${id}.${ext}`;
      await bucket.put(r2Key, bytes, {
        httpMetadata: { contentType },
        customMetadata: { userId: session.user.id, mediaId: id },
      });
      const createdAt = nowIso();
      await db.prepare(
        `INSERT INTO media_objects
          (id, user_id, space, r2_key, content_type, byte_size, created_at)
         VALUES (?, ?, 'journal', ?, ?, ?, ?)`,
      ).bind(id, session.user.id, r2Key, contentType, bytes.byteLength, createdAt).run();
      return json({
        ok: true,
        media: {
          id,
          r2Key,
          contentType,
          byteSize: bytes.byteLength,
          url: `/api/me/journal/media/${id}`,
        },
      }, 201);
    }

    // GET /api/me/journal/media/:id — authenticated private fetch
    const mediaMatch = path.match(/^\/api\/me\/journal\/media\/([^/]+)$/);
    if (mediaMatch && request.method === "GET") {
      const session = await requireSession(db, request);
      const bucket = requireMediaBucket(env);
      const mediaId = decodeURIComponent(mediaMatch[1]);
      const row = await db.prepare(
        `SELECT * FROM media_objects WHERE id = ? AND user_id = ? AND space = 'journal'`,
      ).bind(mediaId, session.user.id).first();
      if (!row) return errorJson(404, "not_found", "媒体不存在");
      const obj = await bucket.get(row.r2_key);
      if (!obj) return errorJson(404, "not_found", "媒体文件不存在");
      const headers = new Headers();
      headers.set("content-type", row.content_type || obj.httpMetadata?.contentType || "application/octet-stream");
      headers.set("cache-control", "private, max-age=3600");
      headers.set("x-content-type-options", "nosniff");
      return new Response(obj.body, { status: 200, headers });
    }

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

    if (pageMatch && request.method === "PATCH") {
      const session = await requireSession(db, request, { csrf: true });
      const pageId = decodeURIComponent(pageMatch[1]);
      const existing = await db.prepare(
        `SELECT * FROM journal_pages WHERE id = ? AND user_id = ?`,
      ).bind(pageId, session.user.id).first();
      if (!existing) return errorJson(404, "not_found", "页面不存在");

      const body = await readJsonBody(request, { maxBytes: 512_000 });
      const content = sanitizeContent(body.content || body);
      // Ensure photo layers reference media owned by this user
      for (const layer of content.layers) {
        if (layer.type !== "photo") continue;
        const media = await db.prepare(
          `SELECT id, r2_key FROM media_objects WHERE id = ? AND user_id = ? AND space = 'journal'`,
        ).bind(layer.payload.mediaId, session.user.id).first();
        if (!media || media.r2_key !== layer.payload.r2Key) {
          return errorJson(400, "invalid_media", "照片资源无效或不属于当前用户");
        }
      }

      const updatedAt = nowIso();
      await db.prepare(
        `UPDATE journal_pages SET content_json = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      ).bind(JSON.stringify(content), updatedAt, pageId, session.user.id).run();
      await db.prepare(
        `UPDATE journals SET updated_at = ? WHERE id = ? AND user_id = ?`,
      ).bind(updatedAt, existing.journal_id, session.user.id).run();

      const row = await db.prepare(
        `SELECT * FROM journal_pages WHERE id = ? AND user_id = ?`,
      ).bind(pageId, session.user.id).first();
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
    if (error.code === "r2_unavailable") return errorJson(503, error.code, error.message);
    if (error.code === "too_many_layers") return errorJson(400, error.code, error.message);
    console.error(JSON.stringify({ event: "journal_api_error", code: error.code, message: error.message }));
    return errorJson(status, error.code || "error", error.message || "请求失败");
  }
}
