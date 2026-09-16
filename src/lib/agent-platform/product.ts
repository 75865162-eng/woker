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
import type { MarketEvidenceItem, MarketResearchReport, ProductOpportunity } from "./market";

export type ProductRange = {
  min?: number;
  max?: number;
};

export type ProductEvidenceItem = MarketEvidenceItem;

export interface ProductPainPoint {
  painPoint: string;
  severity: number;
  evidence: ProductEvidenceItem[];
}

export interface ProductDifferentiationItem {
  angle: string;
  benefit: string;
  rationale: string;
  evidence: ProductEvidenceItem[];
}

export interface ProductPrdSection {
  summary: string;
  userProblem: string;
  targetCustomer: string;
  mustHave: string[];
  shouldHave: string[];
  acceptanceCriteria: string[];
  launchRisks: string[];
}

export interface ProductCostTarget {
  targetRetailPrice: string;
  targetLandedCost: string;
  maxLandedCost: string;
  targetMargin: number;
  rationale: string;
}

export interface ProductProjectDraft {
  projectName: string;
  objective: string;
  stages: Array<{
    name: string;
    goal: string;
    owner: string;
  }>;
  nextStep: string;
  risks: string[];
}

export interface ProductDevelopmentReport {
  goal: string;
  marketplace: string;
  category?: string;
  sourceOpportunity?: ProductOpportunity | null;
  sourceMarketReport?: MarketResearchReport | null;
  marketOpportunitySummary: string;
  competitorPainPoints: ProductPainPoint[];
  differentiation: ProductDifferentiationItem[];
  prd: ProductPrdSection;
  costTarget: ProductCostTarget;
  projectDraft: ProductProjectDraft;
  scores: {
    productReadiness: number;
    differentiation: number;
    costFit: number;
    executionConfidence: number;
  };
  evidence: ProductEvidenceItem[];
  summary: string;
  recommendation: string;
  generatedAt: string;
}

export interface ProductExecutionOutput {
  report: ProductDevelopmentReport;
  evidence: ProductEvidenceItem[];
  memoryItems?: AgentMemoryEntry[];
}

export interface ProductHandoffPayload {
  goal?: string;
  marketplace?: string;
  category?: string;
  productConstraints?: string[];
  marketOpportunity?: ProductOpportunity | null;
  marketReport?: MarketResearchReport | null;
}

export interface ProductExecutionRequest {
  naturalLanguageGoal?: string;
  marketplace?: string;
  category?: string;
  targetPrice?: ProductRange;
  targetCost?: ProductRange;
  targetMargin?: number;
  productConstraints?: string[] | string;
  marketOpportunity?: ProductOpportunity | null;
  marketReport?: MarketResearchReport | null;
  currentSkuContext?: JsonValue;
  context?: Record<string, unknown>;
}

const productToolAdapterId = "product-mcp-adapter";
export const productAgentId = "product";
export const productHandoffStorageKey = "amazon.agent-platform.product-handoff";

