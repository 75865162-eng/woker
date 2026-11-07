import { skillDataTables, datasetForTable, describeMcpDataset, normalizeDatasetQuery, presentMcpReport, McpDatasetError } from "./mcp-datasets";
import { queryPublishedAdsReports } from "@/lib/amazon-ads/report-query";
import { parseAdsQuery } from "@/lib/amazon-ads/query-contract";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { SyncInputError, type SyncScope } from "./policy";
import { readSalesTraffic } from "./sales-query";
import { isSpApiDataset, querySpApiDataset } from "./sp-api-data-query";

type DataSource = {
  id: string;
  resource: string;
  sellerAccountId: string;
  marketplaceId: string;
  activeRunId: string | null;
  lastSuccessAt: Date | null;
  freshnessMinutes: number;
  rowCount: number;
  publishedRun: { status: string; executionVersion: number; resource: string; sourceId: string | null; finishedAt: Date | null; stage: string } | null;
};

export { skillDataTables } from "./mcp-datasets";

function validSources(sources: DataSource[], resource: string) {
  return sources.filter(source => source.resource === resource && source.activeRunId && source.publishedRun?.status === "SUCCEEDED"
    && source.publishedRun.executionVersion === 2 && source.publishedRun.resource === resource && source.publishedRun.sourceId === source.id
    && source.publishedRun.finishedAt && source.publishedRun.stage !== "PURGED");
}

export function availableSkillTables(sources: DataSource[]) {
  return skillDataTables.filter(table => validSources(sources, table.resource).length > 0).map(table => ({
    ...describeMcpDataset(datasetForTable(table.name)),
    schemaStatus: "application_schema_confirmed_source_sample_pending",
    warnings: table.warnings ?? [],
  }));
}

export function skillTableAvailability(sources: DataSource[]) {
  const now = Date.now();
  return skillDataTables.map(table => {
    const published = validSources(sources, table.resource);
    const syncDates = published.map(source => source.lastSuccessAt).filter((value): value is Date => !!value);
    return {
      name: table.name,
      source: table.source,
      grain: table.grain,
      warnings: table.warnings ?? [],
      schemaStatus: "application_schema_confirmed_source_sample_pending",
      available: published.length > 0,
      sourceCount: published.length,
      rowCount: table.name === "ads_report_daily" ? null : published.reduce((total, source) => total + source.rowCount, 0),
      lastSyncAt: syncDates.length ? new Date(Math.min(...syncDates.map(value => value.getTime()))).toISOString() : null,
      freshness: !syncDates.length ? "missing" : published.some(source => !source.lastSuccessAt || now - source.lastSuccessAt.getTime() > source.freshnessMinutes * 60_000) ? "stale" : "ok",
    };
  });
}

export function describeSkillTable(name: string, sources: DataSource[]) {
  const table = datasetForTable(name);
  if (table.name !== "ads_report_daily" && !sources.some(source => source.resource === table.resource)) throw new McpDatasetError("DATASET_UNPUBLISHED", "TABLE_NOT_ALLOWED: 当前授权范围没有该表的数据源。", 403);
  return { ...describeMcpDataset(table), fields: table.fields, warnings: table.warnings ?? [], schemaStatus: "application_schema_confirmed_source_sample_pending" };
}

