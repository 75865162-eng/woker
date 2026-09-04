import type {
  AgentError,
  AgentEvent,
  AgentEventName,
  AgentTraceEvent,
  AgentTraceEventType,
  JsonObject,
  JsonValue,
} from "./types";

const defaultSensitiveKeys = new Set([
  "apiKey",
  "apikey",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "password",
  "secret",
  "clientSecret",
  "webhookUrl",
  "cookie",
]);

let eventSequence = 0;

export function redactJson(value: JsonValue | undefined, extraSensitiveKeys: string[] = []): JsonValue | undefined {
  if (value === undefined) return undefined;

  const keys = new Set([...defaultSensitiveKeys, ...extraSensitiveKeys.map((key) => key.toLowerCase())]);

  return redactValue(value, keys);
}

export function redactError(error: AgentError | Error | unknown): JsonValue {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: null,
    };
  }

  if (error && typeof error === "object") {
    return redactValue(error as JsonValue, defaultSensitiveKeys);
  }

  return { message: String(error) };
}

export function createTraceEvent(input: {
  executionId: string;
  sequence: number;
  type: AgentTraceEventType;
  message?: string;
  payload?: JsonValue;
  redactionKeys?: string[];
  createdAt?: Date;
}): AgentTraceEvent {
  return {
    id: `trace-${input.executionId}-${input.sequence}`,
    executionId: input.executionId,
    sequence: input.sequence,
    type: input.type,
    message: input.message,
    payload: input.payload,
    redactedPayload: redactJson(input.payload, input.redactionKeys),
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  };
}

export function createEvent(input: {
  executionId: string;
  type: AgentEventName;
  payload: JsonValue;
  createdAt?: Date;
}): AgentEvent {
  return {
    id: `event-${input.executionId}-${input.type}-${(input.createdAt ?? new Date()).getTime()}-${++eventSequence}`,
    executionId: input.executionId,
    type: input.type,
    payload: input.payload,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  };
}

function redactValue(value: JsonValue, sensitiveKeys: Set<string>): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, sensitiveKeys));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output: JsonObject = {};

  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      output[key] = "[REDACTED]";
      continue;
    }

    output[key] = redactValue(item as JsonValue, sensitiveKeys);
  }

  return output;
}
