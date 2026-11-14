import type { PpcAnalysisReport, PpcBidRecommendationItem } from "@/lib/agent-platform/ppc";
import type { ConstraintResult } from "@/lib/ads-inventory/constraint";

/**
 * Applies the ads x inventory constraint to an already-built PPC report.
 *
 * Side-car by design: `ppc.ts` stays untouched, so existing evaluation cases and
 * regression tests keep their behaviour. Callers opt in by wrapping the report.
 */

export type InventoryGateBlock = {
  rowId: string;
  keyword: string;
  target: string;
  currentBid: number;
  suggestedBid: number;
  deltaPercent: number;
  reason: string;
};

export type GatedPpcReport = {
  report: PpcAnalysisReport;
  gate: {
    decision: ConstraintResult["decision"];
    applied: boolean;
    removedBidIncreases: number;
    keptBidDecreases: number;
    maxAdditionalDailySpend: number | null;
    clearanceUnits: number | null;
    evidence: ConstraintResult["evidence"];
    reasons: string[];
    missingInputs: string[];
  };
  blocked: InventoryGateBlock[];
};

const isIncrease = (item: PpcBidRecommendationItem) => item.suggestedBid > item.currentBid || item.deltaPercent > 0;

export function gatePpcReportWithInventory(report: PpcAnalysisReport, constraint: ConstraintResult): GatedPpcReport {
  const blocked: InventoryGateBlock[] = [];
  const kept: PpcBidRecommendationItem[] = [];
  let keptBidDecreases = 0;

  const forbidIncrease = constraint.decision === "BLOCK_BOOST"
    || constraint.decision === "NEEDS_DATA"
    || (constraint.decision === "OPTIMIZE_ACOS" && constraint.currentAcosPct !== null);

  const reasonFor = (item: PpcBidRecommendationItem) => {
    if (constraint.decision === "BLOCK_BOOST") {
      return `库存可售 ${constraint.daysOfCoverP50 ?? "?"} 天 < 必备覆盖 ${constraint.requiredCoverDays ?? "?"} 天：加投（${item.currentBid}→${item.suggestedBid}）会加速断货，已拦截。`;
    }
    if (constraint.decision === "NEEDS_DATA") {
      return `库存或经济性数据未通过校验（${constraint.missingInputs.join("；")}）：加投建议不可执行。`;
    }
    return `当前 ACOS ${constraint.currentAcosPct}% 高于上限 ${constraint.targetAcosPct}%：先降本，加投已拦截。`;
  };

  for (const item of report.bidRecommendations) {
    if (forbidIncrease && isIncrease(item)) {
      blocked.push({
        rowId: item.rowId,
        keyword: item.keyword,
        target: item.target,
        currentBid: item.currentBid,
        suggestedBid: item.suggestedBid,
        deltaPercent: item.deltaPercent,
        reason: reasonFor(item),
      });
      continue;
    }
    if (!isIncrease(item)) keptBidDecreases += 1;
    kept.push(item);
  }

  const gateNote = constraint.decision === "ALLOW_CLEARANCE"
    ? `库存门禁：允许清仓加投，每日额外预算上限 ${constraint.maxAdditionalDailySpend ?? 0}，清仓 ${constraint.clearance?.units ?? 0} 件。`
    : constraint.decision === "BLOCK_BOOST"
      ? `库存门禁：拦截 ${blocked.length} 条加投建议，保留 ${keptBidDecreases} 条降价建议。`
      : constraint.decision === "NEEDS_DATA"
        ? `库存门禁：数据未通过校验，拦截 ${blocked.length} 条加投建议，不出投放结论。`
        : constraint.decision === "OPTIMIZE_ACOS"
          ? `库存门禁：ACOS 超上限，拦截 ${blocked.length} 条加投建议。`
          : `库存门禁：库存与效率均正常，建议保留（单次加投上限 ${constraint.maxAdditionalDailySpend ?? 0}）。`;

  return {
    report: {
      ...report,
      bidRecommendations: kept,
      actionPlan: [...report.actionPlan, gateNote],
    },
    gate: {
      decision: constraint.decision,
      applied: true,
      removedBidIncreases: blocked.length,
      keptBidDecreases,
      maxAdditionalDailySpend: constraint.maxAdditionalDailySpend,
      clearanceUnits: constraint.clearance?.units ?? null,
      evidence: constraint.evidence,
      reasons: constraint.reasons,
      missingInputs: constraint.missingInputs,
    },
    blocked,
  };
}

/** Pass-through used when no inventory constraint is available for the scope. */
export function ungatedPpcReport(report: PpcAnalysisReport): GatedPpcReport {
  return {
    report,
    gate: {
      decision: "NEEDS_DATA",
      applied: false,
      removedBidIncreases: 0,
      keptBidDecreases: report.bidRecommendations.filter((item) => !isIncrease(item)).length,
      maxAdditionalDailySpend: null,
      clearanceUnits: null,
      evidence: { snapshotId: "", snapshotAgeHours: null, demandSource: "", windowDays: 0 },
      reasons: ["未提供库存与需求数据，未应用库存门禁；加投建议需人工复核。"],
      missingInputs: ["库存快照", "需求预测"],
    },
    blocked: [],
  };
}
