import { api } from "./auth-client.js";

const $ = (selector, root = document) => root.querySelector(selector);

let mounted = false;
let auth = null;
let notify = () => {};
let onNavigate = () => {};

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

function fillList(container, items, emptyText, renderItem, emptyAction) {
  if (!items.length) {
    const wrap = document.createElement("div");
    wrap.className = "overview-empty-wrap";
    const text = document.createElement("p");
    text.className = "overview-empty";
    text.textContent = emptyText;
    wrap.appendChild(text);
    if (emptyAction) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quick-btn";
      button.textContent = emptyAction.label;
      button.addEventListener("click", emptyAction.onClick);
      wrap.appendChild(button);
    }
    container.replaceChildren(wrap);
    return;
  }
  container.replaceChildren(...items.map(renderItem));
}

async function loadOverview() {
  setStatus("正在整理今天的生活首页…");
  const today = startOfLocalDay(new Date());
  const from = today;
  const to = addDays(today, 14);

  $("#overview-date").textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(today);

  const hour = today.getHours ? new Date().getHours() : 12;
  $("#overview-greet").textContent = hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";

  try {
    const [notesData, tasksData, datesData, placesData] = await Promise.all([
      api("/api/me/notes?sort=updated_desc"),
      api(`/api/me/days/tasks?from=${dateKey(from)}&to=${dateKey(to)}`),
      api("/api/me/days/important"),
      api("/api/me/footprints"),
    ]);

    const notes = notesData.notes || [];
    const tasks = (tasksData.tasks || []).filter((task) => task.date === dateKey(today));
    const dates = datesData.dates || [];
    const places = placesData.footprints || placesData.places || [];

    fillList(
      $("#overview-todos"),
      tasks.slice(0, 6),
      "今天还没有待办",
      (task) => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="ov-check${task.completed ? " done" : ""}" aria-hidden="true"></span><span></span>`;
        li.querySelector("span:last-child").textContent = task.title;
        return li;
      },
      { label: "添加任务", onClick: () => onNavigate("days") },
    );

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

    fillList(
      $("#overview-dates"),
      upcoming,
      "暂无即将到来的重要日期",
      ({ item, remaining }) => {
        const li = document.createElement("li");
        li.innerHTML = `<span></span><em></em>`;
        li.querySelector("span").textContent = item.title;
        li.querySelector("em").textContent = remaining === 0 ? "今天" : `${remaining} 天后`;
        return li;
      },
      { label: "添加日期", onClick: () => onNavigate("days") },
    );

    fillList(
      $("#overview-notes"),
      notes.slice(0, 4),
      "还没有便签",
      (note) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `overview-note color-${note.color || "ivory"}`;
        btn.textContent = note.title || "Untitled note";
        btn.addEventListener("click", () => onNavigate("notes"));
        return btn;
      },
      { label: "新建便签", onClick: () => onNavigate("notes") },
    );

    fillList(
      $("#overview-footprints"),
      places.slice(0, 4),
      "还没有足迹",
      (place) => {
        const li = document.createElement("li");
        li.innerHTML = `<span></span><em></em>`;
        li.querySelector("span").textContent = place.name;
        li.querySelector("em").textContent = place.status === "visited" ? "去过" : "想去";
        li.style.cursor = "pointer";
        li.addEventListener("click", () => onNavigate("footprints"));
        return li;
      },
      { label: "添加地点", onClick: () => onNavigate("footprints") },
    );

    setStatus("");
  } catch (error) {
    setStatus(error.message || "总览加载失败，请稍后重试。", true);
  }
}

export async function mountOverview(authState, options = {}) {
  auth = authState;
  notify = options.notify || notify;
  onNavigate = options.onNavigate || onNavigate;
  if (!mounted) {
    mounted = true;
    document.querySelectorAll("[data-overview-go]").forEach((button) => {
      button.addEventListener("click", () => onNavigate(button.dataset.overviewGo));
    });
  }
  await loadOverview();
}
