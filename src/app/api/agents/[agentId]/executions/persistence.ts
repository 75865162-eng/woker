import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { mapExecutionSummary } from "@/lib/agent-platform/catalog";
import type { createAgentRuntime } from "@/lib/agent-platform";
import type { AgentDefinition } from "@/lib/agent-platform/types";

type RuntimeResult = Awaited<ReturnType<ReturnType<typeof createAgentRuntime>["run"]>>;

export async function persistExecutionResult(
  runtimeResult: RuntimeResult,
  definition: AgentDefinition,
  user: { id: string; organizationId: string },
  scope: { workspaceId: string; accountId: string; marketplace: string },
  body: Record<string, unknown>,
) {
  const executionRecord = await prisma.agentExecution.create({
    data: {
      id: runtimeResult.execution.id, organizationId: user.organizationId,
      agentDefinitionId: definition.id, requestedByUserId: user.id,
      workspaceId: scope.workspaceId, accountId: scope.accountId, marketplace: scope.marketplace,
      sku: runtimeResult.execution.sku, asin: runtimeResult.execution.asin,
      projectId: runtimeResult.execution.projectId, taskId: runtimeResult.execution.taskId,
      status: runtimeResult.execution.status,
      input: runtimeResult.execution.input as Prisma.InputJsonValue,
      context: runtimeResult.execution.context as Prisma.InputJsonValue,
      recommendation: runtimeResult.execution.recommendation as Prisma.InputJsonValue | undefined,
      decision: runtimeResult.execution.decision as Prisma.InputJsonValue | undefined,
      output: runtimeResult.execution.output as Prisma.InputJsonValue | undefined,
      approvalStatus: runtimeResult.execution.approvalStatus,
      tokenUsage: runtimeResult.execution.tokenUsage, toolCallCount: runtimeResult.execution.toolCallCount,
      retryCount: runtimeResult.execution.retryCount, costCents: runtimeResult.execution.costCents,
      error: runtimeResult.execution.error as Prisma.InputJsonValue | undefined,
      startedAt: runtimeResult.execution.startedAt ? new Date(runtimeResult.execution.startedAt) : undefined,
      finishedAt: runtimeResult.execution.finishedAt ? new Date(runtimeResult.execution.finishedAt) : undefined,
    },
  });
  const taskRecord = await prisma.agentTask.create({
    data: {
      organizationId: user.organizationId, executionId: executionRecord.id,
      title: `Agent execution ${definition.name}`,
      description: typeof body.message === "string" ? body.message : undefined,
      status: executionRecord.status === "WAITING_APPROVAL" ? "waiting_approval" : executionRecord.status.toLowerCase(),
      priority: 0,
      payload: { executionId: executionRecord.id, agentId: definition.id, input: runtimeResult.execution.input, context: runtimeResult.execution.context } as Prisma.InputJsonValue,
      result: runtimeResult.execution.output as Prisma.InputJsonValue | undefined,
    },
  });
  await prisma.agentExecution.update({ where: { id: executionRecord.id }, data: { taskId: taskRecord.id } });
  if (runtimeResult.traces.length) {
    await prisma.agentExecutionTrace.createMany({
      data: runtimeResult.traces.map(trace => ({
        id: trace.id, organizationId: user.organizationId, executionId: executionRecord.id,
        sequence: trace.sequence, eventType: trace.type, message: trace.message,
        payload: trace.payload as Prisma.InputJsonValue | undefined,
        redactedPayload: trace.redactedPayload as Prisma.InputJsonValue | undefined,
        createdAt: new Date(trace.createdAt),
      })),
    });
  }
  if (runtimeResult.events.length) {
    await prisma.agentEvent.createMany({
      data: runtimeResult.events.map(event => ({
        id: event.id, organizationId: user.organizationId, executionId: executionRecord.id,
        eventType: event.type, payload: event.payload as Prisma.InputJsonValue, createdAt: new Date(event.createdAt),
      })),
    });
  }
  if (runtimeResult.toolCalls.length) {
    await prisma.agentToolCall.createMany({
      data: runtimeResult.toolCalls.map(toolCall => ({
        id: toolCall.id, organizationId: user.organizationId, executionId: executionRecord.id,
        toolId: toolCall.toolId, toolName: toolCall.toolName, adapterType: toolCall.adapterId,
        riskLevel: toolCall.riskLevel, permission: toolCall.permission as Prisma.InputJsonValue,
        status: toolCall.status, input: toolCall.input as Prisma.InputJsonValue,
        redactedInput: toolCall.redactedInput as Prisma.InputJsonValue,
        output: toolCall.output as Prisma.InputJsonValue | undefined,
        redactedOutput: toolCall.redactedOutput as Prisma.InputJsonValue | undefined,
        latencyMs: toolCall.latencyMs, retryCount: toolCall.retryCount,
        error: toolCall.error as Prisma.InputJsonValue | undefined,
      })),
    });
  }
  if (runtimeResult.approvals.length) {
    await prisma.agentApproval.createMany({
      data: runtimeResult.approvals.map(approval => ({
        id: approval.id, organizationId: user.organizationId, executionId: executionRecord.id,
        toolCallId: approval.toolCallId, riskLevel: approval.riskLevel, status: approval.status,
        recommendation: approval.recommendation as unknown as Prisma.InputJsonValue,
        action: approval.action as unknown as Prisma.InputJsonValue,
        humanDecision: approval.humanDecision as unknown as Prisma.InputJsonValue | undefined,
        requestedByUserId: approval.requestedByUserId, decidedByUserId: approval.decidedByUserId,
        requestedAt: new Date(approval.requestedAt),
        decidedAt: approval.decidedAt ? new Date(approval.decidedAt) : undefined,
        expiresAt: approval.expiresAt ? new Date(approval.expiresAt) : undefined,
      })),
    });
  }
  if (runtimeResult.memoryItems.length) {
    await prisma.agentMemory.createMany({
      data: runtimeResult.memoryItems.map(memoryItem => ({
        id: memoryItem.id, organizationId: user.organizationId,
        agentDefinitionId: memoryItem.agentDefinitionId ?? definition.id,
        scope: memoryItem.scope, scopeKey: memoryItem.scopeKey, summary: memoryItem.summary,
        data: memoryItem.data as Prisma.InputJsonValue, sourceExecutionId: memoryItem.sourceExecutionId,
        confidence: memoryItem.confidence,
        expiresAt: memoryItem.expiresAt ? new Date(memoryItem.expiresAt) : undefined,
        createdAt: new Date(memoryItem.createdAt), updatedAt: new Date(memoryItem.updatedAt),
      })),
    });
  }
  const executions = await prisma.agentExecution.findMany({
    where: { organizationId: user.organizationId, agentDefinitionId: definition.id },
    orderBy: { createdAt: "desc" }, take: 20,
    select: { id: true, agentDefinitionId: true, status: true, createdAt: true, finishedAt: true, tokenUsage: true, toolCallCount: true, approvalStatus: true },
  });
  return {
    execution: { ...runtimeResult.execution, taskId: taskRecord.id },
    executions: executions.map(execution => mapExecutionSummary(execution, definition.name)),
    approvals: runtimeResult.approvals, toolCalls: runtimeResult.toolCalls,
    traces: runtimeResult.traces, events: runtimeResult.events,
  };
}
