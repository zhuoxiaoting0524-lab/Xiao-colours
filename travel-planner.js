import { api } from "./auth-client.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STATUS_LABELS = { planning: "规划中", upcoming: "即将出发", traveling: "旅行中", finished: "已结束" };
const TYPE_LABELS = { place: "景点", food: "餐饮", rest: "休息", transport: "交通", custom: "自定义" };
const CATEGORY_LABELS = { stay: "住宿", transport: "交通", food: "餐饮", activity: "门票与活动", shopping: "购物", other: "其他" };
const SECTION_LABELS = { before: "出发前", during: "旅行中", return: "返程前" };
const COVER_GRADIENTS = [
  "linear-gradient(135deg,#dce7df,#f7eadf)",
  "linear-gradient(135deg,#e6efe9,#dfe8f1)",
  "linear-gradient(135deg,#f5e9e2,#eee7d8)",
  "linear-gradient(135deg,#dbe8e5,#efe6ef)",
];

let auth = null;
let notify = () => {};
let mounted = false;
let trips = [];
let detail = null;
let selectedTripId = null;
let selectedDayId = null;
let activeTab = "itinerary";
let checklistSection = "before";
let editingTrip = null;
let map = null;
let mapModule = null;
let mapMarkers = [];
let dragActivityId = null;

function setStatus(message, error = false) {
  const node = $("#travel-status");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("is-error", error);
  node.hidden = !message;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function formatDate(value, options = {}) {
  if (!value) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", { year: options.year ? "numeric" : undefined, month: "numeric", day: "numeric", weekday: options.weekday ? "short" : undefined, timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function money(value, currency) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 2 }).format(Number(value || 0));
}

function tripCover(trip) {
  const hash = [...trip.destinationName].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return COVER_GRADIENTS[hash % COVER_GRADIENTS.length];
}

async function request(path, options = {}) {
  return api(path, { ...options, csrfToken: auth.csrfToken });
}

function renderTrips() {
  $("#travel-trip-count").textContent = String(trips.length);
  const list = $("#travel-trip-list");
  if (!trips.length) {
    list.innerHTML = '<div class="travel-sidebar-empty"><span>✈</span><p>还没有旅行计划</p><button type="button" data-travel-new>新建旅行</button></div>';
    list.querySelector("button")?.addEventListener("click", openTripDialog);
    return;
  }
  list.replaceChildren(...trips.map((trip) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `travel-trip-card${trip.id === selectedTripId ? " active" : ""}`;
    button.innerHTML = `<span class="travel-trip-cover" style="background:${tripCover(trip)}">${escapeHtml(trip.destinationName.slice(0, 1))}</span><span><strong>${escapeHtml(trip.name)}</strong><small>${escapeHtml(trip.destinationName)} · ${trip.dayCount} 天 ${trip.nightCount} 晚</small><em>${formatDate(trip.startDate)}—${formatDate(trip.endDate)}</em></span><i>${STATUS_LABELS[trip.status]}</i>`;
    button.addEventListener("click", () => selectTrip(trip.id));
    return button;
  }));
}

function renderDetail() {
  const empty = $("#travel-empty");
  const content = $("#travel-detail-content");
  if (!detail) {
    empty.hidden = false;
    content.hidden = true;
    return;
  }
  empty.hidden = true;
  content.hidden = false;
  const trip = detail.trip;
  $("#travel-detail-name").textContent = trip.name;
  $("#travel-detail-meta").textContent = `${trip.destinationName} · ${trip.dayCount} 天 ${trip.nightCount} 晚 · ${formatDate(trip.startDate, { year: true })}—${formatDate(trip.endDate, { year: true })}`;
  $("#travel-detail-status").textContent = STATUS_LABELS[trip.status];
  $(".travel-hero").style.background = tripCover(trip);
  renderDays();
  renderTimeline();
  renderSaved();
  renderInfo();
  renderBudget();
  renderChecklist();
  syncPanels();
}

