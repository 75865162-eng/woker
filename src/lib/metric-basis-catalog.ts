/**
 * 指标口径唯一真相源审计（报告1 P2 统一指标语义层——补充层）。
 *
 * 背景：本项目已有 metrics-registry.ts（8 个广告派生指标的 code/公式/口径唯一，带测试），
 * 报告1 P2 的"统一指标语义层"核心已由它实现。本模块**不重复定义**这些指标，
 * 而是提供跨模块口径清单：把本轮差距审计新增内核（利润/分摊/归因/账本投影/费用解析等）
 * 的口径公式集中登记，做版本化、冲突检测与依赖引用校验，供 BI/报表/审计共用一套口径说明。
 *
 * 红线：
 * - 只登记口径元数据，不做业务计算（计算在各内核内）；
 * - 同一 code 多版本并存需显式 enabled 唯一，冲突时 fail-closed；
 * - 缺来源/缺口径定义显式标注，不臆造公式。
 */

export class MetricBasisCatalogError extends Error {}
function fail(message: string): never { throw new MetricBasisCatalogError(message); }

/** 口径定义（元数据，不含计算实现）。 */
export type MetricBasisDef = {
  /** 指标 code（全局唯一，跨模块命名空间）。 */
  code: string;
  /** 人类可读口径公式（唯一真相源文字）。 */
  formula: string;
  /** 分子/分母口径说明（比率为必填，金额为 null）。 */
  numerator: string | null;
  denominator: string | null;
  /** 单位。 */
  unit: "RATIO" | "MONEY" | "COUNT" | "BP" | "STRING";
  /** 数据来源（模块/报告类型）。 */
  source: string;
  /** 口径版本（正整数）。 */
  version: number;
  /** 是否启用（同 code 只能有一个 enabled 版本）。 */
  enabled: boolean;
  /** 缺失值语义：null=不补零（默认），zero=该指标语义允许 0。 */
  missingSemantics: "null" | "zero";
};

/**
 * 本轮差距审计新增内核的口径清单（公式与内核实现逐字对齐）。
 * 已有广告指标（acos/roas/ctr/cpc/cvr/cpa/acots/asots）见 metrics-registry.ts，此处不重复。
 */
export const GAP_AUDIT_METRIC_BASES: Readonly<MetricBasisDef[]> = Object.freeze([
  {
    code: "netProfit",
    formula: "结算本金 − 平台费 − 采购成本 − 头程 − 广告费 − 退货货损 − VAT − 本地费用",
    numerator: null, denominator: null, unit: "MONEY",
    source: "finance/profit-formula.ts", version: 1, enabled: true, missingSemantics: "null",
  },
  {
    code: "feeAllocationShare",
    formula: "费用总额 × SKU权重 / Σ权重（尾差归末位 SKU）",
    numerator: "费用总额 × SKU权重", denominator: "Σ权重", unit: "MONEY",
    source: "finance/fee-allocation.ts", version: 1, enabled: true, missingSemantics: "null",
  },
  {
    code: "adsAttributionCoverage",
    formula: "已覆盖花费 / 广告总花费（万分比，目标 ≥9950bp）",
    numerator: "coveredSpend", denominator: "totalSpend", unit: "BP",
    source: "amazon-sync/ads-attribution-coverage.ts", version: 1, enabled: true, missingSemantics: "null",
  },
  {
    code: "balanceProjectionClosing",
    formula: "期初 signed + Σ借方 − Σ贷方",
    numerator: null, denominator: null, unit: "MONEY",
    source: "finance/balance-projection.ts", version: 1, enabled: true, missingSemantics: "null",
  },
  {
    code: "fxEntryConvertedBase",
    formula: "原币金额 × 汇率（容差内 ≈ 本位币分录额）",
    numerator: "原币金额", denominator: null, unit: "MONEY",
    source: "finance/fx-entry.ts", version: 1, enabled: true, missingSemantics: "null",
  },
  {
    code: "salesDailyFactOrderCount",
    formula: "COUNT(DISTINCT amazonOrderId) 按 sellerSku/asin/业务日/币种",
    numerator: null, denominator: null, unit: "COUNT",
    source: "amazon-sync/sales-daily-fact.ts", version: 1, enabled: true, missingSemantics: "null",
  },
  {
    code: "inventoryPlanningCoverage",
    formula: "非空字段数 / 应采集字段数（53 列规划报告）",
    numerator: "captured", denominator: "total", unit: "RATIO",
    source: "amazon-sync/inventory-planning-snapshot.ts", version: 1, enabled: true, missingSemantics: "null",
  },
  {
    code: "monthlyReconcileUnpaid",
    formula: "Σ开放项应付 − Σ已结算付款（按供应商/承运商/月，不跨币种）",
    numerator: null, denominator: null, unit: "MONEY",
    source: "finance/reconcile-monthly.ts", version: 1, enabled: true, missingSemantics: "null",
  },
]);

/** 校验口径定义列表：code 非空、版本正、比率的分子分母必填、来源必填。 */
export function validateBasisList(defs: readonly MetricBasisDef[]): void {
  const seen = new Map<string, MetricBasisDef>();
  for (const def of defs) {
    if (typeof def.code !== "string" || !def.code) fail("指标 code 不能为空。");
    if (typeof def.formula !== "string" || !def.formula.trim()) fail(`指标 ${def.code} 口径公式不能为空。`);
    if (!Number.isSafeInteger(def.version) || def.version < 1) fail(`指标 ${def.code} 版本须为正整数。`);
    if (typeof def.source !== "string" || !def.source.trim()) fail(`指标 ${def.code} 来源不能为空。`);
    if ((def.unit === "RATIO" || def.unit === "BP") && (!def.numerator || !def.denominator)) {
      fail(`比率类指标 ${def.code} 须显式提供分子与分母口径。`);
    }
    const prev = seen.get(def.code);
    if (prev && prev.version === def.version) fail(`指标 ${def.code} 版本 ${def.version} 重复。`);
    seen.set(def.code, def);
  }
}

/** 解析启用口径：同 code 只能有一个 enabled 版本，否则冲突 fail-closed。 */
export function resolveEnabledBasis(code: string, defs: readonly MetricBasisDef[]): MetricBasisDef | null {
  const matches = defs.filter(d => d.code === code && d.enabled);
  if (matches.length > 1) fail(`指标 ${code} 存在多个启用版本：${matches.map(d => d.version).join(",")}。`);
  return matches[0] ?? null;
}

/** 审计：列出启用的口径清单与每个 code 的版本，缺来源/缺公式已由 validateBasisList 拦截。 */
export function auditBasisCatalog(defs: readonly MetricBasisDef[]) {
  validateBasisList(defs);
  const enabled = defs.filter(d => d.enabled);
  const byCode = new Map<string, number[]>();
  for (const def of defs) {
    const versions = byCode.get(def.code) ?? [];
    versions.push(def.version);
    byCode.set(def.code, versions);
  }
  return {
    totalDefs: defs.length,
    enabledCount: enabled.length,
    codes: [...byCode.keys()].sort(),
    versions: Object.fromEntries([...byCode].map(([code, versions]) => [code, versions.sort((a, b) => a - b)])),
    missingSemanticsNullCount: enabled.filter(d => d.missingSemantics === "null").length,
  };
}
