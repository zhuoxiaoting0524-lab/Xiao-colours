import { api } from "./auth-client.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

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
let searchPending = false;

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
  const list = $("#place-list");
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "place-empty";
    empty.textContent = places.length ? "这个分类还没有足迹。" : "还没有足迹，先搜索一个地点吧。";
    list.replaceChildren(empty);
  } else {
    list.replaceChildren(...items.map((place) => {
      const button = document.createElement("button");
      button.className = "place";
      button.type = "button";
      button.dataset.status = place.status;
      button.innerHTML = "<span><b></b><small></small></span><i></i>";
      button.querySelector("b").textContent = place.name;
      button.querySelector("small").textContent = place.locationLabel || formatDate(place.date, place.status);
      button.addEventListener("click", () => showPlace(place.id));
      return button;
    }));
  }
  renderPlaceCards(items);
  const visited = places.filter((place) => place.status === "visited").length;
  const wish = places.filter((place) => place.status === "wish").length;
  $("#footprints-visited-count").textContent = String(visited);
  $("#footprints-wish-count").textContent = String(wish);
  $("#footprints-total-count").textContent = String(places.length);
  syncMapMarkers();
}

function renderPlaceCards(items) {
  const container = $("#footprint-cards");
  if (!container) return;
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "footprint-empty-card";
    empty.innerHTML = `
      <span class="fp-empty-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
      </span>
      <h4>还没有足迹</h4>
      <p>先添加一个地点吧，记录你去过的地方，或收藏想去的目的地。</p>
      <button type="button" class="btn-primary-pill" id="fp-empty-add-btn">＋ 添加地点</button>
    `;
    empty.querySelector("#fp-empty-add-btn").addEventListener("click", () => {
      const search = $("#place-search");
      if (search) {
        search.focus();
        notify("在上方搜索框输入城市或地点名称开始记录");
      }
    });
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...items.map((place) => {
    const card = document.createElement("article");
    card.className = "footprint-card";
    card.dataset.status = place.status;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    const isVisited = place.status === "visited";
    card.innerHTML = `
      <div class="fp-card-header">
        <span class="fp-status-tag ${isVisited ? "status-visited" : "status-wish"}">${isVisited ? "去过 · VISITED" : "想去 · WISH"}</span>
        <time class="fp-card-date">${formatDate(place.date, place.status)}</time>
      </div>
      <h4 class="fp-card-title">${place.name}</h4>
      <p class="fp-card-note">${place.note || place.locationLabel || "还没有备注。"}</p>
    `;
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

function syncMapMarkers() {
  mapMarkers.forEach((marker) => marker.remove());
  mapMarkers = [];
  if (!mapInstance || !mapModule) return;
  filteredPlaces().forEach((place) => {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = `map-pin${activePlace === place.id ? " active" : ""}`;
    pin.dataset.status = place.status;
    pin.setAttribute("aria-label", `${place.name}，${place.status === "visited" ? "去过" : "想去"}`);
    pin.addEventListener("pointerdown", (event) => event.stopPropagation());
    pin.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showPlace(place.id);
    });
    mapMarkers.push(new mapModule.Marker({ element: pin, anchor: "center" })
      .setLngLat([place.longitude, place.latitude])
      .addTo(mapInstance));
  });
}

function hidePlaceDetail() {
  $("#place-detail").hidden = true;
  activePlace = null;
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
  activePlace = id;
  const place = places.find((item) => item.id === id);
  const box = $("#place-detail");
  if (!place) {
    hidePlaceDetail();
    return;
  }
  box.innerHTML = '<header><span><p class="overline"></p><h3></h3></span><button type="button" aria-label="关闭">×</button></header><span class="place-state"></span><p class="place-location"></p><p class="place-note"></p><footer><time></time><span class="place-actions"></span></footer>';
  box.querySelector(".overline").textContent = place.status === "visited" ? "VISITED" : "WISH LIST";
  box.querySelector("h3").textContent = place.name;
  box.querySelector(".place-state").textContent = place.status === "visited" ? "去过 · VISITED" : "想去 · WISH LIST";
  box.querySelector(".place-location").textContent = place.locationLabel;
  box.querySelector(".place-note").textContent = place.note || "还没有备注。";
  box.querySelector("time").textContent = formatDate(place.date, place.status);
  box.querySelector(".place-actions").append(
    detailAction("编辑", "under", () => openPlaceDialog(place)),
    detailAction("删除", "under danger", () => deletePlace(place)),
  );
  box.querySelector("header button").addEventListener("click", hidePlaceDetail);
  box.hidden = false;
  syncMapMarkers();
  if (mapInstance) {
    mapInstance.flyTo({
      center: [place.longitude, place.latitude],
      zoom: 11.5,
      bearing: 0,
      pitch: 0,
      duration: matchMedia("(prefers-reduced-motion:reduce)").matches ? 0 : 1_350,
    });
  }
}

function showWorld(animated = true) {
  if (!mapInstance) return;
  hidePlaceDetail();
  mapInstance.fitBounds([[-170, -55], [170, 76]], {
    padding: 18,
    bearing: 0,
    pitch: 0,
    duration: !animated || matchMedia("(prefers-reduced-motion:reduce)").matches ? 0 : 1_100,
  });
}

async function initMap(force = false) {
  if (mapInstance && !force) {
    mapInstance.resize();
    return mapInstance;
  }
  if (mapPromise && !force) return mapPromise;
  if (force && mapInstance) {
    mapMarkers.forEach((marker) => marker.remove());
    mapMarkers = [];
    mapInstance.remove();
    mapInstance = null;
  }
  const loading = $("#map-loading");
  const errorBox = $("#map-error");
  loading.hidden = false;
  errorBox.hidden = true;
  $("#footprints-map").classList.remove("ready");
  mapPromise = (async () => {
    try {
      mapModule = await import("https://unpkg.com/maplibre-gl@6.15.0/dist/maplibre-gl.mjs");
      mapInstance = new mapModule.Map({
        container: "footprints-map",
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [8, 22],
        zoom: 1,
        minZoom: 0,
        maxZoom: 17,
        renderWorldCopies: false,
        attributionControl: true,
      });
      mapInstance.addControl(new mapModule.NavigationControl({ showCompass: true, showZoom: true }), "top-right");
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("地图服务响应超时")), 15_000);
        mapInstance.once("load", () => {
          window.clearTimeout(timer);
          resolve();
        });
        mapInstance.once("error", (event) => {
          if (!mapInstance.loaded()) {
            window.clearTimeout(timer);
            reject(event.error || new Error("地图资源加载失败"));
          }
        });
      });
      loading.hidden = true;
      $("#footprints-map").classList.add("ready");
      mapInstance.resize();
      showWorld(false);
      syncMapMarkers();
      return mapInstance;
    } catch (error) {
      console.error("Footprints map failed:", error);
      loading.hidden = true;
      errorBox.hidden = false;
      $("#map-error-message").textContent = `${error?.message || "地图资源加载失败"}。请检查网络连接后重试。`;
      if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
      }
      return null;
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

