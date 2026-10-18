export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function errorJson(status, code, message, extra = {}) {
  return json({ ok: false, error: { code, message, ...extra } }, status);
}

export function readCookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  const parts = raw.split(/;\s*/);
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1));
  }
  return null;
}

export function sessionCookie(token, { maxAgeSec, secure }) {
  const parts = [
    `xc_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=Lax`,
    `Max-Age=${Math.max(0, maxAgeSec)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure) {
  const parts = [
    "xc_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export async function readJsonBody(request, { maxBytes = 64_000 } = {}) {
  const text = await request.text();
  if (text.length > maxBytes) {
    const error = new Error("请求体过大");
    error.code = "payload_too_large";
    throw error;
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("无效的 JSON");
    error.code = "invalid_json";
    throw error;
  }
}

export function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown"
  );
}

export function requestIsSecure(request) {
  const url = new URL(request.url);
  if (url.protocol === "https:") return true;
  const forwarded = request.headers.get("x-forwarded-proto");
  return forwarded === "https";
}

/** Reject cross-site state changes; SameSite=Lax is primary, Origin check is defense in depth. */
export function assertSameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!origin) {
    // Same-origin navigations / some clients omit Origin; require CSRF header instead.
    return;
  }
  const expected = url.origin;
  if (origin !== expected) {
    const error = new Error("跨站请求被拒绝");
    error.code = "csrf_origin";
    throw error;
  }
}
