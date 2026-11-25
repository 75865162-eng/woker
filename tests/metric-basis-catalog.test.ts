import test from "node:test";
import assert from "node:assert/strict";
import {
  GAP_AUDIT_METRIC_BASES, validateBasisList, resolveEnabledBasis, auditBasisCatalog,
  MetricBasisCatalogError, type MetricBasisDef,
} from "../src/lib/metric-basis-catalog";

function throwsWith(fn: () => void, pattern: RegExp) {
  assert.throws(fn, (e: unknown) => e instanceof MetricBasisCatalogError && pattern.test(e.message));
}

test("口径清单：8 个新增内核口径齐全，code 唯一", () => {
  const audit = auditBasisCatalog(GAP_AUDIT_METRIC_BASES);
  assert.equal(audit.totalDefs, 8);
  assert.equal(audit.enabledCount, 8);
  assert.equal(audit.codes.length, 8);
  assert.ok(audit.codes.includes("netProfit"));
  assert.ok(audit.codes.includes("adsAttributionCoverage"));
  assert.equal(audit.missingSemanticsNullCount, 8, "全部口径缺值不补零");
});

test("比率类口径须显式分子分母", () => {
  const bad: MetricBasisDef[] = [{
    code: "badRatio", formula: "a/b", numerator: null, denominator: null, unit: "RATIO",
    source: "x.ts", version: 1, enabled: true, missingSemantics: "null",
  }];
  throwsWith(() => validateBasisList(bad), /分子与分母/);
});

test("版本重复被拒绝", () => {
  const dup = [GAP_AUDIT_METRIC_BASES[0], GAP_AUDIT_METRIC_BASES[0]];
  throwsWith(() => validateBasisList(dup), /版本.*重复/);
});

test("解析启用口径：唯一启用版本返回该版本", () => {
  const r = resolveEnabledBasis("netProfit", GAP_AUDIT_METRIC_BASES);
  assert.ok(r);
  assert.equal(r!.version, 1);
  assert.match(r!.formula, /结算本金/);
  assert.equal(resolveEnabledBasis("不存在的指标", GAP_AUDIT_METRIC_BASES), null);
});

test("同 code 多个启用版本 → 冲突 fail-closed", () => {
  const v2 = { ...GAP_AUDIT_METRIC_BASES[0], version: 2, enabled: true };
  const defs = [...GAP_AUDIT_METRIC_BASES, v2];
  throwsWith(() => resolveEnabledBasis("netProfit", defs), /多个启用版本/);
});

test("缺公式/缺来源被拒绝", () => {
  const noFormula: MetricBasisDef[] = [{ ...GAP_AUDIT_METRIC_BASES[0], formula: "" }];
  throwsWith(() => validateBasisList(noFormula), /公式不能为空/);
  const noSource: MetricBasisDef[] = [{ ...GAP_AUDIT_METRIC_BASES[0], source: "" }];
  throwsWith(() => validateBasisList(noSource), /来源不能为空/);
});
