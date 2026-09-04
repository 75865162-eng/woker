import type {
  AgentDefinition,
  AgentEventName,
  AgentEvaluationCase,
  AgentMemoryEntry,
  AgentRuntimeExecutor,
  AgentToolAdapter,
  AgentToolDefinition,
  JsonObject,
  JsonValue,
  ToolExecutionInput,
  ToolExecutionResult,
} from "./types";
import { aggregateMetricsForCampaignGroups, enrichMetric } from "@/lib/metrics";
import type { AdjustmentDraft, CampaignGroup, OverallAdDataRow, PerformanceRow } from "@/lib/types";

export interface PpcEvidenceItem {
  claim: string;
  dataSource: string;
  toolId: string;
  toolCallId?: string;
  metric: string;
  value: JsonValue;
  timestamp: string;
}

export interface PpcDiagnosisItem {
  severity: "low" | "medium" | "high";
  issue: string;
  impact: string;
  evidence: PpcEvidenceItem[];
}

export interface PpcOpportunityItem {
  opportunityId: string;
  title: string;
  type: "scale" | "fix" | "defend" | "negative_keyword" | "structure";
  score: number;
  rationale: string;
  evidence: PpcEvidenceItem[];
}

export interface PpcBidRecommendationItem {
  rowId: string;
  campaignGroupId: string;
  keyword: string;
  target: string;
  currentBid: number;
  suggestedBid: number;
  deltaPercent: number;
  recommendation: string;
  confidence: number;
  evidence: PpcEvidenceItem[];
}

export interface PpcNegativeRecommendationItem {
  term: string;
  matchType: string;
  recommendation: string;
  confidence: number;
  evidence: PpcEvidenceItem[];
}

export interface PpcCampaignRecommendationItem {
  title: string;
  recommendation: string;
  confidence: number;
  evidence: PpcEvidenceItem[];
}

export interface PpcAnalysisReport {
  goal: string;
  marketplace: string;
  scope: {
    campaignGroupIds: string[];
    campaignGroupNames: string[];
    workspaceMode?: string;
  };
  summary: string;
  diagnosis: PpcDiagnosisItem[];
  opportunities: PpcOpportunityItem[];
  bidRecommendations: PpcBidRecommendationItem[];
  negativeRecommendations: PpcNegativeRecommendationItem[];
  campaignRecommendations: PpcCampaignRecommendationItem[];
  actionPlan: string[];
  evidence: PpcEvidenceItem[];
  recommendation: string;
  generatedAt: string;
}

export interface PpcExecutionOutput {
  report: PpcAnalysisReport;
  evidence: PpcEvidenceItem[];
  adjustmentDrafts: AdjustmentDraft[];
  amazonAdsPlan?: JsonValue;
  memoryItems?: AgentMemoryEntry[];
}

export interface PpcExecutionRequest {
  naturalLanguageGoal?: string;
  marketplace?: string;
  campaignGroupId?: string;
  workspaceUnitId?: string;
  workspaceMode?: string;
  campaignGroups?: CampaignGroup[];
  performanceRows?: PerformanceRow[];
  overallAdDataRows?: OverallAdDataRow[];
  productContext?: JsonValue;
  sellerSpriteKeywords?: JsonValue;
  historicalData?: JsonValue;
  currentData?: Record<string, unknown>;
  targetAcos?: number;
  targetRoas?: number;
  targetMargin?: number;
  context?: Record<string, unknown>;
}

export const ppcAgentId = "ppc";
const ppcToolAdapterId = "ppc-analytics-adapter";

export const ppcAgentDefinition: AgentDefinition = {
  id: ppcAgentId,
  name: "PPC Diagnosis Agent",
  description: "Diagnose Amazon PPC performance, surface opportunities, and prepare approval-gated recommendation bundles.",
  version: "v1.0.0",
  systemInstructions:
    "You are the PPC Diagnosis Agent for an Amazon commerce OS. Work only through the Tool Gateway. Use current PPC data, SellerSprite signals, historical PPC performance, and product context to diagnose waste, discover scaling opportunities, and prepare bid, negative keyword, and campaign recommendations. Never execute ad changes directly.",
  goals: [
    "Diagnose PPC performance issues",
    "Surface bid, negative, and campaign opportunities",
    "Tie recommendations back to evidence",
    "Prepare approval-gated recommendation bundles",
    "Hand off to bulk export or Amazon API only after human approval",
  ],
  skills: [
    "PPC diagnosis",
    "bid optimization",
    "negative keyword discovery",
    "campaign structure analysis",
    "Amazon Ads operations",
    "evidence synthesis",
  ],
  tools: [
    "ppc.workspace.load",
    "ppc.ads.snapshot",
    "ppc.keyword.signal",
    "ppc.diagnosis.analyze",
    "ppc.bid.recommend",
    "ppc.negative.recommend",
    "ppc.campaign.recommend",
    "ppc.report.compose",
    "amazon.ads.recommendation.plan",
  ],
  permissions: [
    "ppc.read.ads",
    "ppc.read.keyword",
    "ppc.read.historical",
    "ppc.read.product",
    "ppc.write.diagnosis",
    "ppc.write.opportunity",
    "ppc.write.bidRecommendation",
    "ppc.write.negativeRecommendation",
    "ppc.write.campaignRecommendation",
    "ppc.write.report",
    "amazon.ads.plan",
  ],
  inputSchema: {
    type: "object",
    properties: {
      naturalLanguageGoal: { type: "string" },
      marketplace: { type: "string" },
      campaignGroupId: { type: "string" },
      workspaceUnitId: { type: "string" },
      workspaceMode: { type: "string" },
      campaignGroups: { type: "array" },
      performanceRows: { type: "array" },
      overallAdDataRows: { type: "array" },
      productContext: { type: "object" },
      sellerSpriteKeywords: { type: "object" },
      historicalData: { type: "object" },
      targetAcos: { type: "number" },
      targetRoas: { type: "number" },
      targetMargin: { type: "number" },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      report: { type: "object" },
      evidence: { type: "array" },
      adjustmentDrafts: { type: "array" },
    },
  },
  approvalPolicy: {
    requiredForRiskLevels: ["HIGH", "CRITICAL"],
    timeoutMinutes: 120,
    approverRoles: ["owner", "database_admin", "operations_manager", "operations_supervisor"],
    notes: "PPC recommendations must be human-approved before bulk export or Amazon API changes.",
  },
  enabled: true,
};

