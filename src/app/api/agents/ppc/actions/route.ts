import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { createApprovalRequest } from "@/lib/agent-platform/approval";
import { createEvent, createTraceEvent } from "@/lib/agent-platform/trace";
import { createToolGateway } from "@/lib/agent-platform/tool-gateway";
import { amazonAdsToolDefinitions, createAmazonAdsApiAdapter } from "@/lib/agent-platform/amazon-ads";
import { ppcAgentDefinition, ppcAgentId } from "@/lib/agent-platform/ppc";
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
    const adjustmentDrafts = Array.isArray(body.adjustmentDrafts) ? body.adjustmentDrafts : [];
    const actionTarget = stringValue(body.actionTarget, "bulk.export.prepare");
    const decisionAt = new Date();

    if (!report) {
      return NextResponse.json({ error: "A PPC report is required." }, { status: 400 });
    }

    const executionId = `execution-${ppcAgentId}-action-${decisionAt.getTime()}`;
    const amazonAdsPlanResult = actionTarget === "amazon.ads.apply"
      ? await createToolGateway({
          tools: amazonAdsToolDefinitions,
          adapters: [
            createAmazonAdsApiAdapter({
              writeEnabled: process.env.AMAZON_ADS_EXECUTION_ENABLED === "true",
              clock: () => decisionAt,
            }),
          ],
          clock: () => decisionAt,
        }).invoke({
          agent: ppcAgentDefinition,
          executionId,
          context: isObject(body.context) ? body.context : {},
          toolId: "amazon.ads.recommendation.plan",
          input: {
            report,
            adjustmentDrafts,
          } as AgentJsonValue,
        })
      : null;
    const amazonAdsPlan = isObject(amazonAdsPlanResult?.output) && isObject(amazonAdsPlanResult.output.plan)
      ? amazonAdsPlanResult.output.plan
      : null;
    const approval = createApprovalRequest({
      executionId,
      riskLevel: actionTarget === "amazon.ads.apply" ? "CRITICAL" : "HIGH",
      recommendation: {
        summary: actionTarget === "amazon.ads.apply"
          ? "Approve PPC recommendations before Amazon Ads API execution."
          : "Approve PPC recommendations before preparing Bulk export.",
        evidence: report.evidence ?? [],
        risks: [
          "PPC changes affect live ad spend.",
          "Direct Amazon Ads API execution is disabled until human approval and adapter implementation.",
        ],
        confidence: numberValue(report.confidence, 0.78),
      },
      action: {
        type: actionTarget,
        target: "ppc-recommendation-bundle",
        payload: {
          reportSnapshot: report,
          adjustmentDrafts,
          amazonAdsPlan,
          source: "ppc-agent",
        } as AgentJsonValue,
      },
      requestedByUserId: user.id,
      requestedAt: decisionAt,
    });

    const execution = {
      id: executionId,
      organizationId: user.organizationId,
      agentDefinitionId: ppcAgentId,
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
        actionType: actionTarget,
        reportSnapshot: report,
        adjustmentDrafts,
        amazonAdsPlan,
      } as Prisma.InputJsonValue,
      context: isObject(body.context) ? body.context : {},
      recommendation: approval.recommendation,
      decision: {
        summary: approval.recommendation.summary,
        rationale: "PPC recommendations must be reviewed before Bulk export or Amazon Ads API execution.",
        confidence: approval.recommendation.confidence,
        nextStep: "Await human approval",
      },
      output: {
        state: "waiting_approval",
        actionType: actionTarget,
        reportSnapshot: report,
        adjustmentDrafts,
        amazonAdsPlan,
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
        message: "PPC action bundle prepared",
        payload: {
          actionTarget,
          draftCount: adjustmentDrafts.length,
          amazonAdsPlanId: amazonAdsPlan && typeof amazonAdsPlan.planId === "string" ? amazonAdsPlan.planId : undefined,
          reportSummary: typeof report.summary === "string" ? report.summary : undefined,
        } as AgentJsonValue,
        createdAt: decisionAt,
      }),
      createTraceEvent({
        executionId,
        sequence: 2,
        type: "recommendation",
        message: "PPC action approval requested",
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
          title: "Approve PPC recommendation bundle",
          description: approval.recommendation.summary,
          status: "waiting_approval",
          priority: 1,
          payload: {
            actionType: actionTarget,
            reportSnapshot: report,
            adjustmentDrafts,
            amazonAdsPlan,
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
      { error: error instanceof Error ? error.message : "Failed to create PPC action approval." },
      { status: 500 },
    );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}
