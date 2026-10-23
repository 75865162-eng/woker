import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { refreshDueReplenishmentPlans } from "@/lib/operations/replenishment-service";

test("plan persistence keeps exact inventory provenance, newer results and new-product failure identity", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previousClient = globals.prisma;
  const previousUrl = process.env.DATABASE_URL;
  const older = new Date("2026-10-23T00:00:00Z");
  const newer = new Date("2026-10-23T00:01:00Z");
  const policy = {
    id: "policy", enabled: true, organizationId: "org", workspaceId: "ws", sellerAccountId: "store",
    marketplaceId: "market", sellerSku: "sku", updatedAt: new Date("2026-10-22T00:00:00Z"),
    inputs: { lifecycle: "NEW", newProductDailyUnits: 2, productionDays: 1, domesticDays: 1, oceanDays: 1, sourceNote: "confirmed trial demand" },
  };
  type Saved = { generatedAt: Date; policyUpdatedAt: Date; inventoryRunId: string | null; result: { lifecycle: string; status: string }; lastError: string | null };
  let saved: Saved | null = null;
  let successfulRunReads = 0;
  let fail = false;
  let releaseOlder = () => {};
  let notifyStarted = () => {};
  const olderStarted = new Promise<void>((resolve) => { notifyStarted = resolve; });
  const olderGate = new Promise<void>((resolve) => { releaseOlder = resolve; });
  let delayNextInventoryRead = false;
  const database = {
    $queryRaw: async () => [{ id: policy.id }],
    $executeRaw: async () => 1,
    $transaction: async (callback: (tx: unknown) => Promise<void>) => callback(database),
    amazonReplenishmentPolicy: { findUnique: async () => policy },
    amazonReplenishmentPlan: {
      findUnique: async () => saved,
      upsert: async ({ update }: { update: Saved }) => { saved = update; return update; },
    },
    amazonSyncRun: {
      findFirst: async ({ where }: { where: { resource: string } }) => {
        if (where.resource === "catalog") return null;
        successfulRunReads += 1;
        return { id: "inventory-run-actually-read" };
      },
      findMany: async () => [],
    },
    amazonCatalogSnapshot: { findMany: async () => [] },
    amazonInventorySnapshot: { findMany: async () => {
      if (delayNextInventoryRead) { delayNextInventoryRead = false; notifyStarted(); await olderGate; }
      if (fail) throw new Error("database unavailable");
      return [{ sellerAccountId: "store", marketplaceId: "market", sellerSku: "sku", asin: "ASIN", syncRunId: "inventory-run-actually-read", capturedAt: new Date(), fulfillableQuantity: 20, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: 0, unfulfillableQuantity: 0 }];
    } },
  };
  globals.prisma = database as unknown as PrismaClient;
  process.env.DATABASE_URL = "postgresql://unused-test-stub";
  try {
    delayNextInventoryRead = true;
    const slower = refreshDueReplenishmentPlans(older);
    await olderStarted;
    await refreshDueReplenishmentPlans(newer);
    releaseOlder();
    await slower;
    const current = saved as Saved | null;
    assert.equal(current?.generatedAt.getTime(), newer.getTime(), "slower earlier calculation must not overwrite the newer plan");
    assert.equal(current?.inventoryRunId, "inventory-run-actually-read");
    assert.equal(successfulRunReads, 2, "one inventory-run lookup per calculation; no second latest-run lookup");
    fail = true;
    await refreshDueReplenishmentPlans(new Date(newer.getTime() + 60_000));
    const failed = saved as Saved | null;
    assert.equal(failed?.result.lifecycle, "NEW");
    assert.equal(failed?.result.status, "NEEDS_DATA");
    assert.equal(failed?.inventoryRunId, null, "failure must not retain a previous input run reference");
    assert.ok(failed?.lastError);
  } finally {
    releaseOlder();
    globals.prisma = previousClient;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
