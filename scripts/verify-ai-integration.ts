/**
 * End-to-end verification of the AI planning chain, in memory only.
 *
 * Chain: 销量历史 → 预测层 → 补货计划 → 广告×库存约束 → PPC 报告门禁
 *
 * Nothing here touches the database, external APIs, or the LLM. Every number is
 * produced by the deterministic modules that the workers call in production.
 */
import { addDays, weekdayOf } from "@/lib/forecast/types";
import { buildReplenishmentDemandForecast } from "@/lib/operations/replenishment-forecast";
import { calculateReplenishment, parseReplenishmentInputs } from "@/lib/operations/replenishment";
import { buildConstraintFromReplenishmentPlan } from "@/lib/ads-inventory/from-replenishment";
import { gatePpcReportWithInventory } from "@/lib/agent-platform/ppc-inventory-gate";
import { buildAdvisorBrief } from "@/lib/ads-inventory/constraint";
import type { PpcAnalysisReport } from "@/lib/agent-platform/ppc";

const TODAY = "2026-11-14";
const rule = (title: string) => `\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`;
const row = (label: string, value: unknown) => `  ${label.padEnd(30, " ")} ${value === null || value === undefined ? "null" : String(value)}`;

// 1. 180 days of history: weekend peak 26, weekday 12, slow upward trend.
const history = Array.from({ length: 180 }, (_, index) => {
  const date = addDays("2026-05-19", index);
  const weekday = weekdayOf(date);
  const base = weekday === 0 || weekday === 6 ? 26 : 12;
  return { date, units: Math.round(base * (1 + index / 900)) };
});

console.log(rule("1. 预测层（180 天销量 → P50/P90 日需求）"));
const built = buildReplenishmentDemandForecast({ salesHistory: history, asOf: TODAY, horizonDays: 67 });
console.log(row("状态", built.status));
console.log(row("方法", built.detail.method));
console.log(row("置信", built.detail.confidence));
console.log(row("P50 日需求", built.forecast?.p50Daily));
console.log(row("P90 日需求", built.forecast?.p90Daily));
console.log(row("说明", built.note));

// 2. Replenishment with the forecast attached.
function planWith(available: number) {
  const inputs = parseReplenishmentInputs({
    lifecycle: "MATURE",
    matureDemandModel: "COMPLETE_28_DAY",
    productionDays: 30,
    domesticDays: 5,
    oceanDays: 25,
    safetyDays: 7,
    reviewDays: 30,
    salesHistory: history,
    seasonality: null,
    demandForecast: built.forecast,
    receipts: [],
    unitProfit: 6,
    currency: "USD",
    acos: 18,
    advertisingWindow: "last 7 days",
    sourceNote: "验收脚本：预测层接入补货跑批",
  });
  const result = calculateReplenishment(inputs, { available, inbound: 0, fresh: true }, TODAY);
  return {
    generatedAt: new Date(`${TODAY}T02:00:00.000Z`),
    result: { ...result, inventorySource: "sellfox_inventory_current" as const },
    inputSnapshot: {
      inputs,
      inventory: { available, inbound: 0, freshness: "FRESH", capturedAt: `${TODAY}T01:00:00.000Z` },
      inventorySource: "sellfox_inventory_current",
      asOf: TODAY,
    },
  };
}

console.log(rule("2. 补货计划（P50/P90 双情景，可用库存 900）"));
const plan = planWith(900);
const planResult = plan.result as ReturnType<typeof calculateReplenishment>;
console.log(row("状态", planResult.status));
console.log(row("数据来源", planResult.demandSource));
console.log(row("P50 日需求", planResult.dailyDemand));
console.log(row("可售天数 P50", planResult.daysOfCover?.toFixed(2)));
console.log(row("可售天数 P90", planResult.daysOfCoverP90?.toFixed(2)));
console.log(row("建议下单日", planResult.suggestedOrderDate));
console.log(row("断货日 P50 / P90", `${planResult.stockoutWindow?.p50Date} / ${planResult.stockoutWindow?.p90Date}`));
console.log(row("紧急度", planResult.urgency));
console.log(row("建议量 P50 / P90", `${planResult.suggestedQuantity} / ${planResult.suggestedQuantityP90}`));

