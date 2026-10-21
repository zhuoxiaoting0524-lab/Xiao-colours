const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const META = {
  overview: { title: "Overview", desc: "今天的生活首页" },
  notes: { title: "Little Notes", desc: "私人便签" },
  days: { title: "My Days", desc: "日历与当日待办" },
  footprints: { title: "Footprints", desc: "私人足迹地图" },
};

const state = {
  panel: "overview",
  calMode: "week",
  cursor: startOfDay(new Date()),
  selectedDay: startOfDay(new Date()),
  noteColor: "ivory",
  activeNoteId: null,
  activeTaskId: null,
  placeFilter: "all",
  activePlaceId: null,
  map: null,
  markers: new Map(),
  notes: [
    { id: "n1", title: "周末想买的书", body: "找中古店看看有没有旧版封面。", color: "ivory", pin: true },
    { id: "n2", title: "晚餐灵感", body: "番茄牛腩，记得买香菜。", color: "sage", pin: false },
    { id: "n3", title: "给妈妈打电话", body: "问问旅行照片修好了没。", color: "rose", pin: true },
    { id: "n4", title: "散步路线", body: "湖边绕一圈，顺路拍银杏。", color: "blue", pin: false },
    { id: "n5", title: "视觉备忘", body: "统一 Inter + Noto Sans SC，用字重区分层级。", color: "ivory", pin: false },
  ],
  tasks: [],
  dates: [
    { id: "d1", label: "妹妹生日", when: addDays(new Date(), 12) },
    { id: "d2", label: "租约提醒", when: addDays(new Date(), 28) },
    { id: "d3", label: "春季旅行", when: addDays(new Date(), 45) },
  ],
  places: [
    { id: "p1", name: "湖心咖啡", tag: "visited", lat: 31.2304, lng: 121.4737, note: "窗边座位适合写便签。" },
    { id: "p2", name: "城市公园东门", tag: "visited", lat: 31.2358, lng: 121.48, note: "傍晚光线很好。" },
    { id: "p3", name: "旧书店巷口", tag: "wish", lat: 31.225, lng: 121.468, note: "想再去找明信片。" },
    { id: "p4", name: "河边步道", tag: "visited", lat: 31.228, lng: 121.49, note: "周末散步。" },
  ],
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

function daysUntil(d) {
  return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
}

function fmt(d, opts) {
  return new Intl.DateTimeFormat("zh-CN", opts).format(d);
}

function toInputDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 1600);
}

function seedTasks() {
  const today = startOfDay(new Date());
  state.tasks = [
    { id: "t1", title: "整理照片", date: today, done: false },
    { id: "t2", title: "买牛奶和水果", date: today, done: true },
    { id: "t3", title: "回复同学消息", date: today, done: false },
    { id: "t4", title: "预约下周体检", date: addDays(today, 1), done: false },
    { id: "t5", title: "打印旅行清单", date: addDays(today, 2), done: false },
  ];
}

function setPanel(name) {
  state.panel = name;
  $$(".nav-item").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.panel === name));
  $$(".panel").forEach((panel) => {
    const on = panel.dataset.panel === name;
    panel.hidden = !on;
    panel.classList.toggle("is-active", on);
  });
  $("#panel-title").textContent = META[name].title;
  $("#panel-desc").textContent = META[name].desc;
  closeMobile();
  if (name === "overview") renderOverview();
  if (name === "notes") renderNotes();
  if (name === "days") renderDays();
  if (name === "footprints") requestAnimationFrame(() => ensureMap());
}

function openMobile() {
  $("#shell").classList.add("nav-open");
  $("#backdrop").hidden = false;
}

function closeMobile() {
  $("#shell").classList.remove("nav-open");
  $("#backdrop").hidden = true;
}

