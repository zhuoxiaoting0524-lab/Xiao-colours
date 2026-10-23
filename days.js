import { api } from "./auth-client.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const DAY_MS = 86_400_000;

let mounted = false;
let loaded = false;
let auth = null;
let notify = () => {};
let calendarView = "week";
let selectedDate = startOfLocalDay(new Date());
let cursorDate = startOfLocalDay(new Date());
let tasks = [];
let importantDates = [];
let activeTaskId = null;
let activeImportantId = null;

const PLANT_SPRIG_SVG = `
<svg class="plant-sprig" viewBox="0 0 60 70" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M30 65 Q 30 35 25 10" stroke="#738B7B" stroke-width="2" stroke-linecap="round" />
  <path d="M28 50 C 15 48 10 38 18 30 C 26 32 28 42 28 50 Z" fill="#8CA595" opacity="0.8" />
  <path d="M29 38 C 42 36 48 26 40 18 C 32 20 30 30 29 38 Z" fill="#9AB2A3" opacity="0.8" />
  <path d="M26 22 C 16 18 14 10 20 5 C 26 8 26 16 26 22 Z" fill="#7E9685" opacity="0.85" />
  <path d="M25 10 C 28 2 36 2 38 8 C 36 14 30 14 25 10 Z" fill="#8CA595" opacity="0.85" />
</svg>
`;

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return startOfLocalDay(next);
}

function addMonths(date, count) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function startOfWeek(date) {
  const day = date.getDay() || 7;
  return addDays(date, 1 - day);
}

function endOfMonthGrid(date) {
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return addDays(startOfWeek(monthEnd), 6);
}

