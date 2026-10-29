import { api, uploadBytes } from "./auth-client.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const MAP_STYLES = Object.freeze({
  globe: "https://tiles.openfreemap.org/styles/liberty",
  soft: "https://tiles.openfreemap.org/styles/positron",
  terrain: "https://tiles.openfreemap.org/styles/liberty",
});
const TERRAIN_TILEJSON = "https://tiles.mapterhorn.com/tilejson.json";
const LOCAL_PLACES = Object.freeze([
  { aliases: ["日本", "japan"], name: "日本", nameZh: "日本", nameEn: "Japan", label: "日本 · Japan", longitude: 138.2529, latitude: 36.2048, sourceId: "alias:JP", countryCode: "JP", type: "country" },
  { aliases: ["中国", "中國", "china"], name: "中国", nameZh: "中国", nameEn: "China", label: "中国 · China", longitude: 104.1954, latitude: 35.8617, sourceId: "alias:CN", countryCode: "CN", type: "country" },
  { aliases: ["美国", "美國", "usa", "us", "united states"], name: "美国", nameZh: "美国", nameEn: "United States", label: "美国 · United States", longitude: -98.5795, latitude: 39.8283, sourceId: "alias:US", countryCode: "US", type: "country" },
  { aliases: ["英国", "英國", "uk", "united kingdom"], name: "英国", nameZh: "英国", nameEn: "United Kingdom", label: "英国 · United Kingdom", longitude: -3.436, latitude: 55.3781, sourceId: "alias:GB", countryCode: "GB", type: "country" },
  { aliases: ["法国", "法國", "france"], name: "法国", nameZh: "法国", nameEn: "France", label: "法国 · France", longitude: 2.2137, latitude: 46.2276, sourceId: "alias:FR", countryCode: "FR", type: "country" },
  { aliases: ["东京", "東京", "tokyo"], name: "东京", nameZh: "东京", nameEn: "Tokyo", label: "东京，日本 · Tokyo, Japan", longitude: 139.6917, latitude: 35.6895, sourceId: "alias:Tokyo-JP", countryCode: "JP", type: "city" },
  { aliases: ["巴黎", "paris"], name: "巴黎", nameZh: "巴黎", nameEn: "Paris", label: "巴黎，法国 · Paris, France", longitude: 2.3522, latitude: 48.8566, sourceId: "alias:Paris-FR", countryCode: "FR", type: "city" },
  { aliases: ["巴塞罗那", "巴塞羅那", "barcelona"], name: "巴塞罗那", nameZh: "巴塞罗那", nameEn: "Barcelona", label: "巴塞罗那，西班牙 · Barcelona, Spain", longitude: 2.1734, latitude: 41.3851, sourceId: "alias:Barcelona-ES", countryCode: "ES", type: "city" },
]);

let places = [];
let mounted = false;
let authState = null;
let notify = () => {};
let placeFilter = "all";
let activePlace = null;
let editingPlaceId = null;
let selectedLocation = null;
let mapInstance = null;
let mapModule = null;
let mapPromise = null;
let mapMarkers = [];
let searchMarker = null;
let mapEngine = null;
let mapMode = "globe";
let searchPending = false;
let searchTimer = null;
let searchSequence = 0;
let pendingPhotoFile = null;
let removePhotoRequested = false;
let previewObjectUrl = "";

function setStatus(message = "", isError = false) {
  const node = $("#footprints-status");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("is-error", isError);
  node.hidden = !message;
}

