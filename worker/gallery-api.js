/**
 * Private Gallery CRUD + R2 media.
 * Every query is scoped by session.user.id; client-supplied ownership is ignored.
 */
import { nowIso, randomToken } from "./crypto-util.js";
import { requireDb } from "./db.js";
import { assertSameOrigin, errorJson, json, readJsonBody } from "./http.js";
import { assertCsrf, loadSession } from "./sessions.js";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_CATEGORIES = new Set(["places", "nature", "moments"]);

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

function requireMediaBucket(env) {
  if (!env?.MEDIA) {
    const error = new Error("图片存储尚未启用，请管理员绑定 R2（MEDIA）后重新部署");
    error.code = "r2_unavailable";
    error.status = 503;
    throw error;
  }
  return env.MEDIA;
}

function normalizeCategory(value) {
  const category = String(value || "moments").toLowerCase();
  return ALLOWED_CATEGORIES.has(category) ? category : "moments";
}

function normalizeMeta(input = {}) {
  return {
    title: String(input.title || "Untitled memory").trim().slice(0, 80) || "Untitled memory",
    note: String(input.note || "").trim().slice(0, 280),
    category: normalizeCategory(input.category),
  };
}

function extensionFor(contentType) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "jpg";
}

function galleryItem(row) {
  return {
    id: row.id,
    title: row.title || "Untitled memory",
    note: row.note || "",
    category: normalizeCategory(row.category),
    position: Number(row.position || 0),
    mediaId: row.media_id,
    imageUrl: `/api/me/gallery/media/${encodeURIComponent(row.media_id)}?v=${encodeURIComponent(row.updated_at || "")}`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ownGallery(db, userId) {
  return db.prepare(
    `SELECT id, user_id FROM galleries WHERE user_id = ?`,
  ).bind(userId).first();
}

async function itemRow(db, userId, itemId) {
  return db.prepare(
    `SELECT gi.*, mo.r2_key, mo.content_type, mo.byte_size
     FROM gallery_items gi
     JOIN media_objects mo ON mo.id = gi.media_id
     WHERE gi.id = ? AND gi.user_id = ? AND mo.user_id = ? AND mo.space = 'gallery'`,
  ).bind(itemId, userId, userId).first();
}

async function renumberPositions(db, galleryId, userId) {
  const rows = await db.prepare(
    `SELECT id FROM gallery_items
     WHERE gallery_id = ? AND user_id = ?
     ORDER BY position ASC, created_at ASC, id ASC`,
  ).bind(galleryId, userId).all();
  const items = rows.results || [];
  if (!items.length) return;
  const stamp = nowIso();
  await db.batch([
    ...items.map((row, index) => db.prepare(
      `UPDATE gallery_items SET position = ? WHERE id = ? AND user_id = ?`,
    ).bind(-(index + 1), row.id, userId)),
    ...items.map((row, index) => db.prepare(
      `UPDATE gallery_items SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).bind(index + 1, stamp, row.id, userId)),
  ]);
}

async function readImage(request) {
  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    const error = new Error("仅支持 JPEG、PNG、WebP 或 GIF 图片");
    error.code = "invalid_type";
    error.status = 400;
    throw error;
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength) {
    const error = new Error("请选择有效图片");
    error.code = "empty";
    error.status = 400;
    throw error;
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    const error = new Error("单张图片不能超过 8MB");
    error.code = "too_large";
    error.status = 400;
    throw error;
  }
  return { bytes, contentType };
}

export async function handleGalleryApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/me/gallery")) return null;

  const db = requireDb(env);

  try {
    if (path === "/api/me/gallery/items" && request.method === "GET") {
      const session = await requireSession(db, request);
      const rows = await db.prepare(
        `SELECT * FROM gallery_items WHERE user_id = ?
         ORDER BY position ASC, created_at ASC, id ASC`,
      ).bind(session.user.id).all();
      return json({
        ok: true,
        items: (rows.results || []).map(galleryItem),
        storage: env.MEDIA ? "r2" : "r2_unconfigured",
      });
    }

    // Raw image upload. Metadata travels in same-origin query parameters.
    if (path === "/api/me/gallery/items" && request.method === "POST") {
      const session = await requireSession(db, request, { csrf: true });
      const bucket = requireMediaBucket(env);
      const gallery = await ownGallery(db, session.user.id);
      if (!gallery) return errorJson(404, "not_found", "Gallery 不存在");
      const image = await readImage(request);
      const meta = normalizeMeta({
        title: url.searchParams.get("title"),
        note: url.searchParams.get("note"),
        category: url.searchParams.get("category"),
      });
      const id = randomToken(12);
      const mediaId = randomToken(12);
      const r2Key = `users/${session.user.id}/gallery/${mediaId}.${extensionFor(image.contentType)}`;
      const createdAt = nowIso();
      const maxRow = await db.prepare(
        `SELECT COALESCE(MAX(position), 0) AS m FROM gallery_items
         WHERE gallery_id = ? AND user_id = ?`,
      ).bind(gallery.id, session.user.id).first();
      const position = Number(maxRow?.m || 0) + 1;

      await bucket.put(r2Key, image.bytes, {
        httpMetadata: { contentType: image.contentType },
        customMetadata: { userId: session.user.id, mediaId, space: "gallery" },
      });

      try {
        await db.batch([
          db.prepare(
            `INSERT INTO media_objects
              (id, user_id, space, r2_key, content_type, byte_size, created_at)
             VALUES (?, ?, 'gallery', ?, ?, ?, ?)`,
          ).bind(mediaId, session.user.id, r2Key, image.contentType, image.bytes.byteLength, createdAt),
          db.prepare(
            `INSERT INTO gallery_items
              (id, gallery_id, user_id, media_id, position, title, note, category, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            id,
            gallery.id,
            session.user.id,
            mediaId,
            position,
            meta.title,
            meta.note,
            meta.category,
            createdAt,
            createdAt,
          ),
          db.prepare(
            `UPDATE galleries SET updated_at = ? WHERE id = ? AND user_id = ?`,
          ).bind(createdAt, gallery.id, session.user.id),
        ]);
      } catch (error) {
        await bucket.delete(r2Key).catch(() => {});
        throw error;
      }

      const row = await db.prepare(
        `SELECT * FROM gallery_items WHERE id = ? AND user_id = ?`,
      ).bind(id, session.user.id).first();
      return json({ ok: true, item: galleryItem(row) }, 201);
    }

    const mediaMatch = path.match(/^\/api\/me\/gallery\/media\/([^/]+)$/);
    if (mediaMatch && request.method === "GET") {
      const session = await requireSession(db, request);
      const bucket = requireMediaBucket(env);
      const mediaId = decodeURIComponent(mediaMatch[1]);
      const row = await db.prepare(
        `SELECT * FROM media_objects
         WHERE id = ? AND user_id = ? AND space = 'gallery'`,
      ).bind(mediaId, session.user.id).first();
      if (!row) return errorJson(404, "not_found", "图片不存在");
      const object = await bucket.get(row.r2_key);
      if (!object) return errorJson(404, "not_found", "图片文件不存在");
      const headers = new Headers();
      headers.set("content-type", row.content_type || object.httpMetadata?.contentType || "application/octet-stream");
      headers.set("cache-control", "private, no-cache");
      headers.set("x-content-type-options", "nosniff");
      headers.set("content-security-policy", "default-src 'none'; sandbox");
      return new Response(object.body, { status: 200, headers });
    }

    const replaceMatch = path.match(/^\/api\/me\/gallery\/items\/([^/]+)\/image$/);
    if (replaceMatch && request.method === "PUT") {
      const session = await requireSession(db, request, { csrf: true });
      const bucket = requireMediaBucket(env);
      const itemId = decodeURIComponent(replaceMatch[1]);
      const existing = await itemRow(db, session.user.id, itemId);
      if (!existing) return errorJson(404, "not_found", "照片不存在");
      const image = await readImage(request);
      const newKey = `users/${session.user.id}/gallery/${existing.media_id}-${randomToken(6)}.${extensionFor(image.contentType)}`;
      const updatedAt = nowIso();
      await bucket.put(newKey, image.bytes, {
        httpMetadata: { contentType: image.contentType },
        customMetadata: { userId: session.user.id, mediaId: existing.media_id, space: "gallery" },
      });
      try {
        await db.batch([
          db.prepare(
            `UPDATE media_objects SET r2_key = ?, content_type = ?, byte_size = ?
             WHERE id = ? AND user_id = ? AND space = 'gallery'`,
          ).bind(newKey, image.contentType, image.bytes.byteLength, existing.media_id, session.user.id),
          db.prepare(
            `UPDATE gallery_items SET updated_at = ? WHERE id = ? AND user_id = ?`,
          ).bind(updatedAt, itemId, session.user.id),
          db.prepare(
            `UPDATE galleries SET updated_at = ? WHERE id = ? AND user_id = ?`,
          ).bind(updatedAt, existing.gallery_id, session.user.id),
        ]);
      } catch (error) {
        await bucket.delete(newKey).catch(() => {});
        throw error;
      }
      await bucket.delete(existing.r2_key).catch((error) => {
        console.error(JSON.stringify({ event: "gallery_old_media_delete_failed", message: error.message }));
      });
      const row = await db.prepare(
        `SELECT * FROM gallery_items WHERE id = ? AND user_id = ?`,
      ).bind(itemId, session.user.id).first();
      return json({ ok: true, item: galleryItem(row) });
    }

    const itemMatch = path.match(/^\/api\/me\/gallery\/items\/([^/]+)$/);
    if (itemMatch && request.method === "PATCH") {
      const session = await requireSession(db, request, { csrf: true });
      const itemId = decodeURIComponent(itemMatch[1]);
      const existing = await itemRow(db, session.user.id, itemId);
      if (!existing) return errorJson(404, "not_found", "照片不存在");
      const meta = normalizeMeta(await readJsonBody(request, { maxBytes: 8_000 }));
      const updatedAt = nowIso();
      await db.batch([
        db.prepare(
          `UPDATE gallery_items
           SET title = ?, note = ?, category = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
        ).bind(meta.title, meta.note, meta.category, updatedAt, itemId, session.user.id),
        db.prepare(
          `UPDATE galleries SET updated_at = ? WHERE id = ? AND user_id = ?`,
        ).bind(updatedAt, existing.gallery_id, session.user.id),
      ]);
      const row = await db.prepare(
        `SELECT * FROM gallery_items WHERE id = ? AND user_id = ?`,
      ).bind(itemId, session.user.id).first();
      return json({ ok: true, item: galleryItem(row) });
    }

    if (itemMatch && request.method === "DELETE") {
      const session = await requireSession(db, request, { csrf: true });
      const bucket = requireMediaBucket(env);
      const itemId = decodeURIComponent(itemMatch[1]);
      const existing = await itemRow(db, session.user.id, itemId);
      if (!existing) return errorJson(404, "not_found", "照片不存在");
      await db.batch([
        db.prepare(
          `DELETE FROM gallery_items WHERE id = ? AND user_id = ?`,
        ).bind(itemId, session.user.id),
        db.prepare(
          `DELETE FROM media_objects WHERE id = ? AND user_id = ? AND space = 'gallery'`,
        ).bind(existing.media_id, session.user.id),
        db.prepare(
          `UPDATE galleries SET updated_at = ? WHERE id = ? AND user_id = ?`,
        ).bind(nowIso(), existing.gallery_id, session.user.id),
      ]);
      await renumberPositions(db, existing.gallery_id, session.user.id);
      await bucket.delete(existing.r2_key).catch((error) => {
        console.error(JSON.stringify({ event: "gallery_media_delete_failed", message: error.message }));
      });
      return json({ ok: true, deletedId: itemId });
    }

    return null;
  } catch (error) {
    const message = String(error?.message || "");
    if (/no such table:\s*gallery_items/i.test(message)) {
      return errorJson(503, "schema_missing", "Gallery 数据表尚未迁移，请执行 0003_gallery_items");
    }
    const status = error.status || (error.code === "db_unavailable" || error.code === "r2_unavailable" ? 503 : 400);
    if (error.code === "unauthorized") return errorJson(401, error.code, error.message);
    if (["forbidden", "csrf", "csrf_origin"].includes(error.code)) {
      return errorJson(403, error.code, error.message);
    }
    console.error(JSON.stringify({ event: "gallery_api_error", code: error.code, message: error.message }));
    return errorJson(status, error.code || "error", error.message || "请求失败");
  }
}
