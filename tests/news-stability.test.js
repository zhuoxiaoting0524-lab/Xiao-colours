import test from "node:test";
import assert from "node:assert/strict";
import { createNewsCache, getHealthPayload, getNewsPayload } from "../worker/news-cache.js";

class MockKV {
  constructor() { this.values = new Map(); }
  async get(key, type) {
    const value = this.values.get(key) ?? null;
    return type === "json" && value ? JSON.parse(value) : value;
  }
  async put(key, value) { this.values.set(key, value); }
}

function rss(items, now) {
  return `<?xml version="1.0"?><rss><channel>${Array.from({ length: items }, (_, index) => `
    <item><title>Major international event ${index}</title><link>https://news.example/${index}</link>
    <pubDate>${new Date(now - index * 60000).toUTCString()}</pubDate><description>Confirmed report ${index}</description></item>`).join("")}</channel></rss>`;
}
function goodFetch(now, count = 8) { return async () => new Response(rss(count, now), { status: 200, headers: { "content-type": "application/rss+xml" } }); }
function badFetch(status = 503) { return async () => new Response("unavailable", { status }); }
async function json(response) { return response.json(); }

test("one aggregation refresh populates both 24-hour and 7-day caches", async () => {
  const now = Date.UTC(2026, 9, 29, 12);
  const env = { GLOBAL_PULSE_CACHE: new MockKV() };
  const cache = createNewsCache(env, { now: () => now, fetchImpl: goodFetch(now) });
  const refresh = await cache.refreshAll();
  assert.equal(refresh.ok, true);
  const day = await cache.getNews("1d");
  const week = await cache.getNews("1w");
  assert.equal(day.status, 200);
  assert.equal(week.status, 200);
  assert.ok(day.body.articles.length >= 3);
  assert.equal(week.body.articles.length, day.body.articles.length);
});

test("failed refresh preserves the last successful cache", async () => {
  const now = Date.UTC(2026, 9, 29, 12);
  const env = { GLOBAL_PULSE_CACHE: new MockKV() };
  await createNewsCache(env, { now: () => now, fetchImpl: goodFetch(now) }).refreshAll();
  await createNewsCache(env, { now: () => now + 301000, fetchImpl: badFetch(429) }).refreshAll({ force: true });
  const payload = await json(await getNewsPayload(env, "1d", { now: now + 302000 }));
  assert.ok(payload.articles.length >= 3);
  assert.equal(payload.health.lastError.type, "rate_limit");
  assert.equal(payload.health.lastError.status, 429);
});

test("empty cache with all sources unavailable returns a clear 503", async () => {
  const now = Date.UTC(2026, 9, 29, 12);
  const response = await getNewsPayload({ GLOBAL_PULSE_CACHE: new MockKV() }, "1d", { now, fetchImpl: badFetch() });
  const payload = await json(response);
  assert.equal(response.status, 503);
  assert.equal(payload.status, "unavailable");
  assert.deepEqual(payload.articles, []);
});

test("cooldown prevents user refreshes from repeatedly hitting all sources", async () => {
  const now = Date.UTC(2026, 9, 29, 12);
  const env = { GLOBAL_PULSE_CACHE: new MockKV() };
  let requests = 0;
  const fetchImpl = async () => { requests += 1; return new Response("limited", { status: 429 }); };
  const cache = createNewsCache(env, { now: () => now, fetchImpl });
  await cache.getNews("1d");
  await cache.getNews("1d");
  assert.equal(requests, 4);
});

test("health reports per-source status and persistent windows", async () => {
  const now = Date.UTC(2026, 9, 29, 12);
  const env = { GLOBAL_PULSE_CACHE: new MockKV() };
  await createNewsCache(env, { now: () => now, fetchImpl: goodFetch(now) }).refreshAll();
  const health = await json(await getHealthPayload(env, now + 1000));
  assert.equal(health.sources.length, 4);
  assert.equal(health.sources.every((source) => source.ok), true);
  assert.ok(health.windows["1d"].cacheCount >= 3);
  assert.ok(health.windows["1w"].cacheCount >= 3);
});
