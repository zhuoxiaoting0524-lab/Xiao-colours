/**
 * Interactive Journal: flip, add/delete pages, year filter.
 * Page layers use paper-relative coords (see content.coord), not viewport.
 */
import { api } from "./auth-client.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const singleMq = window.matchMedia("(max-width: 640px)");

let csrfToken = "";
let allYears = [];
let pages = []; // filtered list in display order
let yearFilter = null; // null = all years
let cursor = 0; // index into `pages` (left page of spread, or single current)
let flipping = false;
let mounted = false;
let touchStartX = 0;

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
  return total() > 0 && cursor > 0;
}

function canGoNext() {
  if (!total()) return false;
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
}

/**
 * Render page content into a paper stage.
 * Layers are positioned in % of the stage (mapped from normalized coord space).
 */
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

  const coord = page.content?.coord || { width: 1000, height: 1400 };
  stage.style.setProperty("--page-coord-w", String(coord.width));
  stage.style.setProperty("--page-coord-h", String(coord.height));

  // Future collage layers: map x/y/w/h from page coords → % of stage
  for (const layer of page.content?.layers || []) {
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
    layers.append(el);
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
  if (prev) prev.disabled = !canPrev() || flipping;
  if (next) next.disabled = !canGoNext() || flipping;
  if (counter) counter.textContent = counterLabel();
  if (actions) actions.hidden = false;
  if (del) del.disabled = !total() || flipping;
  binder()?.classList.toggle("is-empty-journal", total() === 0);
  binder()?.classList.toggle("is-single-mode", isSingle());
}

function paint() {
  clampCursor();
  const left = $('[data-page-slot="left"]');
  const right = $('[data-page-slot="right"]');
  if (!left || !right) return;

  if (!total()) {
    renderPageInto(left, null, { showCreate: true });
    renderPageInto(right, null, { showCreate: false });
    // Keep both blank pages visible as the open binder
    left.hidden = false;
    right.hidden = isSingle();
    updateNav();
    return;
  }

  if (isSingle()) {
    renderPageInto(left, pages[cursor]);
    renderPageInto(right, null);
    left.hidden = false;
    right.hidden = true;
  } else {
    renderPageInto(left, pages[cursor] || null);
    renderPageInto(right, pages[cursor + 1] || null);
    left.hidden = false;
    right.hidden = false;
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
  allBtn.addEventListener("click", () => selectYear(null));
  rail.append(allBtn);

  for (const y of years) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `year-item${active === y ? " is-active" : ""}`;
    btn.textContent = String(y);
    if (active === y) btn.setAttribute("aria-current", "true");
    btn.addEventListener("click", () => selectYear(y));
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
  // If filtering a year with no pages, keep filter but show empty binder
  renderYearRail();
  paint();
}

async function waitFlip(ms) {
  if (reducedMotion) return;
  await new Promise((r) => setTimeout(r, ms));
}

async function animateFlip(direction) {
  if (reducedMotion || isSingle()) return;
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
  if (!total()) return null;
  if (isSingle()) return pages[cursor]?.id || null;
  // prefer right page if present, else left
  return pages[cursor + 1]?.id || pages[cursor]?.id || null;
}

async function addPage() {
  const body = {};
  if (yearFilter) body.year = yearFilter;
  const data = await api("/api/me/journal/pages", {
    method: "POST",
    csrfToken,
    body,
  });
  await reload();
  // jump to the new page (last in current filter if year matches)
  const idx = pages.findIndex((p) => p.id === data.page.id);
  if (idx >= 0) {
    cursor = isSingle() ? idx : idx - (idx % 2);
  } else {
    // new page may be outside year filter
    yearFilter = null;
    await reload();
    const idx2 = pages.findIndex((p) => p.id === data.page.id);
    cursor = isSingle() ? Math.max(0, idx2) : Math.max(0, idx2 - (idx2 % 2));
  }
  paint();
}

async function deleteFocused() {
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

function bindUi() {
  $("#journal-prev")?.addEventListener("click", () => goPrev());
  $("#journal-next")?.addEventListener("click", () => goNext());
  $("#journal-add-page")?.addEventListener("click", () => addPage().catch(showError));
  $("#journal-delete-page")?.addEventListener("click", () => deleteFocused().catch(showError));
  binder()?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-create-first]");
    if (!btn) return;
    addPage().catch(showError);
  });

  const root = $("#view-journal");
  root?.addEventListener(
    "touchstart",
    (event) => {
      if (!isSingle()) return;
      touchStartX = event.changedTouches[0]?.clientX || 0;
    },
    { passive: true },
  );
  root?.addEventListener(
    "touchend",
    (event) => {
      if (!isSingle()) return;
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
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goPrev();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    }
  });
}

function showError(error) {
  console.error(error);
  window.alert(error.message || String(error));
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
    // Never treat journal API failures as logout / never navigate away.
    if (error?.code === "schema_missing") {
      showError(new Error("手帐数据表尚未就绪（需执行 D1 迁移 0002_journal_pages）。登录状态仍然有效。"));
      return;
    }
    showError(error);
  }
}

export function unmountJournal() {
  // keep listeners; state cleared on next mount via reload
}
