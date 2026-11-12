import test from "node:test";
import assert from "node:assert/strict";
import { nextFinanceHistoryGap } from "@/lib/amazon-sync/automatic-finance-history";
import { automaticAdapter } from "@/lib/amazon-sync/automatic-adapters";
import { planAutomaticTask } from "@/lib/amazon-sync/automatic-planner";

test("Finance history selects only internal holes and caps each repair window", () => {
  const gap = nextFinanceHistoryGap("2025-01-01T00:00:00.000Z", "2025-07-01T00:00:00.000Z", [
    { from: "2025-01-01T00:00:00.000Z", to: "2025-02-01T00:00:00.000Z" },
    { from: "2025-03-15T00:00:00.000Z", to: "2025-04-01T00:00:00.000Z" },
    { from: "2025-05-01T00:00:00.000Z", to: "2025-07-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(gap, { from: "2025-02-01T00:00:00.000Z", to: "2025-03-03T00:00:00.000Z" });
  assert.equal(nextFinanceHistoryGap("2025-01-01T00:00:00.000Z", "2025-04-01T00:00:00.000Z", [
    { from: "2025-02-01T00:00:00.000Z", to: "2025-04-01T00:00:00.000Z" },
  ]), null, "an uncovered prefix is handled by the regular forward cursor");
  assert.equal(nextFinanceHistoryGap("2025-01-01T00:00:00.000Z", "2025-04-01T00:00:00.000Z", [
    { from: "2025-01-01T00:00:00.000Z", to: "2025-02-01T00:00:00.000Z" },
    { from: "bad", to: "2025-03-01T00:00:00.000Z" },
  ]), null, "invalid evidence cannot create a later island");
});

test("Finance planner freezes an internal history window without replacing the forward watermark", async () => {
  const adapter = automaticAdapter("finance")!;
  const now = new Date("2026-11-11T12:00:00.000Z"), marketplaceId = "ATVPDKIKX0DER";
  const scope = { organizationId: "fixture-org", workspaceId: "default" };
  const source = {
    id: "finance-source", resource: "finance", revision: 2, authorizationId: "finance-auth", sellerAccountId: "seller-account", marketplaceId,
    authorization: { revision: 3, status: "CONFIGURED", amazonSellerId: "FIXTURESELLER", identityVerifiedAt: now },
    financePolicy: adapter.createSellerPolicy!({ now, initialFrom: "2024-11-11T12:00:00.000Z", applicationId: "fixture-app", marketplaces: [{ marketplaceId, marketplaceTimeZone: "America/Los_Angeles" }] }).financePolicy,
    resourceCursor: { watermarkFrom: new Date("2026-10-01T00:00:00.000Z"), watermarkTo: new Date("2026-11-10T00:00:00.000Z"), status: "SUCCEEDED" },
  } as unknown as Parameters<typeof planAutomaticTask>[2];
  const plan = { id: "finance-plan", revision: 1, maxAttempts: 3, priority: 1, intervalMinutes: 1440 };
  const planned = await planAutomaticTask(adapter, scope, source, plan, now, {
    readDayHistory: async () => [],
    readFinanceHistory: async () => [
      { from: "2024-11-11T12:00:00.000Z", to: "2025-06-01T00:00:00.000Z" },
      { from: "2025-07-15T00:00:00.000Z", to: "2026-11-10T00:00:00.000Z" },
    ],
  });
  assert.equal(planned?.payload.financeHistoryReplay, true);
  assert.deepEqual(planned?.payload.financeWindow, { from: "2025-06-01T00:00:00.000Z", to: "2025-07-01T00:00:00.000Z" });
  assert.equal(planned?.backfill, true);
  assert.deepEqual(source.resourceCursor, { watermarkFrom: new Date("2026-10-01T00:00:00.000Z"), watermarkTo: new Date("2026-11-10T00:00:00.000Z"), status: "SUCCEEDED" });
});

test("Orders planner schedules a bounded internal hole as replay and leaves the forward watermark alone", async () => {
  const adapter = automaticAdapter("orders")!, now = new Date("2026-11-11T12:00:00.000Z"), marketplaceId = "ATVPDKIKX0DER";
  const scope = { organizationId: "fixture-org", workspaceId: "default" };
  const policy = adapter.createMarketplacePolicy!({ now, initialFrom: "2026-10-01T00:00:00.000Z", applicationId: "fixture-app", marketplaceId, marketplaceTimeZone: "Etc/UTC" }).orderPolicy;
  const source = {
    id: "orders-source", resource: "orders", revision: 2, authorizationId: "orders-auth", sellerAccountId: "seller-account", marketplaceId,
    authorization: { revision: 3, status: "CONFIGURED", amazonSellerId: "FIXTURESELLER", identityVerifiedAt: now }, orderPolicy: policy,
    resourceCursor: { watermarkFrom: new Date("2026-11-01T00:00:00.000Z"), watermarkTo: new Date("2026-11-10T00:00:00.000Z"), status: "SUCCEEDED" },
  } as unknown as Parameters<typeof planAutomaticTask>[2];
  const planned = await planAutomaticTask(adapter, scope, source, { id: "orders-plan", revision: 1, maxAttempts: 3, priority: 1, intervalMinutes: 1440 }, now, {
    readDayHistory: async () => [], readFinanceHistory: async () => [],
    readOrderHistory: async () => [
      { from: "2026-10-01T00:00:00.000Z", to: "2026-10-10T00:00:00.000Z" },
      { from: "2026-10-20T00:00:00.000Z", to: "2026-11-10T00:00:00.000Z" },
    ],
  });
  assert.equal(planned?.payload.orderHistoryReplay, true);
  assert.deepEqual(planned?.payload.orderWindow, { from: "2026-10-10T00:00:00.000Z", to: "2026-10-11T00:00:00.000Z" });
  assert.equal(planned?.backfill, true);
  assert.equal(source.resourceCursor!.watermarkTo.toISOString(), "2026-11-10T00:00:00.000Z");
});

test("Returns planner schedules a bounded internal report gap as replay", async () => {
  const adapter = automaticAdapter("returns")!, now = new Date("2026-11-11T12:00:00.000Z"), marketplaceId = "ATVPDKIKX0DER";
  const scope = { organizationId: "fixture-org", workspaceId: "default" };
  const policy = adapter.createMarketplacePolicy!({ now, initialFrom: "2026-10-01T00:00:00.000Z", applicationId: "fixture-app", marketplaceId, marketplaceTimeZone: "Etc/UTC" }).returnsPolicy;
  const source = {
    id: "returns-source", resource: "returns", revision: 2, authorizationId: "returns-auth", sellerAccountId: "seller-account", marketplaceId,
    authorization: { revision: 3, status: "CONFIGURED", amazonSellerId: "FIXTURESELLER", identityVerifiedAt: now }, returnsPolicy: policy,
    resourceCursor: { watermarkFrom: new Date("2026-11-01T00:00:00.000Z"), watermarkTo: new Date("2026-11-10T00:00:00.000Z"), status: "SUCCEEDED" },
  } as unknown as Parameters<typeof planAutomaticTask>[2];
  const planned = await planAutomaticTask(adapter, scope, source, { id: "returns-plan", revision: 1, maxAttempts: 3, priority: 1, intervalMinutes: 1440 }, now, {
    readDayHistory: async () => [], readFinanceHistory: async () => [],
    readReturnHistory: async () => [
      { from: "2026-10-01T00:00:00.000Z", to: "2026-10-10T00:00:00.000Z" },
      { from: "2026-10-20T00:00:00.000Z", to: "2026-11-10T00:00:00.000Z" },
    ],
  });
  assert.equal(planned?.payload.returnHistoryReplay, true);
  assert.deepEqual(planned?.payload.returnWindow, { from: "2026-10-10T00:00:00.000Z", to: "2026-10-20T00:00:00.000Z" });
  assert.equal(source.resourceCursor!.watermarkTo.toISOString(), "2026-11-10T00:00:00.000Z");
});
