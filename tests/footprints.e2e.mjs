/**
 * Footprints persistence and tenant-isolation checks.
 * Usage: node tests/footprints.e2e.mjs http://127.0.0.1:45454
 */
import { randomBytes } from "node:crypto";

const base = process.argv[2] || "http://127.0.0.1:45454";
const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN || "local-bootstrap-token-change-me";
const suffix = randomBytes(3).toString("hex");

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
  console.log("PASS:", message);
}

function jarFrom(response, previous = "") {
  const raw = response.headers.getSetCookie?.() || [];
  const cookies = raw.length ? raw : [response.headers.get("set-cookie")].filter(Boolean);
  const map = new Map();
  for (const part of previous.split(/;\s*/).filter(Boolean)) {
    const [key, ...rest] = part.split("=");
    map.set(key, rest.join("="));
  }
  for (const line of cookies) {
    const [cookie] = line.split(";");
    const [key, ...rest] = cookie.split("=");
    map.set(key, rest.join("="));
  }
  return [...map.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(path, { method = "GET", body, cookie = "", csrfToken } = {}) {
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
  return { response, data, status: response.status, cookie: jarFrom(response, cookie) };
}

async function requestBytes(path, { method = "PUT", bytes, contentType, cookie = "", csrfToken } = {}) {
  const headers = { Accept: "application/json", Origin: base };
  if (contentType) headers["Content-Type"] = contentType;
  if (cookie) headers.Cookie = cookie;
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(`${base}${path}`, { method, headers, body: bytes });
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json().catch(() => ({}))
    : null;
  return { response, data, status: response.status, cookie: jarFrom(response, cookie) };
}

console.log(`\n=== Footprints phase 3 @ ${base} (${suffix}) ===\n`);

let adminCookie;
let adminCsrf;
const boot = await request("/api/auth/bootstrap", {
  method: "POST",
  body: {
    bootstrapToken,
    email: "admin-phase2@xiao.test",
    password: "admin-password-123",
    displayName: "Admin",
  },
});
if (boot.response.ok) {
  adminCookie = boot.cookie;
  adminCsrf = boot.data.csrfToken;
  assert(true, "local admin bootstrap");
} else {
  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email: "admin-phase2@xiao.test", password: "admin-password-123" },
  });
  assert(login.response.ok, `reuse local admin: ${JSON.stringify(boot.data)}`);
  adminCookie = login.cookie;
  adminCsrf = login.data.csrfToken;
}

async function createMember(name) {
  const invite = await request("/api/admin/invites", {
    method: "POST",
    cookie: adminCookie,
    csrfToken: adminCsrf,
    body: { note: name },
  });
  assert(invite.response.ok, `create invite for ${name}`);
  const email = `${name.toLowerCase()}-${suffix}@xiao.test`;
  const password = `${name.toLowerCase()}-password-123`;
  const registration = await request("/api/auth/register", {
    method: "POST",
    body: { inviteToken: invite.data.invite.token, email, password, displayName: name },
  });
  assert(registration.response.ok, `register ${name}`);
  return { email, password, cookie: registration.cookie, csrf: registration.data.csrfToken };
}

const alice = await createMember("AliceMap");
const bob = await createMember("BobMap");

const aliceCreated = await request("/api/me/footprints", {
  method: "POST",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
  body: {
    name: "Madrid",
    locationLabel: "Madrid, Comunidad de Madrid, España",
    status: "visited",
    date: "2026-10-20",
    note: "Alice private footprint.",
    longitude: -3.7038,
    latitude: 40.4168,
    geocoder: "nominatim",
    sourceId: "relation:5326784",
    nameZh: "马德里",
    nameEn: "Madrid",
    countryCode: "ES",
    placeType: "city",
  },
});
assert(
  aliceCreated.status === 201
    && aliceCreated.data.footprint?.status === "visited"
    && aliceCreated.data.footprint?.countryCode === "ES",
  "Alice creates a visited footprint with normalized geography",
);

const tinyPng = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
const photoUpload = await requestBytes(`/api/me/footprints/${aliceCreated.data.footprint.id}/photo`, {
  bytes: tinyPng,
  contentType: "image/png",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
});
assert(photoUpload.response.ok && photoUpload.data.footprint?.imageUrl, "Alice uploads a private footprint photo");
const photoRead = await requestBytes(`/api/me/footprints/${aliceCreated.data.footprint.id}/photo`, {
  method: "GET",
  cookie: alice.cookie,
});
assert(photoRead.response.ok && photoRead.response.headers.get("content-type") === "image/png", "Alice reads own footprint photo");

