const GDELT_API = "https://api.gdeltproject.org/api/v2/doc/doc";
const USGS_FEEDS = {
  "1h": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson",
  "1d": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
  "1w": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
};
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const CACHE_KEY = "xiaoting-global-news-v1";
const AUTO_REFRESH_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30000;
const GDELT_CORS_TIMEOUT_MS = 12000;

const CATEGORY_CONFIG = {
  all: {
    label: "全球综合",
    query: '(conflict OR economy OR technology OR disaster OR trade OR energy OR politics OR diplomacy)',
  },
  politics: {
    label: "国际政治",
    query: '(election OR government OR diplomacy OR parliament OR president OR minister)',
  },
  conflict: {
    label: "地缘冲突",
    query: '(conflict OR war OR military OR ceasefire OR missile OR sanctions)',
  },
  economy: {
    label: "全球经济",
    query: '(economy OR inflation OR recession OR interest rates OR financial market)',
  },
  technology: {
    label: "科技与 AI",
    query: '(technology OR artificial intelligence OR semiconductor OR cybersecurity OR robotics)',
  },
  disaster: {
    label: "自然灾害",
    query: '(earthquake OR flood OR wildfire OR hurricane OR cyclone OR disaster)',
  },
  trade: {
    label: "国际贸易",
    query: '(international trade OR tariff OR export OR import OR supply chain)',
  },
  energy: {
    label: "能源动态",
    query: '(oil OR natural gas OR renewable energy OR OPEC OR nuclear energy)',
  },
};

const CLASSIFICATION_RULES = [
  ["conflict", /\b(war|conflict|military|missile|airstrike|attack|ceasefire|troops?|weapon|invasion|sanction)\b|战争|冲突|军事|导弹|袭击|停火|制裁/i],
  ["disaster", /\b(earthquake|flood|wildfire|hurricane|cyclone|tsunami|eruption|disaster|storm)\b|地震|洪水|山火|飓风|海啸|灾害/i],
  ["technology", /\b(artificial intelligence|\bAI\b|technology|semiconductor|chip|cyber|robot|software)\b|人工智能|科技|芯片|网络安全|机器人/i],
  ["energy", /\b(oil|gas|energy|opec|nuclear|solar|wind power|renewable)\b|石油|天然气|能源|核电|太阳能/i],
  ["trade", /\b(trade|tariff|export|import|supply chain|shipping)\b|贸易|关税|出口|进口|供应链/i],
  ["economy", /\b(economy|economic|inflation|recession|interest rate|market|stocks?|gdp|bank)\b|经济|通胀|衰退|利率|市场|股市|银行/i],
  ["politics", /\b(election|government|president|minister|parliament|diplomacy|summit|policy)\b|选举|政府|总统|部长|议会|外交|峰会/i],
];

const HIGH_PRIORITY = /\b(invasion|airstrike|missile|earthquake|tsunami|hurricane|cyclone|evacuation|ceasefire|emergency|explosion|war|nuclear|default|crash)\b|入侵|空袭|导弹|地震|海啸|飓风|撤离|停火|紧急|爆炸|战争|核|违约|崩盘/i;
const MEDIUM_PRIORITY = /\b(conflict|military|sanction|flood|wildfire|recession|tariff|cyberattack|outbreak|protest)\b|冲突|军事|制裁|洪水|山火|衰退|关税|网络攻击|疫情|抗议/i;

