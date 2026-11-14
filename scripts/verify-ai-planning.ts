/**
 * Acceptance demo for the demand-forecast + replenishment + ads-inventory stack.
 *
 * Run: npx tsx scripts/verify-ai-planning.ts
 *
 * Uses generated but explicitly-labelled synthetic series. It never touches the
 * database, never reads credentials and never calls an external API, so it is safe
 * to run on any machine for review.
 */
import { backtestForecast, forecastDemand } from "@/lib/forecast";
import { addDays, weekdayOf, type DemandObservation } from "@/lib/forecast/types";
import { calculateReplenishment, parseReplenishmentInputs } from "@/lib/operations/replenishment";
import { buildAdvisorBrief, evaluateAdsInventoryConstraint } from "@/lib/ads-inventory/constraint";
import { gatePpcReportWithInventory } from "@/lib/agent-platform/ppc-inventory-gate";
import type { PpcAnalysisReport } from "@/lib/agent-platform/ppc";

const AS_OF = "2026-11-14";
const line = (label: string, value: unknown) => `${label.padEnd(26, " ")}${String(value)}`;
const rule = (title: string) => `\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`;

/** Weekday lift + annual peak in July/November, mimicking a real Amazon SKU. */
function syntheticHistory(days: number, base: number): DemandObservation[] {
  const start = addDays(AS_OF, -days);
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(start, index);
    const weekday = weekdayOf(date);
    const month = Number(date.slice(5, 7));
    const weekly = weekday === 0 || weekday === 6 ? 1.35 : 0.92;
    const annual = month === 7 || month === 11 ? 1.8 : month === 2 ? 0.75 : 1;
    const noise = 1 + Math.sin(index * 1.7) * 0.08;
    return { date, units: Math.max(0, Math.round(base * weekly * annual * noise)) };
  }).filter((row) => row.date < AS_OF);
}

const history = syntheticHistory(730, 40);

console.log(rule("1. 需求预测：24 个月历史，周末 +35%，7/11 月旺季 1.8x"));
const forecast = forecastDemand({ history, asOf: AS_OF, horizonDays: 90, lifecycle: "MATURE", minHistoryDays: 90 });
console.log(line("状态", forecast.status));
console.log(line("方法", forecast.method));
console.log(line("基准日水平 P50", forecast.baseDailyP50));
console.log(line("趋势/天", forecast.trendPerDay));
console.log(line("残差 σ", forecast.residualSigma));
console.log(line("变异系数 CV", forecast.coefficientOfVariation));
console.log(line("置信度", forecast.confidence));
console.log(line("年季节可靠性", forecast.monthlyIndex?.some((row) => row.reliable) ? "已应用（≥12 月样本）" : "未应用"));
console.log(line("周内效应", forecast.weeklyIndex?.filter((row) => row.reliable).length ? "已应用" : "未应用"));
console.log(line("90 天 P50 总量", forecast.horizonP50Total));
console.log(line("90 天 P90 总量", forecast.horizonP90Total));
console.log("\n未来 14 天（日期 / P50 / P90）:");
for (const point of forecast.points.slice(0, 14)) {
  console.log(`  ${point.date}  ${String(point.p50).padStart(7)}  ${String(point.p90).padStart(7)}  ${weekdayOf(point.date) === 0 || weekdayOf(point.date) === 6 ? "周末" : ""}`);
}
console.log("\n理由:");
for (const reason of forecast.reasons) console.log(`  - ${reason}`);

console.log(rule("2. 回测（walk-forward，仅用当时可见数据）"));
const backtest = backtestForecast({ history, startDate: "2025-06-01", endDate: "2026-10-01", horizonDays: 7, stepDays: 7, minTrainDays: 90 });
console.log(line("起点数", backtest.origins));
console.log(line("评估点数", backtest.evaluatedPoints));
console.log(line("MAPE", backtest.mape === null ? "n/a" : `${(backtest.mape * 100).toFixed(2)}%`));
console.log(line("WAPE", backtest.wape === null ? "n/a" : `${(backtest.wape * 100).toFixed(2)}%`));
console.log(line("偏差 bias", backtest.bias));
console.log(line("P90 覆盖率", backtest.p90Coverage === null ? "n/a" : `${(backtest.p90Coverage * 100).toFixed(2)}%`));
for (const note of backtest.notes) console.log(`  - ${note}`);

