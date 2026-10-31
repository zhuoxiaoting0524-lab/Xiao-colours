import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const js = await readFile(new URL("../travel-planner.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/0007_travel_planner.sql", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");

test("Travel Planner is reachable and exposes the six requested work areas", () => {
  assert.match(html, /data-route="travel"/);
  assert.match(html, /data-screen="travel"/);
  for (const panel of ["itinerary", "map", "saved", "info", "budget", "checklist"]) {
    assert.match(html, new RegExp(`data-travel-panel="${panel}"`));
  }
});

test("manual itinerary editing supports durable ordering and cross-day moves", () => {
  assert.match(js, /card\.draggable\s*=\s*true/);
  assert.match(js, /data-action="up"/);
  assert.match(js, /data-action="down"/);
  assert.match(js, /dayId/);
  assert.match(js, /method:\s*"PATCH"/);
});

test("destination selection is explicit and a single real search result is selected automatically", () => {
  assert.match(js, /if \(places\.length === 1\)/);
  assert.match(js, /已选择真实目的地/);
  assert.match(html, /AI 尚未启用/);
  assert.match(serviceWorker, /xiaocolour-pwa-v7/);
});

test("travel schema is additive and every private record is user-owned", () => {
  for (const table of [
    "travel_trips", "travel_days", "travel_activities", "travel_saved_places",
    "travel_info_items", "travel_expenses", "travel_checklist_items", "travel_versions",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${table}`));
  }
  assert.ok((migration.match(/user_id\s+TEXT\s+NOT NULL/g) || []).length >= 8);
});