function renderDays() {
  const days = $("#travel-days");
  if (!selectedDayId || !detail.days.some((day) => day.id === selectedDayId)) selectedDayId = detail.days[0]?.id || null;
  days.replaceChildren(...detail.days.map((day) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = day.id === selectedDayId ? "active" : "";
    button.innerHTML = `<strong>Day ${day.dayNumber}</strong><small>${formatDate(day.date, { weekday: true })}</small>`;
    button.addEventListener("click", () => { selectedDayId = day.id; renderDays(); renderTimeline(); if (activeTab === "map") renderMap(); });
    return button;
  }));
  const filter = $("#travel-map-day-filter");
  filter.innerHTML = '<option value="all">全部日期</option>' + detail.days.map((day) => `<option value="${day.id}">Day ${day.dayNumber} · ${formatDate(day.date)}</option>`).join("");
}

function activitiesForDay(dayId = selectedDayId) {
  return detail.activities.filter((item) => item.dayId === dayId).sort((a, b) => a.sortOrder - b.sortOrder || String(a.startTime || "").localeCompare(String(b.startTime || "")));
}

function navigationUrl(item) {
  if (item.latitude != null && item.longitude != null && Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude))) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.latitude},${item.longitude}`)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.locationLabel || item.name)}`;
}

function renderTimeline() {
  if (!detail) return;
  const day = detail.days.find((item) => item.id === selectedDayId);
  $("#travel-day-title").textContent = day ? `Day ${day.dayNumber} · ${day.title || detail.trip.destinationName}` : "每日行程";
  $("#travel-day-note").textContent = day?.date ? formatDate(day.date, { year: true, weekday: true }) : "";
  const items = activitiesForDay();
  const timeline = $("#travel-timeline");
  if (!items.length) {
    timeline.innerHTML = '<div class="travel-panel-empty"><span>＋</span><h4>这一天还没有安排</h4><p>添加景点、餐饮、休息、交通或自定义活动。</p><button class="btn-primary-pill" type="button">添加第一个活动</button></div>';
    timeline.querySelector("button").addEventListener("click", () => openActivityDialog());
    return;
  }
  timeline.replaceChildren(...items.map((item, index) => {
    const card = document.createElement("article");
    card.className = "travel-activity";
    card.draggable = true;
    card.dataset.activityId = item.id;
    card.innerHTML = `<time>${escapeHtml(item.startTime || "待定")}</time><span class="travel-activity-dot"></span><div class="travel-activity-body"><div><small>${TYPE_LABELS[item.type]} · ${item.durationMinutes ? `${item.durationMinutes} 分钟` : "时长待定"}</small><h4>${escapeHtml(item.name)}</h4><p>${escapeHtml(item.description || item.locationLabel || "可以补充介绍和备注")}</p>${item.verification === "verified" ? '<em class="travel-verified">已核实地点</em>' : '<em class="travel-unverified">建议核实</em>'}</div><div class="travel-activity-actions"><a href="${navigationUrl(item)}" target="_blank" rel="noopener noreferrer">导航</a><button type="button" data-action="up" aria-label="上移">↑</button><button type="button" data-action="down" aria-label="下移">↓</button><button type="button" data-action="edit">编辑</button><button type="button" data-action="delete" aria-label="删除">×</button></div></div>`;
    card.addEventListener("dragstart", () => { dragActivityId = item.id; });
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", () => reorderByIds(dragActivityId, item.id));
    card.querySelector('[data-action="edit"]').addEventListener("click", () => openActivityDialog(item));
    card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteActivity(item));
    card.querySelector('[data-action="up"]').addEventListener("click", () => moveActivity(index, -1));
    card.querySelector('[data-action="down"]').addEventListener("click", () => moveActivity(index, 1));
    return card;
  }));
}

async function moveActivity(index, delta) {
  const list = activitiesForDay();
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  const reordered = [...list];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  await saveOrder(reordered);
}

async function reorderByIds(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return;
  const list = activitiesForDay();
  const from = list.findIndex((item) => item.id === sourceId);
  const to = list.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  await saveOrder(list);
}

