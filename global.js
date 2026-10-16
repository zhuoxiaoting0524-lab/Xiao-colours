import { AUTO_REFRESH_MS } from "./global/config.js";
import { GlobalPulseDataService } from "./global/data-service.js";
import {
  GlobalPulseHeader,
  LastUpdatedIndicator,
  MajorEvents,
  NewsFeed,
  NewsFilters,
  RelatedCoverage,
  ThemeToggle,
  TopStories,
  WorldBrief,
  categoryExists,
} from "./global/components.js";
import { GlobalMapSection } from "./global/map.js";
import { categoryLabel, debounce, filterArticles, fullDateTime, uniqueValues } from "./global/utils.js";

const elements = {
  body: document.body,
  search: document.querySelector("#gp-search-input"),
  region: document.querySelector("#gp-region-filter"),
  theme: document.querySelector("#gp-theme-toggle"),
  statusText: document.querySelector("#gp-status-text"),
  statusDot: document.querySelector("#gp-status-dot"),
  updated: document.querySelector("#gp-last-updated"),
  topStories: document.querySelector("#gp-top-stories"),
  briefMetrics: document.querySelector("#gp-brief-metrics"),
  majorEvents: document.querySelector("#gp-major-events"),
  categoryTabs: document.querySelector("#gp-category-tabs"),
  time: document.querySelector("#gp-time-filter"),
  refresh: document.querySelector("#gp-refresh-button"),
  resultCount: document.querySelector("#gp-result-count"),
  feedState: document.querySelector("#gp-feed-state"),
  newsFeed: document.querySelector("#gp-news-feed"),
  mapStage: document.querySelector("#gp-map-stage"),
  map: document.querySelector("#gp-world-map"),
  mapLoading: document.querySelector("#gp-map-loading"),
  mapUpdated: document.querySelector("#gp-map-updated"),
  mapQuakeCount: document.querySelector("#gp-map-quake-count"),
  mapRegionCount: document.querySelector("#gp-map-region-count"),
  mapFilterSummary: document.querySelector("#gp-map-filter-summary"),
  relatedCoverage: document.querySelector("#gp-related-coverage"),
  backToTop: document.querySelector("#gp-back-to-top"),
  toast: document.querySelector("#gp-toast"),
  utcClock: document.querySelector("#gp-utc-clock"),
};

const state = {
  articles: [],
  earthquakes: [],
  fetchedAt: null,
  source: null,
  loading: false,
  filters: {
    search: "",
    region: "all",
    category: "all",
    time: "1d",
  },
};

const dataService = new GlobalPulseDataService();
let activeLoadId = 0;
const mapSection = new GlobalMapSection({
  mapElement: elements.map,
  loadingElement: elements.mapLoading,
  onCountrySelect(country) {
    state.filters.region = country;
    elements.region.value = country;
    render();
    document.querySelector("#gp-explore")?.scrollIntoView({ behavior: "smooth", block: "start" });
  },
});

function getVisibleArticles() {
  return filterArticles(state.articles, state.filters);
}

function render() {
  const visible = getVisibleArticles();
  TopStories(elements.topStories, visible);
  NewsFeed(elements.newsFeed, visible);
  WorldBrief(elements.briefMetrics, visible);
  MajorEvents(elements.majorEvents, visible);
  RelatedCoverage(elements.relatedCoverage, visible);
  mapSection.update({ articles: visible, earthquakes: state.earthquakes });
  elements.resultCount.textContent = `${visible.length} 条新闻`;
  LastUpdatedIndicator(elements.updated, state.fetchedAt, state.source);
  const mediaRegions = uniqueValues(visible.flatMap((article) => {
    return article.countries?.length ? article.countries : [article.country];
  }).filter((country) => country && country !== "来源地未知"));
  elements.mapUpdated.textContent = state.fetchedAt ? fullDateTime(state.fetchedAt) : "尚未更新";
  elements.mapQuakeCount.textContent = String(state.earthquakes.length);
  elements.mapRegionCount.textContent = String(mediaRegions.length);
  const regionLabel = state.filters.region === "all" ? "全球" : state.filters.region;
  elements.mapFilterSummary.textContent = `${regionLabel} · ${categoryLabel(state.filters.category)}`;
}

function setLoading(loading) {
  state.loading = loading;
  elements.refresh.disabled = loading;
  elements.refresh.classList.toggle("is-loading", loading);
}

function setFeedState(message = "") {
  elements.feedState.hidden = !message;
  elements.feedState.textContent = message;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
}

function applySnapshot(snapshot, { announce = false } = {}) {
  state.articles = snapshot.articles;
  state.earthquakes = snapshot.earthquakes || [];
  state.fetchedAt = snapshot.fetchedAt;
  state.source = snapshot.source;

  NewsFilters(elements.region, state.articles, state.filters.region);
  state.filters.region = elements.region.value;
  render();

  if (snapshot.source === "live") {
    GlobalPulseHeader({
      statusText: elements.statusText,
      statusDot: elements.statusDot,
      message: snapshot.earthquakeStatus === "cached" ? "新闻已实时更新，地震数据使用最近缓存" : "全球数据连接正常",
      type: "live",
    });
    setFeedState("");
    if (announce) showToast("GLOBAL PULSE 数据已更新");
    return;
  }

  const cacheLabel = snapshot.source === "seed" ? "内置真实新闻快照" : "最近成功缓存";
  GlobalPulseHeader({
    statusText: elements.statusText,
    statusDot: elements.statusDot,
    message: `实时新闻接口暂不可用，正在显示${cacheLabel}`,
    type: "cached",
  });
  setFeedState(`当前展示${cacheLabel}，实际数据时间显示在页面顶部；系统不会将缓存内容标记为实时。`);
  if (announce) showToast("实时接口不可用，已保留最近成功内容");
}

