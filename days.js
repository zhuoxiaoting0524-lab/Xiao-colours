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

function formatMonth(date) {
  return new Intl.DateTimeFormat("en", { month: "long" }).format(date).toUpperCase();
}

function formatLong(date) {
  return new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function setStatus(message, error = false) {
  const node = $("#days-status");
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
  const { from, to } = currentRange();
  $("#calendar-month-label").textContent = formatMonth(cursorDate);
  $("#calendar-range-label").textContent = calendarView === "week"
    ? `${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(from)} — ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(to)}`
    : `${new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(cursorDate)}`;
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
  $("#week").replaceChildren(...Array.from({ length: 7 }, (_, index) => {
    const date = addDays(from, index);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `day${sameDay(date, selectedDate) ? " active" : ""}${dayTasks(date).length ? " has" : ""}`;
    button.setAttribute("aria-label", formatLong(date));
    button.innerHTML = "<span></span><b></b><i></i>";
    button.querySelector("span").textContent = new Intl.DateTimeFormat("en", { weekday: "short" }).format(date).toUpperCase();
    button.querySelector("b").textContent = String(date.getDate());
    if (sameDay(date, today)) button.dataset.today = "true";
    button.addEventListener("click", () => selectDate(date));
    return button;
  }));
}

function renderMonth() {
  const monthStart = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
  const from = startOfWeek(monthStart);
  const today = startOfLocalDay(new Date());
  $("#month").replaceChildren(...Array.from({ length: 42 }, (_, index) => {
    const date = addDays(from, index);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(date.getDate());
    button.classList.toggle("outside", date.getMonth() !== cursorDate.getMonth());
    button.classList.toggle("active", sameDay(date, selectedDate));
    button.classList.toggle("today", sameDay(date, today));
    button.classList.toggle("has", dayTasks(date).length > 0);
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
  $("#day-label").textContent = sameDay(selectedDate, today)
    ? `TODAY · ${new Intl.DateTimeFormat("en", { weekday: "short" }).format(selectedDate).toUpperCase()}`
    : new Intl.DateTimeFormat("en", { weekday: "long" }).format(selectedDate).toUpperCase();
  $("#day-title").textContent = formatLong(selectedDate);
  const container = $("#tasks");
  if (!list.length) {
    container.innerHTML = '<p class="empty">这一天还没有任务。点击 Add task 创建一个。</p>';
  } else {
    container.replaceChildren(...list.map((task) => {
      const row = document.createElement("article");
      row.className = `task${task.completed ? " done" : ""}`;
      row.innerHTML = '<button class="check" type="button" aria-label="切换完成状态"></button><time></time><h4></h4><span><i class="tag"></i><button class="edit" type="button" aria-label="编辑任务">···</button></span>';
      row.querySelector("time").textContent = task.time || "ALL DAY";
      row.querySelector("h4").textContent = task.title;
      row.querySelector(".tag").textContent = task.tag;
      row.querySelector(".check").addEventListener("click", () => toggleTask(task));
      row.querySelector(".edit").addEventListener("click", () => editTask(task.id));
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
  $("#week-progress-label").textContent = `${completed} / ${weekTasks.length}`;
  $("#week-progress-bar").style.width = weekTasks.length ? `${Math.round(completed / weekTasks.length * 100)}%` : "0%";
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
  const sorted = importantDates
    .map((item) => ({ item, occurrence: nextImportantOccurrence(item) }))
    .sort((a, b) => a.occurrence - b.occurrence)
    .slice(0, 8);
  if (!sorted.length) {
    container.innerHTML = '<span class="empty-date">还没有重要日期。</span>';
    return;
  }
  container.replaceChildren(...sorted.map(({ item, occurrence }) => {
    const article = document.createElement("article");
    article.tabIndex = 0;
    article.setAttribute("role", "button");
    const remaining = Math.ceil((startOfLocalDay(occurrence) - startOfLocalDay(new Date())) / DAY_MS);
    article.innerHTML = "<time></time><b><span></span><small></small></b>";
    article.querySelector("time").textContent = new Intl.DateTimeFormat("en", { day: "2-digit", month: "short" }).format(occurrence).toUpperCase();
    article.querySelector("b span").textContent = item.title;
    article.querySelector("small").textContent = remaining === 0 ? "Today" : remaining > 0 ? `${remaining} days` : "Passed";
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
  const dialog = $(`#${id}`);
  if (!dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = $(`#${id}`);
  if (dialog.open) dialog.close();
}

function editTask(id = null) {
  activeTaskId = id;
  const task = tasks.find((item) => item.id === id);
  $("#task-dialog-title").textContent = task ? "编辑任务" : "新的任务";
  $("#task-title").value = task?.title || "";
  $("#task-date").value = task?.date || dateKey(selectedDate);
  $("#task-time").value = task?.time || "";
  $("#task-tag").value = task?.tag || "Personal";
  $("#task-repeat").value = task?.repeatRule || "none";
  $("#task-repeat").disabled = Boolean(task);
  $("#task-meta").textContent = task
    ? "当前只编辑这一条记录。"
    : "重复任务会创建独立日期记录，之后可逐条调整。";
  $("#delete-task").hidden = !task;
  openDialog("task-dialog");
}

async function saveTask(event) {
  event.preventDefault();
  const button = $("#save-task");
  const payload = {
    title: $("#task-title").value.trim(),
    date: $("#task-date").value,
    time: $("#task-time").value,
    tag: $("#task-tag").value,
  };
  if (!activeTaskId) payload.repeatRule = $("#task-repeat").value;
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    const result = activeTaskId
      ? await api(`/api/me/days/tasks/${encodeURIComponent(activeTaskId)}`, { method: "PATCH", csrfToken: auth.csrfToken, body: payload })
      : await api("/api/me/days/tasks", { method: "POST", csrfToken: auth.csrfToken, body: payload });
    closeDialog("task-dialog");
    selectedDate = parseDate(payload.date);
    cursorDate = new Date(selectedDate);
    await loadDays();
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
    $("#home-day-icon").textContent = String(new Date().getDate());
    $("#calendar-prev").addEventListener("click", () => changePeriod(-1));
    $("#calendar-next").addEventListener("click", () => changePeriod(1));
    $$('[data-calendar-view]').forEach((button) => button.addEventListener("click", async () => {
      calendarView = button.dataset.calendarView;
      $$('[data-calendar-view]').forEach((item) => item.classList.toggle("active", item === button));
      $("#week").hidden = calendarView === "month";
      $("#month").hidden = calendarView !== "month";
      await loadDays();
    }));
    $("#add-task").addEventListener("click", () => editTask());
    $("#task-form").addEventListener("submit", saveTask);
    $("#delete-task").addEventListener("click", deleteTask);
    $("#add-important").addEventListener("click", () => editImportant());
    $("#important-form").addEventListener("submit", saveImportant);
    $("#delete-important").addEventListener("click", deleteImportant);
  }
  if (!loaded) await loadDays();
}
