/** Shared Web Crypto helpers — no custom crypto algorithms. */

export function bytesToBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64Url(bytes);
}

export async function sha256Hex(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function nowIso() {
  return new Date().toISOString();
}

export function addDaysIso(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function addHoursIso(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function isExpired(iso) {
  return !iso || Date.now() > new Date(iso).valueOf();
}
