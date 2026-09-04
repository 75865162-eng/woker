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

export type OrchestratorStageId = "market" | "product" | "supplier" | "listing" | "launch" | "ppc";

export type OrchestratorStageStatus =
  | "ready"
  | "waiting_input"
  | "waiting_approval"
  | "blocked_until_launch"
  | "completed";

export interface OrchestratorStage {
  id: OrchestratorStageId;
  name: string;
  agentId: string | null;
  status: OrchestratorStageStatus;
  objective: string;
  requiredInputs: string[];
  outputContract: string[];
  nextRoute?: string;
  handoffKey?: string;
  handoffPayload: JsonObject;
}

export interface OrchestratorHandoff {
  from: "user" | OrchestratorStageId;
  to: OrchestratorStageId;
  agentId: string | null;
  route?: string;
  payload: JsonObject;
  requiredApproval?: boolean;
  summary: string;
}

export interface OrchestratorPlan {
  planId: string;
  goal: string;
  marketplace: string;
  sku?: string;
  asin?: string;
  stages: OrchestratorStage[];
  launchGate: {
    status: "not_ready" | "waiting_approval" | "approved";
    requiredChecks: string[];
    approvalRequired: boolean;
  };
  generatedAt: string;
}

export interface OrchestratorExecutionOutput {
  plan: OrchestratorPlan;
  handoffs: OrchestratorHandoff[];
  currentStage: OrchestratorStageId;
  nextAction: string;
  evidence: Array<{
    claim: string;
    dataSource: string;
    toolId: string;
    metric: string;
    value: JsonValue;
    timestamp: string;
  }>;
  memoryItems?: AgentMemoryEntry[];
}

export interface OrchestratorExecutionRequest {
  naturalLanguageGoal?: string;
  marketplace?: string;
  category?: string;
  sku?: string;
  asin?: string;
  productConstraints?: string[] | string;
  marketOpportunity?: JsonValue;
  productReport?: JsonValue;
  supplierReport?: JsonValue;
  listingDraft?: JsonValue;
  launchApproved?: boolean;
  currentStage?: OrchestratorStageId;
  context?: Record<string, unknown>;
}

const orchestratorToolAdapterId = "orchestrator-internal-adapter";
export const orchestratorAgentId = "orchestrator";
export const orchestratorHandoffStorageKey = "amazon.agent-platform.orchestrator-handoff";

export const orchestratorAgentDefinition: AgentDefinition = {
  id: orchestratorAgentId,
  name: "Agent Orchestrator",
  description: "Coordinate the Amazon AI Commerce OS chain from market discovery through launch and PPC diagnosis.",
  version: "v1.0.0",
  systemInstructions:
    "You are the Agent Orchestrator for an Amazon AI Commerce OS. Build execution plans, prepare typed handoffs, enforce stage order, and preserve approval gates. Use only orchestrator tools through the Tool Gateway. Do not call downstream business tools directly and do not execute high-risk actions.",
  goals: [
    "Translate user goals into a multi-agent commerce workflow",
    "Prepare structured handoffs between Market, Product, Supplier, Listing, Launch, and PPC stages",
    "Enforce launch approval before PPC execution handoff",
    "Keep all agent collaboration auditable",
    "Avoid duplicating downstream business-agent logic",
  ],
  skills: [
    "workflow orchestration",
    "agent handoff design",
    "approval-gated launch planning",
    "context routing",
    "execution trace synthesis",
  ],
  tools: [
    "orchestrator.context.collect",
    "orchestrator.plan.build",
    "orchestrator.handoff.prepare",
    "orchestrator.launch.gate",
    "orchestrator.ppc.handoff",
  ],
  permissions: [
    "orchestrator.read.context",
    "orchestrator.write.plan",
    "orchestrator.write.handoff",
    "orchestrator.write.launchGate",
    "orchestrator.audit",
  ],
  inputSchema: {
    type: "object",
    properties: {
      naturalLanguageGoal: { type: "string" },
      marketplace: { type: "string" },
      category: { type: "string" },
      sku: { type: "string" },
      asin: { type: "string" },
      marketOpportunity: { type: "object" },
      productReport: { type: "object" },
      supplierReport: { type: "object" },
      listingDraft: { type: "object" },
      launchApproved: { type: "boolean" },
      currentStage: { type: "string" },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      plan: { type: "object" },
      handoffs: { type: "array" },
      currentStage: { type: "string" },
      nextAction: { type: "string" },
      evidence: { type: "array" },
    },
  },
  approvalPolicy: {
    requiredForRiskLevels: ["HIGH", "CRITICAL"],
    timeoutMinutes: 120,
    approverRoles: ["owner", "database_admin", "operations_manager", "operations_supervisor"],
    notes: "Orchestrator creates plans and handoffs only. Launch and external write actions remain approval-gated.",
  },
  enabled: true,
};

