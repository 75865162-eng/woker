import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import {
  createAgentRuntime,
  createPlatformToolAdapter,
  defaultAgentDefinitions,
  defaultToolDefinitions,
} from "@/lib/agent-platform";
import { mapExecutionSummary, toAgentDefinition } from "@/lib/agent-platform/catalog";
import { hasAgentPlatformPrismaDelegates, isMissingAgentPlatformPersistenceError } from "@/lib/agent-platform/prisma-support";
import { toPublicAiSettings } from "@/lib/ai-settings";
import { getPublicSellerSpriteMcpSettings, getSellerSpriteMcpSettings } from "@/lib/server/integration-settings";
import { resolveUserAiTextSettings } from "@/lib/server/user-ai-settings";
import {
  createMarketAgentExecutionExecutor,
  createSellerSpriteMcpAdapter,
  marketAgentId,
  marketToolDefinitions,
} from "@/lib/agent-platform/market";
import {
  createListingAgentExecutionExecutor,
  createListingMcpAdapter,
  listingAgentId,
  listingToolDefinitions,
} from "@/lib/agent-platform/listing";
import {
  createProductAgentExecutionExecutor,
  createProductMcpAdapter,
  productAgentId,
  productToolDefinitions,
} from "@/lib/agent-platform/product";
import {
  createSupplierAgentExecutionExecutor,
  createSupplierMcpAdapter,
  supplierAgentId,
  supplierToolDefinitions,
} from "@/lib/agent-platform/supplier";
import {
  createPpcAgentExecutionExecutor,
  createPpcAnalyticsAdapter,
  ppcAgentId,
  ppcToolDefinitions,
} from "@/lib/agent-platform/ppc";
import {
  amazonAdsToolDefinitions,
  createAmazonAdsApiAdapter,
} from "@/lib/agent-platform/amazon-ads";
import {
  createOrchestratorExecutionExecutor,
  createOrchestratorInternalAdapter,
  orchestratorAgentId,
  orchestratorToolDefinitions,
} from "@/lib/agent-platform/orchestrator";
import type { AgentRuntimeExecutor, JsonValue as AgentJsonValue } from "@/lib/agent-platform/types";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const permission = await requireApiPermission("agents", "create", request);

    if (!permission.ok) {
      return permission.response;
    }

    const { user } = permission;
    const { agentId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const scope = workspaceScopeFromRequest(request, body.context as Record<string, unknown> | null | undefined);
    const hasAgentPersistence = hasAgentPlatformPrismaDelegates();
    const agentRecord = hasAgentPersistence
      ? await prisma.agentDefinition.findFirst({
          where: {
            id: agentId,
            organizationId: user.organizationId,
          },
        })
      : null;
    const fallbackDefinition = defaultAgentDefinitions.find((definition) => definition.id === agentId) ?? null;
    const definition = (agentRecord ? toAgentDefinition(agentRecord) : fallbackDefinition) ?? null;

    if (!definition) {
      return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    }

    const isMarketAgent = definition.id === marketAgentId;
    const isListingAgent = definition.id === listingAgentId;
    const isProductAgent = definition.id === productAgentId;
    const isSupplierAgent = definition.id === supplierAgentId;
    const isPpcAgent = definition.id === ppcAgentId;
    const isOrchestratorAgent = definition.id === orchestratorAgentId;

    if (definition.id !== "platform-runtime-core" && !isMarketAgent && !isListingAgent && !isProductAgent && !isSupplierAgent && !isPpcAgent && !isOrchestratorAgent) {
      return NextResponse.json(
        { error: "Execution is not enabled for this agent." },
        { status: 400 },
      );
    }

    const requestedToolId = typeof body.requestedToolId === "string" ? body.requestedToolId : "platform.context.snapshot";
    const requestedToolInput =
      body.requestedToolInput && typeof body.requestedToolInput === "object"
        ? (body.requestedToolInput as Prisma.JsonObject)
        : ({ includeKeys: ["company", "workspace", "user", "sku", "marketplace", "asin", "product", "historicalData", "currentData"] } satisfies Prisma.JsonObject);
    const requiresApproval = Boolean(body.requiresApproval);
    const traceRedactionKeys = Array.isArray(body.traceRedactionKeys) ? body.traceRedactionKeys.map(String) : [];
    const aiSettings = await resolveUserAiTextSettings(user, scope);
    const sellerSpriteMcpSettings = await getSellerSpriteMcpSettings(user, scope);
    const sellerSpritePublicSettings = await getPublicSellerSpriteMcpSettings(user, scope);
    const runtime = createAgentRuntime({
      definitions: [definition],
      tools: isMarketAgent
        ? marketToolDefinitions
        : isListingAgent
          ? listingToolDefinitions
        : isProductAgent
          ? productToolDefinitions
          : isSupplierAgent
            ? supplierToolDefinitions
          : isPpcAgent
            ? [...ppcToolDefinitions, ...amazonAdsToolDefinitions]
          : isOrchestratorAgent
            ? orchestratorToolDefinitions
          : defaultToolDefinitions,
      adapters: isMarketAgent
        ? [createSellerSpriteMcpAdapter({ settings: sellerSpriteMcpSettings })]
        : isListingAgent
          ? [createListingMcpAdapter()]
        : isProductAgent
          ? [createProductMcpAdapter()]
          : isSupplierAgent
            ? [createSupplierMcpAdapter()]
          : isPpcAgent
            ? [
                createPpcAnalyticsAdapter(),
                createAmazonAdsApiAdapter({
                  writeEnabled: process.env.AMAZON_ADS_EXECUTION_ENABLED === "true",
                }),
              ]
          : isOrchestratorAgent
            ? [createOrchestratorInternalAdapter()]
          : [createPlatformToolAdapter()],
    });
    const executionContext = buildExecutionContext(user, scope, body.context, {
      ai: toPublicAiSettings(aiSettings),
      integrations: {
        sellerSprite: sellerSpritePublicSettings,
      },
    });
    const executor: AgentRuntimeExecutor = isMarketAgent
      ? createMarketAgentExecutionExecutor({
          request: body,
          requestedByUserId: user.id,
        })
      : isListingAgent
        ? createListingAgentExecutionExecutor({
            request: body,
            requestedByUserId: user.id,
          })
      : isProductAgent
        ? createProductAgentExecutionExecutor({
            request: body,
            requestedByUserId: user.id,
          })
        : isSupplierAgent
          ? createSupplierAgentExecutionExecutor({
              request: body,
              requestedByUserId: user.id,
            })
        : isPpcAgent
          ? createPpcAgentExecutionExecutor({
              request: body,
              requestedByUserId: user.id,
            })
        : isOrchestratorAgent
          ? createOrchestratorExecutionExecutor({
              request: body,
              requestedByUserId: user.id,
            })
      : async ({ execution, callTool, requestApproval, recordTrace, emitEvent }: Parameters<AgentRuntimeExecutor>[0]) => {
          const toolResult = await callTool(requestedToolId, requestedToolInput as AgentJsonValue);
          const summary = typeof body.message === "string" && body.message.trim()
            ? body.message.trim()
            : "Platform runtime core dry run.";

          recordTrace("decision", "Runtime decision made", {
            summary,
            toolStatus: toolResult.status,
          });
          emitEvent("decision.made", {
            executionId: execution.id,
            summary,
            toolStatus: toolResult.status,
          } as AgentJsonValue);

          const recommendation = {
            summary,
            evidence: toolResult.output ?? null,
            risks: requiresApproval ? ["Human approval requested by operator."] : [],
            confidence: toolResult.status === "SUCCEEDED" ? 0.9 : 0.5,
            nextAction: requiresApproval ? "Wait for approval" : "Persist observation",
          };

          recordTrace("recommendation", "Recommendation drafted", recommendation);
          emitEvent("recommendation.created", recommendation as AgentJsonValue);

          if (toolResult.status === "APPROVAL_REQUIRED" && toolResult.approval) {
            const waitingApprovalOutput: AgentJsonValue = {
              state: "waiting_approval",
              recommendation,
              approval: toolResult.approval as unknown as AgentJsonValue,
            };

            return {
              recommendation,
              decision: {
                summary,
                rationale: "Tool call requires human approval before execution.",
                confidence: 0.9,
                nextStep: "Await human approval",
              },
              approvals: [toolResult.approval],
              output: waitingApprovalOutput,
              tokenUsage: 120,
              costCents: 0,
            };
          }

          if (requiresApproval) {
            const approval = await requestApproval({
              executionId: execution.id,
              riskLevel: "HIGH",
              recommendation,
              action: {
                type: "platform.runtime.execute",
                target: definition.id,
                payload: toolResult.output ?? {},
              },
              requestedByUserId: user.id,
            });

            return {
              recommendation,
              decision: {
                summary,
                rationale: "Approval required before action.",
                confidence: 0.9,
                nextStep: "Await human approval",
              },
              approvals: [approval],
              output: {
                state: "waiting_approval",
                recommendation,
              } satisfies Prisma.JsonObject,
              tokenUsage: 120,
              costCents: 0,
            };
          }

          return {
            recommendation,
            decision: {
              summary,
              rationale: "Dry run completed without side effects.",
              confidence: 0.9,
              nextStep: "Review execution trace",
            },
            output: {
              state: "completed",
              recommendation,
              toolOutput: toolResult.output ?? null,
            } as AgentJsonValue,
            tokenUsage: 120,
            costCents: 0,
          };
        };

    const runtimeResult = await runtime.run({
      agentId: definition.id,
      context: executionContext,
      input: {
        message: typeof body.message === "string" ? body.message : "Agent runtime execution",
        requestedToolId,
        requiresApproval,
      },
      requestedByUserId: user.id,
      workspaceId: scope.workspaceId,
      accountId: scope.accountId,
      marketplace: scope.marketplace,
      sku: typeof body.sku === "string" ? body.sku : executionContext.sku,
      asin: typeof body.asin === "string" ? body.asin : executionContext.asin,
      projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      taskId: typeof body.taskId === "string" ? body.taskId : undefined,
      traceRedactionKeys,
      executor,
    });

    if (!hasAgentPersistence) {
      return NextResponse.json(runtimeResult);
    }

    const executionRecord = await prisma.agentExecution.create({
      data: {
        id: runtimeResult.execution.id,
        organizationId: user.organizationId,
        agentDefinitionId: definition.id,
        requestedByUserId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        sku: runtimeResult.execution.sku,
        asin: runtimeResult.execution.asin,
        projectId: runtimeResult.execution.projectId,
        taskId: runtimeResult.execution.taskId,
        status: runtimeResult.execution.status,
        input: runtimeResult.execution.input as Prisma.InputJsonValue,
        context: runtimeResult.execution.context as Prisma.InputJsonValue,
        recommendation: runtimeResult.execution.recommendation as Prisma.InputJsonValue | undefined,
        decision: runtimeResult.execution.decision as Prisma.InputJsonValue | undefined,
        output: runtimeResult.execution.output as Prisma.InputJsonValue | undefined,
        approvalStatus: runtimeResult.execution.approvalStatus,
        tokenUsage: runtimeResult.execution.tokenUsage,
        toolCallCount: runtimeResult.execution.toolCallCount,
        retryCount: runtimeResult.execution.retryCount,
        costCents: runtimeResult.execution.costCents,
        error: runtimeResult.execution.error as Prisma.InputJsonValue | undefined,
        startedAt: runtimeResult.execution.startedAt ? new Date(runtimeResult.execution.startedAt) : undefined,
        finishedAt: runtimeResult.execution.finishedAt ? new Date(runtimeResult.execution.finishedAt) : undefined,
      },
    });

    const taskRecord = await prisma.agentTask.create({
      data: {
        organizationId: user.organizationId,
        executionId: executionRecord.id,
        title: `Agent execution ${definition.name}`,
        description: typeof body.message === "string" ? body.message : undefined,
        status: executionRecord.status === "WAITING_APPROVAL" ? "waiting_approval" : executionRecord.status.toLowerCase(),
        priority: 0,
        payload: {
          executionId: executionRecord.id,
          agentId: definition.id,
          input: runtimeResult.execution.input,
          context: runtimeResult.execution.context,
        } as Prisma.InputJsonValue,
        result: runtimeResult.execution.output as Prisma.InputJsonValue | undefined,
      },
    });

    await prisma.agentExecution.update({
      where: {
        id: executionRecord.id,
      },
      data: {
        taskId: taskRecord.id,
      },
    });

    if (runtimeResult.traces.length) {
      await prisma.agentExecutionTrace.createMany({
        data: runtimeResult.traces.map((trace) => ({
          id: trace.id,
          organizationId: user.organizationId,
          executionId: executionRecord.id,
          sequence: trace.sequence,
          eventType: trace.type,
          message: trace.message,
          payload: trace.payload as Prisma.InputJsonValue | undefined,
          redactedPayload: trace.redactedPayload as Prisma.InputJsonValue | undefined,
          createdAt: new Date(trace.createdAt),
        })),
      });
    }

    if (runtimeResult.events.length) {
      await prisma.agentEvent.createMany({
        data: runtimeResult.events.map((event) => ({
          id: event.id,
          organizationId: user.organizationId,
          executionId: executionRecord.id,
          eventType: event.type,
          payload: event.payload as Prisma.InputJsonValue,
          createdAt: new Date(event.createdAt),
        })),
      });
    }

    if (runtimeResult.toolCalls.length) {
      await prisma.agentToolCall.createMany({
        data: runtimeResult.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          organizationId: user.organizationId,
          executionId: executionRecord.id,
          toolId: toolCall.toolId,
          toolName: toolCall.toolName,
          adapterType: toolCall.adapterId,
          riskLevel: toolCall.riskLevel,
          permission: toolCall.permission as Prisma.InputJsonValue,
          status: toolCall.status,
          input: toolCall.input as Prisma.InputJsonValue,
          redactedInput: toolCall.redactedInput as Prisma.InputJsonValue,
          output: toolCall.output as Prisma.InputJsonValue | undefined,
          redactedOutput: toolCall.redactedOutput as Prisma.InputJsonValue | undefined,
          latencyMs: toolCall.latencyMs,
          retryCount: toolCall.retryCount,
          error: toolCall.error as Prisma.InputJsonValue | undefined,
        })),
      });
    }

    if (runtimeResult.approvals.length) {
      await prisma.agentApproval.createMany({
        data: runtimeResult.approvals.map((approval) => ({
          id: approval.id,
          organizationId: user.organizationId,
          executionId: executionRecord.id,
          toolCallId: approval.toolCallId,
          riskLevel: approval.riskLevel,
          status: approval.status,
          recommendation: approval.recommendation as unknown as Prisma.InputJsonValue,
          action: approval.action as unknown as Prisma.InputJsonValue,
          humanDecision: approval.humanDecision as unknown as Prisma.InputJsonValue | undefined,
          requestedByUserId: approval.requestedByUserId,
          decidedByUserId: approval.decidedByUserId,
          requestedAt: new Date(approval.requestedAt),
          decidedAt: approval.decidedAt ? new Date(approval.decidedAt) : undefined,
          expiresAt: approval.expiresAt ? new Date(approval.expiresAt) : undefined,
        })),
      });
    }

    if (runtimeResult.memoryItems.length) {
      await prisma.agentMemory.createMany({
        data: runtimeResult.memoryItems.map((memoryItem) => ({
          id: memoryItem.id,
          organizationId: user.organizationId,
          agentDefinitionId: memoryItem.agentDefinitionId ?? definition.id,
          scope: memoryItem.scope,
          scopeKey: memoryItem.scopeKey,
          summary: memoryItem.summary,
          data: memoryItem.data as Prisma.InputJsonValue,
          sourceExecutionId: memoryItem.sourceExecutionId,
          confidence: memoryItem.confidence,
          expiresAt: memoryItem.expiresAt ? new Date(memoryItem.expiresAt) : undefined,
          createdAt: new Date(memoryItem.createdAt),
          updatedAt: new Date(memoryItem.updatedAt),
        })),
      });
    }

    const executions = await prisma.agentExecution.findMany({
      where: {
        organizationId: user.organizationId,
        agentDefinitionId: definition.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20,
      select: {
        id: true,
        agentDefinitionId: true,
        status: true,
        createdAt: true,
        finishedAt: true,
        tokenUsage: true,
        toolCallCount: true,
        approvalStatus: true,
      },
    });

    return NextResponse.json({
      execution: {
        ...runtimeResult.execution,
        taskId: taskRecord.id,
      },
      executions: executions.map((execution) => mapExecutionSummary(execution, definition.name)),
      approvals: runtimeResult.approvals,
      toolCalls: runtimeResult.toolCalls,
      traces: runtimeResult.traces,
      events: runtimeResult.events,
    });
  } catch (error) {
    if (isMissingAgentPlatformPersistenceError(error)) {
      return NextResponse.json(
        { error: "Agent persistence is not ready. Run Prisma generate/migrate before saving executions." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run agent execution." },
      { status: 500 },
    );
  }
}

function buildExecutionContext(
  user: { id: string; email: string; name: string; role: string; organizationId: string; organizationName: string },
  scope: { workspaceId: string; accountId: string; marketplace: string },
  rawContext: unknown,
  runtimeConfig: Record<string, unknown>,
) {
  const context = rawContext && typeof rawContext === "object" ? (rawContext as Record<string, unknown>) : {};

  return {
    ...context,
    runtimeConfig,
    company: {
      organizationId: user.organizationId,
      organizationName: user.organizationName,
    },
    workspace: {
      workspaceId: scope.workspaceId,
      accountId: scope.accountId,
      marketplace: scope.marketplace,
    },
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    sku: typeof context.sku === "string" ? context.sku : undefined,
    asin: typeof context.asin === "string" ? context.asin : undefined,
    marketplace: scope.marketplace,
    historicalData: context.historicalData ?? context.currentData,
    currentData: context.currentData ?? context.historicalData,
  };
}
