const STORAGE_KEY = "xiaocolour-weather-location-v1";
const WEATHER_CACHE_KEY = "xiaocolour-weather-cache-v1";
const WEATHER_REFRESH_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const CITY_ALIASES = [
  city("tokyo", "东京", "Tokyo", "日本", "Japan", 35.6762, 139.6503, "Asia/Tokyo", "JP", ["东京", "東京", "tokyo"]),
  city("paris", "巴黎", "Paris", "法国", "France", 48.8566, 2.3522, "Europe/Paris", "FR", ["巴黎", "paris"]),
  city("madrid", "马德里", "Madrid", "西班牙", "Spain", 40.4168, -3.7038, "Europe/Madrid", "ES", ["马德里", "madrid"]),
  city("barcelona", "巴塞罗那", "Barcelona", "西班牙", "Spain", 41.3874, 2.1686, "Europe/Madrid", "ES", ["巴塞罗那", "barcelona"]),
  city("london", "伦敦", "London", "英国", "United Kingdom", 51.5072, -0.1276, "Europe/London", "GB", ["伦敦", "london"]),
  city("new-york", "纽约", "New York", "美国", "United States", 40.7128, -74.006, "America/New_York", "US", ["纽约", "new york", "nyc"]),
  city("beijing", "北京", "Beijing", "中国", "China", 39.9042, 116.4074, "Asia/Shanghai", "CN", ["北京", "beijing"]),
  city("shanghai", "上海", "Shanghai", "中国", "China", 31.2304, 121.4737, "Asia/Shanghai", "CN", ["上海", "shanghai"]),
  city("hong-kong", "香港", "Hong Kong", "中国", "China", 22.3193, 114.1694, "Asia/Hong_Kong", "HK", ["香港", "hong kong"]),
  city("singapore", "新加坡", "Singapore", "新加坡", "Singapore", 1.3521, 103.8198, "Asia/Singapore", "SG", ["新加坡", "singapore"]),
  city("sydney", "悉尼", "Sydney", "澳大利亚", "Australia", -33.8688, 151.2093, "Australia/Sydney", "AU", ["悉尼", "sydney"]),
];

const TIMEZONE_DEFAULTS = new Map();
CITY_ALIASES.forEach((item) => {
  if (!TIMEZONE_DEFAULTS.has(item.timezone)) TIMEZONE_DEFAULTS.set(item.timezone, item);
});

function city(id, nameZh, nameEn, countryZh, countryEn, latitude, longitude, timezone, countryCode, aliases) {
  return { id, nameZh, nameEn, countryZh, countryEn, latitude, longitude, timezone, countryCode, aliases, source: "preset" };
}

function $(selector, root = document) {
  return root.querySelector(selector);
}

function safeStorage(method, key, value) {
  try {
    if (method === "get") return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch (_) {
    return null;
  }
  return null;
}

function sanitizeLocation(value) {
  if (!value || !Number.isFinite(Number(value.latitude)) || !Number.isFinite(Number(value.longitude))) return null;
  return {
    id: String(value.id || `${value.latitude},${value.longitude}`),
    nameZh: String(value.nameZh || value.nameEn || "当前位置"),
    nameEn: String(value.nameEn || value.nameZh || "Current Location"),
    countryZh: String(value.countryZh || ""),
    countryEn: String(value.countryEn || ""),
    latitude: Number(value.latitude),
    longitude: Number(value.longitude),
    timezone: String(value.timezone || "auto"),
    countryCode: String(value.countryCode || ""),
    source: String(value.source || "search"),
  };
}

function loadSavedLocation() {
  const raw = safeStorage("get", STORAGE_KEY);
  if (raw) {
    try { return sanitizeLocation(JSON.parse(raw)); } catch (_) { /* ignore invalid local preference */ }
  }
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return TIMEZONE_DEFAULTS.get(deviceZone) || CITY_ALIASES.find((item) => item.id === "madrid");
}

function saveLocation(location) {
  safeStorage("set", STORAGE_KEY, JSON.stringify(location));
}

function formatTime(date, timezone) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone === "auto" ? undefined : timezone,
  }).format(date);
}

function formatDate(date, timezone) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "long",
    timeZone: timezone === "auto" ? undefined : timezone,
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${value("month")}月${value("day")}日 · ${value("weekday")}`;
}

export function weatherMeta(code, isDay = 1) {
  if (code === 0) return { label: "晴", icon: isDay ? "☀️" : "🌙" };
  if ([1, 2].includes(code)) return { label: "晴间多云", icon: isDay ? "🌤️" : "☁️" };
  if (code === 3) return { label: "阴", icon: "☁️" };
  if ([45, 48].includes(code)) return { label: "有雾", icon: "🌫️" };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: "毛毛雨", icon: "🌦️" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: "有雨", icon: "🌧️" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "有雪", icon: "🌨️" };
  if ([95, 96, 99].includes(code)) return { label: "雷雨", icon: "⛈️" };
  return { label: "天气变化中", icon: "🌥️" };
}

function rounded(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : "--";
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`请求失败（${response.status}）`);
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("天气服务响应超时，请重试。 ");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function forecastUrl(location) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,apparent_temperature,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "4",
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function cacheKey(location) {
  return `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
}

