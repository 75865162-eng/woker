import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { inventoryNarrow, listingNarrow } from "@/lib/sellfox/narrow-contracts";
import { parseSellfoxAdProductReport, sellfoxReportDownloadUrl } from "@/lib/sellfox/ads-report-contract";
import { sellfoxAgentCsv, sellfoxAgentColumns } from "@/lib/sellfox/agent-read";
import { defaultSellfoxBackfillStart, sellfoxBackfillWindow, nextSellfoxScheduleAt } from "@/lib/sellfox/schedule-time";
import { syncSellfoxListings, type ListingCheckpoint } from "@/lib/sellfox/listing-sync";
import listing from "./fixtures/sellfox/listing-page.json";
import type { sellfoxPost } from "@/lib/sellfox/client";
const headers = ["店铺", "日期", "asin", "sku", "广告活动ID", "广告组ID", "广告产品ID", "广告曝光量", "广告点击量", "广告花费", "广告订单量", "广告销售额"];
async function report(rows: unknown[][], columns = headers) {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("sheet");
  sheet.addRow(columns); rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
const values = ["fixture-store", new Date("2026-10-24T00:00:00Z"), "asin", "msku", "campaign", "group", "product", 100, 0, 0, null, null];
const scope = { storeName: "fixture-store", startDate: "2026-10-24", endDate: "2026-10-24" };
test("narrow mappings preserve missing vs zero and never mistake listing quantity for FBA available", () => {
  assert.equal(inventoryNarrow({ totalInventory: "0" }).totalInventory, 0);
  assert.equal(inventoryNarrow({}).inTransit, null);
  assert.throws(() => inventoryNarrow({ inTransit: "unknown" }));
  const row = listingNarrow(listing.rows[0], "shop-fixture");
  assert.equal(row.fulfillable, 0); assert.equal(row.msku, "MSKU-FIXTURE"); assert.equal(row.sales7, 2);
  assert.equal(listingNarrow({ ...listing.rows[0], inventoryManage: null }, "shop-fixture").fulfillable, null);
  assert.throws(() => listingNarrow(listing.rows[0], "foreign"));
});
test("verified product report columns retain null conversions, reject scope drift, duplicate identities and formulas", async () => {
  const [row] = await parseSellfoxAdProductReport(await report([values]), scope);
  assert.equal(row.cost, 0); assert.equal(row.adOrders, null); assert.equal(row.adSales, null); assert.equal(row.currency, null);
  await assert.rejects(async () => parseSellfoxAdProductReport(await report([values]), { ...scope, storeName: "foreign" }), /店铺/);
  await assert.rejects(async () => parseSellfoxAdProductReport(await report([values, values]), scope), /重复实体/);
  await assert.rejects(async () => parseSellfoxAdProductReport(await report([[...values.slice(0, 9), { formula: "1+1", result: 2 }, null, null]]), scope), /公式/);
  await assert.rejects(async () => parseSellfoxAdProductReport(await report([values], headers.slice(1)), scope), /缺少/);
  await assert.rejects(async () => parseSellfoxAdProductReport(await report([values]), { ...scope, endDate: "2026-10-23" }), /日期/);
});
test("download URLs cannot redirect into credentials, local addresses or an unverified host", () => {
  assert.equal(sellfoxReportDownloadUrl("https://s1.sellfox.com/file.xlsx").hostname, "s1.sellfox.com");
  for (const url of ["http://s1.sellfox.com/a", "https://127.0.0.1/a", "https://s1.sellfox.com.evil.test/a", "https://user:secret@s1.sellfox.com/a", "https://s1.sellfox.com:444/a"]) assert.throws(() => sellfoxReportDownloadUrl(url));
});
test("agent CSV has stable narrow headers, escapes formulas, and never emits payload", () => {
  const csv = sellfoxAgentCsv("sales", [{ msku: "=formula", payload: { token: "secret" }, quantity: 0, complete: false }]);
  assert.match(csv, /'=formula/); assert.doesNotMatch(csv, /payload|secret/);
  assert.ok(sellfoxAgentColumns.sales.includes("complete"));
});
test("winter backfill is bounded and persistent, while all new daily plans share Shanghai 06:30", () => {
  assert.equal(defaultSellfoxBackfillStart(new Date("2026-10-25T00:00:00Z")), "2025-11-01");
  assert.equal(defaultSellfoxBackfillStart(new Date("2026-01-10T00:00:00Z")), "2024-11-01");
  assert.deepEqual(sellfoxBackfillWindow("2025-11-01", "2026-10-24"), { backfillFrom: "2025-11-01", backfillTo: "2025-11-07" });
  assert.deepEqual(sellfoxBackfillWindow("2026-10-23", "2026-10-24", 90), { backfillFrom: "2026-10-23", backfillTo: "2026-10-24" });
  assert.deepEqual(sellfoxBackfillWindow("2026-10-25", "2026-10-24"), {});
  assert.throws(() => sellfoxBackfillWindow("2025-11-01", "2026-10-24", 91));
  for (const resource of ["listings", "ads_report"]) assert.equal(nextSellfoxScheduleAt({ resource, intervalMinutes: 1440, lastEnqueuedAt: null }, new Date("2026-10-24T22:29:00Z")).toISOString(), "2026-10-24T22:30:00.000Z");
});
test("listing transaction failure cannot publish current; retry reuses capture and complete empty capture clears current", async () => {
  let head: string | null = null; let count = 0; let fail = true; let empty = false; let checkpoint: ListingCheckpoint | undefined;
  const db = { sellfoxStore: { findMany: async () => [{ id: "store", externalId: "shop-fixture" }] }, $transaction: async (callback: (tx: unknown) => Promise<void>) => {
    let pending = 0; let published = head;
    await callback({ sellfoxListingSnapshot: { upsert: async () => { pending++; } }, sellfoxSnapshotHead: { upsert: async ({ create }: { create: { capturedAt: Date } }) => { published = create.capturedAt.toISOString(); } } });
    if (fail) { fail = false; throw Error("private database details"); }
    count += pending; head = published;
  } } as unknown as NonNullable<Parameters<typeof syncSellfoxListings>[1]>["db"];
  const post = (async () => empty ? { pageNo: 1, pageSize: 100, totalPage: 0, totalSize: 0, rows: [] } : listing) as typeof sellfoxPost;
  const input = { organizationId: "org", workspaceId: "workspace", shopExternalIds: ["shop-fixture"], capturedAt: "2026-10-25T00:00:00Z", onProgress: async (state: ListingCheckpoint, tx?: unknown) => { if (!tx) checkpoint = structuredClone(state); } };
  await assert.rejects(() => syncSellfoxListings(input, { db, post }));
  assert.equal(head, null); assert.equal(count, 0); assert.doesNotMatch(JSON.stringify(checkpoint), /private/);
  await syncSellfoxListings({ ...input, checkpoint }, { db, post }); assert.equal(head, new Date(input.capturedAt).toISOString()); assert.equal(count, 1);
  empty = true;
  await syncSellfoxListings({ ...input, capturedAt: "2026-10-25T03:00:00Z" }, { db, post }); assert.equal(head, "2026-10-25T03:00:00.000Z"); assert.equal(count, 1);
});
