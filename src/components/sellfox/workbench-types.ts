export type Row = Record<string, unknown>;
export type Pagination = { page: number; pageSize: number; total: number };
export type StoreRow = { id: string; externalId: string; name: string; marketplace: string; country: string; status: string; lastSyncedAt: string };
export type Run = { id: string; resource: string; status: string; summary?: Row | null; error?: string | null; startedAt: string; finishedAt?: string | null };
export type Overview = { configured: boolean; stores: StoreRow[]; counts: Record<string, number>; coverage?: { inventoryStores: number; inventoryMissingStores: number; salesStores: number; salesMissingStores: number }; latestRuns: Run[]; latestSuccessByResource?: Record<string, Run>; workerOnline?: boolean };
export type Schedule = { backfillStart?: string | null; backfillNextDate?: string | null; resource: string; enabled: boolean; intervalMinutes: number; lastEnqueuedAt?: string | null; nextRunAt?: string | null };
export const resourceLabels: Record<string, string> = { stores: "店铺", inventory: "FBA 库存", sales: "销量", performance: "销售利润", hourly: "SP 小时样本", listings: "在线商品", ads_report: "广告产品日报", ads_targeting: "广告投放日报", ads_search_term: "广告搜索词日报", ads_campaign: "广告活动日报", ads_ad_group: "广告组日报", ads_placement: "广告位日报" };
export function browseEmptyMessage(domain: string, overview: Overview | null) {
  if (domain !== "sales" && domain !== "performance") return null;
  const label = domain === "sales" ? "销量" : "销售利润";
  if (overview?.workerOnline === false) return `Worker 当前离线，无法自动同步${label}数据。可点“立即同步”排队，或检查 Worker 状态。`;
  if (!overview?.latestSuccessByResource?.[domain]) return `尚无${label}同步成功记录，请点“立即同步”获取数据。`;
  return `当前筛选日期暂无${label}数据，可调整日期范围，或点“立即同步”补数。`;
}
export const captions: Record<string, string> = {
  orderNum: "订单量", netRevenue: "净销售额", totalInventory: "总库存", inTransit: "在途", inboundWorking: "入仓处理中", inboundShipped: "入仓已发货", inboundReceiving: "入仓接收中", reservedTransfer: "预留调拨", reservedProcessing: "预留处理", reservedCustomerorders: "预留买家订单", unfulfillable: "不可售", warehouseName: "仓库", parentAsin: "父 ASIN", price: "价格", fulfillable: "FBA 可售", sales7: "7天销量", sales14: "14天销量", sales30: "30天销量", adSpend7: "7天广告费", adSpend14: "14天广告费", adSpend30: "30天广告费", campaignId: "活动 ID", adGroupId: "组 ID", productId: "产品 ID", adOrders: "广告订单", adSales: "广告销售额", acos: "ACoS", roas: "ROAS",
  promotionDiscount: "促销折扣", giftWrapFee: "礼品包装费", refundPrice: "退款金额", refundNum: "退款量", commodityCost: "商品成本", shippingPrice: "运费", taxPrice: "税费",

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

export type SellfoxColumn = { key: string; labelZh: string; sellfoxLabel: string; defaultVisible: boolean; requiresField: string; unavailable?: boolean; numeric?: boolean; parts?: string[] };
const column = (key: string, label: string, options: Partial<SellfoxColumn> = {}): SellfoxColumn => ({ key, labelZh: label, sellfoxLabel: label, defaultVisible: true, requiresField: key, ...options });
const missing = (key: string, label: string, visible = false) => column(key, label, { unavailable: true, defaultVisible: visible });
const numbers = (items: [string, string][]) => items.map(([key, label]) => column(key, label, { numeric: true }));
export const columns: Record<string, SellfoxColumn[]> = {
  sales: [column("image", "图片", { parts: ["mainImage"], requiresField: "mainImage（Listing 当前快照）" }), column("identity", "ASIN"), column("name", "店铺/站点", { parts: ["name", "marketplace"], requiresField: "name,marketplace" }), column("analysis", "分析"), missing("operations", "运营"), missing("salesInsight", "销量洞察"), column("parentAsin", "父ASIN"), column("msku", "MSKU"), column("sku", "品名/SKU"), column("title", "标题"), column("fulfillable", "FBA可售", { numeric: true }), column("subtotal", "小计", { numeric: true }),
    ...[column("totalInventory", "总库存", { numeric: true }), missing("awdAvailable", "AWD库存"), missing("awdInbound", "AWD在途"), column("trend", "近7天销量趋势"), column("average7", "均值", { numeric: true }), column("price", "售价", { numeric: true }), column("inventoryCapturedAt", "库存快照时间"), column("currency", "币种"), column("marketplace", "站点"), missing("salesperson", "业务员")].map(c => ({ ...c, defaultVisible: false }))],
  performance: [column("image", "图片", { parts: ["mainImage"], requiresField: "Listing 当前快照或利润 payload.imageUrl" }), column("identity", "标题/ASIN", { parts: ["title", "identity"], requiresField: "title,identity" }), column("name", "店铺/站点", { parts: ["name", "marketplace"] }), column("analysis", "分析"), ...numbers([["grossProfit", "毛利润"], ["grossProfitRate", "毛利率"], ["saleRevenue", "销售额"], ["orderNum", "订单量"], ["fulfillable", "FBA可售"], ["saleQuantity", "销量"]]), column("promotionDiscount", "促销折扣", { numeric: true }), column("giftWrapFee", "礼品包装费", { numeric: true }), column("adCost", "广告花费", { numeric: true }), column("currency", "币种"),
    ...[column("parentAsin", "父ASIN"), column("sku", "品名/SKU"), column("asin", "ASIN"), column("title", "标题"), column("marketplace", "站点"), column("commodityCost", "商品成本", { numeric: true, requiresField: "销售利润 payload.commodityCost" }), column("shippingPrice", "运费", { numeric: true, requiresField: "销售利润 payload.shippingPrice" }), column("taxPrice", "税费", { numeric: true, requiresField: "销售利润 payload.taxPrice" }), ...numbers([["netProfitRate", "净销售额毛利率"], ["netRevenue", "净销售额"], ["refundRate", "退款率"], ["refundPrice", "退款金额"], ["refundNum", "退款量"], ["fbaQuantity", "FBA 销量"], ["fbmQuantity", "FBM 销量"]])].map(c => ({ ...c, defaultVisible: false }))],
  listings: [column("status", "状态"), column("dxmPublishState", "DXM 发布状态", { defaultVisible: false, requiresField: "Listing 当前快照 dxmPublishState 类型投影；原值展示，非配对状态" }), column("fulfillment", "发货方式", { defaultVisible: false, requiresField: "当前 Listing switchFulfillmentTo；空值为未知" }), column("image", "图片", { parts: ["mainImage"], requiresField: "mainImage（Listing V2 当前快照）" }), column("asin", "ASIN/MSKU", { parts: ["asin", "msku"], requiresField: "asin,msku" }), column("title", "标题"), column("brand", "品牌", { defaultVisible: false, requiresField: "Listing 当前快照 payload.brand" }), column("amazonBrand", "亚马逊品牌", { defaultVisible: false, requiresField: "Listing 当前快照 payload.amazonBrand" }), column("rating", "星级", { defaultVisible: false, requiresField: "Listing 当前快照 payload.rating" }), column("ratingCount", "评论数", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.ratingCount" }), column("productTags", "产品标签", { defaultVisible: false, requiresField: "Listing 当前快照 payload.productLabelList[].labelDetailList[].labelName" }), column("openDate", "上架时间", { defaultVisible: false, requiresField: "Listing 当前快照 payload.openDate" }), column("firstSaleDate", "首次售出", { defaultVisible: false, requiresField: "Listing 当前快照 payload.firstSaleDate（空则 firstOrderDate；123 上 firstSaleDate 常空）" }), column("bsrRank", "BSR", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.bsrRank[].rank（优先 bigCategory）" }), column("bsrCategory", "BSR类目", { defaultVisible: false, requiresField: "Listing 当前快照 payload.bsrRank[].categoryName（与 BSR 同元素，优先 bigCategory）" }), column("purchaseCost", "采购成本", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.purchaseCost" }), column("fbaFees", "FBA费用", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.fbaFees" }), column("referralFee", "佣金", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.referralFee" }), column("totalFee", "总费用", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.totalFee" }), column("headTripCost", "头程", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.headTripCost" }), column("buyBoxWinner", "Buy Box", { defaultVisible: false, requiresField: "Listing 当前快照 payload.buyBoxWinner（boolean→是/否）" }), column("reservedQty", "预留", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.reservedQty" }), column("shippingPrice", "运费", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.shippingPrice" }), column("profitPrice", "预估利润", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.profitPrice" }), column("profitRate", "利润率", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.profitRate" }), column("parentAsin", "父ASIN"), column("parentSku", "父SKU", { defaultVisible: false }), column("fnsku", "FNSKU", { defaultVisible: false }), column("sku", "品名SKU"), column("name", "店铺/站点", { parts: ["name", "marketplace"], requiresField: "name,marketplace" }), ...numbers([["price", "价格"], ["sales7", "7天销量"], ["sales14", "14天销量"], ["sales30", "30天销量"], ["revenue7", "7天销售额"], ["revenue14", "14天销售额"], ["revenue30", "30天销售额"], ["adSpend7", "7天广告花费"], ["adSpend14", "14天广告花费"], ["adSpend30", "30天广告花费"], ["fulfillable", "可售"]]), column("totalInventory", "总库存", { numeric: true, defaultVisible: false, requiresField: "sellfox_inventory_current.totalInventory（按 storeId+msku 最新完整库存快照汇总；非销售日库存）" }), column("inventoryCapturedAt", "库存快照时间", { defaultVisible: false, requiresField: "sellfox_inventory_current.capturedAt（最新完整库存快照）" }), column("listingQuantity", "Listing库存", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.quantity" }), column("unsellable", "不可售", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.unsellable" }), column("warehousing", "入库中", { numeric: true, defaultVisible: false, requiresField: "Listing 当前快照 payload.warehousing" }), missing("salesperson", "业务员"), column("sourceUpdatedAt", "更新时间"), ...[column("msku", "MSKU"), column("marketplace", "站点"), column("capturedAt", "快照时间"), column("currency", "币种")].map(c => ({ ...c, defaultVisible: false }))],
  ads: [column("asin", "产品信息", { parts: ["title", "asin"], requiresField: "title,asin" }), missing("enabled", "有效", true), missing("serviceStatus", "服务状态", true), missing("adStrategy", "广告策略"), ...numbers([["fulfillable", "FBA可售"], ["price", "价格"]]), missing("rating", "星级/评论"), column("campaignId", "广告活动"), column("adGroupId", "广告组"), missing("productTags", "标签"), missing("salesperson", "业务员"), ...numbers([["impressions", "曝光"], ["clicks", "点击"], ["cost", "花费"], ["adOrders", "广告订单"], ["adSales", "广告销售额"], ["acos", "ACoS"], ["roas", "ROAS"]]), column("adType", "广告类型"), column("currency", "币种"), ...[missing("image", "图片"), column("msku", "MSKU"), column("title", "标题"), column("name", "店铺"), column("marketplace", "站点")].map(c => ({ ...c, defaultVisible: false }))],
};
// Reuse metric/availability rules; identity belongs to the active CPC report.
columns.ads_targeting = [column("targetingId", "投放ID"), column("targetingText", "投放"), column("matchType", "匹配类型"), ...columns.ads];
columns.ads_search_term = [column("searchTerm", "用户搜索词"), column("targetingId", "投放ID"), column("targetingText", "投放"), column("matchType", "匹配类型"), ...columns.ads];
columns.ads_campaign = [column("campaignName", "活动名称"), ...columns.ads.filter(c => c.key !== "adGroupId")];
columns.ads_ad_group = [column("adGroupName", "广告组名称"), column("targetingText", "投放"), column("matchType", "匹配类型"), ...columns.ads];
columns.ads_placement = [column("placement", "广告位"), ...columns.ads];
export const unavailableReason = "赛狐有、API/本地无";
export function summableColumnKeys(config: SellfoxColumn[]) {
  return config.filter(c => c.numeric && !c.unavailable && !["grossProfitRate", "netProfitRate", "refundRate", "acos", "roas"].includes(c.key)).map(c => c.key);
}
const rollupDimensions = new Set(["store", "developer", "spu"]);
export function defaultVisibleColumnKeys(domain: string, dimension = "msku") {
  // Rollup name already supplies identity; product fields are empty or ambiguous.
  const hidden = !rollupDimensions.has(dimension) ? [] : domain === "sales"
    ? ["name", "operations", "salesInsight", "parentAsin", "msku", "sku", "title"]
    : domain === "performance" ? ["name"] : [];
  return (columns[domain] ?? []).filter(c => c.defaultVisible && !hidden.includes(c.key)).map(c => c.key);
}
export function visibleColumns(domain: string, selected?: string[], dates: string[] = [], dimension = "msku", matrix = false) {
  const configured = columns[domain] ?? [];
  const selectedKeys = selected ?? defaultVisibleColumnKeys(domain, dimension);
  const rollup = rollupDimensions.has(dimension);
  return [...configured.map(c => c.key === "identity" ? { ...c, labelZh: `${domain === "performance" && !rollup ? "标题/" : ""}${({ asin: "ASIN", parentAsin: "父ASIN", msku: "MSKU", sku: "SKU", store: "店铺", developer: "开发员", spu: "SPU" } as Record<string, string>)[dimension] ?? c.labelZh}`, ...(domain === "performance" && rollup ? { parts: ["identity"] } : {}) } : c), ...(domain === "sales" ? dates.filter(date => matrix || selected?.includes(`day:${date}`)).map(date => column(`day:${date}`, date.slice(5), { numeric: true })) : [])].filter(c => selectedKeys.includes(c.key) || (matrix && c.key.startsWith("day:")));
}
// Composite cells share their value with CSV/XLSX; no field is guessed from payload.
export function sellfoxColumnValue(column: SellfoxColumn, row: Row): unknown {
  if (column.unavailable) return null;
  if (column.key === "analysis") return null;
  if (!column.parts) return row[column.key];
  return column.parts.map(key => row[key]).filter(value => value !== null && value !== undefined && value !== "").map(String).join("\n");
}
export function visibleColumnCsv(config: SellfoxColumn[], rows: Row[]) {
  const cell = (value: unknown) => {
    if (typeof value === "number") return String(value);
    let text = value instanceof Date ? value.toISOString() : value == null ? "" : String(value);
    if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [config.map(c => c.labelZh), ...rows.map(row => config.map(c => sellfoxColumnValue(c, row)))].map(line => line.map(cell).join(",")).join("\r\n");
}
