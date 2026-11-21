import { createSnapshotProcessor } from './snapshot-processor';
import { isInventoryReport } from "./inventory-report-contracts";
import { assertAmazonCloudExecution } from "@/lib/amazon/execution-role";
import { assertAutomaticBrandTask } from "./automatic-brand";
import { automaticAdapter } from "./automatic-adapters";
import { recordReportParseEvidence } from "./report-parse-evidence";
import { assertBuyBoxTaskPolicy } from "./buy-box-history";
import { archiveResponse } from "./response-evidence";
import { assertBrandTaskPolicy } from "./brand-collection";
import { continuityEvidence } from "./continuity-access";
import { assertProductDiscoveryHead, validateProductManifest } from "./product-discovery";
import { settlementScope, assertFrozenSettlementScope } from "./settlement-scope";
import { createReportProcessor } from "./reports-processor";
import { isObservationResource, parseObservationPolicy, assertObservationRoles, assertObservationClosed } from "./observation-policy";
import { assertReturnSourcePolicy, createReturnProcessor } from "./returns-processor";
import { sellerArchivePolicy, assertSellerArchiveTarget } from "./seller-archive-policy";
import { assertDomainReportRoles, domainReportRunWindow, type DomainReportResource } from "./domain-reports";
import { assertExecutionWindow } from "./execution-window";
import { automaticPlanKey, automaticMarketplaceAllowed, isAutomaticResource, shouldRetrySyncFailure } from "./automatic-schedule";
import { assertFinanceScope } from "./finance-scope";
import { parseFinancePolicy } from "./finance";
import { createFinanceProcessor } from "./finance-processor";
import { isAmazonScopeAdmin, assertSellerMarketplaceAccess } from "./data-access";
import { randomUUID } from "node:crypto";
import { Prisma, type AmazonSyncRun } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { AmazonSpApiClient, AmazonSpApiError, type AmazonRequestEvent, type AmazonSpApiClientOptions } from "@/lib/amazon/sp-api-client";
import { decryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { withAmazonSyncLock } from "@/lib/operations/sync-lock";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";
import { implementedDomain, incrementalFailureCode, officialEndpoint, retryDelay, syncCenterEnabled, SyncInputError, type SyncScope } from "./policy";
import { scopeLock, syncIncrementalCursorStatus } from "./service";
import { canonical, digest } from "./approval-policy";
import { targetEnvironment } from "./approval-policy";
import { defaultRolePermissionMap, type RolePermissionMap } from "@/lib/accounts/permissions";
import { normalizeRolePermissions } from "@/lib/accounts/role-permissions-utils";
import { createOrderProcessor } from './orders-processor';
import { createDomainReportProcessor } from './domain-reports-processor';
import { createObservationProcessor } from './observation-processor';

const leaseMs = 5 * 60_000, maxPages = 1000, maxRows = 50000;
export class SyncFenceLost extends Error {}
class SyncPreflightRejected extends Error {}





export function classifySyncFailure(error: unknown): { code: string; retryable: boolean; message: string; retryAfterMs: number } {
  // A transient database failure must preserve the archive/checkpoint for the
  // next worker, rather than become a terminal response-validation failure.
  const databaseCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code
    : error instanceof Prisma.PrismaClientInitializationError ? error.errorCode : undefined;
  // Prisma's pg adapter wraps terminated ORM connections in P2039; the
  // PostgreSQL SQLSTATE is nested in driverAdapterError.cause, not meta.code.
  const adapterCause = error instanceof Prisma.PrismaClientKnownRequestError
    ? (error.meta?.driverAdapterError as { cause?: { originalCode?: unknown; code?: unknown } } | undefined)?.cause : undefined;
  const sqlCode = (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" ? error.meta?.code : undefined)
    ?? adapterCause?.originalCode ?? adapterCause?.code;
  if (databaseCode && ["P1001", "P1002", "P1008", "P1017", "P2024", "P2034"].includes(databaseCode)
    || typeof sqlCode === "string" && ["40001", "40P01", "57P01", "57P02", "57P03", "08006"].includes(sqlCode)) {
    return { code: "DATABASE_TRANSIENT", retryable: true, message: "数据库暂时不可用；保留原件和检查点，自动退避恢复。", retryAfterMs: 1000 };
  }
  if (error instanceof AmazonSpApiError) {
    // Report-document content failures happen AFTER a successful (2xx) download.
    // They are data/contract problems, not authorization or pagination-token
    // rejections; route them to their own code with official remediation guidance.
    if (error.upstreamCode === "REPORT_TOO_LARGE") return {
      code: "REPORT_TOO_LARGE", retryable: false,
      message: "报告已下载成功，但解压后超过本系统有界大小上限，重试同一报告无法成功。此组合（通常是全站点搜索词类报告）不适合当前有界采集；自动调度将跳到下一个已批准的报告类型/周期。这不是授权或分页 token 问题。",
      retryAfterMs: 0,
    };
    const reportContentCodes = ["REPORT_CHARSET_UNSUPPORTED", "REPORT_CHARSET_MISMATCH", "REPORT_JSON_ENCODING", "REPORT_JSON_INVALID"];
    if (error.upstreamCode && reportContentCodes.includes(error.upstreamCode)) return {
      code: "REPORT_CONTENT", retryable: false,
      message: `报告已下载成功，但内容处理失败（${error.upstreamCode}）。这不是授权或分页 token 问题。请按 Amazon《Retrieve a report》文档核对报告文档的字符集/压缩与完整性；重新执行该任务会按检查点重新获取报告文档并解析，不会重复扣费。`,
      retryAfterMs: 0,
    };
    // Only the S3 document download tags REPORT_URL_EXPIRED. A plain HTTP 403
    // from a Reports/Orders SP-API endpoint is a real authorization/role problem
    // and must stay API_REJECTED so authorization-recovery can detect it.
    if (error.upstreamCode === "REPORT_URL_EXPIRED") return {
      code: "REPORT_URL_EXPIRED", retryable: true,
      message: "报告文档下载地址已过期（Amazon 预签名 URL 仅 5 分钟有效）。将按官方流程重新调用 getReportDocument 获取新地址后重试，无需重新生成报告。",
      retryAfterMs: error.retryAfterMs || 1000,
    };
    return { code: error.status === 429 ? "THROTTLE" : error.authorizationRejected ? "AUTH" : error.retryable ? "TRANSIENT" : "API_REJECTED", retryable: error.retryable,
      message: error.status === 429 ? "Amazon 请求限流，按退避策略重试。" : error.authorizationRejected ? "Amazon 授权不可用（HTTP 401/403），请重新完成 OAuth 授权并核对开发者档案的 API 角色。" : error.retryable ? "Amazon 网络或服务暂时异常，按检查点重试。" : "Amazon 拒绝请求（非限流、非授权）：请核对请求参数、报告周期是否完整闭合、站点与角色资格；分页场景请确认 nextToken 未过期且未跨窗口复用。旧 token 需从完成快照重新开始。", retryAfterMs: error.retryAfterMs };
  }
  return { code: "VALIDATION_OR_CONFIGURATION", retryable: false, message: "同步配置、响应完整性或检查点校验失败；未发布新快照。请核对数据源及授权后重试。", retryAfterMs: 0 };
}
async function assertActor(run: AmazonSyncRun) {
  if (!await assertWorkspaceAccess(run.organizationId, run.workspaceId, run.requestedByUserId)) throw new Error("任务工作区不再可用。");
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
  if (run.resource === "notifications" && (!actorMember || !isAmazonScopeAdmin(actorMember.role))) throw new SyncPreflightRejected("卖家级通知采集需要组织管理员权限。未请求 Amazon。");
  if (!actorMember || actorMember.user.status !== "active" || !roleCanPerformAction(actorMember.role, "operations", "create", rolePermissions) || (grant?.operation === "control-task" && !roleCanPerformAction(actorMember.role, "operations", "edit", rolePermissions))) throw new SyncPreflightRejected("任务操作人权限已变化。");
  if (scheduled && (!["owner", "database_admin"].includes(actorMember.role) || !roleCanPerformAction(actorMember.role, "operations", "approve", rolePermissions))) throw new SyncPreflightRejected("自动计划管理员权限已变化。");
  const frozen = run.frozenScope as { sourceId?: string; sourceRevision?: number; authorizationId?: string; authorizationRevision?: number; amazonSellerId?: string; sellerAccountId?: string; marketplaceId?: string; resource?: string; region?: string; endpoint?: string; scheduleId?: string; scheduleRevision?: number } | null;
  const frozenDigest = frozen ? digest(frozen) : "";
  if ((scheduled ? !schedule : !grant) || !approverStillAuthorized || !frozen || frozenDigest !== run.frozenScopeDigest || (scheduled && (frozen.scheduleId !== run.scheduleId || frozen.scheduleRevision !== run.scheduleRevision || !isAutomaticResource(run.resource) || !automaticMarketplaceAllowed(run.resource, frozen.marketplaceId ?? "")))) throw new SyncPreflightRejected("执行审批或固定目标范围已失效。");
  const source = await tx.amazonSyncDataSource.findFirst({ where: { id: run.sourceId!, organizationId: run.organizationId, workspaceId: run.workspaceId, ...(!scheduled ? { enabled: true } : {}) }, include: { authorization: true, seller: true } });
  if (!source || !source.enabled || source.id !== frozen.sourceId || source.revision !== frozen.sourceRevision || source.authorizationId !== frozen.authorizationId || source.sellerAccountId !== frozen.sellerAccountId || source.marketplaceId !== frozen.marketplaceId || source.resource !== frozen.resource || source.resource !== run.resource || (!scheduled && source.seller.status !== "active") || source.authorization.status !== "CONFIGURED" || source.authorization.amazonSellerId !== frozen.amazonSellerId || source.authorization.revision !== frozen.authorizationRevision || source.authorization.revision !== run.authorizationRevision) throw new SyncPreflightRejected("数据源或授权在同步期间改变。");
  if (automaticAdapter(run.resource)?.publicationMode === "snapshot" && source.activeRunId && source.activeRunId !== run.id) {
    const published = await tx.amazonSyncRun.findFirst({ where: { organizationId: run.organizationId, workspaceId: run.workspaceId,
      id: source.activeRunId, sourceId: source.id, executionVersion: 2, status: { in: ["SUCCEEDED", "PARTIAL_SUCCESS"] } }, select: { startedAt: true } });
    if (published && published.startedAt >= run.startedAt) throw new SyncPreflightRejected("该快照任务已被较新发布版本取代；原件保留，不再请求或发布。");
  }
  if ((isInventoryReport(run.resource) || ["orders", "finance", "returns", "settlements", "reimbursements", "inventory_age", "long_term_storage_fees", "removal_shipment_report", "fba_shipments", "fba_customer_sales", "mfn_returns", "inventory_events", "removal_order_report"].includes(run.resource)) && (source.authorization.awsRegion !== frozen.region || source.authorization.endpoint !== frozen.endpoint)) throw new SyncPreflightRejected("授权区域与已批准范围不匹配。");
  try {
    await assertSellerMarketplaceAccess(run, run.requestedByUserId, source.sellerAccountId, source.marketplaceId, tx, "sync", scheduled);
    if (!scheduled) await assertSellerMarketplaceAccess(run, grant!.approvedByUserId!, source.sellerAccountId, source.marketplaceId, tx, "sync");
  } catch { throw new SyncPreflightRejected("任务或审批人的 Seller 授权已撤销。"); }
  if (isInventoryReport(run.resource)) assertDomainReportRoles(run.resource, source.authorization);
  if (run.resource === "finance") {
    try {
      const { policy } = await assertFinanceScope(tx, run, source, scheduled ? [run.requestedByUserId] : [run.requestedByUserId, grant!.approvedByUserId!], scheduled);
      const approved = run.frozenScope as { financePolicy?: unknown };
      if (digest(policy) !== digest(parseFinancePolicy(approved.financePolicy))) throw new Error();
    } catch { throw new SyncPreflightRejected("财务角色、卖家级站点集合或审批策略已变化。"); }
  }
  if (run.resource === "returns") {
    try {
      assertReturnSourcePolicy(run, source, scheduled);
    } catch { throw new SyncPreflightRejected("退货角色、站点或冻结策略已变化。"); }
  }
  if (["settlements", "reimbursements", "inventory_age", "long_term_storage_fees", "removal_shipment_report", "fba_shipments", "fba_customer_sales", "mfn_returns", "inventory_events", "removal_order_report"].includes(run.resource)) {
    try {
      const resource = run.resource as DomainReportResource;
      const archivePolicy = sellerArchivePolicy(resource, source.domainPolicy);
      const frozenArchive = (run.frozenScope as { sellerArchivePolicy?: unknown }).sellerArchivePolicy;
      if (digest(archivePolicy) !== digest(frozenArchive)) throw new Error();
      if (archivePolicy) { assertSellerArchiveTarget(run, source.marketplaceId); if (!source.authorization.identityVerifiedAt || !["owner", "database_admin"].includes(actorMember.role)) throw new Error(); }
      assertDomainReportRoles(resource, source.authorization, run.trigger === "schedule" || !!archivePolicy);
      if (["settlements", "inventory_events", "reimbursements", "removal_order_report", "removal_shipment_report", "fba_shipments", "mfn_returns", "long_term_storage_fees"].includes(resource)) domainReportRunWindow(resource, (run.frozenScope as { reportWindow?: unknown }).reportWindow);
      if (!extractMarketplaceParticipations({ payload: source.authorization.marketplaceParticipations }).some(m => m.marketplaceId === source.marketplaceId)) throw new Error();
      if (resource === "settlements" && source.settlementPolicy) assertFrozenSettlementScope(await settlementScope(tx, { organizationId: run.organizationId, workspaceId: run.workspaceId }, source, scheduled ? [run.requestedByUserId] : [run.requestedByUserId, grant!.approvedByUserId!]), (run.frozenScope as { settlement?: unknown }).settlement);
    } catch { throw new SyncPreflightRejected("报告角色、站点资格或冻结范围已变化。未请求 Amazon。"); }
  }
  if (isObservationResource(run.resource)) {
    try {
      const p = parseObservationPolicy(source.domainPolicy, run.resource);
      if (p.resource === "promotions" && !extractMarketplaceParticipations({ payload: source.authorization.marketplaceParticipations }).some(site => site.marketplaceId === source.marketplaceId)) throw new SyncInputError("促销站点不属于当前 Amazon 授权。", 403);
      assertObservationRoles(p, source.authorization, { organizationId: run.organizationId, workspaceId: run.workspaceId, authorizationId: source.authorizationId, authorizationRevision: source.authorization.revision, marketplaceId: source.marketplaceId, currentEvidence: await continuityEvidence(tx, source) }); assertObservationClosed(p, new Date(), source.marketplaceId);
      const taskPolicy = parseObservationPolicy((run.frozenScope as { domainPolicy?: unknown }).domainPolicy, run.resource);
      if (p.resource === "brand_analytics" && p.automaticDiscovery && taskPolicy.resource === "brand_analytics") assertAutomaticBrandTask(p, taskPolicy);
      else if (p.resource === "brand_analytics" && p.collection && taskPolicy.resource === "brand_analytics") assertBrandTaskPolicy(p, taskPolicy);
      else if (scheduled && p.resource === "buy_box_history" && p.allAsins && taskPolicy.resource === "buy_box_history") assertBuyBoxTaskPolicy(p, taskPolicy);
      else if (digest(p) !== digest(taskPolicy)) throw new Error();
      if (source.authorization.awsRegion !== frozen.region || source.authorization.endpoint !== frozen.endpoint) throw new Error();
      if ((p.resource === "listing_details" || p.resource === "catalog_items" || p.resource === "pricing") && p.discovery) await assertProductDiscoveryHead(tx, { organizationId: run.organizationId, workspaceId: run.workspaceId }, source, validateProductManifest((run.frozenScope as { productManifest?: unknown }).productManifest, p));
    } catch (error) { throw new SyncPreflightRejected(error instanceof SyncInputError ? error.message : "观察域角色、站点或冻结策略已变化。"); }
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
  assertAmazonCloudExecution();
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
        const changed = await tx.amazonSyncRun.updateMany({ where: { id: candidate.id, organizationId: candidate.organizationId, workspaceId: candidate.workspaceId, dispatchVersion, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] } }, data: { status: "BLOCKED", error: error.message, finishedAt: new Date(), dispatchVersion: { increment: 1 } } });
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
    const client = new AmazonSpApiClient({ ...decryptAmazonSpApiCredentials(auth.credentialsCiphertext, { ...scope, authorizationId: auth.id }), region: auth.awsRegion, endpoint: auth.endpoint }, { ...runtime.clientOptions, ...(["orders", "finance", "returns", "settlements", "reimbursements", "inventory_age", "long_term_storage_fees", "removal_shipment_report", "fba_shipments", "fba_customer_sales", "mfn_returns", "inventory_events", "removal_order_report"].includes(run.resource) ? { cacheScope: canonical([scope, auth.id, auth.revision]) } : {}), onResponse: e => events.push(e),
      beforeRequest: async () => {
        await assertActor(run);
        const stopped = await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run); return stopForControl(tx, run); });
        if (stopped) throw new SyncFenceLost();
      },
      onErrorResponse: async response => {
        await prisma.$transaction(async tx => {
          await scopeLock(tx, scope); await assertFence(tx, run);
          const prior = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, page: { lt: 0 } }, orderBy: { page: "asc" }, select: { page: true } });
          await archiveResponse(tx, run, (prior?.page ?? 0) - 1, { operation: events.at(-1)?.operation ?? "unknown", evidence: "HTTP_ERROR", status: response.status, requestId: response.requestId }, response.rawBody);
        });
      } });
    const adapter = automaticAdapter(run.resource);
    if (!adapter) throw new SyncInputError("数据域没有已注册的执行适配器。", 422);
    if (adapter.executionKind === "observation") { await executeObservationSlice(run, client, events); return; }
    if (adapter.executionKind === "returns") { await executeReturnSlice(run, client, events); return; }
    if (adapter.executionKind === "domain_report") { await executeDomainReportSlice(run, client, events); return; }
    if (adapter.executionKind === "finance") { await executeFinanceSlice(run, client, events); return; }
    if (adapter.executionKind === "orders") { await executeOrderSlice(run, client, events); return; }
    if (adapter.executionKind === "report" || adapter.executionKind === "catalog" && !auth.amazonSellerId) {
      await executeReportSlice(run, client, events, auth.id, source.marketplaceId, source.sellerAccountId); return;
    }
    if (adapter.executionKind !== "catalog" && adapter.executionKind !== "inventory") throw new SyncInputError("已注册数据域缺少匹配的执行流水线。", 422);
    await executeSnapshotSlice(run, client, events, source);
  } catch (error) {
    if (error instanceof SyncFenceLost) return;
    const failure = ["orders", "finance", "returns", "settlements", "reimbursements", "inventory_age", "long_term_storage_fees", "removal_shipment_report", "fba_shipments", "fba_customer_sales", "mfn_returns", "inventory_events", "removal_order_report"].includes(run.resource) && error instanceof SyncInputError
      ? { code: incrementalFailureCode(run.resource, error.status), retryable: false, message: error.message, retryAfterMs: 0 }
      : classifySyncFailure(error);
  if ((isInventoryReport(run.resource) || ["orders", "finance", "returns", "settlements", "reimbursements", "inventory_age", "long_term_storage_fees", "removal_shipment_report", "fba_shipments", "fba_customer_sales", "mfn_returns", "inventory_events", "removal_order_report"].includes(run.resource)) && !(error instanceof SyncInputError)) failure.message = failure.retryable
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
      const retry = shouldRetrySyncFailure({ ...failure, trigger: run.trigger, attempts: run.attempts, maxAttempts: run.maxAttempts });
      if (failure.retryable && !retry) failure.message = run.trigger === "schedule"
        ? "本轮自动重试次数已用尽；保留原件、已提交页及游标，冷却后由调度器在当前授权范围内自动恢复。"
        : "本轮自动重试次数已用尽；已保留原件、已提交页及游标。须审阅失败原因并通过审批重试，不会自动从头采集。";
      await syncIncrementalCursorStatus(tx, run, retry ? "RETRY_WAIT" : "FAILED");
      const committedRun = await tx.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id }, select: { processedCount: true, insertedCount: true, summary: true, stage: true, pagesCompleted: true, detailsCompletedCount: true } });
      const archivedRawPages = run.sourceId ? await tx.amazonSyncRawPage.count({ where: { ...scope, taskId: run.id } }) : 0;
      if (["REPORT_PARSING", "RETURN_REPORT_PARSING", "RETURN_BATCH_COMMITTED"].includes(committedRun.stage) && ["catalog", "sales_traffic", "inventory_events", "reimbursements", "inventory_age", "long_term_storage_fees", "removal_shipment_report", "fba_shipments", "fba_customer_sales", "mfn_returns", "removal_order_report", "returns"].includes(run.resource)) {
        const raw = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, resource: run.resource, page: { gt: 0 } }, orderBy: { capturedAt: "desc" }, select: { page: true } });
        if (raw) await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage: raw.page, phase: "ATTEMPT_FAILED", rowsCommitted: committedRun.insertedCount, failureCode: failure.code, checkedAt: new Date() });
      }
      if (run.resource === "orders") {
        const page = committedRun.stage === "FETCHING_DETAILS" ? maxPages + committedRun.detailsCompletedCount + 1 : committedRun.pagesCompleted + 1;
        const raw = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, resource: "orders", page }, select: { page: true, requestMetadata: true } });
        const metadata = raw?.requestMetadata as Prisma.JsonObject | undefined;
        // A rejected/preflight HTTP attempt without a current original cannot
        // be labelled a parser failure of an earlier committed page.
        if (raw && metadata?.apiVersion === "2026-01-01" && ["searchOrders", "getOrder"].includes(String(metadata.operation))) await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage: page, phase: "ATTEMPT_FAILED", rowsCommitted: 0, failureCode: failure.code, checkedAt: new Date() });
      }
      const quality = { status: retry ? "RETRYING_PARTIAL" : "FAILED", code: failure.code, archivedRawPages, processedRows: committedRun.processedCount, insertedRows: committedRun.insertedCount, retryScheduled: retry, published: false };
      const priorSummary = committedRun.summary && typeof committedRun.summary === "object" && !Array.isArray(committedRun.summary) ? committedRun.summary as Prisma.JsonObject : {};
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: retry ? "RETRY_WAIT" : "FAILED", error: failure.message, summary: { ...priorSummary, quality }, failedCount: { increment: 1 }, finishedAt: retry ? null : new Date(), nextAttemptAt: new Date(Date.now() + retryDelay(run.attempts, failure.retryAfterMs)), leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
      if (run.sourceId) {
        const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: run.sourceId }, select: { coverage: true } });
        const coverage = source?.coverage && typeof source.coverage === "object" && !Array.isArray(source.coverage) ? source.coverage as Prisma.JsonObject : {};
        await tx.amazonSyncDataSource.updateMany({ where: { ...scope, id: run.sourceId, activeRunId: run.id }, data: { coverage: { ...coverage, latestQualityAttempt: quality } } });
      }
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


