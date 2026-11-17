import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptAiApiKey,
  encryptAiApiKey,
  hasAiSettingsEncryptionKey,
} from "../src/lib/server/ai-settings-crypto";

const KEY = Buffer.from("a".repeat(32), "utf8").toString("base64");
const OTHER_KEY = Buffer.from("b".repeat(32), "utf8").toString("base64");
const env = { AMAZON_SP_API_ENCRYPTION_KEY: KEY };
const scope = { organizationId: "org-1", workspaceId: "ws-1" };

test("ai-settings crypto: 往返加解密得到原始密钥", () => {
  const plain = "sk-test-1234567890";
  const cipher = encryptAiApiKey(plain, scope, env);
  assert.notEqual(cipher, plain);
  assert.ok(cipher.startsWith("aiv1."));
  assert.equal(decryptAiApiKey(cipher, scope, env), plain);
});

test("ai-settings crypto: 同一明文两次加密产生不同密文（随机 IV）", () => {
  const a = encryptAiApiKey("sk-same", scope, env);
  const b = encryptAiApiKey("sk-same", scope, env);
  assert.notEqual(a, b);
  assert.equal(decryptAiApiKey(a, scope, env), "sk-same");
  assert.equal(decryptAiApiKey(b, scope, env), "sk-same");
});

test("ai-settings crypto: 跨组织/工作区 AAD 隔离，密文不可搬运", () => {
  const cipher = encryptAiApiKey("sk-secret", scope, env);
  assert.throws(
    () => decryptAiApiKey(cipher, { organizationId: "org-2", workspaceId: "ws-1" }, env),
    /无法解密/,
  );
  assert.throws(
    () => decryptAiApiKey(cipher, { organizationId: "org-1", workspaceId: "ws-2" }, env),
    /无法解密/,
  );
});

test("ai-settings crypto: 错误主密钥无法解密", () => {
  const cipher = encryptAiApiKey("sk-secret", scope, env);
  assert.throws(
    () => decryptAiApiKey(cipher, scope, { AMAZON_SP_API_ENCRYPTION_KEY: OTHER_KEY }),
    /无法解密/,
  );
});

test("ai-settings crypto: 历史明文原样返回，保证向后兼容", () => {
  assert.equal(decryptAiApiKey("sk-legacy-plaintext", scope, env), "sk-legacy-plaintext");
  assert.equal(decryptAiApiKey("sk-legacy-plaintext", scope, {}), "sk-legacy-plaintext");
});

test("ai-settings crypto: 空值不加密、不解密", () => {
  assert.equal(encryptAiApiKey("", scope, env), "");
  assert.equal(decryptAiApiKey("", scope, env), "");
});

test("ai-settings crypto: 缺少有效主密钥时加密失败、不静默降级", () => {
  assert.equal(hasAiSettingsEncryptionKey(env), true);
  assert.equal(hasAiSettingsEncryptionKey({ AMAZON_SP_API_ENCRYPTION_KEY: "short" }), false);
  assert.throws(() => encryptAiApiKey("sk-x", scope, {}), /需要有效/);
  assert.throws(() => decryptAiApiKey("aiv1.aaa.bbb.ccc", scope, {}), /需要有效/);
});
