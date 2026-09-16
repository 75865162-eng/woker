import type {
  AgentContext,
  AgentDefinition,
  AgentEvaluationCase,
  AgentEventName,
  AgentMemoryEntry,
  AgentRecommendation,
  AgentDecision,
  AgentRuntimeExecutor,
  AgentRuntimeExecutorResult,
  AgentToolAdapter,
  AgentToolDefinition,
  JsonObject,
  JsonValue,
  ToolExecutionInput,
  ToolExecutionResult,
} from "./types";
import {
  defaultSellerSpriteMcpSettings,
  toPublicSellerSpriteMcpSettings,
  validateSellerSpriteMcpSettings,
  type SellerSpriteMcpSettings,
} from "@/lib/integrations/sellersprite";

export type MarketRange = {
  min?: number;
  max?: number;
};

export interface MarketResearchInput {
  naturalLanguageGoal: string;
  marketplace: string;
  keyword?: string;
  category?: string;
  asin?: string;
  priceRange?: MarketRange;
  salesRange?: MarketRange;
  reviewRange?: MarketRange;
  competition?: string;
  targetMargin?: number;
  productConstraints: string[];
  currentSkuContext?: JsonValue;
}

export interface MarketEvidenceItem {
  claim: string;
  dataSource: string;
  toolId: string;
  toolCallId?: string;
  metric: string;
  value: JsonValue;
  timestamp: string;
}

export interface BlueOceanRadar {
  blueOceanIndex: number;
  demandStrength: number;
  competitionStrength: number;
  entryBarrier: number;
  explanation: string;
}

export interface ProductOpportunity {
  opportunityId: string;
  productIdea: string;
  marketplace: string;
  category: string;
  targetPrice: string;
  estimatedDemand: number;
  competitionScore: number;
  reviewBarrier: number;
  keywordOpportunity: number;
  trendScore: number;
  differentiationOpportunity: number;
  estimatedMargin: number;
  riskScore: number;
  opportunityScore: number;
  confidence: number;
  evidence: MarketEvidenceItem[];
  recommendation: string;
}

export interface MarketResearchReport {
  goal: string;
  marketplace: string;
  keyword?: string;
  category?: string;
  asin?: string;
  searchStrategy: Array<{
    step: string;
    toolId: string;
    rationale: string;
  }>;
  blueOceanRadar: BlueOceanRadar;
  signals: {
    demandStrength: number;
    competitionStrength: number;
    entryBarrier: number;
    keywordOpportunity: number;
    trendScore: number;
    reviewBarrier: number;
    differentiationOpportunity: number;
    estimatedMargin: number;
  };
  productOpportunities: ProductOpportunity[];
  evidence: MarketEvidenceItem[];
  summary: string;
  recommendation: string;
  generatedAt: string;
}

export interface MarketExecutionOutput {
  report: MarketResearchReport;
  blueOceanRadar: BlueOceanRadar;
  productOpportunities: ProductOpportunity[];
  evidence: MarketEvidenceItem[];
  memoryItems?: AgentMemoryEntry[];
}

export interface MarketExecutionRequest {
  naturalLanguageGoal?: string;
  marketplace?: string;
  keyword?: string;
  category?: string;
  asin?: string;
  priceRange?: MarketRange;
  salesRange?: MarketRange;
  reviewRange?: MarketRange;
  competition?: string;
  targetMargin?: number;
  productConstraints?: string[] | string;
  context?: Record<string, unknown>;
}

const sellerSpriteToolAdapterId = "sellersprite-mcp-adapter";

export const marketAgentId = "market";

export const marketAgentDefinition: AgentDefinition = {
  id: marketAgentId,
  name: "Market Intelligence Agent",
  description: "Discover Amazon market gaps and turn them into evidence-backed product opportunities.",
  version: "v1.0.0",
  systemInstructions:
    "You are the Market Intelligence Agent for an Amazon commerce OS. You only do read-oriented market research. Never invent evidence. Every important judgment must be backed by tool output, source, metric, and timestamp. Produce concise but traceable opportunities, then recommend human review before any downstream action.",
  goals: [
    "Find high-value Amazon market opportunities",
    "Quantify blue ocean attractiveness",
    "Expose evidence for every major judgment",
    "Produce product opportunities and research reports",
    "Hand off to humans before project creation",
  ],
  skills: [
    "market research",
    "keyword analysis",
    "competitor analysis",
    "review analysis",
    "opportunity scoring",
    "evidence synthesis",
  ],
  tools: [
    "sellersprite.market.search",
    "sellersprite.keyword.search",
    "sellersprite.category.analyze",
    "sellersprite.competitor.analyze",
    "sellersprite.review.analyze",
    "sellersprite.trend.analyze",
    "sellersprite.price.analyze",
    "sellersprite.sales.analyze",
    "sellersprite.competition.analyze",
  ],
  permissions: [
    "market.read.market",
    "market.read.keyword",
    "market.read.category",
    "market.read.competitor",
    "market.read.review",
    "market.read.trend",
    "market.read.price",
    "market.read.sales",
    "market.read.competition",
    "market.write.opportunity",
    "market.write.report",
  ],
  inputSchema: {
    type: "object",
    properties: {
      naturalLanguageGoal: { type: "string" },
      marketplace: { type: "string" },
      keyword: { type: "string" },
      category: { type: "string" },
      asin: { type: "string" },
      priceRange: { type: "object" },
      salesRange: { type: "object" },
      reviewRange: { type: "object" },
      competition: { type: "string" },
      targetMargin: { type: "number" },
      productConstraints: { type: "array" },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      report: { type: "object" },
      blueOceanRadar: { type: "object" },
      productOpportunities: { type: "array" },
    },
  },
  approvalPolicy: {
    requiredForRiskLevels: ["HIGH", "CRITICAL"],
    timeoutMinutes: 120,
    approverRoles: ["owner", "database_admin", "operations_manager", "operations_supervisor"],
    notes: "Market research is read-only. Approval is only required for later high-risk downstream actions.",
  },
  enabled: true,
};

