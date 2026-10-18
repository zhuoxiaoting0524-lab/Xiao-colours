import { api, getMe } from "./auth-client.js";

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

  if (!current) {
    next.hidden = false;
    next.classList.add("is-active");
    return;
  }

  current.classList.remove("is-active");

  const reveal = () => {
    current.hidden = true;
    next.hidden = false;
    void next.offsetWidth;
    next.classList.add("is-active");
  };

  if (reducedMotion) {
    reveal();
    return;
  }

  window.setTimeout(reveal, 220);
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
  document.querySelectorAll("[data-empty-for]").forEach((node) => {
    node.hidden = !loggedIn;
  });

  // Hide demo filler when the signed-in user's spaces are empty shells.
  document.querySelectorAll(".view-journal .binder, .view-gallery .gallery-strip, .view-gallery .gallery-dots, .view-collections .desktop")
    .forEach((node) => {
      node.hidden = loggedIn;
    });
  document.querySelectorAll(".view-journal .year-rail, .view-journal .page-nav, .view-gallery .page-nav")
    .forEach((node) => {
      node.hidden = loggedIn;
    });
}

goButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.go;
    if (!target) return;
    if (target !== "welcome" && !authState.authenticated) {
      location.href = "./login.html";
      return;
    }
    setView(target);
  });
});

document.addEventListener("keydown", (event) => {
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
  location.reload();
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
}

boot();
