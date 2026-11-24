import assert from "node:assert/strict";
import test from "node:test";
import {
  extractField,
  extractFields,
  ORDER_ITEM_FEE_SPECS,
  RETURN_FIELDS_SPECS,
  TRAFFIC_RATE_SPECS,
  ADS_ATTRIBUTION_SPECS,
  FIELD_EXTRACT_GROUPS,
  type FieldExtractSpec,
} from "../src/lib/amazon-sync/wimoor-field-extract";

const spec = (canonical: string, aliases: string[]): FieldExtractSpec => ({ canonical, aliases, wimoorProp: canonical, spapiElement: "test" });

test("提取：精确命中 canonical 键", () => {
  const r = extractField({ "item-tax": "1.23" }, spec("item-tax", ["ItemTax"]));
  assert.equal(r.value, "1.23");
  assert.equal(r.matchedKey, "item-tax");
  assert.equal(r.explicitlyEmpty, false);
});

test("提取：命中别名（大小写/下划线差异）", () => {
  const r = extractField({ ItemTax: "4.56" }, spec("item-tax", ["ItemTax", "item_tax"]));
  assert.equal(r.value, "4.56");
  assert.equal(r.matchedKey, "ItemTax");
});

test("提取：归一化匹配（连字符/空格/大小写不敏感）", () => {
  const r = extractField({ "ITEM TAX": "7.89" }, spec("item-tax", []));
  assert.equal(r.value, "7.89");
  assert.equal(r.matchedKey, "ITEM TAX");
});

test("提取：空值不补零——空字符串/null/空白均返回 null 且标记显式空", () => {
  for (const v of ["", "   ", null, undefined]) {
    const r = extractField({ "item-tax": v }, spec("item-tax", []));
    assert.equal(r.value, null, `值 ${String(v)} 应视为空`);
    assert.equal(r.explicitlyEmpty, true);
  }
});

test("提取：键完全缺失返回 null 且 matchedKey 为空、非显式空", () => {
  const r = extractField({ other: "x" }, spec("item-tax", []));
  assert.equal(r.value, null);
  assert.equal(r.matchedKey, null);
  assert.equal(r.explicitlyEmpty, false);
});

test("提取：fields 整体为 null/undefined 不崩溃", () => {
  for (const f of [null, undefined]) {
    const r = extractField(f, spec("item-tax", []));
    assert.equal(r.value, null);
  }
});

test("提取：canonical 优先于 alias（两者都存在时取 canonical）", () => {
  const r = extractField({ "item-tax": "canonical", ItemTax: "alias" }, spec("item-tax", ["ItemTax"]));
  assert.equal(r.value, "canonical");
});

test("批量提取：返回每个规范键的结果", () => {
  const out = extractFields({ "item-tax": "1", "shipping-price": "2" }, ORDER_ITEM_FEE_SPECS);
  assert.equal(out["item-tax"].value, "1");
  assert.equal(out["shipping-price"].value, "2");
  assert.equal(out["gift-wrap-price"].value, null);
});

test("退货字段：真实报告表头 refunded-amount / tracking-id 可提取", () => {
  const rows = { "refunded-amount": "12.34", "purchase-date": "2026-11-01", "tracking-id": "T-123" };
  const out = extractFields(rows, RETURN_FIELDS_SPECS);
  assert.equal(out["refunded-amount"].value, "12.34");
  assert.equal(out["purchase-date"].value, "2026-11-01");
  assert.equal(out["license-plate-number"].value, "T-123"); // tracking-id 别名命中
  assert.equal(out["license-plate-number"].matchedKey, "tracking-id");
});

test("流量比率字段：驼峰/连字符两种表头都可提取", () => {
  assert.equal(extractField({ sessionPercentage: "0.12" }, TRAFFIC_RATE_SPECS[0]).value, "0.12");
  assert.equal(extractField({ "buy-box-percentage": "0.85" }, TRAFFIC_RATE_SPECS[2]).value, "0.85");
});

test("广告归因：同/跨SKU 与 1/7/14/30 天窗口规格齐全", () => {
  const out = extractFields({ attributedSalesSameSKU: "5", attributedSales7d: "20" }, ADS_ATTRIBUTION_SPECS);
  assert.equal(out.attributedSalesSameSku.value, "5");
  assert.equal(out.attributedSales7d.value, "20");
  assert.equal(out.attributedSales30d.value, null);
  assert.equal(ADS_ATTRIBUTION_SPECS.length, 8);
});

test("全部分组规格：wimoorProp 与 spapiElement 非空", () => {
  for (const g of FIELD_EXTRACT_GROUPS) {
    assert.ok(g.specs.length > 0, `${g.domain} 无规格`);
    for (const s of g.specs) {
      assert.ok(s.canonical.length > 0);
      assert.ok(s.wimoorProp.length > 0);
      assert.ok(s.spapiElement.length > 0);
    }
  }
  assert.equal(FIELD_EXTRACT_GROUPS.length, 5);
});