function formatDate(value, status) {
  if (!value) return status === "visited" ? "日期未填写" : "尚未计划日期";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

function placeZoom(place) {
  if (place.placeType === "country" || place.type === "country") return 4.3;
  if (["city", "town", "municipality", "place"].includes(place.placeType || place.type)) return 8.5;
  return 12.5;
}

function filteredPlaces() {
  return places.filter((place) => placeFilter === "all" || place.status === placeFilter);
}

function closeSearchResults() {
  const box = $("#geocode-results");
  box.hidden = true;
  box.replaceChildren();
}

function renderPlaces() {
  const items = filteredPlaces();
  renderPlaceCards(items);
  const visited = places.filter((place) => place.status === "visited").length;
  const wish = places.filter((place) => place.status === "wish").length;
  const countries = new Set(places.map((place) => place.countryCode).filter(Boolean)).size;
  $("#footprints-visited-count").textContent = String(visited);
  $("#footprints-wish-count").textContent = String(wish);
  $("#footprints-country-count").textContent = String(countries);
  $("#footprints-total-count").textContent = String(places.length);
  syncMapMarkers();
}

function makeCardImage(place) {
  const media = document.createElement("div");
  media.className = "fp-card-media";
  if (place.imageUrl) {
    const image = document.createElement("img");
    image.src = place.imageUrl;
    image.alt = `${place.name} 的旅行照片`;
    image.loading = "lazy";
    image.decoding = "async";
    media.append(image);
  } else {
    media.innerHTML = '<span aria-hidden="true">⌖</span><small>PRIVATE JOURNEY</small>';
  }
  return media;
}

function renderPlaceCards(items) {
  const container = $("#footprint-cards");
  if (!container) return;
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "footprint-empty-card";
    empty.innerHTML = `
      <span class="fp-empty-badge" aria-hidden="true">◎</span>
      <h4>${places.length ? "这个分类还没有记录" : "还没有旅行足迹"}</h4>
      <p>${places.length ? "切换其他分类，或继续添加新的地方。" : "搜索一个真实地点，记录去过的风景或收藏下一段旅程。"}</p>
      <button type="button" class="btn-primary-pill">＋ 添加地点</button>`;
    empty.querySelector("button").addEventListener("click", () => $("#place-search").focus());
    container.replaceChildren(empty);
    return;
  }

  container.replaceChildren(...items.map((place) => {
    const card = document.createElement("article");
    card.className = `footprint-card${activePlace === place.id ? " is-active" : ""}`;
    card.dataset.status = place.status;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `查看 ${place.name} 的旅行记录`);
    const body = document.createElement("div");
    body.className = "fp-card-body";
    body.innerHTML = `
      <div class="fp-card-header"><span class="fp-status-tag"></span><time class="fp-card-date"></time></div>
      <h4 class="fp-card-title"></h4>
      <small class="fp-card-location"></small>
      <p class="fp-card-note"></p>`;
    const isVisited = place.status === "visited";
    body.querySelector(".fp-status-tag").className = `fp-status-tag ${isVisited ? "status-visited" : "status-wish"}`;
    body.querySelector(".fp-status-tag").textContent = isVisited ? "去过" : "想去";
    body.querySelector("time").textContent = formatDate(place.date, place.status);
    body.querySelector("h4").textContent = place.name;
    body.querySelector(".fp-card-location").textContent = place.nameEn && place.nameEn !== place.name ? place.nameEn : place.locationLabel;
    body.querySelector(".fp-card-note").textContent = place.note || "还没有备注。";
    card.append(makeCardImage(place), body);
    const open = () => showPlace(place.id);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    return card;
  }));
}

function clearSearchMarker() {
  if (!searchMarker) return;
  if (mapEngine === "maplibre") searchMarker.remove();
  else if (mapEngine === "leaflet") searchMarker.removeFrom(mapInstance);
  searchMarker = null;
}

function markerElement(place, preview = false) {
  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = `map-pin${preview ? " is-preview" : ""}${activePlace === place.id ? " active" : ""}`;
  pin.dataset.status = place.status || "wish";
  pin.setAttribute("aria-label", preview ? `搜索结果：${place.name}` : `${place.name}，${place.status === "visited" ? "去过" : "想去"}`);
  return pin;
}

