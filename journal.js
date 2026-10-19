/**
 * Interactive Journal: flip, add/delete pages, year filter, freeform edit mode.
 * Page layers use paper-relative coords (see content.coord), not viewport.
 */
import { api, PAGE_COORD } from "./auth-client.js?v=14";
import { createEditor } from "./journal-editor.js?v=14";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const singleMq = window.matchMedia("(max-width: 640px)");

let csrfToken = "";
let allYears = [];
let pages = [];
let yearFilter = null;
let cursor = 0;
let flipping = false;
let mounted = false;
let touchStartX = 0;
let editMode = false;
let editor = null;
let focusSlot = "left"; // which page is being edited in a spread
let editAttachedPageId = null;

function $(sel, root = document) {
  return root.querySelector(sel);
}

function binder() {
  return $("#journal-binder");
}

function isSingle() {
  return singleMq.matches;
}

function total() {
  return pages.length;
}

function clampCursor() {
  if (!total()) {
    cursor = 0;
    return;
  }
  if (isSingle()) {
    cursor = Math.min(Math.max(0, cursor), total() - 1);
    return;
  }
  cursor = Math.max(0, cursor - (cursor % 2));
  if (cursor >= total()) {
    cursor = Math.max(0, total() - 2);
    cursor = cursor - (cursor % 2);
  }
}

function canPrev() {
  return !editMode && total() > 0 && cursor > 0;
}

