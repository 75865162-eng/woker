import { SyncInputError } from "./policy";

export type SkillTable = {
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
      ...["unitsOrdered", "totalOrderItems", "sessions", "pageViews"].map(name => ({ name: `exactMetrics.${name}`, type: "string", nullable: true, description: "Exact numeric text from stored PostgreSQL JSON; legacy metrics remains unchanged." })),
      { name: "exactMetrics.orderedProductSales.amount", type: "string", nullable: true, description: "Exact stored amount text; does not recover precision lost before storage." },
      { name: "exactMetrics.orderedProductSales.currencyCode", type: "string", nullable: true },
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
      { name: "impressions", type: "string", nullable: true, description: "Exact integer string." }, { name: "clicks", type: "string", nullable: true, description: "Exact integer string." },
      { name: "spend", type: "string", nullable: true, description: "Exact decimal string." }, { name: "orders", type: "string", nullable: true, description: "Exact integer string." },
      { name: "sales", type: "string", nullable: true, description: "Exact decimal string." }, { name: "units", type: "string", nullable: true, description: "Exact integer string." },
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

const knownLogicalTables = new Set([
  "ads_campaign_daily", "ads_advertised_product_daily", "ads_targeting_daily", "ads_search_term_daily", "ads_placement_daily", "ads_budget_usage",
  "sales_traffic_asin", "sales_traffic_daily", "inventory", "inventory_age", "inventory_ledger_daily", "inbound_shipments", "sales_rank_daily", "sku_mapping",
  "listings", "orders", "returns", "finance_events", "finance_transactions", "settlements_v2", "reimbursements", "storage_fees_monthly", "fee_preview",
  "ads_report_daily",
  "pricing_daily", "search_terms_weekly", "economics_daily", "economics_fees", "restock_plan", "restock_stockout", "restock_clearance",
]);


export class McpDatasetError extends SyncInputError {
  constructor(readonly businessCode: string, message: string, status = 400) {
    super(message, status);
    this.name = "McpDatasetError";
  }
}

type FieldSchema = { type: "string"; minLength?: number; maxLength?: number; format?: string; enum?: readonly string[]; description?: string };
export type McpDataset = SkillTable & {
  module: "amazon_sync" | "amazon_ads";
  dataType: string;
  legacyTable: string | null;
  filters: Record<string, FieldSchema>;
  aliases: Record<string, string>;
  maxPageSize: number;
  defaultPageSize: number;
  defaultSort: string;
  defaultDirection: "asc" | "desc";
  dateSemantics: string;
  publicationPolicy: string;
};
const text: FieldSchema = { type: "string", minLength: 1, maxLength: 200 };
const date: FieldSchema = { type: "string", format: "date" };
const direction: FieldSchema = { type: "string", enum: ["asc", "desc"] };
const strings = (names: string[]) => Object.fromEntries(names.map(name => [name, text]));
const sorting = (values: string[]) => ({ sortBy: { type: "string" as const, enum: values }, sortDirection: direction });
export const adsEntityTypes = ["SP:campaign", "SP:ad-group", "SP:keyword", "SP:target", "SP:negative-keyword", "SP:negative-target", "SP:campaign-negative-keyword", "SP:campaign-negative-target"] as const;

const contracts: Record<string, Omit<McpDataset, keyof SkillTable>> = {
  inventory: {
    module: "amazon_sync", dataType: "inventory", legacyTable: "inventory",
    filters: { ...strings(["sellerSku", "asin", "condition"]), from: date, to: date, ...sorting(["sellerSku"]) }, aliases: {},
    maxPageSize: 1000, defaultPageSize: 100, defaultSort: "sellerSku", defaultDirection: "asc", dateSemantics: "captured_at_utc", publicationPolicy: "successful_source_snapshot_head",
  },
  listings: {
    module: "amazon_sync", dataType: "listings", legacyTable: "listings",
    filters: { ...strings(["sellerSku", "asin", "listingStatus"]), from: date, to: date, ...sorting(["sellerSku"]) }, aliases: { state: "listingStatus", status: "listingStatus" },
    maxPageSize: 1000, defaultPageSize: 100, defaultSort: "sellerSku", defaultDirection: "asc", dateSemantics: "captured_at_utc", publicationPolicy: "successful_source_snapshot_head",
  },
  sales_traffic_daily: {
    module: "amazon_sync", dataType: "sales_traffic_daily", legacyTable: "sales_traffic_daily",
    filters: { from: date, to: date, ...sorting(["businessDate"]) }, aliases: {},
    maxPageSize: 1000, defaultPageSize: 100, defaultSort: "businessDate", defaultDirection: "desc", dateSemantics: "report_business_date", publicationPolicy: "latest_successful_per_source_day",
  },
  ads_report_daily: {
    module: "amazon_ads", dataType: "report_daily", legacyTable: "ads_report_daily",
    filters: { ...strings(["reportType", "adProduct", "campaignId", "adGroupId", "targetingId", "advertisedAsin", "searchTerm", "placement", "internalProfileId", "authorizationId"]),
      searchTerm: { ...text, description: "Exact case-sensitive search term after trimming; keyword is its alias, not full-text search." },
      search: { type: "string", maxLength: 120, description: "Case-sensitive substring in searchTerm, advertisedAsin, campaignId or adGroupId." }, from: date, to: date,
      ...sorting(["reportDate", "campaignId", "adGroupId", "impressions", "clicks", "spend", "orders", "sales", "searchTerm"]) },
    aliases: { asin: "advertisedAsin", keyword: "searchTerm" },
    maxPageSize: 100, defaultPageSize: 100, defaultSort: "reportDate", defaultDirection: "desc", dateSemantics: "report_source_timezone_date", publicationPolicy: "latest_published_observed_fact_key",
  },
};
export const mcpDatasets: readonly McpDataset[] = [
  ...skillDataTables.map(table => ({ ...table, ...contracts[table.name] })),
  {
    name: "ads_entities", source: "AmazonAdsEntityRecord", resource: "ads_entities", module: "amazon_ads", dataType: "entities", legacyTable: null,
    grain: ["internalProfileId", "entityType", "externalId"],
    fields: ["entityType", "externalId", "parentExternalId", "internalProfileId", "amazonProfileId", "sellerAccountId", "marketplaceId", "state", "sourceTaskId", "apiVersion"].map(name => ({ name, type: "string", nullable: ["parentExternalId", "state", "apiVersion"].includes(name) })),
    filters: { ...strings(["internalProfileId", "authorizationId", "campaignId", "adGroupId", "externalId", "state", "search"]),
      search: { ...text, description: "Substring in name/keywordText (case-insensitive normalized fields) or externalId; legacy JSON fallback may be case-sensitive. Not exact keyword matching." }, entityType: { type: "string", enum: adsEntityTypes },
      ...sorting(["entityType", "externalId", "state", "syncedAt", "sourceUpdatedAt"]) },
    aliases: { status: "state", sort: "sortBy", direction: "sortDirection" },
    maxPageSize: 100, defaultPageSize: 50, defaultSort: "entityType", defaultDirection: "asc", dateSemantics: "not_applicable", publicationPolicy: "current_observed_structure",
    warnings: ["只读当前已观察的结构快照；缺失行不表示已删除，不保证历史版本。", "结构数据无报告日期维度，不提供业绩指标。"],
  },
];
const byTable = new Map(mcpDatasets.filter(item => item.legacyTable).map(item => [item.legacyTable!, item]));
export function datasetForTable(name: string): McpDataset {
  const dataset = byTable.get(name);
  if (dataset) return dataset;
  if (knownLogicalTables.has(name)) throw new McpDatasetError("SCHEMA_UNVERIFIED", "SCHEMA_UNVERIFIED: 该逻辑表尚无已验证的系统数据源。", 409);
  throw new McpDatasetError("TABLE_NOT_ALLOWED", "TABLE_NOT_ALLOWED: 逻辑表不在允许清单中。", 403);
}
export function resolveMcpDataset(input: Record<string, unknown>): McpDataset {
  const hasTable = input.table !== undefined;
  const hasLocator = input.module !== undefined || input.dataType !== undefined;
  const boundedText = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 100;
  if ((!hasTable && !hasLocator) || (hasTable && !boundedText(input.table)) || (hasLocator && (!boundedText(input.module) || !boundedText(input.dataType)))) {
    throw new McpDatasetError("DATASET_LOCATOR_INVALID", "数据集须提供table或完整module/dataType。");
  }
  const located = hasLocator ? mcpDatasets.find(item => item.module === input.module && item.dataType === input.dataType) : undefined;
  if (hasLocator && !located) throw new McpDatasetError("TABLE_NOT_ALLOWED", "TABLE_NOT_ALLOWED: 数据集不在允许清单中。", 403);
  const legacy = hasTable ? datasetForTable(String(input.table)) : undefined;
  if (legacy && located && legacy.name !== located.name) throw new McpDatasetError("DATASET_LOCATOR_CONFLICT", "数据集定位参数冲突。");
  return located ?? legacy!;
}
export function datasetFilterProperties(dataset: McpDataset) {
  return { ...dataset.filters, ...Object.fromEntries(Object.entries(dataset.aliases).map(([alias, canonical]) => [alias, { ...dataset.filters[canonical], description: `Alias of ${canonical}; conflicts are rejected.` }])) };
}
export const datasetFilterNames = [...new Set(mcpDatasets.flatMap(dataset => Object.keys(datasetFilterProperties(dataset))))];
export const datasetScopeProperties = {
  sellerAccountId: { type: "string", minLength: 1, maxLength: 200 }, sellerAccountIds: { type: "array", minItems: 1, maxItems: 200, items: { type: "string", minLength: 1, maxLength: 200 } },
  marketplaceId: { type: "string", minLength: 1, maxLength: 200 },
};
export function datasetInputSchema(query: boolean) {
  const locators = { table: { type: "string", minLength: 1, maxLength: 100 }, module: { type: "string", minLength: 1, maxLength: 100 }, dataType: { type: "string", minLength: 1, maxLength: 100 } };
  const union = Object.fromEntries(datasetFilterNames.map(name => [name, { type: "string", maxLength: 200 }]));
  return {
    type: "object", additionalProperties: false,
    anyOf: [{ required: ["table"] }, { required: ["module", "dataType"] }],
    dependentRequired: { module: ["dataType"], dataType: ["module"] },
    properties: { ...datasetScopeProperties, ...locators, ...(query ? { ...union, filters: { type: "object", additionalProperties: false, properties: union }, page: { type: "integer", minimum: 1, maximum: 10000 }, pageSize: { type: "integer", minimum: 1, maximum: 1000 } } : {}) },
    ...(query ? { allOf: mcpDatasets.map(dataset => {
      const locator = { properties: { module: { const: dataset.module }, dataType: { const: dataset.dataType } }, required: ["module", "dataType"] };
      const supported = datasetFilterProperties(dataset);
      return { if: { anyOf: [locator, ...(dataset.legacyTable ? [{ properties: { table: { const: dataset.legacyTable } }, required: ["table"] }] : [])] },
        then: { properties: { pageSize: { maximum: dataset.maxPageSize }, ...Object.fromEntries(datasetFilterNames.map(name => [name, supported[name] ?? false])), filters: { type: "object", additionalProperties: false, properties: supported } } } };
    }) } : {}),
  };
}
export function describeMcpDataset(dataset: McpDataset) {
  return { name: dataset.name, module: dataset.module, dataType: dataset.dataType, legacyTable: dataset.legacyTable,
    source: dataset.source, grain: dataset.grain, fields: dataset.fields, filters: datasetFilterProperties(dataset),
    maxPageSize: dataset.maxPageSize, defaultPageSize: dataset.defaultPageSize,
    dateSemantics: dataset.dateSemantics, publicationPolicy: dataset.publicationPolicy,
    schemaStatus: "application_schema_confirmed_source_sample_pending", warnings: dataset.warnings ?? [] };
}

/** Pure bounded normalization; never uses client scope fields as authorization. */
export function normalizeDatasetQuery(dataset: McpDataset, input: Record<string, unknown>, now = new Date()) {
  const allowed = new Set([...Object.keys(datasetScopeProperties), "table", "module", "dataType", "filters", "page", "pageSize", ...datasetFilterNames]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new McpDatasetError("FIELD_NOT_MAPPED", "FIELD_NOT_MAPPED: 查询参数不属于此数据集协议。");
  const properties = datasetFilterProperties(dataset);
  const rawFilters = input.filters ?? {};
  if (!rawFilters || typeof rawFilters !== "object" || Array.isArray(rawFilters)) throw new McpDatasetError("FILTER_INVALID", "筛选条件须为对象。");
  const filters: Record<string, string> = {};
  const entries = [...Object.entries(rawFilters), ...Object.entries(input).filter(([key]) => datasetFilterNames.includes(key))];
  for (const [key, value] of entries) {
    const schema = properties[key];
    if (!Object.hasOwn(properties, key)) throw new McpDatasetError("FIELD_NOT_MAPPED", "FIELD_NOT_MAPPED: 筛选字段不属于此数据集。");
    if (typeof value !== "string" || !value.trim() || value.length > (schema.maxLength ?? 200)) throw new McpDatasetError("FILTER_INVALID", "筛选值无效或超过长度限制。");
    const normalized = dataset.module === "amazon_ads" ? value.trim() : value;
    if (schema.enum && !schema.enum.includes(normalized)) throw new McpDatasetError("FILTER_INVALID", "筛选枚举值无效。");
    if (schema.format === "date") validDay(normalized);
    const canonical = Object.hasOwn(dataset.aliases, key) ? dataset.aliases[key] : key;
    if (filters[canonical] !== undefined && filters[canonical] !== normalized) throw new McpDatasetError("FILTER_CONFLICT", "筛选参数或别名冲突。");
    filters[canonical] = normalized;
  }
  filters.sortBy ??= dataset.defaultSort;
  filters.sortDirection ??= dataset.defaultDirection;
  const integer = (value: unknown, fallback: number, max: number) => {
    const actual = value === undefined ? fallback : value;
    if (typeof actual !== "number" || !Number.isSafeInteger(actual) || actual < 1 || actual > max) throw new McpDatasetError("PAGINATION_INVALID", "分页参数超过数据集允许范围。");
    return actual;
  };
  const page = integer(input.page, 1, 10000), pageSize = integer(input.pageSize, dataset.defaultPageSize, dataset.maxPageSize);
  if (dataset.dateSemantics !== "not_applicable" && (filters.from || filters.to || dataset.name === "sales_traffic_daily" || dataset.name === "ads_report_daily")) {
    filters.to ??= now.toISOString().slice(0, 10);
    filters.from ??= shiftDay(filters.to, dataset.name === "sales_traffic_daily" ? -6 : -29);
    validDay(filters.from); validDay(filters.to);
    if (filters.from > filters.to) throw new McpDatasetError("DATE_RANGE_INVALID", "日期范围倒置。");
    const maxDays = dataset.name === "sales_traffic_daily" ? 90 : 366;
    if (Date.parse(filters.to) - Date.parse(filters.from) > maxDays * 86400000) throw new McpDatasetError("DATE_RANGE_INVALID", dataset.name === "sales_traffic_daily" ? "销售流量查询最多 90 天。" : "查询范围最多 367 天。");
  }
  return { dataset, filters, page, pageSize };
}
function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-") || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new McpDatasetError("DATE_RANGE_INVALID", "日期格式无效。");
}
function shiftDay(value: string, days: number) {
  validDay(value);
  return new Date(Date.parse(value) + days * 86400000).toISOString().slice(0, 10);
}

/** Published service totals are exposed only when their comparison dimensions are known. */
export function presentMcpReport<T extends {
  rows: unknown[]; total: number; totals: Array<{ currencyCode: string | null; attributionWindow: string | null; apiVersion: string }>;
  meta: { profiles: Array<{ timezone: string | null }> }; warnings: string[];
}>(data: T) {
  const timezones = new Set(data.meta.profiles.map(profile => profile.timezone));
  const safeTotals = !data.totals.length || (timezones.size === 1 && [...timezones].every(timezone => !!timezone)
    && data.totals.every(group => !!group.currencyCode && !!group.attributionWindow && !!group.apiVersion));
  const warnings = safeTotals ? data.warnings : [...data.warnings, "币种/归因口径缺失或Profile时区不一致，totals为null；不得将未知口径聚合为可比业绩。"];
  return { data: { items: data.rows, total: data.total }, totals: safeTotals ? data.totals : null,
    meta: { ...data.meta, totalsAvailability: safeTotals ? "GROUPED_COMPATIBLE_DIMENSIONS" : "BLOCKED_MIXED_OR_UNKNOWN_DIMENSIONS", warnings } };
}

/** Add protocol metadata without replacing consumer fields or coercing numeric strings. */
export function enrichDatasetResult(result: { data: { items: unknown[]; total: number }; meta: Record<string, unknown> }, input: {
  dataset: McpDataset; requestId: string; toolVersion: string; filters: Record<string, string>;
  scopePairs: Array<{ sellerAccountId: string; marketplaceId: string }>;
}) {
  const pairs = [...new Map(input.scopePairs.map(pair => [`${pair.sellerAccountId}\0${pair.marketplaceId}`, pair])).values()];
  const previous = result.meta.page as { page: number; pageSize: number; hasNext: boolean };
  const pagination = { ...previous, total: result.data.total, pageCount: Math.ceil(result.data.total / previous.pageSize) };
  const warnings = Array.isArray(result.meta.warnings) ? result.meta.warnings : input.dataset.warnings ?? [];
  return { ...result, pagination, warnings,
    meta: { ...result.meta, requestId: input.requestId, toolVersion: input.toolVersion,
      dataset: { id: input.dataset.name, module: input.dataset.module, dataType: input.dataset.dataType, legacyTable: input.dataset.legacyTable },
      scope: { pairs }, dateSemantics: input.dataset.dateSemantics,
      dateRange: input.filters.from ? { from: input.filters.from, to: input.filters.to } : null,
      sort: { field: input.filters.sortBy, direction: input.filters.sortDirection },
      grain: result.meta.grain ?? input.dataset.grain,
      schemaStatus: result.meta.schemaStatus ?? "application_schema_confirmed_source_sample_pending",
      resultStatus: result.data.total > 0 ? "AVAILABLE" : "EMPTY_RESULT",
      publicationPolicy: input.dataset.publicationPolicy,
      timezone: result.meta.profiles ? "per_profile" : null,
      currency: result.meta.currency ?? null, attributionWindow: result.meta.attributionWindow ?? null,
    },
  };
}
