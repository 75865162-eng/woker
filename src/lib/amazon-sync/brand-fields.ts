import type { BrandKind } from "./brand-reports";
const labels: Record<string, string> = {
  from: "周期开始", to: "周期结束", startDate: "周期开始", endDate: "周期结束", reportPeriod: "报告粒度", asin: "ASIN", searchTerm: "搜索词", departmentName: "部门", clickedAsin: "点击商品 ASIN", searchFrequencyRank: "搜索频率排名", clickShareRank: "点击份额排名", clickShare: "点击份额", conversionShare: "转化份额", purchasedWithAsin: "组合购买 ASIN", purchasedWithRank: "组合排名", combinationPct: "组合购买比例",
  searchQueryData: "搜索查询", searchQuery: "查询词", searchQueryScore: "查询分数", searchQueryVolume: "查询搜索量", impressionData: "展示", clickData: "点击", cartAddData: "加购", purchaseData: "购买",
  impressionCount: "展示次数", impressionMedianPrice: "展示价格中位数", clickCount: "点击次数", clickRate: "点击率", clickedMedianPrice: "点击价格中位数", cartAddCount: "加购次数", cartAddedMedianPrice: "加购价格中位数", purchaseCount: "购买次数", searchTrafficSales: "搜索流量销售额", conversionRate: "转化率", purchaseMedianPrice: "购买价格中位数",
  queryImpressionCount: "查询展示次数", medianClickPrice: "点击价格中位数", medianCartAddPrice: "加购价格中位数", medianPurchasePrice: "购买价格中位数", cartAddRate: "加购率", purchaseRate: "购买率", impressionShare: "展示份额", cartAddShare: "加购份额", purchaseShare: "购买份额",
  orders: "订单数", uniqueCustomers: "独立买家数", repeatCustomersPctTotal: "复购买家比例", repeatPurchaseRevenue: "复购订购销售额", repeatPurchaseRevenuePctTotal: "复购销售额占比", amount: "金额", currencyCode: "币种", shareUnit: "份额单位", volumeAvailable: "搜索量是否可用",
};
export function brandFieldLabel(key: string): string {
  if (labels[key]) return labels[key];
  for (const [prefix, label] of [["total", "市场总计"], ["asin", "ASIN"], ["sameDayShipping", "当日达"], ["oneDayShipping", "次日达"], ["twoDayShipping", "两日达"]]) {
    if (key.startsWith(prefix)) { const rest = key.slice(prefix.length); return `${label} · ${brandFieldLabel(rest[0].toLowerCase() + rest.slice(1))}`; }
  }
  return key;
}
export function brandFactValue(facts: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((v, key) => v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>)[key] : undefined, facts);
}
export function brandValue(value: unknown): string {
  if (value === undefined || value === null) return "未知";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") { const v = value as Record<string, unknown>; if (v.amount !== undefined && v.currencyCode) return `${v.amount} ${v.currencyCode}`; return "见字段明细"; }
  return String(value);
}
export const brandColumns: Record<BrandKind, Array<[string, string]>> = {
  search_terms: [["searchTerm", "搜索词"], ["departmentName", "部门"], ["searchFrequencyRank", "搜索频率排名"], ["clickedAsin", "点击 ASIN"], ["clickShareRank", "点击排名"], ["clickShare", "点击份额"], ["conversionShare", "转化份额"]],
  search_query: [["asin", "ASIN"], ["searchQueryData.searchQuery", "查询词"], ["searchQueryData.searchQueryScore", "查询分数"], ["searchQueryData.searchQueryVolume", "查询搜索量"], ["impressionData.asinImpressionCount", "ASIN 展示次数"], ["clickData.asinClickCount", "ASIN 点击次数"], ["cartAddData.asinCartAddCount", "ASIN 加购次数"], ["purchaseData.asinPurchaseCount", "ASIN 购买次数"]],
  search_catalog: [["asin", "ASIN"], ["impressionData.impressionCount", "展示次数"], ["clickData.clickCount", "点击次数"], ["clickData.clickRate", "点击率"], ["cartAddData.cartAddCount", "加购次数"], ["purchaseData.purchaseCount", "购买次数"], ["purchaseData.conversionRate", "转化率"], ["purchaseData.searchTrafficSales", "搜索流量销售额"]],
  market_basket: [["asin", "ASIN"], ["purchasedWithAsin", "组合购买 ASIN"], ["purchasedWithRank", "组合排名"], ["combinationPct", "组合购买比例"]],
  repeat_purchase: [["asin", "ASIN"], ["orders", "订单数"], ["uniqueCustomers", "独立买家数"], ["repeatCustomersPctTotal", "复购买家比例"], ["repeatPurchaseRevenue", "复购订购销售额"], ["repeatPurchaseRevenuePctTotal", "复购销售额占比"]],
};