function canGoNext() {
  if (editMode || !total()) return false;
  if (isSingle()) return cursor < total() - 1;
  return cursor + 2 < total();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function counterLabel() {
  if (!total()) return "0 / 0";
  if (isSingle()) return `${pad(cursor + 1)} / ${pad(total())}`;
  const left = cursor + 1;
  const right = Math.min(cursor + 2, total());
  if (left === right) return `${pad(left)} / ${pad(total())}`;
  return `${pad(left)}–${pad(right)} / ${pad(total())}`;
}

function clearSlot(slotEl) {
  const layers = $("[data-page-layers]", slotEl);
  const folio = $("[data-page-folio]", slotEl);
  const createBtn = $("[data-create-first]", slotEl);
  if (layers) layers.innerHTML = "";
  if (folio) {
    folio.hidden = true;
    folio.textContent = "";
  }
  if (createBtn) createBtn.hidden = true;
  slotEl.dataset.pageId = "";
  slotEl.classList.toggle("is-blank-slot", true);
  slotEl.classList.remove("is-edit-focus");
}

function renderLayerRead(layersRoot, layer, coord, stageEl) {
  const el = document.createElement("div");
  el.className = `page-layer page-layer-${layer.type || "unknown"}`;
  el.dataset.layerId = layer.id || "";
  const t = layer.transform || {};
  const x = Number(t.x || 0);
  const y = Number(t.y || 0);
  const w = Number(t.w || 0);
  const h = Number(t.h || 0);
  const rot = Number(t.rotate || 0);
  el.style.left = `${(x / coord.width) * 100}%`;
  el.style.top = `${(y / coord.height) * 100}%`;
  el.style.width = `${(w / coord.width) * 100}%`;
  el.style.height = `${(h / coord.height) * 100}%`;
  el.style.transform = `rotate(${rot}deg)`;
  el.style.zIndex = String(layer.z || 1);

  if (layer.type === "text") {
    const text = document.createElement("div");
    text.className = "layer-text";
    text.textContent = layer.payload?.text || "";
    const stageH = stageEl.getBoundingClientRect().height || 400;
    text.style.fontSize = `${((Number(layer.payload?.fontSize) || 36) / coord.height) * stageH}px`;
    text.style.color = layer.payload?.color || "#2a2418";
    el.append(text);
  } else if (layer.type === "photo" && layer.payload?.mediaId) {
    const img = document.createElement("img");
    img.className = "layer-photo";
    img.alt = "";
    img.loading = "lazy";
    img.src = `/api/me/journal/media/${encodeURIComponent(layer.payload.mediaId)}`;
    el.append(img);
  }
  layersRoot.append(el);
}

function renderPageInto(slotEl, page, { showCreate = false } = {}) {
  clearSlot(slotEl);
  const layers = $("[data-page-layers]", slotEl);
  const folio = $("[data-page-folio]", slotEl);
  const createBtn = $("[data-create-first]", slotEl);
  const stage = $("[data-page-stage]", slotEl);
  if (!stage || !layers) return;

  if (!page) {
    if (showCreate && createBtn) createBtn.hidden = false;
    return;
  }

  slotEl.dataset.pageId = page.id;
  slotEl.classList.toggle("is-blank-slot", false);

  const coord = page.content?.coord || PAGE_COORD;
  stage.style.setProperty("--page-coord-w", String(coord.width));
  stage.style.setProperty("--page-coord-h", String(coord.height));

  const sorted = [...(page.content?.layers || [])].sort((a, b) => (a.z || 1) - (b.z || 1));
  for (const layer of sorted) {
    renderLayerRead(layers, layer, coord, stage);
  }

  if (folio) {
    folio.hidden = false;
    folio.textContent = pad(page.position);
  }
}

function updateNav() {
  const prev = $("#journal-prev");
  const next = $("#journal-next");
  const counter = $("#journal-counter");
  const actions = $(".journal-actions");
  const del = $("#journal-delete-page");
  const editBtn = $("#journal-edit-toggle");
  if (prev) prev.disabled = !canPrev() || flipping;
  if (next) next.disabled = !canGoNext() || flipping;
  if (counter) counter.textContent = counterLabel();
  if (actions) actions.hidden = false;
  if (del) del.disabled = !total() || flipping || editMode;
  if (editBtn) {
    editBtn.hidden = !total();
    editBtn.textContent = editMode ? "Done" : "Edit";
    editBtn.classList.toggle("is-active", editMode);
  }
  binder()?.classList.toggle("is-empty-journal", total() === 0);
  binder()?.classList.toggle("is-single-mode", isSingle());
  binder()?.classList.toggle("is-editing", editMode);
  const toolbar = $("#journal-edit-toolbar");
  if (toolbar) toolbar.hidden = !editMode;
}

function focusedPage() {
  if (!total()) return null;
  if (isSingle()) return pages[cursor] || null;
  if (focusSlot === "right" && pages[cursor + 1]) return pages[cursor + 1];
  return pages[cursor] || null;
}

function focusedSlotEl() {
  if (isSingle()) return $('[data-page-slot="left"]');
  return $(`[data-page-slot="${focusSlot}"]`);
}

function attachEditorToFocus({ force = false } = {}) {
  ensureEditor();
  const slot = focusedSlotEl();
  const page = focusedPage();
  if (!slot || !page) return false;

  document.querySelectorAll("[data-page-slot]").forEach((el) => {
    el.classList.toggle("is-edit-focus", el === slot);
  });

  // Do not wipe in-progress edits by re-attaching the same page.
  if (!force && editAttachedPageId === page.id && editor?.pageId === page.id) {
    editor.enter();
    return true;
  }

  editor.attach(slot, page);
  editAttachedPageId = page.id;
  editor.enter();
  return true;
}

function paint() {
  clampCursor();
  const left = $('[data-page-slot="left"]');
  const right = $('[data-page-slot="right"]');
  if (!left || !right) return;

  if (!total()) {
    renderPageInto(left, null, { showCreate: true });
    renderPageInto(right, null, { showCreate: false });
    left.hidden = false;
    right.hidden = isSingle();
    updateNav();
    return;
  }

  if (isSingle()) {
    focusSlot = "left";
    // While editing, keep editor DOM — do not rebuild the focused page from server snapshot.
    if (!(editMode && editor && editAttachedPageId === pages[cursor]?.id)) {
      renderPageInto(left, pages[cursor]);
    } else {
      left.dataset.pageId = pages[cursor].id;
      left.classList.toggle("is-blank-slot", false);
      left.hidden = false;
    }
    right.hidden = true;
    left.hidden = false;
  } else {
    const leftPage = pages[cursor] || null;
    const rightPage = pages[cursor + 1] || null;
    const editingLeft = editMode && editor && focusSlot === "left" && editAttachedPageId === leftPage?.id;
    const editingRight = editMode && editor && focusSlot === "right" && editAttachedPageId === rightPage?.id;

    if (!editingLeft) renderPageInto(left, leftPage);
    else {
      left.dataset.pageId = leftPage.id;
      left.classList.toggle("is-blank-slot", false);
    }
    if (!editingRight) renderPageInto(right, rightPage);
    else {
      right.dataset.pageId = rightPage?.id || "";
      right.classList.toggle("is-blank-slot", !rightPage);
    }
    left.hidden = false;
    right.hidden = false;
  }

  if (editMode) {
    attachEditorToFocus({ force: false });
  }

  updateNav();
}

function renderYearRail() {
  const rail = $("#journal-year-rail");
  if (!rail) return;
  rail.innerHTML = "";
  const years = allYears.length ? allYears : [new Date().getFullYear()];
  const active = yearFilter ?? null;

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = `year-item${active === null ? " is-active" : ""}`;
  allBtn.textContent = "全部";
  if (active === null) allBtn.setAttribute("aria-current", "true");
  allBtn.addEventListener("click", () => {
    if (editMode) return;
    selectYear(null);
  });
  rail.append(allBtn);

  for (const y of years) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `year-item${active === y ? " is-active" : ""}`;
    btn.textContent = String(y);
    if (active === y) btn.setAttribute("aria-current", "true");
    btn.addEventListener("click", () => {
      if (editMode) return;
      selectYear(y);
    });
    rail.append(btn);
  }
}