export const orchestratorToolDefinitions: AgentToolDefinition[] = [
  {
    toolId: "orchestrator.context.collect",
    name: "Collect Commerce Context",
    description: "Collect and sanitize current user, SKU, marketplace, and stage payload context for orchestration.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        marketplace: { type: "string" },
        currentStage: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        context: { type: "object" },
        missingInputs: { type: "array" },
      },
    },
    permission: ["orchestrator.read.context"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: orchestratorToolAdapterId,
    enabled: true,
  },
  {
    toolId: "orchestrator.plan.build",
    name: "Build Agent Plan",
    description: "Build the ordered Market to PPC orchestration plan without running downstream business tools.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        contextSnapshot: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        plan: { type: "object" },
      },
    },
    permission: ["orchestrator.write.plan"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: orchestratorToolAdapterId,
    enabled: true,
  },
  {
    toolId: "orchestrator.handoff.prepare",
    name: "Prepare Agent Handoff",
    description: "Prepare typed stage-to-stage payloads for downstream Agent pages and APIs.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        handoffs: { type: "array" },
      },
    },
    permission: ["orchestrator.write.handoff"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: orchestratorToolAdapterId,
    enabled: true,
  },
  {
    toolId: "orchestrator.launch.gate",
    name: "Launch Approval Gate",
    description: "Evaluate whether listing and launch context is ready for human launch approval.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "object" },
        launchApproved: { type: "boolean" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        launchGate: { type: "object" },
      },
    },
    permission: ["orchestrator.write.launchGate"],
    riskLevel: "MEDIUM",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryableErrors: ["TIMEOUT"],
    },
    adapterId: orchestratorToolAdapterId,
    enabled: true,
  },
  {
    toolId: "orchestrator.ppc.handoff",
    name: "Prepare PPC Handoff",
    description: "Prepare PPC diagnosis payload after the launch gate has been reviewed.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "object" },
        launchGate: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        ppcHandoff: { type: "object" },
      },
    },
    permission: ["orchestrator.write.handoff"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: orchestratorToolAdapterId,
    enabled: true,
  },
];

export const orchestratorEvaluationCases = [
  evaluationCase("orchestrator-case-01", "Full chain from user goal", {
    naturalLanguageGoal: "从美国站蓝海机会开始，完成产品、供应商、Listing、Launch 和 PPC 接入",
    marketplace: "US",
  }, {
    shouldCreateSixStages: true,
    shouldStartWithMarket: true,
    shouldEndWithPpc: true,
  }),
  evaluationCase("orchestrator-case-02", "Market output handoff", {
    naturalLanguageGoal: "把市场机会交给 Product Agent",
    marketplace: "US",
    marketOpportunity: { opportunityId: "opp-1", productIdea: "Desk organizer" },
  }, {
    shouldPrepareProductHandoff: true,
  }),
  evaluationCase("orchestrator-case-03", "Product PRD to supplier", {
    naturalLanguageGoal: "根据 PRD 做供应商筛选",
    marketplace: "US",
    productReport: { prd: { summary: "PRD" }, costTarget: { targetLandedCost: "$8.00" } },
  }, {
    shouldPrepareSupplierHandoff: true,
  }),
  evaluationCase("orchestrator-case-04", "Supplier to listing", {
    naturalLanguageGoal: "供应商确认后准备 Listing",
    marketplace: "US",
    supplierReport: { recommendedSupplier: { name: "Supplier A" } },
  }, {
    shouldPrepareListingHandoff: true,
  }),
  evaluationCase("orchestrator-case-05", "Listing before launch gate", {
    naturalLanguageGoal: "Listing draft 完成，等待 Launch",
    marketplace: "US",
    listingDraft: { title: "Desk organizer" },
  }, {
    shouldRequireLaunchApproval: true,
  }),
  evaluationCase("orchestrator-case-06", "Launch approved to PPC", {
    naturalLanguageGoal: "Launch 通过后接 PPC Agent",
    marketplace: "US",
    launchApproved: true,
  }, {
    shouldPreparePpcHandoff: true,
  }),
  evaluationCase("orchestrator-case-07", "Missing goal", {
    marketplace: "US",
  }, {
    shouldUseDefaultGoal: true,
  }),
  evaluationCase("orchestrator-case-08", "Non-US marketplace", {
    naturalLanguageGoal: "英国站从市场到投放全链路",
    marketplace: "UK",
  }, {
    shouldRespectMarketplace: true,
  }),
  evaluationCase("orchestrator-case-09", "Current SKU context", {
    naturalLanguageGoal: "基于当前 SKU 做完整链路",
    marketplace: "US",
    sku: "SKU-001",
    asin: "B000TEST01",
  }, {
    shouldCarrySkuContext: true,
  }),
  evaluationCase("orchestrator-case-10", "Permission boundary", {
    naturalLanguageGoal: "不要直接调用业务工具",
    marketplace: "US",
  }, {
    shouldUseOnlyOrchestratorTools: true,
  }),
  evaluationCase("orchestrator-case-11", "Blocked PPC before launch", {
    naturalLanguageGoal: "PPC 必须等 Launch",
    marketplace: "US",
    launchApproved: false,
  }, {
    shouldBlockPpcUntilLaunch: true,
  }),
  evaluationCase("orchestrator-case-12", "Auditability", {
    naturalLanguageGoal: "生成可审计的交接计划",
    marketplace: "US",
  }, {
    shouldEmitTraceAndEvidence: true,
  }),
];

