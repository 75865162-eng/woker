import assert from "node:assert/strict";
import test, { beforeEach, after } from "node:test";
import { cloudRelayConfiguration, createCloudRelayEnvelope, cloudRelaySignature, verifyCloudRelayEnvelope, AmazonCloudRelayError } from "@/lib/amazon/cloud-relay-protocol";

const originalUrl = process.env.AMAZON_CLOUD_EXECUTOR_URL, originalSecret = process.env.AMAZON_CLOUD_BRIDGE_SECRET;
beforeEach(() => { process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://cloud.fixture.invalid"; process.env.AMAZON_CLOUD_BRIDGE_SECRET = "offline-fixture-relay-secret-with-at-least-32-bytes"; });
after(() => {
  if (originalUrl === undefined) delete process.env.AMAZON_CLOUD_EXECUTOR_URL; else process.env.AMAZON_CLOUD_EXECUTOR_URL = originalUrl;
  if (originalSecret === undefined) delete process.env.AMAZON_CLOUD_BRIDGE_SECRET; else process.env.AMAZON_CLOUD_BRIDGE_SECRET = originalSecret;
});
const envelope = () => createCloudRelayEnvelope({ organizationId: "fixture-org", workspaceId: "fixture-workspace" }, "fixture-user", { kind: "apply", id: "fixture-approval" });

test("relay binds the exact user, tenant, operation and cloud audience", () => {
  const value = envelope(), signature = cloudRelaySignature(value);
  assert.deepEqual(verifyCloudRelayEnvelope(value, signature), value);
  for (const modified of [{ ...value, actorUserId: "admin" }, { ...value, scope: { ...value.scope, organizationId: "another-org" } }, { ...value, operation: { kind: "apply", id: "another-approval" } }, { ...value, audience: "https://other.fixture.invalid" }]) {
    assert.throws(() => verifyCloudRelayEnvelope(modified, signature), AmazonCloudRelayError);
  }
  assert.throws(() => verifyCloudRelayEnvelope(value, null), AmazonCloudRelayError);
});
test("expired, future and cross-environment signed messages are rejected", () => {
  const value = envelope(), signature = cloudRelaySignature(value);
  assert.throws(() => verifyCloudRelayEnvelope(value, signature, value.issuedAt + 120001), /已过期/);
  assert.throws(() => verifyCloudRelayEnvelope(value, signature, value.issuedAt - 120001), /已过期/);
  process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://staging.fixture.invalid";
  assert.throws(() => verifyCloudRelayEnvelope(value, signature), AmazonCloudRelayError);
});
test("bridge never accepts unsigned browser claims or arbitrary business commands", () => {
  const value = envelope();
  assert.throws(() => verifyCloudRelayEnvelope({ ...value, userRole: "owner", approved: true }, "0".repeat(64)), AmazonCloudRelayError);
  const forbidden = { ...value, operation: { kind: "request", command: { action: "save-authorization", refreshToken: "fixture" } } } as typeof value;
  assert.throws(() => verifyCloudRelayEnvelope(forbidden, cloudRelaySignature(forbidden)), AmazonCloudRelayError);
});
test("missing credentials and unsafe executor URLs fail before dispatch", () => {
  for (const url of ["", "http://cloud.fixture.invalid", "https://localhost", "https://127.0.0.1", "https://cloud.fixture.invalid/api?token=x", "https://user:password@cloud.fixture.invalid"]) {
    process.env.AMAZON_CLOUD_EXECUTOR_URL = url;
    assert.throws(cloudRelayConfiguration, AmazonCloudRelayError);
  }
  process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://cloud.fixture.invalid";
  process.env.AMAZON_CLOUD_BRIDGE_SECRET = "short";
  assert.throws(cloudRelayConfiguration, /配置无效/);
});