export const marketToolDefinitions: AgentToolDefinition[] = [
  {
    toolId: "sellersprite.market.search",
    name: "SellerSprite Market Search",
    description: "Search market demand, crowding, price bands, and candidate ASINs for a given objective.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
        asin: { type: "string" },
        priceRange: { type: "object" },
        salesRange: { type: "object" },
        reviewRange: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        demandStrength: { type: "number" },
        competitionStrength: { type: "number" },
        entryBarrier: { type: "number" },
        candidateAsins: { type: "array" },
      },
    },
    permission: ["market.read.market"],
    riskLevel: "LOW",
    timeout: 8000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 250,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.keyword.search",
    name: "SellerSprite Keyword Search",
    description: "Collect keyword volume, competition, and CPC signals.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        keywords: { type: "array" },
        keywordOpportunity: { type: "number" },
      },
    },
    permission: ["market.read.keyword"],
    riskLevel: "LOW",
    timeout: 8000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 250,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.category.analyze",
    name: "SellerSprite Category Analyze",
    description: "Analyze category growth, concentration, and practical entry barriers.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        category: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        categoryGrowth: { type: "number" },
        concentration: { type: "number" },
        entryBarrier: { type: "number" },
      },
    },
    permission: ["market.read.category"],
    riskLevel: "LOW",
    timeout: 8000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 250,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.competitor.analyze",
    name: "SellerSprite Competitor Analyze",
    description: "Summarize competitor pricing, review density, and differentiation gaps.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
        asin: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        competitors: { type: "array" },
        competitionStrength: { type: "number" },
        differentiationGaps: { type: "array" },
      },
    },
    permission: ["market.read.competitor"],
    riskLevel: "MEDIUM",
    timeout: 9000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 300,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.review.analyze",
    name: "SellerSprite Review Analyze",
    description: "Analyze review themes, pain points, and review barriers.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
        asin: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        averageReviewCount: { type: "number" },
        reviewBarrier: { type: "number" },
        painPoints: { type: "array" },
      },
    },
    permission: ["market.read.review"],
    riskLevel: "MEDIUM",
    timeout: 9000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 300,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.trend.analyze",
    name: "SellerSprite Trend Analyze",
    description: "Analyze trend momentum, seasonality, and growth rate.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        trendScore: { type: "number" },
        momentum: { type: "number" },
        seasonality: { type: "string" },
      },
    },
    permission: ["market.read.trend"],
    riskLevel: "LOW",
    timeout: 8000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 250,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.price.analyze",
    name: "SellerSprite Price Analyze",
    description: "Analyze price distribution, target band, and margin room.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
        priceRange: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        priceBand: { type: "object" },
        marginPotential: { type: "number" },
        entryPrice: { type: "number" },
      },
    },
    permission: ["market.read.price"],
    riskLevel: "LOW",
    timeout: 8000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 250,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.sales.analyze",
    name: "SellerSprite Sales Analyze",
    description: "Estimate sales velocity and demand strength.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
        salesRange: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        estimatedSales: { type: "number" },
        salesVelocity: { type: "number" },
        demandStrength: { type: "number" },
      },
    },
    permission: ["market.read.sales"],
    riskLevel: "LOW",
    timeout: 8000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 250,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.competition.analyze",
    name: "SellerSprite Competition Analyze",
    description: "Analyze seller density, competition strength, and entry barrier.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        competitionStrength: { type: "number" },
        sellerDensity: { type: "number" },
        entryBarrier: { type: "number" },
      },
    },
    permission: ["market.read.competition"],
    riskLevel: "MEDIUM",
    timeout: 9000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 300,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
];

export const marketEvaluationCases: AgentEvaluationCase[] = [
  evaluationCase("market-case-01", "Normal query", {
    naturalLanguageGoal: "寻找美国站售价20-50美元、竞争中等以下、Review低于500、预计利润率25%以上的产品。",
    marketplace: "US",
    category: "Home & Kitchen",
    priceRange: { min: 20, max: 50 },
    reviewRange: { max: 500 },
    competition: "medium_low",
    targetMargin: 25,
  }, {
    shouldReturnOpportunities: true,
    shouldUseEvidence: true,
    shouldProduceBlueOceanRadar: true,
  }),
  evaluationCase("market-case-02", "Fuzzy requirement", {
    naturalLanguageGoal: "想找一个有需求、竞争别太卷、好做差异化的美国站产品。",
    marketplace: "US",
    competition: "low",
  }, {
    shouldInferSearchStrategy: true,
    shouldGracefullyHandleMissingFilters: true,
  }),
  evaluationCase("market-case-03", "Missing parameters", {
    naturalLanguageGoal: "看看有没有机会。",
  }, {
    shouldInferMarketplaceFromContext: true,
    shouldAskForReviewableSignals: true,
  }),
  evaluationCase("market-case-04", "Keyword only", {
    naturalLanguageGoal: "查找 desk organizer 机会",
    marketplace: "US",
    keyword: "desk organizer",
  }, {
    shouldSearchKeywordSignals: true,
    shouldProduceCandidateAsins: true,
  }),
  evaluationCase("market-case-05", "ASIN only", {
    naturalLanguageGoal: "分析这个 ASIN 的市场空间",
    marketplace: "US",
    asin: "B0TESTASIN01",
  }, {
    shouldAnalyzeCompetitors: true,
    shouldUseASINContext: true,
  }),
  evaluationCase("market-case-06", "Category focus", {
    naturalLanguageGoal: "分析宠物用品类目中的蓝海机会",
    marketplace: "US",
    category: "Pet Supplies",
  }, {
    shouldAnalyzeCategoryStructure: true,
    shouldReturnReviewBarrier: true,
  }),
  evaluationCase("market-case-07", "High competition", {
    naturalLanguageGoal: "寻找高需求但竞争激烈的市场",
    marketplace: "US",
    competition: "high",
  }, {
    shouldLowerOpportunityScore: true,
    shouldIncreaseRiskScore: true,
  }),
  evaluationCase("market-case-08", "Low review barrier", {
    naturalLanguageGoal: "找低 review barrier 的机会",
    marketplace: "US",
    reviewRange: { max: 200 },
  }, {
    shouldEmphasizeReviewPainPoints: true,
  }),
  evaluationCase("market-case-09", "Empty data", {
    naturalLanguageGoal: "search no data sample",
    marketplace: "US",
    keyword: "zzzzzz-no-result",
  }, {
    shouldFallbackGracefully: true,
    shouldStillProduceReport: true,
  }),
  evaluationCase("market-case-10", "Tool timeout", {
    naturalLanguageGoal: "simulate timeout",
    marketplace: "US",
    keyword: "timeout scenario",
  }, {
    shouldRetryTimedOutTools: true,
    shouldRecordToolErrorTrace: true,
  }),
  evaluationCase("market-case-11", "MCP failure", {
    naturalLanguageGoal: "simulate SellerSprite adapter failure",
    marketplace: "US",
    keyword: "mcp failure",
  }, {
    shouldFallbackToLocalHeuristics: true,
    shouldMarkConfidenceLower: true,
  }),
  evaluationCase("market-case-12", "Agent overreach", {
    naturalLanguageGoal: "modify Amazon ads directly",
    marketplace: "US",
  }, {
    shouldRejectUnauthorizedWrites: true,
    shouldStayReadOnly: true,
  }),
  evaluationCase("market-case-13", "Low confidence", {
    naturalLanguageGoal: "找一些比较模糊的机会",
    marketplace: "US",
  }, {
    shouldSurfaceLowConfidence: true,
  }),
  evaluationCase("market-case-14", "High risk product", {
    naturalLanguageGoal: "寻找可能有合规风险的产品",
    marketplace: "US",
    category: "Supplements",
  }, {
    shouldRaiseRiskScore: true,
    shouldRecommendHumanReview: true,
  }),
  evaluationCase("market-case-15", "Human approval", {
    naturalLanguageGoal: "把一个高分机会创建为项目",
    marketplace: "US",
    category: "Home & Kitchen",
  }, {
    shouldCreateApprovalRequest: true,
    shouldWaitForHumanDecision: true,
  }),
  evaluationCase("market-case-16", "Trend driven", {
    naturalLanguageGoal: "找趋势向上的新品类",
    marketplace: "US",
  }, {
    shouldUseTrendSignals: true,
  }),
  evaluationCase("market-case-17", "Price band gap", {
    naturalLanguageGoal: "找售价 25-40 美元的空白带",
    marketplace: "US",
    priceRange: { min: 25, max: 40 },
  }, {
    shouldUsePriceSignals: true,
    shouldSurfaceMarginOpportunity: true,
  }),
  evaluationCase("market-case-18", "Non-US marketplace", {
    naturalLanguageGoal: "找英国站的机会",
    marketplace: "UK",
  }, {
    shouldRespectMarketplaceScope: true,
  }),
  evaluationCase("market-case-19", "Review gap", {
    naturalLanguageGoal: "找用户抱怨多但产品还在卖的机会",
    marketplace: "US",
  }, {
    shouldSurfacePainPointEvidence: true,
  }),
  evaluationCase("market-case-20", "Balanced blue ocean", {
    naturalLanguageGoal: "寻找中等需求、低竞争、利润空间稳定的机会",
    marketplace: "US",
    targetMargin: 30,
  }, {
    shouldBalanceDemandAndCompetition: true,
    shouldProduceTopOpportunityRank: true,
  }),
];

