import { Activity, Banknote, BookMarked, Bot, Boxes, Calculator, ChartNoAxesCombined, CircleHelp, ClipboardList, Handshake, History, Landmark, ListChecks, PackageSearch, ReceiptText, RefreshCw, SearchCheck, Settings, Sparkles, Star, Store, Tags, Target, Truck, UsersRound, Warehouse } from "lucide-react";
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
 * 7 大板块（2026-11 重组，二级统一命名空间前缀）：
 * 1 商品管理 /product（商品主档 + 计算器中心）
 * 2 赛狐数据 /sellfox（全部赛狐页，数据经赛狐同步）
 * 3 亚马逊数据 /amz（全部 Amazon 页 + 隐藏功能页 + 授权/数据字典；
 *    财务的结算报告/FBA 赔偿、仓库的 FBA 库存/库龄/事件/补货/在途/装箱
 *    均为 Amazon 同步数据，统一收录于此）
 * 4 采购管理 /purchase
 * 5 仓库管理 /wms（仅自有仓库 + 物流文件，FBA 数据已归入亚马逊；一级跳物流文件工作台）
 * 6 财务管理 /fin（ERP 自有财务）
 * 7 AI 与工具 /ai
 *
 * 大原则：亚马逊 / 赛狐同步下来的数据，一律归入对应大组，不在其他板块重复收录。
 * 系统设置的全局项（帮助/任务/版本/账号权限/系统设置）统一放在右上角账号菜单。
 */
