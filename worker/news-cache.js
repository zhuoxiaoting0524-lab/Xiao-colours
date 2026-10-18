const GDELT_API = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_QUERY =
  '(theme:GENERAL_HEALTH OR theme:NATURAL_DISASTER OR theme:ARMEDCONFLICT OR theme:TAX_FNCACT_PRESIDENT OR theme:UNREST OR theme:ECON OR theme:ENV OR theme:IMMIGRATION OR theme:MEDIA OR theme:SCIENCE) sourcelang:eng';

const TIMEOUT_MS = 25000;
const RETRY_DELAYS_MS = [5500, 11000];
const LIVE_WINDOW_MS = 30 * 60 * 1000;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const REFRESH_COOLDOWN_MS = 60 * 1000;
const MIN_VALID_ARTICLES = 5;

const CACHE_KEYS = {
  "1d": "news:1d",
  "1w": "news:1w",
  health: "news:health",
  cooldown: "news:cooldown",
};

function nowIso() {
  return new Date().toISOString();
}

function windowTimespan(time) {
  return time === "1w" ? "7d" : "1d";
}

function buildGdeltUrl(time) {
  const params = new URLSearchParams({
    query: GDELT_QUERY,
    mode: "ArtList",
    maxrecords: "150",
    format: "json",
    sort: "HybridRel",
    timespan: windowTimespan(time),
  });
  return `${GDELT_API}?${params}`;
}

function emptyHealth(storage) {
  return {
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    rawCount: 0,
    validCount: 0,
    cacheCount: 0,
    cacheAgeMs: null,
    stale: false,
    requestedWindow: null,
    storage,
  };
}

async function readJson(store, key) {
  if (!store) return null;
  try {
    const value = await store.get(key, "json");
    return value || null;
  } catch {
    return null;
  }
}

async function writeJson(store, key, value) {
  if (!store) return;
  await store.put(key, JSON.stringify(value));
}

function validateArticles(payload) {
  const articles = Array.isArray(payload?.articles) ? payload.articles : [];
  const valid = articles.filter((article) => {
    const title = String(article?.title || "").trim();
    const url = String(article?.url || "").trim();
    const seen = String(article?.seendate || "").trim();
    return title && /^https?:\/\//i.test(url) && seen;
  });
  return { rawCount: articles.length, articles: valid, validCount: valid.length };
}

async function fetchUpstream(time) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(buildGdeltUrl(time), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const error = new Error(`GDELT HTTP ${response.status}`);
      error.code = `http_${response.status}`;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(time) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const payload = await fetchUpstream(time);
      const checked = validateArticles(payload);
      if (checked.validCount < MIN_VALID_ARTICLES) {
        const error = new Error(`有效新闻不足：${checked.validCount}`);
        error.code = "empty_or_invalid";
        throw error;
      }
      return checked;
    } catch (error) {
      lastError = error;
      if (attempt >= RETRY_DELAYS_MS.length) break;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastError || new Error("GDELT refresh failed");
}

function classifyStatus(fetchedAt) {
  if (!fetchedAt) return "unavailable";
  const age = Date.now() - new Date(fetchedAt).valueOf();
  if (Number.isNaN(age)) return "unavailable";
  if (age <= LIVE_WINDOW_MS) return "live";
  if (age <= STALE_AFTER_MS) return "cache";
  return "stale";
}