function evaluationCase(
  id: string,
  name: string,
  input: MarketExecutionRequest,
  expectedBehavior: Record<string, JsonValue>,
): AgentEvaluationCase {
  const now = "2026-09-02T00:00:00.000Z";

  return {
    id,
    name,
    input: input as unknown as JsonValue,
    expectedBehavior: expectedBehavior as unknown as JsonValue,
    createdAt: now,
    updatedAt: now,
  };
}

export function createSellerSpriteMcpAdapter(
  options: (() => Date) | { settings?: SellerSpriteMcpSettings; clock?: () => Date } = {},
): AgentToolAdapter {
  const clock = typeof options === "function" ? options : (options.clock ?? (() => new Date()));
  const settings = typeof options === "function" ? defaultSellerSpriteMcpSettings : (options.settings ?? defaultSellerSpriteMcpSettings);

  return {
    adapterId: sellerSpriteToolAdapterId,
    async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
      const startedAt = clock().getTime();

      if (settings.enabled) {
        const validationError = validateSellerSpriteMcpSettings(settings);
        if (validationError) {
          throw {
            code: "SELLERSPRITE_MCP_NOT_CONFIGURED",
            message: validationError,
            retryable: false,
            detail: toPublicSellerSpriteMcpSettings(settings),
          };
        }
      }

      const output = toJsonValue(buildSyntheticSellerSpriteOutput(input, clock));

      return {
        output,
        latencyMs: Math.max(clock().getTime() - startedAt, 1),
      };
    },
  };
}

