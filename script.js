import { api, getMe, loginUrlForView, PRIVATE_VIEWS } from "./auth-client.js";
import { mountJournal } from "./journal.js";

/**
 * Unified site session with explicit auth status to prevent redirect loops.
 * status: loading | authenticated | unauthenticated | error
 */

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const views = [...document.querySelectorAll(".view")];
const goButtons = document.querySelectorAll("[data-go]");

let authState = {
  status: "loading",
  authenticated: false,
  user: null,
  csrfToken: "",
  spaces: null,
  errorMessage: "",
};

let loginRedirectQueued = false;

function setView(name) {
  const next = views.find((view) => view.dataset.view === name);
  if (!next || next.classList.contains("is-active")) return;

  const current = views.find((view) => view.classList.contains("is-active"));

  const afterReveal = () => {
    if (name === "journal" && authState.status === "authenticated") {
      mountJournal(authState).catch((error) => {
        showAuthError(error?.message || "无法加载 Journal");
      });
    }
  };

  if (!current) {
    next.hidden = false;
    next.classList.add("is-active");
    syncLocationForView(name);
    afterReveal();
    return;
  }

  current.classList.remove("is-active");

  const reveal = () => {
    current.hidden = true;
    next.hidden = false;
    void next.offsetWidth;
    next.classList.add("is-active");
    syncLocationForView(name);
    afterReveal();
  };

  if (reducedMotion) {
    reveal();
    return;
  }

  window.setTimeout(reveal, 220);
}

function syncLocationForView(name) {
  const url = new URL(window.location.href);
  if (name === "welcome") {
    url.hash = "";
  } else if (PRIVATE_VIEWS.includes(name)) {
    url.hash = name;
  }
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function showAuthError(message) {
  const label = document.querySelector("#auth-user-label");
  if (label) {
    label.textContent = message;
  }
  let banner = document.querySelector("#auth-error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "auth-error-banner";
    banner.className = "auth-error-banner";
    banner.innerHTML = `<span></span> <button type="button" id="auth-retry-btn">重试</button>`;
    document.body.append(banner);
    banner.querySelector("#auth-retry-btn")?.addEventListener("click", () => {
      location.reload();
    });
  }
  banner.querySelector("span").textContent = message;
  banner.hidden = false;
}

function hideAuthError() {
  const banner = document.querySelector("#auth-error-banner");
  if (banner) banner.hidden = true;
}

function renderAuthBar() {
  const label = document.querySelector("#auth-user-label");
  const loginLink = document.querySelector("#auth-login-link");
  const adminLink = document.querySelector("#auth-admin-link");
  const logoutBtn = document.querySelector("#auth-logout-btn");
  if (!label) return;

  if (authState.status === "loading") {
    label.textContent = "正在检查登录状态…";
    loginLink.hidden = true;
    adminLink.hidden = true;
    logoutBtn.hidden = true;
    return;
  }

  if (authState.status === "error") {
    label.textContent = authState.errorMessage || "登录状态检查失败";
    loginLink.hidden = false;
    adminLink.hidden = false;
    adminLink.textContent = "管理员";
    logoutBtn.hidden = true;
    return;
  }

  if (authState.status !== "authenticated") {
    label.textContent = "未登录 · 私人空间需邀请注册";
    loginLink.hidden = false;
    adminLink.hidden = false;
    adminLink.textContent = "管理员";
    logoutBtn.hidden = true;
    return;
  }

  hideAuthError();
  label.textContent = `${authState.user.displayName} · ${authState.user.email}`;
  loginLink.hidden = true;
  adminLink.hidden = authState.user.role !== "admin";
  logoutBtn.hidden = false;
}

function applyEmptyStates() {
  const loggedIn = authState.status === "authenticated";

  document.querySelectorAll('[data-empty-for="gallery"], [data-empty-for="collections"]').forEach((node) => {
    node.hidden = !loggedIn;
  });

  document.querySelectorAll(".view-gallery .gallery-strip, .view-gallery .gallery-dots, .view-collections .desktop")
    .forEach((node) => {
      node.hidden = loggedIn;
    });
  document.querySelectorAll(".view-gallery .page-nav")
    .forEach((node) => {
      node.hidden = loggedIn;
    });

  const journalBinder = document.querySelector(".view-journal .binder");
  const journalRail = document.querySelector(".view-journal .year-rail");
  const journalNav = document.querySelectorAll(".view-journal .page-nav");
  if (journalBinder) journalBinder.hidden = false;
  if (journalRail) journalRail.hidden = false;
  journalNav.forEach((node) => {
    node.hidden = false;
  });
}

function redirectToLoginOnce(view) {
  if (loginRedirectQueued) return false;
  loginRedirectQueued = true;
  location.assign(loginUrlForView(view));
  return false;
}

async function requireAuthForPrivateView(target) {
  await authBoot;
  if (authState.status === "authenticated") return true;
  if (authState.status === "loading") return false;
  if (authState.status === "error") {
    showAuthError(authState.errorMessage || "无法确认登录状态，请重试");
    return false;
  }
  // Only confirmed unauthenticated may redirect to login.
  return redirectToLoginOnce(target);
}

goButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const target = button.dataset.go;
    if (!target) return;
    if (target === "welcome") {
      setView("welcome");
      return;
    }
    if (!(await requireAuthForPrivateView(target))) return;
    setView(target);
  });
});

