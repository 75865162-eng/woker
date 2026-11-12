import { Activity, Banknote, Bot, Boxes, ChartNoAxesCombined, ClipboardList, History, ListChecks, PackageSearch, ReceiptText, SearchCheck, Settings, Sparkles, Store, Truck, UploadCloud, UsersRound, Warehouse } from "lucide-react";

export const accountMenuItems = [
  { href: "/tasks", label: "任务中心", icon: ListChecks, moduleId: "tasks" },
  { href: "/versions", label: "版本审计", icon: History, moduleId: "versions" },
  { href: "/accounts", label: "账号权限", icon: UsersRound, moduleId: "accounts" },
  { href: "/settings", label: "系统设置", icon: Settings, moduleId: "settings" },
];

export const navigationGroups = [
  { label: "商品管理", items: [
    { href: "/dashboard", label: "商品主档", icon: Boxes, moduleId: "products" },
    { href: "/operations?view=catalog", label: "Amazon 在线商品", icon: Store, moduleId: "operations" },
    { href: "/operations?view=listing_details", label: "Listing 信息", icon: ClipboardList, moduleId: "operations" },
    { href: "/listing-ai", label: "Listing AI", icon: Sparkles, moduleId: "listingAi" },
  ] },
  { label: "订单管理", items: [
    { href: "/operations?view=orders", label: "Amazon 订单", icon: ClipboardList, moduleId: "operations" },
    { href: "/operations?view=order-items", label: "订单商品", icon: Boxes, moduleId: "operations" },
    { href: "/sellfox/orders", label: "Sellfox 订单快照", icon: Store, moduleId: "sellfox" },
  ] },
  { label: "仓库管理", items: [
    { href: "/operations?view=inventory", label: "FBA 库存", icon: Warehouse, moduleId: "operations" },
    { href: "/operations?view=inventory_age", label: "库存库龄", icon: Activity, moduleId: "operations" },
    { href: "/operations?view=inventory_events", label: "库存事件", icon: Activity, moduleId: "operations" },
    { href: "/operations?view=replenishment", label: "补货计划", icon: Boxes, moduleId: "operations" },
    { href: "/logistics/warehouse?tab=warehouses", label: "仓库档案", icon: Warehouse, moduleId: "wms" },
    { href: "/logistics/warehouse?tab=receipts", label: "仓库入库", icon: PackageSearch, moduleId: "wms" },
    { href: "/logistics/warehouse?tab=reservations", label: "仓库出库", icon: PackageSearch, moduleId: "wms" },
    { href: "/logistics/warehouse?tab=balances", label: "公司库存与调拨", icon: Warehouse, moduleId: "wms" },
    { href: "/logistics/warehouse?tab=transfers", label: "调拨流水", icon: Warehouse, moduleId: "wms" },
    { href: "/operations/assembly", label: "组装", icon: Boxes, moduleId: "wms" },
    { href: "/logistics", label: "物流文件工作台", icon: PackageSearch, moduleId: "logistics" },
  ] },
  { label: "采购管理", items: [
    { href: "/operations/purchase-plans", label: "采购计划", icon: ClipboardList, moduleId: "operations" },
    { href: "/operations/purchase-invoices", label: "采购发票", icon: ReceiptText, moduleId: "operations" },
    { href: "/operations/ops-extensions", label: "运营资料与滞销", icon: Boxes, moduleId: "operations" },
    { href: "/operations?view=purchase-orders", label: "采购订单", icon: ClipboardList, moduleId: "operations" },
    { href: "/operations?view=suppliers", label: "供应商档案", icon: Store, moduleId: "operations" },
  ] },
  { label: "FBA 物流", items: [
    { href: "/operations?view=fulfillment", label: "FBA 在途货件", icon: Truck, moduleId: "operations" },
    { href: "/operations?view=fba-boxing", label: "FBA 装箱", icon: PackageSearch, moduleId: "operations" },
    { href: "/operations?view=first-mile", label: "头程物流", icon: Truck, moduleId: "operations" },
    { href: "/sellfox/shipments", label: "Sellfox 货件快照", icon: Store, moduleId: "sellfox" },
  ] },
  { label: "财务管理", items: [
    { href: "/operations?view=finance", label: "财务交易", icon: Banknote, moduleId: "operations" },
    { href: "/operations?view=settlements", label: "结算报告", icon: Banknote, moduleId: "operations" },
    { href: "/operations?view=reimbursements", label: "FBA 赔偿", icon: Banknote, moduleId: "operations" },
    { href: "/operations?view=expense-management", label: "ERP 费用单", icon: Banknote, moduleId: "operations" },
    { href: "/sellfox/performance", label: "Sellfox 经营报表", icon: ChartNoAxesCombined, moduleId: "sellfox" },
  ] },
  { label: "广告管理", items: [
    { href: "/amazon-ads/campaigns", label: "Amazon Ads", icon: Activity, moduleId: "workspace" },
    { href: "/workspace", label: "PPC Bulk 优化", icon: UploadCloud, moduleId: "workspace" },
    { href: "/operations?view=ads", label: "PPC 经营指标", icon: ChartNoAxesCombined, moduleId: "operations" },
  ] },
  { label: "数据中心", items: [
    { href: "/operations?view=sales-traffic", label: "销售与流量", icon: ChartNoAxesCombined, moduleId: "operations" },
    { href: "/operations?view=brand_analytics", label: "品牌分析", icon: SearchCheck, moduleId: "operations" },
    { href: "/operations", label: "同步中心", icon: Activity, moduleId: "operations" },
    { href: "/sellfox", label: "Sellfox 数据", icon: Store, moduleId: "sellfox" },
  ] },
  { label: "系统管理", items: [
    { href: "/operations?view=connections", label: "Amazon 账号与站点", icon: Store, moduleId: "operations" },
    { href: "/amazon-ads/accounts", label: "Ads 账号授权", icon: Activity, moduleId: "workspace" },
    ...accountMenuItems,
  ] },
  { label: "其他工作区", items: [
    { href: "/saihu-search-merge", label: "赛狐搜词合并", icon: SearchCheck, moduleId: "searchMerge" },
    { href: "/agents", label: "Amazon AI Agent", icon: Bot, moduleId: "agents" },
    { href: "/lili", label: "粒粒 Lili 技能中心", icon: Sparkles, moduleId: "agents" },
  ] },
];
