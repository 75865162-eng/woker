import test from "node:test";
import assert from "node:assert/strict";
import { syncCenterEnabled, syncDomains, incrementalFailureCode, parseSyncPlan, officialEndpoint, retryDelay, SyncInputError } from "@/lib/amazon-sync/policy";
import { encryptCheckpoint, decryptCheckpoint } from "@/lib/amazon-sync/checkpoint";
import { encryptAmazonSpApiCredentials, decryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { inventoryPublishedWhere, catalogPublishedWhere, taskSummary, incrementalOperatorAction, taskFilters, sourceHealth } from "@/lib/amazon-sync/read";
import { validateInventoryPage, validateCatalogCompletion, classifySyncFailure, sourceTimestamp } from "@/lib/amazon-sync/processor";
import { AmazonSpApiError, readRetryAfter } from "@/lib/amazon/sp-api-client";
import { automaticResources, automaticBackfillDays, automaticInventoryEventBackfillDays, automaticReportDiscoveryDays, nextAutomaticInventoryEventWindow, nextAutomaticSettlementDiscovery } from "@/lib/amazon-sync/automatic-schedule";
const scope = { organizationId: "org", workspaceId: "ws" };
test("sync center defaults off and requires an exact organization/workspace pair", () => {
  assert.equal(syncCenterEnabled(scope, "[]"), false); assert.equal(syncCenterEnabled(scope, "*"), false);
  assert.equal(syncCenterEnabled(scope, '[["other","ws"]]'), false);
  assert.equal(syncCenterEnabled(scope, '[["org","ws"]]'), true);
});
test("data domain catalog has explicit execution and planning metadata", () => {
  assert.ok(syncDomains.length >= 10);
  for (const domain of syncDomains) {
    assert.ok(domain.id && domain.name && domain.group && domain.api && domain.nextStep);
    assert.ok(["snapshot", "incremental", "report", "external"].includes(domain.mode));
    assert.ok(["verified", "pending", "separate"].includes(domain.authorization));
    assert.ok(Number.isInteger(domain.frequency) && domain.frequency > 0);
    assert.ok(Number.isInteger(domain.priority) && domain.priority >= 1 && domain.priority <= 4);
  }
  assert.deepEqual(syncDomains.filter(domain => domain.implemented).map(domain => domain.id).sort(), ["brand_analytics", "buy_box_history", "catalog", "catalog_items", "finance", "fulfillment", "inventory", "inventory_age", "inventory_events", "listing_details", "notifications", "orders", "pricing", "reimbursements", "returns", "sales_traffic", "settlements"]);
});
test("plans reject unimplemented domains, incremental modes and invalid scope/frequency", () => {
  const p = { name: "inventory", resource: "inventory", enabled: false, intervalMinutes: 60, sourceIds: ["one"] };
  assert.equal(parseSyncPlan(p).mode, "snapshot");
  assert.equal(parseSyncPlan({ ...p, resource: "orders", mode: "incremental" }).mode, "incremental");
  assert.equal(parseSyncPlan({ ...p, resource: "finance", mode: "incremental" }).mode, "incremental");
  assert.equal(parseSyncPlan({ ...p, resource: "sales_traffic", mode: "date_range" }).mode, "date_range");
  for (const patch of [{ intervalMinutes: 0 }, { mode: "incremental" }, { sourceIds: [] }, { sourceIds: ["one", "one"] }, { maxAttempts: 11 }, { retentionDays: -1 }]) assert.throws(() => parseSyncPlan({ ...p, ...patch }), SyncInputError);
  assert.equal(parseSyncPlan({ ...p, resource: "returns" }).mode, "incremental");
  assert.equal(parseSyncPlan({ ...p, resource: "inventory_events" }).mode, "incremental");
});
test("automatic sync covers only executable resources and keeps each API's historical limits", () => {
  assert.equal(automaticBackfillDays, 730);
  assert.equal(automaticInventoryEventBackfillDays, 540);
  assert.equal(automaticReportDiscoveryDays, 90);
  for (const resource of ["returns", "inventory_events", "settlements", "reimbursements", "inventory_age", "fulfillment", "listing_details", "catalog_items", "pricing", "brand_analytics", "buy_box_history", "notifications"]) assert.ok((automaticResources as readonly string[]).includes(resource));
  const now = new Date("2026-11-06T12:00:00.000Z");
  const first = nextAutomaticInventoryEventWindow(null, now)!;
  assert.equal(first.from, "2025-05-15");
  assert.equal(first.to, "2025-06-14");
  assert.equal(Date.parse(`${first.to}T00:00:00Z`) - Date.parse(`${first.from}T00:00:00Z`), 30 * 86400000);
  const next = nextAutomaticInventoryEventWindow({ watermarkFrom: new Date("2025-05-16T00:00:00Z"), watermarkTo: new Date("2025-06-15T23:59:59Z"), status: "SUCCEEDED" }, now)!;
  assert.equal(next.from, "2025-06-16"); assert.equal(next.to, "2025-07-16");
  assert.equal(nextAutomaticInventoryEventWindow({ watermarkFrom: new Date("2026-11-05T00:00:00Z"), watermarkTo: new Date("2026-11-05T23:59:59Z"), status: "SUCCEEDED" }, now), null);
  const report = nextAutomaticSettlementDiscovery(now);
  assert.equal(Date.parse(report.createdUntil) - Date.parse(report.createdSince), 89 * 86400000);
  assert.deepEqual(report.retentionGap, { from: new Date(now.getTime() - 90 * 86400000).toISOString(), to: report.createdSince, reason: "QUEUE_MARGIN", complete: false });
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
  assert.equal(sourceTimestamp(""), null);
  assert.throws(() => sourceTimestamp("not-a-date"));
});

test("LWA invalid grant classification blocks automatic retries", () => {
  const failure = classifySyncFailure(new AmazonSpApiError("sensitive upstream", { status: 400, authorizationRejected: true }));
  assert.equal(failure.code, "AUTH"); assert.equal(failure.retryable, false); assert.ok(!failure.message.includes("sensitive upstream"));
});

test("Listings reported totals cannot be published as a truncated complete snapshot", () => {
  assert.throws(() => validateCatalogCompletion({ numberOfResults: 1500 }, 1000, false), /未覆盖/);
  assert.doesNotThrow(() => validateCatalogCompletion({ numberOfResults: 25 }, 20, true));
  assert.doesNotThrow(() => validateCatalogCompletion({ numberOfResults: 25 }, 25, false));
  assert.doesNotThrow(() => validateCatalogCompletion({ numberOfResults: 0 }, 0, false));
  assert.throws(() => validateCatalogCompletion({ numberOfResults: "25" }, 25, false), /总数无效/);
});

test("conflicting duplicates and malformed duplicate quantities cannot publish as a complete snapshot", async () => {
  const { assertConsistentSnapshotRows, validateCatalogPage } = await import("@/lib/amazon-sync/processor");
  const details = { fulfillableQuantity: 1, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: 0, unfulfillableQuantity: 0, researchingQuantity: 0 };
  const item = { sellerSku: "SKU", condition: "NewItem", inventoryDetails: details };
  assert.equal(validateInventoryPage({ inventorySummaries: [item, item] }).rows.length, 1);
  assert.throws(() => validateInventoryPage({ inventorySummaries: [item, { ...item, inventoryDetails: { ...details, fulfillableQuantity: 99 } }] }), /冲突/);
  assert.throws(() => validateInventoryPage({ inventorySummaries: [item, { ...item, inventoryDetails: {} }] }), /不能补零/);
  assert.throws(() => validateInventoryPage({ inventorySummaries: [{ ...item, sellerSku: "x".repeat(501) }] }), /截断/);
  const staged = { sellerSku: "SKU", condition: "NewItem", ...details, sourceUpdatedAt: new Date("2026-11-01T00:00:00Z") };
  assert.doesNotThrow(() => assertConsistentSnapshotRows([staged, { ...staged, capturedAt: new Date() }], "inventory"));
  assert.throws(() => assertConsistentSnapshotRows([staged, { ...staged, fulfillableQuantity: 2 }], "inventory"), /冲突/);
  assert.throws(() => validateCatalogPage({ items: [{ sku: "SKU", summaries: [{ marketplaceId: "OTHER" }] }] }, "US"), /站点摘要/);
  assert.throws(() => validateCatalogPage({ items: [{ sku: "SKU", summaries: [{ marketplaceId: "US", status: [1] }] }] }, "US"), /状态/);
});

test("snapshot SKU/ASIN and explicit observation date filters are database predicates", async () => {
  const { snapshotRowFilters } = await import("@/lib/amazon-sync/snapshot-query");
  const filters = snapshotRowFilters(new URLSearchParams({ sku: "SKU", asin: "B0", from: "2026-11-01", to: "2026-11-02", dateField: "sourceUpdatedAt" }));
  assert.deepEqual(filters.sellerSku, { contains: "SKU", mode: "insensitive" });
  assert.equal((filters.sourceUpdatedAt as { lt: Date }).lt.toISOString(), "2026-11-03T00:00:00.000Z");
  assert.throws(() => snapshotRowFilters(new URLSearchParams({ dateField: "orderDate" })));
  assert.throws(() => snapshotRowFilters(new URLSearchParams({ from: "2026-02-30" })));
  for (const pagination of [null, false, [], ""]) assert.throws(() => validateInventoryPage({ inventorySummaries: [], pagination }));
});

test("incremental operator guidance and error codes distinguish resources without changing legacy codes", () => {
  assert.equal(incrementalFailureCode("orders", 403), "ORDER_ROLE_OR_SCOPE");
  assert.equal(incrementalFailureCode("finance", 400), "FINANCE_VALIDATION");
  assert.equal(incrementalFailureCode("returns", 403), "RETURN_ROLE_OR_SCOPE");
  for (const resource of ["orders", "finance", "returns"]) {
    assert.match(incrementalOperatorAction(resource, "BLOCKED")!, /审批/);
    assert.match(incrementalOperatorAction(resource, "FAILED")!, /人工核查/);
    assert.equal(incrementalOperatorAction(resource, "SUCCEEDED"), null);
  }
  assert.equal(incrementalOperatorAction("inventory", "FAILED"), null);
});