function syncMapMarkers() {
  mapMarkers.forEach((marker) => mapEngine === "leaflet" ? marker.removeFrom(mapInstance) : marker.remove());
  mapMarkers = [];
  if (!mapInstance) return;
  filteredPlaces().forEach((place) => {
    if (mapEngine === "maplibre" && mapModule) {
      const pin = markerElement(place);
      pin.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showPlace(place.id);
      });
      mapMarkers.push(new mapModule.Marker({ element: pin, anchor: "center" })
        .setLngLat([place.longitude, place.latitude])
        .addTo(mapInstance));
    } else if (mapEngine === "leaflet" && window.L) {
      const marker = window.L.circleMarker([place.latitude, place.longitude], {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: place.status === "visited" ? "#738B7B" : "#D9A58C",
        fillOpacity: 1,
      }).addTo(mapInstance).on("click", () => showPlace(place.id));
      mapMarkers.push(marker);
    }
  });
}

function flyToLocation(location, { detail = false } = {}) {
  if (!mapInstance) return;
  const zoom = placeZoom(location);
  if (mapEngine === "maplibre") {
    mapInstance.flyTo({
      center: [location.longitude, location.latitude],
      zoom,
      bearing: 0,
      pitch: mapMode === "terrain" && detail ? 58 : 0,
      duration: reducedMotion() ? 0 : 1_300,
      essential: false,
    });
  } else {
    mapInstance.flyTo([location.latitude, location.longitude], Math.min(zoom, 13), { duration: reducedMotion() ? 0 : 1.1 });
  }
}

function hidePlaceDetail() {
  $("#place-detail").hidden = true;
  activePlace = null;
  renderPlaceCards(filteredPlaces());
  syncMapMarkers();
}

function detailAction(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function showPlace(id) {
  clearSearchMarker();
  activePlace = id;
  const place = places.find((item) => item.id === id);
  const box = $("#place-detail");
  if (!place) {
    hidePlaceDetail();
    return;
  }
  box.replaceChildren();
  if (place.imageUrl) {
    const image = document.createElement("img");
    image.className = "place-detail-photo";
    image.src = place.imageUrl;
    image.alt = `${place.name} 的旅行照片`;
    box.append(image);
  }
  const header = document.createElement("header");
  header.innerHTML = '<span><p class="overline"></p><h3></h3></span><button type="button" aria-label="关闭">×</button>';
  header.querySelector(".overline").textContent = place.status === "visited" ? "VISITED" : "WISH LIST";
  header.querySelector("h3").textContent = place.name;
  header.querySelector("button").addEventListener("click", hidePlaceDetail);
  const state = document.createElement("span");
  state.className = "place-state";
  state.textContent = place.status === "visited" ? "去过 · VISITED" : "想去 · WISH LIST";
  const location = document.createElement("p");
  location.className = "place-location";
  location.textContent = place.locationLabel;
  const note = document.createElement("p");
  note.className = "place-note";
  note.textContent = place.note || "还没有备注。";
  const footer = document.createElement("footer");
  const time = document.createElement("time");
  time.textContent = formatDate(place.date, place.status);
  const actions = document.createElement("span");
  actions.className = "place-actions";
  actions.append(
    detailAction("编辑", "under", () => openPlaceDialog(place)),
    detailAction("删除", "under danger", () => deletePlace(place)),
  );
  footer.append(time, actions);
  box.append(header, state, location, note, footer);
  box.hidden = false;
  renderPlaceCards(filteredPlaces());
  syncMapMarkers();
  flyToLocation(place, { detail: true });
}

function showSearchLocation(result) {
  selectedLocation = result;
  activePlace = null;
  clearSearchMarker();
  flyToLocation(result);
  if (mapEngine === "maplibre" && mapModule) {
    searchMarker = new mapModule.Marker({ element: markerElement(result, true), anchor: "center" })
      .setLngLat([result.longitude, result.latitude])
      .addTo(mapInstance);
  } else if (mapEngine === "leaflet" && window.L) {
    searchMarker = window.L.circleMarker([result.latitude, result.longitude], {
      radius: 9, color: "#fff", weight: 3, fillColor: "#D9A58C", fillOpacity: 1,
    }).addTo(mapInstance);
  }
  const box = $("#place-detail");
  box.innerHTML = '<header><span><p class="overline">SEARCH RESULT</p><h3></h3></span><button type="button" aria-label="关闭">×</button></header><span class="place-state">真实地理位置</span><p class="place-location"></p><p class="place-note"></p><footer><span></span><span class="place-actions"></span></footer>';
  box.querySelector("h3").textContent = result.name;
  box.querySelector(".place-location").textContent = result.label;
  box.querySelector(".place-note").textContent = `${result.type || "place"}${result.countryCode ? ` · ${result.countryCode}` : ""}`;
  box.querySelector(".place-actions").append(
    detailAction("标记为去过", "under", () => openPlaceDialog(null, result, "visited")),
    detailAction("加入想去", "under", () => openPlaceDialog(null, result, "wish")),
  );
  box.querySelector("header button").addEventListener("click", () => {
    box.hidden = true;
    clearSearchMarker();
  });
  box.hidden = false;
}

function showWorld(animated = true) {
  if (!mapInstance) return;
  hidePlaceDetail();
  clearSearchMarker();
  if (mapEngine === "maplibre") {
    mapInstance.flyTo({ center: [18, 22], zoom: 1.15, bearing: 0, pitch: 0, duration: !animated || reducedMotion() ? 0 : 1_100 });
  } else {
    mapInstance.setView([22, 18], 2, { animate: animated && !reducedMotion() });
  }
}

function setModeButtons(mode, fallback = false) {
  $$('[data-map-mode]').forEach((button) => {
    const active = button.dataset.mapMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = fallback && button.dataset.mapMode !== "soft";
  });
  $("#map-mode-switch").classList.toggle("is-fallback", fallback);
}

async function waitForStyleLoad() {
  if (mapInstance.isStyleLoaded()) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("地图样式响应超时")), 15_000);
    mapInstance.once("style.load", () => { clearTimeout(timer); resolve(); });
    mapInstance.once("error", (event) => {
      if (!mapInstance.isStyleLoaded()) { clearTimeout(timer); reject(event.error || new Error("地图样式加载失败")); }
    });
  });
}

