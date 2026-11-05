import { parseReturnPolicy, assertReturnRoles, returnWindowFromFrozen } from "./returns";
import { assertSellerMarketplaceAccess, assertAmazonScopeAdmin } from "./data-access";
import { executionWindowMs } from "./execution-window";
import { parseFinancePolicy, financeWindowFromFrozen, type FinanceWindow } from "./finance";
import { assertFinanceScope } from "./finance-scope";
import { parseOrderSyncPolicy, orderWindowFromFrozen, assertOrderRoles, type OrderWindow } from "./orders";
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
import { automaticMarketplaces, automaticPlanKey, automaticResources } from "./automatic-schedule";
import { activeTaskStatuses, isIncrementalResource, boundedInteger, implementedDomain, officialEndpoint, optionalAmazonSellerId, parseSyncPlan, requiredText, requireSyncCenter, SyncInputError, type SyncScope } from "./policy";

/** Caller holds the run's scope lock and updates its run in this transaction.
 * Never change a completed window or a cursor now owned by a different run.
 * Progress ciphertext, watermarks and lastSuccessAt remain untouched.
 */
export async function syncIncrementalCursorStatus(tx: Prisma.TransactionClient, run: SyncScope & { id: string; sourceId: string | null; resource: string }, status: "PAUSED" | "CANCELLED" | "WAITING" | "RETRY_WAIT" | "FAILED" | "BLOCKED") {
  if (!isIncrementalResource(run.resource) || !run.sourceId) return;
  await tx.amazonSyncResourceCursor.updateMany({ where: { organizationId: run.organizationId, workspaceId: run.workspaceId, sourceId: run.sourceId, resource: run.resource, activeRunId: run.id, status: { not: "SUCCEEDED" } }, data: { status } });
}

