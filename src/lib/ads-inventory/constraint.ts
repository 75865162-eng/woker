/**
 * Ads x inventory constraint engine.
 *
 * Deterministic only: every action and every monetary limit is computed here.
 * The LLM layer may rank and explain these outcomes but MUST NOT create numbers
 * that this module did not produce.
 */

export type AdsWindowMetrics = {
  /** Ad spend in the analysed window (positive number). */
  spend: number | null;
  /** Ad-attributed sales in the same window. */
  sales: number | null;
  orders: number | null;
  /** ACOS as a percentage (0-100). Derived from spend/sales when omitted. */
  acosPct: number | null;
  windowDays: number;
};

export type InventoryPosition = {
  /** Sellable units (FBA fulfillable + own warehouse - reservations). */
  available: number | null;
  /** In-transit with a confirmed ETA only. */
  inboundConfirmed: number | null;
  /** Days since the oldest unsold unit entered stock; null when unknown. */
  agingDays: number | null;
  /** Age of the inventory snapshot in hours; null when unknown. */
  snapshotAgeHours: number | null;
  /** Evidence pointer, e.g. WmsAgingSnapshot / inventory run id. */
  snapshotId: string;
};

export type UnitEconomics = {
  unitPrice: number | null;
  unitCost: number | null;
  /** Gross margin percentage (0-100). Required for any ACOS decision. */
  grossMarginPct: number | null;
  /** Net margin the business wants to keep; drives the ACOS ceiling. */
  targetNetMarginPct: number;
  currency: string;
};

export type DemandStats = {
  p50Daily: number | null;
  p90Daily: number | null;
  /** Where the demand figure came from (forecast method or manual note). */
  source: string;
};

export type LeadTimeInput = {
  productionDays: number | null;
  domesticDays: number | null;
  oceanDays: number | null;
  /** Buffer beyond lead time before boosting is allowed again. */
  safetyDays: number;
};

export type ConstraintPolicy = {
  /** Desired days of cover; above this plus overstock aging, clearance is allowed. */
  targetTurnoverDays: number;
  /** Aging threshold that marks stock as slow-moving. */
  overstockAgingDays: number;
  /** Snapshot older than this blocks any advice. */
  staleSnapshotHours: number;
  /** Planned days over which clearance stock should be sold. */
  clearanceWindowDays: number;
  /** Cap on how much daily spend may be raised at once, in percent of current daily spend. */
  maxDailySpendIncreasePct: number;
};

export type AdsInventoryDecision =
  | "BLOCK_BOOST"
  | "ALLOW_CLEARANCE"
  | "HOLD"
  | "OPTIMIZE_ACOS"
  | "NEEDS_DATA";

export type ConstraintResult = {
  version: "ads-inventory-v1";
  decision: AdsInventoryDecision;
  daysOfCoverP50: number | null;
  daysOfCoverP90: number | null;
  leadDays: number | null;
  /** Days of cover required before any spend increase is safe. */
  requiredCoverDays: number | null;
  stockoutDateP50: string | null;
  currentAcosPct: number | null;
  /** ACOS ceiling implied by margin targets. */
  targetAcosPct: number | null;
  /** Current daily spend, used to size the increase cap. */
  currentDailySpend: number | null;
  maxAdditionalDailySpend: number | null;
  clearance: {
    units: number;
    /** Gross profit that may be given up to clear the excess. */
    lossTolerance: number;
    currency: string;
  } | null;
  allowedActions: string[];
  forbiddenActions: string[];
  evidence: {
    snapshotId: string;
    snapshotAgeHours: number | null;
    demandSource: string;
    windowDays: number;
  };
  reasons: string[];
  missingInputs: string[];
};