function formatLong(date) {
  return new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function setStatus(message, error = false) {
  const node = $("#days-status");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("is-error", error);
  node.hidden = !message;
}

function currentRange() {
  if (calendarView === "week") {
    const from = startOfWeek(cursorDate);
    return { from, to: addDays(from, 6) };
  }
  const monthStart = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
  const from = startOfWeek(monthStart);
  return { from, to: endOfMonthGrid(monthStart) };
}

function sameDay(a, b) {
  return dateKey(a) === dateKey(b);
}

function dayTasks(date) {
  const key = dateKey(date);
  return tasks.filter((task) => task.date === key);
}

function renderHeader() {
  const label = $("#calendar-range-label");
  if (label) {
    label.textContent = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(cursorDate);
  }
}

function selectDate(date) {
  selectedDate = startOfLocalDay(date);
  renderWeek();
  renderMonth();
  renderTasks();
}

function renderWeek() {
  const from = startOfWeek(cursorDate);
  const today = startOfLocalDay(new Date());
  const weekContainer = $("#week");
  if (!weekContainer) return;

  weekContainer.replaceChildren(...Array.from({ length: 7 }, (_, index) => {
    const date = addDays(from, index);
    const dateTasks = dayTasks(date);
    const button = document.createElement("button");
    button.type = "button";
    const isSelected = sameDay(date, selectedDate);
    const isToday = sameDay(date, today);
    button.className = `day${isSelected ? " active" : ""}${dateTasks.length ? " has" : ""}`;
    button.setAttribute("aria-label", formatLong(date));

    // Dots indicator if tasks exist
    let dotsHtml = "";
    if (dateTasks.length > 0) {
      const hasCompleted = dateTasks.some((t) => t.completed);
      const hasPending = dateTasks.some((t) => !t.completed);
      dotsHtml = `<span class="day-dots"><i class="day-dot ${hasPending ? "dot-coral" : "dot-green"}"></i>${hasCompleted && hasPending ? '<i class="day-dot dot-yellow"></i>' : ""}</span>`;
    }

    button.innerHTML = `
      <span class="day-name">${new Intl.DateTimeFormat("en", { weekday: "short" }).format(date).toUpperCase()}</span>
      <b class="day-number">${date.getDate()}</b>
      ${dotsHtml}
    `;

    if (isToday) button.dataset.today = "true";
    button.addEventListener("click", () => selectDate(date));
    return button;
  }));
}

function renderMonth() {
  const monthStart = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
  const from = startOfWeek(monthStart);
  const today = startOfLocalDay(new Date());
  const monthContainer = $("#month");
  if (!monthContainer) return;

  monthContainer.replaceChildren(...Array.from({ length: 42 }, (_, index) => {
    const date = addDays(from, index);
    const dateTasks = dayTasks(date);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(date.getDate());
    button.classList.toggle("outside", date.getMonth() !== cursorDate.getMonth());
    button.classList.toggle("active", sameDay(date, selectedDate));
    button.classList.toggle("today", sameDay(date, today));
    button.classList.toggle("has", dateTasks.length > 0);
    button.setAttribute("aria-label", formatLong(date));
    button.addEventListener("click", async () => {
      if (date.getMonth() !== cursorDate.getMonth()) {
        cursorDate = new Date(date.getFullYear(), date.getMonth(), 1);
        selectedDate = date;
        await loadDays();
      } else {
        selectDate(date);
      }
    });
    return button;
  }));
}

function renderTasks() {
  const list = dayTasks(selectedDate);
  const today = startOfLocalDay(new Date());
  const isToday = sameDay(selectedDate, today);

  // Header formatted as: 今天 · 10月23日 星期五
  const weekdaysZh = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const m = selectedDate.getMonth() + 1;
  const d = selectedDate.getDate();
  const w = weekdaysZh[selectedDate.getDay()];
  const titleEl = $("#day-title");
  if (titleEl) {
    titleEl.textContent = isToday ? `今天 · ${m}月${d}日 ${w}` : `${m}月${d}日 ${w}`;
  }

  const container = $("#tasks");
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `
      <div class="days-empty-wrap">
        ${PLANT_SPRIG_SVG}
        <p class="days-empty-desc">这一天还没有任务。<br>从一件小事开始，让今天变得充实吧！</p>
        <button type="button" class="btn-primary-pill" id="day-empty-add">＋ 添加任务</button>
      </div>
    `;
    container.querySelector("#day-empty-add")?.addEventListener("click", () => editTask());
  } else {
    container.replaceChildren(...list.map((task) => {
      const row = document.createElement("article");
      row.className = `task-item${task.completed ? " done" : ""}`;
      row.innerHTML = `
        <button class="task-check" type="button" aria-label="切换完成状态">✓</button>
        <div class="task-info">
          <h4 class="task-title">${task.title}</h4>
          <div class="task-meta-row">
            ${task.time ? `<time class="task-time">${task.time}</time>` : ""}
            <span class="task-tag-badge">${task.tag || "Personal"}</span>
          </div>
        </div>
        <button class="task-edit-btn" type="button" aria-label="编辑任务">···</button>
      `;
      row.querySelector(".task-check").addEventListener("click", () => toggleTask(task));
      row.querySelector(".task-edit-btn").addEventListener("click", () => editTask(task.id));
      return row;
    }));
  }

  renderProgress();
}

function renderProgress() {
  const from = startOfWeek(selectedDate);
  const to = addDays(from, 6);
  const weekTasks = tasks.filter((task) => {
    const date = parseDate(task.date);
    return date >= from && date <= to;
  });
  const completed = weekTasks.filter((task) => task.completed).length;
  const label = $("#week-progress-label");
  const bar = $("#week-progress-bar");
  if (label) label.textContent = `${completed} / ${weekTasks.length}`;
  if (bar) {
    bar.style.width = weekTasks.length ? `${Math.round((completed / weekTasks.length) * 100)}%` : "0%";
  }
}

function nextImportantOccurrence(item) {
  const original = parseDate(item.date);
  const today = startOfLocalDay(new Date());
  if (item.repeatRule !== "yearly" || original >= today) return original;
  let next = new Date(today.getFullYear(), original.getMonth(), original.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, original.getMonth(), original.getDate());
  return next;
}