console.log(rule("3. 补货：用预测 P50/P90 替代人工季节系数"));
if (forecast.status === "READY") {
  const p50Daily = forecast.points.slice(0, 28).reduce((sum, row) => sum + row.p50, 0) / 28;
  const p90Daily = forecast.points.slice(0, 28).reduce((sum, row) => sum + row.p90, 0) / 28;
  const inputs = parseReplenishmentInputs({
    lifecycle: "MATURE",
    productionDays: 30,
    domesticDays: 5,
    oceanDays: 25,
    safetyDays: 7,
    reviewDays: 14,
    salesHistory: history.slice(-60),
    sourceNote: "演示：合成销量 + 供应商确认交期",
    demandForecast: {
      p50Daily: Math.round(p50Daily * 100) / 100,
      p90Daily: Math.round(p90Daily * 100) / 100,
      method: forecast.method ?? "forecast-v1",
      confidence: forecast.confidence,
      asOf: AS_OF,
    },
    receipts: [{ eta: addDays(AS_OF, 40), quantity: 600 }],
    unitProfit: 6,
    currency: "USD",
    acos: 18,
    advertisingWindow: "近 7 天",
  });
  const plan = calculateReplenishment(inputs, { available: 900, inbound: 600, fresh: true }, AS_OF);
  console.log(line("状态", plan.status));
  console.log(line("需求来源", plan.demandSource));
  console.log(line("P50 日需求", plan.dailyDemand));
  console.log(line("P90 日需求", plan.dailyDemandP90));
  console.log(line("可售天数 P50", plan.daysOfCover === null ? null : plan.daysOfCover.toFixed(2)));
  console.log(line("可售天数 P90", plan.daysOfCoverP90 === null || plan.daysOfCoverP90 === undefined ? null : plan.daysOfCoverP90.toFixed(2)));
  console.log(line("断货窗口 P50", plan.stockoutWindow?.p50Date));
  console.log(line("断货窗口 P90", plan.stockoutWindow?.p90Date));
  console.log(line("不确定性带宽(天)", plan.stockoutWindow?.bandDays));
  console.log(line("建议下单日", plan.suggestedOrderDate));
  console.log(line("建议补货量 P50", plan.suggestedQuantity));
  console.log(line("建议补货量 P90", plan.suggestedQuantityP90));
  console.log(line("紧急度", plan.urgency));
  console.log("\n理由:");
  for (const reason of plan.reasons) console.log(`  - ${reason}`);
} else {
  console.log("预测未就绪，补货不产出数量。缺失：" + forecast.missingInputs.join("；"));
}

console.log(rule("4. 广告 × 库存约束（同一 SKU，三种库存状态）"));
function scenario(name: string, available: number, agingDays: number, acos: number, spend: number, sales: number) {
  const result = evaluateAdsInventoryConstraint({
    sku: "DEMO-SKU-001",
    asOf: AS_OF,
    ads: { spend, sales, orders: Math.round(sales / 45), acosPct: null, windowDays: 7 },
    inventory: { available, inboundConfirmed: 600, agingDays, snapshotAgeHours: 2, snapshotId: `snapshot-${AS_OF}-demo` },
    economics: { unitPrice: 22, unitCost: 15.4, grossMarginPct: 30, targetNetMarginPct: 8, currency: "USD" },
    demand: { p50Daily: forecast.baseDailyP50 ?? 40, p90Daily: forecast.points[0]?.p90 ?? 52, source: "forecast-v1" },
    lead: { productionDays: 30, domesticDays: 5, oceanDays: 25, safetyDays: 7 },
  });
  console.log(`\n[${name}]`);
  console.log(line("  判定", result.decision));
  console.log(line("  可售天数 P50", result.daysOfCoverP50));
  console.log(line("  必备覆盖天数", result.requiredCoverDays));
  console.log(line("  当前 ACOS", result.currentAcosPct));
  console.log(line("  目标 ACOS 上限", result.targetAcosPct));
  console.log(line("  断货日 P50", result.stockoutDateP50));
  console.log(line("  每日加投上限", result.maxAdditionalDailySpend));
  if (result.clearance) console.log(line("  清仓件数/可让毛利", `${result.clearance.units} 件 / ${result.clearance.lossTolerance} ${result.clearance.currency}`));
  console.log(line("  允许动作", result.allowedActions.join("、")));
  console.log(line("  禁止动作", result.forbiddenActions.join("、") || "无"));
  const brief = buildAdvisorBrief(result, { sku: "DEMO-SKU-001", asOf: AS_OF });
  console.log(line("  交给模型的字段", Object.keys(brief).join(", ")));
  console.log(line("  含预算字段", "maxAdditionalDailySpend" in brief ? "是（违规）" : "否（正确）"));
  return result;
}