const COUNTRY_COORDS = {
  "Argentina": [-38.4, -63.6], "Australia": [-25.3, 133.8], "Austria": [47.5, 14.6],
  "Bangladesh": [23.7, 90.4], "Belgium": [50.5, 4.5], "Bolivia": [-16.3, -63.6],
  "Brazil": [-14.2, -51.9], "Bulgaria": [42.7, 25.5], "Cambodia": [12.6, 105],
  "Cameroon": [7.4, 12.4], "Canada": [56.1, -106.3], "Chile": [-35.7, -71.5],
  "China": [35.9, 104.2], "Colombia": [4.6, -74.3], "Croatia": [45.1, 15.2],
  "Cuba": [21.5, -77.8], "Czech Republic": [49.8, 15.5], "Denmark": [56.3, 9.5],
  "Dominican Republic": [18.7, -70.2], "Ecuador": [-1.8, -78.2], "Egypt": [26.8, 30.8],
  "Estonia": [58.6, 25], "Ethiopia": [9.1, 40.5], "Finland": [61.9, 25.7],
  "France": [46.2, 2.2], "Germany": [51.2, 10.5], "Ghana": [7.9, -1],
  "Greece": [39.1, 21.8], "Hungary": [47.2, 19.5], "India": [20.6, 79],
  "Indonesia": [-0.8, 113.9], "Iran": [32.4, 53.7], "Iraq": [33.2, 43.7],
  "Ireland": [53.1, -8.2], "Israel": [31, 34.9], "Italy": [41.9, 12.6],
  "Japan": [36.2, 138.3], "Jordan": [30.6, 36.2], "Kazakhstan": [48, 67],
  "Kenya": [-0.02, 37.9], "Kuwait": [29.3, 47.5], "Latvia": [56.9, 24.6],
  "Lebanon": [33.9, 35.9], "Lithuania": [55.2, 23.9], "Malaysia": [4.2, 101.98],
  "Mexico": [23.6, -102.6], "Morocco": [31.8, -7.1], "Myanmar": [21.9, 95.96],
  "Nepal": [28.4, 84.1], "Netherlands": [52.1, 5.3], "New Zealand": [-40.9, 174.9],
  "Nigeria": [9.1, 8.7], "Norway": [60.5, 8.5], "Pakistan": [30.4, 69.3],
  "Panama": [8.5, -80.8], "Peru": [-9.2, -75], "Philippines": [12.9, 121.8],
  "Poland": [51.9, 19.1], "Portugal": [39.4, -8.2], "Qatar": [25.4, 51.2],
  "Romania": [45.9, 24.97], "Russia": [61.5, 105.3], "Saudi Arabia": [23.9, 45.1],
  "Serbia": [44, 21], "Singapore": [1.35, 103.8], "Slovakia": [48.7, 19.7],
  "Slovenia": [46.2, 15], "South Africa": [-30.6, 22.9], "South Korea": [35.9, 127.8],
  "Spain": [40.5, -3.7], "Sri Lanka": [7.9, 80.8], "Sweden": [60.1, 18.6],
  "Switzerland": [46.8, 8.2], "Syria": [35, 38.99], "Taiwan": [23.7, 121],
  "Tanzania": [-6.4, 34.9], "Thailand": [15.9, 100.99], "Tunisia": [33.9, 9.5],
  "Turkey": [39, 35.2], "Ukraine": [48.4, 31.2], "United Arab Emirates": [23.4, 53.8],
  "United Kingdom": [55.4, -3.4], "United States": [37.1, -95.7], "Uruguay": [-32.5, -55.8],
  "Venezuela": [6.4, -66.6], "Vietnam": [14.1, 108.3], "Yemen": [15.6, 48.5],
  "Zimbabwe": [-19, 29.2],
};

const els = {
  search: document.querySelector("#news-search"),
  country: document.querySelector("#country-filter"),
  category: document.querySelector("#category-filter"),
  time: document.querySelector("#time-filter"),
  refresh: document.querySelector("#refresh-button"),
  reset: document.querySelector("#clear-filters"),
  stream: document.querySelector("#news-stream"),
  statusLight: document.querySelector("#status-light"),
  statusText: document.querySelector("#status-text"),
  resultCount: document.querySelector("#result-count"),
  updatedAt: document.querySelector("#updated-at"),
  briefing: document.querySelector("#briefing-content"),
  events: document.querySelector("#event-list"),
  mapLoading: document.querySelector("#map-loading"),
  mapStage: document.querySelector("#map-stage"),
  toast: document.querySelector("#toast"),
};

const state = {
  articles: [],
  earthquakes: [],
  fetchedAt: null,
  loading: false,
  map: null,
  newsLayer: null,
  quakeLayer: null,
  activeLayer: "all",
  requestController: null,
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((key) => parsed.searchParams.delete(key));
    return parsed.toString();
  } catch {
    return url;
  }
}

