import { api, getMe, loginUrlForView } from "./auth-client.js";
import { mountOverview } from "./overview.js?v=1";
import { mountNotes } from "./notes.js?v=21";
import { mountDays } from "./days.js?v=21";
import { mountFootprints } from "./footprints.js?v=31";

const root = document.querySelector("#personal-space-v2");
const $ = (selector, scope = root) => scope?.querySelector(selector);
const $$ = (selector, scope = root) => [...(scope?.querySelectorAll(selector) || [])];
const privateRoutes = new Set(["overview", "notes", "days", "footprints"]);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const PANEL_META = {
  overview: { title: "Overview", desc: "今天的生活首页" },
  notes: { title: "Little Notes", desc: "私人便签 · 右侧面板编辑" },
  days: { title: "My Days", desc: "周视图为主 · 当日待办" },
  footprints: { title: "Footprints", desc: "地图为主体的足迹空间" },
};

let authState = {
  status: "loading",
  authenticated: false,
  user: null,
  csrfToken: "",
};
let noticeTimer = null;
let navigating = false;

function notify(message, isError = false) {
  const node = $("#personal-app-notice");
  if (!node) return;
  window.clearTimeout(noticeTimer);
  node.textContent = message;
  node.classList.toggle("is-error", isError);
  node.hidden = false;
  noticeTimer = window.setTimeout(() => {
    node.hidden = true;
  }, isError ? 7000 : 2400);
}

function setShellMode(mode) {
  root.dataset.shell = mode;
  const shell = $("#ws-shell");
  const home = $('[data-screen="home"]');
  if (mode === "workspace") {
    if (shell) shell.hidden = false;
    if (home) {
      home.classList.remove("active");
      home.hidden = true;
    }
  } else {
    if (shell) shell.hidden = true;
    if (home) {
      home.hidden = false;
      home.classList.add("active");
    }
    closeMobileNav();
  }
}

function syncNav(name) {
  $$(".ws-nav-item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.route === name);
  });
  const meta = PANEL_META[name];
  if (meta) {
    const title = $("#ws-panel-title");
    const desc = $("#ws-panel-desc");
    if (title) title.textContent = meta.title;
    if (desc) desc.textContent = meta.desc;
  }
}

function openMobileNav() {
  root.classList.add("nav-open");
  const backdrop = $("#ws-backdrop");
  if (backdrop) backdrop.hidden = false;
}

function closeMobileNav() {
  root.classList.remove("nav-open");
  const backdrop = $("#ws-backdrop");
  if (backdrop) backdrop.hidden = true;
}

function renderAccount() {
  const label = $("#personal-auth-user-label");
  const detail = $("#personal-auth-user-detail");
  const email = $("#personal-auth-user-email");
  const login = $("#personal-auth-login-link");
  const admin = $("#personal-auth-admin-link");
  const adminPop = $("#personal-auth-admin-link-pop");
  const logout = $("#personal-auth-logout-btn");
  const enter = $("#welcome-enter");
  const accountBtn = $("#personal-account");

  if (authState.status === "loading") {
    if (label) label.textContent = "正在检查登录状态…";
    if (detail) detail.textContent = "Welcome 与 Global Pulse 可公开访问。";
    if (email) email.textContent = "—";
    if (login) login.hidden = true;
    if (admin) admin.hidden = true;
    if (adminPop) adminPop.hidden = true;
    if (logout) logout.hidden = true;
    if (enter) enter.textContent = "进入工作区";
    return;
  }

  if (authState.status === "authenticated") {
    if (label) label.textContent = authState.user.displayName;
    if (detail) detail.textContent = `已登录为 ${authState.user.displayName} · 点击进入工作区`;
    if (email) email.textContent = authState.user.email;
    if (login) login.hidden = true;
    const isAdmin = authState.user.role === "admin";
    if (admin) admin.hidden = !isAdmin;
    if (adminPop) adminPop.hidden = !isAdmin;
    if (logout) logout.hidden = false;
    if (enter) enter.textContent = "进入工作区";
    if (accountBtn) accountBtn.textContent = "账户设置";
    return;
  }

  if (label) label.textContent = authState.status === "error" ? "暂时无法确认登录状态" : "未登录";
  if (detail) {
    detail.textContent = authState.status === "error"
      ? "请检查网络后刷新；为保护私人数据，不会误判为已登录。"
      : "登录后可进入 Overview、Little Notes、My Days 与 Footprints。";
  }
  if (email) email.textContent = "—";
  if (login) login.hidden = false;
  if (admin) admin.hidden = true;
  if (adminPop) adminPop.hidden = true;
  if (logout) logout.hidden = true;
  if (enter) enter.textContent = "登录后进入";
}

