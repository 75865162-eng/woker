export type SyncScope = { organizationId: string; workspaceId: string };
export type SyncDomainMode = "snapshot" | "incremental" | "report" | "external";
export type SyncDomainPlan = {
  id: string;
  name: string;
  group: string;
  implemented: boolean;
  frequency: number;
  priority: number;
  api: string;
  mode: SyncDomainMode;
  authorization: "verified" | "pending" | "separate";
  nextStep: string;
};
export const syncDomains = [
  { id: "catalog", name: "在线商品", group: "商品与库存", implemented: true, frequency: 1440, priority: 1, api: "Listings Items 2021-08-01 / searchListingsItems", mode: "snapshot", authorization: "verified", nextStep: "继续按店铺／站点执行全量校准。" },
  { id: "inventory", name: "FBA 库存", group: "商品与库存", implemented: true, frequency: 1440, priority: 1, api: "FBA Inventory v1 / getInventorySummaries", mode: "snapshot", authorization: "verified", nextStep: "保持完整快照，后续再评估可靠增量。" },
  { id: "fulfillment", name: "FBA 在途货件", group: "商品与库存", implemented: true, frequency: 120, priority: 2, api: "Fulfillment Inbound 2024-03-20 / 有界计划遍历", mode: "snapshot", authorization: "pending", nextStep: "显式审批 planIds；计划/货件申报数量与实际在途数量分开。" },
  { id: "orders", name: "订单", group: "订单与经营", implemented: true, frequency: 1440, priority: 1, api: "Orders 2026-01-01 / searchOrders + getOrder（详情按审批选择）", mode: "incremental", authorization: "verified", nextStep: "US/CA 来源就绪后自动回溯最多 730 天，再每日增量；详情沿用来源策略。" },
  { id: "order_items", name: "订单商品", group: "订单与经营", implemented: false, frequency: 15, priority: 1, api: "Orders 2026-01-01 / getOrder.orderItems（复用 orders 详情）", mode: "incremental", authorization: "pending", nextStep: "复用订单详情审批、限流和订单主表；不创建独立采集源。" },
  { id: "sales_traffic", name: "销售与流量日报", group: "订单与经营", implemented: true, frequency: 1440, priority: 2, api: "GET_SALES_AND_TRAFFIC_REPORT", mode: "report", authorization: "verified", nextStep: "仅申请已闭合业务日，缺日保持部分成功。" },
  { id: "finance", name: "财务交易", group: "财务与售后", implemented: true, frequency: 1440, priority: 2, api: "Finances 2024-06-19 / listTransactions", mode: "incremental", authorization: "verified", nextStep: "US/CA 来源就绪后自动回溯最多 730 天，再每日增量；保留 posted 回查。" },
  { id: "settlements", name: "结算报告", group: "财务与售后", implemented: true, frequency: 1440, priority: 2, api: "Reports 2021-06-30 / getReports + getReport + getReportDocument; GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", mode: "report", authorization: "pending", nextStep: "仅发现 Amazon 自动生成的最近 90 天报告；Finance and Accounting 角色和 Seller Central 资格需真实验收。" },
  { id: "returns", name: "退货", group: "财务与售后", implemented: true, frequency: 1440, priority: 3, api: "Reports 2021-06-30 / FBA Returns Report", mode: "report", authorization: "verified", nextStep: "按单份报告发布，异常报告不覆盖当前版本。" },
  { id: "reimbursements", name: "赔偿", group: "财务与售后", implemented: true, frequency: 1440, priority: 3, api: "Reports 2021-06-30 / createReport + getReport + getReportDocument; GET_FBA_REIMBURSEMENTS_DATA", mode: "report", authorization: "pending", nextStep: "按 Amazon 原始金额与币种展示；Pricing 或 Amazon Fulfillment 角色、FBA 资格需真实验收。" },
  { id: "inventory_age", name: "库龄", group: "财务与售后", implemented: true, frequency: 1440, priority: 3, api: "Reports 2021-06-30 / createReport + getReport + getReportDocument; GET_FBA_INVENTORY_PLANNING_DATA", mode: "report", authorization: "pending", nextStep: "仅表示当前快照，不支持 NL/PL/SE/BE；缺失分桶保留原始字段，不推断历史。" },
  { id: "inventory_events", name: "FBA 库存事件", group: "商品与库存", implemented: true, frequency: 1440, priority: 2, api: "Reports 2021-06-30 / GET_LEDGER_DETAIL_VIEW_DATA", mode: "report", authorization: "pending", nextStep: "逐次审批单次最多 31 天、最近 540 天的明细库存事件；Amazon Fulfillment 角色需真实核验。" },
  { id: "listing_details", name: "Listing 完整信息", group: "商品与库存", implemented: true, frequency: 1440, priority: 3, api: "Listings Items 2021-08-01 / getListingsItem（有界 SKU）", mode: "snapshot", authorization: "pending", nextStep: "只读取批准的 SKU 和单一 Marketplace；完整属性受安全字段 allowlist 约束。" },
  { id: "catalog_items", name: "商品目录", group: "商品与库存", implemented: true, frequency: 1440, priority: 3, api: "Catalog Items 2022-04-01 / getCatalogItem（有界 ASIN）", mode: "snapshot", authorization: "pending", nextStep: "只读取批准的 ASIN；目录事实是外部观察，不覆盖 ProductRecord。" },
  { id: "pricing", name: "商品价格与 Featured Offer", group: "价格与竞争", implemented: true, frequency: 60, priority: 4, api: "Product Pricing v0 getPricing + 2022-05-01 getCompetitiveSummary", mode: "snapshot", authorization: "pending", nextStep: "显式 ASIN 集合；分段赢家与参考价格，自有 New/B2C 报价独立采集。" },
  { id: "buy_box_history", name: "Buy Box 历史日报", group: "价格与竞争", implemented: true, frequency: 1440, priority: 2, api: "GET_SALES_AND_TRAFFIC_REPORT / 单日 CHILD ASIN", mode: "report", authorization: "pending", nextStep: "仅已闭合单日报告；不拆分多日 ASIN 汇总。" },
  { id: "brand_analytics", name: "搜索词与品牌分析", group: "品牌分析", implemented: true, frequency: 1440, priority: 4, api: "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT（按报告周期）", mode: "report", authorization: "pending", nextStep: "核验 Brand Registry 资格和完整报告周期。" },
] satisfies readonly SyncDomainPlan[];
export type ImplementedDomain = "listing_details" | "catalog_items" | "fulfillment" | "pricing" | "brand_analytics" | "buy_box_history" | "inventory_events" | "inventory" | "catalog" | "sales_traffic" | "orders" | "finance" | "returns" | "settlements" | "reimbursements" | "inventory_age";
export function implementedDomain(value: unknown): ImplementedDomain {
  if (value === "buy_box") throw new SyncInputError("当前 Featured Offer 复用 pricing 数据源；历史日报使用 buy_box_history。", 409);
  if (value === "order_items") throw new SyncInputError("订单商品复用 orders 数据源与 getOrder 详情，不支持独立绑定或任务。", 409);
  const domain = syncDomains.find(candidate => candidate.id === value);
  if (!domain?.implemented) throw new SyncInputError("该数据域规划中，不能启用同步。");
  return domain.id as ImplementedDomain;
}
/** Incremental lifecycle only; legacy snapshot/report semantics stay unchanged. */
export function isIncrementalResource(resource: string) { return ["orders", "finance", "returns", "settlements", "reimbursements", "inventory_age", "inventory_events"].includes(resource); }
export function incrementalFailureCode(resource: string, status: number) {
  const prefix = resource === "finance" ? "FINANCE" : resource === "returns" ? "RETURN" : resource === "settlements" ? "SETTLEMENT" : resource === "reimbursements" ? "REIMBURSEMENT" : resource === "inventory_age" ? "INVENTORY_AGE" : resource === "inventory_events" ? "INVENTORY_EVENTS" : "ORDER";
  return `${prefix}_${status === 403 ? "ROLE_OR_SCOPE" : "VALIDATION"}`;
}
export class SyncInputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "SyncInputError"; }
}
export function syncCenterEnabled(scope: SyncScope, value = process.env.AMAZON_SYNC_CENTER_SCOPES): boolean {
  if (!value) return false;
  try {
    const scopes: unknown = JSON.parse(value);
    return Array.isArray(scopes) && scopes.some(s => Array.isArray(s) && s.length === 2 && s[0] === scope.organizationId && s[1] === scope.workspaceId);
  } catch { return false; }
}
export function requireSyncCenter(scope: SyncScope) {
  if (!syncCenterEnabled(scope)) throw new SyncInputError("该组织／工作区尚未启用同步中心试点。", 409);
}
export function boundedInteger(value: unknown, name: string, min: number, max: number, fallback?: number): number {
  const number = value === undefined ? fallback : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max) throw new SyncInputError(`${name}须为 ${min}–${max} 的整数。`);
  return number;
}
export function requiredText(value: unknown, name: string, limit = 200): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit) throw new SyncInputError(`${name}缺失或超出长度限制。`);
  return value.trim();
}
/** Empty means no Seller identity has been supplied; never substitute a display name. */
export function optionalAmazonSellerId(value: unknown): string {
  if (value === undefined || (typeof value === "string" && !value.trim())) return "";
  return requiredText(value, "Amazon Seller ID");
}
export function parseSyncPlan(value: Record<string, unknown>) {
  const resource = implementedDomain(value.resource);
  if (["returns", "settlements", "reimbursements", "inventory_age", "inventory_events", "fulfillment", "pricing", "brand_analytics", "buy_box_history", "listing_details", "catalog_items"].includes(resource)) throw new SyncInputError("该数据域仅支持逐次审批任务，不支持自动计划。");
  const expectedMode = resource === "orders" || resource === "finance" ? "incremental" : resource === "sales_traffic" ? "date_range" : "snapshot";
  if (value.mode !== undefined && value.mode !== expectedMode) throw new SyncInputError("同步计划模式与数据域不匹配。");
  if (typeof value.enabled !== "boolean") throw new SyncInputError("请选择是否启用计划。");
  if (!Array.isArray(value.sourceIds) || !value.sourceIds.length || value.sourceIds.length > 100 || value.sourceIds.some(v => typeof v !== "string" || !v || v.length > 200) || new Set(value.sourceIds).size !== value.sourceIds.length) throw new SyncInputError("请选择 1–100 个不重复的店铺／站点数据源。");
  return { name: requiredText(value.name, "计划名称", 100), resource, enabled: value.enabled, mode: expectedMode,
    intervalMinutes: boundedInteger(value.intervalMinutes, "同步间隔分钟", 15, 10080),
    priority: boundedInteger(value.priority, "优先级", 1, 4, 1), maxAttempts: boundedInteger(value.maxAttempts, "最大尝试次数", 1, 10, 3),
    retentionDays: boundedInteger(value.retentionDays, "保留天数", 1, 3650, 30), sourceIds: value.sourceIds as string[],
  };
}
export const activeTaskStatuses = ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT", "PAUSED"];
export const taskLabels: Record<string, string> = { WAITING: "等待执行", QUEUED: "排队中", RUNNING: "执行中", RETRY_WAIT: "等待重试", PAUSED: "已暂停", SUCCEEDED: "成功", FAILED: "失败", BLOCKED: "已阻断", CANCELLED: "已取消", PARTIAL_SUCCESS: "部分成功" };
export function retryDelay(attempt: number, retryAfterMs = 0, random = Math.random): number {
  return Math.max(Math.min(retryAfterMs, 60 * 60_000), Math.min(30 * 60_000, 5000 * 2 ** Math.min(Math.max(attempt - 1, 0), 9)) * (1 + random() * .25));
}
export const endpoints: Record<string, string> = { "us-east-1": "https://sellingpartnerapi-na.amazon.com", "eu-west-1": "https://sellingpartnerapi-eu.amazon.com", "us-west-2": "https://sellingpartnerapi-fe.amazon.com" };
export function officialEndpoint(region: string, endpoint: string) {
  if (endpoints[region] !== endpoint) throw new SyncInputError("请选择匹配的 Amazon 官方区域与 endpoint。");
}