function parseGdeltDate(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, y, m, d, h, min, s] = match;
  return new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`);
}

function relativeTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return "时间未知";
  const minutes = Math.max(0, Math.round((Date.now() - date.valueOf()) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}

function classifyTitle(title) {
  const match = CLASSIFICATION_RULES.find(([, pattern]) => pattern.test(title));
  return match?.[0] || "all";
}

function normalizeArticles(rawArticles) {
  const deduped = new Map();
  for (const article of Array.isArray(rawArticles) ? rawArticles : []) {
    const title = String(article.title || "").trim();
    const url = canonicalUrl(String(article.url || "").trim());
    if (!title || !url || !/^https?:\/\//i.test(url)) continue;
    const key = url || title.toLocaleLowerCase();
    if (deduped.has(key)) continue;
    deduped.set(key, {
      title,
      url,
      image: String(article.socialimage || ""),
      source: String(article.domain || new URL(url).hostname).replace(/^www\./, ""),
      country: String(article.sourcecountry || "").trim() || "来源地未知",
      language: String(article.language || "").trim() || "未知语言",
      publishedAt: parseGdeltDate(article.seendate),
      category: classifyTitle(title),
    });
  }
  return [...deduped.values()].sort((a, b) => (b.publishedAt?.valueOf() || 0) - (a.publishedAt?.valueOf() || 0));
}

function safeSearchTerm(value) {
  return value.replace(/[()"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function buildGdeltUrl(format = "json", callback = "") {
  const category = CATEGORY_CONFIG[els.category.value] || CATEGORY_CONFIG.all;
  const search = safeSearchTerm(els.search.value);
  const query = search ? `${category.query} "${search}"` : category.query;
  const params = new URLSearchParams({
    query,
    mode: "ArtList",
    maxrecords: "120",
    format,
    sort: "DateDesc",
    timespan: els.time.value,
  });
  if (callback) params.set("callback", callback);
  return `${GDELT_API}?${params}`;
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function fetchGdeltJsonp(signal) {
  return new Promise((resolve, reject) => {
    const callbackName = `__xiaotingGdelt${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const script = document.createElement("script");
    let settled = false;

    const cleanup = () => {
      script.remove();
      delete window[callbackName];
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };
    const onAbort = () => finish(reject, new DOMException("The operation was aborted.", "AbortError"));

    window[callbackName] = (data) => finish(resolve, data);
    script.src = buildGdeltUrl("jsonp", callbackName);
    script.async = true;
    script.onerror = () => finish(reject, new Error("GDELT JSONP 请求失败"));
    signal?.addEventListener("abort", onAbort, { once: true });
    document.head.append(script);
  });
}

async function fetchGdeltData(signal) {
  const corsController = new AbortController();
  const abortCors = () => corsController.abort();
  const corsTimeout = window.setTimeout(abortCors, GDELT_CORS_TIMEOUT_MS);
  signal?.addEventListener("abort", abortCors, { once: true });
  try {
    return await fetchJson(buildGdeltUrl(), corsController.signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return fetchGdeltJsonp(signal);
  } finally {
    window.clearTimeout(corsTimeout);
    signal?.removeEventListener("abort", abortCors);
  }
}

function setLoading(loading) {
  state.loading = loading;
  els.refresh.disabled = loading;
  els.refresh.classList.toggle("is-loading", loading);
  els.statusLight.className = `status-light${loading ? " is-loading" : ""}`;
}

function setStatus(message, type = "live") {
  els.statusText.textContent = message;
  els.statusLight.className = "status-light";
  if (type !== "live") els.statusLight.classList.add(`is-${type}`);
}

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      articles: state.articles.map((article) => ({
        ...article,
        publishedAt: article.publishedAt?.toISOString() || null,
      })),
      earthquakes: state.earthquakes,
      fetchedAt: state.fetchedAt?.toISOString() || null,
    }));
  } catch {
    // Private browsing or storage limits should not block live data.
  }
}

function readCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!Array.isArray(parsed?.articles) || !parsed.articles.length) return false;
    state.articles = parsed.articles.map((article) => ({
      ...article,
      publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
    }));
    state.earthquakes = Array.isArray(parsed.earthquakes) ? parsed.earthquakes : [];
    state.fetchedAt = parsed.fetchedAt ? new Date(parsed.fetchedAt) : null;
    return true;
  } catch {
    return false;
  }
}

async function readSeedCache() {
  try {
    const response = await fetch("./data/news-cache.json", { cache: "no-store" });
    if (!response.ok) return false;
    const seed = await response.json();
    const articles = normalizeArticles(seed.articles);
    if (!articles.length) return false;
    state.articles = articles;
    const newestTimestamp = Math.max(...articles.map((article) => article.publishedAt?.valueOf() || 0));
    state.fetchedAt = newestTimestamp > 0 ? new Date(newestTimestamp) : null;
    return true;
  } catch {
    return false;
  }
}

