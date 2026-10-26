import { CATEGORY_CONFIG } from "./config.js";
import {
  categoryLabel,
  escapeHtml,
  fullDateTime,
  priorityScore,
  relativeTime,
  uniqueValues,
} from "./utils.js";
import { newsDetailHref } from "./news-reader.js";

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

function knownCountry(country) {
  return country && country !== "来源地未知" ? country : "";
}

function sourceMeta(article, { includeCategory = false } = {}) {
  const displayDate = article.eventUpdatedAt || article.publishedAt;
  const parts = [
    `<span class="gp-news-card__source">${escapeHtml(article.source)}</span>`,
    includeCategory ? `<span>${escapeHtml(categoryLabel(article.category))}</span>` : "",
    knownCountry(article.country) ? `<span>媒体来源国 ${escapeHtml(article.country)}</span>` : "",
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

function hasChineseText(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ""));
}

function displayTitle(article) {
  return article.translatedTitle || article.title;
}

function languageNotice(article) {
  if (article.translatedTitle) return "中文译文 · 保留原文";
  if (!hasChineseText(article.title)) return "未接入翻译 · 显示原文";
  return "中文原文";
}

function factualEventSummary(article) {
  if (article.summary) return conciseText(article.summary);
  if (article.sourceCount > 1) {
    return `该事件已聚合 ${article.sourceCount} 个独立媒体来源；页面保留每条原始报道供交叉查看。`;
  }
  return `来自 ${article.source} 的报道。当前数据源未提供正文摘要，请通过原始链接阅读全文。`;
}

function relatedSourcesMarkup(article) {
  const sources = article.relatedSources?.length ? article.relatedSources : [{
    title: article.originalTitle || article.title,
    url: article.url,
    source: article.source,
    publishedAt: article.publishedAt,
  }];
  const detailUrl = newsDetailHref(article, "#gp-sources");
  return `
    <details class="gp-top-five-card__sources">
      <summary>查看 ${sources.length} 条原始报道</summary>
      <ul>
        ${sources.map((source) => `
          <li>
            <a href="${escapeHtml(detailUrl)}">
              <strong>${escapeHtml(source.source)}</strong>
              <span>${escapeHtml(conciseText(source.title, 92))}</span>
            </a>
            <time>${escapeHtml(relativeTime(source.publishedAt))}</time>
          </li>`).join("")}
      </ul>
    </details>`;
}

