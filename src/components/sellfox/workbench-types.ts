export type Row = Record<string, unknown>;
export type Pagination = { page: number; pageSize: number; total: number };
export type StoreRow = { id: string; externalId: string; name: string; marketplace: string; country: string; status: string; lastSyncedAt: string };
export type Run = { id: string; resource: string; status: string; summary?: Row | null; error?: string | null; startedAt: string; finishedAt?: string | null };
export type Overview = { configured: boolean; stores: StoreRow[]; counts: Record<string, number>; coverage?: { inventoryStores: number; inventoryMissingStores: number; salesStores: number; salesMissingStores: number }; latestRuns: Run[]; latestSuccessByResource?: Record<string, Run>; workerOnline?: boolean };
export type Schedule = { backfillStart?: string | null; backfillNextDate?: string | null; resource: string; enabled: boolean; intervalMinutes: number; lastEnqueuedAt?: string | null; nextRunAt?: string | null };
export const resourceLabels: Record<string, string> = { stores: "店铺", inventory: "FBA 库存", sales: "销量", performance: "产品表现", hourly: "SP 小时样本", listings: "在线 Listing", ads_report: "广告下载报告" };
export const captions: Record<string, string> = {
  orderNum: "订单量", netRevenue: "净销售额", totalInventory: "总库存", inTransit: "在途", inboundWorking: "入仓处理中", inboundShipped: "入仓已发货", inboundReceiving: "入仓接收中", reservedTransfer: "预留调拨", reservedProcessing: "预留处理", reservedCustomerorders: "预留买家订单", unfulfillable: "不可售", warehouseName: "仓库", parentAsin: "父 ASIN", price: "价格", fulfillable: "FBA 可售", sales7: "7天销量", sales14: "14天销量", sales30: "30天销量", adSpend7: "7天广告费", adSpend14: "14天广告费", adSpend30: "30天广告费", campaignId: "活动 ID", adGroupId: "组 ID", productId: "产品 ID", adOrders: "广告订单", adSales: "广告销售额", acos: "ACoS", roas: "ROAS",

  reportDate: "业务日期", capturedAt: "抓取时间", externalId: "Shop ID", name: "店铺", marketplace: "站点", country: "国家", status: "状态",
  asin: "ASIN", msku: "MSKU", sku: "SKU", fnsku: "FNSKU", quantity: "可售库存", revenue: "销售额", currency: "币种", saleQuantity: "销量",
  saleRevenue: "销售额", grossProfit: "毛利润", adCost: "广告费", title: "标题", resource: "资源", startedAt: "开始时间", finishedAt: "结束时间",
  fbaQuantity: "FBA 销量", fbmQuantity: "FBM 销量", grossProfitRate: "毛利率", refundRate: "退款率",
  error: "错误", syncedAt: "同步时间", id: "运行 ID", summary: "摘要", lastSyncedAt: "最近同步", progress: "已提交写入",
  hour: "小时", adType: "广告类型", entityName: "活动", impressions: "曝光", clicks: "点击", cost: "花费", sales: "销售额", orders: "订单",
};
export function dateTime(value: unknown) { return typeof value === "string" && value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-"; }
export function display(value: unknown, key = "") {
  if (value === null || value === undefined || value === "") return "-";
  if (key.endsWith("At")) return dateTime(value);
  if (key === "resource") return resourceLabels[String(value)] ?? String(value);
  if (key === "status") return ({ done: "成功", failed: "失败", queued: "排队中", running: "进行中" } as Record<string, string>)[String(value)] ?? String(value);
  if (typeof value === "object") return "查看详情";
  return String(value);
}
export function runProgress(row: Row) {
  const summary = row.summary as Row | undefined; const progress = summary?.progress as Row | undefined;
  const count = progress?.count ?? (summary?.result as Row | undefined)?.synced ?? (summary?.result as Row | undefined)?.count ?? (summary?.result as Row | undefined)?.writes;
  return typeof count === "number" ? count : null;
}

export type SellfoxColumn = { key: string; labelZh: string; sellfoxLabel: string; defaultVisible: boolean; requiresField: string; unavailable?: boolean; numeric?: boolean };
const column = (key: string, label: string, options: Partial<SellfoxColumn> = {}): SellfoxColumn => ({ key, labelZh: label, sellfoxLabel: label, defaultVisible: true, requiresField: key, ...options });
const missing = (key: string, label: string, visible = false) => column(key, label, { unavailable: true, defaultVisible: visible });
const numbers = (items: [string, string][]) => items.map(([key, label]) => column(key, label, { numeric: true }));
export const columns: Record<string, SellfoxColumn[]> = {
  sales: [missing("image", "图片", true), column("identity", "MSKU"), column("name", "店铺"), column("marketplace", "站点"), column("parentAsin", "父ASIN"), column("msku", "MSKU"), column("price", "售价"), column("sku", "品名SKU"), column("title", "标题"), missing("salesperson", "业务员"), ...numbers([["fulfillable", "FBA可售"], ["totalInventory", "总库存"]]), column("inventoryCapturedAt", "库存快照时间"), missing("awdAvailable", "AWD库存"), missing("awdInbound", "AWD在途"), column("trend", "近7天销量趋势"), column("average7", "近7天日均", { numeric: true }), column("subtotal", "小计", { numeric: true }), column("currency", "币种")],
  performance: [missing("image", "图片", true), column("asin", "ASIN"), column("identity", "ASIN/MSKU"), column("title", "标题"), column("parentAsin", "父ASIN"), column("sku", "品名SKU"), ...numbers([["grossProfit", "毛利润"], ["grossProfitRate", "毛利率"], ["netProfitRate", "净销售额毛利率"], ["saleRevenue", "销售额"], ["netRevenue", "净销售额"], ["orderNum", "订单量"], ["saleQuantity", "销量"], ["fulfillable", "FBA可售"], ["adCost", "广告花费"], ["refundRate", "退款率"]]), column("currency", "币种"), column("name", "店铺"), column("marketplace", "站点"), ...numbers([["fbaQuantity", "FBA 销量"], ["fbmQuantity", "FBM 销量"]]).map(c => ({ ...c, defaultVisible: false })), missing("promotionDiscount", "促销折扣"), missing("giftWrapFee", "礼品包装费")],
  listings: [column("status", "状态"), missing("image", "图片", true), column("asin", "ASIN"), column("msku", "MSKU"), column("title", "标题"), missing("productTags", "产品标签"), column("parentAsin", "父ASIN"), missing("fnsku", "FNSKU"), column("sku", "品名SKU"), column("name", "店铺"), column("marketplace", "站点"), ...numbers([["price", "价格"], ["sales7", "7天销量"], ["sales14", "14天销量"], ["sales30", "30天销量"], ["revenue7", "7天销售额"], ["revenue14", "14天销售额"], ["revenue30", "30天销售额"], ["adSpend7", "7天广告花费"], ["adSpend14", "14天广告花费"], ["adSpend30", "30天广告花费"], ["fulfillable", "可售"]]), missing("salesperson", "业务员"), column("sourceUpdatedAt", "更新时间"), column("capturedAt", "快照时间"), column("currency", "币种")],
  ads: [missing("image", "图片", true), column("asin", "产品信息 / ASIN"), column("msku", "MSKU"), column("title", "标题"), missing("enabled", "有效", true), missing("serviceStatus", "服务状态", true), ...numbers([["fulfillable", "FBA可售"], ["price", "价格"]]), missing("rating", "星级/评论"), column("campaignId", "活动"), column("adGroupId", "组"), missing("salesperson", "业务员"), ...numbers([["impressions", "曝光"], ["clicks", "点击"], ["cost", "花费"], ["adOrders", "广告订单"], ["adSales", "广告销售额"], ["acos", "ACoS"], ["roas", "ROAS"]]), column("adType", "广告类型"), column("name", "店铺"), column("marketplace", "站点"), column("currency", "币种")],
};
export const unavailableReason = "赛狐有、API/本地无";
export function visibleColumns(domain: string, selected?: string[], dates: string[] = [], dimension = "msku") {
  const configured = columns[domain] ?? [];
  return [...configured.map(c => c.key === "identity" ? { ...c, labelZh: ({ asin: "ASIN", parentAsin: "父ASIN", msku: "MSKU", sku: "SKU" } as Record<string, string>)[dimension] ?? c.labelZh } : c), ...(domain === "sales" ? dates.map(date => column(`day:${date}`, date.slice(5), { numeric: true })) : [])].filter(c => selected ? selected.includes(c.key) || c.key.startsWith("day:") : c.defaultVisible);
}
export function visibleColumnCsv(config: SellfoxColumn[], rows: Row[]) {
  const cell = (value: unknown) => {
    if (typeof value === "number") return String(value);
    let text = value instanceof Date ? value.toISOString() : value == null ? "" : String(value);
    if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [config.map(c => c.labelZh), ...rows.map(row => config.map(c => c.unavailable ? null : row[c.key]))].map(line => line.map(cell).join(",")).join("\r\n");
}
