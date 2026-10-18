/**
 * Acceptance suite: invite registration + multi-user isolation.
 * Safe for local wrangler only (creates disposable test users).
 * Usage: node tests/acceptance-isolation.e2e.mjs http://127.0.0.1:8787
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const base = process.argv[2] || "http://127.0.0.1:8787";
const results = [];

function record(id, status, detail = "") {
  results.push({ id, status, detail });
  const tag = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "SKIP";
  console.log(`${tag}  ${id}${detail ? " — " + detail : ""}`);
}

function assert(id, condition, detailPass = "", detailFail = "assertion failed") {
  if (condition) record(id, "PASS", detailPass);
  else {
    record(id, "FAIL", detailFail);
    throw new Error(`FAIL: ${id}: ${detailFail}`);
  }
}

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
  return { response, data, cookie: jarFrom(response, cookie), status: response.status };
}

function d1(sql) {
  const out = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "DB", "--local", "--json", "--command", sql],
    { cwd: "/workspace", encoding: "utf8" },
  );
  return JSON.parse(out);
}

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN || "local-bootstrap-token-change-me";
const suffix = randomBytes(3).toString("hex");
const adminEmail = `admin-${suffix}@xiao.test`;
const aliceEmail = `alice-${suffix}@xiao.test`;
const bobEmail = `bob-${suffix}@xiao.test`;
const adminPass = "admin-password-123";
const alicePass = "alice-password-123";
const bobPass = "bob-password-12345";

console.log(`\n=== Acceptance against ${base} (suffix ${suffix}) ===\n`);

// --- Bootstrap / admin ---
const boot = await api("/api/auth/bootstrap", {
  method: "POST",
  body: {
    bootstrapToken,
    email: adminEmail,
    password: adminPass,
    displayName: "Admin",
  },
});

let adminCookie;
let adminCsrf;

if (boot.data?.error?.code === "already_bootstrapped") {
  // Local DB may already have an admin from a prior run — login with known seed if present,
  // otherwise create invites via whatever admin we can. For fresh local DB we bootstrap above.
  const loginKnown = await api("/api/auth/login", {
    method: "POST",
    body: { email: "admin@xiao.test", password: adminPass },
  });
  if (loginKnown.response.ok) {
    adminCookie = loginKnown.cookie;
    adminCsrf = loginKnown.data.csrfToken;
    record("setup.admin", "PASS", "reused existing local admin@xiao.test");
  } else {
    record("setup.admin", "FAIL", `already_bootstrapped but known admin login failed: ${JSON.stringify(loginKnown.data)}`);
    throw new Error("cannot obtain admin session");
  }
} else {
  assert("1.admin_bootstrap", boot.response.ok, "admin created", JSON.stringify(boot.data));
  adminCookie = boot.cookie;
  adminCsrf = boot.data.csrfToken;
}

const adminMe = await api("/api/auth/me", { cookie: adminCookie });
assert("4.admin_session", adminMe.data.authenticated === true && adminMe.data.user.role === "admin", adminMe.data.user?.email);

// --- 1. Invite registration ---
const inviteA = await api("/api/admin/invites", {
  method: "POST",
  cookie: adminCookie,
  csrfToken: adminCsrf,
  body: { note: `alice-${suffix}` },
});
assert("1.invite_generate", inviteA.response.ok && inviteA.data.invite?.token && inviteA.data.invite?.url,
  inviteA.data.invite?.url?.slice(0, 60), JSON.stringify(inviteA.data));

const inviteB = await api("/api/admin/invites", {
  method: "POST",
  cookie: adminCookie,
  csrfToken: adminCsrf,
  body: { note: `bob-${suffix}` },
});
assert("1.invite_generate_second", inviteB.response.ok, "", JSON.stringify(inviteB.data));

const inviteRevoke = await api("/api/admin/invites", {
  method: "POST",
  cookie: adminCookie,
  csrfToken: adminCsrf,
  body: { note: `revoke-${suffix}` },
});
assert("1.invite_for_revoke", inviteRevoke.response.ok, "", JSON.stringify(inviteRevoke.data));

const revoked = await api(`/api/admin/invites/${inviteRevoke.data.invite.id}/revoke`, {
  method: "POST",
  cookie: adminCookie,
  csrfToken: adminCsrf,
  body: {},
});
assert("1.invite_revoke", revoked.response.ok, "", JSON.stringify(revoked.data));

const regRevoked = await api("/api/auth/register", {
  method: "POST",
  body: {
    inviteToken: inviteRevoke.data.invite.token,
    email: `revoked-${suffix}@xiao.test`,
    password: "revoked-password-123",
    displayName: "Revoked",
  },
});
assert("1.revoked_invite_blocked", regRevoked.status === 400 && regRevoked.data?.error?.code === "invalid_invite",
  "", JSON.stringify(regRevoked.data));

const noInvite = await api("/api/auth/register", {
  method: "POST",
  body: {
    inviteToken: "",
    email: `noinvite-${suffix}@xiao.test`,
    password: "noinvite-password-123",
    displayName: "NoInvite",
  },
});
assert("1.no_invite_blocked", noInvite.status === 400 && noInvite.data?.error?.code === "missing_invite",
  "", JSON.stringify(noInvite.data));

const fakeInvite = await api("/api/auth/register", {
  method: "POST",
  body: {
    inviteToken: "totally-fake-token-not-real",
    email: `fake-${suffix}@xiao.test`,
    password: "fake-password-1234",
    displayName: "Fake",
  },
});
assert("1.fake_invite_blocked", fakeInvite.status === 400, "", JSON.stringify(fakeInvite.data));

// Expired invite: create then age via D1
const inviteExp = await api("/api/admin/invites", {
  method: "POST",
  cookie: adminCookie,
  csrfToken: adminCsrf,
  body: { note: `expired-${suffix}` },
});
assert("1.invite_for_expire", inviteExp.response.ok, "", JSON.stringify(inviteExp.data));
d1(`UPDATE invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = '${inviteExp.data.invite.id}'`);
const regExpired = await api("/api/auth/register", {
  method: "POST",
  body: {
    inviteToken: inviteExp.data.invite.token,
    email: `expired-${suffix}@xiao.test`,
    password: "expired-password-123",
    displayName: "Expired",
  },
});
assert("1.expired_invite_blocked", regExpired.status === 400 && regExpired.data?.error?.code === "invalid_invite",
  "", JSON.stringify(regExpired.data));

const regA = await api("/api/auth/register", {
  method: "POST",
  body: {
    inviteToken: inviteA.data.invite.token,
    email: aliceEmail,
    password: alicePass,
    displayName: "Alice",
  },
});
assert("1.register_alice", regA.response.ok && regA.data.user?.role === "member", aliceEmail, JSON.stringify(regA.data));
const cookieA = regA.cookie;

const reuse = await api("/api/auth/register", {
  method: "POST",
  body: {
    inviteToken: inviteA.data.invite.token,
    email: `alice2-${suffix}@xiao.test`,
    password: alicePass,
    displayName: "Alice2",
  },
});
assert("1.invite_single_use", reuse.status === 400 && reuse.data?.error?.code === "invalid_invite",
  "", JSON.stringify(reuse.data));

const regB = await api("/api/auth/register", {
  method: "POST",
  body: {
    inviteToken: inviteB.data.invite.token,
    email: bobEmail,
    password: bobPass,
    displayName: "Bob",
  },
});
assert("1.register_bob", regB.response.ok, bobEmail, JSON.stringify(regB.data));
const cookieB = regB.cookie;

// --- 2. Multi-account isolation ---
const loginA = await api("/api/auth/login", {
  method: "POST",
  body: { email: aliceEmail, password: alicePass },
});
assert("2.alice_login", loginA.response.ok, "", JSON.stringify(loginA.data));
const loginB = await api("/api/auth/login", {
  method: "POST",
  body: { email: bobEmail, password: bobPass },
});
assert("2.bob_login", loginB.response.ok, "", JSON.stringify(loginB.data));

const spacesA = await api("/api/me/spaces", { cookie: loginA.cookie });
const spacesB = await api("/api/me/spaces", { cookie: loginB.cookie });
assert("2.spaces_ok", spacesA.response.ok && spacesB.response.ok, "", "spaces fetch failed");
assert("2.user_ids_differ", spacesA.data.userId !== spacesB.data.userId,
  `${spacesA.data.userId} vs ${spacesB.data.userId}`);
assert("2.journal_ids_differ", spacesA.data.spaces.journal.id !== spacesB.data.spaces.journal.id);
assert("2.gallery_ids_differ", spacesA.data.spaces.gallery.id !== spacesB.data.spaces.gallery.id);
assert("2.collections_ids_differ", spacesA.data.spaces.collections.id !== spacesB.data.spaces.collections.id);

assert("2.alice_empty_shells",
  spacesA.data.spaces.journal.empty === true
  && spacesA.data.spaces.gallery.empty === true
  && spacesA.data.spaces.collections.empty === true
  && Array.isArray(spacesA.data.spaces.journal.entries)
  && spacesA.data.spaces.journal.entries.length === 0,
  "empty private shells", "demo/shared content leaked into Alice spaces");

assert("2.bob_empty_shells",
  spacesB.data.spaces.journal.empty === true
  && spacesB.data.spaces.gallery.empty === true
  && spacesB.data.spaces.collections.empty === true,
  "empty private shells", "demo/shared content leaked into Bob spaces");

// Parameter probing: /api/me/spaces ignores foreign ids / query params
const probeA = await api(
  `/api/me/spaces?userId=${encodeURIComponent(spacesB.data.userId)}&journalId=${encodeURIComponent(spacesB.data.spaces.journal.id)}`,
  { cookie: loginA.cookie },
);
assert("2.probe_query_ignored",
  probeA.response.ok
  && probeA.data.userId === spacesA.data.userId
  && probeA.data.spaces.journal.id === spacesA.data.spaces.journal.id,
  "still Alice's spaces",
  JSON.stringify(probeA.data));

// No content mutation/delete APIs yet — confirm they do not exist
for (const path of [
  `/api/me/spaces/${spacesB.data.spaces.journal.id}`,
  `/api/me/journal/${spacesB.data.spaces.journal.id}`,
  `/api/me/gallery/${spacesB.data.spaces.gallery.id}`,
  `/api/users/${spacesB.data.userId}/spaces`,
  `/api/admin/users/${spacesB.data.userId}/spaces`,
]) {
  const get = await api(path, { cookie: loginA.cookie });
  const del = await api(path, { method: "DELETE", cookie: loginA.cookie, csrfToken: loginA.data.csrfToken, body: {} });
  // Worker falls through to assets or returns null→404/HTML; must not return other user's JSON space payload
  const looksLikePrivateSpaces = Boolean(get.data?.ok && get.data?.spaces?.journal?.id);
  const leaked = looksLikePrivateSpaces && (
    get.data.userId === spacesB.data.userId
    || get.data.spaces.journal.id === spacesB.data.spaces.journal.id
  );
  assert(`2.no_leak_get:${path}`, !leaked,
    `status=${get.status}`, `unexpected private payload: ${JSON.stringify(get.data).slice(0, 200)}`);
  const mutateLeaked = Boolean(del.data?.ok && del.data?.spaces);
  assert(`2.no_mutate:${path}`, !mutateLeaked && del.status !== 204,
    `status=${del.status}`, JSON.stringify(del.data).slice(0, 200));
}

// Admin private content interface cannot read other users
const adminSpaces = await api("/api/me/spaces", { cookie: adminCookie });
assert("2.admin_own_spaces_only",
  adminSpaces.response.ok
  && adminSpaces.data.userId !== spacesA.data.userId
  && adminSpaces.data.userId !== spacesB.data.userId
  && adminSpaces.data.spaces.journal.id !== spacesA.data.spaces.journal.id
  && adminSpaces.data.spaces.journal.id !== spacesB.data.spaces.journal.id,
  adminSpaces.data.userId,
  "admin /api/me/spaces returned another user's space");

const adminPeek = await api(`/api/me/spaces?userId=${spacesA.data.userId}`, { cookie: adminCookie });
assert("2.admin_cannot_peek_via_query",
  adminPeek.data.userId === adminSpaces.data.userId,
  "",
  `admin peek got ${adminPeek.data.userId}`);

// --- 3. Persistence / D1 user_id binding ---
const d1Users = d1(`SELECT id, email, role FROM users WHERE email IN ('${aliceEmail}','${bobEmail}') ORDER BY email`);
const userRows = d1Users?.[0]?.results || d1Users?.results || [];
// wrangler --json shape: array of { results, success }
const flatUsers = Array.isArray(d1Users)
  ? (d1Users[0]?.results || [])
  : (d1Users.results || []);
assert("3.d1_users_exist", flatUsers.length === 2, JSON.stringify(flatUsers.map(u => u.email)));

const d1Spaces = d1(`SELECT j.user_id AS uid, j.id AS journal_id, g.id AS gallery_id, c.id AS collections_id
  FROM journals j
  JOIN galleries g ON g.user_id = j.user_id
  JOIN collections c ON c.user_id = j.user_id
  WHERE j.user_id IN ('${spacesA.data.userId}','${spacesB.data.userId}')
  ORDER BY j.user_id`);
const spaceRows = Array.isArray(d1Spaces) ? (d1Spaces[0]?.results || []) : (d1Spaces.results || []);
assert("3.d1_spaces_bound_to_user_id", spaceRows.length === 2, JSON.stringify(spaceRows));
const rowA = spaceRows.find((r) => r.uid === spacesA.data.userId);
const rowB = spaceRows.find((r) => r.uid === spacesB.data.userId);
assert("3.d1_alice_ids_match_api",
  rowA && rowA.journal_id === spacesA.data.spaces.journal.id
  && rowA.gallery_id === spacesA.data.spaces.gallery.id
  && rowA.collections_id === spacesA.data.spaces.collections.id);
assert("3.d1_bob_ids_match_api",
  rowB && rowB.journal_id === spacesB.data.spaces.journal.id
  && rowB.gallery_id === spacesB.data.spaces.gallery.id
  && rowB.collections_id === spacesB.data.spaces.collections.id);

// Logout + re-login persistence of space IDs
const logoutA = await api("/api/auth/logout", {
  method: "POST",
  cookie: loginA.cookie,
  csrfToken: loginA.data.csrfToken,
  body: {},
});
assert("4.logout", logoutA.response.ok, "", JSON.stringify(logoutA.data));
const meAfterLogout = await api("/api/auth/me", { cookie: logoutA.cookie || loginA.cookie });
assert("4.session_dead_after_logout", meAfterLogout.data.authenticated === false);
const spacesAfterLogout = await api("/api/me/spaces", { cookie: loginA.cookie });
assert("4.private_api_blocked_after_logout", spacesAfterLogout.status === 401);

const reloginA = await api("/api/auth/login", {
  method: "POST",
  body: { email: aliceEmail, password: alicePass },
});
assert("3.relogin", reloginA.response.ok);
const spacesA2 = await api("/api/me/spaces", { cookie: reloginA.cookie });
assert("3.spaces_persist_after_relogin",
  spacesA2.data.userId === spacesA.data.userId
  && spacesA2.data.spaces.journal.id === spacesA.data.spaces.journal.id
  && spacesA2.data.spaces.gallery.id === spacesA.data.spaces.gallery.id
  && spacesA2.data.spaces.collections.id === spacesA.data.spaces.collections.id);

// Session isolation: Alice cookie must not become Bob
const meA = await api("/api/auth/me", { cookie: reloginA.cookie });
const meB = await api("/api/auth/me", { cookie: loginB.cookie });
assert("4.no_session_mix",
  meA.data.user.email === aliceEmail && meB.data.user.email === bobEmail,
  `${meA.data.user?.email} / ${meB.data.user?.email}`);

// Unified session surface: single /api/auth/me for all modules (no per-module auth endpoints)
const moduleAuth = await Promise.all([
  api("/api/auth/me", { cookie: reloginA.cookie }),
  api("/api/me/spaces", { cookie: reloginA.cookie }),
]);
assert("4.unified_session_me_and_spaces",
  moduleAuth[0].data.authenticated
  && moduleAuth[1].data.userId === moduleAuth[0].data.user.id);

// Items that cannot be fully exercised yet (no editor APIs)
record("2.mutate_other_user_content", "SKIP", "no journal/gallery/collections write APIs in phase 1");
record("2.delete_other_user_content", "SKIP", "no delete content APIs in phase 1");
record("3.refresh_browser_ui", "SKIP", "API re-login persistence covered; browser refresh is same cookie Path=/");
record("4.module_switch_ui", "SKIP", "SPA shares one authState + one cookie; covered by code review + unified /api/auth/me");

console.log("\n=== SUMMARY ===");
const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const skip = results.filter((r) => r.status === "SKIP").length;
console.log(JSON.stringify({ pass, fail, skip, results }, null, 2));
if (fail) process.exit(1);
console.log("\nALL REQUIRED CHECKS PASSED");
