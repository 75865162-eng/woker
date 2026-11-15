import {
  Activity,
  Banknote,
  BookMarked,
  Bot,
  Boxes,
  Calculator,
  ChartNoAxesCombined,
  CircleHelp,
  ClipboardList,
  Handshake,
  History,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Package,
  PackageSearch,
  ReceiptText,
  SearchCheck,
  Settings,
  ShoppingCart,
  Sparkles,
  Star,
  Store,
  Tags,
  Target,
  Truck,
  UploadCloud,
  UsersRound,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** 权限模块；不填时按 href 推导（getModuleIdForPath）。 */
  moduleId?: string;
  /** 二级菜单说明，用于搜索与悬浮提示。 */
  hint?: string;
};

export type NavigationModule = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** 一级模块说明，收起态悬浮/搜索时展示。 */
  hint: string;
  items: NavigationItem[];
};

// 一级模块 + 二级功能菜单。
// 约束：href / moduleId 全部沿用改造前的取值，只调整分组归属、顺序与层级，
// 不新增或修改任何业务路由，权限过滤逻辑（roleCanAccessModule）保持不变。
export const navigationModules: NavigationModule[] = [
  {
    id: "workbench",
    label: "工作台",
    icon: LayoutDashboard,
    hint: "业务总入口与快捷入口",
    items: [
      { href: "/", label: "工作台首页", icon: LayoutDashboard, hint: "业务总入口" },
    ],
  },
  {
    id: "products",
    label: "商品中心",
    icon: Boxes,
    hint: "商品资料、Listing 与调价工具",
    items: [
      { href: "/dashboard", label: "商品主档", icon: Boxes, moduleId: "products", hint: "商品资料、负责人、流程进度" },
      { href: "/operations?view=catalog", label: "Amazon 在线商品", icon: Store, moduleId: "operations", hint: "在线商品与站点信息" },
      { href: "/operations?view=listing_details", label: "Listing 信息", icon: ClipboardList, moduleId: "operations", hint: "标题、五点、图片与 A+" },
      { href: "/listing-ai", label: "Listing AI", icon: Sparkles, moduleId: "listingAi", hint: "Listing 优化建议" },
      { href: "/listing-ai/studio", label: "Listing 生成台", icon: Target, moduleId: "listingAi", hint: "批量生成与改写" },
      { href: "/operations/repricing", label: "跟卖与调价", icon: Tags, moduleId: "operations", hint: "跟卖监控与调价规则" },
      { href: "/operations/calculators", label: "计算器中心", icon: Calculator, moduleId: "operations", hint: "毛利、佣金与费用试算" },
    ],
  },
  {
    id: "sales",
    label: "销售与订单",
    icon: ShoppingCart,
    hint: "订单、评论、销售计划与多渠道",
    items: [
      { href: "/operations?view=orders", label: "Amazon 订单", icon: ClipboardList, moduleId: "operations", hint: "订单明细与状态" },
      { href: "/operations?view=order-items", label: "订单商品", icon: Package, moduleId: "operations", hint: "订单行项目与 SKU" },
      { href: "/sellfox/orders", label: "Sellfox 订单快照", icon: Store, moduleId: "sellfox", hint: "赛狐订单镜像数据" },
      { href: "/operations/reviews", label: "评论与店铺绩效", icon: Star, moduleId: "operations", hint: "评论监控与绩效指标" },
      { href: "/operations/sales-plans", label: "销售计划与预测", icon: Target, moduleId: "operations", hint: "目标、预测与达成" },
      { href: "/operations/multi-channel", label: "多渠道经营", icon: Store, moduleId: "operations", hint: "非亚马逊渠道经营" },
    ],
  },
  {
    id: "ads",
    label: "广告中心",
    icon: Megaphone,
    hint: "Amazon Ads、Bulk 优化与 PPC 指标",
    items: [
      { href: "/amazon-ads/campaigns", label: "Amazon Ads", icon: Activity, moduleId: "workspace", hint: "广告活动、组与关键词" },
      { href: "/workspace", label: "PPC Bulk 优化", icon: UploadCloud, moduleId: "workspace", hint: "Bulk 导入、匹配与导出" },
      { href: "/operations?view=ads", label: "PPC 经营指标", icon: ChartNoAxesCombined, moduleId: "operations", hint: "花费、ACOS 与转化" },
    ],
  },
  {
    id: "purchase",
    label: "采购管理",
    icon: ClipboardList,
    hint: "采购计划、订单、发票与协同",
    items: [
      { href: "/operations/purchase-plans", label: "采购计划", icon: ClipboardList, moduleId: "operations", hint: "补货与采购建议" },
      { href: "/operations?view=purchase-orders", label: "采购订单", icon: ClipboardList, moduleId: "operations", hint: "下单、到货与状态" },
      { href: "/operations/purchase-invoices", label: "采购发票", icon: ReceiptText, moduleId: "operations", hint: "发票登记与核对" },
      { href: "/operations?view=suppliers", label: "供应商档案", icon: Store, moduleId: "operations", hint: "供应商与账期" },
      { href: "/operations/procurement-collab", label: "采购协同", icon: Handshake, moduleId: "operations", hint: "询价与交期协同" },
      { href: "/operations/ops-extensions", label: "运营资料与滞销", icon: Boxes, moduleId: "operations", hint: "滞销识别与运营资料" },
    ],
  },
  {
    id: "inventory",
    label: "库存管理",
    icon: Warehouse,
    hint: "FBA 库存、库龄、补货与仓内作业",
    items: [
      { href: "/operations?view=inventory", label: "FBA 库存", icon: Warehouse, moduleId: "operations", hint: "可售、在途与预留" },
      { href: "/operations?view=inventory_age", label: "库存库龄", icon: Activity, moduleId: "operations", hint: "库龄分布与超龄预警" },
      { href: "/operations?view=inventory_events", label: "库存事件", icon: Activity, moduleId: "operations", hint: "出入库与调整记录" },
      { href: "/operations?view=replenishment", label: "补货计划", icon: Boxes, moduleId: "operations", hint: "补货点与建议量" },
      { href: "/logistics/warehouse?tab=warehouses", label: "仓库档案", icon: Warehouse, moduleId: "wms", hint: "仓库与库位" },
      { href: "/logistics/warehouse?tab=receipts", label: "仓库入库", icon: PackageSearch, moduleId: "wms", hint: "收货单与上架" },
      { href: "/logistics/warehouse?tab=reservations", label: "仓库出库", icon: PackageSearch, moduleId: "wms", hint: "预留与发货" },
      { href: "/logistics/warehouse?tab=balances", label: "公司库存与调拨", icon: Warehouse, moduleId: "wms", hint: "公司库存台账" },
      { href: "/logistics/warehouse?tab=transfers", label: "调拨流水", icon: Warehouse, moduleId: "wms", hint: "调拨单据流水" },
      { href: "/operations/assembly", label: "组装", icon: Boxes, moduleId: "wms", hint: "组合装与拆卸" },
    ],
  },
  {
    id: "logistics",
    label: "物流管理",
    icon: Truck,
    hint: "货件、装箱、头程与物流文件",
    items: [
      { href: "/operations?view=fulfillment", label: "FBA 在途货件", icon: Truck, moduleId: "operations", hint: "在途与签收进度" },
      { href: "/operations?view=fba-boxing", label: "FBA 装箱", icon: PackageSearch, moduleId: "operations", hint: "装箱方案与箱规" },
      { href: "/operations?view=first-mile", label: "头程物流", icon: Truck, moduleId: "operations", hint: "头程报价与轨迹" },
      { href: "/logistics", label: "物流文件工作台", icon: PackageSearch, moduleId: "logistics", hint: "装箱表、箱唛与模板" },
      { href: "/sellfox/shipments", label: "Sellfox 货件快照", icon: Store, moduleId: "sellfox", hint: "赛狐货件镜像数据" },
    ],
  },
  {
    id: "finance",
    label: "财务管理",
    icon: Banknote,
    hint: "交易、结算、赔偿与税务",
    items: [
      { href: "/operations?view=finance", label: "财务交易", icon: Banknote, moduleId: "operations", hint: "收支流水" },
      { href: "/operations?view=settlements", label: "结算报告", icon: Banknote, moduleId: "operations", hint: "账期结算与对账" },
      { href: "/operations?view=reimbursements", label: "FBA 赔偿", icon: Banknote, moduleId: "operations", hint: "赔偿申请与到账" },
      { href: "/operations?view=expense-management", label: "ERP 费用单", icon: ReceiptText, moduleId: "operations", hint: "费用录入与分摊" },
      { href: "/sellfox/performance", label: "Sellfox 经营报表", icon: ChartNoAxesCombined, moduleId: "sellfox", hint: "利润与经营分析" },
      { href: "/operations/tax", label: "税务与发票", icon: Landmark, moduleId: "operations", hint: "税率与开票" },
    ],
  },
  {
    id: "analytics",
    label: "数据中心",
    icon: ChartNoAxesCombined,
    hint: "销售流量、品牌分析与同步",
    items: [
      { href: "/operations?view=sales-traffic", label: "销售与流量", icon: ChartNoAxesCombined, moduleId: "operations", hint: "销量、会话与转化" },
      { href: "/operations?view=brand_analytics", label: "品牌分析", icon: SearchCheck, moduleId: "operations", hint: "品牌指标与搜索词" },
      { href: "/sellfox", label: "Sellfox 数据", icon: Store, moduleId: "sellfox", hint: "赛狐数据总览" },
      { href: "/operations", label: "同步中心", icon: Activity, moduleId: "operations", hint: "任务、同步与重试" },
      { href: "/operations/data-dictionary", label: "数据字典", icon: BookMarked, moduleId: "operations", hint: "字段、口径与来源" },
    ],
  },
  {
    id: "ai",
    label: "AI 智能工作台",
    icon: Bot,
    hint: "Agent、Lili 技能与搜词合并",
    items: [
      { href: "/agents", label: "Amazon AI Agent", icon: Bot, moduleId: "agents", hint: "Agent Runtime 与 Trace" },
      { href: "/lili", label: "粒粒 Lili 技能中心", icon: Sparkles, moduleId: "agents", hint: "技能、设备与授权" },
      { href: "/saihu-search-merge", label: "赛狐搜词合并", icon: SearchCheck, moduleId: "searchMerge", hint: "搜索词报表合并导出" },
    ],
  },
  {
    id: "system",
    label: "系统管理",
    icon: Settings,
    hint: "账号授权、任务、权限与设置",
    items: [
      { href: "/operations?view=connections", label: "Amazon 账号与站点", icon: Store, moduleId: "operations", hint: "店铺授权与站点" },
      { href: "/amazon-ads/accounts", label: "Ads 账号授权", icon: Activity, moduleId: "workspace", hint: "广告账号与 Profile" },
      { href: "/tasks", label: "任务中心", icon: ListChecks, moduleId: "tasks", hint: "异步任务与重试" },
      { href: "/versions", label: "版本审计", icon: History, moduleId: "versions", hint: "变更历史与回滚" },
      { href: "/accounts", label: "账号权限", icon: UsersRound, moduleId: "accounts", hint: "用户、角色与模块权限" },
      { href: "/settings", label: "系统设置", icon: Settings, moduleId: "settings", hint: "组织、工作区与偏好" },
      { href: "/help", label: "帮助中心", icon: CircleHelp, hint: "模块索引与快捷键" },
    ],
  },
];

