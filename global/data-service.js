import {
  CACHE_KEY,
  NEWS_API,
  USGS_FEEDS,
} from "./config.js";
import {
  canonicalUrl,
  classifyTitle,
  parseGdeltDate,
  safeImageUrl,
  safeNewsUrl,
} from "./utils.js";
import { clusterNewsEvents } from "./news-quality.js";

const REQUEST_TIMEOUT_MS = 40000;
const NEWS_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const SEED_NEWS_URL = new URL("../data/news-cache.json", import.meta.url);

export function normalizeArticles(rawArticles, { rankedByRelevance = true } = {}) {
  const deduped = new Map();

  for (const [index, raw] of (Array.isArray(rawArticles) ? rawArticles : []).entries()) {
    const title = String(raw.title || "").trim();
    const url = canonicalUrl(safeNewsUrl(raw.url));
    if (!title || !url) continue;

    const key = url;
    if (deduped.has(key)) continue;

    deduped.set(key, {
      id: key,
      title,
      summary: String(raw.summary || raw.description || raw.snippet || "").trim(),
      url,
      image: safeImageUrl(raw.socialimage),
      source: String(raw.domain || new URL(url).hostname).replace(/^www\./, ""),
      country: String(raw.sourcecountry || "").trim() || "来源地未知",
      language: String(raw.language || "").trim() || "未知语言",
      publishedAt: parseGdeltDate(raw.seendate),
      category: classifyTitle(title),
      apiRank: rankedByRelevance ? index + 1 : null,
    });
  }

  const normalized = [...deduped.values()].sort((a, b) => {
    return (b.publishedAt?.valueOf() || 0) - (a.publishedAt?.valueOf() || 0);
  });
  return clusterNewsEvents(normalized);
}

function serializeSnapshot(snapshot) {
  return {
    ...snapshot,
    articles: snapshot.articles.map((article) => ({
      ...article,
      publishedAt: article.publishedAt?.toISOString() || null,
      eventUpdatedAt: article.eventUpdatedAt?.toISOString() || null,
      relatedSources: (article.relatedSources || []).map((source) => ({
        ...source,
        publishedAt: source.publishedAt?.toISOString() || null,
      })),
    })),
    fetchedAt: snapshot.fetchedAt?.toISOString() || null,
  };
}

function hydrateSnapshot(snapshot) {
  if (!Array.isArray(snapshot?.articles) || !snapshot.articles.length) return null;
  const hydrated = {
    ...snapshot,
    articles: snapshot.articles.map((article) => ({
      ...article,
      publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
      eventUpdatedAt: article.eventUpdatedAt ? new Date(article.eventUpdatedAt) : null,
      relatedSources: (article.relatedSources || []).map((source) => ({
        ...source,
        publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
      })),
    })),
    earthquakes: Array.isArray(snapshot.earthquakes) ? snapshot.earthquakes : [],
    fetchedAt: snapshot.fetchedAt ? new Date(snapshot.fetchedAt) : null,
  };
  if (
    hydrated.source !== "seed"
    && hydrated.fetchedAt
    && Date.now() - hydrated.fetchedAt.valueOf() > NEWS_STALE_AFTER_MS
  ) {
    hydrated.source = "stale";
    hydrated.health = { ...(hydrated.health || {}), stale: true };
  }
  return hydrated;
}

function readBrowserCache(time) {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY));
    return hydrateSnapshot(parsed?.byTime?.[time] || parsed?.latest);
  } catch {
    return null;
  }
}

function writeBrowserCache(time, snapshot) {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {};
    const serialized = serializeSnapshot(snapshot);
    parsed.byTime = { ...(parsed.byTime || {}), [time]: serialized };
    parsed.latest = serialized;
    localStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
  } catch {
    // Private browsing and storage limits must not block live data.
  }
}