function renderOverview() {
  const now = new Date();
  $("#ov-date").textContent = fmt(now, { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const h = now.getHours();
  $("#ov-greet").textContent = h < 12 ? "上午好" : h < 18 ? "下午好" : "晚上好";

  const todos = state.tasks.filter((t) => sameDay(t.date, now));
  const todoEmpty = $("#ov-todos-empty");
  const todoList = $("#ov-todos");
  todoEmpty.hidden = todos.length > 0;
  todoList.hidden = todos.length === 0;
  todoList.innerHTML = "";
  todos.slice(0, 5).forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="tick${t.done ? " on" : ""}"></span><span></span>`;
    li.querySelector("span:last-child").textContent = t.title;
    todoList.appendChild(li);
  });

  const upcoming = state.dates.slice().sort((a, b) => a.when - b.when).slice(0, 4);
  $("#ov-dates-empty").hidden = upcoming.length > 0;
  $("#ov-dates").hidden = upcoming.length === 0;
  $("#ov-dates").innerHTML = "";
  upcoming.forEach((d) => {
    const n = daysUntil(d.when);
    const li = document.createElement("li");
    li.innerHTML = `<span></span><em></em>`;
    li.querySelector("span").textContent = d.label;
    li.querySelector("em").textContent = n === 0 ? "今天" : `${n} 天后`;
    $("#ov-dates").appendChild(li);
  });

  const notes = sortedNotes().slice(0, 4);
  $("#ov-notes-empty").hidden = notes.length > 0;
  $("#ov-notes").hidden = notes.length === 0;
  $("#ov-notes").innerHTML = "";
  notes.forEach((n) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip ${n.color === "ivory" ? "" : n.color}`.trim();
    btn.textContent = n.title;
    btn.addEventListener("click", () => {
      setPanel("notes");
      openNote(n.id);
    });
    $("#ov-notes").appendChild(btn);
  });

  const places = state.places.slice(0, 3);
  $("#ov-places-empty").hidden = places.length > 0;
  $("#ov-places").hidden = places.length === 0;
  $("#ov-places").innerHTML = "";
  places.forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><em></em>`;
    li.querySelector("span").textContent = p.name;
    li.querySelector("em").textContent = p.tag === "visited" ? "去过" : "想去";
    li.style.cursor = "pointer";
    li.addEventListener("click", () => {
      setPanel("footprints");
      selectPlace(p.id);
    });
    $("#ov-places").appendChild(li);
  });
}

function sortedNotes() {
  return state.notes.slice().sort((a, b) => Number(b.pin) - Number(a.pin) || a.title.localeCompare(b.title, "zh"));
}

function renderNotes() {
  const q = ($("#notes-search").value || "").trim().toLowerCase();
  const items = sortedNotes().filter((n) => !q || `${n.title} ${n.body}`.toLowerCase().includes(q));
  const grid = $("#notes-grid");
  const empty = $("#notes-empty");
  grid.innerHTML = "";
  empty.hidden = items.length > 0;
  items.forEach((n) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `note-card ${n.color}${state.activeNoteId === n.id ? " is-selected" : ""}`;
    btn.innerHTML = `${n.pin ? '<span class="pin">置顶</span>' : ""}<h4></h4><p></p>`;
    btn.querySelector("h4").textContent = n.title;
    btn.querySelector("p").textContent = n.body || "空白便签";
    btn.addEventListener("click", () => openNote(n.id));
    grid.appendChild(btn);
  });
}

function openNote(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  state.activeNoteId = id;
  state.noteColor = note.color;
  $("#notes-drawer").hidden = false;
  $("#note-title").value = note.title;
  $("#note-body").value = note.body;
  $("#note-pin").checked = note.pin;
  $$("#note-colors button").forEach((b) => b.classList.toggle("is-active", b.dataset.color === note.color));
  renderNotes();
}

function closeNote() {
  state.activeNoteId = null;
  $("#notes-drawer").hidden = true;
  renderNotes();
}

function saveNote() {
  const note = state.notes.find((n) => n.id === state.activeNoteId);
  if (!note) return;
  note.title = $("#note-title").value.trim() || "无标题";
  note.body = $("#note-body").value.trim();
  note.color = state.noteColor;
  note.pin = $("#note-pin").checked;
  toast("已保存（预览）");
  renderNotes();
  renderOverview();
}

function deleteNote() {
  if (!state.activeNoteId) return;
  state.notes = state.notes.filter((n) => n.id !== state.activeNoteId);
  closeNote();
  toast("已删除（预览）");
  renderOverview();
}

function addNote() {
  const id = `n${Date.now()}`;
  state.notes.unshift({ id, title: "新便签", body: "", color: "ivory", pin: false });
  setPanel("notes");
  openNote(id);
}

function weekDays() {
  const d = state.selectedDay;
  const day = d.getDay() || 7;
  const monday = addDays(d, 1 - day);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function renderDays() {
  $("#week").hidden = state.calMode !== "week";
  $("#month").hidden = state.calMode !== "month";
  $$(".seg-btn[data-cal]").forEach((b) => b.classList.toggle("is-active", b.dataset.cal === state.calMode));

  if (state.calMode === "week") {
    const days = weekDays();
    $("#cal-label").textContent = `${fmt(days[0], { month: "short", day: "numeric" })} – ${fmt(days[6], { month: "short", day: "numeric" })}`;
    const labels = ["一", "二", "三", "四", "五", "六", "日"];
    const today = startOfDay(new Date());
    $("#week").innerHTML = "";
    days.forEach((d, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const has = state.tasks.some((t) => sameDay(t.date, d));
      btn.className = `week-day${sameDay(d, state.selectedDay) ? " is-selected" : ""}${sameDay(d, today) ? " is-today" : ""}${has ? " has-tasks" : ""}`;
      btn.innerHTML = `<span class="wd">${labels[i]}</span><span class="dn">${d.getDate()}</span>`;
      btn.addEventListener("click", () => {
        state.selectedDay = d;
        renderDays();
      });
      $("#week").appendChild(btn);
    });
  } else {
    const base = state.cursor;
    $("#cal-label").textContent = fmt(base, { year: "numeric", month: "long" });
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const startOffset = (first.getDay() || 7) - 1;
    const start = addDays(first, -startOffset);
    const today = startOfDay(new Date());
    $("#month").innerHTML = "";
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `month-cell${d.getMonth() === base.getMonth() ? "" : " muted"}${sameDay(d, state.selectedDay) ? " is-selected" : ""}${sameDay(d, today) ? " is-today" : ""}`;
      btn.textContent = String(d.getDate());
      btn.addEventListener("click", () => {
        state.selectedDay = d;
        state.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
        renderDays();
      });
      $("#month").appendChild(btn);
    }
  }

  $("#day-title").textContent = `${fmt(state.selectedDay, { month: "long", day: "numeric", weekday: "short" })} · 待办`;
  const tasks = state.tasks.filter((t) => sameDay(t.date, state.selectedDay));
  $("#day-tasks-empty").hidden = tasks.length > 0;
  $("#day-tasks").hidden = tasks.length === 0;
  $("#day-tasks").innerHTML = "";
  tasks.forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="tick${t.done ? " on" : ""}"></span><span></span>`;
    li.querySelector("span:last-child").textContent = t.title;
    li.querySelector(".tick").addEventListener("click", (e) => {
      e.stopPropagation();
      t.done = !t.done;
      renderDays();
      renderOverview();
    });
    li.addEventListener("click", () => openTask(t.id));
    $("#day-tasks").appendChild(li);
  });

  $("#days-dates").innerHTML = "";
  state.dates
    .slice()
    .sort((a, b) => a.when - b.when)
    .forEach((d) => {
      const n = daysUntil(d.when);
      const li = document.createElement("li");
      li.innerHTML = `<span></span><em></em>`;
      li.querySelector("span").textContent = d.label;
      li.querySelector("em").textContent = n >= 0 ? `${n} 天` : `已过 ${Math.abs(n)} 天`;
      $("#days-dates").appendChild(li);
    });
}

function openTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  state.activeTaskId = id;
  $("#task-drawer").hidden = false;
  $("#task-title").value = task.title;
  $("#task-date").value = toInputDate(task.date);
}

function closeTask() {
  state.activeTaskId = null;
  $("#task-drawer").hidden = true;
}

function saveTask() {
  const task = state.tasks.find((t) => t.id === state.activeTaskId);
  if (!task) return;
  task.title = $("#task-title").value.trim() || "未命名任务";
  task.date = startOfDay(new Date(`${$("#task-date").value}T12:00:00`));
  state.selectedDay = task.date;
  toast("已保存（预览）");
  renderDays();
  renderOverview();
}

function deleteTask() {
  if (!state.activeTaskId) return;
  state.tasks = state.tasks.filter((t) => t.id !== state.activeTaskId);
  closeTask();
  toast("已删除（预览）");
  renderDays();
  renderOverview();
}

function addTask() {
  const id = `t${Date.now()}`;
  state.tasks.push({ id, title: "新任务", date: state.selectedDay, done: false });
  setPanel("days");
  openTask(id);
  renderDays();
}

function filteredPlaces() {
  const q = ($("#place-search").value || "").trim().toLowerCase();
  return state.places.filter((p) => {
    if (state.placeFilter !== "all" && p.tag !== state.placeFilter) return false;
    if (q && !`${p.name} ${p.note}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function ensureMap() {
  if (!window.L) return;
  if (!state.map) {
    state.map = L.map("map", { zoomControl: true, attributionControl: false }).setView([31.2304, 121.4737], 13);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 19 }).addTo(state.map);
  }
  syncMarkers();
  setTimeout(() => state.map.invalidateSize(), 60);
}

function syncMarkers() {
  if (!state.map) return;
  state.markers.forEach((m) => m.remove());
  state.markers.clear();
  filteredPlaces().forEach((p) => {
    const marker = L.circleMarker([p.lat, p.lng], {
      radius: 7,
      color: "#202321",
      weight: 1.25,
      fillColor: p.tag === "wish" ? "#c9b1a4" : "#afc6b6",
      fillOpacity: 0.95,
    }).addTo(state.map);
    marker.on("click", () => selectPlace(p.id));
    state.markers.set(p.id, marker);
  });
  renderPlaces();
}

function renderPlaces() {
  const list = $("#places-list");
  list.innerHTML = "";
  filteredPlaces().forEach((p) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = state.activePlaceId === p.id ? "is-active" : "";
    btn.textContent = `${p.name} · ${p.tag === "visited" ? "去过" : "想去"}`;
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
  $("#place-card").hidden = false;
  $("#place-title").textContent = place.name;
  $("#place-meta").textContent = place.tag === "visited" ? "去过" : "想去";
  $("#place-note").textContent = place.note;
  renderPlaces();
}

function addPlace() {
  const center = state.map ? state.map.getCenter() : { lat: 31.23, lng: 121.47 };
  const id = `p${Date.now()}`;
  state.places.unshift({
    id,
    name: "新地点",
    tag: "wish",
    lat: center.lat + (Math.random() - 0.5) * 0.01,
    lng: center.lng + (Math.random() - 0.5) * 0.01,
    note: "预览中新增的足迹点。",
  });
  setPanel("footprints");
  selectPlace(id);
  toast("已添加地点（预览）");
}

function bind() {
  $$(".nav-item, .logo").forEach((btn) => btn.addEventListener("click", () => setPanel(btn.dataset.panel)));
  $$("[data-go]").forEach((btn) => btn.addEventListener("click", () => setPanel(btn.dataset.go)));
  $$("[data-quick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.quick;
      if (kind === "note") addNote();
      if (kind === "task") addTask();
      if (kind === "place") addPlace();
    });
  });

  $("#menu-btn").addEventListener("click", openMobile);
  $("#sidebar-close").addEventListener("click", closeMobile);
  $("#backdrop").addEventListener("click", closeMobile);
  $("#btn-settings").addEventListener("click", () => toast("账户设置 · 预览占位"));
  $("#btn-logout").addEventListener("click", () => toast("退出登录 · 预览占位"));

  $("#notes-search").addEventListener("input", renderNotes);
  $("#notes-add").addEventListener("click", addNote);
  $("#notes-empty-add").addEventListener("click", addNote);
  $("#notes-close").addEventListener("click", closeNote);
  $("#note-save").addEventListener("click", saveNote);
  $("#note-delete").addEventListener("click", deleteNote);
  $$("#note-colors button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.noteColor = btn.dataset.color;
      $$("#note-colors button").forEach((b) => b.classList.toggle("is-active", b === btn));
    });
  });

  $$(".seg-btn[data-cal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.calMode = btn.dataset.cal;
      renderDays();
    });
  });
  $("#cal-prev").addEventListener("click", () => {
    if (state.calMode === "week") {
      state.selectedDay = addDays(state.selectedDay, -7);
      state.cursor = state.selectedDay;
    } else {
      state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1);
    }
    renderDays();
  });
  $("#cal-next").addEventListener("click", () => {
    if (state.calMode === "week") {
      state.selectedDay = addDays(state.selectedDay, 7);
      state.cursor = state.selectedDay;
    } else {
      state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1);
    }
    renderDays();
  });
  $("#task-add").addEventListener("click", addTask);
  $("#task-empty-add").addEventListener("click", addTask);
  $("#task-close").addEventListener("click", closeTask);
  $("#task-save").addEventListener("click", saveTask);
  $("#task-delete").addEventListener("click", deleteTask);
  $("#important-add").addEventListener("click", () => toast("重要日期编辑 · 预览占位"));

  $("#place-search").addEventListener("input", syncMarkers);
  $$(".seg-btn[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.placeFilter = btn.dataset.filter;
      $$(".seg-btn[data-filter]").forEach((b) => b.classList.toggle("is-active", b === btn));
      syncMarkers();
    });
  });
  $("#places-toggle").addEventListener("click", () => {
    const open = $("#places-drawer").classList.toggle("is-open");
    $("#places-toggle").textContent = open ? "收起列表" : "展开列表";
  });
  $("#place-add").addEventListener("click", addPlace);
  $("#place-close").addEventListener("click", () => {
    $("#place-card").hidden = true;
    state.activePlaceId = null;
    renderPlaces();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) closeMobile();
    if (state.map && state.panel === "footprints") state.map.invalidateSize();
  });
}

seedTasks();
bind();
setPanel("overview");
