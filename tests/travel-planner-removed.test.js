import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const client = await readFile(new URL("personal-space.js", root), "utf8");
const worker = await readFile(new URL("worker/index.js", root), "utf8");

test("Travel Planner is removed from public navigation and routing", () => {
  const visibleHtml = html.replace(/<!-- Travel Planner retired[\s\S]*?-->/, "");
  assert.doesNotMatch(visibleHtml, /data-route="travel"/);
  assert.doesNotMatch(visibleHtml, /data-screen="travel"/);
  assert.doesNotMatch(client, /mountTravelPlanner|privateRoutes[^\n]*travel/);
  assert.doesNotMatch(worker, /handleTravelApi|\/api\/me\/travel/);
});

test("retired database records are explicitly preserved", () => {
  assert.match(html, /database tables and historical rows are intentionally preserved/);
});