function configureMapMode(mode) {
  if (!mapInstance || mapEngine !== "maplibre") return;
  try { mapInstance.setTerrain(null); } catch { /* no terrain attached */ }
  if (mode === "globe") {
    mapInstance.setProjection({ type: "globe" });
    if (typeof mapInstance.setSky === "function") {
      try {
        mapInstance.setSky({
          "sky-color": "#dce7e2",
          "sky-horizon-blend": 0.07,
          "horizon-color": "#edf2ed",
          "horizon-fog-blend": 0.08,
          "fog-color": "#f8f7f2",
          "fog-ground-blend": 0.15,
        });
      } catch { /* atmosphere is optional across MapLibre builds */ }
    }
  } else {
    mapInstance.setProjection({ type: "mercator" });
  }
  if (mode === "terrain") {
    if (!mapInstance.getSource("xc-terrain")) {
      mapInstance.addSource("xc-terrain", { type: "raster-dem", url: TERRAIN_TILEJSON, tileSize: 256 });
    }
    if (!mapInstance.getSource("xc-hillshade-dem")) {
      mapInstance.addSource("xc-hillshade-dem", { type: "raster-dem", url: TERRAIN_TILEJSON, tileSize: 256 });
    }
    if (!mapInstance.getLayer("xc-hillshade")) {
      const firstSymbol = mapInstance.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
      mapInstance.addLayer({
        id: "xc-hillshade",
        type: "hillshade",
        source: "xc-hillshade-dem",
        paint: { "hillshade-exaggeration": 0.38, "hillshade-shadow-color": "#526D59", "hillshade-highlight-color": "#f7f3e8" },
      }, firstSymbol);
    }
    mapInstance.setTerrain({ source: "xc-terrain", exaggeration: 1.25 });
  }
  syncMapMarkers();
}