async function selectYear(year) {
  yearFilter = year;
  cursor = 0;
  await reload();
}

async function reload() {
  const qs = yearFilter ? `?year=${encodeURIComponent(yearFilter)}` : "";
  const data = await api(`/api/me/journal/pages${qs}`);
  pages = data.pages || [];
  allYears = data.years || [];
  renderYearRail();
  paint();
}

async function waitFlip(ms) {
  if (reducedMotion) return;
  await new Promise((r) => setTimeout(r, ms));
}

async function animateFlip(direction) {
  if (reducedMotion || isSingle() || editMode) return;
  const overlay = $("#journal-flip");
  const sheet = $(".flip-sheet", overlay);
  if (!overlay || !sheet) return;
  overlay.hidden = false;
  sheet.classList.remove("flip-next", "flip-prev", "is-flipping");
  void sheet.offsetWidth;
  sheet.classList.add(direction === "next" ? "flip-next" : "flip-prev");
  sheet.classList.add("is-flipping");
  await waitFlip(520);
  sheet.classList.remove("is-flipping", "flip-next", "flip-prev");
  overlay.hidden = true;
}

async function goPrev() {
  if (!canPrev() || flipping) return;
  flipping = true;
  updateNav();
  try {
    await animateFlip("prev");
    cursor = isSingle() ? cursor - 1 : Math.max(0, cursor - 2);
    paint();
  } finally {
    flipping = false;
    updateNav();
  }
}

async function goNext() {
  if (!canGoNext() || flipping) return;
  flipping = true;
  updateNav();
  try {
    await animateFlip("next");
    cursor = isSingle() ? cursor + 1 : cursor + 2;
    paint();
  } finally {
    flipping = false;
    updateNav();
  }
}

function focusedPageId() {
  return focusedPage()?.id || null;
}

