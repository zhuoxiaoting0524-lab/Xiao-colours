import test from "node:test";
import assert from "node:assert/strict";

import { normalizeArticles } from "../global/data-service.js";
import { safeNewsUrl } from "../global/utils.js";

test("news links accept only HTTPS article URLs", () => {
  assert.equal(safeNewsUrl("https://example.com/story"), "https://example.com/story");
  assert.equal(safeNewsUrl("http://example.com/story"), "");
  assert.equal(safeNewsUrl("javascript:alert(1)"), "");

  const normalized = normalizeArticles([
    { title: "Secure report", url: "https://example.com/story", domain: "example.com" },
    { title: "Insecure report", url: "http://example.com/story", domain: "example.com" },
    { title: "Unsafe report", url: "javascript:alert(1)", domain: "example.com" },
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].title, "Secure report");
  assert.equal(normalized[0].url, "https://example.com/story");
});
