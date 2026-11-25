import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFeesWithRules, validateRules, sortRules, FeeParseRuleError, type FeeParseRule,
} from "../src/lib/amazon-sync/fee-parse-rules";

const rules: FeeParseRule[] = [
  { key: "tax", targetColumn: "itemTax", aliases: ["item-tax", "ItemTax", "item_tax"], transform: "signedAmount", priority: 1 },
  { key: "ship", targetColumn: "shippingPrice", aliases: ["shipping-price", "ShippingPrice"], transform: "number" },
  { key: "taxLegacy", targetColumn: "itemTax", aliases: ["tax_amount"], transform: "raw", priority: 0 },
];

test("规则库校验：键唯一/目标列/别名/变换白名单/优先级整数", () => {
  assert.doesNotThrow(() => validateRules(rules));
  assert.throws(() => validateRules([{ ...rules[0], key: "tax" }, { ...rules[0], key: "tax" }]), FeeParseRuleError);
  assert.throws(() => validateRules([{ ...rules[0], transform: "eval" as never }]), FeeParseRuleError);
  assert.throws(() => validateRules([{ ...rules[0], priority: 1.5 }]), FeeParseRuleError);
});

test("新增表头别名免改代码：多别名 + 归一化匹配 + 来源标记", () => {
  const out = parseFeesWithRules({ "item_tax": "1,234.50", "shipping-price": "3.5" }, rules);
  assert.equal(out.itemTax.value, "1234.50");
  assert.equal(out.itemTax.matchedKey, "item_tax");
  assert.equal(out.itemTax.ruleKey, "tax");
  assert.equal(out.shippingPrice.value, 3.5);
});

test("空值不补零：源空字符串 → null + explicitlyEmpty", () => {
  const out = parseFeesWithRules({ "ItemTax": "" }, rules);
  assert.equal(out.itemTax.value, null);
  assert.equal(out.itemTax.explicitlyEmpty, true);
  const missing = parseFeesWithRules({}, rules);
  assert.equal(missing.itemTax.value, null);
  assert.equal(missing.itemTax.explicitlyEmpty, false);
});

test("优先级：高 priority 规则命中同目标列时，低优先级不覆盖", () => {
  const out = parseFeesWithRules({ "item-tax": "9.99", "tax_amount": "1.00" }, rules);
  assert.equal(out.itemTax.ruleKey, "tax");
  assert.equal(out.itemTax.value, "9.99");
});

test("变换失败：宽松返回 null；strict 抛错（都不臆造）", () => {
  const loose = parseFeesWithRules({ "shipping-price": "not-a-number" }, rules);
  assert.equal(loose.shippingPrice.value, null);
  assert.throws(() => parseFeesWithRules({ "shipping-price": "not-a-number" }, rules, { strict: true }), FeeParseRuleError);
});

test("禁用规则不参与解析；排序不修改原数组", () => {
  const disabled = rules.map(r => r.key === "tax" ? { ...r, enabled: false } : r);
  const out = parseFeesWithRules({ "item-tax": "9.99", "tax_amount": "1.00" }, disabled);
  assert.equal(out.itemTax.ruleKey, "taxLegacy", "高优先级禁用后由低优先级命中");
  const copy = [...rules];
  const sorted = sortRules(rules);
  assert.equal(sorted[0].key, "tax");
  assert.deepEqual(rules, copy, "原数组未被修改");
});
