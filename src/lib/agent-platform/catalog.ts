import type {
  AgentCenterItem,
  AgentDefinition,
  AgentExecutionSummary,
  AgentToolDefinition,
  ApprovalPolicy,
  RetryPolicy,
} from "./types";

type PrismaAgentDefinition = {
  id: string;
  name: string;
  description: string;
  version: string;
  systemInstructions: string;
  goals: unknown;
  skills: unknown;
  tools: unknown;
  permissions: unknown;
  inputSchema: unknown;
  outputSchema: unknown;
  approvalPolicy: unknown;
  enabled: boolean;
};

type PrismaAgentTool = {
  toolId: string;
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  permission: unknown;
  riskLevel: string;
  timeoutMs: number;
  retryPolicy: unknown;
  adapterType: string;
  enabled: boolean;
};

type PrismaAgentExecution = {
  id: string;
  agentDefinitionId: string;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
  tokenUsage: number;
  toolCallCount: number;
  approvalStatus: string | null;
};

export function toAgentDefinition(record: PrismaAgentDefinition): AgentDefinition {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    version: record.version,
    systemInstructions: record.systemInstructions,
    goals: toStringArray(record.goals),
    skills: toStringArray(record.skills),
    tools: toStringArray(record.tools),
    permissions: toStringArray(record.permissions),
    inputSchema: record.inputSchema,
    outputSchema: record.outputSchema,
    approvalPolicy: normalizeApprovalPolicy(record.approvalPolicy),
    enabled: record.enabled,
  };
}

export function toAgentToolDefinition(record: PrismaAgentTool): AgentToolDefinition {
  return {
    toolId: record.toolId,
    name: record.name,
    description: record.description,
    inputSchema: record.inputSchema,
    outputSchema: record.outputSchema,
    permission: toStringArray(record.permission),
    riskLevel: normalizeRiskLevel(record.riskLevel),
    timeout: record.timeoutMs,
    retryPolicy: normalizeRetryPolicy(record.retryPolicy),
    adapterId: record.adapterType,
    enabled: record.enabled,
  };
}

export function summarizeAgentExecutions(
  definitions: AgentDefinition[],
  executions: PrismaAgentExecution[],
): AgentCenterItem[] {
  const executionByAgent = new Map<string, PrismaAgentExecution[]>();

  for (const execution of executions) {
    const list = executionByAgent.get(execution.agentDefinitionId) ?? [];
    list.push(execution);
    executionByAgent.set(execution.agentDefinitionId, list);
  }

  return definitions.map((definition) => {
    const agentExecutions = executionByAgent.get(definition.id) ?? [];
    const completed = agentExecutions.filter((item) => item.status === "COMPLETED").length;
    const tokenUsage = agentExecutions.reduce((total, item) => total + item.tokenUsage, 0);
    const toolCallCount = agentExecutions.reduce((total, item) => total + item.toolCallCount, 0);
    const lastExecution = agentExecutions[0];

    return {
      ...definition,
      recentExecutionCount: agentExecutions.length,
      successRate: agentExecutions.length ? Math.round((completed / agentExecutions.length) * 100) : 0,
      tokenUsage,
      toolCallCount,
      lastExecutionAt: lastExecution?.createdAt.toISOString(),
      lastStatus: normalizeExecutionStatus(lastExecution?.status),
      lastExecutionId: lastExecution?.id,
    };
  });
}

export function mapExecutionSummary(
  execution: PrismaAgentExecution,
  agentName: string,
): AgentExecutionSummary {
  return {
    id: execution.id,
    agentDefinitionId: execution.agentDefinitionId,
    agentName,
    status: normalizeExecutionStatus(execution.status),
    createdAt: execution.createdAt.toISOString(),
    finishedAt: execution.finishedAt?.toISOString(),
    tokenUsage: execution.tokenUsage,
    toolCallCount: execution.toolCallCount,
    approvalStatus: normalizeApprovalStatus(execution.approvalStatus),
  };
}

export function normalizeExecutionStatus(status?: string | null) {
  if (
    status === "CREATED" ||
    status === "QUEUED" ||
    status === "RUNNING" ||
    status === "WAITING_TOOL" ||
    status === "WAITING_APPROVAL" ||
    status === "COMPLETED" ||
    status === "FAILED" ||
    status === "CANCELLED"
  ) {
    return status;
  }

  return "FAILED";
}

export function normalizeApprovalStatus(status?: string | null) {
  if (status === "REQUESTED" || status === "APPROVED" || status === "REJECTED" || status === "EXPIRED") {
    return status;
  }

  return undefined;
}

function normalizeRiskLevel(value: string): AgentToolDefinition["riskLevel"] {
  if (value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL") {
    return value;
  }

  return "LOW";
}

function normalizeRetryPolicy(value: unknown): RetryPolicy {
  if (!value || typeof value !== "object") {
    return { maxAttempts: 1, backoffMs: 0 };
  }

  const record = value as Record<string, unknown>;

  return {
    maxAttempts: typeof record.maxAttempts === "number" ? Math.max(1, Math.floor(record.maxAttempts)) : 1,
    backoffMs: typeof record.backoffMs === "number" ? Math.max(0, Math.floor(record.backoffMs)) : 0,
    multiplier: typeof record.multiplier === "number" ? record.multiplier : undefined,
    retryableErrors: Array.isArray(record.retryableErrors) ? record.retryableErrors.map(String).filter(Boolean) : undefined,
  };
}

function normalizeApprovalPolicy(value: unknown): ApprovalPolicy {
  if (!value || typeof value !== "object") {
    return { requiredForRiskLevels: ["HIGH", "CRITICAL"] };
  }

  const record = value as Record<string, unknown>;

  return {
    requiredForRiskLevels: Array.isArray(record.requiredForRiskLevels)
      ? record.requiredForRiskLevels
          .map(String)
          .filter((item): item is "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" => item === "LOW" || item === "MEDIUM" || item === "HIGH" || item === "CRITICAL")
      : ["HIGH", "CRITICAL"],
    timeoutMinutes: typeof record.timeoutMinutes === "number" ? record.timeoutMinutes : undefined,
    approverRoles: Array.isArray(record.approverRoles) ? record.approverRoles.map(String).filter(Boolean) : undefined,
    notes: typeof record.notes === "string" ? record.notes : undefined,
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.map(String).map((item) => item.trim()).filter(Boolean);
}
