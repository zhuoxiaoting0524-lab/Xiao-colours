const GDELT_API = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_QUERY = "(war OR ceasefire OR sanctions OR election OR summit OR inflation OR tariff OR earthquake OR flood OR wildfire OR hurricane OR \"artificial intelligence\" OR semiconductor OR \"United Nations\")";
const HEALTH_KEY = "global-pulse:health:v1";
const NEWS_KEY_PREFIX = "global-pulse:news:v1:";
const UPDATE_INTERVAL_MS = 15 * 60 * 1000;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MIN_RETRY_INTERVAL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 25 * 1000;
const MIN_VALID_ARTICLES = 5;
const RETRY_DELAYS_MS = [5500, 11000];

function isoTime(now = Date.now()) {
  return new Date(now).toISOString();
}

function parseWindow(value) {
  return value === "1w" ? "1w" : "1d";
}

function snapshotKey(windowName) {
  return `${NEWS_KEY_PREFIX}${parseWindow(windowName)}`;
}

function jsonResponse(payload, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(payload), { ...init, headers });
}

function cacheRequest(key) {
  return new Request(`https://global-pulse-cache.internal/${encodeURIComponent(key)}`);
}

function edgeCacheStore() {
  const edgeCache = globalThis.caches?.default;
  if (!edgeCache) return null;
  return {
    kind: "edge-cache",
    async get(key) {
      const response = await edgeCache.match(cacheRequest(key));
      return response ? response.text() : null;
    },
    async put(key, value) {
      await edgeCache.put(cacheRequest(key), new Response(value, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=31536000",
        },
      }));
    },
  };
}

export function resolveStore(env) {
  if (env?.GLOBAL_PULSE_CACHE?.get && env?.GLOBAL_PULSE_CACHE?.put) {
    return { kind: "kv", get: env.GLOBAL_PULSE_CACHE.get.bind(env.GLOBAL_PULSE_CACHE), put: env.GLOBAL_PULSE_CACHE.put.bind(env.GLOBAL_PULSE_CACHE) };
  }
  return edgeCacheStore();
}

async function readJson(store, key) {
  if (!store) return null;
  try {
    const value = await store.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.warn(JSON.stringify({ event: "cache_read_failed", key, message: error?.message || String(error) }));
    return null;
  }
}

async function writeJson(store, key, value) {
  if (!store) return;
  await store.put(key, JSON.stringify(value));
}

function emptyHealth() {
  return {
    lastSuccessAt: null,
    lastFailureAt: null,
    lastAttemptAt: null,
    lastError: null,
    windows: {},
  };
}

export async function readHealth(env) {
  return { ...emptyHealth(), ...(await readJson(resolveStore(env), HEALTH_KEY) || {}) };
}

function gdeltUrl(windowName) {
  const params = new URLSearchParams({
    query: GDELT_QUERY,
    mode: "ArtList",
    maxrecords: windowName === "1w" ? "250" : "150",
    format: "json",
    sort: "HybridRel",
    timespan: windowName,
  });
  return `${GDELT_API}?${params}`;
}

