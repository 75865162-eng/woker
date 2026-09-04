export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type AgentExecutionStatus =
  | "CREATED"
  | "QUEUED"
  | "RUNNING"
  | "WAITING_TOOL"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type AgentToolRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AgentApprovalStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "EXPIRED";

export type AgentEventName =
  | "agent.started"
  | "tool.called"
  | "tool.completed"
  | "decision.made"
  | "recommendation.created"
  | "approval.requested"
  | "approval.result"
  | "agent.approval.requested"
  | "agent.approval.granted"
  | "agent.action.executed"
  | "action.executed"
  | "error"
  | "retry"
  | "completed";

export type AgentTraceEventType =
  | "agent started"
  | "tool called"
  | "tool input"
  | "tool output"
  | "decision"
  | "recommendation"
  | "approval requested"
  | "approval result"
  | "action executed"
  | "error"
  | "retry"
  | "completed";

export interface ApprovalPolicy {
  requiredForRiskLevels: AgentToolRiskLevel[];
  timeoutMinutes?: number;
  approverRoles?: string[];
  notes?: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  systemInstructions: string;
  goals: string[];
  skills: string[];
  tools: string[];
  permissions: string[];
  inputSchema: unknown;
  outputSchema: unknown;
  approvalPolicy: ApprovalPolicy;
  enabled: boolean;
}

export interface AgentContext {
  company?: unknown;
  workspace?: unknown;
  user?: unknown;
  product?: unknown;
  sku?: string;
  marketplace?: string;
  asin?: string;
  project?: unknown;
  task?: unknown;
  historicalData?: unknown;
  currentData?: unknown;
  [key: string]: unknown;
}

export interface AgentToolDefinition {
  toolId: string;
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  permission: string[];
  riskLevel: AgentToolRiskLevel;
  timeout: number;
  retryPolicy: RetryPolicy;
  adapterId: string;
  enabled: boolean;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  multiplier?: number;
  retryableErrors?: string[];
}

export interface AgentToolCall {
  id: string;
  executionId: string;
  toolId: string;
  toolName: string;
  adapterId: string;
  riskLevel: AgentToolRiskLevel;
  permission: string[];
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "APPROVAL_REQUIRED";
  input: JsonValue;
  redactedInput: JsonValue;
  output?: JsonValue;
  redactedOutput?: JsonValue;
  latencyMs?: number;
  retryCount: number;
  error?: AgentError;
}

export interface AgentTraceEvent {
  id: string;
  executionId: string;
  sequence: number;
  type: AgentTraceEventType;
  message?: string;
  payload?: JsonValue;
  redactedPayload?: JsonValue;
  createdAt: string;
}

export interface AgentEvent {
  id: string;
  executionId: string;
  type: AgentEventName;
  payload: JsonValue;
  createdAt: string;
}

export interface AgentDecision {
  summary: string;
  rationale?: string;
  confidence?: number;
  nextStep?: string;
}

export interface AgentRecommendation {
  summary: string;
  evidence?: unknown;
  risks?: string[];
  confidence?: number;
  nextAction?: string;
}

export interface AgentAction {
  type: string;
  target?: string;
  payload?: JsonValue;
}

export interface AgentApproval {
  id: string;
  executionId: string;
  toolCallId?: string;
  riskLevel: AgentToolRiskLevel;
  status: AgentApprovalStatus;
  recommendation: AgentRecommendation;
  action: AgentAction;
  humanDecision?: {
    decision: "APPROVED" | "REJECTED" | "EXPIRED";
    decidedByUserId?: string;
    decidedAt?: string;
    reason?: string;
  };
  requestedByUserId?: string;
  decidedByUserId?: string;
  requestedAt: string;
  decidedAt?: string;
  expiresAt?: string;
}

