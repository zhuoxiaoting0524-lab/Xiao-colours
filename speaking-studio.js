import { api } from "./auth-client.js";
import { SPEAKING_QUESTIONS, SPEAKING_TOPICS } from "./speaking-question-bank.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let mounted = false;
let auth = null;
let notify = () => {};
let questions = [...SPEAKING_QUESTIONS];
let history = [];
let savedExpressions = [];
let marks = new Map();
let currentQuestion = null;
let currentBlob = null;
let currentAudioId = null;
let currentAudioUrl = null;
let currentFeedback = null;
let currentRetryOf = null;
let mediaRecorder = null;
let mediaStream = null;
let recordChunks = [];
let recordStartedAt = 0;
let recordDuration = 0;
let recordTimer = null;
let mockQuestions = [];
let mockIndex = -1;
let mockResults = [];
let dailyQuestions = [];
let dailyIndex = -1;
let prepTimer = null;

function setStatus(message, error = false) {
  const node = $("#speaking-status");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("is-error", error);
  node.hidden = !message;
}

function switchTab(name) {
  $$("[data-speaking-tab]").forEach((button) => button.classList.toggle("active", button.dataset.speakingTab === name));
  $$("[data-speaking-panel]").forEach((panel) => {
    const active = panel.dataset.speakingPanel === name;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
}

function formatDuration(seconds) {
  const minutes = Math.floor(Number(seconds || 0) / 60);
  const remain = Math.floor(Number(seconds || 0) % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
}

function openRecordingDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("xiaocolour-speaking", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.createObjectStore("recordings", { keyPath: "id" });
      store.createIndex("userId", "userId", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocalRecording(blob, questionId) {
  const db = await openRecordingDb();
  const id = crypto.randomUUID();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("recordings", "readwrite");
    tx.objectStore("recordings").put({ id, userId: auth.user.id, questionId, blob, type: blob.type, durationSeconds: recordDuration, createdAt: new Date().toISOString() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return id;
}

async function deleteLocalRecording(id) {
  if (!id) return;
  const db = await openRecordingDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("recordings", "readwrite");
    tx.objectStore("recordings").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadData() {
  setStatus("正在读取口语学习记录…");
  try {
    const [dashboard, usage, custom, historyData, expressions, markData] = await Promise.all([
      api("/api/me/speaking/dashboard"), api("/api/me/speaking/usage"), api("/api/me/speaking/custom-questions"),
      api("/api/me/speaking/history"), api("/api/me/speaking/expressions"), api("/api/me/speaking/question-marks"),
    ]);
    questions = [...SPEAKING_QUESTIONS, ...(custom.questions || [])];
    history = historyData.answers || [];
    savedExpressions = expressions.expressions || [];
    marks = new Map((markData.marks || []).map((item) => [item.questionId, item]));
    renderDashboard(dashboard, usage);
    renderQuestions();
    renderHistory();
    renderExpressions();
    renderProgress(dashboard.stats || {});
    setStatus("");
  } catch (error) {
    setStatus(error.message || "口语学习数据暂时无法读取。", true);
  }
}

function renderDashboard(data, usageData) {
  const stats = data.stats || {};
  $("#speaking-days").textContent = String(stats.practiceDays || 0);
  $("#speaking-duration").textContent = `${Math.round((stats.durationSeconds || 0) / 60)} 分钟`;
  $("#speaking-review-count").textContent = String(stats.reviewCount || 0);
  $("#speaking-expression-count").textContent = String(stats.pendingExpressions || 0);
  if (data.recent) {
    $("#speaking-recent-title").textContent = data.recent.question_en;
    $("#speaking-recent-meta").textContent = `Part ${data.recent.part} · ${data.recent.topic} · ${formatDuration(data.recent.duration_seconds)}`;
  }
  const usage = usageData.usage || {};
  const holder = $("#speaking-usage");
  holder.querySelector("strong").textContent = `${usage.estimatedNeurons || 0} / ${usage.limit || 8000}`;
  holder.querySelector("i").style.width = `${Math.min(100, ((usage.estimatedNeurons || 0) / (usage.limit || 8000)) * 100)}%`;
  holder.querySelector("em").textContent = usage.blocked ? "今日 AI 请求已停止 · UTC 00:00 重置" : "本应用估算值 · UTC 00:00 重置";
}

function renderQuestions() {
  const part = $("#speaking-part-filter").value;
  const topic = $("#speaking-topic-filter").value;
  const search = $("#speaking-question-search").value.trim().toLowerCase();
  const used = new Set(history.map((item) => item.questionId));
  const filtered = questions.filter((question) => (part === "all" || String(question.part) === part)
    && (topic === "all" || question.topic === topic)
    && (!search || `${question.questionEn} ${question.questionZh} ${question.topic}`.toLowerCase().includes(search)));
  $("#speaking-bank-summary").textContent = `${filtered.length} 道题 · ${questions.filter((q) => !used.has(q.id)).length} 道尚未练习 · 题目为 XiaoColour 原创练习内容，非官方当季真题`;
  const list = $("#speaking-question-list");
  list.replaceChildren(...filtered.map((question) => {
    const item = document.createElement("article");
    item.className = "speaking-question-item";
    const mark = marks.get(question.id) || {};
    item.innerHTML = `<header><span>Part ${question.part} · ${question.topic}</span><span>${used.has(question.id) ? "已练习" : question.difficulty}</span></header><h3></h3><p></p>${question.cuePoints?.length ? `<ul>${question.cuePoints.map((point) => `<li>${point}</li>`).join("")}</ul>` : ""}<div><button type="button" data-action="practice">开始回答</button><button type="button" data-action="favorite" aria-pressed="${Boolean(mark.favorite)}">${mark.favorite ? "★ 已收藏" : "☆ 收藏"}</button><button type="button" data-action="review" aria-pressed="${Boolean(mark.needsReview)}">${mark.needsReview ? "✓ 待复习" : "标记复习"}</button></div>`;
    item.querySelector("h3").textContent = question.questionEn;
    item.querySelector("p").textContent = question.questionZh;
    item.querySelector("[data-action='practice']").addEventListener("click", () => startQuestion(question));
    item.querySelector("[data-action='favorite']").addEventListener("click", () => toggleMark(question.id, "favorite"));
    item.querySelector("[data-action='review']").addEventListener("click", () => toggleMark(question.id, "needsReview"));
    return item;
  }));
}

async function toggleMark(questionId, field) {
  const current = marks.get(questionId) || { questionId, favorite: false, needsReview: false };
  const next = { ...current, [field]: !current[field] };
  try {
    await api("/api/me/speaking/question-marks", { method: "PUT", csrfToken: auth.csrfToken, body: next });
    marks.set(questionId, next);
    renderQuestions();
  } catch (error) { notify(error.message, true); }
}

function startQuestion(question, { mode = "topic", progress = "练习模式", retryOf = null } = {}) {
  currentQuestion = question;
  currentRetryOf = retryOf;
  resetRecording({ removeStored: false });
  $("#speaking-practice-part").textContent = `Part ${question.part}`;
  $("#speaking-practice-topic").textContent = question.topic;
  $("#speaking-practice-progress").textContent = progress;
  $("#speaking-question-en").textContent = question.questionEn;
  $("#speaking-question-zh").textContent = mode === "mock" ? "考试模式不显示中文翻译" : question.questionZh;
  const cue = $("#speaking-cue-points");
  cue.replaceChildren(...(question.cuePoints || []).map((point) => { const li = document.createElement("li"); li.textContent = point; return li; }));
  cue.hidden = !question.cuePoints?.length;
  const mockNote = $("#speaking-mock-note");
  mockNote.hidden = !(mode === "mock" && question.part === 2);
  if (!mockNote.hidden) startPrepCountdown();
  switchTab("practice");
}

function chooseDaily() {
  const used = new Set(history.map((item) => item.questionId));
  const pool = questions.filter((question) => !used.has(question.id));
  dailyQuestions = [...(pool.length ? pool : questions)].sort(() => Math.random() - .5).slice(0, 3);
  dailyIndex = 0;
  mockIndex = -1;
  startQuestion(dailyQuestions[0], { mode: "daily", progress: `Daily Speaking · 1 / ${dailyQuestions.length}` });
}

function nextDailyQuestion() {
  if (dailyIndex < 0 || dailyIndex >= dailyQuestions.length - 1) { dailyIndex = -1; switchTab("progress"); notify("今日口语练习已完成"); return; }
  dailyIndex += 1;
  startQuestion(dailyQuestions[dailyIndex], { mode: "daily", progress: `Daily Speaking · ${dailyIndex + 1} / ${dailyQuestions.length}` });
}

function startMock() {
  const topic = SPEAKING_TOPICS[Math.floor(Math.random() * SPEAKING_TOPICS.length)].key;
  const sample = (part, count) => questions.filter((q) => q.part === part && (part === 1 || q.topic === topic)).sort(() => Math.random() - .5).slice(0, count);
  mockQuestions = [...sample(1, 4), ...sample(2, 1), ...sample(3, 4)];
  mockResults = [];
  dailyIndex = -1;
  mockIndex = 0;
  startQuestion(mockQuestions[0], { mode: "mock", progress: `Full Mock · 1 / ${mockQuestions.length}` });
}

function nextMockQuestion() {
  if (mockIndex < 0 || mockIndex >= mockQuestions.length - 1) { renderMockSummary(); return; }
  mockIndex += 1;
  startQuestion(mockQuestions[mockIndex], { mode: "mock", progress: `Full Mock · ${mockIndex + 1} / ${mockQuestions.length}` });
}

function startPrepCountdown() {
  clearInterval(prepTimer);
  let remaining = 60;
  $("#speaking-mock-timer").textContent = "01:00";
  prepTimer = setInterval(() => {
    remaining -= 1;
    $("#speaking-mock-timer").textContent = formatDuration(remaining);
    if (remaining <= 0) { clearInterval(prepTimer); $("#speaking-recorder-message").textContent = "准备时间结束，可以开始 2 分钟连续陈述。"; }
  }, 1_000);
}

function preferredMimeType() {
  return ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

async function startRecording() {
  if (!currentQuestion) return notify("请先选择一道题目", true);
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return notify("当前浏览器不支持录音，请使用最新版 Safari、Chrome 或 Edge。", true);
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    const mimeType = preferredMimeType();
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
    recordChunks = [];
    mediaRecorder.ondataavailable = (event) => { if (event.data?.size) recordChunks.push(event.data); };
    mediaRecorder.onstop = finishRecording;
    mediaRecorder.start(500);
    recordStartedAt = Date.now();
    $("#speaking-record-dot").classList.add("active");
    $("#speaking-record-state").textContent = "正在录音";
    $("#speaking-record-start").disabled = true;
    $("#speaking-record-stop").disabled = false;
    recordTimer = setInterval(() => {
      recordDuration = Math.floor((Date.now() - recordStartedAt) / 1_000);
      $("#speaking-record-time").textContent = formatDuration(recordDuration);
      if (recordDuration >= (currentQuestion.part === 2 ? 120 : 180)) stopRecording();
    }, 250);
  } catch (error) {
    const denied = error.name === "NotAllowedError" || error.name === "SecurityError";
    notify(denied ? "麦克风权限被拒绝。请在浏览器设置中允许 XiaoColour 使用麦克风。" : "无法开始录音，请检查麦克风。", true);
  }
}

function stopRecording() {
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
}

async function finishRecording() {
  clearInterval(recordTimer);
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  recordDuration = Math.max(1, Math.floor((Date.now() - recordStartedAt) / 1_000));
  currentBlob = new Blob(recordChunks, { type: mediaRecorder.mimeType || "audio/webm" });
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = URL.createObjectURL(currentBlob);
  const audio = $("#speaking-audio");
  audio.src = currentAudioUrl; audio.hidden = false;
  $("#speaking-record-dot").classList.remove("active");
  $("#speaking-record-state").textContent = "录音已保存在本机";
  $("#speaking-record-time").textContent = formatDuration(recordDuration);
  $("#speaking-record-stop").disabled = true;
  $("#speaking-record-reset").disabled = false;
  $("#speaking-download-audio").disabled = false;
  $("#speaking-submit-ai").disabled = false;
  try { currentAudioId = await saveLocalRecording(currentBlob, currentQuestion.id); }
  catch { $("#speaking-recorder-message").textContent = "录音可回听，但浏览器本地保存失败；请先导出备份。"; }
}

async function resetRecording({ removeStored = true } = {}) {
  clearInterval(recordTimer);
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null; mediaRecorder = null; recordChunks = []; recordDuration = 0;
  if (removeStored && currentAudioId) await deleteLocalRecording(currentAudioId).catch(() => {});
  currentAudioId = null; currentBlob = null;
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = null;
  const audio = $("#speaking-audio"); if (audio) { audio.removeAttribute("src"); audio.hidden = true; }
  if ($("#speaking-record-time")) $("#speaking-record-time").textContent = "00:00";
  if ($("#speaking-record-state")) $("#speaking-record-state").textContent = "准备录音";
  $("#speaking-record-dot")?.classList.remove("active");
  if ($("#speaking-record-start")) $("#speaking-record-start").disabled = false;
  if ($("#speaking-record-stop")) $("#speaking-record-stop").disabled = true;
  if ($("#speaking-record-reset")) $("#speaking-record-reset").disabled = true;
  if ($("#speaking-download-audio")) $("#speaking-download-audio").disabled = true;
  if ($("#speaking-submit-ai")) $("#speaking-submit-ai").disabled = true;
}

function downloadRecording() {
  if (!currentBlob) return;
  const link = document.createElement("a");
  link.href = currentAudioUrl;
  link.download = `XiaoColour-Speaking-${currentQuestion.id}-${new Date().toISOString().slice(0,10)}.${currentBlob.type.includes("mp4") ? "m4a" : currentBlob.type.includes("ogg") ? "ogg" : "webm"}`;
  link.click();
}

async function submitAudio() {
  if (!currentBlob || !currentQuestion) return;
  const button = $("#speaking-submit-ai");
  button.disabled = true; button.textContent = "正在转写与批改…";
  $("#speaking-recorder-message").textContent = "音频正在临时发送给 Cloudflare Workers AI；不会永久保存在服务器。";
  const form = new FormData();
  form.append("audio", currentBlob, `answer.${currentBlob.type.includes("mp4") ? "m4a" : "webm"}`);
  form.append("questionId", currentQuestion.id); form.append("durationSeconds", String(recordDuration));
  if (currentAudioId) form.append("audioLocalId", currentAudioId);
  if (currentRetryOf) form.append("retryOf", currentRetryOf);
  try {
    const response = await fetch("/api/me/speaking/analyse-audio", { method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": auth.csrfToken }, body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    currentFeedback = { ...data.result, question: currentQuestion, retryOf: currentRetryOf };
    if (mockIndex >= 0) {
      mockResults.push(currentFeedback);
      if (mockIndex < mockQuestions.length - 1) nextMockQuestion();
      else renderMockSummary();
    } else {
      renderFeedback();
      switchTab("feedback");
    }
    await loadData();
  } catch (error) {
    $("#speaking-recorder-message").textContent = error.message || "提交失败，本地录音仍然保留。";
    notify(error.message || "提交失败，本地录音仍然保留。", true);
  } finally { button.disabled = false; button.textContent = "提交 AI 批改"; }
}

function renderFeedback() {
  if (!currentFeedback) return;
  $("#speaking-feedback-empty").hidden = true;
  $("#speaking-feedback").hidden = false;
  $("#speaking-transcript").textContent = currentFeedback.transcript;
  const report = currentFeedback.feedback;
  const fillItems = (selector, items, left, right) => {
    const node = $(selector);
    const fallback = { original: "没有发现需要优先修改的内容", explanationZh: "继续保持自然、清晰的表达。" };
    fallback[right] = "";
    node.replaceChildren(...(items.length ? items : [fallback]).map((item) => {
      const div = document.createElement("div"); div.className = "speaking-feedback-item";
      div.innerHTML = `<div><del></del> <strong></strong></div><p></p>`;
      div.querySelector("del").textContent = item[left]; div.querySelector("strong").textContent = item[right]; div.querySelector("p").textContent = item.explanationZh;
      return div;
    }));
  };
  fillItems("#speaking-grammar", report.grammar || [], "original", "correction");
  fillItems("#speaking-vocabulary", report.vocabulary || [], "original", "suggestion");
  const content = report.content || {};
  $("#speaking-content").textContent = `${content.addressedQuestion ? "✓" : "○"} 回答题目　${content.clearOpinion ? "✓" : "○"} 观点清晰　${content.hasReason ? "✓" : "○"} 有原因　${content.hasExample ? "✓" : "○"} 有例子　${content.sufficient ? "✓" : "○"} 内容充分\n${content.explanationZh || ""}`;
  $("#speaking-improved").textContent = report.improvedAnswer;
  $("#speaking-priorities").replaceChildren(...(report.priorities || []).map((text) => { const li = document.createElement("li"); li.textContent = text; return li; }));
  renderComparison(currentFeedback);
  let next = $("#speaking-feedback-next");
  if (mockIndex >= 0) {
    if (!next) { next = document.createElement("button"); next.id = "speaking-feedback-next"; next.className = "primary"; $("#speaking-feedback").append(next); }
    next.onclick = nextMockQuestion;
    next.textContent = mockIndex < mockQuestions.length - 1 ? "继续下一题" : "完成模拟考试"; next.hidden = false;
  } else if (dailyIndex >= 0) {
    if (!next) { next = document.createElement("button"); next.id = "speaking-feedback-next"; next.className = "primary"; $("#speaking-feedback").append(next); }
    next.onclick = nextDailyQuestion;
    next.textContent = dailyIndex < dailyQuestions.length - 1 ? "继续下一题" : "完成今日练习";
    next.hidden = false;
  } else if (next) next.hidden = true;
}

function renderComparison(feedback) {
  const panel = $("#speaking-comparison");
  const current = history.find((item) => item.id === feedback.answerId);
  const retryOf = feedback.retryOf || current?.retryOf;
  const previous = history.find((item) => item.id === retryOf);
  panel.hidden = !previous;
  if (!previous) return;
  $("#speaking-previous-answer").textContent = previous.correctedTranscript || previous.transcript;
  $("#speaking-current-answer").textContent = feedback.transcript;
}

function renderMockSummary() {
  if (!mockResults.length) return;
  const grammar = mockResults.flatMap((item) => item.feedback.grammar || []);
  const vocabulary = mockResults.flatMap((item) => item.feedback.vocabulary || []);
  const priorities = [...new Set(mockResults.flatMap((item) => item.feedback.priorities || []))].slice(0, 3);
  const improvedAnswer = mockResults.map((item, index) => `${index + 1}. ${item.question.questionEn}\n${item.feedback.improvedAnswer}`).join("\n\n");
  const transcript = mockResults.map((item, index) => `${index + 1}. ${item.question.questionEn}\n${item.transcript}`).join("\n\n");
  currentFeedback = { answerId: mockResults.at(-1).answerId, transcript, question: mockResults.at(-1).question, feedback: { grammar, vocabulary, priorities, improvedAnswer, content: { addressedQuestion: true, clearOpinion: true, hasReason: true, hasExample: true, sufficient: true, explanationZh: `本次模拟共完成 ${mockResults.length} 道真实回答；以上内容由各题报告合并，不提供官方分数。` } } };
  mockIndex = -1;
  renderFeedback();
  switchTab("feedback");
  notify("完整模拟已完成，分题记录和汇总报告已生成");
}

async function correctTranscript() {
  if (!currentFeedback) return;
  const corrected = prompt("修正明显的语音识别错误后重新分析：", currentFeedback.transcript);
  if (!corrected || corrected.trim() === currentFeedback.transcript) return;
  try {
    setStatus("正在根据修正后的转写重新分析…");
    const data = await api("/api/me/speaking/analyse-text", { method: "POST", csrfToken: auth.csrfToken, body: { questionId: currentQuestion.id, transcript: corrected.trim(), durationSeconds: recordDuration, audioLocalId: currentAudioId, retryOf: currentFeedback.answerId } });
    currentFeedback = { ...data.result, question: currentQuestion, retryOf: currentFeedback.answerId }; renderFeedback(); setStatus(""); await loadData();
  } catch (error) { setStatus(error.message, true); }
}

async function saveImprovedExpression() {
  if (!currentFeedback?.feedback?.improvedAnswer) return;
  try {
    await api("/api/me/speaking/expressions", { method: "POST", csrfToken: auth.csrfToken, body: { expressionEn: currentFeedback.feedback.improvedAnswer, explanationZh: "由本次回答整理的自然表达，可按需拆分复习。", topic: currentQuestion.topic, sourceQuestionId: currentQuestion.id } });
    notify("已加入个人语料库"); await loadData(); switchTab("library");
  } catch (error) { notify(error.message, true); }
}

function renderExpressions() {
  const search = $("#speaking-expression-search")?.value.trim().toLowerCase() || "";
  const expressions = savedExpressions.filter((item) => !search || `${item.expressionEn} ${item.explanationZh} ${item.topic}`.toLowerCase().includes(search));
  const list = $("#speaking-expression-list");
  if (!expressions.length) { list.innerHTML = '<div class="speaking-feedback-empty"><h3>还没有收藏表达</h3><p>可以从批改报告中保存适合自己的英文表达。</p></div>'; return; }
  list.replaceChildren(...expressions.map((item) => {
    const card = document.createElement("article"); card.className = "speaking-expression-card";
    card.innerHTML = `<div><strong></strong><p></p></div><div class="speaking-history-actions"><button type="button" data-action="copy">复制</button><button type="button" data-action="review"></button><button type="button" data-action="delete">删除</button></div>`;
    card.querySelector("strong").textContent = item.expressionEn; card.querySelector("p").textContent = `${item.topic} · ${item.explanationZh}`;
    card.querySelector('[data-action="copy"]').addEventListener("click", async () => { await navigator.clipboard.writeText(item.expressionEn); notify("表达已复制"); });
    const review = card.querySelector('[data-action="review"]');
    review.textContent = item.reviewStatus === "reviewed" ? "已复习" : item.reviewStatus === "learning" ? "学习中" : "待学习";
    review.addEventListener("click", async () => { const next = item.reviewStatus === "new" ? "learning" : item.reviewStatus === "learning" ? "reviewed" : "new"; await api(`/api/me/speaking/expressions/${encodeURIComponent(item.id)}`, { method: "PATCH", csrfToken: auth.csrfToken, body: { reviewStatus: next } }); await loadData(); });
    card.querySelector('[data-action="delete"]').addEventListener("click", async () => { if (!confirm("删除这条个人语料吗？")) return; await api(`/api/me/speaking/expressions/${encodeURIComponent(item.id)}`, { method: "DELETE", csrfToken: auth.csrfToken }); await loadData(); });
    return card;
  }));
}

function renderHistory() {
  const list = $("#speaking-history-list");
  if (!history.length) { list.innerHTML = '<div class="speaking-feedback-empty"><h3>还没有练习记录</h3><p>完成第一次真实回答后，历史记录会保存在这里。</p></div>'; return; }
  list.replaceChildren(...history.map((item) => {
    const card = document.createElement("article"); card.className = "speaking-history-card";
    card.innerHTML = `<div><strong></strong><p></p></div><div class="speaking-history-actions"><button type="button" data-action="view">查看报告</button><button type="button" data-action="retry">再次练习</button><button type="button" data-action="delete">删除</button></div>`;
    card.querySelector("strong").textContent = item.questionEn; card.querySelector("p").textContent = `Part ${item.part} · ${item.topic} · ${new Date(item.createdAt).toLocaleString("zh-CN")} · ${formatDuration(item.durationSeconds)}`;
    const question = questions.find((q) => q.id === item.questionId) || { id: item.questionId, part: item.part, topic: item.topic, questionEn: item.questionEn, questionZh: "" };
    card.querySelector('[data-action="view"]').addEventListener("click", () => { currentQuestion = question; currentFeedback = { answerId: item.id, transcript: item.correctedTranscript || item.transcript, feedback: item.report, question: currentQuestion }; renderFeedback(); switchTab("feedback"); });
    card.querySelector('[data-action="retry"]').addEventListener("click", () => startQuestion(question, { progress: "再次回答", retryOf: item.id }));
    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm("删除这条练习记录吗？本机保存的对应录音也会删除。")) return;
      const result = await api(`/api/me/speaking/answers/${encodeURIComponent(item.id)}`, { method: "DELETE", csrfToken: auth.csrfToken });
      if (result.audioLocalId) await deleteLocalRecording(result.audioLocalId).catch(() => {});
      await loadData();
      notify("练习记录已删除");
    });
    return card;
  }));
}

function renderProgress(stats) {
  const summary = $("#speaking-progress-summary");
  const values = [["累计练习", stats.practiceCount || 0], ["累计时长", `${Math.round((stats.durationSeconds || 0) / 60)} 分钟`], ["已练题目", stats.completedQuestions || 0], ["同题重练", stats.retryCount || 0]];
  summary.replaceChildren(...values.map(([label, value]) => { const card = document.createElement("article"); card.innerHTML = `<small></small><strong></strong>`; card.querySelector("small").textContent = label; card.querySelector("strong").textContent = value; return card; }));
  const buckets = new Map();
  const rules = [["时态", /时态|过去式|现在时|future|tense/i], ["冠词", /冠词|\ba\b|\ban\b|\bthe\b/i], ["单复数", /单复数|复数|plural/i], ["介词", /介词|preposition/i], ["句子结构", /句子|从句|语序|structure/i]];
  history.flatMap((item) => item.report?.grammar || []).forEach((error) => { const text = `${error.explanationZh || ""} ${error.correction || ""}`; const label = rules.find(([, pattern]) => pattern.test(text))?.[0] || "其他语法"; buckets.set(label, (buckets.get(label) || 0) + 1); });
  const list = [...buckets.entries()].sort((a,b) => b[1] - a[1]).slice(0, 5);
  $("#speaking-error-list").replaceChildren(...(list.length ? list.map(([label,count]) => { const p = document.createElement("p"); p.textContent = `${label} · ${count} 次真实批改记录`; return p; }) : [Object.assign(document.createElement("p"), { textContent: "完成练习后，将根据真实批改记录汇总。" })]));
}

async function addCustomQuestion() {
  const questionEn = prompt("输入英文口语题目："); if (!questionEn?.trim()) return;
  const part = Number(prompt("输入 Part：1、2 或 3", "1")); if (![1,2,3].includes(part)) return notify("Part 必须是 1、2 或 3", true);
  const topic = prompt("输入话题分类：", "Custom") || "Custom";
  const questionZh = prompt("输入中文翻译（可选）：", "") || "";
  try { await api("/api/me/speaking/custom-questions", { method: "POST", csrfToken: auth.csrfToken, body: { part, topic, questionEn, questionZh } }); await loadData(); notify("自定义题目已保存"); }
  catch (error) { notify(error.message, true); }
}

function speakQuestion() {
  if (!currentQuestion || !window.speechSynthesis) return notify("当前浏览器不支持题目朗读", true);
  speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(currentQuestion.questionEn); utterance.lang = "en-GB"; utterance.rate = .92; speechSynthesis.speak(utterance);
}

function setupEvents() {
  $$("[data-speaking-tab]").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.speakingTab)));
  $$("[data-speaking-tab-target]").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.speakingTabTarget)));
  $$("[data-speaking-start]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.speakingStart === "daily") chooseDaily();
    else if (button.dataset.speakingStart === "topic") switchTab("questions");
    else startMock();
  }));
  $("#speaking-part-filter").addEventListener("change", renderQuestions); $("#speaking-topic-filter").addEventListener("change", renderQuestions); $("#speaking-question-search").addEventListener("input", renderQuestions);
  $("#speaking-random-question").addEventListener("click", () => startQuestion(questions[Math.floor(Math.random() * questions.length)]));
  $("#speaking-add-question").addEventListener("click", addCustomQuestion);
  $("#speaking-read-question").addEventListener("click", speakQuestion);
  $("#speaking-record-start").addEventListener("click", startRecording); $("#speaking-record-stop").addEventListener("click", stopRecording); $("#speaking-record-reset").addEventListener("click", () => resetRecording());
  $("#speaking-download-audio").addEventListener("click", downloadRecording); $("#speaking-submit-ai").addEventListener("click", submitAudio);
  $("#speaking-edit-transcript").addEventListener("click", correctTranscript); $("#speaking-save-expression").addEventListener("click", saveImprovedExpression);
  $("#speaking-retry-question").addEventListener("click", () => startQuestion(currentQuestion, { mode: "topic", progress: "再次回答", retryOf: currentFeedback?.answerId || null }));
  $("#speaking-expression-search").addEventListener("input", renderExpressions);
  window.addEventListener("beforeunload", (event) => { if (mediaRecorder?.state === "recording") { event.preventDefault(); event.returnValue = ""; } });
}

export async function mountSpeakingStudio(authState, options = {}) {
  auth = authState; notify = options.notify || notify;
  if (!mounted) {
    mounted = true;
    const topicSelect = $("#speaking-topic-filter");
    SPEAKING_TOPICS.forEach((topic) => { const option = document.createElement("option"); option.value = topic.key; option.textContent = `${topic.zh} · ${topic.key}`; topicSelect.append(option); });
    setupEvents();
  }
  await loadData();
}
