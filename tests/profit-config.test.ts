import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProfitConfig, validateParam, resolveProfitConfig, effectiveProfitParams,
  PROFIT_PARAM_KEYS, ProfitConfigError, type ProfitConfigInput,
} from "../src/lib/sellfox/profit-config";

const base = (over: Partial<ProfitConfigInput> = {}): ProfitConfigInput => ({
  organizationId: "o1", workspaceId: "w1", shopId: "shop-1", country: "US", isDefault: false,
  version: 1, values: { vatRate: 0.19, storageFee: 0.5, fenpeiType: "BY_SALES" },
  changeReference: "policy-2026-11",
  ...over,
});

test("构建配置：23 参数键齐全，已配置/未配置显式分类", () => {
  const r = buildProfitConfig(base());
  assert.equal(PROFIT_PARAM_KEYS.length, 23);
  assert.deepEqual(r.configuredKeys, ["vatRate", "storageFee", "fenpeiType"]);
  assert.equal(r.missingKeys.length, 20);
  assert.match(r.changeKey, /profitcfg\|o1\|w1\|shop-1\|US\|1/);
});

test("比率参数须在 [0,1]：越界/非数被拒绝", () => {
  assert.throws(() => validateParam("vatRate", 1.5), ProfitConfigError);
  assert.throws(() => validateParam("taxRate", -0.1), ProfitConfigError);
  assert.throws(() => validateParam("taxRate", "0.2" as never), ProfitConfigError);
  assert.doesNotThrow(() => validateParam("vatRate", 0));
  assert.doesNotThrow(() => validateParam("vatRate", 1));
});

test("非负数值参数与枚举参数校验", () => {
  assert.throws(() => validateParam("storageFee", -1), ProfitConfigError);
  assert.throws(() => validateParam("fenpeiType", "BOGUS" as never), ProfitConfigError);
  assert.doesNotThrow(() => validateParam("fenpeiType", "BY_QTY"));
  assert.doesNotThrow(() => validateParam("roundingMode", "HALF_UP"));
});

test("null 参数合法（未配置，不臆造默认值）", () => {
  assert.doesNotThrow(() => validateParam("vatRate", null));
  const r = buildProfitConfig(base({ values: {} }));
  assert.equal(r.missingKeys.length, 23);
});

test("非法租户/国家/版本/变更依据被拒绝", () => {
  assert.throws(() => buildProfitConfig(base({ country: "us" })), ProfitConfigError);
  assert.throws(() => buildProfitConfig(base({ version: 0 })), ProfitConfigError);
  assert.throws(() => buildProfitConfig(base({ changeReference: "" })), ProfitConfigError);
});

test("解析优先级：精确国家 > 店铺默认 ALL；无匹配返回 null", () => {
  const exact = buildProfitConfig(base({ country: "US", values: { vatRate: 0.2 } }));
  const fallback = buildProfitConfig(base({ country: "ALL", isDefault: true, values: { vatRate: 0.19, storageFee: 0.5 } }));
  assert.equal(resolveProfitConfig("US", [exact, fallback])!.changeKey, exact.changeKey);
  assert.equal(resolveProfitConfig("DE", [exact, fallback])!.changeKey, fallback.changeKey);
  assert.equal(resolveProfitConfig("DE", [exact]), null);
});

test("有效参数合并：精确覆盖默认，缺项仍 null（不补默认）", () => {
  const exact = buildProfitConfig(base({ country: "US", values: { vatRate: 0.2 } }));
  const fallback = buildProfitConfig(base({ country: "ALL", isDefault: true, values: { vatRate: 0.19, storageFee: 0.5 } }));
  const { params, missingKeys } = effectiveProfitParams(exact, fallback);
  assert.equal(params.vatRate, 0.2, "精确国家覆盖默认");
  assert.equal(params.storageFee, 0.5, "默认补齐未配置参数");
  assert.equal(params.fbaMonth, null, "两级都缺保持 null");
  assert.ok(missingKeys.includes("fbaMonth"));
});
