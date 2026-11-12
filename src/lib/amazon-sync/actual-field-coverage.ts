import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, sourceAccessWhere } from "./data-access";
import { domainReportTypes, type DomainReportResource } from "./domain-reports";
import { readDomainReports } from "./domain-reports-query";
import { SyncInputError, type SyncScope } from "./policy";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Counts of checks are not counts of distinct business rows: batches can overlap. */
export function summarizePersistenceChecks(events: Array<{ metadata: unknown }>, truncated: boolean) {
  const latest = new Map<string, Record<string, unknown>>();
  for (const event of events) {
    const item = object(event.metadata);
    if (typeof item.fieldRegistryId !== "string" || typeof item.mappingId !== "string" || typeof item.batchDigest !== "string" || typeof item.reportDocumentId !== "string") continue;
    const key = JSON.stringify([item.fieldRegistryId, item.mappingId, item.reportDocumentId, item.batchDigest]);
    if (!latest.has(key)) latest.set(key, item);
  }
  const rows = [...latest.values()], passed = rows.filter(row => row.status === "PASSED"), failed = rows.filter(row => row.status === "FAILED");
  return { evidenceTruncated: truncated, inspectedEvents: events.length, distinctBatchFieldChecks: rows.length,
    passedChecks: passed.length, failedChecks: failed.length,
    fieldsWithPassedBatch: new Set(passed.map(row => row.fieldRegistryId)).size,
    fieldsWithFailedBatch: new Set(failed.map(row => row.fieldRegistryId)).size,
    checkedRowOccurrences: rows.reduce((total, row) => total + (Number.isSafeInteger(row.checkedRows) && Number(row.checkedRows) >= 0 ? Number(row.checkedRows) : 0), 0),
    distinctVerifiedBusinessRows: null, fullFieldAcceptance: false,
    basis: "LATEST_PER_MAPPING_DOCUMENT_BATCH_WITHIN_BOUNDED_HISTORY" };
}

/** Actual local report coverage, never an official-field-universe percentage.
 * Counts have one source boundary and business dates apply only to business rows. */
