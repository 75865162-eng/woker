// 全站性能采集的路由清单与档位阈值（单一真相源）。
// 供 erp-navigation.mjs（采集）与 perf-budget.mjs（判定）共用，可被单测直接 import。
//
// heading 说明：所有 (erp) 页的唯一稳定 <h1> 由 AppShell 顶栏渲染
// （src/components/app-shell/app-shell-client.tsx:217），文本 = 各 page.tsx 的 <AppShell title=...>。
// PageHeader 刻意只用 <h2>，不在顶栏重复 h1。故 heading 字段即 AppShell title 字符串。
//
// 排除项（非独立可采集目标）：
//   - 动态 slug 页 /skills/[slug]、/lili/[[...path]]、/help/[slug]、/agents/[agentId]：空库 notFound 或 heading 随数据变化。
//   - redirect 壳 /ai、/purchase、/amz、/image-upscale；/forbidden（权限测试专用）。
//   - /design：未映射模块，AppShell 会判 forbidden。

// 档位阈值（来自任务书第 1 节；数值为目标线，非现状声明）。
export const PERF_BUDGET = Object.freeze({
  A: { label: "应用壳/工作台", loginMedianMs: 200, loginP95Ms: 500, viewSwitchMs: 50, newTabPaintedMs: 300, coldLineMs: 1500 },
  B: { label: "常用列表/详情", coldLineMs: 1500, warmNavMs: 500, filterMs: 500, cacheHitMs: 800 },
  C: { label: "重型分析报表", coldLineMs: 3000, filterMs: 800 },
  D: { label: "静态壳/配置", coldLineMs: 1500, warmNavP95Ms: 300 },
});

// fixture 角色需授予 view 的模块（覆盖全部可采集真实页）。
export const FIXTURE_MODULES = Object.freeze([
  "products", "sellfox", "workspace", "searchMerge", "listingAi", "agents",
  "operations", "wms", "logistics", "tasks", "versions", "accounts", "settings",
]);

// 可稳定采集的真实页。tier 用于套用档位线；module 用于失败归因派单。
export const PERF_ROUTES = Object.freeze([
  // A 档：应用壳/高频工作台
  { path: "/", heading: "运营工作台", tier: "A", module: "sellfox" },
  { path: "/tasks", heading: "任务中心", tier: "A", module: "tasks" },
  { path: "/workspace", heading: "PPC 优化工作台", tier: "A", module: "workspace" },
  { path: "/versions", heading: "版本审计", tier: "D", module: "versions" },
  { path: "/listing-ai", heading: "Listing AI", tier: "B", module: "listingAi" },
  { path: "/listing-ai/studio", heading: "Listing 生成台", tier: "B", module: "listingAi" },
  { path: "/logistics", heading: "亚马逊物流处理系统（美国站）", tier: "B", module: "logistics" },
  { path: "/logistics/warehouse", heading: "公司仓库存", tier: "B", module: "wms" },

  // B 档：常用列表/详情/配置
  { path: "/product", heading: "产品管理", tier: "B", module: "products" },
  { path: "/accounts", heading: "账号权限", tier: "B", module: "accounts" },
  { path: "/settings", heading: "系统设置", tier: "D", module: "settings" },
  { path: "/settings/amazon-connections", heading: "Amazon 连接管理", tier: "D", module: "settings" },
  { path: "/help", heading: "帮助中心", tier: "D", module: null },
  { path: "/history", heading: "历史记录", tier: "B", module: "searchMerge" },
  { path: "/saihu-search-merge", heading: "赛狐搜索词合并", tier: "B", module: "searchMerge" },
  { path: "/amazon/catalog", heading: "在线商品与库存", tier: "B", module: "operations" },
  { path: "/amazon/inventory", heading: "FBA 库存", tier: "B", module: "operations" },
  { path: "/amazon-ads", heading: "Amazon Ads", tier: "C", module: "workspace" },

  // B 档：赛狐列表/详情（planned host-page 页空库仍出 AppShell heading，纳入采集以暴露问题）
  { path: "/sellfox", heading: "赛狐数据中台", tier: "B", module: "sellfox" },
  { path: "/sellfox/listings", heading: "在线产品", tier: "B", module: "sellfox" },
  { path: "/sellfox/orders", heading: "全部订单", tier: "B", module: "sellfox" },
  { path: "/sellfox/order-detail", heading: "订单详情", tier: "B", module: "sellfox" },
  { path: "/sellfox/shipments", heading: "货件", tier: "B", module: "sellfox" },
  { path: "/sellfox/inventory", heading: "库存", tier: "B", module: "sellfox" },
  { path: "/sellfox/endpoint-data", heading: "端点原始行", tier: "B", module: "sellfox" },
  { path: "/sellfox/sync", heading: "同步控制台", tier: "B", module: "sellfox" },
  { path: "/sellfox/products", heading: "商品资料", tier: "B", module: "sellfox" },
  { path: "/sellfox/purchase", heading: "采购", tier: "B", module: "sellfox" },
  { path: "/sellfox/finance", heading: "财务", tier: "B", module: "sellfox" },

  // C 档：赛狐重型报表（历史慢点集中）
  { path: "/sellfox/sales", heading: "销量统计", tier: "C", module: "sellfox" },
  { path: "/sellfox/performance", heading: "销售利润", tier: "C", module: "sellfox" },
  { path: "/sellfox/restock", heading: "补货建议", tier: "C", module: "sellfox" },
  { path: "/sellfox/dimensions", heading: "维度分析", tier: "C", module: "sellfox" },
  { path: "/sellfox/profit", heading: "利润报表", tier: "C", module: "sellfox" },
  { path: "/sellfox/ads", heading: "广告报表", tier: "C", module: "sellfox" },

  // B 档：operations 板块（keep-alive 已覆盖，纳入采集确认不过线）
  { path: "/operations", heading: "经营中台", tier: "B", module: "operations" },
  { path: "/operations/assembly", heading: "组装", tier: "B", module: "operations" },
  { path: "/operations/calculators", heading: "计算器中心", tier: "B", module: "operations" },
  { path: "/operations/data-dictionary", heading: "数据字典与自定义字段", tier: "B", module: "operations" },
  { path: "/operations/expenses", heading: "ERP 费用单", tier: "B", module: "operations" },
  { path: "/operations/finance-ledger", heading: "ERP 总账", tier: "B", module: "operations" },
  { path: "/operations/multi-channel", heading: "多渠道经营", tier: "B", module: "operations" },
  { path: "/operations/ops-extensions", heading: "运营资料与滞销", tier: "B", module: "operations" },
  { path: "/operations/procurement-collab", heading: "采购协同", tier: "B", module: "operations" },
  { path: "/operations/purchase-invoices", heading: "采购发票", tier: "B", module: "operations" },
  { path: "/operations/purchase-plans", heading: "采购计划", tier: "B", module: "operations" },
  { path: "/operations/repricing", heading: "跟卖与调价", tier: "B", module: "operations" },
  { path: "/operations/reviews", heading: "评论与店铺绩效", tier: "B", module: "operations" },
  { path: "/operations/sales-plans", heading: "销售计划与预测", tier: "B", module: "operations" },
  { path: "/operations/settlement-allocations", heading: "结算 SKU 分摊", tier: "B", module: "operations" },
  { path: "/operations/tax", heading: "税务与发票台账", tier: "B", module: "operations" },

  // B 档：AI/Agent 工具页
  { path: "/agents", heading: "AI Agent 中心", tier: "B", module: "agents" },
  { path: "/agents/market", heading: "市场 Agent", tier: "B", module: "agents" },
  { path: "/agents/market/selection", heading: "选品证据补全", tier: "B", module: "agents" },
  { path: "/agents/product", heading: "产品 Agent", tier: "B", module: "agents" },
  { path: "/agents/supplier", heading: "供应 Agent", tier: "B", module: "agents" },
  { path: "/agents/listing", heading: "刊登 Agent", tier: "B", module: "agents" },
  { path: "/agents/ppc", heading: "PPC 广告 Agent", tier: "B", module: "agents" },
  { path: "/agents/orchestrator", heading: "Agent 编排器", tier: "B", module: "agents" },
  { path: "/agents/selection-research", heading: "本地 AI 选品研究", tier: "B", module: "agents" },
  { path: "/skills", heading: "Skill 智能工作台", tier: "B", module: "agents" },
]);

