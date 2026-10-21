export async function api(path, { method = "GET", body, csrfToken } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data?.error?.message || `HTTP ${response.status}`);
    error.code = data?.error?.code || "http_error";
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

/** Upload raw image bytes to private R2 via authenticated Worker. */
export async function uploadBytes(path, { bytes, contentType, csrfToken, method = "POST" } = {}) {
  const headers = { Accept: "application/json", "Content-Type": contentType };
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: bytes,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data?.error?.message || `HTTP ${response.status}`);
    error.code = data?.error?.code || "http_error";
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

export async function getMe() {
  return api("/api/auth/me");
}

export function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Only allow same-site relative next targets (no open redirects). */
export function safeNextPath(raw, fallback = "./index.html") {
  if (typeof raw !== "string" || !raw) return fallback;
  const value = raw.trim();
  if (!value.startsWith("./") && !value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.includes("://")) return fallback;
  if (value.includes("\\") || /[\r\n]/.test(value)) return fallback;
  return value;
}

export const PRIVATE_VIEWS = Object.freeze([
  "overview",
  "notes",
  "days",
  "footprints",
  "journal",
  "gallery",
  "collections",
]);

export function loginUrlForView(view) {
  const next = PRIVATE_VIEWS.includes(view)
    ? `./index.html#${view}`
    : "./index.html";
  return `./login.html?next=${encodeURIComponent(next)}`;
}

export const PAGE_COORD = Object.freeze({
  space: "page",
  unit: "normalized",
  origin: "top-left",
  width: 1000,
  height: 1400,
});
