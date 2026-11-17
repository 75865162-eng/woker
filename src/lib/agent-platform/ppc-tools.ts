import { buildBidRecommendations, buildNegativeRecommendations, buildCampaignRecommendations } from "./ppc-recommendations";
import type { AgentToolAdapter, ToolExecutionInput, ToolExecutionResult } from "./types";
import { ppcToolAdapterId } from "./ppc-catalog";
import { toJsonValue, extractJsonObject, isRecord, normalizeCampaignGroups, normalizePerformanceRows, normalizeOverallRows, numberValue, deriveScopeFromRows } from "./ppc-normalization";
import { buildAdsSnapshot, buildKeywordSignal, buildDiagnosis, buildOpportunities } from "./ppc-analysis";
import { buildPpcReport, buildAdjustmentDrafts } from "./ppc-reporting";

export function createPpcAnalyticsAdapter(clock: () => Date = () => new Date()): AgentToolAdapter {
  return {
    adapterId: ppcToolAdapterId,
    async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
      const startedAt = clock().getTime();
      const output = buildSyntheticPpcOutput(input, clock);

      return {
        output: toJsonValue(output),
        latencyMs: Math.max(clock().getTime() - startedAt, 1),
      };
    },
  };
}

export function buildSyntheticPpcOutput(input: ToolExecutionInput, clock: () => Date) {
  const snapshot = extractJsonObject(input.input);
  const context = input.context ?? {};
  const currentData = isRecord(context.currentData) ? context.currentData : {};
  const campaignGroups = normalizeCampaignGroups(snapshot.campaignGroups ?? currentData.campaignGroups ?? []);
  const performanceRows = normalizePerformanceRows(snapshot.performanceRows ?? currentData.performanceRows ?? []);
  const overallAdDataRows = normalizeOverallRows(snapshot.overallAdDataRows ?? currentData.overallAdDataRows ?? []);
  const marketplace = String(snapshot.marketplace ?? context.marketplace ?? currentData.marketplace ?? "US");
  const targetAcos = numberValue(snapshot.targetAcos ?? currentData.targetAcos, 30) ?? 30;
  const targetRoas = numberValue(snapshot.targetRoas ?? currentData.targetRoas, 3) ?? 3;
  const targetMargin = numberValue(snapshot.targetMargin ?? currentData.targetMargin, 25) ?? 25;
  const scopeCampaignGroupIds = campaignGroups.length ? campaignGroups.map((group) => group.id) : deriveScopeFromRows(performanceRows);
  const scopeCampaignGroupNames = campaignGroups.length ? campaignGroups.map((group) => group.adGroupName || group.campaignName) : Array.from(new Set(performanceRows.map((row) => row.adGroupName))).slice(0, 6);
  const scopedRows = performanceRows.filter((row) => !scopeCampaignGroupIds.length || scopeCampaignGroupIds.includes(row.campaignGroupId));
  const adsSnapshot = buildAdsSnapshot(scopedRows, overallAdDataRows, targetAcos, targetRoas);
  const keywordSignal = buildKeywordSignal(
    toJsonValue(snapshot.sellerSpriteKeywords ?? currentData.sellerSpriteKeywords ?? null),
    scopedRows,
    toJsonValue(snapshot.productContext ?? currentData.productContext ?? null),
  );
  const diagnosis = buildDiagnosis(scopedRows, overallAdDataRows, adsSnapshot, keywordSignal, targetAcos, targetMargin, marketplace);
  const opportunities = buildOpportunities(diagnosis, adsSnapshot, keywordSignal, scopedRows, targetAcos, targetRoas);
  const bidRecommendations = buildBidRecommendations(scopedRows, overallAdDataRows, diagnosis, targetAcos, adsSnapshot);
  const negativeRecommendations = buildNegativeRecommendations(scopedRows, overallAdDataRows, diagnosis, keywordSignal);
  const campaignRecommendations = buildCampaignRecommendations(
    campaignGroups,
    diagnosis,
    opportunities,
    toJsonValue(snapshot.productContext ?? currentData.productContext ?? null),
  );
  const report = buildPpcReport({
    goal: String(snapshot.naturalLanguageGoal ?? currentData.goal ?? "PPC diagnosis"),
    marketplace,
    scopeCampaignGroupIds,
    scopeCampaignGroupNames,
    workspaceMode: String(snapshot.workspaceMode ?? currentData.workspaceMode ?? "campaign"),
    diagnosis,
    opportunities,
    bidRecommendations,
    negativeRecommendations,
    campaignRecommendations,
    evidence: [...adsSnapshot.evidence, ...keywordSignal.evidence, ...diagnosis.flatMap((item) => item.evidence), ...opportunities.flatMap((item) => item.evidence), ...bidRecommendations.flatMap((item) => item.evidence), ...negativeRecommendations.flatMap((item) => item.evidence), ...campaignRecommendations.flatMap((item) => item.evidence)],
    generatedAt: clock().toISOString(),
  });

  switch (input.toolId) {
    case "ppc.workspace.load":
      return {
        source: "PPC Analytics Adapter",
        toolId: input.toolId,
        generatedAt: report.generatedAt,
        scope: {
          campaignGroupIds: scopeCampaignGroupIds,
          campaignGroupNames: scopeCampaignGroupNames,
          workspaceMode: report.scope.workspaceMode,
        },
        metrics: adsSnapshot.metrics,
        productContext: snapshot.productContext ?? currentData.productContext ?? null,
      };
    case "ppc.ads.snapshot":
      return {
        source: "PPC Analytics Adapter",
        toolId: input.toolId,
        generatedAt: report.generatedAt,
        metrics: adsSnapshot.metrics,
        topRows: adsSnapshot.topRows,
      };
    case "ppc.keyword.signal":
      return {
        source: "PPC Analytics Adapter",
        toolId: input.toolId,
        generatedAt: report.generatedAt,
        keywordOpportunity: keywordSignal.keywordOpportunity,
        candidateKeywords: keywordSignal.candidateKeywords,
        evidence: keywordSignal.evidence,
      };
    case "ppc.diagnosis.analyze":
      return {
        source: "PPC Analytics Adapter",
        toolId: input.toolId,
        generatedAt: report.generatedAt,
        diagnosis,
      };
    case "ppc.bid.recommend":
      return {
        source: "PPC Analytics Adapter",
        toolId: input.toolId,
        generatedAt: report.generatedAt,
        bidRecommendations,
        adjustmentDrafts: buildAdjustmentDrafts(bidRecommendations),
      };
    case "ppc.negative.recommend":
      return {
        source: "PPC Analytics Adapter",
        toolId: input.toolId,
        generatedAt: report.generatedAt,
        negativeRecommendations,
      };
    case "ppc.campaign.recommend":
      return {
        source: "PPC Analytics Adapter",
        toolId: input.toolId,
        generatedAt: report.generatedAt,
        campaignRecommendations,
      };
    case "ppc.report.compose":
      return {
        source: "PPC Analytics Adapter",
        toolId: input.toolId,
        generatedAt: report.generatedAt,
        report,
      };
    default:
      return {
        source: "PPC Analytics Adapter",
        toolId: input.toolId,
        generatedAt: report.generatedAt,
      };
  }
}
