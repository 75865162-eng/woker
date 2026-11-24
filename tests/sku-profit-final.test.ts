import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSkuSettlementAggregates,
  buildSkuFinalProfit,
  type SkuSettlementLine,
  type SkuCostInput,
  type FxRateInput,
} from "../src/lib/amazon-sync/sku-profit-final";

const lines: SkuSettlementLine[] = [
  { sku: "SKU-A", currency: "USD", amount: "100", orderId: "O1", transactionType: "Order" },
  { sku: "SKU-A", currency: "USD", amount: "-10", orderId: "O1", transactionType: "FBAFees" },
  { sku: "SKU-A", currency: "USD", amount: "-5", orderId: "O2", transactionType: "Refund" },
  { sku: "SKU-B", currency: "BRL", amount: "115,31", orderId: "O3", transactionType: "Order" },
  { sku: "SKU-B", currency: "BRL", amount: "-17,61", orderId: "O3", transactionType: "FBAFees" },
  { sku: "SKU-C", currency: "USD", amount: "50", orderId: null, transactionType: "Order" },
];

test("结算聚合：按 SKU×币种聚净额、distinct 订单、交易类型分列", () => {
  const agg = buildSkuSettlementAggregates(lines);
  const a = agg.find(r => r.sku === "SKU-A")!;
  assert.equal(a.currency, "USD");
  assert.equal(a.settlementNet, "85"); // 100 - 10 - 5
  assert.equal(a.distinctOrders, 2); // O1, O2（O1 两行只计一次）
  assert.equal(a.lineCount, 3);
  assert.equal(a.typeBreakdown.Order, "100");
  assert.equal(a.typeBreakdown.FBAFees, "-10");
  const b = agg.find(r => r.sku === "SKU-B")!;
  assert.equal(b.settlementNet, "97.7"); // 115,31 - 17,61 逗号小数正确解析
});

test("同币种：成本直接相减，fxRate=1", () => {
  const agg = buildSkuSettlementAggregates(lines);
  const costs: SkuCostInput[] = [{ sku: "SKU-A", costCurrency: "USD", purchaseCost: "30", freightCost: "5", otherCost: "2" }];
  const row = buildSkuFinalProfit(agg, costs, []).find(r => r.sku === "SKU-A")!;
  assert.equal(row.status, "SAME_CURRENCY");
  assert.equal(row.costTotalOriginal, "37");
  assert.equal(row.fxRate, "1");
  assert.equal(row.netProfit, "48"); // 85 - 37
  assert.equal(row.netMargin, String(Math.round((48 / 85) * 1e6) / 1e6));
});

test("跨币种+有汇率：折算后相减", () => {
  const agg = buildSkuSettlementAggregates(lines);
  const costs: SkuCostInput[] = [{ sku: "SKU-B", costCurrency: "CNY", purchaseCost: "100", freightCost: "20", otherCost: "0" }];
  const rates: FxRateInput[] = [{ from: "CNY", to: "BRL", rate: "0.7" }];
  const row = buildSkuFinalProfit(agg, costs, rates).find(r => r.sku === "SKU-B")!;
  assert.equal(row.status, "OK");
  assert.equal(row.fxRate, "0.7");
  assert.equal(row.costTotalConverted, "84"); // 120 * 0.7
  assert.equal(row.netProfit, "13.7"); // 97.7 - 84
});

test("跨币种+无汇率：净利润留空，标注原因（不造数）", () => {
  const agg = buildSkuSettlementAggregates(lines);
  const costs: SkuCostInput[] = [{ sku: "SKU-B", costCurrency: "CNY", purchaseCost: "100", freightCost: "0", otherCost: "0" }];
  const row = buildSkuFinalProfit(agg, costs, []).find(r => r.sku === "SKU-B")!;
  assert.equal(row.status, "NO_FX_RATE");
  assert.equal(row.netProfit, null);
  assert.equal(row.costTotalOriginal, "100"); // 成本原值保留
  assert.match(row.note ?? "", /未配置 CNY→BRL 汇率/);
});

test("无成本：净利润留空", () => {
  const agg = buildSkuSettlementAggregates(lines);
  const row = buildSkuFinalProfit(agg, [], []).find(r => r.sku === "SKU-C")!;
  assert.equal(row.status, "NO_COST");
  assert.equal(row.netProfit, null);
  assert.equal(row.settlementNet, "50");
});

test("汇率方向正确：CNY→USD 与 USD→CNY 不串用", () => {
  const agg = buildSkuSettlementAggregates(lines);
  const costs: SkuCostInput[] = [{ sku: "SKU-A", costCurrency: "CNY", purchaseCost: "70", freightCost: "0", otherCost: "0" }];
  const rates: FxRateInput[] = [{ from: "USD", to: "CNY", rate: "7" }]; // 反向汇率，不能用
  const row = buildSkuFinalProfit(agg, costs, rates).find(r => r.sku === "SKU-A")!;
  assert.equal(row.status, "NO_FX_RATE"); // 没有 CNY→USD，不能用 USD→CNY 反推
  assert.equal(row.netProfit, null);
});

test("成本币种优先匹配结算币种", () => {
  const agg = buildSkuSettlementAggregates(lines);
  const costs: SkuCostInput[] = [
    { sku: "SKU-A", costCurrency: "CNY", purchaseCost: "700", freightCost: "0", otherCost: "0" },
    { sku: "SKU-A", costCurrency: "USD", purchaseCost: "30", freightCost: "0", otherCost: "0" },
  ];
  const row = buildSkuFinalProfit(agg, costs, []).find(r => r.sku === "SKU-A")!;
  assert.equal(row.costCurrency, "USD"); // 同币种优先
  assert.equal(row.netProfit, "55"); // 85 - 30
});
