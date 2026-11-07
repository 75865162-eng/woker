import assert from "node:assert/strict";
import test from "node:test";
import { assertApplicable, assertDecision, digest, normalizeCommand, safeState, summary } from "@/lib/amazon-sync/approval-policy";
import { approvedContext, withApprovedChange } from "@/lib/amazon-sync/approved-context";
import { SyncInputError } from "@/lib/amazon-sync/policy";

test("approval command normalization drops client metadata and canonical digest ignores object key order", () => {
  const value = normalizeCommand({ action: "save-authorization", proposedId: "id-1", name: "Local", amazonSellerId: "seller-1", region: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", refreshToken: "secret", requestedByUserId: "attacker", approvedByUserId: "attacker", allowSelfApproval: true, role: "owner" });
  assert.equal("requestedByUserId" in value, false);
  assert.equal("approvedByUserId" in value, false);
  assert.equal("allowSelfApproval" in value, false);
  assert.equal("role" in value, false);
  assert.deepEqual(summary(value).refreshToken, "将替换／新增");
  assert.equal(digest({ a: 1, b: ["x"] }), digest({ b: ["x"], a: 1 }));
});

test("approval safe summaries redact nested secret-like values", () => {
  assert.deepEqual(safeState({ endpoint: "public", credentialsCiphertext: "cipher", nested: [{ refreshToken: "token" }] }), {
    endpoint: "public", credentialsCiphertext: "已配置", nested: [{ refreshToken: "已配置" }],
  });
  assert.throws(() => summary({ action: "run", input: { raw: "not allowed" } }), SyncInputError);
});

test("approval decisions deny self approval by default and require a fresh digest/revision", () => {
  const expiresAt = new Date(Date.now() + 60_000);
  assert.throws(() => assertDecision({ status: "REQUESTED", requestedByUserId: "user-1", expiresAt }, "user-1"), /仅组织所有者或数据库管理员/);
  assert.doesNotThrow(() => assertDecision({ status: "REQUESTED", requestedByUserId: "user-1", expiresAt }, "user-2"));
  const approved = { status: "APPROVED", expiresAt, targetEnvironment: "local", changeDigest: "digest", baseRevision: 4, approvedByUserId: "user-2" };
  assert.doesNotThrow(() => assertApplicable(approved, { environment: "local", digest: "digest", revision: 4 }));
  assert.throws(() => assertApplicable(approved, { environment: "production", digest: "digest", revision: 4 }), /已失效/);
  assert.throws(() => assertApplicable(approved, { environment: "local", digest: "changed", revision: 4 }), /已失效/);
  assert.throws(() => assertApplicable(approved, { environment: "local", digest: "digest", revision: 5 }), /已失效/);
});

test("service mutations fail closed outside the approved transaction context", async () => {
  assert.throws(() => approvedContext({ organizationId: "org-1", workspaceId: "ws-1" }, "run"), /APPROVAL_REQUIRED/);
  const tx = {} as never;
  await withApprovedChange({ tx, scope: { organizationId: "org-1", workspaceId: "ws-1" }, action: "run", approvalId: "approval-1", commandSourceIds: ["source-1"] }, async () => {
    assert.equal(approvedContext({ organizationId: "org-1", workspaceId: "ws-1" }, "run").approvalId, "approval-1");
    assert.throws(() => approvedContext({ organizationId: "org-2", workspaceId: "ws-1" }, "run"), /APPROVAL_REQUIRED/);
    assert.throws(() => approvedContext({ organizationId: "org-1", workspaceId: "ws-1" }, "save-plan"), /APPROVAL_REQUIRED/);
  });
});


test("admin self confirmation still rejects expired, decided, unapplied and replayed requests", () => {
  const now = new Date("2026-11-05T00:00:00Z");
  const row = { status: "REQUESTED", requestedByUserId: "admin", expiresAt: new Date(now.getTime() + 60_000) };
  assert.doesNotThrow(() => assertDecision(row, "admin", now, true));
  assert.throws(() => assertDecision({ ...row, expiresAt: now }, "admin", now, true), /已处理或过期/);
  assert.throws(() => assertDecision({ ...row, status: "APPROVED" }, "admin", now, true), /已处理或过期/);
  const approved = { ...row, status: "APPROVED", targetEnvironment: "local", changeDigest: "digest", baseRevision: 1, approvedByUserId: "admin" };
  const expected = { environment: "local", digest: "digest", revision: 1 };
  assert.doesNotThrow(() => assertApplicable(approved, expected, now));
  for (const status of ["REQUESTED", "APPLYING", "APPLIED", "REVOKED", "FAILED"]) assert.throws(() => assertApplicable({ ...approved, status }, expected, now), /已失效/);
});
