import { brandFairTurn } from "./brand-fairness";
import { assertBrandTaskPolicy } from "./brand-collection";
import { continuityEvidence, continuityOrderTurn, continuityProbeDue } from "./continuity-access";
import { assertProductDiscoveryHead, resolvedProductPolicy, validateProductManifest } from "./product-discovery";
import { requiresReportRowAttribution } from "./report-row-attribution";
import { assertSettlementMarketplaces, parseSettlementReport, type SettlementPolicy, type SettlementBinding } from "./settlements";
import { markReportRowAttribution, persistReportAttributionMarkers, reportVerifiedRowWhere } from "./report-row-attribution";
import { localSellerEvidenceEnabled } from "./seller-report-evidence";
import { decodeReportParts } from "../amazon/report-download-range";
import { readSettlementParts, storeSettlementPart, validateSettlementPartsState, settlementRangeEnabled, type SettlementPartsState } from "./settlement-download-parts";
import { settlementScope, assertFrozenSettlementScope } from "./settlement-scope";
import { allListingsReportType, parseAllListingsReport } from "./catalog-report";
import { deduplicateFacts } from "./observation-parsers";
import { advanceObservation, parseObservationState, observationOperation, type ObservationState } from "./observation-machine";
import { observationReportSpec, type AnalyticsPolicy } from "./observation-policy";
import { isObservationResource, parseObservationPolicy, assertObservationRoles, assertObservationClosed } from "./observation-policy";
import { reportTimestampMatches, parseReturnPolicy, assertReturnRoles, returnWindowFromFrozen, parseReturnState, parseReturnReport, returnPollDelay } from "./returns";
import { sellerArchivePolicy, assertSellerArchiveTarget } from "./seller-archive-policy";
import { assertDomainReportRoles, assertDomainReportReady, assertSettlementDiscoveryAvailable, domainReportRunWindow, domainReportTypes, parseDomainReport, parseGetReportsPage, type DomainReportResource } from "./domain-reports";
import { assertExecutionWindow } from "./execution-window";
import { automaticPlanKey, automaticMarketplaceAllowed, isAutomaticResource } from "./automatic-schedule";
import { assertFinanceScope } from "./finance-scope";
import { parseFinancePolicy, parseFinancePage, financeWindowFromFrozen, assertFinanceRequestWindow, attributeFinanceTransaction, convertFinanceMoney } from "./finance";
import { assertSellerMarketplaceAccess } from "./data-access";
import { rangeFromFrozen } from "./date-range";
import { parseSalesTraffic, salesTrafficReportType } from "./sales-traffic";
import { assertOrderRoles, orderWindowFromFrozen, parseOrderPage, parseOrderDetail, parseOrderSyncPolicy, type OrderSyncPolicy, type OrderWindow } from "./orders";
import { orderBucketKey, reserveOrderToken } from "./orders-rate-limit";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma, type AmazonSyncRun, type AmazonSyncResourceCursor, type AmazonOrderDetailWork } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { AmazonSpApiClient, AmazonSpApiError, type AmazonRequestEvent, type AmazonSpApiClientOptions } from "@/lib/amazon/sp-api-client";
import { decryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { extractAmazonInventorySnapshots } from "@/lib/amazon/inventory";
import { extractCatalogPage } from "@/lib/amazon/catalog";
import { withAmazonSyncLock } from "@/lib/operations/sync-lock";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";
import { decryptCheckpoint, encryptCheckpoint } from "./checkpoint";
import { implementedDomain, incrementalFailureCode, officialEndpoint, retryDelay, syncCenterEnabled, SyncInputError, type SyncScope } from "./policy";
import { scopeLock, syncIncrementalCursorStatus } from "./service";
import { canonical, digest, seal, unseal } from "./approval-policy";
import { targetEnvironment } from "./approval-policy";
import { defaultRolePermissionMap, type RolePermissionMap } from "@/lib/accounts/permissions";
import { normalizeRolePermissions } from "@/lib/accounts/role-permissions-utils";

const leaseMs = 5 * 60_000, maxPages = 1000, maxRows = 50000, pagesPerSlice = 5;
export class SyncFenceLost extends Error {}
class SyncPreflightRejected extends Error {}
export function inventoryNextToken(value: unknown) {
  const record = value as { pagination?: { nextToken?: unknown } };
  if (record && record.pagination === undefined) return undefined;
  if (!record || !record.pagination || typeof record.pagination !== "object" || Array.isArray(record.pagination) || (record.pagination.nextToken !== undefined && typeof record.pagination.nextToken !== "string")) throw new Error("分页结构无效。");
  return record.pagination.nextToken?.trim() || undefined;
}
export function sourceTimestamp(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("数据源更新时间无效。");
  return new Date(value);
}
export function validateInventoryPage(value: unknown) {
  const root = value as { payload?: { inventorySummaries?: unknown }; inventorySummaries?: unknown };
  const rows = root?.payload?.inventorySummaries ?? root?.inventorySummaries;
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || typeof row.sellerSku !== "string" || !row.sellerSku.trim())) throw new Error("库存页缺少关键字段；不能发布不完整快照。");
  if (rows.length > 1000) throw new Error("单页超过安全行数限制。");
  const timestamps = new Map<string, Date | null>(), evidence = new Map<string, string>();
  for (const raw of rows as Record<string, unknown>[]) {
    const key = JSON.stringify([String(raw.sellerSku).trim().slice(0, 500), typeof raw.condition === "string" ? raw.condition.trim().slice(0, 500) : ""]);
    const updated = sourceTimestamp(raw.lastUpdatedTime);
    // Validate every row, including duplicates; the legacy extractor keeps only the first.
    const normalized = extractAmazonInventorySnapshots({ inventorySummaries: [raw] })[0];
    const signature = canonical({ ...normalized, sourceUpdatedAt: updated?.toISOString() ?? null });
    if (evidence.has(key) && evidence.get(key) !== signature) throw new Error("库存重复业务键包含冲突数据，不能发布完整快照。");
    evidence.set(key, signature);
    if (String(raw.sellerSku).trim().length > 500 || (typeof raw.condition === "string" && raw.condition.trim().length > 500)) throw new Error("库存业务键超长，不能截断保存。");
    if (!timestamps.has(key)) timestamps.set(key, updated);
  }
  return { rows: extractAmazonInventorySnapshots(value).map(row => ({ ...row, sourceUpdatedAt: timestamps.get(JSON.stringify([row.sellerSku, row.condition])) ?? null })), rawCount: rows.length, nextToken: inventoryNextToken(value) };
}
export function validateCatalogPage(response: unknown, marketplaceId: string) {
  const page = extractCatalogPage(response, marketplaceId);
  const rawItems = (response as { items: Array<{ sku: string; summaries?: unknown }> }).items;
  for (const item of rawItems) {
    if (item.sku.length > 500 || !Array.isArray(item.summaries)) throw new Error("刊登业务键或站点摘要无效。");
    const matches = item.summaries.filter((v: unknown) => v && typeof v === "object" && (v as { marketplaceId?: unknown }).marketplaceId === marketplaceId);
    if (matches.length !== 1) throw new Error("刊登缺少唯一的目标站点摘要。");
    const summary = matches[0] as { asin?: unknown; status?: unknown };
    if (summary.asin !== undefined && typeof summary.asin !== "string") throw new Error("刊登 ASIN 格式无效。");
    if (summary.status !== undefined && (!Array.isArray(summary.status) || summary.status.some((v: unknown) => typeof v !== "string"))) throw new Error("刊登状态格式无效。");
  }
  assertConsistentSnapshotRows(page.items, "catalog");
  return page;
}
export function validateCatalogCompletion(response: unknown, processedCount: number, hasNextPage: boolean) {
  const total = (response as { numberOfResults?: unknown })?.numberOfResults;
  if (total !== undefined && (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0)) throw new Error("刊登结果总数无效。");
  if (!hasNextPage && typeof total === "number" && total > processedCount) throw new Error("刊登搜索结果未覆盖报告总数；不能发布完整快照。");
}
export function classifySyncFailure(error: unknown): { code: string; retryable: boolean; message: string; retryAfterMs: number } {
  if (error instanceof AmazonSpApiError) return { code: error.status === 429 ? "THROTTLE" : error.authorizationRejected ? "AUTH" : error.retryable ? "TRANSIENT" : "API_REJECTED", retryable: error.retryable,
    message: error.status === 429 ? "Amazon 请求限流，按退避策略重试。" : error.authorizationRejected ? "Amazon 授权不可用，请重新验证授权和域权限。" : error.retryable ? "Amazon 网络或服务暂时异常，按检查点重试。" : "Amazon 拒绝请求，请核对授权、参数或过期分页 token；手动重试将从完整快照重新开始。", retryAfterMs: error.retryAfterMs };
  return { code: "VALIDATION_OR_CONFIGURATION", retryable: false, message: "同步配置、响应完整性或检查点校验失败；未发布新快照。请核对数据源及授权后重试。", retryAfterMs: 0 };
}
async function assertActor(run: AmazonSyncRun) {
  if (!await prisma.workspaceScope.findUnique({ where: { organizationId_id: { organizationId: run.organizationId, id: run.workspaceId } }, select: { id: true } })) throw new Error("任务工作区不再可用。");
  const member = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: run.organizationId, userId: run.requestedByUserId } }, include: { user: { select: { status: true } } } });
  if (!member || member.user.status !== "active" || !roleCanPerformAction(member.role, "operations", "create", await getOrganizationRolePermissions(run.organizationId))) throw new Error("任务操作人已停用或不再具备同步权限。");
}
async function assertFence(tx: Prisma.TransactionClient, run: AmazonSyncRun) {
  const current = await tx.amazonSyncRun.findFirst({ where: { id: run.id, executionVersion: 2, status: "RUNNING", fenceVersion: run.fenceVersion, leaseOwner: run.leaseOwner, leaseExpiresAt: { gt: new Date() } } });
  if (!current) throw new SyncFenceLost();
  return current;
}
async function log(tx: Prisma.TransactionClient, run: AmazonSyncRun, event: string, code?: string) {
  await tx.amazonSyncTaskLog.create({ data: { id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event, stage: run.stage, page: run.pagesCompleted, code } });
}
async function assertLiveSource(tx: Prisma.TransactionClient, run: AmazonSyncRun) {
  const scheduled = run.trigger === "schedule";
  if (!scheduled) try { assertExecutionWindow(run.frozenScope); } catch { throw new SyncPreflightRejected("执行授权截止时间已失效。"); }
  const grant = scheduled ? null : await tx.amazonDataCenterChangeRequest.findFirst({ where: { id: run.executionApprovalId ?? "", organizationId: run.organizationId, workspaceId: run.workspaceId, status: "APPLIED", changeType: "SyncExecutionRequest", OR: [{ operation: "run" }, { operation: "control-task", targetId: run.id }], targetEnvironment: targetEnvironment(), sourceIds: { has: run.sourceId ?? "" } } });
  const schedule = scheduled && run.scheduleId && run.scheduleRevision !== null ? await tx.amazonSyncSchedule.findFirst({ where: { organizationId: run.organizationId, workspaceId: run.workspaceId, id: run.scheduleId, resource: run.resource, executionVersion: 2, enabled: true, revision: run.scheduleRevision, planKey: automaticPlanKey(run.sourceId ?? ""), updatedByUserId: run.requestedByUserId, targets: { some: { sourceId: run.sourceId ?? "" } } }, select: { id: true } }) : null;
  const approverMember = grant?.approvedByUserId ? await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: run.organizationId, userId: grant.approvedByUserId } }, include: { user: { select: { status: true } } } }) : null;
  const rolePermissions: RolePermissionMap = { ...defaultRolePermissionMap };
  for (const role of await tx.organizationRosterRole.findMany({ where: { organizationId: run.organizationId }, select: { id: true, permissions: true } })) rolePermissions[role.id] = { ...(rolePermissions[role.id] ?? {}), ...normalizeRolePermissions(role.permissions) };
  const approverStillAuthorized = scheduled ? !!schedule : !!approverMember && approverMember.user.status === "active" && roleCanPerformAction(approverMember.role, "operations", "approve", rolePermissions);
  const actorMember = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: run.organizationId, userId: run.requestedByUserId } }, include: { user: { select: { status: true } } } });
  if (!actorMember || actorMember.user.status !== "active" || !roleCanPerformAction(actorMember.role, "operations", "create", rolePermissions) || (grant?.operation === "control-task" && !roleCanPerformAction(actorMember.role, "operations", "edit", rolePermissions))) throw new SyncPreflightRejected("任务操作人权限已变化。");
  if (scheduled && (!["owner", "database_admin"].includes(actorMember.role) || !roleCanPerformAction(actorMember.role, "operations", "approve", rolePermissions))) throw new SyncPreflightRejected("自动计划管理员权限已变化。");
  const frozen = run.frozenScope as { sourceId?: string; sourceRevision?: number; authorizationId?: string; authorizationRevision?: number; amazonSellerId?: string; sellerAccountId?: string; marketplaceId?: string; resource?: string; region?: string; endpoint?: string; scheduleId?: string; scheduleRevision?: number } | null;
  const frozenDigest = frozen ? digest(frozen) : "";
  if ((scheduled ? !schedule : !grant) || !approverStillAuthorized || !frozen || frozenDigest !== run.frozenScopeDigest || (scheduled && (frozen.scheduleId !== run.scheduleId || frozen.scheduleRevision !== run.scheduleRevision || !isAutomaticResource(run.resource) || !automaticMarketplaceAllowed(run.resource, frozen.marketplaceId ?? "")))) throw new SyncPreflightRejected("执行审批或固定目标范围已失效。");
  const source = await tx.amazonSyncDataSource.findFirst({ where: { id: run.sourceId!, organizationId: run.organizationId, workspaceId: run.workspaceId, ...(!scheduled ? { enabled: true } : {}) }, include: { authorization: true, seller: true } });
  if (!source || !source.enabled || source.id !== frozen.sourceId || source.revision !== frozen.sourceRevision || source.authorizationId !== frozen.authorizationId || source.sellerAccountId !== frozen.sellerAccountId || source.marketplaceId !== frozen.marketplaceId || source.resource !== frozen.resource || source.resource !== run.resource || (!scheduled && source.seller.status !== "active") || source.authorization.status !== "CONFIGURED" || source.authorization.amazonSellerId !== frozen.amazonSellerId || source.authorization.revision !== frozen.authorizationRevision || source.authorization.revision !== run.authorizationRevision) throw new SyncPreflightRejected("数据源或授权在同步期间改变。");
  if (["orders", "finance", "returns", "settlements", "reimbursements", "inventory_age", "inventory_events"].includes(run.resource) && (source.authorization.awsRegion !== frozen.region || source.authorization.endpoint !== frozen.endpoint)) throw new SyncPreflightRejected("授权区域与已批准范围不匹配。");
  try {
    await assertSellerMarketplaceAccess(run, run.requestedByUserId, source.sellerAccountId, source.marketplaceId, tx, "sync", scheduled);
    if (!scheduled) await assertSellerMarketplaceAccess(run, grant!.approvedByUserId!, source.sellerAccountId, source.marketplaceId, tx, "sync");
  } catch { throw new SyncPreflightRejected("任务或审批人的 Seller 授权已撤销。"); }
  if (run.resource === "finance") {
    try {
      const { policy } = await assertFinanceScope(tx, run, source, scheduled ? [run.requestedByUserId] : [run.requestedByUserId, grant!.approvedByUserId!], scheduled);
      const approved = run.frozenScope as { financePolicy?: unknown };
      if (digest(policy) !== digest(parseFinancePolicy(approved.financePolicy))) throw new Error();
    } catch { throw new SyncPreflightRejected("财务角色、卖家级站点集合或审批策略已变化。"); }
  }
  if (run.resource === "returns") {
    try {
      assertReturnRoles(source.authorization, scheduled);
      const p = parseReturnPolicy(source.returnsPolicy);
      if (digest(p) !== digest(parseReturnPolicy((run.frozenScope as { returnsPolicy?: unknown }).returnsPolicy))) throw new Error();
      officialEndpoint(source.authorization.awsRegion, source.authorization.endpoint);
      if (!extractMarketplaceParticipations({ payload: source.authorization.marketplaceParticipations }).some(m => m.marketplaceId === source.marketplaceId)) throw new Error();
    } catch { throw new SyncPreflightRejected("退货角色、站点或冻结策略已变化。"); }
  }
  if (["settlements", "reimbursements", "inventory_age", "inventory_events"].includes(run.resource)) {
    try {
      const resource = run.resource as DomainReportResource;
      const archivePolicy = sellerArchivePolicy(resource, source.domainPolicy);
      const frozenArchive = (run.frozenScope as { sellerArchivePolicy?: unknown }).sellerArchivePolicy;
      if (digest(archivePolicy) !== digest(frozenArchive)) throw new Error();
      if (archivePolicy) { assertSellerArchiveTarget(run, source.marketplaceId); if (!source.authorization.identityVerifiedAt || !["owner", "database_admin"].includes(actorMember.role)) throw new Error(); }
      assertDomainReportRoles(resource, source.authorization, run.trigger === "schedule" || !!archivePolicy);
      if (["settlements", "inventory_events", "reimbursements"].includes(resource)) domainReportRunWindow(resource, (run.frozenScope as { reportWindow?: unknown }).reportWindow);
      if (!extractMarketplaceParticipations({ payload: source.authorization.marketplaceParticipations }).some(m => m.marketplaceId === source.marketplaceId)) throw new Error();
      if (resource === "settlements" && source.settlementPolicy) assertFrozenSettlementScope(await settlementScope(tx, { organizationId: run.organizationId, workspaceId: run.workspaceId }, source, scheduled ? [run.requestedByUserId] : [run.requestedByUserId, grant!.approvedByUserId!]), (run.frozenScope as { settlement?: unknown }).settlement);
      if (resource === "inventory_age" && ["A1F83G8C2ARO7P", "A13V1IB3VIYZZH", "A1PA6795UKMFR9", "APJ6JRA9NG5V4"].includes(source.marketplaceId)) throw new Error();
    } catch { throw new SyncPreflightRejected("报告角色、站点资格或冻结范围已变化。未请求 Amazon。"); }
  }
  if (isObservationResource(run.resource)) {
    try {
      const p = parseObservationPolicy(source.domainPolicy, run.resource);
      assertObservationRoles(p, source.authorization, { organizationId: run.organizationId, workspaceId: run.workspaceId, authorizationId: source.authorizationId, authorizationRevision: source.authorization.revision, marketplaceId: source.marketplaceId, currentEvidence: await continuityEvidence(tx, source) }); assertObservationClosed(p, new Date(), source.marketplaceId);
      const taskPolicy = parseObservationPolicy((run.frozenScope as { domainPolicy?: unknown }).domainPolicy, run.resource);
      if (p.resource === "brand_analytics" && p.collection && taskPolicy.resource === "brand_analytics") assertBrandTaskPolicy(p, taskPolicy);
      else if (digest(p) !== digest(taskPolicy)) throw new Error();
      if (source.authorization.awsRegion !== frozen.region || source.authorization.endpoint !== frozen.endpoint) throw new Error();
      if ((p.resource === "listing_details" || p.resource === "catalog_items") && p.discovery) await assertProductDiscoveryHead(tx, { organizationId: run.organizationId, workspaceId: run.workspaceId }, source, validateProductManifest((run.frozenScope as { productManifest?: unknown }).productManifest, p));
    } catch { throw new SyncPreflightRejected("观察域角色、站点或冻结策略已变化。"); }
  }
  return source;
}
async function stopForControl(tx: Prisma.TransactionClient, run: AmazonSyncRun) {
  const current = await assertFence(tx, run);
  if (!current.control) return false;
  await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: current.control === "CANCEL" ? "CANCELLED" : "PAUSED", control: null, leaseOwner: null, leaseExpiresAt: null, finishedAt: current.control === "CANCEL" ? new Date() : null } });
  await syncIncrementalCursorStatus(tx, run, current.control === "CANCEL" ? "CANCELLED" : "PAUSED");
  await log(tx, run, current.control === "CANCEL" ? "CANCELLED" : "PAUSED");
  return true;
}
type SyncTaskRuntime = { clientOptions?: Pick<AmazonSpApiClientOptions, "fetch" | "now" | "tokenEndpoint" | "reportDownloadTestHost"> };
export async function processSyncCenterTask(runId: string, dispatchVersion: number, runtime: SyncTaskRuntime = {}) {
  const candidate = await prisma.amazonSyncRun.findFirst({ where: { id: runId, executionVersion: 2 } });
  if (!candidate || !syncCenterEnabled(candidate) || candidate.dispatchVersion !== dispatchVersion || !["WAITING", "QUEUED", "RETRY_WAIT"].includes(candidate.status)) return;
  const source = await prisma.amazonSyncDataSource.findFirst({ where: { id: candidate.sourceId!, organizationId: candidate.organizationId, workspaceId: candidate.workspaceId }, include: { authorization: true } });
  if (!source) return;
  // Shared seller + operation lock also serializes requests across marketplaces and task slices.
  await withAmazonSyncLock({ ...candidate, resource: `v2-api:${source.authorization.amazonSellerId}:${candidate.resource}` }, async () => {
    let run: AmazonSyncRun | null;
    try { run = await prisma.$transaction(async tx => {
      await scopeLock(tx, candidate);
      const live = await tx.amazonSyncRun.findUniqueOrThrow({ where: { id: runId } });
      if (live.dispatchVersion !== dispatchVersion || !["WAITING", "QUEUED", "RETRY_WAIT"].includes(live.status) || live.nextAttemptAt > new Date()) return null;
      await assertLiveSource(tx, live);
      const first = live.stage === "WAITING" || live.status === "RETRY_WAIT";
      const updated = await tx.amazonSyncRun.update({ where: { id: runId }, data: { status: "RUNNING", leaseOwner: randomUUID(), fenceVersion: { increment: 1 }, leaseExpiresAt: new Date(Date.now() + leaseMs), attempts: first ? { increment: 1 } : undefined, executionStartedAt: live.executionStartedAt ?? new Date(), authorizationRevision: live.authorizationRevision ?? source.authorization.revision, error: null } });
      await log(tx, updated, first ? "ATTEMPT_STARTED" : "SLICE_RESUMED"); return updated;
    }); } catch (error) {
      if (!(error instanceof SyncPreflightRejected)) throw error;
      await prisma.$transaction(async tx => {
        await scopeLock(tx, candidate);
        const changed = await tx.amazonSyncRun.updateMany({ where: { id: candidate.id, organizationId: candidate.organizationId, workspaceId: candidate.workspaceId, dispatchVersion, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] } }, data: { status: "BLOCKED", error: "执行前审批、权限或冻结范围已变化；未请求 Amazon。", finishedAt: new Date(), dispatchVersion: { increment: 1 } } });
        if (changed.count) { await syncIncrementalCursorStatus(tx, candidate, "BLOCKED"); await log(tx, candidate, "BLOCKED", "PREFLIGHT_REJECTED"); }
      });
      return;
    }
    if (!run) return;
    await executeSlice(run, runtime);
  });
}
async function executeSlice(run: AmazonSyncRun, runtime: SyncTaskRuntime = {}) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  try {
    await assertActor(run);
    const source = await prisma.$transaction(tx => assertLiveSource(tx, run));
    const auth = source.authorization;
    officialEndpoint(auth.awsRegion, auth.endpoint); implementedDomain(run.resource);
    const sites = extractMarketplaceParticipations({ payload: auth.marketplaceParticipations });
    if (!sites.some(s => s.marketplaceId === source.marketplaceId)) throw new Error("站点未验证。");
    const events: AmazonRequestEvent[] = [];
    const client = new AmazonSpApiClient({ ...decryptAmazonSpApiCredentials(auth.credentialsCiphertext, { ...scope, authorizationId: auth.id }), region: auth.awsRegion, endpoint: auth.endpoint }, { ...runtime.clientOptions, ...(["orders", "finance", "returns", "settlements", "reimbursements", "inventory_age", "inventory_events"].includes(run.resource) ? { cacheScope: canonical([scope, auth.id, auth.revision]) } : {}), onResponse: e => events.push(e) });
    if (isObservationResource(run.resource)) { await executeObservationSlice(run, client, events); return; }
    if (run.resource === "returns") { await executeReturnSlice(run, client, events); return; }
    if (["settlements", "reimbursements", "inventory_age", "inventory_events"].includes(run.resource)) { await executeDomainReportSlice(run, client, events); return; }
    if (run.resource === "finance") { await executeFinanceSlice(run, client, events); return; }
    if (run.resource === "orders") { await executeOrderSlice(run, client, events); return; }
    if (run.resource === "catalog" && !auth.amazonSellerId) { await executeReportSlice(run, client, events, auth.id, source.marketplaceId, source.sellerAccountId); return; }
    if (run.resource === "sales_traffic") { await executeReportSlice(run, client, events, auth.id, source.marketplaceId, source.sellerAccountId); return; }
    let token = decryptCheckpoint(run.checkpointCiphertext, scope, run.id);
    const operation = run.resource === "inventory" ? "getInventorySummaries" : "searchListingsItems";
    const budgetKey = { ...scope, authorizationId: auth.id, operation };
    for (let slice = 0; slice < pagesPerSlice; slice++) {
      if (!syncCenterEnabled(scope)) throw new Error("试点开关已关闭。");
      if (await prisma.$transaction(async tx => { await scopeLock(tx, scope); return stopForControl(tx, run); })) return;
      if (run.paginationComplete) break;
      if (run.pagesCompleted >= maxPages) throw new Error("超过分页安全上限。");
      const budget = await prisma.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: budgetKey } });
      const wait = Math.max(0, (budget?.nextRequestAt.getTime() ?? 0) - Date.now());
      // A long budget wait releases the worker slot; it does not busy-poll Amazon.
      if (wait > 5000) { await yieldSlice(run, new Date(Date.now() + wait)); return; }
      if (wait) await delay(wait);
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        if (await stopForControl(tx, run)) throw new SyncFenceLost();
      });
      const pageTokenHash = createHash("sha256").update(token ?? "FIRST_PAGE").digest("hex");
      if (await prisma.amazonSyncPage.findUnique({ where: { taskId_tokenHash: { taskId: run.id, tokenHash: pageTokenHash } } })) throw new Error("分页 token 循环。");
      events.length = 0;
      let response: unknown;
      try { response = run.resource === "inventory" ? await client.getInventorySummaries({ marketplaceId: source.marketplaceId, nextToken: token }) : await client.searchListingsItems({ sellerId: auth.amazonSellerId, marketplaceId: source.marketplaceId, nextToken: token }); }
      catch (error) { await persistRequests(run, events, budgetKey, error); throw error; }
      await persistRequests(run, events, budgetKey);
      let rows: Array<Prisma.AmazonInventorySnapshotCreateManyInput | Prisma.AmazonCatalogSnapshotCreateManyInput>, nextToken: string | undefined, rawCount: number;
      const capturedAt = new Date();
      if (run.resource === "inventory") {
        const page = validateInventoryPage(response); nextToken = page.nextToken; rawCount = page.rawCount;
        rows = page.rows.map(item => ({ id: createHash("sha256").update(JSON.stringify([run.id, item.sellerSku, item.condition])).digest("hex"), ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, syncRunId: run.id, ...item, capturedAt }));
      } else {
        const pagination = (response as { pagination?: unknown })?.pagination;
        if (pagination !== undefined && (!pagination || typeof pagination !== "object" || Array.isArray(pagination) || ("nextToken" in pagination && pagination.nextToken !== undefined && typeof pagination.nextToken !== "string"))) throw new Error("刊登分页结构无效。");
        const page = validateCatalogPage(response, source.marketplaceId); nextToken = page.nextToken?.trim() || undefined; rawCount = page.items.length;
        validateCatalogCompletion(response, run.processedCount + rawCount, !!nextToken);
        if (rawCount > 1000) throw new Error("单页超过安全行数限制。");
        const rawItems = (response as { items: { summaries?: { marketplaceId?: string; lastUpdatedDate?: unknown }[] }[] }).items;
        rows = page.items.map((item, index) => ({ sourceUpdatedAt: sourceTimestamp(rawItems[index].summaries?.find(summary => summary.marketplaceId === source.marketplaceId)?.lastUpdatedDate), id: createHash("sha256").update(JSON.stringify([run.id, item.sellerSku])).digest("hex"), ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, sourceRunId: run.id, ...item, fieldSources: { sellerSku: "Listings Items API", asin: "Listings Items API", listingStatus: "Listings Items API", fulfillmentType: "Listings Items API" }, capturedAt }));
      }
      if (run.processedCount + rawCount > maxRows) throw new Error("超过总行数安全上限。");
      const checkpointCiphertext = encryptCheckpoint(nextToken, scope, run.id);
      const updated = await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        if (await stopForControl(tx, run)) return null;
        // Identical overlapping pages deduplicate; conflicting observations cannot masquerade as complete.
        const previous = run.resource === "inventory"
          ? await tx.amazonInventorySnapshot.findMany({ where: { ...scope, syncRunId: run.id, sellerSku: { in: rows.map(row => row.sellerSku) } } })
          : await tx.amazonCatalogSnapshot.findMany({ where: { ...scope, sourceRunId: run.id, sellerSku: { in: rows.map(row => row.sellerSku) } } });
        assertConsistentSnapshotRows([...previous, ...rows], run.resource);
        // Staged rows remain invisible until this task becomes the source's published head.
        const inserted = run.resource === "inventory" ? await tx.amazonInventorySnapshot.createMany({ data: rows as Prisma.AmazonInventorySnapshotCreateManyInput[], skipDuplicates: true }) : await tx.amazonCatalogSnapshot.createMany({ data: rows as Prisma.AmazonCatalogSnapshotCreateManyInput[], skipDuplicates: true });
        await tx.amazonSyncPage.create({ data: { ...scope, taskId: run.id, page: run.pagesCompleted + 1, tokenHash: pageTokenHash, rowCount: rawCount } });
        const result = await tx.amazonSyncRun.update({ where: { id: run.id }, data: { pagesCompleted: { increment: 1 }, processedCount: { increment: rawCount }, insertedCount: { increment: inserted.count }, skippedCount: { increment: rawCount - inserted.count }, paginationComplete: !nextToken, checkpointCiphertext, stage: nextToken ? "FETCHING" : "VALIDATING", leaseExpiresAt: new Date(Date.now() + leaseMs) } });
        await log(tx, result, "PAGE_COMMITTED"); return result;
      });
      if (!updated) return;
      Object.assign(run, updated); token = nextToken;
    }
    if (run.paginationComplete) await publish(run); else await yieldSlice(run);
  } catch (error) {
    if (error instanceof SyncFenceLost) return;
    const failure = ["orders", "finance", "returns", "settlements", "reimbursements", "inventory_age", "inventory_events"].includes(run.resource) && error instanceof SyncInputError
      ? { code: incrementalFailureCode(run.resource, error.status), retryable: false, message: error.message, retryAfterMs: 0 }
      : classifySyncFailure(error);
    if (["orders", "finance", "returns", "settlements", "reimbursements", "inventory_age", "inventory_events"].includes(run.resource) && !(error instanceof SyncInputError)) failure.message = failure.retryable
      ? "增量请求暂时失败，按退避策略从已提交游标继续。"
      : "增量请求或响应校验失败；已保留提交页和游标，请核对参数、授权及分页有效期后重新申请。";
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope);
      try { await assertFence(tx, run); } catch (e) { if (e instanceof SyncFenceLost) return; throw e; }
      if (await stopForControl(tx, run)) return;
      if (failure.code === "AUTH" && run.sourceId) {
        const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: run.sourceId }, select: { authorizationId: true } });
        if (source) {
          const changed = await tx.amazonSpApiAuthorization.updateMany({ where: { ...scope, id: source.authorizationId, revision: run.authorizationRevision ?? -1, status: "CONFIGURED" }, data: { status: "ERROR", validationAttemptedAt: new Date(), validationErrorCode: "AUTH_REJECTED" } });
          if (changed.count) await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: run.requestedByUserId, action: "amazon.sync.authorization.rejected", entityType: "AmazonSpApiAuthorization", entityId: source.authorizationId, metadata: { workspaceId: scope.workspaceId, runId: run.id, reason: "AUTH_REJECTED" } } });
        }
      }
      const retry = failure.retryable && run.attempts < run.maxAttempts;
      if (failure.retryable && !retry) failure.message = "本轮自动重试次数已用尽；已保留原件、已提交页及游标。须审阅失败原因并通过审批重试，不会自动从头采集。";
      await syncIncrementalCursorStatus(tx, run, retry ? "RETRY_WAIT" : "FAILED");
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: retry ? "RETRY_WAIT" : "FAILED", error: failure.message, failedCount: { increment: 1 }, finishedAt: retry ? null : new Date(), nextAttemptAt: new Date(Date.now() + retryDelay(run.attempts, failure.retryAfterMs)), leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
      await log(tx, run, retry ? "RETRY_SCHEDULED" : "FAILED", failure.code);
    });
  }
}
async function persistRequests(run: AmazonSyncRun, events: AmazonRequestEvent[], key: SyncScope & { authorizationId: string; operation: string }, error?: unknown) {
  await prisma.$transaction(async tx => {
    await scopeLock(tx, { organizationId: run.organizationId, workspaceId: run.workspaceId });
    await assertFence(tx, run); await assertLiveSource(tx, run);
    const logs = events.map(e => ({ id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event: e.operation, stage: "REQUEST", statusCode: e.status, requestId: e.requestId, rateLimit: e.rateLimit, code: ["settlements", "reimbursements", "inventory_events"].includes(run.resource) && e.operation === key.operation && error instanceof AmazonSpApiError && e.status === error.status ? error.upstreamCode : null }));
    if (error && !events.length) logs.push({ id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event: key.operation, stage: "REQUEST", statusCode: null, requestId: null, rateLimit: null, code: null });
    if (error instanceof AmazonSpApiError && ["REPORT_DOWNLOAD_TIMEOUT", "REPORT_DOWNLOAD_TRANSPORT"].includes(error.upstreamCode ?? "")) logs.push({ id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event: "downloadReportDocument", stage: "DOWNLOAD", statusCode: null, requestId: null, rateLimit: null, code: error.upstreamCode });
    if (run.resource === "settlements" && error instanceof AmazonSpApiError && error.downloadedBytes !== null) logs.push({ id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event: "REPORT_DOWNLOAD_PROGRESS", stage: "DOWNLOAD", statusCode: null, requestId: null, rateLimit: null, code: "RECEIVED_BYTES_" + error.downloadedBytes });
    if (logs.length) await tx.amazonSyncTaskLog.createMany({ data: logs });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { apiRequests: { increment: logs.length }, throttles: { increment: events.filter(e => e.status === 429).length }, leaseExpiresAt: new Date(Date.now() + leaseMs) } });
    const limitEvent = [...events].reverse().find(e => e.operation === key.operation && e.rateLimit), observed = limitEvent ? Number(limitEvent.rateLimit) : undefined;
    const existing = await tx.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: key } });
    const limit = observed && Number.isFinite(observed) ? observed : existing?.observedLimit;
    const throttled = error instanceof AmazonSpApiError && error.status === 429;
    const interval = Math.max(key.operation === "createReport" ? 100_000 : key.operation === "getReport" ? 60_000 : 1000, limit && limit > 0 ? 1000 / limit : 1000, throttled ? retryDelay(run.attempts, error.retryAfterMs) : 0);
    const nextRequestAt = new Date(Date.now() + Math.min(interval, 60 * 60_000));
    await tx.amazonSyncApiBudget.upsert({ where: { organizationId_workspaceId_authorizationId_operation: key }, create: { ...key, nextRequestAt, observedLimit: limit }, update: { nextRequestAt, observedLimit: limit } });
  });
}
async function yieldSlice(run: AmazonSyncRun, nextAttemptAt = new Date()) {
  await prisma.$transaction(async tx => {
    await scopeLock(tx, run); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return;
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "WAITING", stage: ["sales_traffic", "orders", "finance", "returns"].includes(run.resource) ? run.stage : run.paginationComplete ? "VALIDATING" : "FETCHING", leaseOwner: null, leaseExpiresAt: null, nextAttemptAt, dispatchVersion: { increment: 1 } } });
  });
}
async function publish(run: AmazonSyncRun) {
  await assertActor(run);
  await prisma.$transaction(async tx => {
    await scopeLock(tx, run); await assertFence(tx, run); const source = await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return;
    if (!syncCenterEnabled(run) || !run.paginationComplete || !run.pagesCompleted) throw new Error("未完整抓取全部页。");
    const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
    const pageCount = await tx.amazonSyncPage.count({ where: { ...scope, taskId: run.id } });
    const rowCount = run.resource === "inventory" ? await tx.amazonInventorySnapshot.count({ where: { ...scope, syncRunId: run.id } }) : await tx.amazonCatalogSnapshot.count({ where: { ...scope, sourceRunId: run.id } });
    if (pageCount !== run.pagesCompleted || rowCount !== run.insertedCount || rowCount + run.skippedCount !== run.processedCount) throw new Error("分页和记录数量不一致。");
    const finishedAt = new Date();
    const coverage = { type: "complete_snapshot", capturedFrom: run.executionStartedAt!.toISOString(), capturedTo: finishedAt.toISOString(), paginationComplete: true, rowCount, validationVersion: "amazon-sync.v1", sourceUpdatedAt: null };
    await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: finishedAt, rowCount, coverage } });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", stage: "COMPLETED", finishedAt, leaseOwner: null, leaseExpiresAt: null, checkpointCiphertext: null, summary: { provider: "amazon_sp_api", executionVersion: 2, coverage, snapshotCount: rowCount, outcomes: [{ sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, count: rowCount }] } } });
    await log(tx, run, "PUBLISHED");
  });
}

