import type { AgentEvaluationCase, JsonValue } from "./types";
import type { MarketExecutionRequest } from "./market";

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
    shouldFailWithoutMarketData: true,
    shouldNotProduceReport: true,
  }),
  evaluationCase("market-case-10", "Tool timeout", {
    naturalLanguageGoal: "simulate timeout",
    marketplace: "US",
    keyword: "timeout scenario",
  }, {
    shouldFailOnToolError: true,
    shouldRecordToolErrorTrace: true,
  }),
  evaluationCase("market-case-11", "MCP failure", {
    naturalLanguageGoal: "simulate SellerSprite adapter failure",
    marketplace: "US",
    keyword: "mcp failure",
  }, {
    shouldFailWithoutMcpData: true,
    shouldNotProduceReport: true,
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
