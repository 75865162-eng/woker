import type { AgentEvaluationRun, JsonValue } from "./types";

export interface AgentEvaluationInput {
  input: JsonValue;
  expectedBehavior: JsonValue;
  actualBehavior: JsonValue;
  toolCalls: JsonValue;
  finalOutput: JsonValue;
  errors?: JsonValue;
  score?: number;
}

export function normalizeEvaluationScore(score?: number) {
  if (typeof score !== "number" || Number.isNaN(score)) return undefined;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function createEvaluationRun(input: {
  id: string;
  evaluationCaseId: string;
  executionId?: string;
  payload: AgentEvaluationInput;
  createdAt?: Date;
  updatedAt?: Date;
}): AgentEvaluationRun {
  const createdAt = input.createdAt ?? new Date();
  const updatedAt = input.updatedAt ?? createdAt;

  return {
    id: input.id,
    evaluationCaseId: input.evaluationCaseId,
    executionId: input.executionId,
    input: input.payload.input,
    expectedBehavior: input.payload.expectedBehavior,
    actualBehavior: input.payload.actualBehavior,
    toolCalls: input.payload.toolCalls,
    finalOutput: input.payload.finalOutput,
    score: normalizeEvaluationScore(input.payload.score),
    errors: input.payload.errors,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

