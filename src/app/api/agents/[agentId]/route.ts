import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { defaultAgentDefinitions, defaultToolDefinitions } from "@/lib/agent-platform/defaults";
import {
  mapExecutionSummary,
  normalizeExecutionStatus,
  summarizeAgentExecutions,
  toAgentDefinition,
  toAgentToolDefinition,
} from "@/lib/agent-platform/catalog";
import { hasAgentPlatformPrismaDelegates, isMissingAgentPlatformPersistenceError } from "@/lib/agent-platform/prisma-support";
import { resolveAgentRuntimeConfigStatus } from "@/lib/agent-platform/runtime-config";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const permission = await requireApiPermission("agents", "view", request);

    if (!permission.ok) {
      return permission.response;
    }

    const { user } = permission;
    const { agentId } = await context.params;
    const scope = workspaceScopeFromRequest(request);
    const runtimeConfig = await resolveAgentRuntimeConfigStatus(user, scope);

    const fallbackDefinition = defaultAgentDefinitions.find((definition) => definition.id === agentId);
    const fallbackToolDefinitions = defaultToolDefinitions.filter((tool) => fallbackDefinition?.tools.includes(tool.toolId));

    let agentDefinition = fallbackDefinition ?? null;
    let executionRecords: Array<{
      id: string;
      agentDefinitionId: string;
      status: string;
      createdAt: Date;
      finishedAt: Date | null;
      tokenUsage: number;
      toolCallCount: number;
      approvalStatus: string | null;
    }> = [];
    let latestExecution:
      | {
          id: string;
          organizationId: string;
          agentDefinitionId: string;
          requestedByUserId: string | null;
          workspaceId: string;
          accountId: string;
          marketplace: string;
          sku: string | null;
          asin: string | null;
          projectId: string | null;
          taskId: string | null;
          status: string;
          input: unknown;
          context: unknown;
          recommendation: unknown;
          decision: unknown;
          output: unknown;
          approvalStatus: string | null;
          tokenUsage: number;
          toolCallCount: number;
          retryCount: number;
          costCents: number;
          error: unknown;
          startedAt: Date | null;
          finishedAt: Date | null;
          createdAt: Date;
          updatedAt: Date;
          traces: Array<{
            id: string;
            executionId: string;
            sequence: number;
            eventType: string;
            message: string | null;
            payload: unknown;
            redactedPayload: unknown;
            createdAt: Date;
          }>;
          toolCalls: Array<{
            id: string;
            executionId: string;
            toolId: string;
            toolName: string;
            adapterType: string;
            riskLevel: string;
            permission: unknown;
            status: string;
            input: unknown;
            redactedInput: unknown;
            output: unknown;
            redactedOutput: unknown;
            latencyMs: number | null;
            retryCount: number;
            error: unknown;
            createdAt: Date;
          }>;
          approvals: Array<{
            id: string;
            executionId: string;
            toolCallId: string | null;
            riskLevel: string;
            status: string;
            recommendation: unknown;
            action: unknown;
            humanDecision: unknown;
            requestedByUserId: string | null;
            decidedByUserId: string | null;
            requestedAt: Date;
            decidedAt: Date | null;
            expiresAt: Date | null;
            createdAt: Date;
            updatedAt: Date;
          }>;
          events: Array<{
            id: string;
            executionId: string;
            eventType: string;
            payload: unknown;
            createdAt: Date;
          }>;
        }
      | null = null;
    let memoryItems: Array<{
      id: string;
      agentDefinitionId: string | null;
      scope: string;
      scopeKey: string;
      summary: string;
      data: unknown;
      sourceExecutionId: string | null;
      confidence: number;
      expiresAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    const hasAgentPersistence = hasAgentPlatformPrismaDelegates();

    if (hasAgentPersistence) {
      const agentRecord = await prisma.agentDefinition.findFirst({
        where: {
          id: agentId,
          organizationId: user.organizationId,
        },
      });

      if (agentRecord) {
        agentDefinition = toAgentDefinition(agentRecord);
      }

      if (!agentDefinition) {
        return NextResponse.json({ error: "Agent not found." }, { status: 404 });
      }

      executionRecords = await prisma.agentExecution.findMany({
        where: {
          organizationId: user.organizationId,
          agentDefinitionId: agentDefinition.id,
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

      const latestExecutionSummary = executionRecords[0];
      if (latestExecutionSummary) {
        latestExecution = await prisma.agentExecution.findUnique({
          where: {
            id: latestExecutionSummary.id,
          },
          include: {
            traces: {
              orderBy: {
                sequence: "asc",
              },
            },
            toolCalls: {
              orderBy: {
                createdAt: "asc",
              },
            },
            approvals: {
              orderBy: {
                requestedAt: "asc",
              },
            },
            events: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        });
      }

      memoryItems = await prisma.agentMemory.findMany({
        where: {
          organizationId: user.organizationId,
          agentDefinitionId: agentDefinition.id,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 20,
      });
    }

    if (!agentDefinition) {
      return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    }

    const executions = executionRecords.map((execution) => mapExecutionSummary(execution, agentDefinition?.name ?? agentId));
    const stats = summarizeAgentExecutions([agentDefinition], executionRecords)[0];
    const tools = hasAgentPersistence
      ? [
          ...fallbackToolDefinitions,
          ...(await prisma.agentTool.findMany({
            where: {
              organizationId: user.organizationId,
              toolId: {
                in: agentDefinition.tools,
              },
            },
            orderBy: {
              updatedAt: "desc",
            },
          }).then((records) => records.map(toAgentToolDefinition))),
        ]
      : fallbackToolDefinitions;

    return NextResponse.json({
      agent: {
        ...agentDefinition,
        recentExecutionCount: stats?.recentExecutionCount ?? 0,
        successRate: stats?.successRate ?? 0,
        tokenUsage: stats?.tokenUsage ?? 0,
        toolCallCount: stats?.toolCallCount ?? 0,
        lastExecutionAt: stats?.lastExecutionAt,
        lastStatus: stats?.lastStatus,
        lastExecutionId: stats?.lastExecutionId,
      },
      tools,
      executions,
      latestExecution: latestExecution
        ? {
            ...latestExecution,
            status: normalizeExecutionStatus(latestExecution.status),
          }
        : null,
      memoryItems: memoryItems.map((item) => ({
        ...item,
        expiresAt: item.expiresAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      runtimeConfig,
    });
  } catch (error) {
    if (isMissingAgentPlatformPersistenceError(error)) {
      const { agentId } = await context.params;
      const fallbackDefinition = defaultAgentDefinitions.find((definition) => definition.id === agentId);

      if (!fallbackDefinition) {
        return NextResponse.json({ error: "Agent not found." }, { status: 404 });
      }

      const stats = summarizeAgentExecutions([fallbackDefinition], [])[0];

      return NextResponse.json({
        agent: {
          ...fallbackDefinition,
          recentExecutionCount: stats?.recentExecutionCount ?? 0,
          successRate: stats?.successRate ?? 0,
          tokenUsage: stats?.tokenUsage ?? 0,
          toolCallCount: stats?.toolCallCount ?? 0,
          lastExecutionAt: stats?.lastExecutionAt,
          lastStatus: stats?.lastStatus,
          lastExecutionId: stats?.lastExecutionId,
        },
        tools: defaultToolDefinitions.filter((tool) => fallbackDefinition.tools.includes(tool.toolId)),
        executions: [],
        latestExecution: null,
        memoryItems: [],
      });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load agent detail." },
      { status: 500 },
    );
  }
}
