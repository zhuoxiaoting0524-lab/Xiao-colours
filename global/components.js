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

function knownCountry(country) {
  return country && country !== "来源地未知" ? country : "";
}

function sourceMeta(article, { includeCategory = false } = {}) {
  const parts = [
    `<span class="gp-news-card__source">${escapeHtml(article.source)}</span>`,
    includeCategory ? `<span>${escapeHtml(categoryLabel(article.category))}</span>` : "",
    knownCountry(article.country) ? `<span>媒体来源国 ${escapeHtml(article.country)}</span>` : "",
    `<time datetime="${article.publishedAt?.toISOString() || ""}" title="${escapeHtml(fullDateTime(article.publishedAt))}">${escapeHtml(relativeTime(article.publishedAt))}</time>`,
    article.sourceCount > 1 ? `<span>${article.sourceCount} 个媒体来源</span>` : "",
  ].filter(Boolean);
  return parts.join("");
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
        <div class="gp-featured-card__meta">${sourceMeta(article)}</div>
      </div>
    </article>`;
}

export function TopStories(container, articles) {
  if (!articles.length) {
    container.innerHTML = '<div class="gp-empty-state"><p><strong>暂无焦点新闻</strong>请更换筛选条件或稍后刷新。</p></div>';
    return;
  }

  const uniqueEvents = [...new Map(articles.map((article) => [article.eventId || article.url, article])).values()];
  const stories = uniqueEvents
    .sort((a, b) => {
      const scoreDifference = (priorityScore(b) + Number(Boolean(b.image))) - (priorityScore(a) + Number(Boolean(a.image)));
      return scoreDifference || (b.eventUpdatedAt?.valueOf() || b.publishedAt?.valueOf() || 0) - (a.eventUpdatedAt?.valueOf() || a.publishedAt?.valueOf() || 0);
    })
    .slice(0, 3);

  container.innerHTML = stories.map((article, index) => FeaturedNewsCard(article, { lead: index === 0 })).join("");
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
  return `
    <details>
      <summary>${summary}</summary>
      <div class="gp-news-detail">
        <p><b>原始标题</b>${escapeHtml(article.originalTitle || article.title)}</p>
        <p><b>数据说明</b>GDELT 当前提供标题与新闻元数据，页面未使用翻译服务补写标题或正文摘要。</p>
        <ul class="gp-related-sources">
          ${relatedSources.map((source) => `
            <li>
              <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.source)}</a>
              <span>${knownCountry(source.country) ? `媒体来源国 ${escapeHtml(source.country)} · ` : ""}${escapeHtml(fullDateTime(source.publishedAt))}</span>
              ${source.title !== article.title ? `<small>${escapeHtml(source.title)}</small>` : ""}
            </li>`).join("")}
        </ul>
      </div>
    </details>`;
}

export function NewsCard(article) {
  return `
    <article class="gp-news-card${article.image ? "" : " no-image"}">
      <div class="gp-news-card__media">${imageMarkup(article)}</div>
      <div class="gp-news-card__body">
        <div class="gp-news-card__meta">${sourceMeta(article)}</div>
        <span class="gp-badge">${escapeHtml(categoryLabel(article.category))}</span>
        <h3><a class="gp-news-card__title" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a></h3>
        <p class="gp-news-card__context">${article.sourceCount > 1 ? `该事件已聚合 ${article.sourceCount} 个媒体来源。` : "页面展示原始新闻标题与可验证元数据。"}完整内容请以原始报道为准。</p>
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
  const sources = uniqueValues(articles.flatMap((article) => {
    return article.relatedSources?.map((source) => source.source) || [article.source];
  }));
  const regions = uniqueValues(articles.flatMap((article) => {
    return article.countries?.length ? article.countries : [article.country];
  }).filter((country) => country !== "来源地未知"));
  container.innerHTML = `
    <div><strong>${articles.length}</strong><span>新闻</span></div>
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
        <h4><a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a></h4>
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
          <li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.source)} ↗</a></li>`).join("")}
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
