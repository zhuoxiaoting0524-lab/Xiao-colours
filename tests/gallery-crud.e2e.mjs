/** Gallery CRUD, private media and user isolation against local Wrangler. */
const base = process.argv[2] || "http://127.0.0.1:45454";
const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN || "local-bootstrap-token-change-me";

function cookieJar(response, previous = "") {
  const map = new Map(previous.split(/;\s*/).filter(Boolean).map((part) => {
    const [key, ...rest] = part.split("=");
    return [key, rest.join("=")];
  }));
  const values = response.headers.getSetCookie?.() || [response.headers.get("set-cookie")].filter(Boolean);
  for (const line of values) {
    const [pair] = line.split(";");
    const [key, ...rest] = pair.split("=");
    map.set(key, rest.join("="));
  }
  return [...map].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(path, { method = "GET", body, contentType, cookie = "", csrf } = {}) {
  const headers = { Accept: "application/json", Origin: base };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (body !== undefined) headers["Content-Type"] = contentType || "application/json";
  const payload = body === undefined ? undefined
    : contentType ? body : JSON.stringify(body);
  const response = await fetch(`${base}${path}`, { method, headers, body: payload });
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json() : new Uint8Array(await response.arrayBuffer());
  return { response, data, cookie: cookieJar(response, cookie), status: response.status };
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const adminEmail = "gallery-admin@xiao.test";
const adminPassword = "gallery-admin-password-123";
let admin = await request("/api/auth/bootstrap", {
  method: "POST",
  body: { bootstrapToken, email: adminEmail, password: adminPassword, displayName: "Gallery Admin" },
});
if (admin.data?.error?.code === "already_bootstrapped") {
  admin = await request("/api/auth/login", {
    method: "POST",
    body: { email: adminEmail, password: adminPassword },
  });
}
assert(admin.response.ok, "admin session ready");
const adminCookie = admin.cookie;
const adminCsrf = admin.data.csrfToken;

const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));

const before = await request("/api/me/gallery/items", { cookie: adminCookie });
assert(before.response.ok, "authenticated gallery list");

const created = await request("/api/me/gallery/items?title=First%20memory&category=moments", {
  method: "POST",
  body: png,
  contentType: "image/png",
  cookie: adminCookie,
  csrf: adminCsrf,
});
assert(created.status === 201 && created.data.item?.id, "upload creates gallery item");
const itemId = created.data.item.id;
const mediaId = created.data.item.mediaId;

const listed = await request("/api/me/gallery/items", { cookie: adminCookie });
assert(listed.data.items.some((item) => item.id === itemId), "uploaded item persists in list");

const media = await request(`/api/me/gallery/media/${mediaId}`, { cookie: adminCookie });
assert(media.response.ok && media.data.byteLength === png.byteLength, "private R2 image can be read by owner");

const edited = await request(`/api/me/gallery/items/${itemId}`, {
  method: "PATCH",
  body: { title: "Green afternoon", note: "a quiet day", category: "nature" },
  cookie: adminCookie,
  csrf: adminCsrf,
});
assert(edited.response.ok && edited.data.item.category === "nature", "metadata edit persists");

const replaced = await request(`/api/me/gallery/items/${itemId}/image`, {
  method: "PUT",
  body: png,
  contentType: "image/png",
  cookie: adminCookie,
  csrf: adminCsrf,
});
assert(replaced.response.ok && replaced.data.item.id === itemId, "image replacement preserves item");

const invite = await request("/api/admin/invites", {
  method: "POST",
  body: { note: "gallery isolation" },
  cookie: adminCookie,
  csrf: adminCsrf,
});
assert(invite.response.ok, "invite second user");
const member = await request("/api/auth/register", {
  method: "POST",
  body: {
    inviteToken: invite.data.invite.token,
    email: `gallery-member-${Date.now()}@xiao.test`,
    password: "gallery-member-password-123",
    displayName: "Gallery Member",
  },
});
assert(member.response.ok, "second user registered");
const memberList = await request("/api/me/gallery/items", { cookie: member.cookie });
assert(memberList.response.ok && memberList.data.items.length === 0, "second user cannot see owner gallery items");
const stolen = await request(`/api/me/gallery/media/${mediaId}`, { cookie: member.cookie });
assert(stolen.status === 404, "second user cannot read owner image");

const deleted = await request(`/api/me/gallery/items/${itemId}`, {
  method: "DELETE",
  body: {},
  cookie: adminCookie,
  csrf: adminCsrf,
});
assert(deleted.response.ok, "owner can delete item");
const after = await request("/api/me/gallery/items", { cookie: adminCookie });
assert(!after.data.items.some((item) => item.id === itemId), "deleted item is removed from list");
const deletedMedia = await request(`/api/me/gallery/media/${mediaId}`, { cookie: adminCookie });
assert(deletedMedia.status === 404, "deleted image is no longer readable");

const anonymous = await request("/api/me/gallery/items");
assert(anonymous.status === 401, "anonymous gallery access denied");

console.log("ALL GALLERY CRUD CHECKS PASSED");