async function loadData({ manual = false } = {}) {
  if (state.loading) return;
  state.requestController?.abort();
  state.requestController = new AbortController();
  const timeoutId = window.setTimeout(() => state.requestController.abort(), REQUEST_TIMEOUT_MS);
  setLoading(true);
  els.statusText.textContent = "正在获取实时新闻与地震数据…";

  try {
    const quakePromise = fetchJson(
      USGS_FEEDS[els.time.value] || USGS_FEEDS["1d"],
      state.requestController.signal,
    ).then((result) => {
      if (Array.isArray(result.features)) {
        state.earthquakes = result.features;
        renderMapData();
      }
      return result;
    });
    const [newsResult, quakeResult] = await Promise.allSettled([
      fetchGdeltData(state.requestController.signal),
      quakePromise,
    ]);

    if (quakeResult.status === "fulfilled" && Array.isArray(quakeResult.value.features)) {
      state.earthquakes = quakeResult.value.features;
    }
    if (newsResult.status !== "fulfilled") throw newsResult.reason;
    const articles = normalizeArticles(newsResult.value.articles);
    if (!articles.length) throw new Error("新闻接口暂未返回匹配内容");

    state.articles = articles;
    state.fetchedAt = new Date();
    writeCache();
    populateCountryFilter();
    renderAll();
    setStatus(quakeResult.status === "fulfilled" ? "实时数据连接正常" : "新闻已更新，地震数据暂时不可用");
    if (manual) showToast("实时数据已更新");
  } catch (error) {
    let hasCache = state.articles.length > 0 || readCache();
    if (!hasCache) hasCache = await readSeedCache();
    if (hasCache) {
      populateCountryFilter();
      renderAll();
      setStatus("实时接口暂不可用，正在显示最近成功获取的新闻快照", "cached");
      showToast("连接失败，已切换到本地缓存");
    } else {
      renderError(error);
      setStatus("无法连接实时数据源，请稍后重试", "error");
    }
  } finally {
    window.clearTimeout(timeoutId);
    setLoading(false);
    updateStatusMeta();
  }
}

function getVisibleArticles() {
  const country = els.country.value;
  const localSearch = safeSearchTerm(els.search.value).toLocaleLowerCase();
  return state.articles.filter((article) => {
    const countryMatch = country === "all" || article.country === country;
    const searchMatch = !localSearch || `${article.title} ${article.source} ${article.country}`.toLocaleLowerCase().includes(localSearch);
    return countryMatch && searchMatch;
  });
}

function renderNews() {
  const articles = getVisibleArticles();
  els.resultCount.textContent = `${articles.length} 条新闻`;
  if (!articles.length) {
    els.stream.innerHTML = '<div class="empty-state"><p><strong>没有找到匹配内容</strong>请更换搜索词、国家或时间范围。</p></div>';
    return;
  }

  els.stream.innerHTML = articles.map((article) => {
    const category = CATEGORY_CONFIG[article.category] || CATEGORY_CONFIG.all;
    return `
      <article class="news-card">
        <div class="news-meta">
          <span class="news-source">${escapeHtml(article.source)}</span>
          <span class="news-country">${escapeHtml(article.country)}</span>
          <time datetime="${article.publishedAt?.toISOString() || ""}">${escapeHtml(relativeTime(article.publishedAt))}</time>
        </div>
        <h3><a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a></h3>
        <div class="news-detail">
          <span class="news-category">${escapeHtml(category.label)}</span>
          <a class="original-link" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a>
        </div>
      </article>`;
  }).join("");
}

function priorityScore(article) {
  if (HIGH_PRIORITY.test(article.title)) return 2;
  if (MEDIUM_PRIORITY.test(article.title)) return 1;
  return 0;
}

