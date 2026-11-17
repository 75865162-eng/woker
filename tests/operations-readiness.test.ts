import assert from "node:assert/strict";
import test from "node:test";
import { buildBlockedAmazonSyncRun, emptyDomainFreshnessSummaries, extractMarketplaceParticipations, inventorySnapshotStatus, normalizeSyncIdempotencyKey } from "@/lib/operations/readiness";
import { isAmazonSyncResource } from "@/lib/operations/types";
import { getAmazonSpApiConfigurationStatus } from "@/lib/amazon/sp-api-config";

test("未同步库存和聚合缺字段保留未知，真实零与完整入库总数保留", async () => {
  const { emptyInventorySummary } = await import('@/lib/operations/readiness');
  const { compatibilityInventoryQuantities } = await import('@/lib/amazon-sync/compatibility');
  const unknown = { fulfillableQuantity: null, inboundQuantity: null, reservedQuantity: null, unfulfillableQuantity: null };
  const { fulfillableQuantity, inboundQuantity, reservedQuantity, unfulfillableQuantity } = emptyInventorySummary();
  assert.deepEqual({ fulfillableQuantity, inboundQuantity, reservedQuantity, unfulfillableQuantity }, unknown);
  assert.deepEqual(compatibilityInventoryQuantities(null), unknown);
  assert.deepEqual(compatibilityInventoryQuantities({ fulfillableQuantity: null, inboundWorkingQuantity: null, inboundShippedQuantity: null, inboundReceivingQuantity: null, reservedQuantity: null, unfulfillableQuantity: null }), unknown);
  const zero = { fulfillableQuantity: 0, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: 0, unfulfillableQuantity: 0 };
  assert.deepEqual(compatibilityInventoryQuantities(zero), { fulfillableQuantity: 0, inboundQuantity: 0, reservedQuantity: 0, unfulfillableQuantity: 0 });
  assert.equal(compatibilityInventoryQuantities({ ...zero, inboundWorkingQuantity: 3, inboundShippedQuantity: 2 }).inboundQuantity, 5);
  for (const field of ['inboundWorkingQuantity', 'inboundShippedQuantity', 'inboundReceivingQuantity']) {
    assert.equal(compatibilityInventoryQuantities({ ...zero, [field]: null }).inboundQuantity, null);
  }
});

test("rejects unsupported Amazon sync resources", () => {
  assert.equal(isAmazonSyncResource("ads"), true);
  assert.equal(isAmazonSyncResource("inventory"), true);
  assert.equal(isAmazonSyncResource("pricing-write"), false);
});

test("blocked Amazon sync runs state that no external request occurred", () => {
  const now = new Date("2026-10-22T08:00:00.000Z");
  const run = buildBlockedAmazonSyncRun({ id: "run-1", resource: "ads", now });

  assert.equal(run.status, "BLOCKED");
  assert.equal(run.error?.includes("未向 Amazon 发起同步请求"), true);
  assert.deepEqual(run.summary, { externalRequestAttempted: false, provider: "amazon_sp_api" });
  assert.equal(run.finishedAt, now.toISOString());
});

test("SP-API configuration diagnostics expose names but never secret values", () => {
  const missing = getAmazonSpApiConfigurationStatus({ AMAZON_SP_API_LWA_CLIENT_ID: "client" });
  assert.equal(missing.configured, false);
  assert.equal(missing.missingEnvironmentVariables.includes("AMAZON_SP_API_LWA_CLIENT_SECRET"), true);

  const configured = getAmazonSpApiConfigurationStatus({
    AMAZON_SP_API_LWA_CLIENT_ID: "client",
    AMAZON_SP_API_LWA_CLIENT_SECRET: "secret",
    AMAZON_SP_API_REFRESH_TOKEN: "refresh",
    AMAZON_SP_API_AWS_ACCESS_KEY_ID: "access",
    AMAZON_SP_API_AWS_SECRET_ACCESS_KEY: "aws-secret",
  });
  assert.deepEqual(configured, { configured: true, missingEnvironmentVariables: [], region: "us-east-1" });
});

test("sync idempotency keys are bounded and use a machine-safe alphabet", () => {
  assert.equal(normalizeSyncIdempotencyKey(" daily:inventory_2026-10-22 "), "daily:inventory_2026-10-22");
  assert.throws(() => normalizeSyncIdempotencyKey("contains whitespace"));
  assert.throws(() => normalizeSyncIdempotencyKey("x".repeat(161)));
});

