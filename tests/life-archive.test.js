import assert from "node:assert/strict";
import test from "node:test";
import { buildPdfFromJpegs, dateBounds, filterArchiveData } from "../life-archive.js";

const exported = { data: {
  myDays: [
    { id: "a", title: "今年任务", date: "2026-05-01", completed: true },
    { id: "b", title: "去年任务", date: "2025-05-01", completed: false },
  ],
  importantDates: [
    { id: "c", title: "今年日期", date: "2026-08-08" },
    { id: "d", title: "范围外日期", date: "2024-08-08" },
  ],
  footprints: [
    { id: "e", name: "Paris", visitedDate: "2026-03-12", status: "visited" },
    { id: "f", name: "Tokyo", visitedDate: "2025-04-10", status: "wish" },
  ],
} };

test("life archive date ranges are deterministic", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  assert.deepEqual(dateBounds("this-year", "", "", now), { start: "2026-01-01", end: "2026-12-31", label: "2026 年" });
  assert.deepEqual(dateBounds("last-year", "", "", now), { start: "2025-01-01", end: "2025-12-31", label: "2025 年" });
  assert.throws(() => dateBounds("custom", "2026-12-01", "2026-01-01", now), /有效/);
});

test("life archive filters every selected data group by date", () => {
  const result = filterArchiveData(exported, {
    range: "custom", start: "2026-01-01", end: "2026-12-31", now: new Date("2026-10-27"),
    include: new Set(["tasks", "important", "footprints", "photos"]),
  });
  assert.deepEqual(result.tasks.map((item) => item.id), ["a"]);
  assert.deepEqual(result.importantDates.map((item) => item.id), ["c"]);
  assert.deepEqual(result.footprints.map((item) => item.id), ["e"]);
});

test("life archive respects content toggles and empty accounts", () => {
  const result = filterArchiveData({ data: {} }, { range: "all", include: new Set(["tasks"]), now: new Date("2026-10-27") });
  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.importantDates, []);
  assert.deepEqual(result.footprints, []);
});

test("PDF writer emits a valid page tree and PDF trailer", () => {
  const tinyJpeg = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==", "base64"));
  const pdf = buildPdfFromJpegs([tinyJpeg, tinyJpeg]);
  const text = new TextDecoder("latin1").decode(pdf);
  assert.ok(text.startsWith("%PDF-1.7"));
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/Kids \[6 0 R 9 0 R\]/);
  assert.ok(text.endsWith("%%EOF"));
});