/** One bounded Reports operation per slice. Report identity is durable before polling. */
export async function executeReportSlice(run: AmazonSyncRun, client: AmazonSpApiClient, events: AmazonRequestEvent[], authorizationId: string, marketplaceId: string, sellerAccountId: string) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const listing = run.resource === "catalog";
  const range = listing ? undefined : rangeFromFrozen(run.frozenScope);
  const checkpoint = decryptCheckpoint(run.checkpointCiphertext, scope, run.id);
  const state = checkpoint ? JSON.parse(checkpoint) as { creating?: boolean; reportId?: string; documentId?: string; requestedAt?: string } : {};
  if (run.trigger !== "schedule" && run.executionStartedAt && Date.now() - run.executionStartedAt.getTime() > 24 * 60 * 60_000) throw new Error("报告等待超过 24 小时，需重新审批。");
  if (state.creating && !state.reportId) throw new Error("报告申请结果不确定，禁止自动重复申请；需人工核查后批准重试。");
  const operation = !state.reportId ? "createReport" : !state.documentId ? "getReport" : "getReportDocument";
  const budgetKey = { ...scope, authorizationId, operation };
  const budget = await prisma.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: budgetKey } });
  if (budget && budget.nextRequestAt > new Date()) { await yieldSlice(run, budget.nextRequestAt); return; }
  await assertActor(run);
  if (await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertLiveSource(tx, run); return stopForControl(tx, run); })) return;
  const saveState = async (stage: string) => {
    const updated = await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      return tx.amazonSyncRun.update({ where: { id: run.id }, data: { stage, checkpointCiphertext: encryptCheckpoint(JSON.stringify(state), scope, run.id), leaseExpiresAt: new Date(Date.now() + leaseMs) } });
    });
    Object.assign(run, updated);
  };
  let response: unknown;
  if (!state.reportId) {
    state.creating = true; state.requestedAt = new Date().toISOString(); await saveState("REPORT_CREATING");
    try { response = listing ? await client.createAllListingsReport(marketplaceId) : await client.createSalesTrafficReport({ marketplaceId, ...range! }); }
    catch (error) {
      await persistRequests(run, events, budgetKey, error);
      // A 429 is an explicit rejection; other failures may have created a remote report.
      if (error instanceof AmazonSpApiError && error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 408) { state.creating = false; await saveState(error.status === 429 ? "REPORT_REQUEST_WAIT" : "REPORT_REQUEST_REJECTED"); throw error; }
      throw new Error("报告申请结果不确定，禁止自动重放。");
    }
    await persistRequests(run, events, budgetKey);
    const reportId = (response as { reportId?: unknown } | null)?.reportId;
    if (typeof reportId !== "string" || !reportId || reportId.length > 200) throw new Error("报告 ID 无效。");
    state.reportId = reportId; state.creating = false; await saveState("REPORT_POLLING");
    await yieldSlice(run, new Date(Date.now() + 60_000)); return;
  }
  try {
    response = state.documentId ? await client.getReportDocument(state.documentId) : await client.getReport(state.reportId);
  } catch (error) { await persistRequests(run, events, budgetKey, error); throw error; }
  await persistRequests(run, events, budgetKey);
  if (!state.documentId) {
    const report = response as { reportId?: unknown; reportType?: unknown; marketplaceIds?: unknown; processingStatus?: unknown; reportDocumentId?: unknown };
    if (report.reportId !== state.reportId || report.reportType !== (listing ? allListingsReportType : salesTrafficReportType) || !Array.isArray(report.marketplaceIds) || report.marketplaceIds.length !== 1 || report.marketplaceIds[0] !== marketplaceId) throw new Error("报告身份与任务不一致。");
    if (["CANCELLED", "FATAL"].includes(String(report.processingStatus))) throw new Error("Amazon 报告生成失败或取消。");
    if (["IN_QUEUE", "IN_PROGRESS"].includes(String(report.processingStatus))) { await yieldSlice(run, new Date(Date.now() + 60_000)); return; }
    if (report.processingStatus !== "DONE" || typeof report.reportDocumentId !== "string" || !report.reportDocumentId || report.reportDocumentId.length > 200) throw new Error("报告状态或文档 ID 无效。");
    state.documentId = report.reportDocumentId; await saveState("REPORT_DOWNLOADING");
    await yieldSlice(run); return;
  }
  if ((response as { reportDocumentId?: unknown } | null)?.reportDocumentId !== state.documentId) throw new Error("报告文档身份不匹配。");
  events.length = 0;
  let document: unknown;
  try { document = listing ? await client.downloadReportText(response) : await client.downloadReportDocument(response); }
  catch (error) { await persistRequests(run, events, { ...budgetKey, operation: "downloadReportDocument" }, error); throw error; }
  await persistRequests(run, events, { ...budgetKey, operation: "downloadReportDocument" });
  if (listing) {
    if (typeof document !== "string") throw new SyncInputError("Listing 报告格式无效。");
    await publishAllListings(run, document, state.reportId!, state.documentId!, sellerAccountId, marketplaceId);
    return;
  }
  const result = parseSalesTraffic(document, range!, marketplaceId), capturedAt = new Date();
  await assertActor(run);
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); const source = await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return;
    await tx.amazonSalesTrafficSnapshot.createMany({ data: result.rows.map(row => ({ id: createHash("sha256").update(JSON.stringify([run.id, row.businessDate])).digest("hex"), ...scope, sourceId: source.id, syncRunId: run.id, sellerAccountId, marketplaceId, reportId: state.reportId!, documentId: state.documentId!, ...row, capturedAt })) });
    const coverage = { type: "report_business_dates", requestedRange: range, actualFrom: result.rows.map(r => r.businessDate).sort()[0] ?? null, actualTo: result.rows.map(r => r.businessDate).sort().at(-1) ?? null, missingDates: result.missingDates, complete: result.complete, periodClosed: range!.periodClosed, quality: result.complete ? "VALID" : "INCOMPLETE", sourceApi: "Reports 2021-06-30", reportType: salesTrafficReportType, reportId: state.reportId!, documentId: state.documentId!, fetchedAt: capturedAt.toISOString(), transformed: true, granularity: "SELLER_DAY", rowCount: result.rows.length };
    // Partial reports retain evidence but cannot replace a previously valid published version.
    if (result.complete) await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: capturedAt, rowCount: result.rows.length, coverage } });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: result.complete ? "SUCCEEDED" : "PARTIAL_SUCCESS", stage: result.complete ? "COMPLETED" : "QUALITY_FAILED", pagesCompleted: 1, paginationComplete: true, processedCount: result.rows.length, insertedCount: result.rows.length, finishedAt: capturedAt, leaseOwner: null, leaseExpiresAt: null, checkpointCiphertext: null, summary: { provider: "amazon_sp_api", executionVersion: 2, coverage, publishedAt: result.complete ? capturedAt.toISOString() : null }, error: result.complete ? null : !range!.periodClosed ? "业务日期尚未闭合；保留报告证据，未发布为完整数据。" : "报告缺日或缺少字段；保留当前有效版本，未发布本次结果。" } });
    await log(tx, run, result.complete ? "PUBLISHED" : "QUALITY_REJECTED");
  });
}

