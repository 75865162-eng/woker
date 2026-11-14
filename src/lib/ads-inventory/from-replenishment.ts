import {
  evaluateAdsInventoryConstraint,
  type AdsWindowMetrics,
  type ConstraintPolicy,
  type ConstraintResult,
  type UnitEconomics,
} from "./constraint";

/**
 * Derives the ads x inventory constraint from an existing replenishment plan.
 *
 * The point is traceability: the PPC gate must reuse the SAME demand numbers the
 * replenishment run published, instead of recomputing a second, slightly different
 * forecast. Every field is read defensively — anything unreadable becomes `null`
 * and the constraint engine returns NEEDS_DATA rather than a guessed action.
 */

export type ReplenishmentPlanFacts = {
  p50Daily: number | null;
  p90Daily: number | null;
  demandSource: "FORECAST" | "MANUAL_SEASONALITY" | "NONE";
  available: number | null;
  inboundConfirmed: number | null;
  lead: { productionDays: number | null; domesticDays: number | null; oceanDays: number | null; safetyDays: number };
  unitProfit: number | null;
  currency: string | null;
  inventoryCapturedAt: string | null;
  planGeneratedAt: string | null;
  inventorySource: string | null;
  /** Oldest occupied WMS aging band; null keeps the clearance branch closed. */
  agingDays: number | null;
  agingSnapshotId: string | null;
  agingNote: string | null;
  unreadable: string[];
};

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export function readReplenishmentPlanFacts(
  plan: { generatedAt?: Date; result: unknown; inputSnapshot: unknown } | null,
): ReplenishmentPlanFacts {
  const unreadable: string[] = [];
  const result = readRecord(plan?.result);
  const snapshot = readRecord(plan?.inputSnapshot);
  const inputs = readRecord(snapshot?.inputs);
  const inventory = readRecord(snapshot?.inventory);
  const aging = readRecord(snapshot?.aging);

  if (!result) unreadable.push("补货计划结果");
  if (!inputs) unreadable.push("补货参数快照");

  const p50Daily = readNumber(result?.dailyDemand);
  const p90Daily = readNumber(result?.dailyDemandP90);
  if (p50Daily === null) unreadable.push("补货计划 P50 日需求");

  return {
    p50Daily: p50Daily !== null && p50Daily > 0 ? p50Daily : null,
    p90Daily: p90Daily !== null && p90Daily > 0 ? p90Daily : null,
    demandSource: result?.demandSource === "FORECAST" || result?.demandSource === "MANUAL_SEASONALITY" ? result.demandSource : "NONE",
    available: readNumber(inventory?.available),
    inboundConfirmed: readNumber(inventory?.inbound),
    lead: {
      productionDays: readNumber(inputs?.productionDays),
      domesticDays: readNumber(inputs?.domesticDays),
      oceanDays: readNumber(inputs?.oceanDays),
      safetyDays: readNumber(inputs?.safetyDays) ?? 14,
    },
    unitProfit: readNumber(inputs?.unitProfit),
    currency: typeof inputs?.currency === "string" ? inputs.currency : null,
    inventoryCapturedAt: typeof inventory?.capturedAt === "string" ? inventory.capturedAt : null,
    planGeneratedAt: plan?.generatedAt ? plan.generatedAt.toISOString() : null,
    inventorySource: typeof result?.inventorySource === "string" ? result.inventorySource : null,
    agingDays: readNumber(aging?.agingDays),
    agingSnapshotId: typeof aging?.snapshotId === "string" ? aging.snapshotId : null,
    agingNote: typeof aging?.note === "string" ? aging.note : null,
    unreadable,
  };
}

export type PlanConstraintEconomics = {
  /** Selling price used to convert margin percentages into a clearance loss budget. */
  unitPrice: number | null;
  unitCost: number | null;
  /** Gross margin percentage (0-100). Without it the engine never opens a boost. */
  grossMarginPct: number | null;
  targetNetMarginPct?: number;
  currency?: string | null;
};

