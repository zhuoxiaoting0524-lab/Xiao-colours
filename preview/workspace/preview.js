/**
 * XiaoColour Personal Workspace — interactive layout preview only.
 * Does not touch production auth, D1, or Global Pulse.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const META = {
  overview: { title: "Overview", desc: "今天的生活首页" },
  notes: { title: "Little Notes", desc: "私人便签 · 右侧面板编辑" },
  days: { title: "My Days", desc: "周视图为主 · 当日待办" },
  footprints: { title: "Footprints", desc: "地图为主体的足迹空间" },
};

const state = {
  panel: "overview",
  calMode: "week",
  selectedDay: startOfDay(new Date()),
  notes: [
    { id: "n1", title: "周末想买的书", body: "《夏日终曲》· 找中古店看看有没有旧版封面。", color: "cream", pin: true },
    { id: "n2", title: "晚餐灵感", body: "番茄牛腩 + 一小碟凉拌黄瓜。记得买香菜。", color: "green", pin: false },
    { id: "n3", title: "给妈妈打电话", body: "问问旅行照片有没有修好。", color: "pink", pin: true },
    { id: "n4", title: "散步路线", body: "湖边绕一圈，顺路拍银杏。", color: "blue", pin: false },
    { id: "n5", title: "灵感碎片", body: "暖白纸面 + 细线强调，比深色按钮更安静。", color: "cream", pin: false },
  ],
  activeNoteId: null,
  tasks: [],
  activeTaskId: null,
  dates: [
    { id: "d1", label: "妹妹生日", when: addDays(new Date(), 12), countdown: true },
    { id: "d2", label: "租约提醒", when: addDays(new Date(), 28), countdown: true },
    { id: "d3", label: "春季旅行", when: addDays(new Date(), 45), countdown: false },
  ],
  places: [
    { id: "p1", name: "湖心咖啡", tag: "cafe", lat: 31.2304, lng: 121.4737, note: "窗边座位适合写便签。" },
    { id: "p2", name: "城市公园东门", tag: "park", lat: 31.2358, lng: 121.48, note: "傍晚光很好。" },
    { id: "p3", name: "旧书店巷口", tag: "travel", lat: 31.225, lng: 121.468, note: "上次买到了明信片。" },
    { id: "p4", name: "河边步道", tag: "park", lat: 31.228, lng: 121.49, note: "周末散步。" },
  ],
  placeFilter: "all",
  activePlaceId: null,
  map: null,
  markers: new Map(),
};

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return startOfDay(x);
}

function sameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function fmtDate(d, opts) {
  return new Intl.DateTimeFormat("zh-CN", opts).format(d);
}

function daysUntil(d) {
  const ms = startOfDay(d) - startOfDay(new Date());
  return Math.round(ms / 86400000);
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 1800);
}

function seedTasks() {
  const today = startOfDay(new Date());
  state.tasks = [
    { id: "t1", title: "整理 Journal 照片", date: today, done: false },
    { id: "t2", title: "买牛奶和水果", date: today, done: true },
    { id: "t3", title: "回复同学消息", date: today, done: false },
    { id: "t4", title: "预约下周体检", date: addDays(today, 1), done: false },
    { id: "t5", title: "打印旅行清单", date: addDays(today, 2), done: false },
    { id: "t6", title: "整理衣柜换季", date: addDays(today, 3), done: false },
  ];
}

/* —— Navigation —— */
function setPanel(name) {
  state.panel = name;
  $$(".nav-item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.panel === name);
  });
  $$(".panel").forEach((panel) => {
    const on = panel.dataset.panel === name;
    panel.hidden = !on;
    panel.classList.toggle("is-active", on);
  });
  const meta = META[name];
  $("#panel-title").textContent = meta.title;
  $("#panel-desc").textContent = meta.desc;
  closeMobileNav();
  if (name === "footprints") {
    requestAnimationFrame(() => ensureMap());
  }
  if (name === "overview") renderOverview();
  if (name === "notes") renderNotes();
  if (name === "days") renderDays();
}

function openMobileNav() {
  $("#workspace").classList.add("nav-open");
  $("#sidebar-backdrop").hidden = false;
}

function closeMobileNav() {
  $("#workspace").classList.remove("nav-open");
  $("#sidebar-backdrop").hidden = true;
}

