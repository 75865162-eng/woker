import test from "node:test";
import assert from "node:assert/strict";
import { checkFxEntry, checkFxEntries, FxEntryRuleError } from "../src/lib/finance/fx-entry";

test("本位币分录：视作 BASE_CURRENCY，不要求三栏", () => {
  const r = checkFxEntry({ currency: "CNY", baseAmount: "100.000000" }, "CNY");
  assert.equal(r.kind, "BASE_CURRENCY");
  assert.equal(r.baseAmount, "100.000000");
  assert.equal(r.convertedBase, null);
});

test("外币三栏齐全：原币×汇率≈本位币（容差内通过）", () => {
  const r = checkFxEntry({ currency: "USD", originalAmount: "10.00", exchangeRate: "7.120000000000", baseAmount: "71.200000" }, "CNY");
  assert.equal(r.kind, "CONVERTED");
  assert.equal(r.convertedBase, "71.200000");
  assert.equal(r.difference, "0.000000");
});

test("容差内的小额舍入差异允许通过（0.1%）", () => {
  // 10 × 7.12 = 71.2；本位币 71.19，差 0.01，容差 = 71.2 × 0.1% = 0.0712 → 通过
  const r = checkFxEntry({ currency: "USD", originalAmount: "10", exchangeRate: "7.12", baseAmount: "71.19" }, "CNY");
  assert.equal(r.kind, "CONVERTED");
  assert.ok(r.difference !== null && Math.abs(Number(r.difference)) > 0);
});

test("超出容差：抛错（防止外币凭证错账）", () => {
  assert.throws(
    () => checkFxEntry({ currency: "USD", originalAmount: "10", exchangeRate: "7.12", baseAmount: "100" }, "CNY"),
    (e: unknown) => e instanceof FxEntryRuleError && /超出容差/.test((e as Error).message),
  );
});

test("外币缺三栏：NO_FX_DATA，绝不臆造汇率", () => {
  const missingRate = checkFxEntry({ currency: "USD", originalAmount: "10", baseAmount: "71.2" }, "CNY");
  assert.equal(missingRate.kind, "NO_FX_DATA");
  assert.equal(missingRate.convertedBase, null);
  const missingBoth = checkFxEntry({ currency: "EUR", baseAmount: "50" }, "CNY");
  assert.equal(missingBoth.kind, "NO_FX_DATA");
});

test("非法/非正汇率：拒绝（不臆造）", () => {
  assert.throws(() => checkFxEntry({ currency: "USD", originalAmount: "10", exchangeRate: "0", baseAmount: "0" }, "CNY"), FxEntryRuleError);
  assert.throws(() => checkFxEntry({ currency: "USD", originalAmount: "10", exchangeRate: "-7", baseAmount: "-70" }, "CNY"), FxEntryRuleError);
  assert.throws(() => checkFxEntry({ currency: "USD", originalAmount: "10", exchangeRate: "abc", baseAmount: "70" }, "CNY"), FxEntryRuleError);
});

test("币种格式校验", () => {
  assert.throws(() => checkFxEntry({ currency: "usd", baseAmount: "1" }, "CNY"), FxEntryRuleError);
  assert.throws(() => checkFxEntry({ currency: "USD", baseAmount: "1" }, "cny"), FxEntryRuleError);
});

test("批量校验：逐条返回，任一条超差整批抛错", () => {
  const good = checkFxEntries([
    { currency: "CNY", baseAmount: "10" },
    { currency: "USD", originalAmount: "2", exchangeRate: "7", baseAmount: "14" },
  ], "CNY");
  assert.deepEqual(good.map((r) => r.kind), ["BASE_CURRENCY", "CONVERTED"]);
  assert.throws(() => checkFxEntries([
    { currency: "USD", originalAmount: "2", exchangeRate: "7", baseAmount: "14" },
    { currency: "USD", originalAmount: "2", exchangeRate: "7", baseAmount: "999" },
  ], "CNY"), FxEntryRuleError);
});

test("容差边界：toleranceBp 非法拒绝", () => {
  assert.throws(() => checkFxEntry({ currency: "CNY", baseAmount: "1" }, "CNY", -1), FxEntryRuleError);
  assert.throws(() => checkFxEntry({ currency: "CNY", baseAmount: "1" }, "CNY", 10001), FxEntryRuleError);
  assert.throws(() => checkFxEntry({ currency: "CNY", baseAmount: "1" }, "CNY", 1.5), FxEntryRuleError);
});
