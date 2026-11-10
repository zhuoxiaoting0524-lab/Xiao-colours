import { nowIso, randomToken } from "./crypto-util.js";
import { requireDb } from "./db.js";
import { assertSameOrigin, errorJson, json, readJsonBody } from "./http.js";
import { assertCsrf, loadSession } from "./sessions.js";
import { SPEAKING_QUESTIONS } from "../speaking-question-bank.js";

const DEFAULT_DAILY_LIMIT = 8_000;
const REQUEST_RESERVATION = 200;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const AUDIO_TYPES = new Set(["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg", "audio/x-m4a"]);
const TEXT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const SPEECH_MODEL = "@cf/openai/whisper";

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

async function requireSession(db, request, { csrf = false } = {}) {
  const session = await loadSession(db, request);
  if (!session) {
    const error = new Error("未登录");
    error.code = "unauthorized";
    error.status = 401;
    throw error;
  }
  if (csrf && request.method !== "GET" && request.method !== "HEAD") {
    assertSameOrigin(request);
    assertCsrf(request, session);
  }
  return session;
}

function dailyLimit(env) {
  const configured = Number(env.SPEAKING_AI_DAILY_LIMIT || DEFAULT_DAILY_LIMIT);
  return Number.isFinite(configured) ? Math.max(0, Math.min(8_000, Math.floor(configured))) : DEFAULT_DAILY_LIMIT;
}

function parseJsonObject(raw) {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(text);
}

function cleanString(value, max = 2_000) {
  return String(value || "").trim().slice(0, max);
}

function cleanList(value, mapper, max = 12) {
  return Array.isArray(value) ? value.slice(0, max).map(mapper).filter(Boolean) : [];
}

export function validateFeedbackReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI 报告不是对象");
  const grammar = cleanList(value.grammar, (item) => {
    if (!item || typeof item !== "object") return null;
    const original = cleanString(item.original, 300);
    const correction = cleanString(item.correction, 300);
    const explanationZh = cleanString(item.explanationZh, 600);
    return original && correction && explanationZh ? { original, correction, explanationZh } : null;
  });
  const vocabulary = cleanList(value.vocabulary, (item) => {
    if (!item || typeof item !== "object") return null;
    const original = cleanString(item.original, 300);
    const suggestion = cleanString(item.suggestion, 300);
    const explanationZh = cleanString(item.explanationZh, 600);
    return original && suggestion && explanationZh ? { original, suggestion, explanationZh } : null;
  });
  const content = value.content && typeof value.content === "object" ? {
    addressedQuestion: Boolean(value.content.addressedQuestion),
    clearOpinion: Boolean(value.content.clearOpinion),
    hasReason: Boolean(value.content.hasReason),
    hasExample: Boolean(value.content.hasExample),
    sufficient: Boolean(value.content.sufficient),
    explanationZh: cleanString(value.content.explanationZh, 1_000),
  } : { addressedQuestion: false, clearOpinion: false, hasReason: false, hasExample: false, sufficient: false, explanationZh: "" };
  const improvedAnswer = cleanString(value.improvedAnswer, 3_000);
  const priorities = cleanList(value.priorities, (item) => cleanString(item, 500), 3);
  if (!improvedAnswer || !priorities.length) throw new Error("AI 报告缺少参考回答或改进建议");
  return { grammar, vocabulary, content, improvedAnswer, priorities };
}

function feedbackPrompt({ question, transcript }) {
  return `You are a careful IELTS speaking language coach. Analyse only the learner's actual transcript. Do not invent words they did not say. Do not give an official IELTS score or assess pronunciation, stress, or intonation from text. Keep the improved answer natural and close to the learner's meaning. Return JSON only, using exactly this shape:\n{"grammar":[{"original":"exact quote","correction":"...","explanationZh":"中文解释"}],"vocabulary":[{"original":"exact quote","suggestion":"...","explanationZh":"中文解释"}],"content":{"addressedQuestion":true,"clearOpinion":true,"hasReason":true,"hasExample":false,"sufficient":true,"explanationZh":"中文分析"},"improvedAnswer":"natural English answer","priorities":["中文建议1","中文建议2"]}\nQuestion: ${question}\nTranscript: ${transcript}`;
}

function estimatedTextNeurons(input, output) {
  const inputTokens = Math.ceil(String(input).length / 4);
  const outputTokens = Math.ceil(String(output).length / 4);
  return Math.max(1, Math.ceil((inputTokens * 9_091 + outputTokens * 27_273) / 1_000_000));
}