async function fetchJson(url, signal) {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function serverNewsUrl(time, force) {
  const url = new URL(NEWS_API, window.location.origin);
  url.searchParams.set("time", time);
  if (force) url.searchParams.set("refresh", "1");
  return url;
}

async function fetchWorkerNews(time, signal, { force = false } = {}) {
  const response = await fetch(serverNewsUrl(time, force), {
    signal,
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") || "";
  if (response.status === 404 || response.status === 405 || !contentType.includes("application/json")) {
    return null;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error("新闻服务返回了无法解析的数据");
    error.name = "NewsServiceResponseError";
    throw error;
  }
  if (!response.ok || !Array.isArray(payload?.articles)) {
    const error = new Error(payload?.health?.lastError?.message || `新闻服务 HTTP ${response.status}`);
    error.name = "NewsServiceResponseError";
    error.status = response.status;
    error.health = payload?.health || null;
    throw error;
  }
  return payload;
}

async function fetchNews(time, signal, { force = false } = {}) {
  const serverPayload = await fetchWorkerNews(time, signal, { force });
  if (serverPayload) return { payload: serverPayload, transport: "worker" };
  const error = new Error("新闻服务暂不可用");
  error.name = "NewsServiceResponseError";
  throw error;
}

async function readSeedSnapshot() {
  try {
    const response = await fetch(SEED_NEWS_URL, { cache: "no-store" });
    if (!response.ok) return null;
    const seed = await response.json();
    const articles = normalizeArticles(seed.articles, { rankedByRelevance: false });
    if (!articles.length) return null;
    const newest = Math.max(...articles.map((article) => article.publishedAt?.valueOf() || 0));
    return {
      articles,
      earthquakes: [],
      fetchedAt: newest > 0 ? new Date(newest) : null,
      source: "seed",
      health: {
        lastSuccessAt: newest > 0 ? new Date(newest).toISOString() : null,
        lastFailureAt: null,
        lastError: null,
        rawCount: Array.isArray(seed.articles) ? seed.articles.length : 0,
        validCount: articles.length,
        cacheCount: articles.length,
        stale: true,
        storage: "bundled-snapshot",
      },
    };
  } catch {
    return null;
  }
}

export class GlobalPulseDataService {
  constructor() {
    this.inFlight = new Map();
    this.memory = new Map();
    this.controller = null;
  }

  getCached(time) {
    return this.memory.get(time) || readBrowserCache(time);
  }

  async getInitial(time = "1d") {
    const cached = this.getCached(time);
    if (cached) return cached;
    const seed = await readSeedSnapshot();
    if (seed) this.memory.set(time, seed);
    return seed;
  }

  async load(time = "1d", { force = false, refreshUpstream = false } = {}) {
    if (!force && this.inFlight.has(time)) return this.inFlight.get(time);
    if (!force && this.memory.has(time)) return this.memory.get(time);

    this.controller?.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const timeout = window.setTimeout(() => this.controller?.abort(), REQUEST_TIMEOUT_MS);

    const request = this.#loadFresh(time, signal, { refreshUpstream })
      .finally(() => {
        window.clearTimeout(timeout);
        this.inFlight.delete(time);
      });

    this.inFlight.set(time, request);
    return request;
  }

  async #loadFresh(time, signal, { refreshUpstream = false } = {}) {
    const cached = this.getCached(time);
    const [newsResult, quakeResult] = await Promise.allSettled([
      fetchNews(time, signal, { force: refreshUpstream }),
      fetchJson(USGS_FEEDS[time] || USGS_FEEDS["1d"], signal),
    ]);

    const newsPayload = newsResult.status === "fulfilled" ? newsResult.value.payload : null;
    const articles = newsPayload
      ? normalizeArticles(newsPayload.articles)
      : [];
    const earthquakes = quakeResult.status === "fulfilled" && Array.isArray(quakeResult.value.features)
      ? quakeResult.value.features
      : (cached?.earthquakes || []);

    if (articles.length) {
      const fetchedAt = newsPayload.fetchedAt ? new Date(newsPayload.fetchedAt) : new Date();
      const snapshot = {
        articles,
        earthquakes,
        fetchedAt: Number.isNaN(fetchedAt.valueOf()) ? new Date() : fetchedAt,
        source: ["live", "cache", "stale"].includes(newsPayload.status) ? newsPayload.status : "live",
        health: newsPayload.health || null,
        transport: newsResult.value.transport,
        earthquakeStatus: quakeResult.status === "fulfilled" ? "live" : "cached",
      };
      this.memory.set(time, snapshot);
      writeBrowserCache(time, snapshot);
      return snapshot;
    }

    const fallback = cached || await readSeedSnapshot();
    if (fallback) {
      const snapshot = {
        ...fallback,
        earthquakes,
        source: fallback.source === "seed" ? "seed" : (fallback.source === "stale" ? "stale" : "cache"),
        earthquakeStatus: quakeResult.status === "fulfilled" ? "live" : "cached",
        error: newsResult.status === "rejected" ? newsResult.reason : new Error("新闻接口未返回结果"),
        health: newsResult.status === "rejected" && newsResult.reason?.health
          ? newsResult.reason.health
          : fallback.health || null,
      };
      this.memory.set(time, snapshot);
      return snapshot;
    }

    throw newsResult.status === "rejected"
      ? newsResult.reason
      : new Error("新闻接口未返回可用内容");
  }
}
