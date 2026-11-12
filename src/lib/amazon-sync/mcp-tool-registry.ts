import { mcpDatasets, datasetInputSchema, datasetFilterProperties, datasetScopeProperties } from "./mcp-datasets";
import { amazonMcpScopeSchema, requiresAmazonMcpScope } from "./mcp-scope";
/** Server-owned catalog. No credentials, process configuration, or database imports. */
export type McpSchema = Record<string, unknown>;
export type McpOperationMode = "READ_ONLY" | "APPROVAL_REQUEST";
export type McpDataAction = "view" | "export" | "sync";
export const amazonMcpSyncResources = [
  "inventory", "catalog", "sales_traffic", "orders", "finance", "settlements",
  "reimbursements", "returns", "inventory_age", "inventory_events", "fulfillment", "catalog_items", "listing_details", "promotions",
] as const;
/** Fixed business tools inherit account read access; clients cannot change their dataset. */
export const skillBusinessDatasetTools = {
  inventory_get_snapshot: "inventory",
  inventory_get_events: "inventory_events",
  inventory_get_age: "inventory_age",
  reimbursement_get_events: "inventory_events",
  reimbursement_get_payments: "reimbursements",
  returns_get_items: "returns",
  orders_search: "orders",
  orders_get_items: "order_items",
  finance_get_transactions: "finance_transactions",
  finance_get_settlements: "settlements_v2",
} as const;
const reimbursementReadTools = ["reimbursement_get_events", "reimbursement_get_payments", "finance_get_transactions"] as const;
export function hasReimbursementAnalysisReadPath(availableTools: readonly string[]) {
  return availableTools.includes("data_query") || reimbursementReadTools.every(tool => availableTools.includes(tool));
}
export function fixedAmazonMcpDataset(tool: string): "orders" | "order_items" | "inventory" | "sales_traffic_daily" | "listings" | "inventory_events" | "inventory_age" | "reimbursements" | "returns" | "finance_transactions" | "settlements_v2" | "promotions" | "promotion_details" | "promotion_items" | undefined {
  if (Object.hasOwn(skillBusinessDatasetTools, tool)) return skillBusinessDatasetTools[tool as keyof typeof skillBusinessDatasetTools];
  if (tool === "promotions_search") return "promotions";
  if (tool === "promotions_get") return "promotion_details";
  if (tool === "promotions_get_items") return "promotion_items";
  if (tool === "get_listings") return "listings";
  if (tool === "get_inventory") return "inventory";
  if (tool === "get_sales") return "sales_traffic_daily";
  if (tool === "get_orders") return "orders";
  if (tool === "get_order_items") return "order_items";
  return undefined;
}
const legacyTools = [
  ["promotions_search", "查询本地已发布促销摘要；单账号、单站点，不实时调用 Amazon"],
  ["promotions_get", "读取本地促销完整详情及发布/最新修订；费用快照不是实际花费"],
  ["promotions_get_items", "分页读取本地促销 Selection 商品、折扣和预算；CATALOG 仅保留规则；kind=PROMOTION_SELECTION 返回完整商品分页及商品异常"],
  ["inventory_get_snapshot", "分页读取 SP-API 已发布 FBA 库存快照；日期为 capturedAt UTC，不代表历史事件或全部库存渠道"],
  ["inventory_get_events", "分页读取 Reports GET_LEDGER_DETAIL_VIEW_DATA 已发布且归属验证通过的库存事件；日期为事件业务日期，重叠报告不可直接相加"],
  ["inventory_get_age", "分页读取 Reports GET_FBA_INVENTORY_PLANNING_DATA 最新已发布库龄快照；reportId 可指定历史版本，不累加快照"],
  ["reimbursement_get_events", "分页读取已发布 Ledger 库存事件证据；不是未结索赔或资格判断，未归属/未发布不等于没有损失"],
  ["reimbursement_get_payments", "分页读取 Reports GET_FBA_REIMBURSEMENTS_DATA 已发布赔付记录，按 approval-date；原币种金额与数量文本保留，不代表已关联库存事件"],
  ["reimbursement_analyze", "只读分析同一账号/站点的库存事件、赔付报告和财务交易；逐域分页、校验覆盖并保留证据。仅使用已验证关联键，未知关联标记 UNMATCHED/UNABLE_TO_CONFIRM"],
  ["returns_get_items", "分页读取单份已发布 FBA 仓收退货报告，按 returnAt UTC；不代表全渠道退货、退款或完整历史"],
  ["orders_search", "分页读取已入库订单及详情完整性，默认 createdTime UTC，可显式选择 sourceUpdatedAt；不实时请求 Amazon"],
  ["orders_get_items", "分页读取已入库订单商品行及数量、SKU、ASIN、原币金额，默认订单创建日期；明细缺失不能解释为零"],
  ["finance_get_transactions", "分页读取 Finances v2024-06-19 已入库交易；保留原金额、币种、交易类型及 postedAt UTC，读取继承账号分配"],
  ["finance_get_settlements", "分页读取 Reports GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2 的已发布结算明细；保留原始币种和交易粒度，不将报告头当作交易金额"],
  ["get_listings", "只读分页查询单账号、单站点最近成功发布的 Listing 快照；支持 SKU、ASIN、状态及 UTC 采集日期筛选，不是商品主档或完整 Catalog"],
  ["get_inventory", "只读分页查询单账号、单站点最近成功发布的库存快照；日期筛选为 UTC 采集日期，不是库存事件历史"],
  ["get_sales", "只读分页查询单账号、单站点指定业务日期范围的店铺逐日销售流量；不提供 SKU/ASIN 拆分，保留原币与精确数值文本"],
  ["get_orders", "只读分页查询单账号、单站点已入库订单，包含明细完整性和金额缺失提示"],
  ["get_order_items", "只读分页查询单账号、单站点订单商品行，支持订单、SKU、ASIN 和日期筛选"],
  ["amazon.fields.coverage", "只读实际覆盖报告：查看原件、映射、批次核对、业务可见行和结算缺币种数量；不代表官方全字段完成"],
  ["amazon.fields.catalog", "只读字段目录：显示已归档原件观察及未映射状态；不表示字段已完整接通"],
  ["amazon.data.archive.read", "只读分页读取已保存原件的业务字段，保留未知字段和精确数字文本；JSON 可指定 RFC 6901 pointer，TSV 保留列顺序。秘密不返回；原件不代表已发布业务事实"],
  ["amazon.ads.reports.list", "只读查询本地最新已发布广告日报；读取继承账号分配"],
  ["amazon.ads.entities.list", "只读分页查询已同步的 SP 广告结构；无报告日期维度"],
  ["ads_list_entities", "Skill 兼容别名：只读查询已同步的 SP 广告结构"],
  ["ads_get_campaign_structure", "Skill 兼容别名：只读查询活动结构"],
  ["ads_get_sync_status", "Skill 兼容别名：读取 Ads 同步和发布状态"],
  ["ads_get_data_health", "Skill 兼容别名：读取 Ads 数据完整性和 Schema 状态"],
  ["ads_get_connection_status", "Skill 兼容别名：读取 Ads 连接状态"],
  ["ads_get_settings", "Skill 兼容别名：读取 Ads Profile、合同和同步配置摘要"],
  ["amazon.stores.list", "查询当前授权店铺和站点"], ["amazon.inventory.list", "查询最近已同步的库存"],
  ["amazon.inventory.summary", "汇总授权库存"], ["amazon.catalog.list", "查询最近已同步的刊登"],
  ["amazon.sales.list", "查询店铺逐日销售流量快照"], ["amazon.sync.status", "查询同步状态"],
  ["amazon.history.read", "查询成功同步的历史库存或刊登快照"], ["amazon.sales.export", "导出最多 1000 条授权销售快照"],
  ["data_list_tables", "列出当前授权范围内有已发布数据的 Skill 逻辑表"],
  ["data_describe_table", "查看已接入 Skill 逻辑表的字段、粒度和限制"],
  ["data_query", "分页查询已接入 Skill 逻辑表的已发布数据"],
  ["data_sync_status", "查询当前授权数据源和同步状态"],
  ["data_sync_start", "提交同步申请；审批并应用后才会创建同步任务"],
] as const;
function legacyToolInputSchema(name: string) {
  const scopeProperties: Record<string, unknown> = {
    sellerAccountId: { type: "string" }, sellerAccountIds: { type: "array", items: { type: "string" }, maxItems: 200 },
    marketplaceId: { type: "string" },
  };
  if (name === "amazon.data.archive.read") return { type: "object", additionalProperties: false, required: ["sourceId", "taskId", "rawPage"], properties: {
    ...scopeProperties, sourceId: { type: "string", minLength: 1, maxLength: 200 }, taskId: { type: "string", minLength: 1, maxLength: 200 },
    rawPage: { type: "integer", minimum: -2147483648, maximum: 2147483647 }, pointer: { type: "string", maxLength: 2048 },
    page: { type: "integer", minimum: 1, maximum: 10000 }, pageSize: { type: "integer", minimum: 1, maximum: 100 },
  } };
  if (name === "reimbursement_analyze") return { type: "object", additionalProperties: false,
    required: ["from", "to"], properties: { ...scopeProperties, from: { type: "string", format: "date" }, to: { type: "string", format: "date" } } };
  if (fixedAmazonMcpDataset(name) || name === "amazon.ads.reports.list" || ["amazon.ads.entities.list", "ads_list_entities", "ads_get_campaign_structure"].includes(name)) {
    const dataset = mcpDatasets.find(item => item.name === (fixedAmazonMcpDataset(name) ?? (name === "amazon.ads.reports.list" ? "ads_report_daily" : "ads_entities")))!;
    return { type: "object", additionalProperties: false, ...(["promotions_get", "promotions_get_items"].includes(name) ? { required: ["promotionId"] } : name === "get_sales" ? { required: ["from", "to"] } : {}), properties: { ...datasetScopeProperties, ...datasetFilterProperties(dataset),
      ...(name === "ads_get_campaign_structure" ? { entityType: { type: "string", const: "SP:campaign" } } : {}),
      page: { type: "integer", minimum: 1, maximum: 10000 }, pageSize: { type: "integer", minimum: 1, maximum: dataset.maxPageSize } } };
  }
  if (name === "amazon.fields.coverage") return { type: "object", additionalProperties: false, properties: {
    ...scopeProperties, sourceId: { type: "string", minLength: 1, maxLength: 200 }, from: { type: "string", format: "date" }, to: { type: "string", format: "date" },
  }, required: ["sourceId"] };
  if (name === "amazon.fields.catalog") return { type: "object", additionalProperties: false, properties: {
    ...scopeProperties, sourceId: { type: "string", minLength: 1, maxLength: 200 }, page: { type: "integer", minimum: 1, maximum: 9999 },
  }, required: ["sourceId"] };
  if (name === "data_query" || name === "data_describe_table") return datasetInputSchema(name === "data_query");
  if (["ads_get_sync_status", "ads_get_data_health", "ads_get_connection_status", "ads_get_settings"].includes(name)) return {
    type: "object", additionalProperties: false, properties: scopeProperties,
  };
  if (["data_list_tables", "data_describe_table", "data_query", "data_sync_status", "data_sync_start"].includes(name)) {
    const properties = { ...scopeProperties };
    if (name === "data_sync_start") {
      properties.resource = { type: "string", enum: amazonMcpSyncResources, maxLength: 100 };
      properties.dateFrom = { type: "string", format: "date" };
      properties.dateTo = { type: "string", format: "date" };
      properties.eventType = { type: "string", enum: ["", "Adjustments", "CustomerReturns", "Receipts", "Shipments", "VendorReturns", "WhseTransfers"] };
      properties.taskId = { type: "string", minLength: 1, maxLength: 200, description: "申请恢复当前账号及站点的原任务；支持订单、财务、退货、赔付、库存事件、在途、目录和Listing详情。目录及Listing可重新审批恢复已取消任务；保留原范围、原件和检查点，不能同时指定日期或事件类型。" };
    }
    const required = name === "data_sync_start" ? ["resource"] : [];
    return { type: "object", additionalProperties: false, properties, ...(required.length ? { required } : {}) };
  }
  const properties: Record<string, unknown> = {
    ...scopeProperties,
    from: { type: "string", format: "date" }, to: { type: "string", format: "date" },
    keyword: { type: "string", maxLength: 200 }, page: { type: "integer", minimum: 1, maximum: 10000 }, taskId: { type: "string" },
  };
  return { type: "object", additionalProperties: false, properties };
}

