import assert from "node:assert/strict";
import test from "node:test";
import { aiFailureMessage, classifyUpstreamError, redactForLog, safeBaseUrl } from "../src/lib/server/ai-error";

test("上游鉴权错误归为 auth 且不回显原文", () => {
  const failure = classifyUpstreamError(401, "invalid api key sk-abcdefghijklmnop");
  assert.equal(failure.kind, "auth");
  const safe = aiFailureMessage(failure);
  assert.equal(safe.status, 401);
  assert.ok(!safe.error.includes("sk-"));
  assert.ok(!safe.error.includes("abcdefghijklmnop"));
});

test("限流与服务端错误正确分类", () => {
  assert.equal(classifyUpstreamError(429, "too many requests").kind, "rate_limit");
  assert.equal(classifyUpstreamError(503, "service unavailable").kind, "upstream");
  assert.equal(classifyUpstreamError(400, "invalid request model").kind, "config");
});

test("任意错误文案都不包含上游原文或密钥", () => {
  const bodies = [
    "sk-live-SECRETKEY123456",
    "Bearer eyJhbGciOi...",
    "internal host 10.0.0.5:9000",
    "your key sk-proj-abcdefgh is invalid",
  ];
  for (const body of bodies) {
    const failure = classifyUpstreamError(500, body);
    const safe = aiFailureMessage(failure).error;
    assert.ok(!safe.includes("sk-"), safe);
    assert.ok(!safe.includes("10.0.0.5"), safe);
  }
});

test("redactForLog 脱敏密钥、Bearer、URL", () => {
  const redacted = redactForLog("failed with sk-abcdefgh and Bearer token123 at https://internal.local/v1/x?k=secret");
  assert.ok(!redacted.includes("sk-abcdefgh"));
  assert.ok(!redacted.includes("token123"));
  assert.ok(!redacted.includes("https://internal.local"));
});

test("safeBaseUrl 只保留 scheme://host", () => {
  assert.equal(safeBaseUrl("https://internal.local:8443/v1/chat?key=abc"), "https://internal.local:8443");
  assert.equal(safeBaseUrl("http://10.0.0.5:9000/secret/path"), "http://10.0.0.5:9000");
  assert.equal(safeBaseUrl("not a url"), undefined);
  assert.equal(safeBaseUrl(undefined), undefined);
});