export const defaultConstraintPolicy: ConstraintPolicy = {
  targetTurnoverDays: 45,
  overstockAgingDays: 90,
  staleSnapshotHours: 36,
  clearanceWindowDays: 21,
  maxDailySpendIncreasePct: 30,
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

const addDaysIso = (date: string, days: number) =>
  new Date(Date.parse(date) + Math.round(days) * 86_400_000).toISOString().slice(0, 10);

export function resolveCurrentAcos(metrics: AdsWindowMetrics): number | null {
  if (metrics.acosPct !== null && Number.isFinite(metrics.acosPct)) return metrics.acosPct;
  if (metrics.spend !== null && metrics.sales !== null && metrics.sales > 0) return round4((metrics.spend / metrics.sales) * 100);
  return null;
}

/**
 * Core decision. Order matters: risk of stockout always outranks profit motives.
 */
export function evaluateAdsInventoryConstraint(input: {
  sku: string;
  asOf: string;
  ads: AdsWindowMetrics;
  inventory: InventoryPosition;
  economics: UnitEconomics;
  demand: DemandStats;
  lead: LeadTimeInput;
  policy?: Partial<ConstraintPolicy>;
}): ConstraintResult {
  const policy = { ...defaultConstraintPolicy, ...input.policy };
  const reasons: string[] = [];
  const missingInputs: string[] = [];
  const currentAcosPct = resolveCurrentAcos(input.ads);
  const leadParts = [input.lead.productionDays, input.lead.domesticDays, input.lead.oceanDays];
  if (leadParts.some((value) => value === null)) missingInputs.push("生产/国内运输/海运周期");
  const leadDays = leadParts.some((value) => value === null)
    ? null
    : leadParts.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const requiredCoverDays = leadDays === null ? null : leadDays + input.lead.safetyDays;

  if (input.inventory.available === null) missingInputs.push("可售库存");
  if (input.demand.p50Daily === null || input.demand.p50Daily <= 0) missingInputs.push("P50 日需求（零或缺失不能推断）");
  if (input.economics.grossMarginPct === null) missingInputs.push("毛利率");
  if (input.inventory.snapshotAgeHours === null) missingInputs.push("库存快照时间");
  else if (input.inventory.snapshotAgeHours > policy.staleSnapshotHours) {
    missingInputs.push(`新鲜库存快照（当前 ${round2(input.inventory.snapshotAgeHours)} 小时，阈值 ${policy.staleSnapshotHours} 小时）`);
  }

  const base: ConstraintResult = {
    version: "ads-inventory-v1",
    decision: "NEEDS_DATA",
    daysOfCoverP50: null,
    daysOfCoverP90: null,
    leadDays,
    requiredCoverDays,
    stockoutDateP50: null,
    currentAcosPct,
    targetAcosPct: input.economics.grossMarginPct === null ? null : round4(input.economics.grossMarginPct - input.economics.targetNetMarginPct),
    currentDailySpend: input.ads.windowDays > 0 && input.ads.spend !== null ? round2(input.ads.spend / input.ads.windowDays) : null,
    maxAdditionalDailySpend: null,
    clearance: null,
    allowedActions: [],
    forbiddenActions: ["任何加投、提竞价或扩量操作（数据未通过校验）"],
    evidence: {
      snapshotId: input.inventory.snapshotId,
      snapshotAgeHours: input.inventory.snapshotAgeHours,
      demandSource: input.demand.source,
      windowDays: input.ads.windowDays,
    },
    reasons,
    missingInputs,
  };

  if (missingInputs.length > 0) {
    reasons.push("缺少必要事实，不产出投放结论；缺失项不按 0 或均值替代。");
    return base;
  }

  const available = input.inventory.available as number;
  const p50 = input.demand.p50Daily as number;
  const p90 = input.demand.p90Daily;
  const daysOfCoverP50 = available / p50;
  const daysOfCoverP90 = p90 !== null && p90 > 0 ? available / p90 : null;
  const stockoutOffset = Math.floor(daysOfCoverP50);
  const result: ConstraintResult = {
    ...base,
    daysOfCoverP50: round2(daysOfCoverP50),
    daysOfCoverP90: daysOfCoverP90 === null ? null : round2(daysOfCoverP90),
    stockoutDateP50: addDaysIso(input.asOf, stockoutOffset),
  };
  const targetAcos = result.targetAcosPct as number;
  const required = requiredCoverDays as number;

  reasons.push(`可售 ${available}，P50 日需求 ${round2(p50)}，可售天数 ${round2(daysOfCoverP50)} 天；含安全期的必备覆盖 ${required} 天（生产+运输 ${leadDays} + 安全 ${input.lead.safetyDays}）。`);
  if (input.inventory.agingDays !== null) reasons.push(`库龄 ${input.inventory.agingDays} 天；目标周转 ${policy.targetTurnoverDays} 天，滞销阈值 ${policy.overstockAgingDays} 天。`);
  else reasons.push("库龄未知：无法判断滞销，清仓类建议不开放。");
  reasons.push(`目标 ACOS 上限 = 毛利率 ${input.economics.grossMarginPct}% − 目标净利 ${input.economics.targetNetMarginPct}% = ${round4(targetAcos)}%。`);

  if (daysOfCoverP50 < required) {
    result.decision = "BLOCK_BOOST";
    result.maxAdditionalDailySpend = 0;
    result.forbiddenActions = ["加投", "提高竞价", "扩大匹配类型", "增加新广告活动"];
    result.allowedActions = ["降低竞价", "收紧匹配类型", "暂停低转化长尾词", "评估加急补货或跨仓调拨"];
    reasons.push(`可售 ${round2(daysOfCoverP50)} 天 < 必备覆盖 ${required} 天：任何加投都会加速断货，禁止扩量。`);
    if (daysOfCoverP50 < (leadDays as number)) {
      reasons.push(`可售天数已低于纯运输周期 ${leadDays} 天：下一次补货来不及在断货前到仓，只能止损或调拨。`);
    }
    if (daysOfCoverP90 !== null && daysOfCoverP90 < (leadDays as number)) {
      reasons.push(`按 P90 需求，可售天数仅 ${round2(daysOfCoverP90)} 天：断货概率偏高。`);
    }
    return result;
  }

  const isOverstock = input.inventory.agingDays !== null
    && input.inventory.agingDays >= policy.overstockAgingDays
    && daysOfCoverP50 > Math.max(policy.targetTurnoverDays, required);

  if (isOverstock) {
    // A long lead time can exceed the target turnover; the excess must be measured
    // against the larger of the two, otherwise a slow-moving SKU with a 60-day
    // shipping cycle can never qualify for clearance.
    const overstockThresholdDays = Math.max(policy.targetTurnoverDays, required);
    const excessUnits = Math.max(0, Math.ceil(available - p50 * overstockThresholdDays));
    const unitGrossProfit = input.economics.unitPrice !== null && input.economics.grossMarginPct !== null
      ? input.economics.unitPrice * (input.economics.grossMarginPct / 100)
      : null;
    const lossTolerance = unitGrossProfit === null ? null : round2(excessUnits * unitGrossProfit);
    if (lossTolerance !== null && lossTolerance > 0) {
      const dailyFromBudget = lossTolerance / policy.clearanceWindowDays;
      const currentDailySpend = result.currentDailySpend ?? 0;
      const dailyCapFromPct = currentDailySpend * (policy.maxDailySpendIncreasePct / 100);
      const maxAdditionalDailySpend = round2(Math.min(dailyFromBudget, dailyCapFromPct > 0 ? dailyCapFromPct : dailyFromBudget));
      result.decision = "ALLOW_CLEARANCE";
      result.maxAdditionalDailySpend = maxAdditionalDailySpend;
      result.clearance = { units: excessUnits, lossTolerance, currency: input.economics.currency };
      result.allowedActions = ["加投清仓（不超过每日预算上限）", "放宽匹配类型", "配合降价或优惠券"];
      result.forbiddenActions = ["超出清仓预算的加投"];
      reasons.push(`滞销：库龄 ${input.inventory.agingDays} 天且可售 ${round2(daysOfCoverP50)} 天 > 滞销阈值 ${Math.max(policy.targetTurnoverDays, required)} 天（目标周转 ${policy.targetTurnoverDays} 天与必备覆盖 ${required} 天取大）。`);
      reasons.push(`超出目标周转 ${excessUnits} 件，可让出毛利 ${lossTolerance} ${input.economics.currency}，按 ${policy.clearanceWindowDays} 天清仓，每日加投上限 ${maxAdditionalDailySpend}（同时受当前日均花费 +${policy.maxDailySpendIncreasePct}% 约束）。`);
    } else {
      result.decision = "OPTIMIZE_ACOS";
      result.maxAdditionalDailySpend = 0;
      result.allowedActions = ["降价清仓", "参加站内促销"];
      result.forbiddenActions = ["加投（缺少单位毛利，无法核定清仓预算）"];
      reasons.push("判定为滞销，但单位毛利或单价缺失，无法核定清仓预算，不开放加投。");
    }
    return result;
  }

  if (currentAcosPct === null) {
    result.decision = "NEEDS_DATA";
    missingInputs.push("广告 ACOS（花费/销售额）");
    result.forbiddenActions = ["加投（缺少 ACOS 依据）"];
    reasons.push("缺少 ACOS，无法判断投放效率。");
    return result;
  }

  if (currentAcosPct > targetAcos) {
    result.decision = "OPTIMIZE_ACOS";
    result.maxAdditionalDailySpend = 0;
    result.allowedActions = ["降低高 ACOS 词竞价", "否定低转化词", "收紧匹配类型"];
    result.forbiddenActions = ["加投", "提高竞价"];
    reasons.push(`当前 ACOS ${round2(currentAcosPct)}% 高于上限 ${round4(targetAcos)}%，先降本再谈扩量。`);
    return result;
  }

  result.decision = "HOLD";
  const currentDailySpend = result.currentDailySpend ?? 0;
  result.maxAdditionalDailySpend = round2(currentDailySpend * (policy.maxDailySpendIncreasePct / 100));
  result.allowedActions = [`维持并小幅优化（单次加投不超过 ${result.maxAdditionalDailySpend}）`];
  result.forbiddenActions = [];
  reasons.push(`ACOS ${round2(currentAcosPct)}% 优于上限 ${round4(targetAcos)}%，库存覆盖充足，可维持投放并按上限小幅加投。`);
  return result;
}

/**
 * Structured brief for the AI layer. Contains no quantities: the model ranks and
 * explains, it never invents numbers.
 */
export function buildAdvisorBrief(result: ConstraintResult, input: { sku: string; asOf: string }) {
  return {
    version: "ads-advisor-brief-v1",
    sku: input.sku,
    asOf: input.asOf,
    decision: result.decision,
    facts: {
      daysOfCoverP50: result.daysOfCoverP50,
      daysOfCoverP90: result.daysOfCoverP90,
      requiredCoverDays: result.requiredCoverDays,
      currentAcosPct: result.currentAcosPct,
      targetAcosPct: result.targetAcosPct,
      stockoutDateP50: result.stockoutDateP50,
      clearanceUnits: result.clearance?.units ?? null,
    },
    allowedActions: result.allowedActions,
    forbiddenActions: result.forbiddenActions,
    evidence: result.evidence,
    reasons: result.reasons,
    missingInputs: result.missingInputs,
  };
}