export type AmazonMcpToolName = typeof legacyTools[number][0];
export type AmazonMcpToolDefinition = {
  name: AmazonMcpToolName;
  canonicalName: AmazonMcpToolName;
  description: string;
  module: string;
  version: string;
  inputSchema: McpSchema;
  outputSchema: McpSchema;
  operationMode: McpOperationMode;
  requiredPermissions: readonly string[];
  action: McpDataAction;
  enabled: boolean;
  implementationStatus: "IMPLEMENTED";
};

const arrayTools = new Set<string>(["amazon.stores.list", "amazon.sync.status"]);
export const amazonMcpToolDefinitions: readonly AmazonMcpToolDefinition[] = legacyTools.map(([name, description]) => {
  const action: McpDataAction = name === "amazon.sales.export" ? "export" : name === "data_sync_start" ? "sync" : "view";
  const canonicalName = name === "ads_list_entities" || name === "ads_get_campaign_structure" ? "amazon.ads.entities.list" : name;
  const rowQuery = !!fixedAmazonMcpDataset(name) || ["data_query", "amazon.ads.reports.list", "amazon.ads.entities.list", "ads_list_entities", "ads_get_campaign_structure"].includes(name);
  const outputSchema: McpSchema = name === "data_sync_start" ? {
    type: "object", required: ["data", "meta"], properties: {
      data: { type: "object", required: ["approvalRequired", "started", "changeRequest"], properties: {
        approvalRequired: { const: true }, started: { const: false }, changeRequest: { type: "object", required: ["id", "status"], properties: { id: { type: "string", minLength: 1 }, status: { const: "REQUESTED" } } },
      } }, meta: { type: "object" },
    },
  } : rowQuery ? {
    type: "object", required: ["data", "meta", "pagination", "warnings"],
    properties: {
      data: { type: "object", required: ["items", "total"], properties: { items: { type: "array", items: { type: "object" } }, total: { type: "integer", minimum: 0 } } },
      totals: { anyOf: [{ type: "array", items: { type: "object" } }, { type: "null" }] },
      pagination: { type: "object", required: ["page", "pageSize", "total", "pageCount", "hasNext"], properties: { page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1 }, total: { type: "integer", minimum: 0 }, pageCount: { type: "integer", minimum: 0 }, hasNext: { type: "boolean" } } },
      warnings: { type: "array", items: { type: "string" } },
      meta: { type: "object", required: ["requestId", "toolVersion", "dataset", "scope", "dateSemantics", "resultStatus", "schemaStatus"], properties: { requestId: { type: "string" }, toolVersion: { type: "string" }, resultStatus: { type: "string", enum: ["AVAILABLE", "EMPTY_RESULT"] } } },
    },
  } : arrayTools.has(name)
    ? { type: "array", items: { type: "object" } }
    : { type: "object" };
  return {
    name, canonicalName, description, module: name.startsWith("amazon.ads.") || name.startsWith("ads_") ? "amazon_ads" : "amazon_sync",
    version: requiresAmazonMcpScope(name) ? "2.0.0" : "1.0.0", inputSchema: amazonMcpScopeSchema(name, legacyToolInputSchema(name)), outputSchema,
    operationMode: action === "sync" ? "APPROVAL_REQUEST" : "READ_ONLY",
    requiredPermissions: action === "sync" ? ["operations:create", "amazon_data:sync:mcp"] : ["amazon_account:assigned"],
    action, enabled: true, implementationStatus: "IMPLEMENTED",
  };
});

