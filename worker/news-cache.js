const RSS_SOURCES = [
  { id: "bbc", name: "BBC News", country: "United Kingdom", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { id: "aljazeera", name: "Al Jazeera", country: "Qatar", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { id: "guardian", name: "The Guardian", country: "United Kingdom", url: "https://www.theguardian.com/world/rss" },
  { id: "npr", name: "NPR", country: "United States", url: "https://feeds.npr.org/1004/rss.xml" },
];

const SOURCE_TIMEOUT_MS = 12000;
const LIVE_WINDOW_MS = 30 * 60 * 1000;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_VALID_ARTICLES = 3;
const CACHE_KEYS = { "1d": "news:1d", "1w": "news:1w", health: "news:health", cooldown: "news:cooldown:v2" };

function nowIso(now = Date.now()) { return new Date(now).toISOString(); }
function compactDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function decodeXml(value = "") {
  return String(value).replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}
function textTag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return decodeXml(match?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function attrUrl(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]+url=["']([^"']+)["'][^>]*>`, "i"));
  return decodeXml(match?.[1] || "");
}
function safeHttps(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.toString() : "";
  } catch { return ""; }
}
function parseRss(xml, source) {
  return [...String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(([item]) => ({
    url: safeHttps(textTag(item, "link") || textTag(item, "guid")),
    url_mobile: "",
    title: textTag(item, "title"),
    summary: textTag(item, "description"),
    seendate: compactDate(textTag(item, "pubDate") || textTag(item, "dc:date")),
    socialimage: safeHttps(attrUrl(item, "media:content") || attrUrl(item, "media:thumbnail") || attrUrl(item, "enclosure")),
    domain: source.name,
    language: "English",
    sourcecountry: source.country,
  })).filter((article) => article.title && article.url && article.seendate);
}
function articleTime(article) {
  const match = String(article?.seendate || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return match ? Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`) : 0;
}
function mergeArticles(...groups) {
  const map = new Map();
  for (const article of groups.flat()) {
    const key = safeHttps(article?.url).replace(/[?#].*$/, "").replace(/\/$/, "");
    if (key && !map.has(key)) map.set(key, article);
  }
  return [...map.values()].sort((a, b) => articleTime(b) - articleTime(a));
}
function within(articles, now, days) { return articles.filter((article) => articleTime(article) >= now - days * DAY_MS); }
function classifyStatus(fetchedAt, now = Date.now()) {
  if (!fetchedAt) return "unavailable";
  const age = now - new Date(fetchedAt).valueOf();
  if (!Number.isFinite(age)) return "unavailable";
  if (age <= LIVE_WINDOW_MS) return "live";
  if (age <= STALE_AFTER_MS) return "cache";
  return "stale";
}
function errorInfo(error, source = null) {
  const status = Number(error?.status || 0) || null;
  return {
    type: status === 429 ? "rate_limit" : status >= 500 ? "upstream_5xx" : error?.name === "AbortError" ? "timeout" : "source_error",
    status, source, message: String(error?.message || "新闻源请求失败").slice(0, 180),
  };
}
async function readJson(store, key) { try { return await store?.get(key, "json") || null; } catch { return null; } }
async function writeJson(store, key, value) { if (store) await store.put(key, JSON.stringify(value)); }
async function fetchSource(source, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(source.url, { signal: controller.signal, headers: { Accept: "application/rss+xml, application/xml, text/xml" } });
    if (!response.ok) { const error = new Error(`${source.name} HTTP ${response.status}`); error.status = response.status; throw error; }
    const articles = parseRss(await response.text(), source);
    if (!articles.length) throw new Error(`${source.name} 未返回可解析新闻`);
    return { source: source.id, ok: true, count: articles.length, articles };
  } finally { clearTimeout(timer); }
}

export function createNewsCache(env, runtime = {}) {
  const kv = env?.GLOBAL_PULSE_CACHE || null;
  const memory = globalThis.__xiaoNewsMemory || (globalThis.__xiaoNewsMemory = new Map());
  const store = kv || {
    async get(key, type) { const value = memory.get(key); return value == null ? null : type === "json" ? JSON.parse(value) : value; },
    async put(key, value) { memory.set(key, value); },
  };
  const storage = kv ? "kv" : "memory";
  const fetchImpl = runtime.fetchImpl || fetch;
  const clock = runtime.now || (() => Date.now());
  async function readHealth() { return await readJson(store, CACHE_KEYS.health) || { storage, lastSuccessAt: null, lastFailureAt: null, lastError: null, sources: [] }; }

  async function refreshAll({ force = false } = {}) {
    const now = clock();
    const cooldown = await readJson(store, CACHE_KEYS.cooldown);
    if (!force && cooldown?.until > now) return { ok: false, skipped: true, reason: "cooldown" };
    await writeJson(store, CACHE_KEYS.cooldown, { until: now + REFRESH_COOLDOWN_MS });
    const settled = await Promise.allSettled(RSS_SOURCES.map((source) => fetchSource(source, fetchImpl)));
    const sourceHealth = settled.map((result, index) => result.status === "fulfilled"
      ? { source: RSS_SOURCES[index].id, ok: true, count: result.value.count }
      : { source: RSS_SOURCES[index].id, ok: false, count: 0, error: errorInfo(result.reason, RSS_SOURCES[index].id) });
    const fresh = mergeArticles(...settled.filter((result) => result.status === "fulfilled").map((result) => result.value.articles));
    const previousWeek = await readJson(store, CACHE_KEYS["1w"]);
    const weekArticles = within(mergeArticles(fresh, previousWeek?.articles || []), now, 7);
    const dayArticles = within(fresh, now, 1);
    if (fresh.length < MIN_VALID_ARTICLES || dayArticles.length < MIN_VALID_ARTICLES) {
      const failures = sourceHealth.filter((source) => !source.ok).map((source) => source.error);
      const failure = failures[0] || { type: "empty_or_invalid", status: null, source: null, message: `最近24小时有效新闻不足：${dayArticles.length}` };
      const current = await readHealth();
      await writeJson(store, CACHE_KEYS.health, { ...current, storage, lastFailureAt: nowIso(now), lastError: failure, rawCount: fresh.length, validCount: dayArticles.length, sources: sourceHealth });
      console.log(JSON.stringify({ event: "news_refresh_failed", error: failure, sources: sourceHealth }));
      return { ok: false, error: failure, sources: sourceHealth };
    }
    const fetchedAt = nowIso(now);
    const health = { storage, lastSuccessAt: fetchedAt, lastFailureAt: null, lastError: null, rawCount: fresh.length, validCount: dayArticles.length, sources: sourceHealth };
    await Promise.all([
      writeJson(store, CACHE_KEYS["1d"], { status: "live", articles: dayArticles.slice(0, 200), fetchedAt, health }),
      writeJson(store, CACHE_KEYS["1w"], { status: "live", articles: weekArticles.slice(0, 500), fetchedAt, health }),
      writeJson(store, CACHE_KEYS.health, health),
    ]);
    console.log(JSON.stringify({ event: "news_refresh_success", dayCount: dayArticles.length, weekCount: weekArticles.length, sources: sourceHealth }));
    return { ok: true, dayCount: dayArticles.length, weekCount: weekArticles.length, sources: sourceHealth };
  }

  async function getNews(time, { force = false } = {}) {
    const key = time === "1w" ? "1w" : "1d";
    let snapshot = await readJson(store, CACHE_KEYS[key]);
    if (force || !snapshot?.articles?.length) { await refreshAll({ force }); snapshot = await readJson(store, CACHE_KEYS[key]); }
    if (!snapshot?.articles?.length) return { status: 503, body: { status: "unavailable", articles: [], fetchedAt: null, health: { ...(await readHealth()), requestedWindow: key, cacheCount: 0, stale: false } } };
    const now = clock();
    const status = classifyStatus(snapshot.fetchedAt, now);
    const health = { ...(snapshot.health || {}), ...(await readHealth()), requestedWindow: key, cacheCount: snapshot.articles.length, cacheAgeMs: now - new Date(snapshot.fetchedAt).valueOf(), stale: status === "stale", storage };
    return { status: 200, body: { status, articles: snapshot.articles, fetchedAt: snapshot.fetchedAt, health } };
  }
  async function getHealth() {
    const health = await readHealth(); const windows = {};
    for (const key of ["1d", "1w"]) { const snapshot = await readJson(store, CACHE_KEYS[key]); windows[key] = snapshot ? { status: classifyStatus(snapshot.fetchedAt, clock()), fetchedAt: snapshot.fetchedAt, count: snapshot.articles?.length || 0, cacheCount: snapshot.articles?.length || 0 } : null; }
    return { status: classifyStatus(health.lastSuccessAt, clock()), generatedAt: nowIso(clock()), storage, windows, ...health };
  }
  return { getNews, getHealth, refreshAll, storage };
}

export async function getNewsPayload(env, time, options = {}) {
  const cache = createNewsCache(env, { fetchImpl: options.fetchImpl, now: () => options.now ?? Date.now() });
  const result = await cache.getNews(time, { force: options.force });
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json; charset=utf-8" } });
}
export async function getHealthPayload(env, now = Date.now()) {
  const payload = await createNewsCache(env, { now: () => now }).getHealth();
  return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json; charset=utf-8" } });
}
export async function refreshWindow(env, _time, options = {}) {
  return createNewsCache(env, { fetchImpl: options.fetchImpl, now: () => options.now ?? Date.now() }).refreshAll({ force: options.force });
}
