import { isObservationResource, parseObservationPolicy, assertObservationRoles, assertObservationClosed } from "./observation-policy";
import { parseReturnPolicy, assertReturnRoles, returnWindowFromFrozen, nextReturnWindow } from "./returns";
import { assertDomainReportRoles, domainReportRunWindow, type DomainReportResource } from "./domain-reports";
import { saveAccessGrant } from "./access-management";
import { amazonDataAccess, assertAmazonScopeAdmin, assertSellerMarketplaceAccess, isAmazonScopeAdmin } from "./data-access";
import { resolveRequestedRange, rangeFromFrozen } from "./date-range";
import { parseFinancePolicy, nextFinanceWindow, financeWindowFromFrozen } from "./finance";
import { assertFinanceScope } from "./finance-scope";
import { parseOrderSyncPolicy, nextOrderWindow, orderWindowFromFrozen } from "./orders";
import { randomUUID } from "node:crypto";
import { Prisma, type AmazonDataCenterChangeRequest } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { defaultRolePermissionMap, type RolePermissionMap } from "@/lib/accounts/permissions";
import { normalizeRolePermissions } from "@/lib/accounts/role-permissions-utils";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { SyncInputError, requiredText, optionalAmazonSellerId, parseSyncPlan, officialEndpoint, implementedDomain, type SyncScope } from "./policy";
import { operation, operationTypes, normalizeCommand, summary, safeState, digest, seal, unseal, targetEnvironment, assertDecision, assertApplicable, type ChangeOperation } from "./approval-policy";
import { withApprovedChange } from "./approved-context";
import { scopeLock, saveAuthorization, saveSource, savePlan, requestTasks, controlTask, disableAuthorization, performAuthorizationValidation } from "./service";
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const approvalSelect = { id: true, organizationId: true, workspaceId: true, targetEnvironment: true, changeType: true, operation: true, targetId: true, beforeSummary: true, afterSummary: true, sellerIds: true, marketplaceIds: true, domains: true, sourceIds: true, baseRevision: true, changeDigest: true, requestedByUserId: true, approvedByUserId: true, decidedAt: true, status: true, expiresAt: true, appliedAt: true, decisionReason: true, createdAt: true } satisfies Prisma.AmazonDataCenterChangeRequestSelect;
export function changeView(row: AmazonDataCenterChangeRequest) {
  return Object.fromEntries(Object.keys(approvalSelect).map(k => [k, row[k as keyof AmazonDataCenterChangeRequest]]));
}
export async function assertChangePermission(scope: SyncScope, actor: string, action: ChangeOperation | "approve" | "view" | "export", tx: Prisma.TransactionClient) {
  if (!await assertWorkspaceAccess(scope.organizationId, scope.workspaceId, tx)) throw new SyncInputError("工作区不可访问。", 403);
  const member = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor } }, include: { user: { select: { status: true } } } });
  const config = ["save-authorization", "disable-authorization", "save-source", "validate-authorization", "save-access-grant"].includes(action);
  const moduleId = config ? "settings" : "operations";
  const permission = action === "approve" ? "approve" : action === "view" ? "view" : action === "export" ? "export" : config || action === "save-plan" || action === "control-task" ? "edit" : "create";
  const permissions: RolePermissionMap = { ...defaultRolePermissionMap };
  for (const role of await tx.organizationRosterRole.findMany({ where: { organizationId: scope.organizationId }, select: { id: true, permissions: true } })) permissions[role.id] = { ...(permissions[role.id] ?? {}), ...normalizeRolePermissions(role.permissions) };
  if (!member || member.user.status !== "active" || !roleCanPerformAction(member.role, moduleId, permission, permissions)) throw new SyncInputError("操作权限不足。", 403);
  if (config) await assertAmazonScopeAdmin(scope, actor, tx);
  else await amazonDataAccess(scope, actor, tx);
  if ((action === "save-plan" || action === "control-task") && !roleCanPerformAction(member.role, "operations", "create", permissions)) throw new SyncInputError("执行策略变更需要 create 权限。", 403);
  return member;
}
async function audit(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, id: string, event: string, metadata: Record<string, unknown> = {}) {
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: `amazon.data_center.change.${event}`, entityType: "AmazonDataCenterChangeRequest", entityId: id, metadata: json({ workspaceId: scope.workspaceId, ...metadata }) } });
}
const authSelect = { id: true, name: true, amazonSellerId: true, awsRegion: true, endpoint: true, revision: true, status: true, approvedRoles: true, rolesAttestedAt: true } as const;
// Resolve all scope and revision evidence from PostgreSQL, never from the request summaries.
async function inspect(tx: Prisma.TransactionClient, scope: SyncScope, command: Record<string, unknown>) {
  const action = operation(command.action), id = typeof command.id === "string" ? command.id : "";
  let targetId = id, baseRevision = 0;
  let before: unknown = null;
  const after = summary(command);
  let sourceIds = Array.isArray(command.sourceIds) ? command.sourceIds as string[] : [];
  let authId: string | undefined;
  if (["save-authorization", "disable-authorization", "validate-authorization"].includes(action)) {
    const auth = id ? await tx.amazonSpApiAuthorization.findFirst({ where: { ...scope, id }, select: authSelect }) : null;
    if (id && !auth) throw new SyncInputError("授权不存在。", 404);
    if (action !== "save-authorization" && !auth) throw new SyncInputError("请选择授权。");
    before = auth ? { ...auth, credentials: "已配置" } : { credentials: "未配置" }; baseRevision = auth?.revision ?? 0;
    if (action === "save-authorization" && auth && ((auth.amazonSellerId && auth.amazonSellerId !== optionalAmazonSellerId(command.amazonSellerId ?? auth.amazonSellerId)) || auth.awsRegion !== command.region || auth.endpoint !== command.endpoint)) throw new SyncInputError("Seller 身份和区域不可原地更换，须新增授权记录。");
    if (auth && command.revision !== undefined && command.revision !== auth.revision) throw new SyncInputError("授权版本已变化。", 409);
    if (action === "save-authorization") {
      requiredText(command.name, "授权名称", 100); optionalAmazonSellerId(command.amazonSellerId);
      officialEndpoint(requiredText(command.region, "区域"), requiredText(command.endpoint, "endpoint"));
      for (const field of ["lwaClientId", "lwaClientSecret", "refreshToken"]) if ((!auth && !command[field]) || (command[field] !== undefined && (typeof command[field] !== "string" || String(command[field]).length > 16384))) throw new SyncInputError("凭证字段无效。");
    }
    authId = auth?.id;
  } else if (action === "save-source") {
    const authorizationId = requiredText(command.authorizationId, "授权"), sellerAccountId = requiredText(command.sellerAccountId, "ERP 店铺"), marketplaceId = requiredText(command.marketplaceId, "Marketplace");
    const resource = implementedDomain(command.resource);
    const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, sellerAccountId, marketplaceId, resource } });
    const seller = await tx.sellerAccount.findFirst({ where: { ...scope, id: sellerAccountId, status: "active" }, select: { id: true, updatedAt: true } });
    if (!seller) throw new SyncInputError("ERP 店铺不属于当前范围。", 409);
    const auth = await tx.amazonSpApiAuthorization.findFirst({ where: { ...scope, id: authorizationId }, select: authSelect });
    if (!auth) throw new SyncInputError("授权不属于当前范围。", 409);
    if (command.enabled !== false) {
      if (!auth.amazonSellerId) throw new SyncInputError("基础连接未填写 Seller ID；绑定同步店铺前请补充真实卖家编号。", 409);
      const conflict = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, marketplaceId, OR: [{ sellerAccountId, authorizationId: { not: authorizationId } }, { authorizationId, sellerAccountId: { not: sellerAccountId } }] }, select: { id: true } });
      const identity = await tx.amazonSellerIdentity.findFirst({ where: { ...scope, marketplaceId, OR: [{ sellerAccountId }, { authorizationId }] }, select: { authorizationId: true, sellerAccountId: true } });
      if (conflict || (identity && (identity.authorizationId !== authorizationId || identity.sellerAccountId !== sellerAccountId))) throw new SyncInputError("店铺站点授权绑定冲突，须先核查历史归属。", 409);
    }
    if (isObservationResource(resource) && command.enabled !== false) { const p = parseObservationPolicy(command.domainPolicy ?? source?.domainPolicy, resource); assertObservationRoles(p, auth); assertObservationClosed(p, new Date(), marketplaceId); }
    if (resource === "returns" && command.enabled !== false) { parseReturnPolicy(command.returnsPolicy ?? source?.returnsPolicy); assertReturnRoles(auth); }
    if (["settlements", "reimbursements", "inventory_age", "inventory_events"].includes(resource) && command.enabled !== false) assertDomainReportRoles(resource as DomainReportResource, auth);
    if (resource === "orders" && command.enabled !== false) parseOrderSyncPolicy(command.orderPolicy ?? source?.orderPolicy);
    if (resource === "finance" && command.enabled !== false) await assertFinanceScope(tx, scope, { authorizationId, sellerAccountId, marketplaceId, financePolicy: command.financePolicy ?? source?.financePolicy }, [ ]);
    before = { source: source ? { id: source.id, revision: source.revision, authorizationId: source.authorizationId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, resource: source.resource, enabled: source.enabled, freshnessMinutes: source.freshnessMinutes, ...(isObservationResource(source.resource) ? { domainPolicy: source.domainPolicy } : {}), ...(source.resource === "orders" ? { orderPolicy: source.orderPolicy } : {}), ...(source.resource === "finance" ? { financePolicy: source.financePolicy } : {}), ...(source.resource === "returns" ? { returnsPolicy: source.returnsPolicy } : {}) } : null, authorization: auth, seller };
    targetId = source?.id ?? targetId; baseRevision = source?.revision ?? 0; authId = auth.id;
    if (source && command.revision !== undefined && command.revision !== baseRevision) throw new SyncInputError("数据源版本已变化。", 409);
  } else if (action === "save-access-grant") {
    const roleId = command.roleId === undefined ? undefined : requiredText(command.roleId, "角色"), userId = roleId ? undefined : requiredText(command.userId, "成员"), sellerAccountId = requiredText(command.sellerAccountId, "Seller");
    if (roleId && command.userId) throw new SyncInputError("成员和角色只能选择一种。");
    const prior = roleId ? await tx.amazonRoleDataAccessGrant.findUnique({ where: { organizationId_workspaceId_roleId_sellerAccountId: { ...scope, roleId, sellerAccountId } } }) : await tx.amazonDataAccessGrant.findUnique({ where: { organizationId_workspaceId_userId_sellerAccountId: { ...scope, userId: userId!, sellerAccountId } } });
    if (typeof command.enabled !== "boolean" || !Number.isInteger(command.revision) || command.revision !== (prior?.revision ?? 0)) throw new SyncInputError("范围授权版本或启用状态无效。", 409);
    const subject = roleId ? await tx.organizationRosterRole.findUnique({ where: { organizationId_id: { organizationId: scope.organizationId, id: roleId } } }) : await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: userId! } } });
    if (!subject || !await tx.sellerAccount.findFirst({ where: { ...scope, id: sellerAccountId }, select: { id: true } })) throw new SyncInputError("成员或 Seller 不属于当前范围。", 403);
    targetId = prior?.id ?? targetId; baseRevision = prior?.revision ?? 0;
    before = prior ? { id: prior.id, userId, roleId, sellerAccountId, enabled: prior.enabled, revision: prior.revision, actions: prior.actions, marketplaceIds: prior.marketplaceIds, mcpEnabled: prior.mcpEnabled } : null;
  } else if (action === "save-plan") {
    parseSyncPlan(command);
    const plan = id ? await tx.amazonSyncSchedule.findFirst({ where: { ...scope, id, executionVersion: 2 }, include: { targets: { select: { sourceId: true } } } }) : null;
    if (id && !plan) throw new SyncInputError("计划不存在。", 404);
    if (command.enabled === true && !plan?.planKey.startsWith("auto-v1:")) throw new SyncInputError("仅可恢复系统生成的自动同步计划。", 409);
      if (plan && command.revision !== plan.revision) throw new SyncInputError("计划版本已变化。", 409);
    before = plan ? { id: plan.id, revision: plan.revision, name: plan.name, enabled: plan.enabled, resource: plan.resource, intervalMinutes: plan.intervalMinutes, retentionDays: plan.retentionDays, maxAttempts: plan.maxAttempts, priority: plan.priority, mode: plan.mode, sourceIds: plan.targets.map(t => t.sourceId).sort() } : null;
    baseRevision = plan?.revision ?? 0;
  } else if (action === "run") {
    if (!sourceIds.length) throw new SyncInputError("请选择数据源。");
    if (command.planId) {
      const plan = await tx.amazonSyncSchedule.findFirst({ where: { ...scope, id: requiredText(command.planId, "计划"), executionVersion: 2 }, include: { targets: { select: { sourceId: true } } } });
      if (!plan || sourceIds.some(id => !plan.targets.some(t => t.sourceId === id))) throw new SyncInputError("任务范围不属于计划。", 409);
      before = { planId: plan.id, revision: plan.revision }; baseRevision = plan.revision;
    }
  } else if (action === "control-task") {
    if (!["pause", "cancel", "retry", "resume"].includes(String(command.control))) throw new SyncInputError("任务操作无效。");
    const run = await tx.amazonSyncRun.findFirst({ where: { ...scope, id, executionVersion: 2 } });
    if (!run) throw new SyncInputError("任务不存在。", 404);
    before = { id: run.id, status: run.status, stage: run.stage, dispatchVersion: run.dispatchVersion, control: run.control, frozenScope: run.frozenScope }; baseRevision = run.dispatchVersion;
    sourceIds = run.sourceId ? [run.sourceId] : [];
  }
  const sources = sourceIds.length ? await tx.amazonSyncDataSource.findMany({ where: { ...scope, id: { in: sourceIds } }, include: { authorization: { select: authSelect }, seller: { select: { status: true, updatedAt: true } } }, orderBy: { id: "asc" } }) : [];
  if (sources.length !== sourceIds.length) throw new SyncInputError("数据源不属于当前组织／工作区。", 403);
  if (action === "run") for (const source of sources) {
    if (["settlements", "reimbursements", "inventory_age", "inventory_events"].includes(source.resource)) assertDomainReportRoles(source.resource as DomainReportResource, source.authorization);
    if (isObservationResource(source.resource)) { const p = parseObservationPolicy(source.domainPolicy, source.resource); assertObservationRoles(p, source.authorization); assertObservationClosed(p, new Date(), source.marketplaceId); }
    if (source.resource === "sales_traffic") {
      const ranges = command.requestedRanges as Record<string, unknown> | undefined;
      rangeFromFrozen({ requestedRange: ranges?.[source.id] });
    }
    if (source.resource === "returns") returnWindowFromFrozen((command.returnWindows as Record<string, unknown> | undefined)?.[source.id]);
    if (source.resource === "finance") financeWindowFromFrozen((command.financeWindows as Record<string, unknown> | undefined)?.[source.id]);
    if (source.resource === "orders") orderWindowFromFrozen((command.orderWindows as Record<string, unknown> | undefined)?.[source.id]);
    if (["settlements", "inventory_events"].includes(source.resource)) domainReportRunWindow(source.resource as DomainReportResource, (command.reportWindows as Record<string, unknown> | undefined)?.[source.id]);
  }
  const targets = sources.map(s => ({ sourceId: s.id, sourceRevision: s.revision, enabled: s.enabled, authorizationId: s.authorizationId, authorizationRevision: s.authorization.revision, authorizationStatus: s.authorization.status, amazonSellerId: s.authorization.amazonSellerId, sellerAccountId: s.sellerAccountId, sellerStatus: s.seller.status, sellerUpdatedAt: s.seller.updatedAt, marketplaceId: s.marketplaceId, resource: s.resource, ...(isObservationResource(s.resource) ? { domainPolicy: parseObservationPolicy(s.domainPolicy, s.resource) } : {}), ...(s.resource === "orders" ? { orderPolicy: parseOrderSyncPolicy(s.orderPolicy) } : {}), ...(s.resource === "finance" ? { financePolicy: parseFinancePolicy(s.financePolicy) } : {}), ...(s.resource === "returns" ? { returnsPolicy: parseReturnPolicy(s.returnsPolicy) } : {}) }));
  const orderCursors = [];
  for (const source of sources.filter(s => ["orders", "finance", "returns"].includes(s.resource))) {
    const cursor = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: source.id } });
    orderCursors.push({ sourceId: source.id, cursorVersion: cursor?.updatedAt.toISOString() ?? null });
  }
  const boundAuth = authId ? await tx.amazonSpApiAuthorization.findFirst({ where: { ...scope, id: authId }, select: authSelect }) : null;
  return { targetId, baseRevision, beforeSummary: { current: before, targets, ...(orderCursors.length ? { orderCursors } : {}) }, afterSummary: after,
    sellerIds: [...new Set([...targets.map(s => s.amazonSellerId), ...(boundAuth ? [boundAuth.amazonSellerId] : []), ...(typeof command.amazonSellerId === "string" ? [command.amazonSellerId] : [])])].sort(),
    marketplaceIds: [...new Set([...targets.flatMap(s => s.financePolicy ? s.financePolicy.marketplaces.map(m => m.marketplaceId) : [s.marketplaceId]), ...(command.financePolicy ? parseFinancePolicy(command.financePolicy).marketplaces.map(m => m.marketplaceId) : []), ...(typeof command.marketplaceId === "string" ? [command.marketplaceId] : [])])].sort(),
    domains: [...new Set([...targets.map(s => s.resource), ...(typeof command.resource === "string" ? [command.resource] : [])])].sort(), sourceIds: [...sourceIds].sort() };
}
function evidenceDigest(scope: SyncScope, row: { targetEnvironment: string; operation: string; payloadDigest: string }, evidence: unknown) {
  return digest({ ...scope, targetEnvironment: row.targetEnvironment, operation: row.operation, payloadDigest: row.payloadDigest, evidence });
}
export async function requestChange(scope: SyncScope, actor: string, input: Record<string, unknown>) {
  const command = normalizeCommand(input), action = operation(command.action), id = randomUUID(), environment = targetEnvironment();
  if (!command.id && ["save-authorization", "save-source", "save-plan", "save-access-grant"].includes(action)) command.proposedId = randomUUID();
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertChangePermission(scope, actor, action, tx);
    if (action === "run") {
      const sources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, id: { in: command.sourceIds as string[] ?? [] } } });
      const requestedRanges: Record<string, unknown> = {};
      const orderWindows: Record<string, unknown> = {};
      const financeWindows: Record<string, unknown> = {};
      const returnWindows: Record<string, unknown> = {};
      const reportWindows: Record<string, unknown> = {};
      for (const source of sources) {
        if (source.resource === "sales_traffic") requestedRanges[source.id] = resolveRequestedRange(source.marketplaceId, command);
        else if (source.resource === "orders") {
          if (command.dateFrom || command.dateTo || command.datePreset) throw new SyncInputError("订单窗口由持久化游标和已审批策略确定，不接受临时历史日期。");
          const cursor = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: source.id } });
          orderWindows[source.id] = nextOrderWindow(parseOrderSyncPolicy(source.orderPolicy), cursor, new Date());
        }
        else if (source.resource === "returns") {
          if (command.dateFrom || command.dateTo || command.datePreset) throw new SyncInputError("退货窗口由批准策略与持久游标确定。");
          const cursor = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: source.id } });
          returnWindows[source.id] = nextReturnWindow(parseReturnPolicy(source.returnsPolicy), cursor, new Date());
        }
        else if (source.resource === "finance") {
          if (command.dateFrom || command.dateTo || command.datePreset) throw new SyncInputError("财务窗口由持久化游标确定，不接受临时全量日期。");
          const cursor = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: source.id } });
          financeWindows[source.id] = nextFinanceWindow(parseFinancePolicy(source.financePolicy), cursor, new Date());
        }
        else if (source.resource === "settlements") {
          const until = new Date();
          reportWindows[source.id] = { createdSince: new Date(until.getTime() - 90 * 24 * 60 * 60_000).toISOString(), createdUntil: until.toISOString() };
        }
        else if (source.resource === "inventory_events") {
          reportWindows[source.id] = { from: command.dateFrom, to: command.dateTo, eventType: command.eventType ?? "" };
        }
        else if (command.dateFrom || command.dateTo || command.datePreset) throw new SyncInputError("库存和刊登是当前完整快照，不支持历史日期同步；请分开申请。");
      }
      if (Object.keys(requestedRanges).length) command.requestedRanges = requestedRanges;
      if (Object.keys(returnWindows).length) command.returnWindows = returnWindows;
      if (Object.keys(financeWindows).length) command.financeWindows = financeWindows;
      if (Object.keys(orderWindows).length) command.orderWindows = orderWindows;
      if (Object.keys(reportWindows).length) command.reportWindows = reportWindows;
    }
    const ciphertext = seal(command, scope, id, environment), payloadDigest = digest(ciphertext);
    const evidence = await inspect(tx, scope, command); evidence.targetId ||= String(command.proposedId ?? id);
    await checkTargetAccess(tx, scope, actor, evidence.sourceIds);
    const row = await tx.amazonDataCenterChangeRequest.create({ data: { ...scope, id, targetEnvironment: environment, changeType: operationTypes[action], operation: action, ...evidence, beforeSummary: json(safeState(evidence.beforeSummary)), afterSummary: json(safeState(evidence.afterSummary)), changeDigest: evidenceDigest(scope, { targetEnvironment: environment, operation: action, payloadDigest }, evidence), payloadDigest, requestedByUserId: actor, expiresAt: new Date(Date.now() + 60 * 60_000) } });
    await tx.amazonDataCenterSealedCommand.create({ data: { ...scope, id, ciphertext } });
    await audit(tx, scope, actor, id, "requested", { digest: row.changeDigest, operation: action, environment });
    return changeView(row);
  });
}
export async function decideChange(scope: SyncScope, actor: string, id: string, decision: "APPROVED" | "REJECTED" | "REVOKED", reason: string) {
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope); const approver = await assertChangePermission(scope, actor, "approve", tx);
    const row = await tx.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id } });
    if (!row) throw new SyncInputError("审批不存在。", 404);
    if (["save-access-grant", "save-authorization", "disable-authorization", "save-source", "validate-authorization"].includes(row.operation)) await assertAmazonScopeAdmin(scope, actor, tx);
    if (decision === "APPROVED" && row.status === "REQUESTED" && row.expiresAt <= new Date()) {
      await tx.amazonDataCenterChangeRequest.updateMany({ where: { ...scope, id, status: "REQUESTED" }, data: { status: "EXPIRED", decidedAt: new Date(), decisionReason: "审批请求已过期。" } });
      await tx.amazonDataCenterSealedCommand.deleteMany({ where: { ...scope, id } });
      await audit(tx, scope, actor, id, "expired", { digest: row.changeDigest });
      return changeView({ ...row, status: "EXPIRED", decidedAt: new Date(), decisionReason: "审批请求已过期。" });
    }
    if (decision === "REVOKED") {
      if (!["REQUESTED", "APPROVED"].includes(row.status) && !(row.status === "APPLIED" && row.changeType === "SyncExecutionRequest")) throw new SyncInputError("已应用配置不能撤销；须另行提交反向变更。", 409);
    } else assertDecision(row, actor, new Date(), isAmazonScopeAdmin(approver.role));
    if (row.sourceIds.length) await checkTargetAccess(tx, scope, actor, row.sourceIds);
    if (row.targetEnvironment !== targetEnvironment()) throw new SyncInputError("目标环境不匹配。", 409);
    if (decision === "APPROVED") {
      const envelope = await tx.amazonDataCenterSealedCommand.findFirst({ where: { ...scope, id } });
      if (!envelope || digest(envelope.ciphertext) !== row.payloadDigest) throw new SyncInputError("审批载荷完整性校验失败。", 409);
      const command = unseal(envelope.ciphertext, scope, id, row.targetEnvironment);
      const evidence = await inspect(tx, scope, command); evidence.targetId ||= row.targetId;
      if (row.changeDigest !== evidenceDigest(scope, row, evidence) || row.baseRevision !== evidence.baseRevision) {
        await tx.amazonDataCenterChangeRequest.updateMany({ where: { ...scope, id, status: "REQUESTED" }, data: { status: "STALE", decidedAt: new Date(), decisionReason: "申请后配置版本或目标范围已变化。" } });
        await tx.amazonDataCenterSealedCommand.deleteMany({ where: { ...scope, id } });
        await audit(tx, scope, actor, id, "stale", { digest: row.changeDigest });
        return changeView({ ...row, status: "STALE", decidedAt: new Date(), decisionReason: "申请后配置版本或目标范围已变化。" });
      }
    }
    const changed = await tx.amazonDataCenterChangeRequest.updateMany({ where: { ...scope, id, status: row.status }, data: { status: decision, ...(decision === "APPROVED" ? { approvedByUserId: actor } : {}), decidedAt: new Date(), decisionReason: reason } });
    if (!changed.count) throw new SyncInputError("审批状态已被其他操作变更。", 409);
    if (decision === "REJECTED" || decision === "REVOKED") await tx.amazonDataCenterSealedCommand.deleteMany({ where: { ...scope, id } });
    const updated = await tx.amazonDataCenterChangeRequest.findFirstOrThrow({ where: { ...scope, id } });
    await audit(tx, scope, actor, id, decision.toLowerCase(), { digest: row.changeDigest, ...(decision === "APPROVED" ? { selfApproved: row.requestedByUserId === actor, approverRole: approver.role } : {}) }); return changeView(updated);
  });
}
async function checkTargetAccess(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, sourceIds: string[]) {
  if (!sourceIds.length) return;
  const sources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, id: { in: sourceIds } }, });
  if (sources.length !== sourceIds.length) throw new SyncInputError("审批数据源范围无效。", 403);
  for (const source of sources) {
    if (source.resource === "finance") await assertFinanceScope(tx, scope, source, [actor]);
    else await assertSellerMarketplaceAccess(scope, actor, source.sellerAccountId, source.marketplaceId, tx, "sync");
  }
}
async function dispatch(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  switch (operation(command.action)) {
    case "save-access-grant": return saveAccessGrant(scope, actor, command);
    case "save-authorization": return saveAuthorization(scope, actor, command);
    case "disable-authorization": return disableAuthorization(scope, actor, requiredText(command.id, "授权 ID"), command.revision);
    case "save-source": return saveSource(scope, actor, command);
    case "save-plan": return savePlan(scope, actor, command);
    case "run": return requestTasks(scope, actor, command);
    case "control-task": return controlTask(scope, actor, requiredText(command.id, "任务 ID"), command.control);
    case "validate-authorization": throw new SyncInputError("授权验证必须由审批执行边界处理。", 500);
  }
}
async function applyAuthorizationValidation(scope: SyncScope, actor: string, id: string) {
  const approved = await prisma.$transaction(async tx => {
    await scopeLock(tx, scope);
    const row = await tx.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id } });
    if (!row) throw new SyncInputError("审批不存在。", 404);
    await assertChangePermission(scope, actor, "validate-authorization", tx);
    await assertChangePermission(scope, row.approvedByUserId ?? "", "approve", tx);
    await assertAmazonScopeAdmin(scope, row.approvedByUserId ?? "", tx);
    // Terminal requests deliberately have no sealed command. Report their state
    // before checking the payload, without allowing them to execute again.
    if (row.status !== "APPROVED") {
      const message = row.status === "FAILED" ? "本次授权验证已失败，不能重复应用。请到“店铺与授权”查看失败原因，更新凭证后重新提交验证申请。"
        : row.status === "APPLYING" ? "授权验证正在执行，请稍候刷新查看结果。"
        : row.status === "APPLIED" ? "本次授权验证已完成，不能重复应用。"
        : row.status === "REQUESTED" ? "授权验证申请尚未批准，请先批准。"
        : "授权验证审批已失效，请重新提交验证申请。";
      throw new SyncInputError(message, 409);
    }
    await checkTargetAccess(tx, scope, actor, row.sourceIds);
    await checkTargetAccess(tx, scope, row.approvedByUserId ?? "", row.sourceIds);
    const envelope = await tx.amazonDataCenterSealedCommand.findFirst({ where: { ...scope, id } });
    if (!envelope || digest(envelope.ciphertext) !== row.payloadDigest) throw new SyncInputError("待应用授权验证完整性校验失败。", 409);
    const value = unseal(envelope.ciphertext, scope, id, row.targetEnvironment);
    const evidence = await inspect(tx, scope, value); evidence.targetId ||= row.targetId;
    assertApplicable(row, { environment: targetEnvironment(), digest: evidenceDigest(scope, row, evidence), revision: evidence.baseRevision });
    const claimed = await tx.amazonDataCenterChangeRequest.updateMany({ where: { ...scope, id, status: "APPROVED", expiresAt: { gt: new Date() } }, data: { status: "APPLYING" } });
    if (!claimed.count) throw new SyncInputError("审批已经使用。", 409);
    return { command: value, baseRevision: row.baseRevision };
  });
  try {
    const result = await performAuthorizationValidation(scope, actor, requiredText(approved.command.id, "授权 ID"), approved.baseRevision, id);
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope);
      await tx.amazonDataCenterSealedCommand.delete({ where: { organizationId_workspaceId_id: { ...scope, id } } });
      await tx.amazonDataCenterChangeRequest.update({ where: { id }, data: { status: "APPLIED", appliedAt: new Date() } });
      await audit(tx, scope, actor, id, "applied", { digest: digest({ id, result: "validated" }) });
    });
    return { applied: true, changeRequestId: id, result };
  } catch (error) {
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope);
      await tx.amazonDataCenterChangeRequest.updateMany({ where: { ...scope, id, status: "APPLYING" }, data: { status: "FAILED", decisionReason: "授权验证失败；敏感详情已脱敏。" } });
      await tx.amazonDataCenterSealedCommand.deleteMany({ where: { ...scope, id } });
      await audit(tx, scope, actor, id, "apply_failed", { code: "AUTH_VALIDATION_FAILED" });
    });
    throw error;
  }
}
export async function applyChange(scope: SyncScope, actor: string, id: string) {
  const change = await prisma.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id }, select: { operation: true, status: true, expiresAt: true } });
  if (change && ["REQUESTED", "APPROVED"].includes(change.status) && change.expiresAt <= new Date()) {
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope);
      const expired = await tx.amazonDataCenterChangeRequest.updateMany({ where: { ...scope, id, status: change.status }, data: { status: "EXPIRED", decidedAt: new Date(), decisionReason: "审批请求已过期。" } });
      if (expired.count) {
        await tx.amazonDataCenterSealedCommand.deleteMany({ where: { ...scope, id } });
        await audit(tx, scope, actor, id, "expired", {});
      }
    });
    throw new SyncInputError("审批请求已过期。", 409);
  }
  if (change?.operation === "validate-authorization") return applyAuthorizationValidation(scope, actor, id);
  try {
    return await prisma.$transaction(async tx => {
      await scopeLock(tx, scope);
      const row = await tx.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id } });
      if (!row) throw new SyncInputError("审批不存在。", 404);
      const action = operation(row.operation);
      await assertChangePermission(scope, actor, action, tx);
      await assertChangePermission(scope, row.approvedByUserId ?? "", "approve", tx);
      if (["save-access-grant", "save-authorization", "disable-authorization", "save-source", "validate-authorization"].includes(action)) await assertAmazonScopeAdmin(scope, row.approvedByUserId ?? "", tx);
      await checkTargetAccess(tx, scope, actor, row.sourceIds);
      await checkTargetAccess(tx, scope, row.approvedByUserId ?? "", row.sourceIds);
      const envelope = await tx.amazonDataCenterSealedCommand.findFirst({ where: { ...scope, id } });
      if (!envelope || digest(envelope.ciphertext) !== row.payloadDigest) throw new SyncInputError("待应用配置完整性校验失败。", 409);
      const command = unseal(envelope.ciphertext, scope, id, row.targetEnvironment);
      if (operation(command.action) !== action) throw new SyncInputError("审批操作不匹配。", 409);
      const evidence = await inspect(tx, scope, command); evidence.targetId ||= row.targetId;
      assertApplicable(row, { environment: targetEnvironment(), digest: evidenceDigest(scope, row, evidence), revision: evidence.baseRevision });
      const claimed = await tx.amazonDataCenterChangeRequest.updateMany({ where: { ...scope, id, status: "APPROVED", expiresAt: { gt: new Date() } }, data: { status: "APPLYING" } });
      if (claimed.count !== 1) throw new SyncInputError("审批已经使用。", 409);
      if (row.baseRevision) command.revision = row.baseRevision;
      const result = await withApprovedChange({ tx, scope, action, approvalId: id, commandSourceIds: row.sourceIds }, () => dispatch(scope, actor, { ...command, idempotencyKey: `approval:${id}` }));
      if (row.changeType !== "SyncExecutionRequest") {
        const entityId = result && typeof result === "object" && "id" in result ? String(result.id) : row.targetId;
        await tx.amazonDataCenterConfigVersion.create({ data: { ...scope, id: randomUUID(), targetEnvironment: row.targetEnvironment, entityType: row.changeType, entityId, revision: row.baseRevision + 1, summary: row.afterSummary as Prisma.InputJsonValue, approvalId: id, changeDigest: row.changeDigest } });
        // Any other pending grant for this configuration becomes stale immediately.
        await tx.amazonDataCenterChangeRequest.updateMany({ where: { ...scope, id: { not: id }, targetId: row.targetId, status: { in: ["REQUESTED", "APPROVED"] } }, data: { status: "STALE" } });
      }
      await tx.amazonDataCenterSealedCommand.delete({ where: { organizationId_workspaceId_id: { ...scope, id } } });
      await tx.amazonDataCenterChangeRequest.update({ where: { id }, data: { status: "APPLIED", appliedAt: new Date() } });
      await audit(tx, scope, actor, id, "applied", { digest: row.changeDigest });
      return { applied: true, changeRequestId: id };
    });
  } catch (error) {
    // Failure detail is deliberately a fixed code; never persist exceptions or raw commands.
    await prisma.$transaction(async tx => { await scopeLock(tx, scope); const found = await tx.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id } }); if (found) await audit(tx, scope, actor, id, "apply_failed", { code: "APPLY_REJECTED" }); });
    throw error;
  }
}