async function setMapMode(mode, { resetView = false } = {}) {
  if (!MAP_STYLES[mode] || mapEngine !== "maplibre" || !mapInstance) return;
  mapMode = mode;
  setModeButtons(mode);
  const nextStyle = MAP_STYLES[mode];
  if (mapInstance.getStyle()?.sprite?.includes(mode === "soft" ? "positron" : "liberty")) {
    configureMapMode(mode);
  } else {
    mapInstance.setStyle(nextStyle);
    await waitForStyleLoad();
    configureMapMode(mode);
  }
  if (resetView) showWorld();
  else if (activePlace) showPlace(activePlace);
}

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!document.querySelector('link[data-xc-leaflet]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    link.dataset.xcLeaflet = "true";
    document.head.append(link);
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("二维地图组件加载失败"));
    document.head.append(script);
  });
}

async function initFallbackMap(reason) {
  const container = $("#footprints-map");
  container.replaceChildren();
  const L = await loadLeaflet();
  mapEngine = "leaflet";
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
  mapInstance = L.map(container, {
    zoomControl: true,
    worldCopyJump: true,
    dragging: !coarsePointer,
    touchZoom: true,
    scrollWheelZoom: !coarsePointer,
  }).setView([22, 18], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(mapInstance);
  $("#map-loading").hidden = true;
  $("#map-error").hidden = true;
  container.classList.add("ready", "is-fallback");
  $("#map-attribution-note").textContent = `二维回退地图 · ${reason || "WebGL 不可用"} · © OpenStreetMap contributors`;
  setModeButtons("soft", true);
  syncMapMarkers();
  return mapInstance;
}

async function initMap(force = false) {
  if (mapInstance && !force) {
    mapInstance.invalidateSize?.();
    mapInstance.resize?.();
    return mapInstance;
  }
  if (mapPromise && !force) return mapPromise;
  if (force && mapInstance) {
    mapMarkers.forEach((marker) => mapEngine === "leaflet" ? marker.removeFrom(mapInstance) : marker.remove());
    mapMarkers = [];
    clearSearchMarker();
    mapInstance.remove();
    mapInstance = null;
    mapEngine = null;
  }
  const loading = $("#map-loading");
  const errorBox = $("#map-error");
  loading.hidden = false;
  errorBox.hidden = true;
  $("#footprints-map").classList.remove("ready", "is-fallback");
  mapPromise = (async () => {
    try {
      mapModule = await import("https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.mjs");
      if (typeof mapModule.supported === "function" && !mapModule.supported()) throw new Error("当前浏览器不支持 WebGL");
      mapEngine = "maplibre";
      mapInstance = new mapModule.Map({
        container: "footprints-map",
        style: MAP_STYLES.globe,
        center: [18, 22],
        zoom: 1.15,
        minZoom: 0,
        maxZoom: 17,
        renderWorldCopies: false,
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
        cooperativeGestures: true,
      });
      mapInstance.addControl(new mapModule.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), "top-right");
      mapInstance.addControl(new mapModule.AttributionControl({ compact: true }), "bottom-right");
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("3D 地图服务响应超时")), 18_000);
        mapInstance.once("load", () => { window.clearTimeout(timer); resolve(); });
        mapInstance.once("error", (event) => {
          if (!mapInstance.loaded()) { window.clearTimeout(timer); reject(event.error || new Error("3D 地图资源加载失败")); }
        });
      });
      configureMapMode("globe");
      loading.hidden = true;
      $("#footprints-map").classList.add("ready");
      mapInstance.resize();
      setModeButtons("globe");
      syncMapMarkers();
      return mapInstance;
    } catch (error) {
      console.error("Footprints 3D map failed, using 2D fallback:", error);
      try {
        mapInstance?.remove();
        mapInstance = null;
        return await initFallbackMap(error?.message);
      } catch (fallbackError) {
        console.error("Footprints fallback map failed:", fallbackError);
        loading.hidden = true;
        errorBox.hidden = false;
        $("#map-error-message").textContent = `${fallbackError?.message || "地图资源加载失败"}。请检查网络连接后重试。`;
        return null;
      }
    } finally {
      mapPromise = null;
    }
  })();
  return mapPromise;
}