export function createOrchestratorInternalAdapter(clock: () => Date = () => new Date()): AgentToolAdapter {
  return {
    adapterId: orchestratorToolAdapterId,
    async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
      const startedAt = clock().getTime();
      const output = toJsonValue(buildSyntheticOrchestratorOutput(input, clock));

      return {
        output,
        latencyMs: Math.max(clock().getTime() - startedAt, 1),
      };
    },
  };
}

export function createOrchestratorExecutionExecutor(options: {
  request: OrchestratorExecutionRequest;
  requestedByUserId?: string;
  clock?: () => Date;
}): AgentRuntimeExecutor {
  const clock = options.clock ?? (() => new Date());

  return async ({ execution, definition, context, callTool, requestApproval, recordTrace, emitEvent }) => {
    const normalizedInput = normalizeOrchestratorExecutionInput(options.request, context as Record<string, unknown>);
    const generatedAt = clock().toISOString();

    recordTrace(
      "decision",
      "Orchestration goal parsed",
      toJsonValue({
        goal: normalizedInput.goal,
        marketplace: normalizedInput.marketplace,
        sku: normalizedInput.sku ?? null,
        asin: normalizedInput.asin ?? null,
        currentStage: normalizedInput.currentStage,
      }),
    );
    emitEvent("decision.made" as AgentEventName, {
      executionId: execution.id,
      summary: "Orchestrator parsed goal and prepared stage routing.",
      marketplace: normalizedInput.marketplace,
    } as JsonValue);

    const contextResult = await callTool(
      "orchestrator.context.collect",
      toJsonValue({
        goal: normalizedInput.goal,
        marketplace: normalizedInput.marketplace,
        currentStage: normalizedInput.currentStage,
        sku: normalizedInput.sku ?? null,
        asin: normalizedInput.asin ?? null,
        category: normalizedInput.category ?? null,
        productConstraints: normalizedInput.productConstraints,
        stageInputs: normalizedInput.stageInputs,
      }),
    );
    const contextSnapshot = extractJsonObject(contextResult.output);

    const planResult = await callTool(
      "orchestrator.plan.build",
      toJsonValue({
        goal: normalizedInput.goal,
        marketplace: normalizedInput.marketplace,
        sku: normalizedInput.sku ?? null,
        asin: normalizedInput.asin ?? null,
        currentStage: normalizedInput.currentStage,
        contextSnapshot,
        stageInputs: normalizedInput.stageInputs,
      }),
    );
    let plan = extractPlan(planResult.output, normalizedInput, generatedAt);

    const handoffResult = await callTool(
      "orchestrator.handoff.prepare",
      toJsonValue({
        plan,
        stageInputs: normalizedInput.stageInputs,
      }),
    );
    let handoffs = extractHandoffs(handoffResult.output, plan);

    const needsLaunchApproval = !normalizedInput.launchApproved;
    let launchGateOutput: JsonObject = {
      launchGate: toJsonValue(plan.launchGate) as JsonObject,
      launchApproved: normalizedInput.launchApproved,
    };
    if (needsLaunchApproval) {
      const approval = await requestApproval({
        executionId: execution.id,
        riskLevel: "HIGH",
        recommendation: {
          summary: "Launch gate requires human approval before PPC handoff becomes executable.",
          evidence: {
            planId: plan.planId,
            requiredChecks: plan.launchGate.requiredChecks,
            listingDraftPresent: Boolean(normalizedInput.stageInputs.listingDraft),
          },
          risks: [
            "PPC execution before launch approval can spend budget against an unapproved listing.",
            "Launch readiness checks may be incomplete.",
          ],
          confidence: normalizedInput.stageInputs.listingDraft ? 0.82 : 0.68,
          nextAction: "Approve launch gate only after product, supplier, listing, and launch checklist review.",
        },
        action: {
          type: "orchestrator.launch.approve",
          target: "launch",
          payload: {
            planId: plan.planId,
            nextStage: "ppc",
          },
        },
        requestedByUserId: options.requestedByUserId,
      });

      launchGateOutput = {
        launchGate: {
          status: "waiting_approval",
          requiredChecks: plan.launchGate.requiredChecks,
          approvalRequired: true,
          approvalId: approval.id,
        },
        approval: approval as unknown as JsonValue,
      } as JsonObject;
      plan = applyLaunchGate(plan, "waiting_approval");
      handoffs = updatePpcHandoffStatus(handoffs, false);
    } else {
      const launchGateResult = await callTool(
        "orchestrator.launch.gate",
        toJsonValue({
          plan,
          launchApproved: true,
          listingDraft: normalizedInput.stageInputs.listingDraft ?? null,
        }),
      );
      launchGateOutput = extractJsonObject(launchGateResult.output);
      plan = applyLaunchGate(plan, "approved");
      handoffs = updatePpcHandoffStatus(handoffs, true);
    }

    const ppcHandoffResult = await callTool(
      "orchestrator.ppc.handoff",
      toJsonValue({
        plan,
        launchGate: launchGateOutput.launchGate ?? plan.launchGate,
        stageInputs: normalizedInput.stageInputs,
      }),
    );

    const currentStage = resolveCurrentStage(plan);
    const nextAction = buildNextAction(currentStage, plan);
    const evidence = buildEvidence({
      contextResult,
      planResult,
      handoffResult,
      ppcHandoffResult,
      generatedAt,
      launchGateOutput,
    });
    const output: OrchestratorExecutionOutput = {
      plan,
      handoffs,
      currentStage,
      nextAction,
      evidence,
      memoryItems: buildMemoryItems({
        executionId: execution.id,
        agentId: definition.id,
        plan,
        handoffs,
        generatedAt,
      }),
    };

    recordTrace("recommendation", "Orchestration plan prepared", output as unknown as JsonValue);
    emitEvent("recommendation.created", output as unknown as JsonValue);

    return {
      recommendation: {
        summary: `已生成 ${plan.stages.length} 阶段 Agent 编排计划：Market → Product → Supplier → Listing → Launch → PPC。`,
        evidence,
        risks: needsLaunchApproval
          ? ["Launch gate is waiting for human approval before PPC handoff is actionable."]
          : [],
        confidence: normalizedInput.stageInputs.listingDraft || normalizedInput.launchApproved ? 0.86 : 0.78,
        nextAction,
      },
      decision: {
        summary: `Next stage: ${currentStage}.`,
        rationale: "Orchestrator prepared stage contracts and handoff payloads without executing downstream business logic.",
        confidence: 0.84,
        nextStep: nextAction,
      },
      output: toJsonValue(output),
      tokenUsage: 160,
      costCents: 0,
      memoryItems: output.memoryItems,
    };
  };
}