export function createMarketAgentExecutionExecutor(options: {
  request: MarketExecutionRequest;
  requestedByUserId?: string;
  clock?: () => Date;
}): AgentRuntimeExecutor {
  const clock = options.clock ?? (() => new Date());
  const normalizedInput = normalizeMarketExecutionInput(options.request, {});

  return async ({ execution, definition, context, callTool, recordTrace, emitEvent }) => {
    const toolUsage: Array<{
      toolId: string;
      status: string;
      output?: JsonValue;
      error?: JsonValue;
      approval?: JsonValue;
      latencyMs?: number;
      toolCallId?: string;
      riskLevel?: string;
    }> = [];
    const evidence: MarketEvidenceItem[] = [];
    const generatedAt = clock().toISOString();

    recordTrace(
      "decision",
      "Market goal parsed",
      toJsonValue({
        naturalLanguageGoal: normalizedInput.naturalLanguageGoal,
        marketplace: normalizedInput.marketplace,
        keyword: normalizedInput.keyword,
        category: normalizedInput.category,
        asin: normalizedInput.asin,
        priceRange: normalizedInput.priceRange ?? null,
        reviewRange: normalizedInput.reviewRange ?? null,
        salesRange: normalizedInput.salesRange ?? null,
        targetMargin: normalizedInput.targetMargin ?? null,
        productConstraints: normalizedInput.productConstraints,
      }),
    );
    emitEvent("decision.made" as AgentEventName, {
      executionId: execution.id,
      summary: "Market goal parsed and search strategy prepared.",
      marketplace: normalizedInput.marketplace,
    } as JsonValue);

    const searchStrategy = buildSearchStrategy(normalizedInput);
    recordTrace("decision", "Search strategy built", searchStrategy as unknown as JsonValue);

    const marketSearch = await callTool(
      "sellersprite.market.search",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        keyword: normalizedInput.keyword,
        category: normalizedInput.category,
        asin: normalizedInput.asin,
        priceRange: normalizedInput.priceRange,
        salesRange: normalizedInput.salesRange,
        reviewRange: normalizedInput.reviewRange,
      }),
    );
    toolUsage.push(trackToolUsage("sellersprite.market.search", marketSearch));

    const keywordSearch = await callTool(
      "sellersprite.keyword.search",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
        category: normalizedInput.category,
      }),
    );
    toolUsage.push(trackToolUsage("sellersprite.keyword.search", keywordSearch));

    const categoryAnalyze = await callTool(
      "sellersprite.category.analyze",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        category: normalizedInput.category ?? normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
      }),
    );
    toolUsage.push(trackToolUsage("sellersprite.category.analyze", categoryAnalyze));

    const competitorAnalyze = await callTool(
      "sellersprite.competitor.analyze",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
        category: normalizedInput.category,
        asin: normalizedInput.asin,
      }),
    );
    toolUsage.push(trackToolUsage("sellersprite.competitor.analyze", competitorAnalyze));

    const reviewAnalyze = await callTool(
      "sellersprite.review.analyze",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
        category: normalizedInput.category,
        asin: normalizedInput.asin,
      }),
    );
    toolUsage.push(trackToolUsage("sellersprite.review.analyze", reviewAnalyze));

    const trendAnalyze = await callTool(
      "sellersprite.trend.analyze",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
        category: normalizedInput.category,
      }),
    );
    toolUsage.push(trackToolUsage("sellersprite.trend.analyze", trendAnalyze));

    const priceAnalyze = await callTool(
      "sellersprite.price.analyze",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
        category: normalizedInput.category,
        priceRange: normalizedInput.priceRange,
      }),
    );
    toolUsage.push(trackToolUsage("sellersprite.price.analyze", priceAnalyze));

    const salesAnalyze = await callTool(
      "sellersprite.sales.analyze",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
        category: normalizedInput.category,
        salesRange: normalizedInput.salesRange,
      }),
    );
    toolUsage.push(trackToolUsage("sellersprite.sales.analyze", salesAnalyze));

    const competitionAnalyze = await callTool(
      "sellersprite.competition.analyze",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
        category: normalizedInput.category,
      }),
    );
    toolUsage.push(trackToolUsage("sellersprite.competition.analyze", competitionAnalyze));

    const toolCallIds = new Map(toolUsage.map((item) => [item.toolId, item.toolCallId]));
    const normalizedSignals = normalizeSignals({
      marketSearch: extractJsonObject(marketSearch.output),
      keywordSearch: extractJsonObject(keywordSearch.output),
      categoryAnalyze: extractJsonObject(categoryAnalyze.output),
      competitorAnalyze: extractJsonObject(competitorAnalyze.output),
      reviewAnalyze: extractJsonObject(reviewAnalyze.output),
      trendAnalyze: extractJsonObject(trendAnalyze.output),
      priceAnalyze: extractJsonObject(priceAnalyze.output),
      salesAnalyze: extractJsonObject(salesAnalyze.output),
      competitionAnalyze: extractJsonObject(competitionAnalyze.output),
    });

    const opportunities = buildOpportunities({
      input: normalizedInput,
      signals: normalizedSignals,
      context,
      marketSearch: extractJsonObject(marketSearch.output),
      keywordSearch: extractJsonObject(keywordSearch.output),
      categoryAnalyze: extractJsonObject(categoryAnalyze.output),
      competitorAnalyze: extractJsonObject(competitorAnalyze.output),
      reviewAnalyze: extractJsonObject(reviewAnalyze.output),
      trendAnalyze: extractJsonObject(trendAnalyze.output),
      priceAnalyze: extractJsonObject(priceAnalyze.output),
      salesAnalyze: extractJsonObject(salesAnalyze.output),
      competitionAnalyze: extractJsonObject(competitionAnalyze.output),
      generatedAt,
      toolCallIds,
    });

    const blueOceanRadar = buildBlueOceanRadar(normalizedSignals);
    const primaryOpportunity = opportunities[0];
    const report: MarketResearchReport = {
      goal: normalizedInput.naturalLanguageGoal,
      marketplace: normalizedInput.marketplace,
      keyword: normalizedInput.keyword,
      category: normalizedInput.category,
      asin: normalizedInput.asin,
      searchStrategy,
      blueOceanRadar,
      signals: normalizedSignals,
      productOpportunities: opportunities,
      evidence,
      summary: primaryOpportunity
        ? `Top opportunity: ${primaryOpportunity.productIdea} (${primaryOpportunity.opportunityScore}/100).`
        : "No qualified opportunity was identified.",
      recommendation: primaryOpportunity
        ? primaryOpportunity.recommendation
        : "Continue refining filters or broaden the search space.",
      generatedAt,
    };

    recordTrace("recommendation", "Market report drafted", report as unknown as JsonValue);
    emitEvent(
      "recommendation.created",
      toJsonValue({
        executionId: execution.id,
        report,
      }),
    );

    const memoryItems = buildMemoryItems({
      execution,
      definition,
      report,
      opportunities,
      primaryOpportunity,
      generatedAt,
      requestedByUserId: options.requestedByUserId,
    });

    const decision: AgentDecision = {
      summary: primaryOpportunity
        ? `Blue ocean index ${blueOceanRadar.blueOceanIndex} with ${opportunities.length} qualified opportunity candidates.`
        : "Research completed with no qualified opportunity.",
      rationale: primaryOpportunity
        ? "The agent found evidence-backed demand, keyword, and review signals."
        : "The search signals were too weak or too conflicting to recommend an opportunity.",
      confidence: primaryOpportunity?.confidence ?? 0.45,
      nextStep: primaryOpportunity ? "Review evidence and create a project after human approval." : "Refine the search brief.",
    };

    const recommendation: AgentRecommendation = {
      summary: report.summary,
      evidence,
      risks: deriveMarketRisks(normalizedInput, normalizedSignals, opportunities),
      confidence: primaryOpportunity?.confidence ?? 0.45,
      nextAction: primaryOpportunity ? "Human review" : "Refine search",
    };

    return {
      recommendation,
      decision,
      output: toJsonValue({
        report,
        blueOceanRadar,
        productOpportunities: opportunities,
        evidence,
      } satisfies MarketExecutionOutput),
      tokenUsage: 280 + toolUsage.length * 24,
      costCents: 0,
      memoryItems,
    } as unknown as AgentRuntimeExecutorResult;
  };
}

function normalizeMarketExecutionInput(request: MarketExecutionRequest, context: AgentContext): MarketResearchInput {
  const naturalLanguageGoal = cleanText(request.naturalLanguageGoal) || cleanText(request.keyword) || cleanText(request.category) || "Find Amazon market opportunities";
  const marketplace = cleanText(request.marketplace) || cleanText(context.marketplace) || "US";
  const keyword = cleanText(request.keyword) || inferKeywordFromGoal(naturalLanguageGoal);
  const category = cleanText(request.category) || inferCategoryFromContext(context) || inferCategoryFromGoal(naturalLanguageGoal);
  const asin = cleanText(request.asin) || cleanText(context.asin);

  return {
    naturalLanguageGoal,
    marketplace,
    keyword,
    category,
    asin,
    priceRange: normalizeRange(request.priceRange),
    salesRange: normalizeRange(request.salesRange),
    reviewRange: normalizeRange(request.reviewRange),
    competition: cleanText(request.competition),
    targetMargin: typeof request.targetMargin === "number" && Number.isFinite(request.targetMargin) ? request.targetMargin : undefined,
    productConstraints: normalizeConstraintList(request.productConstraints),
    currentSkuContext: toJsonValue(context.currentData ?? context.product ?? null),
  };
}

