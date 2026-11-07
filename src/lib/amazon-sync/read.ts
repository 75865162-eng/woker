import { amazonDataAccess, sourceAccessWhere } from "./data-access";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { safeState } from "./approval-policy";
import { inventorySnapshotStatus } from "@/lib/operations/readiness";
import { SyncInputError, isIncrementalResource, type SyncScope } from "./policy";

export type SnapshotScope = { runId: string; sellerAccountId?: string; marketplaceId?: string; freshnessMinutes?: number; capturedAt: Date | null };
export async function publishedSnapshotScopes(scope: SyncScope, resource: "inventory" | "catalog", actor?: string, target?: { sellerAccountId: string; marketplaceId: string }): Promise<SnapshotScope[]> {
  const allowed = sourceAccessWhere(await amazonDataAccess(scope, actor));
  const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, ...allowed, resource, enabled: true, publishedRun: { status: "SUCCEEDED", executionVersion: 2, resource, finishedAt: { not: null }, stage: { not: "PURGED" } }, activeRunId: { not: null }, ...(target ? { AND: [target] } : {}) }, select: { activeRunId: true, sellerAccountId: true, marketplaceId: true, lastSuccessAt: true, freshnessMinutes: true }, take: 201 });
  if (sources.length > 200) throw new SyncInputError("当前试点超过 200 个数据源，需要先完成容量评审。", 409);
  return sources.map(s => ({ runId: s.activeRunId!, sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId, capturedAt: s.lastSuccessAt, freshnessMinutes: s.freshnessMinutes }));
}
export function inventoryPublishedWhere(scope: SyncScope, heads: SnapshotScope[]): Prisma.AmazonInventorySnapshotWhereInput {
  return { ...scope, OR: heads.length ? heads.map(h => ({ syncRunId: h.runId, ...(h.sellerAccountId ? { sellerAccountId: h.sellerAccountId, marketplaceId: h.marketplaceId } : {}) })) : [{ syncRunId: "__no_published_snapshot__" }] };
}
export function catalogPublishedWhere(scope: SyncScope, heads: SnapshotScope[]): Prisma.AmazonCatalogSnapshotWhereInput {
  return { ...scope, OR: heads.length ? heads.map(h => ({ sourceRunId: h.runId, ...(h.sellerAccountId ? { sellerAccountId: h.sellerAccountId, marketplaceId: h.marketplaceId } : {}) })) : [{ sourceRunId: "__no_published_snapshot__" }] };
}
export function oldestSnapshot(heads: SnapshotScope[]) {
  const dates = heads.map(h => h.capturedAt).filter((d): d is Date => !!d);
  return dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
}
export function sourceHealth(source: { enabled: boolean; lastSuccessAt: Date | null; freshnessMinutes: number; activeRunId: string | null; authorization: { status: string }; seller: { status: string } }, status?: string) {
  if (!source.enabled) return "DISABLED";
  if (source.authorization.status !== "CONFIGURED" || source.seller.status !== "active") return "BLOCKED";
  if (status === "RUNNING" || status === "QUEUED" || status === "WAITING" || status === "RETRY_WAIT") return "SYNCING";
  if (status === "FAILED" || status === "BLOCKED" || status === "PARTIAL_SUCCESS") return status;
  return source.activeRunId ? inventorySnapshotStatus(source.lastSuccessAt, new Date(), source.freshnessMinutes) : "NOT_SYNCED";
}
const sourceInclude = { resourceCursor: { select: { resource: true, watermarkFrom: true, watermarkTo: true, status: true, lastSuccessAt: true, updatedAt: true } }, targets: { select: { schedule: { select: { enabled: true, nextRunAt: true } } } }, authorization: { select: { id: true, name: true, status: true, amazonSellerId: true, awsRegion: true, lastValidatedAt: true } }, seller: { select: { id: true, displayName: true, accountKey: true, status: true } } } satisfies Prisma.AmazonSyncDataSourceInclude;
export async function listSources(scope: SyncScope, filters: { sellerAccountId?: string; marketplaceId?: string; resource?: string } = {}, actor?: string) {
  const allowed = sourceAccessWhere(await amazonDataAccess(scope, actor));
  const sources = await prisma.amazonSyncDataSource.findMany({ where: { AND: [{ ...scope, ...filters }, allowed] }, include: sourceInclude, orderBy: { createdAt: "asc" }, take: 201 });
  if (sources.length > 200) throw new SyncInputError("数据源超过试点容量，需要容量评审。", 409);
  const latest = sources.length ? await prisma.amazonSyncRun.findMany({ where: { ...scope, executionVersion: 2, sourceId: { in: sources.map(s => s.id) } }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], distinct: ["sourceId"] }) : [];
  return sources.map(source => ({ ...source, orderPolicy: safeState(source.orderPolicy) as Prisma.JsonValue, domainPolicy: safeState(source.domainPolicy) as Prisma.JsonValue, resourceCursor: isIncrementalResource(source.resource) && source.resourceCursor ? { ...source.resourceCursor, hasIncompleteWindow: source.resourceCursor.status !== "SUCCEEDED" } : null, nextScheduledAt: source.targets.filter(t => t.schedule.enabled && t.schedule.nextRunAt).map(t => t.schedule.nextRunAt!).sort((a, b) => a.getTime() - b.getTime())[0] ?? null, latestTask: latest.find(t => t.sourceId === source.id) ? taskSummary(latest.find(t => t.sourceId === source.id)!) : null, health: sourceHealth(source, latest.find(t => t.sourceId === source.id)?.status) }));
}
/** Static advice only: no upstream error/body, cursor token or raw document. */
export function incrementalOperatorAction(resource: string, status: string) {
  if (!isIncrementalResource(resource)) return null;
  if (status === "BLOCKED") return "核对当前审批有效期、店铺站点及角色；完成必要验证后重新提交执行审批。";
  if (status === "FAILED") return "查看结构日志与失败阶段，核对参数或重试上限后申请恢复；报告创建结果不确定时先人工核查，勿重复创建。";
  if (status === "PAUSED") return "已保留增量窗口和检查点；经审批恢复后继续，勿重置游标。";
  if (status === "CANCELLED") return "本任务已结束；未完成窗口仍保留，核对绑定及审批后可申请新的任务。";
  if (status === "RETRY_WAIT") return "等待有限重试与持久限流预算，勿重复申请相同窗口或绕过退避。";
  return null;
}
// Whitelist output. Checkpoint ciphertext, leases and dispatch internals never leave the server.
export function taskSummary(t: { id: string; sourceId: string | null; resource: string; status: string; stage: string; trigger: string; mode: string; scheduleId: string | null; scheduleRevision: number | null; startedAt: Date; executionStartedAt: Date | null; finishedAt: Date | null; pagesCompleted: number; processedCount: number; insertedCount: number; updatedCount: number; skippedCount: number; apiRequests: number; throttles: number; attempts: number; maxAttempts: number; error: string | null; control: string | null; nextAttemptAt: Date; summary: unknown; frozenScope?: unknown; requestedByUserId?: string; failedCount?: number; detailsCompletedCount?: number }) {
  return { operatorAction: incrementalOperatorAction(t.resource, t.status), returnWindow: (t.frozenScope as { returnWindow?: unknown } | null)?.returnWindow ?? null, financeWindow: (t.frozenScope as { financeWindow?: unknown } | null)?.financeWindow ?? null, detailsCompletedCount: t.detailsCompletedCount ?? 0, failedCount: t.failedCount ?? 0, orderWindow: (t.frozenScope as { orderWindow?: unknown } | null)?.orderWindow ?? null, requestedByUserId: t.requestedByUserId, requestedRange: (t.frozenScope as { requestedRange?: unknown } | null)?.requestedRange ?? null, id: t.id, sourceId: t.sourceId, resource: t.resource, status: t.status, stage: t.stage, trigger: t.trigger, mode: t.mode, scheduleId: t.scheduleId, scheduleRevision: t.scheduleRevision, queuedAt: t.startedAt, startedAt: t.executionStartedAt, finishedAt: t.finishedAt, elapsedMs: t.executionStartedAt && t.finishedAt ? t.finishedAt.getTime() - t.executionStartedAt.getTime() : null, pagesCompleted: t.pagesCompleted, processedCount: t.processedCount, insertedCount: t.insertedCount, updatedCount: t.updatedCount, skippedCount: t.skippedCount, apiRequests: t.apiRequests, throttles: t.throttles, attempts: t.attempts, maxAttempts: t.maxAttempts, error: t.error, control: t.control, nextAttemptAt: t.nextAttemptAt, summary: t.summary };
}
export function taskFilters(scope: SyncScope, p: URLSearchParams): Prisma.AmazonSyncRunWhereInput {
  const where: Prisma.AmazonSyncRunWhereInput = { ...scope, executionVersion: 2 };
  for (const key of ["sourceId", "resource", "status", "trigger", "scheduleId"] as const) if (p.get(key)) where[key] = p.get(key)!.slice(0, 200);
  if (p.get("sellerAccountId") || p.get("marketplaceId")) where.source = { ...(p.get("sellerAccountId") ? { sellerAccountId: p.get("sellerAccountId")! } : {}), ...(p.get("marketplaceId") ? { marketplaceId: p.get("marketplaceId")! } : {}) };
  const dates: { gte?: Date; lt?: Date } = {};
  for (const key of ["from", "to"] as const) {
    const v = p.get(key); if (!v) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw new SyncInputError("日期格式无效。");
    if (key === "from") dates.gte = new Date(v); else dates.lt = new Date(Date.parse(v) + 86400000);
  }
  if (dates.gte && dates.lt && dates.gte >= dates.lt) throw new SyncInputError("日期范围无效。");
  if (Object.keys(dates).length) where.startedAt = dates;
  return where;
}
export async function readTasks(scope: SyncScope, p: URLSearchParams, actor?: string) {
  const allowed = sourceAccessWhere(await amazonDataAccess(scope, actor));
  const where = { AND: [taskFilters(scope, p), { source: allowed }] }, page = Math.min(10000, Math.max(1, Math.floor(Number(p.get("page")) || 1))), pageSize = 30;
  const [total, rows] = await Promise.all([prisma.amazonSyncRun.count({ where }), prisma.amazonSyncRun.findMany({ where, orderBy: [{ startedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, include: { source: { select: { sellerAccountId: true, marketplaceId: true, seller: { select: { displayName: true, accountKey: true } } } } } })]);
  return { rows: rows.map(row => ({ ...taskSummary(row), scope: row.source })), pagination: { total, page, pageSize, pageCount: Math.ceil(total / pageSize) } };
}
export async function readOverview(scope: SyncScope, p: URLSearchParams, actor?: string) {
  const filters = { ...(p.get("sellerAccountId") ? { sellerAccountId: p.get("sellerAccountId")! } : {}), ...(p.get("marketplaceId") ? { marketplaceId: p.get("marketplaceId")! } : {}) };
  const sources = await listSources(scope, filters, actor);
  const base = taskFilters(scope, p); delete base.status; delete base.startedAt;
  const since = new Date(Date.now() - 86400000);
  const trend = await prisma.$queryRaw<Array<{ bucket: Date; succeeded: bigint; failed: bigint; apiRequests: bigint; throttles: bigint; averageDurationMs: number | null }>>(Prisma.sql`
    SELECT to_timestamp(floor(extract(epoch FROM "startedAt") / 7200) * 7200) AS bucket,
      count(*) FILTER (WHERE status = 'SUCCEEDED') AS succeeded,
      count(*) FILTER (WHERE status IN ('FAILED', 'BLOCKED')) AS failed,
      sum("apiRequests") AS "apiRequests", sum(throttles) AS throttles,
      avg(extract(epoch FROM ("finishedAt" - "executionStartedAt")) * 1000)::float AS "averageDurationMs"
    FROM "AmazonSyncRun" WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}
      AND "executionVersion" = 2 AND "startedAt" >= ${since}
      AND "sourceId" IN (${sources.length ? Prisma.join(sources.map(s => s.id)) : Prisma.sql`NULL`})
    GROUP BY bucket ORDER BY bucket
  `);
  const running = await prisma.amazonSyncRun.count({ where: { ...base, sourceId: { in: sources.map(s => s.id) }, status: "RUNNING" } });
  const expired = sources.filter(s => s.enabled && s.lastSuccessAt && Date.now() - s.lastSuccessAt.getTime() > s.freshnessMinutes * 60000).length;
  const connected = new Set(sources.filter(s => s.authorization.status === "CONFIGURED" && s.seller.status === "active").map(s => s.sellerAccountId));
  const successful = sources.map(s => s.lastSuccessAt).filter((v): v is Date => !!v);
  return { sources, metrics: { connectedStores: connected.size, connectedMarketplaces: new Set(sources.filter(s => s.authorization.status === "CONFIGURED").map(s => s.marketplaceId)).size, enabledDomains: new Set(sources.filter(s => s.enabled).map(s => s.resource)).size, running, issues: sources.filter(s => ["FAILED", "BLOCKED", "STALE", "PARTIAL_SUCCESS"].includes(s.health)).length, expired, lastSuccessAt: successful.length ? new Date(Math.max(...successful.map(v => v.getTime()))) : null }, trend: trend.map(t => ({ ...t, succeeded: Number(t.succeeded), failed: Number(t.failed), apiRequests: Number(t.apiRequests), throttles: Number(t.throttles) })), legacyActive: 0 };
}
