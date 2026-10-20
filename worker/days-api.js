import { nowIso, randomToken } from "./crypto-util.js";
import { requireDb } from "./db.js";
import { assertSameOrigin, errorJson, json, readJsonBody } from "./http.js";
import { assertCsrf, loadSession } from "./sessions.js";

const TAGS = new Set(["Personal", "Study", "Health", "Home"]);
const TASK_REPEATS = new Set(["none", "daily", "weekly", "monthly"]);
const DATE_REPEATS = new Set(["none", "yearly"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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

function dateUtc(value) {
  if (!DATE_RE.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function requireDate(value, label = "日期") {
  const date = dateUtc(value);
  if (!date) {
    const error = new Error(`${label}无效`);
    error.code = "invalid_date";
    error.status = 400;
    throw error;
  }
  return date;
}

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, count) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

function addMonthsClamped(date, count) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + count;
  const day = date.getUTCDate();
  const first = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first;
}

function occurrenceDates(start, repeatRule) {
  if (repeatRule === "none") return [dateString(start)];
  const count = repeatRule === "daily" ? 30 : repeatRule === "weekly" ? 12 : 6;
  return Array.from({ length: count }, (_, index) => {
    if (repeatRule === "daily") return dateString(addDays(start, index));
    if (repeatRule === "weekly") return dateString(addDays(start, index * 7));
    return dateString(addMonthsClamped(start, index));
  });
}

function publicTask(row) {
  return {
    id: row.id,
    title: row.title,
    date: row.task_date,
    time: row.task_time,
    tag: row.tag,
    completed: Boolean(row.is_completed),
    repeatRule: row.repeat_rule,
    recurrenceGroupId: row.recurrence_group_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function publicImportantDate(row) {
  return {
    id: row.id,
    title: row.title,
    date: row.event_date,
    note: row.note,
    repeatRule: row.repeat_rule,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cleanTask(body, { partial = false } = {}) {
  const data = {};
  if (!partial || Object.hasOwn(body, "title")) {
    const title = String(body.title || "").trim().slice(0, 140);
    if (!title) {
      const error = new Error("请填写任务名称");
      error.code = "invalid_title";
      error.status = 400;
      throw error;
    }
    data.title = title;
  }
  if (!partial || Object.hasOwn(body, "date")) {
    requireDate(body.date, "任务日期");
    data.date = body.date;
  }
  if (!partial || Object.hasOwn(body, "time")) {
    const time = String(body.time || "").trim();
    if (time && !TIME_RE.test(time)) {
      const error = new Error("任务时间无效");
      error.code = "invalid_time";
      error.status = 400;
      throw error;
    }
    data.time = time || null;
  }
  if (!partial || Object.hasOwn(body, "tag")) {
    const tag = String(body.tag || "Personal");
    if (!TAGS.has(tag)) {
      const error = new Error("任务标签无效");
      error.code = "invalid_tag";
      error.status = 400;
      throw error;
    }
    data.tag = tag;
  }
  if (!partial || Object.hasOwn(body, "repeatRule")) {
    const repeatRule = String(body.repeatRule || "none");
    if (!TASK_REPEATS.has(repeatRule)) {
      const error = new Error("重复规则无效");
      error.code = "invalid_repeat";
      error.status = 400;
      throw error;
    }
    data.repeatRule = repeatRule;
  }
  if (Object.hasOwn(body, "completed")) data.completed = body.completed ? 1 : 0;
  return data;
}

function cleanImportantDate(body, { partial = false } = {}) {
  const data = {};
  if (!partial || Object.hasOwn(body, "title")) {
    const title = String(body.title || "").trim().slice(0, 140);
    if (!title) {
      const error = new Error("请填写重要日期名称");
      error.code = "invalid_title";
      error.status = 400;
      throw error;
    }
    data.title = title;
  }
  if (!partial || Object.hasOwn(body, "date")) {
    requireDate(body.date, "重要日期");
    data.date = body.date;
  }
  if (!partial || Object.hasOwn(body, "note")) data.note = String(body.note || "").slice(0, 500);
  if (!partial || Object.hasOwn(body, "repeatRule")) {
    const repeatRule = String(body.repeatRule || "none");
    if (!DATE_REPEATS.has(repeatRule)) {
      const error = new Error("重复规则无效");
      error.code = "invalid_repeat";
      error.status = 400;
      throw error;
    }
    data.repeatRule = repeatRule;
  }
  return data;
}

async function handleTasks(request, db, session, url, path) {
  if (path === "/api/me/days/tasks" && request.method === "GET") {
    const today = new Date();
    const defaultFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const from = requireDate(url.searchParams.get("from") || dateString(defaultFrom), "起始日期");
    const to = requireDate(url.searchParams.get("to") || dateString(addDays(from, 41)), "结束日期");
    const rangeDays = Math.round((to.valueOf() - from.valueOf()) / 86_400_000);
    if (rangeDays < 0 || rangeDays > 93) return errorJson(400, "invalid_range", "日期范围须在 0 至 93 天内");
    const rows = await db.prepare(
      `SELECT * FROM day_tasks
       WHERE user_id = ? AND task_date >= ? AND task_date <= ?
       ORDER BY task_date ASC, COALESCE(task_time, '99:99') ASC, created_at ASC`,
    ).bind(session.user.id, dateString(from), dateString(to)).all();
    return json({ ok: true, tasks: (rows.results || []).map(publicTask) });
  }

  if (path === "/api/me/days/tasks" && request.method === "POST") {
    const body = cleanTask(await readJsonBody(request));
    const start = requireDate(body.date, "任务日期");
    const dates = occurrenceDates(start, body.repeatRule);
    const timestamp = nowIso();
    const groupId = body.repeatRule === "none" ? null : randomToken(12);
    const records = dates.map((taskDate) => ({ id: randomToken(12), taskDate }));
    await db.batch(records.map((record) => db.prepare(
      `INSERT INTO day_tasks
        (id, user_id, title, task_date, task_time, tag, is_completed, repeat_rule,
         recurrence_group_id, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL)`,
    ).bind(
      record.id,
      session.user.id,
      body.title,
      record.taskDate,
      body.time,
      body.tag,
      body.repeatRule,
      groupId,
      timestamp,
      timestamp,
    )));
    const row = await db.prepare(
      `SELECT * FROM day_tasks WHERE id = ? AND user_id = ?`,
    ).bind(records[0].id, session.user.id).first();
    return json({ ok: true, task: publicTask(row), generatedCount: records.length }, 201);
  }

  const match = path.match(/^\/api\/me\/days\/tasks\/([^/]+)$/);
  if (!match) return null;
  const id = decodeURIComponent(match[1]);
  const existing = await db.prepare(
    `SELECT * FROM day_tasks WHERE id = ? AND user_id = ?`,
  ).bind(id, session.user.id).first();
  if (!existing) return errorJson(404, "not_found", "任务不存在");

  if (request.method === "PATCH") {
    const changes = cleanTask(await readJsonBody(request), { partial: true });
    const completed = changes.completed ?? existing.is_completed;
    const updatedAt = nowIso();
    await db.prepare(
      `UPDATE day_tasks
       SET title = ?, task_date = ?, task_time = ?, tag = ?, is_completed = ?,
           updated_at = ?, completed_at = ?
       WHERE id = ? AND user_id = ?`,
    ).bind(
      changes.title ?? existing.title,
      changes.date ?? existing.task_date,
      Object.hasOwn(changes, "time") ? changes.time : existing.task_time,
      changes.tag ?? existing.tag,
      completed,
      updatedAt,
      completed ? existing.completed_at || updatedAt : null,
      id,
      session.user.id,
    ).run();
    const row = await db.prepare(
      `SELECT * FROM day_tasks WHERE id = ? AND user_id = ?`,
    ).bind(id, session.user.id).first();
    return json({ ok: true, task: publicTask(row) });
  }

  if (request.method === "DELETE") {
    await db.prepare(
      `DELETE FROM day_tasks WHERE id = ? AND user_id = ?`,
    ).bind(id, session.user.id).run();
    return json({ ok: true });
  }
  return null;
}

async function handleImportantDates(request, db, session, path) {
  if (path === "/api/me/days/important" && request.method === "GET") {
    const rows = await db.prepare(
      `SELECT * FROM important_dates WHERE user_id = ? ORDER BY event_date ASC, created_at ASC LIMIT 200`,
    ).bind(session.user.id).all();
    return json({ ok: true, dates: (rows.results || []).map(publicImportantDate) });
  }
  if (path === "/api/me/days/important" && request.method === "POST") {
    const body = cleanImportantDate(await readJsonBody(request));
    const id = randomToken(12);
    const timestamp = nowIso();
    await db.prepare(
      `INSERT INTO important_dates
        (id, user_id, title, event_date, note, repeat_rule, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, session.user.id, body.title, body.date, body.note, body.repeatRule, timestamp, timestamp).run();
    const row = await db.prepare(
      `SELECT * FROM important_dates WHERE id = ? AND user_id = ?`,
    ).bind(id, session.user.id).first();
    return json({ ok: true, date: publicImportantDate(row) }, 201);
  }

  const match = path.match(/^\/api\/me\/days\/important\/([^/]+)$/);
  if (!match) return null;
  const id = decodeURIComponent(match[1]);
  const existing = await db.prepare(
    `SELECT * FROM important_dates WHERE id = ? AND user_id = ?`,
  ).bind(id, session.user.id).first();
  if (!existing) return errorJson(404, "not_found", "重要日期不存在");
  if (request.method === "PATCH") {
    const changes = cleanImportantDate(await readJsonBody(request), { partial: true });
    const updatedAt = nowIso();
    await db.prepare(
      `UPDATE important_dates SET title = ?, event_date = ?, note = ?, repeat_rule = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).bind(
      changes.title ?? existing.title,
      changes.date ?? existing.event_date,
      changes.note ?? existing.note,
      changes.repeatRule ?? existing.repeat_rule,
      updatedAt,
      id,
      session.user.id,
    ).run();
    const row = await db.prepare(
      `SELECT * FROM important_dates WHERE id = ? AND user_id = ?`,
    ).bind(id, session.user.id).first();
    return json({ ok: true, date: publicImportantDate(row) });
  }
  if (request.method === "DELETE") {
    await db.prepare(
      `DELETE FROM important_dates WHERE id = ? AND user_id = ?`,
    ).bind(id, session.user.id).run();
    return json({ ok: true });
  }
  return null;
}

export async function handleDaysApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/me/days")) return null;
  const db = requireDb(env);
  try {
    const csrf = request.method !== "GET" && request.method !== "HEAD";
    const session = await requireSession(db, request, { csrf });
    const response = path.startsWith("/api/me/days/tasks")
      ? await handleTasks(request, db, session, url, path)
      : await handleImportantDates(request, db, session, path);
    return response;
  } catch (error) {
    const status = error.status || (error.code === "db_unavailable" ? 503 : 400);
    if (error.code === "unauthorized") return errorJson(401, error.code, error.message);
    if (error.code === "csrf" || error.code === "csrf_origin") {
      return errorJson(403, error.code, error.message);
    }
    console.error(JSON.stringify({ event: "days_api_error", code: error.code, message: error.message }));
    return errorJson(status, error.code || "days_error", error.message || "日历请求失败");
  }
}
