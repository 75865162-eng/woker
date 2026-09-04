import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { resolveApproval } from "@/lib/agent-platform/approval";
import { createEvent, createTraceEvent } from "@/lib/agent-platform/trace";
import type { AgentAction, AgentRecommendation, JsonValue as AgentJsonValue } from "@/lib/agent-platform/types";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ approvalId: string }> }) {
  try {
    const permission = await requireApiPermission("agents", "approve", request);

    if (!permission.ok) {
      return permission.response;
    }

    const { user } = permission;
    const { approvalId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { decision?: unknown; reason?: unknown };
    const decision = normalizeDecision(body.decision);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!decision) {
      return NextResponse.json({ error: "A valid approval decision is required." }, { status: 400 });
    }

    const approval = (await prisma.agentApproval.findFirst({
      where: {
        id: approvalId,
        organizationId: user.organizationId,
      },
      include: {
        execution: {
          include: {
            tasks: true,
            traces: {
              orderBy: {
                sequence: "desc",
              },
              take: 1,
            },
          },
        },
      },
    })) as Prisma.AgentApprovalGetPayload<{
      include: {
        execution: {
          include: {
            tasks: true;
            traces: {
              orderBy: {
                sequence: "desc";
              };
              take: 1;
            };
          };
        };
      };
    }> | null;

    if (!approval) {
      return NextResponse.json({ error: "Approval request not found." }, { status: 404 });
    }

    if (approval.status !== "REQUESTED") {
      return NextResponse.json({ error: "Approval request is already resolved." }, { status: 400 });
    }

    const resolvedApproval = resolveApproval({
      approval: {
        id: approval.id,
        executionId: approval.executionId,
        toolCallId: approval.toolCallId ?? undefined,
        riskLevel: approval.riskLevel as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
        status: "REQUESTED",
        recommendation: approval.recommendation as unknown as AgentRecommendation,
        action: approval.action as unknown as AgentAction,
        requestedByUserId: approval.requestedByUserId ?? undefined,
        requestedAt: approval.requestedAt.toISOString(),
        expiresAt: approval.expiresAt?.toISOString(),
      },
      decision,
      decidedByUserId: user.id,
      reason,
    });

    const nextExecutionStatus = decision === "APPROVED" ? "COMPLETED" : "CANCELLED";
    const nextTaskStatus = decision === "APPROVED" ? "completed" : "cancelled";
    const baseOutput =
      approval.execution.output && typeof approval.execution.output === "object" && !Array.isArray(approval.execution.output)
        ? (approval.execution.output as Record<string, unknown>)
        : {};

    const nextOutput: Prisma.InputJsonValue = {
      ...baseOutput,
      approvalDecision: decision,
      approvalReason: reason || undefined,
      action: approval.action,
    } as Prisma.InputJsonValue;

    const nextSequence = (approval.execution.traces[0]?.sequence ?? 0) + 1;
    const traceCreatedAt = new Date();
    const traceEvents = [
      createTraceEvent({
        executionId: approval.executionId,
        sequence: nextSequence,
        type: "approval result",
        message: `Approval ${decision.toLowerCase()}`,
        payload: resolvedApproval as unknown as AgentJsonValue,
        createdAt: traceCreatedAt,
      }),
      createTraceEvent({
        executionId: approval.executionId,
        sequence: nextSequence + 1,
        type: "action executed",
        message: decision === "APPROVED" ? "Approved action recorded." : "Action cancelled by human decision.",
        payload: nextOutput as unknown as AgentJsonValue,
        createdAt: traceCreatedAt,
      }),
      createTraceEvent({
        executionId: approval.executionId,
        sequence: nextSequence + 2,
        type: "completed",
        message: `Execution ${nextExecutionStatus.toLowerCase()}`,
        payload: nextOutput as unknown as AgentJsonValue,
        createdAt: traceCreatedAt,
      }),
    ];
    const auditEvent = createEvent({
      executionId: approval.executionId,
      type: "approval.result",
      payload: resolvedApproval as unknown as AgentJsonValue,
      createdAt: traceCreatedAt,
    });

    await prisma.$transaction([
      prisma.agentApproval.update({
        where: {
          id: approval.id,
        },
        data: {
          status: resolvedApproval.status,
          decidedByUserId: user.id,
          decidedAt: new Date(resolvedApproval.decidedAt ?? new Date().toISOString()),
          humanDecision: resolvedApproval.humanDecision as Prisma.InputJsonValue,
        },
      }),
      prisma.agentExecution.update({
        where: {
          id: approval.executionId,
        },
        data: {
          status: nextExecutionStatus,
          approvalStatus: resolvedApproval.status,
          output: nextOutput,
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      }),
      prisma.agentTask.updateMany({
        where: {
          executionId: approval.executionId,
        },
        data: {
          status: nextTaskStatus,
          result: nextOutput,
        },
      }),
      prisma.agentExecutionTrace.createMany({
        data: traceEvents.map((trace) => ({
          id: trace.id,
          organizationId: user.organizationId,
          executionId: approval.executionId,
          sequence: trace.sequence,
          eventType: trace.type,
          message: trace.message,
          payload: trace.payload as Prisma.InputJsonValue | undefined,
          redactedPayload: trace.redactedPayload as Prisma.InputJsonValue | undefined,
          createdAt: new Date(trace.createdAt),
        })),
      }),
      prisma.agentEvent.create({
        data: {
          id: auditEvent.id,
          organizationId: user.organizationId,
          executionId: approval.executionId,
          eventType: auditEvent.type,
          payload: auditEvent.payload as Prisma.InputJsonValue,
          createdAt: new Date(auditEvent.createdAt),
        },
      }),
    ]);

    return NextResponse.json({
      approval: resolvedApproval,
      execution: {
        id: approval.executionId,
        status: nextExecutionStatus,
        approvalStatus: resolvedApproval.status,
        output: nextOutput,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to resolve approval." },
      { status: 500 },
    );
  }
}

function normalizeDecision(value: unknown) {
  if (value === "APPROVED" || value === "REJECTED" || value === "EXPIRED") {
    return value;
  }

  return undefined;
}