async function publishAllListings(run: AmazonSyncRun, text: string, reportId: string, documentId: string, sellerAccountId: string, marketplaceId: string) {
  const rows = parseAllListingsReport(text), capturedAt = new Date();
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  await assertActor(run);
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); const source = await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return;
    const coverage = { type: "complete_snapshot", sourceApi: "Reports 2021-06-30", reportType: allListingsReportType, reportId, documentId, rowCount: rows.length, paginationComplete: true, capturedTo: capturedAt.toISOString(), historicalSnapshot: false };
    const bodySha256 = digest(text);
    await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page: 1, resource: "catalog", requestMetadata: { reportType: allListingsReportType, reportId, documentId, marketplaceId }, rawCiphertext: seal({ rawText: text }, scope, `${run.id}:1`, "amazon-catalog-report-raw.v1"), bodySha256, capturedAt } });
    await tx.amazonSyncPage.create({ data: { ...scope, taskId: run.id, tokenHash: digest([reportId, documentId]), page: 1, rowCount: rows.length } });
    for (let i = 0; i < rows.length; i += 500) {
      await tx.amazonCatalogSnapshot.createMany({ data: rows.slice(i, i + 500).map(row => ({ ...scope, id: digest([run.id, row.sellerSku]), sellerAccountId, marketplaceId, sourceRunId: run.id, ...row, capturedAt, sourceUpdatedAt: null, fieldSources: { sellerSku: allListingsReportType, asin: allListingsReportType, listingStatus: allListingsReportType, fulfillmentType: allListingsReportType, ...(row.listingAttributes ? { listingAttributes: allListingsReportType } : {}) } })) });
    }
    await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: capturedAt, rowCount: rows.length, coverage } });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", stage: "COMPLETED", pagesCompleted: 1, paginationComplete: true, processedCount: rows.length, insertedCount: rows.length, finishedAt: capturedAt, leaseOwner: null, leaseExpiresAt: null, checkpointCiphertext: null, summary: { provider: "amazon_sp_api", executionVersion: 2, coverage, snapshotCount: rows.length } } });
    await log(tx, run, "PUBLISHED");
  }, { timeout: 30000 });
}

/** Orders 2026-01-01: one page per slice. No worker sleeps and no automatic
 * historical sweep. HTTP remains in the existing SP-API client. The cursor,
 * business upserts and encrypted replay evidence share one transaction.
 * https://developer-docs.amazon.com/sp-api/reference/searchorders
 */
