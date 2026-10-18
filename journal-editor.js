/**
 * Freeform scrapbook editor for a single journal page stage.
 * Coordinates are paper-relative (PAGE_COORD 1000×1400).
 */
import { api, uploadBytes, PAGE_COORD } from "./auth-client.js";

function uid() {
  return `L${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function clamp(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

export function createEditor({ getCsrf, onDirty, onSaved, onError }) {
  let active = false;
  let pageId = null;
  let stageEl = null;
  let layersRoot = null;
  let layers = [];
  let selectedId = null;
  let dirty = false;
  let pointer = null; // { mode, layerId, startX, startY, orig }

  function setDirty(v) {
    dirty = v;
    onDirty?.(dirty);
  }

  function sortedLayers() {
    return [...layers].sort((a, b) => (a.z || 1) - (b.z || 1));
  }

  function maxZ() {
    return layers.reduce((m, l) => Math.max(m, l.z || 1), 0);
  }

  function clientToPage(clientX, clientY) {
    const rect = stageEl.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * PAGE_COORD.width;
    const y = ((clientY - rect.top) / rect.height) * PAGE_COORD.height;
    return { x, y };
  }

  function applyDomTransform(el, layer) {
    const t = layer.transform;
    el.style.left = `${(t.x / PAGE_COORD.width) * 100}%`;
    el.style.top = `${(t.y / PAGE_COORD.height) * 100}%`;
    el.style.width = `${(t.w / PAGE_COORD.width) * 100}%`;
    el.style.height = `${(t.h / PAGE_COORD.height) * 100}%`;
    el.style.transform = `rotate(${t.rotate || 0}deg)`;
    el.style.zIndex = String(layer.z || 1);
  }

  function renderLayerContent(el, layer) {
    el.innerHTML = "";
    el.className = `page-layer page-layer-${layer.type}${selectedId === layer.id ? " is-selected" : ""}`;
    el.dataset.layerId = layer.id;
    applyDomTransform(el, layer);

    if (layer.type === "text") {
      const text = document.createElement("div");
      text.className = "layer-text";
      text.textContent = layer.payload?.text || "文字";
      text.style.fontSize = `${(Number(layer.payload?.fontSize) || 36) / PAGE_COORD.height * 100}%`;
      // Use px relative to stage height for readable text
      const stageH = stageEl.getBoundingClientRect().height || 400;
      text.style.fontSize = `${((Number(layer.payload?.fontSize) || 36) / PAGE_COORD.height) * stageH}px`;
      text.style.color = layer.payload?.color || "#2a2418";
      el.append(text);
    } else if (layer.type === "photo") {
      const img = document.createElement("img");
      img.className = "layer-photo";
      img.alt = "";
      img.draggable = false;
      img.src = `/api/me/journal/media/${encodeURIComponent(layer.payload.mediaId)}`;
      el.append(img);
    }

    if (active && selectedId === layer.id) {
      const frame = document.createElement("div");
      frame.className = "layer-frame";
      frame.innerHTML = `
        <i class="h h-nw" data-handle="nw"></i>
        <i class="h h-ne" data-handle="ne"></i>
        <i class="h h-sw" data-handle="sw"></i>
        <i class="h h-se" data-handle="se"></i>
        <i class="h h-rot" data-handle="rot"></i>
      `;
      el.append(frame);
    }
  }

  function paint() {
    if (!layersRoot) return;
    layersRoot.innerHTML = "";
    for (const layer of sortedLayers()) {
      const el = document.createElement("div");
      renderLayerContent(el, layer);
      layersRoot.append(el);
    }
  }

  function select(id) {
    selectedId = id;
    paint();
  }

  function selected() {
    return layers.find((l) => l.id === selectedId) || null;
  }

  function addText() {
    const layer = {
      id: uid(),
      type: "text",
      z: maxZ() + 1,
      transform: { x: 180, y: 220, w: 420, h: 160, rotate: -2 },
      payload: { text: "写点什么…", fontSize: 42, color: "#2a2418" },
    };
    layers.push(layer);
    select(layer.id);
    setDirty(true);
  }

  async function addPhoto(file) {
    if (!file) return;
    const csrfToken = getCsrf();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const data = await uploadBytes("/api/me/journal/media", {
      bytes,
      contentType: file.type || "image/jpeg",
      csrfToken,
    });
    const media = data.media;
    const layer = {
      id: uid(),
      type: "photo",
      z: maxZ() + 1,
      transform: { x: 160, y: 180, w: 480, h: 480, rotate: 3 },
      payload: { mediaId: media.id, r2Key: media.r2Key },
    };
    layers.push(layer);
    select(layer.id);
    setDirty(true);
  }

  function deleteSelected() {
    if (!selectedId) return;
    layers = layers.filter((l) => l.id !== selectedId);
    selectedId = null;
    paint();
    setDirty(true);
  }

  function bringFront() {
    const layer = selected();
    if (!layer) return;
    layer.z = maxZ() + 1;
    paint();
    setDirty(true);
  }

  function sendBack() {
    const layer = selected();
    if (!layer) return;
    const min = layers.reduce((m, l) => Math.min(m, l.z || 1), layer.z || 1);
    layer.z = min - 1;
    paint();
    setDirty(true);
  }

  function onPointerDown(event) {
    if (!active) return;
    const handle = event.target.closest?.("[data-handle]");
    const layerEl = event.target.closest?.(".page-layer");
    if (handle && layerEl) {
      event.preventDefault();
      event.stopPropagation();
      const id = layerEl.dataset.layerId;
      const layer = layers.find((l) => l.id === id);
      if (!layer) return;
      select(id);
      const pt = clientToPage(event.clientX, event.clientY);
      pointer = {
        mode: handle.dataset.handle === "rot" ? "rotate" : "resize",
        handle: handle.dataset.handle,
        layerId: id,
        startX: pt.x,
        startY: pt.y,
        orig: { ...layer.transform },
      };
      stageEl.setPointerCapture?.(event.pointerId);
      return;
    }
    if (layerEl) {
      event.preventDefault();
      const id = layerEl.dataset.layerId;
      const layer = layers.find((l) => l.id === id);
      if (!layer) return;
      select(id);
      const pt = clientToPage(event.clientX, event.clientY);
      pointer = {
        mode: "drag",
        layerId: id,
        startX: pt.x,
        startY: pt.y,
        orig: { ...layer.transform },
      };
      stageEl.setPointerCapture?.(event.pointerId);
      return;
    }
    // click empty paper
    if (event.target === stageEl || event.target.classList?.contains("page-grain") || event.target.classList?.contains("page-layers")) {
      select(null);
    }
  }

  function onPointerMove(event) {
    if (!pointer) return;
    const layer = layers.find((l) => l.id === pointer.layerId);
    if (!layer) return;
    const pt = clientToPage(event.clientX, event.clientY);
    const dx = pt.x - pointer.startX;
    const dy = pt.y - pointer.startY;
    if (pointer.mode === "drag") {
      layer.transform.x = pointer.orig.x + dx;
      layer.transform.y = pointer.orig.y + dy;
    } else if (pointer.mode === "resize") {
      const o = pointer.orig;
      let { x, y, w, h } = o;
      const handle = pointer.handle;
      if (handle.includes("e")) w = clamp(o.w + dx, 60, PAGE_COORD.width);
      if (handle.includes("s")) h = clamp(o.h + dy, 60, PAGE_COORD.height);
      if (handle.includes("w")) {
        w = clamp(o.w - dx, 60, PAGE_COORD.width);
        x = o.x + (o.w - w);
      }
      if (handle.includes("n")) {
        h = clamp(o.h - dy, 60, PAGE_COORD.height);
        y = o.y + (o.h - h);
      }
      layer.transform = { ...layer.transform, x, y, w, h };
    } else if (pointer.mode === "rotate") {
      const cx = pointer.orig.x + pointer.orig.w / 2;
      const cy = pointer.orig.y + pointer.orig.h / 2;
      const ang = (Math.atan2(pt.y - cy, pt.x - cx) * 180) / Math.PI;
      layer.transform.rotate = Math.round(ang + 90);
    }
    const el = layersRoot.querySelector(`[data-layer-id="${layer.id}"]`);
    if (el) applyDomTransform(el, layer);
    setDirty(true);
  }

  function onPointerUp() {
    pointer = null;
  }

  function onDblClick(event) {
    if (!active) return;
    const layerEl = event.target.closest?.(".page-layer-text");
    if (!layerEl) return;
    const layer = layers.find((l) => l.id === layerEl.dataset.layerId);
    if (!layer || layer.type !== "text") return;
    const next = window.prompt("编辑文字", layer.payload.text || "");
    if (next === null) return;
    layer.payload.text = next.slice(0, 4000);
    paint();
    setDirty(true);
  }

  function bindStage() {
    stageEl.addEventListener("pointerdown", onPointerDown);
    stageEl.addEventListener("pointermove", onPointerMove);
    stageEl.addEventListener("pointerup", onPointerUp);
    stageEl.addEventListener("pointercancel", onPointerUp);
    stageEl.addEventListener("dblclick", onDblClick);
  }

  function unbindStage() {
    if (!stageEl) return;
    stageEl.removeEventListener("pointerdown", onPointerDown);
    stageEl.removeEventListener("pointermove", onPointerMove);
    stageEl.removeEventListener("pointerup", onPointerUp);
    stageEl.removeEventListener("pointercancel", onPointerUp);
    stageEl.removeEventListener("dblclick", onDblClick);
  }

  async function save() {
    if (!pageId) throw new Error("没有可保存的页面");
    const content = {
      version: 1,
      coord: { ...PAGE_COORD },
      background: { paper: "ruled" },
      layers: sortedLayers(),
    };
    const data = await api(`/api/me/journal/pages/${encodeURIComponent(pageId)}`, {
      method: "PATCH",
      csrfToken: getCsrf(),
      body: { content },
    });
    layers = data.page.content.layers || [];
    setDirty(false);
    onSaved?.(data.page);
    return data.page;
  }

  return {
    get active() {
      return active;
    },
    get dirty() {
      return dirty;
    },
    get pageId() {
      return pageId;
    },
    attach(slotEl, page) {
      unbindStage();
      pageId = page?.id || null;
      stageEl = slotEl?.querySelector?.("[data-page-stage]") || null;
      layersRoot = slotEl?.querySelector?.("[data-page-layers]") || null;
      layers = structuredClone(page?.content?.layers || []);
      selectedId = null;
      setDirty(false);
      if (stageEl) bindStage();
      paint();
    },
    enter() {
      active = true;
      stageEl?.classList.add("is-editing-stage");
      paint();
    },
    exit() {
      active = false;
      selectedId = null;
      pointer = null;
      stageEl?.classList.remove("is-editing-stage");
      paint();
    },
    addText,
    addPhoto,
    deleteSelected,
    bringFront,
    sendBack,
    save,
    destroy() {
      unbindStage();
      active = false;
      stageEl = null;
      layersRoot = null;
    },
  };
}
