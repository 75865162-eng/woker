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
  invokeMcp<T>(input: {
    toolId: string;
    input: unknown;
    inputSchema: unknown;
    outputSchema: unknown;
    timeoutMs: number;
    signal?: AbortSignal;
    beforeInvalidInput?: () => void | Promise<void>;
    execute: (signal: AbortSignal) => Promise<T>;
  }): Promise<T>;
}

export class GatewayInvocationError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "INVALID_OUTPUT" | "TIMEOUT" | "CANCELLED" | "INVALID_GATEWAY_CONFIG", message: string) {
    super(message);
    this.name = "GatewayInvocationError";
  }
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
    async invokeMcp<T>({ toolId, input: toolInput, inputSchema, outputSchema, timeoutMs, signal, beforeInvalidInput, execute }: {
      toolId: string;
      input: unknown;
      inputSchema: unknown;
      outputSchema: unknown;
      timeoutMs: number;
      signal?: AbortSignal;
      beforeInvalidInput?: () => void | Promise<void>;
      execute: (signal: AbortSignal) => Promise<T>;
    }) {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
        throw new GatewayInvocationError("INVALID_GATEWAY_CONFIG", "Gateway execution budget is invalid.");
      }
      const inputIssues = validateJsonSchema(toolInput, inputSchema);
      if (inputIssues.length) {
        await beforeInvalidInput?.();
        throw new GatewayInvocationError("INVALID_INPUT", `Tool ${toolId} input does not match its registered schema.`);
      }
      if (signal?.aborted) throw new GatewayInvocationError("CANCELLED", "Tool execution was cancelled.");

      const controller = new AbortController();
      let settle!: (error: GatewayInvocationError) => void;
      const interrupted = new Promise<never>((_, reject) => {
        settle = reject;
      });
      const cancel = () => {
        controller.abort();
        settle(new GatewayInvocationError("CANCELLED", "Tool execution was cancelled."));
      };
      const timer = setTimeout(() => {
        controller.abort();
        settle(new GatewayInvocationError("TIMEOUT", `Tool ${toolId} exceeded its execution budget.`));
      }, timeoutMs);
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        const work = Promise.resolve().then(() => execute(controller.signal));
        const output = await Promise.race([work, interrupted]);
        if (controller.signal.aborted) throw new GatewayInvocationError("CANCELLED", "Tool execution was cancelled.");
        const outputIssues = validateJsonSchema(output, outputSchema);
        if (outputIssues.length) throw new GatewayInvocationError("INVALID_OUTPUT", `Tool ${toolId} output does not match its registered schema.`);
        return output;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    },
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

type JsonSchemaRecord = Record<string, unknown>;
function validateJsonSchema(value: unknown, schemaValue: unknown, path = "$", depth = 0): string[] {
  if (!schemaValue || typeof schemaValue !== "object" || Array.isArray(schemaValue) || depth > 32) return [path];
  const schema = schemaValue as JsonSchemaRecord;
  const issues: string[] = [];
  const typeMatches: (type: unknown, candidate: unknown) => boolean = (type, candidate) => {
    if (Array.isArray(type)) return type.some(item => typeMatches(item, candidate));
    switch (type) {
      case "object": return !!candidate && typeof candidate === "object" && !Array.isArray(candidate);
      case "array": return Array.isArray(candidate);
      case "string": return typeof candidate === "string";
      case "integer": return typeof candidate === "number" && Number.isSafeInteger(candidate);
      case "number": return typeof candidate === "number" && Number.isFinite(candidate);
      case "boolean": return typeof candidate === "boolean";
      case "null": return candidate === null;
      default: return true;
    }
  };
  if (!typeMatches(schema.type, value)) return [path];
  if (schema.const !== undefined && value !== schema.const) issues.push(path);
  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) issues.push(path);
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) issues.push(path);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) issues.push(path);
    if (schema.format === "date" && !isCalendarDate(value)) issues.push(path);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) issues.push(path);
    if (typeof schema.maximum === "number" && value > schema.maximum) issues.push(path);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) issues.push(path);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) issues.push(path);
    if (schema.items && typeof schema.items === "object") value.forEach((item, index) => issues.push(...validateJsonSchema(item, schema.items, `${path}[${index}]`, depth + 1)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties) ? schema.properties as JsonSchemaRecord : {};
    if (Array.isArray(schema.required)) for (const key of schema.required) if (typeof key === "string" && !Object.hasOwn(record, key)) issues.push(`${path}.${key}`);
    for (const [key, dependency] of Object.entries(schema.dependentRequired as Record<string, unknown> ?? {})) {
      if (Object.hasOwn(record, key) && Array.isArray(dependency)) for (const required of dependency) if (typeof required === "string" && !Object.hasOwn(record, required)) issues.push(`${path}.${required}`);
    }
    for (const [key, item] of Object.entries(record)) {
      if (Object.hasOwn(properties, key)) issues.push(...validateJsonSchema(item, properties[key], `${path}.${key}`, depth + 1));
      else if (schema.additionalProperties === false) issues.push(`${path}.${key}`);
    }
  }
  for (const condition of ["anyOf", "allOf"] as const) {
    const branches = schema[condition];
    if (!Array.isArray(branches)) continue;
    if (condition === "anyOf" && !branches.some(branch => validateJsonSchema(value, branch, path, depth + 1).length === 0)) issues.push(path);
    if (condition === "allOf") for (const branch of branches) issues.push(...validateJsonSchema(value, branch, path, depth + 1));
  }
  if (schema.if && typeof schema.if === "object") {
    const selected = validateJsonSchema(value, schema.if, path, depth + 1).length === 0 ? schema.then : schema.else;
    if (selected && typeof selected === "object") issues.push(...validateJsonSchema(value, selected, path, depth + 1));
  }
  return issues;
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
