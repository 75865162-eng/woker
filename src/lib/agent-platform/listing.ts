import type {
  AgentDefinition,
  AgentEventName,
  AgentMemoryEntry,
  AgentRuntimeExecutor,
  AgentToolAdapter,
  AgentToolDefinition,
  JsonObject,
  JsonValue,
  ToolExecutionInput,
  ToolExecutionResult,
} from "./types";
import type { ProductDevelopmentReport, ProductEvidenceItem, ProductHandoffPayload } from "./product";
import type { MarketResearchReport, ProductOpportunity } from "./market";

export interface ListingKeywordGroup {
  placement: "title" | "bullets" | "description" | "backend" | "a-plus";
  keywords: string[];
  intent: string;
  rationale: string;
}

export interface ListingKeywordMap {
  primaryKeywords: string[];
  secondaryKeywords: string[];
  longTailKeywords: string[];
  backendSearchTerms: string[];
  competitorGaps: string[];
  groups: ListingKeywordGroup[];
  notes: string;
}

export interface ListingTitleDraft {
  title: string;
  characterCount: number;
  primaryKeywords: string[];
  secondaryKeywords: string[];
  rationale: string;
}

export interface ListingBulletDraft {
  bullet: string;
  keywordFocus: string[];
  benefit: string;
  evidenceNotes: string[];
}

export interface ListingDescriptionDraft {
  summary: string;
  paragraphs: string[];
  keywordCoverage: string[];
  complianceNotes: string[];
}

export interface ListingAplusBrief {
  objective: string;
  modules: Array<{
    moduleName: string;
    message: string;
    layout: string;
    visualNotes: string[];
  }>;
  imageStoryline: string[];
  recommendations: string[];
}

export interface ListingDraft {
  title: string;
  bullets: string[];
  description: string;
  backendSearchTerms: string;
  aplusBrief: ListingAplusBrief;
  keywordMap: ListingKeywordMap;
  complianceNotes: string[];
  recommendation: string;
  confidence: number;
}

export interface ListingAnalysisReport {
  goal: string;
  marketplace: string;
  category?: string;
  productSummary: string;
  keywordMap: ListingKeywordMap;
  titleDraft: ListingTitleDraft;
  bulletDrafts: ListingBulletDraft[];
  descriptionDraft: ListingDescriptionDraft;
  aplusBrief: ListingAplusBrief;
  listingDraft: ListingDraft;
  evidence: ProductEvidenceItem[];
  summary: string;
  recommendation: string;
  generatedAt: string;
}

export interface ListingExecutionOutput {
  report: ListingAnalysisReport;
  evidence: ProductEvidenceItem[];
  memoryItems?: AgentMemoryEntry[];
}

export interface ListingExecutionRequest {
  naturalLanguageGoal?: string;
  marketplace?: string;
  category?: string;
  productOpportunity?: ProductOpportunity | null;
  marketReport?: MarketResearchReport | null;
  productReport?: ProductDevelopmentReport | null;
  productHandoff?: ProductHandoffPayload | null;
  sellerSpriteKeywords?: JsonValue;
  competitors?: JsonValue;
  currentSkuContext?: JsonValue;
  context?: Record<string, unknown>;
}

export const listingAgentId = "listing";
const listingToolAdapterId = "listing-mcp-adapter";
export const listingHandoffStorageKey = "amazon.agent-platform.listing-handoff";