function buildSyntheticOrchestratorOutput(input: ToolExecutionInput, clock: () => Date) {
  const snapshot = extractJsonObject(input.input);
  const now = clock().toISOString();

  switch (input.toolId) {
    case "orchestrator.context.collect":
      return {
        source: "Orchestrator Internal Adapter",
        toolId: input.toolId,
        generatedAt: now,
        context: {
          goal: snapshot.goal ?? "Run Amazon AI Commerce OS workflow.",
          marketplace: snapshot.marketplace ?? input.context.marketplace ?? "US",
          sku: snapshot.sku ?? input.context.sku ?? null,
          asin: snapshot.asin ?? input.context.asin ?? null,
          category: snapshot.category ?? null,
          productConstraints: snapshot.productConstraints ?? [],
          stageInputs: snapshot.stageInputs ?? {},
        },
        missingInputs: buildMissingInputs(snapshot),
      };
    case "orchestrator.plan.build": {
      const normalized = normalizeOrchestratorExecutionInput(
        {
          naturalLanguageGoal: String(snapshot.goal ?? "Run Amazon AI Commerce OS workflow."),
          marketplace: String(snapshot.marketplace ?? input.context.marketplace ?? "US"),
          sku: typeof snapshot.sku === "string" ? snapshot.sku : undefined,
          asin: typeof snapshot.asin === "string" ? snapshot.asin : undefined,
          currentStage: normalizeStageId(snapshot.currentStage),
        },
        input.context as Record<string, unknown>,
      );

      return {
        source: "Orchestrator Internal Adapter",
        toolId: input.toolId,
        generatedAt: now,
        plan: buildPlan(normalized, now),
      };
    }
    case "orchestrator.handoff.prepare": {
      const plan = extractPlan(snapshot.plan, normalizeOrchestratorExecutionInput({}, input.context as Record<string, unknown>), now);

      return {
        source: "Orchestrator Internal Adapter",
        toolId: input.toolId,
        generatedAt: now,
        handoffs: buildHandoffs(plan),
      };
    }
    case "orchestrator.launch.gate":
      return {
        source: "Orchestrator Internal Adapter",
        toolId: input.toolId,
        generatedAt: now,
        launchGate: {
          status: snapshot.launchApproved === true ? "approved" : "waiting_approval",
          requiredChecks: defaultLaunchChecks,
          approvalRequired: snapshot.launchApproved !== true,
        },
      };
    case "orchestrator.ppc.handoff":
      return {
        source: "Orchestrator Internal Adapter",
        toolId: input.toolId,
        generatedAt: now,
        ppcHandoff: {
          route: "/agents/ppc",
          status: isRecord(snapshot.launchGate) && snapshot.launchGate.status === "approved" ? "ready" : "blocked_until_launch",
          payload: {
            naturalLanguageGoal: "Use launch context, SellerSprite keywords, historical PPC, and product data to diagnose launch PPC.",
            marketplace: extractMarketplaceFromPlan(snapshot.plan),
            productContext: extractStagePayload(snapshot.plan, "listing") ?? extractStagePayload(snapshot.plan, "product") ?? null,
            historicalData: null,
          },
        },
      };
    default:
      return {
        source: "Orchestrator Internal Adapter",
        toolId: input.toolId,
        generatedAt: now,
      };
  }
}

