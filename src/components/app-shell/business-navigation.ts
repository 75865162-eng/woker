import { Activity, Banknote, BookMarked, Bot, Boxes, Calculator, ChartNoAxesCombined, CircleHelp, ClipboardList, Handshake, History, Landmark, ListChecks, PackageSearch, ReceiptText, RefreshCw, SearchCheck, Settings, Sparkles, Star, Store, Tags, Target, Truck, UploadCloud, UsersRound, Warehouse } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * 导航条目：href / label / icon / moduleId 一律保持原值，仅新增稳定 id。
 * id 与 label、href 解耦，改文字或改地址都不会丢失用户的固定状态。
 */
export type NavigationItem = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  moduleId: string | null;
};

/** 一级类目：常驻侧栏；icon 用于收起态与浮层标题。 */
export type NavigationGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavigationItem[];
};

export const accountMenuItems: NavigationItem[] = [
  { id: "account.help", href: "/help", label: "帮助中心", icon: CircleHelp, moduleId: null },
  { id: "account.tasks", href: "/tasks", label: "任务中心", icon: ListChecks, moduleId: "tasks" },
  { id: "account.versions", href: "/versions", label: "版本审计", icon: History, moduleId: "versions" },
  { id: "account.accounts", href: "/accounts", label: "账号权限", icon: UsersRound, moduleId: "accounts" },
  { id: "account.settings", href: "/settings", label: "系统设置", icon: Settings, moduleId: "settings" },
];