function renderSearchResults(results) {
  const box = $("#geocode-results");
  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "geocode-empty";
    empty.textContent = "没有找到匹配地点，请尝试更具体的名称。";
    box.replaceChildren(empty);
  } else {
    box.replaceChildren(...results.map((result) => {
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = "<b></b><small></small>";
      button.querySelector("b").textContent = result.name;
      button.querySelector("small").textContent = result.label;
      button.addEventListener("click", () => {
        selectedLocation = result;
        if (mapInstance) {
          mapInstance.flyTo({
            center: [result.longitude, result.latitude],
            zoom: 12,
            duration: matchMedia("(prefers-reduced-motion:reduce)").matches ? 0 : 1_100,
          });
        }
        openPlaceDialog(null, result);
      });
      return button;
    }));
  }
  box.hidden = false;
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
  searchPending = true;
  const submit = $("#place-search-form button[type=submit]");
  submit.disabled = true;
  submit.textContent = "搜索中";
  closeSearchResults();
  setStatus("正在搜索真实地点…");
  try {
    const data = await api(`/api/me/footprints/search?q=${encodeURIComponent(query)}`);
    renderSearchResults(data.results || []);
    setStatus(data.cached ? "显示缓存的地点搜索结果" : "地点搜索完成");
  } catch (error) {
    console.error("Geocoding search failed:", error);
    setStatus(error.message || "地点搜索失败，请稍后重试。", true);
  } finally {
    searchPending = false;
    submit.disabled = false;
    submit.textContent = "搜索";
  }
}