function renderImportantDates() {
  const container = $("#important-dates");
  if (!container) return;

  const sorted = importantDates
    .map((item) => ({ item, occurrence: nextImportantOccurrence(item) }))
    .sort((a, b) => a.occurrence - b.occurrence)
    .slice(0, 8);

  if (!sorted.length) {
    container.innerHTML = '<span class="empty-date-tip">还没有重要日期。</span>';
    return;
  }

  container.replaceChildren(...sorted.map(({ item, occurrence }) => {
    const article = document.createElement("article");
    article.className = "important-item";
    article.tabIndex = 0;
    article.setAttribute("role", "button");
    const remaining = Math.ceil((startOfLocalDay(occurrence) - startOfLocalDay(new Date())) / DAY_MS);
    article.innerHTML = `
      <div class="important-main">
        <b class="important-title">${item.title}</b>
        <small class="important-note">${item.note || ""}</small>
      </div>
      <span class="important-badge">${remaining === 0 ? "今天" : remaining === 1 ? "明天" : remaining > 0 ? `${remaining} 天后` : "已过"}</span>
    `;
    const open = () => editImportant(item.id);
    article.addEventListener("click", open);
    article.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") open();
    });
    return article;
  }));
}

function renderAll() {
  renderHeader();
  renderWeek();
  renderMonth();
  renderTasks();
  renderImportantDates();
}

async function loadDays() {
  setStatus("正在读取生活计划…");
  const range = currentRange();
  try {
    const [taskData, dateData] = await Promise.all([
      api(`/api/me/days/tasks?from=${dateKey(range.from)}&to=${dateKey(range.to)}`),
      api("/api/me/days/important"),
    ]);
    tasks = taskData.tasks || [];
    importantDates = dateData.dates || [];
    loaded = true;
    renderAll();
    setStatus("");
  } catch (error) {
    setStatus(error.message || "生活计划加载失败，请稍后重试。", true);
    renderAll();
  }
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.showModal) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.close) dialog.close();
}

function editTask(id = null) {
  activeTaskId = id;
  const task = tasks.find((item) => item.id === id);
  $("#task-dialog-title").textContent = task ? "编辑任务" : "新的任务";
  $("#task-title").value = task?.title || "";
  $("#task-date").value = task?.date || dateKey(selectedDate);
  $("#task-time").value = task?.time || "";
  $("#task-tag").value = task?.tag || "Personal";
  $("#task-repeat").value = "none";
  $("#task-repeat").disabled = Boolean(task);
  $("#task-meta").textContent = task ? "正在修改现有任务" : "重复任务会创建独立日期记录，之后可逐条调整。";
  $("#delete-task").hidden = !task;
  openDialog("task-dialog");
}

async function saveTask(event) {
  event.preventDefault();
  const button = $("#save-task");
  const payload = {
    title: $("#task-title").value.trim(),
    date: $("#task-date").value,
    time: $("#task-time").value || null,
    tag: $("#task-tag").value,
    repeat: $("#task-repeat").value,
  };
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    let result;
    if (activeTaskId) {
      result = await api(`/api/me/days/tasks/${encodeURIComponent(activeTaskId)}`, {
        method: "PATCH",
        csrfToken: auth.csrfToken,
        body: payload,
      });
    } else {
      result = await api("/api/me/days/tasks", { method: "POST", csrfToken: auth.csrfToken, body: payload });
    }
    closeDialog("task-dialog");
    selectedDate = parseDate(payload.date);
    cursorDate = new Date(selectedDate);
    await loadDays();
    window.dispatchEvent(new CustomEvent("xc:data-changed", { detail: { source: "days" } }));
    notify(result.generatedCount > 1 ? `已创建 ${result.generatedCount} 条重复任务` : "任务已保存");
  } catch (error) {
    $("#task-meta").textContent = error.message || "保存失败，请重试。";
  } finally {
    button.disabled = false;
    button.textContent = "保存";
  }
}

