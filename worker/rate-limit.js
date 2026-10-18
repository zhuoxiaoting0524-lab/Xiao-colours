import { nowIso, randomToken, sha256Hex } from "./crypto-util.js";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

export async function recordLoginAttempt(db, { key, success }) {
  const keyHash = await sha256Hex(key);
  await db.prepare(
    `INSERT INTO login_attempts (id, key_hash, attempted_at, success) VALUES (?, ?, ?, ?)`,
  ).bind(randomToken(10), keyHash, nowIso(), success ? 1 : 0).run();

  // Opportunistic cleanup of old rows
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(`DELETE FROM login_attempts WHERE attempted_at < ?`).bind(cutoff).run();
}

export async function isLoginRateLimited(db, key) {
  const keyHash = await sha256Hex(key);
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const row = await db.prepare(
    `SELECT COUNT(*) AS c FROM login_attempts
     WHERE key_hash = ? AND attempted_at >= ? AND success = 0`,
  ).bind(keyHash, since).first();
  return Number(row?.c || 0) >= MAX_FAILURES;
}
