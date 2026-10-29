import { api } from "./auth-client.js";
import { mountOverviewWeather } from "./overview-weather.js?v=1";

const $ = (selector, root = document) => root.querySelector(selector);

let mounted = false;
let auth = null;
let notify = () => {};
let onNavigate = () => {};
let onAddTask = () => {};
let onAddDate = () => {};

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return startOfLocalDay(next);
}

function setStatus(message, error = false) {
  const node = $("#overview-status");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("is-error", error);
  node.hidden = !message;
}

const PLANT_SPRIG_SVG = `
<svg class="plant-sprig" viewBox="0 0 60 70" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M30 65 Q 30 35 25 10" stroke="#738B7B" stroke-width="2" stroke-linecap="round" />
  <path d="M28 50 C 15 48 10 38 18 30 C 26 32 28 42 28 50 Z" fill="#8CA595" opacity="0.8" />
  <path d="M29 38 C 42 36 48 26 40 18 C 32 20 30 30 29 38 Z" fill="#9AB2A3" opacity="0.8" />
  <path d="M26 22 C 16 18 14 10 20 5 C 26 8 26 16 26 22 Z" fill="#7E9685" opacity="0.85" />
  <path d="M25 10 C 28 2 36 2 38 8 C 36 14 30 14 25 10 Z" fill="#8CA595" opacity="0.85" />
</svg>
`;

async function loadOverview() {
  setStatus("正在整理今天的生活首页…");
  const today = startOfLocalDay(new Date());
  const from = today;
  const to = addDays(today, 14);

  try {
    const [tasksData, datesData, placesData] = await Promise.all([
      api(`/api/me/days/tasks?from=${dateKey(from)}&to=${dateKey(to)}`),
      api("/api/me/days/important"),
      api("/api/me/footprints"),
    ]);

    const tasks = (tasksData.tasks || []).filter((task) => task.date === dateKey(today));
    const dates = datesData.dates || [];
    const places = placesData.footprints || placesData.places || [];
    const visitedPlaces = places.filter((p) => p.status === "visited");
    const completedTasks = tasks.filter((task) => task.completed).length;

    // Summary stat cards
    const taskCountEl = $("#overview-task-count");
    const taskSubEl = $("#overview-task-sub");
    if (taskCountEl) taskCountEl.textContent = `${completedTasks} / ${tasks.length}`;
    if (taskSubEl) {
      taskSubEl.textContent = tasks.length
        ? (completedTasks === tasks.length ? "已全部完成！" : `还有 ${tasks.length - completedTasks} 项待完成`)
        : "还没有安排，开始计划吧";
    }

    const dateCountEl = $("#overview-date-count");
    const dateSubEl = $("#overview-date-sub");
    if (dateCountEl) dateCountEl.textContent = String(dates.length);
    if (dateSubEl) {
      dateSubEl.textContent = dates.length ? `${dates.length} 个重要时刻` : "还没有重要日期";
    }

    const placeCountEl = $("#overview-place-count");
    const placeSubEl = $("#overview-place-sub");
    if (placeCountEl) placeCountEl.textContent = String(places.length);
    if (placeSubEl) {
      placeSubEl.textContent = `已去过 ${visitedPlaces.length} 个地方`;
    }

    // Render Today's Plan (今天的小计划)
    const todosContainer = $("#overview-todos");
    if (todosContainer) {
      if (!tasks.length) {
        const wrap = document.createElement("li");
        wrap.className = "ov-empty-card-body";
        wrap.innerHTML = `
          <p class="ov-empty-tip">今天还没有安排任务</p>
          ${PLANT_SPRIG_SVG}
          <button type="button" class="btn-primary-pill">+ 添加任务</button>
        `;
        wrap.querySelector("button").addEventListener("click", onAddTask);
        todosContainer.replaceChildren(wrap);
      } else {
        todosContainer.replaceChildren(...tasks.map((task) => {
          const li = document.createElement("li");
          li.className = "ov-task-item";
          li.innerHTML = `
            <button type="button" class="ov-check-button${task.completed ? " done" : ""}" aria-label="${task.completed ? "标记为未完成" : "标记为已完成"}">✓</button>
            <span class="ov-task-title${task.completed ? " is-done" : ""}">${task.title}</span>
            ${task.time ? `<span class="ov-task-time">${task.time}</span>` : ""}
          `;
          li.querySelector("button").addEventListener("click", async () => {
            const btn = li.querySelector("button");
            btn.disabled = true;
            try {
              await api(`/api/me/days/tasks/${encodeURIComponent(task.id)}`, {
                method: "PATCH",
                csrfToken: auth.csrfToken,
                body: { completed: !task.completed },
              });
              await loadOverview();
              window.dispatchEvent(new CustomEvent("xc:data-changed", { detail: { source: "overview" } }));
            } catch (err) {
              notify(err.message || "任务状态更新失败", true);
              btn.disabled = false;
            }
          });
          return li;
        }));
      }
    }

    // Render Important Dates
    const upcoming = dates
      .map((item) => {
        const original = new Date(`${item.date}T00:00:00`);
        let occurrence = original;
        const now = startOfLocalDay(new Date());
        if (item.repeatRule === "yearly" && original < now) {
          occurrence = new Date(now.getFullYear(), original.getMonth(), original.getDate());
          if (occurrence < now) occurrence = new Date(now.getFullYear() + 1, original.getMonth(), original.getDate());
        }
        return { item, occurrence, remaining: Math.ceil((occurrence - now) / 86_400_000) };
      })
      .filter(({ remaining }) => remaining >= 0)
      .sort((a, b) => a.occurrence - b.occurrence)
      .slice(0, 4);

    const datesContainer = $("#overview-dates");
    if (datesContainer) {
      if (!upcoming.length) {
        const wrap = document.createElement("li");
        wrap.className = "ov-dates-empty-body";
        wrap.innerHTML = `<button type="button" class="btn-dashed-action">+ 添加重要日期</button>`;
        wrap.querySelector("button").addEventListener("click", onAddDate);
        datesContainer.replaceChildren(wrap);
      } else {
        datesContainer.replaceChildren(...upcoming.map(({ item, remaining }) => {
          const li = document.createElement("li");
          li.className = "ov-date-item";
          li.innerHTML = `
            <span class="ov-date-title">${item.title}</span>
            <em class="ov-date-tag">${remaining === 0 ? "今天" : remaining === 1 ? "明天" : `${remaining} 天后`}</em>
          `;
          li.addEventListener("click", () => onNavigate("days"));
          return li;
        }));
      }
    }

    setStatus("");
  } catch (error) {
    setStatus(error.message || "总览加载失败，请稍后重试。", true);
  }
}

export async function mountOverview(authState, options = {}) {
  auth = authState;
  notify = options.notify || notify;
  onNavigate = options.onNavigate || onNavigate;
  onAddTask = options.onAddTask || (() => onNavigate("days"));
  onAddDate = options.onAddDate || (() => onNavigate("days"));
  mountOverviewWeather();

  if (!mounted) {
    mounted = true;
    document.querySelectorAll("[data-overview-go]").forEach((button) => {
      button.addEventListener("click", () => onNavigate(button.dataset.overviewGo));
    });
    document.querySelectorAll("[data-overview-add]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.overviewAdd === "task") onAddTask();
        else onAddDate();
      });
    });
    window.addEventListener("xc:data-changed", () => {
      if (auth?.authenticated) loadOverview();
    });
  }

  await loadOverview();
}