const bobCreated = await request("/api/me/footprints", {
  method: "POST",
  cookie: bob.cookie,
  csrfToken: bob.csrf,
  body: {
    name: "Tokyo",
    locationLabel: "東京都, 日本",
    status: "wish",
    date: "",
    note: "Bob private footprint.",
    longitude: 139.6917,
    latitude: 35.6895,
    geocoder: "nominatim",
    sourceId: "relation:1543125",
  },
});
assert(bobCreated.status === 201 && bobCreated.data.footprint?.status === "wish", "Bob creates a wish footprint");

const bobPhotoRead = await requestBytes(`/api/me/footprints/${aliceCreated.data.footprint.id}/photo`, {
  method: "GET",
  cookie: bob.cookie,
});
assert(bobPhotoRead.status === 404, "Bob cannot read Alice footprint photo");

const aliceList = await request("/api/me/footprints", { cookie: alice.cookie });
const bobList = await request("/api/me/footprints", { cookie: bob.cookie });
assert(aliceList.data.footprints.length === 1 && aliceList.data.footprints[0].id === aliceCreated.data.footprint.id, "Alice list only contains Alice data");
assert(bobList.data.footprints.length === 1 && bobList.data.footprints[0].id === bobCreated.data.footprint.id, "Bob list only contains Bob data");

const stealPatch = await request(`/api/me/footprints/${aliceCreated.data.footprint.id}`, {
  method: "PATCH",
  cookie: bob.cookie,
  csrfToken: bob.csrf,
  body: { note: "cross-user edit" },
});
const stealDelete = await request(`/api/me/footprints/${aliceCreated.data.footprint.id}`, {
  method: "DELETE",
  cookie: bob.cookie,
  csrfToken: bob.csrf,
  body: {},
});
assert(stealPatch.status === 404 && stealDelete.status === 404, "Bob cannot update or delete Alice footprint");

const aliceUpdated = await request(`/api/me/footprints/${aliceCreated.data.footprint.id}`, {
  method: "PATCH",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
  body: { name: "Madrid centro", status: "wish", date: "", note: "Updated by Alice." },
});
assert(
  aliceUpdated.response.ok
    && aliceUpdated.data.footprint?.name === "Madrid centro"
    && aliceUpdated.data.footprint?.status === "wish"
    && aliceUpdated.data.footprint?.date === null,
  "Alice edits name, status, date and note",
);

const filtered = await request("/api/me/footprints?status=wish", { cookie: alice.cookie });
assert(filtered.data.footprints.length === 1 && filtered.data.footprints[0].id === aliceCreated.data.footprint.id, "status filter returns the correct footprint");

await request("/api/auth/logout", { method: "POST", cookie: alice.cookie, csrfToken: alice.csrf, body: {} });
const relogin = await request("/api/auth/login", {
  method: "POST",
  body: { email: alice.email, password: alice.password },
});
assert(relogin.response.ok, "Alice logs in again");
const persisted = await request("/api/me/footprints", { cookie: relogin.cookie });
assert(
  persisted.data.footprints.length === 1
    && persisted.data.footprints[0].note === "Updated by Alice."
    && persisted.data.footprints[0].status === "wish",
  "footprint persists after logout and relogin",
);

const aliceDeleted = await request(`/api/me/footprints/${aliceCreated.data.footprint.id}`, {
  method: "DELETE",
  cookie: relogin.cookie,
  csrfToken: relogin.data.csrfToken,
  body: {},
});
assert(aliceDeleted.response.ok, "Alice deletes own footprint");
const afterDelete = await request("/api/me/footprints", { cookie: relogin.cookie });
assert(afterDelete.data.footprints.length === 0, "deleted footprint no longer appears");

const bobDeleted = await request(`/api/me/footprints/${bobCreated.data.footprint.id}`, {
  method: "DELETE",
  cookie: bob.cookie,
  csrfToken: bob.csrf,
  body: {},
});
assert(bobDeleted.response.ok, "Bob deletes own test footprint");

const unauthList = await request("/api/me/footprints");
const unauthSearch = await request("/api/me/footprints/search?q=Madrid");
assert(unauthList.status === 401 && unauthSearch.status === 401, "footprint and geocoding APIs require authentication");

console.log("\nALL FOOTPRINTS PHASE 3 CHECKS PASSED\n");
