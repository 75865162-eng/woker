import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { defaultAgentDefinitions } from "@/lib/agent-platform/defaults";
import { summarizeAgentExecutions, toAgentDefinition } from "@/lib/agent-platform/catalog";
import { hasAgentPlatformPrismaDelegates, isMissingAgentPlatformPersistenceError } from "@/lib/agent-platform/prisma-support";
import { resolveAgentRuntimeConfigStatus } from "@/lib/agent-platform/runtime-config";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("agents", "view", request);

    if (!permission.ok) {
      return permission.response;
    }

    const { user } = permission;
    const scope = workspaceScopeFromRequest(request);
    const runtimeConfig = await resolveAgentRuntimeConfigStatus(user, scope);

    if (!hasAgentPlatformPrismaDelegates()) {
      return NextResponse.json({
        agents: summarizeAgentExecutions(defaultAgentDefinitions, []),
        runtimeConfig,
      });
    }

    const [agentRecords, executionRecords] = await Promise.all([
      prisma.agentDefinition.findMany({
        where: {
          organizationId: user.organizationId,
        },
        orderBy: [{ updatedAt: "desc" }],
      }),
      prisma.agentExecution.findMany({
        where: {
          organizationId: user.organizationId,
        },
        orderBy: [{ createdAt: "desc" }],
        take: 200,
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
      }),
    ]);

    const definitions = agentRecords.length ? agentRecords.map(toAgentDefinition) : defaultAgentDefinitions;
    const executions = executionRecords.filter((execution) => definitions.some((definition) => definition.id === execution.agentDefinitionId));

    return NextResponse.json({
      agents: summarizeAgentExecutions(definitions, executions),
      runtimeConfig,
    });
  } catch (error) {
    if (isMissingAgentPlatformPersistenceError(error)) {
      return NextResponse.json({
        agents: summarizeAgentExecutions(defaultAgentDefinitions, []),
      });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load agent catalog." },
      { status: 500 },
    );
  }
}
