import {
  CACHE_KEY,
  GDELT_API,
  GDELT_QUERY,
  USGS_FEEDS,
} from "./config.js";
import {
  canonicalUrl,
  classifyTitle,
  parseGdeltDate,
  safeImageUrl,
} from "./utils.js";
import { clusterNewsEvents } from "./news-quality.js";
import { fetchGdeltJson } from "./gdelt-client.js";

const REQUEST_TIMEOUT_MS = 40000;
const GDELT_TIMEOUT_MS = 30000;
const SEED_NEWS_URL = new URL("../data/news-cache.json", import.meta.url);

function normalizeArticles(rawArticles, { rankedByRelevance = true } = {}) {
  const deduped = new Map();

  for (const [index, raw] of (Array.isArray(rawArticles) ? rawArticles : []).entries()) {
    const title = String(raw.title || "").trim();
    const url = canonicalUrl(String(raw.url || "").trim());
    if (!title || !/^https?:\/\//i.test(url)) continue;

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
  return {
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

function buildGdeltUrl(time) {
  const params = new URLSearchParams({
    query: GDELT_QUERY,
    mode: "ArtList",
    maxrecords: "150",
    format: "json",
    sort: "HybridRel",
    timespan: time,
  });
  return `${GDELT_API}?${params}`;
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

async function fetchGdelt(time, signal) {
  const corsController = new AbortController();
  const abortCors = () => corsController.abort();
  const timeout = window.setTimeout(abortCors, GDELT_TIMEOUT_MS);
  signal?.addEventListener("abort", abortCors, { once: true });

  try {
    return await fetchGdeltJson(buildGdeltUrl(time), corsController.signal);
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortCors);
  }
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

  async load(time = "1d", { force = false } = {}) {
    if (!force && this.inFlight.has(time)) return this.inFlight.get(time);
    if (!force && this.memory.has(time)) return this.memory.get(time);

    this.controller?.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const timeout = window.setTimeout(() => this.controller?.abort(), REQUEST_TIMEOUT_MS);

    const request = this.#loadFresh(time, signal)
      .finally(() => {
        window.clearTimeout(timeout);
        this.inFlight.delete(time);
      });

    this.inFlight.set(time, request);
    return request;
  }

  async #loadFresh(time, signal) {
    const cached = this.getCached(time);
    const [newsResult, quakeResult] = await Promise.allSettled([
      fetchGdelt(time, signal),
      fetchJson(USGS_FEEDS[time] || USGS_FEEDS["1d"], signal),
    ]);

    const articles = newsResult.status === "fulfilled"
      ? normalizeArticles(newsResult.value.articles)
      : [];
    const earthquakes = quakeResult.status === "fulfilled" && Array.isArray(quakeResult.value.features)
      ? quakeResult.value.features
      : (cached?.earthquakes || []);

    if (articles.length) {
      const snapshot = {
        articles,
        earthquakes,
        fetchedAt: new Date(),
        source: "live",
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
        source: fallback.source === "seed" ? "seed" : "cache",
        earthquakeStatus: quakeResult.status === "fulfilled" ? "live" : "cached",
        error: newsResult.status === "rejected" ? newsResult.reason : new Error("新闻接口未返回结果"),
      };
      this.memory.set(time, snapshot);
      return snapshot;
    }

    throw newsResult.status === "rejected"
      ? newsResult.reason
      : new Error("新闻接口未返回可用内容");
  }
}
