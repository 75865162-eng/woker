import { strict as assert } from "node:assert";
import { test } from "node:test";
import { summarizeOverviewPeriod } from "../src/lib/amazon-sync/store-overview";

const day = (n: number, amount = "0.10", currency = "USD") => ({ businessDate: `2026-11-${String(n).padStart(2, "0")}`, metrics: { orderedProductSales: { amount, currencyCode: currency } }, syncRunId: `run-${n}`, capturedAt: new Date("2026-11-09T00:00:00Z"), reportId: `report-${n}` });

test("complete period preserves precise amounts and does not invent order count", () => {
  const result = summarizeOverviewPeriod("2026-11-01", Array.from({ length: 7 }, (_, i) => day(i + 1)));
  assert.equal(result.complete, true);
  assert.deepEqual(result.orderedProductSales, { amount: "0.7", currency: "USD" });
  assert.equal(result.orderCount, null);
});
test("missing, duplicate and mixed currency prevent a total", () => {
  const rows = Array.from({ length: 7 }, (_, i) => day(i + 1));
  assert.deepEqual(summarizeOverviewPeriod("2026-11-01", rows.slice(1)).missingDates, ["2026-11-01"]);
  assert.equal(summarizeOverviewPeriod("2026-11-01", [...rows, rows[0]]).orderedProductSales, null);
  assert.equal(summarizeOverviewPeriod("2026-11-01", [...rows.slice(0, 6), day(7, "1", "EUR")]).orderedProductSales, null);
});
