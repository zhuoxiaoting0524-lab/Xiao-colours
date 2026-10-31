import { randomBytes } from "node:crypto";

const base = process.argv[2] || "http://127.0.0.1:45468";
const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN || "local-bootstrap-token-change-me";
const suffix = randomBytes(3).toString("hex");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log("PASS:", message);
}

function jarFrom(response, previous = "") {
  const lines = response.headers.getSetCookie?.() || [response.headers.get("set-cookie")].filter(Boolean);
  const values = new Map(previous.split(/;\s*/).filter(Boolean).map((item) => {
    const [key, ...rest] = item.split("="); return [key, rest.join("=")];
  }));
  for (const line of lines) {
    const [cookie] = line.split(";"); const [key, ...rest] = cookie.split("="); values.set(key, rest.join("="));
  }
  return [...values].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(path, { method = "GET", body, cookie = "", csrfToken } = {}) {
  const headers = { Accept: "application/json", Origin: base };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { response, data, status: response.status, cookie: jarFrom(response, cookie) };
}

let adminCookie;
let adminCsrf;
const boot = await request("/api/auth/bootstrap", { method: "POST", body: {
  bootstrapToken, email: "admin-phase2@xiao.test", password: "admin-password-123", displayName: "Admin",
} });
if (boot.response.ok) {
  adminCookie = boot.cookie; adminCsrf = boot.data.csrfToken;
} else {
  const login = await request("/api/auth/login", { method: "POST", body: { email: "admin-phase2@xiao.test", password: "admin-password-123" } });
  assert(login.response.ok, "reuse local admin"); adminCookie = login.cookie; adminCsrf = login.data.csrfToken;
}

async function createMember(name) {
  const invite = await request("/api/admin/invites", { method: "POST", cookie: adminCookie, csrfToken: adminCsrf, body: { note: name } });
  assert(invite.response.ok, `create invite for ${name}`);
  const email = `${name.toLowerCase()}-${suffix}@xiao.test`;
  const password = `${name.toLowerCase()}-password-123`;
  const registration = await request("/api/auth/register", { method: "POST", body: { inviteToken: invite.data.invite.token, email, password, displayName: name } });
  assert(registration.response.ok, `register ${name}`);
  return { cookie: registration.cookie, csrf: registration.data.csrfToken };
}

const alice = await createMember("AliceTravel");
const bob = await createMember("BobTravel");
const created = await request("/api/me/travel", { method: "POST", cookie: alice.cookie, csrfToken: alice.csrf, body: {
  name: "东京五日之旅", destinationName: "Tokyo, Japan", destinationNameZh: "东京，日本",
  countryCode: "JP", latitude: 35.6762, longitude: 139.6503,
  startDate: "2027-04-12", endDate: "2027-04-16", travelers: 2,
  budgetTier: "moderate", budgetAmount: 9800, budgetCurrency: "CNY",
  styles: ["classic", "food"], pace: "moderate", transport: "transit", preferences: "喜欢咖啡馆",
} });
assert(created.status === 201 && created.data.days?.length === 5, "create a persisted five-day Tokyo trip");
const tripId = created.data.trip.id;
const day1 = created.data.days[0].id;
const day2 = created.data.days[1].id;

const first = await request(`/api/me/travel/${tripId}/activities`, { method: "POST", cookie: alice.cookie, csrfToken: alice.csrf, body: {
  dayId: day1, startTime: "09:00", durationMinutes: 90, type: "place", name: "浅草寺",
  locationLabel: "Sensō-ji", latitude: 35.7148, longitude: 139.7967, verification: "verified", sortOrder: 0,
} });
const second = await request(`/api/me/travel/${tripId}/activities`, { method: "POST", cookie: alice.cookie, csrfToken: alice.csrf, body: {
  dayId: day1, startTime: "11:00", durationMinutes: 60, type: "food", name: "午餐", sortOrder: 1,
} });
assert(first.status === 201 && second.status === 201, "add editable itinerary activities");
const moved = await request(`/api/me/travel/${tripId}/activities/${second.data.id}`, { method: "PATCH", cookie: alice.cookie, csrfToken: alice.csrf, body: { dayId: day2, sortOrder: 0 } });
assert(moved.response.ok, "move an activity to another day");

const expense = await request(`/api/me/travel/${tripId}/expenses`, { method: "POST", cookie: alice.cookie, csrfToken: alice.csrf, body: { category: "transport", title: "交通卡", amount: 120, currency: "CNY" } });
const checklist = await request(`/api/me/travel/${tripId}/checklist`, { method: "POST", cookie: alice.cookie, csrfToken: alice.csrf, body: { section: "before", title: "下载离线地图" } });
assert(expense.status === 201 && checklist.status === 201, "save budget and checklist records");

const persisted = await request(`/api/me/travel/${tripId}`, { cookie: alice.cookie });
assert(persisted.response.ok && persisted.data.activities.length === 2 && persisted.data.expenses.length === 1, "trip data survives a fresh API read");
const bobRead = await request(`/api/me/travel/${tripId}`, { cookie: bob.cookie });
const bobDelete = await request(`/api/me/travel/${tripId}`, { method: "DELETE", cookie: bob.cookie, csrfToken: bob.csrf, body: {} });
assert(bobRead.status === 404 && bobDelete.status === 404, "another account cannot read or delete the trip");

const ai = await request(`/api/me/travel/${tripId}/ai`, { method: "POST", cookie: alice.cookie, csrfToken: alice.csrf, body: { scope: "day", dayId: day2 } });
const afterAi = await request(`/api/me/travel/${tripId}`, { cookie: alice.cookie });
assert(ai.status === 503 && afterAi.data.activities.length === 2, "AI unavailable state preserves the manual itinerary");
console.log("\nALL TRAVEL PLANNER CHECKS PASSED\n");
