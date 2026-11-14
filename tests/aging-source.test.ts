import assert from "node:assert/strict";
import test from "node:test";
import { agingFromEstimate, readSkuAgingFacts } from "@/lib/operations/aging-source";

const bands = (overrides: Record<string, number> = {}) => ({
  days0To30: "0",
  days30To60: "0",
  days60To90: "0",
  days90To180: "0",
  days180To365: "0",
  days365Plus: "0",
  ...overrides,
});

test("aging falls back to the oldest occupied band lower bound", () => {
  assert.deepEqual(agingFromEstimate(bands({ days0To30: "120" })), { agingDays: 0, weightedAgeDays: 15 });
  assert.deepEqual(agingFromEstimate(bands({ days0To30: "40", days90To180: "10" })), { agingDays: 90, weightedAgeDays: 39 });
  assert.deepEqual(agingFromEstimate(bands({ days365Plus: "3" })), { agingDays: 365, weightedAgeDays: 400 });
});

test("aging is quantity weighted, not band-position weighted", () => {
  const result = agingFromEstimate(bands({ days0To30: "300", days180To365: "100" }));
  assert.equal(result.agingDays, 180);
  assert.equal(result.weightedAgeDays, 78.75);
});

test("zero or unreadable bands never become an age", () => {
  assert.deepEqual(agingFromEstimate(bands()), { agingDays: null, weightedAgeDays: null });
  assert.deepEqual(agingFromEstimate({ ...bands(), days60To90: null }), { agingDays: null, weightedAgeDays: null });
  assert.deepEqual(agingFromEstimate(null), { agingDays: null, weightedAgeDays: null });
});

type Snapshot = { id: string; warehouseId: string; snapshotDate: Date; capturedAt: Date; records: unknown[] };

function fakeDb(input: { listings: Array<{ sku: string; productRecordId: string }>; snapshots: Snapshot[] }) {
  return {
    productListing: { findMany: async () => input.listings },
    wmsAgingSnapshot: { findMany: async () => input.snapshots },
  } as unknown as Parameters<typeof readSkuAgingFacts>[0];
}

const record = (productRecordId: string, estimate: Record<string, string>, dataStatus = "COMPLETE") => ({
  productRecordId,
  warehouseCode: "WH1",
  sku: "REC-SKU",
  quantity: "100",
  availableQty: "100",
  dataStatus,
  estimate,
});

test("seller sku is bridged to the product record and merged across warehouses", async () => {
  const day = new Date("2026-11-14T02:00:00Z");
  const facts = await readSkuAgingFacts(fakeDb({
    listings: [{ sku: "MSKU-A", productRecordId: "rec-1" }],
    snapshots: [
      { id: "s1", warehouseId: "wh1", snapshotDate: day, capturedAt: day, records: [record("rec-1", bands({ days0To30: "60" }))] },
      { id: "s2", warehouseId: "wh2", snapshotDate: day, capturedAt: day, records: [record("rec-1", bands({ days90To180: "40" }))] },
    ],
  }), { organizationId: "o", workspaceId: "w", skus: ["MSKU-A"], asOf: day });

  const fact = facts.get("MSKU-A")!;
  assert.equal(fact.agingDays, 90);
  // 60 units at 15 days + 40 units at 135 days = 6300/100
  assert.equal(fact.weightedAgeDays, 63);
  assert.equal(fact.warehouses, 2);
  assert.equal(fact.dataStatus, "COMPLETE");
  assert.match(fact.snapshotId!, /s1,s2|s2,s1/);
});

test("missing snapshot, missing listing, and non-COMPLETE rows all stay unusable", async () => {
  const day = new Date("2026-11-14T02:00:00Z");
  const noSnapshot = await readSkuAgingFacts(fakeDb({
    listings: [{ sku: "MSKU-A", productRecordId: "rec-1" }],
    snapshots: [],
  }), { organizationId: "o", workspaceId: "w", skus: ["MSKU-A"], asOf: day });
  assert.equal(noSnapshot.get("MSKU-A")!.dataStatus, "ABSENT");
  assert.equal(noSnapshot.get("MSKU-A")!.agingDays, null);

  const noListing = await readSkuAgingFacts(fakeDb({ listings: [], snapshots: [] }), {
    organizationId: "o", workspaceId: "w", skus: ["MSKU-A"], asOf: day,
  });
  assert.equal(noListing.get("MSKU-A")!.dataStatus, "ABSENT");

  const incomplete = await readSkuAgingFacts(fakeDb({
    listings: [{ sku: "MSKU-A", productRecordId: "rec-1" }],
    snapshots: [{ id: "s1", warehouseId: "wh1", snapshotDate: day, capturedAt: day, records: [record("rec-1", bands({ days0To30: "10" }), "NEEDS_DATA")] }],
  }), { organizationId: "o", workspaceId: "w", skus: ["MSKU-A"], asOf: day });
  assert.equal(incomplete.get("MSKU-A")!.agingDays, null);
  assert.equal(incomplete.get("MSKU-A")!.dataStatus, "ABSENT");
});

test("the newest snapshot per warehouse wins so a re-capture is not double counted", async () => {
  const day = new Date("2026-11-14T00:00:00Z");
  const facts = await readSkuAgingFacts(fakeDb({
    listings: [{ sku: "MSKU-A", productRecordId: "rec-1" }],
    snapshots: [
      { id: "new", warehouseId: "wh1", snapshotDate: day, capturedAt: new Date("2026-11-14T06:00:00Z"), records: [record("rec-1", bands({ days0To30: "50" }))] },
      { id: "old", warehouseId: "wh1", snapshotDate: day, capturedAt: new Date("2026-11-14T01:00:00Z"), records: [record("rec-1", bands({ days365Plus: "50" }))] },
    ],
  }), { organizationId: "o", workspaceId: "w", skus: ["MSKU-A"], asOf: new Date("2026-11-14T08:00:00Z") });

  assert.equal(facts.get("MSKU-A")!.agingDays, 0);
  assert.equal(facts.get("MSKU-A")!.warehouses, 1);
});
