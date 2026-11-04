import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const js = await readFile(new URL("country-archives.js", root), "utf8");
const css = await readFile(new URL("personal-space.css", root), "utf8");
const api = await readFile(new URL("worker/country-archives-api.js", root), "utf8");
const migration = await readFile(new URL("migrations/0008_footprints_country_archives.sql", root), "utf8");

test("Footprints exposes country archives without replacing the globe", () => {
  assert.match(html, /data-footprints-mode="globe"/);
  assert.match(html, /data-footprints-mode="countries"/);
  assert.match(html, /id="footprints-map"/);
  assert.match(html, /id="country-archive-shell"/);
});

test("country archive UI has four persistent data views and responsive rules", () => {
  for (const label of ["总览", "路线", "吃喝玩乐", "花销"]) assert.match(js, new RegExp(label));
  assert.match(js, /not_visited|实际足迹仅允许/);
  assert.match(js, /不同币种分别统计/);
  assert.match(css, /@media\(max-width:640px\)/);
  assert.match(css, /country-archive-shell\.country-selected/);
});

test("country names are localized and country selection is restored", () => {
  assert.match(js, /Intl\.DisplayNames/);
  assert.match(js, /xiaocolour-country-archive/);
  assert.match(js, /已去 \$\{Number\(country\.visited_count\|\|0\)\} · 想去/);
});

test("money and tenant ownership are enforced server-side", () => {
  assert.match(migration, /amount_minor INTEGER/);
  assert.match(migration, /experience_id TEXT UNIQUE/);
  assert.match(api, /session\.user\.id/);
  assert.match(api, /country_expenses WHERE id=\? AND user_id=\? AND archive_id=\?/);
  assert.match(api, /actual && row\.status !== "visited"/);
});