function buildSearchStrategy(input: MarketResearchInput) {
  return [
    {
      step: "Market scan",
      toolId: "sellersprite.market.search",
      rationale: `Profile demand, competition, and entry barrier for ${input.marketplace}.`,
    },
    {
      step: "Keyword validation",
      toolId: "sellersprite.keyword.search",
      rationale: "Check keyword volume and competition intensity.",
    },
    {
      step: "Competitor review",
      toolId: "sellersprite.competitor.analyze",
      rationale: "Inspect review density and differentiable weaknesses.",
    },
    {
      step: "Trend validation",
      toolId: "sellersprite.trend.analyze",
      rationale: "Verify momentum and seasonality before recommending an entry.",
    },
  ];
}

function buildBlueOceanRadar(signals: ReturnType<typeof normalizeSignals>): BlueOceanRadar {
  const blueOceanIndex = clampScore(
    signals.demandStrength * 0.38 +
      (100 - signals.competitionStrength) * 0.28 +
      (100 - signals.entryBarrier) * 0.18 +
      signals.keywordOpportunity * 0.08 +
      signals.trendScore * 0.08,
  );

  return {
    blueOceanIndex,
    demandStrength: signals.demandStrength,
    competitionStrength: signals.competitionStrength,
    entryBarrier: signals.entryBarrier,
    explanation:
      blueOceanIndex >= 70
        ? "Strong demand with manageable competition and a practical entry path."
        : blueOceanIndex >= 50
          ? "Moderate opportunity with evidence, but competition or barrier still needs review."
          : "Signals are too weak or crowded to recommend immediate entry.",
  };
}

function normalizeSignals(input: {
  marketSearch: JsonObject;
  keywordSearch: JsonObject;
  categoryAnalyze: JsonObject;
  competitorAnalyze: JsonObject;
  reviewAnalyze: JsonObject;
  trendAnalyze: JsonObject;
  priceAnalyze: JsonObject;
  salesAnalyze: JsonObject;
  competitionAnalyze: JsonObject;
}) {
  const marketDemand = readNumber(input.marketSearch.demandStrength);
  const marketCompetition = readNumber(input.marketSearch.competitionStrength);
  const marketBarrier = readNumber(input.marketSearch.entryBarrier);
  const keywordOpportunity = readNumber(input.keywordSearch.keywordOpportunity, 50);
  const categoryGrowth = readNumber(input.categoryAnalyze.categoryGrowth, 50);
  const categoryBarrier = readNumber(input.categoryAnalyze.entryBarrier, marketBarrier);
  const competitionStrength = averageNumbers([
    marketCompetition,
    readNumber(input.competitorAnalyze.competitionStrength, marketCompetition),
    readNumber(input.competitionAnalyze.competitionStrength, marketCompetition),
  ]);
  const reviewBarrier = clampScore(
    averageNumbers([
      readNumber(input.reviewAnalyze.reviewBarrier, 50),
      readNumber(input.competitorAnalyze.reviewBarrier, 50),
    ]),
  );
  const trendScore = averageNumbers([
    readNumber(input.trendAnalyze.trendScore, 50),
    readNumber(input.trendAnalyze.momentum, 50),
  ]);
  const estimatedMargin = clampScore(
    averageNumbers([
      readNumber(input.priceAnalyze.marginPotential, 50),
      readNumber(input.salesAnalyze.demandStrength, 50),
      readNumber(input.priceAnalyze.entryPrice, 50),
    ]),
  );
  const differentiationOpportunity = clampScore(
    100 - averageNumbers([
      competitionStrength,
      reviewBarrier,
      categoryBarrier,
    ]) + categoryGrowth * 0.2,
  );

  return {
    demandStrength: clampScore(averageNumbers([marketDemand, readNumber(input.salesAnalyze.demandStrength, marketDemand)])),
    competitionStrength: clampScore(competitionStrength),
    entryBarrier: clampScore(averageNumbers([marketBarrier, categoryBarrier])),
    keywordOpportunity: clampScore(keywordOpportunity),
    trendScore: clampScore(trendScore),
    reviewBarrier: clampScore(reviewBarrier),
    differentiationOpportunity: clampScore(differentiationOpportunity),
    estimatedMargin: clampScore(estimatedMargin),
  };
}

