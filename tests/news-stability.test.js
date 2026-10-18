import test from "node:test";
import assert from "node:assert/strict";

import {
  getHealthPayload,
  getNewsPayload,
  refreshWindow,
} from "../worker/news-cache.js";
import { rankNewsEvents, selectTopEvents } from "../global/news-quality.js";

class MockKV {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

function gdeltDate(time) {
  return new Date(time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function rawArticles(count, time = Date.now()) {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://news.example/${index}`,
    title: index % 2
      ? `International summit reaches major agreement number ${index}`
      : `Central bank announces inflation policy number ${index}`,
    seendate: gdeltDate(time - index * 60_000),
    domain: `source${index % 4}.example`,
    sourcecountry: index % 2 ? "France" : "Japan",
    language: "English",
    socialimage: "",
  }));
}

function okFetch(count = 12, time = Date.now()) {
  return async () => new Response(JSON.stringify({ articles: rawArticles(count, time) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorFetch(status = 429) {
  return async () => new Response("upstream rejected request", { status });
}

async function body(response) {
  return response.json();
}

test("normal fetch validates news, persists it, and reports live health", async () => {
  const now = Date.UTC(2026, 9, 18, 12);
  const env = { GLOBAL_PULSE_CACHE: new MockKV() };
  const response = await getNewsPayload(env, "1d", { now, fetchImpl: okFetch(12, now), sleepImpl: async () => {} });
  const payload = await body(response);
  assert.equal(response.status, 200);
  assert.equal(payload.status, "live");
  assert.equal(payload.articles.length, 12);
  assert.equal(payload.health.rawCount, 12);
  assert.equal(payload.health.validCount, 12);
  assert.equal(payload.health.cacheCount, 12);
  assert.equal(payload.health.storage, "kv");
});

test("an upstream failure keeps the last successful cache and records HTTP 429", async () => {
  const now = Date.UTC(2026, 9, 18, 12);
  const env = { GLOBAL_PULSE_CACHE: new MockKV() };
  await refreshWindow(env, "1d", { now, fetchImpl: okFetch(10, now), sleepImpl: async () => {} });
  const response = await getNewsPayload(env, "1d", {
    now: now + 61_000,
    force: true,
    fetchImpl: errorFetch(429),
    sleepImpl: async () => {},
  });
  const payload = await body(response);
  assert.equal(response.status, 200);
  assert.equal(payload.status, "cache");
  assert.equal(payload.articles.length, 10);
  assert.equal(payload.health.lastError.type, "rate_limit");
  assert.equal(payload.health.lastError.status, 429);

  const laterRead = await getNewsPayload(env, "1d", { now: now + 62_000 });
  assert.equal((await body(laterRead)).status, "cache");
});

test("cache older than 24 hours is returned as stale instead of live news", async () => {
  const now = Date.UTC(2026, 9, 17, 8);
  const env = { GLOBAL_PULSE_CACHE: new MockKV() };
  await refreshWindow(env, "1d", { now, fetchImpl: okFetch(9, now), sleepImpl: async () => {} });
  const response = await getNewsPayload(env, "1d", { now: now + 25 * 60 * 60 * 1000 });
  const payload = await body(response);
  assert.equal(payload.status, "stale");
  assert.equal(payload.health.stale, true);
  assert.equal(payload.articles.length, 9);
});

test("two major events remain two while ordinary news stays available separately", () => {
  const now = Date.UTC(2026, 9, 18, 12);
  const major = [
    "United Nations announces ceasefire after international war talks",
    "Major earthquake prompts mass evacuation and state of emergency",
  ].map((title, index) => ({
    title,
    summary: "",
    category: index ? "disaster" : "international",
    source: `major${index}.example`,
    country: index ? "Japan" : "France",
    publishedAt: new Date(now - index * 60_000),
    eventUpdatedAt: new Date(now - index * 60_000),
    relatedSources: [{ source: `major${index}.example`, country: index ? "Japan" : "France", title, apiRank: index + 1 }],
    sourceCount: 1,
    apiRank: index + 1,
  }));
  const ordinary = {
    title: "Local technology museum opens a new public exhibition",
    summary: "",
    category: "technology",
    source: "ordinary.example",
    country: "Canada",
    publishedAt: new Date(now - 120_000),
    eventUpdatedAt: new Date(now - 120_000),
    relatedSources: [{ source: "ordinary.example", country: "Canada", title: "Local technology museum opens a new public exhibition", apiRank: 30 }],
    sourceCount: 1,
    apiRank: 30,
  };
  assert.equal(selectTopEvents([...major, ordinary], 5, now).length, 2);
  assert.equal(rankNewsEvents([...major, ordinary], now).length, 3);
});

test("ordinary news can exist while the major-event selection is empty", () => {
  const now = Date.UTC(2026, 9, 18, 12);
  const ordinary = rawArticles(6, now).map((raw, index) => {
    const title = `Community library publishes reading list number ${index}`;
    return {
    title,
    summary: "",
    category: "technology",
    source: raw.domain,
    country: raw.sourcecountry,
    publishedAt: new Date(now - index * 60_000),
    eventUpdatedAt: new Date(now - index * 60_000),
    relatedSources: [{ source: raw.domain, country: raw.sourcecountry, title, apiRank: index + 20 }],
    sourceCount: 1,
    apiRank: index + 20,
  };
  });
  assert.equal(selectTopEvents(ordinary, 5, now).length, 0);
  assert.equal(rankNewsEvents(ordinary, now).length, 6);
});

test("all sources unavailable produces a clear 503 state", async () => {
  const now = Date.UTC(2026, 9, 18, 12);
  const env = { GLOBAL_PULSE_CACHE: new MockKV() };
  const response = await getNewsPayload(env, "1d", { now, fetchImpl: errorFetch(503), sleepImpl: async () => {} });
  const payload = await body(response);
  assert.equal(response.status, 503);
  assert.equal(payload.status, "unavailable");
  assert.equal(payload.articles.length, 0);
  assert.equal(payload.health.lastError.type, "upstream_5xx");
});

test("an empty-cache outage observes the retry cooldown instead of hammering upstream", async () => {
  const now = Date.UTC(2026, 9, 18, 12);
  const env = { GLOBAL_PULSE_CACHE: new MockKV() };
  let requestCount = 0;
  const failingFetch = async () => {
    requestCount += 1;
    return new Response("rate limited", { status: 429 });
  };
  await getNewsPayload(env, "1d", { now, fetchImpl: failingFetch, sleepImpl: async () => {} });
  assert.equal(requestCount, 3);
  const response = await getNewsPayload(env, "1d", {
    now: now + 30_000,
    fetchImpl: failingFetch,
    sleepImpl: async () => {},
  });
  assert.equal(response.status, 503);
  assert.equal(requestCount, 3);
});

test("a later successful refresh automatically recovers from failure", async () => {
  const now = Date.UTC(2026, 9, 18, 12);
  const env = { GLOBAL_PULSE_CACHE: new MockKV() };
  await getNewsPayload(env, "1d", { now, fetchImpl: errorFetch(429), sleepImpl: async () => {} });
  const response = await getNewsPayload(env, "1d", { now: now + 61_000, fetchImpl: okFetch(8, now + 61_000), sleepImpl: async () => {} });
  const payload = await body(response);
  assert.equal(response.status, 200);
  assert.equal(payload.status, "live");
  assert.equal(payload.articles.length, 8);
  assert.ok(payload.health.lastSuccessAt);
  assert.ok(payload.health.lastFailureAt);
});

test("cache remains available across new Worker requests and health reads", async () => {
  const now = Date.UTC(2026, 9, 18, 12);
  const kv = new MockKV();
  await refreshWindow({ GLOBAL_PULSE_CACHE: kv }, "1d", { now, fetchImpl: okFetch(7, now), sleepImpl: async () => {} });
  const nextRequestEnv = { GLOBAL_PULSE_CACHE: kv };
  const response = await getNewsPayload(nextRequestEnv, "1d", { now: now + 5 * 60_000 });
  const payload = await body(response);
  const healthResponse = await getHealthPayload(nextRequestEnv, now + 5 * 60_000);
  const health = await body(healthResponse);
  assert.equal(payload.articles.length, 7);
  assert.equal(health.windows["1d"].cacheCount, 7);
  assert.equal(health.storage, "kv");
});
