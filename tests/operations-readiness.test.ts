import assert from "node:assert/strict";
import test from "node:test";
import { buildBlockedAmazonSyncRun, buildDomainFreshnessSummaries, emptyDomainFreshnessSummaries, extractMarketplaceParticipations, inventorySnapshotStatus, normalizeSyncIdempotencyKey } from "@/lib/operations/readiness";
import { isAmazonSyncResource } from "@/lib/operations/types";
import { getAmazonSpApiConfigurationStatus } from "@/lib/amazon/sp-api-config";

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

test("domain freshness keeps PPC unconnected and reports failed unsupported attempts", () => {
  const inventory = {
    status: "FRESH" as const,
    syncRunId: "inventory-run",
    capturedAt: "2026-10-22T07:00:00.000Z",
    snapshotCount: 1,
    fulfillableQuantity: 4,
    inboundQuantity: 2,
    reservedQuantity: 1,
    unfulfillableQuantity: 0,
  };
  const latestByDomain = new Map([
    ["finance" as const, {
      latestAttempt: { id: "finance-run", status: "FAILED", error: "未实现执行器", startedAt: new Date("2026-10-21T08:00:00.000Z"), finishedAt: new Date("2026-10-21T08:01:00.000Z") },
      latestSuccess: null,
    }],
  ]);
  const summaries = buildDomainFreshnessSummaries({
    inventory,
    latestByDomain,
  });

  assert.equal(summaries.ads.status, "NOT_SYNCED");
  assert.match(summaries.ads.reason ?? "", /PPC/);
  assert.equal(summaries.finance.status, "FAILED");
  assert.equal(summaries.finance.lastAttemptStatus, "FAILED");
  assert.equal(summaries.inventory.status, "FRESH");
});


test("persisted marketplace mapping remains usable by inventory worker", () => {
  const mapping = [{ marketplaceId: "ATVPDKIKX0DER", countryCode: "US", name: "Amazon.com", domainName: "www.amazon.com" }];
  assert.deepEqual(extractMarketplaceParticipations({ payload: mapping }), mapping);
});
