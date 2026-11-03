import { randomUUID, createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AmazonSpApiClient } from "@/lib/amazon/sp-api-client";
import { decryptAmazonSpApiCredentials, encryptAmazonSpApiCredentials, mergeAmazonSpApiSettings, type AmazonSpApiSettings } from "@/lib/amazon/integration-secrets";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";
import { activeTaskStatuses, boundedInteger, implementedDomain, officialEndpoint, parseSyncPlan, requiredText, requireSyncCenter, SyncInputError, type SyncScope } from "./policy";

export async function scopeLock(tx: Prisma.TransactionClient, scope: SyncScope) {
  const key = JSON.stringify(["amazon-sync-center", scope.organizationId, scope.workspaceId]);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
export async function assertLegacyDrained(tx: Prisma.TransactionClient, scope: SyncScope) {
  const active = await tx.amazonSyncRun.count({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, executionVersion: 1, resource: { in: ["inventory", "catalog"] }, status: { in: ["QUEUED", "RUNNING"] } } });
  if (active) throw new SyncInputError("旧同步任务尚未排空；请先关闭旧计划并等待旧 Worker 结束，再启用试点。", 409);
}
const authorizationSelect = { id: true, name: true, amazonSellerId: true, awsRegion: true, endpoint: true, revision: true, status: true, marketplaceParticipations: true, lastValidatedAt: true, updatedAt: true } satisfies Prisma.AmazonSpApiAuthorizationSelect;
export async function listAuthorizations(scope: SyncScope) {
  return prisma.amazonSpApiAuthorization.findMany({ where: scope, select: authorizationSelect, orderBy: { createdAt: "asc" } });
}
export async function saveAuthorization(scope: SyncScope, actorUserId: string, body: Record<string, unknown>) {
  requireSyncCenter(scope);
  const id = body.id === undefined ? randomUUID() : requiredText(body.id, "授权 ID");
  const existing = await prisma.amazonSpApiAuthorization.findFirst({ where: { ...scope, id } });
  if (body.id && !existing) throw new SyncInputError("授权不存在。", 404);
  if (existing && body.revision !== existing.revision) throw new SyncInputError("授权已更新，请刷新后重新编辑。", 409);
  const name = requiredText(body.name, "授权名称", 100), amazonSellerId = requiredText(body.amazonSellerId, "Amazon Seller ID");
  const region = requiredText(body.region, "区域"), endpoint = requiredText(body.endpoint, "API endpoint");
  officialEndpoint(region, endpoint);
  if (existing && (existing.amazonSellerId !== amazonSellerId || existing.awsRegion !== region)) throw new SyncInputError("卖家身份和区域不可原地更换，请新增授权。");
  let credentials = existing ? decryptAmazonSpApiCredentials(existing.credentialsCiphertext, { ...scope, authorizationId: id }) : null;
  if (body.importLegacy === true) {
    if (existing) throw new SyncInputError("旧凭证仅可导入新授权。");
    const legacy = await prisma.amazonIntegrationSecret.findUnique({ where: { organizationId_workspaceId: scope } });
    if (!legacy) throw new SyncInputError("当前范围没有可导入的旧凭证。");
    credentials = decryptAmazonSpApiCredentials(legacy.credentialsCiphertext, scope);
    if (legacy.awsRegion !== region || legacy.endpoint !== endpoint) throw new SyncInputError("导入区域必须与旧凭证一致。");
  }
  const submitted: Partial<AmazonSpApiSettings> = { region, endpoint };
  for (const field of ["lwaClientId", "lwaClientSecret", "refreshToken", "awsAccessKeyId", "awsSecretAccessKey", "awsSessionToken"] as const) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || (body[field] as string).length > 16384)) throw new SyncInputError("凭证格式无效或超出长度限制。");
    if (typeof body[field] === "string") submitted[field] = body[field];
  }
  const settings = mergeAmazonSpApiSettings(credentials, submitted);
  const credentialsCiphertext = encryptAmazonSpApiCredentials(settings, { ...scope, authorizationId: id });
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertLegacyDrained(tx, scope);
    if (existing) {
      const changed = await tx.amazonSpApiAuthorization.updateMany({ where: { ...scope, id, revision: body.revision as number }, data: { name, credentialsCiphertext, revision: { increment: 1 }, status: "NOT_CONFIGURED", marketplaceParticipations: [], lastValidatedAt: null, updatedByUserId: actorUserId } });
      if (!changed.count) throw new SyncInputError("授权已更新，请刷新。", 409);
    } else await tx.amazonSpApiAuthorization.create({ data: { ...scope, id, name, amazonSellerId, awsRegion: region, endpoint, credentialsCiphertext, updatedByUserId: actorUserId } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.saved", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, importedLegacy: body.importLegacy === true, encrypted: true } } });
    return tx.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id }, select: authorizationSelect });
  });
}
export async function validateAuthorization(scope: SyncScope, actorUserId: string, id: string) {
  requireSyncCenter(scope);
  const auth = await prisma.amazonSpApiAuthorization.findFirst({ where: { ...scope, id } });
  if (!auth) throw new SyncInputError("授权不存在。", 404);
  officialEndpoint(auth.awsRegion, auth.endpoint);
  const client = new AmazonSpApiClient({ ...decryptAmazonSpApiCredentials(auth.credentialsCiphertext, { ...scope, authorizationId: auth.id }), region: auth.awsRegion, endpoint: auth.endpoint });
  const participationResponse = await client.getMarketplaceParticipations() as { payload?: unknown };
  if (!Array.isArray(participationResponse?.payload)) throw new SyncInputError("Amazon 站点响应结构无效。", 409);
  const marketplaces = extractMarketplaceParticipations({ payload: participationResponse.payload.filter(row => !row || typeof row !== "object" || !("participation" in row) || !row.participation || typeof row.participation !== "object" || !("isParticipating" in row.participation) || row.participation.isParticipating !== false) });
  if (!marketplaces.length) throw new SyncInputError("Amazon 未返回可用的参与站点，不能标记验证成功。", 409);
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope);
    const changed = await tx.amazonSpApiAuthorization.updateMany({ where: { ...scope, id, revision: auth.revision }, data: { status: "CONFIGURED", marketplaceParticipations: marketplaces, lastValidatedAt: new Date() } });
    if (!changed.count) throw new SyncInputError("验证期间凭证发生变化，请重新验证。", 409);
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.validated", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, marketplaceCount: marketplaces.length, sellerIdentity: "operator_declared", domainGrants: "not_proven" } } });
    return tx.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id }, select: authorizationSelect });
  });
}
export async function saveSource(scope: SyncScope, actorUserId: string, body: Record<string, unknown>) {
  requireSyncCenter(scope);
  const authorizationId = requiredText(body.authorizationId, "授权"), sellerAccountId = requiredText(body.sellerAccountId, "ERP 店铺"), marketplaceId = requiredText(body.marketplaceId, "Marketplace ID");
  const resource = implementedDomain(body.resource), freshnessMinutes = boundedInteger(body.freshnessMinutes, "新鲜度分钟", 15, 43200, resource === "inventory" ? 360 : 2880);
  if (typeof body.enabled !== "boolean") throw new SyncInputError("请选择数据源是否启用。");
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertLegacyDrained(tx, scope);
    const existing = await tx.amazonSyncDataSource.findUnique({ where: { organizationId_workspaceId_sellerAccountId_marketplaceId_resource: { ...scope, sellerAccountId, marketplaceId, resource } } });
    // Stopping an existing source must remain possible after its credentials or seller become unavailable.
    if (existing && existing.authorizationId !== authorizationId) throw new SyncInputError("数据源不允许原地更换授权；需单独评审迁移历史归属。", 409);
    if (existing && body.enabled === false) {
      const row = await tx.amazonSyncDataSource.update({ where: { id: existing.id }, data: { enabled: false, freshnessMinutes } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.source.saved", entityType: "AmazonSyncDataSource", entityId: row.id, metadata: { workspaceId: scope.workspaceId, enabled: false } } });
      return row;
    }
    const auth = await tx.amazonSpApiAuthorization.findFirst({ where: { ...scope, id: authorizationId, status: "CONFIGURED" } });
    const seller = await tx.sellerAccount.findFirst({ where: { ...scope, id: sellerAccountId, status: "active" } });
    if (!auth || !seller) throw new SyncInputError("授权未验证，或店铺不属于当前范围／已停用。", 409);
    const sites = extractMarketplaceParticipations({ payload: auth.marketplaceParticipations });
    if (!sites.some(s => s.marketplaceId === marketplaceId)) throw new SyncInputError("该站点不在已验证参与站点内。");
    if (!existing && await tx.amazonSyncDataSource.count({ where: scope }) >= 200) throw new SyncInputError("试点最多支持 200 个数据源，扩容需性能评审。", 409);
    const duplicate = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, authorizationId, marketplaceId, resource, NOT: { sellerAccountId } } });
    if (duplicate) throw new SyncInputError("同一卖家、站点和数据域不能映射到多个 ERP 店铺。", 409);
    const row = await tx.amazonSyncDataSource.upsert({ where: { organizationId_workspaceId_sellerAccountId_marketplaceId_resource: { ...scope, sellerAccountId, marketplaceId, resource } }, create: { ...scope, id: randomUUID(), authorizationId, sellerAccountId, marketplaceId, resource, freshnessMinutes, enabled: body.enabled as boolean }, update: { freshnessMinutes, enabled: body.enabled as boolean } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.source.saved", entityType: "AmazonSyncDataSource", entityId: row.id, metadata: { workspaceId: scope.workspaceId, enabled: row.enabled } } });
    return row;
  });
}
export async function savePlan(scope: SyncScope, actorUserId: string, body: Record<string, unknown>) {
  requireSyncCenter(scope); const plan = parseSyncPlan(body);
  const id = body.id === undefined ? randomUUID() : requiredText(body.id, "计划 ID");
  const { sourceIds, ...fields } = plan;
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertLegacyDrained(tx, scope);
    const existing = await tx.amazonSyncSchedule.findFirst({ where: { ...scope, id, executionVersion: 2 } });
    if (body.id && !existing) throw new SyncInputError("计划不存在。", 404);
    if (!existing && await tx.amazonSyncSchedule.count({ where: { ...scope, executionVersion: 2 } }) >= 200) throw new SyncInputError("试点最多支持 200 个计划，扩容需性能评审。", 409);
    if (existing && body.revision !== existing.revision) throw new SyncInputError("计划已被更新，请刷新。", 409);
    const sources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, id: { in: sourceIds }, resource: plan.resource, ...(plan.enabled ? { enabled: true } : {}) } });
    if (sources.length !== sourceIds.length) throw new SyncInputError("计划范围包含无效、停用或其他数据域的数据源。");
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
  });
}
export async function createTask(tx: Prisma.TransactionClient, scope: SyncScope, actorUserId: string, sourceId: string, options: { key: string; trigger: string; scheduleId?: string; scheduleRevision?: number; maxAttempts?: number; priority?: number }) {
  scope = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: sourceId, enabled: true }, include: { authorization: true, seller: true } });
  if (!source || source.authorization.status !== "CONFIGURED" || source.seller.status !== "active") throw new SyncInputError("数据源、授权或店铺不可用。", 409);
  implementedDomain(source.resource);
  const existing = await tx.amazonSyncRun.findUnique({ where: { organizationId_workspaceId_idempotencyKey: { ...scope, idempotencyKey: options.key } } });
  if (existing) {
    if (existing.sourceId !== sourceId || existing.executionVersion !== 2) throw new SyncInputError("幂等键已用于其他范围。", 409);
    return existing;
  }
  const active = await tx.amazonSyncRun.findFirst({ where: { ...scope, sourceId, status: { in: activeTaskStatuses } } });
  if (active) return active;
  return tx.amazonSyncRun.create({ data: { ...scope, id: randomUUID(), executionVersion: 2, sourceId, requestedByUserId: actorUserId, resource: source.resource, idempotencyKey: options.key,
    status: "WAITING", trigger: options.trigger, scheduleId: options.scheduleId, scheduleRevision: options.scheduleRevision, maxAttempts: options.maxAttempts ?? 3, priority: options.priority ?? 1 } });
}
export async function requestTasks(scope: SyncScope, actorUserId: string, body: Record<string, unknown>) {
  requireSyncCenter(scope);
  const key = requiredText(body.idempotencyKey, "幂等键", 160);
  if (!Array.isArray(body.sourceIds) || !body.sourceIds.length || body.sourceIds.length > 100 || body.sourceIds.some(v => typeof v !== "string")) throw new SyncInputError("请选择 1–100 个数据源。");
  const sourceIds = [...new Set(body.sourceIds as string[])];
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertLegacyDrained(tx, scope);
    const plan = body.planId ? await tx.amazonSyncSchedule.findFirst({ where: { ...scope, id: requiredText(body.planId, "计划 ID"), executionVersion: 2 }, include: { targets: true } }) : null;
    if (body.planId && (!plan || sourceIds.some(id => !plan.targets.some(t => t.sourceId === id)))) throw new SyncInputError("手动执行目标不属于该计划。", 409);
    const fingerprint = createHash("sha256").update(JSON.stringify([[...sourceIds].sort(), plan?.id ?? null])).digest("hex");
    // A request record in the audit table binds a user key to the complete fan-out payload.
    const requestId = createHash("sha256").update(JSON.stringify([scope.organizationId, scope.workspaceId, key])).digest("hex");
    const prior = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, action: "amazon.sync.request", entityId: requestId }, orderBy: { createdAt: "asc" } });
    if (prior) {
      const metadata = prior.metadata as { fingerprint?: string; taskIds?: string[] } | null;
      if (metadata?.fingerprint !== fingerprint || !Array.isArray(metadata.taskIds)) throw new SyncInputError("幂等键已用于不同目标。", 409);
      return tx.amazonSyncRun.findMany({ where: { ...scope, id: { in: metadata.taskIds } } });
    }
    const runs = [];
    for (const sourceId of sourceIds) runs.push(await createTask(tx, scope, actorUserId, sourceId, { key: `manual:${requestId}:${sourceId}`, trigger: "manual", scheduleId: plan?.id, scheduleRevision: plan?.revision, maxAttempts: plan?.maxAttempts, priority: plan?.priority }));
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.request", entityType: "AmazonSyncRun", entityId: requestId, metadata: { workspaceId: scope.workspaceId, fingerprint, taskIds: runs.map(r => r.id) } } });
    return runs;
  });
}
export async function controlTask(scope: SyncScope, actorUserId: string, id: string, action: unknown) {
  requireSyncCenter(scope);
  if (!["retry", "pause", "resume", "cancel"].includes(String(action))) throw new SyncInputError("无效任务操作。");
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope);
    const run = await tx.amazonSyncRun.findFirst({ where: { ...scope, id, executionVersion: 2 } });
    if (!run) throw new SyncInputError("任务不存在。", 404);
    if (run.status === "SUCCEEDED" || run.status === "CANCELLED") throw new SyncInputError("该任务已结束。", 409);
    let data: Prisma.AmazonSyncRunUpdateManyMutationInput;
    if (action === "cancel" || action === "pause") {
      if (!activeTaskStatuses.includes(run.status)) throw new SyncInputError("当前任务不可暂停／取消。", 409);
      data = run.status === "RUNNING" ? { control: action === "cancel" ? "CANCEL" : "PAUSE" } : { status: action === "cancel" ? "CANCELLED" : "PAUSED", control: null, finishedAt: action === "cancel" ? new Date() : null, dispatchVersion: { increment: 1 } };
    } else {
      if (action === "retry" ? !["FAILED", "BLOCKED"].includes(run.status) : run.status !== "PAUSED") throw new SyncInputError("当前任务不可重试／恢复。", 409);
      const collision = await tx.amazonSyncRun.findFirst({ where: { ...scope, sourceId: run.sourceId, id: { not: id }, status: { in: activeTaskStatuses } } });
      if (collision) throw new SyncInputError("该范围已有其他活动任务。", 409);
      // New retry window is explicit and bounded; historical attempt logs/counters remain.
      if (action === "retry" && run.stage === "PURGED") throw new SyncInputError("历史检查点已按保留策略清理，请新建同步任务。", 409);
      if (action === "retry") {
        // A failed snapshot can have an expired page token or changed credentials.
        // Explicit retry restarts this unpublished snapshot, retaining attempt logs/API counters.
        await tx.amazonInventorySnapshot.deleteMany({ where: { ...scope, syncRunId: id } });
        await tx.amazonCatalogSnapshot.deleteMany({ where: { ...scope, sourceRunId: id } });
        await tx.amazonSyncPage.deleteMany({ where: { ...scope, taskId: id } });
      }
      data = { status: "WAITING", control: null, error: null, finishedAt: null, maxAttempts: action === "retry" ? run.attempts + 3 : run.maxAttempts, requestedByUserId: actorUserId, nextAttemptAt: new Date(), dispatchVersion: { increment: 1 },
        ...(action === "retry" ? { stage: "WAITING", pagesCompleted: 0, paginationComplete: false, checkpointCiphertext: null, authorizationRevision: null, processedCount: 0, insertedCount: 0, updatedCount: 0, skippedCount: 0 } : {}) };
    }
    await tx.amazonSyncRun.update({ where: { id }, data });
    await tx.amazonSyncTaskLog.create({ data: { ...scope, id: randomUUID(), taskId: id, attempt: run.attempts, event: String(action).toUpperCase(), stage: run.stage } });
    return tx.amazonSyncRun.findUniqueOrThrow({ where: { id } });
  });
}

export async function disableAuthorization(scope: SyncScope, actorUserId: string, id: string, revision: unknown) {
  requireSyncCenter(scope);
  if (!Number.isInteger(revision)) throw new SyncInputError("请提供授权版本。");
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope);
    const changed = await tx.amazonSpApiAuthorization.updateMany({ where: { ...scope, id, revision: revision as number }, data: { status: "DISABLED", revision: { increment: 1 } } });
    if (!changed.count) throw new SyncInputError("授权不存在或已更新。", 409);
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.disabled", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId } } });
    return { disabled: true };
  });
}
