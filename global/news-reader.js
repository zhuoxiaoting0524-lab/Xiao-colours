import {
  GDELT_CONTEXT_API,
  READER_CACHE_KEY,
} from "./config.js";
import { fetchGdeltJson } from "./gdelt-client.js";
import { scoreNewsImportance } from "./news-quality.js";
import { canonicalUrl, parseGdeltDate } from "./utils.js";

const CONTEXT_CACHE_TTL_MS = 30 * 60 * 1000;
const QUERY_STOP_WORDS = new Set([
  "about", "after", "again", "amid", "among", "and", "are", "breaking", "could", "from",
  "global", "have", "into", "latest", "major", "more", "news", "over", "report", "says",
  "that", "their", "this", "through", "update", "what", "when", "where", "which", "with",
  "world", "would",
]);
const ENTITY_TOKENS = new Set([
  "america", "american", "biden", "china", "chinese", "eu", "europe", "european", "france",
  "gaza", "germany", "india", "iran", "israel", "japan", "nato", "palestine", "putin", "russia",
  "russian", "sudan", "trump", "uk", "ukraine", "ukrainian", "un", "us", "yemen", "zelensky",
]);
const EVENT_TOKENS = new Set([
  "airstrike", "casualties", "ceasefire", "earthquake", "election", "flood", "hurricane", "inflation",
  "invasion", "missile", "sanction", "sanctions", "summit", "tariff", "tariffs", "war", "wildfire",
]);

function cleanText(value, limit = 900) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function contextQuery(article) {
  const candidates = [
    ...(article.relatedSources || []).filter((source) => /english/i.test(source.language || "")),
    article,
  ];
  const title = candidates.find((item) => /^[\x00-\x7F]+$/.test(item.title || ""))?.title || "";
  if (!title) return "";
  const tokens = title.match(/[A-Za-z][A-Za-z'-]{2,}/g) || [];
  const unique = [];
  tokens.forEach((token) => {
    const normalized = token.toLocaleLowerCase().replace(/^['-]+|['-]+$/g, "");
    if ((normalized.length < 3 && !ENTITY_TOKENS.has(normalized)) || QUERY_STOP_WORDS.has(normalized) || unique.includes(normalized)) return;
    unique.push(normalized);
  });
  const selected = [
    ...unique.filter((token) => ENTITY_TOKENS.has(token)).slice(0, 2),
    ...unique.filter((token) => EVENT_TOKENS.has(token)).slice(0, 1),
  ];
  unique.forEach((token) => {
    if (selected.length < 2 && !selected.includes(token)) selected.push(token);
  });
  return selected.slice(0, 3).join(" ");
}

function readContextCache(eventId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(READER_CACHE_KEY) || "{}");
    const entry = parsed[eventId];
    if (!entry || Date.now() - entry.cachedAt > CONTEXT_CACHE_TTL_MS) return null;
    return {
      ...entry.payload,
      contexts: (entry.payload.contexts || []).map((context) => ({
        ...context,
        publishedAt: context.publishedAt ? new Date(context.publishedAt) : null,
      })),
    };
  } catch {
    return null;
  }
}

function writeContextCache(eventId, payload) {
  try {
    const parsed = JSON.parse(localStorage.getItem(READER_CACHE_KEY) || "{}") || {};
    parsed[eventId] = { cachedAt: Date.now(), payload };
    const entries = Object.entries(parsed)
      .sort((left, right) => right[1].cachedAt - left[1].cachedAt)
      .slice(0, 12);
    localStorage.setItem(READER_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Reader context remains optional when storage is unavailable.
  }
}

function normalizeContexts(rawArticles) {
  const grouped = new Map();
  (Array.isArray(rawArticles) ? rawArticles : []).forEach((raw) => {
    const url = canonicalUrl(String(raw.url || ""));
    const context = cleanText(raw.context || raw.sentence);
    if (!/^https?:\/\//i.test(url) || !context) return;
    const key = context.toLocaleLowerCase();
    const source = String(raw.domain || new URL(url).hostname).replace(/^www\./, "");
    if (grouped.has(key)) {
      const existing = grouped.get(key);
      if (!existing.outlets.includes(source)) existing.outlets.push(source);
      return;
    }
    grouped.set(key, {
      title: cleanText(raw.title, 240),
      sentence: cleanText(raw.sentence, 420),
      context,
      url,
      source,
      outlets: [source],
      language: cleanText(raw.language, 40),
      publishedAt: parseGdeltDate(raw.seendate),
    });
  });
  return [...grouped.values()].slice(0, 6);
}

export function newsDetailHref(article, fragment = "") {
  const id = article.eventId || article.id;
  const url = new URL("./news.html", import.meta.url);
  url.searchParams.set("id", id);
  url.hash = fragment.replace(/^#/, "");
  return url.toString();
}

export function findEventById(articles, eventId) {
  return (articles || []).find((article) => article.eventId === eventId || article.id === eventId) || null;
}

export function eventImportance(article) {
  return article.importance || scoreNewsImportance(article);
}

export async function loadEventContext(article, { force = false, signal } = {}) {
  if (!force) {
    const cached = readContextCache(article.eventId);
    if (cached) return { ...cached, source: "cache" };
  }
  const query = contextQuery(article);
  if (!query) return { query: "", contexts: [], source: "unsupported-language", fetchedAt: null };

  const params = new URLSearchParams({
    query,
    mode: "artlist",
    maxrecords: "24",
    format: "json",
    sort: "HybridRel",
    timespan: "72h",
  });
  const response = await fetchGdeltJson(`${GDELT_CONTEXT_API}?${params}`, signal);
  const payload = {
    query,
    contexts: normalizeContexts(response.articles),
    source: "live",
    fetchedAt: new Date().toISOString(),
  };
  writeContextCache(article.eventId, payload);
  return payload;
}