export async function executeOrderSlice(run: AmazonSyncRun, client: AmazonSpApiClient, events: AmazonRequestEvent[], now: () => Date = () => new Date()) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  await assertActor(run);
  const source = await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run);
    return assertLiveSource(tx, run);
  });
  const policy = parseOrderSyncPolicy(source.orderPolicy), auth = source.authorization;
  officialEndpoint(auth.awsRegion, auth.endpoint);
  assertOrderRoles(auth, policy, run.trigger === "schedule", { ...scope, authorizationId: auth.id, authorizationRevision: auth.revision, marketplaceId: source.marketplaceId, currentEvidence: await continuityEvidence(prisma, source) });
  const sites = extractMarketplaceParticipations({ payload: auth.marketplaceParticipations });
  if (!sites.some(site => site.marketplaceId === source.marketplaceId)) throw new SyncPreflightRejected("订单站点未验证。");
  const window = orderWindowFromFrozen((run.frozenScope as { orderWindow?: unknown } | null)?.orderWindow);
  const frozenPolicy = (run.frozenScope as { orderPolicy?: unknown } | null)?.orderPolicy;
  if ((frozenPolicy !== undefined && digest(parseOrderSyncPolicy(frozenPolicy)) !== digest(policy)) || (policy.details && frozenPolicy === undefined)) throw new SyncPreflightRejected("订单详情策略不在已批准执行范围内。");
  const detailPolicyDigest = policy.details ? digest(policy.details) : null;
  const bucketKey = orderBucketKey(auth.amazonSellerId, policy.applicationId);
  const prepared = await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return null;
    let cursor = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: source.id } });
    if (cursor && (cursor.organizationId !== scope.organizationId || cursor.workspaceId !== scope.workspaceId || cursor.amazonSellerId !== auth.amazonSellerId || cursor.marketplaceId !== source.marketplaceId || cursor.resource !== "orders")) throw new SyncPreflightRejected("订单游标与卖家绑定不匹配。");
    if (cursor && cursor.status !== "SUCCEEDED" && (cursor.watermarkFrom.toISOString() !== window.from || cursor.watermarkTo.toISOString() !== window.to)) throw new SyncPreflightRejected("订单窗口与未完成游标不匹配。");
    if (cursor?.status === "SUCCEEDED" && cursor.activeRunId === run.id) return { complete: true as const, cursor };
    const starting = !cursor || cursor.status === "SUCCEEDED";
    if (!starting && cursor?.detailPolicyDigest !== detailPolicyDigest) throw new SyncPreflightRejected("未完成窗口的详情策略发生变化。");
    if (cursor && cursor.status === "SUCCEEDED" && Date.parse(window.to) <= cursor.watermarkTo.getTime()) throw new SyncPreflightRejected("订单窗口已被其他任务完成，请重新申请。");
    cursor = await tx.amazonSyncResourceCursor.upsert({ where: { sourceId: source.id }, create: { ...scope, id: randomUUID(), sourceId: source.id, resource: "orders", amazonSellerId: auth.amazonSellerId, marketplaceId: source.marketplaceId, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), activeRunId: run.id, status: "RUNNING", detailPolicyDigest }, update: { activeRunId: run.id, status: "RUNNING", ...(starting ? { watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), nextTokenCiphertext: null, listComplete: false, detailPolicyDigest } : {}) } });
    if (starting && policy.details?.backfillExisting) {
      const previous = await tx.amazonOrderRecord.findMany({ where: { ...scope, sourceId: source.id, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, sourceUpdatedAt: { lte: new Date(window.to) }, OR: [{ detailPolicyDigest: null }, { detailPolicyDigest: { not: detailPolicyDigest! } }, { detailsUpdatedAt: null }] }, orderBy: [{ sourceUpdatedAt: "desc" }, { id: "asc" }], take: policy.details.maxOrders, select: { id: true, amazonOrderId: true, sourceUpdatedAt: true } });
      if (previous.length) await tx.amazonOrderDetailWork.createMany({ data: previous.map(row => {
        const key = { sourceId: source.id, amazonOrderId: row.amazonOrderId, listedUpdatedAt: row.sourceUpdatedAt, policyDigest: detailPolicyDigest! };
        return { id: digest(key), ...scope, ...key, orderRecordId: row.id, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), status: "PENDING" };
      }), skipDuplicates: true });
    }
    if (policy.details) {
      const work = await tx.amazonOrderDetailWork.findFirst({ where: { ...scope, sourceId: source.id, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), policyDigest: detailPolicyDigest!, status: "PENDING" }, orderBy: [{ listedUpdatedAt: "asc" }, { id: "asc" }] });
      if (work || cursor.listComplete) return { complete: false as const, cursor, work };
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bucketKey}, 0))`;
    const bucket = await tx.amazonSyncTokenBucket.findUnique({ where: { bucketKey } });
    if (!await continuityOrderTurn(tx, source, run.id)) { const budget = reserveOrderToken(bucket, policy, now()); return { complete: false as const, cursor, reservation: { allowed: false, nextAt: new Date(Math.max(now().getTime() + 5000, budget.nextAt.getTime())) } }; }
    const reservation = reserveOrderToken(bucket, policy, now());
    await tx.amazonSyncTokenBucket.upsert({ where: { bucketKey }, create: { bucketKey, tokens: reservation.tokens, replenishedAt: reservation.replenishedAt }, update: { tokens: reservation.tokens, replenishedAt: reservation.replenishedAt } });
    return { complete: false as const, cursor, reservation };
  });
  if (!prepared) return;
  if (prepared.complete) return;
  if ("work" in prepared) { await executeOrderDetailSlice(run, source, policy, window, prepared.cursor, prepared.work ?? null, client, events, now); return; }
  if (!prepared.reservation.allowed) { await yieldSlice(run, prepared.reservation.nextAt); return; }
  const token = decryptCheckpoint(prepared.cursor.nextTokenCiphertext, scope, prepared.cursor.id);
  const tokenHash = digest([window, token ?? null]);
  if (await prisma.amazonSyncPage.findUnique({ where: { taskId_tokenHash: { taskId: run.id, tokenHash } } })) throw new Error("订单分页 token 循环。");
  events.length = 0;
  let response: Awaited<ReturnType<AmazonSpApiClient["searchOrders"]>>;
  try {
    // Recheck authorization immediately before any HTTP, including the LWA refresh.
    await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run); });
    response = await client.searchOrders({ marketplaceId: source.marketplaceId, lastUpdatedAfter: window.from, lastUpdatedBefore: window.to, paginationToken: token });
  } catch (error) {
    await persistOrderRequests(run, events, bucketKey, policy.requestsPerSecond, now(), error);
    throw error;
  }
  await persistOrderRequests(run, events, bucketKey, policy.requestsPerSecond, now());
  const page = parseOrderPage(response.body, source.marketplaceId, policy, window);
  if (page.orders.length > 100 || run.pagesCompleted >= maxPages || run.processedCount + page.orders.length > maxRows) throw new Error("订单窗口超过安全容量，请缩小窗口并重新审批。");
  if (page.nextToken && digest([window, page.nextToken]) === tokenHash) throw new Error("订单分页 token 循环。");
  const capturedAt = now(), pageNumber = run.pagesCompleted + 1;
  const rawCiphertext = seal({ rawBody: response.rawBody }, scope, `${run.id}:${pageNumber}`, "amazon-orders-raw.v1");
  await assertActor(run);
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return;
    const currentCursor = await tx.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: source.id } });
    if (currentCursor.activeRunId !== run.id || currentCursor.nextTokenCiphertext !== prepared.cursor.nextTokenCiphertext) throw new SyncFenceLost();
    let inserted = 0, updated = 0, skipped = 0;
    for (const row of page.orders) {
      const key = { ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, amazonOrderId: row.amazonOrderId };
      const existing = await tx.amazonOrderRecord.findUnique({ where: { organizationId_workspaceId_sellerAccountId_marketplaceId_amazonOrderId: key } });
      if (existing && existing.sourceUpdatedAt.getTime() === row.sourceUpdatedAt.getTime() && (existing.rawStatus !== row.rawStatus || existing.createdTime.getTime() !== row.createdTime.getTime())) throw new SyncInputError("同一订单版本出现冲突数据，已保留游标并阻止提交。");
      if (existing && existing.sourceId !== source.id) throw new SyncInputError("订单事实不属于当前数据源，禁止跨绑定覆盖。");
      const skip = existing && (existing.sourceUpdatedAt > row.sourceUpdatedAt || (existing.sourceUpdatedAt.getTime() === row.sourceUpdatedAt.getTime() && existing.rawStatus === row.rawStatus && existing.normalizedStatus === row.normalizedStatus));
      const data = { ...scope, sourceId: source.id, sourceRunId: run.id, sellerAccountId: source.sellerAccountId, amazonSellerId: auth.amazonSellerId, marketplaceTimeZone: policy.marketplaceTimeZone, ...row, capturedAt };
      if (skip) skipped++;
      else {
        await tx.amazonOrderRecord.upsert({ where: { organizationId_workspaceId_sellerAccountId_marketplaceId_amazonOrderId: key }, create: { id: digest(key), ...data }, update: data });
        if (existing) updated++; else inserted++;
      }
      if (policy.details && (!existing || existing.sourceUpdatedAt <= row.sourceUpdatedAt) && !(existing?.detailsUpdatedAt && existing.detailsUpdatedAt >= row.sourceUpdatedAt && existing.detailPolicyDigest === detailPolicyDigest)) {
        const workKey = { sourceId: source.id, amazonOrderId: row.amazonOrderId, listedUpdatedAt: row.sourceUpdatedAt, policyDigest: detailPolicyDigest! };
        await tx.amazonOrderDetailWork.upsert({ where: { sourceId_amazonOrderId_listedUpdatedAt_policyDigest: workKey }, create: { id: digest(workKey), ...scope, ...workKey, orderRecordId: existing?.id ?? digest(key), watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to) }, update: {} });
      }
    }
    const workWhere = { ...scope, sourceId: source.id, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), policyDigest: detailPolicyDigest ?? "" };
    if (policy.details && await tx.amazonOrderDetailWork.count({ where: workWhere }) > policy.details.maxOrders) throw new SyncInputError("订单详情超过本窗口批准的订单预算，未提交当前页。");
    await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page: pageNumber, resource: "orders", requestMetadata: { apiVersion: "2026-01-01", operation: "searchOrders", method: "GET", path: "/orders/2026-01-01/orders", marketplaceId: source.marketplaceId, window, pageTokenHash: tokenHash, requestId: events.findLast(e => e.operation === "searchOrders")?.requestId ?? null }, rawCiphertext, bodySha256: createHash("sha256").update(response.rawBody).digest("hex"), capturedAt } });
    await tx.amazonSyncPage.create({ data: { ...scope, taskId: run.id, page: pageNumber, tokenHash, rowCount: page.orders.length } });
    const pending = policy.details ? await tx.amazonOrderDetailWork.count({ where: { ...workWhere, status: "PENDING" } }) : 0;
    const complete = !page.nextToken && !pending;
    await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { listComplete: !page.nextToken, nextTokenCiphertext: encryptCheckpoint(page.nextToken, scope, prepared.cursor.id), status: complete ? "SUCCEEDED" : "RUNNING", ...(complete ? { lastSuccessAt: capturedAt } : {}) } });
    const coverage = { type: "incremental_window", apiVersion: "2026-01-01", window, complete, listComplete: !page.nextToken, detailsEnabled: !!policy.details, detailsComplete: !!policy.details && complete, pendingDetails: pending, piiCollected: null, factsContainPii: false, rawMayContainPii: true, rowCount: await tx.amazonOrderRecord.count({ where: { ...scope, sourceId: source.id } }) };
    if (complete) await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: capturedAt, rowCount: coverage.rowCount, coverage } });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: complete ? "SUCCEEDED" : "WAITING", stage: complete ? "COMPLETED" : pending ? "FETCHING_DETAILS" : "FETCHING", pagesCompleted: { increment: 1 }, processedCount: { increment: page.orders.length }, insertedCount: { increment: inserted }, updatedCount: { increment: updated }, skippedCount: { increment: skipped }, paginationComplete: !page.nextToken, checkpointCiphertext: encryptCheckpoint(page.nextToken, scope, run.id), summary: { coverage }, finishedAt: complete ? capturedAt : null, nextAttemptAt: capturedAt, leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
    await log(tx, run, complete ? "ORDER_WINDOW_COMPLETED" : "ORDER_PAGE_COMMITTED");
  });
}

/** Orders v2026-01-01 getOrder: exactly one durable work item per slice.
 * https://developer-docs.amazon.com/sp-api/reference/getorder-3
 * https://developer-docs.amazon.com/sp-api/docs/access-orders-pii
 * LWA/approved roles, no RDT. PII is never placed in logs or query projections.
 */
async function executeOrderDetailSlice(run: AmazonSyncRun, source: Awaited<ReturnType<typeof assertLiveSource>>, policy: OrderSyncPolicy, window: OrderWindow, cursor: AmazonSyncResourceCursor, work: AmazonOrderDetailWork | null, client: AmazonSpApiClient, events: AmazonRequestEvent[], now: () => Date) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const details = policy.details!;
  const bucketKey = orderBucketKey(source.authorization.amazonSellerId, policy.applicationId, "getOrder");
  let response: Awaited<ReturnType<AmazonSpApiClient["getOrder"]>> | null = null;
  if (work) {
    const reservation = await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run);
      const live = await assertLiveSource(tx, run); assertOrderRoles(live.authorization, policy, false, { ...scope, authorizationId: live.authorizationId, authorizationRevision: live.authorization.revision, marketplaceId: live.marketplaceId, currentEvidence: await continuityEvidence(tx, live) });
      if (await stopForControl(tx, run)) return null;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bucketKey}, 0))`;
      if (await continuityProbeDue(tx, live)) return { allowed: false, nextAt: new Date(now().getTime() + 5000) };
      const bucket = await tx.amazonSyncTokenBucket.findUnique({ where: { bucketKey } });
      const result = reserveOrderToken(bucket, details, now());
      await tx.amazonSyncTokenBucket.upsert({ where: { bucketKey }, create: { bucketKey, tokens: result.tokens, replenishedAt: result.replenishedAt }, update: { tokens: result.tokens, replenishedAt: result.replenishedAt } });
      return result;
    });
    if (!reservation) return;
    if (!reservation.allowed) { await yieldSlice(run, reservation.nextAt); return; }
    events.length = 0;
    try {
      await assertActor(run);
      await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); const live = await assertLiveSource(tx, run); assertOrderRoles(live.authorization, policy, false, { ...scope, authorizationId: live.authorizationId, authorizationRevision: live.authorization.revision, marketplaceId: live.marketplaceId, currentEvidence: await continuityEvidence(tx, live) }); });
      response = await client.getOrder({ orderId: work.amazonOrderId, includedData: details.includedData });
    } catch (error) {
      await persistOrderRequests(run, events, bucketKey, details.requestsPerSecond, now(), error); throw error;
    }
    await persistOrderRequests(run, events, bucketKey, details.requestsPerSecond, now());
  }
  const parsed = response && work ? parseOrderDetail(response.body, work.amazonOrderId, source.marketplaceId, policy, work.listedUpdatedAt) : null;
  const capturedAt = now(), policyDigest = digest(details);
  await assertActor(run);
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); const live = await assertLiveSource(tx, run); assertOrderRoles(live.authorization, policy, false, { ...scope, authorizationId: live.authorizationId, authorizationRevision: live.authorization.revision, marketplaceId: live.marketplaceId, currentEvidence: await continuityEvidence(tx, live) });
    if (await stopForControl(tx, run)) return;
    const currentCursor = await tx.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: source.id } });
    if (currentCursor.activeRunId !== run.id || currentCursor.detailPolicyDigest !== policyDigest || currentCursor.watermarkFrom.toISOString() !== window.from || currentCursor.watermarkTo.toISOString() !== window.to || currentCursor.nextTokenCiphertext !== cursor.nextTokenCiphertext) throw new SyncFenceLost();
    if (work && parsed && response) {
      const currentWork = await tx.amazonOrderDetailWork.findFirstOrThrow({ where: { ...scope, id: work.id, sourceId: source.id, policyDigest, status: "PENDING" } });
      const current = await tx.amazonOrderRecord.findFirstOrThrow({ where: { ...scope, id: currentWork.orderRecordId, sourceId: source.id, marketplaceId: source.marketplaceId, amazonOrderId: work.amazonOrderId } });
      if (current.amazonSellerId && current.amazonSellerId !== source.authorization.amazonSellerId) throw new SyncInputError("订单已绑定其他卖家，禁止详情接管。", 409);
      const detailHash = digest(response.body);
      if (current.sourceUpdatedAt > parsed.sourceUpdatedAt || current.createdTime.getTime() !== parsed.createdTime.getTime()) throw new SyncInputError("订单详情版本落后或创建时间冲突，未覆盖现有事实。");
      if (current.detailsUpdatedAt?.getTime() === parsed.sourceUpdatedAt.getTime() && current.detailPolicyDigest === policyDigest && current.detailHash !== detailHash) throw new SyncInputError("同一订单详情版本出现冲突，未覆盖已提交详情。");
      await tx.amazonOrderRecord.update({ where: { id: current.id }, data: { sourceRunId: run.id, amazonSellerId: source.authorization.amazonSellerId, sourceUpdatedAt: parsed.sourceUpdatedAt, rawStatus: parsed.rawStatus, normalizedStatus: parsed.normalizedStatus, capturedAt, detailsUpdatedAt: parsed.sourceUpdatedAt, detailPolicyDigest: policyDigest, detailHash,
        detailCiphertext: seal({ rawBody: response.rawBody }, scope, current.id, "amazon-order-detail.v1"), grandTotalOriginal: parsed.grandTotal?.original ?? null, grandTotalAmount: parsed.grandTotal ? new Prisma.Decimal(parsed.grandTotal.original) : null, currencyCode: parsed.grandTotal?.currency ?? null } });
      await tx.amazonOrderItemRecord.deleteMany({ where: { ...scope, sourceId: source.id, orderRecordId: current.id } });
      if (parsed.items.length) await tx.amazonOrderItemRecord.createMany({ data: parsed.items.map(item => ({ ...scope, sourceId: source.id, orderRecordId: current.id, orderItemId: item.orderItemId, asin: item.asin, sellerSku: item.sellerSku, quantityOrdered: item.quantityOrdered, proceedsOriginal: item.proceeds?.original ?? null, proceedsAmount: item.proceeds ? new Prisma.Decimal(item.proceeds.original) : null, currencyCode: item.proceeds?.currency ?? null })) });
      // Positive list pages occupy 1..maxPages. Detail archive ordinals occupy
      // maxPages+1 onward; operation metadata distinguishes them from list pages.
      const archiveOrdinal = maxPages + run.detailsCompletedCount + 1;
      await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page: archiveOrdinal, resource: "orders", requestMetadata: { apiVersion: "2026-01-01", operation: "getOrder", method: "GET", path: `/orders/2026-01-01/orders/${encodeURIComponent(work.amazonOrderId)}`, marketplaceId: source.marketplaceId, includedData: details.includedData, purpose: details.purpose, window, rawMayContainPii: true, requestId: events.findLast(e => e.operation === "getOrder")?.requestId ?? null }, rawCiphertext: seal({ rawBody: response.rawBody }, scope, `${run.id}:${archiveOrdinal}`, "amazon-orders-raw.v1"), bodySha256: createHash("sha256").update(response.rawBody).digest("hex"), capturedAt } });
      await tx.amazonOrderDetailWork.update({ where: { id: work.id }, data: { status: "SUCCEEDED", completedAt: capturedAt } });
    }
    const pendingDetails = await tx.amazonOrderDetailWork.count({ where: { ...scope, sourceId: source.id, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), policyDigest, status: "PENDING" } });
    const complete = currentCursor.listComplete && pendingDetails === 0;
    const coverage = { type: "incremental_window", apiVersion: "2026-01-01", window, complete, listComplete: currentCursor.listComplete, detailsEnabled: true, detailsComplete: complete, pendingDetails, piiCollected: null, factsContainPii: false, rawMayContainPii: true, rowCount: await tx.amazonOrderRecord.count({ where: { ...scope, sourceId: source.id } }) };
    await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { status: complete ? "SUCCEEDED" : "RUNNING", ...(complete ? { lastSuccessAt: capturedAt } : {}) } });
    if (complete) await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: capturedAt, rowCount: coverage.rowCount, coverage } });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: complete ? "SUCCEEDED" : "WAITING", stage: complete ? "COMPLETED" : pendingDetails ? "FETCHING_DETAILS" : "FETCHING", ...(work ? { detailsCompletedCount: { increment: 1 } } : {}), paginationComplete: currentCursor.listComplete, summary: { coverage }, finishedAt: complete ? capturedAt : null, nextAttemptAt: capturedAt, leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
    await log(tx, run, complete ? "ORDER_WINDOW_COMPLETED" : "ORDER_DETAIL_COMMITTED");
  });
}

