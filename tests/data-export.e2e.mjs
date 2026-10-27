import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.argv[2] || "http://127.0.0.1:45461";

function updateCookie(response, previous = "") {
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  return cookie || previous;
}

async function jsonApi(path, { method = "GET", cookie = "", csrf = "", body } = {}) {
  const headers = { accept: "application/json", origin: base };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers["x-csrf-token"] = csrf;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { response, data, cookie: updateCookie(response, cookie) };
}

async function login(email, password) {
  const result = await jsonApi("/api/auth/login", { method: "POST", body: { email, password } });
  assert.equal(result.response.status, 200, `login failed for ${email}: ${JSON.stringify(result.data)}`);
  return { cookie: result.cookie, csrf: result.data.csrfToken };
}

const alice = await login("alice@xiao.test", "alice-password-123");
const bob = await login("bob@xiao.test", "bob-password-12345");
const stamp = Date.now();
const aliceTitle = `Alice export ${stamp}`;
const bobTitle = `Bob export ${stamp}`;

for (const [session, title] of [[alice, aliceTitle], [bob, bobTitle]]) {
  const created = await jsonApi("/api/me/days/tasks", {
    method: "POST", cookie: session.cookie, csrf: session.csrf,
    body: { title, date: "2026-10-27", time: null, tag: "Personal", repeatRule: "none" },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
}

const footprintCreate = await jsonApi("/api/me/footprints", {
  method: "POST", cookie: alice.cookie, csrf: alice.csrf,
  body: {
    name: "Paris", locationLabel: "Paris, France", status: "visited", date: "2026-06-12",
    note: "PDF 测试旅行记录", longitude: 2.3522, latitude: 48.8566,
    geocoder: "test", sourceId: `test:${stamp}`, nameZh: "巴黎", nameEn: "Paris", countryCode: "FR", placeType: "city",
  },
});
assert.equal(footprintCreate.response.status, 201, JSON.stringify(footprintCreate.data));
const footprintId = footprintCreate.data.footprint.id;
const pngBytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
const photoResponse = await fetch(`${base}/api/me/footprints/${encodeURIComponent(footprintId)}/photo`, {
  method: "PUT",
  headers: { cookie: alice.cookie, origin: base, "x-csrf-token": alice.csrf, "content-type": "image/png" },
  body: pngBytes,
});
assert.equal(photoResponse.status, 200, await photoResponse.text());

async function download(path, session) {
  return fetch(`${base}${path}`, { headers: { cookie: session.cookie, accept: "application/octet-stream" } });
}

const aliceJsonResponse = await download("/api/me/export.json", alice);
assert.equal(aliceJsonResponse.status, 200);
assert.match(aliceJsonResponse.headers.get("cache-control") || "", /no-store/);
const aliceJson = await aliceJsonResponse.json();
fs.writeFileSync("/tmp/XiaoColour-Data-e2e.json", `${JSON.stringify(aliceJson, null, 2)}\n`);
assert.equal(aliceJson.format, "xiaocolour-backup");
assert.equal(aliceJson.version, 1);
assert.ok(aliceJson.data.myDays.some((task) => task.title === aliceTitle));
assert.equal(aliceJson.data.myDays.some((task) => task.title === bobTitle), false);
assert.equal(JSON.stringify(aliceJson).includes("password_hash"), false);
assert.equal(JSON.stringify(aliceJson).includes("token_hash"), false);
assert.ok(aliceJson.data.footprints.some((place) => place.id === footprintId && place.photo?.contentType === "image/png"));

const bobJsonResponse = await download("/api/me/export.json", bob);
const bobJson = await bobJsonResponse.json();
assert.ok(bobJson.data.myDays.some((task) => task.title === bobTitle));
assert.equal(bobJson.data.myDays.some((task) => task.title === aliceTitle), false);

const zipResponse = await download("/api/me/backup.zip", alice);
assert.equal(zipResponse.status, 200);
assert.equal(zipResponse.headers.get("content-type"), "application/zip");
assert.match(zipResponse.headers.get("cache-control") || "", /no-store/);
const zipPath = "/tmp/XiaoColour-Backup-e2e.zip";
fs.writeFileSync(zipPath, new Uint8Array(await zipResponse.arrayBuffer()));

const anonymous = await fetch(`${base}/api/me/export.json`);
assert.equal(anonymous.status, 401);

console.log(JSON.stringify({ ok: true, zipPath, aliceCounts: aliceJson.counts, bobCounts: bobJson.counts }, null, 2));