export function TopFiveCard(article, rank) {
  const size = rank === 1 ? "lead" : rank <= 3 ? "medium" : "compact";
  const cardClass = `gp-top-five-card gp-top-five-card--${size}${article.image ? "" : " no-image"}`;
  const visibleTitle = displayTitle(article);
  // Direct link to original source if available
  const originalUrl = article.url || newsDetailHref(article);
  const summary = size === "lead" && article.summary
    ? `<p class="gp-top-five-card__summary">${escapeHtml(conciseText(article.summary, 132))}</p>`
    : "";
  return `
    <article class="${cardClass}">
      <a class="gp-top-five-card__media" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer" aria-label="打开原文：${escapeHtml(article.title)}">${imageMarkup(article, { eager: rank === 1 })}</a>
      <span class="gp-top-five-card__rank" aria-label="第 ${rank} 名">${String(rank).padStart(2, "0")}</span>
      <div class="gp-top-five-card__content">
        <div class="gp-top-five-card__eyebrow">
          <span class="gp-badge">${escapeHtml(categoryLabel(article.category))}</span>
          <span class="gp-top-five-card__language">${escapeHtml(languageNotice(article))}</span>
        </div>
        <h3><a href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(visibleTitle)}</a></h3>
        ${article.translatedTitle ? `<p class="gp-top-five-card__original" lang="auto">原文：${escapeHtml(article.title)}</p>` : ""}
        ${summary}
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
}

export function NewsDetail(article) {
  const relatedSources = article.relatedSources?.length ? article.relatedSources : [{
    title: article.originalTitle || article.title,
    url: article.url,
    source: article.source,
    country: article.country,
    language: article.language,
    publishedAt: article.publishedAt,
  }];
  const summary = relatedSources.length > 1
    ? `查看 ${relatedSources.length} 条关联报道`
    : "查看数据详情";
  const detailUrl = newsDetailHref(article, "#gp-sources");
  return `
    <details>
      <summary>${summary}</summary>
      <div class="gp-news-detail">
        <p><b>原始标题</b>${escapeHtml(article.originalTitle || article.title)}</p>
        <p><b>数据说明</b>GDELT 当前提供标题与新闻元数据，页面未使用翻译服务补写标题或正文摘要。</p>
        <ul class="gp-related-sources">
          ${relatedSources.map((source) => `
            <li>
              <a href="${escapeHtml(detailUrl)}">${escapeHtml(source.source)}</a>
              <span>${knownCountry(source.country) ? `媒体来源国 ${escapeHtml(source.country)} · ` : ""}${escapeHtml(fullDateTime(source.publishedAt))}</span>
              ${source.title !== article.title ? `<small>${escapeHtml(source.title)}</small>` : ""}
            </li>`).join("")}
        </ul>
      </div>
    </details>`;
}

export function NewsCard(article) {
  const visibleTitle = displayTitle(article);
  // Direct link to the original source
  const originalUrl = article.url || newsDetailHref(article);
  return `
    <article class="gp-news-card${article.image ? "" : " no-image"}">
      <div class="gp-news-card__media">${imageMarkup(article)}</div>
      <div class="gp-news-card__body">
        <div class="gp-news-card__meta">${sourceMeta(article)}</div>
        <span class="gp-badge">${escapeHtml(categoryLabel(article.category))}</span>
        <h3><a class="gp-news-card__title" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(visibleTitle)}</a></h3>
        <!-- Simplified: no internal summary or analysis -->
        <div class="gp-news-card__footer">
          <span>${escapeHtml(article.translatedTitle ? "中文译文 · 保留原文" : hasChineseText(article.title) ? "中文原文" : `未接入翻译 · ${article.language} 原文`)}</span>
          <a href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">打开原文 →</a>
        </div>
      </div>
    </article>`;
}
  

export function DailyBrief(container, topEvents, { availableCount = 0, dataStatus = "live" } = {}) {
  container.dataset.count = String(topEvents.length);
  if (!topEvents.length) {
    const stale = ["stale", "seed"].includes(dataStatus);
    container.innerHTML = `<p class="gp-related-empty">${stale
      ? "今日数据不可用，因此不生成今日简报；历史缓存不会冒充实时分析。"
      : availableCount > 0
        ? `最近24小时有 ${availableCount} 条普通新闻，但没有事件通过重大级别门槛。这里不会把普通摘要冒充为 AI 分析。`
        : "最近24小时没有可用于简报的新闻。这里不会把旧内容冒充为今日分析。"}</p>`;
    return;
  }

  container.innerHTML = topEvents.map((article, index) => `
    <article class="gp-daily-brief__item">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <div>
        <h3><a href="${escapeHtml(newsDetailHref(article))}">${escapeHtml(article.title)}</a></h3>
        <p>${escapeHtml(article.importance?.attentionNote || factualEventSummary(article))}</p>
        <small>${escapeHtml(article.source)} · ${escapeHtml(relativeTime(article.eventUpdatedAt || article.publishedAt))} · ${article.sourceCount || 1} 个媒体来源</small>
      </div>
    </article>`).join("");
}

export function WorldBrief(container, articles) {
  const sources = uniqueValues(articles.flatMap((article) => {
    return article.relatedSources?.map((source) => source.source) || [article.source];
  }));
  const regions = uniqueValues(articles.flatMap((article) => {
    return article.countries?.length ? article.countries : [article.country];
  }).filter((country) => country !== "来源地未知"));
  container.innerHTML = `
    <div><strong>${articles.length}</strong><span>事件</span></div>
    <div><strong>${sources.length}</strong><span>媒体</span></div>
    <div><strong>${regions.length}</strong><span>地区</span></div>`;
}

export function MajorEvents(container, articles) {
  const important = articles
    .map((article) => ({ article, score: priorityScore(article) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.article.eventUpdatedAt?.valueOf() || b.article.publishedAt?.valueOf() || 0) - (a.article.eventUpdatedAt?.valueOf() || a.article.publishedAt?.valueOf() || 0))
    .slice(0, 5);

  if (!important.length) {
    container.innerHTML = '<div class="gp-major-event"><span class="gp-major-event__dot"></span><div><h4>当前范围内没有触发重点事件关键词的新闻</h4><p>这是规则结果，不代表全球没有重大事件。</p></div></div>';
    return;
  }

  container.innerHTML = important.map(({ article, score }) => `
    <article class="gp-major-event">
      <span class="gp-major-event__dot${score === 2 ? " is-critical" : ""}" aria-hidden="true"></span>
      <div>
        <h4><a href="${escapeHtml(newsDetailHref(article))}">${escapeHtml(article.title)}</a></h4>
        <p>${escapeHtml(article.source)} · ${knownCountry(article.country) ? `${escapeHtml(article.country)} · ` : ""}${escapeHtml(relativeTime(article.publishedAt))}</p>
      </div>
    </article>`).join("");
}

export function RelatedCoverage(container, articles) {
  const multiSource = articles
    .filter((article) => article.sourceCount > 1)
    .sort((a, b) => b.sourceCount - a.sourceCount || (b.publishedAt?.valueOf() || 0) - (a.publishedAt?.valueOf() || 0))
    .slice(0, 3);

  if (!multiSource.length) {
    container.innerHTML = '<p class="gp-related-empty">当前载入范围内暂未识别到可靠的多来源事件聚合。</p>';
    return;
  }

  container.innerHTML = multiSource.map((article) => `
    <details class="gp-related-event">
      <summary>
        <span>${escapeHtml(article.title)}</span>
        <small>${article.sourceCount} 个媒体来源</small>
      </summary>
      <ul>
        ${article.relatedSources.map((source) => `
          <li><a href="${escapeHtml(newsDetailHref(article, "#gp-sources"))}">${escapeHtml(source.source)} · 站内查看</a></li>`).join("")}
      </ul>
    </details>`).join("");
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
