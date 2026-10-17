import { GlobalPulseDataService } from "./data-service.js";
import {
  eventImportance,
  findEventById,
  loadEventContext,
  newsDetailHref,
} from "./news-reader.js";
import {
  categoryLabel,
  escapeHtml,
  fullDateTime,
  relativeTime,
  uniqueValues,
} from "./utils.js";

const root = document.querySelector("#gp-reader-root");
const themeButton = document.querySelector("#gp-theme-toggle");
const dataService = new GlobalPulseDataService();

function hasChineseText(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ""));
}

function setTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.body.dataset.gpTheme = nextTheme;
  themeButton.setAttribute("aria-pressed", String(nextTheme === "light"));
  themeButton.setAttribute("aria-label", nextTheme === "light" ? "切换为深色模式" : "切换为浅色模式");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", nextTheme === "light" ? "#EEF2F7" : "#0B1020");
  try { localStorage.setItem("global-pulse-theme", nextTheme); } catch { /* Optional. */ }
}

function initialTheme() {
  try { return localStorage.getItem("global-pulse-theme") || "dark"; } catch { return "dark"; }
}

function sourceRows(article) {
  return article.relatedSources?.length ? article.relatedSources : [{
    title: article.originalTitle || article.title,
    url: article.url,
    source: article.source,
    country: article.country,
    language: article.language,
    publishedAt: article.publishedAt,
  }];
}

function metaSummary(article) {
  const count = article.sourceCount || sourceRows(article).length;
  const time = article.eventUpdatedAt || article.publishedAt;
  if (article.summary) return article.summary;
  return `截至 ${fullDateTime(time)}，GLOBAL PULSE 已识别并整理 ${count} 个媒体来源围绕“${article.title}”发布的报道。以下页面只整合可追溯的标题、时间、来源与 GDELT 合法提供的上下文短片段，不把推测补写成新闻正文。`;
}

function factItems(article) {
  const sources = sourceRows(article);
  const domains = uniqueValues(sources.map((source) => source.source));
  const sourceCountries = uniqueValues(sources.map((source) => source.country).filter((country) => country && country !== "来源地未知"));
  const languages = uniqueValues(sources.map((source) => source.language).filter(Boolean));
  const latest = sources[0] || article;
  return [
    `当前聚合 ${domains.length} 个独立媒体域名，所有原始链接均保留。`,
    latest.publishedAt ? `最近一条关联报道记录于 ${fullDateTime(latest.publishedAt)}，来源为 ${latest.source}。` : "",
    sourceCountries.length ? `媒体来源国包括 ${sourceCountries.join("、")}；这表示媒体所在地，不等同于事件发生地。` : "",
    languages.length ? `原始报道语言包括 ${languages.join("、")}。` : "",
  ].filter(Boolean);
}

function sourceTimeline(article) {
  return [...sourceRows(article)]
    .sort((left, right) => (right.publishedAt?.valueOf() || 0) - (left.publishedAt?.valueOf() || 0))
    .map((source) => `
      <li class="gp-reader-timeline__item">
        <time datetime="${source.publishedAt?.toISOString() || ""}">${escapeHtml(fullDateTime(source.publishedAt))}</time>
        <div><strong>${escapeHtml(source.source)}</strong><p>${escapeHtml(source.title)}</p></div>
      </li>`).join("");
}

function sourceCards(article) {
  return sourceRows(article).map((source, index) => `
    <article class="gp-reader-source" id="gp-source-${index + 1}">
      <div><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(source.source)}</strong></div>
      <h3>${escapeHtml(source.title)}</h3>
      <p>${source.country && source.country !== "来源地未知" ? `媒体来源国 ${escapeHtml(source.country)} · ` : ""}${escapeHtml(fullDateTime(source.publishedAt))}</p>
      <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">查看原始报道 ↗</a>
    </article>`).join("");
}

function relatedEvents(article, articles) {
  const importance = eventImportance(article);
  const regions = new Set(importance.regions || []);
  return (articles || [])
    .filter((candidate) => candidate.eventId !== article.eventId)
    .map((candidate) => {
      const candidateImportance = eventImportance(candidate);
      const regionOverlap = (candidateImportance.regions || []).some((region) => regions.has(region));
      const related = regionOverlap || candidate.category === article.category;
      return { candidate, related, score: candidateImportance.score };
    })
    .filter((item) => item.related)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ candidate }) => `
      <a class="gp-reader-related__item" href="${escapeHtml(newsDetailHref(candidate))}">
        <span>${escapeHtml(categoryLabel(candidate.category))}</span>
        <strong>${escapeHtml(candidate.translatedTitle || candidate.title)}</strong>
        <small>${escapeHtml(candidate.source)} · ${escapeHtml(relativeTime(candidate.eventUpdatedAt || candidate.publishedAt))}</small>
      </a>`).join("");
}