export const productAgentDefinition: AgentDefinition = {
  id: productAgentId,
  name: "Product Agent",
  description: "Transform market opportunities into PRD, cost targets, and product project drafts.",
  version: "v1.0.0",
  systemInstructions:
    "You are the Product Agent for an Amazon commerce OS. Turn validated market opportunities into product briefs, differentiation strategies, PRDs, cost targets, and project drafts. Stay evidence-driven, use only the Tool Gateway, and never claim supplier or cost certainty without supporting data.",
  goals: [
    "Turn market opportunities into product plans",
    "Identify competitor pain points",
    "Define product differentiation",
    "Draft PRD and cost targets",
    "Prepare product project handoff",
  ],
  skills: [
    "product strategy",
    "competitor pain point analysis",
    "differentiation design",
    "PRD drafting",
    "cost target planning",
    "project framing",
  ],
  tools: [
    "product.market.opportunity.load",
    "product.competitor.painpoints.scan",
    "product.differentiation.design",
    "product.prd.compose",
    "product.cost.target.estimate",
    "product.project.draft",
  ],
  permissions: [
    "product.read.marketOpportunity",
    "product.read.marketReport",
    "product.read.competitorPainPoints",
    "product.read.cost",
    "product.read.internalProduct",
    "product.write.brief",
    "product.write.prd",
    "product.write.costTarget",
    "product.write.projectDraft",
    "product.write.recommendation",
  ],
  inputSchema: {
    type: "object",
    properties: {
      naturalLanguageGoal: { type: "string" },
      marketplace: { type: "string" },
      category: { type: "string" },
      targetPrice: { type: "object" },
      targetCost: { type: "object" },
      targetMargin: { type: "number" },
      productConstraints: { type: "array" },
      marketOpportunity: { type: "object" },
      marketReport: { type: "object" },
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
    notes: "Drafting product plans is read-oriented. Project creation is approval-gated downstream.",
  },
  enabled: true,
};

export const productToolDefinitions: AgentToolDefinition[] = [
  {
    toolId: "product.market.opportunity.load",
    name: "Load Market Opportunity",
    description: "Normalize the selected market opportunity and source market report.",
    inputSchema: {
      type: "object",
      properties: {
        marketOpportunity: { type: "object" },
        marketReport: { type: "object" },
        marketplace: { type: "string" },
        category: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        marketOpportunity: { type: "object" },
        marketReport: { type: "object" },
        summary: { type: "string" },
      },
    },
    permission: ["product.read.marketOpportunity"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: productToolAdapterId,
    enabled: true,
  },
  {
    toolId: "product.competitor.painpoints.scan",
    name: "Competitor Pain Point Scan",
    description: "Extract competitor pain points and product complaints from the opportunity context.",
    inputSchema: {
      type: "object",
      properties: {
        marketOpportunity: { type: "object" },
        marketReport: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        painPoints: { type: "array" },
      },
    },
    permission: ["product.read.competitorPainPoints"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: productToolAdapterId,
    enabled: true,
  },
  {
    toolId: "product.differentiation.design",
    name: "Differentiation Design",
    description: "Generate differentiation angles and positioning for the product opportunity.",
    inputSchema: {
      type: "object",
      properties: {
        marketOpportunity: { type: "object" },
        painPoints: { type: "array" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        differentiation: { type: "array" },
        positioning: { type: "string" },
      },
    },
    permission: ["product.write.brief"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: productToolAdapterId,
    enabled: true,
  },
  {
    toolId: "product.prd.compose",
    name: "PRD Compose",
    description: "Compose a PRD skeleton from the market opportunity and differentiation strategy.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        marketOpportunity: { type: "object" },
        differentiation: { type: "array" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        prd: { type: "object" },
      },
    },
    permission: ["product.write.prd"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: productToolAdapterId,
    enabled: true,
  },
  {
    toolId: "product.cost.target.estimate",
    name: "Cost Target Estimate",
    description: "Estimate landed cost and cost targets for the product concept.",
    inputSchema: {
      type: "object",
      properties: {
        targetPrice: { type: "object" },
        targetMargin: { type: "number" },
        marketOpportunity: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        costTarget: { type: "object" },
      },
    },
    permission: ["product.read.cost"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: productToolAdapterId,
    enabled: true,
  },
  {
    toolId: "product.project.draft",
    name: "Product Project Draft",
    description: "Draft a product project plan and stage sequence for human review.",
    inputSchema: {
      type: "object",
      properties: {
        prd: { type: "object" },
        costTarget: { type: "object" },
        marketOpportunity: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        projectDraft: { type: "object" },
      },
    },
    permission: ["product.write.projectDraft"],
    riskLevel: "MEDIUM",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: productToolAdapterId,
    enabled: true,
  },
];

export const productEvaluationCases = [
  evaluationCase("product-case-01", "Normal handoff", {
    naturalLanguageGoal: "把 market opportunity 转成 PRD 和产品项目",
    marketplace: "US",
    marketOpportunity: {
      opportunityId: "opportunity-1",
      productIdea: "Adjustable desk organizer",
      marketplace: "US",
      category: "Home & Kitchen",
      targetPrice: "$29.99",
      estimatedDemand: 72,
      competitionScore: 44,
      reviewBarrier: 32,
      keywordOpportunity: 68,
      trendScore: 61,
      differentiationOpportunity: 70,
      estimatedMargin: 31,
      riskScore: 29,
      opportunityScore: 77,
      confidence: 0.84,
      evidence: [],
      recommendation: "Strong opportunity",
    } satisfies ProductOpportunity,
  }, {
    shouldDraftPRD: true,
    shouldEstimateCostTarget: true,
    shouldCreateProjectDraft: true,
  }),
  evaluationCase("product-case-02", "Only market report", {
    naturalLanguageGoal: "用市场报告来产出产品规划",
    marketplace: "US",
  }, {
    shouldInferFromMarketReport: true,
    shouldProduceReadablePlan: true,
  }),
  evaluationCase("product-case-03", "Fuzzy brief", {
    naturalLanguageGoal: "帮我把机会变成产品",
    marketplace: "US",
  }, {
    shouldHandleAmbiguousBrief: true,
  }),
  evaluationCase("product-case-04", "Missing market opportunity", {
    naturalLanguageGoal: "直接给我 PRD",
    marketplace: "US",
  }, {
    shouldFallbackGracefully: true,
  }),
  evaluationCase("product-case-05", "Cost sensitive", {
    naturalLanguageGoal: "控制成本的前提下做差异化",
    marketplace: "US",
    targetMargin: 35,
  }, {
    shouldEmphasizeCostTarget: true,
  }),
  evaluationCase("product-case-06", "Differentiation focus", {
    naturalLanguageGoal: "突出和竞品不同的设计",
    marketplace: "US",
  }, {
    shouldSurfaceDifferentiationAngles: true,
  }),
  evaluationCase("product-case-07", "Category specific", {
    naturalLanguageGoal: "做宠物用品产品规划",
    marketplace: "US",
    category: "Pet Supplies",
  }, {
    shouldRespectCategoryScope: true,
  }),
  evaluationCase("product-case-08", "Low confidence", {
    naturalLanguageGoal: "信息很少但先出个计划",
    marketplace: "US",
  }, {
    shouldMarkConfidenceLower: true,
  }),
  evaluationCase("product-case-09", "Project approval", {
    naturalLanguageGoal: "生成产品项目草案",
    marketplace: "US",
  }, {
    shouldCreateProjectDraft: true,
    shouldWaitForHumanReview: true,
  }),
  evaluationCase("product-case-10", "High risk category", {
    naturalLanguageGoal: "做高风险类目判断",
    marketplace: "US",
    category: "Supplements",
  }, {
    shouldIncreaseRiskAwareness: true,
  }),
  evaluationCase("product-case-11", "Non-US marketplace", {
    naturalLanguageGoal: "做英国站产品规划",
    marketplace: "UK",
  }, {
    shouldRespectMarketplaceScope: true,
  }),
  evaluationCase("product-case-12", "Imported market opportunity", {
    naturalLanguageGoal: "从 market agent 结果进入产品规划",
    marketplace: "US",
  }, {
    shouldUseMarketHandoff: true,
  }),
] satisfies Array<{ id: string; name: string; input: JsonValue; expectedBehavior: JsonValue; createdAt: string; updatedAt: string }>;

function evaluationCase(
  id: string,
  name: string,
  input: ProductExecutionRequest,
  expectedBehavior: Record<string, JsonValue>,
) {
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

export function createProductMcpAdapter(clock: () => Date = () => new Date()): AgentToolAdapter {
  return {
    adapterId: productToolAdapterId,
    async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
      const startedAt = clock().getTime();
      const output = toJsonValue(buildSyntheticProductOutput(input, clock));

      return {
        output,
        latencyMs: Math.max(clock().getTime() - startedAt, 1),
      };
    },
  };
}

export function createProductAgentExecutionExecutor(options: {
  request: ProductExecutionRequest;
  requestedByUserId?: string;
  clock?: () => Date;
}): AgentRuntimeExecutor {
  const clock = options.clock ?? (() => new Date());
  const normalizedInput = normalizeProductExecutionInput(options.request, {});

  return async ({ execution, definition, callTool, recordTrace, emitEvent }) => {
    const generatedAt = clock().toISOString();

    recordTrace(
      "decision",
      "Product brief parsed",
      toJsonValue({
        naturalLanguageGoal: normalizedInput.naturalLanguageGoal,
        marketplace: normalizedInput.marketplace,
        category: normalizedInput.category,
        targetMargin: normalizedInput.targetMargin ?? null,
        productConstraints: normalizedInput.productConstraints,
      }),
    );
    emitEvent("decision.made" as AgentEventName, {
      executionId: execution.id,
      summary: "Product brief parsed and plan sequence prepared.",
      marketplace: normalizedInput.marketplace,
    } as JsonValue);

    const marketOpportunityResult = await callTool(
      "product.market.opportunity.load",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        category: normalizedInput.category,
        marketOpportunity: normalizedInput.marketOpportunity,
        marketReport: normalizedInput.marketReport,
      }),
    );
    const marketOpportunitySnapshot = extractJsonObject(marketOpportunityResult.output);

    const painPointResult = await callTool(
      "product.competitor.painpoints.scan",
      toJsonValue({
        marketOpportunity: normalizedInput.marketOpportunity ?? marketOpportunitySnapshot.marketOpportunity,
        marketReport: normalizedInput.marketReport ?? marketOpportunitySnapshot.marketReport,
      }),
    );
    const painPoints = extractPainPoints(painPointResult.output);

    const differentiationResult = await callTool(
      "product.differentiation.design",
      toJsonValue({
        marketOpportunity: normalizedInput.marketOpportunity ?? marketOpportunitySnapshot.marketOpportunity,
        painPoints,
      }),
    );
    const differentiation = extractDifferentiationItems(differentiationResult.output);

    const prdResult = await callTool(
      "product.prd.compose",
      toJsonValue({
        goal: normalizedInput.naturalLanguageGoal,
        marketOpportunity: normalizedInput.marketOpportunity ?? marketOpportunitySnapshot.marketOpportunity,
        differentiation,
      }),
    );
    const prd = extractPrd(prdResult.output);
    const marketOpportunityRecord = isRecord(marketOpportunitySnapshot.marketOpportunity)
      ? marketOpportunitySnapshot.marketOpportunity
      : null;
    const marketOpportunityTargetPrice =
      marketOpportunityRecord && typeof marketOpportunityRecord.targetPrice !== "undefined"
        ? marketOpportunityRecord.targetPrice
        : null;

    const costTargetResult = await callTool(
      "product.cost.target.estimate",
      toJsonValue({
        targetPrice: normalizedInput.targetPrice ?? marketOpportunityTargetPrice ?? null,
        targetMargin: normalizedInput.targetMargin ?? normalizedInput.marketOpportunity?.estimatedMargin ?? 30,
        marketOpportunity: normalizedInput.marketOpportunity ?? marketOpportunitySnapshot.marketOpportunity,
      }),
    );
    const costTarget = extractCostTarget(costTargetResult.output, normalizedInput.targetMargin);

    const projectResult = await callTool(
      "product.project.draft",
      toJsonValue({
        prd,
        costTarget,
        marketOpportunity: normalizedInput.marketOpportunity ?? marketOpportunitySnapshot.marketOpportunity,
      }),
    );
    const projectDraft = extractProjectDraft(projectResult.output);

    const sourceOpportunity =
      normalizedInput.marketOpportunity ??
      (isRecord(marketOpportunitySnapshot.marketOpportunity)
        ? (marketOpportunitySnapshot.marketOpportunity as unknown as ProductOpportunity)
        : null);
    const sourceMarketReport =
      normalizedInput.marketReport ??
      (isRecord(marketOpportunitySnapshot.marketReport)
        ? (marketOpportunitySnapshot.marketReport as unknown as MarketResearchReport)
        : null);
    const summary = buildSummary(sourceOpportunity, prd, costTarget);
    const recommendation = buildRecommendation(costTarget, projectDraft, sourceOpportunity);
    const evidence = buildEvidence({
      marketOpportunityResult,
      painPointResult,
      differentiationResult,
      prdResult,
      costTargetResult,
      projectResult,
      generatedAt,
    });
    const report: ProductDevelopmentReport = {
      goal: normalizedInput.naturalLanguageGoal,
      marketplace: normalizedInput.marketplace,
      category: normalizedInput.category,
      sourceOpportunity,
      sourceMarketReport,
      marketOpportunitySummary: summarizeOpportunity(sourceOpportunity, sourceMarketReport),
      competitorPainPoints: painPoints,
      differentiation,
      prd,
      costTarget,
      projectDraft,
      scores: computeScores(sourceOpportunity, painPoints, differentiation, costTarget),
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

    recordTrace("recommendation", "Product plan drafted", report as unknown as JsonValue);
    emitEvent("recommendation.created", report as unknown as JsonValue);

    return {
      recommendation: {
        summary: report.recommendation,
        evidence: report.evidence,
        risks: report.projectDraft.risks,
        confidence: Math.max(0.55, report.scores.executionConfidence / 100),
        nextAction: "Review PRD and cost target before product project approval.",
      },
      decision: {
        summary: report.summary,
        rationale: "Product planning is complete and ready for human review.",
        confidence: Math.max(0.55, report.scores.executionConfidence / 100),
        nextStep: "Review project draft and prepare approval-gated handoff",
      },
      output: toJsonValue({
        report,
        evidence,
      }),
      tokenUsage: 140,
      costCents: 0,
      memoryItems,
    };
  };
}

function normalizeProductExecutionInput(request: ProductExecutionRequest, context: Record<string, unknown>) {
  const currentData = isRecord(context.currentData) ? context.currentData : {};
  const productOpportunity = extractJsonObject(toJsonValue(request.marketOpportunity ?? currentData.marketOpportunity));
  const productReport = extractJsonObject(toJsonValue(request.marketReport ?? currentData.marketReport));

  return {
    naturalLanguageGoal: String(request.naturalLanguageGoal ?? currentData.goal ?? productOpportunity.productIdea ?? "Turn the market opportunity into a product plan."),
    marketplace: String(request.marketplace ?? productReport.marketplace ?? productOpportunity.marketplace ?? currentData.marketplace ?? context.marketplace ?? "US"),
    category: String(request.category ?? productOpportunity.category ?? productReport.category ?? currentData.category ?? "general"),
    marketOpportunity: Object.keys(productOpportunity).length ? (productOpportunity as unknown as ProductOpportunity) : null,
    marketReport: Object.keys(productReport).length ? (productReport as unknown as MarketResearchReport) : null,
    targetPrice: normalizeRange(request.targetPrice),
    targetCost: normalizeRange(request.targetCost),
    targetMargin: typeof request.targetMargin === "number" ? request.targetMargin : undefined,
    productConstraints: normalizeStringArray(request.productConstraints ?? currentData.productConstraints),
    currentSkuContext: request.currentSkuContext ?? currentData ?? null,
  };
}

function buildSyntheticProductOutput(input: ToolExecutionInput, clock: () => Date) {
  const snapshot = extractJsonObject(input.input);
  const context = input.context ?? {};
  const currentData = isRecord(context.currentData) ? context.currentData : {};
  const seed = hashText(JSON.stringify({
    toolId: input.toolId,
    marketplace: String(snapshot.marketplace ?? context.marketplace ?? "US"),
    category: String(snapshot.category ?? currentData.category ?? "general"),
    opportunity: snapshot.marketOpportunity ?? currentData.marketOpportunity ?? null,
    report: snapshot.marketReport ?? currentData.marketReport ?? null,
  }));
  const now = clock().toISOString();

  switch (input.toolId) {
    case "product.market.opportunity.load":
      return {
        source: "Product MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        marketplace: String(snapshot.marketplace ?? context.marketplace ?? "US"),
        category: String(snapshot.category ?? currentData.category ?? "general"),
        marketOpportunity: snapshot.marketOpportunity ?? currentData.marketOpportunity ?? null,
        marketReport: snapshot.marketReport ?? currentData.marketReport ?? null,
        summary: buildOpportunitySummary(snapshot.marketOpportunity ?? currentData.marketOpportunity ?? null, snapshot.marketReport ?? currentData.marketReport ?? null),
      };
    case "product.competitor.painpoints.scan":
      return {
        source: "Product MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        painPoints: buildPainPoints(seed),
      };
    case "product.differentiation.design":
      return {
        source: "Product MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        differentiation: buildDifferentiation(),
        positioning: buildPositioning(seed),
      };
    case "product.prd.compose":
      return {
        source: "Product MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        prd: buildPrd(snapshot),
      };
    case "product.cost.target.estimate":
      return {
        source: "Product MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        costTarget: buildCostTarget(snapshot, seed),
      };
    case "product.project.draft":
      return {
        source: "Product MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        projectDraft: buildProjectDraft(snapshot),
      };
    default:
      return {
        source: "Product MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
      };
  }
}

function buildPainPoints(seed: number): ProductPainPoint[] {
  const points = [
    "Packaging does not solve the core use case clearly.",
    "Review feedback repeatedly mentions durability or fit issues.",
    "Product copy fails to explain the differentiated workflow.",
    "Accessory set is incomplete compared with buyer expectations.",
  ];

  return points.slice(0, 3).map((painPoint, index) => ({
    painPoint,
    severity: clampScore(48 + ((seed >> (index * 3)) % 30)),
    evidence: [
      evidenceItem({
        claim: painPoint,
        dataSource: "Product MCP Adapter",
        toolId: "product.competitor.painpoints.scan",
        metric: "pain-point",
        value: painPoint,
      }),
    ],
  }));
}

function buildDifferentiation(): ProductDifferentiationItem[] {
  const angles = [
    {
      angle: "Better first-use experience",
      benefit: "Lower setup friction and faster perceived value.",
      rationale: "Reduces early churn and supports stronger review quality.",
    },
    {
      angle: "Quality-led packaging and materials",
      benefit: "Improves trust and reduces complaint rate.",
      rationale: "Useful when the category shows durability pain points.",
    },
    {
      angle: "Bundled workflow or accessory completeness",
      benefit: "Makes the listing feel more complete and harder to compare on price alone.",
      rationale: "Strengthens the moat against generic competitors.",
    },
  ];

  return angles.map((item) => ({
    ...item,
    evidence: [
      evidenceItem({
        claim: item.angle,
        dataSource: "Product MCP Adapter",
        toolId: "product.differentiation.design",
        metric: "differentiation-angle",
        value: item.benefit,
      }),
    ],
  }));
}

function buildPositioning(seed: number) {
  const variants = [
    "Position the product around convenience and faster first use.",
    "Position the product around durable quality and clearer problem solving.",
    "Position the product around a bundled workflow that reduces buyer friction.",
  ];

  return variants[seed % variants.length];
}

function buildPrd(snapshot: JsonObject): ProductPrdSection {
  const productName = String(
    snapshot.marketOpportunity && isRecord(snapshot.marketOpportunity) && typeof snapshot.marketOpportunity.productIdea === "string"
      ? snapshot.marketOpportunity.productIdea
      : "new product concept",
  );

  return {
    summary: `PRD for ${productName}.`,
    userProblem: "Buyers need a clearer, more reliable, and less frustrating solution than current market offerings.",
    targetCustomer: "Amazon buyers who care about convenience, durability, and value.",
    mustHave: [
      "Core use case solved in first use",
      "Packaging and instructions that reduce confusion",
      "Feature set aligned with market pain points",
    ],
    shouldHave: [
      "Accessory bundle or upgrade path",
      "Improved unboxing and insert experience",
      "Launch copy that explains the differentiation",
    ],
    acceptanceCriteria: [
      "Product concept maps to a specific market opportunity",
      "Cost target supports the desired margin",
      "Differentiation is clear enough to explain in one sentence",
    ],
    launchRisks: [
      "Supplier variance may raise landed cost",
      "Feature creep may erode margin",
      "Differentiation may be too subtle for marketplace buyers",
    ],
  };
}

function buildCostTarget(snapshot: JsonObject, seed: number): ProductCostTarget {
  const targetRetailPrice = moneyString(guessPrice(snapshot, seed));
  const targetMargin = typeof snapshot.targetMargin === "number" ? clampScore(snapshot.targetMargin) : 30;
  const targetLanded = clampDecimal((guessPrice(snapshot, seed) * (100 - targetMargin)) / 100);

  return {
    targetRetailPrice,
    targetLandedCost: moneyString(targetLanded),
    maxLandedCost: moneyString(clampDecimal(targetLanded * 1.08)),
    targetMargin,
    rationale: "Keep landed cost low enough to protect margin while leaving room for packaging, freight, and launch spend.",
  };
}

function buildProjectDraft(snapshot: JsonObject): ProductProjectDraft {
  const productName = String(
    snapshot.marketOpportunity && isRecord(snapshot.marketOpportunity) && typeof snapshot.marketOpportunity.productIdea === "string"
      ? snapshot.marketOpportunity.productIdea
      : "product concept",
  );

  return {
    projectName: `${productName} Product Project`,
    objective: "Turn the selected market opportunity into an approved PRD and cost target.",
    stages: [
      { name: "Opportunity Review", goal: "Confirm market fit and scope", owner: "Product" },
      { name: "PRD Draft", goal: "Translate pain points into product requirements", owner: "Product" },
      { name: "Cost Alignment", goal: "Lock landed cost and margin target", owner: "Supply Chain" },
      { name: "Approval Handoff", goal: "Move into human review and project approval", owner: "Operations" },
    ],
    nextStep: "Review PRD, cost target, and risk notes before approval.",
    risks: [
      "Cost assumptions may shift after supplier RFQ",
      "Market differentiation can weaken if requirements are underdefined",
      "Launch scope may need adjustment after human review",
    ],
  };
}

function computeScores(
  opportunity: ProductOpportunity | null,
  painPoints: ProductPainPoint[],
  differentiation: ProductDifferentiationItem[],
  costTarget: ProductCostTarget,
) {
  const opportunityScore = opportunity?.opportunityScore ?? 62;
  const painDepth = clampScore(Math.round(painPoints.reduce((sum, item) => sum + item.severity, 0) / Math.max(1, painPoints.length)));
  const differentiationScore = clampScore(Math.round(differentiation.reduce((sum, item) => sum + item.evidence.length * 10, 0) / Math.max(1, differentiation.length)) + 40);
  const costFit = clampScore(Math.max(40, 100 - Math.abs(costTarget.targetMargin - 30) * 2));
  const productReadiness = clampScore(Math.round(opportunityScore * 0.35 + painDepth * 0.2 + differentiationScore * 0.25 + costFit * 0.2));

  return {
    productReadiness,
    differentiation: differentiationScore,
    costFit,
    executionConfidence: clampScore(Math.round(productReadiness * 0.9)),
  };
}

function buildEvidence(input: {
  marketOpportunityResult: { output?: JsonValue; toolCall?: { id?: string } };
  painPointResult: { output?: JsonValue; toolCall?: { id?: string } };
  differentiationResult: { output?: JsonValue; toolCall?: { id?: string } };
  prdResult: { output?: JsonValue; toolCall?: { id?: string } };
  costTargetResult: { output?: JsonValue; toolCall?: { id?: string } };
  projectResult: { output?: JsonValue; toolCall?: { id?: string } };
  generatedAt: string;
}): ProductEvidenceItem[] {
  return [
    evidenceItem({
      claim: "Market opportunity normalized",
      dataSource: "Product MCP Adapter",
      toolId: "product.market.opportunity.load",
      toolCallId: input.marketOpportunityResult.toolCall?.id,
      metric: "market-opportunity",
      value: input.marketOpportunityResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Competitor pain points extracted",
      dataSource: "Product MCP Adapter",
      toolId: "product.competitor.painpoints.scan",
      toolCallId: input.painPointResult.toolCall?.id,
      metric: "pain-points",
      value: input.painPointResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Differentiation strategy designed",
      dataSource: "Product MCP Adapter",
      toolId: "product.differentiation.design",
      toolCallId: input.differentiationResult.toolCall?.id,
      metric: "differentiation",
      value: input.differentiationResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "PRD drafted",
      dataSource: "Product MCP Adapter",
      toolId: "product.prd.compose",
      toolCallId: input.prdResult.toolCall?.id,
      metric: "prd",
      value: input.prdResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Cost target estimated",
      dataSource: "Product MCP Adapter",
      toolId: "product.cost.target.estimate",
      toolCallId: input.costTargetResult.toolCall?.id,
      metric: "cost-target",
      value: input.costTargetResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Project draft prepared",
      dataSource: "Product MCP Adapter",
      toolId: "product.project.draft",
      toolCallId: input.projectResult.toolCall?.id,
      metric: "project-draft",
      value: input.projectResult.output ?? null,
      timestamp: input.generatedAt,
    }),
  ];
}

function buildMemoryItems(input: {
  execution: { id: string; agentDefinitionId: string };
  definition: AgentDefinition;
  report: ProductDevelopmentReport;
  generatedAt: string;
  requestedByUserId?: string;
}): AgentMemoryEntry[] {
  const scopeKey = `${input.report.marketplace}:${input.report.category ?? input.report.sourceOpportunity?.category ?? "product"}:${input.report.sourceOpportunity?.opportunityId ?? input.execution.id}`;

  return [
    {
      id: `memory-${input.execution.id}-brief`,
      agentDefinitionId: input.definition.id,
      scope: "product-brief",
      scopeKey,
      summary: `${input.report.projectDraft.projectName} drafted with readiness ${input.report.scores.productReadiness}/100.`,
      data: toJsonValue({
        report: input.report,
        requestedByUserId: input.requestedByUserId ?? null,
      }),
      sourceExecutionId: input.execution.id,
      confidence: Math.max(0.55, input.report.scores.executionConfidence / 100),
      createdAt: input.generatedAt,
      updatedAt: input.generatedAt,
    },
    {
      id: `memory-${input.execution.id}-prd`,
      agentDefinitionId: input.definition.id,
      scope: "product-prd",
      scopeKey,
      summary: `PRD drafted for ${input.report.sourceOpportunity?.productIdea ?? "product concept"}.`,
      data: toJsonValue({
        prd: input.report.prd,
        costTarget: input.report.costTarget,
        projectDraft: input.report.projectDraft,
      }),
      sourceExecutionId: input.execution.id,
      confidence: Math.max(0.55, input.report.scores.executionConfidence / 100),
      createdAt: input.generatedAt,
      updatedAt: input.generatedAt,
    },
  ];
}

function buildSummary(opportunity: ProductOpportunity | null, prd: ProductPrdSection, costTarget: ProductCostTarget) {
  const productName = opportunity?.productIdea ?? "the selected product";
  return `${productName} can be translated into a PRD with ${prd.mustHave.length} must-have items and a target landed cost of ${costTarget.targetLandedCost}.`;
}

function buildRecommendation(costTarget: ProductCostTarget, projectDraft: ProductProjectDraft, opportunity: ProductOpportunity | null) {
  return `Advance ${opportunity?.productIdea ?? "the product concept"} into project review only if the cost target remains within ${costTarget.maxLandedCost} and the differentiation story stays clear.`;
}

function summarizeOpportunity(opportunity: ProductOpportunity | null, report: MarketResearchReport | null) {
  if (!opportunity) {
    return report ? `${report.marketplace} market report available but no selected opportunity was supplied.` : "No market opportunity supplied.";
  }

  return `${opportunity.productIdea} scored ${opportunity.opportunityScore}/100 with estimated margin ${opportunity.estimatedMargin}%.`;
}

function extractPainPoints(value: JsonValue | undefined): ProductPainPoint[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const points = Array.isArray(record.painPoints) ? record.painPoints : [];

  return points
    .map((item): ProductPainPoint | null => {
      if (!isRecord(item)) return null;
      return {
        painPoint: String(item.painPoint ?? item.title ?? "Competitor pain point"),
        severity: clampScore(typeof item.severity === "number" ? item.severity : 50),
        evidence: Array.isArray(item.evidence) ? (item.evidence as ProductEvidenceItem[]) : [],
      };
    })
    .filter((item): item is ProductPainPoint => Boolean(item));
}

function extractDifferentiationItems(value: JsonValue | undefined): ProductDifferentiationItem[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.differentiation) ? record.differentiation : [];

  return items
    .map((item): ProductDifferentiationItem | null => {
      if (!isRecord(item)) return null;
      return {
        angle: String(item.angle ?? "Differentiation angle"),
        benefit: String(item.benefit ?? "Improves product fit"),
        rationale: String(item.rationale ?? "Supports product planning"),
        evidence: Array.isArray(item.evidence) ? (item.evidence as ProductEvidenceItem[]) : [],
      };
    })
    .filter((item): item is ProductDifferentiationItem => Boolean(item));
}

function extractPrd(value: JsonValue | undefined): ProductPrdSection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
  return buildPrd({});
  }

  const record = value as Record<string, unknown>;

  return {
    summary: String(record.summary ?? "PRD draft"),
    userProblem: String(record.userProblem ?? "Product problem statement"),
    targetCustomer: String(record.targetCustomer ?? "Amazon buyers"),
    mustHave: normalizeStringArray(record.mustHave),
    shouldHave: normalizeStringArray(record.shouldHave),
    acceptanceCriteria: normalizeStringArray(record.acceptanceCriteria),
    launchRisks: normalizeStringArray(record.launchRisks),
  };
}

function extractCostTarget(value: JsonValue | undefined, targetMargin?: number): ProductCostTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return buildCostTarget({}, 0);
  }

  const record = value as Record<string, unknown>;

  return {
    targetRetailPrice: String(record.targetRetailPrice ?? "$29.99"),
    targetLandedCost: String(record.targetLandedCost ?? "$12.00"),
    maxLandedCost: String(record.maxLandedCost ?? "$14.00"),
    targetMargin: typeof record.targetMargin === "number" ? record.targetMargin : targetMargin ?? 30,
    rationale: String(record.rationale ?? "Cost target estimated"),
  };
}

