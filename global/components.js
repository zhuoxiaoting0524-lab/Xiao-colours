import { CATEGORY_CONFIG } from "./config.js";
import {
  categoryLabel,
  escapeHtml,
  fullDateTime,
  relativeTime,
  safeNewsUrl,
  uniqueValues,
} from "./utils.js";

function originalNewsUrl(article) {
  return safeNewsUrl(article?.url)
    || article?.relatedSources?.map((source) => safeNewsUrl(source.url)).find(Boolean)
    || "";
}

function imageMarkup(article, { eager = false } = {}) {
  if (!article.image) return "";
  return `<img
    src="${escapeHtml(article.image)}"
    alt=""
    ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'}
    decoding="async"
    referrerpolicy="no-referrer"
    data-gp-news-image
  />`;
}

function bindImageFallbacks(container) {
  container.querySelectorAll("[data-gp-news-image]").forEach((image) => {
    image.addEventListener("error", () => {
      image.closest(".gp-featured-card, .gp-top-five-card, .gp-news-card")?.classList.add("no-image");
      image.remove();
    }, { once: true });
  });
}

function sourceMeta(article) {
  const displayDate = article.eventUpdatedAt || article.publishedAt;
  const parts = [
    `<span class="gp-news-card__source">${escapeHtml(article.source)}</span>`,
    `<time datetime="${displayDate?.toISOString() || ""}" title="${escapeHtml(fullDateTime(displayDate))}">${escapeHtml(relativeTime(displayDate))}</time>`,
    article.sourceCount > 1 ? `<span>${article.sourceCount} 个媒体来源</span>` : "",
  ].filter(Boolean);
  return parts.join("");
}