function renderEvents() {
  const important = getVisibleArticles()
    .map((article) => ({ article, score: priorityScore(article) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (b.article.publishedAt?.valueOf() || 0) - (a.article.publishedAt?.valueOf() || 0))
    .slice(0, 8);

  if (!important.length) {
    els.events.innerHTML = '<p class="empty-copy">当前筛选范围内没有触发重大事件关键词的新闻。</p>';
    return;
  }

  els.events.innerHTML = important.map(({ article, score }) => `
    <article class="event-item">
      <span class="severity-dot${score === 2 ? " is-high" : ""}" aria-hidden="true"></span>
      <div>
        <h3><a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a></h3>
        <p>${escapeHtml(article.source)} · ${escapeHtml(article.country)} · ${escapeHtml(relativeTime(article.publishedAt))}</p>
      </div>
    </article>`).join("");
}

function renderBriefing() {
  const articles = getVisibleArticles();
  if (!articles.length) {
    els.briefing.innerHTML = "<p>没有可用于生成统计概览的新闻。</p>";
    return;
  }
  const countries = new Set(articles.map((item) => item.country).filter((country) => country !== "来源地未知"));
  const sources = new Set(articles.map((item) => item.source));
  const categoryCounts = articles.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] || 0) + 1;
    return counts;
  }, {});
  const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];
  const topLabel = CATEGORY_CONFIG[topCategory?.[0]]?.label || "全球综合";
  els.briefing.innerHTML = `
    <div class="briefing-metrics">
      <div><strong>${articles.length}</strong><span>新闻</span></div>
      <div><strong>${sources.size}</strong><span>媒体</span></div>
      <div><strong>${countries.size}</strong><span>来源国</span></div>
    </div>
    <p>当前结果中，<b>${escapeHtml(topLabel)}</b>相关报道数量最多。此概览仅统计已载入标题、媒体与来源国，不构成事实判断或 AI 推断。</p>`;
}

function populateCountryFilter() {
  const selected = els.country.value;
  const countries = [...new Set(state.articles.map((article) => article.country))]
    .filter((country) => country && country !== "来源地未知")
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  els.country.innerHTML = '<option value="all">全部地区</option>' + countries
    .map((country) => `<option value="${escapeHtml(country)}">${escapeHtml(country)}</option>`)
    .join("");
  els.country.value = countries.includes(selected) ? selected : "all";
}