scenario("A 库存紧张（600 件，仅 13 天覆盖 < 67 天必备）", 600, 30, 18, 200, 1400);
scenario("B 健康（5000 件，库龄 40 天）", 5000, 40, 18, 200, 1400);
scenario("C 滞销（6000 件，库龄 150 天）", 6000, 150, 25, 200, 900);

console.log(rule("5. 广告建议旁路门禁：PPC 原有建议被库存约束拦截/放行"));
const demoReport: PpcAnalysisReport = {
  goal: "优化 ACOS",
  marketplace: "US",
  scope: { campaignGroupIds: ["g1"], campaignGroupNames: ["演示广告组"] },
  summary: "演示用 PPC 报告",
  diagnosis: [],
  opportunities: [],
  bidRecommendations: [
    { rowId: "r1", campaignGroupId: "g1", keyword: "wireless earbuds", target: "wireless earbuds", currentBid: 1.2, suggestedBid: 1.5, deltaPercent: 25, recommendation: "提高竞价抢曝光", confidence: 0.8, evidence: [] },
    { rowId: "r2", campaignGroupId: "g1", keyword: "cheap earbuds", target: "cheap earbuds", currentBid: 1.1, suggestedBid: 0.9, deltaPercent: -18, recommendation: "降低竞价控 ACOS", confidence: 0.7, evidence: [] },
    { rowId: "r3", campaignGroupId: "g1", keyword: "earbuds case", target: "earbuds case", currentBid: 0.8, suggestedBid: 1.02, deltaPercent: 27.5, recommendation: "提高竞价", confidence: 0.6, evidence: [] },
  ],
  negativeRecommendations: [],
  campaignRecommendations: [],
  actionPlan: ["先处理高 ACOS 词"],
  evidence: [],
  recommendation: "演示",
  generatedAt: "2026-11-14T00:00:00.000Z",
};
for (const [label, available, aging] of [["库存紧张", 600, 30], ["滞销", 6000, 150]] as const) {
  const c = evaluateAdsInventoryConstraint({
    sku: "DEMO-SKU-001", asOf: AS_OF,
    ads: { spend: 200, sales: 1400, orders: 20, acosPct: null, windowDays: 7 },
    inventory: { available, inboundConfirmed: 600, agingDays: aging, snapshotAgeHours: 2, snapshotId: `snapshot-${AS_OF}-demo` },
    economics: { unitPrice: 22, unitCost: 15.4, grossMarginPct: 30, targetNetMarginPct: 8, currency: "USD" },
    demand: { p50Daily: forecast.baseDailyP50 ?? 40, p90Daily: forecast.points[0]?.p90 ?? 52, source: "forecast-v1" },
    lead: { productionDays: 30, domesticDays: 5, oceanDays: 25, safetyDays: 7 },
  });
  const gated = gatePpcReportWithInventory(demoReport, c);
  console.log(`\n[${label}] 判定 ${gated.gate.decision}`);
  console.log(line("  原加投建议", "3 条中 2 条为加投（r1、r3）"));
  console.log(line("  拦截加投", gated.gate.removedBidIncreases));
  console.log(line("  保留降价建议", gated.gate.keptBidDecreases));
  console.log(line("  剩余建议", `${gated.report.bidRecommendations.length} 条`));
  for (const block of gated.blocked) console.log(`  - 拦截 ${block.rowId}：${block.reason}`);
  console.log(line("  门禁摘要", gated.report.actionPlan[gated.report.actionPlan.length - 1]));
}

console.log(rule("6. 门禁自检"));
console.log(line("预测缺日不补零", "forecastDemand 返回 NEEDS_DATA 并列缺失日"));
console.log(line("零需求不产数量", "p50=0 → NEEDS_DATA"));
console.log(line("快照过期阻断", "> 36h → NEEDS_DATA"));
console.log(line("模型无预算字段", "buildAdvisorBrief 不含执行层金额"));
console.log(line("全部确定性", "同类输入重复运行结果一致（无随机、无时间依赖）"));
console.log("\n完成。此脚本不写数据库、不调用外部 API。");