export const listingAgentDefinition: AgentDefinition = {
  id: listingAgentId,
  name: "Listing Agent",
  description: "Turn product plans and keyword evidence into keyword maps, title, bullets, description, and A+ brief drafts.",
  version: "v1.0.0",
  systemInstructions:
    "You are the Listing Agent for an Amazon commerce OS. Turn a validated product plan, keyword signals, and competitor evidence into a keyword map, title, bullet points, description, A+ brief, and listing draft. Use the Tool Gateway only. Never claim keyword certainty without evidence.",
  goals: [
    "Build keyword maps from product and market evidence",
    "Draft SEO-aware listing copy",
    "Compose title, bullet points, and description",
    "Prepare A+ brief and listing draft",
    "Hand off for human approval before publication",
  ],
  skills: [
    "keyword mapping",
    "Amazon SEO copy",
    "competitive positioning",
    "listing drafting",
    "A+ planning",
  ],
  tools: [
    "listing.product.load",
    "listing.keyword.map",
    "listing.title.draft",
    "listing.bullet.draft",
    "listing.description.draft",
    "listing.aplus.brief",
    "listing.listing.draft",
  ],
  permissions: [
    "listing.read.product",
    "listing.read.keywords",
    "listing.read.competitors",
    "listing.write.keywordMap",
    "listing.write.title",
    "listing.write.bullets",
    "listing.write.description",
    "listing.write.aplus",
    "listing.write.listingDraft",
  ],
  inputSchema: {
    type: "object",
    properties: {
      naturalLanguageGoal: { type: "string" },
      marketplace: { type: "string" },
      category: { type: "string" },
      productOpportunity: { type: "object" },
      marketReport: { type: "object" },
      productReport: { type: "object" },
      productHandoff: { type: "object" },
      sellerSpriteKeywords: { type: "object" },
      competitors: { type: "object" },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      report: { type: "object" },
      evidence: { type: "array" },
    },
  },
  approvalPolicy: {
    requiredForRiskLevels: ["HIGH", "CRITICAL"],
    timeoutMinutes: 120,
    approverRoles: ["owner", "database_admin", "operations_manager", "operations_supervisor"],
    notes: "Listing drafts are approval-gated before publication.",
  },
  enabled: true,
};