function openPlaceDialog(place = null, location = null) {
  editingPlaceId = place?.id || null;
  selectedLocation = location || (place ? {
    name: place.name,
    label: place.locationLabel,
    longitude: place.longitude,
    latitude: place.latitude,
    sourceId: place.sourceId,
  } : selectedLocation);
  if (!editingPlaceId && !selectedLocation) {
    notify("请先搜索并选择一个真实地点。", true);
    $("#place-search").focus();
    return;
  }
  $("#place-dialog-title").textContent = place ? "编辑足迹" : "添加足迹";
  $("#place-name").value = place?.name || selectedLocation.name;
  $("#place-status").value = place?.status || "wish";
  $("#place-date").value = place?.date || "";
  $("#place-note").value = place?.note || "";
  $("#place-location-label").textContent = place?.locationLabel || selectedLocation.label;
  $("#delete-place").hidden = !place;
  $("#save-place").textContent = place ? "保存修改" : "保存足迹";
  $("#place-dialog").showModal();
}

async function savePlace(event) {
  event.preventDefault();
  const place = editingPlaceId ? places.find((item) => item.id === editingPlaceId) : null;
  const location = selectedLocation || (place ? {
    longitude: place.longitude,
    latitude: place.latitude,
    label: place.locationLabel,
    sourceId: place.sourceId,
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
    geocoder: "nominatim",
    sourceId: location.sourceId || null,
  };
  const save = $("#save-place");
  save.disabled = true;
  save.textContent = "保存中…";
  try {
    const data = editingPlaceId
      ? await api(`/api/me/footprints/${encodeURIComponent(editingPlaceId)}`, { method: "PATCH", csrfToken: authState.csrfToken, body: payload })
      : await api("/api/me/footprints", { method: "POST", csrfToken: authState.csrfToken, body: payload });
    const saved = data.footprint;
    const index = places.findIndex((item) => item.id === saved.id);
    if (index === -1) places.unshift(saved);
    else places.splice(index, 1, saved);
    $("#place-dialog").close();
    closeSearchResults();
    renderPlaces();
    showPlace(saved.id);
    notify(editingPlaceId ? "足迹已更新" : "足迹已保存");
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
      method: "DELETE",
      csrfToken: authState.csrfToken,
      body: {},
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
    $$('[data-filter]').forEach((button) => button.addEventListener("click", () => {
      placeFilter = button.dataset.filter;
      $$('[data-filter]').forEach((item) => item.classList.toggle("active", item === button));
      renderPlaces();
    }));
    $("#add-place").addEventListener("click", () => {
      const query = $("#place-search").value.trim();
      if (query.length >= 2) searchPlaces();
      else {
        notify("先搜索城市或地点，再从结果中选择。", true);
        $("#place-search").focus();
      }
    });
    $("#place-form").addEventListener("submit", savePlace);
    $("#delete-place").addEventListener("click", () => deletePlace());
    $("#world-view").addEventListener("click", () => showWorld());
    $("#retry-map").addEventListener("click", () => initMap(true));
  }
  await Promise.all([loadFootprints(), initMap()]);
}