export interface AgentMemoryEntry {
  id: string;
  agentDefinitionId?: string;
  scope: string;
  scopeKey: string;
  summary: string;
  data: JsonValue;
  sourceExecutionId?: string;
  confidence: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentExecution {
  id: string;
  organizationId: string;
  agentDefinitionId: string;
  requestedByUserId?: string;
  workspaceId: string;
  accountId: string;
  marketplace: string;
  sku?: string;
  asin?: string;
  projectId?: string;
  taskId?: string;
  status: AgentExecutionStatus;
  input: JsonValue;
  context: AgentContext;
  recommendation?: AgentRecommendation;
  decision?: AgentDecision;
  output?: JsonValue;
  approvalStatus?: AgentApprovalStatus;
  tokenUsage: number;
  toolCallCount: number;
  retryCount: number;
  costCents: number;
  error?: AgentError;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentExecutionSummary {
  id: string;
  agentDefinitionId: string;
  agentName: string;
  status: AgentExecutionStatus;
  createdAt: string;
  finishedAt?: string;
  tokenUsage: number;
  toolCallCount: number;
  approvalStatus?: AgentApprovalStatus;
}

export interface AgentCenterItem extends AgentDefinition {
  recentExecutionCount: number;
  successRate: number;
  tokenUsage: number;
  toolCallCount: number;
  lastExecutionAt?: string;
  lastStatus?: AgentExecutionStatus;
  lastExecutionId?: string;
}

export interface AgentExecutionDetail extends AgentExecution {
  traces: AgentTraceEvent[];
  events: AgentEvent[];
  toolCalls: AgentToolCall[];
  approvals: AgentApproval[];
}

export interface AgentEvaluationCase {
  id: string;
  agentDefinitionId?: string;
  name: string;
  input: JsonValue;
  expectedBehavior: JsonValue;
  createdAt: string;
  updatedAt: string;
}

export interface AgentEvaluationRun {
  id: string;
  evaluationCaseId: string;
  executionId?: string;
  input: JsonValue;
  expectedBehavior: JsonValue;
  actualBehavior: JsonValue;
  toolCalls: JsonValue;
  finalOutput: JsonValue;
  score?: number;
  errors?: JsonValue;
  createdAt: string;
  updatedAt: string;
}

export interface AgentExecutionCreateInput {
  agentId: string;
  context: AgentContext;
  input: JsonValue;
  requestedByUserId?: string;
  workspaceId?: string;
  accountId?: string;
  marketplace?: string;
  sku?: string;
  asin?: string;
  projectId?: string;
  taskId?: string;
}

export interface AgentExecutionRunInput extends AgentExecutionCreateInput {
  traceRedactionKeys?: string[];
}

export interface ToolExecutionInput {
  executionId: string;
  toolId: string;
  input: JsonValue;
  context: AgentContext;
  approval?: AgentApproval | null;
}

export interface ToolExecutionResult {
  output: JsonValue;
  latencyMs: number;
}

export interface ToolGatewayResult {
  status: "SUCCEEDED" | "APPROVAL_REQUIRED" | "DENIED" | "FAILED";
  output?: JsonValue;
  approval?: AgentApproval;
  error?: AgentError;
  latencyMs?: number;
}

export interface AgentError {
  code: string;
  message: string;
  retryable?: boolean;
  detail?: JsonValue;
}

export interface AgentRuntimeExecutorResult {
  recommendation?: AgentRecommendation;
  decision?: AgentDecision;
  output?: JsonValue;
  actions?: AgentAction[];
  approvals?: AgentApproval[];
  toolCallIds?: string[];
  tokenUsage?: number;
  costCents?: number;
  memoryItems?: AgentMemoryEntry[];
}

export interface AgentRuntimeExecutor {
  (input: {
    execution: AgentExecution;
    definition: AgentDefinition;
    context: AgentContext;
    callTool: (toolId: string, input: JsonValue) => Promise<ToolGatewayResult>;
    requestApproval: (approval: Omit<AgentApproval, "id" | "status" | "requestedAt">) => Promise<AgentApproval>;
    recordTrace: (type: AgentTraceEventType, message?: string, payload?: JsonValue) => void;
    emitEvent: (type: AgentEventName, payload: JsonValue) => void;
  }): Promise<AgentRuntimeExecutorResult>;
}

export interface AgentToolAdapter {
  adapterId: string;
  execute(input: ToolExecutionInput): Promise<ToolExecutionResult>;
}

export interface AgentRuntimeOptions {
  definitions: AgentDefinition[];
  tools: AgentToolDefinition[];
  adapters: AgentToolAdapter[];
  clock?: () => Date;
  approvalPolicy?: ApprovalPolicy;
}