/* —— Overview —— */
function renderOverview() {
  const now = new Date();
  $("#overview-date").textContent = fmtDate(now, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  $("#overview-greet").textContent =
    now.getHours() < 12 ? "上午好，慢慢开始。" : now.getHours() < 18 ? "下午好，按自己的节奏。" : "晚上好，留下一点今天。";

  const todos = state.tasks.filter((t) => sameDay(t.date, now));
  const list = $("#overview-todos");
  const empty = $("#overview-todos-empty");
  list.innerHTML = "";
  empty.hidden = todos.length > 0;
  todos.slice(0, 5).forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML = `<input type="checkbox" ${t.done ? "checked" : ""} disabled /><span>${escapeHtml(t.title)}</span>`;
    list.appendChild(li);
  });

  const dates = $("#overview-dates");
  dates.innerHTML = "";
  state.dates
    .slice()
    .sort((a, b) => a.when - b.when)
    .slice(0, 3)
    .forEach((d) => {
      const n = daysUntil(d.when);
      const li = document.createElement("li");
      li.innerHTML = `<span>${escapeHtml(d.label)}</span><span class="meta">${n === 0 ? "今天" : n > 0 ? `${n} 天后` : `${Math.abs(n)} 天前`}</span>`;
      dates.appendChild(li);
    });

  const notes = $("#overview-notes");
  notes.innerHTML = "";
  sortedNotes()
    .slice(0, 4)
    .forEach((n) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `note-chip ${n.color}`;
      btn.textContent = n.title;
      btn.addEventListener("click", () => {
        setPanel("notes");
        openNote(n.id);
      });
      notes.appendChild(btn);
    });

  const fps = $("#overview-footprints");
  fps.innerHTML = "";
  state.places.slice(0, 3).forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="meta">${tagLabel(p.tag)}</span>`;
    li.style.cursor = "pointer";
    li.addEventListener("click", () => {
      setPanel("footprints");
      selectPlace(p.id);
    });
    fps.appendChild(li);
  });
}

/* —— Notes —— */
function sortedNotes() {
  return state.notes
    .slice()
    .sort((a, b) => Number(b.pin) - Number(a.pin) || a.title.localeCompare(b.title, "zh"));
}

function renderNotes() {
  const q = ($("#notes-search").value || "").trim().toLowerCase();
  const grid = $("#notes-grid");
  const empty = $("#notes-empty");
  grid.innerHTML = "";
  const items = sortedNotes().filter(
    (n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
  );
  empty.hidden = items.length > 0;
  items.forEach((n) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `note-card ${n.color}${state.activeNoteId === n.id ? " is-selected" : ""}`;
    btn.innerHTML = `${n.pin ? '<span class="pin-badge">置顶</span>' : ""}<h4>${escapeHtml(n.title)}</h4><p>${escapeHtml(n.body)}</p>`;
    btn.addEventListener("click", () => openNote(n.id));
    grid.appendChild(btn);
  });
}

function openNote(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  state.activeNoteId = id;
  const panel = $("#notes-editor");
  panel.hidden = false;
  $("#note-title").value = note.title;
  $("#note-body").value = note.body;
  $("#note-color").value = note.color;
  $("#note-pin").checked = note.pin;
  renderNotes();
}

function closeNoteEditor() {
  state.activeNoteId = null;
  $("#notes-editor").hidden = true;
  renderNotes();
}

function saveNote() {
  const note = state.notes.find((n) => n.id === state.activeNoteId);
  if (!note) return;
  note.title = $("#note-title").value.trim() || "无标题";
  note.body = $("#note-body").value.trim();
  note.color = $("#note-color").value;
  note.pin = $("#note-pin").checked;
  toast("便签已保存（预览）");
  renderNotes();
  renderOverview();
}

function deleteNote() {
  if (!state.activeNoteId) return;
  state.notes = state.notes.filter((n) => n.id !== state.activeNoteId);
  closeNoteEditor();
  toast("便签已删除（预览）");
  renderOverview();
}

function addNote() {
  const id = `n${Date.now()}`;
  state.notes.unshift({
    id,
    title: "新便签",
    body: "",
    color: "cream",
    pin: false,
  });
  setPanel("notes");
  openNote(id);
}

/* —— Days —— */
function weekDays() {
  const d = startOfDay(state.selectedDay);
  const day = d.getDay() || 7; // Mon=1 … Sun=7
  const monday = addDays(d, 1 - day);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function renderDays() {
  renderWeek();
  renderMonth();
  $("#week-strip").hidden = state.calMode !== "week";
  $("#month-grid").hidden = state.calMode !== "month";
  $$(".seg-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.cal === state.calMode));

  $("#day-tasks-title").textContent = `${fmtDate(state.selectedDay, {
    month: "long",
    day: "numeric",
    weekday: "short",
  })} · 待办`;

  const tasks = state.tasks.filter((t) => sameDay(t.date, state.selectedDay));
  const list = $("#day-tasks");
  const empty = $("#day-tasks-empty");
  list.innerHTML = "";
  empty.hidden = tasks.length > 0;
  tasks.forEach((t) => {
    const li = document.createElement("li");
    li.dataset.id = t.id;
    li.innerHTML = `<input type="checkbox" ${t.done ? "checked" : ""} /><span>${escapeHtml(t.title)}</span>`;
    const cb = li.querySelector("input");
    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      t.done = cb.checked;
      renderOverview();
    });
    li.addEventListener("click", () => openTask(t.id));
    list.appendChild(li);
  });

  const dates = $("#days-dates");
  dates.innerHTML = "";
  state.dates
    .slice()
    .sort((a, b) => a.when - b.when)
    .forEach((d) => {
      const n = daysUntil(d.when);
      const li = document.createElement("li");
      li.innerHTML = `<span>${escapeHtml(d.label)}</span><span class="meta">${n >= 0 ? `倒计时 ${n} 天` : `已过 ${Math.abs(n)} 天`}</span>`;
      dates.appendChild(li);
    });
}

function renderWeek() {
  const strip = $("#week-strip");
  strip.innerHTML = "";
  const labels = ["一", "二", "三", "四", "五", "六", "日"];
  weekDays().forEach((d, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const has = state.tasks.some((t) => sameDay(t.date, d));
    btn.className = `week-day${sameDay(d, state.selectedDay) ? " is-selected" : ""}${has ? " has-tasks" : ""}`;
    btn.innerHTML = `<span class="wd">${labels[i]}</span><span class="dn">${d.getDate()}</span>`;
    btn.addEventListener("click", () => {
      state.selectedDay = d;
      renderDays();
    });
    strip.appendChild(btn);
  });
}

function renderMonth() {
  const grid = $("#month-grid");
  grid.innerHTML = "";
  const base = state.selectedDay;
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const startOffset = (first.getDay() || 7) - 1;
  const start = addDays(first, -startOffset);
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const btn = document.createElement("button");
    btn.type = "button";
    const inMonth = d.getMonth() === base.getMonth();
    const has = state.tasks.some((t) => sameDay(t.date, d));
    btn.className = `month-cell${inMonth ? "" : " muted"}${sameDay(d, state.selectedDay) ? " is-selected" : ""}`;
    btn.innerHTML = `${d.getDate()}${has ? '<span class="dot"></span>' : ""}`;
    btn.addEventListener("click", () => {
      state.selectedDay = d;
      renderDays();
    });
    grid.appendChild(btn);
  }
}

function openTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  state.activeTaskId = id;
  $("#task-editor").hidden = false;
  $("#task-title").value = task.title;
  $("#task-date").value = toInputDate(task.date);
}

function closeTaskEditor() {
  state.activeTaskId = null;
  $("#task-editor").hidden = true;
}

function saveTask() {
  const task = state.tasks.find((t) => t.id === state.activeTaskId);
  if (!task) return;
  task.title = $("#task-title").value.trim() || "未命名任务";
  task.date = startOfDay(new Date($("#task-date").value + "T12:00:00"));
  state.selectedDay = task.date;
  toast("任务已保存（预览）");
  renderDays();
  renderOverview();
}

function deleteTask() {
  if (!state.activeTaskId) return;
  state.tasks = state.tasks.filter((t) => t.id !== state.activeTaskId);
  closeTaskEditor();
  toast("任务已删除（预览）");
  renderDays();
  renderOverview();
}

function addTask() {
  const id = `t${Date.now()}`;
  const task = {
    id,
    title: "新任务",
    date: state.selectedDay,
    done: false,
  };
  state.tasks.push(task);
  setPanel("days");
  openTask(id);
  renderDays();
}

function toInputDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* —— Footprints —— */
function tagLabel(tag) {
  return { cafe: "咖啡", park: "公园", travel: "旅行" }[tag] || tag;
}

function filteredPlaces() {
  const q = ($("#place-search").value || "").trim().toLowerCase();
  return state.places.filter((p) => {
    if (state.placeFilter !== "all" && p.tag !== state.placeFilter) return false;
    if (q && !p.name.toLowerCase().includes(q) && !p.note.toLowerCase().includes(q)) return false;
    return true;
  });
}

function ensureMap() {
  if (!window.L) return;
  if (!state.map) {
    state.map = L.map("map", { zoomControl: true, attributionControl: false }).setView([31.2304, 121.4737], 13);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(state.map);
  }
  syncMarkers();
  setTimeout(() => state.map.invalidateSize(), 80);
}

function syncMarkers() {
  if (!state.map) return;
  state.markers.forEach((m) => m.remove());
  state.markers.clear();
  const places = filteredPlaces();
  places.forEach((p) => {
    const marker = L.circleMarker([p.lat, p.lng], {
      radius: 8,
      color: "#1a1a1a",
      weight: 1.5,
      fillColor: "#c8dfb8",
      fillOpacity: 0.9,
    }).addTo(state.map);
    marker.on("click", () => selectPlace(p.id));
    state.markers.set(p.id, marker);
  });
  renderPlacesList();
}

function renderPlacesList() {
  const list = $("#places-list");
  list.innerHTML = "";
  filteredPlaces().forEach((p) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = state.activePlaceId === p.id ? "is-active" : "";
    btn.textContent = `${p.name} · ${tagLabel(p.tag)}`;
    btn.addEventListener("click", () => selectPlace(p.id));
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function selectPlace(id) {
  const place = state.places.find((p) => p.id === id);
  if (!place) return;
  state.activePlaceId = id;
  ensureMap();
  state.map.setView([place.lat, place.lng], 14, { animate: true });
  const detail = $("#place-detail");
  detail.hidden = false;
  $("#place-detail-title").textContent = place.name;
  $("#place-detail-meta").textContent = tagLabel(place.tag);
  $("#place-detail-note").textContent = place.note;
  renderPlacesList();
}

function addPlace() {
  const id = `p${Date.now()}`;
  const center = state.map ? state.map.getCenter() : { lat: 31.23, lng: 121.47 };
  const place = {
    id,
    name: "新地点",
    tag: "travel",
    lat: center.lat + (Math.random() - 0.5) * 0.01,
    lng: center.lng + (Math.random() - 0.5) * 0.01,
    note: "在预览里新增的足迹点。",
  };
  state.places.unshift(place);
  setPanel("footprints");
  selectPlace(id);
  toast("已添加地点（预览）");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* —— Bindings —— */
function bind() {
  $("#enter-workspace").addEventListener("click", () => {
    $("#welcome-view").hidden = true;
    $("#workspace").hidden = false;
    setPanel("overview");
  });

  $("#back-welcome").addEventListener("click", () => {
    closeMobileNav();
    closeNoteEditor();
    closeTaskEditor();
    $("#workspace").hidden = true;
    $("#welcome-view").hidden = false;
  });

  $$(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => setPanel(btn.dataset.panel));
  });

  $$("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => setPanel(btn.dataset.go));
  });

  $("#menu-btn").addEventListener("click", openMobileNav);
  $("#sidebar-close").addEventListener("click", closeMobileNav);
  $("#sidebar-backdrop").addEventListener("click", closeMobileNav);

  $("#btn-settings").addEventListener("click", () => toast("账户设置 · 预览占位，不改正式账户系统"));
  $("#btn-logout").addEventListener("click", () => {
    toast("已退出（预览）");
    $("#back-welcome").click();
  });

  $$("[data-quick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.quick;
      if (kind === "note") addNote();
      if (kind === "task") addTask();
      if (kind === "place") addPlace();
    });
  });

  $("#notes-search").addEventListener("input", renderNotes);
  $("#notes-add").addEventListener("click", addNote);
  $("#notes-close").addEventListener("click", closeNoteEditor);
  $("#note-save").addEventListener("click", saveNote);
  $("#note-delete").addEventListener("click", deleteNote);

  $$(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.calMode = btn.dataset.cal;
      renderDays();
    });
  });
  $("#task-add").addEventListener("click", addTask);
  $("#task-close").addEventListener("click", closeTaskEditor);
  $("#task-save").addEventListener("click", saveTask);
  $("#task-delete").addEventListener("click", deleteTask);

  $("#place-search").addEventListener("input", () => {
    syncMarkers();
  });
  $("#place-filter").addEventListener("change", (e) => {
    state.placeFilter = e.target.value;
    syncMarkers();
  });
  $("#places-toggle").addEventListener("click", () => {
    const drawer = $("#places-drawer");
    const open = drawer.classList.toggle("is-open");
    $("#places-toggle").textContent = open ? "收起列表" : "展开列表";
  });
  $("#place-add").addEventListener("click", addPlace);
  $("#place-detail-close").addEventListener("click", () => {
    $("#place-detail").hidden = true;
    state.activePlaceId = null;
    renderPlacesList();
  });

  window.addEventListener("resize", () => {
    if (state.map && state.panel === "footprints") {
      state.map.invalidateSize();
    }
    if (window.innerWidth > 768) closeMobileNav();
  });
}

seedTasks();
bind();