function estimatedAudioNeurons(durationSeconds) {
  return Math.max(1, Math.ceil((Math.max(1, durationSeconds) / 60) * 41.14));
}

async function usageRow(db, userId) {
  const date = utcDate();
  return (await db.prepare(
    `SELECT usage_date_utc, estimated_neurons, request_count, blocked, last_error_code, updated_at
     FROM speaking_daily_usage WHERE user_id = ? AND usage_date_utc = ?`,
  ).bind(userId, date).first()) || {
    usage_date_utc: date, estimated_neurons: 0, request_count: 0, blocked: 0, last_error_code: null, updated_at: null,
  };
}

async function reserveUsage(db, userId, limit) {
  const date = utcDate();
  const updatedAt = nowIso();
  await db.prepare(
    `INSERT OR IGNORE INTO speaking_daily_usage
      (user_id, usage_date_utc, estimated_neurons, request_count, blocked, updated_at)
     VALUES (?, ?, 0, 0, 0, ?)`,
  ).bind(userId, date, updatedAt).run();
  const result = await db.prepare(
    `UPDATE speaking_daily_usage
     SET estimated_neurons = estimated_neurons + ?, request_count = request_count + 1, updated_at = ?
     WHERE user_id = ? AND usage_date_utc = ? AND blocked = 0 AND estimated_neurons + ? <= ?`,
  ).bind(REQUEST_RESERVATION, updatedAt, userId, date, REQUEST_RESERVATION, limit).run();
  if (!result.meta?.changes) {
    const error = new Error("今日 AI 免费保护额度已用完；题库、历史和本地录音仍可使用。");
    error.code = "ai_daily_limit";
    error.status = 429;
    throw error;
  }
}

async function reconcileUsage(db, userId, actual) {
  const delta = Math.max(-REQUEST_RESERVATION, Math.ceil(actual) - REQUEST_RESERVATION);
  await db.prepare(
    `UPDATE speaking_daily_usage SET estimated_neurons = MAX(0, estimated_neurons + ?), updated_at = ?
     WHERE user_id = ? AND usage_date_utc = ?`,
  ).bind(delta, nowIso(), userId, utcDate()).run();
}

function quotaFailure(error) {
  const value = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();
  return value.includes("quota") || value.includes("daily limit") || value.includes("neurons exceeded");
}

async function blockUsage(db, userId, code) {
  await db.prepare(
    `UPDATE speaking_daily_usage SET blocked = 1, last_error_code = ?, updated_at = ?
     WHERE user_id = ? AND usage_date_utc = ?`,
  ).bind(cleanString(code, 120) || "cloudflare_quota", nowIso(), userId, utcDate()).run();
}

