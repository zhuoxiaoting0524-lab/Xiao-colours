import { addDaysIso, isExpired, nowIso, randomToken, sha256Hex } from "./crypto-util.js";
import { clearSessionCookie, readCookie, sessionCookie } from "./http.js";

export const SESSION_DAYS = 14;
export const COOKIE_NAME = "xc_session";

export async function createSession(db, { userId, ip, userAgent }) {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const csrfSecret = randomToken(24);
  const createdAt = nowIso();
  const expiresAt = addDaysIso(SESSION_DAYS);
  const id = randomToken(12);
  await db.prepare(
    `INSERT INTO sessions
      (id, user_id, token_hash, csrf_secret, created_at, expires_at, last_seen_at, ip_hash, user_agent_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    userId,
    tokenHash,
    csrfSecret,
    createdAt,
    expiresAt,
    createdAt,
    ip ? await sha256Hex(ip) : null,
    userAgent ? await sha256Hex(userAgent.slice(0, 300)) : null,
  ).run();

  return { id, token, csrfSecret, expiresAt };
}

export async function destroySessionByToken(db, token) {
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
}

export async function destroyAllSessionsForUser(db, userId) {
  await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
}

export async function loadSession(db, request) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(
    `SELECT s.*, u.email, u.display_name, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  ).bind(tokenHash).first();

  if (!row || isExpired(row.expires_at)) {
    if (row) await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(row.id).run();
    return null;
  }

  // Sliding activity update (best-effort)
  await db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`)
    .bind(nowIso(), row.id)
    .run();

  return {
    sessionId: row.id,
    token,
    csrfSecret: row.csrf_secret,
    expiresAt: row.expires_at,
    user: {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
    },
  };
}

export function assertCsrf(request, session) {
  const header = request.headers.get("x-csrf-token") || "";
  if (!session?.csrfSecret || header !== session.csrfSecret) {
    const error = new Error("CSRF 校验失败");
    error.code = "csrf";
    error.status = 403;
    throw error;
  }
}

export function attachSessionCookie(response, token, { secure, expiresAt }) {
  const maxAgeSec = Math.max(0, Math.floor((new Date(expiresAt).valueOf() - Date.now()) / 1000));
  response.headers.append("set-cookie", sessionCookie(token, { maxAgeSec, secure }));
  return response;
}

export function attachClearSessionCookie(response, secure) {
  response.headers.append("set-cookie", clearSessionCookie(secure));
  return response;
}
