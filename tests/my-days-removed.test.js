import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const client = await readFile(new URL("personal-space.js", root), "utf8");
const worker = await readFile(new URL("worker/index.js", root), "utf8");
const migration = await readFile(new URL("migrations/0004_notes_days.sql", root), "utf8");
const exportApi = await readFile(new URL("worker/data-export-api.js", root), "utf8");

test("My Days is removed from navigation, pages, dialogs, and active APIs", () => {
  assert.doesNotMatch(html, /data-route="days"|data-screen="days"|id="task-dialog"|id="important-dialog"/);
  assert.doesNotMatch(client, /mountDays|openTaskComposer|openImportantComposer|privateRoutes[^\n]*days/);
  assert.doesNotMatch(worker, /handleDaysApi|\/api\/me\/days/);
});

test("historical task and important-date data remain recoverable in exports", () => {
  assert.match(migration, /day_tasks/);
  assert.match(migration, /important_dates/);
  assert.match(exportApi, /day_tasks/);
  assert.match(exportApi, /important_dates/);
});