export function buildConstraintFromReplenishmentPlan(input: {
  sku: string;
  asOf: string;
  now: Date;
  plan: { generatedAt: Date; result: unknown; inputSnapshot: unknown } | null;
  ads: AdsWindowMetrics;
  economics: PlanConstraintEconomics;
  policy?: Partial<ConstraintPolicy>;
}): ConstraintResult {
  const facts = readReplenishmentPlanFacts(input.plan);
  const snapshotAgeHours = facts.inventoryCapturedAt !== null && Number.isFinite(Date.parse(facts.inventoryCapturedAt))
    ? Math.max(0, (input.now.getTime() - Date.parse(facts.inventoryCapturedAt)) / 3_600_000)
    : null;

  const economics: UnitEconomics = {
    unitPrice: input.economics.unitPrice,
    unitCost: input.economics.unitCost,
    grossMarginPct: input.economics.grossMarginPct,
    targetNetMarginPct: input.economics.targetNetMarginPct ?? 15,
    currency: input.economics.currency ?? facts.currency ?? "USD",
  };

  const result = evaluateAdsInventoryConstraint({
    sku: input.sku,
    asOf: input.asOf,
    ads: input.ads,
    inventory: {
      available: facts.available,
      inboundConfirmed: facts.inboundConfirmed,
      // Aging comes from the WMS snapshot captured with the plan. When absent it stays
      // null, which keeps clearance closed instead of assuming stock is fresh.
      agingDays: facts.agingDays,
      snapshotAgeHours,
      snapshotId: facts.inventoryCapturedAt !== null ? `replenishment:${input.sku}@${facts.inventoryCapturedAt}` : "",
    },
    economics,
    demand: {
      p50Daily: facts.p50Daily,
      p90Daily: facts.p90Daily,
      source: `replenishment-plan:${facts.demandSource}${facts.planGeneratedAt ? `@${facts.planGeneratedAt}` : ""}`,
    },
    lead: facts.lead,
    policy: input.policy,
  });

  if (!input.plan) {
    result.reasons.push("该 MSKU 没有补货计划：库存门禁无事实依据，按数据缺失处理。");
  } else if (facts.unreadable.length) {
    result.reasons.push(`补货计划字段不可读：${facts.unreadable.join("；")}。`);
  }
  if (facts.available === null && input.plan) {
    result.reasons.push("补货计划未记录可售库存快照：库存门禁不可用。");
  }
  if (facts.agingNote) {
    result.reasons.push(`库龄：${facts.agingNote}`);
  } else if (facts.agingDays === null && input.plan) {
    result.reasons.push("补货计划无 WMS 库龄快照：清仓分支保持关闭。");
  }
  return result;
}

/** Ads window metrics from PPC rows. Window days must be stated by the caller. */
export function adsMetricsFromRows(input: {
  rows: Array<{ spend: number; sales: number; orders: number }>;
  windowDays: number | null;
}): AdsWindowMetrics {
  const spend = input.rows.reduce((sum, row) => sum + (Number.isFinite(row.spend) ? row.spend : 0), 0);
  const sales = input.rows.reduce((sum, row) => sum + (Number.isFinite(row.sales) ? row.sales : 0), 0);
  const orders = input.rows.reduce((sum, row) => sum + (Number.isFinite(row.orders) ? row.orders : 0), 0);
  return {
    spend: input.rows.length ? spend : null,
    sales: input.rows.length ? sales : null,
    orders: input.rows.length ? orders : null,
    acosPct: input.rows.length && sales > 0 ? Math.round((spend / sales) * 10_000) / 100 : null,
    windowDays: input.windowDays ?? 0,
  };
}

/**
 * Fail-closed placeholder for when the constraint cannot be computed at all
 * (database error, unreadable plan). A safety gate must never fail open: the
 * decision degrades to NEEDS_DATA, which blocks every bid increase.
 */
export function failClosedConstraint(reason: string): ConstraintResult {
  const result = evaluateAdsInventoryConstraint({
    sku: "UNKNOWN",
    asOf: new Date().toISOString().slice(0, 10),
    ads: { spend: null, sales: null, orders: null, acosPct: null, windowDays: 0 },
    inventory: { available: null, inboundConfirmed: null, agingDays: null, snapshotAgeHours: null, snapshotId: "" },
    economics: { unitPrice: null, unitCost: null, grossMarginPct: null, targetNetMarginPct: 15, currency: "USD" },
    demand: { p50Daily: null, p90Daily: null, source: reason },
    lead: { productionDays: null, domesticDays: null, oceanDays: null, safetyDays: 14 },
  });
  result.reasons.push(reason);
  return result;
}
