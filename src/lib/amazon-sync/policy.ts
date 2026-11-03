export type SyncScope = { organizationId: string; workspaceId: string };
export const syncDomains = [
  { id: "catalog", name: "在线商品", group: "商品与库存", implemented: true, frequency: 1440, priority: 1, api: "Listings Items 2021-08-01 / searchListingsItems" },
  { id: "inventory", name: "FBA 库存", group: "商品与库存", implemented: true, frequency: 60, priority: 1, api: "FBA Inventory v1 / getInventorySummaries" },
  { id: "fbm_inventory", name: "FBM 库存", group: "商品与库存", implemented: false, frequency: 60, priority: 1, api: "待核验 Listings Items 数量与履约渠道" },
  { id: "fulfillment", name: "FBA 在途货件", group: "商品与库存", implemented: false, frequency: 120, priority: 2, api: "Fulfillment Inbound / 版本待冻结" },
  { id: "orders", name: "订单", group: "订单与经营", implemented: false, frequency: 15, priority: 1, api: "Orders 2026-01-01 / 版本待联调" },
  { id: "order_items", name: "订单商品", group: "订单与经营", implemented: false, frequency: 15, priority: 1, api: "随订单；新版 includedData 待联调" },
  { id: "sales_traffic", name: "销售与流量日报", group: "订单与经营", implemented: false, frequency: 1440, priority: 2, api: "GET_SALES_AND_TRAFFIC_REPORT" },
  { id: "finance", name: "财务交易", group: "财务与售后", implemented: false, frequency: 360, priority: 2, api: "Finances 2024-06-19 / listTransactions" },
  { id: "settlements", name: "结算报告", group: "财务与售后", implemented: false, frequency: 1440, priority: 2, api: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2（仅发现）" },
  { id: "returns", name: "退货", group: "财务与售后", implemented: false, frequency: 1440, priority: 3, api: "GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA" },
  { id: "reimbursements", name: "赔偿", group: "财务与售后", implemented: false, frequency: 1440, priority: 3, api: "GET_FBA_REIMBURSEMENTS_DATA" },
  { id: "inventory_age", name: "库龄", group: "财务与售后", implemented: false, frequency: 1440, priority: 3, api: "GET_FBA_INVENTORY_PLANNING_DATA（资格待核验）" },
  { id: "pricing", name: "商品价格", group: "价格与竞争", implemented: false, frequency: 60, priority: 4, api: "Product Pricing / 操作和规模待冻结" },
  { id: "buy_box", name: "Featured Offer / Buy Box", group: "价格与竞争", implemented: false, frequency: 60, priority: 4, api: "Product Pricing / 操作待冻结" },
  { id: "brand_analytics", name: "搜索词与品牌分析", group: "品牌分析", implemented: false, frequency: 1440, priority: 4, api: "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT（按报告周期）" },
] as const;
export type ImplementedDomain = "inventory" | "catalog";
export function implementedDomain(value: unknown): ImplementedDomain {
  if (value !== "inventory" && value !== "catalog") throw new SyncInputError("该数据域规划中，不能启用同步。");
  return value;
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
export function parseSyncPlan(value: Record<string, unknown>) {
  const resource = implementedDomain(value.resource);
  if (value.mode !== undefined && value.mode !== "snapshot") throw new SyncInputError("当前执行器仅支持完整快照；增量和报告仍待接入。");
  if (typeof value.enabled !== "boolean") throw new SyncInputError("请选择是否启用计划。");
  if (!Array.isArray(value.sourceIds) || !value.sourceIds.length || value.sourceIds.length > 100 || value.sourceIds.some(v => typeof v !== "string" || !v || v.length > 200) || new Set(value.sourceIds).size !== value.sourceIds.length) throw new SyncInputError("请选择 1–100 个不重复的店铺／站点数据源。");
  return { name: requiredText(value.name, "计划名称", 100), resource, enabled: value.enabled, mode: "snapshot",
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
