const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const templates = {
  Reykjavík: { country: "Iceland", coordinates: [-21.9426, 64.1466] },
  Seoul: { country: "South Korea", coordinates: [126.978, 37.5665] },
  Marrakech: { country: "Morocco", coordinates: [-7.9811, 31.6295] },
};

let places = [
  { id: 1, name: "Barcelona", country: "Spain", status: "visited", note: "熟悉的街道、海风和缓慢的傍晚。", coordinates: [2.1734, 41.3851], date: "2026 · CURRENT" },
  { id: 2, name: "Lisbon", country: "Portugal", status: "visited", note: "坡道、电车和阳光落在旧墙上的颜色。", coordinates: [-9.1393, 38.7223], date: "2025 · SPRING" },
  { id: 3, name: "Tokyo", country: "Japan", status: "wish", note: "想去认真走一次城市，也想看安静的近郊。", coordinates: [139.6917, 35.6895], date: "SOMEDAY" },
  { id: 4, name: "Iceland", country: "Iceland", status: "wish", note: "想看冬天的海岸、风和很远的光。", coordinates: [-19.0208, 64.9631], date: "SOMEDAY" },
];

let mounted = false;
let placeFilter = "all";
let activePlace = null;
let mapInstance = null;
let mapModule = null;
let mapPromise = null;
let mapMarkers = [];

function filteredPlaces() {
  const query = $("#place-search").value.trim().toLowerCase();
  return places.filter((place) => (
    (placeFilter === "all" || place.status === placeFilter)
    && `${place.name} ${place.country}`.toLowerCase().includes(query)
  ));
}

function renderPlaces() {
  $("#place-list").replaceChildren(...filteredPlaces().map((place) => {
    const button = document.createElement("button");
    button.className = "place";
    button.type = "button";
    button.dataset.status = place.status;
    button.innerHTML = "<span><b></b><small></small></span><i></i>";
    button.querySelector("b").textContent = place.name;
    button.querySelector("small").textContent = place.country;
    button.addEventListener("click", () => showPlace(place.id));
    return button;
  }));
  syncMapMarkers();
}

function syncMapMarkers() {
  mapMarkers.forEach((marker) => marker.remove());
  mapMarkers = [];
  if (!mapInstance || !mapModule) return;
  filteredPlaces().forEach((place) => {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = `map-pin${activePlace === place.id ? " active" : ""}`;
    pin.dataset.status = place.status;
    pin.setAttribute("aria-label", `${place.name}，${place.status === "visited" ? "去过" : "想去"}`);
    pin.addEventListener("pointerdown", (event) => event.stopPropagation());
    pin.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showPlace(place.id);
    });
    mapMarkers.push(new mapModule.Marker({ element: pin, anchor: "center" })
      .setLngLat(place.coordinates)
      .addTo(mapInstance));
  });
}

function showPlace(id) {
  activePlace = id;
  const place = places.find((item) => item.id === id);
  const box = $("#place-detail");
  if (!place) return;
  box.innerHTML = '<header><span><p class="overline"></p><h3></h3></span><button type="button" aria-label="关闭">×</button></header><span></span><p></p><footer></footer>';
  box.querySelector(".overline").textContent = place.country.toUpperCase();
  box.querySelector("h3").textContent = place.name;
  box.querySelector(":scope>span").textContent = place.status === "visited" ? "去过 · VISITED" : "想去 · WISH LIST";
  box.querySelector(":scope>p").textContent = place.note;
  box.querySelector("footer").textContent = place.date;
  box.querySelector("header button").addEventListener("click", () => {
    box.hidden = true;
    activePlace = null;
    syncMapMarkers();
  });
  box.hidden = false;
  syncMapMarkers();
  if (mapInstance) {
    mapInstance.flyTo({
      center: place.coordinates,
      zoom: place.name === "Iceland" ? 6.4 : 11.5,
      bearing: 0,
      pitch: 0,
      duration: matchMedia("(prefers-reduced-motion:reduce)").matches ? 0 : 1500,
    });
  }
}

function showWorld(animated = true) {
  if (!mapInstance) return;
  activePlace = null;
  $("#place-detail").hidden = true;
  syncMapMarkers();
  mapInstance.fitBounds([[-170, -55], [170, 76]], {
    padding: 18,
    bearing: 0,
    pitch: 0,
    duration: !animated || matchMedia("(prefers-reduced-motion:reduce)").matches ? 0 : 1200,
  });
}

async function initMap(force = false) {
  if (mapInstance && !force) {
    mapInstance.resize();
    return mapInstance;
  }
  if (mapPromise && !force) return mapPromise;
  if (force && mapInstance) {
    mapMarkers.forEach((marker) => marker.remove());
    mapMarkers = [];
    mapInstance.remove();
    mapInstance = null;
  }
  const loading = $("#map-loading");
  const errorBox = $("#map-error");
  loading.hidden = false;
  errorBox.hidden = true;
  $("#footprints-map").classList.remove("ready");
  mapPromise = (async () => {
    try {
      mapModule = await import("https://unpkg.com/maplibre-gl@6.15.0/dist/maplibre-gl.mjs");
      mapInstance = new mapModule.Map({
        container: "footprints-map",
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [8, 22],
        zoom: 1,
        minZoom: 0,
        maxZoom: 17,
        renderWorldCopies: false,
        attributionControl: true,
      });
      mapInstance.addControl(new mapModule.NavigationControl({ showCompass: true, showZoom: true }), "top-right");
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("地图服务响应超时")), 15000);
        mapInstance.once("load", () => {
          window.clearTimeout(timer);
          resolve();
        });
        mapInstance.once("error", (event) => {
          if (!mapInstance.loaded()) {
            window.clearTimeout(timer);
            reject(event.error || new Error("地图资源加载失败"));
          }
        });
      });
      loading.hidden = true;
      $("#footprints-map").classList.add("ready");
      mapInstance.resize();
      showWorld(false);
      syncMapMarkers();
      return mapInstance;
    } catch (error) {
      console.error("Footprints map failed:", error);
      loading.hidden = true;
      errorBox.hidden = false;
      $("#map-error-message").textContent = `${error?.message || "地图资源加载失败"}。请检查网络连接后重试。`;
      if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
      }
      return null;
    } finally {
      mapPromise = null;
    }
  })();
  return mapPromise;
}

export async function mountFootprints() {
  if (!mounted) {
    mounted = true;
    $("#place-search").addEventListener("input", renderPlaces);
    $$('[data-filter]').forEach((button) => button.addEventListener("click", () => {
      placeFilter = button.dataset.filter;
      $$('[data-filter]').forEach((item) => item.classList.toggle("active", item === button));
      renderPlaces();
    }));
    $("#add-place").addEventListener("click", () => $("#place-dialog").showModal());
    $("#place-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const name = $("#place-name").value;
      const template = templates[name];
      const place = {
        id: Date.now(),
        name,
        country: template.country,
        status: $("#place-status").value,
        note: $("#place-note").value.trim() || "一段等待被写下的地点记忆。",
        coordinates: template.coordinates,
        date: "PREVIEW ONLY",
      };
      places.push(place);
      $("#place-dialog").close();
      renderPlaces();
      showPlace(place.id);
    });
    $("#world-view").addEventListener("click", () => showWorld());
    $("#retry-map").addEventListener("click", () => initMap(true));
    renderPlaces();
  }
  await initMap();
}
