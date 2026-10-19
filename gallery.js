import { api, uploadBytes } from "./auth-client.js?v=16";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const CARD_CLASSES = [
  "gallery-card-tall", "gallery-card-wide", "gallery-card-note", "gallery-card-square",
  "gallery-card-window", "gallery-card-night", "gallery-card-polaroid", "gallery-card-meadow",
  "gallery-card-small", "gallery-card-last",
];

let mounted = false;
let csrfToken = "";
let items = [];
let activeFilter = "all";
let activeCards = [];
let activeIndex = 0;
let editingId = "";
let replacementFile = null;

function $(selector, root = document) {
  return root.querySelector(selector);
}

function allCards() {
  return [...document.querySelectorAll(".gallery-card")];
}

function visibleCards() {
  return allCards().filter((card) => !card.hidden);
}

function titleFromFile(file) {
  return String(file?.name || "Untitled memory")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 80) || "Untitled memory";
}

function setStatus(message = "", tone = "") {
  const node = $("#gallery-status");
  if (!node) return;
  node.textContent = message;
  node.dataset.tone = tone;
  node.hidden = !message;
}

function setBusy(busy) {
  $("#gallery-upload-button")?.toggleAttribute("disabled", busy);
  $("#gallery-empty-upload")?.toggleAttribute("disabled", busy);
  $("#gallery-editor-form")?.classList.toggle("is-busy", busy);
}

function updateCount() {
  const count = visibleCards().length;
  const label = $("#gallery-count");
  const empty = $("#gallery-no-results");
  const grid = $("#gallery-grid");
  const emptyTitle = $("#gallery-empty-title");
  const emptyCopy = $("#gallery-empty-copy");
  const emptyUpload = $("#gallery-empty-upload");
  if (label) label.textContent = String(count);
  if (grid) grid.classList.toggle("is-empty", count === 0);
  if (empty) empty.hidden = count !== 0;
  if (emptyTitle) emptyTitle.textContent = items.length ? "这个分类暂时没有照片。" : "这里还没有照片。";
  if (emptyCopy) {
    emptyCopy.textContent = items.length
      ? "换一个分类看看，或继续加入新的记忆。"
      : "点击 Add photos，放进第一段属于你的记忆。";
  }
  if (emptyUpload) emptyUpload.hidden = items.length !== 0;
}