async function mountRoute(name) {
  if (name === "overview") {
    await mountOverview(authState, { notify, onNavigate: (target) => route(target) });
  }
  if (name === "notes") await mountNotes(authState, { notify });
  if (name === "days") await mountDays(authState, { notify });
  if (name === "footprints") await mountFootprints(authState, { notify });
}

async function route(name, { push = true } = {}) {
  if (navigating) return;
  if (name === "home" || !name) name = "home";
  const screen = $(`[data-screen="${name}"]`);
  if (!screen && name !== "home") name = authState.authenticated ? "overview" : "home";

  if (privateRoutes.has(name)) {
    if (authState.status === "loading") await authBoot;
    if (authState.status === "unauthenticated") {
      location.assign(loginUrlForView(name));
      return;
    }
    if (authState.status !== "authenticated") {
      notify("无法确认登录状态，私人模块暂未打开。", true);
      return;
    }
  }

  navigating = true;
  try {
    if (name === "home") {
      setShellMode("welcome");
      $$('[data-screen]').forEach((node) => {
        const on = node.dataset.screen === "home";
        node.classList.toggle("active", on);
        node.hidden = !on;
      });
      document.body.dataset.route = "home";
      if (push) history.pushState(null, "", `${location.pathname}${location.search}`);
    } else {
      setShellMode("workspace");
      $$('[data-screen]').forEach((node) => {
        const on = node.dataset.screen === name;
        node.classList.toggle("active", on);
        node.hidden = !on;
      });
      syncNav(name);
      document.body.dataset.route = name;
      const target = `#${name}`;
      if (push) history.pushState(null, "", target);
      await mountRoute(name);
    }
    closeMobileNav();
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    $("#personal-app")?.focus({ preventScroll: true });
  } catch (error) {
    console.error("Personal route failed:", error);
    notify(error.message || "页面加载失败，请重试。", true);
  } finally {
    navigating = false;
  }
}

async function bootAuth() {
  renderAccount();
  try {
    const me = await getMe();
    authState = me.authenticated
      ? { status: "authenticated", authenticated: true, user: me.user, csrfToken: me.csrfToken || "" }
      : { status: "unauthenticated", authenticated: false, user: null, csrfToken: "" };
  } catch (error) {
    authState = { status: "error", authenticated: false, user: null, csrfToken: "", error };
  }
  renderAccount();
  return authState;
}

const authBoot = bootAuth();

$$("[data-route]").forEach((button) => {
  button.addEventListener("click", () => route(button.dataset.route));
});

window.addEventListener("popstate", () => {
  const hash = location.hash.slice(1);
  route(hash || "home", { push: false });
});

$("#ws-menu")?.addEventListener("click", openMobileNav);
$("#ws-sidebar-close")?.addEventListener("click", closeMobileNav);
$("#ws-backdrop")?.addEventListener("click", closeMobileNav);

$("#personal-account")?.addEventListener("click", () => {
  const pop = $("#personal-account-pop");
  if (!pop) return;
  pop.hidden = !pop.hidden;
  $("#personal-account")?.setAttribute("aria-expanded", String(!pop.hidden));
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#personal-account,#personal-account-pop")) {
    const pop = $("#personal-account-pop");
    if (pop) pop.hidden = true;
    $("#personal-account")?.setAttribute("aria-expanded", "false");
  }
});

$("#personal-auth-logout-btn")?.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", csrfToken: authState.csrfToken, body: {} });
  } finally {
    location.href = "./index.html";
  }
});

$("#places-drawer-toggle")?.addEventListener("click", () => {
  const panel = $("#place-panel");
  if (!panel) return;
  const open = panel.classList.toggle("is-open");
  $("#places-drawer-toggle").textContent = open ? "收起列表" : "展开列表";
  root.classList.toggle("places-collapsed", !open);
});

$$("[data-close]").forEach((button) => button.addEventListener("click", () => {
  const dialog = document.getElementById(button.dataset.close);
  if (dialog?.open) dialog.close();
}));

$$("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
}));

window.addEventListener("resize", () => {
  if (window.innerWidth > 768) closeMobileNav();
});

await authBoot;
const initialHash = location.hash.slice(1);
let initial = initialHash || "home";
if (!initialHash && authState.status === "authenticated") initial = "overview";
if (privateRoutes.has(initial) || initial === "home") {
  await route(initial, { push: false });
} else {
  await route(authState.status === "authenticated" ? "overview" : "home", { push: false });
}
