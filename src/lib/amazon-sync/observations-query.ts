import { observationBusinessFields } from "./observation-business-fields";
import { amazonAccountReadAccess } from "./read-account";
import type { Prisma } from "@prisma/client";
import { businessDate } from "./date-range";
import { queryPageSize } from "./query-page";
import { inboundIdentifier } from "./inbound";
import { prisma } from "@/lib/db/prisma";
import { sourceAccessWhere } from "./data-access";
import { isObservationResource } from "./observation-policy";
import { SyncInputError, type SyncScope } from "./policy";
export async function readObservations(scope: SyncScope, params: URLSearchParams, actor?: string, db: Prisma.TransactionClient = prisma) {
  params = new URLSearchParams(params);
  const resource = params.get("resource"); if (!resource || !isObservationResource(resource)) throw new SyncInputError("观察域无效。");
  if (resource === "promotions" && (!params.get("sellerAccountId") || !params.get("marketplaceId"))) throw new SyncInputError("促销查询必须显式指定单个 Seller Account 和 Marketplace。", 403);
  const inboundFilters: Prisma.AmazonDomainObservationWhereInput[] = [];
  for (const key of ["inboundPlanId", "shipmentId"] as const) {
    const value = params.get(key);
    if (!value) continue;
    if (resource !== "fulfillment") throw new SyncInputError("入库计划和货件筛选仅适用于 FBA Inbound。");
    try { inboundIdentifier(value); } catch { throw new SyncInputError("入库计划或货件标识无效。"); }
    inboundFilters.push({ facts: { path: [key], equals: value } });
  }
  if (resource === "promotions") {
    for (const key of ["promotionId", "selectionId", "revision", "trackingId", "status", "promotionType"]) {
      const value = params.get(key); if (!value) continue;
      if (value.length > 500) throw new SyncInputError("促销筛选无效。");
      const path = [key];
      inboundFilters.push({ facts: { path, equals: value } });
    }
  }
  for (const key of ["sourceId", "sellerAccountId", "marketplaceId", "asin", "sellerSku", "searchTerm", "kind", "runId"]) if ((params.get(key)?.length ?? 0) > 5000) throw new SyncInputError("筛选超出长度限制。");
  const access = await amazonAccountReadAccess(scope, actor, params, db, resource);
  params.set("sellerAccountId", access.sellerIds[0]);
  const sources = await db.amazonSyncDataSource.findMany({ where: { ...scope, ...sourceAccessWhere(access), resource, ...(params.get("sellerAccountId") ? { sellerAccountId: params.get("sellerAccountId")! } : {}), ...(params.get("marketplaceId") ? { marketplaceId: params.get("marketplaceId")! } : {}) }, select: { id: true, sellerAccountId: true, marketplaceId: true, activeRunId: true, rowCount: true, coverage: true, lastSuccessAt: true, seller: { select: { displayName: true } } }, orderBy: { id: "asc" }, take: 201 });
  if (sources.length > 200) throw new SyncInputError("数据源超出试点容量。", 409);
  const source = params.get("sourceId") ? sources.find(s => s.id === params.get("sourceId")) : resource === "listing_details" ? sources.find(s => s.activeRunId && s.rowCount > 0) ?? sources[0] : sources[0];
  if (params.get("sourceId") && !source) throw new SyncInputError("数据源不可访问。", 403);
  if (source) params.set("sourceId", source.id);
  const from = params.get("from") ? businessDate(params.get("from")) : undefined;
  const to = params.get("to") ? businessDate(params.get("to")) : undefined;
  if (from && to && from > to) throw new SyncInputError("日期范围无效。");
  if ((from || to) && resource !== "buy_box_history" && resource !== "promotions") throw new SyncInputError("该快照数据域不支持历史日期筛选。");
  if (resource === "promotions") {
    if (from) inboundFilters.push({ facts: { path: ["queryDates", "scheduleEndUtc"], gte: from + "T00:00:00.000Z" } });
    if (to) inboundFilters.push({ facts: { path: ["queryDates", "scheduleStartUtc"], lt: new Date(Date.parse(to + "T00:00:00Z") + 86400000).toISOString() } });
  }
  if ((from || to) && params.get("runId")) throw new SyncInputError("历史日期范围与指定版本不能同时使用。");
  const runId = params.get("runId") || source?.activeRunId;
  const published = { OR: [{ status: "SUCCEEDED", stage: { not: "PURGED" } }, { resource: "catalog_items", status: "PARTIAL_SUCCESS", stage: "PARTIAL_PUBLISHED" }] };
  const run = runId && source ? await db.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, id: runId, resource, ...published, finishedAt: { not: null }, executionVersion: 2 }, select: { id: true, finishedAt: true, summary: true, paginationComplete: true } }) : null;
  if (params.get("runId") && !run) throw new SyncInputError("已发布观察版本不可访问。", 403);
  const page = Math.min(1000, Math.max(1, Math.floor(Number(params.get("page")) || 1))), pageSize = queryPageSize(params);
  let publishedRunIds = run ? [run.id] : [];
  let historyDays: string[] | null = null;
  if (resource === "buy_box_history" && (from || to)) {
    // Select one latest complete whole-ASIN publication per business day.
    // Revisions and retries are versions, not additive business observations.
    const candidates = await db.amazonSyncRun.findMany({ where: { ...scope, sourceId: source?.id ?? "__none__", resource, executionVersion: 2, status: "SUCCEEDED", stage: "COMPLETED", paginationComplete: true, finishedAt: { not: null }, AND: [
      { summary: { path: ["coverage", "complete"], equals: true } },
      { frozenScope: { path: ["domainPolicy", "allAsins"], equals: true } },
      ...(from ? [{ frozenScope: { path: ["domainPolicy", "from"], gte: from } }] : []),
      ...(to ? [{ frozenScope: { path: ["domainPolicy", "to"], lte: to } }] : []),
    ] }, select: { id: true, frozenScope: true }, orderBy: [{ finishedAt: "desc" }, { id: "desc" }], take: 10001 });
    if (candidates.length > 10000) throw new SyncInputError("历史版本超过容量，请缩小日期范围。", 409);
    const days = new Map<string, string>();
    for (const candidate of candidates) {
      const policy = (candidate.frozenScope as { domainPolicy?: { from?: string; to?: string } }).domainPolicy;
      if (policy?.from && policy.from === policy.to && !days.has(policy.from)) days.set(policy.from, candidate.id);
    }
    publishedRunIds = [...days.values()]; historyDays = [...days.keys()].sort();
  }
  const where: Prisma.AmazonDomainObservationWhereInput = { task: { id: { in: publishedRunIds } }, ...scope, sourceId: source?.id ?? "__none__", sourceRunId: { in: publishedRunIds }, ...Object.fromEntries(["asin", "sellerSku", "searchTerm", "kind"].filter(key => params.get(key)).map(key => [key, params.get(key)!])) };
  if (inboundFilters.length) where.AND = inboundFilters;
  const [rows, total, versions, latestTask] = await Promise.all([
    db.amazonDomainObservation.findMany({ where, select: { id: true, sourceId: true, sourceRunId: true, kind: true, asin: true, sellerSku: true, searchTerm: true, facts: true, capturedAt: true }, orderBy: [{ kind: "asc" }, { id: "asc" }], take: pageSize, skip: (page - 1) * pageSize }),
    db.amazonDomainObservation.count({ where }),
    source ? db.amazonSyncRun.findMany({ where: { ...scope, sourceId: source.id, resource, ...published, finishedAt: { not: null }, executionVersion: 2 }, select: { id: true, finishedAt: true, summary: true }, orderBy: [{ finishedAt: "desc" }, { id: "desc" }], take: 100 }) : [],
    source ? db.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, resource, executionVersion: 2 }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], select: { id: true, status: true, stage: true, processedCount: true, failedCount: true, updatedAt: true, nextAttemptAt: true, error: true } }) : null,
  ]);
  const businessRows = await observationBusinessFields(scope, rows, db);
  await amazonAccountReadAccess(scope, actor, params, db, resource);
  return { resource, completeness: historyDays ? { mode: "LATEST_COMPLETE_WHOLE_ASIN_REPORT_PER_DAY", from: from ?? null, to: to ?? null, publishedDays: historyDays, historicalComplete: false } : run && (run.summary as { coverage?: { complete?: boolean } } | null)?.coverage?.complete === false ? { mode: "PARTIAL_PUBLISHED_VERSION", complete: false, coverage: (run.summary as { coverage: unknown }).coverage } : "PUBLISHED_VERSION_ONLY", latestTask, sources, source: source ?? null, run, versions, rows: businessRows, numericEncoding: "JSON_NUMERIC_STRINGS", pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
}