async function loadFootprints() {
  setStatus("正在读取你的足迹…");
  try {
    const data = await api("/api/me/footprints");
    places = data.footprints || [];
    renderPlaces();
    setStatus(places.length ? `${places.length} 个私人地点` : "");
  } catch (error) {
    console.error("Footprints load failed:", error);
    places = [];
    renderPlaces();
    setStatus(error.message || "足迹加载失败，请稍后重试。", true);
  }
}

function renderSearchResults(results, { local = false } = {}) {
  const box = $("#geocode-results");
  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "geocode-empty";
    empty.textContent = local ? "按 Enter 或点击搜索，可查询全球更多地点与地址。" : "没有找到匹配地点，请尝试更具体的名称。";
    box.replaceChildren(empty);
  } else {
    box.replaceChildren(...results.map((result) => {
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = "<b></b><small></small><em></em>";
      button.querySelector("b").textContent = result.nameZh && result.nameEn ? `${result.nameZh} · ${result.nameEn}` : result.name;
      button.querySelector("small").textContent = result.label;
      button.querySelector("em").textContent = `${result.type || "place"}${result.countryCode ? ` · ${result.countryCode}` : ""}`;
      button.addEventListener("click", () => {
        $("#place-search").value = result.nameZh || result.name;
        $("#place-search-clear").hidden = false;
        closeSearchResults();
        showSearchLocation(result);
      });
      return button;
    }));
  }
  box.dataset.local = String(local);
  box.hidden = false;
}

function localSuggestions(query) {
  const normalized = query.trim().toLocaleLowerCase("en-US");
  if (!normalized) return [];
  return LOCAL_PLACES.filter((place) => place.aliases.some((alias) => alias.startsWith(normalized) || normalized.startsWith(alias))).slice(0, 5);
}

function queueLocalSuggestions() {
  window.clearTimeout(searchTimer);
  const input = $("#place-search");
  $("#place-search-clear").hidden = !input.value;
  searchTimer = window.setTimeout(() => {
    const query = input.value.trim();
    if (!query) {
      closeSearchResults();
      return;
    }
    renderSearchResults(localSuggestions(query), { local: true });
  }, 300);
}

async function searchPlaces(event) {
  event?.preventDefault();
  if (searchPending) return;
  const query = $("#place-search").value.trim();
  if (query.length < 2) {
    notify("请至少输入两个字符再搜索。", true);
    $("#place-search").focus();
    return;
  }
  const local = localSuggestions(query).find((item) => item.aliases.includes(query.toLocaleLowerCase("en-US")));
  if (local) {
    renderSearchResults([local], { local: true });
    showSearchLocation(local);
    setStatus("已定位到规范化地点");
    return;
  }
  searchPending = true;
  const sequence = ++searchSequence;
  const submit = $("#place-search-form button[type=submit]");
  submit.disabled = true;
  submit.textContent = "搜索中";
  closeSearchResults();
  setStatus("正在搜索真实地点…");
  try {
    const data = await api(`/api/me/footprints/search?q=${encodeURIComponent(query)}`);
    if (sequence !== searchSequence) return;
    renderSearchResults(data.results || []);
    setStatus(data.cached ? "显示缓存的地点搜索结果" : "地点搜索完成");
  } catch (error) {
    console.error("Geocoding search failed:", error);
    setStatus(error.message || "地点搜索失败，请稍后重试。", true);
    const box = $("#geocode-results");
    box.innerHTML = '<p class="geocode-empty">搜索服务暂时不可用。</p><button type="button" class="geocode-retry">重新搜索</button>';
    box.querySelector("button").addEventListener("click", () => searchPlaces());
    box.hidden = false;
  } finally {
    searchPending = false;
    submit.disabled = false;
    submit.textContent = "搜索";
  }
}

function releasePreviewUrl() {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = "";
}

function setPhotoPreview(source = "") {
  const image = $("#place-photo-preview");
  const placeholder = $("#place-photo-placeholder");
  image.hidden = !source;
  placeholder.hidden = Boolean(source);
  if (source) image.src = source;
  else image.removeAttribute("src");
}