async function saveOrder(items) {
  try {
    await Promise.all(items.map((item, index) => request(`/api/me/travel/${detail.trip.id}/activities/${item.id}`, { method: "PATCH", body: { sortOrder: index * 10 } })));
    await loadTrip(detail.trip.id, { quiet: true });
  } catch (error) { notify(error.message || "行程排序保存失败", true); }
}

function renderSaved() {
  const list = $("#travel-saved-list");
  const items = detail?.savedPlaces || [];
  if (!items.length) { list.innerHTML = '<div class="travel-panel-empty"><h4>还没有收藏地点</h4><p>收藏不会自动标记为已经去过。</p></div>'; return; }
  list.innerHTML = items.map((item) => `<article class="travel-simple-card"><small>${escapeHtml(item.category)}</small><h4>${escapeHtml(item.name)}</h4><p>${escapeHtml(item.location_label || item.note || "")}</p><button data-delete-saved="${item.id}" type="button">删除</button></article>`).join("");
  $$('[data-delete-saved]', list).forEach((button) => button.addEventListener("click", () => deleteSimple("saved", button.dataset.deleteSaved)));
}

function renderInfo() {
  const list = $("#travel-info-list");
  const items = detail?.infoItems || [];
  if (!items.length) { list.innerHTML = '<div class="travel-panel-empty"><h4>还没有旅行信息</h4><p>这里只保存普通旅行资料，请勿记录护照或银行卡号码。</p></div>'; return; }
  list.innerHTML = items.map((item) => `<article class="travel-simple-card"><small>${escapeHtml(item.item_type)}</small><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.details || "")}</p>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">打开链接 ↗</a>` : ""}<button data-delete-info="${item.id}" type="button">删除</button></article>`).join("");
  $$('[data-delete-info]', list).forEach((button) => button.addEventListener("click", () => deleteSimple("info", button.dataset.deleteInfo)));
}

function renderBudget() {
  if (!detail) return;
  const currency = detail.trip.currency;
  const expenses = detail.expenses.filter((item) => item.currency === currency);
  const spent = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const total = detail.trip.budgetAmount == null ? null : detail.trip.budgetAmount / 100;
  $("#travel-budget-total").textContent = total == null ? "未设置" : money(total, currency);
  $("#travel-budget-spent").textContent = money(spent, currency);
  $("#travel-budget-left").textContent = total == null ? "—" : money(total - spent, currency);
  $("#travel-budget-bar").style.width = total ? `${Math.min(100, spent / total * 100)}%` : "0%";
  const list = $("#travel-expense-list");
  list.innerHTML = expenses.length ? expenses.map((item) => `<article><span><small>${CATEGORY_LABELS[item.category]}</small><strong>${escapeHtml(item.title)}</strong></span><b>${money(item.amount, item.currency)}</b><button type="button" data-delete-expense="${item.id}">×</button></article>`).join("") : '<div class="travel-panel-empty"><p>还没有费用记录。</p></div>';
  $$('[data-delete-expense]', list).forEach((button) => button.addEventListener("click", () => deleteSimple("expenses", button.dataset.deleteExpense)));
}

function renderChecklist() {
  if (!detail) return;
  $$("#travel-checklist-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.section === checklistSection));
  const items = detail.checklist.filter((item) => item.section === checklistSection);
  const list = $("#travel-checklist-list");
  list.innerHTML = items.length ? items.map((item) => `<article><label><input type="checkbox" data-check="${item.id}" ${item.completed ? "checked" : ""}><span class="${item.completed ? "done" : ""}">${escapeHtml(item.title)}</span></label><button type="button" data-delete-check="${item.id}">×</button></article>`).join("") : `<div class="travel-panel-empty"><p>${SECTION_LABELS[checklistSection]}还没有清单事项。</p></div>`;
  $$('[data-check]', list).forEach((input) => input.addEventListener("change", () => updateChecklist(input.dataset.check, input.checked)));
  $$('[data-delete-check]', list).forEach((button) => button.addEventListener("click", () => deleteSimple("checklist", button.dataset.deleteCheck)));
}

function syncPanels() {
  $$("#travel-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.travelTab === activeTab));
  $$('[data-travel-panel]').forEach((panel) => { const active = panel.dataset.travelPanel === activeTab; panel.hidden = !active; panel.classList.toggle("active", active); });
  if (activeTab === "map") setTimeout(renderMap, 0);
}

async function loadTrips({ selectFirst = true } = {}) {
  setStatus("正在读取旅行计划…");
  try {
    const payload = await request("/api/me/travel");
    trips = payload.trips || [];
    renderTrips();
    if (selectFirst && !selectedTripId && trips[0]) await selectTrip(trips[0].id);
    if (!trips.length) { detail = null; renderDetail(); }
    setStatus("");
  } catch (error) { setStatus(error.message || "旅行计划加载失败", true); }
}

async function selectTrip(id) {
  selectedTripId = id;
  renderTrips();
  await loadTrip(id);
}

async function loadTrip(id, { quiet = false } = {}) {
  if (!quiet) setStatus("正在打开旅行…");
  try {
    detail = await request(`/api/me/travel/${encodeURIComponent(id)}`);
    selectedTripId = id;
    if (!selectedDayId || !detail.days.some((day) => day.id === selectedDayId)) selectedDayId = detail.days[0]?.id || null;
    const index = trips.findIndex((trip) => trip.id === id);
    if (index >= 0) trips[index] = detail.trip;
    renderTrips(); renderDetail(); setStatus("");
  } catch (error) { setStatus(error.message || "旅行详情加载失败", true); }
}

function openTripDialog(trip = null) {
  editingTrip = trip;
  const form = $("#travel-trip-form");
  form.reset();
  $("#travel-trip-dialog-title").textContent = trip ? "编辑旅行" : "新建旅行";
  $("#travel-trip-form-status").textContent = trip ? "为保护已有行程，已创建旅行暂不直接修改日期范围。" : "";
  if (trip) {
    for (const [name, value] of Object.entries({ name: trip.name, destinationQuery: trip.destinationName, destinationName: trip.destinationName, destinationLabel: trip.destinationLabel, destinationTimezone: trip.destinationTimezone, countryCode: trip.countryCode, longitude: trip.longitude, latitude: trip.latitude, startDate: trip.startDate, endDate: trip.endDate, travelers: trip.travelers, budgetLevel: trip.budgetLevel, budgetAmount: trip.budgetAmount == null ? "" : trip.budgetAmount / 100, currency: trip.currency, pace: trip.pace, transport: trip.transport, preferences: trip.preferences })) {
      const field = form.elements[name]; if (field) field.value = value ?? "";
    }
    trip.styles.forEach((style) => { const input = form.querySelector(`[name="styles"][value="${style}"]`); if (input) input.checked = true; });
    form.elements.startDate.disabled = true; form.elements.endDate.disabled = true;
    $("#travel-create-ai").hidden = true; $("#travel-create-blank").textContent = "保存修改";
  } else {
    form.elements.startDate.disabled = false; form.elements.endDate.disabled = false;
    $("#travel-create-ai").hidden = false; $("#travel-create-blank").textContent = "创建空白计划";
  }
  $("#travel-destination-results").hidden = true;
  $("#travel-trip-dialog").showModal();
}

async function searchPlace(query, target, onSelect) {
  const results = $(target);
  results.hidden = false;
  results.innerHTML = '<p class="travel-searching">正在搜索真实地点…</p>';
  try {
    const payload = await request(`/api/me/footprints/search?q=${encodeURIComponent(query)}`);
    const places = payload.results || [];
    if (places.length === 1) {
      onSelect(places[0]);
      results.innerHTML = `<p class="travel-search-selected">✓ 已选择：${escapeHtml(places[0].label)}</p>`;
      results.hidden = false;
      return;
    }
    results.innerHTML = places.length ? places.map((place, index) => `<button type="button" data-index="${index}"><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(place.label)}</small></button>`).join("") : "<p>没有找到地点，请尝试更完整的名称。</p>";
    if (places.length > 1) results.insertAdjacentHTML("afterbegin", '<p class="travel-search-hint">请选择下方一个真实地点：</p>');
    $$('[data-index]', results).forEach((button) => button.addEventListener("click", () => onSelect(places[Number(button.dataset.index)])));
  } catch (error) { results.innerHTML = `<p>${escapeHtml(error.message || "地点搜索失败")}</p>`; }
}

async function submitTrip(event) {
  const action = event.submitter?.value;
  if (action === "cancel") return;
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form));
  body.styles = new FormData(form).getAll("styles");
  body.travelers = Number(body.travelers);
  body.longitude = body.longitude === "" ? null : Number(body.longitude);
  body.latitude = body.latitude === "" ? null : Number(body.latitude);
  if (!body.destinationName) { $("#travel-trip-form-status").textContent = "请先搜索并选择一个真实目的地。"; return; }
  try {
    if (editingTrip) {
      await request(`/api/me/travel/${editingTrip.id}`, { method: "PATCH", body });
      $("#travel-trip-dialog").close(); await loadTrips({ selectFirst: false }); await loadTrip(editingTrip.id); notify("旅行信息已保存");
    } else {
      const created = await request("/api/me/travel", { method: "POST", body });
      $("#travel-trip-dialog").close(); await loadTrips({ selectFirst: false }); await selectTrip(created.trip.id); notify("空白旅行计划已创建");
      if (action === "ai") {
        try { await request(`/api/me/travel/${created.trip.id}/ai`, { method: "POST", body: { mode: "generate" } }); }
        catch (error) { notify(`${error.message} 已保留空白计划，可继续手动编辑。`, true); }
      }
    }
  } catch (error) { $("#travel-trip-form-status").textContent = error.message || "旅行保存失败"; }
}

function openActivityDialog(item = null) {
  const form = $("#travel-activity-form"); form.reset();
  $("#travel-activity-dialog-title").textContent = item ? "编辑活动" : "添加活动";
  form.elements.activityId.value = item?.id || "";
  form.elements.dayId.innerHTML = detail.days.map((day) => `<option value="${day.id}">Day ${day.dayNumber} · ${formatDate(day.date)}</option>`).join("");
  form.elements.dayId.value = item?.dayId || selectedDayId;
  for (const [name, value] of Object.entries({ name: item?.name, startTime: item?.startTime, durationMinutes: item?.durationMinutes, type: item?.type, placeQuery: item?.locationLabel, locationLabel: item?.locationLabel, sourceId: item?.sourceId, longitude: item?.longitude, latitude: item?.latitude, verification: item?.verification, description: item?.description, note: item?.note })) { if (form.elements[name] && value != null) form.elements[name].value = value; }
  $("#travel-place-results").hidden = true;
  $("#travel-activity-dialog").showModal();
}

async function submitActivity(event) {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const form = event.currentTarget; const body = Object.fromEntries(new FormData(form)); const id = body.activityId; delete body.activityId; body.durationMinutes = body.durationMinutes === "" ? null : Number(body.durationMinutes); body.longitude = body.longitude === "" ? null : Number(body.longitude); body.latitude = body.latitude === "" ? null : Number(body.latitude); body.sortOrder = id ? undefined : activitiesForDay(body.dayId).length * 10;
  try { await request(`/api/me/travel/${detail.trip.id}/activities${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", body }); $("#travel-activity-dialog").close(); await loadTrip(detail.trip.id, { quiet: true }); notify("行程活动已保存"); }
  catch (error) { notify(error.message || "活动保存失败", true); }
}