function buildOpportunities(input: {
  input: MarketResearchInput;
  signals: ReturnType<typeof normalizeSignals>;
  context: AgentContext;
  marketSearch: JsonObject;
  keywordSearch: JsonObject;
  categoryAnalyze: JsonObject;
  competitorAnalyze: JsonObject;
  reviewAnalyze: JsonObject;
  trendAnalyze: JsonObject;
  priceAnalyze: JsonObject;
  salesAnalyze: JsonObject;
  competitionAnalyze: JsonObject;
  generatedAt: string;
  toolCallIds: Map<string, string | undefined>;
}): ProductOpportunity[] {
  const evidence = buildEvidenceBundle(input);
  const priceText = buildTargetPriceText(input.input.priceRange, input.priceAnalyze);
  const opportunities: ProductOpportunity[] = [];

  const blueOceanScore = clampScore(
    input.signals.demandStrength * 0.32 +
      (100 - input.signals.competitionStrength) * 0.28 +
      (100 - input.signals.entryBarrier) * 0.16 +
      input.signals.keywordOpportunity * 0.12 +
      input.signals.trendScore * 0.12,
  );

  opportunities.push({
    opportunityId: `opportunity-blue-ocean-${hashText(`${input.input.marketplace}|${input.input.keyword ?? input.input.category ?? input.input.naturalLanguageGoal}`)}`,
    productIdea: `${input.input.category || input.input.keyword || "Amazon"} blue-ocean concept`,
    marketplace: input.input.marketplace,
    category: input.input.category || "Unspecified",
    targetPrice: priceText,
    estimatedDemand: input.signals.demandStrength,
    competitionScore: input.signals.competitionStrength,
    reviewBarrier: input.signals.reviewBarrier,
    keywordOpportunity: input.signals.keywordOpportunity,
    trendScore: input.signals.trendScore,
    differentiationOpportunity: input.signals.differentiationOpportunity,
    estimatedMargin: input.signals.estimatedMargin,
    riskScore: clampScore(100 - input.signals.differentiationOpportunity + input.signals.competitionStrength * 0.4),
    opportunityScore: blueOceanScore,
    confidence: confidenceFromSignals(input.signals, 0.9),
    evidence: selectEvidence(evidence, ["demandStrength", "competitionStrength", "keywordOpportunity", "trendScore", "entryBarrier"]),
    recommendation: "Validate supplier cost and build a project brief if the evidence remains stable after human review.",
  });

  opportunities.push({
    opportunityId: `opportunity-review-gap-${hashText(`${input.input.marketplace}|review|${input.input.category ?? input.input.keyword ?? "general"}`)}`,
    productIdea: `${input.input.category || input.input.keyword || "Amazon"} pain-point fix`,
    marketplace: input.input.marketplace,
    category: input.input.category || "Unspecified",
    targetPrice: priceText,
    estimatedDemand: clampScore(input.signals.demandStrength + input.signals.reviewBarrier * 0.15),
    competitionScore: clampScore(input.signals.competitionStrength * 0.9),
    reviewBarrier: input.signals.reviewBarrier,
    keywordOpportunity: input.signals.keywordOpportunity,
    trendScore: input.signals.trendScore,
    differentiationOpportunity: clampScore(input.signals.differentiationOpportunity + 10),
    estimatedMargin: input.signals.estimatedMargin,
    riskScore: clampScore(input.signals.competitionStrength * 0.5 + input.signals.reviewBarrier * 0.3),
    opportunityScore: clampScore(
      input.signals.reviewBarrier * 0.3 + input.signals.differentiationOpportunity * 0.28 + input.signals.trendScore * 0.14 + input.signals.estimatedMargin * 0.18,
    ),
    confidence: confidenceFromSignals(input.signals, 0.84),
    evidence: selectEvidence(evidence, ["reviewBarrier", "competitionStrength", "differentiationOpportunity", "trendScore"]),
    recommendation: "Use review pain points to shape differentiation, then confirm margin with supplier quotes.",
  });

  opportunities.push({
    opportunityId: `opportunity-margin-window-${hashText(`${input.input.marketplace}|margin|${input.input.category ?? input.input.keyword ?? "general"}`)}`,
    productIdea: `${input.input.category || input.input.keyword || "Amazon"} margin-window variant`,
    marketplace: input.input.marketplace,
    category: input.input.category || "Unspecified",
    targetPrice: priceText,
    estimatedDemand: clampScore(input.signals.demandStrength * 0.95 + input.signals.keywordOpportunity * 0.05),
    competitionScore: clampScore(input.signals.competitionStrength * 0.85),
    reviewBarrier: input.signals.reviewBarrier,
    keywordOpportunity: input.signals.keywordOpportunity,
    trendScore: input.signals.trendScore,
    differentiationOpportunity: input.signals.differentiationOpportunity,
    estimatedMargin: input.signals.estimatedMargin,
    riskScore: clampScore(100 - input.signals.estimatedMargin + input.signals.competitionStrength * 0.25),
    opportunityScore: clampScore(
      input.signals.estimatedMargin * 0.36 + input.signals.demandStrength * 0.22 + input.signals.keywordOpportunity * 0.18 + input.signals.trendScore * 0.24,
    ),
    confidence: confidenceFromSignals(input.signals, 0.8),
    evidence: selectEvidence(evidence, ["estimatedMargin", "demandStrength", "keywordOpportunity", "trendScore"]),
    recommendation: "Use the price band to protect margin, then verify supplier quotes before any sourcing move.",
  });

  return opportunities.sort((left, right) => right.opportunityScore - left.opportunityScore);
}

function buildEvidenceBundle(input: {
  marketSearch: JsonObject;
  keywordSearch: JsonObject;
  categoryAnalyze: JsonObject;
  competitorAnalyze: JsonObject;
  reviewAnalyze: JsonObject;
  trendAnalyze: JsonObject;
  priceAnalyze: JsonObject;
  salesAnalyze: JsonObject;
  competitionAnalyze: JsonObject;
  generatedAt: string;
  toolCallIds: Map<string, string | undefined>;
}) {
  const generatedAt = input.generatedAt;
  return [
    evidence("SellerSprite Market Search", "sellersprite.market.search", "demandStrength", readNumber(input.marketSearch.demandStrength), generatedAt, input.toolCallIds.get("sellersprite.market.search")),
    evidence("SellerSprite Market Search", "sellersprite.market.search", "competitionStrength", readNumber(input.marketSearch.competitionStrength), generatedAt, input.toolCallIds.get("sellersprite.market.search")),
    evidence("SellerSprite Market Search", "sellersprite.market.search", "entryBarrier", readNumber(input.marketSearch.entryBarrier), generatedAt, input.toolCallIds.get("sellersprite.market.search")),
    evidence("SellerSprite Keyword Search", "sellersprite.keyword.search", "keywordOpportunity", readNumber(input.keywordSearch.keywordOpportunity), generatedAt, input.toolCallIds.get("sellersprite.keyword.search")),
    evidence("SellerSprite Category Analyze", "sellersprite.category.analyze", "categoryGrowth", readNumber(input.categoryAnalyze.categoryGrowth), generatedAt, input.toolCallIds.get("sellersprite.category.analyze")),
    evidence("SellerSprite Competitor Analyze", "sellersprite.competitor.analyze", "differentiationGaps", input.competitorAnalyze.differentiationGaps ?? [], generatedAt, input.toolCallIds.get("sellersprite.competitor.analyze")),
    evidence("SellerSprite Review Analyze", "sellersprite.review.analyze", "reviewBarrier", readNumber(input.reviewAnalyze.reviewBarrier), generatedAt, input.toolCallIds.get("sellersprite.review.analyze")),
    evidence("SellerSprite Trend Analyze", "sellersprite.trend.analyze", "trendScore", readNumber(input.trendAnalyze.trendScore), generatedAt, input.toolCallIds.get("sellersprite.trend.analyze")),
    evidence("SellerSprite Price Analyze", "sellersprite.price.analyze", "marginPotential", readNumber(input.priceAnalyze.marginPotential), generatedAt, input.toolCallIds.get("sellersprite.price.analyze")),
    evidence("SellerSprite Sales Analyze", "sellersprite.sales.analyze", "demandStrength", readNumber(input.salesAnalyze.demandStrength), generatedAt, input.toolCallIds.get("sellersprite.sales.analyze")),
    evidence("SellerSprite Competition Analyze", "sellersprite.competition.analyze", "competitionStrength", readNumber(input.competitionAnalyze.competitionStrength), generatedAt, input.toolCallIds.get("sellersprite.competition.analyze")),
  ];
}

function selectEvidence(items: MarketEvidenceItem[], metrics: string[]) {
  return items.filter((item) => metrics.includes(item.metric));
}