function normalizeOrchestratorExecutionInput(request: OrchestratorExecutionRequest, context: Record<string, unknown>) {
  const currentData = isRecord(context.currentData) ? context.currentData : {};
  const goal = String(
    request.naturalLanguageGoal ??
      currentData.goal ??
      "从 Amazon 市场机会开始，串联 Product、Supplier、Listing、Launch 和 PPC Agent。",
  );
  const marketplace = String(request.marketplace ?? currentData.marketplace ?? context.marketplace ?? "US");

  return {
    goal,
    marketplace,
    category: typeof request.category === "string" ? request.category : stringOrUndefined(currentData.category),
    sku: request.sku ?? stringOrUndefined(context.sku) ?? stringOrUndefined(currentData.sku),
    asin: request.asin ?? stringOrUndefined(context.asin) ?? stringOrUndefined(currentData.asin),
    productConstraints: normalizeStringArray(request.productConstraints ?? currentData.productConstraints),
    currentStage: request.currentStage ?? normalizeStageId(currentData.currentStage) ?? "market",
    launchApproved: request.launchApproved === true || currentData.launchApproved === true,
    stageInputs: {
      marketOpportunity: request.marketOpportunity ?? currentData.marketOpportunity ?? null,
      productReport: request.productReport ?? currentData.productReport ?? null,
      supplierReport: request.supplierReport ?? currentData.supplierReport ?? null,
      listingDraft: request.listingDraft ?? currentData.listingDraft ?? null,
    },
  };
}