/** One Reports operation or one bounded normalization batch per worker slice. */
export async function executeDomainReportSlice(run: AmazonSyncRun, client: AmazonSpApiClient, events: AmazonRequestEvent[], now: () => Date = () => new Date()) {
  const resource = run.resource as DomainReportResource;
  if (!Object.hasOwn(domainReportTypes, resource)) throw new SyncInputError("未注册的 Amazon 报告域。");
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const source = await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); return assertLiveSource(tx, run); });
  const archivePolicy = sellerArchivePolicy(resource, source.domainPolicy);
  assertDomainReportRoles(resource, source.authorization, run.trigger === "schedule" || !!archivePolicy);
  const window = domainReportRunWindow(resource, (run.frozenScope as { reportWindow?: unknown }).reportWindow, now());
  const discoveryWindow = window && "createdSince" in window ? window : null;
  const settlement = resource === "settlements" ? (run.frozenScope as { settlement?: { policy: SettlementPolicy; bindings: SettlementBinding[] } }).settlement : undefined;
  const inventoryEventWindow = window && "eventType" in window ? window : null;
  const reimbursementWindow = resource === "reimbursements" && window && "dataStartTime" in window ? window : null;
  const reportDataWindow = inventoryEventWindow ?? reimbursementWindow;
  const cursor = await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    const old = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: source.id } });
    if (old && (old.resource !== resource || old.amazonSellerId !== source.authorization.amazonSellerId || old.marketplaceId !== source.marketplaceId || old.organizationId !== scope.organizationId || old.workspaceId !== scope.workspaceId)) throw new SyncInputError("报告游标身份不匹配。", 403);
    const reportWindow = (run.frozenScope as { reportWindow?: { createdSince?: string; createdUntil?: string } }).reportWindow;
    const starting = !old || old.status === "SUCCEEDED";
    if (old && !starting && reimbursementWindow && (old.watermarkFrom.getTime() !== Date.parse(reimbursementWindow.dataStartTime) || old.watermarkTo.getTime() !== Date.parse(reimbursementWindow.dataEndTime))) throw new SyncInputError("赔偿窗口与未完成报告游标不匹配；保留原报告，须单独核对后恢复。", 409);
    if (old && !starting && resource === "settlements" && (old.watermarkFrom.toISOString() !== reportWindow?.createdSince || old.watermarkTo.toISOString() !== reportWindow?.createdUntil)) throw new SyncInputError("结算发现窗口与未完成游标不匹配。", 409);
    const create = {
      ...scope,
      id: randomUUID(),
      sourceId: source.id,
      resource,
      amazonSellerId: source.authorization.amazonSellerId,
      marketplaceId: source.marketplaceId,
      watermarkFrom: new Date(discoveryWindow?.createdSince ?? reportDataWindow?.dataStartTime ?? now()),
      watermarkTo: new Date(discoveryWindow?.createdUntil ?? reportDataWindow?.dataEndTime ?? now()),
      status: "RUNNING",
      activeRunId: run.id,
    } as const;
    const update = {
      activeRunId: run.id,
      status: "RUNNING",
      ...(starting ? {
        watermarkFrom: new Date(discoveryWindow?.createdSince ?? reportDataWindow?.dataStartTime ?? now()),
        watermarkTo: new Date(discoveryWindow?.createdUntil ?? reportDataWindow?.dataEndTime ?? now()),
        reportStateCiphertext: null,
      } : {}),
    };
    return tx.amazonSyncResourceCursor.upsert({ where: { sourceId: source.id }, create, update });
  });
  const state = cursor.reportStateCiphertext ? JSON.parse(decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id) ?? "{}") as { reportId?: string; documentId?: string; archiveTaskId?: string; archivePage?: number; offset?: number; rows?: number; totalRows?: number; publishedRows?: number; reportIds?: Array<{ reportId: string; createdTime: string | null }>; reportIndex?: number; discoveryToken?: string; creating?: boolean; polls?: number; reportCreatedAt?: string | null; requestedAt?: string; documentSaved?: boolean; marketplaceIds?: string[]; reconcileToken?: string; reconcileCandidates?: Array<{ reportId: string; createdTime: string | null }> } : {};
  const operation = resource === "settlements" && !state.reportId || state.creating ? "getReports" : !state.reportId ? "createReport" : !state.documentId ? "getReport" : "getReportDocument";
  const budgetKey = { ...scope, authorizationId: source.authorization.id, operation };
  const budget = await prisma.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: budgetKey } });
  // Seller settlement archives use their own durable owner/raw references.
  // Parsing or projecting an existing original consumes no Amazon request.
  if (!state.archiveTaskId && !(settlement && state.documentId) && budget && budget.nextRequestAt > now()) { await yieldSlice(run, budget.nextRequestAt); return; }
  const saveState = async (stage: string, status: "WAITING" | "SUCCEEDED" = "WAITING", nextAttemptAt = now()) => {
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      const cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
      await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher, status: status === "SUCCEEDED" ? "SUCCEEDED" : "RUNNING", ...(status === "SUCCEEDED" ? { lastSuccessAt: now() } : {}) } });
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, status, stage, finishedAt: status === "SUCCEEDED" ? now() : null, nextAttemptAt, leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 }, ...(status === "SUCCEEDED" ? { paginationComplete: true } : {}) } });
      await log(tx, run, stage);
    });
  };
  const saveProgress = async (stage: string) => prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return true;
    const cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
    await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher } });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, stage, leaseExpiresAt: new Date(now().getTime() + leaseMs) } });
    await log(tx, run, stage);
    return false;
  });
  const record = async (error?: unknown) => persistRequests(run, events, budgetKey, error);
  if (resource === "settlements" && !state.reportId) {
    assertSettlementDiscoveryAvailable(discoveryWindow!, now());
    const response = await client.getReports({ reportType: domainReportTypes.settlements, marketplaceId: source.marketplaceId, ...discoveryWindow!, ...(state.discoveryToken ? { nextToken: state.discoveryToken } : {}) }).catch(async e => { await record(e); throw e; });
    await record();
    const page = parseGetReportsPage(response, domainReportTypes.settlements, source.marketplaceId, settlement?.policy.collectionMarketplaceIds);
    const discovered = [...new Map([...(state.reportIds ?? []), ...page.reports].map(item => [item.reportId, item])).values()];
    if (discovered.length > 1000) throw new SyncInputError("结算报告超过单任务 1000 份上限；缩小报告创建时间窗口后重新申请。", 409);
    state.reportIds = discovered;
    if (page.nextToken) { state.discoveryToken = page.nextToken; await saveState("SETTLEMENT_DISCOVERY"); return; }
    if (!state.reportIds.length) {
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        if (await stopForControl(tx, run)) return;
        const capturedAt = now(), cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
        await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher, status: "SUCCEEDED", lastSuccessAt: capturedAt } });
        await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: capturedAt, rowCount: 0, coverage: { type: "report_discovery", reportType: domainReportTypes.settlements, reportCount: 0, createdSince: discoveryWindow!.createdSince, createdUntil: discoveryWindow!.createdUntil, ...(discoveryWindow!.retentionGap ? { retentionGap: discoveryWindow!.retentionGap, historicalComplete: false } : {}), capturedAt: capturedAt.toISOString() } } });
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, status: "SUCCEEDED", stage: "COMPLETED", finishedAt: capturedAt, paginationComplete: true, summary: { coverage: { reportType: domainReportTypes.settlements, reportCount: 0, discoveryOnly: true, window: discoveryWindow, historicalComplete: false } }, leaseOwner: null, leaseExpiresAt: null } });
        await log(tx, run, "SETTLEMENT_DISCOVERY_EMPTY");
      });
      return;
    }
    state.reportIndex = 0; state.reportId = state.reportIds[0].reportId; state.reportCreatedAt = state.reportIds[0].createdTime;
    await saveState("SETTLEMENT_REPORT_SELECTED"); return;
  }
  if (resource !== "settlements" && !state.reportId) {
    if (state.creating) {
      const requestedAt = Date.parse(state.requestedAt ?? "");
      if (!Number.isFinite(requestedAt)) throw new SyncInputError("报告创建检查点缺少申请时间；禁止重复创建。", 409);
      const response = await client.getReports({ reportType: domainReportTypes[resource], marketplaceId: source.marketplaceId, createdSince: new Date(requestedAt - 5_000).toISOString(), createdUntil: now().toISOString(), ...(state.reconcileToken ? { nextToken: state.reconcileToken } : {}) }).catch(async e => { await record(e); throw e; });
      await record();
      const page = parseGetReportsPage(response, domainReportTypes[resource], source.marketplaceId);
      const candidates = [...new Map([...(state.reconcileCandidates ?? []), ...page.reports.filter(item => item.createdTime !== null && Date.parse(item.createdTime) >= requestedAt - 5_000)].map(item => [item.reportId, item])).values()];
      if (candidates.length > 100) throw new SyncInputError("Amazon 报告创建核对结果超过容量上限；已停止自动处理。", 409);
      state.reconcileCandidates = candidates;
      if (page.nextToken) { state.reconcileToken = page.nextToken; await saveState("REPORT_CREATE_RECONCILING"); return; }
      delete state.reconcileToken;
      if (candidates.length > 1) throw new SyncInputError("报告申请时间范围内存在多个候选报告，无法安全确认本任务的报告；请人工核对。", 409);
      if (candidates.length === 1) {
        state.reportId = candidates[0].reportId;
        state.reportCreatedAt = candidates[0].createdTime;
        state.creating = false;
        delete state.reconcileCandidates;
        state.polls = 0;
        await saveState("REPORT_CREATE_RECONCILED"); return;
      }
      state.polls = (state.polls ?? 0) + 1;
      if (state.polls >= 100 || now().getTime() - requestedAt > 24 * 60 * 60_000) throw new SyncInputError("Amazon 尚未提供可核對的報告記錄；為避免重複建立，已停止自動重試。", 409);
      await saveState("REPORT_CREATE_RECONCILING", "WAITING", new Date(now().getTime() + 60_000)); return;
    }
    if (resource === "reimbursements" && !reimbursementWindow) throw new SyncInputError("旧赔偿任务无冻结日期窗口，须保留原任务并重新申请明确窗口；禁止创建无界报告。", 409);
    state.creating = true; state.requestedAt = now().toISOString(); state.polls = 0; state.reconcileCandidates = [];
    if (await saveProgress("REPORT_CREATING")) return;
    let response;
    try {
      response = resource === "inventory_events"
        ? await client.createInventoryLedgerReport({ marketplaceId: source.marketplaceId, from: inventoryEventWindow!.dataStartTime, to: inventoryEventWindow!.dataEndTime, eventType: inventoryEventWindow!.eventType })
        : resource === "reimbursements"
          ? await client.createReport({ reportType: domainReportTypes.reimbursements, marketplaceId: source.marketplaceId, from: reimbursementWindow!.dataStartTime, to: reimbursementWindow!.dataEndTime })
          : await client.createSnapshotReport({ reportType: domainReportTypes[resource], marketplaceId: source.marketplaceId });
    }
    catch (e) {
      await record(e);
      if (e instanceof AmazonSpApiError && e.status !== null && e.status >= 400 && e.status < 500 && e.status !== 408) {
        state.creating = false; delete state.requestedAt; state.polls = 0;
        await saveProgress("REPORT_CREATE_REJECTED");
      }
      throw e;
    }
    await record();
    const reportId = (response as { reportId?: unknown })?.reportId;
    if (typeof reportId !== "string" || !reportId || reportId.length > 200) throw new SyncInputError("Amazon 报告未返回有效 reportId。", 422);
    state.reportId = reportId; state.creating = false; state.polls = 0; await saveState("REPORT_POLLING", "WAITING", new Date(now().getTime() + 60_000)); return;
  }
  if (!state.documentId) {
    const report = await client.getReport(state.reportId!).catch(async e => { await record(e); throw e; }); await record();
    const data = report as { reportId?: unknown; reportType?: unknown; marketplaceIds?: unknown; processingStatus?: unknown; reportDocumentId?: unknown; createdTime?: unknown };
    if (data.reportId !== state.reportId || data.reportType !== domainReportTypes[resource]) throw new SyncInputError("Amazon 报告身份与任务范围不一致。", 422);
    if (settlement) state.marketplaceIds = assertSettlementMarketplaces(data.marketplaceIds, settlement.policy, source.marketplaceId);
    else if (!Array.isArray(data.marketplaceIds) || data.marketplaceIds.length !== 1 || data.marketplaceIds[0] !== source.marketplaceId) throw new SyncInputError("Amazon 报告站点与任务范围不一致。", 422);
    if (resource === "inventory_events" && inventoryEventWindow) {
      const ledger = report as { dataStartTime?: unknown; dataEndTime?: unknown };
      if ((ledger.dataStartTime !== undefined && Date.parse(String(ledger.dataStartTime)) !== Date.parse(inventoryEventWindow.dataStartTime)) || (ledger.dataEndTime !== undefined && Date.parse(String(ledger.dataEndTime)) !== Date.parse(inventoryEventWindow.dataEndTime))) throw new SyncInputError("库存事件报告日期与审批范围不一致。", 422);
    }
    if (reimbursementWindow) {
      const dates = report as { dataStartTime?: unknown; dataEndTime?: unknown };
      if ((dates.dataStartTime !== undefined && !reportTimestampMatches(dates.dataStartTime, reimbursementWindow.dataStartTime)) || (dates.dataEndTime !== undefined && !reportTimestampMatches(dates.dataEndTime, reimbursementWindow.dataEndTime))) throw new SyncInputError("赔偿报告日期与冻结窗口不一致。", 422);
    }
    if (data.createdTime !== undefined && (typeof data.createdTime !== "string" || !Number.isFinite(Date.parse(data.createdTime)))) throw new SyncInputError("Amazon 报告创建时间无效。", 422);
    if (typeof data.createdTime === "string") state.reportCreatedAt = new Date(data.createdTime).toISOString();
    if (["IN_QUEUE", "IN_PROGRESS"].includes(String(data.processingStatus))) { state.polls = (state.polls ?? 0) + 1; if (state.polls > 100) throw new SyncInputError("报告轮询达到上限，请人工检查后重新申请。", 409); await saveState("REPORT_POLLING", "WAITING", new Date(now().getTime() + 60_000)); return; }
    assertDomainReportReady(data.processingStatus, data.reportDocumentId);
    state.documentId = data.reportDocumentId as string; await saveState("REPORT_DOWNLOADING"); return;
  }
  if (settlement && state.documentId) {
    const marketplaceIds = assertSettlementMarketplaces(state.marketplaceIds, settlement.policy, source.marketplaceId);
    const reportKey = { ...scope, amazonSellerId: source.authorization.amazonSellerId, region: source.authorization.awsRegion, reportType: domainReportTypes.settlements, reportId: state.reportId! };
    const reportId = digest(reportKey);
    // Reserve a single seller/report owner before any document download. The
    // organization lock and run fence cover both the claim and every commit.
    const claimed = await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return null;
      let report = await tx.amazonSettlementReport.findUnique({ where: { organizationId_workspaceId_amazonSellerId_region_reportType_reportId: reportKey } });
      if (!report) report = await tx.amazonSettlementReport.create({ data: { id: reportId, ...reportKey, authorizationId: source.authorizationId, authorizationRevision: source.authorization.revision, sourceRunId: run.id, reportMarketplaceIds: marketplaceIds, collectionMarketplaceIds: settlement.policy.collectionMarketplaceIds, siteBindings: settlement.bindings, createdTime: state.reportCreatedAt ? new Date(state.reportCreatedAt) : null } });
      if (report.authorizationId !== source.authorizationId || report.authorizationRevision !== source.authorization.revision || digest(report.reportMarketplaceIds) !== digest(marketplaceIds) || digest(report.collectionMarketplaceIds) !== digest(settlement.policy.collectionMarketplaceIds) || digest(report.siteBindings) !== digest(settlement.bindings)) throw new SyncInputError("结算原件已由不同授权版本或采集范围归档，须人工核对，禁止覆盖。", 409);
      if (report.sourceRunId !== run.id && report.status !== "PUBLISHED") {
        const owner = await tx.amazonSyncRun.findUniqueOrThrow({ where: { id: report.sourceRunId }, select: { status: true } });
        if (["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT", "PAUSED"].includes(owner.status)) return { busy: true as const, report };
        report = await tx.amazonSettlementReport.update({ where: { id: report.id }, data: { sourceRunId: run.id } });
      }
      return { busy: false as const, report };
    });
    if (!claimed) return;
    if (claimed.busy) { await saveState("SETTLEMENT_OWNER_WAIT", "WAITING", new Date(now().getTime() + 60_000)); return; }
    const report = claimed.report;
    if (!report.rawTaskId) {
      const resumable = settlementRangeEnabled(scope);
      const rangedState = state as typeof state & { downloadParts?: SettlementPartsState; rangeDocument?: { value: unknown; expiresAt: string; documentDigest: string } };
      const documentDigest = digest([report.id, state.documentId]);
      const cachedDocument = rangedState.rangeDocument?.documentDigest === documentDigest && Date.parse(rangedState.rangeDocument.expiresAt) > now().getTime() ? rangedState.rangeDocument.value : undefined;
      const assembled = resumable && rangedState.downloadParts && rangedState.downloadParts.offset === rangedState.downloadParts.total;
      if (!assembled && !(resumable && cachedDocument) && budget && budget.nextRequestAt > now()) { await yieldSlice(run, budget.nextRequestAt); return; }
      let text: string;
      if (resumable) {
        if (rangedState.downloadParts) validateSettlementPartsState(rangedState.downloadParts, documentDigest);
        if (!rangedState.downloadParts || rangedState.downloadParts.offset < rangedState.downloadParts.total) {
          let document = cachedDocument;
          if (!document) {
            document = await client.getReportDocument(state.documentId).catch(async e => { await record(e); throw e; }); await record(); events.length = 0;
            // Amazon's signed document URL lasts five minutes; keep a one-minute margin.
            // This value only enters the AES-GCM cursor/task checkpoint, never DTO/logs.
            rangedState.rangeDocument = { value: document, expiresAt: new Date(now().getTime() + 240000).toISOString(), documentDigest };
            await saveState("SETTLEMENT_DOWNLOAD_READY"); return;
          }
          const prior = rangedState.downloadParts;
          const part = await client.downloadReportPart(document, prior ? { offset: prior.offset, total: prior.total, etag: prior.etag } : { offset: 0 }).catch(async e => { await persistRequests(run, events, { ...budgetKey, operation: "downloadReportDocument" }, e); events.length = 0; throw e; });
          // Download logging does not consume or extend the Reports metadata budget.
          await persistRequests(run, events, { ...budgetKey, operation: "downloadReportDocument" }); events.length = 0;
          await prisma.$transaction(async tx => {
            await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
            if (await stopForControl(tx, run)) return;
            const current = await tx.amazonSettlementReport.findUniqueOrThrow({ where: { id: report.id } });
            if (current.sourceRunId !== run.id || current.rawTaskId) throw new SyncInputError("结算分段归档所有权已变化。", 409);
            rangedState.downloadParts = await storeSettlementPart(tx, scope, run.id, documentDigest, part, prior);
            const cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
            await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher } });
            await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, status: "WAITING", stage: "SETTLEMENT_DOWNLOAD_PART", nextAttemptAt: now(), leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
            await log(tx, run, "SETTLEMENT_PART_ARCHIVED");
          });
          return;
        }
        text = decodeReportParts(await prisma.$transaction(tx => readSettlementParts(tx, scope, source.id, rangedState.downloadParts!, documentDigest)));
      } else {
        if (rangedState.downloadParts) throw new SyncInputError("结算分段检查点需要已批准本机续传入口；保留证据并停止。", 409);
        const document = await client.getReportDocument(state.documentId).catch(async e => { await record(e); throw e; }); await record();
        text = await client.downloadReportText(document, localSellerEvidenceEnabled(scope) ? { timeoutMs: 90_000 } : {}).catch(async e => { await record(e); throw e; }); await record();
      }
      // Archive first so a parser rejection preserves the encrypted evidence.
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        if (await stopForControl(tx, run)) return;
        const current = await tx.amazonSettlementReport.findUniqueOrThrow({ where: { id: report.id } });
        if (current.sourceRunId !== run.id || current.rawTaskId) throw new SyncInputError("结算归档所有权已变化。", 409);
        const lastRaw = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id }, orderBy: { page: "desc" }, select: { page: true } });
        const page = (lastRaw?.page ?? 0) + 1, capturedAt = now(), hash = createHash("sha256").update(text).digest("hex");
        await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page, resource, requestMetadata: { operation: "getReportDocument", reportId: state.reportId!, reportType: domainReportTypes.settlements, marketplaceIds, rawMayContainPii: true }, rawCiphertext: seal({ rawText: text }, scope, `${run.id}:${page}`, "amazon-settlements-raw.v1"), bodySha256: hash, capturedAt } });
        await tx.amazonSettlementReport.update({ where: { id: report.id }, data: { rawTaskId: run.id, rawPage: page, contentSha256: hash, capturedAt, status: "ARCHIVED" } });
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { pagesCompleted: { increment: 1 } } });
      });
      await saveState("SETTLEMENT_ARCHIVED"); return;
    }
    let rows: ReturnType<typeof parseSettlementReport>["rows"] = [], rowCount = 0;
    {
      const archive = await prisma.amazonSyncRawPage.findUnique({ where: { taskId_page: { taskId: report.rawTaskId, page: report.rawPage! } } });
      if (!archive || archive.organizationId !== scope.organizationId || archive.workspaceId !== scope.workspaceId || archive.resource !== "settlements" || archive.bodySha256 !== report.contentSha256) throw new SyncInputError("结算密文原件来源不一致。", 409);
      const raw = unseal(archive.rawCiphertext, scope, `${archive.taskId}:${archive.page}`, "amazon-settlements-raw.v1") as { rawText: string };
      if (createHash("sha256").update(raw.rawText).digest("hex") !== report.contentSha256) throw new SyncInputError("结算原件摘要不一致。", 409);
      const parsed = parseSettlementReport(raw.rawText, marketplaceIds, settlement.bindings, { offset: state.offset ?? 0, limit: 500 });
      rows = parsed.rows; rowCount = parsed.rowCount;
    }
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      const current = await tx.amazonSettlementReport.findUniqueOrThrow({ where: { id: report.id } });
      if (current.status !== "PUBLISHED" && current.sourceRunId !== run.id) throw new SyncInputError("结算解析所有权已变化。", 409);
      // Existing report tables are a site-scoped read projection. The seller-level
      // original and attribution rows above remain the durable settlement source.
      for (const binding of settlement.bindings.filter(b => b.sourceId === source.id)) {
        const documentId = digest([scope, binding.sourceId, state.reportId]);
        const prior = await tx.amazonSyncReportDocument.findUnique({ where: { organizationId_workspaceId_sourceId_reportId: { ...scope, sourceId: binding.sourceId, reportId: state.reportId! } } });
        if (prior && prior.contentSha256 !== report.contentSha256) throw new SyncInputError("结算站点投影与卖家级原件摘要冲突。", 409);
        await tx.amazonSyncReportDocument.createMany({ data: [{ id: documentId, ...scope, sourceId: binding.sourceId, sourceRunId: run.id, sellerAccountId: binding.sellerAccountId, amazonSellerId: report.amazonSellerId, marketplaceId: binding.marketplaceId, resource: "settlements", reportType: report.reportType, reportId: report.reportId, reportCreatedAt: report.createdTime, businessDateField: "posted-date or settlement-start-date", rowCount: 0, contentSha256: report.contentSha256!, status: "STAGED", capturedAt: report.capturedAt! }], skipDuplicates: true });
        const siteRows = rows.filter(r => r.binding?.sourceId === binding.sourceId);
        if (siteRows.length) await tx.amazonSyncReportRow.createMany({ data: siteRows.map(({ row }) => ({ id: digest([documentId, row.rowNumber]), ...scope, sourceId: binding.sourceId, reportDocumentId: documentId, reportId: report.reportId, ...row, fields: row.fields as Prisma.InputJsonValue })), skipDuplicates: true });
      }
      const inserted = await tx.amazonSettlementRow.createMany({ data: rows.map(({ row, status, binding }) => {
        const identity = { id: digest([report.id, row.rowNumber]), ...scope, reportDocumentId: report.id, rowNumber: row.rowNumber, rowHash: row.rowHash, attributionStatus: status };
        if (!binding) return identity;
        const { quantityOriginal: _quantity, fields, rowNumber: _number, rowHash: _hash, ...business } = row;
        void _quantity; void _number; void _hash;
        return { ...identity, ...business, sourceId: binding.sourceId, marketplaceId: binding.marketplaceId, sellerAccountId: binding.sellerAccountId, fields: fields as Prisma.InputJsonValue };
      }), skipDuplicates: true });
      state.offset = (state.offset ?? 0) + rows.length;
      const complete = state.offset >= rowCount;
      if (complete && report.status !== "PUBLISHED") await tx.amazonSettlementReport.update({ where: { id: report.id }, data: { status: "PUBLISHED", publishedAt: now() } });
      else if (!complete && report.status !== "PUBLISHED") await tx.amazonSettlementReport.update({ where: { id: report.id }, data: { status: "STAGED" } });
      if (complete) for (const binding of settlement.bindings.filter(b => b.sourceId === source.id)) {
        const documentId = digest([scope, binding.sourceId, state.reportId]);
        const rowCount = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: binding.sourceId, reportDocumentId: documentId } });
        await tx.amazonSyncReportDocument.update({ where: { id: documentId }, data: { status: "PUBLISHED", rowCount, publishedAt: report.publishedAt ?? now() } });
      }
      const next = complete ? state.reportIds?.[(state.reportIndex ?? 0) + 1] : undefined;
      if (next) {
        state.reportIndex = (state.reportIndex ?? 0) + 1; state.reportId = next.reportId; state.reportCreatedAt = next.createdTime;
        delete state.documentId; delete state.marketplaceIds; delete state.offset; delete (state as typeof state & { downloadParts?: SettlementPartsState; rangeDocument?: unknown }).downloadParts; delete (state as typeof state & { rangeDocument?: unknown }).rangeDocument; state.polls = 0;
      }
      const finished = complete && !next;
      const cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
      await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher, status: finished ? "SUCCEEDED" : "RUNNING", ...(finished ? { lastSuccessAt: now() } : {}) } });
      const publishedRowCount = await tx.amazonSettlementRow.count({ where: { ...scope, sourceId: source.id, attributionStatus: "ATTRIBUTED", document: { status: "PUBLISHED" } } });
      const quarantinedRows = await tx.amazonSettlementRow.count({ where: { ...scope, attributionStatus: { not: "ATTRIBUTED" }, document: { status: "PUBLISHED", ...reportKey, reportId: { in: (state.reportIds ?? []).map(r => r.reportId) } } } });
      const coverage = { reportType: domainReportTypes.settlements, discoveryWindow, historicalComplete: false, rowCount: publishedRowCount, quarantinedRows, attributionComplete: quarantinedRows === 0, capturedAt: now().toISOString(), businessDateField: "posted-date or settlement-start-date", reportIds: (state.reportIds ?? []).map(r => r.reportId) };
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, pagesCompleted: { increment: 1 }, processedCount: { increment: rows.length }, insertedCount: { increment: inserted.count }, status: finished ? "SUCCEEDED" : "WAITING", stage: finished ? "COMPLETED" : next ? "SETTLEMENT_NEXT_REPORT" : "SETTLEMENT_PARSING", finishedAt: finished ? now() : null, paginationComplete: finished, ...(finished ? { summary: { coverage } } : {}), nextAttemptAt: now(), leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
      if (finished) await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { rowCount: publishedRowCount, activeRunId: run.id, lastSuccessAt: now(), coverage } });
      await log(tx, run, finished ? "SETTLEMENT_PUBLISHED" : "SETTLEMENT_ROWS_COMMITTED");
    });
    return;
  }
  if (!state.archiveTaskId) {
    const document = await client.getReportDocument(state.documentId).catch(async e => { await record(e); throw e; }); await record();
    let text: string;
    try { text = await client.downloadReportText(document); } catch (e) { await record(e); throw e; }
    await record();
    const parsed = parseDomainReport(resource, text, { limit: 0, ...(inventoryEventWindow ? { inventoryEventWindow } : {}), ...(reimbursementWindow ? { reimbursementWindow } : {}) });
    const rawPage = Math.max(run.pagesCompleted + 1, 1);
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page: rawPage, resource, requestMetadata: { apiVersion: "2021-06-30", operation: "getReportDocument", reportId: state.reportId, documentId: state.documentId, reportCreatedAt: state.reportCreatedAt ?? null, reportType: domainReportTypes[resource], marketplaceId: source.marketplaceId, ...(resource === "inventory_events" ? { reportWindow: window } : {}), rawMayContainPii: true }, rawCiphertext: seal({ rawText: text }, scope, `${run.id}:${rawPage}`, `amazon-${resource}-raw.v1`), bodySha256: createHash("sha256").update(text).digest("hex"), capturedAt: now() } });
      state.archiveTaskId = run.id; state.archivePage = rawPage; state.offset = 0; state.rows = parsed.rowCount;
      const cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
      await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher } });
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, pagesCompleted: { increment: 1 }, status: "WAITING", stage: "REPORT_PARSING", nextAttemptAt: now(), leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
    });
    return;
  }
  const archive = await prisma.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: state.archiveTaskId, page: state.archivePage, resource, task: { sourceId: source.id } } });
  if (!archive) throw new SyncInputError("报告密文原件缺失，无法解析。", 409);
  const raw = unseal(archive.rawCiphertext, scope, `${archive.taskId}:${archive.page}`, `amazon-${resource}-raw.v1`) as { rawText: string };
  if (createHash("sha256").update(raw.rawText).digest("hex") !== archive.bodySha256) throw new SyncInputError("报告原件摘要校验失败。", 409);
  const offset = state.offset ?? 0, parsed = parseDomainReport(resource, raw.rawText, { offset, limit: 500, ...(inventoryEventWindow ? { inventoryEventWindow } : {}), ...(reimbursementWindow ? { reimbursementWindow } : {}) }), batch = parsed.rows;
  if (!state.documentSaved) {
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      const id = digest([scope, source.id, state.reportId]);
      const prior = await tx.amazonSyncReportDocument.findUnique({ where: { organizationId_workspaceId_sourceId_reportId: { ...scope, sourceId: source.id, reportId: state.reportId! } } });
      if (prior && prior.contentSha256 !== archive.bodySha256) throw new SyncInputError("相同 Amazon reportId 返回了不同内容摘要；拒绝覆盖已归档报告。", 409);
      await tx.amazonSyncReportDocument.createMany({ data: [{ id, ...scope, sourceId: source.id, sourceRunId: run.id, sellerAccountId: source.sellerAccountId, amazonSellerId: source.authorization.amazonSellerId, marketplaceId: source.marketplaceId, resource, reportType: domainReportTypes[resource], reportId: state.reportId!, reportCreatedAt: state.reportCreatedAt ? new Date(state.reportCreatedAt) : null, businessDateField: parsed.dateField, rowCount: parsed.rowCount, contentSha256: archive.bodySha256, status: "STAGED", capturedAt: now() }], skipDuplicates: true });
      state.documentSaved = true;
      const cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
      await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher } });
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, status: "WAITING", stage: "REPORT_PARSING", nextAttemptAt: now(), leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
    });
    return;
  }
  const documentId = digest([scope, source.id, state.reportId]);
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return;
    const guarded = ["inventory_events", "reimbursements"].includes(resource);
    const attributed = guarded ? await markReportRowAttribution(tx, scope, source, batch) : batch;
    const inserted = await tx.amazonSyncReportRow.createMany({ data: attributed.map(row => ({ id: digest([documentId, row.rowNumber]), ...scope, sourceId: source.id, reportDocumentId: documentId, reportId: state.reportId!, ...row, fields: row.fields as Prisma.InputJsonValue })), skipDuplicates: true });
    if (guarded) await persistReportAttributionMarkers(tx, scope, source.id, documentId, attributed);
    state.offset = offset + batch.length;
    state.totalRows = (state.totalRows ?? 0) + batch.length;
    const complete = state.offset >= parsed.rowCount;
    if (complete && archivePolicy) {
      await tx.amazonSyncReportDocument.update({ where: { id: documentId }, data: { status: "STAGED", publishedAt: null } });
      const cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
      // Collection may advance independently. Never write a site success watermark.
      await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { status: "SUCCEEDED", reportStateCiphertext: cipher } });
      const prior = source.coverage && typeof source.coverage === "object" && !Array.isArray(source.coverage) ? source.coverage : {};
      const archiveCollection = { mode: archivePolicy.mode, status: "ARCHIVED_SITE_PENDING", lastCompletedAt: now().toISOString(), from: cursor.watermarkFrom.toISOString(), to: cursor.watermarkTo.toISOString(), reportId: state.reportId!, documentId, rows: parsed.rowCount, published: false, historicalComplete: false };
      await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { coverage: { ...prior, archiveCollection } } });
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", stage: "ARCHIVED_SITE_PENDING", checkpointCiphertext: cipher, finishedAt: now(), paginationComplete: true, pagesCompleted: { increment: 1 }, processedCount: { increment: batch.length }, insertedCount: { increment: inserted.count }, summary: { archiveCollection }, dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null } });
      await log(tx, run, "SELLER_REPORT_ARCHIVED");
      return;
    }
    if (complete && guarded) {
      const visibleRows = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: source.id, reportDocumentId: documentId, ...reportVerifiedRowWhere(resource, source.marketplaceId) } });
      if (visibleRows !== parsed.rowCount) {
        await tx.amazonSyncReportDocument.update({ where: { id: documentId }, data: { status: "STAGED" } });
        const cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
        await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { status: "BLOCKED", reportStateCiphertext: cipher } });
        const priorCoverage = source.coverage && typeof source.coverage === "object" && !Array.isArray(source.coverage) ? source.coverage : {};
        await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { coverage: { ...priorCoverage, quarantinedRows: parsed.rowCount - visibleRows, historicalComplete: false, rowAttribution: { status: "PENDING_VERIFICATION", version: "explicit-report-row.v1", verifiedRows: visibleRows, parsedRows: parsed.rowCount, complete: false } } } });
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "BLOCKED", stage: "REPORT_ATTRIBUTION_PENDING", error: "REPORT_ROW_ATTRIBUTION_PENDING：报告行归属未完全证实；原件及明细保留，未发布站点事实。", checkpointCiphertext: cipher, pagesCompleted: { increment: 1 }, processedCount: { increment: batch.length }, insertedCount: { increment: inserted.count }, dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null } });
        await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: run.requestedByUserId, action: "amazon.sync.report.attribution-blocked", entityType: "AmazonSyncRun", entityId: run.id, metadata: { workspaceId: scope.workspaceId, sourceId: source.id, resource, parsedRows: parsed.rowCount, verifiedRows: visibleRows, originalPreserved: true } } });
        return;
      }
    }
    if (complete) await tx.amazonSyncReportDocument.update({ where: { id: documentId }, data: { status: "PUBLISHED", publishedAt: now() } });
    const nextReport = complete && resource === "settlements" ? state.reportIds?.[(state.reportIndex ?? 0) + 1] : undefined;
    if (nextReport) {
      state.reportIndex = (state.reportIndex ?? 0) + 1; state.reportId = nextReport.reportId; state.reportCreatedAt = nextReport.createdTime;
      delete state.documentId; delete state.archiveTaskId; delete state.archivePage; delete state.offset; delete state.rows; delete state.documentSaved;
      state.polls = 0;
    }
    const finished = complete && !nextReport;
    const totalProcessed = state.totalRows;
    const totalInserted = run.insertedCount + inserted.count;
    const cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
    await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher, ...(finished ? { status: "SUCCEEDED", lastSuccessAt: now() } : { status: "RUNNING" }) } });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, pagesCompleted: { increment: 1 }, processedCount: { increment: batch.length }, insertedCount: { increment: inserted.count }, status: finished ? "SUCCEEDED" : "WAITING", stage: finished ? "COMPLETED" : nextReport ? "SETTLEMENT_NEXT_REPORT" : "REPORT_PARSING", finishedAt: finished ? now() : null, paginationComplete: finished, summary: finished ? { coverage: { reportType: domainReportTypes[resource], reportIds: resource === "settlements" ? (state.reportIds ?? []).map(item => item.reportId) : [state.reportId!], rows: totalProcessed, insertedRows: totalInserted, businessDateField: parsed.dateField, ...(discoveryWindow ? { discoveryWindow, historicalComplete: false } : {}), ...(reimbursementWindow ? { reimbursementWindow, historicalComplete: false } : {}), dateMeaning: resource === "inventory_age" ? "snapshot; not historical inventory" : parsed.dateField } } : undefined, leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
    if (finished) {
      const publishedRowCount = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: source.id, document: { status: "PUBLISHED", resource }, ...reportVerifiedRowWhere(resource, source.marketplaceId) } });
      const allRows = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: source.id, document: { status: "PUBLISHED", resource } } });
      await tx.amazonSyncDataSource.update({
        where: { id: source.id },
        data: {
          activeRunId: run.id,
          lastSuccessAt: now(),
          rowCount: publishedRowCount,
          coverage: {
            reportType: domainReportTypes[resource],
            reportIds: resource === "settlements" ? (state.reportIds ?? []).map(item => item.reportId) : [state.reportId!],
            rowCount: publishedRowCount,
            ...(guarded ? { quarantinedRows: allRows - publishedRowCount, attributionPolicy: "verified-site-v1", historicalComplete: false } : {}),
            capturedAt: now().toISOString(),
            businessDateField: parsed.dateField,
            ...(requiresReportRowAttribution(resource) ? { rowAttribution: { status: "VERIFIED", version: "explicit-report-row.v1", complete: true } } : {}),
            ...(discoveryWindow ? { discoveryWindow, historicalComplete: false } : {}),
            ...(reimbursementWindow ? { reimbursementWindow, historicalComplete: false } : {}),
          },
        },
      });
    }
    await log(tx, run, finished ? "REPORT_PUBLISHED" : complete ? "REPORT_ROWS_COMMITTED" : "REPORT_ROWS_COMMITTED");
  });
}