export async function readActualFieldCoverage(scope: SyncScope, params: URLSearchParams, actor: string, sourceFence?: string[]) {
  const sourceId = params.get("sourceId");
  if (!sourceId || sourceId.length > 200) throw new SyncInputError("实际覆盖报告必须指定 sourceId。");
  const assertSource = async () => {
    const access = await amazonDataAccess(scope, actor);
    const source = await prisma.amazonSyncDataSource.findFirst({ where: { AND: [scope, sourceAccessWhere(access), { id: sourceId }, ...(sourceFence ? [{ id: { in: sourceFence } }] : [])] } });
    if (!source) throw new SyncInputError("覆盖报告来源不可访问。", 403);
    return source;
  };
  const source = await assertSource();
  if (!(source.resource in domainReportTypes)) throw new SyncInputError("实际业务覆盖目前支持结算、赔付、库龄和库存事件；其他域尚未实现。", 409);
  const resource = source.resource as DomainReportResource;
  const query = new URLSearchParams({ sourceId, resource, pageSize: "1" });
  for (const key of ["from", "to"] as const) if (params.has(key)) query.set(key, params.get(key)!);
  // Reuse the actual business reader's publication, attribution and date rules.
  const visible = await readDomainReports(scope, query, actor);
  const result = await prisma.$transaction(async tx => {
    const rawWhere: Prisma.AmazonSyncRawPageWhereInput = { ...scope, resource, OR: [{ task: { sourceId } }, { settlementReports: { some: { ...scope, rows: { some: { ...scope, sourceId } } } } }], requestMetadata: { path: ["reportType"], equals: domainReportTypes[resource] } };
    const rowWhere: Prisma.AmazonSyncReportRowWhereInput = { ...scope, sourceId, ...(query.has("from") || query.has("to") ? { businessDate: { ...(query.has("from") ? { gte: query.get("from")! } : {}), ...(query.has("to") ? { lte: query.get("to")! } : {}) } } : {}) };
    const fieldWhere: Prisma.AmazonFieldRegistryWhereInput = { ...scope, observations: { some: { ...scope, raw: rawWhere } } };
    const [archives, archivesWithObservations, fields, mappedFields, rows, rowsMissingCurrency, publishedRows, dates, documents, evidence, repairs] = await Promise.all([
      tx.amazonSyncRawPage.count({ where: rawWhere }),
      tx.amazonSyncRawPage.count({ where: { ...rawWhere, fieldScans: { some: scope } } }),
      tx.amazonFieldRegistry.count({ where: fieldWhere }),
      tx.amazonFieldRegistry.count({ where: { ...fieldWhere, mappingStatus: "MAPPED" } }),
      tx.amazonSyncReportRow.count({ where: rowWhere }),
      tx.amazonSyncReportRow.count({ where: { ...rowWhere, amountOriginal: { not: null }, OR: [{ currencyCode: null }, { currencyCode: "" }] } }),
      tx.amazonSyncReportRow.count({ where: { ...rowWhere, document: { status: "PUBLISHED", resource, reportType: domainReportTypes[resource] } } }),
      tx.amazonSyncReportRow.aggregate({ where: rowWhere, _min: { businessDate: true }, _max: { businessDate: true } }),
      tx.amazonSyncReportDocument.groupBy({ by: ["status"], where: { ...scope, sourceId, resource }, _count: true }),
      tx.auditLog.findMany({ where: { organizationId: scope.organizationId, action: "amazon.sync.fields.persistence-checked",
        AND: [{ metadata: { path: ["workspaceId"], equals: scope.workspaceId } }, { metadata: { path: ["sourceId"], equals: sourceId } }] },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5001, select: { metadata: true } }),
      tx.auditLog.findMany({ where: { organizationId: scope.organizationId, action: "amazon.sync.settlement.currency-reparsed",
        entityId: sourceId, metadata: { path: ["workspaceId"], equals: scope.workspaceId } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 11,
        select: { id: true, createdAt: true, metadata: true } }),
    ]);
    return { settlementReplays: { recent: repairs.slice(0, 10), truncated: repairs.length > 10, scope: "RECENT_APPROVED_CURRENCY_REPLAYS_ONLY" }, archives: { reportPayloads: archives, withFieldObservations: archivesWithObservations, withoutFieldObservations: archives - archivesWithObservations, scope: "SOURCE_TASKS_OR_SELLER_REPORT_ROW_LINKS_NOT_DATE_FILTERED", legacySharedArchivesMayBeExcluded: true, completeScanCount: null },
      fields: { observed: fields, mapped: mappedFields, unmapped: fields - mappedFields, officialFieldCount: null, completeFieldCount: null },
      business: { storedRows: rows, publishedRows, rowsWithAmountMissingCurrency: rowsMissingCurrency,
        firstObservedBusinessDate: dates._min.businessDate, lastObservedBusinessDate: dates._max.businessDate,
        dateRangeDoesNotProveContinuousCoverage: true, documentCountScope: "ALL_SOURCE_HISTORY", documentsByStatus: documents.map(item => ({ status: item.status, count: item._count })) },
      persistence: summarizePersistenceChecks(evidence.slice(0, 5000), evidence.length > 5000) };
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
  const current = await assertSource();
  if (current.revision !== source.revision || current.authorizationId !== source.authorizationId) throw new SyncInputError("覆盖报告来源已变化，请重新查询。", 409);
  return { observedAt: new Date().toISOString(), sourceId, resource, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId,
    ...result, query: { businessReader: "domain-reports", visibleRows: visible.pagination.total, from: query.get("from"), to: query.get("to"),
      snapshotAtomicWithCounts: false, fieldQueryAcceptanceVerified: false },
    evidenceScope: "ALL_SOURCE_HISTORY_NOT_BUSINESS_DATE_FILTERED", officialUniverseComplete: false, liveAmazonAcceptanceVerified: false, complete: false };
}
