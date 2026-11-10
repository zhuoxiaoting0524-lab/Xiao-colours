import { api } from "./auth-client.js";
import { mountOverviewWeather } from "./overview-weather.js?v=1";

const $ = (selector, root = document) => root.querySelector(selector);

let mounted = false;
let auth = null;
let onNavigate = () => {};

function setStatus(message, error = false) {
  const node = $("#overview-status");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("is-error", error);
  node.hidden = !message;
}

async function loadOverview() {
  setStatus("正在整理旅行概览…");
  try {
    const placesData = await api("/api/me/footprints");
    const places = placesData.footprints || placesData.places || [];
    const visitedPlaces = places.filter((place) => place.status === "visited");
    const wishlistPlaces = places.filter((place) => place.status === "wish");

    const placeCount = $("#overview-place-count");
    const placeSummary = $("#overview-place-sub");
    if (placeCount) placeCount.textContent = String(places.length);
    if (placeSummary) placeSummary.textContent = `已去 ${visitedPlaces.length} · 想去 ${wishlistPlaces.length}`;

    setStatus("");
  } catch (error) {
    setStatus(error.message || "旅行概览加载失败，请稍后重试。", true);
  }
}

export async function mountOverview(authState, options = {}) {
  auth = authState;
  onNavigate = options.onNavigate || onNavigate;
  mountOverviewWeather();

  if (!mounted) {
    mounted = true;
    document.querySelectorAll("[data-overview-go]").forEach((button) => {
      button.addEventListener("click", () => onNavigate(button.dataset.overviewGo));
    });
    window.addEventListener("xc:data-changed", () => {
      if (auth?.authenticated) loadOverview();
    });
  }

  await loadOverview();
}
