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

export async function getMe() {
  return api("/api/auth/me");
}

export function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}
