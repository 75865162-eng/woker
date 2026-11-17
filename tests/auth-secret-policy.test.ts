import assert from "node:assert/strict";
import test from "node:test";
import { isProductionAuthSecretValid } from "../src/lib/auth/secret-policy";

const VALID = "a".repeat(32);

test("生产密钥：合法随机值通过", () => {
  assert.equal(isProductionAuthSecretValid(VALID), true);
  assert.equal(isProductionAuthSecretValid("x".repeat(48)), true);
});

test("生产密钥：缺失、占位符、过短一律拒绝", () => {
  assert.equal(isProductionAuthSecretValid(undefined), false);
  assert.equal(isProductionAuthSecretValid(""), false);
  assert.equal(isProductionAuthSecretValid("local-development-auth-secret"), false);
  assert.equal(isProductionAuthSecretValid("change-this-local-secret-before-production"), false);
  assert.equal(isProductionAuthSecretValid("replace-with-a-random-secret-at-least-32-characters"), false);
  assert.equal(isProductionAuthSecretValid("short"), false);
  assert.equal(isProductionAuthSecretValid("a".repeat(31)), false);
});