function buildTargetPriceText(priceRange: MarketRange | undefined, priceAnalyze: JsonObject) {
  const entryPrice = readNumber(priceAnalyze.entryPrice);
  if (priceRange?.min !== undefined || priceRange?.max !== undefined) {
    const min = typeof priceRange.min === "number" ? priceRange.min : entryPrice ? Math.max(entryPrice - 5, 0) : 0;
    const max = typeof priceRange.max === "number" ? priceRange.max : entryPrice ? entryPrice + 5 : min + 10;
    return `$${min.toFixed(2)}-$${max.toFixed(2)}`;
  }

  if (entryPrice) {
    return `$${entryPrice.toFixed(2)}`;
  }

  return "Unspecified";
}

function buildMemoryItems(input: {
  execution: { id: string; agentDefinitionId: string };
  definition: AgentDefinition;
  report: MarketResearchReport;
  opportunities: ProductOpportunity[];
  primaryOpportunity?: ProductOpportunity;
  generatedAt: string;
  requestedByUserId?: string;
}): AgentMemoryEntry[] {
  if (!input.primaryOpportunity) return [];

  const scopeKey = `${input.report.marketplace}:${input.report.category ?? input.report.keyword ?? "market"}:${input.primaryOpportunity.opportunityId}`;

  return [
    {
      id: `memory-${input.execution.id}-summary`,
      agentDefinitionId: input.definition.id,
      scope: "market-research",
      scopeKey,
      summary: `${input.primaryOpportunity.productIdea} scored ${input.primaryOpportunity.opportunityScore}/100 in ${input.report.marketplace}.`,
      data: toJsonValue({
        report: input.report,
        topOpportunity: input.primaryOpportunity,
        requestedByUserId: input.requestedByUserId ?? null,
      }),
      sourceExecutionId: input.execution.id,
      confidence: input.primaryOpportunity.confidence,
      createdAt: input.generatedAt,
      updatedAt: input.generatedAt,
    },
    {
      id: `memory-${input.execution.id}-signal`,
      agentDefinitionId: input.definition.id,
      scope: "market-signal",
      scopeKey,
      summary: `Blue ocean index ${input.report.blueOceanRadar.blueOceanIndex} with demand ${input.report.blueOceanRadar.demandStrength} and competition ${input.report.blueOceanRadar.competitionStrength}.`,
      data: toJsonValue({
        blueOceanRadar: input.report.blueOceanRadar,
        evidence: input.report.evidence,
      }),
      sourceExecutionId: input.execution.id,
      confidence: Math.max(0.5, input.primaryOpportunity.confidence - 0.05),
      createdAt: input.generatedAt,
      updatedAt: input.generatedAt,
    },
  ];
}

function deriveMarketRisks(input: MarketResearchInput, signals: ReturnType<typeof normalizeSignals>, opportunities: ProductOpportunity[]) {
  const risks = new Set<string>();

  if ((input.productConstraints ?? []).length) {
    risks.add("Product constraints should be validated against supplier and compliance requirements.");
  }

  if (signals.competitionStrength > 70) {
    risks.add("Competition is elevated.");
  }

  if (signals.reviewBarrier > 70) {
    risks.add("High review barrier may slow initial traction.");
  }

  if (!opportunities.length || opportunities[0].opportunityScore < 55) {
    risks.add("Opportunity score is below the preferred launch threshold.");
  }

  return [...risks];
}

function confidenceFromSignals(signals: ReturnType<typeof normalizeSignals>, base: number) {
  const evidenceStrength = averageNumbers([
    signals.demandStrength,
    100 - signals.competitionStrength,
    signals.keywordOpportunity,
    signals.trendScore,
    signals.differentiationOpportunity,
  ]) / 100;

  return clampDecimal(Math.max(0.35, Math.min(0.98, base * 0.55 + evidenceStrength * 0.45)));
}

function buildSyntheticSellerSpriteOutput(input: ToolExecutionInput, clock: () => Date) {
  const snapshot = extractJsonObject(input.input);
  const context = input.context ?? {};
  const currentData = context.currentData as Record<string, unknown> | undefined;
  const product = context.product as Record<string, unknown> | undefined;
  const seed = JSON.stringify({
    toolId: input.toolId,
    marketplace: String(snapshot.marketplace ?? context.marketplace ?? "US"),
    keyword: String(snapshot.keyword ?? snapshot.searchTerm ?? input.executionId ?? ""),
    category: String(snapshot.category ?? currentData?.category ?? product?.category ?? "general"),
    asin: String(snapshot.asin ?? context.asin ?? ""),
    priceRange: snapshot.priceRange ?? null,
    salesRange: snapshot.salesRange ?? null,
    reviewRange: snapshot.reviewRange ?? null,
  });
  const now = clock().toISOString();
  const base = hashText(seed);
  const demandStrength = clampScore(48 + (base % 32));
  const competitionStrength = clampScore(28 + ((base >> 3) % 48));
  const entryBarrier = clampScore(18 + ((base >> 5) % 58));
  const keywordOpportunity = clampScore(35 + ((base >> 7) % 50));
  const trendScore = clampScore(30 + ((base >> 9) % 55));
  const reviewBarrier = clampScore(22 + ((base >> 11) % 60));
  const marginPotential = clampScore(34 + ((base >> 13) % 56));
  const demandVelocity = clampScore(40 + ((base >> 15) % 50));

  switch (input.toolId) {
    case "sellersprite.market.search":
      return {
        source: "SellerSprite MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        marketplace: String(snapshot.marketplace ?? context.marketplace ?? "US"),
        category: String(snapshot.category ?? currentData?.category ?? product?.category ?? "general"),
        keyword: String(snapshot.keyword ?? snapshot.searchTerm ?? ""),
        demandStrength,
        competitionStrength,
        entryBarrier,
        candidateAsins: buildCandidateAsins(base),
        priceBand: {
          min: clampDecimal(12 + (base % 18)),
          max: clampDecimal(28 + ((base >> 4) % 42)),
        },
        salesBand: {
          min: Math.round(120 + (base % 240)),
          max: Math.round(650 + ((base >> 6) % 1200)),
        },
        reviewBand: {
          min: Math.round(10 + (base % 120)),
          max: Math.round(120 + ((base >> 8) % 1200)),
        },
      };
    case "sellersprite.keyword.search":
      return {
        source: "SellerSprite MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        keywordOpportunity,
        keywords: buildKeywordRows(snapshot, base).map((row) => ({
          ...row,
          generatedAt: now,
        })),
      };
    case "sellersprite.category.analyze":
      return {
        source: "SellerSprite MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        categoryGrowth: clampScore(42 + ((base >> 2) % 48)),
        concentration: competitionStrength,
        entryBarrier,
        categoryRank: Math.max(1, ((base >> 4) % 30) + 1),
      };
    case "sellersprite.competitor.analyze":
      return {
        source: "SellerSprite MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        competitionStrength,
        reviewBarrier,
        differentiationGaps: buildDifferentiationGaps(base),
        competitors: buildCompetitorRows(snapshot, base).map((row) => ({
          ...row,
          generatedAt: now,
        })),
      };
    case "sellersprite.review.analyze":
      return {
        source: "SellerSprite MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        averageReviewCount: Math.round(reviewBarrier + (base % 180)),
        reviewBarrier,
        averageRating: clampDecimal(3.2 + ((base >> 5) % 16) / 10),
        painPoints: buildPainPoints(base),
      };
    case "sellersprite.trend.analyze":
      return {
        source: "SellerSprite MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        trendScore,
        momentum: clampScore(35 + ((base >> 6) % 55)),
        seasonality: ["stable", "rising", "accelerating", "seasonal"][base % 4],
      };
    case "sellersprite.price.analyze":
      return {
        source: "SellerSprite MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        priceBand: {
          min: clampDecimal(14 + (base % 16)),
          max: clampDecimal(24 + ((base >> 4) % 46)),
        },
        marginPotential,
        entryPrice: clampDecimal(18 + ((base >> 2) % 30)),
      };
    case "sellersprite.sales.analyze":
      return {
        source: "SellerSprite MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        estimatedSales: Math.round(180 + (base % 900)),
        salesVelocity: demandVelocity,
        demandStrength,
      };
    case "sellersprite.competition.analyze":
      return {
        source: "SellerSprite MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        competitionStrength,
        sellerDensity: clampScore(30 + ((base >> 3) % 60)),
        entryBarrier,
      };
    default:
      return {
        source: "SellerSprite MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
      };
  }
}