async function persistOrderRequests(run: AmazonSyncRun, events: AmazonRequestEvent[], bucketKey: string, configuredRate: number, now: Date, error?: unknown) {
  await prisma.$transaction(async tx => {
    await scopeLock(tx, run); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (events.length) await tx.amazonSyncTaskLog.createMany({ data: events.map(e => ({ organizationId: run.organizationId, workspaceId: run.workspaceId, id: randomUUID(), taskId: run.id, attempt: run.attempts, event: e.operation, stage: "REQUEST", requestId: e.requestId, statusCode: e.status, rateLimit: e.rateLimit, code: run.resource === "finance" && e.operation === "listTransactions" && error instanceof AmazonSpApiError && e.status === error.status ? error.upstreamCode : null })) });
    if (error instanceof AmazonSpApiError && ["REPORT_DOWNLOAD_GZIP", "REPORT_DOWNLOAD_TIMEOUT", "REPORT_DOWNLOAD_TRANSPORT"].includes(error.upstreamCode ?? "")) await tx.amazonSyncTaskLog.create({ data: { id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event: "REPORT_DOWNLOAD_FAILED", stage: "DOWNLOAD", code: error.upstreamCode } });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { apiRequests: { increment: events.length }, throttles: { increment: events.filter(e => e.status === 429).length }, leaseExpiresAt: new Date(now.getTime() + leaseMs) } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bucketKey}, 0))`;
    const event = events.findLast(e => ["searchOrders", "getOrder", "listTransactions", "createReport", "getReport", "getReportDocument", "getInboundPlan", "listInboundPlanItems", "getShipment", "listShipmentItems", "getCompetitiveSummary", "getPricing"].includes(e.operation) && e.rateLimit);
    const observed = event?.rateLimit ? Number(event.rateLimit) : null;
    const data = { ...(observed && observed > 0 && Number.isFinite(observed) ? { observedLimit: Math.min(observed, configuredRate) } : {}), ...(error instanceof AmazonSpApiError && error.status === 429 ? { tokens: 0, blockedUntil: new Date(now.getTime() + retryDelay(run.attempts, error.retryAfterMs)) } : {}) };
    await tx.amazonSyncTokenBucket.update({ where: { bucketKey }, data });
  });
}

export function assertConsistentSnapshotRows(rows: object[], resource: string) {
  const seen = new Map<string, string>();
  const fields = resource === "inventory" ? ["sellerSku", "condition", "asin", "fnSku", "fulfillableQuantity", "inboundWorkingQuantity", "inboundShippedQuantity", "inboundReceivingQuantity", "reservedQuantity", "unfulfillableQuantity", "researchingQuantity", "sourceUpdatedAt"] : ["sellerSku", "asin", "listingStatus", "fulfillmentType", "sourceUpdatedAt"];
  for (const object of rows) {
    const row = object as Record<string, unknown>;
    const key = canonical([row.sellerSku, resource === "inventory" ? row.condition : null]);
    const signature = canonical(Object.fromEntries(fields.map(field => [field, row[field] instanceof Date ? row[field].toISOString() : row[field]])));
    if (seen.has(key) && seen.get(key) !== signature) throw new Error("重复业务键包含冲突数据；不能发布完整快照。");
    seen.set(key, signature);
  }
}

/** Finances v2024-06-19 listTransactions. One bounded page per slice; the
 * original number lexemes are encrypted and committed with the business cursor.
 * https://developer-docs.amazon.com/sp-api/reference/listtransactions
 */
export async function executeFinanceSlice(run: AmazonSyncRun, client: AmazonSpApiClient, events: AmazonRequestEvent[], now: () => Date = () => new Date()) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  await assertActor(run);
  const source = await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); return assertLiveSource(tx, run); });
  const policy = parseFinancePolicy(source.financePolicy), auth = source.authorization;
  const window = financeWindowFromFrozen((run.frozenScope as { financeWindow?: unknown }).financeWindow);
  assertFinanceRequestWindow(window, now());
  const policyDigest = digest(policy);
  const bucketKey = digest(["listTransactions.2024-06-19", auth.amazonSellerId, policy.applicationId]);
  const prepared = await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return null;
    let cursor = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: source.id } });
    if (cursor && (cursor.resource !== "finance" || cursor.amazonSellerId !== auth.amazonSellerId || cursor.marketplaceId !== source.marketplaceId || cursor.organizationId !== scope.organizationId || cursor.workspaceId !== scope.workspaceId)) throw new SyncInputError("财务游标身份不匹配。", 403);
    if (cursor && cursor.status !== "SUCCEEDED" && (cursor.watermarkFrom.toISOString() !== window.from || cursor.watermarkTo.toISOString() !== window.to || cursor.detailPolicyDigest !== policyDigest)) throw new SyncInputError("财务窗口或策略与未完成游标不匹配。", 409);
    if (cursor?.status === "SUCCEEDED" && Date.parse(window.to) <= cursor.watermarkTo.getTime()) throw new SyncInputError("财务窗口已完成，请重新申请后续窗口。", 409);
    const starting = !cursor || cursor.status === "SUCCEEDED";
    cursor = await tx.amazonSyncResourceCursor.upsert({ where: { sourceId: source.id }, create: { ...scope, id: randomUUID(), sourceId: source.id, resource: "finance", amazonSellerId: auth.amazonSellerId, marketplaceId: source.marketplaceId, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), activeRunId: run.id, status: "RUNNING", detailPolicyDigest: policyDigest }, update: { activeRunId: run.id, status: "RUNNING", ...(starting ? { watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), nextTokenCiphertext: null, detailPolicyDigest: policyDigest } : {}) } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bucketKey}, 0))`;
    const bucket = await tx.amazonSyncTokenBucket.findUnique({ where: { bucketKey } });
    const reservation = reserveOrderToken(bucket, policy, now());
    await tx.amazonSyncTokenBucket.upsert({ where: { bucketKey }, create: { bucketKey, tokens: reservation.tokens, replenishedAt: reservation.replenishedAt }, update: { tokens: reservation.tokens, replenishedAt: reservation.replenishedAt } });
    return { cursor, reservation };
  });
  if (!prepared) return;
  if (!prepared.reservation.allowed) { await yieldSlice(run, prepared.reservation.nextAt); return; }
  const token = decryptCheckpoint(prepared.cursor.nextTokenCiphertext, scope, prepared.cursor.id);
  const replay = prepared.cursor.reportStateCiphertext ? JSON.parse(decryptCheckpoint(prepared.cursor.reportStateCiphertext, scope, prepared.cursor.id) ?? "null") as { replayApprovalId?: string; window?: { from?: string; to?: string } } | null : null;
  const replayId = replay?.replayApprovalId && replay.window?.from === window.from && replay.window?.to === window.to ? replay.replayApprovalId : undefined;
  const financeTokenHash = (value: string | null) => replayId ? digest([window, policyDigest, value, replayId]) : digest([window, policyDigest, value]);
  const tokenHash = financeTokenHash(token ?? null);
  if (await prisma.amazonSyncPage.findFirst({ where: { ...scope, tokenHash, task: { sourceId: source.id } } })) throw new SyncInputError("财务分页循环，未推进游标。");
  events.length = 0;
  let response: Awaited<ReturnType<AmazonSpApiClient["listTransactions"]>>;
  try {
    await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run); });
    // Recheck after queue/rate-limit waits; the frozen start ages while waiting.
    assertFinanceRequestWindow(window, now());
    response = await client.listTransactions({ postedAfter: window.from, postedBefore: window.to, nextToken: token });
  } catch (error) { await persistOrderRequests(run, events, bucketKey, policy.requestsPerSecond, now(), error); throw error; }
  await persistOrderRequests(run, events, bucketKey, policy.requestsPerSecond, now());
  const page = parseFinancePage(response.rawBody, window);
  if (run.pagesCompleted >= maxPages || run.processedCount + page.transactions.length > maxRows) throw new SyncInputError("财务窗口超过安全容量，保留游标并停止。");
  if (page.nextToken && financeTokenHash(page.nextToken) === tokenHash) throw new SyncInputError("财务分页循环，未推进游标。");
  // Validate every row before committing anything, including an out-of-scope site.
  const rows = page.transactions.map(row => {
    const attribution = attributeFinanceTransaction(row, auth.amazonSellerId, policy);
    return { row, attribution, converted: attribution.reason ? null : convertFinanceMoney(row.amount, row.postedAt, policy) };
  });
  const capturedAt = now(), pageNumber = run.pagesCompleted + 1;
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return;
    const cursor = await tx.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: source.id } });
    if (cursor.activeRunId !== run.id || cursor.captureSequence !== prepared.cursor.captureSequence || cursor.nextTokenCiphertext !== prepared.cursor.nextTokenCiphertext) throw new SyncFenceLost();
    const observationSequence = cursor.captureSequence + 1;
    let inserted = 0, updated = 0, skipped = 0;
    for (const { row, attribution, converted } of rows) {
      const key = { ...scope, sellerAccountId: source.sellerAccountId, transactionId: row.transactionId };
      const existing = await tx.amazonFinanceRecord.findUnique({ where: { organizationId_workspaceId_sellerAccountId_transactionId: key } });
      if (existing && (existing.sourceId !== source.id || existing.observationSequence >= observationSequence)) throw new SyncInputError("财务采集顺序或来源冲突，禁止旧观察覆盖新事实。");
      const rowHash = digest({ ...row, postedAt: row.postedAt.toISOString(), attribution, converted });
      if (existing?.rowHash === rowHash) { skipped++; continue; }
      const id = existing?.id ?? digest(key), quarantined = !!attribution.reason;
      const data = { ...key, amazonSellerId: auth.amazonSellerId, sourceId: source.id, sourceRunId: run.id,
        marketplaceId: attribution.marketplaceId, marketplaceTimeZone: attribution.marketplaceTimeZone, attributionStatus: quarantined ? "QUARANTINED" : "ATTRIBUTED", quarantineReason: attribution.reason,
        postedAt: row.postedAt, transactionType: quarantined ? null : row.transactionType, rawStatus: quarantined ? null : row.rawStatus,
        orderId: quarantined ? null : row.orderId, classification: quarantined ? "UNATTRIBUTED" : row.classification,
        originalAmount: quarantined ? null : row.amount.original, amount: quarantined ? null : row.amount.original, currency: quarantined ? null : row.amount.currency,
        convertedAmount: converted?.amount ?? null, convertedCurrency: converted?.currency ?? null, conversionStatus: converted?.status ?? "QUARANTINED",
        fxEvidence: converted?.evidence ? converted.evidence as Prisma.InputJsonValue : Prisma.DbNull,
        observationSequence, rowHash, capturedAt };
      await tx.amazonFinanceRecord.upsert({ where: { organizationId_workspaceId_sellerAccountId_transactionId: key }, create: { id, ...data }, update: data });
      if (quarantined) await tx.amazonFinanceQuarantine.upsert({ where: { recordId: id }, create: { ...scope, recordId: id, ciphertext: seal({ ...row, postedAt: row.postedAt.toISOString() }, scope, id, "amazon-finance-quarantine.v1"), createdAt: capturedAt }, update: { ciphertext: seal({ ...row, postedAt: row.postedAt.toISOString() }, scope, id, "amazon-finance-quarantine.v1"), createdAt: capturedAt } });
      else await tx.amazonFinanceQuarantine.deleteMany({ where: { ...scope, recordId: id } });
      if (existing) updated++; else inserted++;
    }
    await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page: pageNumber, resource: "finance", requestMetadata: { apiVersion: "2024-06-19", operation: "listTransactions", method: "GET", path: "/finances/2024-06-19/transactions", sellerWide: true, approvedMarketplaceIds: policy.marketplaces.map(m => m.marketplaceId), window, pageTokenHash: tokenHash, requestId: events.findLast(e => e.operation === "listTransactions")?.requestId ?? null }, rawCiphertext: seal({ rawBody: response.rawBody }, scope, `${run.id}:${pageNumber}`, "amazon-finance-raw.v1"), bodySha256: createHash("sha256").update(response.rawBody).digest("hex"), capturedAt } });
    await tx.amazonSyncPage.create({ data: { ...scope, taskId: run.id, page: pageNumber, tokenHash, rowCount: rows.length } });
    const complete = !page.nextToken;
    await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { captureSequence: observationSequence, nextTokenCiphertext: encryptCheckpoint(page.nextToken, scope, cursor.id), status: complete ? "SUCCEEDED" : "RUNNING", ...(complete ? { lastSuccessAt: capturedAt } : {}) } });
    const where = { ...scope, sourceId: source.id };
    const rowCount = await tx.amazonFinanceRecord.count({ where });
    const quarantinedCount = await tx.amazonFinanceRecord.count({ where: { ...where, attributionStatus: "QUARANTINED" } });
    const unconvertedCount = await tx.amazonFinanceRecord.count({ where: { ...where, conversionStatus: "UNCONVERTED" } });
    const previousCoverage = source.coverage && typeof source.coverage === "object" && !Array.isArray(source.coverage) ? source.coverage : {};
    const retentionGaps = Array.isArray(previousCoverage.retentionGaps) ? previousCoverage.retentionGaps : [];
    const coverage = { type: "posted_incremental_window", apiVersion: "2024-06-19", window, sellerWide: true, marketplaceIds: policy.marketplaces.map(m => m.marketplaceId), transportComplete: complete, financialFinal: false, overlapSeconds: policy.overlapSeconds, rowCount, quarantinedCount, unconvertedCount, ...(retentionGaps.length ? { retentionGaps, historicalComplete: false } : {}) };
    if (complete) await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: capturedAt, rowCount, coverage } });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: complete ? "SUCCEEDED" : "WAITING", stage: complete ? "COMPLETED" : "FETCHING", pagesCompleted: { increment: 1 }, processedCount: { increment: rows.length }, insertedCount: { increment: inserted }, updatedCount: { increment: updated }, skippedCount: { increment: skipped }, paginationComplete: complete, checkpointCiphertext: encryptCheckpoint(page.nextToken, scope, run.id), summary: { coverage }, finishedAt: complete ? capturedAt : null, nextAttemptAt: capturedAt, leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
    await log(tx, run, complete ? "FINANCE_WINDOW_COMPLETED" : "FINANCE_PAGE_COMMITTED");
  }, { timeout: 60000 });
}