export function validateAmazonMcpDefinitions(definitions: readonly AmazonMcpToolDefinition[]) {
  const names = new Set<string>();
  for (const definition of definitions) {
    if (names.has(definition.name)) throw new Error(`Duplicate MCP tool: ${definition.name}`);
    names.add(definition.name);
    if (definition.inputSchema.type !== "object" || !["object", "array"].includes(String(definition.outputSchema.type))) throw new Error(`Invalid MCP schema: ${definition.name}`);
    if (!definition.version || !definition.requiredPermissions.length) throw new Error(`Missing MCP metadata: ${definition.name}`);
  }
  for (const definition of definitions) {
    const canonical = definitions.find(item => item.name === definition.canonicalName);
    if (!canonical || canonical.canonicalName !== canonical.name || canonical.action !== definition.action) throw new Error(`Invalid MCP alias: ${definition.name}`);
  }
}
validateAmazonMcpDefinitions(amazonMcpToolDefinitions);

/** Require every catalog name to have an explicit server handler; never export internal Agent tools. */
export function bindAmazonMcpHandlers<Context, Result>(
  handlers: Record<AmazonMcpToolName, (context: Context) => Promise<Result>>,
  definitions: readonly AmazonMcpToolDefinition[] = amazonMcpToolDefinitions,
) {
  validateAmazonMcpDefinitions(definitions);
  const names = new Set<string>(definitions.map(item => item.name));
  for (const name of Object.keys(handlers)) if (!names.has(name)) throw new Error(`Orphan MCP handler: ${name}`);
  return definitions.map(definition => {
    const handler = handlers[definition.name];
    if (typeof handler !== "function") throw new Error(`Missing MCP handler: ${definition.name}`);
    return { ...definition, handler };
  });
}

/** Keep the credential editor's historical tuple contract. */
export const amazonMcpTools = amazonMcpToolDefinitions.map(({ name, description }) => [name, description] as const);
export const amazonMcpToolCatalog = amazonMcpToolDefinitions.map(definition => ({ ...definition }));

export function isCallableAmazonMcpTool(definition: AmazonMcpToolDefinition) {
  return definition.enabled && definition.implementationStatus === "IMPLEMENTED";
}

export function mcpDiscoveryDescriptor(definition: AmazonMcpToolDefinition, protocolVersion: string | null) {
  return {
    name: definition.name, description: definition.description, inputSchema: definition.inputSchema,
    annotations: { readOnlyHint: definition.operationMode === "READ_ONLY", destructiveHint: false, openWorldHint: false },
    ...(protocolVersion === "2025-06-18" ? {
      ...(definition.outputSchema.type === "object" ? { outputSchema: definition.outputSchema } : {}),
      _meta: { "erp/module": definition.module, "erp/toolVersion": definition.version, "erp/operationMode": definition.operationMode,
        "erp/implementationStatus": definition.implementationStatus, "erp/dataAvailability": "NOT_CHECKED" },
    } : {}),
  };
}
