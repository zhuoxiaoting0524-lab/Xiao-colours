/** Two-account Speaking Studio isolation check against a local Worker. */
const base = process.argv[2] || "http://127.0.0.1:45473";

function cookieFrom(response) {
  const values = response.headers.getSetCookie?.() || [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function request(path, { method = "GET", body, cookie = "", csrfToken = "" } = {}) {
  const headers = { accept: "application/json", origin: base };
  if (cookie) headers.cookie = cookie;
  if (csrfToken) headers["x-csrf-token"] = csrfToken;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { response, data, cookie: cookieFrom(response) || cookie };
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function login(email, password) {
  const result = await request("/api/auth/login", { method: "POST", body: { email, password } });
  assert(result.response.ok, `login failed for ${email}: ${JSON.stringify(result.data)}`);
  return { cookie: result.cookie, csrfToken: result.data.csrfToken };
}

const alice = await login("alice@xiao.test", "alice-password-123");
const bob = await login("bob@xiao.test", "bob-password-12345");

const aliceQuestion = await request("/api/me/speaking/custom-questions", {
  method: "POST", ...alice, body: { part: 1, topic: "Private Alice", questionEn: "What helps Alice relax?", questionZh: "什么帮助 Alice 放松？" },
});
const bobQuestion = await request("/api/me/speaking/custom-questions", {
  method: "POST", ...bob, body: { part: 3, topic: "Private Bob", questionEn: "How should Bob's city change?", questionZh: "Bob 的城市应如何改变？" },
});
assert(aliceQuestion.response.ok && bobQuestion.response.ok, "custom question creation failed");

await request("/api/me/speaking/expressions", { method: "POST", ...alice, body: { expressionEn: "Alice-only expression", topic: "Private Alice" } });
await request("/api/me/speaking/expressions", { method: "POST", ...bob, body: { expressionEn: "Bob-only expression", topic: "Private Bob" } });

const [aliceQuestions, bobQuestions, aliceExpressions, bobExpressions] = await Promise.all([
  request("/api/me/speaking/custom-questions", alice),
  request("/api/me/speaking/custom-questions", bob),
  request("/api/me/speaking/expressions", alice),
  request("/api/me/speaking/expressions", bob),
]);

const aq = JSON.stringify(aliceQuestions.data);
const bq = JSON.stringify(bobQuestions.data);
const ae = JSON.stringify(aliceExpressions.data);
const be = JSON.stringify(bobExpressions.data);
assert(aq.includes("Alice") && !aq.includes("Bob"), "Alice question scope leaked");
assert(bq.includes("Bob") && !bq.includes("Alice"), "Bob question scope leaked");
assert(ae.includes("Alice-only") && !ae.includes("Bob-only"), "Alice expression scope leaked");
assert(be.includes("Bob-only") && !be.includes("Alice-only"), "Bob expression scope leaked");

const unauthorized = await request("/api/me/speaking/history");
assert(unauthorized.response.status === 401, "unauthenticated private API must return 401");
console.log("PASS Speaking Studio two-account isolation e2e");
