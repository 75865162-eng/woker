import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAttributionCoverage, splitAttributedSales, AdsAttributionError, type AdsAttributionRow,
} from "../src/lib/amazon-sync/ads-attribution-coverage";

const row = (key: string, spend: string, same: string | null, other: string | null = null): AdsAttributionRow => ({
  rowKey: key, spend, salesSameSku: same, salesOtherSku: other,
  conversionsSameSku: same !== null ? "1.000000" : null, conversionsOtherSku: null,
});

test("覆盖率：已覆盖花费 / 总花费（万分比），未覆盖行显式列出", () => {
  const r = computeAttributionCoverage([
    row("r1", "100.000000", "500.000000"),
    row("r2", "100.000000", null, null),
  ]);
  assert.equal(r.totalSpend, "200.000000");
  assert.equal(r.coveredSpend, "100.000000");
  assert.equal(r.uncoveredSpend, "100.000000");
  assert.equal(r.coverageBp, 5000, "50%");
  assert.equal(r.meetsTarget, false);
  assert.deepEqual(r.uncoveredRows, ["r2"]);
  assert.equal(r.coveredRowCount, 1);
  assert.equal(r.uncoveredRowCount, 1);
});

test("覆盖率达标：≥99.5%（9950bp）", () => {
  const r = computeAttributionCoverage([
    row("r1", "995.000000", "5000.000000"),
    row("r2", "5.000000", "20.000000"),
  ]);
  assert.equal(r.coverageBp, 10000);
  assert.equal(r.meetsTarget, true);
  assert.deepEqual(r.uncoveredRows, []);
});

test("totalSpend=0 → coverageBp/meetsTarget 为 null（不臆造 100%）", () => {
  const r = computeAttributionCoverage([]);
  assert.equal(r.coverageBp, null);
  assert.equal(r.meetsTarget, null);
});

test("同/跨 SKU 销售额拆分汇总，缺值不补零", () => {
  const split = splitAttributedSales([
    row("r1", "10.000000", "100.000000", "50.000000"),
    row("r2", "10.000000", null, "30.000000"),
    row("r3", "10.000000", null, null),
  ]);
  assert.equal(split.salesSameSku, "100.000000");
  assert.equal(split.salesOtherSku, "80.000000");
});

test("非法输入：重复 rowKey / 负花费 / 非法窗口 / 非法目标 → fail-closed", () => {
  assert.throws(() => computeAttributionCoverage([row("r1", "1", "1"), row("r1", "1", "1")]), AdsAttributionError);
  assert.throws(() => computeAttributionCoverage([row("r1", "-1", "1")]), AdsAttributionError);
  assert.throws(() => computeAttributionCoverage([], "99d" as never), AdsAttributionError);
  assert.throws(() => computeAttributionCoverage([], "7d", 20000), AdsAttributionError);
});

test("分窗口独立：window 出现在结果，不混窗口", () => {
  const r = computeAttributionCoverage([row("r1", "10.000000", "50.000000")], "14d");
  assert.equal(r.window, "14d");
});
