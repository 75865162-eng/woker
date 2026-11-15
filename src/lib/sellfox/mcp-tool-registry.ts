/**
 * Sellfox MCP server-owned catalog.
 *
 * Every dataset here is a Sellfox-prefixed table in a closed allow-list.
 * Amazon tables never appear in this registry, so a Sellfox credential cannot
 * name them even with a hand-written request.
 *
 * `query_data` returns the full physical row (`SELECT t.*`) by default, which
 * includes the original API response kept in `payload`. `columns` is only the
 * narrow backwards-compatible summary projection, selected with
 * `fields: "summary"`. Sensitive columns are dropped server-side and never
 * leave this process.
 *
 * Tool names are namespaced `sellfox.*`. The legacy un-namespaced names stay
 * as aliases so existing client configs keep working, but aliases resolve to
 * the same canonical tool and carry the same credential check.
 */
import { assertProviderDataset, assertProviderTable, McpIsolationError } from "@/lib/mcp/isolation";

export type SellfoxScopeMode =
  /** Table carries organizationId + workspaceId + storeId. */
  | "tenant_store"
  /** Table carries organizationId + workspaceId but has no store dimension. */
  | "tenant_only"
  /** Table only carries storeId; tenant is verified through SellfoxStore. */
  | "store_join";

export type SellfoxDataset = {
  key: string;
  table: string;
  label: string;
  dateField: string;
  /** Column used for the credential store fence. `id` for the store master. */
  storeColumn: string | null;
  /** Narrow backwards-compatible projection; every entry must be a real column. */
  columns: readonly string[];
  description: string;
  defaultLimit: number;
  scopeMode: SellfoxScopeMode;
  /** 该表存在 storeId IS NULL 的全局采集行；这些行只对 storeScope 含 "*" 的全店铺凭证可见，不向单店凭证放行。 */
  nullableStore?: boolean;
  /** Physical columns removed server-side before rows are returned. */
  excludedColumns?: readonly string[];
  /** dateField 的真实物理类型是 TEXT（YYYY-MM-DD）而非 date/timestamp：SQL 必须按文本比较，否则 PG 报 42883。 */
  dateIsText?: boolean;
  /** 该表按 capturedAt 保留多版本时，指向 SellfoxSnapshotHead.resource 的当前态指针。 */
  headResource?: string;
  /** 与 headResource 配对的物理版本列（capturedAt / latestCapturedAt）。 */
  versionColumn?: string;
};

const q = (...names: string[]) => names.map(name => `"${name}"`);