async function addPage() {
  if (editMode) return;
  const body = {};
  if (yearFilter) body.year = yearFilter;
  const data = await api("/api/me/journal/pages", {
    method: "POST",
    csrfToken,
    body,
  });
  await reload();
  const idx = pages.findIndex((p) => p.id === data.page.id);
  if (idx >= 0) {
    cursor = isSingle() ? idx : idx - (idx % 2);
  } else {
    yearFilter = null;
    await reload();
    const idx2 = pages.findIndex((p) => p.id === data.page.id);
    cursor = isSingle() ? Math.max(0, idx2) : Math.max(0, idx2 - (idx2 % 2));
  }
  paint();
}

async function deleteFocused() {
  if (editMode) return;
  const id = focusedPageId();
  if (!id) return;
  const ok = window.confirm("确定删除这一页手帐吗？此操作不可撤销。");
  if (!ok) return;
  await api(`/api/me/journal/pages/${encodeURIComponent(id)}`, {
    method: "DELETE",
    csrfToken,
    body: {},
  });
  await reload();
  paint();
}

async function enterEdit() {
  if (!total()) {
    showError(new Error("请先新增一页手帐，再开始编辑"));
    return;
  }
  const page = focusedPage();
  if (!page) {
    showError(new Error("当前没有可编辑的页面"));
    return;
  }
  editMode = true;
  ensureEditor();
  // Force attach once when entering edit.
  editAttachedPageId = null;
  paint();
  if (!attachEditorToFocus({ force: true })) {
    editMode = false;
    updateNav();
    showError(new Error("无法进入编辑：页面未就绪"));
  }
}

async function exitEdit({ saveFirst = false } = {}) {
  if (saveFirst && editor?.dirty) {
    await editor.save();
    await reload();
  } else if (editor?.dirty) {
    const keep = window.confirm("有未保存的更改。先保存再退出？\n确定=保存，取消=丢弃");
    if (keep) {
      await editor.save();
    }
    await reload();
  }
  editor?.exit();
  editMode = false;
  editAttachedPageId = null;
  paint();
}

function showError(error) {
  console.error(error);
  window.alert(error.message || String(error));
}

function ensureEditor() {
  if (editor) return editor;
  editor = createEditor({
    getCsrf: () => csrfToken,
    onDirty: () => {
      const saveBtn = $("#journal-tool-save");
      if (saveBtn) saveBtn.classList.toggle("is-dirty", editor.dirty);
    },
    onSaved: (page) => {
      const idx = pages.findIndex((p) => p.id === page.id);
      if (idx >= 0) pages[idx] = page;
    },
    onError: showError,
    onTextSync: (value, enabled) => {
      const draft = $("#journal-text-draft");
      if (!draft) return;
      draft.hidden = !enabled;
      if (enabled && document.activeElement !== draft) draft.value = value || "";
    },
  });
  return editor;
}

