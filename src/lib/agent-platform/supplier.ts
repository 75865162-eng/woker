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
import type { ProductDevelopmentReport, ProductEvidenceItem, ProductHandoffPayload, ProductPrdSection } from "./product";

export interface SupplierQuotation {
  supplierId: string;
  supplierName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  moq: string;
  unitPrice: string;
  shippingEstimate: string;
  leadTime: string;
  sampleCost: string;
  notes: string;
  score: number;
}

export interface SupplierRecommendation {
  supplierId: string;
  supplierName: string;
  summary: string;
  strengths: string[];
  risks: string[];
  confidence: number;
}

export interface SupplierRfQSection {
  subject: string;
  objective: string;
  productSummary: string;
  requiredCapabilities: string[];
  targetPrice: string;
  targetLeadTime: string;
  questions: string[];
}

export interface SupplierAnalysisReport {
  goal: string;
  marketplace: string;
  category?: string;
  productSummary: string;
  supplierRecommendations: SupplierRecommendation[];
  quotationAnalysis: SupplierQuotation[];
  rfqDraft: SupplierRfQSection;
  supplierProjectDraft: {
    projectName: string;
    objective: string;
    stages: Array<{
      name: string;
      goal: string;
      owner: string;
    }>;
    nextStep: string;
    risks: string[];
  };
  evidence: ProductEvidenceItem[];
  summary: string;
  recommendation: string;
  generatedAt: string;
}

export interface SupplierExecutionOutput {
  report: SupplierAnalysisReport;
  evidence: ProductEvidenceItem[];
  memoryItems?: AgentMemoryEntry[];
}

export interface SupplierExecutionRequest {
  naturalLanguageGoal?: string;
  marketplace?: string;
  category?: string;
  prd?: ProductPrdSection | null;
  productReport?: ProductDevelopmentReport | null;
  productHandoff?: ProductHandoffPayload | null;
  currentSkuContext?: JsonValue;
  context?: Record<string, unknown>;
}

export const supplierAgentId = "supplier";
const supplierToolAdapterId = "supplier-mcp-adapter";
export const supplierHandoffStorageKey = "amazon.agent-platform.supplier-handoff";