export async function querySkillTable(input: {
  scope: SyncScope;
  actor: string;
  sources: DataSource[];
  tableName: string;
  sellerAccountId?: string;
  marketplaceId?: string;
  filters?: Record<string, string>;
  page: number;
  pageSize: number;
}) {
  const table = datasetForTable(input.tableName);
  const normalized = normalizeDatasetQuery(table, { filters: input.filters, page: input.page, pageSize: input.pageSize });
  const sources = (table.name === "ads_report_daily" ? input.sources : validSources(input.sources, table.resource)).filter(source => (!input.sellerAccountId || source.sellerAccountId === input.sellerAccountId)
    && (!input.marketplaceId || source.marketplaceId === input.marketplaceId));
  if (!sources.length) throw new McpDatasetError("DATASET_UNPUBLISHED", "TABLE_NOT_ALLOWED: 当前授权范围没有该表的已发布数据源。", 403);
  const filters = normalized.filters;

  if (table.name === "ads_report_daily") {
    const params = new URLSearchParams({ ...filters, kind: "reports", page: String(input.page), pageSize: String(input.pageSize) });
    const result = await queryPublishedAdsReports(input.scope, input.actor, parseAdsQuery(params), sources.map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId })));
    return presentMcpReport(result);
  }

  const now = new Date();
  const freshness = sources.map(source => source.lastSuccessAt && now.getTime() - source.lastSuccessAt.getTime() <= source.freshnessMinutes * 60_000);
  const syncDates = sources.map(source => source.lastSuccessAt).filter((value): value is Date => !!value);
  const oldestSyncAt = syncDates.length ? new Date(Math.min(...syncDates.map(value => value.getTime()))).toISOString() : null;
  const meta = {
    source: table.source,
    isSandbox: false,
    lastSyncAt: oldestSyncAt,
    freshness: !syncDates.length ? "missing" : freshness.every(Boolean) ? "ok" : "stale",
    grain: table.grain,
    currency: table.name === "sales_traffic_daily" ? "per_row" : null,
    attributionWindow: null,
    warnings: table.warnings ?? [],
    page: { page: input.page, pageSize: input.pageSize, hasNext: false },
    sources: sources.map(source => ({ sourceId: source.id, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, syncRunId: source.activeRunId, lastSyncAt: source.lastSuccessAt?.toISOString() ?? null })),
  };

  if (isSpApiDataset(table.name)) {
    const result = await querySpApiDataset({ ...input, resource: table.resource, sources, filters });
    const actual = sources.filter(source => source.id === result.source.id);
    return { data: { items: result.rows, total: result.pagination.total }, meta: { ...meta,
      sources: meta.sources.filter(source => source.sourceId === result.source.id),
      lastSyncAt: actual[0]?.lastSuccessAt?.toISOString() ?? null,
      completeness: result.completeness,
      page: { page: result.pagination.page, pageSize: result.pagination.pageSize, hasNext: result.pagination.page < result.pagination.pageCount } } };
  }

  if (table.name === "sales_traffic_daily") {
    const from = filters.from;
    const to = filters.to;
    const result = await readSalesTraffic(input.scope, new URLSearchParams({
      ...(from ? { from } : {}), ...(to ? { to } : {}), ...(input.sellerAccountId ? { sellerAccountId: input.sellerAccountId } : {}),
      ...(input.marketplaceId ? { marketplaceId: input.marketplaceId } : {}), page: String(input.page), direction: filters.sortDirection, sort: filters.sortBy,
    }), { actor: input.actor, pageSize: input.pageSize, sourceFence: sources.map(source => source.id), includeExactMetrics: true });
    return {
      data: { items: result.rows.map(row => ({ sellerAccountId: row.sellerAccountId, marketplaceId: row.marketplaceId, businessDate: row.businessDate, metrics: row.metrics, exactMetrics: row.exactMetrics, quality: row.quality, capturedAt: row.capturedAt, syncRunId: row.syncRunId })), total: result.pagination.total },
      meta: { ...meta, lastSyncAt: oldestSyncAt ?? result.asOf, freshness: result.rows.length === 0 && !result.pagination.total ? "missing" : meta.freshness,
        numericEncoding: "legacy_metrics_numbers_and_exactMetrics_strings_from_stored_json",
        warnings: [...(table.warnings ?? []), "exactMetrics 为数据库已保存 JSON 数值的精确字符串；旧 metrics 保持兼容，不证明采集前的精度。"],
        page: { page: result.pagination.page, pageSize: result.pagination.pageSize, hasNext: result.pagination.page < result.pagination.pageCount } },
    };
  }

  const dateFilter = dateBounds(filters.from, filters.to);
  const sourceFilter = sources.map(source => table.name === "inventory"
    ? { sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, syncRunId: source.activeRunId! }
    : { sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, sourceRunId: source.activeRunId! });
  if (table.name === "inventory") {
    const where: Prisma.AmazonInventorySnapshotWhereInput = {
      ...input.scope,
      OR: sourceFilter,
      ...(filters.sellerSku ? { sellerSku: filters.sellerSku } : {}), ...(filters.asin ? { asin: filters.asin } : {}),
      ...(filters.condition ? { condition: filters.condition } : {}), ...(dateFilter ? { capturedAt: dateFilter } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.amazonInventorySnapshot.count({ where }),
      prisma.amazonInventorySnapshot.findMany({ where, select: { sellerAccountId: true, marketplaceId: true, sellerSku: true, asin: true, fnSku: true, condition: true, fulfillableQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true, inboundReceivingQuantity: true, reservedQuantity: true, unfulfillableQuantity: true, researchingQuantity: true, sourceUpdatedAt: true, capturedAt: true, syncRunId: true }, orderBy: [{ [filters.sortBy]: filters.sortDirection as Prisma.SortOrder }, { id: "asc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    ]);
    return { data: { items: rows, total }, meta: { ...meta, page: { page: input.page, pageSize: input.pageSize, hasNext: input.page * input.pageSize < total } } };
  }

  if (table.name !== "listings") throw new McpDatasetError("SCHEMA_UNVERIFIED", "SCHEMA_UNVERIFIED: 数据集没有已绑定的查询服务。", 409);
  const where: Prisma.AmazonCatalogSnapshotWhereInput = {
    ...input.scope,
    OR: sourceFilter,
    ...(filters.sellerSku ? { sellerSku: filters.sellerSku } : {}), ...(filters.asin ? { asin: filters.asin } : {}),
    ...(filters.listingStatus ? { listingStatus: filters.listingStatus } : {}), ...(dateFilter ? { capturedAt: dateFilter } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.amazonCatalogSnapshot.count({ where }),
    prisma.amazonCatalogSnapshot.findMany({ where, select: { sellerAccountId: true, marketplaceId: true, sellerSku: true, asin: true, listingStatus: true, fulfillmentType: true, listingAttributes: true, sourceUpdatedAt: true, capturedAt: true, sourceRunId: true }, orderBy: [{ [filters.sortBy]: filters.sortDirection as Prisma.SortOrder }, { id: "asc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
  ]);
  return { data: { items: rows, total }, meta: { ...meta, page: { page: input.page, pageSize: input.pageSize, hasNext: input.page * input.pageSize < total } } };
}

function dateBounds(from?: string, to?: string) {
  const bounds: { gte?: Date; lt?: Date } = {};
  for (const [key, value] of [["from", from], ["to", to]] as const) {
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new SyncInputError("日期格式无效。");
    if (key === "from") bounds.gte = new Date(`${value}T00:00:00.000Z`);
    else bounds.lt = new Date(Date.parse(`${value}T00:00:00.000Z`) + 86_400_000);
  }
  if (bounds.gte && bounds.lt && bounds.gte >= bounds.lt) throw new SyncInputError("日期范围无效。");
  return Object.keys(bounds).length ? bounds : undefined;
}