async function deleteActivity(item) {
  if (!confirm(`删除“${item.name}”？删除前会保留一个可恢复版本。`)) return;
  await request(`/api/me/travel/${detail.trip.id}/activities/${item.id}`, { method: "DELETE" }); await loadTrip(detail.trip.id, { quiet: true });
}

async function deleteSimple(kind, id) {
  if (!confirm("确认删除这条记录？")) return;
  await request(`/api/me/travel/${detail.trip.id}/${kind}/${id}`, { method: "DELETE" }); await loadTrip(detail.trip.id, { quiet: true });
}

async function updateChecklist(id, completed) { await request(`/api/me/travel/${detail.trip.id}/checklist/${id}`, { method: "PATCH", body: { completed } }); await loadTrip(detail.trip.id, { quiet: true }); }

async function addSaved() {
  const name = prompt("收藏地点名称："); if (!name) return;
  const note = prompt("备注（可选）：") || "";
  await request(`/api/me/travel/${detail.trip.id}/saved`, { method: "POST", body: { name, note, category: "other" } }); await loadTrip(detail.trip.id, { quiet: true });
}

async function addInfo() {
  const title = prompt("旅行信息标题："); if (!title) return;
  const details = prompt("内容（请勿填写护照或银行卡号码）：") || "";
  await request(`/api/me/travel/${detail.trip.id}/info`, { method: "POST", body: { title, details, type: "note" } }); await loadTrip(detail.trip.id, { quiet: true });
}

