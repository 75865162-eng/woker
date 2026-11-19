/**
 * 业务板块「二级命名空间」→ 真实页面的单一数据源。
 *
 * 背景：7 大板块要求二级链接统一使用各自命名空间前缀
 *   /product 商品管理、/sellfox 赛狐数据、/amazon 亚马逊数据、
 *   /purchase 采购管理、/wms 仓库管理、/fin 财务管理、/ai AI 与工具。
 * 真实页面仍复用经营中台 workbench（/operations?view=xxx）、WMS、AI 等既有实现，
 * 通过 next.config.ts rewrites 把新命名空间映射到真实页面，避免重复实现与页面搬迁风险。
 *
 * 约定：
 * - destination 有值 → 生成 rewrite（source=href → destination）。
 * - destination 缺省 → 该 href 由真实 page.tsx 提供（如 /product）。
 * - moduleId → 供 permissions.ts 做 pathname 权限归属，避免合法访问被误判 forbidden。
 *
 * 该文件保持纯数据，不依赖其他模块；next.config.ts 与 permissions.ts 共同消费。
 */
export type NamespaceEntry = {
  href: string;
  moduleId: string;
  destination?: string;
};

export const namespaceEntries: NamespaceEntry[] = [
  // ── 商品管理 /product ──────────────────────────────
  // /product 为真实 page.tsx（商品主档，已替代旧 /dashboard），无需 rewrite。
  { href: "/product", moduleId: "products" },
  { href: "/product/calculators", moduleId: "products", destination: "/operations/calculators" },

  // ── 采购管理 /purchase ─────────────────────────────
  { href: "/purchase", moduleId: "operations" }, // 命名空间落地页（redirect）
  { href: "/purchase/plans", moduleId: "operations", destination: "/operations/purchase-plans" },
  { href: "/purchase/orders", moduleId: "operations", destination: "/operations?view=purchase-orders" },
  { href: "/purchase/invoices", moduleId: "operations", destination: "/operations/purchase-invoices" },
  { href: "/purchase/suppliers", moduleId: "operations", destination: "/operations?view=suppliers" },
  { href: "/purchase/collab", moduleId: "operations", destination: "/operations/procurement-collab" },
  { href: "/purchase/ops-extensions", moduleId: "operations", destination: "/operations/ops-extensions" },

  // ── 仓库管理 /wms（仅保留自有仓库 + 物流文件，FBA 数据已归入亚马逊）──
  { href: "/wms", moduleId: "wms", destination: "/wms/logistics" }, // 一级落地 → 物流文件工作台
  { href: "/wms/warehouse", moduleId: "wms", destination: "/logistics/warehouse?tab=warehouses" },
  { href: "/wms/receipts", moduleId: "wms", destination: "/logistics/warehouse?tab=receipts" },
  { href: "/wms/reservations", moduleId: "wms", destination: "/logistics/warehouse?tab=reservations" },
  { href: "/wms/balances", moduleId: "wms", destination: "/logistics/warehouse?tab=balances" },
  { href: "/wms/transfers", moduleId: "wms", destination: "/logistics/warehouse?tab=transfers" },
  { href: "/wms/assembly", moduleId: "wms", destination: "/operations/assembly" },
  { href: "/wms/logistics", moduleId: "logistics", destination: "/logistics" },

  // ── 财务管理 /fin（结算报告、FBA 赔偿已归入亚马逊）──
  { href: "/fin", moduleId: "operations", destination: "/fin/transactions" }, // 一级落地
  { href: "/fin/transactions", moduleId: "operations", destination: "/operations?view=finance" },
  { href: "/fin/ledger", moduleId: "operations", destination: "/operations/finance-ledger" },
  { href: "/fin/allocations", moduleId: "operations", destination: "/operations/settlement-allocations" },
  { href: "/fin/expenses", moduleId: "operations", destination: "/operations?view=expense-management" },
  { href: "/fin/tax", moduleId: "operations", destination: "/operations/tax" },

  // ── AI 与工具 /ai ──────────────────────────────────
  { href: "/ai", moduleId: "agents" }, // 命名空间落地页（已有的真实 redirect）
  { href: "/ai/agent", moduleId: "agents", destination: "/agents" },
  { href: "/ai/skills", moduleId: "agents", destination: "/skills" },
  { href: "/ai/listing", moduleId: "listingAi", destination: "/listing-ai" },
  { href: "/ai/listing-studio", moduleId: "listingAi", destination: "/listing-ai/studio" },
  // /ai/lili 用服务端 rewrite 直达 /lili，而非 page.tsx 的客户端 redirect：
  // redirect 跳板会让 tab 身份分裂（/ai/lili 幽灵 tab + /lili 实际 tab），且延迟落地会
  // 覆盖用户紧随其后的导航（表现为「点击假死」）。rewrite 保持 URL/tab 身份稳定为 /ai/lili。
  { href: "/ai/lili", moduleId: "agents", destination: "/lili" },

  // ── 赛狐数据 /sellfox（搜词合并为历史独立路由，纳入赛狐命名空间）──
  { href: "/sellfox/search-merge", moduleId: "searchMerge", destination: "/saihu-search-merge" },

  // ── 亚马逊数据命名空间落地页 ─────────────────────
  { href: "/amz", moduleId: "operations" }, // 已有的真实 redirect
];

/** 生成 next.config.ts 需要的 rewrite 列表（仅带 destination 的条目）。 */
export function namespaceRewrites(): Array<{ source: string; destination: string }> {
  return namespaceEntries
    .filter((entry): entry is NamespaceEntry & { destination: string } => Boolean(entry.destination))
    .map(({ href, destination }) => ({ source: href, destination }));
}

/** 供 permissions.ts 做 pathname → moduleId 归属的新增路径。 */
export function namespacePathModules(): Array<{ path: string; moduleId: string }> {
  return namespaceEntries.map(({ href, moduleId }) => ({ path: href, moduleId }));
}
