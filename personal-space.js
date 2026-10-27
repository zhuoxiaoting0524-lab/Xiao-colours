import { api, getMe, loginUrlForView } from "./auth-client.js";
import { mountOverview } from "./overview.js?v=4";
import { mountDays, openTaskComposer, openImportantComposer } from "./days.js?v=23";
import { mountFootprints } from "./footprints.js?v=35";

const root = document.querySelector("#personal-space-v2");
const $ = (selector, scope = root) => scope?.querySelector(selector);
const $$ = (selector, scope = root) => [...(scope?.querySelectorAll(selector) || [])];
const privateRoutes = new Set(["overview", "days", "footprints", "settings"]);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const PANEL_META = {
  overview: { title: "Overview", desc: "温柔的问候、今日计划与生活概览" },
  days: { title: "My Days", desc: "把日子过成自己喜欢的样子。" },
  footprints: { title: "Footprints", desc: "走过的地方，都是生活的颜色。" },
  settings: { title: "设置", desc: "让这个空间更符合你的喜好。" },
};

let authState = {
  status: "loading",
  authenticated: false,
  user: null,
  csrfToken: "",
};
let noticeTimer = null;
let navigating = false;
let settingsMounted = false;

function effectiveTheme(choice) {
  if (choice !== "system") return choice;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const COLOR_SCHEMES = {
  sage: { primary: "#738B7B", primaryDark: "#526D59", primarySoft: "#E8EEE7" },
  peach: { primary: "#E8A588", primaryDark: "#B86F50", primarySoft: "#FCEEE7" },
  rose: { primary: "#E09292", primaryDark: "#B55E5E", primarySoft: "#FCEBEB" },
  blue: { primary: "#8EAAC9", primaryDark: "#5B7E9F", primarySoft: "#EAF1F8" },
  lavender: { primary: "#B89FD1", primaryDark: "#8162A0", primarySoft: "#F4EFF9" },
};

function applyColorScheme(scheme = localStorage.getItem("xiaocolour-color-scheme") || "sage") {
  const chosen = COLOR_SCHEMES[scheme] || COLOR_SCHEMES.sage;
  root.style.setProperty("--color-primary", chosen.primary);
  root.style.setProperty("--color-primary-dark", chosen.primaryDark);
  root.style.setProperty("--color-primary-soft", chosen.primarySoft);
  root.style.setProperty("--brand", chosen.primary);
  root.style.setProperty("--brand-soft", chosen.primarySoft);
  root.style.setProperty("--primary-dark", chosen.primaryDark);
  $$(".swatch-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.colorScheme === scheme);
  });
}

function applyTheme(choice = localStorage.getItem("xiaocolour-theme") || "light") {
  const allowed = ["light", "dark", "system"];
  const next = allowed.includes(choice) ? choice : "light";
  root.dataset.themeChoice = next;
  root.dataset.theme = effectiveTheme(next);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", root.dataset.theme === "dark" ? "#18201C" : "#F8F7F2");
  root.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const selected = button.dataset.themeChoice === next;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", String(selected));
  });
  applyColorScheme();
}

applyTheme();

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
    const initial = authState.user.displayName?.trim()?.charAt(0)?.toUpperCase() || "X";
    $("#ws-account-initial") && ($("#ws-account-initial").textContent = initial);
    return;
  }

  if (label) label.textContent = authState.status === "error" ? "暂时无法确认登录状态" : "未登录";
  if (detail) {
    detail.textContent = authState.status === "error"
      ? "请检查网络后刷新；为保护私人数据，不会误判为已登录。"
      : "登录后可进入 Overview、My Days 与 Footprints。";
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
    await mountOverview(authState, {
      notify,
      onNavigate: (target) => route(target),
      onAddTask: async () => { await route("days"); openTaskComposer(); },
      onAddDate: async () => { await route("days"); openImportantComposer(); },
    });
  }
  if (name === "days") await mountDays(authState, { notify });
  if (name === "footprints") await mountFootprints(authState, { notify });
  if (name === "settings") mountSettings();
}

function mountSettings() {
  const user = authState.user;
  if (!user) return;
  const initial = user.displayName?.trim()?.charAt(0)?.toUpperCase() || "X";
  const avatarEl = $("#settings-avatar");
  if (avatarEl) avatarEl.textContent = initial;
  const nameEl = $("#settings-name");
  if (nameEl) nameEl.textContent = user.displayName || "XiaoColour";
  const emailEl = $("#settings-email");
  if (emailEl) emailEl.textContent = user.email || "记录生活的每一份美好";
  const adminLink = $("#settings-admin-link");
  if (adminLink) adminLink.hidden = user.role !== "admin";
  
  applyTheme(root.dataset.themeChoice);
  applyColorScheme();

  if (settingsMounted) return;
  settingsMounted = true;

  $$("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => {
    const choice = button.dataset.themeChoice;
    localStorage.setItem("xiaocolour-theme", choice);
    applyTheme(choice);
    notify("外观主题已保存");
  }));

  $$(".swatch-btn").forEach((btn) => btn.addEventListener("click", () => {
    const scheme = btn.dataset.colorScheme;
    localStorage.setItem("xiaocolour-color-scheme", scheme);
    applyColorScheme(scheme);
    notify("界面风格已更新");
  }));

  $("#settings-notify-toggle")?.addEventListener("change", (e) => {
    notify(e.target.checked ? "提醒通知已开启" : "提醒通知已关闭");
  });

  $("#settings-lang")?.addEventListener("change", (e) => {
    notify(`语言已切换为 ${e.target.options[e.target.selectedIndex].text}`);
  });

  $("#settings-edit-profile")?.addEventListener("click", () => {
    const currentName = $("#settings-name").textContent;
    const newName = window.prompt("修改显示名称：", currentName);
    if (newName && newName.trim()) {
      $("#settings-name").textContent = newName.trim();
      notify("个人资料已更新");
    }
  });

  $("#settings-logout")?.addEventListener("click", logout);
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST", csrfToken: authState.csrfToken, body: {} });
  } finally {
    location.href = "./index.html";
  }
}

async function route(name, { push = true } = {}) {
  if (navigating) return;
  if (name === "home" || !name) name = "home";
  const screen = $(`[data-screen="${name}"]`);
  if (!screen && name !== "home") {
    name = authState.authenticated ? "overview" : "home";
    if (!push) {
      const replacement = name === "home" ? `${location.pathname}${location.search}` : `#${name}`;
      history.replaceState(null, "", replacement);
    }
  }

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

$("#personal-auth-logout-btn")?.addEventListener("click", logout);

$("#ws-header-search")?.addEventListener("click", () => {
  if (location.hash !== "#footprints") {
    route("footprints");
  }
  setTimeout(() => {
    $("#place-search")?.focus();
  }, 120);
});

$("#ws-header-notify")?.addEventListener("click", () => {
  notify("今日一切顺利，生活自有节奏。☀");
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

matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (root.dataset.themeChoice === "system") applyTheme("system");
});

await authBoot;
const initialHash = location.hash.slice(1);
let initial = initialHash || "home";
if (!initialHash && authState.status === "authenticated") initial = "overview";
await route(initial, { push: false });