function loadWeatherCache(location) {
  const raw = safeStorage("get", WEATHER_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.key !== cacheKey(location) || Date.now() - parsed.savedAt > WEATHER_REFRESH_MS) return null;
    return parsed.data;
  } catch (_) {
    return null;
  }
}

function saveWeatherCache(location, data) {
  safeStorage("set", WEATHER_CACHE_KEY, JSON.stringify({ key: cacheKey(location), savedAt: Date.now(), data }));
}

export function buildForecastRows(daily = {}) {
  return (daily.time || []).slice(1, 4).map((date, index) => {
    const sourceIndex = index + 1;
    const meta = weatherMeta(Number(daily.weather_code?.[sourceIndex]));
    return {
      date,
      dayLabel: ["明天", "后天", "大后天"][index],
      description: meta.label,
      icon: meta.icon,
      high: rounded(daily.temperature_2m_max?.[sourceIndex]),
      low: rounded(daily.temperature_2m_min?.[sourceIndex]),
    };
  });
}

function locationLabel(location) {
  if (location.nameZh === location.nameEn) return location.nameZh;
  return `${location.nameZh} · ${location.nameEn}`;
}

function countryLabel(location) {
  const country = location.countryZh && location.countryEn && location.countryZh !== location.countryEn
    ? `${location.countryZh} · ${location.countryEn}`
    : location.countryZh || location.countryEn;
  return [country, location.timezone !== "auto" ? location.timezone : ""].filter(Boolean).join(" · ");
}

function aliasMatches(query) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  return CITY_ALIASES.filter((item) => item.aliases.some((alias) => alias.toLocaleLowerCase().includes(normalized)));
}

function geocodeResult(result, englishResult) {
  return sanitizeLocation({
    id: `openmeteo-${result.id}`,
    nameZh: result.name,
    nameEn: englishResult?.name || result.name,
    countryZh: result.country || "",
    countryEn: englishResult?.country || result.country || "",
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone || "auto",
    countryCode: result.country_code || "",
    source: "open-meteo",
  });
}

async function searchLocations(query) {
  const presets = aliasMatches(query);
  if (presets.length) return presets.slice(0, 6);
  const base = "https://geocoding-api.open-meteo.com/v1/search";
  const makeUrl = (language) => `${base}?${new URLSearchParams({ name: query, count: "6", language, format: "json" })}`;
  const [zh, en] = await Promise.all([fetchJson(makeUrl("zh")), fetchJson(makeUrl("en"))]);
  const englishById = new Map((en.results || []).map((item) => [item.id, item]));
  const source = (zh.results?.length ? zh.results : en.results) || [];
  return source.map((item) => geocodeResult(item, englishById.get(item.id))).filter(Boolean);
}

function renderSearchResults(results, onSelect) {
  const list = $("#overview-city-results");
  if (!list) return;
  if (!results.length) {
    list.innerHTML = '<li class="ov-city-empty">没有找到匹配城市，请尝试更完整的中英文名称。</li>';
    return;
  }
  list.replaceChildren(...results.map((location) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ov-city-result";
    button.innerHTML = `<strong>${locationLabel(location)}</strong><small>${countryLabel(location)}</small>`;
    button.addEventListener("click", () => onSelect(location));
    li.append(button);
    return li;
  }));
}

function renderWeather(data, location) {
  const current = data.current || {};
  const meta = weatherMeta(Number(current.weather_code), Number(current.is_day));
  const timezone = data.timezone || location.timezone;
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "设备当地时区";
  const cityName = locationLabel(location);
  $("#overview-weather-city-name").textContent = cityName;
  $("#overview-weather-icon").textContent = meta.icon;
  $("#overview-weather-temp").textContent = `${rounded(current.temperature_2m)}°C`;
  $("#overview-weather-desc").textContent = meta.label;
  $("#overview-weather-city-time").textContent = `${location.nameZh}时间 ${formatTime(new Date(), timezone)}`;
  $("#overview-device-timezone").textContent = deviceZone;
  $("#overview-weather-feels").textContent = `${rounded(current.apparent_temperature)}°C`;
  $("#overview-weather-rain").textContent = `${rounded(data.daily?.precipitation_probability_max?.[0])}%`;
  $("#overview-weather-sheet-title").textContent = cityName;
  $("#overview-weather-status").textContent = "";
  $("#overview-weather-retry").hidden = true;

  const forecast = $("#overview-weather-forecast");
  forecast.replaceChildren(...buildForecastRows(data.daily).map((row) => {
    const li = document.createElement("li");
    li.className = "ov-forecast-row";
    li.innerHTML = `<strong>${row.dayLabel}</strong><span class="ov-forecast-icon" aria-hidden="true">${row.icon}</span><span>${row.description}</span><b>${row.high}°</b><em>${row.low}°</em>`;
    return li;
  }));
}

