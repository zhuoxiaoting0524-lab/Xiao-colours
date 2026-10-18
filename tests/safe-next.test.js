import test from "node:test";
import assert from "node:assert/strict";
import { safeNextPath, loginUrlForView, PRIVATE_VIEWS } from "../auth-client.js";

test("safeNextPath blocks open redirects", () => {
  assert.equal(safeNextPath("./index.html#journal"), "./index.html#journal");
  assert.equal(safeNextPath("/admin.html"), "/admin.html");
  assert.equal(safeNextPath("https://evil.example/"), "./index.html");
  assert.equal(safeNextPath("//evil.example"), "./index.html");
  assert.equal(safeNextPath("javascript:alert(1)"), "./index.html");
});

test("loginUrlForView targets private modules with shared next", () => {
  assert.equal(PRIVATE_VIEWS.length, 3);
  assert.equal(
    loginUrlForView("gallery"),
    "./login.html?next=" + encodeURIComponent("./index.html#gallery"),
  );
});