function bindUi() {
  ensureEditor();

  $("#journal-prev")?.addEventListener("click", () => goPrev());
  $("#journal-next")?.addEventListener("click", () => goNext());
  $("#journal-add-page")?.addEventListener("click", () => addPage().catch(showError));
  $("#journal-delete-page")?.addEventListener("click", () => deleteFocused().catch(showError));
  $("#journal-edit-toggle")?.addEventListener("click", () => {
    if (editMode) exitEdit({ saveFirst: false }).catch(showError);
    else enterEdit().catch(showError);
  });

  $("#journal-tool-text")?.addEventListener("click", async () => {
    try {
      if (!editMode) await enterEdit();
      if (!attachEditorToFocus({ force: false })) {
        showError(new Error("请先选中一页手帐纸，再添加文字"));
        return;
      }
      ensureEditor().addText();
      const draft = $("#journal-text-draft");
      if (draft) {
        draft.hidden = false;
        setTimeout(() => draft.focus(), 40);
      }
    } catch (error) {
      showError(error);
    }
  });
  $("#journal-text-draft")?.addEventListener("input", (event) => {
    ensureEditor().applyToolbarText(event.target.value);
  });
  $("#journal-text-draft")?.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  $("#journal-tool-photo")?.addEventListener("click", () => {
    const input = $("#journal-photo-input");
    input?.click();
  });
  $("#journal-photo-input")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await ensureEditor().addPhoto(file);
    } catch (error) {
      showError(error);
    }
  });
  $("#journal-tool-front")?.addEventListener("click", () => ensureEditor().bringFront());
  $("#journal-tool-back")?.addEventListener("click", () => ensureEditor().sendBack());
  $("#journal-tool-delete")?.addEventListener("click", () => ensureEditor().deleteSelected());
  $("#journal-tool-save")?.addEventListener("click", async () => {
    try {
      if (!editMode) await enterEdit();
      if (!attachEditorToFocus({ force: false })) {
        throw new Error("请先打开一页手帐，再保存");
      }
      await ensureEditor().save();
      // Merge saved content into local pages cache without full remount wipe.
      const savedId = ensureEditor().pageId;
      const data = await api(`/api/me/journal/pages/${encodeURIComponent(savedId)}`);
      const idx = pages.findIndex((p) => p.id === savedId);
      if (idx >= 0) pages[idx] = data.page;
      window.alert("已保存");
    } catch (error) {
      showError(error);
    }
  });

  binder()?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-create-first]");
    if (!btn) return;
    addPage().catch(showError);
  });

  // Pick which page of a spread to edit
  binder()?.addEventListener("pointerdown", (event) => {
    if (!editMode || isSingle()) return;
    if (event.target.closest(".layer-text-input, .journal-edit-toolbar, #journal-text-draft")) return;
    const slot = event.target.closest("[data-page-slot]");
    if (!slot || !slot.dataset.pageId) return;
    const which = slot.dataset.pageSlot;
    if (which !== focusSlot) {
      // Switching page: ask to save dirty work first.
      const switchPage = async () => {
        if (editor?.dirty) {
          const keep = window.confirm("换页前保存当前页的修改？\n确定=保存，取消=丢弃");
          if (keep) await editor.save();
        }
        focusSlot = which;
        editAttachedPageId = null;
        paint();
        attachEditorToFocus({ force: true });
      };
      switchPage().catch(showError);
    }
  });

  const root = $("#view-journal");
  root?.addEventListener(
    "touchstart",
    (event) => {
      if (!isSingle() || editMode) return;
      touchStartX = event.changedTouches[0]?.clientX || 0;
    },
    { passive: true },
  );
  root?.addEventListener(
    "touchend",
    (event) => {
      if (!isSingle() || editMode) return;
      const x = event.changedTouches[0]?.clientX || 0;
      const dx = x - touchStartX;
      if (Math.abs(dx) < 48) return;
      if (dx < 0) goNext();
      else goPrev();
    },
    { passive: true },
  );

  singleMq.addEventListener("change", () => {
    clampCursor();
    paint();
  });

  document.addEventListener("keydown", (event) => {
    const view = $("#view-journal");
    if (!view || view.hidden || !view.classList.contains("is-active")) return;
    if (editMode) {
      if (event.key === "Escape") {
        event.preventDefault();
        exitEdit().catch(showError);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goPrev();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    }
  });
}

export async function mountJournal(auth) {
  if (!auth?.authenticated && auth?.status !== "authenticated") return;
  csrfToken = auth.csrfToken || "";
  if (!mounted) {
    bindUi();
    mounted = true;
  }
  try {
    await reload();
  } catch (error) {
    if (error?.code === "schema_missing") {
      showError(new Error("手帐数据表尚未就绪（需执行 D1 迁移 0002_journal_pages）。登录状态仍然有效。"));
      return;
    }
    showError(error);
  }
}

export function unmountJournal() {
  editor?.destroy();
  editor = null;
  editMode = false;
}
