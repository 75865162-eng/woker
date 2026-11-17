import type { AgentContext, AgentDefinition, AgentMemoryEntry, JsonObject, JsonValue } from "./types";
import type { MarketResearchInput, BlueOceanRadar, ProductOpportunity, MarketEvidenceItem, MarketRange, MarketResearchReport } from "./market-contracts";
import { clampScore, readNumber, averageNumbers, hashText, toJsonValue, clampDecimal } from "./market-normalization";

export function buildSearchStrategy(input: MarketResearchInput) {
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

export function buildBlueOceanRadar(signals: ReturnType<typeof normalizeSignals>): BlueOceanRadar {
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

export function normalizeSignals(input: {
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

export function buildOpportunities(input: {
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

  return opportunities.sort((left, right) => (right.opportunityScore ?? 0) - (left.opportunityScore ?? 0));
}

export function buildEvidenceBundle(input: {
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

export function selectEvidence(items: MarketEvidenceItem[], metrics: string[]) {
  return items.filter((item) => metrics.includes(item.metric));
}

export function buildTargetPriceText(priceRange: MarketRange | undefined, priceAnalyze: JsonObject) {
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

export function buildMemoryItems(input: {
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

export function deriveMarketRisks(input: MarketResearchInput, signals: ReturnType<typeof normalizeSignals>, opportunities: ProductOpportunity[]) {
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

  if (!opportunities.length || (opportunities[0].opportunityScore ?? 0) < 55) {
    risks.add("Opportunity score is below the preferred launch threshold.");
  }

  return [...risks];
}

export function confidenceFromSignals(signals: ReturnType<typeof normalizeSignals>, base: number) {
  const evidenceStrength = averageNumbers([
    signals.demandStrength,
    100 - signals.competitionStrength,
    signals.keywordOpportunity,
    signals.trendScore,
    signals.differentiationOpportunity,
  ]) / 100;

  return clampDecimal(Math.max(0.35, Math.min(0.98, base * 0.55 + evidenceStrength * 0.45)));
}

export function evidence(
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