function buildPlan(input: ReturnType<typeof normalizeOrchestratorExecutionInput>, generatedAt: string): OrchestratorPlan {
  const planId = `orchestrator-plan-${hashText(`${input.goal}:${input.marketplace}:${input.sku ?? ""}:${input.asin ?? ""}`)}`;
  const stages: OrchestratorStage[] = [
    {
      id: "market",
      name: "Market Agent",
      agentId: "market",
      status: input.stageInputs.marketOpportunity ? "completed" : "ready",
      objective: "Discover Amazon market opportunities and create Product Opportunity candidates.",
      requiredInputs: ["naturalLanguageGoal", "marketplace", "category", "filters"],
      outputContract: ["ProductOpportunity", "MarketResearchReport", "evidence"],
      nextRoute: "/agents/market",
      handoffKey: "amazon.agent-platform.product-handoff",
      handoffPayload: {
        naturalLanguageGoal: input.goal,
        marketplace: input.marketplace,
        category: input.category ?? null,
        productConstraints: input.productConstraints,
      },
    },
    {
      id: "product",
      name: "Product Agent",
      agentId: "product",
      status: input.stageInputs.productReport ? "completed" : input.stageInputs.marketOpportunity ? "ready" : "waiting_input",
      objective: "Turn market opportunity, competitor pain points, and differentiation into PRD and product project draft.",
      requiredInputs: ["ProductOpportunity", "MarketResearchReport"],
      outputContract: ["PRD", "CostTarget", "ProductProjectDraft", "evidence"],
      nextRoute: "/agents/product",
      handoffKey: "amazon.agent-platform.supplier-handoff",
      handoffPayload: {
        naturalLanguageGoal: "基于 Market Agent 机会生成 PRD、差异化和成本目标。",
        marketplace: input.marketplace,
        category: input.category ?? null,
        marketOpportunity: toJsonValue(input.stageInputs.marketOpportunity),
      },
    },
    {
      id: "supplier",
      name: "Supplier Agent",
      agentId: "supplier",
      status: input.stageInputs.supplierReport ? "completed" : input.stageInputs.productReport ? "ready" : "waiting_input",
      objective: "Use PRD and cost target to screen suppliers, draft RFQ, compare quotes, and recommend supplier.",
      requiredInputs: ["PRD", "CostTarget", "ProductProjectDraft"],
      outputContract: ["SupplierRecommendation", "RFQDraft", "QuotationAnalysis", "evidence"],
      nextRoute: "/agents/supplier",
      handoffKey: "amazon.agent-platform.listing-handoff",
      handoffPayload: {
        naturalLanguageGoal: "基于 Product Agent PRD 做供应商筛选、询价模板、报价比较和推荐。",
        marketplace: input.marketplace,
        productReport: toJsonValue(input.stageInputs.productReport),
      },
    },
    {
      id: "listing",
      name: "Listing Agent",
      agentId: "listing",
      status: input.stageInputs.listingDraft ? "completed" : input.stageInputs.supplierReport || input.stageInputs.productReport ? "ready" : "waiting_input",
      objective: "Combine product specification, SellerSprite keywords, competitors, and brand context into listing draft.",
      requiredInputs: ["ProductSpecification", "KeywordData", "CompetitorData", "BrandInformation"],
      outputContract: ["KeywordMap", "Title", "Bullets", "Description", "A+Brief", "ListingDraft"],
      nextRoute: "/agents/listing",
      handoffPayload: {
        naturalLanguageGoal: "基于 Product + SellerSprite Keywords + Competitors 生成 Listing Draft。",
        marketplace: input.marketplace,
        productReport: toJsonValue(input.stageInputs.productReport),
        supplierReport: toJsonValue(input.stageInputs.supplierReport),
      },
    },
    {
      id: "launch",
      name: "Launch Gate",
      agentId: null,
      status: input.launchApproved ? "completed" : "waiting_approval",
      objective: "Human approval gate before launch and paid traffic execution.",
      requiredInputs: ["ApprovedProductProject", "SupplierDecision", "ApprovedListingDraft", "LaunchChecklist"],
      outputContract: ["LaunchApproval", "LaunchChecklistResult"],
      handoffPayload: {
        launchApproved: input.launchApproved,
        requiredChecks: defaultLaunchChecks,
        listingDraft: toJsonValue(input.stageInputs.listingDraft),
      },
    },
    {
      id: "ppc",
      name: "PPC Agent",
      agentId: "ppc",
      status: input.launchApproved ? "ready" : "blocked_until_launch",
      objective: "Diagnose launch PPC with Amazon Ads, SellerSprite keywords, historical PPC, and product data.",
      requiredInputs: ["LaunchApproval", "ProductData", "SellerSpriteKeywords", "HistoricalPPC", "AmazonAdsData"],
      outputContract: ["Diagnosis", "BidRecommendation", "NegativeRecommendation", "CampaignRecommendation", "ApprovalRequest"],
      nextRoute: "/agents/ppc",
      handoffPayload: {
        naturalLanguageGoal: "基于 Launch 后的产品上下文诊断 PPC，并输出审批前建议。",
        marketplace: input.marketplace,
        sku: input.sku ?? null,
        asin: input.asin ?? null,
        productContext: toJsonValue(input.stageInputs.listingDraft ?? input.stageInputs.productReport ?? null),
        launchApproved: input.launchApproved,
      },
    },
  ];

  return {
    planId,
    goal: input.goal,
    marketplace: input.marketplace,
    sku: input.sku,
    asin: input.asin,
    stages,
    launchGate: {
      status: input.launchApproved ? "approved" : "waiting_approval",
      requiredChecks: defaultLaunchChecks,
      approvalRequired: !input.launchApproved,
    },
    generatedAt,
  };
}

