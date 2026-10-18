import {
  addDaysIso,
  addHoursIso,
  isExpired,
  nowIso,
  randomToken,
  sha256Hex,
} from "./crypto-util.js";
import {
  createUserSpaces,
  getUserByEmail,
  getUserById,
  publicUser,
  requireDb,
} from "./db.js";
import {
  assertSameOrigin,
  clientIp,
  errorJson,
  json,
  readJsonBody,
  requestIsSecure,
} from "./http.js";
import { hashPassword, verifyPassword } from "./password.js";
import { isLoginRateLimited, recordLoginAttempt } from "./rate-limit.js";
import {
  assertCsrf,
  attachClearSessionCookie,
  attachSessionCookie,
  createSession,
  destroyAllSessionsForUser,
  destroySessionByToken,
  loadSession,
} from "./sessions.js";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

async function requireAdmin(db, request, opts) {
  const session = await requireSession(db, request, opts);
  if (session.user.role !== "admin") {
    const error = new Error("需要管理员权限");
    error.code = "forbidden";
    error.status = 403;
    throw error;
  }
  return session;
}

function inviteUrl(request, rawToken) {
  const url = new URL("/invite.html", request.url);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

export async function handleAuthApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const db = requireDb(env);
  const secure = requestIsSecure(request);

  try {
    if (path === "/api/auth/me" && request.method === "GET") {
      const session = await loadSession(db, request);
      if (!session) return json({ ok: true, authenticated: false, user: null });
      return json({
        ok: true,
        authenticated: true,
        user: session.user,
        csrfToken: session.csrfSecret,
      });
    }

    if (path === "/api/auth/bootstrap" && request.method === "POST") {
      const body = await readJsonBody(request);
      const bootstrap = env.ADMIN_BOOTSTRAP_TOKEN;
      if (!bootstrap || body.bootstrapToken !== bootstrap) {
        return errorJson(403, "forbidden", "引导令牌无效");
      }
      const existingAdmin = await db.prepare(
        `SELECT id FROM users WHERE role = 'admin' LIMIT 1`,
      ).first();
      if (existingAdmin) {
        return errorJson(409, "already_bootstrapped", "管理员已存在");
      }
      const email = normalizeEmail(body.email);
      if (!validEmail(email)) return errorJson(400, "invalid_email", "邮箱格式无效");
      const passwordHash = await hashPassword(body.password);
      const id = randomToken(12);
      const createdAt = nowIso();
      await db.prepare(
        `INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'admin', ?, ?)`,
      ).bind(
        id,
        email,
        passwordHash,
        String(body.displayName || "Admin").slice(0, 80),
        createdAt,
        createdAt,
      ).run();
      await createUserSpaces(db, id);
      const user = await getUserById(db, id);
      const session = await createSession(db, {
        userId: id,
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent") || "",
      });
      const response = json({
        ok: true,
        user: publicUser(user),
        csrfToken: session.csrfSecret,
      });
      return attachSessionCookie(response, session.token, {
        secure,
        expiresAt: session.expiresAt,
      });
    }

    if (path === "/api/auth/register" && request.method === "POST") {
      assertSameOrigin(request);
      const body = await readJsonBody(request);
      const email = normalizeEmail(body.email);
      const inviteToken = String(body.inviteToken || "").trim();
      if (!inviteToken) return errorJson(400, "missing_invite", "缺少邀请令牌");
      if (!validEmail(email)) return errorJson(400, "invalid_email", "邮箱格式无效");
      if (await getUserByEmail(db, email)) {
        return errorJson(409, "email_taken", "该邮箱已注册");
      }

      const inviteHash = await sha256Hex(inviteToken);
      const passwordHash = await hashPassword(body.password);
      const userId = randomToken(12);
      const createdAt = nowIso();
      const displayName = String(body.displayName || email.split("@")[0]).slice(0, 80);

      // Pre-check invite (final single-use guarantee is the conditional UPDATE below).
      const invite = await db.prepare(
        `SELECT id FROM invites
         WHERE token_hash = ?
           AND used_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > ?`,
      ).bind(inviteHash, createdAt).first();
      if (!invite) {
        return errorJson(400, "invalid_invite", "邀请无效、已使用、已撤销或已过期");
      }

      try {
        await db.prepare(
          `INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'member', ?, ?)`,
        ).bind(userId, email, passwordHash, displayName, createdAt, createdAt).run();
      } catch (error) {
        if (String(error?.message || "").includes("UNIQUE")) {
          return errorJson(409, "email_taken", "该邮箱已注册");
        }
        throw error;
      }

      // Single-use lock: only one concurrent registrant can win this UPDATE.
      const consume = await db.prepare(
        `UPDATE invites
         SET used_at = ?, used_by = ?
         WHERE token_hash = ?
           AND used_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > ?`,
      ).bind(createdAt, userId, inviteHash, createdAt).run();

      if (!consume.meta?.changes) {
        await db.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();
        return errorJson(400, "invalid_invite", "邀请无效、已使用、已撤销或已过期");
      }

      await createUserSpaces(db, userId);

      const user = await getUserById(db, userId);
      const session = await createSession(db, {
        userId,
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent") || "",
      });
      const response = json({
        ok: true,
        user: publicUser(user),
        csrfToken: session.csrfSecret,
      });
      return attachSessionCookie(response, session.token, {
        secure,
        expiresAt: session.expiresAt,
      });
    }

    if (path === "/api/auth/login" && request.method === "POST") {
      assertSameOrigin(request);
      const body = await readJsonBody(request);
      const email = normalizeEmail(body.email);
      const ip = clientIp(request);
      const rateKey = `${ip}|${email}`;
      if (await isLoginRateLimited(db, rateKey)) {
        return errorJson(429, "rate_limited", "尝试过多，请 15 分钟后再试");
      }

      const user = await getUserByEmail(db, email);
      const ok = user ? await verifyPassword(body.password || "", user.password_hash) : false;
      await recordLoginAttempt(db, { key: rateKey, success: ok });
      if (!ok) return errorJson(401, "invalid_credentials", "邮箱或密码错误");

      const session = await createSession(db, {
        userId: user.id,
        ip,
        userAgent: request.headers.get("user-agent") || "",
      });
      const response = json({
        ok: true,
        user: publicUser(user),
        csrfToken: session.csrfSecret,
      });
      return attachSessionCookie(response, session.token, {
        secure,
        expiresAt: session.expiresAt,
      });
    }

    if (path === "/api/auth/logout" && request.method === "POST") {
      const session = await loadSession(db, request);
      if (session) {
        assertSameOrigin(request);
        assertCsrf(request, session);
        await destroySessionByToken(db, session.token);
      }
      const response = json({ ok: true });
      return attachClearSessionCookie(response, secure);
    }

    if (path === "/api/auth/password-reset/request" && request.method === "POST") {
      // Phase 1: only admins can mint reset links (no email provider yet).
      const session = await requireAdmin(db, request, { csrf: true });
      const body = await readJsonBody(request);
      const email = normalizeEmail(body.email);
      const user = await getUserByEmail(db, email);
      if (!user) return errorJson(404, "not_found", "用户不存在");
      const raw = randomToken(32);
      const tokenHash = await sha256Hex(raw);
      const createdAt = nowIso();
      await db.prepare(
        `INSERT INTO password_reset_tokens
          (id, user_id, token_hash, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(randomToken(12), user.id, tokenHash, session.user.id, createdAt, addHoursIso(2)).run();
      const resetUrl = new URL("/reset.html", request.url);
      resetUrl.searchParams.set("token", raw);
      return json({ ok: true, resetUrl: resetUrl.toString(), expiresInHours: 2 });
    }

    if (path === "/api/auth/password-reset/confirm" && request.method === "POST") {
      assertSameOrigin(request);
      const body = await readJsonBody(request);
      const raw = String(body.token || "").trim();
      if (!raw) return errorJson(400, "missing_token", "缺少重置令牌");
      const tokenHash = await sha256Hex(raw);
      const passwordHash = await hashPassword(body.password);
      const usedAt = nowIso();
      const row = await db.prepare(
        `SELECT * FROM password_reset_tokens WHERE token_hash = ?`,
      ).bind(tokenHash).first();
      if (!row || row.used_at || row.revoked_at || isExpired(row.expires_at)) {
        return errorJson(400, "invalid_token", "重置链接无效或已过期");
      }
      const consume = await db.prepare(
        `UPDATE password_reset_tokens SET used_at = ?
         WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      ).bind(usedAt, tokenHash, usedAt).run();
      if (!consume.meta?.changes) {
        return errorJson(400, "invalid_token", "重置链接无效或已过期");
      }
      await db.prepare(
        `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
      ).bind(passwordHash, usedAt, row.user_id).run();
      await destroyAllSessionsForUser(db, row.user_id);
      return json({ ok: true });
    }

    if (path === "/api/admin/invites" && request.method === "GET") {
      await requireAdmin(db, request, { csrf: false });
      const rows = await db.prepare(
        `SELECT id, token_prefix, created_at, expires_at, used_at, used_by, revoked_at, note
         FROM invites
         ORDER BY created_at DESC
         LIMIT 100`,
      ).all();
      return json({ ok: true, invites: rows.results || [] });
    }

    if (path === "/api/admin/invites" && request.method === "POST") {
      const session = await requireAdmin(db, request, { csrf: true });
      const body = await readJsonBody(request);
      const raw = randomToken(24);
      const tokenHash = await sha256Hex(raw);
      const createdAt = nowIso();
      const expiresAt = addDaysIso(7);
      const id = randomToken(12);
      await db.prepare(
        `INSERT INTO invites
          (id, token_hash, token_prefix, created_by, created_at, expires_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        tokenHash,
        raw.slice(0, 8),
        session.user.id,
        createdAt,
        expiresAt,
        String(body.note || "").slice(0, 120) || null,
      ).run();
      return json({
        ok: true,
        invite: {
          id,
          tokenPrefix: raw.slice(0, 8),
          expiresAt,
          url: inviteUrl(request, raw),
          // raw token returned once at creation time only
          token: raw,
        },
      });
    }

    if (path.startsWith("/api/admin/invites/") && request.method === "POST" && path.endsWith("/revoke")) {
      await requireAdmin(db, request, { csrf: true });
      const inviteId = path.split("/")[4];
      const result = await db.prepare(
        `UPDATE invites SET revoked_at = ?
         WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL`,
      ).bind(nowIso(), inviteId).run();
      if (!result.meta?.changes) {
        return errorJson(404, "not_found", "邀请不存在或无法撤销");
      }
      return json({ ok: true });
    }

    if (path === "/api/me/spaces" && request.method === "GET") {
      const session = await requireSession(db, request);
      const journal = await db.prepare(
        `SELECT id, created_at AS createdAt, updated_at AS updatedAt FROM journals WHERE user_id = ?`,
      ).bind(session.user.id).first();
      const gallery = await db.prepare(
        `SELECT id, created_at AS createdAt, updated_at AS updatedAt FROM galleries WHERE user_id = ?`,
      ).bind(session.user.id).first();
      const collections = await db.prepare(
        `SELECT id, created_at AS createdAt, updated_at AS updatedAt FROM collections WHERE user_id = ?`,
      ).bind(session.user.id).first();

      let journalPageCount = 0;
      if (journal) {
        const countRow = await db.prepare(
          `SELECT COUNT(*) AS c FROM journal_pages WHERE user_id = ? AND journal_id = ?`,
        ).bind(session.user.id, journal.id).first();
        journalPageCount = Number(countRow?.c || 0);
      }

      // Isolation: only current user's rows; no admin peek endpoint.
      return json({
        ok: true,
        userId: session.user.id,
        spaces: {
          journal: journal
            ? { ...journal, pageCount: journalPageCount, empty: journalPageCount === 0 }
            : null,
          gallery: gallery ? { ...gallery, items: [], empty: true } : null,
          collections: collections ? { ...collections, items: [], empty: true } : null,
        },
        // Future media: R2 keys will be scoped under users/{userId}/...
        media: { storage: "r2_planned", prefix: `users/${session.user.id}/` },
      });
    }

    return null;
  } catch (error) {
    const status = error.status || (error.code === "db_unavailable" ? 503 : 400);
    if (error.code === "unauthorized") return errorJson(401, error.code, error.message);
    if (error.code === "forbidden" || error.code === "csrf" || error.code === "csrf_origin") {
      return errorJson(403, error.code, error.message);
    }
    if (error.code === "invalid_password") return errorJson(400, error.code, error.message);
    console.error(JSON.stringify({ event: "auth_api_error", code: error.code, message: error.message }));
    return errorJson(status, error.code || "error", error.message || "请求失败");
  }
}
