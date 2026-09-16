import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { createApprovalRequest } from "@/lib/agent-platform/approval";
import { createEvent, createTraceEvent } from "@/lib/agent-platform/trace";
import { listingAgentId } from "@/lib/agent-platform/listing";
import type { JsonValue as AgentJsonValue } from "@/lib/agent-platform/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("agents", "create", request);

    if (!permission.ok) {
      return permission.response;
    }

    const { user } = permission;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const report = isObject(body.report) ? body.report : null;
    const decisionAt = new Date();

    if (!report) {
      return NextResponse.json({ error: "A listing report is required." }, { status: 400 });
    }

    const listingDraft = isObject(report.listingDraft) ? report.listingDraft : null;
    const title = stringValue((listingDraft && typeof listingDraft.title === "string" ? listingDraft.title : undefined) ?? "Listing Draft");
    const executionId = `execution-${listingAgentId}-project-${decisionAt.getTime()}`;
    const approval = createApprovalRequest({
      executionId,
      riskLevel: "HIGH",
      recommendation: {
        summary: `Publish listing draft for ${title}.`,
        evidence: report.evidence ?? [],
        risks: ["Listing publication is approval gated."],
        confidence: numberValue(listingDraft && typeof listingDraft.confidence === "number" ? listingDraft.confidence : undefined, 0.72),
      },
      action: {
        type: "listing.publish",
        target: title,
        payload: {
          reportSnapshot: report,
          source: "listing-agent",
        } as AgentJsonValue,
      },
      requestedByUserId: user.id,
      requestedAt: decisionAt,
    });

    const execution = {
      id: executionId,
      organizationId: user.organizationId,
      agentDefinitionId: listingAgentId,
      requestedByUserId: user.id,
      workspaceId: stringValue(body.workspaceId, "default"),
      accountId: stringValue(body.accountId, ""),
      marketplace: stringValue(body.marketplace, ""),
      sku: stringValue(body.sku),
      asin: stringValue(body.asin),
      projectId: stringValue(body.projectId),
      taskId: undefined,
      status: "WAITING_APPROVAL",
      input: {
        actionType: "listing.publish",
        reportSnapshot: report,
      } as Prisma.InputJsonValue,
      context: isObject(body.context) ? body.context : {},
      recommendation: approval.recommendation,
      decision: {
        summary: approval.recommendation.summary,
        rationale: "The listing draft must be reviewed before publication.",
        confidence: approval.recommendation.confidence,
        nextStep: "Await human approval",
      },
      output: {
        state: "waiting_approval",
        actionType: "listing.publish",
        reportSnapshot: report,
      } as Prisma.InputJsonValue,
      approvalStatus: "REQUESTED",
      tokenUsage: 20,
      toolCallCount: 0,
      retryCount: 0,
      costCents: 0,
      startedAt: decisionAt.toISOString(),
      createdAt: decisionAt.toISOString(),
      updatedAt: decisionAt.toISOString(),
    };

    const traces = [
      createTraceEvent({
        executionId,
        sequence: 1,
        type: "decision",
        message: "Listing draft prepared",
        payload: {
          title,
          reportSummary: typeof report.summary === "string" ? report.summary : undefined,
        } as AgentJsonValue,
        createdAt: decisionAt,
      }),
      createTraceEvent({
        executionId,
        sequence: 2,
        type: "recommendation",
        message: "Listing approval requested",
        payload: approval.recommendation as unknown as AgentJsonValue,
        createdAt: decisionAt,
      }),
      createTraceEvent({
        executionId,
        sequence: 3,
        type: "approval requested",
        message: "Awaiting human approval",
        payload: approval as unknown as AgentJsonValue,
        createdAt: decisionAt,
      }),
    ];
    const event = createEvent({
      executionId,
      type: "approval.requested",
      payload: approval as unknown as AgentJsonValue,
      createdAt: decisionAt,
    });

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({
        execution: {
          ...execution,
          taskId: `task-${executionId}`,
          approvals: [approval],
          traces,
          toolCalls: [],
          events: [event],
        },
        approval,
        task: {
          id: `task-${executionId}`,
          status: "waiting_approval",
        },
      });
    }

    const transactionResults = await prisma.$transaction([
      prisma.agentExecution.create({
        data: {
          id: execution.id,
          organizationId: execution.organizationId,
          agentDefinitionId: execution.agentDefinitionId,
          requestedByUserId: execution.requestedByUserId,
          workspaceId: execution.workspaceId,
          accountId: execution.accountId,
          marketplace: execution.marketplace,
          sku: execution.sku,
          asin: execution.asin,
          projectId: execution.projectId,
          taskId: execution.taskId,
          status: execution.status,
          input: execution.input,
          context: execution.context as Prisma.InputJsonValue,
          recommendation: execution.recommendation as unknown as Prisma.InputJsonValue,
          decision: execution.decision as unknown as Prisma.InputJsonValue,
          output: execution.output as unknown as Prisma.InputJsonValue,
          approvalStatus: execution.approvalStatus,
          tokenUsage: execution.tokenUsage,
          toolCallCount: execution.toolCallCount,
          retryCount: execution.retryCount,
          costCents: execution.costCents,
          startedAt: decisionAt,
          createdAt: decisionAt,
          updatedAt: decisionAt,
        },
      }),
      prisma.agentTask.create({
        data: {
          organizationId: user.organizationId,
          executionId,
          title: `Publish listing draft for ${title}`,
          description: approval.recommendation.summary,
          status: "waiting_approval",
          priority: 1,
          payload: {
            actionType: "listing.publish",
            reportSnapshot: report,
          } as Prisma.InputJsonValue,
          result: execution.output,
        },
      }),
      prisma.agentApproval.create({
        data: {
          id: approval.id,
          organizationId: user.organizationId,
          executionId,
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
        },
      }),
      prisma.agentExecutionTrace.createMany({
        data: traces.map((trace) => ({
          id: trace.id,
          organizationId: user.organizationId,
          executionId,
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
          id: event.id,
          organizationId: user.organizationId,
          executionId,
          eventType: event.type,
          payload: event.payload as Prisma.InputJsonValue,
          createdAt: new Date(event.createdAt),
        },
      }),
    ]).then(([createdExecution, createdTask]) => [createdExecution, createdTask] as const);

    const taskRecord = transactionResults[1] as { id: string };
    const executionDetail = {
      ...execution,
      taskId: taskRecord.id,
      approvals: [approval],
      traces,
      toolCalls: [],
      events: [event],
    };

    return NextResponse.json({
      execution: executionDetail,
      task: taskRecord,
      approval,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create listing project approval." },
      { status: 500 },
    );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
