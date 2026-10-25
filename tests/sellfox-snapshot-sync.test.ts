import test from "node:test";
import assert from "node:assert/strict";
import inventory from "./fixtures/sellfox/inventory-page.json";
import volume from "./fixtures/sellfox/sales-volume-page.json";
import revenue from "./fixtures/sellfox/sales-revenue-page.json";
import { sellfoxInventoryRow, sellfoxSalesRow, sellfoxSnapshotPage } from "@/lib/sellfox/snapshot-contracts";
import { syncSellfoxSnapshotStores, type SnapshotCheckpoint } from "@/lib/sellfox/snapshot-sync";
import { SellfoxStoreSyncError } from "@/lib/sellfox/sync-errors";
import type { sellfoxPost } from "@/lib/sellfox/client";

test("verified inventory contract maps Amazon MSKU and available units, preserving null and real zero", () => {
  const row = sellfoxInventoryRow(inventory.rows[0], "shop-fixture");
  assert.equal(row.msku, "MSKU-FIXTURE"); assert.equal(row.sku, "SKU-FIXTURE"); assert.equal(row.quantity, 0);
  assert.equal(sellfoxInventoryRow({ ...inventory.rows[0], available: null }, "shop-fixture").quantity, null);
  assert.throws(() => sellfoxInventoryRow(inventory.rows[0], "foreign-shop"), /归属/);
  assert.throws(() => sellfoxInventoryRow({ ...inventory.rows[0], available: "unknown" }, "shop-fixture"), /无效数量/);
  assert.throws(() => sellfoxSnapshotPage({ ...inventory, totalSize: 2 }, 1), /不一致/);
  assert.equal(sellfoxSnapshotPage({ pageNo: 1, pageSize: 100, totalPage: 0, totalSize: 0, rows: [] }, 1).rows.length, 0);
});
test("daily metric contracts reject foreign shops, combined MSKUs, wrong dates and absent metrics", () => {
  assert.equal(sellfoxSalesRow(volume.rows[0], "shop-fixture", "2026-10-24", "productNum").value, 2);
  assert.equal(sellfoxSalesRow(revenue.rows[0], "shop-fixture", "2026-10-24", "salePrice").value, 19.99);
  assert.throws(() => sellfoxSalesRow(volume.rows[0], "other", "2026-10-24", "productNum"), /归属/);
  assert.throws(() => sellfoxSalesRow(volume.rows[0], "shop-fixture", "2026-10-23", "productNum"), /日期/);
  assert.throws(() => sellfoxSalesRow(volume.rows[0], "shop-fixture", "2026-10-24", "salePrice"), /指标/);
  assert.throws(() => sellfoxSalesRow({ ...volume.rows[0], mskus: ["a", "b"] }, "shop-fixture", "2026-10-24", "productNum"), /唯一/);
});

test("historical MSKU sales preserve an unpaired internal SKU without weakening identity validation", () => {
  for (const [fixture, metric] of [[volume, "productNum"], [revenue, "salePrice"]] as const) {
    const raw = { ...fixture.rows[0], skus: null };
    const parsed = sellfoxSalesRow(raw, "shop-fixture", "2026-10-24", metric);
    assert.equal(parsed.sku, "");
    assert.equal(parsed.msku, fixture.rows[0].mskus[0]);
    assert.equal(parsed.payload.skus, null);
    assert.throws(() => sellfoxSalesRow({ ...raw, mskus: null }, "shop-fixture", "2026-10-24", metric), /身份/);
    assert.throws(() => sellfoxSalesRow({ ...raw, shopIds: null }, "shop-fixture", "2026-10-24", metric), /身份/);
    assert.throws(() => sellfoxSalesRow({ ...raw, skus: [null] }, "shop-fixture", "2026-10-24", metric), /身份/);
    assert.throws(() => sellfoxSalesRow({ ...raw, skus: undefined }, "shop-fixture", "2026-10-24", metric), /身份/);
    assert.throws(() => sellfoxSalesRow(raw, "foreign", "2026-10-24", metric), /归属/);
  }
});