function renderArticle(article, snapshot) {
  const importance = eventImportance(article);
  const sources = sourceRows(article);
  const visibleTitle = article.translatedTitle || article.title;
  const originalLanguage = article.language || sources[0]?.language || "未知语言";
  const regions = importance.regions || [];
  const related = relatedEvents(article, snapshot?.articles);
  document.title = `${visibleTitle}｜GLOBAL PULSE`;
  root.innerHTML = `
    <article class="gp-reader-article">
      <header class="gp-reader-hero">
        <a class="gp-reader-breadcrumb" href="../global.html">GLOBAL PULSE / 全球新闻</a>
        <div class="gp-reader-eyebrow">
          <span class="gp-badge">${escapeHtml(categoryLabel(article.category))}</span>
          <span>${article.translatedTitle ? "中文整理标题 · 保留原文" : hasChineseText(article.title) ? "中文原文" : `未接入翻译 · ${escapeHtml(originalLanguage)} 原文`}</span>
        </div>
        <h1>${escapeHtml(visibleTitle)}</h1>
        ${article.translatedTitle ? `<p class="gp-reader-original">原始标题：${escapeHtml(article.title)}</p>` : ""}
        <div class="gp-reader-byline">
          <strong>${escapeHtml(article.source)}</strong>
          <time datetime="${(article.eventUpdatedAt || article.publishedAt)?.toISOString() || ""}">${escapeHtml(fullDateTime(article.eventUpdatedAt || article.publishedAt))}</time>
          <span>${article.sourceCount || sources.length} 个媒体来源</span>
        </div>
        <p class="gp-reader-disclosure">这是基于公开新闻元数据与合法上下文片段制作的站内事件整理，不转载第三方受版权保护的全文。</p>
      </header>

      <div class="gp-reader-layout">
        <div class="gp-reader-body">
          <section class="gp-reader-section" aria-labelledby="gp-summary-title">
            <p class="gp-section-index">01 / EVENT SUMMARY</p>
            <h2 id="gp-summary-title">事件核心摘要</h2>
            <p class="gp-reader-lede">${escapeHtml(metaSummary(article))}</p>
          </section>

          <section class="gp-reader-section" aria-labelledby="gp-facts-title">
            <p class="gp-section-index">02 / VERIFIED METADATA</p>
            <h2 id="gp-facts-title">已核对的信息</h2>
            <ul class="gp-reader-facts">${factItems(article).map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>
          </section>

          ${importance.attentionNote ? `<section class="gp-reader-section gp-reader-attention" aria-labelledby="gp-attention-title"><p class="gp-section-index">03 / WHY IT MATTERS</p><h2 id="gp-attention-title">为什么值得关注？</h2><p>${escapeHtml(importance.attentionNote)}</p><small>依据标题、时间、地区与多来源元数据整理 · 非 AI 推测</small></section>` : ""}

          ${regions.length ? `<section class="gp-reader-section" aria-labelledby="gp-regions-title"><p class="gp-section-index">04 / PEOPLE & PLACES</p><h2 id="gp-regions-title">涉及地区</h2><div class="gp-reader-chips">${regions.map((region) => `<span>${escapeHtml(region)}</span>`).join("")}</div><p class="gp-reader-note">这里只展示能够从报道标题可靠识别的地区；无法确认的人物与地点不会补写。</p></section>` : ""}

          <section class="gp-reader-section" aria-labelledby="gp-context-title">
            <p class="gp-section-index">05 / SOURCE CONTEXT</p>
            <h2 id="gp-context-title">报道上下文</h2>
            <div id="gp-reader-context"><div class="gp-inline-skeleton"></div><p class="gp-reader-note">正在查询 GDELT Context 提供的短上下文片段…</p></div>
          </section>

          <section class="gp-reader-section" aria-labelledby="gp-progress-title">
            <p class="gp-section-index">06 / LATEST UPDATES</p>
            <h2 id="gp-progress-title">报道时间线</h2>
            <ol class="gp-reader-timeline">${sourceTimeline(article)}</ol>
          </section>

          <section class="gp-reader-section" aria-labelledby="gp-coverage-title">
            <p class="gp-section-index">07 / COVERAGE COMPARISON</p>
            <h2 id="gp-coverage-title">不同媒体如何报道</h2>
            <p class="gp-reader-note">以下保留各媒体原始标题。标题表述存在差异时，GLOBAL PULSE 不自行把未经证实的说法判定为事实。</p>
            <div class="gp-reader-headlines">${sources.map((source) => `<div><strong>${escapeHtml(source.source)}</strong><p>${escapeHtml(source.title)}</p></div>`).join("")}</div>
          </section>

          <section class="gp-reader-section" id="gp-sources" aria-labelledby="gp-sources-title">
            <p class="gp-section-index">08 / ORIGINAL SOURCES</p>
            <h2 id="gp-sources-title">来源与原始报道</h2>
            <p class="gp-reader-warning">下列按钮会在新标签页打开第三方媒体网站，原始媒体网站可能包含广告。</p>
            <div class="gp-reader-sources">${sourceCards(article)}</div>
          </section>
        </div>

        <aside class="gp-reader-aside" aria-label="事件阅读信息">
          <div><span>内容级别</span><strong>多来源事件整理</strong></div>
          <div><span>数据状态</span><strong>${snapshot?.source === "live" ? "实时数据" : "最近成功快照"}</strong></div>
          <div><span>正文版权</span><strong>未转载第三方全文</strong></div>
          <a href="../global.html">← 返回全球新闻</a>
        </aside>
      </div>

      <section class="gp-reader-related" aria-labelledby="gp-related-title">
        <div><p class="gp-section-index">CONTINUE READING</p><h2 id="gp-related-title">相关新闻</h2></div>
        <div class="gp-reader-related__grid">${related || '<p class="gp-reader-note">当前数据中没有足够可靠的相关新闻。</p>'}</div>
      </section>
    </article>`;
}

