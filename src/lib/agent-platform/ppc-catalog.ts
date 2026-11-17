import type { AgentDefinition, AgentToolDefinition } from "./types";
import { ppcAgentId } from "./ppc-constants";

export const ppcToolAdapterId = "ppc-analytics-adapter";

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
