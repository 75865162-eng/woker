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


test("Sellfox plans use complete daily MSKU sales and current inventory, never profit or Amazon fallback", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previousClient = globals.prisma;
  const previousUrl = process.env.DATABASE_URL;
  let now = new Date("2026-10-25T00:00:00Z");
  const policy = {
    id: "policy", enabled: true, organizationId: "org", workspaceId: "ws", sellerAccountId: "seller",
    marketplaceId: "ATVPDKIKX0DER", sellerSku: "EXACT-MSKU", updatedAt: new Date("2026-10-24T00:00:00Z"),
    inputs: { lifecycle: "MATURE", productionDays: 1, domesticDays: 1, oceanDays: 1, sourceNote: "verified store mapping",
      historicalSource: { storeId: "tk-us" }, salesHistory: [{ date: "2026-10-01", units: 999 }] },
  };
  type Saved = { inventoryRunId: string | null; generatedAt: Date; policyUpdatedAt: Date;
    inputSnapshot: { inventorySource: string | null; inventory: { storeId: string }; inputs: { salesHistory: unknown[] } };
    result: { status: string; dailyDemand: number | null; inventorySource: string }; lastError: string | null };
  let saved: Saved | null = null;
  let missingDay = false;
  let incomplete = false;
  let missingInventory = false;
  let invalidStore = false;
  let salesReads = 0;
  const database = {
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      const query = sql.join("?");
      if (query.includes('FROM "AmazonReplenishmentPolicy"')) return [{ id: policy.id }];
      assert.ok(values.includes("org") && values.includes("ws") && values.includes("tk-us") && values.includes("EXACT-MSKU"));
      if (query.includes("FROM sellfox_sales_daily")) {
        salesReads += 1;
        assert.match(query, /msku = \?/);
        assert.match(query, /complete = true/);
        return Array.from({ length: missingDay ? 27 : 28 }, (_, i) => ({
          reportDate: new Date(Date.parse("2026-10-25") - (i + 1) * 86400000).toISOString().slice(0, 10),
          msku: "EXACT-MSKU", sku: "", quantity: 10, complete: !(incomplete && i === 0),
        }));
      }
      assert.match(query, /FROM sellfox_inventory_current/);
      assert.match(query, /msku = \?/);
      return [{ available: missingInventory ? null : 50, inbound: null, capturedAt: missingInventory ? null : now }];
    },
    $executeRaw: async () => 1,
    $transaction: async (callback: (tx: unknown) => Promise<void>) => callback(database),
    sellfoxStore: { findFirst: async ({ where }: { where: unknown }) => {
      assert.deepEqual(where, { id: "tk-us", organizationId: "org", workspaceId: "ws" });
      return invalidStore ? null : { id: "tk-us", externalId: "124687" };
    } },
    amazonReplenishmentPolicy: { findUnique: async () => policy },
    amazonReplenishmentPlan: {
      findUnique: async () => saved,
      upsert: async ({ update }: { update: Saved }) => { saved = update; return update; },
    },
    // No Amazon snapshot or profit delegate: any accidental fallback makes the plan fail.
  };
  globals.prisma = database as unknown as PrismaClient;
  process.env.DATABASE_URL = "postgresql://unused-test-stub";
  const refresh = async () => { now = new Date(now.getTime() + 60_000); await refreshDueReplenishmentPlans(now); return saved as Saved | null; };
  try {
    let plan = await refresh();
    assert.equal(plan?.result.status, "READY", "empty internal SKU must not discard exact MSKU sales");
    assert.equal(plan?.result.dailyDemand, 10);
    assert.equal(plan?.result.inventorySource, "sellfox_inventory_current");
    assert.equal(plan?.inputSnapshot.inventorySource, "sellfox_inventory_current");
    assert.equal(plan?.inputSnapshot.inventory.storeId, "tk-us");
    assert.equal(plan?.inventoryRunId, null);
    missingDay = true;
    plan = await refresh();
    assert.equal(plan?.result.status, "NEEDS_DATA");
    assert.equal(plan?.result.dailyDemand, null);
    assert.equal(plan?.inputSnapshot.inputs.salesHistory.length, 27);
    missingDay = false; incomplete = true;
    assert.equal((await refresh())?.result.status, "NEEDS_DATA");
    incomplete = false; missingInventory = true;
    assert.equal((await refresh())?.result.status, "NEEDS_DATA", "no Amazon fallback when current is empty");
    invalidStore = true;
    assert.ok((await refresh())?.lastError);
    const reads = salesReads;
    policy.sellerSku = " ";
    assert.equal((await refresh())?.result.status, "NEEDS_DATA");
    assert.equal(salesReads, reads, "blank MSKU must not query or match blank identities");
  } finally {
    globals.prisma = previousClient;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
