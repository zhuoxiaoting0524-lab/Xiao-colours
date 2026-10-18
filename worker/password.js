/**
 * Password hashing via Web Crypto SubtleCrypto PBKDF2-SHA-256.
 * This uses the platform's verified PBKDF2 implementation — not a custom cipher.
 * Cloudflare Workers caps SubtleCrypto PBKDF2 at 100_000 iterations — use the platform max.
 */
import { base64UrlToBytes, bytesToBase64Url, timingSafeEqual } from "./crypto-util.js";

export const PASSWORD_ALGO = "pbkdf2-sha256";
export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

function encodeRecord({ algo, iterations, saltB64, hashB64 }) {
  return `${algo}$${iterations}$${saltB64}$${hashB64}`;
}

function parseRecord(record) {
  const parts = String(record || "").split("$");
  if (parts.length !== 4) return null;
  const [algo, iterationsRaw, saltB64, hashB64] = parts;
  const iterations = Number(iterationsRaw);
  if (algo !== PASSWORD_ALGO || !Number.isFinite(iterations) || iterations < 100_000) return null;
  if (!saltB64 || !hashB64) return null;
  return { algo, iterations, saltB64, hashB64 };
}

async function deriveKey(password, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations,
    },
    keyMaterial,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 10 || password.length > 200) {
    const error = new Error("密码长度需在 10–200 个字符之间");
    error.code = "invalid_password";
    throw error;
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  return encodeRecord({
    algo: PASSWORD_ALGO,
    iterations: PBKDF2_ITERATIONS,
    saltB64: bytesToBase64Url(salt),
    hashB64: bytesToBase64Url(hash),
  });
}

export async function verifyPassword(password, stored) {
  const parsed = parseRecord(stored);
  if (!parsed || typeof password !== "string") return false;
  try {
    const salt = base64UrlToBytes(parsed.saltB64);
    const expected = base64UrlToBytes(parsed.hashB64);
    const actual = await deriveKey(password, salt, parsed.iterations);
    if (actual.length !== expected.length) return false;
    // Convert to hex strings for constant-time compare of equal-length digests.
    const actualHex = [...actual].map((b) => b.toString(16).padStart(2, "0")).join("");
    const expectedHex = [...expected].map((b) => b.toString(16).padStart(2, "0")).join("");
    return timingSafeEqual(actualHex, expectedHex);
  } catch {
    return false;
  }
}