function openPlaceDialog(place = null, location = null, defaultStatus = "wish") {
  editingPlaceId = place?.id || null;
  selectedLocation = location || (place ? {
    name: place.name,
    nameZh: place.nameZh,
    nameEn: place.nameEn,
    label: place.locationLabel,
    longitude: place.longitude,
    latitude: place.latitude,
    sourceId: place.sourceId,
    countryCode: place.countryCode,
    type: place.placeType,
  } : selectedLocation);
  if (!editingPlaceId && !selectedLocation) {
    notify("请先搜索并选择一个真实地点。", true);
    $("#place-search").focus();
    return;
  }
  releasePreviewUrl();
  pendingPhotoFile = null;
  removePhotoRequested = false;
  $("#place-photo").value = "";
  setPhotoPreview(place?.imageUrl || "");
  $("#remove-place-photo").hidden = !place?.imageUrl;
  $("#place-dialog-title").textContent = place ? "编辑足迹" : "添加足迹";
  $("#place-name").value = place?.name || selectedLocation.name;
  $("#place-status").value = place?.status || defaultStatus;
  $("#place-date").value = place?.date || "";
  $("#place-note").value = place?.note || "";
  $("#place-location-label").textContent = place?.locationLabel || selectedLocation.label;
  $("#delete-place").hidden = !place;
  $("#save-place").textContent = place ? "保存修改" : "保存足迹";
  $("#place-dialog").showModal();
}

async function compressPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1280;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  let width = Math.max(1, Math.round(bitmap.width * scale));
  let height = Math.max(1, Math.round(bitmap.height * scale));
  let quality = 0.82;
  let blob = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, width, height);
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (blob && blob.size <= 700 * 1024) break;
    quality -= 0.1;
    width = Math.round(width * 0.84);
    height = Math.round(height * 0.84);
  }
  bitmap.close();
  if (!blob || blob.size > 700 * 1024) throw new Error("照片压缩后仍然过大，请选择尺寸更小的图片");
  return blob;
}

async function savePlace(event) {
  event.preventDefault();
  const previousEditingId = editingPlaceId;
  const place = editingPlaceId ? places.find((item) => item.id === editingPlaceId) : null;
  const location = selectedLocation || (place ? {
    longitude: place.longitude, latitude: place.latitude, label: place.locationLabel, sourceId: place.sourceId,
    nameZh: place.nameZh, nameEn: place.nameEn, countryCode: place.countryCode, type: place.placeType,
  } : null);
  if (!location) {
    notify("请重新搜索并选择地点。", true);
    return;
  }
  const payload = {
    name: $("#place-name").value,
    locationLabel: location.label || place?.locationLabel || "",
    status: $("#place-status").value,
    date: $("#place-date").value,
    note: $("#place-note").value,
    longitude: location.longitude,
    latitude: location.latitude,
    geocoder: location.sourceId?.startsWith("alias:") ? "local-alias" : "nominatim",
    sourceId: location.sourceId || null,
    nameZh: location.nameZh || null,
    nameEn: location.nameEn || null,
    countryCode: location.countryCode || null,
    placeType: location.type || "place",
  };
  const save = $("#save-place");
  save.disabled = true;
  save.textContent = "保存中…";
  try {
    let data = editingPlaceId
      ? await api(`/api/me/footprints/${encodeURIComponent(editingPlaceId)}`, { method: "PATCH", csrfToken: authState.csrfToken, body: payload })
      : await api("/api/me/footprints", { method: "POST", csrfToken: authState.csrfToken, body: payload });
    let saved = data.footprint;
    if (removePhotoRequested && saved.imageUrl) {
      await api(`/api/me/footprints/${encodeURIComponent(saved.id)}/photo`, { method: "DELETE", csrfToken: authState.csrfToken, body: {} });
      saved = { ...saved, photoId: null, imageUrl: null };
    }
    if (pendingPhotoFile) {
      const compressed = await compressPhoto(pendingPhotoFile);
      data = await uploadBytes(`/api/me/footprints/${encodeURIComponent(saved.id)}/photo`, {
        method: "PUT",
        bytes: compressed,
        contentType: compressed.type,
        csrfToken: authState.csrfToken,
      });
      saved = data.footprint;
    }
    const index = places.findIndex((item) => item.id === saved.id);
    if (index === -1) places.unshift(saved);
    else places.splice(index, 1, saved);
    $("#place-dialog").close();
    closeSearchResults();
    renderPlaces();
    showPlace(saved.id);
    notify(previousEditingId ? "足迹已更新" : "足迹已保存");
    setStatus(`${places.length} 个私人地点`);
    window.dispatchEvent(new CustomEvent("xc:data-changed", { detail: { source: "footprints" } }));
  } catch (error) {
    console.error("Footprint save failed:", error);
    notify(error.message || "足迹保存失败。", true);
  } finally {
    save.disabled = false;
    save.textContent = editingPlaceId ? "保存修改" : "保存足迹";
  }
}

