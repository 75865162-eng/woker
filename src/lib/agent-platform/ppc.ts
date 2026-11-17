import type { AgentEventName, AgentRuntimeExecutor, JsonValue } from "./types";
import { gatePpcReportWithInventory, ungatedPpcReport, type GatedPpcReport } from "./ppc-inventory-gate";
import { failClosedConstraint } from "@/lib/ads-inventory/from-replenishment";
import type { ConstraintResult } from "@/lib/ads-inventory/constraint";
import type { PpcExecutionRequest } from "./ppc-contracts";
import { normalizePpcExecutionRequest, toJsonValue } from "./ppc-normalization";
import { extractReport, extractEvidence, buildAdjustmentDrafts, buildMemoryItems, computeConfidence } from "./ppc-reporting";

export function createPpcAgentExecutionExecutor(options: {
  request: PpcExecutionRequest;
  requestedByUserId?: string;
  clock?: () => Date;
  /**
   * Optional inventory constraint. When supplied, bid increases that conflict with
   * stock coverage are removed from the report and from the adjustment drafts that
   * would later become Amazon actions. `null` means "no inventory facts for this
   * scope", which keeps the report unchanged but is recorded as ungated.
   */
  inventoryConstraint?: () => ConstraintResult | null | Promise<ConstraintResult | null>;
}): AgentRuntimeExecutor {
  const normalized = normalizePpcExecutionRequest(options.request, options.request.context ?? {});

  return async ({ execution, definition, callTool: invokeTool, recordTrace, emitEvent }) => {
    const callTool: typeof invokeTool = async (toolId, input) => {
      const result = await invokeTool(toolId, input);
      if (result.status !== "SUCCEEDED") throw new Error(`PPC tool ${toolId} failed: ${result.error?.message ?? result.status}`);
      return result;
    };
    recordTrace(
      "decision",
      "PPC scope parsed",
      toJsonValue({
        naturalLanguageGoal: normalized.naturalLanguageGoal,
        marketplace: normalized.marketplace,
        campaignGroupId: normalized.campaignGroupId,
        workspaceUnitId: normalized.workspaceUnitId,
        workspaceMode: normalized.workspaceMode,
      }),
    );
    emitEvent("decision.made" as AgentEventName, {
      executionId: execution.id,
      summary: "PPC scope parsed and recommendation workflow prepared.",
      marketplace: normalized.marketplace,
    } as JsonValue);

    const workspaceLoad = await callTool(
      "ppc.workspace.load",
      toJsonValue({
        campaignGroups: normalized.campaignGroups,
        performanceRows: normalized.performanceRows,
        overallAdDataRows: normalized.overallAdDataRows,
        currentData: normalized.currentData,
      }),
    );
    const adsSnapshot = await callTool(
      "ppc.ads.snapshot",
      toJsonValue({
        campaignGroups: normalized.campaignGroups,
        performanceRows: normalized.performanceRows,
        overallAdDataRows: normalized.overallAdDataRows,
        targetAcos: normalized.targetAcos,
      }),
    );
    const keywordSignal = await callTool(
      "ppc.keyword.signal",
      toJsonValue({
        sellerSpriteKeywords: normalized.sellerSpriteKeywords,
        performanceRows: normalized.performanceRows,
        productContext: normalized.productContext ?? normalized.currentData?.productContext ?? null,
      }),
    );
    const diagnosisResult = await callTool(
      "ppc.diagnosis.analyze",
      toJsonValue({
        adsSnapshot: adsSnapshot.output,
        keywordSignal: keywordSignal.output,
      }),
    );
    const bidResult = await callTool(
      "ppc.bid.recommend",
      toJsonValue({
        adsSnapshot: adsSnapshot.output,
        diagnosis: diagnosisResult.output,
        targetAcos: normalized.targetAcos,
      }),
    );
    const negativeResult = await callTool(
      "ppc.negative.recommend",
      toJsonValue({
        adsSnapshot: adsSnapshot.output,
        diagnosis: diagnosisResult.output,
      }),
    );
    const campaignResult = await callTool(
      "ppc.campaign.recommend",
      toJsonValue({
        diagnosis: diagnosisResult.output,
        opportunities: bidResult.output,
        productContext: normalized.productContext ?? normalized.currentData?.productContext ?? null,
      }),
    );
    const reportResult = await callTool(
      "ppc.report.compose",
      toJsonValue({
        diagnosis: diagnosisResult.output,
        opportunities: bidResult.output,
        bidRecommendations: bidResult.output,
        negativeRecommendations: negativeResult.output,
        campaignRecommendations: campaignResult.output,
      }),
    );

    const rawReport = extractReport(reportResult.output, normalized);
    const evidence = extractEvidence(workspaceLoad.output, adsSnapshot.output, keywordSignal.output, diagnosisResult.output, bidResult.output, negativeResult.output, campaignResult.output, reportResult.output);
    const reportEvidence = new Map([...rawReport.evidence, ...evidence].map((item) => [
      `${item.toolId}:${item.metric}:${item.dataSource}:${item.claim}:${JSON.stringify(item.value)}`,
      item,
    ]));
    const evidencedReport = { ...rawReport, evidence: [...reportEvidence.values()] };
    let gated: GatedPpcReport | null = null;
    if (options.inventoryConstraint) {
      try {
        const constraint = await options.inventoryConstraint();
        gated = constraint ? gatePpcReportWithInventory(evidencedReport, constraint) : ungatedPpcReport(evidencedReport);
      } catch (error) {
        // Fail closed: a gate that cannot compute must block bid increases, never
        // let them through silently.
        const message = error instanceof Error ? error.message : "unknown";
        recordTrace("error", "Inventory gate failed", toJsonValue({ message }));
        gated = gatePpcReportWithInventory(evidencedReport, failClosedConstraint(`库存门禁计算失败（${message}）：加投不可执行。`));
      }
      if (gated) recordTrace("decision", "Inventory gate applied", toJsonValue(gated.gate));
    }
    const report = gated?.report ?? evidencedReport;
    const adjustmentDrafts = buildAdjustmentDrafts(report.bidRecommendations);
    const gateRisks = gated?.blocked.map((item) => `${item.keyword || item.target}：${item.reason}`) ?? [];
    const memoryItems = buildMemoryItems({
      execution,
      definition,
      report,
      generatedAt: report.generatedAt,
      requestedByUserId: options.requestedByUserId,
    });

    recordTrace("recommendation", "PPC report prepared", report as unknown as JsonValue);
    emitEvent("recommendation.created", report as unknown as JsonValue);

    return {
      recommendation: {
        summary: report.recommendation,
        evidence,
        risks: [...report.diagnosis.filter((item) => item.severity !== "low").map((item) => item.issue), ...gateRisks],
        confidence: computeConfidence(report),
        nextAction: "Review recommendation bundle and request human approval.",
      },
      decision: {
        summary: report.summary,
        rationale: gated
          ? `PPC diagnosis is ready for human review. Inventory gate: ${gated.gate.decision}.`
          : "PPC diagnosis is ready for human review.",
        confidence: computeConfidence(report),
        nextStep: "Review diagnosis, bid, negative, and campaign recommendations",
      },
      output: toJsonValue({
        report,
        evidence,
        adjustmentDrafts,
        inventoryGate: gated?.gate ?? null,
        blockedBidIncreases: gated?.blocked ?? [],
      }),
      tokenUsage: 180,
      costCents: 0,
      memoryItems,
    };
  };
}

export type { PpcEvidenceItem, PpcDiagnosisItem, PpcOpportunityItem, PpcBidRecommendationItem, PpcNegativeRecommendationItem, PpcCampaignRecommendationItem, PpcAnalysisReport, PpcExecutionOutput, PpcExecutionRequest } from "./ppc-contracts";
export { ppcAgentId } from "./ppc-constants";
export { ppcAgentDefinition, ppcToolDefinitions } from "./ppc-catalog";
export { ppcEvaluationCases } from "./ppc-evaluations";
export { createPpcAnalyticsAdapter } from "./ppc-tools";