export const sellfoxDatasets: Record<string, SellfoxDataset> = {
  /* ---------------------------------------------------------------- */
  /* business facts                                                    */
  /* ---------------------------------------------------------------- */
  stores: {
    key: "stores", table: "SellfoxStore", label: "店铺", dateField: "updatedAt", storeColumn: "id",
    columns: q("externalId", "name", "marketplace", "country", "status"), description: "店铺主数据（仅返回凭证范围内的店铺）", defaultLimit: 200,
    scopeMode: "tenant_store",
  },
  listings: {
    key: "listings", table: "SellfoxListingSnapshot", label: "在线产品", dateField: "capturedAt", storeColumn: "storeId",
    columns: q("storeId", "msku", "asin", "title", "price", "listingQuantity", "status", "capturedAt"), description: "Listing 快照（价格/库存/状态）", defaultLimit: 50,
    scopeMode: "tenant_store", headResource: "listings", versionColumn: "capturedAt",
  },
  inventory: {
    key: "inventory", table: "SellfoxFbaInventorySnapshot", label: "FBA库存", dateField: "reportDate", storeColumn: "storeId",
    columns: q("storeId", "msku", "asin", "totalInventory", "quantity", "reportDate"), description: "FBA 库存明细（库存量与采集日）", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true, headResource: "inventory", versionColumn: "capturedAt",
  },
  sales: {
    key: "sales", table: "SellfoxSalesDailySnapshot", label: "销量日快照", dateField: "reportDate", storeColumn: "storeId",
    columns: q("storeId", "msku", "asin", "reportDate", "orders", "revenue", "quantity"), description: "店铺×日×MSKU 销量与销售额", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  orders: {
    key: "orders", table: "SellfoxOrderSnapshot", label: "订单", dateField: "purchaseDate", storeColumn: "storeId",
    columns: q("storeId", "orderId", "asin", "msku", "purchaseDate", "qty", "itemAmount", "orderStatus", "fulfillmentChannel"), description: "订单明细（近 30 天滚动）", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  performance: {
    key: "performance", table: "SellfoxProductDailySnapshot", label: "产品利润日报", dateField: "reportDate", storeColumn: "storeId",
    columns: q("storeId", "asin", "msku", "reportDate", "orderNum", "saleRevenue", "grossProfit", "grossProfitRate"), description: "产品维度日利润（全字段含 100+ 费用列与原始 payload）", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  ads_product: {
    key: "ads_product", table: "SellfoxAdsProductDaily", label: "广告产品日报", dateField: "reportDate", storeColumn: "storeId",
    columns: q("storeId", "asin", "reportDate", "adType", "impressions", "clicks", "cost", "adSales", "adOrders"), description: "ASIN 维度广告表现（原始列，衍生指标由分析工具计算）", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  ads_campaign: {
    key: "ads_campaign", table: "SellfoxAdsCampaignDaily", label: "广告活动日报", dateField: "reportDate", storeColumn: "storeId",
    columns: q("storeId", "campaignName", "reportDate", "adType", "impressions", "clicks", "cost", "adSales", "adOrders"), description: "广告活动维度表现（原始列，衍生指标由分析工具计算）", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  ads_ad_group: {
    key: "ads_ad_group", table: "SellfoxAdsAdGroupDaily", label: "广告组日报", dateField: "reportDate", storeColumn: "storeId",
    columns: q("storeId", "campaignId", "adGroupId", "adGroupName", "reportDate", "adType", "impressions", "clicks", "cost", "adSales", "adOrders"), description: "广告组维度日表现", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  ads_targeting: {
    key: "ads_targeting", table: "SellfoxAdsTargetingDaily", label: "广告投放日报", dateField: "reportDate", storeColumn: "storeId",
    columns: q("storeId", "campaignId", "adGroupId", "targetingId", "targetingText", "matchType", "reportDate", "adType", "impressions", "clicks", "cost", "adSales", "adOrders"), description: "投放/关键词维度日表现", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  ads_search_term: {
    key: "ads_search_term", table: "SellfoxAdsSearchTermDaily", label: "广告搜索词日报", dateField: "reportDate", storeColumn: "storeId",
    columns: q("storeId", "campaignId", "adGroupId", "searchTerm", "reportDate", "adType", "impressions", "clicks", "cost", "adSales", "adOrders"), description: "用户搜索词维度日表现", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  ads_placement: {
    key: "ads_placement", table: "SellfoxAdsPlacementDaily", label: "广告位日报", dateField: "reportDate", storeColumn: "storeId",
    columns: q("storeId", "campaignId", "placement", "reportDate", "adType", "impressions", "clicks", "cost", "adSales", "adOrders"), description: "广告位维度日表现", defaultLimit: 50,
    scopeMode: "tenant_store", dateIsText: true,
  },
  ads_hourly: {
    key: "ads_hourly", table: "SellfoxHourlyMetric", label: "广告小时指标", dateField: "syncedAt", storeColumn: "storeId",
    columns: q("storeId", "reportDate", "hour", "adType", "entityType", "entityId", "entityName", "impressions", "clicks", "cost", "sales", "orders"), description: "小时粒度广告/销量指标", defaultLimit: 50,
    scopeMode: "tenant_store",
  },
  fba_shipments: {
    key: "fba_shipments", table: "SellfoxFbaShipmentSnapshot", label: "FBA货件", dateField: "latestCapturedAt", storeColumn: "storeId",
    columns: q("storeId", "shipmentId", "sku", "declaredQty", "shippedQty", "receivedQty", "status", "latestCapturedAt"), description: "FBA 入库货件", defaultLimit: 50,
    scopeMode: "tenant_store", headResource: "fba_shipments", versionColumn: "latestCapturedAt",
  },
  api_records: {
    key: "api_records", table: "SellfoxApiRecord", label: "通用采集原始行", dateField: "syncedAt", storeColumn: "storeId",
    columns: q("endpointCode", "storeId", "scopeKey", "period", "externalId", "syncedAt"), description: "通用端点采集的原始响应行（payload 完整保留，不猜字段、不补零）", defaultLimit: 50,
    scopeMode: "tenant_store", nullableStore: true,
  },
  ads_proposals: {
    key: "ads_proposals", table: "SellfoxAdsProposal", label: "广告调整建议", dateField: "createdAt", storeColumn: "storeId",
    columns: q("storeId", "asin", "kind", "action", "entityType", "externalId", "status", "createdAt"), description: "广告调整草稿与建议（非正式主档）", defaultLimit: 50,
    scopeMode: "tenant_store",
  },
  /* ---------------------------------------------------------------- */
  /* sync evidence / coverage                                          */
  /* ---------------------------------------------------------------- */
  coverage: {
    key: "coverage", table: "SellfoxCoverage", label: "同步覆盖度", dateField: "updatedAt", storeColumn: "storeId",
    columns: q("resource", "storeId", "firstDate", "lastDate", "rowCount", "lastRunId", "lastStatus", "updatedAt"), description: "按资源×店铺从事实表重算的覆盖度", defaultLimit: 100,
    scopeMode: "tenant_store",
  },
  report_tasks: {
    key: "report_tasks", table: "SellfoxReportTask", label: "赛狐报表任务", dateField: "updatedAt", storeColumn: "storeId",
    columns: q("storeId", "runId", "reportTypeCode", "adType", "startDate", "endDate", "status", "updatedAt"), description: "广告报表任务与状态", defaultLimit: 100,
    scopeMode: "tenant_store",
  },
  snapshot_head: {
    key: "snapshot_head", table: "SellfoxSnapshotHead", label: "当前态指针", dateField: "capturedAt", storeColumn: "storeId",
    columns: q("storeId", "resource", "capturedAt"), description: "每个店铺×资源的当前完整采集版本", defaultLimit: 100,
    scopeMode: "store_join",
  },
  sales_day_coverage: {
    key: "sales_day_coverage", table: "SellfoxSalesDayCoverage", label: "销量日写入覆盖", dateField: "capturedAt", storeColumn: "storeId",
    columns: q("storeId", "reportDate", "capturedAt", "rowWrites"), description: "销量日行的采集版本与写入行数", defaultLimit: 100,
    scopeMode: "store_join",
  },
  sync_runs: {
    key: "sync_runs", table: "SellfoxSyncRun", label: "同步运行", dateField: "startedAt", storeColumn: null,
    columns: q("resource", "status", "error", "startedAt", "finishedAt", "summary"), description: "每次同步动作的时间/状态/数据量（summary 保留原始计数）", defaultLimit: 100,
    scopeMode: "tenant_only", excludedColumns: ["executionToken"],
  },
  sync_shards: {
    key: "sync_shards", table: "SellfoxSyncShard", label: "同步分片", dateField: "startedAt", storeColumn: null,
    columns: q("resource", "scopeKey", "period", "status", "rows", "runId", "startedAt", "updatedAt", "finishedAt"), description: "资源×店铺×期间的分片进度与行数", defaultLimit: 100,
    scopeMode: "tenant_only",
  },
  api_endpoints: {
    key: "api_endpoints", table: "SellfoxApiEndpoint", label: "赛狐API端点配置", dateField: "createdAt", storeColumn: null,
    columns: q("code", "label", "path", "dateMode", "scopeMode", "chunkDays", "pageSize", "maxRows", "enabled", "createdAt"), description: "已登记的赛狐 API 端点（不含凭证）", defaultLimit: 100,
    scopeMode: "tenant_only",
  },
  sync_schedules: {
    key: "sync_schedules", table: "SellfoxSyncSchedule", label: "同步调度", dateField: "createdAt", storeColumn: null,
    columns: q("resource", "enabled", "intervalMinutes", "backfillStart", "backfillNextDate", "lastEnqueuedAt"), description: "按资源的自动同步调度配置", defaultLimit: 100,
    scopeMode: "tenant_only",
  },
  product_backfill: {
    key: "product_backfill", table: "SellfoxProductBackfillState", label: "利润回填状态", dateField: "createdAt", storeColumn: null,
    columns: q("nextReportDate", "emptyDayStreak", "status", "lastError", "lastRunAt", "completedAt"), description: "产品利润日报的历史回填进度", defaultLimit: 100,
    scopeMode: "tenant_only",
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
    description: "列出赛狐所有数据集的行数/最新日期/覆盖店铺数/完整物理字段清单；只统计该凭证店铺范围内的数据",
    schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "sellfox.query_data",
    description: "按数据集分页查询赛狐本地已落地的明细行，默认返回整行全部原始字段（含 payload 原始响应）；支持时间范围、排序方向与当前态/历史版本口径，返回围栏内总行数、来源表、更新时间与版本信息；数据集为封闭清单，不接受任意表名",
    schema: {
      type: "object", additionalProperties: false, required: ["dataset"],
      properties: { dataset: { type: "string", enum: sellfoxDatasetKeys }, ...scopeProperties, fromDate: { type: "string", format: "date" }, toDate: { type: "string", format: "date" },
        fields: { type: "string", enum: ["all", "summary"], description: "all=整行全部物理字段（默认）；summary=仅返回兼容用的窄列投影" },
        sortDirection: { type: "string", enum: ["asc", "desc"], description: "排序方向；排序列固定为数据集的日期列，不接受任意列名" },
        versionScope: { type: "string", enum: ["current", "history", "all"], description: "current=仅 Head 指针指向的当前完整采集版本（默认，与 ERP 页面口径一致）；history=仅历史版本；all=不过滤。仅对按 capturedAt 保留多版本的快照表生效" } },
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
  version: "2.2.0",
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
