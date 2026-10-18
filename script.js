import { api, getMe, loginUrlForView, PRIVATE_VIEWS } from "./auth-client.js";
import { mountJournal } from "./journal.js";

/**
 * Unified site session:
 * - One HttpOnly cookie (`xc_session`, Path=/) shared by every page on this origin.
 * - Welcome + Global Pulse stay public.
 * - Journal requires login (no demo browsing). Gallery / Collections same gate.
 */

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const views = [...document.querySelectorAll(".view")];
const goButtons = document.querySelectorAll("[data-go]");

let authState = {
  authenticated: false,
  user: null,
  csrfToken: "",
  spaces: null,
};

function setView(name) {
  const next = views.find((view) => view.dataset.view === name);
  if (!next || next.classList.contains("is-active")) return;

  const current = views.find((view) => view.classList.contains("is-active"));

  const afterReveal = () => {
    if (name === "journal" && authState.authenticated) {
      mountJournal(authState);
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

function renderAuthBar() {
  const label = document.querySelector("#auth-user-label");
  const loginLink = document.querySelector("#auth-login-link");
  const adminLink = document.querySelector("#auth-admin-link");
  const logoutBtn = document.querySelector("#auth-logout-btn");
  if (!label) return;

  if (!authState.authenticated) {
    label.textContent = "未登录 · 私人空间需邀请注册";
    loginLink.hidden = false;
    adminLink.hidden = false;
    adminLink.textContent = "管理员";
    logoutBtn.hidden = true;
    return;
  }

  label.textContent = `${authState.user.displayName} · ${authState.user.email}`;
  loginLink.hidden = true;
  adminLink.hidden = authState.user.role !== "admin";
  logoutBtn.hidden = false;
}

function applyEmptyStates() {
  const loggedIn = authState.authenticated;

  // Gallery / Collections still use shell empty copy until those modules ship.
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

  // Journal: always keep binder for logged-in users (blank paper + create CTA).
  // Unauthenticated users never reach this view (login redirect).
  const journalBinder = document.querySelector(".view-journal .binder");
  const journalRail = document.querySelector(".view-journal .year-rail");
  const journalNav = document.querySelectorAll(".view-journal .page-nav");
  if (journalBinder) journalBinder.hidden = false;
  if (journalRail) journalRail.hidden = false;
  journalNav.forEach((node) => {
    node.hidden = false;
  });
}

async function requireAuthForPrivateView(target) {
  await authBoot;
  if (authState.authenticated) return true;
  location.href = loginUrlForView(target);
  return false;
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
  try {
    const me = await getMe();
    authState = {
      authenticated: Boolean(me.authenticated),
      user: me.user,
      csrfToken: me.csrfToken || "",
      spaces: null,
    };
    if (authState.authenticated) {
      const spaces = await api("/api/me/spaces");
      authState.spaces = spaces.spaces;
    }
  } catch {
    authState = { authenticated: false, user: null, csrfToken: "", spaces: null };
  }
  renderAuthBar();
  applyEmptyStates();

  const hashView = window.location.hash.replace(/^#/, "");
  if (PRIVATE_VIEWS.includes(hashView)) {
    if (authState.authenticated) {
      setView(hashView);
    } else {
      location.replace(loginUrlForView(hashView));
    }
  }
}

const authBoot = boot();
