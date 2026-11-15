/**
 * Sellfox MCP server-owned catalog.
 *
 * Every dataset here is a Sellfox-prefixed table with an explicit column
 * allow-list. Amazon tables never appear in this registry, so a Sellfox
 * credential cannot name them even with a hand-written request.
 *
 * Tool names are namespaced `sellfox.*`. The legacy un-namespaced names stay
 * as aliases so existing client configs keep working, but aliases resolve to
 * the same canonical tool and carry the same credential check.
 */
import { assertProviderDataset, assertProviderTable, McpIsolationError } from "../mcp/isolation";

export type SellfoxScopeMode = "tenant_store" | "tenant_only" | "store_join";

export type SellfoxDataset = {
  key: string;
  table: string;
  label: string;
  dateField: string;
  /** Column used for the credential store fence. `id` for the store master. */
  storeColumn: string | null;
  columns: readonly string[];
  allColumns?: readonly string[];
  description: string;
  defaultLimit: number;
  scopeMode: SellfoxScopeMode;
  nullableStore?: boolean;
  excludedColumns?: readonly string[];
  dateIsText?: boolean;
  headResource?: string;
  versionColumn?: string;
};

export const sellfoxDatasets: Record<string, SellfoxDataset> = {
  stores: {
    key: "stores", table: "SellfoxStore", label: "店铺", dateField: "updatedAt", storeColumn: "id",
    columns: ["\"externalId\"", "name", "marketplace", "country", "status"], description: "店铺主数据（仅返回凭证范围内的店铺）", defaultLimit: 200,
    scopeMode: "tenant_store",
  },
  listings: {
    key: "listings", table: "SellfoxListingSnapshot", label: "在线产品", dateField: "capturedAt", storeColumn: "storeId",
    columns: ["\"storeId\"", "\"msku\"", "asin", "title", "price", "fulfillable", "status", "\"capturedAt\""], description: "Listing 快照（价格/可售/状态）", defaultLimit: 50,
    scopeMode: "tenant_store", headResource: "listings", versionColumn: "capturedAt",
  },
  inventory: {
    key: "inventory", table: "SellfoxFbaInventorySnapshot", label: "FBA库存", dateField: "reportDate", storeColumn: "storeId",
    columns: ["\"storeId\"", "\"msku\"", "asin", "sku", "quantity", "\"totalInventory\"", "\"inTransit\"", "\"reportDate\""], description: "FBA 库存明细（可售/总库存/在途）", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true, headResource: "inventory", versionColumn: "capturedAt",
  },
  sales: {
    key: "sales", table: "SellfoxSalesDailySnapshot", label: "销量日快照", dateField: "reportDate", storeColumn: "storeId",
    columns: ["\"storeId\"", "\"msku\"", "asin", "\"reportDate\"", "orders", "quantity", "revenue", "currency"], description: "店铺×日×MSKU 销量、订单量与销售额", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  orders: {
    key: "orders", table: "SellfoxOrderSnapshot", label: "订单", dateField: "purchaseDate", storeColumn: "storeId",
    columns: ["\"storeId\"", "\"orderId\"", "asin", "\"msku\"", "\"purchaseDate\"", "qty", "\"itemAmount\"", "orderStatus", "\"fulfillmentChannel\"", "\"latestCapturedAt\""], description: "订单行快照", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  performance: {
    key: "performance", table: "SellfoxProductDailySnapshot", label: "产品利润日报", dateField: "reportDate", storeColumn: "storeId",
    columns: ["\"storeId\"", "asin", "\"msku\"", "\"reportDate\"", "\"orderNum\"", "\"saleRevenue\"", "\"grossProfit\"", "\"grossProfitRate\"", "\"onlySettle\""], description: "产品维度日利润；已结算与全部口径须区分", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  ads_product: {
    key: "ads_product", table: "SellfoxAdsProductDaily", label: "广告产品日报", dateField: "reportDate", storeColumn: "storeId",
    columns: ["\"storeId\"", "asin", "\"reportDate\"", "impressions", "clicks", "cost", "\"adSales\"", "\"adOrders\""], description: "ASIN 维度广告表现；ACoS/ROAS由查询服务派生", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  ads_campaign: {
    key: "ads_campaign", table: "SellfoxAdsCampaignDaily", label: "广告活动日报", dateField: "reportDate", storeColumn: "storeId",
    columns: ["\"storeId\"", "\"campaignId\"", "\"campaignName\"", "\"reportDate\"", "impressions", "clicks", "cost", "\"adSales\"", "\"adOrders\""], description: "广告活动维度表现；ACoS/ROAS由查询服务派生", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  fba_shipments: {
    key: "fba_shipments", table: "SellfoxFbaShipmentSnapshot", label: "FBA货件", dateField: "sourceCreatedAt", storeColumn: "storeId",
    columns: ["\"storeId\"", "\"shipmentId\"", "\"shipmentName\"", "asin", "msku", "sku", "\"declaredQty\"", "\"shippedQty\"", "\"receivedQty\"", "status", "\"sourceCreatedAt\"", "\"shippedAt\""], description: "FBA 入库货件行快照", defaultLimit: 50,
    scopeMode: "tenant_store", headResource: "fba_shipments", versionColumn: "latestCapturedAt",
  },
  ads_ad_group: {
    key: "ads_ad_group", table: "SellfoxAdsAdGroupDaily", label: "广告组日报", dateField: "reportDate", storeColumn: "storeId",
    columns: ["\"storeId\"", "\"campaignId\"", "\"adGroupId\"", "\"adGroupName\"", "\"reportDate\"", "adType", "impressions", "clicks", "cost", "\"adSales\"", "\"adOrders\""], description: "广告组维度日表现", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  ads_targeting: {
    key: "ads_targeting", table: "SellfoxAdsTargetingDaily", label: "广告投放日报", dateField: "reportDate", storeColumn: "storeId",
    columns: ["\"storeId\"", "\"campaignId\"", "\"adGroupId\"", "\"targetingId\"", "\"targetingText\"", "matchType", "\"reportDate\"", "adType", "impressions", "clicks", "cost", "\"adSales\"", "\"adOrders\""], description: "投放/关键词维度日表现", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  ads_search_term: {
    key: "ads_search_term", table: "SellfoxAdsSearchTermDaily", label: "广告搜索词日报", dateField: "reportDate", storeColumn: "storeId",
    columns: ["\"storeId\"", "\"campaignId\"", "\"adGroupId\"", "searchTerm", "\"reportDate\"", "adType", "impressions", "clicks", "cost", "\"adSales\"", "\"adOrders\""], description: "用户搜索词维度日表现", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  ads_placement: {
    key: "ads_placement", table: "SellfoxAdsPlacementDaily", label: "广告位日报", dateField: "reportDate", storeColumn: "storeId",
    columns: ["\"storeId\"", "\"campaignId\"", "placement", "\"reportDate\"", "adType", "impressions", "clicks", "cost", "\"adSales\"", "\"adOrders\""], description: "广告位维度日表现", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  ads_hourly: {
    key: "ads_hourly", table: "SellfoxHourlyMetric", label: "广告小时指标", dateField: "syncedAt", storeColumn: "storeId",
    columns: ["\"storeId\"", "\"reportDate\"", "hour", "adType", "entityType", "entityId", "entityName", "impressions", "clicks", "cost", "sales", "orders"], description: "小时粒度广告/销量指标", defaultLimit: 50,
    scopeMode: "tenant_store", excludedColumns: ["payload"],
  },
  api_records: {
    key: "api_records", table: "SellfoxApiRecord", label: "通用采集原始行", dateField: "syncedAt", storeColumn: "storeId",
    columns: ["endpointCode", "\"storeId\"", "scopeKey", "period", "externalId", "syncedAt"], description: "通用端点采集的原始响应行", defaultLimit: 50,
    scopeMode: "tenant_store", nullableStore: true, excludedColumns: ["payload"],
  },
  coverage: {
    key: "coverage", table: "SellfoxCoverage", label: "同步覆盖度", dateField: "updatedAt", storeColumn: "storeId",
    columns: ["resource", "\"storeId\"", "firstDate", "lastDate", "rowCount", "lastRunId", "lastStatus", "updatedAt"], description: "按资源与店铺记录的同步覆盖度", defaultLimit: 100,
    scopeMode: "tenant_store",
  },
  api_endpoints: {
    key: "api_endpoints", table: "SellfoxApiEndpoint", label: "赛狐API端点配置", dateField: "createdAt", storeColumn: null,
    columns: ["code", "label", "dateMode", "scopeMode", "chunkDays", "pageSize", "maxRows", "enabled", "createdAt"], description: "已登记的赛狐 API 端点配置（不含凭证）", defaultLimit: 100,
    scopeMode: "tenant_only",
  },
  sync_runs: {
    key: "sync_runs", table: "SellfoxSyncRun", label: "同步运行", dateField: "startedAt", storeColumn: null,
    columns: ["resource", "status", "error", "startedAt", "finishedAt", "summary"], description: "每次同步动作的状态与数据量摘要", defaultLimit: 100,
    scopeMode: "tenant_only", excludedColumns: ["executionToken"],
  },
  sync_shards: {
    key: "sync_shards", table: "SellfoxSyncShard", label: "同步分片", dateField: "startedAt", storeColumn: null,
    columns: ["resource", "scopeKey", "period", "status", "rows", "runId", "startedAt", "updatedAt", "finishedAt"], description: "资源、店铺与期间分片进度", defaultLimit: 100,
    scopeMode: "tenant_only",
  },
  sync_schedules: {
    key: "sync_schedules", table: "SellfoxSyncSchedule", label: "同步调度", dateField: "createdAt", storeColumn: null,
    columns: ["resource", "enabled", "intervalMinutes", "backfillStart", "backfillNextDate", "lastEnqueuedAt"], description: "按资源的同步调度配置", defaultLimit: 100,
    scopeMode: "tenant_only",
  },
  product_backfill: {
    key: "product_backfill", table: "SellfoxProductBackfillState", label: "利润回填状态", dateField: "createdAt", storeColumn: null,
    columns: ["nextReportDate", "emptyDayStreak", "status", "lastError", "lastRunAt", "completedAt"], description: "产品利润日报历史回填进度", defaultLimit: 100,
    scopeMode: "tenant_only",
  },
  snapshot_head: {
    key: "snapshot_head", table: "SellfoxSnapshotHead", label: "当前态指针", dateField: "capturedAt", storeColumn: "storeId",
    columns: ["\"storeId\"", "resource", "capturedAt"], description: "店铺×资源当前完整采集版本指针", defaultLimit: 100,
    scopeMode: "store_join",
  },
  sales_day_coverage: {
    key: "sales_day_coverage", table: "SellfoxSalesDayCoverage", label: "销量日写入覆盖", dateField: "capturedAt", storeColumn: "storeId",
    columns: ["\"storeId\"", "reportDate", "capturedAt", "rowWrites"], description: "销量日采集版本与写入行数", defaultLimit: 100,
    scopeMode: "store_join",
  },
};

export const sellfoxDatasetKeys = Object.keys(sellfoxDatasets);
export const sellfoxTableAllowList = [...new Set(Object.values(sellfoxDatasets).map(dataset => dataset.table))];

export function sellfoxDataset(key: string): SellfoxDataset {
  assertProviderDataset("sellfox", key, sellfoxDatasetKeys);
  const dataset = sellfoxDatasets[key];
  assertProviderTable("sellfox", dataset.table, sellfoxTableAllowList);
  return dataset;
}

export type SellfoxMcpToolName =
  | "sellfox.stores.list"
  | "sellfox.dataset.overview"
  | "sellfox.query_data"
  | "sellfox.restock_suggestions"
  | "sellfox.ads_diagnosis"
  | "sellfox.sales_trend";

export type SellfoxMcpToolDefinition = {
  name: SellfoxMcpToolName;
  canonicalName: SellfoxMcpToolName;
  description: string;
  module: string;
  version: string;
  inputSchema: Record<string, unknown>;
  operationMode: "READ_ONLY";
  action: "view";
  requiredPermissions: readonly string[];
  enabled: boolean;
  implementationStatus: "IMPLEMENTED";
};

const scopeProperties = {
  storeId: { type: "string", maxLength: 200, description: "可选的单个店铺；必须落在凭证店铺范围内" },
  limit: { type: "integer", minimum: 1, maximum: 500 },
  offset: { type: "integer", minimum: 0, maximum: 1_000_000 },
};

const tools: Array<{ name: SellfoxMcpToolName; description: string; schema: Record<string, unknown> }> = [
  {
    name: "sellfox.stores.list",
    description: "列出该凭证店铺范围内的店铺主数据；不存在跨凭证或跨组织店铺发现能力",
    schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "sellfox.dataset.overview",
    description: "列出赛狐数据集的行数/最新日期/覆盖店铺数；只统计该凭证店铺范围内的数据",
    schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "sellfox.query_data",
    description: "按数据集分页查询赛狐明细行，支持店铺/日期过滤；数据集为封闭清单，不接受任意表名",
    schema: {
      type: "object", additionalProperties: false, required: ["dataset"],
      properties: { dataset: { type: "string", enum: sellfoxDatasetKeys }, ...scopeProperties, fromDate: { type: "string", format: "date" }, toDate: { type: "string", format: "date" }, fields: { type: "string", enum: ["summary", "all"] } },
    },
  },
  {
    name: "sellfox.restock_suggestions",
    description: "补货建议：7/14/30 加权日销 × FBA 在手 × 在途，输出可售天数与建议补货量（口径：备货 30 天/安全 7 天）",
    schema: { type: "object", additionalProperties: false, properties: { ...scopeProperties, maxCoverDays: { type: "integer", minimum: 1, maximum: 365 } } },
  },
  {
    name: "sellfox.ads_diagnosis",
    description: "广告×库存联动诊断：每个 ASIN 花费/ROAS/ACOS + 可售天数，用于生成广告调整方案",
    schema: { type: "object", additionalProperties: false, properties: { ...scopeProperties, days: { type: "integer", minimum: 1, maximum: 90 } } },
  },
  {
    name: "sellfox.sales_trend",
    description: "日销量/销售额趋势；只汇总凭证店铺范围",
    schema: { type: "object", additionalProperties: false, properties: { ...scopeProperties, days: { type: "integer", minimum: 1, maximum: 90 } } },
  },
];

export const sellfoxMcpToolDefinitions: readonly SellfoxMcpToolDefinition[] = tools.map(tool => ({
  name: tool.name,
  canonicalName: tool.name,
  description: tool.description,
  module: "sellfox",
  version: "2.0.0",
  inputSchema: tool.schema,
  operationMode: "READ_ONLY",
  action: "view",
  requiredPermissions: ["sellfox:view"],
  enabled: true,
  implementationStatus: "IMPLEMENTED",
}));

/** Legacy client names map to canonical tools; they are never separate grants. */
export const sellfoxLegacyToolAliases: Record<string, SellfoxMcpToolName> = {
  dataset_overview: "sellfox.dataset.overview",
  query_data: "sellfox.query_data",
  restock_suggestions: "sellfox.restock_suggestions",
  ads_diagnosis: "sellfox.ads_diagnosis",
  sales_trend: "sellfox.sales_trend",
};

export const sellfoxMcpToolNames = sellfoxMcpToolDefinitions.map(tool => tool.name);

/** A credential grant may contain canonical names or legacy aliases; normalize once. */
export function normalizeSellfoxToolGrant(tool: string): SellfoxMcpToolName | null {
  if (sellfoxMcpToolNames.includes(tool as SellfoxMcpToolName)) return tool as SellfoxMcpToolName;
  return sellfoxLegacyToolAliases[tool] ?? null;
}

export function normalizeSellfoxToolGrants(tools: readonly string[]): SellfoxMcpToolName[] {
  const result = new Set<SellfoxMcpToolName>();
  for (const tool of tools) {
    const canonical = normalizeSellfoxToolGrant(tool);
    if (!canonical) throw new McpIsolationError(`工具「${tool}」不属于赛狐 MCP 目录。`, "TOOL_NOT_ALLOWED", 400, "sellfox");
    result.add(canonical);
  }
  return [...result];
}

export function sellfoxMcpDefinition(name: string): SellfoxMcpToolDefinition {
  const canonical = normalizeSellfoxToolGrant(name);
  const definition = sellfoxMcpToolDefinitions.find(tool => tool.name === canonical);
  if (!definition) throw new McpIsolationError(`未知工具「${name}」。`, "TOOL_NOT_ALLOWED", 400, "sellfox");
  return definition;
}

export function validateSellfoxMcpDefinitions(definitions: readonly SellfoxMcpToolDefinition[] = sellfoxMcpToolDefinitions) {
  const names = new Set<string>();
  for (const definition of definitions) {
    if (names.has(definition.name)) throw new Error(`Duplicate Sellfox MCP tool: ${definition.name}`);
    names.add(definition.name);
    if (!definition.name.startsWith("sellfox.")) throw new Error(`Sellfox MCP tool must be namespaced: ${definition.name}`);
    if (definition.inputSchema.type !== "object") throw new Error(`Invalid Sellfox MCP schema: ${definition.name}`);
  }
  for (const [alias, canonical] of Object.entries(sellfoxLegacyToolAliases)) {
    if (names.has(alias)) throw new Error(`Legacy alias collides with canonical tool: ${alias}`);
    if (!names.has(canonical)) throw new Error(`Legacy alias points to missing tool: ${alias}`);
  }
}
validateSellfoxMcpDefinitions();

/** Tool names visible to a credential. Discovery and runtime share this list. */
export function sellfoxDiscoverableTools(tools: readonly string[]) {
  const granted = new Set(normalizeSellfoxToolGrants(tools));
  return sellfoxMcpToolDefinitions.filter(tool => granted.has(tool.name));
}