/** 头像菜单沿用的系统入口（与「系统管理」模块指向同一批页面）。 */
export const accountMenuItems = [
  { href: "/tasks", label: "任务中心", icon: ListChecks, moduleId: "tasks" },
  { href: "/versions", label: "版本审计", icon: History, moduleId: "versions" },
  { href: "/accounts", label: "账号权限", icon: UsersRound, moduleId: "accounts" },
  { href: "/settings", label: "系统设置", icon: Settings, moduleId: "settings" },
];

/** 兼容层：老组件/测试按 groups.items 读取扁平结构。 */
export const navigationGroups = navigationModules.map((module) => ({
  label: module.label,
  icon: module.icon,
  items: module.items,
}));

export const allNavigationItems: NavigationItem[] = navigationModules.flatMap((module) => module.items);

const navItemByHref = new Map<string, NavigationItem>();
for (const item of allNavigationItems) navItemByHref.set(item.href, item);
for (const item of accountMenuItems) if (!navItemByHref.has(item.href)) navItemByHref.set(item.href, item as NavigationItem);

export function findNavigationItem(href: string): NavigationItem | undefined {
  const [pathname] = href.split("?");
  return navItemByHref.get(href) ?? navItemByHref.get(pathname);
}

/** 通过 href 反查所属一级模块，用于自动展开。 */
export function findNavigationModule(href: string): NavigationModule | undefined {
  const [pathname] = href.split("?");
  const exact = navigationModules.find((module) => module.items.some((item) => item.href === href));
  if (exact) return exact;
  const byPath = navigationModules.find((module) => module.items.some((item) => item.href === pathname));
  if (byPath) return byPath;
  const byPrefix = navigationModules.find((module) =>
    module.items.some((item) => {
      const itemPath = item.href.split("?")[0];
      if (!PREFIX_MATCH_ROOTS.has(itemPath)) return false;
      return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
    }),
  );
  return byPrefix;
}

