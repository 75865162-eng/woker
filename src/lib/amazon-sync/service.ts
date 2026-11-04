import { assertSellerMarketplaceAccess, assertAmazonScopeAdmin } from "./data-access";
import { executionWindowMs } from "./execution-window";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { targetEnvironment } from "./approval-policy";
import { rangeFromFrozen, type RequestedRange } from "./date-range";
import { randomUUID, createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decryptAmazonSpApiCredentials, encryptAmazonSpApiCredentials, mergeAmazonSpApiSettings, type AmazonSpApiSettings } from "@/lib/amazon/integration-secrets";
import { approvedContext } from "./approved-context";
import { digest } from "./approval-policy";
import { AmazonSpApiClient, AmazonSpApiError } from "@/lib/amazon/sp-api-client";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";
import { activeTaskStatuses, boundedInteger, implementedDomain, officialEndpoint, parseSyncPlan, requiredText, requireSyncCenter, SyncInputError, type SyncScope } from "./policy";

export async function scopeLock(tx: Prisma.TransactionClient, scope: SyncScope) {
  const key = JSON.stringify(["amazon-sync-center", scope.organizationId, scope.workspaceId]);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
const authorizationSelect = { id: true, name: true, amazonSellerId: true, awsRegion: true, endpoint: true, revision: true, status: true, marketplaceParticipations: true, lastValidatedAt: true, validationAttemptedAt: true, validationErrorCode: true, updatedAt: true } satisfies Prisma.AmazonSpApiAuthorizationSelect;
export async function listAuthorizations(scope: SyncScope) {
  return prisma.amazonSpApiAuthorization.findMany({ where: scope, select: authorizationSelect, orderBy: { createdAt: "asc" } });
}
export async function saveAuthorization(scope: SyncScope, actorUserId: string, body: Record<string, unknown>) {
  const { tx: db } = approvedContext(scope, "save-authorization");
  requireSyncCenter(scope);
  await assertAmazonScopeAdmin(scope, actorUserId, db);
  const id = body.id === undefined ? requiredText(body.proposedId, "新记录 ID") : requiredText(body.id, "授权 ID");
  const existing = await db.amazonSpApiAuthorization.findFirst({ where: { ...scope, id } });
  if (body.id && !existing) throw new SyncInputError("授权不存在。", 404);
  if (existing && body.revision !== existing.revision) throw new SyncInputError("授权已更新，请刷新后重新编辑。", 409);
  const name = requiredText(body.name, "授权名称", 100), amazonSellerId = requiredText(body.amazonSellerId, "Amazon Seller ID");
  const region = requiredText(body.region, "区域"), endpoint = requiredText(body.endpoint, "API endpoint");
  officialEndpoint(region, endpoint);
  if (existing && (existing.amazonSellerId !== amazonSellerId || existing.awsRegion !== region || existing.endpoint !== endpoint)) throw new SyncInputError("卖家身份、区域和 endpoint 不可原地更换，请新增授权。");
  const credentials = existing ? decryptAmazonSpApiCredentials(existing.credentialsCiphertext, { ...scope, authorizationId: id }) : null;
  const submitted: Partial<AmazonSpApiSettings> = { region, endpoint };
  for (const field of ["lwaClientId", "lwaClientSecret", "refreshToken", "awsAccessKeyId", "awsSecretAccessKey", "awsSessionToken"] as const) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || (body[field] as string).length > 16384)) throw new SyncInputError("凭证格式无效或超出长度限制。");
    if (typeof body[field] === "string") submitted[field] = body[field];
  }
  const settings = mergeAmazonSpApiSettings(credentials, submitted);
  const credentialsCiphertext = encryptAmazonSpApiCredentials(settings, { ...scope, authorizationId: id });
  return (async (tx: Prisma.TransactionClient) => {
    await scopeLock(tx, scope);
    if (existing) {
      const changed = await tx.amazonSpApiAuthorization.updateMany({ where: { ...scope, id, revision: body.revision as number }, data: { name, credentialsCiphertext, revision: { increment: 1 }, identityVerifiedAt: null, identityEvidence: "MANUAL_UNVERIFIED", status: "NOT_CONFIGURED", marketplaceParticipations: [], lastValidatedAt: null, validationAttemptedAt: null, validationErrorCode: null, updatedByUserId: actorUserId } });
      if (!changed.count) throw new SyncInputError("授权已更新，请刷新。", 409);
    } else await tx.amazonSpApiAuthorization.create({ data: { ...scope, id, name, amazonSellerId, awsRegion: region, endpoint, credentialsCiphertext, updatedByUserId: actorUserId } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.saved", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, importedLegacy: body.importLegacy === true, encrypted: true } } });
    return tx.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id }, select: authorizationSelect });
  })(db);
}
export async function performAuthorizationValidation(scope: SyncScope, actorUserId: string, id: string, expectedRevision: number, approvalId?: string) {
  if (!approvalId) throw new SyncInputError("APPROVAL_REQUIRED：授权验证必须使用已领取的执行审批。", 428);
  const grant = await prisma.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id: approvalId, status: "APPLYING", operation: "validate-authorization", targetId: id, baseRevision: expectedRevision, targetEnvironment: targetEnvironment() } });
  await assertAmazonScopeAdmin(scope, actorUserId);
  if (!grant?.approvedByUserId) throw new SyncInputError("授权验证执行审批无效。", 403);
  const members = await prisma.organizationMember.findMany({ where: { organizationId: scope.organizationId, userId: { in: [actorUserId, grant.approvedByUserId] } }, include: { user: { select: { status: true } } } });
  const actor = members.find(m => m.userId === actorUserId), approver = members.find(m => m.userId === grant.approvedByUserId), permissions = await getOrganizationRolePermissions(scope.organizationId);
  if (!actor || !approver || actor.user.status !== "active" || approver.user.status !== "active" || !roleCanPerformAction(actor.role, "settings", "edit", permissions) || !roleCanPerformAction(approver.role, "operations", "approve", permissions)) throw new SyncInputError("授权验证操作人或审批人权限已变化。", 403);
  const auth = await prisma.amazonSpApiAuthorization.findFirst({ where: { ...scope, id } });
  if (!auth || auth.status === "DISABLED" || auth.revision !== expectedRevision) throw new SyncInputError("授权不存在、已停用或版本已变化。", 409);
  officialEndpoint(auth.awsRegion, auth.endpoint);
  const credentials = decryptAmazonSpApiCredentials(auth.credentialsCiphertext, { ...scope, authorizationId: id });
  const attemptedAt = new Date();
  try {
    const payload = await new AmazonSpApiClient({ ...credentials, region: auth.awsRegion, endpoint: auth.endpoint }).getMarketplaceParticipations();
    const participations = extractMarketplaceParticipations(payload);
    if (!participations.length) throw new SyncInputError("Amazon 未返回可用 Marketplace 参与站点。", 409);
    const changed = await prisma.amazonSpApiAuthorization.updateMany({ where: { ...scope, id, revision: auth.revision, status: { not: "DISABLED" } }, data: { status: "CONFIGURED", marketplaceParticipations: participations as Prisma.InputJsonValue, lastValidatedAt: attemptedAt, validationAttemptedAt: attemptedAt, validationErrorCode: null, revision: { increment: 1 }, updatedByUserId: actorUserId } });
    if (!changed.count) throw new SyncInputError("授权在验证期间已发生变更。", 409);
    await prisma.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.validated", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, marketplaceCount: participations.length, credentialsEncrypted: true } } });
    return { validated: true, marketplaceCount: participations.length };
  } catch (error) {
    const errorCode = error instanceof AmazonSpApiError && error.authorizationRejected ? "AUTH_REJECTED" : error instanceof SyncInputError ? "INVALID_PARTICIPATIONS" : "VALIDATION_FAILED";
    await prisma.amazonSpApiAuthorization.updateMany({ where: { ...scope, id, revision: auth.revision, status: { not: "DISABLED" } }, data: { status: errorCode === "AUTH_REJECTED" ? "ERROR" : "NOT_CONFIGURED", validationAttemptedAt: attemptedAt, validationErrorCode: errorCode } });
    await prisma.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.validation_failed", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, code: errorCode } } });
    if (error instanceof SyncInputError) throw error;
    throw new SyncInputError("Amazon 授权验证失败；错误信息已脱敏记录。", 409);
  }
}
/** Compatibility symbol is fail-closed; application callers use change-approval.ts. */
export async function validateAuthorization(scope: SyncScope, actorUserId: string, id: string) {
  const context = approvedContext(scope, "validate-authorization");
  const auth = await context.tx.amazonSpApiAuthorization.findFirst({ where: { ...scope, id }, select: { revision: true } });
  if (!auth) throw new SyncInputError("授权不存在。", 404);
  return performAuthorizationValidation(scope, actorUserId, id, auth.revision, context.approvalId);
}

