/**
 * Phase 2 Notes + Days persistence and user-isolation checks.
 * Usage: node tests/personal-space-v2.e2e.mjs http://127.0.0.1:45454
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

console.log(`\n=== Personal Space phase 2 @ ${base} (${suffix}) ===\n`);

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
  const candidates = ["admin-phase2@xiao.test", "admin@xiao.test", "admin-f78e1c@xiao.test"];
  let login = null;
  for (const email of candidates) {
    const result = await request("/api/auth/login", {
      method: "POST",
      body: { email, password: "admin-password-123" },
    });
    if (result.response.ok) {
      login = result;
      break;
    }
  }
  assert(login, `reuse local admin: ${JSON.stringify(boot.data)}`);
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

const alice = await createMember("AliceP2");
const bob = await createMember("BobP2");

const aliceNote = await request("/api/me/notes", {
  method: "POST",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
  body: { title: "Alice private note", body: "Only Alice can read this.", color: "sage", pinned: true },
});
assert(aliceNote.status === 201 && aliceNote.data.note?.pinned, "Alice creates pinned note");

const bobNote = await request("/api/me/notes", {
  method: "POST",
  cookie: bob.cookie,
  csrfToken: bob.csrf,
  body: { title: "Bob private note", body: "Only Bob can read this.", color: "blue" },
});
assert(bobNote.status === 201, "Bob creates own note");

const aliceNotes = await request("/api/me/notes?search=Alice&sort=updated_desc", { cookie: alice.cookie });
assert(aliceNotes.data.notes.length === 1 && aliceNotes.data.notes[0].id === aliceNote.data.note.id, "Alice search returns only own note");
const bobNotes = await request("/api/me/notes", { cookie: bob.cookie });
assert(bobNotes.data.notes.length === 1 && bobNotes.data.notes[0].id === bobNote.data.note.id, "Bob list excludes Alice note");

const stealNotePatch = await request(`/api/me/notes/${aliceNote.data.note.id}`, {
  method: "PATCH",
  cookie: bob.cookie,
  csrfToken: bob.csrf,
  body: { title: "stolen" },
});
assert(stealNotePatch.status === 404, "Bob cannot edit Alice note");
const stealNoteDelete = await request(`/api/me/notes/${aliceNote.data.note.id}`, {
  method: "DELETE",
  cookie: bob.cookie,
  csrfToken: bob.csrf,
  body: {},
});
assert(stealNoteDelete.status === 404, "Bob cannot delete Alice note");

const recurring = await request("/api/me/days/tasks", {
  method: "POST",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
  body: { title: "Weekly study", date: "2026-10-20", time: "09:30", tag: "Study", repeatRule: "weekly" },
});
assert(recurring.status === 201 && recurring.data.generatedCount === 12, "weekly task creates 12 dated records");
const aliceTasks = await request("/api/me/days/tasks?from=2026-10-20&to=2027-01-19", { cookie: alice.cookie });
assert(aliceTasks.data.tasks.length === 12, "Alice can read generated recurring tasks");
const bobTasks = await request("/api/me/days/tasks?from=2026-10-20&to=2027-01-19", { cookie: bob.cookie });
assert(bobTasks.data.tasks.length === 0, "Bob task list excludes Alice tasks");

const firstTaskId = aliceTasks.data.tasks[0].id;
const stealTask = await request(`/api/me/days/tasks/${firstTaskId}`, {
  method: "PATCH",
  cookie: bob.cookie,
  csrfToken: bob.csrf,
  body: { completed: true },
});
assert(stealTask.status === 404, "Bob cannot update Alice task");
const completeTask = await request(`/api/me/days/tasks/${firstTaskId}`, {
  method: "PATCH",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
  body: { completed: true },
});
assert(completeTask.response.ok && completeTask.data.task.completed, "Alice completes own task");

const important = await request("/api/me/days/important", {
  method: "POST",
  cookie: alice.cookie,
  csrfToken: alice.csrf,
  body: { title: "Important day", date: "2026-11-18", note: "Remember this", repeatRule: "yearly" },
});
assert(important.status === 201, "Alice creates important date");
const bobImportant = await request("/api/me/days/important", { cookie: bob.cookie });
assert(bobImportant.data.dates.length === 0, "Bob important dates exclude Alice data");
const stealImportant = await request(`/api/me/days/important/${important.data.date.id}`, {
  method: "DELETE",
  cookie: bob.cookie,
  csrfToken: bob.csrf,
  body: {},
});
assert(stealImportant.status === 404, "Bob cannot delete Alice important date");

await request("/api/auth/logout", { method: "POST", cookie: alice.cookie, csrfToken: alice.csrf, body: {} });
const relogin = await request("/api/auth/login", {
  method: "POST",
  body: { email: alice.email, password: alice.password },
});
assert(relogin.response.ok, "Alice logs in again");
const persistedNotes = await request("/api/me/notes", { cookie: relogin.cookie });
const persistedTasks = await request("/api/me/days/tasks?from=2026-10-20&to=2027-01-19", { cookie: relogin.cookie });
assert(persistedNotes.data.notes.some((note) => note.id === aliceNote.data.note.id), "note persists after relogin");
assert(persistedTasks.data.tasks.length === 12, "tasks persist after relogin");

const unauthNotes = await request("/api/me/notes");
const unauthTasks = await request("/api/me/days/tasks?from=2026-10-20&to=2026-10-27");
assert(unauthNotes.status === 401 && unauthTasks.status === 401, "private APIs require authentication");

console.log("\nALL PERSONAL SPACE PHASE 2 CHECKS PASSED\n");