function renderContext(result) {
  const container = document.querySelector("#gp-reader-context");
  if (!container) return;
  if (!result.contexts.length) {
    const reason = result.source === "unsupported-language"
      ? "当前事件没有可用于 GDELT Context 检索的英文标题，因此不生成可能失真的上下文。"
      : "GDELT Context 当前未返回可核对的额外片段。页面仍保留完整来源时间线与原始标题。";
    container.innerHTML = `<div class="gp-reader-context-state"><strong>没有额外上下文</strong><p>${escapeHtml(reason)}</p></div>`;
    return;
  }
  container.innerHTML = `
    <p class="gp-reader-note">以下是 GDELT Context 返回的短片段，保持原文并按重复内容合并；它们用于理解报道语境，不等同于本站独立确认全部陈述。</p>
    <div class="gp-reader-contexts">
      ${result.contexts.map((item) => `
        <article class="gp-reader-context-card">
          <div><strong>${escapeHtml(item.source)}</strong><span>${escapeHtml(item.language || "原文")}${item.outlets.length > 1 ? ` · ${item.outlets.length} 个转载来源` : ""}</span></div>
          <p lang="auto">${escapeHtml(item.context)}</p>
          <small>${escapeHtml(item.title)} · ${escapeHtml(fullDateTime(item.publishedAt))}</small>
        </article>`).join("")}
    </div>
    <p class="gp-reader-context-credit">上下文数据更新时间：${escapeHtml(result.fetchedAt ? fullDateTime(new Date(result.fetchedAt)) : "最近缓存")}</p>`;
}

function renderError(title, message) {
  root.innerHTML = `<div class="gp-reader-error"><span>GLOBAL PULSE</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a href="../global.html">← 返回全球新闻</a></div>`;
}

async function locateEvent(eventId) {
  for (const time of ["1d", "1w", "1h"]) {
    const cached = dataService.getCached(time);
    const cachedEvent = findEventById(cached?.articles, eventId);
    if (cachedEvent) return { article: cachedEvent, snapshot: cached };
  }
  const initial = await dataService.getInitial("1d");
  const initialEvent = findEventById(initial?.articles, eventId);
  if (initialEvent) return { article: initialEvent, snapshot: initial };
  const live = await dataService.load("1d", { force: true });
  return { article: findEventById(live?.articles, eventId), snapshot: live };
}

async function bootstrap() {
  setTheme(initialTheme());
  document.querySelector("#gp-footer-year").textContent = new Date().getFullYear();
  const eventId = new URLSearchParams(location.search).get("id");
  if (!eventId) {
    renderError("缺少新闻标识", "这个链接没有包含可识别的事件 ID。请返回新闻列表重新选择。");
    return;
  }

  try {
    const { article, snapshot } = await locateEvent(eventId);
    if (!article) {
      renderError("未找到这条新闻", "它可能已超出当前数据窗口，或最近数据尚未成功缓存。页面不会用其他新闻冒充该事件。");
      return;
    }
    renderArticle(article, snapshot);
    try {
      renderContext(await loadEventContext(article));
    } catch {
      const context = document.querySelector("#gp-reader-context");
      if (context) context.innerHTML = '<div class="gp-reader-context-state"><strong>上下文服务暂时不可用</strong><p>页面已保留站内事件摘要、来源对比和报道时间线。稍后重新打开可再次尝试。</p></div>';
    }
  } catch (error) {
    renderError("新闻加载失败", error?.name === "AbortError" ? "数据请求超时，请稍后重试。" : "当前无法读取实时数据或最近缓存，请返回列表后稍后重试。");
  }
}

themeButton.addEventListener("click", () => setTheme(document.body.dataset.gpTheme === "light" ? "dark" : "light"));
bootstrap();
