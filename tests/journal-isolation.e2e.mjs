/**
 * Journal page isolation + CRUD against local wrangler.
 * Usage: node tests/journal-isolation.e2e.mjs http://127.0.0.1:45454
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

async function api(path, { method = "GET", body, cookie = "", csrfToken } = {}) {
  const headers = { Accept: "application/json", Origin: base };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { response, data, cookie: jarFrom(response, cookie), status: response.status };
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

console.log(`\n=== Journal isolation @ ${base} (${suffix}) ===\n`);

// bootstrap or login admin
let adminCookie, adminCsrf;
const boot = await api("/api/auth/bootstrap", {
  method: "POST",
  body: {
    bootstrapToken,
    email: `admin-j-${suffix}@xiao.test`,
    password: "admin-password-123",
    displayName: "Admin",
  },
});
if (boot.response.ok) {
  assert(true, "admin bootstrap");
  adminCookie = boot.cookie;
  adminCsrf = boot.data.csrfToken;
} else if (boot.data?.error?.code === "already_bootstrapped") {
  const candidates = ["admin@xiao.test", `admin-f78e1c@xiao.test`];
  let ok = null;
  for (const email of candidates) {
    const login = await api("/api/auth/login", {
      method: "POST",
      body: { email, password: "admin-password-123" },
    });
    if (login.response.ok) {
      ok = login;
      break;
    }
  }
  assert(ok, "reuse existing local admin session");
  adminCookie = ok.cookie;
  adminCsrf = ok.data.csrfToken;
} else {
  assert(false, `bootstrap failed: ${JSON.stringify(boot.data)}`);
}

async function registerViaInvite(email, password, name) {
  const inv = await api("/api/admin/invites", {
    method: "POST",
    cookie: adminCookie,
    csrfToken: adminCsrf,
    body: { note: name },
  });
  assert(inv.response.ok, `invite ${name}`);
  const reg = await api("/api/auth/register", {
    method: "POST",
    body: {
      inviteToken: inv.data.invite.token,
      email,
      password,
      displayName: name,
    },
  });
  assert(reg.response.ok, `register ${name}`);
  return { cookie: reg.cookie, csrf: reg.data.csrfToken, user: reg.data.user };
}

const aliceEmail = `alice-j-${suffix}@xiao.test`;
const bobEmail = `bob-j-${suffix}@xiao.test`;
const alice = await registerViaInvite(aliceEmail, "alice-password-123", "AliceJ");
const bob = await registerViaInvite(bobEmail, "bob-password-12345", "BobJ");

const emptyA = await api("/api/me/journal/pages", { cookie: alice.cookie });
assert(emptyA.response.ok && emptyA.data.pages.length === 0, "Alice starts with 0 pages");
assert(emptyA.data.coord?.width === 1000 && emptyA.data.coord?.height === 1400, "coord system present");

const p1 = await api("/api/me/journal/pages", {
  method: "POST",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
  body: { year: 2026, title: "A1" },
});
assert(p1.status === 201 && p1.data.page?.id, "Alice create page 1");
assert(p1.data.page.content?.coord?.space === "page", "page has paper coord");
assert(Array.isArray(p1.data.page.content.layers) && p1.data.page.content.layers.length === 0, "blank layers");

const p2 = await api("/api/me/journal/pages", {
  method: "POST",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
  body: { year: 2026 },
});
const p3 = await api("/api/me/journal/pages", {
  method: "POST",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
  body: { year: 2025 },
});
assert(p2.response.ok && p3.response.ok, "Alice create more pages");

const listA = await api("/api/me/journal/pages", { cookie: alice.cookie });
assert(listA.data.pages.length === 3, `Alice has 3 pages, got ${listA.data.pages.length}`);
assert(listA.data.pages[0].position === 1 && listA.data.pages[2].position === 3, "positions sequential");

const year2026 = await api("/api/me/journal/pages?year=2026", { cookie: alice.cookie });
assert(year2026.data.pages.length === 2, "year filter 2026");
assert(year2026.data.pages.every((p) => p.year === 2026), "year filter only 2026");

const bobPage = await api("/api/me/journal/pages", {
  method: "POST",
  cookie: bob.cookie,
  csrfToken: bob.csrf,
  body: { year: 2026 },
});
assert(bobPage.response.ok, "Bob create page");

const listB = await api("/api/me/journal/pages", { cookie: bob.cookie });
assert(listB.data.pages.length === 1, "Bob has 1 page");
assert(listB.data.pages[0].id !== p1.data.page.id, "Bob page id differs");

// Cross-user GET by id
const stealGet = await api(`/api/me/journal/pages/${p1.data.page.id}`, { cookie: bob.cookie });
assert(stealGet.status === 404, "Bob cannot GET Alice page by id");

const stealDel = await api(`/api/me/journal/pages/${p1.data.page.id}`, {
  method: "DELETE",
  cookie: bob.cookie,
  csrfToken: bob.csrf,
  body: {},
});
assert(stealDel.status === 404, "Bob cannot DELETE Alice page");

const stillA = await api("/api/me/journal/pages", { cookie: alice.cookie });
assert(stillA.data.pages.length === 3, "Alice pages intact after Bob probe");

// Admin cannot read Alice pages via private API
const adminPages = await api("/api/me/journal/pages", { cookie: adminCookie });
assert(adminPages.response.ok, "admin can hit own journal API");
assert(!adminPages.data.pages.some((p) => p.id === p1.data.page.id), "admin list excludes Alice pages");

const adminGetAlice = await api(`/api/me/journal/pages/${p1.data.page.id}`, { cookie: adminCookie });
assert(adminGetAlice.status === 404, "admin cannot GET Alice page by id");

// Delete + renumber
const del = await api(`/api/me/journal/pages/${p1.data.page.id}`, {
  method: "DELETE",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
  body: {},
});
assert(del.response.ok, "Alice delete page 1");
const afterDel = await api("/api/me/journal/pages", { cookie: alice.cookie });
assert(afterDel.data.pages.length === 2, "Alice has 2 after delete");
assert(afterDel.data.pages[0].position === 1 && afterDel.data.pages[1].position === 2, "renumbered");

// Persistence across re-login
const logout = await api("/api/auth/logout", {
  method: "POST",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
  body: {},
});
assert(logout.response.ok, "logout");
const denied = await api("/api/me/journal/pages", { cookie: alice.cookie });
assert(denied.status === 401, "journal API blocked after logout");

const relogin = await api("/api/auth/login", {
  method: "POST",
  body: { email: aliceEmail, password: "alice-password-123" },
});
assert(relogin.response.ok, "relogin");
const persisted = await api("/api/me/journal/pages", { cookie: relogin.cookie });
assert(persisted.data.pages.length === 2, "pages persist after relogin");
assert(
  persisted.data.pages.map((p) => p.id).sort().join() === afterDel.data.pages.map((p) => p.id).sort().join(),
  "same page ids after relogin",
);

const spaces = await api("/api/me/spaces", { cookie: relogin.cookie });
assert(spaces.data.spaces.journal.pageCount === 2, "spaces.pageCount matches");
assert(spaces.data.spaces.journal.empty === false, "spaces.empty false");

// unauthenticated
const noAuth = await api("/api/me/journal/pages");
assert(noAuth.status === 401, "unauthenticated journal list denied");

console.log("\nALL JOURNAL ISOLATION CHECKS PASSED\n");
