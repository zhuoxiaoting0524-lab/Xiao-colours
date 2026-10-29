import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../lifestyle-journal.css", import.meta.url), "utf8");

test("workspace uses one explicit vertical scroll container", () => {
  assert.match(css, /#personal-space-v2 \.ws-shell[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /#personal-space-v2 \.ws-main[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/);
  assert.match(css, /#personal-space-v2 \.ws-sidebar[\s\S]*?overflow-y:\s*auto;/);
});

test("overview cards adapt at compact desktop and mobile widths", () => {
  assert.match(css, /@media \(min-width:\s*769px\) and \(max-width:\s*1200px\)[\s\S]*?\.ov-stats[\s\S]*?repeat\(2,/);
  assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*?\.ov-stats[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(css, /\.ov-stat-content small[\s\S]*?word-break:\s*keep-all;/);
});

test("mobile map preserves page gestures and safe bottom spacing", () => {
  assert.match(css, /\.real-map[\s\S]*?touch-action:\s*pan-y pinch-zoom;/);
  assert.match(css, /safe-area-inset-bottom/);
});