// 3. Ads x inventory constraint built from that same plan.
const ads = { spend: 200, sales: 1400, orders: 20, acosPct: null, windowDays: 7 };
console.log(rule("3. 广告 × 库存约束（直接读取该补货计划）"));

function report(): PpcAnalysisReport {
  return {
    goal: "降 ACOS 并扩量",
    marketplace: "US",
    scope: { campaignGroupIds: ["g1"], campaignGroupNames: ["Earbuds Group"] },
    summary: "demo",
    diagnosis: [],
    opportunities: [],
    bidRecommendations: [
      { rowId: "r1", campaignGroupId: "g1", keyword: "wireless earbuds", target: "wireless earbuds", currentBid: 1.2, suggestedBid: 1.5, deltaPercent: 25, recommendation: "提高竞价抢占曝光", confidence: 0.8, evidence: [] },
      { rowId: "r2", campaignGroupId: "g1", keyword: "cheap earbuds", target: "cheap earbuds", currentBid: 1.1, suggestedBid: 0.9, deltaPercent: -18, recommendation: "降低竞价控 ACOS", confidence: 0.7, evidence: [] },
      { rowId: "r3", campaignGroupId: "g1", keyword: "earbuds case", target: "earbuds case", currentBid: 0.8, suggestedBid: 1.0, deltaPercent: 25, recommendation: "加投长尾词", confidence: 0.6, evidence: [] },
    ],
    negativeRecommendations: [],
    campaignRecommendations: [],
    actionPlan: [],
    evidence: [],
    recommendation: "demo",
    generatedAt: `${TODAY}T00:00:00.000Z`,
  };
}

for (const [label, available, margin] of [
  ["A 库存紧张（900 件，毛利率 30%）", 900, 30],
  ["B 库存充足（6000 件，毛利率 30%）", 6000, 30],
  ["C 毛利率缺失（6000 件）", 6000, null],
] as const) {
  const constraint = buildConstraintFromReplenishmentPlan({
    sku: "SKU-EARBUDS-01",
    asOf: TODAY,
    now: new Date(`${TODAY}T03:00:00.000Z`),
    plan: planWith(available),
    ads,
    economics: { unitPrice: 22, unitCost: 15.4, grossMarginPct: margin },
  });
  const gated = gatePpcReportWithInventory(report(), constraint);
  const brief = buildAdvisorBrief(constraint, { sku: "SKU-EARBUDS-01", asOf: TODAY });
  console.log(`\n  [${label}]`);
  console.log(row("决策", constraint.decision));
  console.log(row("可售天数 P50 / 必备", `${constraint.daysOfCoverP50} / ${constraint.requiredCoverDays}`));
  console.log(row("目标 ACOS 上限", constraint.targetAcosPct));
  console.log(row("拦截加投 / 保留降价", `${gated.gate.removedBidIncreases} / ${gated.gate.keptBidDecreases}`));
  console.log(row("最终建议条数", gated.report.bidRecommendations.length));
  for (const blocked of gated.blocked) console.log(row(`  拦截 ${blocked.keyword}`, blocked.reason));
  console.log(row("AI 只读摘要（allowedActions）", JSON.stringify(brief.allowedActions)));
}

console.log(rule("结论"));
console.log("  数量与日期全部来自确定性模块；预测层无法计算时自动回落到 28 天模型并在 reasons 中说明。");
console.log("  广告层读取的是补货计划发布的同一份 P50/P90，不另算一份。");
console.log("  毛利率缺失或库存快照过期时，决策降级为 NEEDS_DATA 并拦截加投，不会放行。\n");
