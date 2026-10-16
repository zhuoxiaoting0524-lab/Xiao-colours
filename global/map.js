import {
  COUNTRY_COORDS,
  LEAFLET_CSS,
  LEAFLET_JS,
} from "./config.js";
import { escapeHtml, fullDateTime, relativeTime } from "./utils.js";

function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`link[href="${href}"]`)) return resolve();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = resolve;
    link.onerror = reject;
    document.head.append(link);
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.L) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

export class GlobalMapSection {
  constructor({ mapElement, loadingElement, onCountrySelect }) {
    this.mapElement = mapElement;
    this.loadingElement = loadingElement;
    this.onCountrySelect = onCountrySelect;
    this.map = null;
    this.newsLayer = null;
    this.quakeLayer = null;
    this.activeLayer = "all";
    this.articles = [];
    this.earthquakes = [];
  }

  async init() {
    if (this.map) return;
    this.loadingElement.innerHTML = '<span aria-hidden="true"></span><p>正在加载地图与事件图层…</p>';

    try {
      await Promise.all([loadStylesheet(LEAFLET_CSS), loadScript(LEAFLET_JS)]);
      this.map = window.L.map(this.mapElement, {
        center: [24, 8],
        zoom: 2,
        minZoom: 2,
        maxZoom: 7,
        worldCopyJump: true,
        zoomControl: true,
        attributionControl: true,
      });
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 7,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(this.map);
      this.newsLayer = window.L.layerGroup().addTo(this.map);
      this.quakeLayer = window.L.layerGroup().addTo(this.map);
      this.loadingElement.classList.add("is-hidden");
      this.render();
    } catch {
      this.loadingElement.classList.add("is-error");
      this.loadingElement.innerHTML = "<p>地图组件暂时无法加载。新闻列表仍可正常使用。</p>";
    }
  }

  update({ articles, earthquakes }) {
    this.articles = articles;
    this.earthquakes = earthquakes;
    this.render();
  }

  setLayer(layer) {
    this.activeLayer = layer;
    this.applyLayerVisibility();
  }

  invalidateSize() {
    window.setTimeout(() => this.map?.invalidateSize(), 100);
  }

  markerIcon(kind, value = "") {
    const numericValue = Number(value);
    const size = kind === "news" ? Math.min(36, 18 + Math.log2(numericValue + 1) * 4) : 18;
    return window.L.divIcon({
      className: "",
      html: `<span class="gp-map-marker is-${kind}" style="width:${size}px;height:${size}px">${kind === "news" ? numericValue : ""}</span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  render() {
    if (!this.map || !this.newsLayer || !this.quakeLayer) return;
    this.newsLayer.clearLayers();
    this.quakeLayer.clearLayers();

    const byCountry = this.articles.reduce((groups, article) => {
      if (!COUNTRY_COORDS[article.country]) return groups;
      (groups[article.country] ||= []).push(article);
      return groups;
    }, {});

    Object.entries(byCountry).forEach(([country, articles]) => {
      const marker = window.L.marker(COUNTRY_COORDS[country], {
        icon: this.markerIcon("news", articles.length),
        keyboard: true,
        title: `${country}：${articles.length} 条媒体来源新闻`,
      });
      marker.bindPopup(`
        <b>${escapeHtml(country)} · 媒体来源聚合</b><br>
        ${articles.length} 条已载入报道的发布媒体来源于该国。<br>
        此标记不是新闻事件坐标。<br>
        <a href="#gp-news-feed" data-gp-map-country="${escapeHtml(country)}">在新闻列表中筛选 →</a>`);
      marker.on("popupopen", (event) => {
        const link = event.popup.getElement()?.querySelector("[data-gp-map-country]");
        link?.addEventListener("click", () => this.onCountrySelect(country), { once: true });
      });
      marker.addTo(this.newsLayer);
    });

    this.earthquakes.forEach((feature) => {
      const [longitude, latitude] = feature.geometry?.coordinates || [];
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const properties = feature.properties || {};
      const magnitude = Number(properties.mag);
      const markerType = magnitude >= 6 ? "critical" : "disaster";
      const detailUrl = /^https?:\/\//i.test(properties.url || "") ? properties.url : "";
      const occurredAt = new Date(properties.time);
      const marker = window.L.marker([latitude, longitude], {
        icon: this.markerIcon(markerType),
        keyboard: true,
        title: `M ${Number.isFinite(magnitude) ? magnitude : "?"} ${properties.place || "地震事件"}`,
      });
      marker.bindPopup(`
        <b>M ${escapeHtml(Number.isFinite(magnitude) ? magnitude : "?")} · ${escapeHtml(properties.title || "地震事件")}</b><br>
        地区：${escapeHtml(properties.place || "位置未知")}<br>
        时间：${escapeHtml(fullDateTime(occurredAt))}（${escapeHtml(relativeTime(occurredAt))}）<br>
        来源：USGS
        ${detailUrl ? `<br><a href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer">查看 USGS 事件详情 ↗</a>` : ""}`);
      marker.addTo(this.quakeLayer);
    });

    this.applyLayerVisibility();
  }

  applyLayerVisibility() {
    if (!this.map) return;
    const showNews = this.activeLayer === "all" || this.activeLayer === "news";
    const showQuakes = this.activeLayer === "all" || this.activeLayer === "quake";

    if (showNews && !this.map.hasLayer(this.newsLayer)) this.newsLayer.addTo(this.map);
    if (!showNews && this.map.hasLayer(this.newsLayer)) this.map.removeLayer(this.newsLayer);
    if (showQuakes && !this.map.hasLayer(this.quakeLayer)) this.quakeLayer.addTo(this.map);
    if (!showQuakes && this.map.hasLayer(this.quakeLayer)) this.map.removeLayer(this.quakeLayer);
  }
}
