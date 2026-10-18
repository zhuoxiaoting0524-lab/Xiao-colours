import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword, PASSWORD_ALGO, PBKDF2_ITERATIONS } from "../worker/password.js";

test("PBKDF2 password hash uses Web Crypto record format", async () => {
  const stored = await hashPassword("correct-horse-battery-staple");
  assert.match(stored, new RegExp(`^${PASSWORD_ALGO}\\$${PBKDF2_ITERATIONS}\\$`));
  assert.equal(await verifyPassword("correct-horse-battery-staple", stored), true);
  assert.equal(await verifyPassword("wrong-password-here", stored), false);
});

test("rejects too-short passwords", async () => {
  await assert.rejects(() => hashPassword("short"), /10/);
});
