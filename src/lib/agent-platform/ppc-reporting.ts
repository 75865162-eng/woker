import type { AgentMemoryEntry, JsonValue } from "./types";
import type { AdjustmentDraft } from "@/lib/types";
import type { PpcDiagnosisItem, PpcOpportunityItem, PpcBidRecommendationItem, PpcNegativeRecommendationItem, PpcCampaignRecommendationItem, PpcEvidenceItem, PpcAnalysisReport } from "./ppc-contracts";
import { normalizePpcExecutionRequest, isRecord, toJsonValue } from "./ppc-normalization";

export function buildPpcReport(input: {
  goal: string;
  marketplace: string;
  scopeCampaignGroupIds: string[];
  scopeCampaignGroupNames: string[];
  workspaceMode: string;
  diagnosis: PpcDiagnosisItem[];
  opportunities: PpcOpportunityItem[];
  bidRecommendations: PpcBidRecommendationItem[];
  negativeRecommendations: PpcNegativeRecommendationItem[];
  campaignRecommendations: PpcCampaignRecommendationItem[];
  evidence: PpcEvidenceItem[];
  generatedAt: string;
}): PpcAnalysisReport {
  const topOpportunity = input.opportunities[0];
  const summary = `${input.diagnosis.length} 个诊断信号、${input.opportunities.length} 个机会、${input.bidRecommendations.length} 条竞价建议、${input.negativeRecommendations.length} 条否定建议、${input.campaignRecommendations.length} 条结构建议。`;
  const recommendation = topOpportunity
    ? `${topOpportunity.title}，优先处理 ${topOpportunity.type === "scale" ? "扩量" : topOpportunity.type === "fix" ? "控损" : "结构优化"} 机会。`
    : "先稳定 PPC 结构，再逐步展开优化。";

  return {
    goal: input.goal,
    marketplace: input.marketplace,
    scope: {
      campaignGroupIds: input.scopeCampaignGroupIds,
      campaignGroupNames: input.scopeCampaignGroupNames,
      workspaceMode: input.workspaceMode,
    },
    summary,
    diagnosis: input.diagnosis,
    opportunities: input.opportunities,
    bidRecommendations: input.bidRecommendations,
    negativeRecommendations: input.negativeRecommendations,
    campaignRecommendations: input.campaignRecommendations,
    actionPlan: [
      "Review diagnosis and prioritize waste control.",
      "Approve or reject bid recommendations.",
      "Queue negative keyword updates for human approval.",
      "Apply campaign restructuring after approval.",
    ],
    evidence: input.evidence,
    recommendation,
    generatedAt: input.generatedAt,
  };
}

export function extractReport(output: JsonValue | undefined, normalized: ReturnType<typeof normalizePpcExecutionRequest>): PpcAnalysisReport {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    if (record.report && typeof record.report === "object" && !Array.isArray(record.report)) {
      return record.report as PpcAnalysisReport;
    }
  }

  return buildPpcReport({
    goal: normalized.naturalLanguageGoal,
    marketplace: normalized.marketplace,
    scopeCampaignGroupIds: normalized.campaignGroups.map((group) => group.id),
    scopeCampaignGroupNames: normalized.campaignGroups.map((group) => group.adGroupName || group.campaignName),
    workspaceMode: normalized.workspaceMode,
    diagnosis: [],
    opportunities: [],
    bidRecommendations: [],
    negativeRecommendations: [],
    campaignRecommendations: [],
    evidence: [],
    generatedAt: new Date().toISOString(),
  });
}

export function extractEvidence(...inputs: Array<JsonValue | undefined>): PpcEvidenceItem[] {
  const now = new Date().toISOString();
  const evidence: PpcEvidenceItem[] = [];

  for (const input of inputs) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      continue;
    }

    const record = input as Record<string, unknown>;
    if (Array.isArray(record.evidence)) {
      for (const item of record.evidence) {
        if (isRecord(item) && typeof item.claim === "string") {
          evidence.push({
            claim: item.claim,
            dataSource: String(item.dataSource ?? "PPC"),
            toolId: String(item.toolId ?? "ppc.report.compose"),
            metric: String(item.metric ?? "signal"),
            value: (item.value as JsonValue) ?? null,
            timestamp: String(item.timestamp ?? now),
          });
        }
      }
    }
  }

  return evidence;
}

export function buildAdjustmentDrafts(recommendations: PpcBidRecommendationItem[]) {
  return recommendations.map<AdjustmentDraft>((recommendation, index) => ({
    id: `ppc-draft-${recommendation.rowId}-${index}`,
    campaignGroupId: recommendation.campaignGroupId,
    rowId: recommendation.rowId,
    field: "bid",
    headerName: "竞价",
    oldValue: recommendation.currentBid,
    newValue: recommendation.suggestedBid,
    keyword: recommendation.keyword,
    target: recommendation.target,
    currentBid: recommendation.currentBid,
    suggestedBid: recommendation.suggestedBid,
    deltaPercent: recommendation.deltaPercent,
    reason: recommendation.recommendation,
    matchedRule: "PPC Agent",
    selected: true,
  }));
}

export function buildMemoryItems(input: {
  execution: { id: string };
  definition: { id: string };
  report: PpcAnalysisReport;
  generatedAt: string;
  requestedByUserId?: string;
}): AgentMemoryEntry[] {
  const scopeKey = `${input.definition.id}:${input.report.marketplace}:${input.report.scope.campaignGroupIds.join(",") || "all"}`;

  return [
    {
      id: `memory-${input.execution.id}-summary`,
      agentDefinitionId: input.definition.id,
      scope: "workspace",
      scopeKey,
      summary: input.report.recommendation,
      data: toJsonValue({
        summary: input.report.summary,
        diagnosis: input.report.diagnosis.slice(0, 5),
        opportunities: input.report.opportunities.slice(0, 5),
      }),
      sourceExecutionId: input.execution.id,
      confidence: 0.82,
      createdAt: input.generatedAt,
      updatedAt: input.generatedAt,
    },
  ];
}

export function computeConfidence(report: PpcAnalysisReport) {
  const positiveSignals = report.opportunities.filter((item) => item.type === "scale" || item.type === "defend").length;
  const negativeSignals = report.diagnosis.filter((item) => item.severity === "high").length;

  return Math.max(0.55, Math.min(0.93, 0.68 + positiveSignals * 0.04 - negativeSignals * 0.03));
}