export const listingToolDefinitions: AgentToolDefinition[] = [
  {
    toolId: "listing.product.load",
    name: "Load Product Listing Context",
    description: "Normalize product, market, keyword, and competitor context for listing drafting.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        category: { type: "string" },
        productReport: { type: "object" },
        marketReport: { type: "object" },
        productOpportunity: { type: "object" },
        sellerSpriteKeywords: { type: "object" },
        competitors: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        keywords: { type: "object" },
        competitors: { type: "object" },
      },
    },
    permission: ["listing.read.product"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
  {
    toolId: "listing.keyword.map",
    name: "Keyword Map Builder",
    description: "Build a keyword map with title, bullets, description, backend, and A+ placements.",
    inputSchema: {
      type: "object",
      properties: {
        productSummary: { type: "string" },
        sellerSpriteKeywords: { type: "object" },
        competitors: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        keywordMap: { type: "object" },
      },
    },
    permission: ["listing.read.keywords", "listing.read.competitors", "listing.write.keywordMap"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
  {
    toolId: "listing.title.draft",
    name: "Title Draft",
    description: "Draft an Amazon listing title using primary and secondary keyword coverage.",
    inputSchema: {
      type: "object",
      properties: {
        productSummary: { type: "string" },
        keywordMap: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        titleDraft: { type: "object" },
      },
    },
    permission: ["listing.write.title"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
  {
    toolId: "listing.bullet.draft",
    name: "Bullet Draft",
    description: "Draft benefit-led bullets with evidence-aware keyword coverage.",
    inputSchema: {
      type: "object",
      properties: {
        productSummary: { type: "string" },
        keywordMap: { type: "object" },
        titleDraft: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        bulletDrafts: { type: "array" },
      },
    },
    permission: ["listing.write.bullets"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
  {
    toolId: "listing.description.draft",
    name: "Description Draft",
    description: "Draft the product description and compliance-safe keyword coverage.",
    inputSchema: {
      type: "object",
      properties: {
        productSummary: { type: "string" },
        bulletDrafts: { type: "array" },
        keywordMap: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        descriptionDraft: { type: "object" },
      },
    },
    permission: ["listing.write.description"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
  {
    toolId: "listing.aplus.brief",
    name: "A+ Brief Draft",
    description: "Draft the A+ content brief and visual storyline.",
    inputSchema: {
      type: "object",
      properties: {
        productSummary: { type: "string" },
        keywordMap: { type: "object" },
        bulletDrafts: { type: "array" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        aplusBrief: { type: "object" },
      },
    },
    permission: ["listing.write.aplus"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
  {
    toolId: "listing.listing.draft",
    name: "Listing Draft",
    description: "Assemble title, bullets, description, backend terms, and A+ brief into a listing draft.",
    inputSchema: {
      type: "object",
      properties: {
        titleDraft: { type: "object" },
        bulletDrafts: { type: "array" },
        descriptionDraft: { type: "object" },
        aplusBrief: { type: "object" },
        keywordMap: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        listingDraft: { type: "object" },
      },
    },
    permission: ["listing.write.listingDraft"],
    riskLevel: "MEDIUM",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
];

export const listingEvaluationCases = [
  evaluationCase("listing-case-01", "Normal handoff", {
    naturalLanguageGoal: "把产品计划转成 Listing Draft",
    marketplace: "US",
  }, {
    shouldLoadProductContext: true,
    shouldBuildKeywordMap: true,
    shouldDraftTitle: true,
    shouldDraftBullets: true,
  }),
  evaluationCase("listing-case-02", "Missing product report", {
    naturalLanguageGoal: "帮我写 listing",
    marketplace: "US",
  }, {
    shouldFallbackGracefully: true,
  }),
  evaluationCase("listing-case-03", "Keyword heavy", {
    naturalLanguageGoal: "围绕关键词优化 listing",
    marketplace: "US",
  }, {
    shouldPrioritizeKeywords: true,
  }),
  evaluationCase("listing-case-04", "Competitor heavy", {
    naturalLanguageGoal: "根据竞品重写 listing",
    marketplace: "US",
  }, {
    shouldUseCompetitorGaps: true,
  }),
  evaluationCase("listing-case-05", "Title focus", {
    naturalLanguageGoal: "先做标题",
    marketplace: "US",
  }, {
    shouldDraftTitle: true,
  }),
  evaluationCase("listing-case-06", "Bullet focus", {
    naturalLanguageGoal: "优化 bullets",
    marketplace: "US",
  }, {
    shouldDraftBullets: true,
  }),
  evaluationCase("listing-case-07", "Description focus", {
    naturalLanguageGoal: "重写 description",
    marketplace: "US",
  }, {
    shouldDraftDescription: true,
  }),
  evaluationCase("listing-case-08", "A+ focus", {
    naturalLanguageGoal: "生成 A+ brief",
    marketplace: "US",
  }, {
    shouldDraftAplus: true,
  }),
  evaluationCase("listing-case-09", "Low confidence", {
    naturalLanguageGoal: "信息不多先给 draft",
    marketplace: "US",
  }, {
    shouldLowerConfidence: true,
  }),
  evaluationCase("listing-case-10", "Human approval", {
    naturalLanguageGoal: "生成 listing draft 供审批",
    marketplace: "US",
  }, {
    shouldWaitForHumanReview: true,
  }),
];

function evaluationCase(
  id: string,
  name: string,
  input: ListingExecutionRequest,
  expectedBehavior: Record<string, JsonValue>,
) {
  const now = "2026-09-03T00:00:00.000Z";

  return {
    id,
    name,
    input: input as unknown as JsonValue,
    expectedBehavior: expectedBehavior as unknown as JsonValue,
    createdAt: now,
    updatedAt: now,
  };
}

export function createListingMcpAdapter(clock: () => Date = () => new Date()): AgentToolAdapter {
  return {
    adapterId: listingToolAdapterId,
    async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
      const startedAt = clock().getTime();
      const output = toJsonValue(buildSyntheticListingOutput(input, clock));

      return {
        output,
        latencyMs: Math.max(clock().getTime() - startedAt, 1),
      };
    },
  };
}

export function createListingAgentExecutionExecutor(options: {
  request: ListingExecutionRequest;
  requestedByUserId?: string;
  clock?: () => Date;
}): AgentRuntimeExecutor {
  const clock = options.clock ?? (() => new Date());
  const normalizedInput = normalizeListingExecutionInput(options.request, {});

  return async ({ execution, definition, callTool, recordTrace, emitEvent }) => {
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

function normalizeListingExecutionInput(request: ListingExecutionRequest, context: Record<string, unknown>) {
  const currentData = isRecord(context.currentData) ? context.currentData : {};
  const productHandoff = extractJsonObject(toJsonValue(request.productHandoff ?? currentData.productHandoff));
  const productReport = extractJsonObject(toJsonValue(request.productReport ?? currentData.productReport));
  const marketReport = extractJsonObject(toJsonValue(request.marketReport ?? currentData.marketReport));
  const productOpportunity = extractOpportunity(request.productOpportunity ?? currentData.productOpportunity);

  return {
    naturalLanguageGoal: String(request.naturalLanguageGoal ?? currentData.goal ?? productReport.summary ?? "Turn the product plan into a listing draft."),
    marketplace: String(request.marketplace ?? productReport.marketplace ?? marketReport.marketplace ?? productHandoff.marketplace ?? currentData.marketplace ?? context.marketplace ?? "US"),
    category: String(request.category ?? productReport.category ?? marketReport.category ?? productHandoff.category ?? currentData.category ?? "general"),
    productReport,
    marketReport,
    productOpportunity,
    productHandoff: Object.keys(productHandoff).length ? (productHandoff as unknown as ProductHandoffPayload) : null,
    sellerSpriteKeywords: request.sellerSpriteKeywords ?? currentData.sellerSpriteKeywords ?? null,
    competitors: request.competitors ?? currentData.competitors ?? null,
    currentSkuContext: request.currentSkuContext ?? currentData ?? null,
  };
}

function buildSyntheticListingOutput(input: ToolExecutionInput, clock: () => Date) {
  const snapshot = extractJsonObject(input.input);
  const context = input.context ?? {};
  const currentData = isRecord(context.currentData) ? context.currentData : {};
  const seed = hashText(JSON.stringify({
    toolId: input.toolId,
    marketplace: String(snapshot.marketplace ?? context.marketplace ?? "US"),
    category: String(snapshot.category ?? currentData.category ?? "general"),
    productSummary: snapshot.productSummary ?? readSummary(currentData.productReport) ?? currentData.goal ?? null,
  }));
  const now = clock().toISOString();

  switch (input.toolId) {
    case "listing.product.load":
      return {
        source: "Listing MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        marketplace: String(snapshot.marketplace ?? context.marketplace ?? "US"),
        category: String(snapshot.category ?? currentData.category ?? "general"),
        summary: summarizeProduct(
          (snapshot.productReport ?? currentData.productReport ?? null) as ProductDevelopmentReport | JsonObject | null,
          (snapshot.marketReport ?? currentData.marketReport ?? null) as MarketResearchReport | JsonObject | null,
          (snapshot.productOpportunity ?? currentData.productOpportunity ?? null) as ProductOpportunity | JsonObject | null,
        ),
        keywords: snapshot.sellerSpriteKeywords ?? currentData.sellerSpriteKeywords ?? buildSyntheticKeywordSeed(seed),
        competitors: snapshot.competitors ?? currentData.competitors ?? buildSyntheticCompetitors(seed),
      };
    case "listing.keyword.map":
      return {
        source: "Listing MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        keywordMap: buildKeywordMap(snapshot, seed),
      };
    case "listing.title.draft":
      return {
        source: "Listing MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        titleDraft: buildTitleDraft(snapshot, seed),
      };
    case "listing.bullet.draft":
      return {
        source: "Listing MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        bulletDrafts: buildBulletDrafts(snapshot, seed),
      };
    case "listing.description.draft":
      return {
        source: "Listing MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        descriptionDraft: buildDescriptionDraft(snapshot, seed),
      };
    case "listing.aplus.brief":
      return {
        source: "Listing MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        aplusBrief: buildAplusBrief(snapshot, seed),
      };
    case "listing.listing.draft":
      return {
        source: "Listing MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        listingDraft: buildListingDraft(snapshot, seed),
      };
    default:
      return {
        source: "Listing MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
      };
  }
}

function buildSyntheticKeywordSeed(seed: number) {
  return {
    source: "SellerSprite Keywords",
    primaryKeywords: [
      "amazon listing",
      "keyword map",
      "product title",
      "amazon bullets",
    ],
    secondaryKeywords: [
      "seo optimized",
      "conversion focused",
      "amazon copy",
    ],
    longTailKeywords: [
      "keyword rich amazon listing",
      "listing optimization draft",
    ],
    competitorGaps: [
      "Missing functional benefit emphasis",
      "Weak back-end keyword coverage",
    ],
    seed,
  };
}

function buildSyntheticCompetitors(seed: number) {
  return [
    {
      name: "Competitor A",
      weakness: "Generic title structure",
      opportunity: "Sharper keyword hierarchy",
      seed,
    },
    {
      name: "Competitor B",
      weakness: "Thin benefit story",
      opportunity: "Stronger conversion copy",
      seed,
    },
  ];
}

function buildKeywordMap(snapshot: JsonObject, seed: number): ListingKeywordMap {
  const productSummary = String(snapshot.productSummary ?? "product");
  const primaryKeywords = normalizeStringArray(
    isRecord(snapshot.sellerSpriteKeywords) && Array.isArray(snapshot.sellerSpriteKeywords.primaryKeywords)
      ? snapshot.sellerSpriteKeywords.primaryKeywords
      : ["amazon listing", productSummary, "keyword map"],
  );
  const secondaryKeywords = normalizeStringArray(
    isRecord(snapshot.sellerSpriteKeywords) && Array.isArray(snapshot.sellerSpriteKeywords.secondaryKeywords)
      ? snapshot.sellerSpriteKeywords.secondaryKeywords
      : ["seo optimized", "conversion focused"],
  );
  const longTailKeywords = normalizeStringArray(
    isRecord(snapshot.sellerSpriteKeywords) && Array.isArray(snapshot.sellerSpriteKeywords.longTailKeywords)
      ? snapshot.sellerSpriteKeywords.longTailKeywords
      : ["amazon copy", "listing optimization"],
  );
  const backendSearchTerms = normalizeStringArray([
    ...primaryKeywords.slice(0, 2),
    ...secondaryKeywords.slice(0, 2),
    `seed-${seed % 100}`,
  ]);
  const competitorGaps = Array.isArray(snapshot.competitors)
    ? normalizeStringArray(snapshot.competitors.flatMap((item) => (isRecord(item) ? [String(item.opportunity ?? item.weakness ?? "Listing gap")] : [])))
    : ["Keyword hierarchy", "Conversion focus"];

  return {
    primaryKeywords,
    secondaryKeywords,
    longTailKeywords,
    backendSearchTerms,
    competitorGaps,
    groups: [
      {
        placement: "title",
        keywords: primaryKeywords.slice(0, 5),
        intent: "High intent",
        rationale: "Put the strongest discovery terms in the title.",
      },
      {
        placement: "bullets",
        keywords: secondaryKeywords.slice(0, 5),
        intent: "Benefit intent",
        rationale: "Use bullets to surface buyer outcomes and conversion hooks.",
      },
      {
        placement: "description",
        keywords: longTailKeywords.slice(0, 5),
        intent: "Context intent",
        rationale: "Use description for supporting detail and long-tail coverage.",
      },
      {
        placement: "backend",
        keywords: backendSearchTerms,
        intent: "Indexing intent",
        rationale: "Reserve backend terms for hidden indexing coverage.",
      },
      {
        placement: "a-plus",
        keywords: competitorGaps.slice(0, 4),
        intent: "Positioning intent",
        rationale: "A+ should answer the competitor gaps and reinforce the product story.",
      },
    ],
    notes: "Keyword map built from product context, SellerSprite signals, and competitor gaps.",
  };
}

function buildTitleDraft(snapshot: JsonObject, seed: number): ListingTitleDraft {
  const keywordMap = extractKeywordMap(snapshot.keywordMap);
  const productSummary = String(snapshot.productSummary ?? "Amazon product");
  const core = keywordMap.primaryKeywords[0] ?? productSummary;
  const secondary = keywordMap.secondaryKeywords[0] ?? "optimized";
  const title = `${core} ${productSummary} - ${secondary} for Amazon`;

  return {
    title: trimToLength(title, 180),
    characterCount: trimToLength(title, 180).length,
    primaryKeywords: keywordMap.primaryKeywords.slice(0, 4),
    secondaryKeywords: keywordMap.secondaryKeywords.slice(0, 4),
    rationale: `Blend the primary discovery term with the product summary and secondary signal (seed ${seed % 100}).`,
  };
}

function buildBulletDrafts(snapshot: JsonObject, seed: number): ListingBulletDraft[] {
  const keywordMap = extractKeywordMap(snapshot.keywordMap);
  const productSummary = String(snapshot.productSummary ?? "product");
  const focus = keywordMap.secondaryKeywords.slice(0, 4);

  return [
    {
      bullet: `BUILT FOR ${productSummary.toUpperCase()}: ${focus[0] ?? "functional design"} helps buyers understand the core value fast.`,
      keywordFocus: [keywordMap.primaryKeywords[0] ?? productSummary, focus[0] ?? "value"],
      benefit: "Clarifies the main value proposition",
      evidenceNotes: ["Derived from product summary and competitor gap"],
    },
    {
      bullet: `${focus[1] ?? "Conversion focused"} design highlights the buyer outcome and improves click-to-cart confidence.`,
      keywordFocus: [focus[1] ?? "conversion", keywordMap.secondaryKeywords[1] ?? "benefit"],
      benefit: "Highlights the customer outcome",
      evidenceNotes: ["Aligned to keyword map and market language"],
    },
    {
      bullet: `Competitor gap coverage: ${keywordMap.competitorGaps[0] ?? "stronger positioning"} helps differentiate the listing.`,
      keywordFocus: [keywordMap.competitorGaps[0] ?? "differentiation"],
      benefit: "Addresses competitive weakness",
      evidenceNotes: ["Based on competitor gap synthesis"],
    },
    {
      bullet: `Amazon-ready detail and clear use case support long-tail search intent and purchase confidence.`,
      keywordFocus: keywordMap.longTailKeywords.slice(0, 3),
      benefit: "Supports conversion and indexing",
      evidenceNotes: [`Seed ${seed % 100}`],
    },
  ];
}

function buildDescriptionDraft(snapshot: JsonObject, seed: number): ListingDescriptionDraft {
  const keywordMap = extractKeywordMap(snapshot.keywordMap);
  const productSummary = String(snapshot.productSummary ?? "product");

  return {
    summary: `${productSummary} listing description`,
    paragraphs: [
      `${productSummary} is positioned for buyers who want a clear, practical solution with obvious value.`,
      `The copy emphasizes ${keywordMap.primaryKeywords[0] ?? "primary search intent"} and ${keywordMap.secondaryKeywords[0] ?? "buyer benefits"} while keeping the language natural.`,
      `Competitor gaps around ${keywordMap.competitorGaps[0] ?? "positioning"} are addressed in the feature story and call to action.`,
    ],
    keywordCoverage: [
      ...keywordMap.primaryKeywords.slice(0, 4),
      ...keywordMap.secondaryKeywords.slice(0, 4),
      `seed-${seed % 100}`,
    ],
    complianceNotes: [
      "Avoid unsupported claims.",
      "Keep formatting compatible with Amazon description rules.",
    ],
  };
}

function buildAplusBrief(snapshot: JsonObject, seed: number): ListingAplusBrief {
  const keywordMap = extractKeywordMap(snapshot.keywordMap);

  return {
    objective: "Create a concise A+ module set that reinforces the product story and conversion value.",
    modules: [
      {
        moduleName: "Hero Module",
        message: `Lead with ${keywordMap.primaryKeywords[0] ?? "the product promise"} and the core buyer outcome.`,
        layout: "Full-width hero with headline and supporting benefit bar",
        visualNotes: ["Use product lifestyle context", "Keep text short"],
      },
      {
        moduleName: "Benefit Module",
        message: `Explain how ${keywordMap.secondaryKeywords[0] ?? "the main benefit"} solves the buyer problem.`,
        layout: "Three column benefit grid",
        visualNotes: ["Show feature -> benefit mapping", "Highlight proof points"],
      },
      {
        moduleName: "Differentiation Module",
        message: `Answer competitor gap: ${keywordMap.competitorGaps[0] ?? "clear positioning"}.`,
        layout: "Comparison-led module",
        visualNotes: ["Use contrast callouts", "Keep copy evidence-based"],
      },
    ],
    imageStoryline: [
      "Hero lifestyle image",
      "Feature close-up",
      "Comparison proof image",
    ],
    recommendations: [
      "Keep the narrative buyer-first.",
      "Avoid crowded copy blocks.",
      `Tie imagery to the keyword story (seed ${seed % 100}).`,
    ],
  };
}

function buildListingDraft(snapshot: JsonObject, seed: number): ListingDraft {
  const keywordMap = extractKeywordMap(snapshot.keywordMap);
  const titleDraft = extractTitleDraft(snapshot.titleDraft);
  const bulletDrafts = extractBulletDrafts(snapshot.bulletDrafts);
  const descriptionDraft = extractDescriptionDraft(snapshot.descriptionDraft);
  const aplusBrief = extractAplusBrief(snapshot.aplusBrief);

  return {
    title: titleDraft.title,
    bullets: bulletDrafts.map((item) => item.bullet),
    description: descriptionDraft.paragraphs.join("\n\n"),
    backendSearchTerms: keywordMap.backendSearchTerms.join(", "),
    aplusBrief,
    keywordMap,
    complianceNotes: [
      "Verify product claims before publication.",
      "Review keyword density and policy compliance.",
      "Confirm bullet length and formatting are Amazon-safe.",
    ],
    recommendation: `Publish after human review and confirm keyword coverage plus competitor differentiation. Seed ${seed % 100}.`,
    confidence: clampScore(72 + (seed % 18)),
  };
}

function buildSummary(report: ProductDevelopmentReport | JsonObject | null) {
  const productSummary = isRecord(report) && typeof report.summary === "string" ? report.summary : "the selected product";
  return `${productSummary} can be turned into a listing draft with a keyword map, SEO title, bullets, description, and A+ brief.`;
}

function buildRecommendation(titleDraft: ListingTitleDraft, keywordMap: ListingKeywordMap) {
  return `Use ${titleDraft.primaryKeywords[0] ?? "the primary keyword"} in the title, cover ${keywordMap.competitorGaps[0] ?? "the main competitor gap"} in the bullets, then route the draft for human approval.`;
}

function summarizeProduct(
  report: ProductDevelopmentReport | JsonObject | null,
  marketReport: MarketResearchReport | JsonObject | null,
  productOpportunity: ProductOpportunity | JsonObject | null,
) {
  if (isRecord(report) && typeof report.summary === "string") return report.summary;
  if (isRecord(productOpportunity) && typeof productOpportunity.productIdea === "string") return productOpportunity.productIdea;
  if (isRecord(marketReport) && typeof marketReport.summary === "string") return marketReport.summary;
  return "No product context supplied.";
}

function readSummary(value: unknown) {
  return isRecord(value) && typeof value.summary === "string" ? value.summary : null;
}

function buildEvidence(input: {
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

function buildMemoryItems(input: {
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

function extractKeywordMap(value: JsonValue | undefined): ListingKeywordMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      primaryKeywords: [],
      secondaryKeywords: [],
      longTailKeywords: [],
      backendSearchTerms: [],
      competitorGaps: [],
      groups: [],
      notes: "Keyword map unavailable.",
    };
  }

  const record = value as Record<string, unknown>;
  const groups = Array.isArray(record.groups)
    ? record.groups.map((item) => {
        const group = isRecord(item) ? item : {};
        return {
          placement: normalizePlacement(group.placement),
          keywords: normalizeStringArray(group.keywords),
          intent: String(group.intent ?? "Intent"),
          rationale: String(group.rationale ?? "Rationale"),
        } satisfies ListingKeywordGroup;
      })
    : [];

  return {
    primaryKeywords: normalizeStringArray(record.primaryKeywords),
    secondaryKeywords: normalizeStringArray(record.secondaryKeywords),
    longTailKeywords: normalizeStringArray(record.longTailKeywords),
    backendSearchTerms: normalizeStringArray(record.backendSearchTerms),
    competitorGaps: normalizeStringArray(record.competitorGaps),
    groups,
    notes: String(record.notes ?? "Keyword map generated."),
  };
}

function extractTitleDraft(value: JsonValue | undefined): ListingTitleDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      title: "Listing Title",
      characterCount: 0,
      primaryKeywords: [],
      secondaryKeywords: [],
      rationale: "No title draft available.",
    };
  }

  const record = value as Record<string, unknown>;
  const title = String(record.title ?? "Listing Title");

  return {
    title,
    characterCount: title.length,
    primaryKeywords: normalizeStringArray(record.primaryKeywords),
    secondaryKeywords: normalizeStringArray(record.secondaryKeywords),
    rationale: String(record.rationale ?? "Title draft generated."),
  };
}

function extractBulletDrafts(value: JsonValue | undefined): ListingBulletDraft[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const bullets = Array.isArray(record.bulletDrafts) ? record.bulletDrafts : [];

  return bullets
    .map((item): ListingBulletDraft | null => {
      if (!isRecord(item)) return null;
      return {
        bullet: String(item.bullet ?? "Bullet"),
        keywordFocus: normalizeStringArray(item.keywordFocus),
        benefit: String(item.benefit ?? "Benefit"),
        evidenceNotes: normalizeStringArray(item.evidenceNotes),
      };
    })
    .filter((item): item is ListingBulletDraft => Boolean(item));
}

function extractDescriptionDraft(value: JsonValue | undefined): ListingDescriptionDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      summary: "Description",
      paragraphs: [],
      keywordCoverage: [],
      complianceNotes: [],
    };
  }

  const record = value as Record<string, unknown>;

  return {
    summary: String(record.summary ?? "Description"),
    paragraphs: normalizeStringArray(record.paragraphs),
    keywordCoverage: normalizeStringArray(record.keywordCoverage),
    complianceNotes: normalizeStringArray(record.complianceNotes),
  };
}

function extractAplusBrief(value: JsonValue | undefined): ListingAplusBrief {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      objective: "A+ brief",
      modules: [],
      imageStoryline: [],
      recommendations: [],
    };
  }

  const record = value as Record<string, unknown>;
  const modules = Array.isArray(record.modules)
    ? record.modules.map((item) => {
        const moduleRecord = isRecord(item) ? item : {};
        return {
          moduleName: String(moduleRecord.moduleName ?? "Module"),
          message: String(moduleRecord.message ?? "Message"),
          layout: String(moduleRecord.layout ?? "Layout"),
          visualNotes: normalizeStringArray(moduleRecord.visualNotes),
        };
      })
    : [];

  return {
    objective: String(record.objective ?? "A+ brief"),
    modules,
    imageStoryline: normalizeStringArray(record.imageStoryline),
    recommendations: normalizeStringArray(record.recommendations),
  };
}

function extractListingDraft(value: JsonValue | undefined, keywordMap: ListingKeywordMap, aplusBrief: ListingAplusBrief): ListingDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      title: "Listing Draft",
      bullets: [],
      description: "",
      backendSearchTerms: keywordMap.backendSearchTerms.join(", "),
      aplusBrief,
      keywordMap,
      complianceNotes: [],
      recommendation: "Draft listing for review",
      confidence: 70,
    };
  }

  const record = value as Record<string, unknown>;

  return {
    title: String(record.title ?? "Listing Draft"),
    bullets: normalizeStringArray(record.bullets),
    description: String(record.description ?? ""),
    backendSearchTerms: String(record.backendSearchTerms ?? keywordMap.backendSearchTerms.join(", ")),
    aplusBrief: extractAplusBrief(record.aplusBrief as JsonValue | undefined) || aplusBrief,
    keywordMap,
    complianceNotes: normalizeStringArray(record.complianceNotes),
    recommendation: String(record.recommendation ?? "Review listing draft"),
    confidence: typeof record.confidence === "number" ? clampScore(record.confidence) : 70,
  };
}

function extractOpportunity(value: unknown): ProductOpportunity | null {
  if (!isRecord(value)) return null;

  return {
    opportunityId: String(value.opportunityId ?? "opportunity"),
    productIdea: String(value.productIdea ?? value.summary ?? "product idea"),
    marketplace: String(value.marketplace ?? "US"),
    category: String(value.category ?? "general"),
    targetPrice: String(value.targetPrice ?? "$0.00"),
    estimatedDemand: typeof value.estimatedDemand === "number" ? value.estimatedDemand : 0,
    competitionScore: typeof value.competitionScore === "number" ? value.competitionScore : 0,
    reviewBarrier: typeof value.reviewBarrier === "number" ? value.reviewBarrier : 0,
    keywordOpportunity: typeof value.keywordOpportunity === "number" ? value.keywordOpportunity : 0,
    trendScore: typeof value.trendScore === "number" ? value.trendScore : 0,
    differentiationOpportunity: typeof value.differentiationOpportunity === "number" ? value.differentiationOpportunity : 0,
    estimatedMargin: typeof value.estimatedMargin === "number" ? value.estimatedMargin : 0,
    riskScore: typeof value.riskScore === "number" ? value.riskScore : 0,
    opportunityScore: typeof value.opportunityScore === "number" ? value.opportunityScore : 0,
    confidence: typeof value.confidence === "number" ? value.confidence : 0,
    evidence: Array.isArray(value.evidence) ? (value.evidence as ProductEvidenceItem[]) : [],
    recommendation: String(value.recommendation ?? "Opportunity"),
  };
}

function trimToLength(text: string, maxLength: number) {
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hashText(text: string) {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

function normalizePlacement(value: unknown): ListingKeywordGroup["placement"] {
  if (value === "title" || value === "bullets" || value === "description" || value === "backend" || value === "a-plus") {
    return value;
  }

  return "description";
}

function evidenceItem(input: {
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

function extractJsonObject(value: JsonValue | undefined): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonObject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
