import type { AgentEventName, AgentRecommendation, AgentDecision, AgentRuntimeExecutor, AgentRuntimeExecutorResult, JsonValue } from "./types";
import type { MarketExecutionRequest, MarketEvidenceItem, MarketResearchReport, MarketExecutionOutput } from "./market-contracts";
import { normalizeMarketExecutionInput, toJsonValue, extractJsonObject } from "./market-normalization";
import { buildSearchStrategy, normalizeSignals, buildOpportunities, buildBlueOceanRadar, buildMemoryItems, deriveMarketRisks } from "./market-analysis";
import { assertMarketToolResponse, trackToolUsage } from "./market-tools";

export function createMarketAgentExecutionExecutor(options: {
  request: MarketExecutionRequest;
  requestedByUserId?: string;
  clock?: () => Date;
}): AgentRuntimeExecutor {
  const clock = options.clock ?? (() => new Date());
  const normalizedInput = normalizeMarketExecutionInput(options.request, {});

  return async ({ execution, definition, context, callTool, recordTrace, emitEvent }) => {
    if (options.request.selectionRun) {
      const result = await callTool("market.selection.run", toJsonValue({ ...normalizedInput, fileId: options.request.selectionFileId ?? null }));
      if (result.status !== "SUCCEEDED") throw result.error ?? { code: "NOT_IMPLEMENTED", message: "Round B selection unavailable.", retryable: false };
      return {
        output: result.output ?? null,
        tokenUsage: 0, costCents: 0,
      };
    }
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
    assertMarketToolResponse("sellersprite.market.search", marketSearch, {
      marketplace: normalizedInput.marketplace,
      keyword: normalizedInput.keyword,
      category: normalizedInput.category,
      asin: normalizedInput.asin,
    });
    toolUsage.push(trackToolUsage("sellersprite.market.search", marketSearch));

    const keywordSearch = await callTool(
      "sellersprite.keyword.search",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
        category: normalizedInput.category,
      }),
    );
    assertMarketToolResponse("sellersprite.keyword.search", keywordSearch, {
      marketplace: normalizedInput.marketplace,
      keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
      category: normalizedInput.category,
    });
    toolUsage.push(trackToolUsage("sellersprite.keyword.search", keywordSearch));

    const categoryAnalyze = await callTool(
      "sellersprite.category.analyze",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        category: normalizedInput.category ?? normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
      }),
    );
    assertMarketToolResponse("sellersprite.category.analyze", categoryAnalyze, {
      marketplace: normalizedInput.marketplace,
      category: normalizedInput.category ?? normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
    });
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
    assertMarketToolResponse("sellersprite.competitor.analyze", competitorAnalyze, {
      marketplace: normalizedInput.marketplace,
      keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
      category: normalizedInput.category,
      asin: normalizedInput.asin,
    });
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
    assertMarketToolResponse("sellersprite.review.analyze", reviewAnalyze, {
      marketplace: normalizedInput.marketplace,
      keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
      category: normalizedInput.category,
      asin: normalizedInput.asin,
    });
    toolUsage.push(trackToolUsage("sellersprite.review.analyze", reviewAnalyze));

    const trendAnalyze = await callTool(
      "sellersprite.trend.analyze",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
        category: normalizedInput.category,
      }),
    );
    assertMarketToolResponse("sellersprite.trend.analyze", trendAnalyze, {
      marketplace: normalizedInput.marketplace,
      keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
      category: normalizedInput.category,
    });
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
    assertMarketToolResponse("sellersprite.price.analyze", priceAnalyze, {
      marketplace: normalizedInput.marketplace,
      keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
      category: normalizedInput.category,
    });
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
    assertMarketToolResponse("sellersprite.sales.analyze", salesAnalyze, {
      marketplace: normalizedInput.marketplace,
      keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
      category: normalizedInput.category,
    });
    toolUsage.push(trackToolUsage("sellersprite.sales.analyze", salesAnalyze));

    const competitionAnalyze = await callTool(
      "sellersprite.competition.analyze",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
        category: normalizedInput.category,
      }),
    );
    assertMarketToolResponse("sellersprite.competition.analyze", competitionAnalyze, {
      marketplace: normalizedInput.marketplace,
      keyword: normalizedInput.keyword ?? normalizedInput.naturalLanguageGoal,
      category: normalizedInput.category,
    });
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

export type { MarketRange, MarketResearchInput, MarketEvidenceItem, BlueOceanRadar, ProductOpportunity, MarketResearchReport, MarketExecutionOutput, MarketExecutionRequest } from "./market-contracts";
export { marketAgentDefinition, marketToolDefinitions } from "./market-catalog";
export { marketAgentId } from "./market-constants";
export { createSellerSpriteMcpAdapter } from "./market-tools";
export { marketEvaluationCases } from "./market-evaluations";