import { api } from "./auth-client.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let mounted = false;
let loaded = false;
let notes = [];
let activeId = null;
let selectedColor = "ivory";
let auth = null;
let notify = () => {};
let searchTimer = null;

function openDialog() {
  const dialog = $("#note-dialog");
  if (!dialog.open) dialog.showModal();
}

function closeDialog() {
  const dialog = $("#note-dialog");
  if (dialog.open) dialog.close();
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function setStatus(message, error = false) {
  const node = $("#notes-status");
  node.textContent = message;
  node.classList.toggle("is-error", error);
  node.hidden = !message;
}

function render() {
  const wall = $("#note-wall");
  $("#note-count").textContent = String(notes.length);
  $("#note-empty").hidden = notes.length !== 0;
  wall.replaceChildren(...notes.map((note) => {
    const button = document.createElement("button");
    button.className = "note";
    button.type = "button";
    button.dataset.color = note.color;
    button.setAttribute("aria-label", `打开便签：${note.title || "Untitled note"}`);
    button.innerHTML = "<time></time><span class=\"note-pin\" aria-hidden=\"true\"></span><h3></h3><p></p>";
    button.querySelector("time").textContent = formatDate(note.updatedAt);
    button.querySelector(".note-pin").textContent = note.pinned ? "●" : "";
    button.querySelector("h3").textContent = note.title || "Untitled note";
    button.querySelector("p").textContent = note.body || "这是一张空白便签。";
    button.addEventListener("click", () => editNote(note.id));
    return button;
  }));
}

async function loadNotes() {
  setStatus("正在读取你的便签…");
  try {
    const search = $("#note-search").value.trim();
    const sort = $("#note-sort").value;
    const params = new URLSearchParams({ sort });
    if (search) params.set("search", search);
    const data = await api(`/api/me/notes?${params}`);
    notes = data.notes || [];
    loaded = true;
    render();
    setStatus("");
  } catch (error) {
    setStatus(error.message || "便签加载失败，请稍后重试。", true);
  }
}

function syncColors() {
  $$('[data-note-color]').forEach((button) => {
    button.classList.toggle("active", button.dataset.noteColor === selectedColor);
  });
}

function editNote(id = null) {
  activeId = id;
  const note = notes.find((item) => item.id === id);
  selectedColor = note?.color || "ivory";
  $("#note-dialog-title").textContent = note ? "打开便签" : "新的便签";
  $("#note-title").value = note?.title || "";
  $("#note-body").value = note?.body || "";
  $("#note-pinned").checked = Boolean(note?.pinned);
  $("#note-meta").textContent = note
    ? `最后保存：${formatDate(note.updatedAt)}`
    : "保存后会写入当前账户的私人空间。";
  $("#delete-note").hidden = !note;
  syncColors();
  openDialog();
  window.setTimeout(() => $("#note-title").focus(), 30);
}

async function saveNote(event) {
  event.preventDefault();
  const button = $("#save-note");
  const payload = {
    title: $("#note-title").value.trim() || "Untitled note",
    body: $("#note-body").value,
    color: selectedColor,
    pinned: $("#note-pinned").checked,
  };
  button.disabled = true;
  button.textContent = "保存中…";
  $("#note-form").classList.add("save-pending");
  try {
    if (activeId) {
      await api(`/api/me/notes/${encodeURIComponent(activeId)}`, {
        method: "PATCH",
        csrfToken: auth.csrfToken,
        body: payload,
      });
    } else {
      await api("/api/me/notes", {
        method: "POST",
        csrfToken: auth.csrfToken,
        body: payload,
      });
    }
    closeDialog();
    await loadNotes();
    notify("便签已保存");
  } catch (error) {
    $("#note-meta").textContent = error.message || "保存失败，请重试。";
  } finally {
    button.disabled = false;
    button.textContent = "保存";
    $("#note-form").classList.remove("save-pending");
  }
}

async function deleteNote() {
  if (!activeId) return;
  if (!window.confirm("确定删除这张便签吗？删除后无法恢复。")) return;
  try {
    await api(`/api/me/notes/${encodeURIComponent(activeId)}`, {
      method: "DELETE",
      csrfToken: auth.csrfToken,
      body: {},
    });
    closeDialog();
    await loadNotes();
    notify("便签已删除");
  } catch (error) {
    $("#note-meta").textContent = error.message || "删除失败，请重试。";
  }
}

export async function mountNotes(authState, options = {}) {
  auth = authState;
  notify = options.notify || notify;
  if (!mounted) {
    mounted = true;
    $("#add-note").addEventListener("click", () => editNote());
    $("#note-form").addEventListener("submit", saveNote);
    $("#delete-note").addEventListener("click", deleteNote);
    $("#note-search").addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(loadNotes, 260);
    });
    $("#note-sort").addEventListener("change", loadNotes);
    $$('[data-note-color]').forEach((button) => button.addEventListener("click", () => {
      selectedColor = button.dataset.noteColor;
      syncColors();
    }));
  }
  if (!loaded) await loadNotes();
}
