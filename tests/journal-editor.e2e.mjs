/**
 * Journal editor: save layers + media isolation.
 * Usage: node tests/journal-editor.e2e.mjs http://127.0.0.1:45454
 */
import { randomBytes } from "node:crypto";

const base = process.argv[2] || "http://127.0.0.1:45454";
const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN || "local-bootstrap-token-change-me";
const suffix = randomBytes(3).toString("hex");

function jarFrom(response, previous = "") {
  const raw = response.headers.getSetCookie?.() || [];
  const cookies = raw.length ? raw : [response.headers.get("set-cookie")].filter(Boolean);
  const map = new Map();
  for (const part of previous.split(/;\s*/).filter(Boolean)) {
    const [k, ...rest] = part.split("=");
    map.set(k, rest.join("="));
  }
  for (const line of cookies) {
    const first = line.split(";")[0];
    const [k, ...rest] = first.split("=");
    map.set(k, rest.join("="));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function api(path, { method = "GET", body, cookie = "", csrfToken, raw, contentType } = {}) {
  const headers = { Accept: "application/json", Origin: base };
  if (cookie) headers.Cookie = cookie;
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  let payload;
  if (raw !== undefined) {
    headers["Content-Type"] = contentType || "application/octet-stream";
    payload = raw;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${base}${path}`, { method, headers, body: payload });
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const data = isJson ? await response.json().catch(() => ({})) : null;
  const buf = isJson ? null : new Uint8Array(await response.arrayBuffer());
  return { response, data, buf, cookie: jarFrom(response, cookie), status: response.status };
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

console.log(`\n=== Journal editor @ ${base} (${suffix}) ===\n`);

let adminCookie, adminCsrf;
const boot = await api("/api/auth/bootstrap", {
  method: "POST",
  body: {
    bootstrapToken,
    email: `admin-e-${suffix}@xiao.test`,
    password: "admin-password-123",
    displayName: "Admin",
  },
});
if (boot.response.ok) {
  adminCookie = boot.cookie;
  adminCsrf = boot.data.csrfToken;
} else {
  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email: "admin@xiao.test", password: "admin-password-123" },
  });
  // try recent admins
  let ok = login.response.ok ? login : null;
  if (!ok) {
    for (const email of [`admin-f78e1c@xiao.test`, `admin-j-${suffix}@xiao.test`]) {
      const l = await api("/api/auth/login", { method: "POST", body: { email, password: "admin-password-123" } });
      if (l.response.ok) { ok = l; break; }
    }
  }
  // last resort: create invites need any admin - list from DB via registering isn't possible
  assert(ok || boot.data?.error?.code === "already_bootstrapped", "need admin");
  // If already bootstrapped but no known admin password, create users via... can't.
  // Use bootstrap failure path: login as alice from previous tests won't work for invites.
  if (!ok) {
    // Try logging in with the email we would have created - fail soft by creating invite as... 
    console.error("Cannot obtain admin session for invites. Ensure local D1 has known admin.");
    process.exit(1);
  }
  adminCookie = ok.cookie;
  adminCsrf = ok.data.csrfToken;
}

async function register(email, password, name) {
  const inv = await api("/api/admin/invites", {
    method: "POST", cookie: adminCookie, csrfToken: adminCsrf, body: { note: name },
  });
  assert(inv.response.ok, `invite ${name}`);
  const reg = await api("/api/auth/register", {
    method: "POST",
    body: { inviteToken: inv.data.invite.token, email, password, displayName: name },
  });
  assert(reg.response.ok, `register ${name}`);
  return { cookie: reg.cookie, csrf: reg.data.csrfToken };
}

const alice = await register(`alice-e-${suffix}@xiao.test`, "alice-password-123", "AliceE");
const bob = await register(`bob-e-${suffix}@xiao.test`, "bob-password-12345", "BobE");

const pageA = await api("/api/me/journal/pages", {
  method: "POST", cookie: alice.cookie, csrfToken: alice.csrf, body: { year: 2026 },
});
assert(pageA.status === 201, "Alice create page");

const tinyPng = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
), (c) => c.charCodeAt(0));

const up = await api("/api/me/journal/media", {
  method: "POST",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
  raw: tinyPng,
  contentType: "image/png",
});
if (up.status === 503 && up.data?.error?.code === "r2_unavailable") {
  console.log("SKIP photo: R2 unavailable in this environment");
} else {
  assert(up.status === 201 && up.data.media?.id, `upload media ${JSON.stringify(up.data)}`);
  const mediaId = up.data.media.id;
  const stealMedia = await api(`/api/me/journal/media/${mediaId}`, { cookie: bob.cookie });
  assert(stealMedia.status === 404, "Bob cannot fetch Alice media");
  const getMedia = await api(`/api/me/journal/media/${mediaId}`, { cookie: alice.cookie });
  assert(getMedia.status === 200 && getMedia.buf?.byteLength > 0, "Alice can fetch own media");

  const content = {
    version: 1,
    coord: { space: "page", unit: "normalized", origin: "top-left", width: 1000, height: 1400 },
    background: { paper: "ruled" },
    layers: [
      {
        id: "t1",
        type: "text",
        z: 1,
        transform: { x: 100, y: 120, w: 400, h: 160, rotate: -4 },
        payload: { text: "hello scrapbook", fontSize: 40, color: "#2a2418" },
      },
      {
        id: "p1",
        type: "photo",
        z: 2,
        transform: { x: 200, y: 400, w: 360, h: 360, rotate: 6 },
        payload: { mediaId, r2Key: up.data.media.r2Key },
      },
    ],
  };
  const save = await api(`/api/me/journal/pages/${pageA.data.page.id}`, {
    method: "PATCH", cookie: alice.cookie, csrfToken: alice.csrf, body: { content },
  });
  assert(save.response.ok && save.data.page.content.layers.length === 2, "save layers");

  const stealPatch = await api(`/api/me/journal/pages/${pageA.data.page.id}`, {
    method: "PATCH", cookie: bob.cookie, csrfToken: bob.csrf,
    body: { content: { ...content, layers: [] } },
  });
  assert(stealPatch.status === 404, "Bob cannot PATCH Alice page");

  const again = await api(`/api/me/journal/pages/${pageA.data.page.id}`, { cookie: alice.cookie });
  assert(again.data.page.content.layers[0].payload.text === "hello scrapbook", "persist text");
  assert(again.data.page.content.layers[1].payload.mediaId === mediaId, "persist photo ref");
}

// text-only path always
const pageA2 = await api("/api/me/journal/pages", {
  method: "POST", cookie: alice.cookie, csrfToken: alice.csrf, body: { year: 2026 },
});
const textOnly = await api(`/api/me/journal/pages/${pageA2.data.page.id}`, {
  method: "PATCH",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
  body: {
    content: {
      version: 1,
      coord: { width: 1000, height: 1400, space: "page", unit: "normalized", origin: "top-left" },
      background: { paper: "ruled" },
      layers: [{
        id: "only",
        type: "text",
        z: 1,
        transform: { x: 50, y: 50, w: 300, h: 120, rotate: 0 },
        payload: { text: "only text", fontSize: 32, color: "#111" },
      }],
    },
  },
});
assert(textOnly.response.ok, "text-only save");

const bobGet = await api(`/api/me/journal/pages/${pageA2.data.page.id}`, { cookie: bob.cookie });
assert(bobGet.status === 404, "Bob cannot GET Alice page content");

console.log("\nALL JOURNAL EDITOR CHECKS PASSED\n");