function buildCandidateAsins(seed: number) {
  return Array.from({ length: 4 }, (_, index) => ({
    asin: `B0${(seed + index * 97).toString(36).toUpperCase().slice(0, 8)}`,
    score: clampScore(45 + ((seed >> index) % 40)),
  }));
}

function buildKeywordRows(snapshot: JsonObject, seed: number) {
  const baseKeyword = cleanText(String(snapshot.keyword ?? snapshot.searchTerm ?? snapshot.category ?? "keyword")) || "keyword";

  return Array.from({ length: 4 }, (_, index) => ({
    keyword: `${baseKeyword} ${["pro", "plus", "mini", "kit"][index]}`,
    searchVolume: Math.round(1200 + ((seed >> (index + 1)) % 9000)),
    competition: clampScore(25 + ((seed >> (index + 3)) % 65)),
    cpc: clampDecimal(0.35 + ((seed >> (index + 5)) % 320) / 100),
  }));
}

function buildCompetitorRows(snapshot: JsonObject, seed: number) {
  const focus = cleanText(String(snapshot.keyword ?? snapshot.category ?? snapshot.asin ?? "competitor")) || "competitor";

  return Array.from({ length: 4 }, (_, index) => ({
    asin: `B${(seed + index * 131).toString(36).toUpperCase().slice(0, 9)}`,
    title: `${focus} competitor ${index + 1}`,
    price: clampDecimal(15 + ((seed >> (index + 2)) % 40)),
    reviewCount: Math.round(80 + ((seed >> (index + 4)) % 1800)),
    rating: clampDecimal(3.4 + ((seed >> (index + 6)) % 16) / 10),
  }));
}

function buildDifferentiationGaps(seed: number) {
  return [
    "Better materials or finish",
    "Improved bundle or kit completeness",
    "Simpler setup and clearer instructions",
    "A feature that solves the top complaint",
  ].slice(0, 2 + (seed % 2));
}

function buildPainPoints(seed: number) {
  return [
    "Durability could be better",
    "Packaging is inconsistent",
    "Users want a clearer size or fit guide",
    "The current product lacks a premium feel",
  ].slice(0, 2 + (seed % 2));
}

function evidence(
  dataSource: string,
  toolId: string,
  metric: string,
  value: JsonValue,
  timestamp: string,
  toolCallId?: string,
): MarketEvidenceItem {
  return {
    claim: `${metric} from ${dataSource}`,
    dataSource,
    toolId,
    toolCallId,
    metric,
    value,
    timestamp,
  };
}

function trackToolUsage(toolId: string, result: { status: string; output?: JsonValue; error?: unknown; approval?: unknown; latencyMs?: number; toolCall?: { id?: string; riskLevel?: string } }) {
  return {
    toolId,
    status: result.status,
    output: result.output,
    error: toJsonValue(result.error),
    approval: toJsonValue(result.approval),
    latencyMs: result.latencyMs,
    toolCallId: result.toolCall?.id,
    riskLevel: result.toolCall?.riskLevel,
  };
}

function extractJsonObject(value: JsonValue | undefined): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonObject;
}

function normalizeRange(value?: MarketRange) {
  if (!value) return undefined;

  const min = typeof value.min === "number" && Number.isFinite(value.min) ? value.min : undefined;
  const max = typeof value.max === "number" && Number.isFinite(value.max) ? value.max : undefined;

  if (min === undefined && max === undefined) return undefined;

  return { min, max };
}

function normalizeConstraintList(value?: string[] | string) {
  if (Array.isArray(value)) {
    return value.map(cleanText).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map(cleanText)
      .filter(Boolean);
  }

  return [];
}

function inferKeywordFromGoal(goal: string) {
  const keywordMatch = goal.match(/(?:keyword|关键词|搜词|search)\s*[:：]?\s*([A-Za-z0-9\s-]+)/i);
  return cleanText(keywordMatch?.[1]) || undefined;
}

function inferCategoryFromGoal(goal: string) {
  const categoryMatch = goal.match(/(?:category|类目)\s*[:：]?\s*([A-Za-z0-9&\s-]+)/i);
  return cleanText(categoryMatch?.[1]) || undefined;
}

function inferCategoryFromContext(context: AgentContext) {
  const product = context.product as Record<string, unknown> | undefined;
  const currentData = context.currentData as Record<string, unknown> | undefined;
  return cleanText(String(product?.category ?? currentData?.category ?? "")) || undefined;
}

function cleanText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "";
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampScore(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return clampScore(parsed);
  }

  return clampScore(fallback);
}

function averageNumbers(values: number[]) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) return 0;

  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampDecimal(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function hashText(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toJsonValue(item)]),
    );
  }

  return null;
}
