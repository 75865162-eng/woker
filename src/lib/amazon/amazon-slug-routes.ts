/**
 * Amazon 数据板块的「页面后缀」命名空间（/amazon/<slug>）。
 *
 * 目标：让赛狐（/sellfox/*）与亚马逊（/amazon/*）两套后缀并存，
 * 同时复用经营中台已经实现并验证过的 workbench 组件，避免重复实现。
 *
 * 约定：
 * - value 以 `view:` 开头 → 映射到 `/operations?view=<view>`（由 OperationsSyncEntry 渲染）。
 * - 否则 value 是一个真实站内路径（独立 page，如 /operations/reviews）。
 *
 * 该文件是 next.config.ts（生成 rewrites）与 sync-center-workbench.tsx
 * （从 pathname 解析 view）的单一数据源。保持纯数据、无其他依赖。
 */
export const amazonSlugRoutes: Record<string, string> = {
  // 订单
  "sales-traffic": "view:sales-traffic",
  orders: "view:orders",
  order: "view:orders", // 单数别名：/amazon/order 与 /sellfox/order 对称
  "order-items": "view:order-items",
  // 商品 / Listing
  // catalog 已由真实页面 src/app/(erp)/amazon/catalog/page.tsx 提供（参考赛狐分组下钻范式重写）。
  // 此处保留 view:catalog 映射作为导航兜底声明；Next.js 真实文件路径优先于 afterFiles rewrite，
  // 故 /amazon/catalog 实际命中真实 page，不会落到通用 view 表格。
  catalog: "view:catalog",
  listing: "view:listing_details",
  "listing-details": "view:listing_details",
  "catalog-items": "view:catalog_items",
  "a-plus": "view:a-plus",
  // 广告
  ads: "view:ads",
  campaigns: "/amazon-ads/campaigns",
  // 库存 / 履约
  // inventory 已由真实页面 src/app/(erp)/amazon/inventory/page.tsx 提供（参考赛狐分组下钻范式重写）。
  // 此处保留 view:inventory 映射作为导航兜底声明；Next.js 真实文件路径优先于 afterFiles rewrite，
  // 故 /amazon/inventory 实际命中真实 page，不会落到通用 view 表格。
  inventory: "view:inventory",
  // inventory-health：Wimoor FBA 库存 detail+planning 迁移，真实 page 提供，映射自身作导航兜底声明。
  "inventory-health": "/amazon/inventory-health",
  "inventory-age": "view:inventory_age",
  replenishment: "view:replenishment",
  fulfillment: "view:fulfillment",
  "fba-boxing": "view:fba-boxing",
  "first-mile": "view:first-mile",
  // 财务
  finance: "view:finance",
  // finance-transactions / settlement-summary：Wimoor 交易报告与结算汇总迁移，真实 page 提供，映射自身作兜底。
  "finance-transactions": "/amazon/finance-transactions",
  settlements: "view:settlements",
  "settlement-summary": "/amazon/settlement-summary",
  // 报告与观察中心（15 个 report 域 + 促销 / 通知订阅，均为 Amazon 数据源，与赛狐隔离）
  "fba-customer-sales": "view:fba_customer_sales",
  "mfn-returns": "view:mfn_returns",
  "fba-shipments": "view:fba_shipments",
  "fba-inventory-by-country": "view:fba_inventory_by_country",
  "fba-fulfilled-inventory": "view:fba_fulfilled_inventory",
  "fba-inventory-report": "view:fba_inventory_report",
  "reserved-inventory": "view:reserved_inventory",
  "stranded-inventory": "view:stranded_inventory",
  "recommended-removals": "view:recommended_removals",
  "storage-fees": "view:storage_fees",
  "long-term-storage-fees": "view:long_term_storage_fees",
  "fba-overage-fees": "view:fba_overage_fees",
  "fee-preview": "view:fee_preview",
  "removal-order-report": "view:removal_order_report",
  "removal-shipment-report": "view:removal_shipment_report",
  promotions: "view:promotions",
  notifications: "view:notifications",
  // 分析 / 数据
  "brand-analytics": "view:brand_analytics",
  "buy-box": "view:buy_box_history",
  pricing: "view:pricing",
  fees: "view:fee_preview",
  returns: "view:returns",
  "repeat-purchase": "view:repeat-purchase",
  // 同步 / 配置
  sync: "view:amazon-sync",
  "sync-center": "/operations",
  connections: "view:connections",
  "ads-accounts": "/amazon-ads/accounts",
  "data-dictionary": "/operations/data-dictionary",
  "wimoor-field-parity": "/operations/wimoor-field-parity",
  // 独立路由页
  reviews: "/operations/reviews",
  "sales-plans": "/operations/sales-plans",
  "multi-channel": "/operations/multi-channel",
  repricing: "/operations/repricing",
};

/** 从 /amazon/<slug> 的 slug 解析出 ?view= 值；独立路由页返回 null。 */
export function amazonSlugView(slug: string): string | null {
  const target = amazonSlugRoutes[slug];
  return target?.startsWith("view:") ? target.slice(5) : null;
}

/** 生成 next.config.ts 需要的 rewrite 列表。 */
export function amazonSlugRewrites(): Array<{ source: string; destination: string }> {
  return Object.entries(amazonSlugRoutes).map(([slug, target]) => ({
    source: `/amazon/${slug}`,
    destination: target.startsWith("view:") ? `/operations?view=${target.slice(5)}` : target,
  }));
}
