import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { defaultAgentDefinitions } from "@/lib/agent-platform";
import { toAgentDefinition } from "@/lib/agent-platform/catalog";
import { hasAgentPlatformPrismaDelegates, isMissingAgentPlatformPersistenceError } from "@/lib/agent-platform/prisma-support";
import { toPublicAiSettings } from "@/lib/ai-settings";
import { getPublicSellerSpriteMcpSettings, getSellerSpriteMcpSettings } from "@/lib/server/integration-settings";
import { resolveUserAiTextSettings } from "@/lib/server/user-ai-settings";
import { marketAgentId } from "@/lib/agent-platform/market";
import type { JsonValue as AgentJsonValue } from "@/lib/agent-platform/types";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { handoffProvenance, isObject, parseLaunchApproval, validateHandoff, type ChainStage } from "@/lib/agent-platform/handoff";
import { verifyLaunchApproval } from "@/lib/agent-platform/launch-gate";
import { startAgentMeter, type PointsMeter } from "@/lib/points/usage";
import { buildExecutionContext } from "./context";
import { isExecutionEnabled, prepareExecutionRuntime } from "./runtime";
import { persistExecutionResult } from "./persistence";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  // 供 catch 释放预扣：执行失败时不能把积分留在冻结态。
  let pointsMeter: PointsMeter | null = null;
  try {
    const permission = await requireApiPermission("agents", "create", request);
    if (!permission.ok) return permission.response;
    const { user } = permission;
    const { agentId } = await context.params;
    if (agentId.startsWith("selection-research-v1:")) return NextResponse.json({ error: "Use the gated selection research API." }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const scope = workspaceScopeFromRequest(request, body.context as Record<string, unknown> | null | undefined);
    const hasAgentPersistence = hasAgentPlatformPrismaDelegates();
    if (body.chainHandoff != null) {
      try {
        validateHandoff(body.chainHandoff, (agentId === "orchestrator" ? "launch" : agentId) as ChainStage, {
          organizationId: user.organizationId, userId: user.id, workspaceId: scope.workspaceId,
        });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid handoff." }, { status: 400 });
      }
    }
    if (agentId === "ppc" && (body.chainHandoff != null || body.launchApproval != null || body.launchApproved != null)) {
      const inbound = isObject(body.chainHandoff) ? body.chainHandoff : {};
      const reference = parseLaunchApproval(inbound.launchApproval ?? body.launchApproval);
      const approval = reference && hasAgentPersistence ? await prisma.agentApproval.findFirst({
        where: { id: reference.approvalId, organizationId: user.organizationId, executionId: reference.executionId },
        include: { execution: true },
      }) : null;
      if (!verifyLaunchApproval(reference, approval, { organizationId: user.organizationId, workspaceId: scope.workspaceId })) {
        return NextResponse.json({ code: "blocked_until_launch", error: "blocked_until_launch：需要本组织、本工作区对应计划的有效 Launch 审批。" }, { status: 403 });
      }
      // 产品上下文只取已批准计划，不信任浏览器修改后的内容。
      const approvedOutput = isObject(approval?.execution.output) ? approval.execution.output : {};
      const approvedPlan = isObject(approvedOutput.plan) ? approvedOutput.plan : {};
      body.marketplace = approvedPlan.marketplace;
      body.sku = approvedPlan.sku;
      body.asin = approvedPlan.asin;
      const approvedHandoffs = Array.isArray(approvedOutput.handoffs) ? approvedOutput.handoffs : [];
      const ppcHandoff = approvedHandoffs.find((item) => isObject(item) && item.to === "ppc");
      if (!isObject(ppcHandoff) || !isObject(ppcHandoff.payload) || !isObject(ppcHandoff.payload.productContext) || !Object.keys(ppcHandoff.payload.productContext).length) {
        return NextResponse.json({ code: "blocked_until_launch", error: "批准计划缺少产品/刊登上下文，请重新准备并审批 Launch。" }, { status: 403 });
      }
      body.productContext = ppcHandoff.payload.productContext;
    }
    const agentRecord = hasAgentPersistence
      ? await prisma.agentDefinition.findFirst({ where: { id: agentId, organizationId: user.organizationId } })
      : null;
    const fallbackDefinition = defaultAgentDefinitions.find((definition) => definition.id === agentId) ?? null;
    let definition = (agentRecord ? toAgentDefinition(agentRecord) : fallbackDefinition) ?? null;
    if (!definition) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    if (definition.id === marketAgentId && !definition.tools.includes("market.selection.run")) {
      definition = { ...definition, tools: [...definition.tools, "market.selection.run"] };
    }
    if (!isExecutionEnabled(definition.id)) {
      return NextResponse.json({ error: "Execution is not enabled for this agent." }, { status: 400 });
    }
    const requestedToolId = typeof body.requestedToolId === "string" ? body.requestedToolId : "platform.context.snapshot";
    const requestedToolInput = body.requestedToolInput && typeof body.requestedToolInput === "object"
      ? body.requestedToolInput as AgentJsonValue
      : { includeKeys: ["company", "workspace", "user", "sku", "marketplace", "asin", "product", "historicalData", "currentData"] };
    const requiresApproval = Boolean(body.requiresApproval);
    const traceRedactionKeys = Array.isArray(body.traceRedactionKeys) ? body.traceRedactionKeys.map(String) : [];
    const aiSettings = await resolveUserAiTextSettings(user, scope);
    const sellerSpriteMcpSettings = await getSellerSpriteMcpSettings(user, scope);
    const sellerSpritePublicSettings = await getPublicSellerSpriteMcpSettings(user, scope);
    const { runtime, executor } = prepareExecutionRuntime({
      definition, body, userId: user.id,
      scope: { organizationId: user.organizationId, workspaceId: scope.workspaceId },
      sellerSpriteMcpSettings, requestedToolId, requestedToolInput, requiresApproval,
    });
    const executionContext = buildExecutionContext(user, scope, body.context, {
      ai: toPublicAiSettings(aiSettings), integrations: { sellerSprite: sellerSpritePublicSettings },
    });
    // 积分计量沿用影子模式合同。
    const meter = await startAgentMeter({ organizationId: user.organizationId, userId: user.id, agentId: definition.id });
    pointsMeter = meter;
    const runtimeResult = await runtime.run({
      agentId: definition.id, context: executionContext,
      input: {
        message: typeof body.message === "string" ? body.message : "Agent runtime execution",
        requestedToolId, requiresApproval, handoff: handoffProvenance(body.chainHandoff) as AgentJsonValue,
      },
      requestedByUserId: user.id, workspaceId: scope.workspaceId, accountId: scope.accountId, marketplace: scope.marketplace,
      sku: typeof body.sku === "string" ? body.sku : executionContext.sku,
      asin: typeof body.asin === "string" ? body.asin : executionContext.asin,
      projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      taskId: typeof body.taskId === "string" ? body.taskId : undefined,
      traceRedactionKeys, executor,
    });
    // 先完成全部持久化及响应组装，再结算；失败统一释放预扣。
    const result = hasAgentPersistence
      ? await persistExecutionResult(runtimeResult, definition, user, scope, body)
      : runtimeResult;
    let charged = 0;
    if (runtimeResult.execution.status === "FAILED") await meter.release();
    else charged = (await meter.settle(runtimeResult.execution.id))?.charged ?? 0;
    return NextResponse.json({
      ...result,
      points: { requestKey: meter.requestKey, reserved: meter.reserved, charged, ...(meter.skipReason ? { skipReason: meter.skipReason } : {}) },
    });
  } catch (error) {
    if (pointsMeter?.reserved) await pointsMeter.release();
    if (isMissingAgentPlatformPersistenceError(error)) {
      return NextResponse.json({ error: "Agent persistence is not ready. Run Prisma generate/migrate before saving executions." }, { status: 503 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to run agent execution." }, { status: 500 });
  }
}
