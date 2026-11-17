import type { AgentDefinition, AgentMemoryEntry, JsonObject, JsonValue } from "./types";
import type { ProductDevelopmentReport, ProductEvidenceItem } from "./product";
import { isRecord, toJsonValue, clampScore } from "./listing-normalization";
import type { ListingTitleDraft, ListingKeywordMap, ListingAnalysisReport } from "./listing-contracts";

export function buildSummary(report: ProductDevelopmentReport | JsonObject | null) {
  const productSummary = isRecord(report) && typeof report.summary === "string" ? report.summary : "the selected product";
  return `${productSummary} can be turned into a listing draft with a keyword map, SEO title, bullets, description, and A+ brief.`;
}

export function buildRecommendation(titleDraft: ListingTitleDraft, keywordMap: ListingKeywordMap) {
  return `Use ${titleDraft.primaryKeywords[0] ?? "the primary keyword"} in the title, cover ${keywordMap.competitorGaps[0] ?? "the main competitor gap"} in the bullets, then route the draft for human approval.`;
}

export function buildEvidence(input: {
  productLoadResult: { output?: JsonValue; toolCall?: { id?: string } };
  keywordMapResult: { output?: JsonValue; toolCall?: { id?: string } };
  titleResult: { output?: JsonValue; toolCall?: { id?: string } };
  bulletResult: { output?: JsonValue; toolCall?: { id?: string } };
  descriptionResult: { output?: JsonValue; toolCall?: { id?: string } };
  aplusResult: { output?: JsonValue; toolCall?: { id?: string } };
  listingDraftResult: { output?: JsonValue; toolCall?: { id?: string } };
  generatedAt: string;
}): ProductEvidenceItem[] {
  return [
    evidenceItem({
      claim: "Product context normalized",
      dataSource: "Listing MCP Adapter",
      toolId: "listing.product.load",
      toolCallId: input.productLoadResult.toolCall?.id,
      metric: "product-context",
      value: input.productLoadResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Keyword map built",
      dataSource: "Listing MCP Adapter",
      toolId: "listing.keyword.map",
      toolCallId: input.keywordMapResult.toolCall?.id,
      metric: "keyword-map",
      value: input.keywordMapResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Title drafted",
      dataSource: "Listing MCP Adapter",
      toolId: "listing.title.draft",
      toolCallId: input.titleResult.toolCall?.id,
      metric: "title-draft",
      value: input.titleResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Bullets drafted",
      dataSource: "Listing MCP Adapter",
      toolId: "listing.bullet.draft",
      toolCallId: input.bulletResult.toolCall?.id,
      metric: "bullet-draft",
      value: input.bulletResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Description drafted",
      dataSource: "Listing MCP Adapter",
      toolId: "listing.description.draft",
      toolCallId: input.descriptionResult.toolCall?.id,
      metric: "description-draft",
      value: input.descriptionResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "A+ brief drafted",
      dataSource: "Listing MCP Adapter",
      toolId: "listing.aplus.brief",
      toolCallId: input.aplusResult.toolCall?.id,
      metric: "aplus-brief",
      value: input.aplusResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Listing draft assembled",
      dataSource: "Listing MCP Adapter",
      toolId: "listing.listing.draft",
      toolCallId: input.listingDraftResult.toolCall?.id,
      metric: "listing-draft",
      value: input.listingDraftResult.output ?? null,
      timestamp: input.generatedAt,
    }),
  ];
}

export function buildMemoryItems(input: {
  execution: { id: string; agentDefinitionId: string };
  definition: AgentDefinition;
  report: ListingAnalysisReport;
  generatedAt: string;
  requestedByUserId?: string;
}): AgentMemoryEntry[] {
  const scopeKey = `${input.report.marketplace}:${input.report.category ?? input.report.productSummary ?? "listing"}:${input.execution.id}`;

  return [
    {
      id: `memory-${input.execution.id}-listing`,
      agentDefinitionId: input.definition.id,
      scope: "listing-copy",
      scopeKey,
      summary: `${input.report.titleDraft.title} drafted with keyword map and A+ brief.`,
      data: toJsonValue({
        report: input.report,
        requestedByUserId: input.requestedByUserId ?? null,
      }),
      sourceExecutionId: input.execution.id,
      confidence: Math.max(0.55, clampScore(input.report.listingDraft.confidence) / 100),
      createdAt: input.generatedAt,
      updatedAt: input.generatedAt,
    },
  ];
}

export function evidenceItem(input: {
  claim: string;
  dataSource: string;
  toolId: string;
  metric: string;
  value: JsonValue;
  toolCallId?: string;
  timestamp?: string;
}): ProductEvidenceItem {
  return {
    claim: input.claim,
    dataSource: input.dataSource,
    toolId: input.toolId,
    toolCallId: input.toolCallId,
    metric: input.metric,
    value: input.value,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}