async function deletePlace(place = places.find((item) => item.id === editingPlaceId)) {
  if (!place || !window.confirm(`确定删除“${place.name}”吗？`)) return;
  try {
    await api(`/api/me/footprints/${encodeURIComponent(place.id)}`, {
      method: "DELETE", csrfToken: authState.csrfToken, body: {},
    });
    places = places.filter((item) => item.id !== place.id);
    if ($("#place-dialog").open) $("#place-dialog").close();
    hidePlaceDetail();
    renderPlaces();
    setStatus(places.length ? `${places.length} 个私人地点` : "");
    notify("足迹已删除");
    window.dispatchEvent(new CustomEvent("xc:data-changed", { detail: { source: "footprints" } }));
  } catch (error) {
    console.error("Footprint delete failed:", error);
    notify(error.message || "足迹删除失败。", true);
  }
}

export async function mountFootprints(nextAuthState, options = {}) {
  authState = nextAuthState;
  notify = options.notify || notify;
  if (!mounted) {
    mounted = true;
    $("#place-search-form").addEventListener("submit", searchPlaces);
    $("#place-search").addEventListener("input", queueLocalSuggestions);
    $("#place-search-clear").addEventListener("click", () => {
      $("#place-search").value = "";
      $("#place-search-clear").hidden = true;
      selectedLocation = null;
      closeSearchResults();
      clearSearchMarker();
      $("#place-search").focus();
    });
    $$('[data-filter]').forEach((button) => button.addEventListener("click", () => {
      placeFilter = button.dataset.filter;
      $$('[data-filter]').forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", String(active));
      });
      renderPlaces();
    }));
    $$('[data-map-mode]').forEach((button) => button.addEventListener("click", () => setMapMode(button.dataset.mapMode, { resetView: true }).catch((error) => {
      console.error("Map mode failed:", error);
      notify("地图模式切换失败，请重试。", true);
    })));
    $("#add-place").addEventListener("click", () => {
      if (selectedLocation) openPlaceDialog(null, selectedLocation);
      else if ($("#place-search").value.trim().length >= 2) searchPlaces();
      else {
        notify("先搜索国家、城市或地点，再从结果中选择。", true);
        $("#place-search").focus();
      }
    });
    $("#place-photo").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      pendingPhotoFile = file;
      removePhotoRequested = false;
      releasePreviewUrl();
      previewObjectUrl = URL.createObjectURL(file);
      setPhotoPreview(previewObjectUrl);
      $("#remove-place-photo").hidden = false;
    });
    $("#remove-place-photo").addEventListener("click", () => {
      pendingPhotoFile = null;
      removePhotoRequested = true;
      $("#place-photo").value = "";
      releasePreviewUrl();
      setPhotoPreview("");
      $("#remove-place-photo").hidden = true;
    });
    $("#place-dialog").addEventListener("close", releasePreviewUrl);
    $("#place-form").addEventListener("submit", savePlace);
    $("#delete-place").addEventListener("click", () => deletePlace());
    $("#world-view").addEventListener("click", () => showWorld());
    $("#retry-map").addEventListener("click", () => initMap(true));
  }
  await Promise.all([loadFootprints(), initMap()]);
}
