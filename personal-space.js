import { api, getMe, loginUrlForView } from "./auth-client.js";
import { mountNotes } from "./notes.js?v=20";
import { mountDays } from "./days.js?v=20";
import { mountFootprints } from "./footprints.js?v=20";

const root = document.querySelector("#personal-space-v2");
const $ = (selector, scope = root) => scope?.querySelector(selector);
const $$ = (selector, scope = root) => [...(scope?.querySelectorAll(selector) || [])];
const privateRoutes = new Set(["notes", "days", "footprints"]);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

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

function renderAccount() {
  const label = $("#personal-auth-user-label");
  const detail = $("#personal-auth-user-detail");
  const login = $("#personal-auth-login-link");
  const admin = $("#personal-auth-admin-link");
  const logout = $("#personal-auth-logout-btn");
  const trigger = $("#personal-account");
  if (!label) return;
  if (authState.status === "loading") {
    label.textContent = "正在检查登录状态…";
    detail.textContent = "Welcome 与 Global Pulse 可公开访问。";
    trigger.textContent = "···";
    login.hidden = true;
    admin.hidden = true;
    logout.hidden = true;
    return;
  }
  if (authState.status === "authenticated") {
    label.textContent = authState.user.displayName;
    detail.textContent = authState.user.email;
    trigger.textContent = authState.user.displayName.slice(0, 1).toLowerCase();
    login.hidden = true;
    admin.hidden = authState.user.role !== "admin";
    logout.hidden = false;
    return;
  }
  label.textContent = authState.status === "error" ? "暂时无法确认登录状态" : "未登录";
  detail.textContent = authState.status === "error"
    ? "请检查网络后刷新；为保护私人数据，不会误判为已登录。"
    : "登录后可进入三个私人模块。";
  trigger.textContent = "···";
  login.hidden = false;
  admin.hidden = false;
  logout.hidden = true;
}

async function mountRoute(name) {
  if (name === "notes") await mountNotes(authState, { notify });
  if (name === "days") await mountDays(authState, { notify });
  if (name === "footprints") await mountFootprints();
}

async function route(name, { push = true } = {}) {
  if (navigating) return;
  name = $( `[data-screen="${name}"]` ) ? name : "home";
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
    $$('[data-screen]').forEach((screen) => screen.classList.toggle("active", screen.dataset.screen === name));
    document.body.dataset.route = name;
    const target = name === "home" ? `${location.pathname}${location.search}` : `#${name}`;
    if (push) history.pushState(null, "", target);
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    $("#personal-app")?.focus({ preventScroll: true });
    await mountRoute(name);
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

$$('[data-route]').forEach((button) => button.addEventListener("click", () => route(button.dataset.route)));

window.addEventListener("popstate", () => route(location.hash.slice(1) || "home", { push: false }));

$("#personal-account")?.addEventListener("click", () => {
  const pop = $("#personal-account-pop");
  pop.hidden = !pop.hidden;
  $("#personal-account").setAttribute("aria-expanded", String(!pop.hidden));
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

$$('[data-close]').forEach((button) => button.addEventListener("click", () => {
  const dialog = document.getElementById(button.dataset.close);
  if (dialog?.open) dialog.close();
}));

$$('dialog').forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
}));

await authBoot;
const initial = location.hash.slice(1) || "home";
await route(privateRoutes.has(initial) ? initial : "home", { push: false });
