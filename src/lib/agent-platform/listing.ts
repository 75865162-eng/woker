import type { AgentEventName, AgentRuntimeExecutor, JsonValue } from "./types";
import type { ProductDevelopmentReport } from "./product";
import type { MarketResearchReport } from "./market";
import type { ListingExecutionRequest, ListingAnalysisReport } from "./listing-contracts";
import { normalizeListingExecutionInput, toJsonValue, extractJsonObject, extractKeywordMap, extractTitleDraft, extractBulletDrafts, extractDescriptionDraft, extractAplusBrief, extractListingDraft, isRecord, summarizeProduct, clampScore } from "./listing-normalization";
import { buildSummary, buildRecommendation, buildEvidence, buildMemoryItems } from "./listing-reporting";

export function createListingAgentExecutionExecutor(options: {
  request: ListingExecutionRequest;
  requestedByUserId?: string;
  clock?: () => Date;
}): AgentRuntimeExecutor {
  const clock = options.clock ?? (() => new Date());
  const normalizedInput = normalizeListingExecutionInput(options.request, {});

  return async ({ execution, definition, callTool: gatewayCallTool, recordTrace, emitEvent }) => {
    const callTool: typeof gatewayCallTool = async (toolId, input) => {
      const result = await gatewayCallTool(toolId, input);
      if (result.status !== "SUCCEEDED") throw new Error(`NEEDS_DATA: Listing 工具 ${toolId} 未完成：${result.error?.message ?? result.status}`);
      return result;
    };
    const generatedAt = clock().toISOString();

    recordTrace(
      "decision",
      "Listing brief parsed",
      toJsonValue({
        naturalLanguageGoal: normalizedInput.naturalLanguageGoal,
        marketplace: normalizedInput.marketplace,
        category: normalizedInput.category,
      }),
    );
    emitEvent("decision.made" as AgentEventName, {
      executionId: execution.id,
      summary: "Listing brief parsed and copy workflow prepared.",
      marketplace: normalizedInput.marketplace,
    } as JsonValue);

    const productLoadResult = await callTool(
      "listing.product.load",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        category: normalizedInput.category,
        productReport: normalizedInput.productReport,
        supplierReport: normalizedInput.supplierReport,
        marketReport: normalizedInput.marketReport,
        productOpportunity: normalizedInput.productOpportunity,
        sellerSpriteKeywords: normalizedInput.sellerSpriteKeywords,
        competitors: normalizedInput.competitors,
      }),
    );
    const productContext = extractJsonObject(productLoadResult.output);

    const keywordMapResult = await callTool(
      "listing.keyword.map",
      toJsonValue({
        productSummary: productContext.summary,
        sellerSpriteKeywords: normalizedInput.sellerSpriteKeywords ?? productContext.keywords,
        competitors: normalizedInput.competitors ?? productContext.competitors,
      }),
    );
    const keywordMap = extractKeywordMap(keywordMapResult.output);

    const titleResult = await callTool(
      "listing.title.draft",
      toJsonValue({
        productSummary: productContext.summary,
        keywordMap,
      }),
    );
    const titleDraft = extractTitleDraft(titleResult.output);

    const bulletResult = await callTool(
      "listing.bullet.draft",
      toJsonValue({
        productSummary: productContext.summary,
        keywordMap,
        titleDraft,
      }),
    );
    const bulletDrafts = extractBulletDrafts(bulletResult.output);

    const descriptionResult = await callTool(
      "listing.description.draft",
      toJsonValue({
        productSummary: productContext.summary,
        bulletDrafts,
        keywordMap,
      }),
    );
    const descriptionDraft = extractDescriptionDraft(descriptionResult.output);

    const aplusResult = await callTool(
      "listing.aplus.brief",
      toJsonValue({
        productSummary: productContext.summary,
        keywordMap,
        bulletDrafts,
      }),
    );
    const aplusBrief = extractAplusBrief(aplusResult.output);

    const listingDraftResult = await callTool(
      "listing.listing.draft",
      toJsonValue({
        titleDraft,
        bulletDrafts,
        descriptionDraft,
        aplusBrief,
        keywordMap,
      }),
    );
    const listingDraft = extractListingDraft(listingDraftResult.output, keywordMap, aplusBrief);

    const sourceProductReport = normalizedInput.productReport ?? (isRecord(productContext.productReport) ? (productContext.productReport as unknown as ProductDevelopmentReport) : null);
    const sourceMarketReport = normalizedInput.marketReport ?? (isRecord(productContext.marketReport) ? (productContext.marketReport as unknown as MarketResearchReport) : null);
    const summary = buildSummary(sourceProductReport);
    const recommendation = buildRecommendation(titleDraft, keywordMap);
    const evidence = buildEvidence({
      productLoadResult,
      keywordMapResult,
      titleResult,
      bulletResult,
      descriptionResult,
      aplusResult,
      listingDraftResult,
      generatedAt,
    });
    const report: ListingAnalysisReport = {
      goal: normalizedInput.naturalLanguageGoal,
      marketplace: normalizedInput.marketplace,
      category: normalizedInput.category,
      productSummary: summarizeProduct(sourceProductReport, sourceMarketReport, normalizedInput.productOpportunity),
      keywordMap,
      titleDraft,
      bulletDrafts,
      descriptionDraft,
      aplusBrief,
      listingDraft,
      evidence,
      summary,
      recommendation,
      generatedAt,
    };

    const memoryItems = buildMemoryItems({
      execution,
      definition,
      report,
      generatedAt,
      requestedByUserId: options.requestedByUserId,
    });

    recordTrace("recommendation", "Listing draft prepared", report as unknown as JsonValue);
    emitEvent("recommendation.created", report as unknown as JsonValue);

    return {
      recommendation: {
        summary: report.recommendation,
        evidence: report.evidence,
        risks: report.listingDraft.complianceNotes,
        confidence: clampScore(listingDraft.confidence) / 100,
        nextAction: "Review listing draft and prepare human approval.",
      },
      decision: {
        summary: report.summary,
        rationale: "Listing drafting is complete and ready for human review.",
        confidence: clampScore(listingDraft.confidence) / 100,
        nextStep: "Review title, bullets, description, and A+ brief",
      },
      output: toJsonValue({
        report,
        evidence,
      }),
      tokenUsage: 150,
      costCents: 0,
      memoryItems,
    };
  };
}

export type { ListingKeywordGroup, ListingKeywordMap, ListingTitleDraft, ListingBulletDraft, ListingDescriptionDraft, ListingAplusBrief, ListingDraft, ListingAnalysisReport, ListingExecutionOutput, ListingExecutionRequest } from "./listing-contracts";
export { listingAgentId, listingHandoffStorageKey } from "./listing-constants";
export { listingAgentDefinition, listingToolDefinitions } from "./listing-catalog";
export { createListingMcpAdapter } from "./listing-tools";
export { listingEvaluationCases } from "./listing-evaluations";