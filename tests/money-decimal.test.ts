import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { moneyToNumber } from "../src/lib/sellfox/money-display";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

function modelBlock(name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  assert.ok(start >= 0, `缺少模型 ${name}`);
  return schema.slice(start, schema.indexOf("\n}", start));
}

test("金额展示序列化：Decimal 转 number，null 保持 null，不补造零值", () => {
  assert.equal(moneyToNumber(new Prisma.Decimal("12.3400")), 12.34);
  assert.equal(moneyToNumber(new Prisma.Decimal("0.0001")), 0.0001);
  assert.equal(moneyToNumber(new Prisma.Decimal("-1234.5678")), -1234.5678);
  assert.equal(moneyToNumber(null), null);
  assert.equal(moneyToNumber(undefined), null);
});

test("商品主档采购价为 DECIMAL(20,4)，不再使用 Float", () => {
  const block = modelBlock("ProductRecord");
  assert.match(block, /purchasePrice\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(20, 4\)/);
  assert.doesNotMatch(block, /purchasePrice\s+Float/);
});

test("赛狐金额字段均为 DECIMAL(20,4)，比率/件数保留 Float", () => {
  const daily = modelBlock("SellfoxProductDailySnapshot");
  for (const field of ["netRevenue", "saleRevenue", "grossProfit", "adCost", "promotionDiscount", "refundPrice", "avgPurchaseCost"]) {
    assert.match(daily, new RegExp(`${field}\\s+Decimal\\??\\s+@db\\.Decimal\\(20, 4\\)`), `${field} 应为 Decimal(20,4)`);
  }
  for (const field of ["grossProfitRate", "refundRate", "refundNum", "evaluationSaleNum", "channelSaleNum"]) {
    assert.match(daily, new RegExp(`${field}\\s+Float\\??\\s*\\n`), `${field} 应保留 Float`);
  }
});

test("赛狐广告与订单金额字段为 DECIMAL(20,4)，含 currency 独立字段", () => {
  const ads = modelBlock("SellfoxAdsTargetingDaily");
  assert.match(ads, /cost\s+Decimal\?\s+@db\.Decimal\(20, 4\)/);
  assert.match(ads, /adSales\s+Decimal\?\s+@db\.Decimal\(20, 4\)/);
  assert.match(ads, /currency\s+String/);
  const orders = modelBlock("SellfoxOrderSnapshot");
  for (const field of ["orderTotal", "itemAmount", "revenue"]) {
    assert.match(orders, new RegExp(`${field}\\s+Decimal\\??\\s+@db\\.Decimal\\(20, 4\\)`));
  }
});

test("DECIMAL 金额运算使用 decimal.js（Prisma.Decimal）无浮点误差", () => {
  const a = new Prisma.Decimal("0.1");
  const b = new Prisma.Decimal("0.2");
  assert.equal(a.add(b).toString(), "0.3");
  assert.equal(new Prisma.Decimal("19.99").mul(3).toFixed(2), "59.97");
  // ACOS 口径：cost/adSales*100，Decimal 保证精度
  const cost = new Prisma.Decimal("12.34");
  const adSales = new Prisma.Decimal("61.70");
  assert.equal(cost.div(adSales).mul(100).toFixed(1), "20.0");
});
