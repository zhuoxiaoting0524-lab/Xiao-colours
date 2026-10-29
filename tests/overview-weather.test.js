import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildForecastRows, weatherMeta } from "../overview-weather.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../lifestyle-journal.css", import.meta.url), "utf8");

test("overview includes independent local clock, weather city and detail controls", () => {
  assert.match(html, /id="overview-local-time"/);
  assert.match(html, /id="overview-weather-city-button"/);
  assert.match(html, /id="overview-weather-details-toggle"/);
  assert.match(html, /id="overview-use-location"/);
  assert.match(html, /东京 \/ Tokyo/);
});

test("weather codes render a truthful weather label and icon", () => {
  assert.deepEqual(weatherMeta(0, 1), { label: "晴", icon: "☀️" });
  assert.equal(weatherMeta(63, 1).label, "有雨");
  assert.equal(weatherMeta(95, 1).label, "雷雨");
});

test("forecast keeps only the next three city-local days", () => {
  const rows = buildForecastRows({
    time: ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"],
    weather_code: [0, 1, 3, 61],
    temperature_2m_max: [22, 23.2, 18.7, 16.1],
    temperature_2m_min: [15, 16.1, 12.4, 10.2],
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.dayLabel), ["明天", "后天", "大后天"]);
  assert.equal(rows[0].high, 23);
  assert.equal(rows[2].description, "有雨");
});

test("mobile weather details use a safe-area bottom sheet without locking page scroll", () => {
  assert.match(css, /\.ov-weather-details,[\s\S]*?position:\s*fixed;[\s\S]*?safe-area-inset-bottom/);
  assert.doesNotMatch(css, /\.ov-weather-details[\s\S]{0,250}body\s*\{[\s\S]{0,80}overflow:\s*hidden/);
});
