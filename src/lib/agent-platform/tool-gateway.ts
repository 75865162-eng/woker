import { createApprovalRequest, requiresApproval } from "./approval";
import { canAgentUseTool } from "./permissions";
import { redactJson } from "./trace";
import type {
  AgentApproval,
  AgentDefinition,
  AgentToolAdapter,
  AgentToolCall,
  AgentToolDefinition,
  AgentContext,
  AgentError,
  JsonValue,
  ToolGatewayResult,
} from "./types";

export interface ToolGateway {
  invoke(input: {
    agent: AgentDefinition;
    executionId: string;
    context: AgentContext;
    toolId: string;
    input: JsonValue;
    approval?: AgentApproval | null;
    traceRedactionKeys?: string[];
  }): Promise<ToolGatewayResult & { toolCall?: AgentToolCall }>;
}

export function createToolGateway(input: {
  tools: AgentToolDefinition[];
  adapters: AgentToolAdapter[];
  clock?: () => Date;
}): ToolGateway {
  const toolById = new Map(input.tools.map((tool) => [tool.toolId, tool]));
  const adapterById = new Map(input.adapters.map((adapter) => [adapter.adapterId, adapter]));
  const clock = input.clock ?? (() => new Date());

  return {
    async invoke({ agent, executionId, context, toolId, input: toolInput, approval, traceRedactionKeys }) {
      const tool = toolById.get(toolId);

      if (!tool || !tool.enabled) {
        return {
          status: "DENIED",
          error: normalizeError("TOOL_NOT_FOUND", `Tool ${toolId} is not available.`, false),
        };
      }

      if (!canAgentUseTool(agent, tool)) {
        return {
          status: "DENIED",
          error: normalizeError("PERMISSION_DENIED", `Agent ${agent.id} cannot use tool ${toolId}.`, false),
        };
      }

      const needsApproval = requiresApproval(agent.approvalPolicy, tool.riskLevel);
      if (needsApproval && !approval) {
        const requestedApproval = createApprovalRequest({
          executionId,
          riskLevel: tool.riskLevel,
          recommendation: {
            summary: `Tool ${tool.name} requires human approval before execution.`,
            risks: [`${tool.riskLevel} risk tool call`],
            confidence: 1,
          },
          action: {
            type: "tool.execute",
            target: tool.toolId,
            payload: redactJson(toolInput, traceRedactionKeys) ?? {},
          },
        });

        return {
          status: "APPROVAL_REQUIRED",
          approval: requestedApproval,
        };
      }

      const adapter = adapterById.get(tool.adapterId);
      if (!adapter) {
        return {
          status: "FAILED",
          error: normalizeError("ADAPTER_NOT_FOUND", `Adapter ${tool.adapterId} is not available.`, false),
        };
      }

      const toolCall: AgentToolCall = {
        id: `toolcall-${executionId}-${toolId}-${clock().getTime()}`,
        executionId,
        toolId,
        toolName: tool.name,
        adapterId: tool.adapterId,
        riskLevel: tool.riskLevel,
        permission: tool.permission,
        status: "QUEUED",
        input: toolInput,
        redactedInput: redactJson(toolInput, traceRedactionKeys) ?? {},
        retryCount: 0,
      };

      const retryPolicy = tool.retryPolicy;
      const timeoutMs = tool.timeout;
      const maxAttempts = Math.max(1, retryPolicy.maxAttempts);
      let lastError: AgentError | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          toolCall.status = "RUNNING";
          toolCall.retryCount = attempt - 1;

          const result = await withTimeout(
            adapter.execute({
              executionId,
              toolId,
              input: toolInput,
              context,
              approval,
            }),
            timeoutMs,
          );

          toolCall.status = "SUCCEEDED";
          toolCall.output = result.output;
          toolCall.redactedOutput = redactJson(result.output, traceRedactionKeys);
          toolCall.latencyMs = result.latencyMs;

          return {
            status: "SUCCEEDED",
            output: result.output,
            latencyMs: result.latencyMs,
            toolCall,
          };
        } catch (error) {
          lastError = normalizeCaughtError(error);
          toolCall.error = lastError;
          toolCall.status = "FAILED";

          if (attempt < maxAttempts && isRetryableError(lastError, retryPolicy.retryableErrors)) {
            continue;
          }

          return {
            status: "FAILED",
            error: lastError,
            toolCall,
          };
        }
      }

      return {
        status: "FAILED",
        error: lastError ?? normalizeError("UNKNOWN", "Tool execution failed.", true),
        toolCall,
      };
    },
  };
}

function normalizeCaughtError(error: unknown): AgentError {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const candidate = error as AgentError;

    return {
      code: candidate.code || "UNKNOWN",
      message: candidate.message || "Tool execution failed.",
      retryable: candidate.retryable ?? true,
      detail: candidate.detail,
    };
  }

  if (error instanceof Error) {
    return {
      code: error.name || "ERROR",
      message: error.message || "Tool execution failed.",
      retryable: true,
    };
  }

  return {
    code: "UNKNOWN",
    message: String(error ?? "Tool execution failed."),
    retryable: true,
  };
}

function normalizeError(code: string, message: string, retryable: boolean): AgentError {
  return { code, message, retryable };
}

function isRetryableError(error: AgentError, retryableErrors?: string[]) {
  if (error.retryable === false) return false;
  if (!retryableErrors?.length) return Boolean(error.retryable ?? true);

  return retryableErrors.includes(error.code) || retryableErrors.some((item) => error.message.includes(item));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return promise;

  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        normalizeError("TIMEOUT", `Tool execution exceeded ${timeoutMs}ms.`, true),
      );
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}
