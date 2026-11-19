import { Activity, Banknote, BookMarked, Bot, Boxes, Calculator, ChartNoAxesCombined, CircleHelp, ClipboardList, Handshake, History, Landmark, ListChecks, PackageSearch, ReceiptText, RefreshCw, SearchCheck, Settings, Sparkles, Star, Store, Tags, Target, Truck, UploadCloud, UsersRound, Warehouse } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * 导航条目：href / label / icon / moduleId 保持语义，id 为稳定标识。
 * id 与 label、href 解耦，改文字或改地址都不会丢失用户的固定状态。
 */
export type NavigationItem = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  moduleId: string | null;
};

/**
 * 一级类目：常驻侧栏。
 * - href：一级命名空间链接（点击一级直接跳转到该板块落地页）。
 * - icon：收起态与二级浮层标题图标。
 */
export type NavigationGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  items: NavigationItem[];
};

export const accountMenuItems: NavigationItem[] = [
  { id: "account.help", href: "/help", label: "帮助中心", icon: CircleHelp, moduleId: null },
  { id: "account.tasks", href: "/tasks", label: "任务中心", icon: ListChecks, moduleId: "tasks" },
  { id: "account.versions", href: "/versions", label: "版本审计", icon: History, moduleId: "versions" },
  { id: "account.accounts", href: "/accounts", label: "账号权限", icon: UsersRound, moduleId: "accounts" },
  { id: "account.settings", href: "/settings", label: "系统设置", icon: Settings, moduleId: "settings" },
];

/**
 * 7 大板块（2026-11 重组）：
 * 1 商品管理（仅主档） /Product
 * 2 赛狐数据（所有赛狐页） /sellfox
 * 3 亚马逊数据（所有 Amazon 页 + 隐藏功能页 + 系统设置业务项） /amz
 * 4 采购管理 /purchase
 * 5 仓库管理（含物流发货） /WMS
 * 6 财务管理 /Fin
 * 7 AI 与工具 /ai
 *
 * 系统设置的全局项（帮助/任务/版本/账号权限/系统设置）统一放在右上角账号菜单，
 * 不再作为一级板块出现。
 */
