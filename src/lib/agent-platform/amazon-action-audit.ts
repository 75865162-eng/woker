import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createApprovalRequest } from "./approval";
import { buildAmazonAdsExecutionPlan, amazonAdsToolDefinitions, createAmazonAdsApiAdapter, type AmazonAdsExecutionPlan } from "./amazon-ads";
import { ppcAgentDefinition } from "./ppc";
import { createToolGateway } from "./tool-gateway";
import type { AgentApproval, JsonValue } from "./types";
import { actionDigest, actionKey, assertAction, assertNotExpired, validateBidPlan } from "./amazon-action-policy";
import { inventorySnapshotStatus } from "@/lib/operations/readiness";
import { assertAmazonAdsTransportImplemented } from "@/lib/amazon/ads-client";

export type AmazonActionScope = { organizationId: string; workspaceId: string; actorUserId: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export async function assertActionWorkspace(db: Prisma.TransactionClient, scope: AmazonActionScope) {
  const workspace = await db.workspaceScope.findUnique({ where: { organizationId_id: { organizationId: scope.organizationId, id: scope.workspaceId } } });
  assertAction(workspace, "WORKSPACE_NOT_FOUND", "工作区不属于当前组织。", 404);
}
async function auditLock(db: Prisma.TransactionClient, scope: AmazonActionScope, key: string) {
  const lock = JSON.stringify(["amazon-action", scope.organizationId, scope.workspaceId, key]);
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
}
export async function previewAmazonAction(scope: AmazonActionScope, input: { report: Record<string, unknown>; adjustmentDrafts: unknown[]; idempotencyKey: unknown }, db = prisma, now = new Date()) {
  const key = actionKey(input.idempotencyKey);
  const digest = actionDigest({ report: input.report, adjustmentDrafts: input.adjustmentDrafts });
  const plan = buildAmazonAdsExecutionPlan({ report: input.report, adjustmentDrafts: input.adjustmentDrafts, clock: () => now });
  // Explicitly limit this release to bid changes. Other recommendations remain in the report.
  plan.operations = plan.operations.filter((operation) => operation.operationType === "update_bid");
  plan.warnings.push(...validateBidPlan(plan), "仅预览 update_bid；旧值来自提交的报告，尚未与 Amazon 实时值核验。", "报告 rowId 不是 Amazon entity ID；真实写入仍被 NOT_IMPLEMENTED 闸门阻止。");
  const expiresAt = new Date(now.getTime() + 30 * 60000);
  return db.$transaction(async (tx) => {
    await assertActionWorkspace(tx, scope);
    await auditLock(tx, scope, key);
    const prior = await tx.amazonAgentActionAudit.findUnique({ where: { organizationId_workspaceId_idempotencyKey: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, idempotencyKey: key } } });
    if (prior) {
      assertAction(prior.actorUserId === scope.actorUserId && record(prior.preview).requestDigest === digest, "IDEMPOTENCY_CONFLICT", "此幂等键已绑定另一个请求或操作者。");
      return previewResponse(tx, scope, prior.id, String(record(prior.preview).approvalId));
    }
    const inventoryRun = await tx.amazonSyncRun.findFirst({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, resource: "inventory", status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" } });
    const inventoryStatus = inventorySnapshotStatus(inventoryRun?.finishedAt ?? null, now);
    plan.warnings.push("广告报表日期未建立可信映射，新鲜度 UNKNOWN；请复核原报表周期。", `库存新鲜度 ${inventoryStatus}；此计划未据此调整出价。`);
    const definition = await tx.agentDefinition.findFirst({ where: { id: "ppc", organizationId: scope.organizationId, enabled: true } });
    assertAction(definition, "AGENT_NOT_CONFIGURED", "当前组织尚未配置启用 PPC Agent。", 409);
    const executionId = `execution-ppc-action-${randomUUID()}`;
    const auditId = `amazon-action-${randomUUID()}`;
    const approval = createApprovalRequest({ executionId, riskLevel: "CRITICAL", requestedAt: now, expiresAt, requestedByUserId: scope.actorUserId,
      recommendation: { summary: "人工复核 Amazon update_bid 预览；本版本不会写入 Amazon。", risks: plan.warnings, confidence: 1 },
      action: { type: "amazon.ads.apply", target: auditId, payload: { auditId, workspaceId: scope.workspaceId } } });
    const output = json({ reportSnapshot: input.report, adjustmentDrafts: input.adjustmentDrafts, amazonAdsPlan: plan, auditId, state: "waiting_approval" });
    await tx.agentExecution.create({ data: { id: executionId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentDefinitionId: "ppc", requestedByUserId: scope.actorUserId,
      status: "WAITING_APPROVAL", approvalStatus: "REQUESTED", input: output, context: {}, output, startedAt: now } });
    await tx.agentTask.create({ data: { organizationId: scope.organizationId, executionId, title: "复核 Amazon 出价预览", description: approval.recommendation.summary, status: "waiting_approval", priority: 1, payload: json({ auditId }), result: output } });
    await tx.agentApproval.create({ data: { id: approval.id, organizationId: scope.organizationId, executionId, riskLevel: approval.riskLevel, status: "REQUESTED", recommendation: json(approval.recommendation), action: json(approval.action), requestedByUserId: scope.actorUserId, requestedAt: now, expiresAt } });
    await tx.amazonAgentActionAudit.create({ data: { id: auditId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorUserId: scope.actorUserId,
      actionType: "update_bid", targetType: "ppc-bid-batch", targetId: executionId, status: "PREVIEW", idempotencyKey: key, expiresAt,
      preview: json({ plan, approvalId: approval.id, executionId, requestDigest: digest, externalWriteAttempted: false }),
      oldValues: json(plan.operations.map((row) => ({ target: row.target, bid: record(row.payload).currentBid, source: "submitted_report_unverified" }))),
      newValues: json({ requested: plan.operations.map((row) => ({ target: row.target, bid: record(row.payload).suggestedBid })), externalWriteAttempted: false }) } });
    await tx.agentExecutionTrace.create({ data: { id: randomUUID(), organizationId: scope.organizationId, executionId, sequence: 1, eventType: "approval requested", message: "Amazon bid PREVIEW persisted", payload: json({ auditId, approvalId: approval.id }) } });
    return previewResponse(tx, scope, auditId, approval.id);
  });
}
async function previewResponse(tx: Prisma.TransactionClient, scope: AmazonActionScope, auditId: string, approvalId: string) {
  const audit = await tx.amazonAgentActionAudit.findFirstOrThrow({ where: { id: auditId, organizationId: scope.organizationId, workspaceId: scope.workspaceId } });
  const approval = await tx.agentApproval.findFirstOrThrow({ where: { id: approvalId, organizationId: scope.organizationId } });
  const execution = await tx.agentExecution.findFirstOrThrow({ where: { id: approval.executionId, organizationId: scope.organizationId, workspaceId: scope.workspaceId }, include: { tasks: true, traces: { orderBy: { sequence: "asc" } }, approvals: true, toolCalls: true, events: true } });
  return { audit, approval, execution, task: execution.tasks[0] };
}
export async function confirmAmazonAction(scope: AmazonActionScope, approvalId: string, decision: "APPROVED" | "REJECTED" | "EXPIRED", reason: string, db = prisma, now = new Date()) {
  return db.$transaction(async (tx) => {
    await assertActionWorkspace(tx, scope);
    const approval = await tx.agentApproval.findFirst({ where: { id: approvalId, organizationId: scope.organizationId, execution: { workspaceId: scope.workspaceId } } });
    assertAction(approval && record(approval.action).type === "amazon.ads.apply", "APPROVAL_NOT_FOUND", "当前工作区审批不存在。", 404);
    const auditId = String(record(approval.action).target ?? "");
    await auditLock(tx, scope, auditId);
    const audit = await tx.amazonAgentActionAudit.findFirst({ where: { id: auditId, organizationId: scope.organizationId, workspaceId: scope.workspaceId } });
    assertAction(audit && record(audit.preview).approvalId === approvalId && audit.targetId === approval.executionId, "AUDIT_NOT_FOUND", "审批与预览绑定不一致。", 404);
    assertAction(approval.status === "REQUESTED" && audit.status === "PREVIEW" && !audit.confirmedAt, "ALREADY_RESOLVED", "审批已处理。");
    if (decision !== "EXPIRED") { assertNotExpired(audit.expiresAt, now); assertNotExpired(approval.expiresAt, now); }
    const changed = await tx.agentApproval.updateMany({ where: { id: approvalId, organizationId: scope.organizationId, status: "REQUESTED" }, data: { status: decision, decidedByUserId: scope.actorUserId, decidedAt: now, humanDecision: json({ decision, reason, decidedByUserId: scope.actorUserId, decidedAt: now.toISOString() }) } });
    assertAction(changed.count === 1, "ALREADY_RESOLVED", "审批已被并发处理。");
    // With execution disabled, confirmation stays PREVIEW and confirmedAt records the human decision.
    const status = decision === "APPROVED" ? process.env.AMAZON_ADS_EXECUTION_ENABLED === "true" ? "CONFIRMED" : "PREVIEW" : decision;
    const updated = await tx.amazonAgentActionAudit.update({ where: { id: audit.id }, data: { status, confirmedAt: decision === "APPROVED" ? now : null,
      newValues: json({ ...record(audit.newValues), approvalDecision: decision, confirmedByUserId: scope.actorUserId, reason }) } });
    const executionStatus = decision === "APPROVED" ? "WAITING_TOOL" : "CANCELLED";
    const executionRecord = await tx.agentExecution.findUniqueOrThrow({ where: { id: approval.executionId } });
    await tx.agentExecution.update({ where: { id: approval.executionId }, data: { status: executionStatus, approvalStatus: decision,
      output: json({ ...record(executionRecord.output), state: decision === "APPROVED" ? "approved_waiting_execution" : "cancelled", auditId, approvalDecision: decision }) } });
    const lastTrace = await tx.agentExecutionTrace.findFirst({ where: { executionId: approval.executionId }, orderBy: { sequence: "desc" } });
    await tx.agentExecutionTrace.create({ data: { id: randomUUID(), organizationId: scope.organizationId, executionId: approval.executionId,
      sequence: (lastTrace?.sequence ?? 0) + 1, eventType: "approval result", message: `Amazon preview ${decision.toLowerCase()}`,
      payload: json({ auditId, approvalId, decision, actorUserId: scope.actorUserId }) } });
    await tx.agentEvent.create({ data: { id: randomUUID(), organizationId: scope.organizationId, executionId: approval.executionId, eventType: "approval.result",
      payload: json({ auditId, approvalId, decision, actorUserId: scope.actorUserId }) } });
    await tx.agentTask.updateMany({ where: { executionId: approval.executionId, organizationId: scope.organizationId }, data: { status: decision === "APPROVED" ? "pending" : "cancelled" } });
    return { audit: updated, approval: { ...approval, status: decision }, execution: { id: approval.executionId, status: executionStatus, approvalStatus: decision } };
  });
}
export async function applyAmazonAction(scope: AmazonActionScope, auditId: string, keyInput: unknown, db = prisma, now = new Date()) {
  const key = actionKey(keyInput);
  return db.$transaction(async (tx) => {
    await assertActionWorkspace(tx, scope);
    await auditLock(tx, scope, auditId);
    const audit = await tx.amazonAgentActionAudit.findFirst({ where: { id: auditId, organizationId: scope.organizationId, workspaceId: scope.workspaceId } });
    assertAction(audit, "AUDIT_NOT_FOUND", "当前工作区预览不存在。", 404);
    assertAction(audit.idempotencyKey === key, "IDEMPOTENCY_CONFLICT", "apply 必须使用 preview 的幂等键。");
    const preview = record(audit.preview);
    const approval = await tx.agentApproval.findFirst({ where: { id: String(preview.approvalId), organizationId: scope.organizationId, executionId: audit.targetId, execution: { workspaceId: scope.workspaceId } } });
    assertAction(approval?.status === "APPROVED" && approval.decidedByUserId && approval.decidedAt && audit.confirmedAt && record(approval.action).target === audit.id, "APPROVAL_REQUIRED", "必须先完成此工作区预览的人工审批。", 403);
    // An applied result can be replayed after expiry, but can never be executed twice.
    const prior = record(audit.newValues).execution;
    if (prior) return { audit, execution: prior, replayed: true };
    assertNotExpired(audit.expiresAt, now); assertNotExpired(approval.expiresAt, now);
    assertAction(["PREVIEW", "CONFIRMED"].includes(audit.status), "INVALID_STATE", "审计状态不允许执行。");
    const plan = preview.plan as unknown as AmazonAdsExecutionPlan;
    validateBidPlan(plan);
    const enabled = process.env.AMAZON_ADS_EXECUTION_ENABLED === "true";
    const gateway = createToolGateway({ tools: amazonAdsToolDefinitions, clock: () => now, adapters: [createAmazonAdsApiAdapter({ clock: () => now, writeEnabled: enabled,
      executeApproved: async () => {
        if (enabled) assertAmazonAdsTransportImplemented();
        return { execution: { status: "DRY_RUN_BLOCKED", code: "EXECUTION_DISABLED", externalWriteAttempted: false, message: "执行开关关闭；仅记录 dry_run，未写 Amazon。" } };
      } })] });
    const result = await gateway.invoke({ agent: { ...ppcAgentDefinition, tools: [...ppcAgentDefinition.tools, "amazon.ads.recommendation.apply"], permissions: [...ppcAgentDefinition.permissions, "amazon.ads.write.approved"] },
      executionId: approval.executionId, context: { company: { organizationId: scope.organizationId }, workspace: { workspaceId: scope.workspaceId } }, toolId: "amazon.ads.recommendation.apply",
      input: { auditId, approvalId: approval.id, plan } as unknown as JsonValue,
      approval: { ...approval, expiresAt: approval.expiresAt?.toISOString(), requestedAt: approval.requestedAt.toISOString() } as unknown as AgentApproval });
    const execution = result.status === "SUCCEEDED" ? record(result.output).execution : { status: "FAILED", code: result.error?.code ?? "APPLY_FAILED", message: result.error?.message ?? "执行失败。", externalWriteAttempted: false };
    const failed = result.status !== "SUCCEEDED";
    const updated = await tx.amazonAgentActionAudit.update({ where: { id: audit.id }, data: { status: failed ? "FAILED" : "PREVIEW", newValues: json({ ...record(audit.newValues), execution, attemptedAt: now.toISOString(), attemptedByUserId: scope.actorUserId }) } });
    await tx.agentExecution.update({ where: { id: approval.executionId }, data: { status: failed ? "FAILED" : "COMPLETED", toolCallCount: 1, output: json({ ...record((await tx.agentExecution.findUniqueOrThrow({ where: { id: approval.executionId } })).output), state: failed ? "failed" : "dry_run", auditId, execution }), finishedAt: now } });
    await tx.agentTask.updateMany({ where: { organizationId: scope.organizationId, executionId: approval.executionId }, data: { status: failed ? "failed" : "completed", result: json({ auditId, execution }) } });
    if (result.toolCall) {
      const call = result.toolCall;
      await tx.agentToolCall.create({ data: { id: call.id, organizationId: scope.organizationId, executionId: approval.executionId,
        toolId: call.toolId, toolName: call.toolName, adapterType: call.adapterId, riskLevel: call.riskLevel,
        permission: json(call.permission), status: call.status, input: json(call.input), redactedInput: json(call.redactedInput),
        output: call.output === undefined ? undefined : json(call.output), error: call.error === undefined ? undefined : json(call.error), latencyMs: call.latencyMs, retryCount: call.retryCount } });
    }
    const lastTrace = await tx.agentExecutionTrace.findFirst({ where: { executionId: approval.executionId }, orderBy: { sequence: "desc" } });
    await tx.agentExecutionTrace.create({ data: { id: randomUUID(), organizationId: scope.organizationId, executionId: approval.executionId, sequence: (lastTrace?.sequence ?? 0) + 1, eventType: "action executed", message: failed ? "Amazon write blocked: NOT_IMPLEMENTED" : "Dry run recorded; no Amazon write", payload: json({ auditId, execution }) } });
    return { audit: updated, execution, replayed: false };
  });
}