function extractProjectDraft(value: JsonValue | undefined): ProductProjectDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return buildProjectDraft({});
  }

  const record = value as Record<string, unknown>;

  return {
    projectName: String(record.projectName ?? "Product Project"),
    objective: String(record.objective ?? "Draft product project"),
    stages: Array.isArray(record.stages)
      ? (record.stages as unknown[]).map((item) => {
          const stage = isRecord(item) ? item : {};
          return {
            name: String(stage.name ?? "Stage"),
            goal: String(stage.goal ?? "Define stage goal"),
            owner: String(stage.owner ?? "Product"),
          };
        })
      : [],
    nextStep: String(record.nextStep ?? "Review project draft"),
    risks: normalizeStringArray(record.risks),
  };
}

function buildOpportunitySummary(opportunity: unknown, report: unknown) {
  const normalizedOpportunity = isProductOpportunity(opportunity) ? opportunity : null;
  const normalizedReport = isMarketResearchReport(report) ? report : null;

  if (normalizedOpportunity) {
    return `${normalizedOpportunity.productIdea} in ${normalizedOpportunity.marketplace} / ${normalizedOpportunity.category}.`;
  }

  if (normalizedReport) {
    return `${normalizedReport.marketplace} / ${normalizedReport.category ?? normalizedReport.keyword ?? "market"} market report.`;
  }

  return "No market opportunity supplied.";
}

function isProductOpportunity(value: unknown): value is ProductOpportunity {
  return isRecord(value) && typeof value.opportunityId === "string" && typeof value.productIdea === "string" && typeof value.marketplace === "string";
}

function isMarketResearchReport(value: unknown): value is MarketResearchReport {
  return isRecord(value) && typeof value.marketplace === "string" && Array.isArray(value.productOpportunities);
}

function normalizeRange(value: ProductRange | undefined | null): ProductRange | undefined {
  if (!value) return undefined;
  const min = typeof value.min === "number" && Number.isFinite(value.min) ? value.min : undefined;
  const max = typeof value.max === "number" && Number.isFinite(value.max) ? value.max : undefined;
  if (min === undefined && max === undefined) return undefined;
  return { min, max };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

function guessPrice(snapshot: JsonObject, seed: number) {
  const value = snapshot.targetPrice;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const base = 18 + (seed % 12);
  return clampDecimal(base + ((seed >> 4) % 10) * 0.5);
}

function moneyString(value: number) {
  return `$${clampDecimal(value).toFixed(2)}`;
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

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampDecimal(value: number) {
  return Math.round(value * 100) / 100;
}

function hashText(text: string) {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
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