export async function saveSource(scope: SyncScope, actorUserId: string, body: Record<string, unknown>) {
  const { tx: db } = approvedContext(scope, "save-source");
  await assertAmazonScopeAdmin(scope, actorUserId, db);
  requireSyncCenter(scope);
  const authorizationId = requiredText(body.authorizationId, "授权"), sellerAccountId = requiredText(body.sellerAccountId, "ERP 店铺"), marketplaceId = requiredText(body.marketplaceId, "Marketplace ID");
  const resource = implementedDomain(body.resource), freshnessMinutes = boundedInteger(body.freshnessMinutes, "新鲜度分钟", 15, 43200, resource === "inventory" ? 360 : 2880);
  if (typeof body.enabled !== "boolean") throw new SyncInputError("请选择数据源是否启用。");
  return (async (tx: Prisma.TransactionClient) => {
    await scopeLock(tx, scope);
    const existing = await tx.amazonSyncDataSource.findUnique({ where: { organizationId_workspaceId_sellerAccountId_marketplaceId_resource: { ...scope, sellerAccountId, marketplaceId, resource } } });
    // Stopping an existing source must remain possible after its credentials or seller become unavailable.
    if (existing && existing.authorizationId !== authorizationId) throw new SyncInputError("数据源不允许原地更换授权；需单独评审迁移历史归属。", 409);
    if (existing && body.enabled === false) {
      const row = await tx.amazonSyncDataSource.update({ where: { id: existing.id }, data: { enabled: false, freshnessMinutes, revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.source.saved", entityType: "AmazonSyncDataSource", entityId: row.id, metadata: { workspaceId: scope.workspaceId, enabled: false } } });
      return row;
    }
    const auth = await tx.amazonSpApiAuthorization.findFirst({ where: { ...scope, id: authorizationId, status: "CONFIGURED" } });
    const seller = await tx.sellerAccount.findFirst({ where: { ...scope, id: sellerAccountId, status: "active" } });
    if (!auth || !seller) throw new SyncInputError("授权未验证，或店铺不属于当前范围／已停用。", 409);
    const conflicting = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, sellerAccountId, marketplaceId, authorizationId: { not: authorizationId } }, select: { id: true } });
    const identity = await tx.amazonSellerIdentity.findFirst({ where: { ...scope, marketplaceId, OR: [{ sellerAccountId }, { authorizationId }] }, select: { authorizationId: true, sellerAccountId: true } });
    if (conflicting || (identity && (identity.authorizationId !== authorizationId || identity.sellerAccountId !== sellerAccountId))) throw new SyncInputError("同一店铺站点的数据域必须使用同一授权；须先核查历史归属。", 409);
    const sites = extractMarketplaceParticipations({ payload: auth.marketplaceParticipations });
    if (!sites.some(s => s.marketplaceId === marketplaceId)) throw new SyncInputError("该站点不在已验证参与站点内。");
    if (!existing && await tx.amazonSyncDataSource.count({ where: scope }) >= 200) throw new SyncInputError("试点最多支持 200 个数据源，扩容需性能评审。", 409);
    const duplicate = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, authorizationId, marketplaceId, NOT: { sellerAccountId } } });
    if (duplicate) throw new SyncInputError("同一卖家、站点和数据域不能映射到多个 ERP 店铺。", 409);
    const row = await tx.amazonSyncDataSource.upsert({ where: { organizationId_workspaceId_sellerAccountId_marketplaceId_resource: { ...scope, sellerAccountId, marketplaceId, resource } }, create: { ...scope, id: requiredText(body.proposedId, "新数据源 ID"), authorizationId, sellerAccountId, marketplaceId, resource, freshnessMinutes, enabled: body.enabled as boolean }, update: { freshnessMinutes, enabled: body.enabled as boolean, revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.source.saved", entityType: "AmazonSyncDataSource", entityId: row.id, metadata: { workspaceId: scope.workspaceId, enabled: row.enabled } } });
    return row;
  })(db);
}
export async function savePlan(scope: SyncScope, actorUserId: string, body: Record<string, unknown>) {
  const { tx: db } = approvedContext(scope, "save-plan");
  requireSyncCenter(scope); const plan = parseSyncPlan(body);
  const id = body.id === undefined ? requiredText(body.proposedId, "新计划 ID") : requiredText(body.id, "计划 ID");
  const { sourceIds, ...fields } = plan;
  return (async (tx: Prisma.TransactionClient) => {
    await scopeLock(tx, scope);
    const existing = await tx.amazonSyncSchedule.findFirst({ where: { ...scope, id, executionVersion: 2 } });
    if (body.id && !existing) throw new SyncInputError("计划不存在。", 404);
    if (!existing && await tx.amazonSyncSchedule.count({ where: { ...scope, executionVersion: 2 } }) >= 200) throw new SyncInputError("试点最多支持 200 个计划，扩容需性能评审。", 409);
    if (existing && body.revision !== existing.revision) throw new SyncInputError("计划已被更新，请刷新。", 409);
    const sources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, id: { in: sourceIds }, resource: plan.resource, ...(plan.enabled ? { enabled: true } : {}) } });
    if (sources.length !== sourceIds.length) throw new SyncInputError("计划范围包含无效、停用或其他数据域的数据源。");
    for (const source of sources) await assertSellerMarketplaceAccess(scope, actorUserId, source.sellerAccountId, source.marketplaceId, tx, "sync");
    if (plan.enabled) {
      const conflict = await tx.amazonSyncPlanTarget.findFirst({ where: { ...scope, sourceId: { in: sourceIds }, schedule: { enabled: true, executionVersion: 2, NOT: { id } } } });
      if (conflict) throw new SyncInputError("相同数据源已有启用的快照计划；请先暂停原计划。", 409);
    }
    const data = { ...fields, nextRunAt: plan.enabled ? new Date(Date.now() + plan.intervalMinutes * 60000) : null, updatedByUserId: actorUserId };
    const row = existing ? await tx.amazonSyncSchedule.update({ where: { id }, data: { ...data, revision: { increment: 1 } } }) : await tx.amazonSyncSchedule.create({ data: { ...scope, id, planKey: id, executionVersion: 2, ...data } });
    await tx.amazonSyncPlanTarget.deleteMany({ where: { ...scope, scheduleId: id } });
    await tx.amazonSyncPlanTarget.createMany({ data: sourceIds.map(sourceId => ({ ...scope, scheduleId: id, sourceId })) });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.plan.saved", entityType: "AmazonSyncSchedule", entityId: id, metadata: { workspaceId: scope.workspaceId, revision: row.revision, enabled: row.enabled, targetCount: sourceIds.length } } });
    return row;
  })(db);
}
export async function createTask(tx: Prisma.TransactionClient, scope: SyncScope, actorUserId: string, sourceId: string, options: { key: string; trigger: string; scheduleId?: string; scheduleRevision?: number; maxAttempts?: number; priority?: number; requestedRange?: RequestedRange }) {
  const approval = approvedContext(scope, "run");
  scope = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: sourceId, enabled: true }, include: { authorization: true, seller: true } });
  if (!source || source.authorization.status !== "CONFIGURED" || source.seller.status !== "active") throw new SyncInputError("数据源、授权或店铺不可用。", 409);
  implementedDomain(source.resource);
  await assertSellerMarketplaceAccess(scope, actorUserId, source.sellerAccountId, source.marketplaceId, tx, "sync");
  const existing = await tx.amazonSyncRun.findUnique({ where: { organizationId_workspaceId_idempotencyKey: { ...scope, idempotencyKey: options.key } } });
  if (existing) {
    if (existing.sourceId !== sourceId || existing.executionVersion !== 2) throw new SyncInputError("幂等键已用于其他范围。", 409);
    return existing;
  }
  const active = await tx.amazonSyncRun.findFirst({ where: { ...scope, sourceId, status: { in: activeTaskStatuses } } });
  if (active) throw new SyncInputError("该数据源已有活动任务；请先完成或取消后重新申请执行审批。", 409);
  if (!approval.commandSourceIds?.includes(sourceId)) throw new SyncInputError("任务目标超出执行审批范围。", 403);
  if (source.resource === "sales_traffic") rangeFromFrozen({ requestedRange: options.requestedRange });
  const frozenScope = { executionExpiresAt: new Date(Date.now() + executionWindowMs).toISOString(), sourceId: source.id, sourceRevision: source.revision, authorizationId: source.authorization.id, authorizationRevision: source.authorization.revision, amazonSellerId: source.authorization.amazonSellerId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, resource: source.resource, ...(options.requestedRange ? { requestedRange: options.requestedRange } : {}) };
  return tx.amazonSyncRun.create({ data: { ...scope, id: randomUUID(), executionVersion: 2, sourceId, requestedByUserId: actorUserId, resource: source.resource, authorizationRevision: source.authorization.revision, idempotencyKey: options.key,
    executionApprovalId: approval.approvalId, frozenScope, frozenScopeDigest: digest(frozenScope),
    mode: source.resource === "sales_traffic" ? "date_range" : "snapshot", status: "WAITING", trigger: options.trigger, scheduleId: options.scheduleId, scheduleRevision: options.scheduleRevision, maxAttempts: options.maxAttempts ?? 3, priority: options.priority ?? 1 } });
}
export async function requestTasks(scope: SyncScope, actorUserId: string, body: Record<string, unknown>) {
  const { tx: db } = approvedContext(scope, "run");
  requireSyncCenter(scope);
  const key = requiredText(body.idempotencyKey, "幂等键", 160);
  if (!Array.isArray(body.sourceIds) || !body.sourceIds.length || body.sourceIds.length > 100 || body.sourceIds.some(v => typeof v !== "string")) throw new SyncInputError("请选择 1–100 个数据源。");
  const sourceIds = [...new Set(body.sourceIds as string[])];
  return (async (tx: Prisma.TransactionClient) => {
    await scopeLock(tx, scope);
    const plan = body.planId ? await tx.amazonSyncSchedule.findFirst({ where: { ...scope, id: requiredText(body.planId, "计划 ID"), executionVersion: 2 }, include: { targets: true } }) : null;
    if (body.planId && (!plan || sourceIds.some(id => !plan.targets.some(t => t.sourceId === id)))) throw new SyncInputError("手动执行目标不属于该计划。", 409);
    const fingerprint = createHash("sha256").update(JSON.stringify([[...sourceIds].sort(), plan?.id ?? null, body.requestedRanges ?? null])).digest("hex");
    // A request record in the audit table binds a user key to the complete fan-out payload.
    const requestId = createHash("sha256").update(JSON.stringify([scope.organizationId, scope.workspaceId, key])).digest("hex");
    const prior = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, action: "amazon.sync.request", entityId: requestId }, orderBy: { createdAt: "asc" } });
    if (prior) {
      const metadata = prior.metadata as { fingerprint?: string; taskIds?: string[] } | null;
      if (metadata?.fingerprint !== fingerprint || !Array.isArray(metadata.taskIds)) throw new SyncInputError("幂等键已用于不同目标。", 409);
      return tx.amazonSyncRun.findMany({ where: { ...scope, id: { in: metadata.taskIds } } });
    }
    const runs = [];
    for (const sourceId of sourceIds) runs.push(await createTask(tx, scope, actorUserId, sourceId, { key: `manual:${requestId}:${sourceId}`, trigger: "manual", scheduleId: plan?.id, scheduleRevision: plan?.revision, maxAttempts: plan?.maxAttempts, priority: plan?.priority, requestedRange: (body.requestedRanges as Record<string, RequestedRange> | undefined)?.[sourceId] }));
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.request", entityType: "AmazonSyncRun", entityId: requestId, metadata: { workspaceId: scope.workspaceId, fingerprint, taskIds: runs.map(r => r.id) } } });
    return runs;
  })(db);
}
export async function controlTask(scope: SyncScope, actorUserId: string, id: string, action: unknown) {
  const { tx: db } = approvedContext(scope, "control-task");
  requireSyncCenter(scope);
  if (!["retry", "pause", "resume", "cancel"].includes(String(action))) throw new SyncInputError("无效任务操作。");
  return (async (tx: Prisma.TransactionClient) => {
    await scopeLock(tx, scope);
    const run = await tx.amazonSyncRun.findFirst({ where: { ...scope, id, executionVersion: 2 } });
    if (!run) throw new SyncInputError("任务不存在。", 404);
    const targetSource = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: run.sourceId! }, select: { sellerAccountId: true, marketplaceId: true } });
    if (!targetSource) throw new SyncInputError("数据源不存在。", 404);
    await assertSellerMarketplaceAccess(scope, actorUserId, targetSource.sellerAccountId, targetSource.marketplaceId, tx, "sync");
    if (run.status === "SUCCEEDED" || run.status === "CANCELLED") throw new SyncInputError("该任务已结束。", 409);
    let data: Prisma.AmazonSyncRunUncheckedUpdateManyInput;
    if (action === "cancel" || action === "pause") {
      if (!activeTaskStatuses.includes(run.status)) throw new SyncInputError("当前任务不可暂停／取消。", 409);
      data = run.status === "RUNNING" ? { control: action === "cancel" ? "CANCEL" : "PAUSE" } : { status: action === "cancel" ? "CANCELLED" : "PAUSED", control: null, finishedAt: action === "cancel" ? new Date() : null, dispatchVersion: { increment: 1 } };
    } else {
      if (action === "retry" ? !["FAILED", "BLOCKED", "PARTIAL_SUCCESS"].includes(run.status) : run.status !== "PAUSED") throw new SyncInputError("当前任务不可重试／恢复。", 409);
      const collision = await tx.amazonSyncRun.findFirst({ where: { ...scope, sourceId: run.sourceId, id: { not: id }, status: { in: activeTaskStatuses } } });
      if (collision) throw new SyncInputError("该范围已有其他活动任务。", 409);
      // New retry window is explicit and bounded; historical attempt logs/counters remain.
      if (action === "retry" && run.stage === "PURGED") throw new SyncInputError("历史检查点已按保留策略清理，请新建同步任务。", 409);
      const approval = approvedContext(scope, "control-task");
      if (!approval.commandSourceIds?.includes(run.sourceId!)) throw new SyncInputError("操作超出审批范围。", 403);
      if (action === "retry") {
        await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.task.retry", entityType: "AmazonSyncRun", entityId: id, metadata: { workspaceId: scope.workspaceId, previousStatus: run.status, previousAttempt: run.attempts, previousSummary: run.summary, executionApprovalId: approval.approvalId } } });
        await tx.amazonSyncPage.deleteMany({ where: { ...scope, taskId: id } });
        await tx.amazonInventorySnapshot.deleteMany({ where: { ...scope, syncRunId: id } });
        await tx.amazonCatalogSnapshot.deleteMany({ where: { ...scope, sourceRunId: id } });
        await tx.amazonSalesTrafficSnapshot.deleteMany({ where: { ...scope, syncRunId: id } });
      }
      const renewedFrozen = { ...(run.frozenScope as Prisma.JsonObject ?? {}), executionExpiresAt: new Date(Date.now() + executionWindowMs).toISOString() };
      data = { status: "WAITING", executionApprovalId: approval.approvalId, requestedByUserId: actorUserId, control: null, error: null, finishedAt: null, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: new Date(), dispatchVersion: { increment: 1 }, maxAttempts: run.attempts + 3,
        frozenScope: renewedFrozen, frozenScopeDigest: digest(renewedFrozen),
        ...(action === "retry" ? { checkpointCiphertext: null, stage: "WAITING", pagesCompleted: 0, paginationComplete: false, processedCount: 0, insertedCount: 0, updatedCount: 0, skippedCount: 0, summary: Prisma.DbNull, executionStartedAt: null } : {}) };

    }
    await tx.amazonSyncRun.update({ where: { id }, data });
    await tx.amazonSyncTaskLog.create({ data: { ...scope, id: randomUUID(), taskId: id, attempt: run.attempts, event: String(action).toUpperCase(), stage: run.stage } });
    return tx.amazonSyncRun.findUniqueOrThrow({ where: { id } });
  })(db);
}

export async function disableAuthorization(scope: SyncScope, actorUserId: string, id: string, revision: unknown) {
  const { tx: db } = approvedContext(scope, "disable-authorization");
  await assertAmazonScopeAdmin(scope, actorUserId, db);
  requireSyncCenter(scope);
  if (!Number.isInteger(revision)) throw new SyncInputError("请提供授权版本。");
  return (async (tx: Prisma.TransactionClient) => {
    await scopeLock(tx, scope);
    const changed = await tx.amazonSpApiAuthorization.updateMany({ where: { ...scope, id, revision: revision as number }, data: { status: "DISABLED", revision: { increment: 1 } } });
    if (!changed.count) throw new SyncInputError("授权不存在或已更新。", 409);
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.disabled", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId } } });
    return { disabled: true };
  })(db);
}
