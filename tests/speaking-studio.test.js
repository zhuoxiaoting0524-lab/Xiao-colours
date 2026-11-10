import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SPEAKING_QUESTIONS, SPEAKING_TOPICS } from "../speaking-question-bank.js";
import { validateFeedbackReport } from "../worker/speaking-api.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("original question bank contains 150 balanced questions", () => {
  assert.equal(SPEAKING_QUESTIONS.length, 150);
  assert.equal(SPEAKING_TOPICS.length, 10);
  assert.equal(SPEAKING_QUESTIONS.filter((q) => q.part === 1).length, 70);
  assert.equal(SPEAKING_QUESTIONS.filter((q) => q.part === 2).length, 30);
  assert.equal(SPEAKING_QUESTIONS.filter((q) => q.part === 3).length, 50);
  assert.ok(SPEAKING_QUESTIONS.every((q) => q.id && q.questionEn && q.questionZh));
});

test("feedback validator rejects prose and preserves structured evidence", () => {
  assert.throws(() => validateFeedbackReport("not json"));
  const result = validateFeedbackReport({
    grammar: [{ original: "I go yesterday", correction: "I went yesterday", explanationZh: "过去时间使用过去式。" }],
    vocabulary: [{ original: "very good", suggestion: "rewarding", explanationZh: "更自然具体。" }],
    content: { addressedQuestion: true, clearOpinion: true, hasReason: true, hasExample: false, sufficient: true, explanationZh: "结构清楚。" },
    improvedAnswer: "I went there yesterday and found it rewarding.",
    priorities: ["注意过去式"],
  });
  assert.equal(result.grammar[0].correction, "I went yesterday");
  assert.equal(result.priorities.length, 1);
});

test("Speaking Studio is a private first-level route and cached assets are versioned", async () => {
  const [html, app, auth, sw] = await Promise.all([read("index.html"), read("personal-space.js"), read("auth-client.js"), read("service-worker.js")]);
  assert.match(html, /data-route="speaking"/);
  assert.match(html, /data-screen="speaking"/);
  assert.match(app, /mountSpeakingStudio/);
  assert.match(app, /privateRoutes[^\n]*"speaking"/);
  assert.match(auth, /"speaking"/);
  assert.match(sw, /xiaocolour-pwa-v13/);
});

test("private speaking persistence is scoped to the current user", async () => {
  const [migration, api, exportApi] = await Promise.all([read("migrations/0009_speaking_studio.sql"), read("worker/speaking-api.js"), read("worker/data-export-api.js")]);
  for (const table of ["speaking_custom_questions", "speaking_sessions", "speaking_answers", "speaking_feedback", "speaking_saved_expressions", "speaking_review_items", "speaking_question_marks", "speaking_daily_usage"]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(migration, /user_id TEXT NOT NULL REFERENCES users\(id\)/);
  assert.match(api, /WHERE a\.user_id = \?/);
  assert.match(api, /DELETE FROM speaking_answers WHERE id = \? AND user_id = \?/);
  assert.match(api, /SELECT id, part, topic[\s\S]*FROM speaking_custom_questions WHERE id = \? AND user_id = \?/);
  assert.match(exportApi, /speakingStudio/);
  assert.match(exportApi, /speaking-studio\.json/);
});

test("practice UI includes mock flow, comparison, library review and real history deletion", async () => {
  const [html, client, api] = await Promise.all([read("index.html"), read("speaking-studio.js"), read("worker/speaking-api.js")]);
  assert.match(html, /id="speaking-comparison"/);
  assert.match(html, /id="speaking-expression-search"/);
  assert.match(html, /id="speaking-progress-summary"/);
  assert.match(client, /renderMockSummary/);
  assert.match(client, /nextDailyQuestion/);
  assert.match(client, /retryOf: item\.id/);
  assert.match(api, /request\.method === "PATCH"/);
  assert.match(api, /DELETE FROM speaking_answers WHERE id = \? AND user_id = \?/);
});

test("AI use is guarded by a conservative free-tier threshold", async () => {
  const [api, wrangler] = await Promise.all([read("worker/speaking-api.js"), read("wrangler.jsonc")]);
  assert.match(api, /DEFAULT_DAILY_LIMIT = 8_000/);
  assert.match(api, /Math\.min\(8_000/);
  assert.match(api, /@cf\/openai\/whisper/);
  assert.match(api, /@cf\/google\/gemma-4-26b-a4b-it/);
  assert.match(wrangler, /"SPEAKING_AI_DAILY_LIMIT": "8000"/);
});
