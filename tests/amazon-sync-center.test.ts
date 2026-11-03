import test from "node:test";
import assert from "node:assert/strict";
import { syncCenterEnabled, parseSyncPlan, officialEndpoint, retryDelay, SyncInputError } from "@/lib/amazon-sync/policy";
import { encryptCheckpoint, decryptCheckpoint } from "@/lib/amazon-sync/checkpoint";
import { encryptAmazonSpApiCredentials, decryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { inventoryPublishedWhere, catalogPublishedWhere, taskSummary, taskFilters, sourceHealth } from "@/lib/amazon-sync/read";
import { validateInventoryPage, classifySyncFailure, sourceTimestamp } from "@/lib/amazon-sync/processor";
import { AmazonSpApiError, readRetryAfter } from "@/lib/amazon/sp-api-client";
const scope = { organizationId: "org", workspaceId: "ws" };
test("sync center defaults off and requires an exact organization/workspace pair", () => {
  assert.equal(syncCenterEnabled(scope, "[]"), false); assert.equal(syncCenterEnabled(scope, "*"), false);
  assert.equal(syncCenterEnabled(scope, '[["other","ws"]]'), false);
  assert.equal(syncCenterEnabled(scope, '[["org","ws"]]'), true);
});
test("plans reject unimplemented domains, incremental modes and invalid scope/frequency", () => {
  const p = { name: "inventory", resource: "inventory", enabled: false, intervalMinutes: 60, sourceIds: ["one"] };
  assert.equal(parseSyncPlan(p).mode, "snapshot");
  for (const patch of [{ intervalMinutes: 0 }, { resource: "orders" }, { mode: "incremental" }, { sourceIds: [] }, { sourceIds: ["one", "one"] }, { maxAttempts: 11 }, { retentionDays: -1 }]) assert.throws(() => parseSyncPlan({ ...p, ...patch }), SyncInputError);
});
test("authorization endpoints are restricted to matching official regions", () => {
  officialEndpoint("us-east-1", "https://sellingpartnerapi-na.amazon.com");
  assert.throws(() => officialEndpoint("us-east-1", "https://127.0.0.1"));
  assert.throws(() => officialEndpoint("eu-west-1", "https://sellingpartnerapi-na.amazon.com"));
});
test("credentials and checkpoints cannot be swapped between authorizations, tenants or tasks", () => {
  const old = process.env.AMAZON_SP_API_ENCRYPTION_KEY; process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");
  try {
    const credentials = { lwaClientId: "client", lwaClientSecret: "secret", refreshToken: "token", awsAccessKeyId: "", awsSecretAccessKey: "" };
    const a = { ...scope, authorizationId: "a" }, b = { ...scope, authorizationId: "b" };
    const v2 = encryptAmazonSpApiCredentials(credentials, a); assert.ok(v2.startsWith("v2.")); assert.equal(decryptAmazonSpApiCredentials(v2, a).refreshToken, "token");
    assert.throws(() => decryptAmazonSpApiCredentials(v2, b)); assert.throws(() => decryptAmazonSpApiCredentials(v2, scope));
    const v1 = encryptAmazonSpApiCredentials(credentials, scope); assert.equal(decryptAmazonSpApiCredentials(v1, scope).refreshToken, "token");
    const checkpoint = encryptCheckpoint("sensitive-page-token", scope, "task")!;
    assert.ok(!checkpoint.includes("sensitive-page-token")); assert.equal(decryptCheckpoint(checkpoint, scope, "task"), "sensitive-page-token");
    assert.throws(() => decryptCheckpoint(checkpoint, scope, "other")); assert.throws(() => decryptCheckpoint(checkpoint, { ...scope, organizationId: "other" }, "task"));
  } finally { if (old === undefined) delete process.env.AMAZON_SP_API_ENCRYPTION_KEY; else process.env.AMAZON_SP_API_ENCRYPTION_KEY = old; }
});
test("published snapshot predicates include every scope head and exclude unfinished rows", () => {
  const heads = [{ runId: "a", sellerAccountId: "store-a", marketplaceId: "US", capturedAt: null }, { runId: "b", sellerAccountId: "store-b", marketplaceId: "CA", capturedAt: null }];
  assert.deepEqual(inventoryPublishedWhere(scope, heads).OR, [{ syncRunId: "a", sellerAccountId: "store-a", marketplaceId: "US" }, { syncRunId: "b", sellerAccountId: "store-b", marketplaceId: "CA" }]);
  assert.equal(catalogPublishedWhere(scope, heads).organizationId, "org"); assert.ok(inventoryPublishedWhere(scope, []).OR);
});
test("complete empty snapshot is fresh while missing fields or malformed pagination fail", () => {
  assert.deepEqual(validateInventoryPage({ payload: { inventorySummaries: [] } }).rows, []);
  assert.throws(() => validateInventoryPage({ payload: {} }));
  assert.throws(() => validateInventoryPage({ payload: { inventorySummaries: [{}] } }));
  assert.throws(() => validateInventoryPage({ payload: { inventorySummaries: [] }, pagination: { nextToken: 1 } }));
  assert.equal(sourceHealth({ enabled: true, lastSuccessAt: new Date(), freshnessMinutes: 60, activeRunId: "zero-row-manifest", authorization: { status: "CONFIGURED" }, seller: { status: "active" } }), "FRESH");
});
test("retry handles missing quota, 429/5xx/network and never persists raw upstream messages", () => {
  const f = classifySyncFailure(new AmazonSpApiError("private token and buyer info", { status: 429, retryable: true, retryAfterMs: 60000 }));
  assert.equal(f.code, "THROTTLE"); assert.equal(f.retryable, true); assert.ok(!JSON.stringify(f).includes("private token"));
  assert.equal(classifySyncFailure(new AmazonSpApiError("no", { status: 403 })).retryable, false);
  assert.equal(classifySyncFailure(new AmazonSpApiError("network", { retryable: true })).retryable, true);
  assert.equal(retryDelay(2, 60000, () => 0), 60000); assert.equal(readRetryAfter("60", new Date()), 60000); assert.equal(readRetryAfter("invalid", new Date()), 0);
});
test("task filters are server-side, scoped and reject invalid UTC dates", () => {
  const w = taskFilters(scope, new URLSearchParams({ sellerAccountId: "store", marketplaceId: "US", status: "FAILED", from: "2026-11-01", to: "2026-11-04" }));
  assert.equal(w.organizationId, "org"); assert.equal(w.executionVersion, 2); assert.equal(w.status, "FAILED"); assert.ok(w.source);
  assert.throws(() => taskFilters(scope, new URLSearchParams({ from: "2026-02-31" })));
});
test("task DTO excludes checkpoint, lease and dispatch secrets", () => {
  const row = { id: "task", sourceId: "source", resource: "inventory", status: "RUNNING", stage: "FETCHING", trigger: "manual", mode: "snapshot", scheduleId: null, scheduleRevision: null, startedAt: new Date(), executionStartedAt: null, finishedAt: null, pagesCompleted: 0, processedCount: 0, insertedCount: 0, updatedCount: 0, skippedCount: 0, apiRequests: 0, throttles: 0, attempts: 1, maxAttempts: 3, error: null, control: null, nextAttemptAt: new Date(), summary: null, checkpointCiphertext: "sensitive", leaseOwner: "private", dispatchVersion: 3 };
  assert.ok(!JSON.stringify(taskSummary(row)).includes("sensitive")); assert.ok(!("leaseOwner" in taskSummary(row)));
});

test("official source update timestamps remain distinct from synchronization time", () => {
  assert.equal(sourceTimestamp("2026-11-01T00:00:00Z")?.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(sourceTimestamp(undefined), null);
  assert.throws(() => sourceTimestamp("not-a-date"));
});