function updateStatusMeta() {
  const visibleCount = getVisibleArticles().length;
  els.resultCount.textContent = `${visibleCount} 条新闻`;
  els.updatedAt.textContent = state.fetchedAt
    ? `最近更新 ${state.fetchedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
    : "尚未更新";
}

function renderAll() {
  renderNews();
  renderBriefing();
  renderEvents();
  renderMapData();
  updateStatusMeta();
}

function renderError(error) {
  const message = error?.name === "AbortError" ? "请求超时" : "数据源暂时不可用";
  els.stream.innerHTML = `<div class="empty-state"><p><strong>${message}</strong>没有可用缓存。请稍后点击“刷新”重试。</p></div>`;
  els.resultCount.textContent = "0 条新闻";
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
}

function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`link[href="${href}"]`)) return resolve();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = resolve;
    link.onerror = reject;
    document.head.append(link);
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.L) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

async function initMap() {
  if (state.map) return;
  try {
    await Promise.all([loadStylesheet(LEAFLET_CSS), loadScript(LEAFLET_JS)]);
    state.map = window.L.map("world-map", {
      center: [24, 8],
      zoom: 2,
      minZoom: 2,
      maxZoom: 7,
      worldCopyJump: true,
      zoomControl: true,
    });
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 7,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(state.map);
    state.newsLayer = window.L.layerGroup().addTo(state.map);
    state.quakeLayer = window.L.layerGroup().addTo(state.map);
    els.mapLoading.classList.add("is-hidden");
    renderMapData();
  } catch {
    els.mapLoading.innerHTML = "<p>地图组件暂时无法加载。新闻列表仍可正常使用。</p>";
  }
}

function markerIcon(type, count = "") {
  const size = type === "quake" ? 18 : Math.min(34, 18 + Math.log2(Number(count) + 1) * 4);
  return window.L.divIcon({
    className: "",
    html: `<span class="map-marker ${type}" style="width:${size}px;height:${size}px">${type === "news" ? count : ""}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function renderMapData() {
  if (!state.map || !state.newsLayer || !state.quakeLayer) return;
  state.newsLayer.clearLayers();
  state.quakeLayer.clearLayers();
  const articles = getVisibleArticles();
  const byCountry = articles.reduce((groups, article) => {
    if (!COUNTRY_COORDS[article.country]) return groups;
    (groups[article.country] ||= []).push(article);
    return groups;
  }, {});

  Object.entries(byCountry).forEach(([country, items]) => {
    const marker = window.L.marker(COUNTRY_COORDS[country], { icon: markerIcon("news", items.length), keyboard: true });
    marker.bindPopup(`<b>${escapeHtml(country)}</b><br>${items.length} 条媒体来源于该国的新闻<br><a href="#news-stream" data-map-country="${escapeHtml(country)}">在列表中查看 →</a>`);
    marker.on("popupopen", (event) => {
      const link = event.popup.getElement()?.querySelector("[data-map-country]");
      link?.addEventListener("click", () => {
        els.country.value = country;
        renderAll();
        els.stream.focus({ preventScroll: true });
      }, { once: true });
    });
    marker.addTo(state.newsLayer);
  });

  state.earthquakes.forEach((feature) => {
    const [lon, lat] = feature.geometry?.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const props = feature.properties || {};
    const marker = window.L.marker([lat, lon], { icon: markerIcon("quake"), keyboard: true });
    marker.bindPopup(`<b>M ${escapeHtml(props.mag ?? "?")}</b><br>${escapeHtml(props.place || "位置未知")}<br>${escapeHtml(relativeTime(new Date(props.time)))}${props.url ? `<br><a href="${escapeHtml(props.url)}" target="_blank" rel="noopener noreferrer">USGS 事件详情 ↗</a>` : ""}`);
    marker.addTo(state.quakeLayer);
  });
  applyMapLayer();
}

function applyMapLayer() {
  if (!state.map) return;
  const wantsNews = state.activeLayer === "all" || state.activeLayer === "news";
  const wantsQuakes = state.activeLayer === "all" || state.activeLayer === "quake";
  if (wantsNews && !state.map.hasLayer(state.newsLayer)) state.newsLayer.addTo(state.map);
  if (!wantsNews && state.map.hasLayer(state.newsLayer)) state.map.removeLayer(state.newsLayer);
  if (wantsQuakes && !state.map.hasLayer(state.quakeLayer)) state.quakeLayer.addTo(state.map);
  if (!wantsQuakes && state.map.hasLayer(state.quakeLayer)) state.map.removeLayer(state.quakeLayer);
}

function updateClock() {
  const now = new Date();
  document.querySelector("#utc-clock").textContent = now.toLocaleTimeString("zh-CN", {
    timeZone: "UTC", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  document.querySelector("#utc-date").textContent = now.toLocaleDateString("zh-CN", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  });
}

let searchTimer;
els.search.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    renderAll();
  }, 180);
});
els.search.addEventListener("search", () => renderAll());
els.search.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadData({ manual: true });
});
els.country.addEventListener("change", renderAll);
els.category.addEventListener("change", () => loadData({ manual: true }));
els.time.addEventListener("change", () => loadData({ manual: true }));
els.refresh.addEventListener("click", () => loadData({ manual: true }));
els.reset.addEventListener("click", () => {
  els.search.value = "";
  els.country.value = "all";
  els.category.value = "all";
  els.time.value = "1d";
  loadData({ manual: true });
});

document.querySelectorAll("[data-layer]").forEach((button) => {
  button.addEventListener("click", () => {
    state.activeLayer = button.dataset.layer;
    document.querySelectorAll("[data-layer]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    applyMapLayer();
  });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !state.fetchedAt) return;
  if (Date.now() - state.fetchedAt.valueOf() >= AUTO_REFRESH_MS) loadData();
});

document.querySelector("#footer-year").textContent = new Date().getFullYear();
updateClock();
window.setInterval(updateClock, 1000);
window.setInterval(() => loadData(), AUTO_REFRESH_MS);

const mapObserver = new IntersectionObserver((entries, observer) => {
  if (!entries.some((entry) => entry.isIntersecting)) return;
  observer.disconnect();
  const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 200));
  schedule(initMap);
}, { rootMargin: "200px" });
mapObserver.observe(els.mapStage);

async function bootstrapData() {
  const cached = readCache() || await readSeedCache();
  if (cached) {
    populateCountryFilter();
    renderAll();
    setStatus("正在显示最近成功获取的内容，同时检查最新数据", "cached");
  }
  loadData();
}

bootstrapData();
