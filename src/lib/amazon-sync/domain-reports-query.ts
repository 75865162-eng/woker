import { inventoryReportResources, isInventoryReport } from "./inventory-report-contracts";
import { amazonBusinessData } from "./business-data";
import { amazonAccountReadAccess } from "./read-account";
import { queryPageSize } from "./query-page";
import { hasReadableReportAttributionProof, requiresReportRowAttribution } from "./report-row-attribution";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellerAccessWhere } from "./data-access";
import { SyncInputError, type SyncScope } from "./policy";
import { domainReportTypes, type DomainReportResource } from "./domain-reports";
import { reportVerifiedRowWhere } from "./report-row-attribution";
import { localSellerEvidenceEnabled } from "./seller-report-evidence";

const resources: DomainReportResource[] = ["settlements", "reimbursements", "inventory_age", "long_term_storage_fees", "removal_shipment_report", "inventory_events", "removal_order_report", "fba_shipments", "fba_customer_sales", "mfn_returns", ...inventoryReportResources];
function date(value: string | null) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new SyncInputError("业务日期格式无效。");
  return value;
}

export async function readDomainReports(scope: SyncScope, params: URLSearchParams, actor?: string) {
  params = new URLSearchParams(params);
  const resource = params.get("resource") as DomainReportResource;
  if (!resources.includes(resource)) throw new SyncInputError("报告域无效。");
  for (const key of ["sourceId", "sellerAccountId", "marketplaceId", "reportId"] as const) if ((params.get(key)?.length ?? 0) > 200) throw new SyncInputError("报告筛选长度超限。");
  const access = await amazonAccountReadAccess(scope, actor, params, prisma, resource);
  params.set("sellerAccountId", access.sellerIds[0]);
  const storedSources = await prisma.amazonSyncDataSource.findMany({ where: { AND: [scope, sellerAccessWhere(access), { resource }, ...(params.get("sellerAccountId") ? [{ sellerAccountId: params.get("sellerAccountId")! }] : []), ...(params.get("marketplaceId") ? [{ marketplaceId: params.get("marketplaceId")! }] : [])] }, select: { id: true, resource: true, enabled: true, sellerAccountId: true, marketplaceId: true, rowCount: true, lastSuccessAt: true, activeRunId: true, coverage: true, seller: { select: { displayName: true } }, resourceCursor: { select: { status: true, lastSuccessAt: true, watermarkFrom: true, watermarkTo: true } } }, orderBy: [{ sellerAccountId: "asc" }, { marketplaceId: "asc" }], take: 201 });
  const sources = storedSources.map(item => {
    const coverage = item.coverage && typeof item.coverage === "object" && !Array.isArray(item.coverage) ? item.coverage : {};
    const proof = coverage.rowAttribution;
    const verified = hasReadableReportAttributionProof(proof);
    return requiresReportRowAttribution(resource) && !verified ? { ...item, rowCount: 0, lastSuccessAt: null, activeRunId: null, coverage: { ...coverage, rowAttribution: { status: "PENDING_VERIFICATION", visibleRows: 0, version: "" } } } : item;
  });
  if (sources.length > 200) throw new SyncInputError("报告数据源超过试点容量。", 409);
  const sourceId = params.get("sourceId");
  const source = sourceId ? sources.find(item => item.id === sourceId) : resource === "inventory_age" ? sources.find(item => item.activeRunId && item.rowCount > 0) ?? sources[0] : sources[0];
  if (sourceId && !source) throw new SyncInputError("报告数据源不可访问。", 403);
  const page = Math.min(10000, Math.max(1, Math.floor(Number(params.get("page")) || 1))), pageSize = queryPageSize(params);
  const proof = source?.coverage && typeof source.coverage === "object" && !Array.isArray(source.coverage) ? source.coverage.rowAttribution : null;
  const attributionVisible = !requiresReportRowAttribution(resource) || hasReadableReportAttributionProof(proof);
  const where: Prisma.AmazonSyncReportRowWhereInput = { ...scope, sourceId: attributionVisible ? source?.id ?? "__none__" : "__attribution_pending__", ...reportVerifiedRowWhere(resource, source?.marketplaceId ?? "") };
  const from = date(params.get("from")), to = date(params.get("to"));
  if (from && to && from > to) throw new SyncInputError("业务日期范围无效。");
  if (from || to) where.businessDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  for (const [param, field] of [["orderId", "orderId"], ["sellerSku", "sellerSku"], ["asin", "asin"], ["transactionType", "transactionType"], ["amountType", "amountType"]] as const) {
    const value = params.get(param); if (value) { if (value.length > 500) throw new SyncInputError("报告筛选长度超限。"); where[field] = value; }
  }
  const cellFilters: Array<[string, string, readonly DomainReportResource[]]> = [
    ["fnSku", "fnsku", ["inventory_events", "inventory_age", "long_term_storage_fees", "removal_shipment_report", "reimbursements"]],
    ["country", "country", ["fba_inventory_by_country"]],
    ["eventType", "event-type", ["inventory_events"]],
    ["eventReferenceId", "reference-id", ["inventory_events"]],
    ["reimbursementId", "reimbursement-id", ["reimbursements"]],
    ["reason", "reason", ["inventory_events", "reimbursements"]],
    ["disposition", "disposition", ["inventory_events"]],
    ["unreconciledQuantity", "unreconciled-quantity", ["inventory_events"]],
  ];
  for (const [param, key, supported] of cellFilters) {
    const value = params.get(param);
    if (value === null) continue;
    if (!supported.includes(resource) || !value.trim() || value !== value.trim() || value.length > 200) throw new SyncInputError("报告字段筛选无效。");
    const clauses = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [...clauses, { fields: { path: [key], equals: value } }];
  }
  if (params.get("reportId")) where.document = { status: "PUBLISHED", resource, reportType: domainReportTypes[resource], reportId: params.get("reportId")! };
  else if (resource === "inventory_age" || resource === "long_term_storage_fees" || resource === "fba_shipments" || resource === "fba_customer_sales" || resource === "mfn_returns" || isInventoryReport(resource)) {
    const latest = source ? await prisma.amazonSyncReportDocument.findFirst({ where: { ...scope, sourceId: source.id, resource, reportType: domainReportTypes[resource], status: "PUBLISHED" }, orderBy: [{ capturedAt: "desc" }, { id: "desc" }], select: { id: true } }) : null;
    where.reportDocumentId = latest?.id ?? "__no_published_inventory_age__";
    where.document = { status: "PUBLISHED", resource, reportType: domainReportTypes[resource] };
  }
  else where.document = { status: "PUBLISHED", resource, reportType: domainReportTypes[resource] };
  const [total, rows, documents, latestTask] = await Promise.all([
    prisma.amazonSyncReportRow.count({ where }),
    prisma.amazonSyncReportRow.findMany({ where, orderBy: [{ businessDate: "desc" }, { reportId: "desc" }, { rowNumber: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, reportId: true, rowNumber: true, businessDate: true, businessDateRaw: true, orderId: true, sellerSku: true, asin: true, transactionType: true, amountType: true, amountDescription: true, amountOriginal: true, currencyCode: true, quantityOriginal: true, fields: true, document: { select: { id: true, sourceRunId: true, capturedAt: true, publishedAt: true, reportCreatedAt: true, businessDateField: true } } } }),
    source && attributionVisible ? prisma.amazonSyncReportDocument.findMany({ where: { ...scope, sourceId: source.id, resource, status: "PUBLISHED" }, select: { reportId: true, reportCreatedAt: true, businessDateField: true, rowCount: true, capturedAt: true, publishedAt: true, sourceRunId: true }, orderBy: [{ capturedAt: "desc" }], take: 100 }) : Promise.resolve([]),
    source ? prisma.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, resource, executionVersion: 2 }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], select: { id: true, status: true, stage: true, error: true, updatedAt: true } }) : null,
  ]);
  await amazonAccountReadAccess(scope, actor, params, prisma, resource);
  return { resource, latestTask, canReadSellerEvidence: requiresReportRowAttribution(resource) && localSellerEvidenceEnabled(scope), source: source ?? null, sources, documents, reportTypes: domainReportTypes, rows: rows.map(row => ({ ...row, fields: amazonBusinessData(row.fields) })), pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) }, dateMeaning: isInventoryReport(resource) ? "capture time; current inventory snapshot, not historical balance" : resource === "inventory_age" ? "snapshot-date; current report snapshot, not historical inventory" : resource === "inventory_events" ? "Amazon ledger event date; rows are immutable report observations, not an inventory balance" : resource === "reimbursements" ? "approval-date" : resource === "mfn_returns" ? "return-request-date within the latest requested 60-day report window" : resource === "fba_customer_sales" ? "shipment-date within the latest requested snapshot; no historical completeness is implied" : "settlement-start-date where present; discovery window uses report-created time", amountMeaning: resource === "settlements" ? "amount values remain localized original strings; do not total across currencies" : "original report values; do not treat as financial postings" };
}
