import { amazonDataAccess, assertSellerAccess, sellerAccessWhere } from "./data-access";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { assertChangePermission } from "./change-approval";
import { scopeLock } from "./service";
import { parseSalesQuery, readSalesTraffic } from "./sales-query";
import { canonical } from "./approval-policy";
import { requiredText, syncCenterEnabled, SyncInputError, type SyncScope } from "./policy";

export async function assertExportAccess(tx: Prisma.TransactionClient, scope: SyncScope, actor: string) {
  if (!syncCenterEnabled(scope)) throw new SyncInputError("同步中心已关闭。", 409);
  await assertChangePermission(scope, actor, "view", tx);
  await assertChangePermission(scope, actor, "export", tx);
}
export async function assertExportJobAccess(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, query: Prisma.JsonValue) {
  await assertExportAccess(tx, scope, actor);
  const access = await amazonDataAccess(scope, actor, tx, "export"), frozen = query as Record<string, unknown>;
  if (Array.isArray(frozen._scopeSourceIds)) {
    if (frozen._scopeSourceIds.some(id => typeof id !== "string")) throw new SyncInputError("导出范围无效。", 403);
    const sources = await tx.amazonSyncDataSource.findMany({ where: { AND: [scope, sellerAccessWhere(access), { id: { in: frozen._scopeSourceIds as string[] } }] }, select: { id: true } });
    if (sources.length !== frozen._scopeSourceIds.length) throw new SyncInputError("导出原始站点授权已撤销。", 403);
    return;
  }
  // Legacy exports lack a site fence and must be recreated by restricted members.
  if (!access.allSellers && access.scopes) throw new SyncInputError("旧导出缺少站点范围，请重新申请。", 403);
  if (frozen._scopeAll === true) { if (!access.allSellers) throw new SyncInputError("导出原始范围授权已撤销。", 403); return; }
  if (!Array.isArray(frozen._scopeSellerIds) || frozen._scopeSellerIds.some(id => typeof id !== "string")) throw new SyncInputError("导出缺少冻结范围授权，请重新申请。", 403);
  if (!access.allSellers && frozen._scopeSellerIds.some(id => !access.sellerIds.includes(id as string))) throw new SyncInputError("导出原始 Seller 授权已撤销。", 403);
}
export async function requestSalesExport(scope: SyncScope, actor: string, body: Record<string, unknown>) {
  if (process.env.QUEUE_DRIVER !== "redis") throw new SyncInputError("导出需要 Redis Worker，不能在请求内执行。", 503);
  const key = requiredText(body.idempotencyKey, "幂等键", 160);
  const cutoff = body.asOf === undefined ? new Date() : new Date(String(body.asOf));
  if (!Number.isFinite(cutoff.getTime()) || cutoff > new Date()) throw new SyncInputError("导出数据版本时间无效。");
  if (!body.filters || typeof body.filters !== "object" || Array.isArray(body.filters)) throw new SyncInputError("缺少导出筛选条件。");
  const filters = body.filters as Record<string, unknown>;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) { if (typeof v !== "string") throw new SyncInputError("导出筛选格式无效。"); if (v) params.set(k, v); }
  const filtersQuery = JSON.parse(JSON.stringify(parseSalesQuery(params))) as Prisma.InputJsonObject;
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertExportAccess(tx, scope, actor);
    if (typeof filtersQuery.sellerAccountId === "string") await assertSellerAccess(scope, actor, [filtersQuery.sellerAccountId], tx, "export");
    const access = await amazonDataAccess(scope, actor, tx, "export");
    const sources = await tx.amazonSyncDataSource.findMany({ where: { AND: [scope, sellerAccessWhere(access), { resource: "sales_traffic", ...(typeof filtersQuery.sellerAccountId === "string" ? { sellerAccountId: filtersQuery.sellerAccountId } : {}), ...(typeof filtersQuery.marketplaceId === "string" ? { marketplaceId: filtersQuery.marketplaceId } : {}) }] }, select: { id: true }, take: 201 });
    if (sources.length > 200) throw new SyncInputError("导出数据源超过安全上限。", 409);
    const query: Prisma.InputJsonObject = { ...filtersQuery, _scopeSourceIds: sources.map(s => s.id).sort(), _scopeAll: access.allSellers && !filtersQuery.sellerAccountId, _scopeSellerIds: typeof filtersQuery.sellerAccountId === "string" ? [filtersQuery.sellerAccountId] : [...access.sellerIds].sort() };
    const prior = await tx.amazonDataExport.findUnique({ where: { organizationId_workspaceId_requestedByUserId_idempotencyKey: { ...scope, requestedByUserId: actor, idempotencyKey: key } } });
    if (prior) { if (canonical(prior.query) !== canonical(query) || (body.asOf !== undefined && prior.cutoff.getTime() !== cutoff.getTime())) throw new SyncInputError("导出幂等键已用于其他筛选。", 409); return { id: prior.id, status: prior.status }; }
    const job = await tx.amazonDataExport.create({ data: { ...scope, id: randomUUID(), requestedByUserId: actor, idempotencyKey: key, query, cutoff } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.data.export.requested", entityType: "AmazonDataExport", entityId: job.id, metadata: { workspaceId: scope.workspaceId, query, cutoff: job.cutoff.toISOString() } } });
    return { id: job.id, status: job.status };
  });
}
export async function dispatchSalesExports(scopes: SyncScope[], onlyIds?: string[], enqueue = async (job: { id: string; fence: number }) => { await getAmazonSyncQueue().add("export-amazon-sales", { runId: job.id, exportId: job.id, fence: job.fence }, { jobId: `adc-export-${job.id}-${job.fence}`, attempts: 1, removeOnComplete: true, removeOnFail: true }); }) {
  if (!scopes.length || onlyIds?.length === 0) return;
  // Recovery and dispatch have independent bounds: live long exports cannot hide queued work.
  const expired = await prisma.amazonDataExport.findMany({ where: { OR: scopes, ...(onlyIds ? { id: { in: onlyIds } } : {}), status: "RUNNING", leaseExpiresAt: { lt: new Date() } }, orderBy: [{ leaseExpiresAt: "asc" }, { id: "asc" }], take: 20 });
  for (const job of expired) await prisma.amazonDataExport.updateMany({ where: { id: job.id, status: "RUNNING", fence: job.fence, leaseExpiresAt: { lt: new Date() } }, data: { status: "QUEUED", leaseExpiresAt: null, fence: { increment: 1 } } });
  const jobs = await prisma.amazonDataExport.findMany({ where: { OR: scopes, ...(onlyIds ? { id: { in: onlyIds } } : {}), status: "QUEUED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20 });
  for (const job of jobs) {
    await enqueue(job);
  }
}
export async function processSalesExport(id: string, fence: number) {
  const candidate = await prisma.amazonDataExport.findUnique({ where: { id } });
  if (!candidate || candidate.status !== "QUEUED" || candidate.fence !== fence) return;
  const scope = { organizationId: candidate.organizationId, workspaceId: candidate.workspaceId };
  const claimed = await prisma.amazonDataExport.updateMany({ where: { id, status: "QUEUED", fence }, data: { status: "RUNNING", leaseExpiresAt: new Date(Date.now() + 5 * 60_000) } });
  if (!claimed.count) return;
  let storedKey: string | undefined;
  try {
    await prisma.$transaction(tx => assertExportJobAccess(tx, scope, candidate.requestedByUserId, candidate.query));
    const params = new URLSearchParams(Object.entries(candidate.query as Record<string, unknown>).filter(([key, value]) => !key.startsWith("_") && typeof value === "string") as Array<[string, string]>), lines: string[] = [];
    lines.push(JSON.stringify({ type: "manifest", organizationId: scope.organizationId, workspaceId: scope.workspaceId, domain: "sales_traffic", dateField: "report_business_date", granularity: "SELLER_DAY", filters: candidate.query, asOf: candidate.cutoff.toISOString(), versionPolicy: (candidate.query as Record<string, unknown>).taskId ? "historical_task" : "latest_successful_per_source_day" }));
    let count = 0, bytes = Buffer.byteLength(lines[0]) + 1;
    for (let page = 1; ; page++) {
      params.set("page", String(page));
      const result = await readSalesTraffic(scope, params, { cutoff: candidate.cutoff, pageSize: 1000, action: "export", sourceFence: (candidate.query as Record<string, string[]>)._scopeSourceIds, actor: candidate.requestedByUserId, sellerFence: (candidate.query as Record<string, unknown>)._scopeAll === true ? undefined : (candidate.query as Record<string, string[]>)._scopeSellerIds });
      if (result.pagination.total > 100_000) throw new SyncInputError("导出超过 100,000 行，请缩小日期或店铺范围。");
      for (const row of result.rows) { const line = JSON.stringify({ type: "data", ...row }); bytes += Buffer.byteLength(line) + 1; if (bytes > 64 * 1024 * 1024) throw new SyncInputError("导出超过 64 MB，请缩小范围。"); lines.push(line); count++; }
      if (page >= result.pagination.pageCount) break;
      await prisma.$transaction(tx => assertExportJobAccess(tx, scope, candidate.requestedByUserId, candidate.query));
      const renewed = await prisma.amazonDataExport.updateMany({ where: { id, status: "RUNNING", fence }, data: { leaseExpiresAt: new Date(Date.now() + 5 * 60_000) } });
      if (!renewed.count) throw new Error("Export fence lost");
    }
    const fileId = randomUUID(), storageKey = `amazon-data-exports/${scope.organizationId}/${scope.workspaceId}/${id}/${fence}.jsonl`;
    const stored = await getStorageDriver().putBuffer({ key: storageKey, buffer: Buffer.from(lines.join("\n") + "\n"), contentType: "application/x-ndjson" });
    storedKey = storageKey;
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertExportJobAccess(tx, scope, candidate.requestedByUserId, candidate.query);
      const changed = await tx.amazonDataExport.updateMany({ where: { id, ...scope, status: "RUNNING", fence, leaseExpiresAt: { gt: new Date() } }, data: { rowCount: count, status: "SUCCEEDED", finishedAt: new Date(), leaseExpiresAt: null } });
      if (!changed.count) throw new Error("Export fence lost");
      await tx.fileObject.create({ data: { id: fileId, ...scope, userId: candidate.requestedByUserId, originalName: `amazon-sales-${id}.jsonl`, mimeType: "application/x-ndjson", size: stored.size, storageType: getStorageType(), storageKey } });
      await tx.amazonDataExport.update({ where: { id }, data: { fileId } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: candidate.requestedByUserId, action: "amazon.data.export.succeeded", entityType: "AmazonDataExport", entityId: id, metadata: { workspaceId: scope.workspaceId, rowCount: count, fileId, cutoff: candidate.cutoff.toISOString() } } });
    });
  } catch (error) {
    if (storedKey) await getStorageDriver().delete(storedKey).catch(() => undefined);
    await prisma.$transaction(async tx => {
      const changed = await tx.amazonDataExport.updateMany({ where: { id, ...scope, status: "RUNNING", fence }, data: { status: "FAILED", error: error instanceof SyncInputError ? error.message : "导出失败；数据或权限已变化，请重新申请。", finishedAt: new Date(), leaseExpiresAt: null } });
      if (changed.count) await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: candidate.requestedByUserId, action: "amazon.data.export.failed", entityType: "AmazonDataExport", entityId: id, metadata: { workspaceId: scope.workspaceId, code: "EXPORT_FAILED" } } });
    });
  }
}
