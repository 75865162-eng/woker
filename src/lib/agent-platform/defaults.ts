import type {
  AgentDefinition,
  AgentToolAdapter,
  AgentToolDefinition,
  AgentContext,
  JsonObject,
  JsonValue,
  ToolExecutionInput,
  ToolExecutionResult,
} from "./types";
import { marketAgentDefinition, marketToolDefinitions } from "./market";
import { listingAgentDefinition, listingToolDefinitions } from "./listing";
import { productAgentDefinition, productToolDefinitions } from "./product";
import { supplierAgentDefinition, supplierToolDefinitions } from "./supplier";
import { ppcAgentDefinition, ppcToolDefinitions } from "./ppc";
import { amazonAdsToolDefinitions } from "./amazon-ads";
import { orchestratorAgentDefinition, orchestratorToolDefinitions } from "./orchestrator";

export const agentPlatformModuleId = "agents";
export const agentPlatformRoute = "/agents";

export const defaultAgentDefinitions: AgentDefinition[] = [
  {
    id: "platform-runtime-core",
    name: "Agent Runtime Core",
    description: "Platform runtime template for execution, approval, trace, and tool gateway validation.",
    version: "v1.0.0",
    systemInstructions:
      "You are the platform runtime core. Do not perform business actions. Focus on safe execution, traceability, and approval-aware orchestration.",
    goals: [
      "Validate runtime boundaries",
      "Protect tool access",
      "Record trace and audit data",
      "Support approval-gated action flow",
    ],
    skills: ["orchestration", "trace", "audit", "approval", "tool-routing"],
    tools: ["platform.context.snapshot"],
    permissions: ["agent.platform.read", "agent.platform.execute", "agent.platform.audit"],
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        requestedToolId: { type: "string" },
        requiresApproval: { type: "boolean" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        recommendation: { type: "object" },
        output: { type: "object" },
      },
    },
    approvalPolicy: {
      requiredForRiskLevels: ["HIGH", "CRITICAL"],
      timeoutMinutes: 120,
      approverRoles: ["owner", "database_admin", "operations_manager", "operations_supervisor"],
    },
    enabled: true,
  },
  marketAgentDefinition,
  listingAgentDefinition,
  productAgentDefinition,
  supplierAgentDefinition,
  ppcAgentDefinition,
  orchestratorAgentDefinition,
];

export const defaultToolDefinitions: AgentToolDefinition[] = [
  {
    toolId: "platform.context.snapshot",
    name: "Context Snapshot",
    description: "Return a sanitized snapshot of the current agent context.",
    inputSchema: {
      type: "object",
      properties: {
        includeKeys: { type: "array" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        context: { type: "object" },
      },
    },
    permission: ["agent.platform.read"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: "platform-tool-adapter",
    enabled: true,
  },
  ...marketToolDefinitions,
  ...listingToolDefinitions,
  ...productToolDefinitions,
  ...supplierToolDefinitions,
  ...ppcToolDefinitions,
  ...amazonAdsToolDefinitions,
  ...orchestratorToolDefinitions,
];

export function createPlatformToolAdapter(clock: () => Date = () => new Date()): AgentToolAdapter {
  return {
    adapterId: "platform-tool-adapter",
    async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
      const startedAt = clock().getTime();
      const includeKeys = Array.isArray((input.input as Record<string, unknown>)?.includeKeys)
        ? ((input.input as Record<string, unknown>).includeKeys as string[])
        : undefined;

      const context = input.context ?? {};
      const snapshot = includeKeys?.length
        ? Object.fromEntries(includeKeys.map((key) => [key, toJsonValue(context[key])]))
        : sanitizeContext(context);

      return {
        output: {
          context: snapshot,
          executionId: input.executionId,
          toolId: input.toolId,
          generatedAt: clock().toISOString(),
        } as JsonValue,
        latencyMs: Math.max(clock().getTime() - startedAt, 0),
      };
    },
  };
}

function sanitizeContext(context: AgentContext): JsonObject {
  return {
    company: toJsonValue(context.company),
    workspace: toJsonValue(context.workspace),
    user: toJsonValue(context.user),
    product: toJsonValue(context.product),
    sku: context.sku ?? null,
    marketplace: context.marketplace ?? null,
    asin: context.asin ?? null,
    project: toJsonValue(context.project),
    task: toJsonValue(context.task),
    historicalData: toJsonValue(context.historicalData),
    currentData: toJsonValue(context.currentData),
  };
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toJsonValue(item)]),
    );
  }

  return null;
}