export const navigationGroups: NavigationGroup[] = [
  { id: "products", label: "商品管理", icon: Boxes, href: "/dashboard", items: [
    { id: "products.master", href: "/dashboard", label: "商品主档", icon: Boxes, moduleId: "products" },
  ] },

  { id: "sellfox", label: "赛狐数据", icon: Store, href: "/sellfox/profit", items: [
    { id: "sellfox.profit", href: "/sellfox/profit", label: "利润报表", icon: Banknote, moduleId: "sellfox" },
    { id: "sellfox.sales", href: "/sellfox/sales", label: "销量统计", icon: ChartNoAxesCombined, moduleId: "sellfox" },
    { id: "sellfox.orders", href: "/sellfox/orders", label: "订单快照", icon: ClipboardList, moduleId: "sellfox" },
    { id: "sellfox.orderDetail", href: "/sellfox/order-detail", label: "订单详情", icon: ClipboardList, moduleId: "sellfox" },
    { id: "sellfox.ads", href: "/sellfox/ads", label: "广告报表", icon: Target, moduleId: "sellfox" },
    { id: "sellfox.products", href: "/sellfox/products", label: "商品资料", icon: Tags, moduleId: "sellfox" },
    { id: "sellfox.listings", href: "/sellfox/listings", label: "Listing", icon: ClipboardList, moduleId: "sellfox" },
    { id: "sellfox.purchase", href: "/sellfox/purchase", label: "采购", icon: PackageSearch, moduleId: "sellfox" },
    { id: "sellfox.inventory", href: "/sellfox/inventory", label: "库存", icon: Warehouse, moduleId: "sellfox" },
    { id: "sellfox.stockOps", href: "/sellfox/stock-ops", label: "出入库", icon: Boxes, moduleId: "sellfox" },
    { id: "sellfox.restock", href: "/sellfox/restock", label: "补货", icon: RefreshCw, moduleId: "sellfox" },
    { id: "sellfox.shipments", href: "/sellfox/shipments", label: "货件快照", icon: Truck, moduleId: "sellfox" },
    { id: "sellfox.finance", href: "/sellfox/finance", label: "结算", icon: ReceiptText, moduleId: "sellfox" },
    { id: "sellfox.performance", href: "/sellfox/performance", label: "经营报表", icon: Activity, moduleId: "sellfox" },
    { id: "sellfox.sync", href: "/sellfox/sync", label: "数据同步", icon: RefreshCw, moduleId: "sellfox" },
    { id: "sellfox.endpoint", href: "/sellfox/endpoint-data", label: "端点数据", icon: SearchCheck, moduleId: "sellfox" },
    { id: "sellfox.searchMerge", href: "/saihu-search-merge", label: "搜词合并", icon: SearchCheck, moduleId: "searchMerge" },
  ] },

  { id: "amazon", label: "亚马逊数据", icon: Activity, href: "/operations?view=sales-traffic", items: [
    // 经营分析
    { id: "amazon.salesTraffic", href: "/amazon/sales-traffic", label: "销售与流量", icon: ChartNoAxesCombined, moduleId: "operations" },
    { id: "amazon.brandAnalytics", href: "/amazon/brand-analytics", label: "品牌分析", icon: SearchCheck, moduleId: "operations" },
    { id: "amazon.dataKiosk", href: "/amazon/data-kiosk", label: "数据看板", icon: SearchCheck, moduleId: "operations" },
    { id: "amazon.dataDictionary", href: "/amazon/data-dictionary", label: "数据字典", icon: BookMarked, moduleId: "operations" },
    // 商品 / Listing
    { id: "amazon.catalog", href: "/amazon/catalog", label: "在线商品与库存", icon: Store, moduleId: "operations" },
    { id: "amazon.listing", href: "/amazon/listing", label: "Listing 信息", icon: ClipboardList, moduleId: "operations" },
    { id: "amazon.catalogItems", href: "/amazon/catalog-items", label: "目录属性", icon: ClipboardList, moduleId: "operations" },
    { id: "amazon.productTypes", href: "/amazon/product-types", label: "商品类型", icon: Tags, moduleId: "operations" },
    { id: "amazon.aPlus", href: "/amazon/a-plus", label: "A+ 页面", icon: Sparkles, moduleId: "operations" },
    { id: "amazon.repricing", href: "/amazon/repricing", label: "跟卖与调价", icon: Tags, moduleId: "operations" },
    // 订单
    { id: "amazon.orders", href: "/amazon/orders", label: "订单", icon: ClipboardList, moduleId: "operations" },
    { id: "amazon.orderItems", href: "/amazon/order-items", label: "订单商品", icon: Boxes, moduleId: "operations" },
    { id: "amazon.returns", href: "/amazon/returns", label: "退货与退款", icon: RefreshCw, moduleId: "operations" },
    { id: "amazon.buyerMessages", href: "/amazon/buyer-messages", label: "买家消息", icon: Handshake, moduleId: "operations" },
    { id: "amazon.repeatPurchase", href: "/amazon/repeat-purchase", label: "重复购买", icon: RefreshCw, moduleId: "operations" },
    // 广告
    { id: "amazon.ads", href: "/amazon/ads", label: "PPC 经营指标", icon: Target, moduleId: "operations" },
    { id: "amazon.campaigns", href: "/amazon/campaigns", label: "Amazon Ads", icon: Activity, moduleId: "workspace" },
    { id: "amazon.ppcBulk", href: "/workspace", label: "PPC Bulk 优化", icon: UploadCloud, moduleId: "workspace" },
    // 定价 / 库存 / 履约
    { id: "amazon.pricing", href: "/amazon/pricing", label: "定价与 BuyBox", icon: Tags, moduleId: "operations" },
    { id: "amazon.buyBox", href: "/amazon/buy-box", label: "BuyBox 历史", icon: ChartNoAxesCombined, moduleId: "operations" },
    { id: "amazon.inventory", href: "/amazon/inventory", label: "FBA 库存", icon: Warehouse, moduleId: "operations" },
    { id: "amazon.inventoryAge", href: "/amazon/inventory-age", label: "库存库龄", icon: Activity, moduleId: "operations" },
    { id: "amazon.inventoryEvents", href: "/amazon/inventory-events", label: "库存事件", icon: Activity, moduleId: "operations" },
    { id: "amazon.replenishment", href: "/amazon/replenishment", label: "补货计划", icon: Boxes, moduleId: "operations" },
    { id: "amazon.fulfillment", href: "/amazon/fulfillment", label: "FBA 在途货件", icon: Truck, moduleId: "operations" },
    { id: "amazon.fbaBoxing", href: "/amazon/fba-boxing", label: "FBA 装箱", icon: PackageSearch, moduleId: "operations" },
    { id: "amazon.firstMile", href: "/amazon/first-mile", label: "头程物流", icon: Truck, moduleId: "operations" },
    { id: "amazon.merchantShipping", href: "/amazon/merchant-shipping", label: "商家配送", icon: Truck, moduleId: "operations" },
    { id: "amazon.mcf", href: "/amazon/mcf", label: "MCF 多渠道履约", icon: Boxes, moduleId: "operations" },
    { id: "amazon.awd", href: "/amazon/awd", label: "AWD 仓储配送", icon: Warehouse, moduleId: "operations" },
    // 财务
    { id: "amazon.finance", href: "/amazon/finance", label: "财务交易", icon: Banknote, moduleId: "operations" },
    { id: "amazon.settlements", href: "/amazon/settlements", label: "结算报告", icon: Banknote, moduleId: "operations" },
    { id: "amazon.reimbursements", href: "/amazon/reimbursements", label: "FBA 赔偿", icon: Banknote, moduleId: "operations" },
    { id: "amazon.fees", href: "/amazon/fees", label: "费用估算", icon: Calculator, moduleId: "operations" },
    { id: "amazon.offers", href: "/amazon/offers", label: "报价通知", icon: ClipboardList, moduleId: "operations" },
    // 计划 / 账号
    { id: "amazon.salesPlans", href: "/amazon/sales-plans", label: "销售计划与预测", icon: Target, moduleId: "operations" },
    { id: "amazon.multiChannel", href: "/amazon/multi-channel", label: "多渠道经营", icon: Store, moduleId: "operations" },
    { id: "amazon.reviews", href: "/amazon/reviews", label: "评论与店铺绩效", icon: Star, moduleId: "operations" },
    { id: "amazon.accountHealth", href: "/amazon/account-health", label: "账号健康", icon: Activity, moduleId: "operations" },
    // 同步 / 授权（原系统设置业务项）
    { id: "amazon.syncCenter", href: "/amazon/sync-center", label: "同步中心", icon: RefreshCw, moduleId: "operations" },
    { id: "amazon.syncMatrix", href: "/amazon/sync", label: "Amazon 同步矩阵", icon: Activity, moduleId: "operations" },
    { id: "amazon.connections", href: "/amazon/connections", label: "账号与站点授权", icon: Store, moduleId: "operations" },
    { id: "amazon.adsAccounts", href: "/amazon/ads-accounts", label: "Ads 账号授权", icon: Activity, moduleId: "workspace" },
  ] },

  { id: "purchase", label: "采购管理", icon: ClipboardList, href: "/operations/purchase-plans", items: [
    { id: "purchase.plans", href: "/operations/purchase-plans", label: "采购计划", icon: ClipboardList, moduleId: "operations" },
    { id: "purchase.orders", href: "/operations?view=purchase-orders", label: "采购订单", icon: ClipboardList, moduleId: "operations" },
    { id: "purchase.invoices", href: "/operations/purchase-invoices", label: "采购发票", icon: ReceiptText, moduleId: "operations" },
    { id: "purchase.suppliers", href: "/operations?view=suppliers", label: "供应商档案", icon: Store, moduleId: "operations" },
    { id: "purchase.collab", href: "/operations/procurement-collab", label: "采购协同", icon: Handshake, moduleId: "operations" },
    { id: "purchase.opsExtensions", href: "/operations/ops-extensions", label: "运营资料与滞销", icon: Boxes, moduleId: "operations" },
  ] },

  { id: "warehouse", label: "仓库管理", icon: Warehouse, href: "/operations?view=inventory", items: [
    { id: "warehouse.fbaInventory", href: "/operations?view=inventory", label: "FBA 库存", icon: Warehouse, moduleId: "operations" },
    { id: "warehouse.inventoryAge", href: "/operations?view=inventory_age", label: "库存库龄", icon: Activity, moduleId: "operations" },
    { id: "warehouse.inventoryEvents", href: "/operations?view=inventory_events", label: "库存事件", icon: Activity, moduleId: "operations" },
    { id: "warehouse.replenishment", href: "/operations?view=replenishment", label: "补货计划", icon: Boxes, moduleId: "operations" },
    { id: "warehouse.profile", href: "/logistics/warehouse?tab=warehouses", label: "仓库档案", icon: Warehouse, moduleId: "wms" },
    { id: "warehouse.receipts", href: "/logistics/warehouse?tab=receipts", label: "仓库入库", icon: PackageSearch, moduleId: "wms" },
    { id: "warehouse.reservations", href: "/logistics/warehouse?tab=reservations", label: "仓库出库", icon: PackageSearch, moduleId: "wms" },
    { id: "warehouse.balances", href: "/logistics/warehouse?tab=balances", label: "公司库存与调拨", icon: Warehouse, moduleId: "wms" },
    { id: "warehouse.transfers", href: "/logistics/warehouse?tab=transfers", label: "调拨流水", icon: Warehouse, moduleId: "wms" },
    { id: "warehouse.assembly", href: "/operations/assembly", label: "组装", icon: Boxes, moduleId: "wms" },
    // 物流发货（原「物流发货」板块并入）
    { id: "logistics.fulfillment", href: "/operations?view=fulfillment", label: "FBA 在途货件", icon: Truck, moduleId: "operations" },
    { id: "logistics.fbaBoxing", href: "/operations?view=fba-boxing", label: "FBA 装箱", icon: PackageSearch, moduleId: "operations" },
    { id: "logistics.firstMile", href: "/operations?view=first-mile", label: "头程物流", icon: Truck, moduleId: "operations" },
    { id: "logistics.files", href: "/logistics", label: "物流文件工作台", icon: PackageSearch, moduleId: "logistics" },
  ] },

  { id: "finance", label: "财务管理", icon: Banknote, href: "/operations?view=finance", items: [
    { id: "finance.transactions", href: "/operations?view=finance", label: "财务交易", icon: Banknote, moduleId: "operations" },
    { id: "finance.settlements", href: "/operations?view=settlements", label: "结算报告", icon: Banknote, moduleId: "operations" },
    { id: "finance.reimbursements", href: "/operations?view=reimbursements", label: "FBA 赔偿", icon: Banknote, moduleId: "operations" },
    { id: "finance.ledger", href: "/operations/finance-ledger", label: "财务台账", icon: BookMarked, moduleId: "operations" },
    { id: "finance.allocations", href: "/operations/settlement-allocations", label: "结算分配", icon: ReceiptText, moduleId: "operations" },
    { id: "finance.expenses", href: "/operations?view=expense-management", label: "ERP 费用单", icon: ReceiptText, moduleId: "operations" },
    { id: "finance.tax", href: "/operations/tax", label: "税务与发票", icon: Landmark, moduleId: "operations" },
  ] },

  { id: "ai", label: "AI 与工具", icon: Bot, href: "/ai/lili", items: [
    { id: "ai.lili", href: "/ai/lili", label: "粒粒 Lili 技能中心", icon: Sparkles, moduleId: "agents" },
    { id: "ai.agent", href: "/agents", label: "Amazon AI Agent", icon: Bot, moduleId: "agents" },
    { id: "ai.skills", href: "/skills", label: "Skill 智能工作台", icon: Sparkles, moduleId: "agents" },
    { id: "ai.listingAi", href: "/listing-ai", label: "Listing AI", icon: Sparkles, moduleId: "listingAi" },
    { id: "ai.listingStudio", href: "/listing-ai/studio", label: "Listing 生成台", icon: Target, moduleId: "listingAi" },
    { id: "ai.calculators", href: "/operations/calculators", label: "计算器中心", icon: Calculator, moduleId: "operations" },
  ] },
];

/**
 * 全局条目索引：供 Pin 固定时按稳定 id 反查条目、校验归属与权限，避免幽灵入口。
 */
export const navigationItemIndex = new Map<string, { item: NavigationItem; groupId: string; groupLabel: string }>();
for (const group of navigationGroups) {
  for (const item of group.items) {
    navigationItemIndex.set(item.id, { item, groupId: group.id, groupLabel: group.label });
  }
}
