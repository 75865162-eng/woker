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