// 亚马逊 ERP 常用归类：商品 → 销售 → 广告 → 采购 → 仓库 → 物流 → 财务 → 数据 → AI/工具 → 设置。
// 只新增稳定 id 与一级类目 icon；分组归属、顺序、href / moduleId 全部保持原值，权限过滤逻辑不变。
export const navigationGroups: NavigationGroup[] = [
  { id: "products", label: "商品管理", icon: Boxes, items: [
    { id: "products.master", href: "/dashboard", label: "商品主档", icon: Boxes, moduleId: "products" },
    { id: "products.sellfox", href: "/sellfox/products", label: "Sellfox 商品资料", icon: Tags, moduleId: "sellfox" },
    { id: "products.catalog", href: "/operations?view=catalog", label: "Amazon 在线商品", icon: Store, moduleId: "operations" },
    { id: "products.listingDetails", href: "/operations?view=listing_details", label: "Listing 信息", icon: ClipboardList, moduleId: "operations" },
    { id: "products.listingAi", href: "/listing-ai", label: "Listing AI", icon: Sparkles, moduleId: "listingAi" },
    { id: "products.listingStudio", href: "/listing-ai/studio", label: "Listing 生成台", icon: Target, moduleId: "listingAi" },
    { id: "products.repricing", href: "/operations/repricing", label: "跟卖与调价", icon: Tags, moduleId: "operations" },
    { id: "products.calculators", href: "/operations/calculators", label: "计算器中心", icon: Calculator, moduleId: "operations" },
  ] },
  { id: "sales", label: "销售管理", icon: ChartNoAxesCombined, items: [
    { id: "sales.orders", href: "/operations?view=orders", label: "Amazon 订单", icon: ClipboardList, moduleId: "operations" },
    { id: "sales.sellfoxSales", href: "/sellfox/sales", label: "Sellfox 销量统计", icon: ChartNoAxesCombined, moduleId: "sellfox" },
    { id: "sales.sellfoxProfit", href: "/sellfox/profit", label: "Sellfox 利润报表", icon: Banknote, moduleId: "sellfox" },
    { id: "sales.orderItems", href: "/operations?view=order-items", label: "订单商品", icon: Boxes, moduleId: "operations" },
    { id: "sales.sellfoxOrders", href: "/sellfox/orders", label: "Sellfox 订单快照", icon: Store, moduleId: "sellfox" },
    { id: "sales.sellfoxOrderDetail", href: "/sellfox/order-detail", label: "Sellfox 订单详情", icon: ClipboardList, moduleId: "sellfox" },
    { id: "sales.reviews", href: "/operations/reviews", label: "评论与店铺绩效", icon: Star, moduleId: "operations" },
    { id: "sales.salesPlans", href: "/operations/sales-plans", label: "销售计划与预测", icon: Target, moduleId: "operations" },
    { id: "sales.multiChannel", href: "/operations/multi-channel", label: "多渠道经营", icon: Store, moduleId: "operations" },
  ] },
  { id: "ads", label: "广告管理", icon: Target, items: [
    { id: "ads.amazonAds", href: "/amazon-ads/campaigns", label: "Amazon Ads", icon: Activity, moduleId: "workspace" },
    { id: "ads.ppcBulk", href: "/workspace", label: "PPC Bulk 优化", icon: UploadCloud, moduleId: "workspace" },
    { id: "ads.ppcMetrics", href: "/operations?view=ads", label: "PPC 经营指标", icon: ChartNoAxesCombined, moduleId: "operations" },
    { id: "ads.sellfoxAds", href: "/sellfox/ads", label: "Sellfox 广告报表", icon: Target, moduleId: "sellfox" },
  ] },
  { id: "procurement", label: "采购管理", icon: ClipboardList, items: [
    { id: "procurement.plans", href: "/operations/purchase-plans", label: "采购计划", icon: ClipboardList, moduleId: "operations" },
    { id: "procurement.orders", href: "/operations?view=purchase-orders", label: "采购订单", icon: ClipboardList, moduleId: "operations" },
    { id: "procurement.invoices", href: "/operations/purchase-invoices", label: "采购发票", icon: ReceiptText, moduleId: "operations" },
    { id: "procurement.suppliers", href: "/operations?view=suppliers", label: "供应商档案", icon: Store, moduleId: "operations" },
    { id: "procurement.sellfox", href: "/sellfox/purchase", label: "Sellfox 采购", icon: ClipboardList, moduleId: "sellfox" },
    { id: "procurement.collab", href: "/operations/procurement-collab", label: "采购协同", icon: Handshake, moduleId: "operations" },
    { id: "procurement.opsExtensions", href: "/operations/ops-extensions", label: "运营资料与滞销", icon: Boxes, moduleId: "operations" },
  ] },
  { id: "warehouse", label: "仓库管理", icon: Warehouse, items: [
    { id: "warehouse.fbaInventory", href: "/operations?view=inventory", label: "FBA 库存", icon: Warehouse, moduleId: "operations" },
    { id: "warehouse.sellfoxInventory", href: "/sellfox/inventory", label: "Sellfox 库存", icon: Warehouse, moduleId: "sellfox" },
    { id: "warehouse.sellfoxStockOps", href: "/sellfox/stock-ops", label: "Sellfox 出入库", icon: PackageSearch, moduleId: "sellfox" },
    { id: "warehouse.inventoryAge", href: "/operations?view=inventory_age", label: "库存库龄", icon: Activity, moduleId: "operations" },
    { id: "warehouse.inventoryEvents", href: "/operations?view=inventory_events", label: "库存事件", icon: Activity, moduleId: "operations" },
    { id: "warehouse.replenishment", href: "/operations?view=replenishment", label: "补货计划", icon: Boxes, moduleId: "operations" },
    { id: "warehouse.profile", href: "/logistics/warehouse?tab=warehouses", label: "仓库档案", icon: Warehouse, moduleId: "wms" },
    { id: "warehouse.receipts", href: "/logistics/warehouse?tab=receipts", label: "仓库入库", icon: PackageSearch, moduleId: "wms" },
    { id: "warehouse.reservations", href: "/logistics/warehouse?tab=reservations", label: "仓库出库", icon: PackageSearch, moduleId: "wms" },
    { id: "warehouse.balances", href: "/logistics/warehouse?tab=balances", label: "公司库存与调拨", icon: Warehouse, moduleId: "wms" },
    { id: "warehouse.transfers", href: "/logistics/warehouse?tab=transfers", label: "调拨流水", icon: Warehouse, moduleId: "wms" },
    { id: "warehouse.assembly", href: "/operations/assembly", label: "组装", icon: Boxes, moduleId: "wms" },
  ] },
  { id: "logistics", label: "物流发货", icon: Truck, items: [
    { id: "logistics.fulfillment", href: "/operations?view=fulfillment", label: "FBA 在途货件", icon: Truck, moduleId: "operations" },
    { id: "logistics.fbaBoxing", href: "/operations?view=fba-boxing", label: "FBA 装箱", icon: PackageSearch, moduleId: "operations" },
    { id: "logistics.firstMile", href: "/operations?view=first-mile", label: "头程物流", icon: Truck, moduleId: "operations" },
    { id: "logistics.files", href: "/logistics", label: "物流文件工作台", icon: PackageSearch, moduleId: "logistics" },
    { id: "logistics.sellfoxShipments", href: "/sellfox/shipments", label: "Sellfox 货件快照", icon: Store, moduleId: "sellfox" },
  ] },
  { id: "finance", label: "财务管理", icon: Banknote, items: [
    { id: "finance.transactions", href: "/operations?view=finance", label: "财务交易", icon: Banknote, moduleId: "operations" },
    { id: "finance.settlements", href: "/operations?view=settlements", label: "结算报告", icon: Banknote, moduleId: "operations" },
    { id: "finance.sellfox", href: "/sellfox/finance", label: "Sellfox 结算", icon: Landmark, moduleId: "sellfox" },
    { id: "finance.reimbursements", href: "/operations?view=reimbursements", label: "FBA 赔偿", icon: Banknote, moduleId: "operations" },
    { id: "finance.expenses", href: "/operations?view=expense-management", label: "ERP 费用单", icon: Banknote, moduleId: "operations" },
    { id: "finance.sellfoxPerformance", href: "/sellfox/performance", label: "Sellfox 经营报表", icon: ChartNoAxesCombined, moduleId: "sellfox" },
    { id: "finance.tax", href: "/operations/tax", label: "税务与发票", icon: Landmark, moduleId: "operations" },
  ] },
  { id: "data", label: "数据中心", icon: SearchCheck, items: [
    { id: "data.salesTraffic", href: "/operations?view=sales-traffic", label: "销售与流量", icon: ChartNoAxesCombined, moduleId: "operations" },
    { id: "data.brandAnalytics", href: "/operations?view=brand_analytics", label: "品牌分析", icon: SearchCheck, moduleId: "operations" },
    { id: "data.sellfox", href: "/sellfox", label: "Sellfox 数据", icon: Store, moduleId: "sellfox" },
    { id: "data.sellfoxSync", href: "/sellfox/sync", label: "Sellfox 同步", icon: RefreshCw, moduleId: "sellfox" },
    { id: "data.syncCenter", href: "/operations", label: "同步中心", icon: Activity, moduleId: "operations" },
    { id: "data.amazonSyncMatrix", href: "/operations?view=amazon-sync", label: "Amazon 同步矩阵", icon: Activity, moduleId: "operations" },
  ] },
  { id: "ai", label: "AI 与工具", icon: Bot, items: [
    { id: "ai.agent", href: "/agents", label: "Amazon AI Agent", icon: Bot, moduleId: "agents" },
    { id: "ai.lili", href: "/lili", label: "粒粒 Lili 技能中心", icon: Sparkles, moduleId: "agents" },
    { id: "ai.skills", href: "/skills", label: "Skill 智能工作台", icon: Sparkles, moduleId: "agents" },
    { id: "ai.saihuMerge", href: "/saihu-search-merge", label: "赛狐搜词合并", icon: SearchCheck, moduleId: "searchMerge" },
  ] },
  { id: "system", label: "系统设置", icon: Settings, items: [
    { id: "system.connections", href: "/operations?view=connections", label: "Amazon 账号与站点", icon: Store, moduleId: "operations" },
    { id: "system.adsAccounts", href: "/amazon-ads/accounts", label: "Ads 账号授权", icon: Activity, moduleId: "workspace" },
    { id: "system.dataDictionary", href: "/operations/data-dictionary", label: "数据字典", icon: BookMarked, moduleId: "operations" },
    ...accountMenuItems,
  ] },
];

/**
 * 全局条目索引：供 Pin 固定时按稳定 id 反查条目、校验归属与权限，避免幽灵入口。
 * key 为 item.id，value 携带所属分组 id。
 */
export const navigationItemIndex = new Map<string, { item: NavigationItem; groupId: string; groupLabel: string }>();
for (const group of navigationGroups) {
  for (const item of group.items) {
    navigationItemIndex.set(item.id, { item, groupId: group.id, groupLabel: group.label });
  }
}