async function toggleTask(task) {
  try {
    await api(`/api/me/days/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      csrfToken: auth.csrfToken,
      body: { completed: !task.completed },
    });
    task.completed = !task.completed;
    renderTasks();
    window.dispatchEvent(new CustomEvent("xc:data-changed", { detail: { source: "days" } }));
  } catch (error) {
    notify(error.message || "状态更新失败", true);
  }
}

async function deleteTask() {
  if (!activeTaskId || !window.confirm("确定删除这条任务吗？")) return;
  try {
    await api(`/api/me/days/tasks/${encodeURIComponent(activeTaskId)}`, {
      method: "DELETE",
      csrfToken: auth.csrfToken,
      body: {},
    });
    closeDialog("task-dialog");
    await loadDays();
    window.dispatchEvent(new CustomEvent("xc:data-changed", { detail: { source: "days" } }));
    notify("任务已删除");
  } catch (error) {
    $("#task-meta").textContent = error.message || "删除失败，请重试。";
  }
}

function editImportant(id = null) {
  activeImportantId = id;
  const item = importantDates.find((date) => date.id === id);
  $("#important-dialog-title").textContent = item ? "编辑重要日期" : "新的重要日期";
  $("#important-title").value = item?.title || "";
  $("#important-date").value = item?.date || dateKey(selectedDate);
  $("#important-note").value = item?.note || "";
  $("#important-repeat").value = item?.repeatRule || "none";
  $("#delete-important").hidden = !item;
  openDialog("important-dialog");
}

async function saveImportant(event) {
  event.preventDefault();
  const button = $("#save-important");
  const payload = {
    title: $("#important-title").value.trim(),
    date: $("#important-date").value,
    note: $("#important-note").value,
    repeatRule: $("#important-repeat").value,
  };
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    if (activeImportantId) {
      await api(`/api/me/days/important/${encodeURIComponent(activeImportantId)}`, { method: "PATCH", csrfToken: auth.csrfToken, body: payload });
    } else {
      await api("/api/me/days/important", { method: "POST", csrfToken: auth.csrfToken, body: payload });
    }
    closeDialog("important-dialog");
    await loadDays();
    window.dispatchEvent(new CustomEvent("xc:data-changed", { detail: { source: "days" } }));
    notify("重要日期已保存");
  } catch (error) {
    notify(error.message || "重要日期保存失败", true);
  } finally {
    button.disabled = false;
    button.textContent = "保存";
  }
}

async function deleteImportant() {
  if (!activeImportantId || !window.confirm("确定删除这个重要日期吗？")) return;
  try {
    await api(`/api/me/days/important/${encodeURIComponent(activeImportantId)}`, {
      method: "DELETE",
      csrfToken: auth.csrfToken,
      body: {},
    });
    closeDialog("important-dialog");
    await loadDays();
    window.dispatchEvent(new CustomEvent("xc:data-changed", { detail: { source: "days" } }));
    notify("重要日期已删除");
  } catch (error) {
    notify(error.message || "删除失败", true);
  }
}

async function changePeriod(direction) {
  cursorDate = calendarView === "week"
    ? addDays(cursorDate, direction * 7)
    : addMonths(cursorDate, direction);
  selectedDate = calendarView === "week" ? startOfWeek(cursorDate) : new Date(cursorDate);
  await loadDays();
}

export async function mountDays(authState, options = {}) {
  auth = authState;
  notify = options.notify || notify;
  if (!mounted) {
    mounted = true;
    const dayIcon = $("#home-day-icon");
    if (dayIcon) dayIcon.textContent = String(new Date().getDate());
    $("#calendar-prev")?.addEventListener("click", () => changePeriod(-1));
    $("#calendar-next")?.addEventListener("click", () => changePeriod(1));
    $("#calendar-today")?.addEventListener("click", async () => {
      cursorDate = startOfLocalDay(new Date());
      selectedDate = new Date(cursorDate);
      await loadDays();
    });
    $$('[data-calendar-view]').forEach((button) => button.addEventListener("click", async () => {
      calendarView = button.dataset.calendarView;
      $$('[data-calendar-view]').forEach((item) => item.classList.toggle("active", item === button));
      const weekEl = $("#week");
      const monthEl = $("#month");
      if (weekEl) weekEl.hidden = calendarView === "month";
      if (monthEl) monthEl.hidden = calendarView !== "month";
      await loadDays();
    }));
    $("#add-task")?.addEventListener("click", () => editTask());
    $("#task-form")?.addEventListener("submit", saveTask);
    $("#delete-task")?.addEventListener("click", deleteTask);
    $("#add-important")?.addEventListener("click", () => editImportant());
    $("#important-form")?.addEventListener("submit", saveImportant);
    $("#delete-important")?.addEventListener("click", deleteImportant);
    window.addEventListener("xc:data-changed", (e) => {
      if (e.detail?.source !== "days" && auth?.authenticated) loadDays();
    });
  }
  if (!loaded) await loadDays();
}

export function openTaskComposer() {
  editTask();
}

export function openImportantComposer() {
  editImportant();
}
