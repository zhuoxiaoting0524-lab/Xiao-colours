import {
  CATEGORY_CONFIG,
  CLASSIFICATION_RULES,
  HIGH_PRIORITY,
  MEDIUM_PRIORITY,
  TIME_WINDOWS,
} from "./config.js";

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((key) => {
      parsed.searchParams.delete(key);
    });
    return parsed.toString();
  } catch {
    return url;
  }
}

export function safeImageUrl(url) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function parseGdeltDate(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
}

export function relativeTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return "时间未知";
  const minutes = Math.max(0, Math.round((Date.now() - date.valueOf()) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}

export function fullDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return "时间未知";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function classifyTitle(title) {
  return CLASSIFICATION_RULES.find(([, pattern]) => pattern.test(title))?.[0] || "international";
}

export function categoryLabel(category) {
  return CATEGORY_CONFIG[category]?.label || CATEGORY_CONFIG.international.label;
}

export function priorityScore(article) {
  if (HIGH_PRIORITY.test(article.title)) return 2;
  if (MEDIUM_PRIORITY.test(article.title)) return 1;
  return 0;
}

export function safeSearchTerm(value) {
  return String(value || "").replace(/[()"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function filterArticles(articles, filters) {
  const search = safeSearchTerm(filters.search).toLocaleLowerCase();
  const windowMs = TIME_WINDOWS[filters.time] || TIME_WINDOWS["1d"];
  const threshold = Date.now() - windowMs;

  return articles.filter((article) => {
    const categoryMatches = filters.category === "all" || article.category === filters.category;
    const regionMatches = filters.region === "all" || article.country === filters.region;
    const searchMatches = !search || `${article.title} ${article.source} ${article.country} ${categoryLabel(article.category)}`
      .toLocaleLowerCase()
      .includes(search);
    const timeMatches = !article.publishedAt || article.publishedAt.valueOf() >= threshold;
    return categoryMatches && regionMatches && searchMatches && timeMatches;
  });
}

export function debounce(callback, delay = 220) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}

export function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}
