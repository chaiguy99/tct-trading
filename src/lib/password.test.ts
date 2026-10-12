import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import test from "node:test";
import { verifyPassword } from "./password";

test("verifies a scrypt password hash without accepting another password", () => {
  const password = "correct horse battery staple";
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64).toString("hex");
  const encoded = `scrypt:${salt.toString("hex")}:${digest}`;

  assert.equal(verifyPassword(password, encoded), true);
  assert.equal(verifyPassword("incorrect password", encoded), false);
});

test("rejects malformed password hashes", () => {
  assert.equal(verifyPassword("password", ""), false);
  assert.equal(verifyPassword("password", "sha256:deadbeef:deadbeef"), false);
  assert.equal(verifyPassword("password", "scrypt:not-hex:not-hex"), false);
  assert.equal(verifyPassword("x".repeat(1_025), "scrypt:invalid:invalid"), false);
});
