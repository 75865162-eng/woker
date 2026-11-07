/** Browser-safe report catalogue. Only current public Seller Brand Analytics reports. */
export const brandReports = {
  search_terms: { label: "搜索词分析", reportType: "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT", asinScoped: false, periods: ["DAY", "WEEK", "MONTH", "QUARTER"] },
  search_query: { label: "搜索查询绩效 SQP", reportType: "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT", asinScoped: true, periods: ["WEEK", "MONTH", "QUARTER"] },
  search_catalog: { label: "搜索目录绩效 SCP", reportType: "GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT", asinScoped: true, periods: ["WEEK", "MONTH", "QUARTER"] },
  market_basket: { label: "购买组合", reportType: "GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT", asinScoped: false, periods: ["DAY", "WEEK", "MONTH", "QUARTER"] },
  repeat_purchase: { label: "复购分析", reportType: "GET_BRAND_ANALYTICS_REPEAT_PURCHASE_REPORT", asinScoped: false, periods: ["WEEK", "MONTH", "QUARTER"] },
} as const;
export type BrandKind = keyof typeof brandReports;
export type BrandPeriod = "DAY" | "WEEK" | "MONTH" | "QUARTER";
export const brandPeriodLabels: Record<BrandPeriod, string> = { DAY: "日", WEEK: "周", MONTH: "月", QUARTER: "季度" };
export const brandOfficialUrl = "https://developer-docs.amazon.com/sp-api/docs/report-type-values-analytics";