test("marketplace participations retain only non-secret site mapping metadata", () => {
  const participations = extractMarketplaceParticipations({
    payload: [
      { marketplace: { id: "ATVPDKIKX0DER", countryCode: "us", name: "Amazon.com", domainName: "www.amazon.com", secret: "never-store" } },
      { marketplace: { id: "ATVPDKIKX0DER", countryCode: "US", name: "Duplicate" } },
      { marketplace: { countryCode: "CA" } },
    ],
  });
  assert.deepEqual(participations, [{ marketplaceId: "ATVPDKIKX0DER", countryCode: "US", name: "Amazon.com", domainName: "www.amazon.com" }]);
});

test("inventory freshness is explicit and bounded by the configured window", () => {
  const now = new Date("2026-10-22T08:00:00.000Z");
  assert.equal(inventorySnapshotStatus(null, now, 60), "NOT_SYNCED");
  assert.equal(inventorySnapshotStatus(new Date("2026-10-22T07:30:00.000Z"), now, 60), "FRESH");
  assert.equal(inventorySnapshotStatus(new Date("2026-10-22T06:59:59.000Z"), now, 60), "STALE");
});

test("operations readiness exposes six domains and keeps unimplemented domains unsynced", () => {
  const inventory = {
    status: "NOT_SYNCED" as const,
    syncRunId: null,
    capturedAt: null,
    snapshotCount: 0,
    fulfillableQuantity: 0,
    inboundQuantity: 0,
    reservedQuantity: 0,
    unfulfillableQuantity: 0,
  };
  const summaries = emptyDomainFreshnessSummaries(inventory);

  assert.deepEqual(Object.keys(summaries).sort(), ["ads", "catalog", "finance", "fulfillment", "inventory", "orders"]);
  assert.equal(summaries.inventory.status, "NOT_SYNCED");
  assert.equal(summaries.orders.status, "NOT_SYNCED");
  assert.match(summaries.orders.reason ?? "", /尚未接入/);
});

test("兼容就绪投影只聚合中心状态且部分成功不冒充最新", async () => {
  const { aggregateCenterHealth } = await import("@/lib/amazon-sync/compatibility");
  assert.equal(aggregateCenterHealth([]), "NOT_SYNCED");
  assert.equal(aggregateCenterHealth(["FRESH", "FRESH"]), "FRESH");
  assert.equal(aggregateCenterHealth(["FRESH", "PARTIAL_SUCCESS"]), "FAILED");
  assert.equal(aggregateCenterHealth(["STALE", "SYNCING"]), "SYNCING");
  assert.equal(aggregateCenterHealth(["SYNCING", "BLOCKED"]), "BLOCKED");
  assert.equal(aggregateCenterHealth(["FRESH", "unknown"]), "NOT_SYNCED");
});

test("同步中心健康状态是就绪页的唯一来源", async () => {
  const { sourceHealth } = await import("@/lib/amazon-sync/read");
  const source = { enabled: true, lastSuccessAt: new Date(), freshnessMinutes: 60, activeRunId: "published", authorization: { status: "CONFIGURED" }, seller: { status: "active" } };
  assert.equal(sourceHealth(source), "FRESH");
  assert.equal(sourceHealth({ ...source, lastSuccessAt: new Date(0) }), "STALE");
  assert.equal(sourceHealth({ ...source, activeRunId: null }), "NOT_SYNCED");
  for (const status of ["RUNNING", "QUEUED", "WAITING", "RETRY_WAIT"]) assert.equal(sourceHealth(source, status), "SYNCING");
  for (const status of ["FAILED", "BLOCKED", "PARTIAL_SUCCESS"]) assert.equal(sourceHealth(source, status), status);
  assert.equal(sourceHealth({ ...source, enabled: false }, "RUNNING"), "DISABLED");
  assert.equal(sourceHealth({ ...source, authorization: { status: "ERROR" } }, "RUNNING"), "BLOCKED");
});


test("persisted marketplace mapping remains usable by inventory worker", () => {
  const mapping = [{ marketplaceId: "ATVPDKIKX0DER", countryCode: "US", name: "Amazon.com", domainName: "www.amazon.com" }];
  assert.deepEqual(extractMarketplaceParticipations({ payload: mapping }), mapping);
});