const defaultLaunchChecks = [
  "Product project approved",
  "Supplier recommendation reviewed",
  "Listing draft approved",
  "Cost and margin target reviewed",
  "PPC budget and risk policy confirmed",
];

function buildHandoffs(plan: OrchestratorPlan): OrchestratorHandoff[] {
  return [
    handoff("user", "market", plan),
    handoff("market", "product", plan),
    handoff("product", "supplier", plan),
    handoff("supplier", "listing", plan),
    handoff("listing", "launch", plan, true),
    handoff("launch", "ppc", plan, plan.launchGate.approvalRequired),
  ];
}

function handoff(from: "user" | OrchestratorStageId, to: OrchestratorStageId, plan: OrchestratorPlan, requiredApproval = false): OrchestratorHandoff {
  const stage = plan.stages.find((item) => item.id === to);

  return {
    from,
    to,
    agentId: stage?.agentId ?? null,
    route: stage?.nextRoute,
    payload: (stage?.handoffPayload ?? {}) as JsonObject,
    requiredApproval,
    summary: `${from} → ${stage?.name ?? to}`,
  };
}

function applyLaunchGate(plan: OrchestratorPlan, status: "waiting_approval" | "approved"): OrchestratorPlan {
  return {
    ...plan,
    launchGate: {
      ...plan.launchGate,
      status,
      approvalRequired: status !== "approved",
    },
    stages: plan.stages.map((stage) => {
      if (stage.id === "launch") {
        return { ...stage, status: status === "approved" ? "completed" : "waiting_approval" };
      }

      if (stage.id === "ppc") {
        return { ...stage, status: status === "approved" ? "ready" : "blocked_until_launch" };
      }

      return stage;
    }),
  };
}

function updatePpcHandoffStatus(handoffs: OrchestratorHandoff[], launchApproved: boolean) {
  return handoffs.map((item) => {
    if (item.to !== "ppc") return item;

    return {
      ...item,
      requiredApproval: !launchApproved,
      payload: {
        ...item.payload,
        launchApproved,
        status: launchApproved ? "ready" : "blocked_until_launch",
      },
    };
  });
}

function resolveCurrentStage(plan: OrchestratorPlan): OrchestratorStageId {
  const next = plan.stages.find((stage) => stage.status === "ready" || stage.status === "waiting_approval" || stage.status === "blocked_until_launch");

  return next?.id ?? "ppc";
}

function buildNextAction(currentStage: OrchestratorStageId, plan: OrchestratorPlan) {
  const stage = plan.stages.find((item) => item.id === currentStage);

  if (currentStage === "launch") {
    return "Review launch checklist and approve before PPC handoff.";
  }

  if (currentStage === "ppc" && stage?.status === "blocked_until_launch") {
    return "Approve Launch gate before opening PPC Agent.";
  }

  return stage?.nextRoute ? `Open ${stage.name} at ${stage.nextRoute}.` : `Review ${stage?.name ?? currentStage}.`;
}

function extractPlan(output: unknown, fallbackInput: ReturnType<typeof normalizeOrchestratorExecutionInput>, generatedAt: string): OrchestratorPlan {
  const record = extractJsonObject(output);
  const plan = record.plan && isRecord(record.plan) ? record.plan : record;

  if (isRecord(plan) && Array.isArray(plan.stages)) {
    return plan as unknown as OrchestratorPlan;
  }

  return buildPlan(fallbackInput, generatedAt);
}