function applyFilter(filter) {
  activeFilter = filter;
  allCards().forEach((card, index) => {
    const matches = filter === "all" || card.dataset.galleryCategory === filter;
    card.hidden = !matches;
    if (matches && !reducedMotion) {
      card.style.setProperty("--gallery-delay", `${Math.min(index, 6) * 35}ms`);
      card.classList.remove("is-revealed");
      requestAnimationFrame(() => card.classList.add("is-revealed"));
    }
  });
  document.querySelectorAll("[data-gallery-filter]").forEach((button) => {
    const selected = button.dataset.galleryFilter === filter;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  updateCount();
}

function makeCard(item, index) {
  const card = document.createElement("article");
  card.className = `gallery-card ${CARD_CLASSES[index % CARD_CLASSES.length]}`;
  card.dataset.galleryId = item.id;
  card.dataset.galleryCategory = item.category;
  card.dataset.gallerySrc = item.imageUrl;
  card.dataset.galleryTitle = item.title;
  card.dataset.galleryNote = item.note || "";

  const view = document.createElement("button");
  view.type = "button";
  view.className = "gallery-card-view";
  view.setAttribute("aria-label", `查看照片：${item.title}`);

  const photo = document.createElement("span");
  photo.className = "gallery-photo";
  const image = document.createElement("img");
  image.src = item.imageUrl;
  image.alt = item.title;
  image.loading = index < 2 ? "eager" : "lazy";
  image.decoding = "async";
  photo.append(image);

  const caption = document.createElement("span");
  caption.className = "gallery-caption";
  const title = document.createElement("b");
  title.textContent = item.title;
  const note = document.createElement("small");
  note.textContent = item.note || ({
    places: "a place to remember",
    nature: "a little piece of nature",
    moments: "a moment worth keeping",
  }[item.category]);
  caption.append(title, note);
  view.append(photo, caption);

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "gallery-card-edit";
  edit.textContent = "编辑";
  edit.setAttribute("aria-label", `编辑照片：${item.title}`);
  edit.addEventListener("click", () => openEditor(item.id));
  view.addEventListener("click", () => openLightbox(card));
  card.append(view, edit);
  return card;
}

function render() {
  const grid = $("#gallery-grid");
  if (!grid) return;
  grid.replaceChildren(...items.map(makeCard));
  applyFilter(activeFilter);
}

function lightbox() {
  return $("#gallery-lightbox");
}

function paintLightbox() {
  const card = activeCards[activeIndex];
  if (!card) return;
  const image = $("#gallery-lightbox-image");
  if (image) {
    image.src = card.dataset.gallerySrc || "";
    image.alt = card.dataset.galleryTitle || "Gallery photo";
  }
  if ($("#gallery-lightbox-title")) $("#gallery-lightbox-title").textContent = card.dataset.galleryTitle || "Gallery";
  if ($("#gallery-lightbox-note")) $("#gallery-lightbox-note").textContent = card.dataset.galleryNote || "";
}

function openLightbox(card) {
  activeCards = visibleCards();
  activeIndex = Math.max(0, activeCards.indexOf(card));
  paintLightbox();
  const dialog = lightbox();
  if (!dialog) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function stepLightbox(direction) {
  if (!activeCards.length) return;
  activeIndex = (activeIndex + direction + activeCards.length) % activeCards.length;
  paintLightbox();
}

function editor() {
  return $("#gallery-editor");
}

function closeEditor() {
  replacementFile = null;
  editingId = "";
  const dialog = editor();
  if (dialog?.open) dialog.close();
}

function openEditor(itemId) {
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) return;
  editingId = item.id;
  replacementFile = null;
  $("#gallery-edit-title").value = item.title;
  $("#gallery-edit-category").value = item.category;
  $("#gallery-edit-note").value = item.note || "";
  $("#gallery-replace-name").textContent = "保留当前图片";
  $("#gallery-editor-message").textContent = "";
  const dialog = editor();
  if (typeof dialog?.showModal === "function") dialog.showModal();
  else dialog?.setAttribute("open", "");
}

async function loadItems() {
  setStatus("正在读取你的照片…");
  try {
    const data = await api("/api/me/gallery/items");
    items = Array.isArray(data.items) ? data.items : [];
    render();
    if (data.storage !== "r2") {
      setStatus("图片存储尚未启用；管理员需要配置 R2 后才能上传。", "warning");
    } else {
      setStatus("");
    }
  } catch (error) {
    items = [];
    render();
    setStatus(error?.message || "Gallery 加载失败，请重试。", "error");
  }
}

async function uploadFiles(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  setBusy(true);
  let completed = 0;
  try {
    for (const file of files) {
      setStatus(`正在上传 ${completed + 1} / ${files.length}：${file.name}`);
      const params = new URLSearchParams({ title: titleFromFile(file), category: "moments" });
      const result = await uploadBytes(`/api/me/gallery/items?${params}`, {
        bytes: file,
        contentType: file.type,
        csrfToken,
      });
      items.push(result.item);
      completed += 1;
      render();
    }
    setStatus(`已加入 ${completed} 张照片。`, "success");
    window.setTimeout(() => setStatus(""), 2400);
  } catch (error) {
    setStatus(`已上传 ${completed} 张；${error?.message || "其余照片上传失败"}`, "error");
  } finally {
    setBusy(false);
    const input = $("#gallery-file-input");
    if (input) input.value = "";
  }
}

async function saveEditor(event) {
  event.preventDefault();
  const item = items.find((candidate) => candidate.id === editingId);
  if (!item) return;
  const message = $("#gallery-editor-message");
  setBusy(true);
  if (message) message.textContent = "正在保存…";
  try {
    const result = await api(`/api/me/gallery/items/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      csrfToken,
      body: {
        title: $("#gallery-edit-title").value,
        note: $("#gallery-edit-note").value,
        category: $("#gallery-edit-category").value,
      },
    });
    let next = result.item;
    if (replacementFile) {
      const replaced = await uploadBytes(`/api/me/gallery/items/${encodeURIComponent(item.id)}/image`, {
        method: "PUT",
        bytes: replacementFile,
        contentType: replacementFile.type,
        csrfToken,
      });
      next = replaced.item;
    }
    items = items.map((candidate) => candidate.id === item.id ? next : candidate);
    render();
    closeEditor();
    setStatus("照片已更新。", "success");
    window.setTimeout(() => setStatus(""), 2000);
  } catch (error) {
    if (message) message.textContent = error?.message || "保存失败，请重试。";
  } finally {
    setBusy(false);
  }
}

async function deleteEditingItem() {
  const item = items.find((candidate) => candidate.id === editingId);
  if (!item) return;
  if (!window.confirm(`确定删除“${item.title}”吗？删除后无法恢复。`)) return;
  const message = $("#gallery-editor-message");
  setBusy(true);
  if (message) message.textContent = "正在删除…";
  try {
    await api(`/api/me/gallery/items/${encodeURIComponent(item.id)}`, {
      method: "DELETE",
      csrfToken,
      body: {},
    });
    items = items.filter((candidate) => candidate.id !== item.id);
    render();
    closeEditor();
    setStatus("照片已删除。", "success");
    window.setTimeout(() => setStatus(""), 2000);
  } catch (error) {
    if (message) message.textContent = error?.message || "删除失败，请重试。";
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  document.querySelectorAll("[data-gallery-filter]").forEach((button) => {
    button.addEventListener("click", () => applyFilter(button.dataset.galleryFilter || "all"));
  });
  $("#gallery-upload-button")?.addEventListener("click", () => $("#gallery-file-input")?.click());
  $("#gallery-empty-upload")?.addEventListener("click", () => $("#gallery-file-input")?.click());
  $("#gallery-file-input")?.addEventListener("change", (event) => uploadFiles(event.target.files));
  $("#gallery-editor-form")?.addEventListener("submit", saveEditor);
  $("#gallery-delete-button")?.addEventListener("click", deleteEditingItem);
  document.querySelectorAll("[data-gallery-editor-close]").forEach((button) => button.addEventListener("click", closeEditor));
  $("#gallery-replace-button")?.addEventListener("click", () => $("#gallery-replace-input")?.click());
  $("#gallery-replace-input")?.addEventListener("change", (event) => {
    replacementFile = event.target.files?.[0] || null;
    $("#gallery-replace-name").textContent = replacementFile?.name || "保留当前图片";
  });
  $("[data-gallery-prev]")?.addEventListener("click", () => stepLightbox(-1));
  $("[data-gallery-next]")?.addEventListener("click", () => stepLightbox(1));
  lightbox()?.addEventListener("click", (event) => {
    if (event.target === lightbox()) lightbox().close();
  });
  editor()?.addEventListener("click", (event) => {
    if (event.target === editor()) closeEditor();
  });
  document.addEventListener("keydown", (event) => {
    const dialog = lightbox();
    if (!dialog?.open) return;
    if (event.key === "ArrowLeft") stepLightbox(-1);
    if (event.key === "ArrowRight") stepLightbox(1);
  });
}

export async function mountGallery(authState = {}) {
  csrfToken = authState.csrfToken || csrfToken;
  if (!mounted) {
    mounted = true;
    bindEvents();
  }
  await loadItems();
}
