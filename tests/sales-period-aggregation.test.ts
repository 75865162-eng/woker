import assert from "node:assert/strict";
import test from "node:test";
import { aggregateRows, daysBetween, isoWeekOf, num, shiftDays, summarize, topFromRows } from "../src/lib/amazon-sync/sales-query";
import type { ProductSalesRow, SalesRow } from "../src/lib/amazon-sync/sales-query";

function salesRow(over: Partial<SalesRow> & { businessDate: string; metrics: SalesRow["metrics"] }): SalesRow {
  return {
    id: over.id ?? crypto.randomUUID(), organizationId: "org", workspaceId: "ws", sourceId: over.sourceId ?? "src1",
    sellerAccountId: over.sellerAccountId ?? "seller1", marketplaceId: over.marketplaceId ?? "ATVPDKIKX0DER",
    businessDate: over.businessDate, reportId: "r", documentId: "d", metrics: over.metrics, quality: "VALID",
    capturedAt: new Date(), publishedAt: new Date(), amazonSellerId: "A1", sellerName: "店铺A", frozenScope: null, summary: null,
    syncRunId: over.syncRunId ?? "run1",
  } as SalesRow;
}
function productRow(over: Partial<ProductSalesRow> & { businessDate: string; childAsin: string; metrics: ProductSalesRow["metrics"] }): ProductSalesRow {
  return {
    id: over.id ?? crypto.randomUUID(), organizationId: "org", workspaceId: "ws", sourceId: "src1", syncRunId: "run1",
    sellerAccountId: "seller1", marketplaceId: "ATVPDKIKX0DER", businessDate: over.businessDate, granularity: "CHILD",
    childAsin: over.childAsin, parentAsin: over.parentAsin ?? null, sellerSku: over.sellerSku ?? null,
    reportId: "r", documentId: "d", metrics: over.metrics, quality: "VALID", capturedAt: new Date(), sellerName: "店铺A", amazonSellerId: "A1", publishedAt: new Date(),
  } as ProductSalesRow;
}

test("ISO 周边界正确（2026-01-01 属于 2026-W01，周一为 2025-12-29）", () => {
  const w = isoWeekOf("2026-01-01");
  assert.equal(w.year, 2026);
  assert.equal(w.week, 1);
  assert.equal(w.monday, "2025-12-29");
});

test("按周聚合跨月边界，缺指标记 null 不补零", () => {
  const rows = [
    salesRow({ businessDate: "2026-11-16", metrics: { unitsOrdered: "3", orderedProductSales: { amount: "30.00", currencyCode: "USD" } } }),
    salesRow({ businessDate: "2026-11-17", metrics: { unitsOrdered: "4" } }),
    salesRow({ businessDate: "2026-11-23", metrics: { unitsOrdered: "5", orderedProductSales: { amount: "50.00", currencyCode: "USD" } } }),
  ];
  const agg = aggregateRows(rows, (d) => { const w = isoWeekOf(d); return { key: `${w.year}-W${String(w.week).padStart(2, "0")}`, start: w.monday, end: shiftDays(w.monday, 6) }; }, (s, e) => daysBetween(s, e));
  assert.equal(agg.length, 2);
  assert.equal(agg[0].period, "2026-W47");
  assert.equal(agg[0].unitsOrdered, "7");
  assert.deepEqual(agg[0].sales, [{ currency: "USD", amount: "30.00" }]);
  assert.equal(agg[0].sessions, null);
});

test("销售额按币种分列，不跨币种相加", () => {
  const rows = [
    salesRow({ businessDate: "2026-11-20", metrics: { orderedProductSales: { amount: "10.00", currencyCode: "USD" } } }),
    salesRow({ businessDate: "2026-11-20", sellerAccountId: "seller2", metrics: { orderedProductSales: { amount: "20.00", currencyCode: "EUR" } } }),
  ];
  const totals = summarize(rows);
  assert.deepEqual(totals.sales.map(s => `${s.currency} ${s.amount}`), ["EUR 20.00", "USD 10.00"]);
});

test("覆盖完整判定与缺失指标 null", () => {
  const one = summarize([salesRow({ businessDate: "2026-11-20", metrics: { unitsOrdered: "3" } })]);
  assert.equal(one.complete, true);
  const missingMetric = summarize([salesRow({ businessDate: "2026-11-20", metrics: {} })]);
  assert.equal(missingMetric.unitsOrdered, null);
});

test("num 只接受数字字符串", () => {
  assert.equal(num("12"), 12);
  assert.equal(num("12.5"), 12.5);
  assert.equal(num(""), null);
  assert.equal(num("abc"), null);
  assert.equal(num(null), null);
});

test("排行按销量降序并跳过空身份", () => {
  const rows = [
    productRow({ businessDate: "2026-11-21", childAsin: "B000000002", metrics: { unitsOrdered: "5" } }),
    productRow({ businessDate: "2026-11-21", childAsin: "B000000001", metrics: { unitsOrdered: "9" } }),
    productRow({ businessDate: "2026-11-21", childAsin: "", metrics: { unitsOrdered: "100" } }),
  ];
  const top = topFromRows(rows, (r) => r.childAsin, 10);
  assert.deepEqual(top.map(t => t.identity), ["B000000001", "B000000002"]);
});