/** Reports v2021-06-30 FBA Returns: one HTTP operation or one bounded DB batch.
 * https://developer-docs.amazon.com/sp-api/reference/createreport
 * https://developer-docs.amazon.com/sp-api/reference/getreport
 * https://developer-docs.amazon.com/sp-api/reference/getreportdocument
 * https://developer-docs.amazon.com/sp-api/docs/retrieve-a-report
 * This registered report is not restricted; arbitrary report types are rejected.
 */
export async function executeReturnSlice(run: AmazonSyncRun, client: AmazonSpApiClient, events: AmazonRequestEvent[], now: () => Date = () => new Date()) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const source = await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); return assertLiveSource(tx, run); });
  const policy = parseReturnPolicy(source.returnsPolicy), auth = source.authorization;
  const window = returnWindowFromFrozen((run.frozenScope as { returnWindow?: unknown }).returnWindow), policyDigest = digest(policy);
  const cursor = await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    const old = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: source.id } });
    if (old && (old.resource !== "returns" || old.amazonSellerId !== auth.amazonSellerId || old.marketplaceId !== source.marketplaceId || old.organizationId !== scope.organizationId || old.workspaceId !== scope.workspaceId)) throw new SyncInputError("退货游标身份不匹配。", 403);
    const starting = !old || old.status === "SUCCEEDED";
    if (old && !starting && (old.watermarkFrom.toISOString() !== window.from || old.watermarkTo.toISOString() !== window.to || old.detailPolicyDigest !== policyDigest)) throw new SyncInputError("退货窗口或策略与未完成游标不符。", 409);
    if (old?.status === "SUCCEEDED" && Date.parse(window.to) <= old.watermarkTo.getTime()) throw new SyncInputError("该退货窗口已完成。", 409);
    return tx.amazonSyncResourceCursor.upsert({ where: { sourceId: source.id }, create: { ...scope, id: randomUUID(), sourceId: source.id, resource: "returns", amazonSellerId: auth.amazonSellerId, marketplaceId: source.marketplaceId, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), status: "RUNNING", activeRunId: run.id, detailPolicyDigest: policyDigest }, update: { activeRunId: run.id, status: "RUNNING", ...(starting ? { watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), reportStateCiphertext: null, detailPolicyDigest: policyDigest } : {}) } });
  });
  const state = parseReturnState(decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id));
  const commit = async (stage: string, mutate?: (tx: Prisma.TransactionClient) => Promise<void>, complete = false, nextAt = now()) => {
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      const live = await tx.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: source.id } });
      if (live.activeRunId !== run.id || live.reportStateCiphertext !== cursor.reportStateCiphertext) throw new SyncFenceLost();
      if (mutate) await mutate(tx);
      const ciphertext = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
      await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: ciphertext, status: complete ? "SUCCEEDED" : "RUNNING", ...(complete ? { lastSuccessAt: now() } : {}) } });
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { stage, status: complete ? "SUCCEEDED" : "WAITING", paginationComplete: complete, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: nextAt, finishedAt: complete ? now() : null, dispatchVersion: { increment: 1 } } });
      await log(tx, run, stage);
    }, { timeout: 60000 });
  };
  if (state.archiveTaskId) {
    const archive = await prisma.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: state.archiveTaskId, page: 1, resource: "returns", task: { sourceId: source.id } } });
    if (!archive || !state.reportId) throw new SyncInputError("退货密文报告证据缺失。");
    const envelope = unseal(archive.rawCiphertext, scope, `${state.archiveTaskId}:1`, "amazon-returns-raw.v1") as { rawText: string };
    if (createHash("sha256").update(envelope.rawText).digest("hex") !== archive.bodySha256) throw new SyncInputError("退货报告原件校验失败。");
    const parsed = parseReturnReport(envelope.rawText, window, policy, state.offset);
    state.offset = parsed.nextOffset;
    await commit(parsed.complete ? "RETURN_REPORT_COMPLETED" : "RETURN_BATCH_COMMITTED", async tx => {
      let inserted = 0;
      for (const { reasonCode, ...row } of parsed.rows) {
        let reasonId: string | null = null;
        if (reasonCode) {
          reasonId = digest([scope, reasonCode]);
          await tx.amazonReturnReason.upsert({ where: { organizationId_workspaceId_code: { ...scope, code: reasonCode } }, create: { ...scope, id: reasonId, code: reasonCode }, update: {} });
        }
        const key = { ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, reportId: state.reportId!, rowHash: row.rowHash };
        const result = await tx.amazonReturnRecord.createMany({ data: [{ id: digest(key), ...key, amazonSellerId: auth.amazonSellerId, ...row, reasonId, sourceId: source.id, sourceRunId: run.id, sellerAccountId: source.sellerAccountId, marketplaceTimeZone: policy.marketplaceTimeZone, capturedAt: now() }], skipDuplicates: true });
        inserted += result.count;
      }
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { pagesCompleted: { increment: 1 }, processedCount: { increment: parsed.rows.length }, insertedCount: { increment: inserted }, skippedCount: { increment: parsed.rows.length - inserted } } });
      if (parsed.complete) {
        const rowCount = await tx.amazonReturnRecord.count({ where: { ...scope, sourceId: source.id, reportId: state.reportId } });
        const coverage = { type: "fba_received_returns_report", apiVersion: "2021-06-30", reportType: policy.reportType, reportId: state.reportId!, window, complete: true, returnsUniverseComplete: false, rowCount, rawRows: parsed.total, duplicateRows: parsed.total - rowCount, archiveTaskId: state.archiveTaskId!, reasonMapping: "RAW_CODE_ONLY" };
        await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: now(), rowCount, coverage } });
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { summary: { coverage } } });
      }
    }, parsed.complete);
    return;
  }
  if (state.creating && !state.reportId) throw new SyncInputError("退货报告申请结果不确定，禁止自动重复创建；需人工核查。");
  if (state.requestedAt && (state.polls >= policy.pollMaxAttempts || now().getTime() - Date.parse(state.requestedAt) > policy.pollDeadlineMinutes * 60000)) throw new SyncInputError("退货报告等待达到上限，保留报告与游标，需人工核查。");
  const operation = !state.reportId ? "createReport" : !state.documentId ? "getReport" : "getReportDocument";
  const budget = policy.budgets[operation], bucketKey = digest([`${operation}.2021-06-30`, auth.amazonSellerId, policy.applicationId]);
  // Respect the existing Reports budget too, so new returns traffic cannot ignore
  // a recently observed throttle from the pre-existing sales-report flow.
  const oldBudget = await prisma.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: { ...scope, authorizationId: auth.id, operation } } });
  if (oldBudget && oldBudget.nextRequestAt > now()) { await yieldSlice(run, oldBudget.nextRequestAt); return; }
  const reservation = await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bucketKey}, 0))`;
    const old = await tx.amazonSyncTokenBucket.findUnique({ where: { bucketKey } });
    const r = reserveOrderToken(old, budget, now());
    await tx.amazonSyncTokenBucket.upsert({ where: { bucketKey }, create: { bucketKey, tokens: r.tokens, replenishedAt: r.replenishedAt }, update: { tokens: r.tokens, replenishedAt: r.replenishedAt } }); return r;
  });
  if (!reservation.allowed) { await yieldSlice(run, reservation.nextAt); return; }
  const record = async (error?: unknown) => {
    await persistOrderRequests(run, events, bucketKey, budget.requestsPerSecond, now(), error);
    const key = { ...scope, authorizationId: auth.id, operation };
    const nextRequestAt = new Date(now().getTime() + Math.ceil(1000 / budget.requestsPerSecond));
    await prisma.amazonSyncApiBudget.upsert({ where: { organizationId_workspaceId_authorizationId_operation: key }, create: { ...key, nextRequestAt }, update: { nextRequestAt } });
    events.length = 0;
  };
  const wait = () => new Date(now().getTime() + returnPollDelay(policy, state.polls));
  if (!state.reportId) {
    state.creating = true; state.requestedAt = now().toISOString();
    // Save uncertain-create intent while retaining the current fenced lease.
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      const text = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
      await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: text } }); cursor.reportStateCiphertext = text;
    });
    events.length = 0;
    try {
      await prisma.$transaction(tx => assertLiveSource(tx, run));
      const response = await client.createReport({ reportType: policy.reportType, marketplaceId: source.marketplaceId, ...window }) as { reportId?: unknown };
      await record();
      if (typeof response.reportId !== "string" || !response.reportId || response.reportId.length > 200) throw new SyncInputError("退货报告 ID 无效，保留不确定创建状态。");
      state.reportId = response.reportId; state.creating = false;
      await commit("RETURN_REPORT_POLLING", undefined, false, wait());
    } catch (error) {
      if (events.length) await record(error);
      if (error instanceof AmazonSpApiError && error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 408) {
        state.creating = false;
        await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: encryptCheckpoint(JSON.stringify(state), scope, cursor.id) } }); });
        throw error;
      }
      throw new SyncInputError("退货报告创建结果不确定，禁止自动重放，请人工核查。");
    }
    return;
  }
  state.polls++;
  events.length = 0;
  let response: unknown;
  try {
    await prisma.$transaction(tx => assertLiveSource(tx, run));
    response = state.documentId ? await client.getReportDocument(state.documentId) : await client.getReport(state.reportId);
    await record();
  } catch (error) {
    await record(error);
    if (error instanceof AmazonSpApiError && error.status === 404) { await commit("RETURN_RESOURCE_PENDING", undefined, false, wait()); return; }
    // Persist attempt count without releasing the lease used by error handling.
    await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: encryptCheckpoint(JSON.stringify(state), scope, cursor.id) } }); });
    throw error;
  }
  if (!state.documentId) {
    const r = response as { reportId?: string; reportType?: string; marketplaceIds?: string[]; dataStartTime?: string; dataEndTime?: string; processingStatus?: string; reportDocumentId?: string };
    if (r.reportId !== state.reportId || r.reportType !== policy.reportType || !Array.isArray(r.marketplaceIds) || r.marketplaceIds.length !== 1 || r.marketplaceIds[0] !== source.marketplaceId || !reportTimestampMatches(r.dataStartTime, window.from) || !reportTimestampMatches(r.dataEndTime, window.to)) throw new SyncInputError("退货报告身份、站点或时间窗与审批不一致。");
    if (r.processingStatus === "IN_QUEUE" || r.processingStatus === "IN_PROGRESS") { await commit("RETURN_REPORT_POLLING", undefined, false, wait()); return; }
    if (r.processingStatus !== "DONE" || !r.reportDocumentId || r.reportDocumentId.length > 200) throw new SyncInputError("退货报告失败、取消或文档身份缺失，未推断为空报告。");
    state.documentId = r.reportDocumentId; await commit("RETURN_REPORT_DOWNLOADING"); return;
  }
  if ((response as { reportDocumentId?: unknown })?.reportDocumentId !== state.documentId) throw new SyncInputError("退货文档身份不匹配。");
  events.length = 0;
  let text: string;
  try { await prisma.$transaction(tx => assertLiveSource(tx, run)); text = await client.downloadReportText(response); }
  catch (error) {
    await record(error);
    if (error instanceof AmazonSpApiError && [403, 404].includes(error.status ?? 0)) { await commit("RETURN_URL_REFRESH", undefined, false, wait()); return; }
    throw error;
  }
  await record();
  parseReturnReport(text, window, policy); // validate entire bounded file before staging any facts
  state.archiveTaskId = run.id; state.offset = 0;
  await commit("RETURN_REPORT_PARSING", async tx => {
    await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page: 1, resource: "returns", requestMetadata: { apiVersion: "2021-06-30", operation: "getReportDocument", reportId: state.reportId!, documentId: state.documentId!, reportType: policy.reportType, marketplaceId: source.marketplaceId, window, rawMayContainPii: true }, rawCiphertext: seal({ rawText: text }, scope, `${run.id}:1`, "amazon-returns-raw.v1"), bodySha256: createHash("sha256").update(text).digest("hex"), capturedAt: now() } });
  });
}

/** Shared observation receiver. Each leased slice performs at most one bounded
 * request; facts remain staged until a fenced, scope-checked publication. */
async function executeObservationSlice(run: AmazonSyncRun, client: AmazonSpApiClient, events: AmazonRequestEvent[]) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const source = await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); return assertLiveSource(tx, run); });
  const configuredPolicy = parseObservationPolicy(run.resource === "brand_analytics" ? (run.frozenScope as { domainPolicy?: unknown }).domainPolicy : source.domainPolicy, run.resource);
  const manifest = (run.frozenScope as { productManifest?: unknown }).productManifest;
  const policy = resolvedProductPolicy(configuredPolicy, manifest);
  let state = parseObservationState(run.checkpointCiphertext ? unseal(run.checkpointCiphertext, scope, run.id, "amazon-observation-state.v1").state : null, policy);
  if (observationOperation(state, policy.resource) === "uncertainCreate") throw new SyncInputError("报告申请结果不确定；禁止自动再次创建，需核对原任务。", 409);
  const saveState = async (tx: Prisma.TransactionClient, next: ObservationState) => {
    const checkpointCiphertext = seal({ state: next }, scope, run.id, "amazon-observation-state.v1");
    Object.assign(run, await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext, leaseExpiresAt: new Date(Date.now() + leaseMs) } }));
  };
  if (state.stage === "COMPLETE") {
    await assertActor(run);
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); const live = await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      const rowCount = await tx.amazonDomainObservation.count({ where: { ...scope, sourceRunId: run.id, sourceId: live.id } });
      if (rowCount !== run.insertedCount || rowCount + run.skippedCount !== run.processedCount || !state.requests || !syncCenterEnabled(run)) throw new SyncInputError("观察记录完整性校验失败。");
      if ((policy.resource === "listing_details" || policy.resource === "catalog_items") && policy.discovery && (state.planIndex !== (policy.resource === "listing_details" ? policy.sellerSkus.length : policy.asins.length) || rowCount !== state.planIndex)) throw new SyncInputError("全店详情分片尚未完整提交，不能发布。");
      const coverage = { ...(manifest ? { discovery: manifest, catalogSnapshotComplete: true } : {}), type: "APPROVED_SCOPE_OBSERVATION", resource: policy.resource, complete: true, accountUniverseComplete: false, rowCount, capturedFrom: run.executionStartedAt!.toISOString(), capturedTo: new Date().toISOString(), ...(policy.resource === "fulfillment" ? { planIds: policy.planIds, marketplaceVerified: true, quantitySemantics: "DECLARED_ONLY", transportEventsAvailable: false } : policy.resource === "listing_details" ? { sellerSkus: policy.sellerSkus, attributeCoverage: "PRODUCT_FIELD_ALLOWLIST" } : policy.resource === "catalog_items" ? { asins: policy.asins, attributeCoverage: "PRODUCT_FIELD_ALLOWLIST" } : policy.resource === "pricing" ? { asins: policy.asins, ownPriceCoverage: "APPROVED_ASINS_NEW_B2C_GET_PRICING" } : { from: policy.from, to: policy.to, asins: policy.asins, ...(policy.resource === "brand_analytics" ? { reportKind: policy.reportKind, reportPeriod: policy.reportPeriod } : {}), reportId: state.reportId! }) };
      await tx.amazonSyncDataSource.update({ where: { id: live.id }, data: { activeRunId: run.id, lastSuccessAt: new Date(), rowCount, coverage } });
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", stage: "COMPLETED", paginationComplete: true, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, checkpointCiphertext: null, summary: { coverage } } });
      // A failed report may have deferred its plan for a day. Once that same
      // checkpoint succeeds, wake only an already-enabled finite brand plan.
      // The scheduler still checks the manifest and never recreates uncertain work.
      if (policy.resource === "brand_analytics" && (parseObservationPolicy(live.domainPolicy, "brand_analytics") as AnalyticsPolicy).collection) {
        const now = new Date();
        await tx.amazonSyncSchedule.updateMany({ where: { ...scope, resource: "brand_analytics", executionVersion: 2, enabled: true, planKey: automaticPlanKey(live.id), nextRunAt: { gt: now }, targets: { some: { sourceId: live.id } } }, data: { nextRunAt: now } });
      }
      await log(tx, run, "OBSERVATIONS_PUBLISHED");
    }); return;
  }
  // Reparse the authenticated original archive after a compatible parser fix.
  // No network call, new report, or request budget reset is involved.
  let archivedDownload: string | undefined;
  if (policy.resource === "brand_analytics" && state.stage === "DOWNLOAD") {
    const page = await prisma.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, resource: "brand_analytics", requestMetadata: { path: ["operation"], equals: "downloadReportDocument" } }, orderBy: { page: "desc" } });
    if (page) {
      const raw = unseal(page.rawCiphertext, scope, run.id + ":" + page.page, "amazon-observation-raw.v1").rawBody;
      if (typeof raw !== "string" || digest(raw) !== page.bodySha256) throw new SyncInputError("报告归档完整性校验失败。", 409);
      try { advanceObservation(policy, state, null, { rawBody: raw, marketplaceId: source.marketplaceId, sellerId: source.authorization.amazonSellerId }); archivedDownload = raw; }
      catch { /* Keep the normal download path for an unchanged invalid report. */ }
    }
  }
  if (archivedDownload === undefined && state.requests >= policy.maxRequests) throw new SyncInputError("观察任务已达到审批请求预算，未发布新版本。", 409);
  const operation = observationOperation(state, policy.resource), auth = source.authorization;
  const key = { ...scope, authorizationId: auth.id, operation };
  // Same bucket namespace as existing Reports receivers. Never split by site.
  const bucketKey = digest([`${operation}.${["createReport", "getReport", "getReportDocument"].includes(operation) ? "2021-06-30" : policy.resource === "listing_details" ? "2021-08-01" : policy.resource === "catalog_items" ? "2022-04-01" : policy.resource === "fulfillment" ? "2024-03-20" : operation === "getPricing" ? "v0" : "2022-05-01"}`, auth.amazonSellerId, policy.applicationId]);
  const reserve = archivedDownload !== undefined ? { allowed: true, nextAt: new Date() } : await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return null;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bucketKey}, 0))`;
    const budget = await tx.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: key } });
    if (budget && budget.nextRequestAt > new Date()) return { allowed: false, nextAt: budget.nextRequestAt };
    if (policy.resource === "brand_analytics") {
      const turn = await brandFairTurn(tx, run, policy, operation, async peer => { await assertLiveSource(tx, peer); });
      if (!turn.allowed) return turn;
    }
    const bucket = await tx.amazonSyncTokenBucket.findUnique({ where: { bucketKey } });
    if (await continuityProbeDue(tx, source)) return { allowed: false, nextAt: new Date(Date.now() + 5000) };
    const result = reserveOrderToken(bucket, { requestsPerSecond: policy.requestsPerSecond, burst: 1 }, new Date());
    await tx.amazonSyncTokenBucket.upsert({ where: { bucketKey }, create: { bucketKey, tokens: result.tokens, replenishedAt: result.replenishedAt }, update: { tokens: result.tokens, replenishedAt: result.replenishedAt } });
    if (result.allowed) {
      state.requests++; if (state.stage === "CREATE") state.stage = "CREATING";
      await saveState(tx, state);
      const nextRequestAt = new Date(Date.now() + Math.ceil(1000 / policy.requestsPerSecond));
      await tx.amazonSyncApiBudget.upsert({ where: { organizationId_workspaceId_authorizationId_operation: key }, create: { ...key, nextRequestAt }, update: { nextRequestAt } });
    }
    return result;
  });
  if (!reserve) return;
  if (!reserve.allowed) { await yieldSlice(run, reserve.nextAt); return; }
  let body: unknown, rawBody = ""; events.length = 0;
  try {
    if (policy.resource === "fulfillment") {
      const inboundPlanId = policy.planIds[state.planIndex], shipmentId = state.shipmentIds[state.shipmentIndex];
      const result = state.stage === "PLAN" || state.stage === "VERIFY_PLAN" ? await client.getInboundPlan({ inboundPlanId }) : state.stage === "PLAN_ITEMS" ? await client.listInboundPlanItems({ inboundPlanId, paginationToken: state.token }) : state.stage === "SHIPMENT" ? await client.getInboundShipment({ inboundPlanId, shipmentId }) : await client.listInboundShipmentItems({ inboundPlanId, shipmentId, paginationToken: state.token });
      body = result.body; rawBody = result.rawBody;
    } else if (policy.resource === "listing_details" || policy.resource === "catalog_items") {
      const result = policy.resource === "listing_details" ? await client.getListingDetail({ sellerId: auth.amazonSellerId, sellerSku: policy.sellerSkus[state.planIndex], marketplaceId: source.marketplaceId }) : await client.getCatalogDetail({ asin: policy.asins[state.planIndex], marketplaceId: source.marketplaceId });
      body = result.body; rawBody = result.rawBody;
    } else if (policy.resource === "pricing") {
      const result = state.stage === "OWN_PRICE" ? await client.getOwnPrices({ asins: policy.asins, marketplaceId: source.marketplaceId }) : await client.getCompetitiveSummary({ asins: policy.asins, marketplaceId: source.marketplaceId }); body = result.body; rawBody = result.rawBody;
    } else if (state.stage === "CREATING") body = await client.createObservationReport(observationReportSpec(policy, source.marketplaceId));
    else if (state.stage === "POLL") body = await client.getReport(state.reportId!);
    else if (state.stage === "DOCUMENT") body = await client.getReportDocument(state.documentId!);
    else if (state.stage === "DOWNLOAD") { rawBody = archivedDownload ?? await client.downloadReportText(state.document, policy.resource === "brand_analytics" ? { timeoutMs: 90_000 } : {}); body = null; }
    else throw new SyncInputError("观察任务阶段无效。");
    if (!rawBody) rawBody = JSON.stringify(body);
  } catch (error) {
    await persistOrderRequests(run, events, bucketKey, policy.requestsPerSecond, new Date(), error);
    // A definite 429 means create was rejected. All uncertain outcomes retain intent.
    if (state.stage === "CREATING" && error instanceof AmazonSpApiError && error.status === 429 || state.stage === "DOWNLOAD" && error instanceof AmazonSpApiError && [403, 404].includes(error.status ?? 0)) {
      state.stage = state.stage === "CREATING" ? "CREATE" : "DOCUMENT"; delete state.document;
      await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run); await saveState(tx, state); });
      await yieldSlice(run, new Date(Date.now() + Math.max(60_000, error instanceof AmazonSpApiError ? error.retryAfterMs : 0))); return;
    }
    throw error;
  }
  if (archivedDownload === undefined) await persistOrderRequests(run, events, bucketKey, policy.requestsPerSecond, new Date());
  const capturedAt = new Date();
  // Archive before validation, including rejected contracts; never expose raw data.
  if (Buffer.byteLength(rawBody, "utf8") > 4 * 1024 * 1024) throw new SyncInputError("Amazon 单次观察响应超过 4 MiB 限制；保留旧版本。", 413);
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) throw new SyncFenceLost();
    if (archivedDownload === undefined) await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page: state.requests, resource: run.resource, requestMetadata: { operation, ...(manifest ? { batchIndex: Math.floor(state.planIndex / 100), objectIndex: state.planIndex } : {}) }, rawCiphertext: seal({ rawBody }, scope, `${run.id}:${state.requests}`, "amazon-observation-raw.v1"), bodySha256: digest(rawBody), capturedAt } });
  });
  const result = advanceObservation(policy, state, body, { rawBody, marketplaceId: source.marketplaceId, sellerId: auth.amazonSellerId });
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) throw new SyncFenceLost();
    if (run.processedCount + result.rows.length > policy.maxRows) throw new SyncInputError("观察记录超过审批行数预算。");
    let inserted = 0;
    const normalized = deduplicateFacts(result.rows, policy.maxRows);
    for (let offset = 0; offset < normalized.length; offset += 500) {
      const batch = normalized.slice(offset, offset + 500).map(row => ({ ...scope, sourceId: source.id, sourceRunId: run.id, id: digest([run.id, row.kind, row.businessKey]), ...row, facts: row.facts as Prisma.InputJsonValue, capturedAt }));
      const existing = new Map((await tx.amazonDomainObservation.findMany({ where: { ...scope, sourceRunId: run.id, id: { in: batch.map(row => row.id) } }, select: { id: true, facts: true } })).map(row => [row.id, row.facts]));
      for (const row of batch) if (existing.has(row.id) && canonical(existing.get(row.id)) !== canonical(row.facts)) throw new SyncInputError("重复观察业务键存在冲突，拒绝发布。");
      inserted += (await tx.amazonDomainObservation.createMany({ data: batch, skipDuplicates: true })).count;
    }
    await saveState(tx, result.state);
    Object.assign(run, await tx.amazonSyncRun.update({ where: { id: run.id }, data: { pagesCompleted: { increment: 1 }, processedCount: { increment: result.rows.length }, insertedCount: { increment: inserted }, skippedCount: { increment: result.rows.length - inserted } } }));
    await log(tx, run, "OBSERVATION_SLICE_COMMITTED");
  });
  state = result.state;
  await yieldSlice(run, new Date(Date.now() + (state.stage === "POLL" ? 60_000 : 0)));
}