document.addEventListener("keydown", async (event) => {
  if (event.key !== "Escape") return;
  const active = views.find((view) => view.classList.contains("is-active"));
  if (active && active.dataset.view !== "welcome") setView("welcome");
});

document.querySelector("#auth-logout-btn")?.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", {
      method: "POST",
      csrfToken: authState.csrfToken,
      body: {},
    });
  } catch {
    // Still clear local UI if session already gone.
  }
  location.href = "./index.html";
});

async function boot() {
  authState = {
    status: "loading",
    authenticated: false,
    user: null,
    csrfToken: "",
    spaces: null,
    errorMessage: "",
  };
  renderAuthBar();

  try {
    const me = await getMe();
    if (!me.authenticated) {
      authState = {
        status: "unauthenticated",
        authenticated: false,
        user: null,
        csrfToken: "",
        spaces: null,
        errorMessage: "",
      };
    } else {
      authState = {
        status: "authenticated",
        authenticated: true,
        user: me.user,
        csrfToken: me.csrfToken || "",
        spaces: null,
        errorMessage: "",
      };
      // Spaces / journal metadata must NEVER demote an authenticated session.
      try {
        const spaces = await api("/api/me/spaces");
        authState.spaces = spaces.spaces;
      } catch (spacesError) {
        console.warn("spaces load failed (session kept):", spacesError);
        authState.spaces = null;
        // Soft warning only — do not flip to unauthenticated / do not redirect.
        showAuthError(spacesError?.message || "私人空间元数据加载失败，可稍后重试");
      }
    }
  } catch (error) {
    authState = {
      status: "error",
      authenticated: false,
      user: null,
      csrfToken: "",
      spaces: null,
      errorMessage: error?.message || "登录状态检查失败",
    };
    showAuthError(authState.errorMessage);
  }

  renderAuthBar();
  applyEmptyStates();

  const hashView = window.location.hash.replace(/^#/, "");
  if (PRIVATE_VIEWS.includes(hashView)) {
    if (authState.status === "authenticated") {
      setView(hashView);
    } else if (authState.status === "unauthenticated") {
      redirectToLoginOnce(hashView);
    } else if (authState.status === "error") {
      // Stay on welcome with error — never loop to login on server/network errors.
      history.replaceState(null, "", window.location.pathname + window.location.search);
      showAuthError(authState.errorMessage);
    }
  }
}

const authBoot = boot();