export const ppcToolDefinitions: AgentToolDefinition[] = [
  {
    toolId: "ppc.workspace.load",
    name: "PPC Workspace Load",
    description: "Normalize workspace PPC context into a scoped execution snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        campaignGroups: { type: "array" },
        performanceRows: { type: "array" },
        overallAdDataRows: { type: "array" },
        currentData: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        scope: { type: "object" },
        metrics: { type: "object" },
        productContext: { type: "object" },
      },
    },
    permission: ["ppc.read.ads", "ppc.read.historical", "ppc.read.product"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: ppcToolAdapterId,
    enabled: true,
  },
  {
    toolId: "ppc.ads.snapshot",
    name: "PPC Ads Snapshot",
    description: "Aggregate campaign, keyword, spend, and conversion signals from historical PPC data.",
    inputSchema: {
      type: "object",
      properties: {
        campaignGroups: { type: "array" },
        performanceRows: { type: "array" },
        overallAdDataRows: { type: "array" },
        targetAcos: { type: "number" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        metrics: { type: "object" },
        topRows: { type: "array" },
      },
    },
    permission: ["ppc.read.ads", "ppc.read.historical"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: ppcToolAdapterId,
    enabled: true,
  },
  {
    toolId: "ppc.keyword.signal",
    name: "PPC Keyword Signal",
    description: "Infer keyword opportunities and wasted spend signals from SellerSprite and PPC data.",
    inputSchema: {
      type: "object",
      properties: {
        sellerSpriteKeywords: { type: "object" },
        performanceRows: { type: "array" },
        productContext: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        keywordOpportunity: { type: "number" },
        candidateKeywords: { type: "array" },
      },
    },
    permission: ["ppc.read.keyword", "ppc.read.product"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: ppcToolAdapterId,
    enabled: true,
  },
  {
    toolId: "ppc.diagnosis.analyze",
    name: "PPC Diagnosis",
    description: "Produce a performance diagnosis from ads and keyword signals.",
    inputSchema: {
      type: "object",
      properties: {
        adsSnapshot: { type: "object" },
        keywordSignal: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        diagnosis: { type: "array" },
      },
    },
    permission: ["ppc.write.diagnosis"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: ppcToolAdapterId,
    enabled: true,
  },
  {
    toolId: "ppc.bid.recommend",
    name: "PPC Bid Recommendation",
    description: "Generate bid recommendations and draft changes for improving PPC efficiency.",
    inputSchema: {
      type: "object",
      properties: {
        adsSnapshot: { type: "object" },
        diagnosis: { type: "array" },
        targetAcos: { type: "number" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        bidRecommendations: { type: "array" },
        adjustmentDrafts: { type: "array" },
      },
    },
    permission: ["ppc.write.bidRecommendation"],
    riskLevel: "MEDIUM",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: ppcToolAdapterId,
    enabled: true,
  },
  {
    toolId: "ppc.negative.recommend",
    name: "PPC Negative Recommendation",
    description: "Detect negative keyword candidates and waste reduction opportunities.",
    inputSchema: {
      type: "object",
      properties: {
        adsSnapshot: { type: "object" },
        diagnosis: { type: "array" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        negativeRecommendations: { type: "array" },
      },
    },
    permission: ["ppc.write.negativeRecommendation"],
    riskLevel: "MEDIUM",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: ppcToolAdapterId,
    enabled: true,
  },
  {
    toolId: "ppc.campaign.recommend",
    name: "PPC Campaign Recommendation",
    description: "Recommend campaign restructuring, segmentation, and budget allocation changes.",
    inputSchema: {
      type: "object",
      properties: {
        diagnosis: { type: "array" },
        opportunities: { type: "array" },
        productContext: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        campaignRecommendations: { type: "array" },
      },
    },
    permission: ["ppc.write.campaignRecommendation"],
    riskLevel: "MEDIUM",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: ppcToolAdapterId,
    enabled: true,
  },
  {
    toolId: "ppc.report.compose",
    name: "PPC Report Compose",
    description: "Compose the final PPC diagnosis, opportunity, and recommendation report.",
    inputSchema: {
      type: "object",
      properties: {
        diagnosis: { type: "array" },
        opportunities: { type: "array" },
        bidRecommendations: { type: "array" },
        negativeRecommendations: { type: "array" },
        campaignRecommendations: { type: "array" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        report: { type: "object" },
      },
    },
    permission: ["ppc.write.report"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: ppcToolAdapterId,
    enabled: true,
  },
];

export const ppcEvaluationCases: AgentEvaluationCase[] = [
  evaluationCase("ppc-case-01", "High ACOS diagnosis", {
    naturalLanguageGoal: "诊断 ACOS 偏高的广告组并给出调价建议",
    marketplace: "US",
    targetAcos: 30,
  }, {
    shouldDiagnoseWaste: true,
    shouldProduceBidReduction: true,
    shouldSurfaceEvidence: true,
  }),
  evaluationCase("ppc-case-02", "Low ACOS scale", {
    naturalLanguageGoal: "找出可以加预算的高效关键词",
    marketplace: "US",
    targetAcos: 25,
  }, {
    shouldIdentifyScalingOpportunity: true,
    shouldProduceBidIncrease: true,
  }),
  evaluationCase("ppc-case-03", "Negative keyword opportunity", {
    naturalLanguageGoal: "找出该加否定词的浪费流量",
    marketplace: "US",
  }, {
    shouldProduceNegativeKeywords: true,
  }),
  evaluationCase("ppc-case-04", "Campaign cleanup", {
    naturalLanguageGoal: "建议拆分广告结构",
    marketplace: "US",
  }, {
    shouldRecommendCampaignRestructure: true,
  }),
  evaluationCase("ppc-case-05", "Sparse data", {
    naturalLanguageGoal: "只有少量点击的数据也要给建议",
    marketplace: "US",
  }, {
    shouldHandleSparseSignals: true,
  }),
  evaluationCase("ppc-case-06", "No orders", {
    naturalLanguageGoal: "找零订单高花费词",
    marketplace: "US",
  }, {
    shouldDetectZeroOrderWaste: true,
  }),
  evaluationCase("ppc-case-07", "Product context aware", {
    naturalLanguageGoal: "结合产品卖点做 PPC 建议",
    marketplace: "US",
  }, {
    shouldUseProductContext: true,
  }),
  evaluationCase("ppc-case-08", "SellerSprite aware", {
    naturalLanguageGoal: "结合 SellerSprite 关键词做 PPC 建议",
    marketplace: "US",
  }, {
    shouldUseKeywordSignals: true,
  }),
  evaluationCase("ppc-case-09", "Workspace scope", {
    naturalLanguageGoal: "只看当前工作区的广告组",
    marketplace: "US",
  }, {
    shouldRespectWorkspaceScope: true,
  }),
  evaluationCase("ppc-case-10", "Human approval bundle", {
    naturalLanguageGoal: "把建议打包成审批",
    marketplace: "US",
  }, {
    shouldRequireHumanApproval: true,
  }),
  evaluationCase("ppc-case-11", "High risk campaign change", {
    naturalLanguageGoal: "建议大幅调整竞价和结构",
    marketplace: "US",
  }, {
    shouldEscalateRisk: true,
  }),
  evaluationCase("ppc-case-12", "Evidence trace", {
    naturalLanguageGoal: "每个结论都要能追踪到工具和指标",
    marketplace: "US",
  }, {
    shouldReturnEvidenceTrace: true,
  }),
];

function evaluationCase(
  id: string,
  name: string,
  input: PpcExecutionRequest,
  expectedBehavior: Record<string, JsonValue>,
): AgentEvaluationCase {
  const now = "2026-09-03T00:00:00.000Z";

  return {
    id,
    agentDefinitionId: ppcAgentId,
    name,
    input: input as unknown as JsonValue,
    expectedBehavior: expectedBehavior as unknown as JsonValue,
    createdAt: now,
    updatedAt: now,
  };
}

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

export function createPpcAgentExecutionExecutor(options: {
  request: PpcExecutionRequest;
  requestedByUserId?: string;
  clock?: () => Date;
}): AgentRuntimeExecutor {
  const normalized = normalizePpcExecutionRequest(options.request, options.request.context ?? {});

  return async ({ execution, definition, callTool, recordTrace, emitEvent }) => {
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

    const report = extractReport(reportResult.output, normalized);
    const evidence = extractEvidence(workspaceLoad.output, adsSnapshot.output, keywordSignal.output, diagnosisResult.output, bidResult.output, negativeResult.output, campaignResult.output, reportResult.output);
    const adjustmentDrafts = buildAdjustmentDrafts(report.bidRecommendations);
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
        risks: report.diagnosis.filter((item) => item.severity !== "low").map((item) => item.issue),
        confidence: computeConfidence(report),
        nextAction: "Review recommendation bundle and request human approval.",
      },
      decision: {
        summary: report.summary,
        rationale: "PPC diagnosis is ready for human review.",
        confidence: computeConfidence(report),
        nextStep: "Review diagnosis, bid, negative, and campaign recommendations",
      },
      output: toJsonValue({
        report,
        evidence,
        adjustmentDrafts,
      }),
      tokenUsage: 180,
      costCents: 0,
      memoryItems,
    };
  };
}

function normalizePpcExecutionRequest(request: PpcExecutionRequest, context: Record<string, unknown>) {
  const currentData = isRecord(context.currentData) ? context.currentData : {};
  const currentCampaignGroups = Array.isArray(currentData.campaignGroups) ? (currentData.campaignGroups as CampaignGroup[]) : [];
  const currentPerformanceRows = Array.isArray(currentData.performanceRows) ? (currentData.performanceRows as PerformanceRow[]) : [];
  const currentOverallRows = Array.isArray(currentData.overallAdDataRows) ? (currentData.overallAdDataRows as OverallAdDataRow[]) : [];

  return {
    naturalLanguageGoal: String(request.naturalLanguageGoal ?? currentData.goal ?? "Diagnose PPC and generate recommendations."),
    marketplace: String(request.marketplace ?? currentData.marketplace ?? context.marketplace ?? "US"),
    campaignGroupId: request.campaignGroupId ?? (typeof currentData.activeCampaignGroupId === "string" ? currentData.activeCampaignGroupId : undefined),
    workspaceUnitId: request.workspaceUnitId ?? (typeof currentData.activeWorkspaceUnitId === "string" ? currentData.activeWorkspaceUnitId : undefined),
    workspaceMode: String(request.workspaceMode ?? currentData.workspaceMode ?? "campaign"),
    campaignGroups: (request.campaignGroups ?? currentCampaignGroups).filter(Boolean),
    performanceRows: (request.performanceRows ?? currentPerformanceRows).filter(Boolean),
    overallAdDataRows: (request.overallAdDataRows ?? currentOverallRows).filter(Boolean),
    productContext: request.productContext ?? currentData.productContext ?? null,
    sellerSpriteKeywords: request.sellerSpriteKeywords ?? currentData.sellerSpriteKeywords ?? null,
    historicalData: request.historicalData ?? currentData.historicalData ?? null,
    currentData,
    targetAcos: request.targetAcos ?? numberValue(currentData.targetAcos, undefined),
    targetRoas: request.targetRoas ?? numberValue(currentData.targetRoas, undefined),
    targetMargin: request.targetMargin ?? numberValue(currentData.targetMargin, undefined),
  };
}

function buildSyntheticPpcOutput(input: ToolExecutionInput, clock: () => Date) {
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

function buildAdsSnapshot(
  performanceRows: PerformanceRow[],
  overallAdDataRows: OverallAdDataRow[],
  targetAcos: number,
  targetRoas: number,
) {
  const campaignGroupIds = Array.from(new Set(performanceRows.map((row) => row.campaignGroupId)));
  const metrics = aggregateMetricsForCampaignGroups(campaignGroupIds, performanceRows);
  const topRows = [...performanceRows]
    .sort((left, right) => {
      const leftScore = rowPpcScore(left, targetAcos, targetRoas);
      const rightScore = rowPpcScore(right, targetAcos, targetRoas);
      return rightScore - leftScore;
    })
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      campaignGroupId: row.campaignGroupId,
      campaignName: row.campaignName,
      adGroupName: row.adGroupName,
      keyword: row.keyword,
      target: row.target,
      matchType: row.matchType,
      currentBid: row.currentBid,
      acos: enrichMetric(row, "acos"),
      roas: enrichMetric(row, "roas"),
      cpc: enrichMetric(row, "cpc"),
      orders: row.orders,
      clicks: row.clicks,
      spend: row.spend,
    }));

  return {
    metrics,
    topRows,
    evidence: [{
      claim: "Aggregated PPC performance snapshot built from historical rows.",
      dataSource: "Historical PPC",
      toolId: "ppc.ads.snapshot",
      metric: "acos",
      value: metrics.acos,
      timestamp: new Date().toISOString(),
    }],
    overallAdDataRows,
  };
}

function buildKeywordSignal(sellerSpriteKeywords: JsonValue, performanceRows: PerformanceRow[], productContext: JsonValue | null) {
  const keywordSeed = isRecord(sellerSpriteKeywords) ? sellerSpriteKeywords : {};
  const primary = normalizeStringArray(
    Array.isArray(keywordSeed.primaryKeywords) ? keywordSeed.primaryKeywords : [performanceRows[0]?.keyword, productContextText(productContext)].filter(Boolean),
  );
  const secondary = normalizeStringArray(Array.isArray(keywordSeed.secondaryKeywords) ? keywordSeed.secondaryKeywords : []);
  const longTail = normalizeStringArray(Array.isArray(keywordSeed.longTailKeywords) ? keywordSeed.longTailKeywords : []);
  const candidateKeywords = [...primary, ...secondary, ...longTail].filter(Boolean).slice(0, 12);
  const keywordOpportunity = clampScore(
    Math.round(
      (candidateKeywords.length > 0 ? 55 : 30) +
        Math.min(30, performanceRows.filter((row) => row.orders > 0).length * 4) +
        Math.min(15, performanceRows.filter((row) => row.clicks > 20 && row.orders === 0).length * 3),
    ),
  );

  return {
    keywordOpportunity,
    candidateKeywords,
    evidence: [{
      claim: "Keyword opportunity signals inferred from SellerSprite and PPC rows.",
      dataSource: "SellerSprite + PPC",
      toolId: "ppc.keyword.signal",
      metric: "keywordOpportunity",
      value: keywordOpportunity,
      timestamp: new Date().toISOString(),
    }],
  };
}

function buildDiagnosis(
  performanceRows: PerformanceRow[],
  overallAdDataRows: OverallAdDataRow[],
  adsSnapshot: ReturnType<typeof buildAdsSnapshot>,
  keywordSignal: ReturnType<typeof buildKeywordSignal>,
  targetAcos: number,
  targetMargin: number,
  marketplace: string,
): PpcDiagnosisItem[] {
  const diagnosis: PpcDiagnosisItem[] = [];
  const totalAcos = adsSnapshot.metrics.acos ?? 0;
  const badRows = performanceRows.filter((row) => row.clicks >= 20 && row.orders === 0);
  const winningRows = performanceRows.filter((row) => row.orders > 0 && enrichMetric(row, "acos") <= targetAcos);
  const highCpcRows = performanceRows.filter((row) => row.clicks >= 10 && enrichMetric(row, "cpc") > adsSnapshot.metrics.cpc * 1.15);

  if (totalAcos > targetAcos && adsSnapshot.metrics.sales > 0) {
    diagnosis.push({
      severity: "high",
      issue: "整体 ACOS 高于目标",
      impact: `当前 ACOS ${formatPercent(totalAcos)} 高于目标 ${formatPercent(targetAcos)}，需要先控损再扩量。`,
      evidence: evidenceFromRows("ppc.diagnosis.analyze", "acos", performanceRows.slice(0, 3), "Historical PPC", "整体 ACOS 偏高"),
    });
  }

  if (badRows.length > 0) {
    diagnosis.push({
      severity: "high",
      issue: "存在高点击零订单浪费",
      impact: `${badRows.length} 条关键词/投放对象出现高点击无订单，优先考虑降价、否定或暂停。`,
      evidence: evidenceFromRows("ppc.diagnosis.analyze", "clicks", badRows.slice(0, 3), "Historical PPC", "高点击零订单"),
    });
  }

  if (winningRows.length > 0) {
    diagnosis.push({
      severity: "medium",
      issue: "存在可扩量的高效词",
      impact: `${winningRows.length} 条词/投放对象表现优于目标 ACOS，可适度加价或拆分独立放量。`,
      evidence: evidenceFromRows("ppc.diagnosis.analyze", "roas", winningRows.slice(0, 3), "Historical PPC", "高效词"),
    });
  }

  if (highCpcRows.length > 0) {
    diagnosis.push({
      severity: "medium",
      issue: "CPC 偏高",
      impact: `${highCpcRows.length} 条记录 CPC 高于组合均值，存在出价或匹配宽泛问题。`,
      evidence: evidenceFromRows("ppc.diagnosis.analyze", "cpc", highCpcRows.slice(0, 3), "Historical PPC", "高 CPC"),
    });
  }

  if (keywordSignal.keywordOpportunity >= 70) {
    diagnosis.push({
      severity: "medium",
      issue: "关键词扩量空间明显",
      impact: "SellerSprite 与 PPC 词数据都显示可进一步扩展的关键词空间。",
      evidence: [...keywordSignal.evidence],
    });
  }

  if (overallAdDataRows.some((row) => row.matchStatus === "unmatched")) {
    diagnosis.push({
      severity: "low",
      issue: "Overall 数据存在未匹配项",
      impact: "有少量 Overall 记录未能准确回写到 Bulk 行，建议检查词形和匹配类型。",
      evidence: [{
        claim: "Overall data contains unmatched rows.",
        dataSource: "Amazon Ads",
        toolId: "ppc.ads.snapshot",
        metric: "matchStatus",
        value: "unmatched",
        timestamp: new Date().toISOString(),
      }],
    });
  }

  if (marketplace && targetMargin >= 30 && adsSnapshot.metrics.sales > 0 && totalAcos <= targetAcos) {
    diagnosis.push({
      severity: "medium",
      issue: "有利润空间支持加码",
      impact: `目标利润率 ${formatPercent(targetMargin)} 与当前表现匹配，适合优先扩量高效词。`,
      evidence: evidenceFromRows("ppc.diagnosis.analyze", "sales", winningRows.slice(0, 2), "Historical PPC", "利润空间支持加码"),
    });
  }

  if (!diagnosis.length) {
    diagnosis.push({
      severity: "low",
      issue: "信号不足",
      impact: "当前数据量有限，但仍可先从搜索词浪费和核心词放量两个方向入手。",
      evidence: adsSnapshot.evidence,
    });
  }

  return diagnosis;
}

function buildOpportunities(
  diagnosis: PpcDiagnosisItem[],
  adsSnapshot: ReturnType<typeof buildAdsSnapshot>,
  keywordSignal: ReturnType<typeof buildKeywordSignal>,
  performanceRows: PerformanceRow[],
  targetAcos: number,
  targetRoas: number,
): PpcOpportunityItem[] {
  const opportunities: PpcOpportunityItem[] = [];
  const winningRows = performanceRows.filter((row) => row.orders > 0 && enrichMetric(row, "acos") <= targetAcos);
  const wasteRows = performanceRows.filter((row) => row.clicks >= 20 && row.orders === 0);
  const exploratoryRows = performanceRows.filter((row) => row.clicks >= 10 && row.orders > 0 && enrichMetric(row, "roas") >= targetRoas);

  if (winningRows.length) {
    opportunities.push({
      opportunityId: "scale-winning-terms",
      title: "扩量高效关键词",
      type: "scale",
      score: clampScore(80 + Math.min(15, winningRows.length * 2)),
      rationale: "当前存在 ACOS 达标且有订单的词，可以拆分放量并上调竞价。",
      evidence: evidenceFromRows("ppc.opportunity.detect", "acos", winningRows.slice(0, 4), "Historical PPC", "高效词扩量"),
    });
  }

  if (wasteRows.length) {
    opportunities.push({
      opportunityId: "cut-waste",
      title: "削减无订单浪费",
      type: "fix",
      score: clampScore(75 + Math.min(15, wasteRows.length * 2)),
      rationale: "高点击无订单的词/投放对象应先降价、否定或暂停。",
      evidence: evidenceFromRows("ppc.opportunity.detect", "clicks", wasteRows.slice(0, 4), "Historical PPC", "无订单浪费"),
    });
  }

  if (keywordSignal.keywordOpportunity >= 60) {
    opportunities.push({
      opportunityId: "expand-keyword-surface",
      title: "扩展关键词面",
      type: "structure",
      score: keywordSignal.keywordOpportunity,
      rationale: "SellerSprite 关键词与 PPC 数据合并后，仍有更宽的 keyword surface 可覆盖。",
      evidence: [...keywordSignal.evidence],
    });
  }

  if (exploratoryRows.length) {
    opportunities.push({
      opportunityId: "defend-winners",
      title: "保护高转化词",
      type: "defend",
      score: clampScore(78 + Math.min(10, exploratoryRows.length)),
      rationale: "高 ROAS 的词需要单独结构保护，避免被泛词拖累。",
      evidence: evidenceFromRows("ppc.opportunity.detect", "roas", exploratoryRows.slice(0, 4), "Historical PPC", "高 ROAS 防守"),
    });
  }

  if (!opportunities.length) {
    opportunities.push({
      opportunityId: "observe-and-learn",
      title: "先观察再细分",
      type: "structure",
      score: 52,
      rationale: "数据还不足以形成强结论，建议先积累更多点击和订单样本。",
      evidence: diagnosis.flatMap((item) => item.evidence).slice(0, 3),
    });
  }

  return opportunities.sort((left, right) => right.score - left.score);
}

function buildBidRecommendations(
  performanceRows: PerformanceRow[],
  overallAdDataRows: OverallAdDataRow[],
  diagnosis: PpcDiagnosisItem[],
  targetAcos: number,
  adsSnapshot: ReturnType<typeof buildAdsSnapshot>,
): PpcBidRecommendationItem[] {
  const recommendations: PpcBidRecommendationItem[] = [];
  const overallRowsByKey = new Map(
    overallAdDataRows
      .filter((row) => row.campaignGroupId)
      .map((row) => [`${row.campaignGroupId}::${row.keyword.toLowerCase()}::${row.matchType.toLowerCase()}`, row]),
  );

  for (const row of performanceRows.slice(0, 18)) {
    const acos = enrichMetric(row, "acos");
    const roas = enrichMetric(row, "roas");
    const cpc = enrichMetric(row, "cpc");
    const baseConfidence = row.orders > 0 ? 0.82 : 0.68;
    const overallRow = overallRowsByKey.get(`${row.campaignGroupId}::${row.keyword.toLowerCase()}::${row.matchType.toLowerCase()}`);
    const evidence = [
      ...evidenceFromRows("ppc.bid.recommend", "acos", [row], "Historical PPC", "竞价建议"),
      ...(overallRow
        ? [{
            claim: "Matched Overall row confirms auction efficiency.",
            dataSource: "Amazon Ads",
            toolId: "ppc.ads.snapshot",
            metric: "cpc",
            value: overallRow.cpc ?? cpc,
            timestamp: new Date().toISOString(),
          }]
        : []),
    ];

    if (row.orders > 0 && acos <= targetAcos) {
      const suggestedBid = roundBid(row.currentBid * 1.08);

      recommendations.push({
        rowId: row.id,
        campaignGroupId: row.campaignGroupId,
        keyword: row.keyword,
        target: row.target,
        currentBid: row.currentBid,
        suggestedBid,
        deltaPercent: Number((((suggestedBid - row.currentBid) / row.currentBid) * 100).toFixed(1)),
        recommendation: "上调竞价 5-10% 并单独观察转化。",
        confidence: baseConfidence,
        evidence,
      });
      continue;
    }

    if (row.clicks >= 15 && row.orders === 0) {
      const suggestedBid = roundBid(Math.max(0.02, row.currentBid * 0.8));

      recommendations.push({
        rowId: row.id,
        campaignGroupId: row.campaignGroupId,
        keyword: row.keyword,
        target: row.target,
        currentBid: row.currentBid,
        suggestedBid,
        deltaPercent: Number((((suggestedBid - row.currentBid) / row.currentBid) * 100).toFixed(1)),
        recommendation: "先降价控损，必要时暂停或转否定。",
        confidence: 0.88,
        evidence,
      });
      continue;
    }

    if (roas >= adsSnapshot.metrics.roas && row.orders > 0) {
      const suggestedBid = roundBid(row.currentBid * 1.05);

      recommendations.push({
        rowId: row.id,
        campaignGroupId: row.campaignGroupId,
        keyword: row.keyword,
        target: row.target,
        currentBid: row.currentBid,
        suggestedBid,
        deltaPercent: Number((((suggestedBid - row.currentBid) / row.currentBid) * 100).toFixed(1)),
        recommendation: "轻度加价以获取更多高质量流量。",
        confidence: 0.8,
        evidence,
      });
    }
  }

  if (!recommendations.length) {
    const fallbackRow = performanceRows[0];
    if (fallbackRow) {
      recommendations.push({
        rowId: fallbackRow.id,
        campaignGroupId: fallbackRow.campaignGroupId,
        keyword: fallbackRow.keyword,
        target: fallbackRow.target,
        currentBid: fallbackRow.currentBid,
        suggestedBid: roundBid(fallbackRow.currentBid),
        deltaPercent: 0,
        recommendation: "数据不足，先观察并继续收集样本。",
        confidence: 0.5,
        evidence: evidenceFromRows("ppc.bid.recommend", "clicks", [fallbackRow], "Historical PPC", "样本不足"),
      });
    }
  }

  return recommendations.slice(0, 12);
}

function buildNegativeRecommendations(
  performanceRows: PerformanceRow[],
  overallAdDataRows: OverallAdDataRow[],
  diagnosis: PpcDiagnosisItem[],
  keywordSignal: ReturnType<typeof buildKeywordSignal>,
): PpcNegativeRecommendationItem[] {
  const recommendations: PpcNegativeRecommendationItem[] = [];
  const wasteRows = performanceRows.filter((row) => row.clicks >= 20 && row.orders === 0);

  for (const row of wasteRows.slice(0, 8)) {
    recommendations.push({
      term: row.keyword || row.target,
      matchType: row.matchType,
      recommendation: "建议添加否定词或把该词从广泛流量中隔离出去。",
      confidence: 0.86,
      evidence: evidenceFromRows("ppc.negative.recommend", "clicks", [row], "Historical PPC", "否定词候选"),
    });
  }

  if (!recommendations.length && keywordSignal.candidateKeywords.length) {
    recommendations.push({
      term: keywordSignal.candidateKeywords[0] ?? "unknown",
      matchType: "broad",
      recommendation: "当前没有明确否定词，但应持续监控泛词流量。",
      confidence: 0.55,
      evidence: keywordSignal.evidence,
    });
  }

  if (overallAdDataRows.some((row) => row.matchStatus === "unmatched")) {
    recommendations.push({
      term: "overall-unmatched",
      matchType: "signal",
      recommendation: "先修复未匹配数据，避免把错误词误判为浪费。",
      confidence: 0.65,
      evidence: [{
        claim: "Unmatched overall data affects negative keyword confidence.",
        dataSource: "Amazon Ads",
        toolId: "ppc.ads.snapshot",
        metric: "matchStatus",
        value: "unmatched",
        timestamp: new Date().toISOString(),
      }],
    });
  }

  return recommendations.slice(0, 10);
}

function buildCampaignRecommendations(
  campaignGroups: CampaignGroup[],
  diagnosis: PpcDiagnosisItem[],
  opportunities: PpcOpportunityItem[],
  productContext: JsonValue | null,
): PpcCampaignRecommendationItem[] {
  const recommendations: PpcCampaignRecommendationItem[] = [];

  if (diagnosis.some((item) => item.issue.includes("ACOS"))) {
    recommendations.push({
      title: "把高 ACOS 词拆成独立控制组",
      recommendation: "将高花费泛词与高效 exact 词拆开，分别设定预算和出价上限。",
      confidence: 0.88,
      evidence: diagnosis.flatMap((item) => item.evidence).slice(0, 4),
    });
  }

  if (opportunities.some((item) => item.type === "scale")) {
    recommendations.push({
      title: "为赢家词单独建扩量路径",
      recommendation: "对高效词建立单独 campaign / ad group，保留更高预算和更窄的匹配范围。",
      confidence: 0.86,
      evidence: opportunities.filter((item) => item.type === "scale").flatMap((item) => item.evidence).slice(0, 4),
    });
  }

  if (campaignGroups.length > 1) {
    recommendations.push({
      title: "统一检查生命周期分组与预算",
      recommendation: "按新品、成熟、衰退、清库存四类检查预算分配和否定词继承。",
      confidence: 0.78,
      evidence: [{
        claim: "Campaign grouping available for lifecycle planning.",
        dataSource: "Workspace",
        toolId: "ppc.workspace.load",
        metric: "campaignGroupCount",
        value: campaignGroups.length,
        timestamp: new Date().toISOString(),
      }],
    });
  }

  if (productContext) {
    recommendations.push({
      title: "把产品卖点映射到关键词分层",
      recommendation: "让 title、bullet、A+ 卖点反向驱动 PPC 的 keyword hierarchy 和精准词池。",
      confidence: 0.72,
      evidence: [{
        claim: "Product context can inform PPC keyword hierarchy.",
        dataSource: "Product Data",
        toolId: "ppc.workspace.load",
        metric: "productContext",
        value: productContext,
        timestamp: new Date().toISOString(),
      }],
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      title: "先稳定结构，再扩量",
      recommendation: "当前信号有限，先收拢浪费、确认核心词，再逐步放量。",
      confidence: 0.7,
      evidence: diagnosis.flatMap((item) => item.evidence).slice(0, 3),
    });
  }

  return recommendations.slice(0, 6);
}

function buildPpcReport(input: {
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

function extractReport(output: JsonValue | undefined, normalized: ReturnType<typeof normalizePpcExecutionRequest>): PpcAnalysisReport {
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

function extractEvidence(...inputs: Array<JsonValue | undefined>): PpcEvidenceItem[] {
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

function buildAdjustmentDrafts(recommendations: PpcBidRecommendationItem[]) {
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

function buildMemoryItems(input: {
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

function evidenceFromRows(
  toolId: string,
  metric: string,
  rows: PerformanceRow[],
  dataSource: string,
  claimPrefix: string,
): PpcEvidenceItem[] {
  return rows.map((row) => ({
    claim: `${claimPrefix}: ${row.keyword || row.target}`,
    dataSource,
    toolId,
    metric,
    value: {
      campaignGroupId: row.campaignGroupId,
      keyword: row.keyword,
      target: row.target,
      matchType: row.matchType,
      currentBid: row.currentBid,
      impressions: row.impressions,
      clicks: row.clicks,
      orders: row.orders,
      sales: row.sales,
      spend: row.spend,
      acos: enrichMetric(row, "acos"),
      roas: enrichMetric(row, "roas"),
      cpc: enrichMetric(row, "cpc"),
    },
    timestamp: new Date().toISOString(),
  }));
}

function rowPpcScore(row: PerformanceRow, targetAcos: number, targetRoas: number) {
  const acos = enrichMetric(row, "acos");
  const roas = enrichMetric(row, "roas");
  const ordersScore = Math.min(30, row.orders * 6);
  const acosScore = row.orders > 0 ? Math.max(0, 30 - Math.max(0, acos - targetAcos)) : 0;
  const roasScore = row.orders > 0 ? Math.max(0, 20 + Math.min(20, Math.max(0, roas - targetRoas) * 5)) : 0;

  return ordersScore + acosScore + roasScore - Math.min(20, row.clicks / 5);
}

function normalizeCampaignGroups(groups: unknown): CampaignGroup[] {
  if (!Array.isArray(groups)) return [];

  return groups.filter(isRecord).map((group, index) => ({
    id: String(group.id ?? `campaign-group-${index}`),
    campaignName: String(group.campaignName ?? group.adGroupName ?? `Campaign ${index + 1}`),
    adGroupName: String(group.adGroupName ?? group.campaignName ?? `Ad Group ${index + 1}`),
    lifecycleGroupId: normalizeLifecycleGroupId(group.lifecycleGroupId),
    keywordCount: numberValue(group.keywordCount, 0) ?? 0,
    lastUpdated: String(group.lastUpdated ?? new Date().toISOString()),
    sheetName: typeof group.sheetName === "string" ? group.sheetName : undefined,
  }));
}

function normalizePerformanceRows(rows: unknown): PerformanceRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.filter(isRecord).map((row, index) => ({
    id: String(row.id ?? `row-${index}`),
    campaignGroupId: String(row.campaignGroupId ?? "default"),
    batchId: String(row.batchId ?? "batch-default"),
    sheetName: typeof row.sheetName === "string" ? row.sheetName : undefined,
    sourceRowIndex: numberValue(row.sourceRowIndex, undefined),
    sourceRowNumber: numberValue(row.sourceRowNumber, undefined),
    entity: typeof row.entity === "string" ? row.entity : undefined,
    adGroupNameRef: typeof row.adGroupNameRef === "string" ? row.adGroupNameRef : undefined,
    campaignName: String(row.campaignName ?? "Campaign"),
    adGroupName: String(row.adGroupName ?? "Ad Group"),
    keyword: String(row.keyword ?? row.target ?? "keyword"),
    target: String(row.target ?? row.keyword ?? "target"),
    matchType: String(row.matchType ?? "broad"),
    currentBid: numberValue(row.currentBid, 0.2) ?? 0.2,
    impressions: numberValue(row.impressions, 0) ?? 0,
    clicks: numberValue(row.clicks, 0) ?? 0,
    orders: numberValue(row.orders, 0) ?? 0,
    sales: numberValue(row.sales, 0) ?? 0,
    spend: numberValue(row.spend, 0) ?? 0,
    topOfSearchShare: numberValue(row.topOfSearchShare, 0) ?? 0,
    advertisedProductOrders: numberValue(row.advertisedProductOrders, 0) ?? 0,
    otherProductOrders: numberValue(row.otherProductOrders, 0) ?? 0,
    viewableImpressions: numberValue(row.viewableImpressions, 0) ?? 0,
    status: row.status === "paused" ? "paused" : "enabled",
  }));
}

function normalizeOverallRows(rows: unknown): OverallAdDataRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.filter(isRecord).map((row, index) => ({
    id: String(row.id ?? `overall-${index}`),
    fileId: String(row.fileId ?? "file-default"),
    sheetName: typeof row.sheetName === "string" ? row.sheetName : undefined,
    campaignGroupId: typeof row.campaignGroupId === "string" ? row.campaignGroupId : undefined,
    scopeCampaignGroupIds: Array.isArray(row.scopeCampaignGroupIds) ? row.scopeCampaignGroupIds.map(String) : undefined,
    campaignName: typeof row.campaignName === "string" ? row.campaignName : undefined,
    adGroupName: typeof row.adGroupName === "string" ? row.adGroupName : undefined,
    keyword: String(row.keyword ?? row.target ?? "keyword"),
    target: String(row.target ?? row.keyword ?? "target"),
    matchType: String(row.matchType ?? "broad"),
    impressions: numberValue(row.impressions, 0) ?? 0,
    clicks: numberValue(row.clicks, 0) ?? 0,
    orders: numberValue(row.orders, 0) ?? 0,
    sales: numberValue(row.sales, 0) ?? 0,
    spend: numberValue(row.spend, 0) ?? 0,
    cpc: numberValue(row.cpc, undefined),
    acos: numberValue(row.acos, undefined),
    roas: numberValue(row.roas, undefined),
    matchStatus: normalizeMatchStatus(row.matchStatus),
    matchError: typeof row.matchError === "string" ? row.matchError : undefined,
  }));
}

function deriveScopeFromRows(rows: PerformanceRow[]) {
  return Array.from(new Set(rows.map((row) => row.campaignGroupId))).slice(0, 6);
}

function productContextText(value: JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  return String(record.title ?? record.name ?? record.summary ?? record.productName ?? "");
}

function normalizeLifecycleGroupId(value: unknown) {
  return value === "launch" || value === "mature" || value === "decline" || value === "clearance" ? value : undefined;
}

function normalizeMatchStatus(value: unknown) {
  return value === "matched" || value === "unmatched" || value === "ambiguous" ? value : "matched";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundBid(value: number) {
  return Math.max(0.02, Number(value.toFixed(2)));
}

function computeConfidence(report: PpcAnalysisReport) {
  const positiveSignals = report.opportunities.filter((item) => item.type === "scale" || item.type === "defend").length;
  const negativeSignals = report.diagnosis.filter((item) => item.severity === "high").length;

  return Math.max(0.55, Math.min(0.93, 0.68 + positiveSignals * 0.04 - negativeSignals * 0.03));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberValue(value: unknown, fallback: number | undefined) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toJsonValue(item)]));
  }
  return null;
}

function extractJsonObject(value: JsonValue | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObject;
}

function formatPercent(value: number) {
  return `${Number(value.toFixed(1))}%`;
}
