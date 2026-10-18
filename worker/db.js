import { addDaysIso, nowIso, randomToken } from "./crypto-util.js";

export function requireDb(env) {
  if (!env?.DB) {
    const error = new Error("D1 数据库未绑定（env.DB）");
    error.code = "db_unavailable";
    error.status = 503;
    throw error;
  }
  return env.DB;
}

export async function createUserSpaces(db, userId) {
  const createdAt = nowIso();
  await db.batch([
    db.prepare(
      `INSERT INTO journals (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).bind(randomToken(12), userId, createdAt, createdAt),
    db.prepare(
      `INSERT INTO galleries (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).bind(randomToken(12), userId, createdAt, createdAt),
    db.prepare(
      `INSERT INTO collections (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).bind(randomToken(12), userId, createdAt, createdAt),
  ]);
}

export async function getUserByEmail(db, email) {
  return db.prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`).bind(email).first();
}

export async function getUserById(db, id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first();
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    createdAt: user.created_at,
  };
}

export { addDaysIso, nowIso, randomToken };
