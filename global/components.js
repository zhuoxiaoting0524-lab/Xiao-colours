import { CATEGORY_CONFIG } from "./config.js";
import {
  categoryLabel,
  escapeHtml,
  fullDateTime,
  priorityScore,
  relativeTime,
  uniqueValues,
} from "./utils.js";

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
      image.closest(".gp-featured-card, .gp-news-card")?.classList.add("no-image");
      image.remove();
    }, { once: true });
  });
}

export function FeaturedNewsCard(article, { lead = false } = {}) {
  const cardClass = `gp-featured-card${lead ? " gp-featured-card--lead" : ""}${article.image ? "" : " no-image"}`;
  return `
    <article class="${cardClass}">
      <a class="gp-featured-card__link" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer" aria-label="阅读原始报道：${escapeHtml(article.title)}"></a>
      <div class="gp-featured-card__media">${imageMarkup(article, { eager: lead })}</div>
      <div class="gp-featured-card__content">
        <span class="gp-badge">${escapeHtml(categoryLabel(article.category))}</span>
        <h3>${escapeHtml(article.title)}</h3>
        <div class="gp-featured-card__meta">
          <span class="gp-featured-card__source">${escapeHtml(article.source)}</span>
          <span>${escapeHtml(article.country)}</span>
          <time datetime="${article.publishedAt?.toISOString() || ""}" title="${escapeHtml(fullDateTime(article.publishedAt))}">${escapeHtml(relativeTime(article.publishedAt))}</time>
        </div>
      </div>
    </article>`;
}

export function TopStories(container, articles) {
  if (!articles.length) {
    container.innerHTML = '<div class="gp-empty-state"><p><strong>暂无焦点新闻</strong>请更换筛选条件或稍后刷新。</p></div>';
    return;
  }

  const stories = [...articles]
    .sort((a, b) => {
      const scoreDifference = (priorityScore(b) + Number(Boolean(b.image))) - (priorityScore(a) + Number(Boolean(a.image)));
      return scoreDifference || (b.publishedAt?.valueOf() || 0) - (a.publishedAt?.valueOf() || 0);
    })
    .slice(0, 3);

  container.innerHTML = stories.map((article, index) => FeaturedNewsCard(article, { lead: index === 0 })).join("");
  bindImageFallbacks(container);
}

export function NewsDetail(article) {
  return `
    <details>
      <summary>查看数据详情</summary>
      <p>媒体来源国：${escapeHtml(article.country)} · 原文语言：${escapeHtml(article.language)} · 发布时间：${escapeHtml(fullDateTime(article.publishedAt))}。GDELT 当前只提供标题与元数据，完整内容请以原始报道为准。</p>
    </details>`;
}

export function NewsCard(article) {
  return `
    <article class="gp-news-card${article.image ? "" : " no-image"}">
      <div class="gp-news-card__media">${imageMarkup(article)}</div>
      <div class="gp-news-card__body">
        <div class="gp-news-card__meta">
          <span class="gp-news-card__source">${escapeHtml(article.source)}</span>
          <span>${escapeHtml(article.country)}</span>
          <time datetime="${article.publishedAt?.toISOString() || ""}" title="${escapeHtml(fullDateTime(article.publishedAt))}">${escapeHtml(relativeTime(article.publishedAt))}</time>
        </div>
        <span class="gp-badge">${escapeHtml(categoryLabel(article.category))}</span>
        <h3><a class="gp-news-card__title" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a></h3>
        <p class="gp-news-card__context">来自 ${escapeHtml(article.source)} 的最新报道。页面仅展示可验证的新闻元数据，不自动补写正文摘要。</p>
        <div class="gp-news-card__footer">
          <span>${escapeHtml(article.language)}</span>
          <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a>
        </div>
      </div>
      ${NewsDetail(article)}
    </article>`;
}

export function NewsFeed(container, articles) {
  if (!articles.length) {
    container.innerHTML = '<div class="gp-empty-state"><p><strong>没有找到匹配内容</strong>请调整关键词、地区、分类或时间范围。</p></div>';
    return;
  }
  container.innerHTML = articles.map(NewsCard).join("");
  bindImageFallbacks(container);
}

export function WorldBrief(container, articles) {
  const sources = uniqueValues(articles.map((article) => article.source));
  const regions = uniqueValues(articles.map((article) => article.country).filter((country) => country !== "来源地未知"));
  container.innerHTML = `
    <div><strong>${articles.length}</strong><span>新闻</span></div>
    <div><strong>${sources.length}</strong><span>媒体</span></div>
    <div><strong>${regions.length}</strong><span>地区</span></div>`;
}

export function MajorEvents(container, articles) {
  const important = articles
    .map((article) => ({ article, score: priorityScore(article) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.article.publishedAt?.valueOf() || 0) - (a.article.publishedAt?.valueOf() || 0))
    .slice(0, 5);

  if (!important.length) {
    container.innerHTML = '<div class="gp-major-event"><span class="gp-major-event__dot"></span><div><h4>当前范围内没有触发重点事件关键词的新闻</h4><p>这是规则结果，不代表全球没有重大事件。</p></div></div>';
    return;
  }

  container.innerHTML = important.map(({ article, score }) => `
    <article class="gp-major-event">
      <span class="gp-major-event__dot${score === 2 ? " is-critical" : ""}" aria-hidden="true"></span>
      <div>
        <h4><a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a></h4>
        <p>${escapeHtml(article.source)} · ${escapeHtml(relativeTime(article.publishedAt))}</p>
      </div>
    </article>`).join("");
}

export function NewsFilters(regionSelect, articles, selectedRegion = "all") {
  const regions = uniqueValues(articles.map((article) => article.country))
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
  const prefix = source === "live" ? "实时更新" : "缓存时间";
  element.textContent = `${prefix} ${fullDateTime(fetchedAt)}`;
  element.title = fetchedAt.toISOString();
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
