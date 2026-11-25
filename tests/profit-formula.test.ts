import test from "node:test";
import assert from "node:assert/strict";
import {
  computeProfit, missingStandardKeys, DEFAULT_PROFIT_EXPRESSION, ProfitFormulaError,
  type ProfitItem, type ProfitFormulaConfig,
} from "../src/lib/finance/profit-formula";

function item(key: string, amount: string | null, source = "settlement-2026-11"): ProfitItem {
  return { key, label: key, amount, currency: "CNY", source };
}
const all = (overrides: Record<string, string | null> = {}) =>
  STANDARD.map(k => item(k, overrides[k] !== undefined ? overrides[k] : "1.000000"));
const STANDARD = ["principal", "platformFee", "procurementCost", "firstMile", "ads", "returns", "vat", "local"];
const cfg = (items: ProfitItem[], expression = DEFAULT_PROFIT_EXPRESSION): ProfitFormulaConfig => ({
  organizationId: "o1", workspaceId: "w1", currency: "CNY", version: 1, expression, items,
});

test("默认公式：8 项全配置 → READY，净利润 = 本金 − 7 项费用", () => {
  // 本金 100，7 项费用各 1 → 100-7=93
  const items = all({ principal: "100.000000" });
  const r = computeProfit(cfg(items));
  assert.equal(r.status, "READY");
  assert.equal(r.netProfit, "93.000000");
  assert.equal(r.version, 1);
  assert.equal(r.breakdown.length, 8);
  assert.ok(r.breakdown.every(b => b.included));
});

test("未配置项显式标注：amount=null → INCOMPLETE，netProfit=null（绝不补零）", () => {
  const items = all({ ads: null });
  const r = computeProfit(cfg(items));
  assert.equal(r.status, "INCOMPLETE");
  assert.equal(r.netProfit, null);
  assert.deepEqual(r.pendingSources, ["ads"]);
  assert.equal(r.breakdown.find(b => b.key === "ads")!.included, false);
});

test("无来源项也算 pending（source 空字符串不臆造）", () => {
  const items = all();
  items[4] = { ...items[4], source: "  " };
  const r = computeProfit(cfg(items));
  assert.equal(r.status, "INCOMPLETE");
  assert.ok(r.pendingSources.includes("ads"));
});

test("跨币种混算被拒绝（fail-closed）", () => {
  const items = all();
  items[3] = { ...items[3], currency: "USD" };
  assert.throws(() => computeProfit(cfg(items)), (e: unknown) => e instanceof ProfitFormulaError && /跨币种混算/.test(e.message));
});

test("公式引用未定义项被拒绝", () => {
  assert.throws(
    () => computeProfit(cfg(all(), "[principal]-[unknown]")),
    (e: unknown) => e instanceof ProfitFormulaError && /未定义的项/.test(e.message),
  );
});

test("非法公式（代码注入/函数调用）被安全求值器拒绝", () => {
  assert.throws(() => computeProfit(cfg(all(), "[principal];process.exit()")), ProfitFormulaError);
  assert.throws(() => computeProfit(cfg(all(), "[principal]**2")), ProfitFormulaError);
});

test("缺失标准项检测（供 UI 提示补录）", () => {
  const items = all();
  const reduced = items.filter(i => i.key !== "vat" && i.key !== "local");
  assert.deepEqual(missingStandardKeys(reduced), ["vat", "local"]);
  assert.deepEqual(missingStandardKeys(all()), []);
});

test("自定义公式：仅用就绪项也能求值；缺项不进入公式则不影响 READY", () => {
  const items = [
    item("principal", "50.000000"),
    item("platformFee", "5.000000"),
  ];
  const r = computeProfit(cfg(items, "[principal]-[platformFee]"));
  assert.equal(r.status, "READY");
  assert.equal(r.netProfit, "45.000000");
});