function extractHandoffs(output: unknown, plan: OrchestratorPlan): OrchestratorHandoff[] {
  const record = extractJsonObject(output);

  if (Array.isArray(record.handoffs)) {
    return record.handoffs as unknown as OrchestratorHandoff[];
  }

  return buildHandoffs(plan);
}

function buildEvidence(input: {
  contextResult: { output?: JsonValue; status: string };
  planResult: { output?: JsonValue; status: string };
  handoffResult: { output?: JsonValue; status: string };
  ppcHandoffResult: { output?: JsonValue; status: string };
  generatedAt: string;
  launchGateOutput: JsonObject;
}) {
  return [
    evidenceItem("Context collected through Tool Gateway", "orchestrator.context.collect", input.contextResult.status, input.generatedAt),
    evidenceItem("Stage plan built through Tool Gateway", "orchestrator.plan.build", input.planResult.status, input.generatedAt),
    evidenceItem("Agent handoffs prepared through Tool Gateway", "orchestrator.handoff.prepare", input.handoffResult.status, input.generatedAt),
    evidenceItem("Launch gate evaluated with human approval boundary", "orchestrator.launch.gate", input.launchGateOutput.launchGate ?? "waiting_approval", input.generatedAt),
    evidenceItem("PPC handoff prepared without direct ad execution", "orchestrator.ppc.handoff", input.ppcHandoffResult.status, input.generatedAt),
  ];
}

function evidenceItem(claim: string, toolId: string, value: JsonValue, timestamp: string) {
  return {
    claim,
    dataSource: "Orchestrator Internal Adapter",
    toolId,
    metric: "workflow-control",
    value,
    timestamp,
  };
}

function buildMemoryItems(input: {
  executionId: string;
  agentId: string;
  plan: OrchestratorPlan;
  handoffs: OrchestratorHandoff[];
  generatedAt: string;
}): AgentMemoryEntry[] {
  return [
    {
      id: `memory-${input.executionId}-orchestrator-plan`,
      agentDefinitionId: input.agentId,
      scope: "workflow",
      scopeKey: input.plan.planId,
      summary: `Orchestration plan for ${input.plan.marketplace}: ${input.plan.goal}`,
      data: toJsonValue({
        plan: input.plan,
        handoffs: input.handoffs,
      }),
      sourceExecutionId: input.executionId,
      confidence: 0.84,
      createdAt: input.generatedAt,
      updatedAt: input.generatedAt,
    },
  ];
}

function buildMissingInputs(snapshot: JsonObject) {
  const missing: string[] = [];
  const stageInputs = isRecord(snapshot.stageInputs) ? snapshot.stageInputs : {};

  if (!stageInputs.marketOpportunity) missing.push("marketOpportunity");
  if (!stageInputs.productReport) missing.push("productReport");
  if (!stageInputs.supplierReport) missing.push("supplierReport");
  if (!stageInputs.listingDraft) missing.push("listingDraft");

  return missing;
}

function extractMarketplaceFromPlan(plan: unknown) {
  return isRecord(plan) && typeof plan.marketplace === "string" ? plan.marketplace : "US";
}

function extractStagePayload(plan: unknown, stageId: OrchestratorStageId) {
  if (!isRecord(plan) || !Array.isArray(plan.stages)) return null;
  const stage = (plan.stages as unknown[]).find((item) => isRecord(item) && item.id === stageId);

  return isRecord(stage) ? stage.handoffPayload ?? null : null;
}

function normalizeStageId(value: unknown): OrchestratorStageId | undefined {
  return value === "market" || value === "product" || value === "supplier" || value === "listing" || value === "launch" || value === "ppc"
    ? value
    : undefined;
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function evaluationCase(
  id: string,
  name: string,
  input: OrchestratorExecutionRequest,
  expectedBehavior: Record<string, JsonValue>,
) {
  const now = "2026-09-03T00:00:00.000Z";

  return {
    id,
    agentDefinitionId: orchestratorAgentId,
    name,
    input: input as unknown as JsonValue,
    expectedBehavior: expectedBehavior as unknown as JsonValue,
    createdAt: now,
    updatedAt: now,
  };
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractJsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return value as JsonObject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

function hashText(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}