export async function scopeLock(tx: Prisma.TransactionClient, scope: SyncScope) {
  const key = JSON.stringify(["amazon-sync-center", scope.organizationId, scope.workspaceId]);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
const authorizationSelect = { id: true, name: true, amazonSellerId: true, awsRegion: true, endpoint: true, revision: true, status: true, approvedRoles: true, rolesAttestedAt: true, marketplaceParticipations: true, lastValidatedAt: true, validationAttemptedAt: true, validationErrorCode: true, updatedAt: true } satisfies Prisma.AmazonSpApiAuthorizationSelect;
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
  const name = requiredText(body.name, "授权名称", 100), amazonSellerId = optionalAmazonSellerId(body.amazonSellerId ?? existing?.amazonSellerId);
  const region = requiredText(body.region, "区域"), endpoint = requiredText(body.endpoint, "API endpoint");
  officialEndpoint(region, endpoint);
  if (existing && ((existing.amazonSellerId && existing.amazonSellerId !== amazonSellerId) || existing.awsRegion !== region || existing.endpoint !== endpoint)) throw new SyncInputError("卖家身份、区域和 endpoint 不可原地更换，请新增授权。");
  const credentials = existing ? decryptAmazonSpApiCredentials(existing.credentialsCiphertext, { ...scope, authorizationId: id }) : null;
  const submitted: Partial<AmazonSpApiSettings> = { region, endpoint };
  for (const field of ["lwaClientId", "lwaClientSecret", "refreshToken", "awsAccessKeyId", "awsSecretAccessKey", "awsSessionToken"] as const) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || (body[field] as string).length > 16384)) throw new SyncInputError("凭证格式无效或超出长度限制。");
    if (typeof body[field] === "string") submitted[field] = body[field];
  }
  const settings = mergeAmazonSpApiSettings(credentials, submitted);
  const roleData = body.approvedRoles === undefined ? {} : { approvedRoles: body.approvedRoles as string[], rolesAttestedAt: new Date() };
  const credentialsCiphertext = encryptAmazonSpApiCredentials(settings, { ...scope, authorizationId: id });
  return (async (tx: Prisma.TransactionClient) => {
    await scopeLock(tx, scope);
    if (!amazonSellerId && await tx.amazonSpApiAuthorization.findFirst({ where: { ...scope, amazonSellerId: "", awsRegion: region, ...(existing ? { id: { not: id } } : {}) }, select: { id: true } })) throw new SyncInputError("此区域已有待补充 Seller ID 的基础连接，请更新该连接后再新增。", 409);
    if (existing) {
      const changed = await tx.amazonSpApiAuthorization.updateMany({ where: { ...scope, id, revision: body.revision as number }, data: { name, amazonSellerId, credentialsCiphertext, ...roleData, revision: { increment: 1 }, identityVerifiedAt: null, identityEvidence: "MANUAL_UNVERIFIED", status: "NOT_CONFIGURED", marketplaceParticipations: [], lastValidatedAt: null, validationAttemptedAt: null, validationErrorCode: null, updatedByUserId: actorUserId } });
      if (!changed.count) throw new SyncInputError("授权已更新，请刷新。", 409);
    } else await tx.amazonSpApiAuthorization.create({ data: { ...scope, id, name, amazonSellerId, awsRegion: region, endpoint, credentialsCiphertext, ...roleData, updatedByUserId: actorUserId } });
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
  let lastResponseOperation = "LWA";
  try {
    const client = new AmazonSpApiClient({ ...credentials, region: auth.awsRegion, endpoint: auth.endpoint }, {
      onResponse: event => { lastResponseOperation = event.operation; },
    });
    const payload = await client.getMarketplaceParticipations();
    const participations = extractMarketplaceParticipations(payload);
    if (!participations.length) throw new SyncInputError("Amazon 未返回可用 Marketplace 参与站点。", 409);
    // Basic connection only: do not probe Listings or claim Seller identity / domain permissions.
    const changed = await prisma.amazonSpApiAuthorization.updateMany({ where: { ...scope, id, revision: auth.revision, status: { not: "DISABLED" } }, data: { status: "CONFIGURED", marketplaceParticipations: participations as Prisma.InputJsonValue, lastValidatedAt: attemptedAt, validationAttemptedAt: attemptedAt, validationErrorCode: null, revision: { increment: 1 }, updatedByUserId: actorUserId } });
    if (!changed.count) throw new SyncInputError("授权在验证期间已发生变更。", 409);
    await prisma.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.validated", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, marketplaceCount: participations.length, credentialsEncrypted: true } } });
    return { validated: true, marketplaceCount: participations.length };
  } catch (error) {
    const errorCode = error instanceof AmazonSpApiError && error.authorizationRejected ? "AUTH_REJECTED" : error instanceof SyncInputError ? "INVALID_PARTICIPATIONS" : "VALIDATION_FAILED";
    await prisma.amazonSpApiAuthorization.updateMany({ where: { ...scope, id, revision: auth.revision, status: { not: "DISABLED" } }, data: { status: errorCode === "AUTH_REJECTED" ? "ERROR" : "NOT_CONFIGURED", validationAttemptedAt: attemptedAt, validationErrorCode: errorCode } });
    await prisma.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.validation_failed", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, code: errorCode } } });
    if (error instanceof SyncInputError) throw error;
    if (error instanceof AmazonSpApiError) {
      // The client message is already bounded and redacted. Only an HTTP
      // response has a status; timeouts/network failures are not Amazon replies.
      const failedStep = lastResponseOperation === "LWA" ? "LWA 换取访问令牌"
        : lastResponseOperation === "getMarketplaceParticipations" ? "Sellers.getMarketplaceParticipations（参与站点查询）"
        : "SP-API 授权校验";
      const message = error.status !== null ? `亚马逊返回：${error.message} 失败步骤：${failedStep}。` : `连接异常：${error.message} 请检查网络或代理后重新申请验证。`;
      throw new SyncInputError(message, 409);
    }
    throw new SyncInputError("系统异常：授权验证未完成，请检查服务状态后重新申请验证。", 409);
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
      if (["orders", "finance", "returns"].includes(resource)) await stopOrderSourceTasks(tx, scope, [existing.id]);
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.source.saved", entityType: "AmazonSyncDataSource", entityId: row.id, metadata: { workspaceId: scope.workspaceId, enabled: false } } });
      return row;
    }
    const auth = await tx.amazonSpApiAuthorization.findFirst({ where: { ...scope, id: authorizationId, status: "CONFIGURED" } });
    const seller = await tx.sellerAccount.findFirst({ where: { ...scope, id: sellerAccountId, status: "active" } });
    if (!auth || !seller) throw new SyncInputError("授权未验证，或店铺不属于当前范围／已停用。", 409);
    if (!auth.amazonSellerId) throw new SyncInputError("基础连接未填写 Seller ID；绑定同步店铺前请补充真实卖家编号。", 409);
    const orderPolicy = resource === "orders" ? parseOrderSyncPolicy(body.orderPolicy ?? existing?.orderPolicy) : undefined;
    if (orderPolicy) {
      officialEndpoint(auth.awsRegion, auth.endpoint); assertOrderRoles(auth, orderPolicy);
      if (existing?.orderPolicy && parseOrderSyncPolicy(existing.orderPolicy).applicationId !== orderPolicy.applicationId) throw new SyncInputError("订单应用标识不可原地更换；真实应用迁移须单独评审限流与历史游标。");
      if (existing?.orderPolicy) {
        const cursor = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: existing.id } });
        if (cursor && cursor.status !== "SUCCEEDED" && digest(parseOrderSyncPolicy(existing.orderPolicy)) !== digest(orderPolicy)) throw new SyncInputError("订单窗口尚未完成，不得改变已冻结的列表/详情策略；请先完成原窗口或单独评审游标维护。", 409);
      }
      // One authorization cannot split its seller/app quota into per-site buckets.
      const siblings = await tx.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId, resource: "orders", ...(existing ? { id: { not: existing.id } } : {}) }, select: { orderPolicy: true } });
      if (siblings.some(s => { const p = parseOrderSyncPolicy(s.orderPolicy); return p.applicationId !== orderPolicy.applicationId || p.requestsPerSecond !== orderPolicy.requestsPerSecond || p.burst !== orderPolicy.burst || (p.details && orderPolicy.details && (p.details.requestsPerSecond !== orderPolicy.details.requestsPerSecond || p.details.burst !== orderPolicy.details.burst)); })) throw new SyncInputError("同一授权的订单数据源必须使用相同应用标识与限流预算，避免拆分预算。");
    }
    const conflicting = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, sellerAccountId, marketplaceId, authorizationId: { not: authorizationId } }, select: { id: true } });
    const identity = await tx.amazonSellerIdentity.findFirst({ where: { ...scope, marketplaceId, OR: [{ sellerAccountId }, { authorizationId }] }, select: { authorizationId: true, sellerAccountId: true } });
    if (conflicting || (identity && (identity.authorizationId !== authorizationId || identity.sellerAccountId !== sellerAccountId))) throw new SyncInputError("同一店铺站点的数据域必须使用同一授权；须先核查历史归属。", 409);
    const sites = extractMarketplaceParticipations({ payload: auth.marketplaceParticipations });
    if (!sites.some(s => s.marketplaceId === marketplaceId)) throw new SyncInputError("该站点不在已验证参与站点内。");
    if (!existing && await tx.amazonSyncDataSource.count({ where: scope }) >= 200) throw new SyncInputError("试点最多支持 200 个数据源，扩容需性能评审。", 409);
    const duplicate = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, authorizationId, marketplaceId, NOT: { sellerAccountId } } });
    if (duplicate) throw new SyncInputError("同一卖家、站点和数据域不能映射到多个 ERP 店铺。", 409);
    const financePolicy = resource === "finance" ? parseFinancePolicy(body.financePolicy ?? existing?.financePolicy) : undefined;
    if (financePolicy) {
      await assertFinanceScope(tx, scope, { authorizationId, sellerAccountId, marketplaceId, financePolicy }, [actorUserId]);
      const sibling = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, authorizationId, resource: "finance", ...(existing ? { id: { not: existing.id } } : {}) } });
      if (sibling) throw new SyncInputError("同一卖家区域仅允许一个财务采集源，不能按站点重复采集。", 409);
      if (existing?.financePolicy) {
        const old = parseFinancePolicy(existing.financePolicy);
        if (old.applicationId !== financePolicy.applicationId) throw new SyncInputError("财务应用标识不能原地更换。");
        const cursor = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: existing.id } });
        if (cursor && cursor.status !== "SUCCEEDED" && digest(old) !== digest(financePolicy)) throw new SyncInputError("未完成财务窗口不可改变冻结策略。", 409);
      }
    }
    const returnsPolicy = resource === "returns" ? parseReturnPolicy(body.returnsPolicy ?? existing?.returnsPolicy) : undefined;
    if (returnsPolicy) {
      officialEndpoint(auth.awsRegion, auth.endpoint); assertReturnRoles(auth);
      if (existing?.returnsPolicy) {
        const prior = parseReturnPolicy(existing.returnsPolicy);
        const cursor = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: existing.id } });
        if (prior.applicationId !== returnsPolicy.applicationId || (cursor && cursor.status !== "SUCCEEDED" && digest(prior) !== digest(returnsPolicy))) throw new SyncInputError("退货应用标识或未完成窗口的策略不可原地改变。", 409);
      }
      const siblings = await tx.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId, resource: "returns" }, select: { returnsPolicy: true } });
      if (siblings.some(s => { const p = parseReturnPolicy(s.returnsPolicy); return p.applicationId !== returnsPolicy.applicationId || digest(p.budgets) !== digest(returnsPolicy.budgets); })) throw new SyncInputError("同一授权退货源必须共享应用与预算。", 409);
    }
    const returnData = returnsPolicy ? { returnsPolicy: returnsPolicy as Prisma.InputJsonValue } : {};
    const financeData = financePolicy ? { financePolicy: financePolicy as Prisma.InputJsonValue } : {};
    const orderData = orderPolicy ? { orderPolicy: orderPolicy as Prisma.InputJsonValue } : {};
    const row = await tx.amazonSyncDataSource.upsert({ where: { organizationId_workspaceId_sellerAccountId_marketplaceId_resource: { ...scope, sellerAccountId, marketplaceId, resource } }, create: { ...scope, id: requiredText(body.proposedId, "新数据源 ID"), authorizationId, sellerAccountId, marketplaceId, resource, freshnessMinutes, enabled: body.enabled as boolean, ...orderData, ...financeData, ...returnData }, update: { freshnessMinutes, enabled: body.enabled as boolean, revision: { increment: 1 }, ...orderData, ...financeData, ...returnData } });
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
    if (existing?.planKey.startsWith("auto-v1:")) {
      if (sourceIds.length !== 1 || existing.planKey !== automaticPlanKey(sourceIds[0]) || existing.resource !== plan.resource || existing.mode !== plan.mode || existing.intervalMinutes !== plan.intervalMinutes) throw new SyncInputError("自动计划的范围、模式和频率不可改变；可暂停或恢复。", 409);
    }
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
export async function createTask(tx: Prisma.TransactionClient, scope: SyncScope, actorUserId: string, sourceId: string, options: { key: string; trigger: string; scheduleId?: string; scheduleRevision?: number; maxAttempts?: number; priority?: number; requestedRange?: RequestedRange; orderWindow?: OrderWindow; financeWindow?: FinanceWindow; returnWindow?: FinanceWindow }) {
  const scheduled = options.trigger === "schedule";
  const approval = scheduled ? null : approvedContext(scope, "run");
  scope = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: sourceId, enabled: true }, include: { authorization: true, seller: true } });
  if (!source || source.authorization.status !== "CONFIGURED" || source.seller.status !== "active") throw new SyncInputError("数据源、授权或店铺不可用。", 409);
  if (!source.authorization.amazonSellerId) throw new SyncInputError("基础连接未填写真实 Seller ID，不能启动店铺数据同步。", 409);
  implementedDomain(source.resource);
  const schedule = scheduled && options.scheduleId ? await tx.amazonSyncSchedule.findFirst({ where: { ...scope, id: options.scheduleId, resource: source.resource, executionVersion: 2, enabled: true, revision: options.scheduleRevision, targets: { some: { sourceId } } } }) : null;
  if (scheduled && (!schedule || schedule.updatedByUserId !== actorUserId || schedule.planKey !== automaticPlanKey(source.id) || !automaticMarketplaces.has(source.marketplaceId) || !(automaticResources as readonly string[]).includes(source.resource))) throw new SyncInputError("自动计划已停用、已变更或不包含此数据源。", 409);
  await assertSellerMarketplaceAccess(scope, actorUserId, source.sellerAccountId, source.marketplaceId, tx, "sync");
  const existing = await tx.amazonSyncRun.findUnique({ where: { organizationId_workspaceId_idempotencyKey: { ...scope, idempotencyKey: options.key } } });
  if (existing) {
    if (existing.sourceId !== sourceId || existing.executionVersion !== 2) throw new SyncInputError("幂等键已用于其他范围。", 409);
    return existing;
  }
  const active = await tx.amazonSyncRun.findFirst({ where: { ...scope, sourceId, status: { in: activeTaskStatuses } } });
  if (active) throw new SyncInputError("该数据源已有活动任务；请先完成或取消后重新申请执行审批。", 409);
  if (!scheduled && !approval?.commandSourceIds?.includes(sourceId)) throw new SyncInputError("任务目标超出执行审批范围。", 403);
  if (source.resource === "sales_traffic") rangeFromFrozen({ requestedRange: options.requestedRange });
  const orderWindow = source.resource === "orders" ? orderWindowFromFrozen(options.orderWindow) : undefined;
  if (orderWindow) assertOrderRoles(source.authorization, parseOrderSyncPolicy(source.orderPolicy));
  const financeWindow = source.resource === "finance" ? financeWindowFromFrozen(options.financeWindow) : undefined;
  if (financeWindow) await assertFinanceScope(tx, scope, source, [actorUserId]);
  const returnWindow = source.resource === "returns" ? returnWindowFromFrozen(options.returnWindow) : undefined;
  if (returnWindow) assertReturnRoles(source.authorization);
  const frozenScope = { executionExpiresAt: new Date(Date.now() + executionWindowMs).toISOString(), sourceId: source.id, sourceRevision: source.revision, authorizationId: source.authorization.id, authorizationRevision: source.authorization.revision, amazonSellerId: source.authorization.amazonSellerId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, resource: source.resource, ...(scheduled ? { scheduleId: schedule!.id, scheduleRevision: schedule!.revision } : {}), ...(options.requestedRange ? { requestedRange: options.requestedRange } : {}), ...(returnWindow ? { returnWindow, returnsPolicy: parseReturnPolicy(source.returnsPolicy), region: source.authorization.awsRegion, endpoint: source.authorization.endpoint } : {}), ...(financeWindow ? { financeWindow, financePolicy: parseFinancePolicy(source.financePolicy), region: source.authorization.awsRegion, endpoint: source.authorization.endpoint } : {}), ...(orderWindow ? { orderWindow, orderPolicy: parseOrderSyncPolicy(source.orderPolicy), region: source.authorization.awsRegion, endpoint: source.authorization.endpoint } : {}) };
  return tx.amazonSyncRun.create({ data: { ...scope, id: randomUUID(), executionVersion: 2, sourceId, requestedByUserId: actorUserId, resource: source.resource, authorizationRevision: source.authorization.revision, idempotencyKey: options.key,
    executionApprovalId: approval?.approvalId ?? null, frozenScope, frozenScopeDigest: digest(frozenScope),
    mode: ["orders", "finance", "returns"].includes(source.resource) ? "incremental" : source.resource === "sales_traffic" ? "date_range" : "snapshot", status: "WAITING", trigger: options.trigger, scheduleId: options.scheduleId, scheduleRevision: options.scheduleRevision, maxAttempts: options.maxAttempts ?? 3, priority: options.priority ?? 1 } });
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
    const fingerprintParts: unknown[] = [[...sourceIds].sort(), plan?.id ?? null, body.requestedRanges ?? null];
    if (body.returnWindows !== undefined) fingerprintParts.push(body.returnWindows);
    if (body.financeWindows !== undefined) fingerprintParts.push(body.financeWindows);
    if (body.orderWindows !== undefined) fingerprintParts.push(body.orderWindows);
    const fingerprint = createHash("sha256").update(JSON.stringify(fingerprintParts)).digest("hex");
    // A request record in the audit table binds a user key to the complete fan-out payload.
    const requestId = createHash("sha256").update(JSON.stringify([scope.organizationId, scope.workspaceId, key])).digest("hex");
    const prior = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, action: "amazon.sync.request", entityId: requestId }, orderBy: { createdAt: "asc" } });
    if (prior) {
      const metadata = prior.metadata as { fingerprint?: string; taskIds?: string[] } | null;
      if (metadata?.fingerprint !== fingerprint || !Array.isArray(metadata.taskIds)) throw new SyncInputError("幂等键已用于不同目标。", 409);
      return tx.amazonSyncRun.findMany({ where: { ...scope, id: { in: metadata.taskIds } } });
    }
    const runs = [];
    for (const sourceId of sourceIds) runs.push(await createTask(tx, scope, actorUserId, sourceId, { key: `manual:${requestId}:${sourceId}`, trigger: "manual", scheduleId: plan?.id, scheduleRevision: plan?.revision, maxAttempts: plan?.maxAttempts, priority: plan?.priority, requestedRange: (body.requestedRanges as Record<string, RequestedRange> | undefined)?.[sourceId], returnWindow: (body.returnWindows as Record<string, FinanceWindow> | undefined)?.[sourceId], financeWindow: (body.financeWindows as Record<string, FinanceWindow> | undefined)?.[sourceId], orderWindow: (body.orderWindows as Record<string, OrderWindow> | undefined)?.[sourceId] }));
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
      if (action === "retry" && !["orders", "finance", "returns"].includes(run.resource)) {
        await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.task.retry", entityType: "AmazonSyncRun", entityId: id, metadata: { workspaceId: scope.workspaceId, previousStatus: run.status, previousAttempt: run.attempts, previousSummary: run.summary, executionApprovalId: approval.approvalId } } });
        await tx.amazonSyncPage.deleteMany({ where: { ...scope, taskId: id } });
        await tx.amazonInventorySnapshot.deleteMany({ where: { ...scope, syncRunId: id } });
        await tx.amazonCatalogSnapshot.deleteMany({ where: { ...scope, sourceRunId: id } });
        await tx.amazonSalesTrafficSnapshot.deleteMany({ where: { ...scope, syncRunId: id } });
      }
      const renewedFrozen = { ...(run.frozenScope as Prisma.JsonObject ?? {}), executionExpiresAt: new Date(Date.now() + executionWindowMs).toISOString() };
      data = { status: "WAITING", trigger: "manual", executionApprovalId: approval.approvalId, requestedByUserId: actorUserId, control: null, error: null, finishedAt: null, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: new Date(), dispatchVersion: { increment: 1 }, maxAttempts: run.attempts + 3,
        frozenScope: renewedFrozen, frozenScopeDigest: digest(renewedFrozen),
        ...(action === "retry" && !["orders", "finance", "returns"].includes(run.resource) ? { checkpointCiphertext: null, stage: "WAITING", pagesCompleted: 0, paginationComplete: false, processedCount: 0, insertedCount: 0, updatedCount: 0, skippedCount: 0, summary: Prisma.DbNull, executionStartedAt: null } : {}) };

    }
    const updated = await tx.amazonSyncRun.update({ where: { id }, data });
    if (!updated.control && ["PAUSED", "CANCELLED", "WAITING"].includes(updated.status)) await syncIncrementalCursorStatus(tx, run, updated.status as "PAUSED" | "CANCELLED" | "WAITING");
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
    const orderSources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: id, resource: { in: ["orders", "finance", "returns"] } }, select: { id: true } });
    if (orderSources.length) {
      await tx.amazonSyncDataSource.updateMany({ where: { ...scope, id: { in: orderSources.map(s => s.id) } }, data: { enabled: false, revision: { increment: 1 } } });
      await stopOrderSourceTasks(tx, scope, orderSources.map(s => s.id));
    }
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.disabled", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId } } });
    return { disabled: true };
  })(db);
}

async function stopOrderSourceTasks(tx: Prisma.TransactionClient, scope: SyncScope, sourceIds: string[]) {
  // Fence queued and running orders immediately; stale Redis deliveries become no-ops.
  await tx.amazonSyncRun.updateMany({ where: { ...scope, sourceId: { in: sourceIds }, resource: { in: ["orders", "finance", "returns"] }, status: { in: activeTaskStatuses } }, data: { status: "CANCELLED", stage: "BINDING_DISABLED", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 }, fenceVersion: { increment: 1 }, error: "增量绑定或授权已停用，任务已取消；保留游标。" } });
  await tx.amazonSyncResourceCursor.updateMany({ where: { ...scope, sourceId: { in: sourceIds }, status: { not: "SUCCEEDED" } }, data: { status: "CANCELLED" } });
  const targets = await tx.amazonSyncPlanTarget.findMany({ where: { ...scope, sourceId: { in: sourceIds } }, select: { scheduleId: true } });
  if (targets.length) await tx.amazonSyncSchedule.updateMany({ where: { ...scope, resource: { in: ["orders", "finance", "returns"] }, id: { in: targets.map(t => t.scheduleId) } }, data: { enabled: false, nextRunAt: null, revision: { increment: 1 } } });
}
