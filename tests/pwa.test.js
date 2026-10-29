import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("PWA manifest opens XiaoColour Overview in standalone mode", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));
  assert.equal(manifest.name, "XiaoColour");
  assert.equal(manifest.short_name, "XiaoColour");
  assert.equal(manifest.start_url, "/#overview");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#738B7B");
  assert.equal(manifest.background_color, "#F8F7F2");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
});

test("all production Global Pulse entrances stay in the current PWA window", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const entries = [...html.matchAll(/<a\b[^>]*href="\/global"[^>]*>/g)].map((match) => match[0]);
  assert.equal(entries.length, 4);
  assert.ok(entries.every((entry) => /target="_self"/.test(entry)));
  assert.doesNotMatch(html, /href="\.\/global\.html"/);
});

test("Global Pulse provides a direct Overview return link", async () => {
  const html = await readFile(new URL("global.html", root), "utf8");
  assert.match(html, /class="gp-back-home" href="\/#overview" target="_self"/);
  assert.match(html, /返回 XiaoColour/);
});

test("service worker never caches APIs or cross-origin map resources", async () => {
  const worker = await readFile(new URL("service-worker.js", root), "utf8");
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /content-disposition/);
  assert.match(worker, /caches\.match\("\/offline"\)/);
});

test("main page exposes install metadata and a real install control", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /apple-touch-icon.*icons\/apple-touch-icon\.png/);
  assert.match(html, /id="settings-install-pwa"/);
  assert.match(html, /pwa-install\.js/);
});