function fixture() {
  let rows = new Map<string, Record<string, unknown>>(); let checkpoint: SnapshotCheckpoint | undefined; let failCommit = false;
  const calls: string[] = []; let failureMetric = ""; let revenueCurrency = "USD";
  type Args = { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> };
  const key = (where: Record<string, unknown>) => JSON.stringify(where);
  let pendingCheckpoint: SnapshotCheckpoint | undefined;
  const db = {
    sellfoxStore: { findMany: async () => [{ id: "store", externalId: "shop-fixture" }] },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const pending = structuredClone(rows); pendingCheckpoint = undefined;
      const table = { upsert: async (args: Args) => { const id = key(args.where); pending.set(id, { ...(pending.get(id) ?? args.create), ...args.update }); }, findUnique: async ({ where }: { where: Record<string, unknown> }) => pending.get(key(where)) ?? null };
      await fn({ sellfoxFbaInventorySnapshot: table, sellfoxSalesDailySnapshot: table, sellfoxSnapshotHead: { upsert: async () => undefined }, sellfoxSalesDayCoverage: { upsert: async () => undefined } });
      if (failCommit) { failCommit = false; throw new Error("private database error"); }
      rows = pending; if (pendingCheckpoint) checkpoint = pendingCheckpoint;
    },
  } as unknown as NonNullable<Parameters<typeof syncSellfoxSnapshotStores>[1]>["db"];
  const post = (async (path: string, body: { type?: string }) => {
    const metric = body.type ?? "inventory"; calls.push(metric); if (failureMetric === metric) throw new Error("private transport error");
    const response = structuredClone(path.includes("inventory") ? inventory : metric === "productNum" ? volume : revenue);
    if (metric === "orderNum") {
      const day = (response as typeof revenue).rows[0].productSaleDayOpenVo[0];
      Object.assign(day, { orderNum: 1 });
    }
    if (metric === "salePrice") (response as typeof revenue).rows[0].productSaleDayOpenVo[0].currency = revenueCurrency;
    return response;
  }) as typeof sellfoxPost;
  const onProgress = async (progress: { checkpoint: SnapshotCheckpoint }, tx?: unknown) => { if (tx) pendingCheckpoint = structuredClone(progress.checkpoint); else checkpoint = structuredClone(progress.checkpoint); };
  return { dependencies: { db, post }, calls, onProgress, get rows() { return rows; }, get checkpoint() { return checkpoint; }, failCommit() { failCommit = true; }, failMetric(metric: string) { failureMetric = metric; }, setRevenueCurrency(value: string) { revenueCurrency = value; } };
}
const input = { organizationId: "org", workspaceId: "workspace", shopExternalIds: ["shop-fixture"], reportDate: "2026-10-24", capturedAt: "2026-10-25T00:00:00Z" };
test("sales merge three metrics by MSKU/day, retry only the failed metric, and preserve null until it succeeds", async () => {
  const f = fixture(); f.failMetric("salePrice");
  await assert.rejects(() => syncSellfoxSnapshotStores({ ...input, resource: "sales", onProgress: f.onProgress }, f.dependencies), (e) => e instanceof SellfoxStoreSyncError && e.retryable);
  assert.equal(f.rows.size, 1); assert.equal([...f.rows.values()][0].quantity, 2); assert.equal([...f.rows.values()][0].revenue, null);
  assert.equal(f.checkpoint?.stores["shop-fixture"].productNum?.done, true);
  f.failMetric("");
  await syncSellfoxSnapshotStores({ ...input, resource: "sales", checkpoint: f.checkpoint, onProgress: f.onProgress }, f.dependencies);
  assert.deepEqual(f.calls, ["productNum", "salePrice", "orderNum", "salePrice"]);
  assert.equal([...f.rows.values()][0].revenue, 19.99); assert.equal([...f.rows.values()][0].quantity, 2);
  assert.equal([...f.rows.values()][0].orders, 1);
  await syncSellfoxSnapshotStores({ ...input, resource: "sales", onProgress: f.onProgress }, f.dependencies);
  assert.equal(f.rows.size, 1);
});
test("inventory transaction rollback and repeated capture retain stable identities and different capture history", async () => {
  const f = fixture(); f.failCommit();
  await assert.rejects(() => syncSellfoxSnapshotStores({ ...input, resource: "inventory", onProgress: f.onProgress }, f.dependencies));
  assert.equal(f.rows.size, 0); assert.equal(f.checkpoint?.stores["shop-fixture"].inventory?.writes, 0);
  assert.doesNotMatch(JSON.stringify(f.checkpoint), /private/);
  await syncSellfoxSnapshotStores({ ...input, resource: "inventory", checkpoint: f.checkpoint, onProgress: f.onProgress }, f.dependencies);
  await syncSellfoxSnapshotStores({ ...input, resource: "inventory", onProgress: f.onProgress }, f.dependencies);
  assert.equal(f.rows.size, 1);
  await syncSellfoxSnapshotStores({ ...input, capturedAt: "2026-10-25T03:00:00Z", resource: "inventory", onProgress: f.onProgress }, f.dependencies);
  assert.equal(f.rows.size, 2);
});

