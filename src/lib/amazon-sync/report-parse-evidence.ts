import { orderParserVersion, orderFactSchemaVersion } from "./orders";
import { financeParser } from "./finance-parser";
import { inventoryReportParserVersion } from "./inventory-report-contracts";
import { randomUUID } from "node:crypto";
import type { AmazonSyncRun, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertAmazonScopeAdmin } from "./data-access";
import { SyncInputError, type SyncScope } from "./policy";

export type ReportParsePhase = "ARCHIVED" | "ROWS_COMMITTED" | "PARSED_SITE_PENDING" | "ATTRIBUTION_PENDING" | "PUBLISHED" | "ATTEMPT_FAILED";
/** Version the executable parser contract independently of upstream schemas. */
export const reportParserVersions: Readonly<Record<string, string>> = {
  removal_order_report: "domain-reports.v2",
  removal_shipment_report: "domain-reports.v2",
  long_term_storage_fees: "domain-reports.v2",
  storage_fees: "inventory-reports.tsv.v1", fba_fulfilled_inventory: "inventory-reports.tsv.v1", fba_inventory_report: "inventory-reports.tsv.v1", reserved_inventory: "inventory-reports.tsv.v1", stranded_inventory: "inventory-reports.tsv.v1", recommended_removals: "inventory-reports.tsv.v1", fba_overage_fees: "inventory-reports.tsv.v1", fee_preview: "inventory-reports.tsv.v1",
  orders: orderParserVersion,
  finance: financeParser.version,
  sales_traffic: "sales-traffic.v1", catalog: "all-listings.v1", settlements: "settlements.v3",
  inventory_events: "domain-reports.v2", reimbursements: "domain-reports.v2", inventory_age: "domain-reports.v2", returns: "fba-returns.v1",
  fba_shipments: "domain-reports.v2",
  fba_customer_sales: "domain-reports.v2",
  mfn_returns: "domain-reports.v2",
  fba_inventory_by_country: inventoryReportParserVersion,
};

/** Caller holds scope lock and run fence. This event commits atomically with
 * the described archive/business batch; it never rewrites the original file. */
export async function recordReportParseEvidence(tx: Prisma.TransactionClient, run: AmazonSyncRun, input: {
  rawTaskId: string; rawPage: number; phase: ReportParsePhase; rowsCommitted: number;
  totalRows?: number; processedRows?: number; checkedAt: Date; failureCode?: string; replayed?: boolean;
  finance?: { resultDigest?: string; diagnostic?: { code: string; offset: number | null; path: string | null }; counts?: { inserted: number; updated: number; reused: number; quarantined: number } };
}) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  if (!run.sourceId || !reportParserVersions[run.resource] || !Number.isSafeInteger(input.rowsCommitted) || input.rowsCommitted < 0 || input.totalRows !== undefined && (!Number.isSafeInteger(input.totalRows) || input.totalRows < input.rowsCommitted) || input.processedRows !== undefined && (!Number.isSafeInteger(input.processedRows) || input.processedRows < 0 || input.totalRows !== undefined && input.processedRows > input.totalRows)) throw new SyncInputError("报告解析证据范围或计数无效。", 409);
  const raw = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: input.rawTaskId, page: input.rawPage, resource: run.resource, task: { sourceId: run.sourceId } }, select: { bodySha256: true, capturedAt: true, requestMetadata: true } });
  if (!raw) throw new SyncInputError("报告解析证据缺少同来源原件。", 409);
  const metadata = raw.requestMetadata && typeof raw.requestMetadata === "object" && !Array.isArray(raw.requestMetadata) ? raw.requestMetadata as Prisma.JsonObject : {};
  if (run.resource === "orders" && (metadata.apiVersion !== "2026-01-01" || !["searchOrders", "getOrder"].includes(String(metadata.operation)))) throw new SyncInputError("订单解析证据的 API 操作或版本不匹配。", 409);
  await tx.auditLog.create({ data: { id: randomUUID(), organizationId: scope.organizationId, userId: run.requestedByUserId,
    action: "amazon.sync.report.parse-checkpoint", entityType: "AmazonSyncRun", entityId: run.id, metadata: {
      version: 1, ...scope, sourceId: run.sourceId, resource: run.resource, taskId: run.id,
      rawTaskId: input.rawTaskId, rawPage: input.rawPage, rawSha256: raw.bodySha256,
      archivedAt: raw.capturedAt.toISOString(), checkedAt: input.checkedAt.toISOString(),
      parserVersion: reportParserVersions[run.resource], officialSchemaVersion: null,
      ...(run.resource === "finance" ? { sourceCode: financeParser.sourceCode, apiVersion: financeParser.apiVersion, responseType: financeParser.responseType,
        expectedStructure: financeParser.structure, validatedStructure: ["ROWS_COMMITTED", "PUBLISHED"].includes(input.phase) ? financeParser.structure : null,
        schemaVersion: financeParser.schemaVersion, replayed: input.replayed ?? false, ...input.finance } : {}),
      ...(run.resource === "orders" ? { apiVersion: "2026-01-01", operation: metadata.operation,
        schemaVersion: orderFactSchemaVersion,
        rowKind: metadata.operation === "searchOrders" ? "ORDER" : "ORDER_ITEM",
        replayed: input.replayed ?? null } : {}),
      phase: input.phase, rowsCommitted: input.rowsCommitted, totalRows: input.totalRows ?? null,
      processedRows: input.processedRows ?? input.rowsCommitted,
      failureCode: input.failureCode ?? null,
      published: input.phase === "PUBLISHED",
    } } });
}

