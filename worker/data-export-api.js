import { requireDb } from "./db.js";
import { errorJson } from "./http.js";
import { loadSession } from "./sessions.js";

const BACKUP_FORMAT = "xiaocolour-backup";
const BACKUP_VERSION = 1;
const MAX_ZIP_BYTES = 24 * 1024 * 1024;
const encoder = new TextEncoder();

function attachmentHeaders(contentType, filename) {
  return {
    "content-type": contentType,
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "private, no-store, max-age=0",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
  };
}

function dateStamp(iso = new Date().toISOString()) { return iso.slice(0, 10); }
function safeSegment(value, fallback = "record") {
  return String(value || "").normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || fallback;
}
function extensionFor(contentType) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}
function rows(result) { return Array.isArray(result?.results) ? result.results : []; }

async function tableNames(db) {
  const result = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all();
  return new Set(rows(result).map((row) => row.name));
}

async function selectForUser(db, tables, table, userId, orderBy = "created_at ASC") {
  if (!tables.has(table)) return [];
  const result = await db.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY ${orderBy}`).bind(userId).all();
  return rows(result);
}

function withoutPrivateColumns(row, additional = []) {
  const copy = { ...row };
  ["user_id", "image_data", ...additional].forEach((key) => delete copy[key]);
  return copy;
}

function publicTask(row) {
  return { id: row.id, title: row.title, date: row.task_date, time: row.task_time || null, tag: row.tag || null, completed: Boolean(row.is_completed), repeatRule: row.repeat_rule || "none", recurrenceGroupId: row.recurrence_group_id || null, completedAt: row.completed_at || null, createdAt: row.created_at, updatedAt: row.updated_at };
}
function publicImportantDate(row) {
  return { id: row.id, title: row.title, date: row.event_date, note: row.note || "", repeatRule: row.repeat_rule || "none", createdAt: row.created_at, updatedAt: row.updated_at };
}
function publicPhoto(photo) {
  return {
    id: photo.id,
    contentType: photo.content_type,
    byteSize: Number(photo.byte_size || 0),
    originalName: photo.original_name || null,
    caption: photo.caption || "",
    position: Number(photo.position || 0),
    isCover: Boolean(photo.is_cover),
    createdAt: photo.created_at,
    updatedAt: photo.updated_at,
  };
}
function publicFootprint(row, photos = []) {
  const normalizedPhotos = photos.map(publicPhoto);
  const cover = normalizedPhotos.find((photo) => photo.isCover) || normalizedPhotos[0] || null;
  return {
    id: row.id, name: row.name, locationLabel: row.location_label || "", status: row.status,
    visitedDate: row.visited_date || null, note: row.note || "", longitude: Number(row.longitude), latitude: Number(row.latitude),
    geocoder: row.geocoder || null, sourceId: row.source_id || null, nameZh: row.name_zh || null, nameEn: row.name_en || null,
    countryCode: row.country_code || null, placeType: row.place_type || null,
    photo: cover,
    photos: normalizedPhotos,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function collectUserExport(db, user, { includePhotoBytes = false } = {}) {
  const tables = await tableNames(db);
  const userId = user.id;
  const [taskRows, importantDateRows, footprintRows, photoMetadataRows, noteRows, journalRows, galleryRows, mediaRows] = await Promise.all([
    selectForUser(db, tables, "day_tasks", userId, "task_date ASC, created_at ASC"),
    selectForUser(db, tables, "important_dates", userId, "event_date ASC, created_at ASC"),
    selectForUser(db, tables, "footprints", userId),
    tables.has("footprint_photos")
      ? db.prepare(`SELECT id, footprint_id, user_id, content_type, byte_size,
                           original_name, caption, position, is_cover, created_at, updated_at
                    FROM footprint_photos WHERE user_id = ?
                    ORDER BY footprint_id ASC, is_cover DESC, position ASC, created_at ASC`).bind(userId).all().then(rows)
      : [],
    selectForUser(db, tables, "personal_notes", userId),
    selectForUser(db, tables, "journal_pages", userId),
    selectForUser(db, tables, "gallery_items", userId),
    selectForUser(db, tables, "media_objects", userId),
  ]);
  const photosByFootprint = new Map();
  for (const photo of photoMetadataRows) {
    const album = photosByFootprint.get(photo.footprint_id) || [];
    album.push(photo);
    photosByFootprint.set(photo.footprint_id, album);
  }
  const footprints = footprintRows.map((footprint) => publicFootprint(footprint, photosByFootprint.get(footprint.id) || []));
  const exportedAt = new Date().toISOString();
  const data = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt,
    account: { id: user.id, email: user.email, displayName: user.displayName },
    data: {
      myDays: taskRows.map(publicTask), importantDates: importantDateRows.map(publicImportantDate), footprints,
      other: {
        notes: noteRows.map((row) => withoutPrivateColumns(row)),
        journalPages: journalRows.map((row) => withoutPrivateColumns(row)),
        galleryItems: galleryRows.map((row) => withoutPrivateColumns(row)),
        mediaMetadata: mediaRows.map((row) => withoutPrivateColumns(row)),
      },
    },
    counts: { myDays: taskRows.length, importantDates: importantDateRows.length, footprints: footprints.length, footprintPhotos: photoMetadataRows.length, otherRecords: noteRows.length + journalRows.length + galleryRows.length + mediaRows.length },
  };
  const declaredPhotoBytes = photoMetadataRows.reduce((sum, photo) => sum + Number(photo.byte_size || 0), 0);
  if (includePhotoBytes && declaredPhotoBytes > MAX_ZIP_BYTES) {
    const error = new Error("照片备份超过单次下载上限，请联系管理员分批导出");
    error.code = "backup_too_large";
    error.status = 413;
    error.photoBytes = declaredPhotoBytes;
    throw error;
  }
  const photoRows = includePhotoBytes && tables.has("footprint_photos")
    ? rows(await db.prepare(`SELECT * FROM footprint_photos WHERE user_id = ? ORDER BY created_at ASC`).bind(userId).all())
    : [];
  const photos = photoRows.map((photo) => ({
    id: photo.id, footprintId: photo.footprint_id, contentType: photo.content_type, byteSize: Number(photo.byte_size || 0),
    bytes: photo.image_data instanceof Uint8Array ? photo.image_data : new Uint8Array(photo.image_data || []),
  }));
  return { data, photos };
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let k = 0; k < 8; k += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      crcTable[n] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function viewOf(length) { const bytes = new Uint8Array(length); return { bytes, view: new DataView(bytes.buffer) }; }
function concatBytes(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

export function createZip(files) {
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const content = file.bytes instanceof Uint8Array ? file.bytes : encoder.encode(String(file.bytes));
    const checksum = crc32(content);
    const local = viewOf(30 + name.length);
    local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true); local.view.setUint16(6, 0x0800, true);
    local.view.setUint32(14, checksum, true); local.view.setUint32(18, content.length, true); local.view.setUint32(22, content.length, true); local.view.setUint16(26, name.length, true); local.bytes.set(name, 30);
    localParts.push(local.bytes, content);
    const central = viewOf(46 + name.length);
    central.view.setUint32(0, 0x02014b50, true); central.view.setUint16(4, 20, true); central.view.setUint16(6, 20, true); central.view.setUint16(8, 0x0800, true);
    central.view.setUint32(16, checksum, true); central.view.setUint32(20, content.length, true); central.view.setUint32(24, content.length, true); central.view.setUint16(28, name.length, true); central.view.setUint32(42, offset, true); central.bytes.set(name, 46);
    centralParts.push(central.bytes); offset += local.bytes.length + content.length;
  }
  const centralDirectory = concatBytes(centralParts);
  const end = viewOf(22);
  end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, files.length, true); end.view.setUint16(10, files.length, true); end.view.setUint32(12, centralDirectory.length, true); end.view.setUint32(16, offset, true);
  return concatBytes([...localParts, centralDirectory, end.bytes]);
}

function prettyJson(value) { return encoder.encode(`${JSON.stringify(value, null, 2)}\n`); }
function zipFiles(exported, photos) {
  const root = "XiaoColour-Backup", photoPaths = new Map();
  const photoFiles = photos.map((photo) => {
    const filename = `${safeSegment(photo.footprintId, "footprint")}-${safeSegment(photo.id, "photo")}.${extensionFor(photo.contentType)}`;
    const path = `${root}/photos/footprints/${filename}`;
    photoPaths.set(photo.id, path);
    return { name: path, bytes: photo.bytes };
  });
  const footprints = exported.data.footprints.map((footprint) => {
    const photos = (footprint.photos || []).map((photo) => ({ ...photo, backupPath: photoPaths.get(photo.id) || null }));
    const cover = photos.find((photo) => photo.isCover) || photos[0] || null;
    return { ...footprint, photo: cover, photos };
  });
  const manifest = { format: exported.format, version: exported.version, exportedAt: exported.exportedAt, account: exported.account, counts: exported.counts, contents: ["data/my-days.json", "data/important-dates.json", "data/footprints.json", "data/other-data.json", ...photoFiles.map((file) => file.name.replace(`${root}/`, ""))] };
  return [
    { name: `${root}/manifest.json`, bytes: prettyJson(manifest) },
    { name: `${root}/data/my-days.json`, bytes: prettyJson(exported.data.myDays) },
    { name: `${root}/data/important-dates.json`, bytes: prettyJson(exported.data.importantDates) },
    { name: `${root}/data/footprints.json`, bytes: prettyJson(footprints) },
    { name: `${root}/data/other-data.json`, bytes: prettyJson(exported.data.other) },
    ...photoFiles,
  ];
}

export async function handleDataExportApi(request, env) {
  const url = new URL(request.url);
  if (request.method !== "GET") return errorJson(405, "method_not_allowed", "仅支持下载");
  const db = requireDb(env);
  const session = await loadSession(db, request);
  if (!session) return errorJson(401, "unauthorized", "请先登录");
  if (url.pathname === "/api/me/export.json") {
    const { data } = await collectUserExport(db, session.user);
    return new Response(`${JSON.stringify(data, null, 2)}\n`, { headers: attachmentHeaders("application/json; charset=utf-8", `XiaoColour-Data-${dateStamp(data.exportedAt)}.json`) });
  }
  if (url.pathname === "/api/me/backup.zip") {
    let exported;
    try {
      exported = await collectUserExport(db, session.user, { includePhotoBytes: true });
    } catch (error) {
      if (error?.code === "backup_too_large") return errorJson(413, error.code, error.message, { limitBytes: MAX_ZIP_BYTES, photoBytes: error.photoBytes });
      throw error;
    }
    const { data, photos } = exported;
    const photoBytes = photos.reduce((sum, photo) => sum + photo.bytes.byteLength, 0);
    if (photoBytes > MAX_ZIP_BYTES) return errorJson(413, "backup_too_large", "照片备份超过单次下载上限，请联系管理员分批导出", { limitBytes: MAX_ZIP_BYTES, photoBytes });
    const zip = createZip(zipFiles(data, photos));
    if (zip.byteLength > MAX_ZIP_BYTES) return errorJson(413, "backup_too_large", "备份文件超过单次下载上限，请联系管理员分批导出", { limitBytes: MAX_ZIP_BYTES, backupBytes: zip.byteLength });
    return new Response(zip, { headers: attachmentHeaders("application/zip", `XiaoColour-Backup-${dateStamp(data.exportedAt)}.zip`) });
  }
  return null;
}