export function createNewsCache(env) {
  const kv = env?.GLOBAL_PULSE_CACHE || null;
  const storage = kv ? "kv" : "edge-cache";

  // Fallback in-memory store for local preview without KV binding.
  const memory = globalThis.__xiaoNewsMemory || (globalThis.__xiaoNewsMemory = new Map());

  const store = kv || {
    async get(key, type) {
      const value = memory.get(key);
      if (value == null) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) {
      memory.set(key, value);
    },
  };

  async function readHealth() {
    return (await readJson(store, CACHE_KEYS.health)) || emptyHealth(storage);
  }

  async function writeHealth(patch) {
    const current = await readHealth();
    const next = { ...current, ...patch, storage };
    await writeJson(store, CACHE_KEYS.health, next);
    return next;
  }

  async function readWindow(time) {
    return readJson(store, CACHE_KEYS[time] || CACHE_KEYS["1d"]);
  }

  async function writeWindow(time, snapshot) {
    await writeJson(store, CACHE_KEYS[time] || CACHE_KEYS["1d"], snapshot);
  }

  async function refreshWindow(time, { force = false } = {}) {
    const cooldown = await readJson(store, CACHE_KEYS.cooldown);
    if (!force && cooldown?.until && Date.now() < cooldown.until) {
      return { ok: false, skipped: true, reason: "cooldown" };
    }

    try {
      const checked = await fetchWithRetry(time);
      const fetchedAt = nowIso();
      const snapshot = {
        status: "live",
        articles: checked.articles,
        fetchedAt,
        health: {
          lastSuccessAt: fetchedAt,
          lastFailureAt: null,
          lastError: null,
          rawCount: checked.rawCount,
          validCount: checked.validCount,
          cacheCount: checked.validCount,
          cacheAgeMs: 0,
          stale: false,
          requestedWindow: time,
          storage,
        },
      };
      await writeWindow(time, snapshot);
      await writeHealth({
        lastSuccessAt: fetchedAt,
        lastFailureAt: null,
        lastError: null,
        rawCount: checked.rawCount,
        validCount: checked.validCount,
        cacheCount: checked.validCount,
        cacheAgeMs: 0,
        stale: false,
        requestedWindow: time,
      });
      await writeJson(store, CACHE_KEYS.cooldown, { until: Date.now() + REFRESH_COOLDOWN_MS });
      console.log(JSON.stringify({ event: "news_refresh_success", time, count: checked.validCount }));
      return { ok: true, snapshot };
    } catch (error) {
      const failure = {
        lastFailureAt: nowIso(),
        lastError: {
          code: error.code || error.name || "refresh_failed",
          message: error.message || "refresh failed",
        },
        requestedWindow: time,
      };
      await writeHealth(failure);
      await writeJson(store, CACHE_KEYS.cooldown, { until: Date.now() + REFRESH_COOLDOWN_MS });
      console.log(JSON.stringify({ event: "news_refresh_failed", time, error: failure.lastError }));
      return { ok: false, error: failure.lastError };
    }
  }

  async function getNews(time, { force = false } = {}) {
    if (force) await refreshWindow(time, { force: true });

    let snapshot = await readWindow(time);
    if (!snapshot && !force) {
      await refreshWindow(time, { force: false });
      snapshot = await readWindow(time);
    }

    if (!snapshot?.articles?.length) {
      return {
        status: 503,
        body: {
          status: "unavailable",
          articles: [],
          fetchedAt: null,
          health: {
            ...(await readHealth()),
            requestedWindow: time,
            storage,
          },
        },
      };
    }

    const status = classifyStatus(snapshot.fetchedAt);
    const age = snapshot.fetchedAt ? Date.now() - new Date(snapshot.fetchedAt).valueOf() : null;
    const health = {
      ...(snapshot.health || emptyHealth(storage)),
      ...(await readHealth()),
      cacheCount: snapshot.articles.length,
      cacheAgeMs: age,
      stale: status === "stale",
      requestedWindow: time,
      storage,
    };

    return {
      status: 200,
      body: {
        status,
        articles: snapshot.articles,
        fetchedAt: snapshot.fetchedAt,
        health,
      },
    };
  }

  async function getHealth() {
    const health = await readHealth();
    const windows = {};
    for (const time of ["1d", "1w"]) {
      const snapshot = await readWindow(time);
      windows[time] = snapshot
        ? {
            status: classifyStatus(snapshot.fetchedAt),
            fetchedAt: snapshot.fetchedAt,
            count: snapshot.articles?.length || 0,
          }
        : null;
    }
    return {
      status: classifyStatus(health.lastSuccessAt),
      generatedAt: nowIso(),
      storage,
      windows,
      lastSuccessAt: health.lastSuccessAt,
      lastFailureAt: health.lastFailureAt,
      lastError: health.lastError,
    };
  }

  async function refreshAll() {
    const results = {
      "1d": await refreshWindow("1d"),
      "1w": await refreshWindow("1w"),
    };
    console.log(JSON.stringify({ event: "scheduled_refresh_complete", results: {
      "1d": Boolean(results["1d"].ok),
      "1w": Boolean(results["1w"].ok),
    } }));
    return results;
  }

  return { getNews, getHealth, refreshAll, refreshWindow, storage };
}