export const supplierAgentDefinition: AgentDefinition = {
  id: supplierAgentId,
  name: "Supplier Agent",
  description: "Evaluate suppliers, draft RFQs, and turn product plans into sourcing-ready actions.",
  version: "v1.0.0",
  systemInstructions:
    "You are the Supplier Agent for an Amazon commerce OS. Turn a validated product plan into supplier recommendations, quotation analysis, and RFQ drafts. Use the Tool Gateway only. Do not claim live supplier certainty when the evidence is synthetic or incomplete.",
  goals: [
    "Find suitable suppliers",
    "Analyze quotation history",
    "Draft RFQ requests",
    "Recommend supplier candidates",
    "Prepare sourcing project handoff",
  ],
  skills: [
    "supplier evaluation",
    "quotation analysis",
    "RFQ drafting",
    "lead time analysis",
    "sourcing project planning",
  ],
  tools: [
    "supplier.product.load",
    "supplier.database.search",
    "supplier.quotation.analyze",
    "supplier.recommendation.compose",
    "supplier.rfq.draft",
    "supplier.project.draft",
  ],
  permissions: [
    "supplier.read.product",
    "supplier.read.prd",
    "supplier.read.supplierDatabase",
    "supplier.read.quotation",
    "supplier.write.recommendation",
    "supplier.write.rfq",
    "supplier.write.projectDraft",
  ],
  inputSchema: {
    type: "object",
    properties: {
      naturalLanguageGoal: { type: "string" },
      marketplace: { type: "string" },
      category: { type: "string" },
      prd: { type: "object" },
      productReport: { type: "object" },
      productHandoff: { type: "object" },
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
    notes: "Sourcing drafts are read-oriented; project creation is approval-gated downstream.",
  },
  enabled: true,
};

export const supplierToolDefinitions: AgentToolDefinition[] = [
  {
    toolId: "supplier.product.load",
    name: "Load Product Context",
    description: "Normalize the selected PRD and product report into sourcing context.",
    inputSchema: {
      type: "object",
      properties: {
        prd: { type: "object" },
        productReport: { type: "object" },
        productHandoff: { type: "object" },
        marketplace: { type: "string" },
        category: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        prd: { type: "object" },
        productReport: { type: "object" },
        summary: { type: "string" },
      },
    },
    permission: ["supplier.read.product"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: supplierToolAdapterId,
    enabled: true,
  },
  {
    toolId: "supplier.database.search",
    name: "Supplier Database Search",
    description: "Search a synthetic supplier database for candidate factories and sourcing matches.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        category: { type: "string" },
        prd: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        suppliers: { type: "array" },
      },
    },
    permission: ["supplier.read.supplierDatabase"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: supplierToolAdapterId,
    enabled: true,
  },
  {
    toolId: "supplier.quotation.analyze",
    name: "Quotation Analyze",
    description: "Analyze historical quotation patterns and landing cost implications.",
    inputSchema: {
      type: "object",
      properties: {
        suppliers: { type: "array" },
        prd: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        quotations: { type: "array" },
      },
    },
    permission: ["supplier.read.quotation"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: supplierToolAdapterId,
    enabled: true,
  },
  {
    toolId: "supplier.recommendation.compose",
    name: "Supplier Recommendation",
    description: "Compose a supplier recommendation from database and quotation signals.",
    inputSchema: {
      type: "object",
      properties: {
        suppliers: { type: "array" },
        quotations: { type: "array" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        recommendations: { type: "array" },
      },
    },
    permission: ["supplier.write.recommendation"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: supplierToolAdapterId,
    enabled: true,
  },
  {
    toolId: "supplier.rfq.draft",
    name: "RFQ Draft",
    description: "Draft an RFQ for shortlisted suppliers.",
    inputSchema: {
      type: "object",
      properties: {
        recommendations: { type: "array" },
        prd: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        rfqDraft: { type: "object" },
      },
    },
    permission: ["supplier.write.rfq"],
    riskLevel: "MEDIUM",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: supplierToolAdapterId,
    enabled: true,
  },
  {
    toolId: "supplier.project.draft",
    name: "Supplier Project Draft",
    description: "Draft a sourcing project plan for human review.",
    inputSchema: {
      type: "object",
      properties: {
        rfqDraft: { type: "object" },
        recommendations: { type: "array" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        projectDraft: { type: "object" },
      },
    },
    permission: ["supplier.write.projectDraft"],
    riskLevel: "MEDIUM",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: supplierToolAdapterId,
    enabled: true,
  },
];

export const supplierEvaluationCases = [
  evaluationCase("supplier-case-01", "Normal handoff", {
    naturalLanguageGoal: "把 PRD 转成供应商推荐和 RFQ 草稿",
    marketplace: "US",
  }, {
    shouldLoadProductContext: true,
    shouldRecommendSuppliers: true,
    shouldDraftRFQ: true,
  }),
  evaluationCase("supplier-case-02", "Missing PRD", {
    naturalLanguageGoal: "我还没有 PRD",
    marketplace: "US",
  }, {
    shouldFallbackGracefully: true,
  }),
  evaluationCase("supplier-case-03", "Fuzzy brief", {
    naturalLanguageGoal: "帮我找靠谱工厂",
    marketplace: "US",
  }, {
    shouldInferSourcingIntent: true,
  }),
  evaluationCase("supplier-case-04", "Cost pressure", {
    naturalLanguageGoal: "尽量压低成本",
    marketplace: "US",
  }, {
    shouldEmphasizeCostTradeoff: true,
  }),
  evaluationCase("supplier-case-05", "Lead time pressure", {
    naturalLanguageGoal: "交期越短越好",
    marketplace: "US",
  }, {
    shouldEmphasizeLeadTime: true,
  }),
  evaluationCase("supplier-case-06", "Category specific", {
    naturalLanguageGoal: "做宠物用品供应商分析",
    marketplace: "US",
    category: "Pet Supplies",
  }, {
    shouldRespectCategoryScope: true,
  }),
  evaluationCase("supplier-case-07", "Quotation comparison", {
    naturalLanguageGoal: "比较报价差异",
    marketplace: "US",
  }, {
    shouldCompareQuotations: true,
  }),
  evaluationCase("supplier-case-08", "Low confidence", {
    naturalLanguageGoal: "信息不多先给推荐",
    marketplace: "US",
  }, {
    shouldLowerConfidence: true,
  }),
  evaluationCase("supplier-case-09", "Project approval", {
    naturalLanguageGoal: "生成供应项目草案",
    marketplace: "US",
  }, {
    shouldCreateProjectDraft: true,
    shouldWaitForHumanReview: true,
  }),
  evaluationCase("supplier-case-10", "Non-US marketplace", {
    naturalLanguageGoal: "做英国站供应商分析",
    marketplace: "UK",
  }, {
    shouldRespectMarketplaceScope: true,
  }),
];

function evaluationCase(
  id: string,
  name: string,
  input: SupplierExecutionRequest,
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

export function createSupplierMcpAdapter(clock: () => Date = () => new Date()): AgentToolAdapter {
  return {
    adapterId: supplierToolAdapterId,
    async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
      const startedAt = clock().getTime();
      const output = toJsonValue(buildSyntheticSupplierOutput(input, clock));

      return {
        output,
        latencyMs: Math.max(clock().getTime() - startedAt, 1),
      };
    },
  };
}

export function createSupplierAgentExecutionExecutor(options: {
  request: SupplierExecutionRequest;
  requestedByUserId?: string;
  clock?: () => Date;
}): AgentRuntimeExecutor {
  const clock = options.clock ?? (() => new Date());
  const normalizedInput = normalizeSupplierExecutionInput(options.request, {});

  return async ({ execution, definition, callTool, recordTrace, emitEvent }) => {
    const generatedAt = clock().toISOString();

    recordTrace(
      "decision",
      "Supplier brief parsed",
      toJsonValue({
        naturalLanguageGoal: normalizedInput.naturalLanguageGoal,
        marketplace: normalizedInput.marketplace,
        category: normalizedInput.category,
      }),
    );
    emitEvent("decision.made" as AgentEventName, {
      executionId: execution.id,
      summary: "Supplier brief parsed and sourcing workflow prepared.",
      marketplace: normalizedInput.marketplace,
    } as JsonValue);

    const productLoadResult = await callTool(
      "supplier.product.load",
      toJsonValue({
        prd: normalizedInput.prd,
        productReport: normalizedInput.productReport,
        productHandoff: normalizedInput.productHandoff,
        marketplace: normalizedInput.marketplace,
        category: normalizedInput.category,
      }),
    );
    const productContext = extractJsonObject(productLoadResult.output);

    const supplierSearchResult = await callTool(
      "supplier.database.search",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        category: normalizedInput.category,
        prd: normalizedInput.prd ?? productContext.prd,
      }),
    );
    const suppliers = extractSupplierRecommendations(supplierSearchResult.output);

    const quotationResult = await callTool(
      "supplier.quotation.analyze",
      toJsonValue({
        suppliers,
        prd: normalizedInput.prd ?? productContext.prd,
      }),
    );
    const quotations = extractSupplierQuotations(quotationResult.output);

    const recommendationResult = await callTool(
      "supplier.recommendation.compose",
      toJsonValue({
        suppliers,
        quotations,
      }),
    );
    const recommendations = extractSupplierRecommendationItems(recommendationResult.output, suppliers, quotations);

    const rfqResult = await callTool(
      "supplier.rfq.draft",
      toJsonValue({
        recommendations,
        prd: normalizedInput.prd ?? productContext.prd,
      }),
    );
    const rfqDraft = extractRfQSection(rfqResult.output);

    const projectResult = await callTool(
      "supplier.project.draft",
      toJsonValue({
        rfqDraft,
        recommendations,
      }),
    );
    const projectDraft = extractProjectDraft(projectResult.output);

    const sourcePrd = normalizedInput.prd ?? (isRecord(productContext.prd) ? (productContext.prd as unknown as ProductPrdSection) : null);
    const sourceProductReport = normalizedInput.productReport ?? (isRecord(productContext.productReport) ? (productContext.productReport as unknown as ProductDevelopmentReport) : null);
    const summary = buildSummary(sourcePrd, projectDraft, recommendations);
    const recommendation = buildRecommendation(recommendations, rfqDraft, projectDraft);
    const evidence = buildEvidence({
      productLoadResult,
      supplierSearchResult,
      quotationResult,
      recommendationResult,
      rfqResult,
      projectResult,
      generatedAt,
    });
    const report: SupplierAnalysisReport = {
      goal: normalizedInput.naturalLanguageGoal,
      marketplace: normalizedInput.marketplace,
      category: normalizedInput.category,
      productSummary: summarizeProduct(sourcePrd, sourceProductReport),
      supplierRecommendations: recommendations,
      quotationAnalysis: quotations,
      rfqDraft,
      supplierProjectDraft: projectDraft,
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

    recordTrace("recommendation", "Supplier plan drafted", report as unknown as JsonValue);
    emitEvent("recommendation.created", report as unknown as JsonValue);

    return {
      recommendation: {
        summary: report.recommendation,
        evidence: report.evidence,
        risks: projectDraft.risks,
        confidence: clampScore(recommendations[0]?.confidence ?? 0.7) / 100,
        nextAction: "Review supplier shortlist and RFQ draft before sourcing approval.",
      },
      decision: {
        summary: report.summary,
        rationale: "Supplier planning is complete and ready for human review.",
        confidence: clampScore(recommendations[0]?.confidence ?? 0.7) / 100,
        nextStep: "Review sourcing project draft and RFQ",
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

function normalizeSupplierExecutionInput(request: SupplierExecutionRequest, context: Record<string, unknown>) {
  const currentData = isRecord(context.currentData) ? context.currentData : {};
  const productHandoff = extractJsonObject(toJsonValue(request.productHandoff ?? currentData.productHandoff));
  const productReport = extractJsonObject(toJsonValue(request.productReport ?? currentData.productReport));
  const prd = extractPrdObject(request.prd ?? currentData.prd);

  return {
    naturalLanguageGoal: String(request.naturalLanguageGoal ?? currentData.goal ?? prd?.summary ?? "Turn the product plan into supplier recommendations."),
    marketplace: String(request.marketplace ?? productReport.marketplace ?? productHandoff.marketplace ?? currentData.marketplace ?? context.marketplace ?? "US"),
    category: String(request.category ?? productReport.category ?? productHandoff.category ?? currentData.category ?? "general"),
    prd,
    productReport,
    productHandoff: Object.keys(productHandoff).length ? (productHandoff as unknown as ProductHandoffPayload) : null,
    currentSkuContext: request.currentSkuContext ?? currentData ?? null,
  };
}

function buildSyntheticSupplierOutput(input: ToolExecutionInput, clock: () => Date) {
  const snapshot = extractJsonObject(input.input);
  const context = input.context ?? {};
  const currentData = isRecord(context.currentData) ? context.currentData : {};
  const seed = hashText(JSON.stringify({
    toolId: input.toolId,
    marketplace: String(snapshot.marketplace ?? context.marketplace ?? "US"),
    category: String(snapshot.category ?? currentData.category ?? "general"),
    prd: snapshot.prd ?? currentData.prd ?? null,
  }));
  const now = clock().toISOString();

  switch (input.toolId) {
    case "supplier.product.load":
      return {
        source: "Supplier MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        marketplace: String(snapshot.marketplace ?? context.marketplace ?? "US"),
        category: String(snapshot.category ?? currentData.category ?? "general"),
        prd: snapshot.prd ?? currentData.prd ?? null,
        productReport: snapshot.productReport ?? currentData.productReport ?? null,
        summary: summarizeProduct(
          (snapshot.prd ?? currentData.prd ?? null) as ProductPrdSection | JsonObject | null,
          (snapshot.productReport ?? currentData.productReport ?? null) as ProductDevelopmentReport | JsonObject | null,
        ),
      };
    case "supplier.database.search":
      return {
        source: "Supplier MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        suppliers: buildSupplierCandidates(seed),
      };
    case "supplier.quotation.analyze":
      return {
        source: "Supplier MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        quotations: buildQuotations(seed),
      };
    case "supplier.recommendation.compose":
      return {
        source: "Supplier MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        recommendations: buildRecommendations(seed),
      };
    case "supplier.rfq.draft":
      return {
        source: "Supplier MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        rfqDraft: buildRfQDraft(snapshot, seed),
      };
    case "supplier.project.draft":
      return {
        source: "Supplier MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
        projectDraft: buildProjectDraft(snapshot),
      };
    default:
      return {
        source: "Supplier MCP Adapter",
        toolId: input.toolId,
        generatedAt: now,
      };
  }
}

function buildSupplierCandidates(seed: number): SupplierRecommendation[] {
  const suppliers = [
    "宁波优选塑业",
    "深圳新迈电子",
    "广州万合日用品",
    "义乌尚品家居",
  ];

  return suppliers.map((supplierName, index) => ({
    supplierId: `supplier-${index + 1}`,
    supplierName,
    summary: `${supplierName} matches the product scope with stable capacity and flexible MOQ.`,
    strengths: [
      "Stable production capacity",
      "Responsive sample iteration",
      "Supports Amazon-ready packaging",
    ],
    risks: [
      "Quote variance may require follow-up",
      "Tool output is synthetic and must be verified by human review",
    ],
    confidence: clampScore(68 + ((seed >> (index * 2)) % 18)) / 100,
  }));
}

function buildQuotations(seed: number): SupplierQuotation[] {
  return [
    {
      supplierId: "supplier-1",
      supplierName: "宁波优选塑业",
      contactName: "李经理",
      contactEmail: "sales@example.com",
      moq: "500 pcs",
      unitPrice: "$4.80",
      shippingEstimate: "$1.20",
      leadTime: "20 days",
      sampleCost: "$35.00",
      notes: "Best balance of cost and lead time.",
      score: clampScore(74 + (seed % 10)),
    },
    {
      supplierId: "supplier-2",
      supplierName: "深圳新迈电子",
      contactName: "王经理",
      contactEmail: "quote@example.com",
      moq: "300 pcs",
      unitPrice: "$5.25",
      shippingEstimate: "$1.05",
      leadTime: "18 days",
      sampleCost: "$40.00",
      notes: "Slightly higher price, better iteration speed.",
      score: clampScore(70 + ((seed >> 3) % 10)),
    },
    {
      supplierId: "supplier-3",
      supplierName: "广州万合日用品",
      contactName: "陈经理",
      contactEmail: "wholesale@example.com",
      moq: "800 pcs",
      unitPrice: "$4.55",
      shippingEstimate: "$1.35",
      leadTime: "24 days",
      sampleCost: "$32.00",
      notes: "Lowest unit price but stricter MOQ.",
      score: clampScore(66 + ((seed >> 5) % 12)),
    },
  ];
}

function buildRecommendations(seed: number): SupplierRecommendation[] {
  const quotations = buildQuotations(seed);

  return quotations.map((quotation, index) => ({
    supplierId: quotation.supplierId,
    supplierName: quotation.supplierName,
    summary: `${quotation.supplierName} offers a ${quotation.unitPrice} target with lead time ${quotation.leadTime}.`,
    strengths: [
      quotation.notes,
      "Supports RFQ-based comparison",
      "Reasonable sample and logistics estimate",
    ],
    risks: [
      "Final landed cost must be validated through real supplier quote",
      "Packaging and compliance scope may shift pricing",
    ],
    confidence: clampScore(72 + ((seed >> index) % 12)) / 100,
  }));
}

function buildRfQDraft(snapshot: JsonObject, seed: number): SupplierRfQSection {
  const productName = String(
    snapshot.prd && isRecord(snapshot.prd) && typeof snapshot.prd.summary === "string"
      ? snapshot.prd.summary
      : "product concept",
  );
  const priceBandShift = seed % 2 === 0 ? "stable" : "tight";

  return {
    subject: `RFQ for ${productName}`,
    objective: "Request quotation, sample, lead time, and production capability details.",
    productSummary: `Validated product concept with differentiated requirements and ${priceBandShift} pricing guardrails.`,
    requiredCapabilities: [
      "Amazon-ready packaging",
      "Stable quality inspection",
      "Sample iteration support",
    ],
    targetPrice: "$5.00 - $5.50",
    targetLeadTime: "18-24 days",
    questions: [
      "What is the MOQ per SKU?",
      "What is the unit price at 500 / 1000 / 3000 pcs?",
      "What is the sample fee and lead time?",
      "Do you support custom packaging and insert cards?",
    ],
  };
}

function buildProjectDraft(snapshot: JsonObject): {
  projectName: string;
  objective: string;
  stages: Array<{ name: string; goal: string; owner: string }>;
  nextStep: string;
  risks: string[];
} {
  const productName = String(
    snapshot.prd && isRecord(snapshot.prd) && typeof snapshot.prd.summary === "string"
      ? snapshot.prd.summary
      : "sourcing project",
  );

  return {
    projectName: `${productName} Sourcing Project`,
    objective: "Turn supplier recommendations into a sourcing-ready project for human review.",
    stages: [
      { name: "Supplier Shortlist", goal: "Select best-fit suppliers", owner: "Supplier" },
      { name: "RFQ Draft", goal: "Send structured RFQ to shortlisted suppliers", owner: "Supplier" },
      { name: "Quotation Review", goal: "Compare landed cost and lead time", owner: "Operations" },
      { name: "Approval Handoff", goal: "Move into human review and sourcing approval", owner: "Operations" },
    ],
    nextStep: "Review supplier shortlist and RFQ draft before approval.",
    risks: [
      "Quotation data is synthetic until validated",
      "MOQ may conflict with launch plan",
      "Lead time may vary after real supplier contact",
    ],
  };
}

function buildEvidence(input: {
  productLoadResult: { output?: JsonValue; toolCall?: { id?: string } };
  supplierSearchResult: { output?: JsonValue; toolCall?: { id?: string } };
  quotationResult: { output?: JsonValue; toolCall?: { id?: string } };
  recommendationResult: { output?: JsonValue; toolCall?: { id?: string } };
  rfqResult: { output?: JsonValue; toolCall?: { id?: string } };
  projectResult: { output?: JsonValue; toolCall?: { id?: string } };
  generatedAt: string;
}): ProductEvidenceItem[] {
  return [
    evidenceItem({
      claim: "Product context normalized",
      dataSource: "Supplier MCP Adapter",
      toolId: "supplier.product.load",
      toolCallId: input.productLoadResult.toolCall?.id,
      metric: "product-context",
      value: input.productLoadResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Supplier candidates found",
      dataSource: "Supplier MCP Adapter",
      toolId: "supplier.database.search",
      toolCallId: input.supplierSearchResult.toolCall?.id,
      metric: "supplier-candidates",
      value: input.supplierSearchResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Quotation analysis completed",
      dataSource: "Supplier MCP Adapter",
      toolId: "supplier.quotation.analyze",
      toolCallId: input.quotationResult.toolCall?.id,
      metric: "quotation-analysis",
      value: input.quotationResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Supplier recommendation drafted",
      dataSource: "Supplier MCP Adapter",
      toolId: "supplier.recommendation.compose",
      toolCallId: input.recommendationResult.toolCall?.id,
      metric: "supplier-recommendation",
      value: input.recommendationResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "RFQ drafted",
      dataSource: "Supplier MCP Adapter",
      toolId: "supplier.rfq.draft",
      toolCallId: input.rfqResult.toolCall?.id,
      metric: "rfq-draft",
      value: input.rfqResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Sourcing project drafted",
      dataSource: "Supplier MCP Adapter",
      toolId: "supplier.project.draft",
      toolCallId: input.projectResult.toolCall?.id,
      metric: "project-draft",
      value: input.projectResult.output ?? null,
      timestamp: input.generatedAt,
    }),
  ];
}

function buildSummary(prd: ProductPrdSection | null, projectDraft: { projectName: string }, recommendations: SupplierRecommendation[]) {
  const productSummary = prd ? prd.summary : "the selected product concept";
  const supplierName = recommendations[0]?.supplierName ?? "a shortlisted supplier";
  return `${productSummary} can be sourced through ${supplierName}, with RFQ and ${projectDraft.projectName} prepared for review.`;
}

function buildRecommendation(recommendations: SupplierRecommendation[], rfqDraft: SupplierRfQSection, projectDraft: { nextStep: string }) {
  return `Use ${recommendations[0]?.supplierName ?? "the top supplier"} as the first RFQ target, then review quote spread, sample cost, lead time, and ${rfqDraft.targetLeadTime} against ${projectDraft.nextStep.toLowerCase()}.`;
}

function summarizeProduct(prd: ProductPrdSection | JsonObject | null, report: ProductDevelopmentReport | JsonObject | null) {
  if (isRecord(prd) && typeof prd.summary === "string") return prd.summary;
  if (isRecord(report) && typeof report.summary === "string") return report.summary;
  return "No product context supplied.";
}

function extractSupplierRecommendations(value: JsonValue | undefined): SupplierRecommendation[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const suppliers = Array.isArray(record.suppliers) ? record.suppliers : [];

  return suppliers
    .map((item): SupplierRecommendation | null => {
      if (!isRecord(item)) return null;
      return {
        supplierId: String(item.supplierId ?? item.id ?? "supplier"),
        supplierName: String(item.supplierName ?? item.name ?? "Supplier"),
        summary: String(item.summary ?? "Supplier candidate"),
        strengths: normalizeStringArray(item.strengths),
        risks: normalizeStringArray(item.risks),
        confidence: typeof item.confidence === "number" ? item.confidence : 0.7,
      };
    })
    .filter((item): item is SupplierRecommendation => Boolean(item));
}

function extractSupplierQuotations(value: JsonValue | undefined): SupplierQuotation[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const quotations = Array.isArray(record.quotations) ? record.quotations : [];

  return quotations
    .map((item): SupplierQuotation | null => {
      if (!isRecord(item)) return null;
      return {
        supplierId: String(item.supplierId ?? "supplier"),
        supplierName: String(item.supplierName ?? "Supplier"),
        contactName: String(item.contactName ?? "Contact"),
        contactEmail: String(item.contactEmail ?? "sales@example.com"),
        contactPhone: typeof item.contactPhone === "string" ? item.contactPhone : undefined,
        moq: String(item.moq ?? "-"),
        unitPrice: String(item.unitPrice ?? "-"),
        shippingEstimate: String(item.shippingEstimate ?? "-"),
        leadTime: String(item.leadTime ?? "-"),
        sampleCost: String(item.sampleCost ?? "-"),
        notes: String(item.notes ?? ""),
        score: typeof item.score === "number" ? clampScore(item.score) : 70,
      };
    })
    .filter((item): item is SupplierQuotation => Boolean(item));
}

function extractSupplierRecommendationItems(
  value: JsonValue | undefined,
  suppliers: SupplierRecommendation[],
  quotations: SupplierQuotation[],
): SupplierRecommendation[] {
  const extracted = extractSupplierRecommendations(value);
  if (extracted.length) return extracted;
  return suppliers.length ? suppliers : quotations.map((quotation) => ({
    supplierId: quotation.supplierId,
    supplierName: quotation.supplierName,
    summary: quotation.notes,
    strengths: ["Quotation available"],
    risks: ["Synthetic quotation requires validation"],
    confidence: quotation.score / 100,
  }));
}

function extractRfQSection(value: JsonValue | undefined): SupplierRfQSection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return buildRfQDraft({}, 0);
  }

  const record = value as Record<string, unknown>;

  return {
    subject: String(record.subject ?? "RFQ"),
    objective: String(record.objective ?? "Request quotation"),
    productSummary: String(record.productSummary ?? "Product summary"),
    requiredCapabilities: normalizeStringArray(record.requiredCapabilities),
    targetPrice: String(record.targetPrice ?? "$5.00 - $5.50"),
    targetLeadTime: String(record.targetLeadTime ?? "18-24 days"),
    questions: normalizeStringArray(record.questions),
  };
}

function extractProjectDraft(value: JsonValue | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return buildProjectDraft({});
  }

  const record = value as Record<string, unknown>;

  return {
    projectName: String(record.projectName ?? "Sourcing Project"),
    objective: String(record.objective ?? "Draft sourcing project"),
    stages: Array.isArray(record.stages)
      ? (record.stages as unknown[]).map((item) => {
          const stage = isRecord(item) ? item : {};
          return {
            name: String(stage.name ?? "Stage"),
            goal: String(stage.goal ?? "Define stage goal"),
            owner: String(stage.owner ?? "Supplier"),
          };
        })
      : [],
    nextStep: String(record.nextStep ?? "Review sourcing project"),
    risks: normalizeStringArray(record.risks),
  };
}

function extractPrdObject(value: unknown): ProductPrdSection | null {
  if (!isRecord(value)) return null;
  return {
    summary: String(value.summary ?? "PRD"),
    userProblem: String(value.userProblem ?? "Problem"),
    targetCustomer: String(value.targetCustomer ?? "Customer"),
    mustHave: normalizeStringArray(value.mustHave),
    shouldHave: normalizeStringArray(value.shouldHave),
    acceptanceCriteria: normalizeStringArray(value.acceptanceCriteria),
    launchRisks: normalizeStringArray(value.launchRisks),
  };
}

function buildMemoryItems(input: {
  execution: { id: string; agentDefinitionId: string };
  definition: AgentDefinition;
  report: SupplierAnalysisReport;
  generatedAt: string;
  requestedByUserId?: string;
}): AgentMemoryEntry[] {
  const scopeKey = `${input.report.marketplace}:${input.report.category ?? input.report.productSummary ?? "supplier"}:${input.execution.id}`;

  return [
    {
      id: `memory-${input.execution.id}-supplier`,
      agentDefinitionId: input.definition.id,
      scope: "supplier-planning",
      scopeKey,
      summary: `${input.report.supplierProjectDraft.projectName} drafted with RFQ and supplier recommendations.`,
      data: toJsonValue({
        report: input.report,
        requestedByUserId: input.requestedByUserId ?? null,
      }),
      sourceExecutionId: input.execution.id,
      confidence: Math.max(0.55, input.report.supplierRecommendations[0]?.confidence ?? 0.7),
      createdAt: input.generatedAt,
      updatedAt: input.generatedAt,
    },
  ];
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