export const executeReportSlice = createReportProcessor({
  prisma, leaseMs, scopeLock, assertActor, assertFence, assertLiveSource, stopForControl, yieldSlice, log, persistRequests,
});

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

export { assertConsistentSnapshotRows } from "./snapshot-consistency";


const executeFinanceSlice = createFinanceProcessor({ prisma, maxPages, maxRows, scopeLock, assertActor, assertFence, assertLiveSource, stopForControl, yieldSlice, log, persistOrderRequests, fenceLost: () => new SyncFenceLost() });

/** Same live approval/source/site checks as execution; no privilege renewal. */
export async function assertAutomaticRecoveryAccess(tx: Prisma.TransactionClient, run: AmazonSyncRun) {
  if (run.trigger !== "schedule") throw new SyncInputError("仅自动计划任务可以自动恢复。", 403);
  return assertLiveSource(tx, run);
}

export async function assertFinanceParserRecoveryAccess(tx: Prisma.TransactionClient, run: AmazonSyncRun) {
  if (run.resource !== "finance") throw new SyncInputError("财务解析恢复范围无效。", 403);
  return assertLiveSource(tx, run);
}

/** Reports v2021-06-30 FBA Returns: one HTTP operation or one bounded DB batch.
 * https://developer-docs.amazon.com/sp-api/reference/createreport
 * https://developer-docs.amazon.com/sp-api/reference/getreport
 * https://developer-docs.amazon.com/sp-api/reference/getreportdocument
 * https://developer-docs.amazon.com/sp-api/docs/retrieve-a-report
 * This registered report is not restricted; arbitrary report types are rejected.
 */
const executeReturnSlice = createReturnProcessor({
  prisma, leaseMs, scopeLock, assertFence, assertLiveSource, stopForControl,
  yieldSlice, log, persistOrderRequests, fenceLost: () => new SyncFenceLost(),
});

const processorRuntime = { prisma, leaseMs, maxPages, maxRows, scopeLock, assertActor, assertFence, assertLiveSource, stopForControl, yieldSlice, log, persistRequests, persistOrderRequests, fenceLost: () => new SyncFenceLost(), preflightRejected: (message: string) => new SyncPreflightRejected(message) };
const executeOrderSlice = createOrderProcessor(processorRuntime);
const executeDomainReportSlice = createDomainReportProcessor(processorRuntime);
const executeObservationSlice = createObservationProcessor(processorRuntime);

const executeSnapshotSlice = createSnapshotProcessor(processorRuntime);
export { inventoryNextToken, sourceTimestamp, validateInventoryPage, validateCatalogPage, validateCatalogCompletion } from './snapshot-processor';
