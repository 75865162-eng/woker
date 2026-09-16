import { createApprovalRequest, resolveApproval } from "./approval";
import { createEvent, createTraceEvent, redactError } from "./trace";
import { createToolGateway, type ToolGateway } from "./tool-gateway";
import type {
  AgentApproval,
  AgentDefinition,
  AgentEvent,
  AgentEventName,
  AgentError,
  AgentExecution,
  AgentExecutionRunInput,
  AgentMemoryEntry,
  AgentRuntimeExecutor,
  AgentRuntimeExecutorResult,
  AgentToolAdapter,
  AgentToolCall,
  AgentToolDefinition,
  AgentTraceEvent,
  JsonValue,
} from "./types";

export interface AgentRuntimeRunResult {
  execution: AgentExecution;
  traces: AgentTraceEvent[];
  events: AgentEvent[];
  toolCalls: AgentToolCall[];
  approvals: AgentApproval[];
  memoryItems: AgentMemoryEntry[];
}

export interface AgentRuntime {
  run(input: AgentExecutionRunInput & { executor: AgentRuntimeExecutor }): Promise<AgentRuntimeRunResult>;
  finalizeApproval(input: {
    execution: AgentExecution;
    approval: AgentApproval;
    decision?: "APPROVED" | "REJECTED" | "EXPIRED";
    actionOutput?: JsonValue;
    actionSummary?: string;
    clock?: () => Date;
  }): AgentRuntimeRunResult;
  toolGateway: ToolGateway;
  getDefinition(agentId: string): AgentDefinition | undefined;
}

