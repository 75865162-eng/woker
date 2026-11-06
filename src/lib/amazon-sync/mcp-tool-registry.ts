/** Server-owned catalog. No credentials, process configuration, or database imports. */
export type McpSchema = Record<string, unknown>;
export type McpOperationMode = "READ_ONLY" | "APPROVAL_REQUEST";
export type McpDataAction = "view" | "export" | "sync";
const legacyTools = [
  ["amazon.ads.reports.list", "只读查询本地最新已发布广告日报；需要独立显式授权"],
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
  if (name === "amazon.ads.reports.list") return {
    type: "object", additionalProperties: false, properties: {
      ...scopeProperties,
      ...Object.fromEntries(["internalProfileId", "authorizationId", "reportType", "adProduct", "campaignId", "adGroupId", "targetingId", "advertisedAsin", "searchTerm", "placement", "search"].map(key => [key, { type: "string", maxLength: 200 }])),
      from: { type: "string", format: "date" }, to: { type: "string", format: "date" },
      page: { type: "integer", minimum: 1, maximum: 10000 }, pageSize: { type: "integer", minimum: 1, maximum: 100 },
      sortBy: { type: "string", enum: ["reportDate", "campaignId", "adGroupId", "impressions", "clicks", "spend", "orders", "sales", "searchTerm"] },
      sortDirection: { type: "string", enum: ["asc", "desc"] },
    },
  };
  if (["amazon.ads.entities.list", "ads_list_entities", "ads_get_campaign_structure"].includes(name)) return {
    type: "object", additionalProperties: false, properties: {
      ...scopeProperties,
      ...Object.fromEntries(["internalProfileId", "authorizationId", "campaignId", "adGroupId", "externalId", "state", "search"].map(key => [key, { type: "string", maxLength: 200 }])),
      entityType: { type: "string", enum: ["SP:campaign", "SP:ad-group", "SP:keyword", "SP:target", "SP:negative-keyword", "SP:negative-target", "SP:campaign-negative-keyword", "SP:campaign-negative-target"] },
      page: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
      pageSize: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      sort: { type: "string", enum: ["entityType", "externalId", "state", "syncedAt", "sourceUpdatedAt"] },
      direction: { type: "string", enum: ["asc", "desc"] },
    },
  };
  if (["ads_get_sync_status", "ads_get_data_health", "ads_get_connection_status", "ads_get_settings"].includes(name)) return {
    type: "object", additionalProperties: false, properties: scopeProperties,
  };
  if (["data_list_tables", "data_describe_table", "data_query", "data_sync_status", "data_sync_start"].includes(name)) {
    const properties = { ...scopeProperties };
    if (name === "data_describe_table") properties.table = { type: "string", maxLength: 100 };
    if (name === "data_query") {
      properties.table = { type: "string", maxLength: 100 };
      properties.page = { type: "integer", minimum: 1, maximum: 10000 };
      properties.pageSize = { type: "integer", minimum: 1, maximum: 1000, default: 100 };
        properties.filters = {
        type: "object", additionalProperties: false,
          properties: Object.fromEntries(["sellerSku", "asin", "condition", "listingStatus", "from", "to", "reportType", "adProduct", "campaignId", "adGroupId", "advertisedAsin", "searchTerm", "placement", "targetingId", "internalProfileId", "authorizationId", "sortBy", "sortDirection"].map(field => [field, { type: "string", maxLength: 200, ...(field === "from" || field === "to" ? { format: "date" } : {}) }])),
      };
    }
    if (name === "data_sync_start") {
      properties.resource = { type: "string", maxLength: 100 };
      properties.dateFrom = { type: "string", format: "date" };
      properties.dateTo = { type: "string", format: "date" };
    }
    const required = name === "data_describe_table" || name === "data_query" ? ["table"] : name === "data_sync_start" ? ["resource"] : [];
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
  const outputSchema: McpSchema = arrayTools.has(name)
    ? { type: "array", items: { type: "object" } }
    : name.startsWith("data_") || name.startsWith("ads_") || name.startsWith("amazon.ads.")
      ? { type: "object", required: ["data", "meta"], properties: { data: { type: "object" }, meta: { type: "object" } } }
      : { type: "object" };
  return {
    name, canonicalName, description, module: name.startsWith("amazon.ads.") || name.startsWith("ads_") ? "amazon_ads" : "amazon_sync",
    version: "1.0.0", inputSchema: legacyToolInputSchema(name), outputSchema,
    operationMode: action === "sync" ? "APPROVAL_REQUEST" : "READ_ONLY",
    requiredPermissions: [`operations:${action === "sync" ? "create" : action}`, `amazon_data:${action}:mcp`],
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