async function lookupQuestion(db, userId, id) {
  const builtIn = SPEAKING_QUESTIONS.find((question) => question.id === id);
  if (builtIn) return builtIn;
  const row = await db.prepare(
    `SELECT id, part, topic, question_en, question_zh, cue_points_json, difficulty, created_at, updated_at
     FROM speaking_custom_questions WHERE id = ? AND user_id = ?`,
  ).bind(id, userId).first();
  if (!row) return null;
  return {
    id: row.id, part: row.part, topic: row.topic, topicZh: row.topic, questionEn: row.question_en,
    questionZh: row.question_zh, cuePoints: JSON.parse(row.cue_points_json || "[]"), difficulty: row.difficulty,
    sourceType: "Custom", createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function runTextFeedback(env, question, transcript) {
  const prompt = feedbackPrompt({ question, transcript });
  const response = await env.AI.run(TEXT_MODEL, {
    messages: [
      { role: "system", content: "Return valid JSON only. Follow the user's evidence and safety constraints exactly." },
      { role: "user", content: prompt },
    ],
    max_completion_tokens: 1_100,
    temperature: 0.2,
    response_format: { type: "json_object" },
  });
  const raw = response?.response ?? response?.result?.response ?? response;
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  return { report: validateFeedbackReport(parseJsonObject(text)), rawText: text, prompt };
}

async function persistAnswer(db, userId, { question, transcript, durationSeconds, audioLocalId, retryOf, report }) {
  const answerId = randomToken(12);
  const feedbackId = randomToken(12);
  const timestamp = nowIso();
  await db.batch([
    db.prepare(
      `INSERT INTO speaking_answers
       (id, user_id, question_id, part, topic, question_en, transcript, corrected_transcript, audio_local_id, duration_seconds, retry_of, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(answerId, userId, question.id, question.part, question.topic, question.questionEn, transcript, transcript, audioLocalId || null, durationSeconds, retryOf || null, timestamp, timestamp),
    db.prepare(
      `INSERT INTO speaking_feedback (id, answer_id, user_id, report_json, model_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(feedbackId, answerId, userId, JSON.stringify(report), TEXT_MODEL, timestamp),
  ]);
  return answerId;
}

async function analyseTranscript({ db, env, session, question, transcript, durationSeconds = 0, audioLocalId = null, retryOf = null, audioNeurons = 0 }) {
  if (!env.AI) {
    const error = new Error("Cloudflare Workers AI 尚未绑定；本地录音与题库仍可使用。");
    error.code = "ai_unavailable";
    error.status = 503;
    throw error;
  }
  const result = await runTextFeedback(env, question.questionEn, transcript);
  const estimate = audioNeurons + estimatedTextNeurons(result.prompt, result.rawText);
  const answerId = await persistAnswer(db, session.user.id, { question, transcript, durationSeconds, audioLocalId, retryOf, report: result.report });
  await reconcileUsage(db, session.user.id, estimate);
  return { answerId, transcript, feedback: result.report, models: { speech: audioNeurons ? SPEECH_MODEL : null, feedback: TEXT_MODEL }, estimatedNeurons: estimate };
}

export async function handleSpeakingApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/me/speaking")) return null;
  const db = requireDb(env);

  try {
    const session = await requireSession(db, request, { csrf: request.method !== "GET" && request.method !== "HEAD" });
    const userId = session.user.id;
    const limit = dailyLimit(env);

    if (path === "/api/me/speaking/usage" && request.method === "GET") {
      const usage = await usageRow(db, userId);
      return json({ ok: true, usage: { dateUtc: usage.usage_date_utc, estimatedNeurons: usage.estimated_neurons, requestCount: usage.request_count, blocked: Boolean(usage.blocked), limit, resetAtUtc: `${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`, estimateOnly: true } });
    }

    if (path === "/api/me/speaking/dashboard" && request.method === "GET") {
      const [stats, totals, recent, expressions, reviews] = await Promise.all([
        db.prepare(`SELECT COUNT(*) practice_count, COALESCE(SUM(duration_seconds),0) duration_seconds, COUNT(DISTINCT substr(created_at,1,10)) practice_days FROM speaking_answers WHERE user_id = ? AND created_at >= datetime('now','-7 days')`).bind(userId).first(),
        db.prepare(`SELECT COUNT(*) practice_count, COALESCE(SUM(duration_seconds),0) duration_seconds, COUNT(DISTINCT question_id) completed_questions, SUM(CASE WHEN retry_of IS NOT NULL THEN 1 ELSE 0 END) retry_count FROM speaking_answers WHERE user_id = ?`).bind(userId).first(),
        db.prepare(`SELECT a.id, a.question_en, a.topic, a.part, a.duration_seconds, a.created_at FROM speaking_answers a WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 1`).bind(userId).first(),
        db.prepare(`SELECT COUNT(*) count FROM speaking_saved_expressions WHERE user_id = ? AND review_status != 'reviewed'`).bind(userId).first(),
        db.prepare(`SELECT COUNT(*) count FROM speaking_review_items WHERE user_id = ? AND resolved_at IS NULL`).bind(userId).first(),
      ]);
      return json({ ok: true, stats: { weeklyPracticeCount: stats?.practice_count || 0, practiceDays: stats?.practice_days || 0, weeklyDurationSeconds: stats?.duration_seconds || 0, practiceCount: totals?.practice_count || 0, durationSeconds: totals?.duration_seconds || 0, completedQuestions: totals?.completed_questions || 0, retryCount: totals?.retry_count || 0, pendingExpressions: expressions?.count || 0, reviewCount: reviews?.count || 0 }, recent: recent || null });
    }

    if (path === "/api/me/speaking/history" && request.method === "GET") {
      const rows = await db.prepare(
        `SELECT a.id, a.question_id questionId, a.part, a.topic, a.question_en questionEn, a.transcript, a.corrected_transcript correctedTranscript,
                a.audio_local_id audioLocalId, a.duration_seconds durationSeconds, a.retry_of retryOf, a.created_at createdAt, f.report_json reportJson
         FROM speaking_answers a LEFT JOIN speaking_feedback f ON f.answer_id = a.id AND f.user_id = a.user_id
         WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 100`,
      ).bind(userId).all();
      return json({ ok: true, answers: (rows.results || []).map((row) => ({ ...row, report: row.reportJson ? JSON.parse(row.reportJson) : null, reportJson: undefined })) });
    }

    const answerMatch = path.match(/^\/api\/me\/speaking\/answers\/([^/]+)$/);
    if (answerMatch && request.method === "DELETE") {
      const answerId = decodeURIComponent(answerMatch[1]);
      const owned = await db.prepare(`SELECT audio_local_id audioLocalId FROM speaking_answers WHERE id = ? AND user_id = ?`).bind(answerId, userId).first();
      if (!owned) return errorJson(404, "not_found", "练习记录不存在");
      await db.prepare(`DELETE FROM speaking_answers WHERE id = ? AND user_id = ?`).bind(answerId, userId).run();
      return json({ ok: true, audioLocalId: owned.audioLocalId || null });
    }

    if (path === "/api/me/speaking/custom-questions" && request.method === "GET") {
      const rows = await db.prepare(`SELECT * FROM speaking_custom_questions WHERE user_id = ? ORDER BY created_at DESC`).bind(userId).all();
      return json({ ok: true, questions: (rows.results || []).map((row) => ({ id: row.id, part: row.part, topic: row.topic, topicZh: row.topic, questionEn: row.question_en, questionZh: row.question_zh, cuePoints: JSON.parse(row.cue_points_json || "[]"), difficulty: row.difficulty, sourceType: "Custom", createdAt: row.created_at, updatedAt: row.updated_at })) });
    }

    if (path === "/api/me/speaking/custom-questions" && request.method === "POST") {
      const body = await readJsonBody(request);
      const part = Number(body.part);
      const questionEn = cleanString(body.questionEn, 500);
      if (![1, 2, 3].includes(part) || !questionEn) return errorJson(400, "invalid_question", "请填写有效的 Part 和英文题目");
      const id = `custom-${randomToken(8)}`;
      const timestamp = nowIso();
      await db.prepare(`INSERT INTO speaking_custom_questions (id,user_id,part,topic,question_en,question_zh,cue_points_json,difficulty,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, userId, part, cleanString(body.topic, 80) || "Custom", questionEn, cleanString(body.questionZh, 500), JSON.stringify(cleanList(body.cuePoints, (item) => cleanString(item, 200), 4)), ["easy","medium","hard"].includes(body.difficulty) ? body.difficulty : "medium", timestamp, timestamp).run();
      return json({ ok: true, id }, 201);
    }

    if (path === "/api/me/speaking/question-marks" && request.method === "GET") {
      const rows = await db.prepare(`SELECT question_id questionId, favorite, needs_review needsReview FROM speaking_question_marks WHERE user_id = ?`).bind(userId).all();
      return json({ ok: true, marks: (rows.results || []).map((row) => ({ questionId: row.questionId, favorite: Boolean(row.favorite), needsReview: Boolean(row.needsReview) })) });
    }

    if (path === "/api/me/speaking/question-marks" && request.method === "PUT") {
      const body = await readJsonBody(request);
      const questionId = cleanString(body.questionId, 160);
      if (!questionId) return errorJson(400, "invalid_question", "题目无效");
      await db.prepare(
        `INSERT INTO speaking_question_marks (user_id, question_id, favorite, needs_review, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, question_id) DO UPDATE SET favorite = excluded.favorite, needs_review = excluded.needs_review, updated_at = excluded.updated_at`,
      ).bind(userId, questionId, body.favorite ? 1 : 0, body.needsReview ? 1 : 0, nowIso()).run();
      return json({ ok: true });
    }

    if (path === "/api/me/speaking/expressions" && request.method === "GET") {
      const rows = await db.prepare(`SELECT id, expression_en expressionEn, explanation_zh explanationZh, topic, source_question_id sourceQuestionId, review_status reviewStatus, created_at createdAt FROM speaking_saved_expressions WHERE user_id = ? ORDER BY created_at DESC`).bind(userId).all();
      return json({ ok: true, expressions: rows.results || [] });
    }

    if (path === "/api/me/speaking/expressions" && request.method === "POST") {
      const body = await readJsonBody(request);
      const expression = cleanString(body.expressionEn, 500);
      if (!expression) return errorJson(400, "invalid_expression", "请填写英文表达");
      const id = randomToken(12); const timestamp = nowIso();
      await db.prepare(`INSERT INTO speaking_saved_expressions (id,user_id,expression_en,explanation_zh,topic,source_question_id,review_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id,userId,expression,cleanString(body.explanationZh,800),cleanString(body.topic,80)||"General",cleanString(body.sourceQuestionId,120)||null,"new",timestamp,timestamp).run();
      return json({ ok: true, id }, 201);
    }

    const expressionMatch = path.match(/^\/api\/me\/speaking\/expressions\/([^/]+)$/);
    if (expressionMatch && request.method === "PATCH") {
      const body = await readJsonBody(request);
      const reviewStatus = cleanString(body.reviewStatus, 20);
      if (!["new", "learning", "reviewed"].includes(reviewStatus)) return errorJson(400, "invalid_status", "复习状态无效");
      const result = await db.prepare(`UPDATE speaking_saved_expressions SET review_status = ?, updated_at = ? WHERE id = ? AND user_id = ?`).bind(reviewStatus, nowIso(), decodeURIComponent(expressionMatch[1]), userId).run();
      if (!result.meta?.changes) return errorJson(404, "not_found", "表达不存在");
      return json({ ok: true });
    }
    if (expressionMatch && request.method === "DELETE") {
      const result = await db.prepare(`DELETE FROM speaking_saved_expressions WHERE id = ? AND user_id = ?`).bind(decodeURIComponent(expressionMatch[1]), userId).run();
      if (!result.meta?.changes) return errorJson(404, "not_found", "表达不存在");
      return json({ ok: true });
    }

    if (path === "/api/me/speaking/analyse-text" && request.method === "POST") {
      const body = await readJsonBody(request, { maxBytes: 32_000 });
      const question = await lookupQuestion(db, userId, cleanString(body.questionId, 160));
      const transcript = cleanString(body.transcript, 8_000);
      if (!question || !transcript) return errorJson(400, "invalid_submission", "题目或转写内容无效");
      await reserveUsage(db, userId, limit);
      try {
        return json({ ok: true, result: await analyseTranscript({ db, env, session, question, transcript, durationSeconds: Math.min(900, Math.max(0, Number(body.durationSeconds) || 0)), audioLocalId: cleanString(body.audioLocalId, 160) || null, retryOf: cleanString(body.retryOf, 160) || null }) });
      } catch (error) {
        if (quotaFailure(error)) await blockUsage(db, userId, error.code || "cloudflare_quota");
        throw error;
      }
    }

    if (path === "/api/me/speaking/analyse-audio" && request.method === "POST") {
      if (!env.AI) return errorJson(503, "ai_unavailable", "Cloudflare Workers AI 尚未绑定；本地录音与题库仍可使用。");
      const form = await request.formData();
      const file = form.get("audio");
      const question = await lookupQuestion(db, userId, cleanString(form.get("questionId"), 160));
      const durationSeconds = Math.min(180, Math.max(1, Number(form.get("durationSeconds")) || 1));
      if (!question || !file || typeof file.arrayBuffer !== "function") return errorJson(400, "invalid_submission", "请选择题目并录制回答");
      const type = String(file.type || "").split(";")[0].toLowerCase();
      if (!AUDIO_TYPES.has(type) || file.size <= 0 || file.size > MAX_AUDIO_BYTES) return errorJson(400, "invalid_audio", "音频格式不支持或文件超过 10MB");
      await reserveUsage(db, userId, limit);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const speech = await env.AI.run(SPEECH_MODEL, { audio: [...bytes] });
        const transcript = cleanString(speech?.text || speech?.result?.text, 8_000);
        if (!transcript) throw Object.assign(new Error("没有识别到清晰的英文回答，请重新录制。"), { code: "empty_transcript", status: 422 });
        const audioNeurons = estimatedAudioNeurons(durationSeconds);
        return json({ ok: true, result: await analyseTranscript({ db, env, session, question, transcript, durationSeconds, audioLocalId: cleanString(form.get("audioLocalId"), 160) || null, retryOf: cleanString(form.get("retryOf"), 160) || null, audioNeurons }) });
      } catch (error) {
        if (quotaFailure(error)) await blockUsage(db, userId, error.code || "cloudflare_quota");
        throw error;
      }
    }

    return errorJson(404, "not_found", "口语接口不存在");
  } catch (error) {
    return errorJson(error.status || (error.code === "unauthorized" ? 401 : 500), error.code || "speaking_error", error.message || "口语服务暂时不可用");
  }
}