export function createAgentRuntime(options: {
  definitions: AgentDefinition[];
  tools: AgentToolDefinition[];
  adapters: AgentToolAdapter[];
  clock?: () => Date;
}): AgentRuntime {
  const definitionById = new Map(options.definitions.map((definition) => [definition.id, definition]));
  const toolGateway = createToolGateway({
    tools: options.tools,
    adapters: options.adapters,
    clock: options.clock,
  });
  const clock = options.clock ?? (() => new Date());

  return {
    toolGateway,
    getDefinition(agentId: string) {
      return definitionById.get(agentId);
    },
    async run(input) {
      const definition = definitionById.get(input.agentId);
      if (!definition || !definition.enabled) {
        throw new Error(`Agent ${input.agentId} is not available.`);
      }

      const now = clock();
      const execution: AgentExecution = {
        id: `execution-${definition.id}-${now.getTime()}`,
        organizationId: input.context.company && typeof input.context.company === "object" && "organizationId" in input.context.company
          ? String((input.context.company as Record<string, unknown>).organizationId ?? "")
          : "unknown",
        agentDefinitionId: definition.id,
        requestedByUserId: input.requestedByUserId,
        workspaceId: input.workspaceId ?? "default",
        accountId: input.accountId ?? "",
        marketplace: input.marketplace ?? input.context.marketplace ?? "",
        sku: input.sku ?? input.context.sku,
        asin: input.asin ?? input.context.asin,
        projectId: input.projectId,
        taskId: input.taskId,
        status: "CREATED",
        input: input.input,
        context: input.context,
        tokenUsage: 0,
        toolCallCount: 0,
        retryCount: 0,
        costCents: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      const traces: AgentTraceEvent[] = [];
      const events: AgentEvent[] = [];
      const toolCalls: AgentToolCall[] = [];
      const approvals: AgentApproval[] = [];
      const memoryItems: AgentMemoryEntry[] = [];
      let sequence = 0;

      const recordTrace = (type: AgentTraceEvent["type"], message?: string, payload?: JsonValue) => {
        const trace = createTraceEvent({
          executionId: execution.id,
          sequence: ++sequence,
          type,
          message,
          payload,
          redactionKeys: input.traceRedactionKeys,
          createdAt: clock(),
        });
        traces.push(trace);
        return trace;
      };

      const emitEvent = (type: AgentEventName, payload: JsonValue) => {
        const event = createEvent({
          executionId: execution.id,
          type,
          payload,
          createdAt: clock(),
        });
        events.push(event);
        return event;
      };

      execution.status = "QUEUED";
      recordTrace("agent started", "Execution queued", { agentId: definition.id });
      emitEvent("agent.started", { agentId: definition.id, executionId: execution.id });

      execution.status = "RUNNING";
      execution.startedAt = clock().toISOString();
      recordTrace("agent started", "Execution running", { agentId: definition.id });

      try {
        const result = await input.executor({
          execution,
          definition,
          context: input.context,
          callTool: async (toolId: string, toolInput: JsonValue) => {
            execution.status = "WAITING_TOOL";
            recordTrace("tool called", `Tool ${toolId} called`, { toolId });
            recordTrace("tool input", `Tool ${toolId} input`, toolInput);
            emitEvent("tool.called", { toolId, executionId: execution.id } as unknown as JsonValue);

            const toolResult = await toolGateway.invoke({
              agent: definition,
              executionId: execution.id,
              context: input.context,
              toolId,
              input: toolInput,
              traceRedactionKeys: input.traceRedactionKeys,
            });

            if (toolResult.toolCall) {
              toolCalls.push(toolResult.toolCall);
            }

            if (toolResult.status === "APPROVAL_REQUIRED" && toolResult.approval) {
              approvals.push(toolResult.approval);
              execution.status = "WAITING_APPROVAL";
              execution.approvalStatus = toolResult.approval.status;
              recordTrace("approval requested", "Approval required for tool execution", toolResult.approval as unknown as JsonValue);
              emitEvent("agent.approval.requested", toolResult.approval as unknown as JsonValue);
            } else if (toolResult.status === "SUCCEEDED") {
              execution.status = "RUNNING";
              recordTrace("tool output", `Tool ${toolId} output`, toolResult.output);
              emitEvent("tool.completed", { toolId, executionId: execution.id, output: toolResult.output } as unknown as JsonValue);
            } else if (toolResult.status === "FAILED" && toolResult.error) {
              execution.status = "RUNNING";
              recordTrace("error", `Tool ${toolId} failed`, redactError(toolResult.error));
              emitEvent("error", { toolId, executionId: execution.id, error: redactError(toolResult.error) } as unknown as JsonValue);
            } else if (toolResult.status === "DENIED" && toolResult.error) {
              execution.status = "RUNNING";
              recordTrace("error", `Tool ${toolId} denied`, redactError(toolResult.error));
              emitEvent("error", { toolId, executionId: execution.id, error: redactError(toolResult.error) } as unknown as JsonValue);
            }

            execution.toolCallCount = toolCalls.length;
            return toolResult;
          },
          requestApproval: async (approvalInput) => {
            const approval = createApprovalRequest({
              ...approvalInput,
              requestedAt: clock(),
              expiresAt: approvalInput.expiresAt ? new Date(approvalInput.expiresAt) : undefined,
            });
            approvals.push(approval);
            execution.status = "WAITING_APPROVAL";
            execution.approvalStatus = approval.status;
            recordTrace("approval requested", approval.recommendation.summary, approval as unknown as JsonValue);
            emitEvent("approval.requested", approval as unknown as JsonValue);
            return approval;
          },
          recordTrace,
          emitEvent,
        });

        applyRuntimeResult(execution, result);
        execution.toolCallCount = toolCalls.length;
        execution.updatedAt = clock().toISOString();
        if (result.memoryItems?.length) {
          memoryItems.push(...result.memoryItems);
        }

        if (approvals.some((approval) => approval.status === "REQUESTED")) {
          execution.status = "WAITING_APPROVAL";
        } else {
          execution.status = "COMPLETED";
          execution.finishedAt = clock().toISOString();
          recordTrace("completed", "Execution completed", execution.output ?? result.output ?? {});
          emitEvent("completed", { executionId: execution.id, agentId: definition.id } as unknown as JsonValue);
        }

        return {
          execution,
          traces,
          events,
          toolCalls,
          approvals,
          memoryItems,
        };
      } catch (error) {
        execution.status = "FAILED";
        execution.error = normalizeExecutionError(error);
        execution.finishedAt = clock().toISOString();
        execution.updatedAt = clock().toISOString();
        recordTrace("error", "Execution failed", execution.error as unknown as JsonValue);
        emitEvent("error", { executionId: execution.id, error: execution.error } as unknown as JsonValue);

        return {
          execution,
          traces,
          events,
          toolCalls,
          approvals,
          memoryItems,
        };
      }
    },
    finalizeApproval(input) {
      const approval = resolveApproval({
        approval: input.approval,
        decision: input.decision ?? "APPROVED",
        decidedAt: input.clock?.() ?? clock(),
      });
      const execution: AgentExecution = {
        ...input.execution,
        approvalStatus: approval.status,
        status: approval.status === "APPROVED" ? "COMPLETED" : "CANCELLED",
        output: approval.status === "APPROVED" ? input.actionOutput ?? input.execution.output : input.execution.output,
        finishedAt: (input.clock ?? clock)().toISOString(),
        updatedAt: (input.clock ?? clock)().toISOString(),
      };
      const traces = [
        createTraceEvent({
          executionId: execution.id,
          sequence: 1,
          type: "approval result",
          message: approval.status,
          payload: approval as unknown as JsonValue,
          createdAt: input.clock?.() ?? clock(),
        }),
        createTraceEvent({
          executionId: execution.id,
          sequence: 2,
          type: "action executed",
          message: input.actionSummary ?? "Approved action executed.",
          payload: input.actionOutput ?? {},
          createdAt: input.clock?.() ?? clock(),
        }),
        createTraceEvent({
          executionId: execution.id,
          sequence: 3,
          type: "completed",
          message: "Execution completed after approval",
          payload: execution.output ?? {},
          createdAt: input.clock?.() ?? clock(),
        }),
      ];
      const events = [
        createEvent({
          executionId: execution.id,
          type: "approval.result",
          payload: approval as unknown as JsonValue,
          createdAt: input.clock?.() ?? clock(),
        }),
        createEvent({
          executionId: execution.id,
          type: "action.executed",
          payload: input.actionOutput ?? {},
          createdAt: input.clock?.() ?? clock(),
        }),
        createEvent({
          executionId: execution.id,
          type: "completed",
          payload: execution.output ?? {},
          createdAt: input.clock?.() ?? clock(),
        }),
      ];

      return {
        execution,
        traces,
        events,
        toolCalls: [],
        approvals: [approval],
        memoryItems: [],
      };
    },
  };
}

function applyRuntimeResult(execution: AgentExecution, result: AgentRuntimeExecutorResult) {
  if (result.recommendation) {
    execution.recommendation = result.recommendation;
  }

  if (result.decision) {
    execution.decision = result.decision;
  }

  if (result.output !== undefined) {
    execution.output = result.output;
  }

  if (typeof result.tokenUsage === "number") {
    execution.tokenUsage = result.tokenUsage;
  }

  if (typeof result.costCents === "number") {
    execution.costCents = result.costCents;
  }
}

function normalizeExecutionError(error: unknown): AgentError {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return {
      code: String((error as { code?: unknown }).code ?? "UNKNOWN"),
      message: String((error as { message?: unknown }).message ?? "Execution failed."),
      retryable: (error as { retryable?: unknown }).retryable !== false,
      detail: redactError(error),
    };
  }

  if (error instanceof Error) {
    return {
      code: error.name || "ERROR",
      message: error.message || "Execution failed.",
      retryable: true,
    };
  }

  return {
    code: "UNKNOWN",
    message: String(error ?? "Execution failed."),
    retryable: true,
  };
}