function conciseText(value, limit = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}…`;
}

function relatedSourcesMarkup(article) {
  const primaryUrl = originalNewsUrl(article);
  const sources = (article.relatedSources || [])
    .map((source) => ({ ...source, url: safeNewsUrl(source.url) }))
    .filter((source) => source.url && source.url !== primaryUrl);
  if (!sources.length) return "";
  return `
    <details class="gp-top-five-card__sources">
      <summary>其他媒体报道（${sources.length}）</summary>
      <ul>
        ${sources.map((source) => `
          <li>
            <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">
              <strong>${escapeHtml(source.source)}</strong>
              <span>${escapeHtml(conciseText(source.title, 92))}</span>
            </a>
            <time>${escapeHtml(relativeTime(source.publishedAt))}</time>
          </li>`).join("")}
      </ul>
    </details>`;
}

function bindCardNavigation(container) {
  container.querySelectorAll("[data-gp-news-url]").forEach((card) => {
    const open = () => {
      const url = safeNewsUrl(card.dataset.gpNewsUrl);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    };
    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button, summary, details")) return;
      open();
    });
    card.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !event.target.closest("a, button, summary")) {
        event.preventDefault();
        open();
      }
    });
  });
}

export function TopFiveCard(article, rank) {
  const size = rank === 1 ? "lead" : rank <= 3 ? "medium" : "compact";
  const cardClass = `gp-top-five-card gp-top-five-card--${size}${article.image ? "" : " no-image"}`;
  const originalUrl = originalNewsUrl(article);
  if (!originalUrl) return "";
  return `
    <article class="${cardClass} is-clickable" data-gp-news-url="${escapeHtml(originalUrl)}" tabindex="0" role="link" aria-label="打开原文：${escapeHtml(article.title)}">
      <a class="gp-top-five-card__media" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer" aria-label="打开原文：${escapeHtml(article.title)}">${imageMarkup(article, { eager: rank === 1 })}</a>
      <span class="gp-top-five-card__rank" aria-label="第 ${rank} 名">${String(rank).padStart(2, "0")}</span>
      <div class="gp-top-five-card__content">
        <div class="gp-top-five-card__eyebrow">
          <span class="gp-badge">${escapeHtml(categoryLabel(article.category))}</span>
        </div>
        <h3><a href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a></h3>
        <div class="gp-featured-card__meta">${sourceMeta(article)}</div>
        ${relatedSourcesMarkup(article)}
      </div>
    </article>`;
}

export function TodayTopFive(container, topEvents, { availableCount = 0, dataStatus = "live" } = {}) {
  container.dataset.count = String(topEvents.length);
  if (!topEvents.length) {
    const stale = ["stale", "seed"].includes(dataStatus);
    const title = stale
      ? "今日实时数据暂不可用"
      : availableCount > 0 ? "当前没有新闻通过重大事件门槛" : "最近24小时暂无可用新闻";
    const detail = stale
      ? "过期缓存不会进入今日 TOP 5；历史新闻已移至独立区域。"
      : availableCount > 0
        ? `最近24小时仍有 ${availableCount} 条普通真实新闻，可在下方继续浏览。`
        : "系统不会使用旧新闻或虚构内容补足五条。";
    container.innerHTML = `<div class="gp-empty-state gp-empty-state--compact"><p><strong>${escapeHtml(title)}</strong>${escapeHtml(detail)}</p></div>`;
    return;
  }
  container.innerHTML = topEvents.map((article, index) => TopFiveCard(article, index + 1)).join("");
  bindImageFallbacks(container);
  bindCardNavigation(container);
}

export function NewsCard(article) {
  const originalUrl = originalNewsUrl(article);
  if (!originalUrl) return "";
  return `
    <article class="gp-news-card${article.image ? "" : " no-image"} is-clickable" data-gp-news-url="${escapeHtml(originalUrl)}" tabindex="0" role="link" aria-label="打开原文：${escapeHtml(article.title)}">
      <a class="gp-news-card__media" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer" aria-label="打开原文：${escapeHtml(article.title)}">${imageMarkup(article)}</a>
      <div class="gp-news-card__body">
        <div class="gp-news-card__meta">${sourceMeta(article)}</div>
        <span class="gp-badge">${escapeHtml(categoryLabel(article.category))}</span>
        <h3><a class="gp-news-card__title" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a></h3>
        <div class="gp-news-card__footer">
          <a href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">打开原文 →</a>
        </div>
      </div>
    </article>`;
}
  

export function NewsFilters(regionSelect, articles, selectedRegion = "all") {
  const regions = uniqueValues(articles.map((article) => article.country))
    .concat(uniqueValues(articles.flatMap((article) => article.countries || [])))
    .filter((region, index, array) => array.indexOf(region) === index)
    .filter((region) => region !== "来源地未知")
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  regionSelect.innerHTML = '<option value="all">全球地区</option>' + regions
    .map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`)
    .join("");
  regionSelect.value = regions.includes(selectedRegion) ? selectedRegion : "all";
}

export function LastUpdatedIndicator(element, fetchedAt, source) {
  if (!fetchedAt) {
    element.textContent = "尚未更新";
    return;
  }
  const prefix = source === "live" ? "实时更新"
    : ["stale", "seed"].includes(source) ? "历史缓存时间"
      : "缓存时间";
  element.textContent = `${prefix} ${fullDateTime(fetchedAt)}`;
  element.title = fetchedAt.toISOString();
}

// Simple news feed renderer – displays a list of news cards
export function NewsFeed(container, articles) {
  if (!Array.isArray(articles) || articles.length === 0) {
    container.innerHTML = `
      <div class="gp-empty-state">
        <p><strong>暂无新闻</strong>请稍后再试。</p>
      </div>`;
    return;
  }
  // Use existing NewsCard component for each article
  container.innerHTML = articles.map(NewsCard).join("");
  bindImageFallbacks(container);
  bindCardNavigation(container);
}

export function ThemeToggle(button, theme) {
  const isLight = theme === "light";
  button.setAttribute("aria-pressed", String(isLight));
  button.setAttribute("aria-label", isLight ? "切换为深色模式" : "切换为浅色模式");
}

export function GlobalPulseHeader({ statusText, statusDot, message, type = "live" }) {
  statusText.textContent = message;
  statusDot.className = "gp-live-dot";
  if (type !== "live") statusDot.classList.add(`is-${type}`);
}

export function categoryExists(category) {
  return Boolean(CATEGORY_CONFIG[category]);
}