function setWeatherError(message) {
  $("#overview-weather-status").textContent = message || "天气暂不可用，请稍后重试。";
  $("#overview-weather-retry").hidden = false;
  $("#overview-weather-temp").textContent = "--°C";
  $("#overview-weather-desc").textContent = "天气暂不可用";
}

let mounted = false;
let currentLocation = null;
let latestWeather = null;
let weatherTimer = 0;
let clockTimer = 0;
let searchTimer = 0;

function updateClocks() {
  const now = new Date();
  $("#overview-local-time").textContent = formatTime(now, "auto");
  $("#overview-local-date").textContent = formatDate(now, "auto");
  if (currentLocation) {
    const timezone = latestWeather?.timezone || currentLocation.timezone;
    $("#overview-weather-city-time").textContent = `${currentLocation.nameZh}时间 ${formatTime(now, timezone)}`;
  }
}

async function loadWeather({ force = false } = {}) {
  if (!currentLocation) return;
  $("#overview-weather-status").textContent = "正在更新天气…";
  $("#overview-weather-retry").hidden = true;
  try {
    const cached = force ? null : loadWeatherCache(currentLocation);
    latestWeather = cached || await fetchJson(forecastUrl(currentLocation));
    if (!cached) saveWeatherCache(currentLocation, latestWeather);
    if (latestWeather.timezone && currentLocation.timezone === "auto") currentLocation.timezone = latestWeather.timezone;
    renderWeather(latestWeather, currentLocation);
    updateClocks();
  } catch (error) {
    setWeatherError(error.message);
  }
}

function closePanels() {
  $("#overview-weather-details").hidden = true;
  $("#overview-city-picker").hidden = true;
  $("#overview-weather-backdrop").hidden = true;
  $("#overview-weather-details-toggle").setAttribute("aria-expanded", "false");
}

function openPanel(panel) {
  const details = $("#overview-weather-details");
  const picker = $("#overview-city-picker");
  const target = panel === "details" ? details : picker;
  const wasOpen = !target.hidden;
  closePanels();
  if (wasOpen) return;
  target.hidden = false;
  if (matchMedia("(max-width: 768px)").matches) $("#overview-weather-backdrop").hidden = false;
  if (panel === "details") $("#overview-weather-details-toggle").setAttribute("aria-expanded", "true");
  if (panel === "picker") setTimeout(() => $("#overview-city-search")?.focus(), 0);
}

async function selectLocation(location) {
  currentLocation = sanitizeLocation(location);
  saveLocation(currentLocation);
  closePanels();
  await loadWeather({ force: true });
}

function requestCurrentLocation() {
  const status = $("#overview-city-status");
  if (!navigator.geolocation) {
    status.textContent = "当前浏览器不支持定位，请使用城市搜索。";
    return;
  }
  status.textContent = "等待定位授权…";
  navigator.geolocation.getCurrentPosition(async (position) => {
    status.textContent = "已获取当前位置，正在更新天气…";
    await selectLocation({
      id: "current-location",
      nameZh: "当前位置",
      nameEn: "Current Location",
      countryZh: "",
      countryEn: "",
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      timezone: "auto",
      countryCode: "",
      source: "geolocation",
    });
  }, (error) => {
    status.textContent = error.code === 1 ? "定位权限未开启，仍可使用下方搜索选择城市。" : "无法获取当前位置，请重试或手动搜索。";
  }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 15 * 60 * 1000 });
}

export function mountOverviewWeather() {
  if (!$("#overview-weather-card")) return;
  currentLocation = loadSavedLocation();
  if (!mounted) {
    mounted = true;
    $("#overview-weather-details-toggle").addEventListener("click", () => openPanel("details"));
    $("#overview-weather-city-button").addEventListener("click", () => openPanel("picker"));
    $("#overview-weather-backdrop").addEventListener("click", closePanels);
    document.querySelectorAll("[data-weather-close]").forEach((button) => button.addEventListener("click", closePanels));
    $("#overview-weather-retry").addEventListener("click", () => loadWeather({ force: true }));
    $("#overview-use-location").addEventListener("click", requestCurrentLocation);
    $("#overview-city-search-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = $("#overview-city-search").value.trim();
      if (!query) return;
      const status = $("#overview-city-status");
      status.textContent = "正在搜索城市…";
      try {
        const results = await searchLocations(query);
        renderSearchResults(results, selectLocation);
        status.textContent = results.length ? "请选择正确的城市和国家。" : "";
      } catch (error) {
        status.textContent = error.message || "城市搜索失败，请重试。";
        renderSearchResults([], selectLocation);
      }
    });
    $("#overview-city-search").addEventListener("input", (event) => {
      clearTimeout(searchTimer);
      const query = event.target.value.trim();
      if (query.length < 2) return;
      searchTimer = setTimeout(() => $("#overview-city-search-form").requestSubmit(), 300);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePanels();
    });
  }

  clearInterval(clockTimer);
  clearInterval(weatherTimer);
  updateClocks();
  clockTimer = setInterval(updateClocks, 1000);
  loadWeather();
  weatherTimer = setInterval(() => loadWeather({ force: true }), WEATHER_REFRESH_MS);
}