function cleanText(value, limit = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function validHttpUrl(value) {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function sanitizeArticles(rawArticles) {
  const seen = new Set();
  const articles = [];
  for (const raw of Array.isArray(rawArticles) ? rawArticles : []) {
    const url = cleanText(raw?.url, 1800);
    const title = cleanText(raw?.title, 400);
    const seenDate = cleanText(raw?.seendate, 40);
    if (!title || !validHttpUrl(url) || !/^\d{8}T\d{6}Z$/.test(seenDate) || seen.has(url)) continue;
    seen.add(url);
    articles.push({
      url,
      url_mobile: validHttpUrl(raw?.url_mobile) ? cleanText(raw.url_mobile, 1800) : "",
      title,
      seendate: seenDate,
      socialimage: validHttpUrl(raw?.socialimage) ? cleanText(raw.socialimage, 1800) : "",
      domain: cleanText(raw?.domain, 255),
      language: cleanText(raw?.language, 80),
      sourcecountry: cleanText(raw?.sourcecountry, 120),
      summary: cleanText(raw?.summary || raw?.description || raw?.snippet, 900),
    });
  }
  return articles;
}

export function classifyError(error) {
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return "timeout";
  if (Number(error?.status) === 429) return "rate_limit";
  if (Number(error?.status) >= 500) return "upstream_5xx";
  if (Number(error?.status) >= 400) return "upstream_4xx";
  if (error?.name === "InvalidNewsPayloadError") return "invalid_data";
  return "network";
}

function retryable(error) {
  return ["rate_limit", "upstream_5xx", "timeout", "network"].includes(classifyError(error));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAttempt(windowName, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(gdeltUrl(windowName), {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "GLOBAL-PULSE/1.0 (+https://xiao-colours.zhuoxiaoting0524.workers.dev/global)",
      },
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(cleanText(text, 220) || `GDELT HTTP ${response.status}`);
      error.name = "GdeltResponseError";
      error.status = response.status;
      throw error;
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      const error = new Error("GDELT returned non-JSON content");
      error.name = "InvalidNewsPayloadError";
      throw error;
    }
    const rawCount = Array.isArray(payload?.articles) ? payload.articles.length : 0;
    const articles = sanitizeArticles(payload?.articles);
    if (articles.length < MIN_VALID_ARTICLES) {
      const error = new Error(`GDELT payload contained ${rawCount} raw and ${articles.length} valid articles`);
      error.name = "InvalidNewsPayloadError";
      error.rawCount = rawCount;
      error.validCount = articles.length;
      throw error;
    }
    return { articles, rawCount, validCount: articles.length };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGdeltWithRetry(windowName, {
  fetchImpl = fetch,
  sleepImpl = sleep,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return { ...(await fetchAttempt(windowName, fetchImpl)), attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (attempt >= RETRY_DELAYS_MS.length || !retryable(error)) break;
      await sleepImpl(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

async function writeFailureHealth(store, health, windowName, error, now) {
  const failure = {
    at: isoTime(now),
    type: classifyError(error),
    status: Number(error?.status) || null,
    message: cleanText(error?.message, 260) || "Unknown upstream error",
  };
  const next = {
    ...health,
    lastAttemptAt: failure.at,
    lastFailureAt: failure.at,
    lastError: failure,
    windows: {
      ...(health.windows || {}),
      [windowName]: {
        ...(health.windows?.[windowName] || {}),
        lastAttemptAt: failure.at,
        lastFailureAt: failure.at,
        lastError: failure,
      },
    },
  };
  await writeJson(store, HEALTH_KEY, next);
  console.error(JSON.stringify({ event: "news_refresh_failed", window: windowName, ...failure }));
  return next;
}

export async function refreshWindow(env, windowValue, {
  fetchImpl = fetch,
  sleepImpl = sleep,
  now = Date.now(),
} = {}) {
  const windowName = parseWindow(windowValue);
  const store = resolveStore(env);
  const health = { ...emptyHealth(), ...(await readJson(store, HEALTH_KEY) || {}) };
  const attemptAt = isoTime(now);
  await writeJson(store, HEALTH_KEY, {
    ...health,
    lastAttemptAt: attemptAt,
    windows: {
      ...(health.windows || {}),
      [windowName]: { ...(health.windows?.[windowName] || {}), lastAttemptAt: attemptAt },
    },
  });

  try {
    const result = await fetchGdeltWithRetry(windowName, { fetchImpl, sleepImpl });
    const snapshot = {
      version: 1,
      source: "gdelt",
      window: windowName,
      fetchedAt: isoTime(now),
      rawCount: result.rawCount,
      validCount: result.validCount,
      attempts: result.attempts,
      articles: result.articles,
    };
    await writeJson(store, snapshotKey(windowName), snapshot);
    const successHealth = {
      ...health,
      lastAttemptAt: attemptAt,
      lastSuccessAt: snapshot.fetchedAt,
      windows: {
        ...(health.windows || {}),
        [windowName]: {
          ...(health.windows?.[windowName] || {}),
          lastAttemptAt: attemptAt,
          lastSuccessAt: snapshot.fetchedAt,
          rawCount: result.rawCount,
          validCount: result.validCount,
          cacheCount: result.validCount,
          attempts: result.attempts,
        },
      },
    };
    await writeJson(store, HEALTH_KEY, successHealth);
    console.log(JSON.stringify({ event: "news_refresh_success", window: windowName, rawCount: result.rawCount, validCount: result.validCount, attempts: result.attempts }));
    return { snapshot, health: successHealth };
  } catch (error) {
    await writeFailureHealth(store, health, windowName, error, now);
    throw error;
  }
}

export function snapshotStatus(snapshot, now = Date.now()) {
  if (!snapshot?.fetchedAt) return "unavailable";
  const ageMs = Math.max(0, now - new Date(snapshot.fetchedAt).valueOf());
  if (ageMs <= UPDATE_INTERVAL_MS * 2) return "live";
  if (ageMs <= STALE_AFTER_MS) return "cache";
  return "stale";
}

function publicHealth(health, snapshot, requestedWindow, storeKind, now) {
  const fetchedAt = snapshot?.fetchedAt ? new Date(snapshot.fetchedAt).valueOf() : 0;
  const cacheAgeMs = fetchedAt ? Math.max(0, now - fetchedAt) : null;
  const windowHealth = health.windows?.[requestedWindow] || {};
  return {
    lastSuccessAt: windowHealth.lastSuccessAt || health.lastSuccessAt || null,
    lastFailureAt: windowHealth.lastFailureAt || health.lastFailureAt || null,
    lastError: windowHealth.lastError || health.lastError || null,
    rawCount: snapshot?.rawCount ?? windowHealth.rawCount ?? 0,
    validCount: snapshot?.validCount ?? windowHealth.validCount ?? 0,
    cacheCount: snapshot?.articles?.length || 0,
    cacheAgeMs,
    stale: cacheAgeMs === null ? true : cacheAgeMs > STALE_AFTER_MS,
    requestedWindow,
    storage: storeKind || "none",
  };
}

export async function getNewsPayload(env, requestedTime, {
  force = false,
  fetchImpl = fetch,
  sleepImpl = sleep,
  now = Date.now(),
  waitUntil,
} = {}) {
  const requestedWindow = parseWindow(requestedTime === "1h" ? "1d" : requestedTime);
  const store = resolveStore(env);
  let snapshot = await readJson(store, snapshotKey(requestedWindow));
  let health = { ...emptyHealth(), ...(await readJson(store, HEALTH_KEY) || {}) };
  const ageMs = snapshot?.fetchedAt ? now - new Date(snapshot.fetchedAt).valueOf() : Infinity;
  const lastAttempt = health.windows?.[requestedWindow]?.lastAttemptAt || health.lastAttemptAt;
  const canRetry = !lastAttempt || now - new Date(lastAttempt).valueOf() >= MIN_RETRY_INTERVAL_MS;
  let refreshFailed = false;

  if (!snapshot && canRetry) {
    try {
      const refreshed = await refreshWindow(env, requestedWindow, { fetchImpl, sleepImpl, now });
      snapshot = refreshed.snapshot;
      health = refreshed.health;
    } catch {
      refreshFailed = true;
      health = await readHealth(env);
    }
  } else if (snapshot && force && canRetry) {
    try {
      const refreshed = await refreshWindow(env, requestedWindow, { fetchImpl, sleepImpl, now });
      snapshot = refreshed.snapshot;
      health = refreshed.health;
    } catch {
      refreshFailed = true;
      health = await readHealth(env);
    }
  } else if (ageMs > UPDATE_INTERVAL_MS && canRetry && typeof waitUntil === "function") {
    waitUntil(refreshWindow(env, requestedWindow, { fetchImpl, sleepImpl, now }).catch(() => undefined));
  }

  if (!snapshot?.articles?.length) {
    return jsonResponse({
      status: "unavailable",
      articles: [],
      fetchedAt: null,
      health: publicHealth(health, null, requestedWindow, store?.kind, now),
    }, { status: 503 });
  }

  const ageStatus = snapshotStatus(snapshot, now);
  const lastFailureAt = health.windows?.[requestedWindow]?.lastFailureAt || health.lastFailureAt;
  const failedAfterSnapshot = Boolean(
    lastFailureAt
    && new Date(lastFailureAt).valueOf() > new Date(snapshot.fetchedAt).valueOf()
  );
  return jsonResponse({
    status: (refreshFailed || failedAfterSnapshot) && ageStatus === "live" ? "cache" : ageStatus,
    articles: snapshot.articles,
    fetchedAt: snapshot.fetchedAt,
    health: publicHealth(health, snapshot, requestedWindow, store?.kind, now),
  });
}

export async function getHealthPayload(env, now = Date.now()) {
  const store = resolveStore(env);
  const health = await readHealth(env);
  const day = await readJson(store, snapshotKey("1d"));
  const week = await readJson(store, snapshotKey("1w"));
  return jsonResponse({
    status: day || week ? "ok" : "unavailable",
    generatedAt: isoTime(now),
    storage: store?.kind || "none",
    windows: {
      "1d": day ? { fetchedAt: day.fetchedAt, status: snapshotStatus(day, now), rawCount: day.rawCount, validCount: day.validCount, cacheCount: day.articles.length } : null,
      "1w": week ? { fetchedAt: week.fetchedAt, status: snapshotStatus(week, now), rawCount: week.rawCount, validCount: week.validCount, cacheCount: week.articles.length } : null,
    },
    lastSuccessAt: health.lastSuccessAt,
    lastFailureAt: health.lastFailureAt,
    lastError: health.lastError,
  }, { status: day || week ? 200 : 503 });
}

export const workerConstants = {
  UPDATE_INTERVAL_MS,
  STALE_AFTER_MS,
  MIN_RETRY_INTERVAL_MS,
  MIN_VALID_ARTICLES,
};