// CORE 3 页：权限撤销/组织隔离测试专用的真实页面（与侧边栏导航无关，只要页面存在即可）。
export const CORE_ROUTES = Object.freeze([
  { path: "/listing-ai", heading: "Listing AI", module: "listingAi" },
  { path: "/logistics", heading: "亚马逊物流处理系统（美国站）", module: "logistics" },
  { path: "/workspace", heading: "PPC 优化工作台", module: "workspace" },
]);

// Warm 导航页：侧边栏为「一级类目常驻 + 二级浮层(Flyout portal)」结构，二级链接不在 aside nav 内。
// 模拟真实用户：hover 一级类目(aria-label=groupLabel) → 点浮层里的二级链接(itemLabel)。
// 全部选同一板块(赛狐数据)内页面：hover 同一类目浮层稳定，避免跨板块 hover 的 180ms 关闭竞争。
// 来自 business-navigation.ts 的 items，fixture 授予 sellfox 权限后可见。
export const WARM_NAV_ROUTES = Object.freeze([
  { path: "/sellfox/sales", groupLabel: "赛狐数据", itemLabel: "销量统计", heading: "销量统计", module: "sellfox" },
  { path: "/sellfox/profit", groupLabel: "赛狐数据", itemLabel: "利润报表", heading: "利润报表", module: "sellfox" },
  { path: "/sellfox/orders", groupLabel: "赛狐数据", itemLabel: "订单快照", heading: "全部订单", module: "sellfox" },
]);

// fixture build 需保留的 (erp) 顶层目录（从清单派生，避免手写漂移）。
export function collectableTopDirs() {
  const dirs = new Set(["forbidden"]);
  for (const route of PERF_ROUTES) {
    const seg = route.path.split("/").filter(Boolean)[0];
    if (seg) dirs.add(seg);
  }
  for (const route of CORE_ROUTES) {
    const seg = route.path.split("/").filter(Boolean)[0];
    if (seg) dirs.add(seg);
  }
  return [...dirs].sort();
}

export const collectableCount = PERF_ROUTES.length;
