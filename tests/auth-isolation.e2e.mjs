/**
 * End-to-end isolation check against a running wrangler dev server.
 * Usage: node tests/auth-isolation.e2e.mjs http://127.0.0.1:8787
 */
const base = process.argv[2] || "http://127.0.0.1:8787";

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

async function api(path, { method = "GET", body, cookie = "", csrfToken } = {}) {
  const headers = { Accept: "application/json", Origin: base };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data, cookie: jarFrom(response, cookie) };
}

function assertOk(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN || "local-bootstrap-token-change-me";

const boot = await api("/api/auth/bootstrap", {
  method: "POST",
  body: {
    bootstrapToken,
    email: "admin@xiao.test",
    password: "admin-password-123",
    displayName: "Admin",
  },
});

if (boot.data?.error?.code === "already_bootstrapped") {
  console.log("admin already exists, continuing with login…");
} else {
  assertOk(boot.response.ok, `bootstrap failed: ${JSON.stringify(boot.data)}`);
}

const adminLogin = await api("/api/auth/login", {
  method: "POST",
  body: { email: "admin@xiao.test", password: "admin-password-123" },
});
assertOk(adminLogin.response.ok, `admin login failed: ${JSON.stringify(adminLogin.data)}`);
let adminCookie = adminLogin.cookie;
const adminCsrf = adminLogin.data.csrfToken;

const inviteA = await api("/api/admin/invites", {
  method: "POST",
  cookie: adminCookie,
  csrfToken: adminCsrf,
  body: { note: "user-a" },
});
assertOk(inviteA.response.ok, `invite A failed: ${JSON.stringify(inviteA.data)}`);

const inviteB = await api("/api/admin/invites", {
  method: "POST",
  cookie: adminCookie,
  csrfToken: adminCsrf,
  body: { note: "user-b" },
});
assertOk(inviteB.response.ok, `invite B failed: ${JSON.stringify(inviteB.data)}`);

const regA = await api("/api/auth/register", {
  method: "POST",
  body: {
    inviteToken: inviteA.data.invite.token,
    email: "alice@xiao.test",
    password: "alice-password-123",
    displayName: "Alice",
  },
});
assertOk(regA.response.ok, `register A failed: ${JSON.stringify(regA.data)}`);
const cookieA = regA.cookie;

const reuse = await api("/api/auth/register", {
  method: "POST",
  body: {
    inviteToken: inviteA.data.invite.token,
    email: "alice2@xiao.test",
    password: "alice-password-123",
    displayName: "Alice2",
  },
});
assertOk(reuse.response.status === 400, "invite must be single-use");

const regB = await api("/api/auth/register", {
  method: "POST",
  body: {
    inviteToken: inviteB.data.invite.token,
    email: "bob@xiao.test",
    password: "bob-password-12345",
    displayName: "Bob",
  },
});
assertOk(regB.response.ok, `register B failed: ${JSON.stringify(regB.data)}`);
const cookieB = regB.cookie;

const spacesA = await api("/api/me/spaces", { cookie: cookieA });
const spacesB = await api("/api/me/spaces", { cookie: cookieB });
assertOk(spacesA.response.ok && spacesB.response.ok, "spaces fetch failed");
assertOk(spacesA.data.userId !== spacesB.data.userId, "user ids must differ");
assertOk(spacesA.data.spaces.journal.id !== spacesB.data.spaces.journal.id, "journal ids must be isolated");
assertOk(spacesA.data.spaces.gallery.id !== spacesB.data.spaces.gallery.id, "gallery ids must be isolated");
assertOk(spacesA.data.spaces.collections.id !== spacesB.data.spaces.collections.id, "collections ids must be isolated");

const meA = await api("/api/auth/me", { cookie: cookieA });
assertOk(meA.data.user.email === "alice@xiao.test", "Alice session mismatch");
const meB = await api("/api/auth/me", { cookie: cookieB });
assertOk(meB.data.user.email === "bob@xiao.test", "Bob session mismatch");

const logoutA = await api("/api/auth/logout", {
  method: "POST",
  cookie: cookieA,
  csrfToken: meA.data.csrfToken,
  body: {},
});
assertOk(logoutA.response.ok, "logout failed");
const meAfter = await api("/api/auth/me", { cookie: logoutA.cookie });
assertOk(meAfter.data.authenticated === false, "session must die after logout");

console.log("PASS auth isolation e2e");
console.log(JSON.stringify({
  aliceUserId: spacesA.data.userId,
  bobUserId: spacesB.data.userId,
  aliceJournal: spacesA.data.spaces.journal.id,
  bobJournal: spacesB.data.spaces.journal.id,
}, null, 2));
