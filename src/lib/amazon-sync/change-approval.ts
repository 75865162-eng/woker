import { latestClosedStorageFeeMonth, longTermStorageFeeRunWindow } from "./long-term-storage-fees";
import { inspectReportRecovery } from "./report-checkpoint-recovery";
import { amazonCloudExecutionEnabled } from "@/lib/amazon/execution-role";
import { inspectProductPartialPublication } from "./product-partial-publication";
import { previewProductAccessRecovery, applyProductAccessRecovery } from "./product-access-recovery";
import { previewReportArchiveRecovery, applyReportArchiveRecovery } from "./report-archive-recovery";
import { previewInboundItemRecovery, applyInboundItemRecovery } from "./inbound-item-recovery";
import { previewOrderFulfillmentRecovery, applyOrderFulfillmentRecovery } from "./order-fulfillment-recovery";
import { inspectOrderRecovery } from "./orders-recovery";
import { previewListingAttributeRecovery, applyListingAttributeRecovery } from "./listing-attribute-recovery";
import { previewFieldArchiveRecovery, applyFieldArchiveRecovery } from "./field-archive-recovery";
import { previewSettlementCurrencyRepair, applySettlementCurrencyRepair } from "./settlement-currency-repair";
import { nextBrandCollectionPolicy } from "./brand-collection-query";
import { discoverProductObjects } from "./product-discovery";
import { previewReportAttribution, applyReportAttribution } from "./report-attribution-recovery";
import { settlementScope } from "./settlement-scope";
import { parseSettlementPolicy } from "./settlements";
import { automaticPlanKey, latestClosedReimbursementWindow, nextAutomaticSettlementDiscovery } from "./automatic-schedule";
import { isObservationResource, parseObservationPolicy, assertObservationRoles, assertObservationClosed } from "./observation-policy";
import { parseReturnPolicy, assertReturnRoles, returnWindowFromFrozen, nextReturnWindow } from "./returns";
import { sellerArchivePolicy, assertSellerArchiveTarget } from "./seller-archive-policy";
import { isRemovalReport, assertDomainReportRoles, reimbursementRunWindow, removalOrderRunWindow, domainReportRunWindow, type DomainReportResource } from "./domain-reports";
import { saveAccessGrant } from "./access-management";
import { amazonDataAccess, assertAmazonScopeAdmin, assertSellerMarketplaceAccess, isAmazonScopeAdmin } from "./data-access";
import { resolveRequestedRange, rangeFromFrozen } from "./date-range";
import { parseFinancePolicy, nextFinanceWindow, financeWindowFromFrozen } from "./finance";
import { assertFinanceScope } from "./finance-scope";
import { parseOrderSyncPolicy, nextOrderWindow, orderWindowFromFrozen, assertOrderRoles } from "./orders";
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
import { inspectFinanceSiteRecovery } from "./finance-site-recovery";
import { inspectProductRecovery } from "./product-recovery";
import { ensureAmazonSyncInitialized } from "./scheduler";
import { preflightIdentityRecovery } from "./identity-recovery";
import { performIdentityAdoption } from "./identity-adoption";
import { previewFinanceRecovery, applyFinanceRecovery, previewFinanceReplay, applyFinanceReplay } from "./finance-recovery";
import { previewReportRecovery, applyReportRecovery } from "./report-recovery";
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const approvalSelect = { id: true, organizationId: true, workspaceId: true, targetEnvironment: true, changeType: true, operation: true, targetId: true, beforeSummary: true, afterSummary: true, sellerIds: true, marketplaceIds: true, domains: true, sourceIds: true, baseRevision: true, changeDigest: true, requestedByUserId: true, approvedByUserId: true, decidedAt: true, status: true, expiresAt: true, appliedAt: true, decisionReason: true, createdAt: true } satisfies Prisma.AmazonDataCenterChangeRequestSelect;
export function changeView(row: AmazonDataCenterChangeRequest) {
  return Object.fromEntries(Object.keys(approvalSelect).map(k => [k, row[k as keyof AmazonDataCenterChangeRequest]]));
}
export async function assertChangePermission(scope: SyncScope, actor: string, action: ChangeOperation | "approve" | "view" | "export", tx: Prisma.TransactionClient) {
  if (!await assertWorkspaceAccess(scope.organizationId, scope.workspaceId, tx)) throw new SyncInputError("工作区不可访问。", 403);
  const member = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor } }, include: { user: { select: { status: true } } } });
  const config = ["save-authorization", "disable-authorization", "save-source", "validate-authorization", "save-access-grant", "adopt-identity", "recover-finance-window", "recover-report"].includes(action);
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
  if (action === "recover-report" && command.productAccessOnly === true) {
    const repair = await previewProductAccessRecovery(tx, scope, id, requiredText(command.taskId, "目录原任务"));
    if (repair.recoveryDigest !== command.recoveryDigest || repair.source.revision !== command.revision) throw new SyncInputError("目录续验清单已变化。", 409);
    before = repair.manifest; sourceIds = [id]; baseRevision = repair.source.revision; authId = repair.source.authorizationId;
  } else if (action === "recover-report" && command.archiveOnly === true) {
    const repair = await previewReportArchiveRecovery(tx, scope, id, requiredText(command.taskId, "失败任务"), requiredText(command.reportDocumentId, "历史原件"));
    if (repair.recoveryDigest !== command.recoveryDigest || repair.source.revision !== command.revision) throw new SyncInputError("历史原件恢复清单已变化。", 409);
    before = repair.manifest; sourceIds = [id]; baseRevision = repair.source.revision; authId = repair.source.authorizationId;
  } else if (action === "recover-report" && command.inboundItemsOnly === true) {
    const repair = await previewInboundItemRecovery(tx, scope, id, requiredText(command.taskId, "原件任务"));
    if (repair.recoveryDigest !== command.recoveryDigest || repair.source.revision !== command.revision) throw new SyncInputError("FBA 补齐清单已变化。", 409);
    before = repair.manifest; sourceIds = [id]; baseRevision = repair.source.revision; authId = repair.source.authorizationId;
  } else if (action === "recover-report" && command.orderFulfillmentOnly === true) {
    const repair = await previewOrderFulfillmentRecovery(tx, scope, id, requiredText(command.taskId, "原件任务"), command.rawPages);
    if (repair.recoveryDigest !== command.recoveryDigest || repair.source.revision !== command.revision) throw new SyncInputError("订单履约补齐清单已变化。", 409);
    before = repair.manifest; sourceIds = [id]; baseRevision = repair.source.revision; authId = repair.source.authorizationId;
  } else if (action === "recover-report" && command.listingAttributesOnly === true) {
    const repair = await previewListingAttributeRecovery(tx, scope, id, requiredText(command.taskId, "原件任务"), command.rawPages);
    if (repair.recoveryDigest !== command.recoveryDigest || repair.source.revision !== command.revision) throw new SyncInputError("Listing 补齐清单已变化。", 409);
    before = repair.manifest; sourceIds = [id]; baseRevision = repair.source.revision; authId = repair.source.authorizationId;
  } else if (action === "recover-report" && command.fieldScanOnly === true) {
    const scan = await previewFieldArchiveRecovery(tx, scope, id, requiredText(command.taskId, "原件任务"), command.rawPages);
    if (scan.recoveryDigest !== command.recoveryDigest || scan.source.revision !== command.revision) throw new SyncInputError("字段回扫清单已变化。", 409);
    before = scan.manifest; sourceIds = [id]; baseRevision = scan.source.revision; authId = scan.source.authorizationId;
  } else if (action === "recover-report" && command.currencyOnly === true) {
    if (command.attributionOnly === true) throw new SyncInputError("币种修复与归属修复必须分别申请。");
    const repair = await previewSettlementCurrencyRepair(tx, scope, id, command.reportDocumentIds);
    if (repair.recoveryDigest !== command.recoveryDigest || repair.source.revision !== command.revision) throw new SyncInputError("币种修复清单已变化。", 409);
    before = repair.manifest; sourceIds = [id]; baseRevision = repair.source.revision; authId = repair.source.authorizationId;
  } else if (action === "recover-report" && command.attributionOnly === true) {
    const report = await previewReportAttribution(tx, scope, id);
    if (report.recoveryDigest !== command.recoveryDigest || report.source.revision !== command.revision) throw new SyncInputError("归属恢复清单已变化。", 409);
    before = report.manifest; sourceIds = [id]; baseRevision = report.source.revision; authId = report.source.authorizationId;
  } else if (action === "recover-report") {
    const report = await previewReportRecovery(tx, scope, id, command.reportWindow, command.settlementPolicy);
    if (report.recoveryDigest !== command.recoveryDigest || report.source.revision !== command.revision) throw new SyncInputError("报告恢复清单已变化。", 409);
    before = { sourceId: id, originalRunId: report.run.id, proposed: report.proposed, ...("settlement" in report ? { settlement: report.settlement } : {}) };
    sourceIds = [id]; baseRevision = report.source.revision; authId = report.source.authorizationId;
  } else if (action === "recover-finance-window" && command.sameWindowReplay === true) {
    const report = await previewFinanceReplay(tx, scope, id);
    if (report.recoveryDigest !== command.recoveryDigest || report.source.revision !== command.revision) throw new SyncInputError("财务重放证据已变化。", 409);
    before = report.manifest; sourceIds = [id]; baseRevision = report.source.revision; authId = report.source.authorizationId;
  } else if (action === "recover-finance-window") {
    const report = await previewFinanceRecovery(tx, scope, id, new Date(requiredText(command.reviewedAt, "预审时间")));
    if (report.recoveryDigest !== command.recoveryDigest || report.source.revision !== command.revision) throw new SyncInputError("财务恢复清单已变化。", 409);
    before = { sourceId: id, revision: report.source.revision, original: report.proposal.original, proposed: report.proposal.proposed, gap: report.proposal.gap, recoveryDigest: report.recoveryDigest };
    sourceIds = [id]; baseRevision = report.source.revision; authId = report.source.authorizationId;
  } else if (action === "adopt-identity") {
    const reviewedAt = new Date(requiredText(command.reviewedAt, "预审时间"));
    if (!Number.isFinite(reviewedAt.getTime()) || reviewedAt.getTime() > Date.now() || Date.now() - reviewedAt.getTime() > 3600000) throw new SyncInputError("身份预审已过期。", 409);
    const report = await preflightIdentityRecovery(tx, scope, id, requiredText(command.amazonSellerId, "Seller ID"), reviewedAt);
    if (command.manifestDigest !== report.manifestDigest || command.revision !== report.manifest.authorization.revision) throw new SyncInputError("身份恢复清单已变化，须重新预审。", 409);
    if (report.blockers.some(code => code !== "HISTORICAL_FACT_ATTRIBUTION_NOT_ATTESTED")) throw new SyncInputError("身份接管前须按审批停止计划并处理在途任务；冲突不得强行应用。", 409);
    if (report.manifest.plans.some(plan => plan.enabled)) throw new SyncInputError("身份接管前须经审批暂停相关计划。", 409);
    before = { authorization: report.manifest.authorization, manifestDigest: report.manifestDigest, historicalFactsRemainUnverified: true };
    sourceIds = report.manifest.sources.map(source => source.id);
    baseRevision = report.manifest.authorization.revision;
    authId = id;
  } else if (["save-authorization", "disable-authorization", "validate-authorization"].includes(action)) {
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
      if (!auth.amazonSellerId && command.resource === "listing_details") throw new SyncInputError("Listing Items 详情需 OAuth 卖家身份；全量 Listing 请使用 catalog 报表。", 409);
      const conflict = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, marketplaceId, OR: [{ sellerAccountId, authorizationId: { not: authorizationId } }, { authorizationId, sellerAccountId: { not: sellerAccountId } }] }, select: { id: true } });
      const identity = await tx.amazonSellerIdentity.findFirst({ where: { ...scope, marketplaceId, OR: [{ sellerAccountId }, { authorizationId }] }, select: { authorizationId: true, sellerAccountId: true } });
      if (conflict || (identity && (identity.authorizationId !== authorizationId || identity.sellerAccountId !== sellerAccountId))) throw new SyncInputError("店铺站点授权绑定冲突，须先核查历史归属。", 409);
    }
    if (isObservationResource(resource) && command.enabled !== false) { const p = parseObservationPolicy(command.domainPolicy ?? source?.domainPolicy, resource); assertObservationRoles(p, auth, { ...scope, authorizationId: auth.id, authorizationRevision: auth.revision, marketplaceId }); assertObservationClosed(p, new Date(), marketplaceId); }
    if (resource === "returns" && command.enabled !== false) { parseReturnPolicy(command.returnsPolicy ?? source?.returnsPolicy); assertReturnRoles(auth); }
    const archivePolicy = sellerArchivePolicy(resource, command.domainPolicy ?? source?.domainPolicy);
    if (archivePolicy) assertSellerArchiveTarget(scope, marketplaceId);
    if (["settlements", "reimbursements", "inventory_age", "long_term_storage_fees", "removal_shipment_report", "fba_shipments", "inventory_events", "removal_order_report", "storage_fees", "fba_fulfilled_inventory", "fba_inventory_report", "reserved_inventory", "stranded_inventory", "recommended_removals"].includes(resource) && command.enabled !== false) assertDomainReportRoles(resource as DomainReportResource, auth, !!archivePolicy);
    if (resource === "orders" && command.enabled !== false) {
      const orderPolicy = parseOrderSyncPolicy(command.orderPolicy ?? source?.orderPolicy);
      assertOrderRoles(auth, orderPolicy, false, { ...scope, authorizationId: auth.id, authorizationRevision: auth.revision, marketplaceId });
    }
    if (resource === "finance" && command.enabled !== false) await assertFinanceScope(tx, scope, { authorizationId, sellerAccountId, marketplaceId, financePolicy: command.financePolicy ?? source?.financePolicy }, [ ]);
    if (resource === "settlements" && (command.settlementPolicy ?? source?.settlementPolicy)) await settlementScope(tx, scope, { authorizationId, marketplaceId, settlementPolicy: command.settlementPolicy ?? source?.settlementPolicy }, []);
    before = { source: source ? { id: source.id, revision: source.revision, authorizationId: source.authorizationId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, resource: source.resource, enabled: source.enabled, freshnessMinutes: source.freshnessMinutes, ...(source.resource === "settlements" ? { settlementPolicy: source.settlementPolicy } : {}), ...(isObservationResource(source.resource) ? { domainPolicy: source.domainPolicy } : {}), ...(source.resource === "orders" ? { orderPolicy: source.orderPolicy } : {}), ...(source.resource === "finance" ? { financePolicy: source.financePolicy } : {}), ...(source.resource === "returns" ? { returnsPolicy: source.returnsPolicy } : {}) } : null, authorization: auth, seller };
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
    if (command.enabled === true && !plan?.planKey.startsWith("auto-v1:") && !(command.resource === "brand_analytics" && !plan)) throw new SyncInputError("仅可恢复系统生成的自动同步计划。", 409);
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
    if (!["pause", "cancel", "retry", "resume", "publish-available"].includes(String(command.control))) throw new SyncInputError("任务操作无效。");
    const run = await tx.amazonSyncRun.findFirst({ where: { ...scope, id, executionVersion: 2 } });
    if (!run) throw new SyncInputError("任务不存在。", 404);
    if (command.quarantineOutsideFinanceScope === true && (run.resource !== "finance" || run.status !== "FAILED" || run.error !== "财务响应含批准范围之外的站点，整页未提交。")) throw new SyncInputError("仅可恢复已确认站点越界的失败财务任务。", 409);
    before = { ...(run.resource === "orders" && ["retry", "resume"].includes(String(command.control)) ? { orderRecovery: await inspectOrderRecovery(tx, run) } : {}), id: run.id, status: run.status, stage: run.stage, dispatchVersion: run.dispatchVersion, control: run.control, frozenScope: run.frozenScope, trigger: run.trigger, scheduleId: run.scheduleId, scheduleRevision: run.scheduleRevision }; baseRevision = run.dispatchVersion;
    if (command.quarantineOutsideFinanceScope === true) before = { ...(before as Record<string, unknown>), financeSiteRecovery: await inspectFinanceSiteRecovery(tx, run) };
    if (["catalog_items", "listing_details"].includes(run.resource) && ["retry", "resume"].includes(String(command.control))) before = { ...(before as Record<string, unknown>), productRecovery: await inspectProductRecovery(tx, run) };
    if (["reimbursements", "inventory_events"].includes(run.resource) && ["retry", "resume"].includes(String(command.control))) before = { ...(before as Record<string, unknown>), reportRecovery: await inspectReportRecovery(tx, run) };
    if (command.control === "publish-available") before = { ...(before as Record<string, unknown>), partialPublication: (await inspectProductPartialPublication(tx, scope, run.id)).evidence };
    sourceIds = run.sourceId ? [run.sourceId] : [];
  }
  const sources = sourceIds.length ? await tx.amazonSyncDataSource.findMany({ where: { ...scope, id: { in: sourceIds } }, include: { authorization: { select: authSelect }, seller: { select: { status: true, updatedAt: true } } }, orderBy: { id: "asc" } }) : [];
  if (sources.length !== sourceIds.length) throw new SyncInputError("数据源不属于当前组织／工作区。", 403);
  if (action === "run") for (const source of sources) {
    if (["settlements", "reimbursements", "inventory_age", "long_term_storage_fees", "removal_shipment_report", "fba_shipments", "inventory_events", "removal_order_report", "storage_fees", "fba_overage_fees", "fee_preview", "fba_fulfilled_inventory", "fba_inventory_report", "reserved_inventory", "stranded_inventory", "recommended_removals"].includes(source.resource)) assertDomainReportRoles(source.resource as DomainReportResource, source.authorization, !!sellerArchivePolicy(source.resource, source.domainPolicy));
    if (isObservationResource(source.resource)) { const p = parseObservationPolicy(source.domainPolicy, source.resource); assertObservationRoles(p, source.authorization, { ...scope, authorizationId: source.authorizationId, authorizationRevision: source.authorization.revision, marketplaceId: source.marketplaceId }); assertObservationClosed(p, new Date(), source.marketplaceId); }
    if (source.resource === "sales_traffic") {
      const ranges = command.requestedRanges as Record<string, unknown> | undefined;
      rangeFromFrozen({ requestedRange: ranges?.[source.id] });
    }
    if (source.resource === "returns") returnWindowFromFrozen((command.returnWindows as Record<string, unknown> | undefined)?.[source.id]);
    if (source.resource === "finance") financeWindowFromFrozen((command.financeWindows as Record<string, unknown> | undefined)?.[source.id]);
    if (source.resource === "orders") orderWindowFromFrozen((command.orderWindows as Record<string, unknown> | undefined)?.[source.id]);
    if (["settlements", "inventory_events", "reimbursements", "removal_order_report", "removal_shipment_report", "fba_shipments", "mfn_returns", "long_term_storage_fees"].includes(source.resource)) domainReportRunWindow(source.resource as DomainReportResource, (command.reportWindows as Record<string, unknown> | undefined)?.[source.id]);
  }
  const targets = sources.map(s => ({ sourceId: s.id, sourceRevision: s.revision, enabled: s.enabled, authorizationId: s.authorizationId, authorizationRevision: s.authorization.revision, authorizationStatus: s.authorization.status, amazonSellerId: s.authorization.amazonSellerId, sellerAccountId: s.sellerAccountId, sellerStatus: s.seller.status, sellerUpdatedAt: s.seller.updatedAt, marketplaceId: s.marketplaceId, resource: s.resource, ...(sellerArchivePolicy(s.resource, s.domainPolicy) ? { sellerArchivePolicy: sellerArchivePolicy(s.resource, s.domainPolicy) } : {}), ...(isObservationResource(s.resource) ? { domainPolicy: parseObservationPolicy(s.domainPolicy, s.resource) } : {}), ...(s.resource === "orders" ? { orderPolicy: parseOrderSyncPolicy(s.orderPolicy) } : {}), ...(s.resource === "finance" ? { financePolicy: parseFinancePolicy(s.financePolicy) } : {}), ...(s.resource === "settlements" && s.settlementPolicy ? { settlementPolicy: parseSettlementPolicy(s.settlementPolicy) } : {}), ...(s.resource === "returns" ? { returnsPolicy: parseReturnPolicy(s.returnsPolicy) } : {}) }));
  if (action === "run") for (const source of sources) {
    if (isObservationResource(source.resource)) {
      const manifest = await discoverProductObjects(tx, scope, source, parseObservationPolicy(source.domainPolicy, source.resource));
      if (manifest) Object.assign(targets.find(t => t.sourceId === source.id)!, { productManifest: manifest });
    }
  }
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
export async function requestChange(scope: SyncScope, actor: string, input: Record<string, unknown>, relayKey?: string): Promise<ReturnType<typeof changeView>> {
  const command = normalizeCommand(input), action = operation(command.action), environment = targetEnvironment();
  if (action === "run" && !amazonCloudExecutionEnabled()) {
    await assertChangePermission(scope, actor, action, prisma);
    const result = await (await import("./cloud-relay")).relayAmazonExecution(scope, actor, { kind: "request", command });
    return result.changeRequest as ReturnType<typeof changeView>;
  }
  const relayId = relayKey ? digest([scope, actor, relayKey]) : undefined;
  const id = relayId ? `cloud-run-${relayId}` : randomUUID();
  if (!command.id && ["save-authorization", "save-source", "save-plan", "save-access-grant"].includes(action)) command.proposedId = randomUUID();
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertChangePermission(scope, actor, action, tx);
    if (relayId) {
      if (action !== "run") throw new SyncInputError("云端幂等标识仅适用于同步申请。", 400);
      const prior = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, action: "amazon.cloud.sync.request", entityId: relayId } });
      if (prior) {
        const metadata = prior.metadata as { fingerprint?: string; changeRequestId?: string };
        if (metadata.fingerprint !== digest(input) || metadata.changeRequestId !== id || prior.userId !== actor) throw new SyncInputError("云端幂等标识已绑定其他请求。", 409);
        return changeView(await tx.amazonDataCenterChangeRequest.findFirstOrThrow({ where: { ...scope, id } }));
      }
    }
    if (action === "save-plan" && command.resource === "brand_analytics") await assertAmazonScopeAdmin(scope, actor, tx);
    if (action === "run") {
      const sources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, id: { in: command.sourceIds as string[] ?? [] } }, include: { authorization: true } });
      const requestedRanges: Record<string, unknown> = {};
      const orderWindows: Record<string, unknown> = {};
      const financeWindows: Record<string, unknown> = {};
      const returnWindows: Record<string, unknown> = {};
      const reportWindows: Record<string, unknown> = {};
      const brandPolicies: Record<string, unknown> = {};
      for (const source of sources) {
        if (source.resource === "brand_analytics") {
          if (command.dateFrom || command.dateTo || command.datePreset) throw new SyncInputError("品牌日期由已批准的来源清单确定。");
          brandPolicies[source.id] = await nextBrandCollectionPolicy(tx, scope, source);
        }
        else if (source.resource === "sales_traffic") requestedRanges[source.id] = resolveRequestedRange(source.marketplaceId, command);
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
          reportWindows[source.id] = nextAutomaticSettlementDiscovery(new Date());
        }
        else if (source.resource === "long_term_storage_fees") {
          reportWindows[source.id] = longTermStorageFeeRunWindow(command.dateFrom || command.dateTo ? { from: command.dateFrom, to: command.dateTo } : latestClosedStorageFeeMonth());
        }
        else if (isRemovalReport(source.resource)) {
          const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          reportWindows[source.id] = removalOrderRunWindow({ from: command.dateFrom ?? yesterday, to: command.dateTo ?? yesterday });
        }
        else if (source.resource === "fba_shipments") {
          const latest = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
          const to = command.dateTo ?? latest;
          const from = command.dateFrom ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
          reportWindows[source.id] = domainReportRunWindow("fba_shipments", { from, to });
        }
        else if (source.resource === "mfn_returns") {
          const to = command.dateTo ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          const from = command.dateFrom ?? new Date(Date.parse(`${to}T00:00:00Z`) - 59 * 86400000).toISOString().slice(0, 10);
          reportWindows[source.id] = domainReportRunWindow("mfn_returns", { from, to });
        }
        else if (source.resource === "reimbursements") {
          const cursor = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: source.id } });
          if (cursor && cursor.status !== "SUCCEEDED") throw new SyncInputError("赔偿已有未完成报告，须先核对原报告与检查点，不能用新日期覆盖。", 409);
          reportWindows[source.id] = reimbursementRunWindow(command.dateFrom || command.dateTo ? { from: command.dateFrom, to: command.dateTo } : latestClosedReimbursementWindow(new Date()));
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
      if (Object.keys(brandPolicies).length) command.brandPolicies = brandPolicies;
    }
    const ciphertext = seal(command, scope, id, environment), payloadDigest = digest(ciphertext);
    const evidence = await inspect(tx, scope, command); evidence.targetId ||= String(command.proposedId ?? id);
    await checkTargetAccess(tx, scope, actor, evidence.sourceIds, ["adopt-identity", "recover-finance-window", "recover-report"].includes(action) || action === "save-plan" && await isAutomaticPlan(tx, scope, evidence.targetId) || action === "control-task" && await isScheduledFinanceControl(tx, scope, evidence.targetId));
    const row = await tx.amazonDataCenterChangeRequest.create({ data: { ...scope, id, targetEnvironment: environment, changeType: operationTypes[action], operation: action, ...evidence, beforeSummary: json(safeState(evidence.beforeSummary)), afterSummary: json(safeState(evidence.afterSummary)), changeDigest: evidenceDigest(scope, { targetEnvironment: environment, operation: action, payloadDigest }, evidence), payloadDigest, requestedByUserId: actor, expiresAt: new Date(Date.now() + 60 * 60_000) } });
    await tx.amazonDataCenterSealedCommand.create({ data: { ...scope, id, ciphertext } });
    await audit(tx, scope, actor, id, "requested", { digest: row.changeDigest, operation: action, environment });
    if (relayId) await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.cloud.sync.request", entityType: "AmazonDataCenterChangeRequest", entityId: relayId, metadata: { workspaceId: scope.workspaceId, fingerprint: digest(input), changeRequestId: id } } });
    return changeView(row);
  });
}
export async function decideChange(scope: SyncScope, actor: string, id: string, decision: "APPROVED" | "REJECTED" | "REVOKED", reason: string): Promise<ReturnType<typeof changeView>> {
  if (!amazonCloudExecutionEnabled()) {
    const local = await prisma.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id }, select: { operation: true } });
    if (!local || local.operation === "run") {
      await assertChangePermission(scope, actor, "approve", prisma);
      return (await (await import("./cloud-relay")).relayAmazonExecution(scope, actor, { kind: "decide", id, decision, reason })).changeRequest as ReturnType<typeof changeView>;
    }
  }
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope); const approver = await assertChangePermission(scope, actor, "approve", tx);
    const row = await tx.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id } });
    if (!row) throw new SyncInputError("审批不存在。", 404);
    if (["save-access-grant", "save-authorization", "disable-authorization", "save-source", "validate-authorization", "adopt-identity", "recover-finance-window", "recover-report"].includes(row.operation)) await assertAmazonScopeAdmin(scope, actor, tx);
    if (decision === "APPROVED" && row.status === "REQUESTED" && row.expiresAt <= new Date()) {
      await tx.amazonDataCenterChangeRequest.updateMany({ where: { ...scope, id, status: "REQUESTED" }, data: { status: "EXPIRED", decidedAt: new Date(), decisionReason: "审批请求已过期。" } });
      await tx.amazonDataCenterSealedCommand.deleteMany({ where: { ...scope, id } });
      await audit(tx, scope, actor, id, "expired", { digest: row.changeDigest });
      return changeView({ ...row, status: "EXPIRED", decidedAt: new Date(), decisionReason: "审批请求已过期。" });
    }
    if (decision === "REVOKED") {
      if (!["REQUESTED", "APPROVED"].includes(row.status) && !(row.status === "APPLIED" && row.changeType === "SyncExecutionRequest")) throw new SyncInputError("已应用配置不能撤销；须另行提交反向变更。", 409);
    } else assertDecision(row, actor, new Date(), isAmazonScopeAdmin(approver.role));
    if (row.sourceIds.length) await checkTargetAccess(tx, scope, actor, row.sourceIds, ["adopt-identity", "recover-finance-window", "recover-report"].includes(row.operation) || row.operation === "save-plan" && await isAutomaticPlan(tx, scope, row.targetId) || row.operation === "control-task" && await isScheduledFinanceControl(tx, scope, row.targetId));
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
async function isAutomaticPlan(tx: Prisma.TransactionClient, scope: SyncScope, id: string) {
  if (!id) return false;
  return Boolean(await tx.amazonSyncSchedule.findFirst({ where: { ...scope, id, executionVersion: 2, planKey: { startsWith: "auto-v1:" } }, select: { id: true } }));
}
async function isScheduledFinanceControl(tx: Prisma.TransactionClient, scope: SyncScope, id: string) {
  const run = await tx.amazonSyncRun.findFirst({ where: { ...scope, id, resource: "finance", executionVersion: 2, trigger: "schedule" } });
  if (!run?.sourceId || !run.scheduleId || run.scheduleRevision === null) return false;
  const frozen = run.frozenScope as Prisma.JsonObject | null;
  if (!frozen || digest(frozen) !== run.frozenScopeDigest || frozen.sourceId !== run.sourceId || frozen.resource !== run.resource || frozen.scheduleId !== run.scheduleId || frozen.scheduleRevision !== run.scheduleRevision) return false;
  const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: run.sourceId, enabled: true }, include: { authorization: true } });
  if (!source || frozen.sourceRevision !== source.revision || frozen.authorizationId !== source.authorizationId || frozen.authorizationRevision !== source.authorization.revision || run.authorizationRevision !== source.authorization.revision || frozen.amazonSellerId !== source.authorization.amazonSellerId || frozen.marketplaceId !== source.marketplaceId || frozen.sellerAccountId !== source.sellerAccountId || digest(frozen.financePolicy) !== digest(source.financePolicy)) return false;
  return Boolean(await tx.amazonSyncSchedule.findFirst({ where: { ...scope, id: run.scheduleId, resource: "finance", executionVersion: 2, enabled: true, revision: run.scheduleRevision, planKey: automaticPlanKey(run.sourceId), updatedByUserId: run.requestedByUserId, targets: { some: { sourceId: run.sourceId } } }, select: { id: true } }));
}
async function checkTargetAccess(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, sourceIds: string[], allowInactiveAutomaticPlan = false) {
  if (!sourceIds.length) return;
  const sources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, id: { in: sourceIds } }, });
  if (sources.length !== sourceIds.length) throw new SyncInputError("审批数据源范围无效。", 403);
  for (const source of sources) {
    if (source.resource === "finance") await assertFinanceScope(tx, scope, source, [actor], allowInactiveAutomaticPlan);
    else await assertSellerMarketplaceAccess(scope, actor, source.sellerAccountId, source.marketplaceId, tx, "sync", allowInactiveAutomaticPlan);
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
    case "control-task": return controlTask(scope, actor, requiredText(command.id, "任务 ID"), command.control, command.quarantineOutsideFinanceScope === true);
    case "validate-authorization": throw new SyncInputError("授权验证必须由审批执行边界处理。", 500);
    case "adopt-identity": throw new SyncInputError("身份接管必须由独立审批执行边界处理。", 500);
    case "recover-finance-window": return command.sameWindowReplay === true ? applyFinanceReplay(scope, actor, command) : applyFinanceRecovery(scope, actor, command);
    case "recover-report": return command.productAccessOnly === true ? applyProductAccessRecovery(scope, actor, command) : command.archiveOnly === true ? applyReportArchiveRecovery(scope, actor, command) : command.inboundItemsOnly === true ? applyInboundItemRecovery(scope, actor, command) : command.orderFulfillmentOnly === true ? applyOrderFulfillmentRecovery(scope, actor, command) : command.listingAttributesOnly === true ? applyListingAttributeRecovery(scope, actor, command) : command.fieldScanOnly === true ? applyFieldArchiveRecovery(scope, actor, command) : command.currencyOnly === true ? applySettlementCurrencyRepair(scope, actor, command) : command.attributionOnly === true ? applyReportAttribution(scope, actor, command) : applyReportRecovery(scope, actor, command);
  }
}
async function applyAuthorizationValidation(scope: SyncScope, actor: string, id: string, identityAdoption = false) {
  const approved = await prisma.$transaction(async tx => {
    await scopeLock(tx, scope);
    const row = await tx.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id } });
    if (!row) throw new SyncInputError("审批不存在。", 404);
    if (row.operation !== (identityAdoption ? "adopt-identity" : "validate-authorization")) throw new SyncInputError("审批执行操作不匹配。", 403);
    await assertChangePermission(scope, actor, identityAdoption ? "adopt-identity" : "validate-authorization", tx);
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
    await checkTargetAccess(tx, scope, actor, row.sourceIds, identityAdoption);
    await checkTargetAccess(tx, scope, row.approvedByUserId ?? "", row.sourceIds, identityAdoption);
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
    if (identityAdoption) return await performIdentityAdoption(scope, actor, id, approved.command);
    const result = await performAuthorizationValidation(scope, actor, requiredText(approved.command.id, "授权 ID"), approved.baseRevision, id);
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope);
      await tx.amazonDataCenterSealedCommand.delete({ where: { organizationId_workspaceId_id: { ...scope, id } } });
      await tx.amazonDataCenterChangeRequest.update({ where: { id }, data: { status: "APPLIED", appliedAt: new Date() } });
      await audit(tx, scope, actor, id, "applied", { digest: digest({ id, result: "validated" }) });
    });
    let automaticSync: Awaited<ReturnType<typeof ensureAmazonSyncInitialized>>;
    try { automaticSync = await ensureAmazonSyncInitialized(scope, requiredText(approved.command.id, "授权 ID")); }
    catch {
      console.error(`[amazon-sync-center] automatic initialization deferred for authorization ${String(approved.command.id).slice(0, 80)}`);
      automaticSync = { status: "deferred", sourceCount: 0, planCount: 0, taskCount: 0 };
    }
    return { applied: true, changeRequestId: id, result: { ...result, automaticSync } };
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
  if (!amazonCloudExecutionEnabled() && (!change || change.operation === "run")) {
    await assertChangePermission(scope, actor, "run", prisma);
    return (await import("./cloud-relay")).relayAmazonExecution(scope, actor, { kind: "apply", id });
  }
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
  if (change?.operation === "adopt-identity") return applyAuthorizationValidation(scope, actor, id, true);
  try {
    return await prisma.$transaction(async tx => {
      await scopeLock(tx, scope);
      const row = await tx.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id } });
      if (!row) throw new SyncInputError("审批不存在。", 404);
      const action = operation(row.operation);
      await assertChangePermission(scope, actor, action, tx);
      await assertChangePermission(scope, row.approvedByUserId ?? "", "approve", tx);
      if (["save-access-grant", "save-authorization", "disable-authorization", "save-source", "validate-authorization", "recover-finance-window", "recover-report"].includes(action)) await assertAmazonScopeAdmin(scope, row.approvedByUserId ?? "", tx);
      const allowInactiveAutomaticPlan = ["recover-finance-window", "recover-report"].includes(action) || action === "save-plan" && await isAutomaticPlan(tx, scope, row.targetId) || action === "control-task" && await isScheduledFinanceControl(tx, scope, row.targetId);
      await checkTargetAccess(tx, scope, actor, row.sourceIds, allowInactiveAutomaticPlan);
      await checkTargetAccess(tx, scope, row.approvedByUserId ?? "", row.sourceIds, allowInactiveAutomaticPlan);
      const envelope = await tx.amazonDataCenterSealedCommand.findFirst({ where: { ...scope, id } });
      if (!envelope || digest(envelope.ciphertext) !== row.payloadDigest) throw new SyncInputError("待应用配置完整性校验失败。", 409);
      const command = unseal(envelope.ciphertext, scope, id, row.targetEnvironment);
      if (action === "save-plan" && command.resource === "brand_analytics") await assertAmazonScopeAdmin(scope, row.approvedByUserId ?? "", tx);
      if (operation(command.action) !== action) throw new SyncInputError("审批操作不匹配。", 409);
      const evidence = await inspect(tx, scope, command); evidence.targetId ||= row.targetId;
      assertApplicable(row, { environment: targetEnvironment(), digest: evidenceDigest(scope, row, evidence), revision: evidence.baseRevision });
      const claimed = await tx.amazonDataCenterChangeRequest.updateMany({ where: { ...scope, id, status: "APPROVED", expiresAt: { gt: new Date() } }, data: { status: "APPLYING" } });
      if (claimed.count !== 1) throw new SyncInputError("审批已经使用。", 409);
      if (row.baseRevision) command.revision = row.baseRevision;
      const result = await withApprovedChange({ tx, scope, action, approvalId: id, commandSourceIds: row.sourceIds }, () => dispatch(scope, actor, { ...command, idempotencyKey: `approval:${id}` }));
      if (row.changeType !== "SyncExecutionRequest" && !(action === "recover-report" && (command.fieldScanOnly === true || command.currencyOnly === true || command.listingAttributesOnly === true || command.orderFulfillmentOnly === true || command.attributionOnly === true || command.inboundItemsOnly === true || command.archiveOnly === true || command.productAccessOnly === true))) {
        const entityId = result && typeof result === "object" && "id" in result ? String(result.id) : row.targetId;
        await tx.amazonDataCenterConfigVersion.create({ data: { ...scope, id: randomUUID(), targetEnvironment: row.targetEnvironment, entityType: row.changeType, entityId, revision: row.baseRevision + 1, summary: row.afterSummary as Prisma.InputJsonValue, approvalId: id, changeDigest: row.changeDigest } });
        // Any other pending grant for this configuration becomes stale immediately.
        await tx.amazonDataCenterChangeRequest.updateMany({ where: { ...scope, id: { not: id }, targetId: row.targetId, status: { in: ["REQUESTED", "APPROVED"] } }, data: { status: "STALE" } });
      }
      await tx.amazonDataCenterSealedCommand.delete({ where: { organizationId_workspaceId_id: { ...scope, id } } });
      await tx.amazonDataCenterChangeRequest.update({ where: { id }, data: { status: "APPLIED", appliedAt: new Date() } });
      await audit(tx, scope, actor, id, "applied", { digest: row.changeDigest });
      return { applied: true, changeRequestId: id };
    }, change?.operation === "recover-report" ? { timeout: 120_000 } : undefined);
  } catch (error) {
    // Failure detail is deliberately a fixed code; never persist exceptions or raw commands.
    await prisma.$transaction(async tx => { await scopeLock(tx, scope); const found = await tx.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id } }); if (found) await audit(tx, scope, actor, id, "apply_failed", { code: "APPLY_REJECTED" }); });
    throw error;
  }
}