/** 老分组名 → 新模块名的归一化，供页面框架面包屑复用同一套一级分类。 */
export { normalizeModuleLabel } from "@/lib/navigation/module-labels";

/**
 * hub 型入口（详情页挂在同一路由下）允许前缀匹配，
 * 避免 /agents/ppc、/lili/skills 这类子路由失去高亮。
 */
const PREFIX_MATCH_ROOTS = new Set(["/agents", "/lili", "/sellfox", "/amazon-ads"]);

/** 某些入口存在默认 view/tab 的等价路径。 */
const PATHNAME_ALIASES: Record<string, string[]> = {
  "/amazon-ads/campaigns": ["/amazon-ads"],
};

export type NavigationLocation = { pathname: string; searchParams: URLSearchParams | null };

/**
 * 二级菜单高亮判定：
 * 1. 路径必须一致（或命中 hub 别名）；
 * 2. 带查询参数的入口逐项比对，缺省的 tab=warehouses 视为默认；
 * 3. 无查询参数的入口（如 /operations 同步中心）只在当前 URL 没有 view 时命中。
 */
export function matchesNavigationItem(itemHref: string, location: NavigationLocation): boolean {
  const [rawPath, rawQuery] = itemHref.split("?");
  const pathCandidates = [rawPath, ...(PATHNAME_ALIASES[rawPath] ?? [])];
  const pathMatched = pathCandidates.includes(location.pathname);
  if (!pathMatched) {
    if (!PREFIX_MATCH_ROOTS.has(rawPath)) return false;
    if (!location.pathname.startsWith(`${rawPath}/`)) return false;
  }

  const params = location.searchParams;
  const wanted = new URLSearchParams(rawQuery ?? "");
  const required = [...wanted.entries()];
  if (!required.length) {
    if (rawPath === "/operations") return !params?.has("view");
    if (rawPath === "/logistics/warehouse") return !params?.has("tab");
    return true;
  }
  if (!params) return false;
  return required.every(([key, value]) => {
    const actual = params.get(key);
    if (actual) return actual === value;
    return key === "tab" && value === "warehouses";
  });
}