async function renderMap() {
  if (!detail || activeTab !== "map") return;
  const filter = $("#travel-map-day-filter").value || "all";
  const items = detail.activities.filter((item) => (filter === "all" || item.dayId === filter) && item.longitude != null && item.latitude != null && Number.isFinite(Number(item.longitude)) && Number.isFinite(Number(item.latitude)));
  try {
    if (!mapModule) mapModule = await import("https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.mjs");
    if (!map) {
      map = new mapModule.Map({ container: "travel-map", style: "https://tiles.openfreemap.org/styles/positron", center: detail.trip.longitude != null ? [detail.trip.longitude, detail.trip.latitude] : [0, 20], zoom: detail.trip.longitude != null ? 9 : 1.4, attributionControl: true });
      map.addControl(new mapModule.NavigationControl({ showCompass: true }), "top-right");
      map.on("load", () => renderMap());
      return;
    }
    if (!map.loaded()) return;
    mapMarkers.forEach((marker) => marker.remove()); mapMarkers = [];
    if (map.getLayer("travel-route")) map.removeLayer("travel-route"); if (map.getSource("travel-route")) map.removeSource("travel-route");
    items.forEach((item, index) => { const el = document.createElement("button"); el.className = "travel-map-marker"; el.textContent = String(index + 1); el.title = item.name; el.addEventListener("click", () => { selectedDayId = item.dayId; activeTab = "itinerary"; renderDetail(); }); mapMarkers.push(new mapModule.Marker({ element: el }).setLngLat([item.longitude, item.latitude]).addTo(map)); });
    if (items.length > 1) { map.addSource("travel-route", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: items.map((item) => [item.longitude, item.latitude]) } } }); map.addLayer({ id: "travel-route", type: "line", source: "travel-route", paint: { "line-color": "#738B7B", "line-width": 3, "line-opacity": .8, "line-dasharray": [1, 1.5] } }); }
    if (items.length) { const bounds = new mapModule.LngLatBounds(); items.forEach((item) => bounds.extend([item.longitude, item.latitude])); map.fitBounds(bounds, { padding: 70, maxZoom: 13, duration: 600 }); }
    else if (detail.trip.longitude != null) map.flyTo({ center: [detail.trip.longitude, detail.trip.latitude], zoom: 9 });
    $("#travel-map-note").textContent = items.length ? `显示 ${items.length} 个已核实坐标；连线仅表示行程顺序，不代表实际道路或交通时间。` : "当前筛选没有已核实坐标的活动。";
    setTimeout(() => map.resize(), 0);
  } catch (error) { $("#travel-map-note").textContent = `地图暂不可用：${error.message}`; }
}