/** Parser evidence may describe seller-wide quarantined reports, so this
 * maintenance reader is administrator-only even when site data is viewable. */
export async function readReportParseEvidence(scope: SyncScope, params: URLSearchParams, actor: string) {
  await assertAmazonScopeAdmin(scope, actor);
  const sourceId = params.get("sourceId"), taskId = params.get("taskId");
  for (const value of [sourceId, taskId]) if (value && value.length > 200) throw new SyncInputError("解析证据筛选长度超限。");
  if (!sourceId && !taskId) throw new SyncInputError("解析证据查询须指定 sourceId 或 taskId。");
  const tasks = taskId ? await prisma.amazonSyncRun.findFirst({ where: { ...scope, id: taskId, ...(sourceId ? { sourceId } : {}) }, select: { id: true, sourceId: true } }) : null;
  if (taskId && !tasks) throw new SyncInputError("解析任务不可访问。", 404);
  const selectedSource = sourceId ?? tasks?.sourceId;
  const source = selectedSource ? await prisma.amazonSyncDataSource.findFirst({ where: { ...scope, id: selectedSource }, select: { id: true, resource: true } }) : null;
  if (!source) throw new SyncInputError("解析来源不可访问。", 404);
  const pageValue = params.get("page") ?? "1";
  if (!/^\d+$/.test(pageValue) || Number(pageValue) < 1 || Number(pageValue) > 1000) throw new SyncInputError("解析证据页码须为 1–1000。");
  const page = Number(pageValue), pageSize = 50;
  const events = await prisma.auditLog.findMany({ where: { organizationId: scope.organizationId, action: "amazon.sync.report.parse-checkpoint", entityType: "AmazonSyncRun", ...(taskId ? { entityId: taskId } : {}),
    AND: [{ metadata: { path: ["workspaceId"], equals: scope.workspaceId } }, { metadata: { path: ["sourceId"], equals: source.id } }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize + 1, select: { id: true, createdAt: true, metadata: true } });
  await assertAmazonScopeAdmin(scope, actor);
  return { sourceId: source.id, taskId, events: events.slice(0, pageSize).map(event => ({ id: event.id, recordedAt: event.createdAt, evidence: event.metadata })),
    pagination: { page, pageSize, hasMore: events.length > pageSize }, oldArchivesBackfilled: false,
    scope: source.resource === "orders" ? "REGISTERED_ORDER_PARSER_CHECKPOINTS_ONLY" : "REGISTERED_REPORT_PARSER_CHECKPOINTS_ONLY", rawBodyIncluded: false };
}