export const navigationGroups: NavigationGroup[] = [
  { id: "products", label: "商品管理", icon: Boxes, href: "/product", items: [
    { id: "products.master", href: "/product", label: "商品主档", icon: Boxes, moduleId: "products" },
    { id: "products.calculators", href: "/product/calculators", label: "计算器中心", icon: Calculator, moduleId: "products" },
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
    { id: "sellfox.restock", href: "/sellfox/restock", label: "补货", icon: RefreshCw, moduleId: "sellfox" },
    { id: "sellfox.shipments", href: "/sellfox/shipments", label: "货件快照", icon: Truck, moduleId: "sellfox" },
    { id: "sellfox.finance", href: "/sellfox/finance", label: "结算", icon: ReceiptText, moduleId: "sellfox" },
    { id: "sellfox.performance", href: "/sellfox/performance", label: "经营报表", icon: Activity, moduleId: "sellfox" },
    { id: "sellfox.sync", href: "/sellfox/sync", label: "数据同步", icon: RefreshCw, moduleId: "sellfox" },
    { id: "sellfox.endpoint", href: "/sellfox/endpoint-data", label: "端点数据", icon: SearchCheck, moduleId: "sellfox" },
    { id: "sellfox.searchMerge", href: "/sellfox/search-merge", label: "搜词合并", icon: SearchCheck, moduleId: "searchMerge" },
  ] },

  { id: "amazon", label: "亚马逊数据", icon: Activity, href: "/amazon/sales-traffic", items: [
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
    // 定价 / 库存 / 履约（仓库板块的 FBA 数据统一收录于此）
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
    // 财务（含原财务板块移入的结算报告 / FBA 赔偿）
    { id: "amazon.finance", href: "/amazon/finance", label: "财务交易", icon: Banknote, moduleId: "operations" },
    { id: "amazon.settlements", href: "/amazon/settlements", label: "结算报告", icon: Banknote, moduleId: "operations" },
    { id: "amazon.reimbursements", href: "/amazon/reimbursements", label: "FBA 赔偿", icon: Banknote, moduleId: "operations" },
    { id: "amazon.fees", href: "/amazon/fees", label: "费用估算", icon: Calculator, moduleId: "operations" },
    { id: "amazon.offers", href: "/amazon/offers", label: "报价通知", icon: ClipboardList, moduleId: "operations" },
    // 报告与观察中心（Amazon 报告原始行 + 促销/通知观察，数据已落库，与赛狐隔离）
    { id: "amazon.fbaCustomerSales", href: "/amazon/fba-customer-sales", label: "FBA 客户发货销售", icon: ReceiptText, moduleId: "operations" },
    { id: "amazon.mfnReturns", href: "/amazon/mfn-returns", label: "自配送退货明细", icon: ReceiptText, moduleId: "operations" },
    { id: "amazon.fbaShipments", href: "/amazon/fba-shipments", label: "FBA 发货报告", icon: ReceiptText, moduleId: "operations" },
    { id: "amazon.fbaInventoryByCountry", href: "/amazon/fba-inventory-by-country", label: "FBA 多国库存", icon: Warehouse, moduleId: "operations" },
    { id: "amazon.fbaFulfilledInventory", href: "/amazon/fba-fulfilled-inventory", label: "FBA Fulfilled 库存", icon: Warehouse, moduleId: "operations" },
    { id: "amazon.fbaInventoryReport", href: "/amazon/fba-inventory-report", label: "FBA 库存报告", icon: Warehouse, moduleId: "operations" },
    { id: "amazon.reservedInventory", href: "/amazon/reserved-inventory", label: "预留库存", icon: Warehouse, moduleId: "operations" },
    { id: "amazon.strandedInventory", href: "/amazon/stranded-inventory", label: "滞留库存", icon: Warehouse, moduleId: "operations" },
    { id: "amazon.recommendedRemovals", href: "/amazon/recommended-removals", label: "推荐移除", icon: ReceiptText, moduleId: "operations" },
    { id: "amazon.storageFees", href: "/amazon/storage-fees", label: "FBA 仓储费", icon: ReceiptText, moduleId: "operations" },
    { id: "amazon.longTermStorageFees", href: "/amazon/long-term-storage-fees", label: "长期仓储费", icon: ReceiptText, moduleId: "operations" },
    { id: "amazon.fbaOverageFees", href: "/amazon/fba-overage-fees", label: "FBA 超额费用", icon: ReceiptText, moduleId: "operations" },
    { id: "amazon.feePreview", href: "/amazon/fee-preview", label: "FBA 费用预览", icon: ReceiptText, moduleId: "operations" },
    { id: "amazon.removalOrderReport", href: "/amazon/removal-order-report", label: "移除订单明细", icon: ReceiptText, moduleId: "operations" },
    { id: "amazon.removalShipmentReport", href: "/amazon/removal-shipment-report", label: "移除货件明细", icon: ReceiptText, moduleId: "operations" },
    { id: "amazon.promotions", href: "/amazon/promotions", label: "促销观察", icon: Activity, moduleId: "operations" },
    { id: "amazon.notifications", href: "/amazon/notifications", label: "通知订阅发现", icon: Activity, moduleId: "operations" },
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

  { id: "purchase", label: "采购管理", icon: ClipboardList, href: "/purchase/plans", items: [
    { id: "purchase.plans", href: "/purchase/plans", label: "采购计划", icon: ClipboardList, moduleId: "operations" },
    { id: "purchase.orders", href: "/purchase/orders", label: "采购订单", icon: ClipboardList, moduleId: "operations" },
    { id: "purchase.invoices", href: "/purchase/invoices", label: "采购发票", icon: ReceiptText, moduleId: "operations" },
    { id: "purchase.suppliers", href: "/purchase/suppliers", label: "供应商档案", icon: Store, moduleId: "operations" },
    { id: "purchase.collab", href: "/purchase/collab", label: "采购协同", icon: Handshake, moduleId: "operations" },
    { id: "purchase.opsExtensions", href: "/purchase/ops-extensions", label: "运营资料与滞销", icon: Boxes, moduleId: "operations" },
  ] },

  { id: "warehouse", label: "仓库管理", icon: Warehouse, href: "/wms/logistics", items: [
    { id: "warehouse.profile", href: "/wms/warehouse", label: "仓库档案", icon: Warehouse, moduleId: "wms" },
    { id: "warehouse.receipts", href: "/wms/receipts", label: "仓库入库", icon: PackageSearch, moduleId: "wms" },
    { id: "warehouse.reservations", href: "/wms/reservations", label: "仓库出库", icon: PackageSearch, moduleId: "wms" },
    { id: "warehouse.balances", href: "/wms/balances", label: "公司库存与调拨", icon: Warehouse, moduleId: "wms" },
    { id: "warehouse.transfers", href: "/wms/transfers", label: "调拨流水", icon: Warehouse, moduleId: "wms" },
    { id: "warehouse.assembly", href: "/wms/assembly", label: "组装", icon: Boxes, moduleId: "wms" },
    { id: "logistics.files", href: "/wms/logistics", label: "物流文件工作台", icon: PackageSearch, moduleId: "logistics" },
  ] },

  { id: "finance", label: "财务管理", icon: Banknote, href: "/fin/transactions", items: [
    { id: "finance.transactions", href: "/fin/transactions", label: "财务交易", icon: Banknote, moduleId: "operations" },
    { id: "finance.ledger", href: "/fin/ledger", label: "财务台账", icon: BookMarked, moduleId: "operations" },
    { id: "finance.allocations", href: "/fin/allocations", label: "结算分配", icon: ReceiptText, moduleId: "operations" },
    { id: "finance.expenses", href: "/fin/expenses", label: "ERP 费用单", icon: ReceiptText, moduleId: "operations" },
    { id: "finance.tax", href: "/fin/tax", label: "税务与发票", icon: Landmark, moduleId: "operations" },
  ] },

  // AI 板块入口使用本板块命名空间 /ai/lili，由 next.config rewrites 服务端直达 /lili
  // （见 src/lib/navigation/namespace-routes.ts）。不要退回 page.tsx 的客户端 redirect：
  // redirect 跳板会让 tab 身份分裂成「/ai/lili 幽灵 tab + /lili 实际 tab」，且延迟落地
  // 会覆盖用户紧随其后的导航（表现为点了别的菜单却停在 /lili），侧栏高亮也会失效。
  { id: "ai", label: "AI 与工具", icon: Bot, href: "/ai/lili", items: [
    { id: "ai.lili", href: "/ai/lili", label: "粒粒 Lili 技能中心", icon: Sparkles, moduleId: "agents" },
    { id: "ai.agent", href: "/ai/agent", label: "Amazon AI Agent", icon: Bot, moduleId: "agents" },
    { id: "ai.skills", href: "/ai/skills", label: "Skill 智能工作台", icon: Sparkles, moduleId: "agents" },
    { id: "ai.listingAi", href: "/ai/listing", label: "Listing AI", icon: Sparkles, moduleId: "listingAi" },
    { id: "ai.listingStudio", href: "/ai/listing-studio", label: "Listing 生成台", icon: Target, moduleId: "listingAi" },
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