function bindEvents() {
  $("#travel-new-trip").addEventListener("click", () => openTripDialog());
  $$('[data-travel-new]').forEach((button) => button.addEventListener("click", () => openTripDialog()));
  $("#travel-edit-trip").addEventListener("click", () => openTripDialog(detail.trip));
  $("#travel-delete-trip").addEventListener("click", async () => { if (!confirm(`删除“${detail.trip.name}”及其所有行程资料？此操作不能撤销。`)) return; await request(`/api/me/travel/${detail.trip.id}`, { method: "DELETE" }); selectedTripId = null; selectedDayId = null; detail = null; await loadTrips(); });
  $("#travel-trip-form").addEventListener("submit", submitTrip);
  const destinationForm = $("#travel-trip-form");
  const selectDestination = (place) => {
    destinationForm.elements.destinationQuery.value = place.name;
    destinationForm.elements.destinationName.value = place.name;
    destinationForm.elements.destinationLabel.value = place.label;
    destinationForm.elements.countryCode.value = place.countryCode || "";
    destinationForm.elements.longitude.value = place.longitude;
    destinationForm.elements.latitude.value = place.latitude;
    $("#travel-trip-form-status").textContent = `已选择真实目的地：${place.label}`;
  };
  destinationForm.elements.destinationQuery.addEventListener("input", () => {
    destinationForm.elements.destinationName.value = "";
    destinationForm.elements.destinationLabel.value = "";
    destinationForm.elements.countryCode.value = "";
    destinationForm.elements.longitude.value = "";
    destinationForm.elements.latitude.value = "";
    $("#travel-trip-form-status").textContent = "输入后点击搜索；只有选中真实地点后才能创建计划。";
  });
  $("#travel-destination-search").addEventListener("click", () => searchPlace(destinationForm.elements.destinationQuery.value, "#travel-destination-results", selectDestination));
  $("#travel-activity-form").addEventListener("submit", submitActivity);
  $("#travel-place-search").addEventListener("click", () => searchPlace($("#travel-activity-form").elements.placeQuery.value, "#travel-place-results", (place) => { const form = $("#travel-activity-form"); form.elements.placeQuery.value = place.name; form.elements.locationLabel.value = place.label; form.elements.sourceId.value = place.sourceId; form.elements.longitude.value = place.longitude; form.elements.latitude.value = place.latitude; form.elements.verification.value = "verified"; $("#travel-place-results").hidden = true; }));
  $("#travel-add-activity").addEventListener("click", () => openActivityDialog());
  $$("#travel-tabs button").forEach((button) => button.addEventListener("click", () => { activeTab = button.dataset.travelTab; syncPanels(); }));
  $("#travel-map-day-filter").addEventListener("change", renderMap);
  $("#travel-add-saved").addEventListener("click", addSaved);
  $("#travel-add-info").addEventListener("click", addInfo);
  $("#travel-expense-form").addEventListener("submit", async (event) => { event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget)); body.currency = detail.trip.currency; await request(`/api/me/travel/${detail.trip.id}/expenses`, { method: "POST", body }); event.currentTarget.reset(); await loadTrip(detail.trip.id, { quiet: true }); });
  $$("#travel-checklist-tabs button").forEach((button) => button.addEventListener("click", () => { checklistSection = button.dataset.section; renderChecklist(); }));
  $("#travel-checklist-form").addEventListener("submit", async (event) => { event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget)); body.section = checklistSection; await request(`/api/me/travel/${detail.trip.id}/checklist`, { method: "POST", body }); event.currentTarget.reset(); await loadTrip(detail.trip.id, { quiet: true }); });
  $("#travel-ai-day").addEventListener("click", async () => { const instruction = prompt("你希望如何调整这一天？原行程会在你确认前保持不变。"); if (!instruction) return; try { await request(`/api/me/travel/${detail.trip.id}/ai`, { method: "POST", body: { mode: "adjust", dayId: selectedDayId, instruction } }); } catch (error) { notify(error.message, true); } });
}

export async function mountTravelPlanner(authState, options = {}) {
  auth = authState; notify = options.notify || notify;
  if (!mounted) { mounted = true; bindEvents(); }
  await loadTrips();
}
