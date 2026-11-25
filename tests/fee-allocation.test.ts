import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateFee, allocateFeeMatrix, FEE_POOL_DEFAULT_STRATEGY, FeeAllocationError,
  type FeeAllocationInput,
} from "../src/lib/finance/fee-allocation";

const base = (over: Partial<FeeAllocationInput>): FeeAllocationInput => ({
  feeType: "advSpendFee", totalAmount: "10.000000", currency: "CNY", strategy: "salesWeight",
  targets: [{ sku: "A", weight: "30.000000" }, { sku: "B", weight: "70.000000" }],
  ...over,
});

test("salesWeight：按销售额比例分摊，逐行之和精确等于总额", () => {
  const r = allocateFee(base({}));
  assert.equal(r.lines[0].amount, "3.000000");
  assert.equal(r.lines[1].amount, "7.000000");
  assert.equal(r.allocatedTotal, "10.000000");
  assert.equal(r.exact, true);
  assert.equal(r.residual, "0.000000");
});

test("equal 均摊含尾差：10/3 除不尽时尾差归末位，仍精确对平", () => {
  const r = allocateFee(base({ strategy: "equal", totalAmount: "10.000000", targets: [
    { sku: "A", weight: null }, { sku: "B", weight: null }, { sku: "C", weight: null },
  ] }));
  const sum = r.lines.reduce((a, l) => a + Number(l.amount), 0);
  assert.equal(sum.toFixed(6), "10.000000");
  assert.equal(r.exact, true);
  assert.equal(r.residual, "0.000000");
});

test("direct 直接归集：全额落目标 SKU，其余为 0（0 是分摊结果非臆造源值）", () => {
  const r = allocateFee(base({ strategy: "direct", directSku: "B" }));
  assert.equal(r.lines[0].amount, "0.000000");
  assert.equal(r.lines[1].amount, "10.000000");
  assert.equal(r.exact, true);
});

test("custom 自定义权重：按自定义比例分摊", () => {
  const r = allocateFee(base({ strategy: "custom", targets: [
    { sku: "A", weight: "1.000000" }, { sku: "B", weight: "3.000000" },
  ] }));
  assert.equal(r.lines[0].amount, "2.500000");
  assert.equal(r.lines[1].amount, "7.500000");
});

test("分母为 0 / 权重缺失 / 负权重 → fail-closed 不臆造", () => {
  assert.throws(() => allocateFee(base({ strategy: "salesWeight", targets: [
    { sku: "A", weight: "0" }, { sku: "B", weight: "0" },
  ] })), (e: unknown) => e instanceof FeeAllocationError && /权重合计须为正数/.test(e.message));
  assert.throws(() => allocateFee(base({ strategy: "salesWeight", targets: [
    { sku: "A", weight: null }, { sku: "B", weight: "1" },
  ] })), (e: unknown) => e instanceof FeeAllocationError && /缺失不臆造/.test(e.message));
  assert.throws(() => allocateFee(base({ strategy: "custom", targets: [
    { sku: "A", weight: "-1" }, { sku: "B", weight: "1" },
  ] })), (e: unknown) => e instanceof FeeAllocationError && /权重须为正数|非负/.test(e.message));
});

test("非法输入（重复 SKU / 跨币种 / 未知策略 / direct 缺目标）被拒绝", () => {
  assert.throws(() => allocateFee(base({ targets: [{ sku: "A", weight: "1" }, { sku: "A", weight: "2" }] })), FeeAllocationError);
  assert.throws(() => allocateFee(base({ currency: "usd" })), FeeAllocationError);
  assert.throws(() => allocateFee(base({ strategy: "bogus" as never })), FeeAllocationError);
  assert.throws(() => allocateFee(base({ strategy: "direct" })), FeeAllocationError);
});

test("矩阵：多费用独立分摊、独立对平，按费用类型索引", () => {
  const matrix = allocateFeeMatrix([
    base({ feeType: "advSpendFee" }),
    base({ feeType: "storageFee", totalAmount: "3.000000", targets: [{ sku: "A", weight: "1" }, { sku: "B", weight: "1" }] }),
  ]);
  assert.equal(matrix.advSpendFee.exact, true);
  assert.equal(matrix.storageFee.lines[0].amount, "1.500000");
  assert.match(FEE_POOL_DEFAULT_STRATEGY.storageFee, /salesWeight/);
});

test("尾差精度：极小费用除 3，末位补齐不丢分", () => {
  const r = allocateFee(base({ totalAmount: "0.010000", strategy: "equal", targets: [
    { sku: "A", weight: null }, { sku: "B", weight: null }, { sku: "C", weight: null },
  ] }));
  assert.equal(r.allocatedTotal, "0.010000");
  assert.equal(r.exact, true);
});