function renderLoadError(error) {
  const timeout = error?.name === "AbortError";
  GlobalPulseHeader({
    statusText: elements.statusText,
    statusDot: elements.statusDot,
    message: timeout ? "数据请求超时，请稍后重试" : "全球数据源暂时不可用",
    type: "error",
  });
  setFeedState(state.articles.length
    ? "本次更新失败，页面继续保留上一次成功获取的内容。"
    : "当前没有可用新闻或缓存，请稍后点击“刷新数据”重试。");

  if (!state.articles.length) {
    elements.topStories.innerHTML = '<div class="gp-empty-state"><p><strong>暂时无法加载焦点新闻</strong>请稍后重试。</p></div>';
    elements.newsFeed.innerHTML = '<div class="gp-empty-state"><p><strong>暂时无法连接新闻数据源</strong>地图与其他页面不受影响。</p></div>';
  }
}

async function loadData({ announce = false } = {}) {
  const loadId = ++activeLoadId;
  setLoading(true);
  GlobalPulseHeader({
    statusText: elements.statusText,
    statusDot: elements.statusDot,
    message: "正在检查最新全球数据…",
    type: "loading",
  });

  try {
    const snapshot = await dataService.load(state.filters.time, { force: true });
    if (loadId !== activeLoadId) return;
    applySnapshot(snapshot, { announce });
  } catch (error) {
    if (loadId !== activeLoadId) return;
    renderLoadError(error);
    if (announce) showToast("更新失败，请稍后重试");
  } finally {
    if (loadId === activeLoadId) setLoading(false);
  }
}

function setTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  elements.body.dataset.gpTheme = nextTheme;
  ThemeToggle(elements.theme, nextTheme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", nextTheme === "light" ? "#EEF2F7" : "#0B1020");
  try {
    localStorage.setItem("global-pulse-theme", nextTheme);
  } catch {
    // Theme persistence is optional.
  }
  mapSection.invalidateSize();
}

function getInitialTheme() {
  try {
    return localStorage.getItem("global-pulse-theme") || "dark";
  } catch {
    return "dark";
  }
}

const updateSearch = debounce(() => {
  state.filters.search = elements.search.value;
  render();
}, 220);

elements.search.addEventListener("input", updateSearch);
elements.search.addEventListener("search", () => {
  state.filters.search = elements.search.value;
  render();
});

elements.region.addEventListener("change", () => {
  state.filters.region = elements.region.value;
  render();
});

elements.categoryTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-gp-category]");
  if (!button || !categoryExists(button.dataset.gpCategory)) return;
  state.filters.category = button.dataset.gpCategory;
  elements.categoryTabs.querySelectorAll("[data-gp-category]").forEach((item) => {
    const active = item === button;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  render();
});

elements.time.addEventListener("change", () => {
  state.filters.time = elements.time.value;
  render();
  loadData({ announce: true });
});

elements.refresh.addEventListener("click", () => loadData({ announce: true }));

elements.theme.addEventListener("click", () => {
  const nextTheme = elements.body.dataset.gpTheme === "light" ? "dark" : "light";
  setTheme(nextTheme);
});

document.querySelectorAll("[data-gp-layer]").forEach((button) => {
  button.addEventListener("click", () => {
    const layer = button.dataset.gpLayer;
    document.querySelectorAll("[data-gp-layer]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    mapSection.setLayer(layer);
  });
});

elements.backToTop.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

window.addEventListener("scroll", () => {
  elements.backToTop.classList.toggle("is-visible", window.scrollY > 700);
}, { passive: true });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !state.fetchedAt) return;
  if (Date.now() - state.fetchedAt.valueOf() >= AUTO_REFRESH_MS) loadData();
});

function updateClock() {
  elements.utcClock.textContent = `${new Date().toLocaleTimeString("zh-CN", {
    timeZone: "UTC",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  })} UTC`;
}

const mapObserver = new IntersectionObserver((entries, observer) => {
  if (!entries.some((entry) => entry.isIntersecting)) return;
  observer.disconnect();
  const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 180));
  schedule(() => mapSection.init());
}, { rootMargin: "240px" });
mapObserver.observe(elements.mapStage);

async function bootstrap() {
  setTheme(getInitialTheme());
  document.querySelector("#gp-footer-year").textContent = new Date().getFullYear();
  updateClock();
  window.setInterval(updateClock, 30000);

  const initial = await dataService.getInitial(state.filters.time);
  if (initial) applySnapshot(initial);
  await loadData();
  window.setInterval(() => loadData(), AUTO_REFRESH_MS);
}

bootstrap();
