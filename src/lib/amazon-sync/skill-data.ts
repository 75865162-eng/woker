import { queryPublishedAdsReports } from "@/lib/amazon-ads/report-query";
import { parseAdsQuery } from "@/lib/amazon-ads/query-contract";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { SyncInputError, type SyncScope } from "./policy";
import { readSalesTraffic } from "./sales-query";

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

type SkillTable = {
  name: string;
  source: string;
  resource: string;
  grain: string[];
  fields: Array<{ name: string; type: string; nullable?: boolean; description?: string }>;
  warnings?: string[];
};

export const skillDataTables: SkillTable[] = [
  {
    name: "inventory",
    source: "AmazonInventorySnapshot",
    resource: "inventory",
    grain: ["sellerAccountId", "marketplaceId", "sellerSku", "condition", "syncRunId"],
    fields: [
      { name: "sellerAccountId", type: "string" }, { name: "marketplaceId", type: "string" },
      { name: "sellerSku", type: "string" }, { name: "asin", type: "string" },
      { name: "fnSku", type: "string" }, { name: "condition", type: "string" },
      { name: "fulfillableQuantity", type: "integer" }, { name: "inboundWorkingQuantity", type: "integer" },
      { name: "inboundShippedQuantity", type: "integer" }, { name: "inboundReceivingQuantity", type: "integer" },
      { name: "reservedQuantity", type: "integer" }, { name: "unfulfillableQuantity", type: "integer" },
      { name: "researchingQuantity", type: "integer" }, { name: "sourceUpdatedAt", type: "datetime", nullable: true },
      { name: "capturedAt", type: "datetime" }, { name: "syncRunId", type: "string" },
    ],
  },
  {
    name: "listings",
    source: "AmazonCatalogSnapshot",
    resource: "catalog",
    grain: ["organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "sellerSku", "sourceRunId"],
    fields: [
      { name: "sellerAccountId", type: "string" }, { name: "marketplaceId", type: "string" },
      { name: "sellerSku", type: "string" }, { name: "asin", type: "string" },
      { name: "listingStatus", type: "string", nullable: true }, { name: "fulfillmentType", type: "string", nullable: true },
      { name: "sourceUpdatedAt", type: "datetime", nullable: true }, { name: "capturedAt", type: "datetime" },
      { name: "sourceRunId", type: "string" },
    ],
  },
  {
    name: "sales_traffic_daily",
    source: "AmazonSalesTrafficSnapshot",
    resource: "sales_traffic",
    grain: ["sellerAccountId", "marketplaceId", "businessDate", "syncRunId"],
    fields: [
      { name: "sellerAccountId", type: "string" }, { name: "marketplaceId", type: "string" },
      { name: "businessDate", type: "date" }, { name: "metrics.unitsOrdered", type: "integer", nullable: true },
      { name: "metrics.totalOrderItems", type: "integer", nullable: true }, { name: "metrics.sessions", type: "integer", nullable: true },
      { name: "metrics.pageViews", type: "integer", nullable: true }, { name: "metrics.orderedProductSales.amount", type: "decimal", nullable: true },
      { name: "metrics.orderedProductSales.currencyCode", type: "string", nullable: true },
      { name: "quality", type: "string" }, { name: "capturedAt", type: "datetime" }, { name: "syncRunId", type: "string" },
    ],
    warnings: ["店铺逐日粒度，不含 ASIN/SKU 拆分。", "金额按行保留原币种，不得跨币种合计。"],
  },
  {
    name: "ads_report_daily",
    source: "AmazonAdsReportFact",
    resource: "ads_reports",
    grain: ["sellerAccountId", "marketplaceId", "reportType", "adProduct", "reportDate", "factKey", "versionId"],
    fields: [
      { name: "sellerAccountId", type: "string" }, { name: "marketplaceId", type: "string" },
      { name: "profileId", type: "string" }, { name: "reportType", type: "string" },
      { name: "adProduct", type: "string" }, { name: "reportDate", type: "date" },
      { name: "campaignId", type: "string", nullable: true }, { name: "adGroupId", type: "string", nullable: true },
      { name: "targetingId", type: "string", nullable: true }, { name: "advertisedAsin", type: "string", nullable: true },
      { name: "searchTerm", type: "string", nullable: true }, { name: "placement", type: "string", nullable: true },
      { name: "impressions", type: "integer", nullable: true }, { name: "clicks", type: "integer", nullable: true },
      { name: "spend", type: "decimal", nullable: true }, { name: "orders", type: "integer", nullable: true },
      { name: "sales", type: "decimal", nullable: true }, { name: "units", type: "integer", nullable: true },
      { name: "ctr", type: "decimal", nullable: true, description: "clicks / impressions × 100；分母缺失或为 0 时为 null。" },
      { name: "cpc", type: "decimal", nullable: true, description: "spend / clicks；分母缺失或为 0 时为 null。" },
      { name: "cvr", type: "decimal", nullable: true, description: "orders / clicks × 100；分母缺失或为 0 时为 null。" },
      { name: "acos", type: "decimal", nullable: true, description: "spend / sales × 100；分母缺失或为 0 时为 null。" },
      { name: "roas", type: "decimal", nullable: true, description: "sales / spend；分母缺失或为 0 时为 null。" },
      { name: "currencyCode", type: "string", nullable: true, description: "当前查询按 Ads Profile 提供；真实报表逐行币种仍待样本核验。" }, { name: "attributionWindow", type: "string", nullable: true },
      { name: "apiVersion", type: "string" }, { name: "versionId", type: "string" },
    ],
    warnings: ["仅展示完整成功任务的已发布报表版本。", "广告金额币种来自 Profile 配置；按行返回，不跨币种汇总。", "Amazon 报表真实样本仍待核验。"],
  },
];

const supportedByName = new Map(skillDataTables.map(table => [table.name, table]));
const knownLogicalTables = new Set([
  "ads_campaign_daily", "ads_advertised_product_daily", "ads_targeting_daily", "ads_search_term_daily", "ads_placement_daily", "ads_budget_usage",
  "sales_traffic_asin", "sales_traffic_daily", "inventory", "inventory_age", "inventory_ledger_daily", "inbound_shipments", "sales_rank_daily", "sku_mapping",
  "listings", "orders", "returns", "finance_events", "finance_transactions", "settlements_v2", "reimbursements", "storage_fees_monthly", "fee_preview",
  "ads_report_daily",
  "pricing_daily", "search_terms_weekly", "economics_daily", "economics_fees", "restock_plan", "restock_stockout", "restock_clearance",
]);

function validSources(sources: DataSource[], resource: string) {
  return sources.filter(source => source.resource === resource && source.activeRunId && source.publishedRun?.status === "SUCCEEDED"
    && source.publishedRun.executionVersion === 2 && source.publishedRun.resource === resource && source.publishedRun.sourceId === source.id
    && source.publishedRun.finishedAt && source.publishedRun.stage !== "PURGED");
}

export function availableSkillTables(sources: DataSource[]) {
  return skillDataTables.filter(table => validSources(sources, table.resource).length > 0).map(table => ({
    name: table.name,
    source: table.source,
    grain: table.grain,
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
  const table = supportedByName.get(name);
  if (!table) {
    if (knownLogicalTables.has(name)) throw new SyncInputError("SCHEMA_UNVERIFIED: 该逻辑表尚无已验证的系统数据源。", 409);
    throw new SyncInputError("TABLE_NOT_ALLOWED: 逻辑表不在允许清单中。", 403);
  }
  if (table.name !== "ads_report_daily" && !validSources(sources, table.resource).length) throw new SyncInputError("TABLE_NOT_ALLOWED: 当前授权范围没有该表的已发布数据源。", 403);
  return { name: table.name, source: table.source, grain: table.grain, fields: table.fields, warnings: table.warnings ?? [], schemaStatus: "application_schema_confirmed_source_sample_pending" };
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
  const table = supportedByName.get(input.tableName);
  if (!table) {
    if (knownLogicalTables.has(input.tableName)) throw new SyncInputError("SCHEMA_UNVERIFIED: 该逻辑表尚无已验证的系统数据源。", 409);
    throw new SyncInputError("TABLE_NOT_ALLOWED: 逻辑表不在允许清单中。", 403);
  }
  const sources = (table.name === "ads_report_daily" ? input.sources : validSources(input.sources, table.resource)).filter(source => (!input.sellerAccountId || source.sellerAccountId === input.sellerAccountId)
    && (!input.marketplaceId || source.marketplaceId === input.marketplaceId));
  if (!sources.length) throw new SyncInputError("TABLE_NOT_ALLOWED: 当前授权范围没有该表的已发布数据源。", 403);
  const filters = input.filters ?? {};
  const allowedFilters: Record<string, string[]> = {
    inventory: ["sellerSku", "asin", "condition", "from", "to"],
    listings: ["sellerSku", "asin", "listingStatus", "from", "to"],
    sales_traffic_daily: ["from", "to"],
    ads_report_daily: ["from", "to", "reportType", "adProduct", "campaignId", "adGroupId", "targetingId", "advertisedAsin", "searchTerm", "placement", "internalProfileId", "authorizationId", "sortBy", "sortDirection"],
  };
  if (Object.keys(filters).some(key => !allowedFilters[table.name]?.includes(key))) throw new SyncInputError("FIELD_NOT_MAPPED: 筛选字段不属于此逻辑表。", 400);

  if (table.name === "ads_report_daily") {
    const params = new URLSearchParams({ ...filters, kind: "reports", page: String(input.page), pageSize: String(input.pageSize) });
    const result = await queryPublishedAdsReports(input.scope, input.actor, parseAdsQuery(params), sources.map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId })));
    return { data: { items: result.rows, total: result.total }, meta: { ...result.meta, warnings: result.warnings } };
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
    sources: sources.map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, lastSyncAt: source.lastSuccessAt?.toISOString() ?? null })),
  };

  if (table.name === "sales_traffic_daily") {
    const from = filters.from;
    const to = filters.to;
    validateDateRange(from, to);
    const result = await readSalesTraffic(input.scope, new URLSearchParams({
      ...(from ? { from } : {}), ...(to ? { to } : {}), ...(input.sellerAccountId ? { sellerAccountId: input.sellerAccountId } : {}),
      ...(input.marketplaceId ? { marketplaceId: input.marketplaceId } : {}), page: String(input.page), direction: "desc",
    }), { actor: input.actor, pageSize: input.pageSize, sourceFence: sources.map(source => source.id) });
    return {
      data: { items: result.rows.map(row => ({ sellerAccountId: row.sellerAccountId, marketplaceId: row.marketplaceId, businessDate: row.businessDate, metrics: row.metrics, quality: row.quality, capturedAt: row.capturedAt, syncRunId: row.syncRunId })), total: result.pagination.total },
      meta: { ...meta, lastSyncAt: oldestSyncAt ?? result.asOf, freshness: result.rows.length === 0 && !result.pagination.total ? "missing" : meta.freshness,
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
      prisma.amazonInventorySnapshot.findMany({ where, select: { sellerAccountId: true, marketplaceId: true, sellerSku: true, asin: true, fnSku: true, condition: true, fulfillableQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true, inboundReceivingQuantity: true, reservedQuantity: true, unfulfillableQuantity: true, researchingQuantity: true, sourceUpdatedAt: true, capturedAt: true, syncRunId: true }, orderBy: [{ sellerSku: "asc" }, { id: "asc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    ]);
    return { data: { items: rows, total }, meta: { ...meta, page: { page: input.page, pageSize: input.pageSize, hasNext: input.page * input.pageSize < total } } };
  }

  const where: Prisma.AmazonCatalogSnapshotWhereInput = {
    ...input.scope,
    OR: sourceFilter,
    ...(filters.sellerSku ? { sellerSku: filters.sellerSku } : {}), ...(filters.asin ? { asin: filters.asin } : {}),
    ...(filters.listingStatus ? { listingStatus: filters.listingStatus } : {}), ...(dateFilter ? { capturedAt: dateFilter } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.amazonCatalogSnapshot.count({ where }),
    prisma.amazonCatalogSnapshot.findMany({ where, select: { sellerAccountId: true, marketplaceId: true, sellerSku: true, asin: true, listingStatus: true, fulfillmentType: true, sourceUpdatedAt: true, capturedAt: true, sourceRunId: true }, orderBy: [{ sellerSku: "asc" }, { id: "asc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
  ]);
  return { data: { items: rows, total }, meta: { ...meta, page: { page: input.page, pageSize: input.pageSize, hasNext: input.page * input.pageSize < total } } };
}

function validateDateRange(from?: string, to?: string) {
  dateBounds(from, to);
  if (from && to && (Date.parse(to) - Date.parse(from)) / 86_400_000 > 90) throw new SyncInputError("销售流量查询最多 90 天。");
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
