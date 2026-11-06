import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, sourceAccessWhere } from "./data-access";
import { isObservationResource } from "./observation-policy";
import { SyncInputError, type SyncScope } from "./policy";
export async function readObservations(scope: SyncScope, params: URLSearchParams, actor?: string) {
  const resource = params.get("resource"); if (!resource || !isObservationResource(resource)) throw new SyncInputError("观察域无效。");
  for (const key of ["sourceId", "sellerAccountId", "marketplaceId", "asin", "sellerSku", "searchTerm", "kind", "runId"]) if ((params.get(key)?.length ?? 0) > 5000) throw new SyncInputError("筛选超出长度限制。");
  const access = await amazonDataAccess(scope, actor);
  const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, ...sourceAccessWhere(access), resource, ...(params.get("sellerAccountId") ? { sellerAccountId: params.get("sellerAccountId")! } : {}), ...(params.get("marketplaceId") ? { marketplaceId: params.get("marketplaceId")! } : {}) }, select: { id: true, sellerAccountId: true, marketplaceId: true, activeRunId: true, coverage: true, lastSuccessAt: true, seller: { select: { displayName: true } } }, orderBy: { id: "asc" }, take: 201 });
  if (sources.length > 200) throw new SyncInputError("数据源超出试点容量。", 409);
  const source = params.get("sourceId") ? sources.find(s => s.id === params.get("sourceId")) : sources[0];
  if (params.get("sourceId") && !source) throw new SyncInputError("数据源不可访问。", 403);
  const runId = params.get("runId") || source?.activeRunId;
  const run = runId && source ? await prisma.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, id: runId, resource, status: "SUCCEEDED", stage: { not: "PURGED" }, finishedAt: { not: null }, executionVersion: 2 }, select: { id: true, finishedAt: true, summary: true } }) : null;
  if (params.get("runId") && !run) throw new SyncInputError("已发布观察版本不可访问。", 403);
  const page = Math.min(1000, Math.max(1, Math.floor(Number(params.get("page")) || 1))), pageSize = 50;
  const where = { task: { id: { in: run ? [run.id] : [] } }, ...scope, sourceId: source?.id ?? "__none__", sourceRunId: run?.id ?? "__none__", ...Object.fromEntries(["asin", "sellerSku", "searchTerm", "kind"].filter(key => params.get(key)).map(key => [key, params.get(key)!])) };
  const [rows, total, versions, latestTask] = await Promise.all([
    prisma.amazonDomainObservation.findMany({ where, select: { id: true, sourceRunId: true, kind: true, asin: true, sellerSku: true, searchTerm: true, facts: true, capturedAt: true }, orderBy: [{ kind: "asc" }, { id: "asc" }], take: pageSize, skip: (page - 1) * pageSize }),
    prisma.amazonDomainObservation.count({ where }),
    source ? prisma.amazonSyncRun.findMany({ where: { ...scope, sourceId: source.id, resource, status: "SUCCEEDED", stage: { not: "PURGED" }, finishedAt: { not: null }, executionVersion: 2 }, select: { id: true, finishedAt: true, summary: true }, orderBy: [{ finishedAt: "desc" }, { id: "desc" }], take: 100 }) : [],
    source ? prisma.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, resource, executionVersion: 2 }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], select: { id: true, status: true, stage: true, processedCount: true, failedCount: true, updatedAt: true, nextAttemptAt: true, error: true } }) : null,
  ]);
  return { resource, latestTask, sources, source: source ?? null, run, versions, rows, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
}
