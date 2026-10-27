const PAGE_WIDTH = 900;
const PAGE_HEIGHT = 1273;
const PDF_WIDTH = 595.28;
const PDF_HEIGHT = 841.89;
const MAX_PAGES = 80;
const MAX_PHOTOS = 40;
const COLORS = {
  cream: "#FBF8F0", paper: "#FFFDF8", sage: "#738B7B", sageDark: "#526D59",
  sageSoft: "#E8EEE7", peach: "#F5E9E2", apricot: "#D9A58C", ink: "#252B28", muted: "#768078", line: "#E4E7DF",
};

const encoder = new TextEncoder();

function safeDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function isoDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateBounds(range, start, end, now = new Date()) {
  if (range === "this-year") return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31`, label: `${now.getFullYear()} 年` };
  if (range === "last-year") return { start: `${now.getFullYear() - 1}-01-01`, end: `${now.getFullYear() - 1}-12-31`, label: `${now.getFullYear() - 1} 年` };
  if (range === "custom") {
    if (!safeDate(start) || !safeDate(end) || start > end) throw new Error("请选择有效的自定义日期范围");
    return { start, end, label: `${start} 至 ${end}` };
  }
  return { start: null, end: null, label: "全部记录" };
}

function withinRange(value, bounds) {
  if (!bounds.start) return true;
  const date = String(value || "").slice(0, 10);
  return Boolean(date && date >= bounds.start && date <= bounds.end);
}

export function filterArchiveData(exported, options) {
  const bounds = dateBounds(options.range, options.start, options.end, options.now || new Date());
  const taskRows = options.include.has("tasks") ? (exported.data?.myDays || []).filter((item) => withinRange(item.date, bounds)) : [];
  const importantDates = options.include.has("important") ? (exported.data?.importantDates || []).filter((item) => withinRange(item.date, bounds)) : [];
  const footprints = options.include.has("footprints") ? (exported.data?.footprints || []).filter((item) => withinRange(item.visitedDate || item.createdAt, bounds)) : [];
  return { bounds, tasks: taskRows, importantDates, footprints };
}

function roundedRect(ctx, x, y, width, height, radius, fill, stroke = null) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + width - r, y); ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r); ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

function drawLeaves(ctx, x, y, scale = 1, color = COLORS.sage) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 80); ctx.quadraticCurveTo(10, 38, 2, 0); ctx.stroke();
  [[5, 18, 18, -8], [-2, 34, -20, -7], [5, 50, 21, -3], [-1, 65, -18, 2]].forEach(([sx, sy, ex, ey]) => {
    ctx.beginPath(); ctx.ellipse(ex, sy + ey, 12, 6, ex > 0 ? -0.5 : 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, sy + ey); ctx.stroke();
  });
  ctx.restore();
}

function createPage() {
  const canvas = document.createElement("canvas"); canvas.width = PAGE_WIDTH; canvas.height = PAGE_HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = COLORS.cream; ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  return { canvas, ctx };
}

function text(ctx, value, x, y, { font = '28px "Noto Sans SC", sans-serif', color = COLORS.ink, align = "left", baseline = "alphabetic" } = {}) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = baseline; ctx.fillText(String(value ?? ""), x, y);
}

function wrapLines(ctx, value, maxWidth, maxLines = 20) {
  const chars = Array.from(String(value || ""));
  const lines = []; let line = "";
  for (const char of chars) {
    if (char === "\n") { lines.push(line); line = ""; continue; }
    const next = line + char;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = char; } else line = next;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && chars.length > lines.join("").length) lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  return lines;
}

function paragraph(ctx, value, x, y, maxWidth, { font = '23px "Noto Sans SC", sans-serif', color = COLORS.ink, lineHeight = 38, maxLines = 8, align = "left" } = {}) {
  ctx.font = font;
  const lines = wrapLines(ctx, value, maxWidth, maxLines);
  lines.forEach((line, index) => text(ctx, line, x, y + index * lineHeight, { font, color, align }));
  return y + lines.length * lineHeight;
}

function pageHeader(ctx, titleValue, eyebrow, pageNumber) {
  text(ctx, "XiaoColour", 64, 55, { font: '600 20px Georgia, "Noto Serif SC", serif', color: COLORS.sageDark });
  text(ctx, eyebrow, 64, 110, { font: '700 13px "Noto Sans SC", sans-serif', color: COLORS.sage });
  text(ctx, titleValue, 64, 162, { font: '600 42px Georgia, "Noto Serif SC", serif' });
  ctx.fillStyle = COLORS.line; ctx.fillRect(64, 184, 772, 1);
  text(ctx, String(pageNumber), 824, 1220, { font: '15px "Noto Sans SC", sans-serif', color: COLORS.muted, align: "right" });
}

function pageToJpeg(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(async (blob) => {
    if (!blob) return reject(new Error("无法生成 PDF 页面图像"));
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, "image/jpeg", 0.9));
}

async function addPage(pages, painter) {
  if (pages.length >= MAX_PAGES) throw new Error(`档案内容超过 ${MAX_PAGES} 页，请缩小时间范围后重试`);
  const { canvas, ctx } = createPage();
  await painter(ctx, pages.length + 1);
  pages.push(await pageToJpeg(canvas));
  canvas.width = 1; canvas.height = 1;
}

function statCard(ctx, x, y, value, label, tint) {
  roundedRect(ctx, x, y, 225, 135, 18, tint, COLORS.line);
  text(ctx, value, x + 28, y + 61, { font: '600 43px Georgia, "Noto Serif SC", serif', color: COLORS.sageDark });
  text(ctx, label, x + 28, y + 99, { font: '18px "Noto Sans SC", sans-serif', color: COLORS.muted });
}

async function loadPhoto(footprintId) {
  const response = await fetch(`/api/me/footprints/${encodeURIComponent(footprintId)}/photo`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) return null;
  const blob = await response.blob();
  if (!blob.type.startsWith("image/") || blob.size > 2 * 1024 * 1024) return null;
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

function drawCoverImage(ctx, image, x, y, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const sw = width / scale, sh = height / scale;
  const sx = (image.width - sw) / 2, sy = (image.height - sh) / 2;
  ctx.save();
  roundedRect(ctx, x, y, width, height, 18, COLORS.sageSoft);
  ctx.clip(); ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height); ctx.restore();
}

function escapePdfName(value) { return String(value).replace(/[()\\]/g, "\\$&"); }
function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

export function buildPdfFromJpegs(images, title = "XiaoColour My Life Archive") {
  if (!images.length) throw new Error("PDF 至少需要一页");
  const objectCount = 3 + images.length * 3;
  const objects = new Array(objectCount + 1);
  objects[1] = encoder.encode("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = images.map((_, index) => `${6 + index * 3} 0 R`).join(" ");
  objects[2] = encoder.encode(`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`);
  objects[3] = encoder.encode(`<< /Title (${escapePdfName(title)}) /Creator (XiaoColour) >>`);
  images.forEach((image, index) => {
    const imageId = 4 + index * 3, contentId = imageId + 1, pageId = imageId + 2;
    objects[imageId] = concat([encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH} /Height ${PAGE_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, encoder.encode("\nendstream")]);
    const command = `q ${PDF_WIDTH} 0 0 ${PDF_HEIGHT} 0 0 cm /Im0 Do Q`;
    objects[contentId] = encoder.encode(`<< /Length ${command.length} >>\nstream\n${command}\nendstream`);
    objects[pageId] = encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
  });
  const parts = [encoder.encode("%PDF-1.7\n%XiaoColour\n")];
  const offsets = new Array(objectCount + 1).fill(0); let position = parts[0].length;
  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = position;
    const object = concat([encoder.encode(`${id} 0 obj\n`), objects[id], encoder.encode("\nendobj\n")]);
    parts.push(object); position += object.length;
  }
  const xrefOffset = position;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objectCount; id += 1) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(encoder.encode(xref));
  return concat(parts);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = filename; link.hidden = true; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function formatDate(value) {
  const date = safeDate(value); if (!date) return "日期未记录";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

async function renderArchive(exported, options, onProgress) {
  const filtered = filterArchiveData(exported, options); const pages = [];
  const doneTasks = filtered.tasks.filter((task) => task.completed).length;
  const visited = filtered.footprints.filter((place) => place.status === "visited");
  const wished = filtered.footprints.filter((place) => place.status === "wish");
  const countries = new Set(filtered.footprints.map((place) => place.countryCode).filter(Boolean));
  onProgress(8, "正在设计封面…");
  await addPage(pages, async (ctx, page) => {
    ctx.fillStyle = COLORS.sageSoft; ctx.fillRect(0, 0, PAGE_WIDTH, 17);
    drawLeaves(ctx, 725, 70, 1.5, "#9AAB92"); drawLeaves(ctx, 118, 990, 1.2, "#D9A58C");
    text(ctx, "XiaoColour", 70, 105, { font: '600 25px Georgia, "Noto Serif SC", serif', color: COLORS.sageDark });
    text(ctx, "My Life Archive", 70, 390, { font: 'italic 62px Georgia, "Noto Serif SC", serif', color: COLORS.sageDark });
    text(ctx, "我的生活档案", 70, 485, { font: '600 65px "Noto Serif SC", serif' });
    paragraph(ctx, "走过的地方，都是生活的颜色。", 74, 560, 660, { font: '27px "Noto Serif SC", serif', color: COLORS.muted, lineHeight: 42 });
    roundedRect(ctx, 70, 895, 760, 160, 22, COLORS.peach);
    text(ctx, "记录范围", 102, 945, { font: '700 15px "Noto Sans SC", sans-serif', color: COLORS.apricot });
    text(ctx, filtered.bounds.label, 102, 988, { font: '600 26px "Noto Sans SC", sans-serif' });
    text(ctx, `导出日期  ${formatDate(new Date().toISOString())}`, 102, 1027, { font: '18px "Noto Sans SC", sans-serif', color: COLORS.muted });
    text(ctx, page, 824, 1220, { font: '15px sans-serif', color: COLORS.muted, align: "right" });
  });

  onProgress(18, "正在整理生活概览…");
  await addPage(pages, async (ctx, page) => {
    pageHeader(ctx, "生活概览", "LIFE OVERVIEW", page);
    statCard(ctx, 64, 235, filtered.tasks.length, "已记录任务", COLORS.sageSoft);
    statCard(ctx, 337, 235, doneTasks, "已完成任务", "#EEF3EA");
    statCard(ctx, 610, 235, filtered.importantDates.length, "重要日期", COLORS.peach);
    statCard(ctx, 64, 402, visited.length, "去过的地点", "#EEF3EA");
    statCard(ctx, 337, 402, wished.length, "想去的地点", COLORS.peach);
    statCard(ctx, 610, 402, countries.size, "国家或地区", "#E7F0EF");
    roundedRect(ctx, 64, 610, 772, 350, 24, COLORS.paper, COLORS.line);
    drawLeaves(ctx, 690, 650, 1.4, "#A9B9A4");
    text(ctx, "一页一页，收藏真实生活。", 106, 735, { font: '600 34px "Noto Serif SC", serif' });
    paragraph(ctx, "这里的每个数字都来自你在 XiaoColour 中实际保存的记录。没有数据的项目会如实显示为 0。", 106, 800, 540, { font: '22px "Noto Sans SC", sans-serif', color: COLORS.muted, lineHeight: 38, maxLines: 4 });
  });

  if (options.include.has("tasks") || options.include.has("important")) {
    const entries = [
      ...filtered.tasks.map((item) => ({ ...item, kind: "task" })),
      ...filtered.importantDates.map((item) => ({ ...item, kind: "important" })),
    ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const chunks = entries.length ? Array.from({ length: Math.ceil(entries.length / 11) }, (_, index) => entries.slice(index * 11, index * 11 + 11)) : [[]];
    for (let index = 0; index < chunks.length; index += 1) {
      onProgress(25 + Math.round((index / chunks.length) * 25), "正在排版 My Days…");
      await addPage(pages, async (ctx, page) => {
        pageHeader(ctx, "我的日程", `MY DAYS · ${index + 1}/${chunks.length}`, page);
        if (!chunks[index].length) {
          roundedRect(ctx, 64, 250, 772, 220, 22, COLORS.paper, COLORS.line);
          text(ctx, "这个时间范围内还没有日程记录。", 450, 350, { font: '26px "Noto Serif SC", serif', color: COLORS.muted, align: "center" });
        }
        chunks[index].forEach((item, rowIndex) => {
          const y = 225 + rowIndex * 82;
          roundedRect(ctx, 64, y, 772, 64, 13, rowIndex % 2 ? COLORS.paper : "#F5F7F2", COLORS.line);
          text(ctx, String(item.date || "—"), 84, y + 39, { font: '17px "Noto Sans SC", sans-serif', color: COLORS.muted });
          const titleValue = item.kind === "important" ? `重要日期 · ${item.title}` : item.title;
          text(ctx, titleValue, 245, y + 39, { font: '600 19px "Noto Sans SC", sans-serif' });
          text(ctx, item.kind === "task" ? (item.completed ? "已完成" : "待完成") : "纪念", 806, y + 39, { font: '15px "Noto Sans SC", sans-serif', color: item.completed ? COLORS.sage : COLORS.apricot, align: "right" });
        });
      });
    }
  }

  if (options.include.has("footprints")) {
    const records = filtered.footprints.length ? filtered.footprints : [null];
    const photoRecords = records.filter((place) => place?.photo && options.include.has("photos")).slice(0, MAX_PHOTOS);
    const photoIds = new Set(photoRecords.map((place) => place.id));
    for (let index = 0; index < records.length; index += 1) {
      const place = records[index]; onProgress(52 + Math.round((index / records.length) * 38), "正在整理旅行足迹与照片…");
      let image = null;
      if (place && photoIds.has(place.id)) { try { image = await loadPhoto(place.id); } catch { image = null; } }
      await addPage(pages, async (ctx, page) => {
        pageHeader(ctx, "旅行足迹", `FOOTPRINTS · ${index + 1}/${records.length}`, page);
        if (!place) {
          roundedRect(ctx, 64, 250, 772, 235, 22, COLORS.paper, COLORS.line);
          drawLeaves(ctx, 655, 300, 1.1, "#A9B9A4");
          text(ctx, "这个时间范围内还没有旅行足迹。", 450, 365, { font: '26px "Noto Serif SC", serif', color: COLORS.muted, align: "center" });
          return;
        }
        roundedRect(ctx, 64, 225, 772, image ? 310 : 420, 22, COLORS.paper, COLORS.line);
        text(ctx, place.nameZh || place.name || place.nameEn || "未命名地点", 96, 285, { font: '600 35px "Noto Serif SC", serif' });
        text(ctx, [place.nameEn, place.countryCode].filter(Boolean).join(" · "), 96, 322, { font: '17px "Noto Sans SC", sans-serif', color: COLORS.muted });
        roundedRect(ctx, 690, 248, 110, 42, 21, place.status === "visited" ? COLORS.sageSoft : COLORS.peach);
        text(ctx, place.status === "visited" ? "去过" : "想去", 745, 275, { font: '600 17px "Noto Sans SC", sans-serif', color: place.status === "visited" ? COLORS.sageDark : "#9C644C", align: "center" });
        text(ctx, `日期  ${formatDate(place.visitedDate)}`, 96, 380, { font: '18px "Noto Sans SC", sans-serif', color: COLORS.muted });
        paragraph(ctx, place.note || "这条足迹还没有添加文字备注。", 96, 435, 680, { font: '22px "Noto Sans SC", sans-serif', color: COLORS.ink, lineHeight: 37, maxLines: image ? 3 : 7 });
        if (image) { drawCoverImage(ctx, image, 64, 570, 772, 470); image.close?.(); }
      });
    }
  }

  onProgress(94, "正在完成最后一页…");
  await addPage(pages, async (ctx, page) => {
    drawLeaves(ctx, 665, 125, 1.7, "#AAB7A2"); drawLeaves(ctx, 145, 900, 1.2, "#D8B39E");
    text(ctx, "“", 450, 385, { font: '90px Georgia, serif', color: COLORS.sage, align: "center" });
    paragraph(ctx, "每一段平凡的日子，\n都值得被认真收藏。", 450, 510, 700, { font: '600 40px "Noto Serif SC", serif', color: COLORS.ink, lineHeight: 68, maxLines: 3, align: "center" });
    text(ctx, "XiaoColour · My Little World", 450, 760, { font: 'italic 25px Georgia, serif', color: COLORS.sageDark, align: "center" });
    text(ctx, page, 824, 1220, { font: '15px sans-serif', color: COLORS.muted, align: "right" });
  });
  onProgress(98, "正在封装 PDF 文件…");
  return buildPdfFromJpegs(pages);
}

export function mountLifeArchive({ notify } = {}) {
  const dialog = document.querySelector("#life-archive-dialog");
  const openButton = document.querySelector("#settings-export-pdf");
  const form = document.querySelector("#life-archive-form");
  if (!dialog || !openButton || !form || openButton.dataset.bound === "true") return;
  openButton.dataset.bound = "true";
  const errorNode = dialog.querySelector("#archive-error");
  const progress = dialog.querySelector("#archive-progress");
  const fill = dialog.querySelector("#archive-progress-fill");
  const progressText = dialog.querySelector("#archive-progress-text");
  const submit = dialog.querySelector("#create-life-archive");
  const customRange = dialog.querySelector("#archive-custom-range");
  const photos = dialog.querySelector('input[value="photos"]');
  const footprints = dialog.querySelector('input[value="footprints"]');
  const setProgress = (percent, message) => { progress.hidden = false; fill.style.width = `${percent}%`; progressText.textContent = message; };
  openButton.addEventListener("click", () => { errorNode.textContent = ""; progress.hidden = true; dialog.showModal(); });
  dialog.querySelectorAll("[data-close='life-archive-dialog']").forEach((button) => button.addEventListener("click", () => { if (!submit.disabled) dialog.close(); }));
  dialog.querySelectorAll('input[name="archive-range"]').forEach((input) => input.addEventListener("change", () => { customRange.hidden = input.value !== "custom" || !input.checked; }));
  footprints.addEventListener("change", () => { photos.disabled = !footprints.checked; if (!footprints.checked) photos.checked = false; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); errorNode.textContent = "";
    const range = form.elements["archive-range"].value;
    const include = new Set([...form.querySelectorAll('input[name="archive-content"]:checked')].map((input) => input.value));
    if (!include.size) { errorNode.textContent = "请至少选择一项内容"; return; }
    const options = { range, start: dialog.querySelector("#archive-start-date").value, end: dialog.querySelector("#archive-end-date").value, include };
    try {
      dateBounds(range, options.start, options.end);
      submit.disabled = true; openButton.disabled = true; setProgress(3, "正在安全读取当前账户的数据…");
      const response = await fetch("/api/me/export.json", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message || "无法读取私人数据");
      const exported = await response.json();
      await document.fonts?.ready;
      const pdf = await renderArchive(exported, options, setProgress);
      const filename = `XiaoColour-Life-Archive-${isoDay(new Date())}.pdf`;
      downloadBlob(new Blob([pdf], { type: "application/pdf" }), filename);
      setProgress(100, `${filename} 已生成，共 ${pdf.length >= 1024 * 1024 ? `${(pdf.length / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(pdf.length / 1024)} KB`}`);
      notify?.("PDF 生活档案已生成");
    } catch (error) {
      errorNode.textContent = error.message || "PDF 生成失败，请缩小时间范围后重试";
      progress.hidden = true; notify?.(errorNode.textContent, true);
    } finally { submit.disabled = false; openButton.disabled = false; }
  });
}