test("a new sales capture never combines new quantity with stale revenue, and mismatched currencies fail closed", async () => {
  const f = fixture();
  await syncSellfoxSnapshotStores({ ...input, resource: "sales", onProgress: f.onProgress }, f.dependencies);
  f.failMetric("salePrice");
  await assert.rejects(() => syncSellfoxSnapshotStores({ ...input, capturedAt: "2026-10-25T03:00:00Z", resource: "sales", onProgress: f.onProgress }, f.dependencies));
  assert.equal([...f.rows.values()][0].revenue, null);
  assert.equal([...f.rows.values()][0].quantity, 2);
  f.failMetric(""); f.setRevenueCurrency("EUR");
  await assert.rejects(() => syncSellfoxSnapshotStores({ ...input, capturedAt: "2026-10-25T03:00:00Z", resource: "sales", checkpoint: f.checkpoint, onProgress: f.onProgress }, f.dependencies), (error) => error instanceof SellfoxStoreSyncError && !error.retryable);
  assert.equal([...f.rows.values()][0].currency, "USD");
  assert.equal([...f.rows.values()][0].revenue, null);
});


test("orderNum accepts unknown and real zero but rejects fractional orders", () => {
  for (const [raw, expected] of [[null, null], [undefined, null], ["", null], [0, 0], ["3", 3]] as const) {
    const row = { ...volume.rows[0], productSaleDayOpenVo: [{ day: "2026-10-24", currency: "USD", orderNum: raw }] };
    assert.equal(sellfoxSalesRow(row, "shop-fixture", "2026-10-24", "orderNum").value, expected);
  }
  assert.throws(() => sellfoxSalesRow({ ...volume.rows[0], productSaleDayOpenVo: [{ day: "2026-10-24", currency: "USD", orderNum: 1.5 }] }, "shop-fixture", "2026-10-24", "orderNum"), /无效数量/);
});

test("failed orders remain null, retain checkpoint, and retry without refetching other metrics", async () => {
  const f = fixture(); f.failMetric("orderNum");
  await assert.rejects(() => syncSellfoxSnapshotStores({ ...input, resource: "sales", onProgress: f.onProgress }, f.dependencies));
  const row = [...f.rows.values()][0];
  assert.equal(row.orders, null); assert.equal(row.quantity, 2); assert.equal(row.revenue, 19.99);
  assert.equal(f.checkpoint?.stores["shop-fixture"].orderNum?.done, false);
  f.failMetric("");
  await syncSellfoxSnapshotStores({ ...input, resource: "sales", checkpoint: f.checkpoint, onProgress: f.onProgress }, f.dependencies);
  assert.deepEqual(f.calls, ["productNum", "salePrice", "orderNum", "orderNum"]);
  assert.equal([...f.rows.values()][0].orders, 1);
});
