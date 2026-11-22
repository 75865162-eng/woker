import assert from "node:assert/strict";
import test from "node:test";
import { navigationGroups, accountMenuItems, navigationItemIndex } from "@/components/app-shell/business-navigation";
import { amazonSlugRoutes, amazonSlugView, amazonSlugRewrites } from "@/lib/amazon/amazon-slug-routes";
import { namespaceEntries, namespaceRewrites, namespacePathModules } from "@/lib/navigation/namespace-routes";
import { getModuleIdForPath } from "@/lib/accounts/permissions";

test("一级重组为 7 大板块，顺序与命名稳定", () => {
  assert.deepEqual(navigationGroups.map(g => g.id), [
    "products", "sellfox", "amazon", "purchase", "warehouse", "finance", "ai",
  ]);
  assert.deepEqual(navigationGroups.map(g => g.label), [
    "商品管理", "赛狐数据", "亚马逊数据", "采购管理", "仓库管理", "财务管理", "AI 与工具",
  ]);
});

test("每个一级板块都有可点击的落地链接", () => {
  const expected: Record<string, string> = {
    products: "/product",
    sellfox: "/sellfox/profit",
    amazon: "/amazon/sales-traffic",
    purchase: "/purchase/plans",
    warehouse: "/wms/logistics",
    finance: "/fin/transactions",
    // AI 一级走 /ai/lili 命名空间，由服务端 rewrite 直达 /lili（无 redirect 跳板）。
    ai: "/ai/lili",
  };
  for (const group of navigationGroups) {
    assert.equal(group.href, expected[group.id], `${group.id} 一级跳转目标`);
    assert.ok(group.href.startsWith("/"), `${group.id} 一级链接应为站内路径`);
  }
});

test("除亚马逊板块外，所有二级链接都用本板块命名空间前缀", () => {
  const prefixByGroup: Record<string, string> = {
    products: "/product",
    sellfox: "/sellfox",
    purchase: "/purchase",
    warehouse: "/wms",
    finance: "/fin",
    ai: "/ai",
  };
  for (const group of navigationGroups) {
    const prefix = prefixByGroup[group.id];
    if (!prefix) continue;
    for (const item of group.items) {
      assert.ok(item.href === prefix || item.href.startsWith(`${prefix}/`), `${item.id} 应使用 ${prefix} 前缀，实际 ${item.href}`);
    }
  }
});

test("计算器中心从 AI 板块移入商品管理，路径 /product/calculators", () => {
  const products = navigationGroups.find(g => g.id === "products")!;
  const calc = products.items.find(i => i.id === "products.calculators");
  assert.ok(calc, "商品管理应含计算器中心");
  assert.equal(calc!.href, "/product/calculators");
  const ai = navigationGroups.find(g => g.id === "ai")!;
  assert.equal(ai.items.some(i => i.href.includes("calculator")), false, "AI 板块不应再有计算器中心");
});

test("Amazon 同步数据只在一处收录：财务无结算报告/FBA 赔偿，仓库无 FBA 数据", () => {
  const finance = navigationGroups.find(g => g.id === "finance")!;
  const financeHrefs = finance.items.map(i => i.href);
  assert.equal(financeHrefs.some(h => h.includes("settlement")), false, "财务不应再收录结算报告");
  assert.equal(financeHrefs.some(h => h.includes("reimbursement")), false, "财务不应再收录 FBA 赔偿");

  const warehouse = navigationGroups.find(g => g.id === "warehouse")!;
  const warehouseHrefs = warehouse.items.map(i => i.href);
  assert.equal(warehouseHrefs.some(h => /fba|inventory|fulfillment|replenishment|first-mile|boxing/.test(h)), false, "仓库不应再收录 FBA 数据");

  const amazon = navigationGroups.find(g => g.id === "amazon")!;
  const amazonHrefs = new Set(amazon.items.map(i => i.href));
  for (const slug of ["settlements", "inventory", "inventory-age", "replenishment", "fulfillment", "fba-boxing"]) {
    assert.ok(amazonHrefs.has(`/amazon/${slug}`), `Amazon 板块应收录 /amazon/${slug}`);
  }
});

test("无站点归属证据的赔偿/库存事件报告不设可见页面入口", () => {
  // 上游 FBA 赔偿报告与 Ledger 库存事件报告的标准列不含 marketplace/store 归属字段，
  // 明细无法安全归因到具体站点（安全边界隔离、verifiedRows=0）。按产品决策不展示这两个页面，
  // 数据仍在服务端加密归档，不删除数据契约、同步能力与只读 API。
  const amazon = navigationGroups.find(g => g.id === "amazon")!;
  const hrefs = new Set(amazon.items.map(i => i.href));
  assert.equal(hrefs.has("/amazon/reimbursements"), false, "赔偿页不应有导航入口");
  assert.equal(hrefs.has("/amazon/inventory-events"), false, "库存事件页不应有导航入口");
  const rewriteSources = new Set(amazonSlugRewrites().map(r => r.source));
  assert.equal(rewriteSources.has("/amazon/reimbursements"), false, "赔偿页不应有 URL 直达别名");
  assert.equal(rewriteSources.has("/amazon/inventory-events"), false, "库存事件页不应有 URL 直达别名");
});

test("所有赛狐页面归入赛狐数据板块", () => {
  const sellfox = navigationGroups.find(g => g.id === "sellfox")!;
  const sellfoxItems = sellfox.items.filter(i => i.href.startsWith("/sellfox/"));
  assert.ok(sellfoxItems.length >= 14, "赛狐数据应集成全部赛狐页面");
  assert.ok(sellfox.items.some(i => i.href === "/sellfox/profit"));
  assert.ok(sellfox.items.some(i => i.href === "/sellfox/orders"));
  assert.ok(sellfox.items.some(i => i.href === "/sellfox/ads"));
  assert.ok(sellfox.items.some(i => i.href === "/sellfox/search-merge"), "搜词合并归入赛狐命名空间");
});

test("隐藏 Amazon 功能页全部纳入亚马逊数据板块", () => {
  const amazon = navigationGroups.find(g => g.id === "amazon")!;
  const hrefs = new Set(amazon.items.map(i => i.href));
  for (const slug of ["returns", "pricing", "buy-box", "fees", "repeat-purchase"]) {
    assert.ok(hrefs.has(`/amazon/${slug}`), `隐藏页 /amazon/${slug} 应纳入亚马逊数据`);
  }
});

// 上一轮补齐的 15 个 report 域 + promotions/notifications 承接页，必须既有一级导航入口，
// 也有 /amazon/<slug> 直达别名（rewrite 到 /operations?view=），杜绝「有数据无页面」与「页面不连通」。
const reportAndObservationSlugs = [
  "fba-customer-sales", "mfn-returns", "fba-shipments", "fba-inventory-by-country",
  "fba-fulfilled-inventory", "fba-inventory-report", "reserved-inventory", "stranded-inventory",
  "recommended-removals", "storage-fees", "long-term-storage-fees", "fba-overage-fees",
  "fee-preview", "removal-order-report", "removal-shipment-report", "promotions", "notifications",
];

test("报告与观察承接页全部纳入亚马逊数据一级板块", () => {
  const amazon = navigationGroups.find(g => g.id === "amazon")!;
  const hrefs = new Set(amazon.items.map(i => i.href));
  for (const slug of reportAndObservationSlugs) {
    assert.ok(hrefs.has(`/amazon/${slug}`), `承接页 /amazon/${slug} 应纳入亚马逊数据一级导航`);
  }
});

test("报告与观察承接页均有 /amazon/<slug> rewrite 到对应 view", () => {
  const bySource = new Map(amazonSlugRewrites().map(r => [r.source, r.destination]));
  const expectedView: Record<string, string> = {
    "fba-customer-sales": "fba_customer_sales", "mfn-returns": "mfn_returns", "fba-shipments": "fba_shipments",
    "fba-inventory-by-country": "fba_inventory_by_country", "fba-fulfilled-inventory": "fba_fulfilled_inventory",
    "fba-inventory-report": "fba_inventory_report", "reserved-inventory": "reserved_inventory",
    "stranded-inventory": "stranded_inventory", "recommended-removals": "recommended_removals",
    "storage-fees": "storage_fees", "long-term-storage-fees": "long_term_storage_fees",
    "fba-overage-fees": "fba_overage_fees", "fee-preview": "fee_preview",
    "removal-order-report": "removal_order_report", "removal-shipment-report": "removal_shipment_report",
    promotions: "promotions", notifications: "notifications",
  };
  for (const slug of reportAndObservationSlugs) {
    assert.equal(bySource.get(`/amazon/${slug}`), `/operations?view=${expectedView[slug]}`, `/amazon/${slug} 应 rewrite 到承接页 view`);
    assert.equal(amazonSlugView(slug), expectedView[slug], `amazonSlugView(${slug}) 应解析到承接页 view`);
  }
});

test("系统设置业务项归入亚马逊数据，全局项留在右上角账号菜单", () => {
  const amazon = navigationGroups.find(g => g.id === "amazon")!;
  const amazonHrefs = amazon.items.map(i => i.href);
  assert.ok(amazonHrefs.includes("/amazon/connections"), "账号与站点授权应归入亚马逊数据");
  assert.ok(amazonHrefs.includes("/amazon/ads-accounts"), "Ads 账号授权应归入亚马逊数据");
  assert.ok(amazonHrefs.includes("/amazon/data-dictionary"), "数据字典应归入亚马逊数据");
  assert.equal(navigationGroups.some(g => g.id === "system"), false, "不应再有系统设置一级板块");
  const accountHrefs = accountMenuItems.map(i => i.href);
  assert.ok(accountHrefs.includes("/settings"));
  assert.ok(accountHrefs.includes("/accounts"));
  assert.ok(accountHrefs.includes("/help"));
});

test("物流文件工作台是仓库管理一级落地与唯一物流文件入口", () => {
  const warehouse = navigationGroups.find(g => g.id === "warehouse")!;
  assert.equal(warehouse.href, "/wms/logistics");
  assert.ok(warehouse.items.some(i => i.href === "/wms/logistics"));
});

test("稳定 id 索引无重复、全部可反查", () => {
  let total = 0;
  for (const group of navigationGroups) total += group.items.length;
  assert.equal(navigationItemIndex.size, total, "索引条目数应与全部二级项一致");
  for (const group of navigationGroups) {
    for (const item of group.items) {
      assert.equal(navigationItemIndex.get(item.id)?.groupId, group.id, `${item.id} 归属应正确`);
    }
  }
});

test("Amazon 后缀 rewrite：view 类映射与独立路由类映射都生成正确", () => {
  const rewrites = amazonSlugRewrites();
  const bySource = new Map(rewrites.map(r => [r.source, r.destination]));
  assert.equal(bySource.get("/amazon/orders"), "/operations?view=orders");
  assert.equal(bySource.get("/amazon/order"), "/operations?view=orders");
  assert.equal(bySource.get("/amazon/ads"), "/operations?view=ads");
  assert.equal(bySource.get("/amazon/listing"), "/operations?view=listing_details");
  assert.equal(bySource.get("/amazon/reviews"), "/operations/reviews");
  assert.equal(bySource.get("/amazon/campaigns"), "/amazon-ads/campaigns");
  assert.ok(rewrites.every(r => r.source.startsWith("/amazon/")));
});

test("命名空间 rewrite：商品/采购/仓库/财务/AI/赛狐新前缀都映射到真实页面", () => {
  const bySource = new Map(namespaceRewrites().map(r => [r.source, r.destination]));
  // /product 为真实 page.tsx，不产生 rewrite；仅二级 calculators 走 rewrite
  assert.equal(bySource.get("/product"), undefined);
  assert.equal(bySource.get("/product/calculators"), "/operations/calculators");
  assert.equal(bySource.get("/purchase/plans"), "/operations/purchase-plans");
  assert.equal(bySource.get("/purchase/orders"), "/operations?view=purchase-orders");
  assert.equal(bySource.get("/wms/warehouse"), "/logistics/warehouse?tab=warehouses");
  assert.equal(bySource.get("/wms/logistics"), "/logistics");
  assert.equal(bySource.get("/fin/transactions"), "/operations?view=finance");
  assert.equal(bySource.get("/fin/tax"), "/operations/tax");
  assert.equal(bySource.get("/ai/agent"), "/agents");
  assert.equal(bySource.get("/ai/listing"), "/listing-ai");
  assert.equal(bySource.get("/sellfox/search-merge"), "/saihu-search-merge");
});

test("每个导航二级链接的 href 都有 rewrite 或真实命名空间落地页兜底", () => {
  const rewriteSources = new Set(namespaceRewrites().map(r => r.source));
  const namespaceHrefs = new Set(namespaceEntries.map(e => e.href));
  const amazonSources = new Set(amazonSlugRewrites().map(r => r.source));
  for (const group of navigationGroups) {
    for (const item of group.items) {
      const ok = rewriteSources.has(item.href) || namespaceHrefs.has(item.href) || amazonSources.has(item.href)
        // 赛狐 /sellfox/*、商品主档 /product 由真实 page.tsx 提供；/ai/lili 由 namespace rewrite 直达 /lili
        || item.href.startsWith("/sellfox/") || item.href === "/product";
      assert.ok(ok, `${item.id} 的 ${item.href} 应有 rewrite 或真实页兜底`);
    }
  }
});

test("每个一级板块的 href 都能在二级菜单找到同 URL 入口", () => {
  for (const group of navigationGroups) {
    assert.ok(
      group.items.some(i => i.href === group.href),
      `${group.label} 一级 ${group.href} 应在二级有同 URL 入口`,
    );
  }
});

test("导航中无旧链接：/dashboard、大写命名空间、/workspace、ppc-bulk 均不出现", () => {
  const allHrefs = navigationGroups.flatMap(g => [g.href, ...g.items.map(i => i.href)]);
  const stalePatterns = [/^\/dashboard(\?|$)/, /^\/(Product|WMS|Fin)(\/|$)/, /^\/workspace$/, /^\/operations\?view=/, /ppc-bulk/i];
  for (const href of allHrefs) {
    for (const pattern of stalePatterns) {
      assert.equal(pattern.test(href), false, `导航不应残留旧链接 ${href}`);
    }
  }
});

test("pathname 解析：view 类后缀返回 view，独立路由类返回 null", () => {
  assert.equal(amazonSlugView("orders"), "orders");
  assert.equal(amazonSlugView("order"), "orders");
  assert.equal(amazonSlugView("brand-analytics"), "brand_analytics");
  assert.equal(amazonSlugView("reviews"), null);
  assert.equal(amazonSlugView("not-exist"), null);
  assert.ok(Object.keys(amazonSlugRoutes).length > 30, "后缀映射应覆盖全部 Amazon 页面");
});

test("命名空间路径映射到正确模块，最长匹配避免父前缀误吞子路径", () => {
  assert.equal(namespacePathModules().some(e => e.path === "/product"), true);
  // /amazon/<slug> 仍归 operations
  assert.equal(getModuleIdForPath("/amazon/orders"), "operations");
  assert.equal(getModuleIdForPath("/amazon/returns"), "operations");
  // 新增命名空间 → 模块
  assert.equal(getModuleIdForPath("/product"), "products");
  assert.equal(getModuleIdForPath("/product/calculators"), "products");
  assert.equal(getModuleIdForPath("/purchase/plans"), "operations");
  assert.equal(getModuleIdForPath("/wms/warehouse"), "wms");
  assert.equal(getModuleIdForPath("/fin/tax"), "operations");
  // 最长匹配：/ai/listing 应归 listingAi，不被 /ai(agents) 抢先
  assert.equal(getModuleIdForPath("/ai/listing"), "listingAi");
  assert.equal(getModuleIdForPath("/ai/listing-studio"), "listingAi");
  assert.equal(getModuleIdForPath("/ai/agent"), "agents");
  // /amazon-ads 仍归 workspace，不能被 /amazon 前缀误吞
  assert.equal(getModuleIdForPath("/amazon-ads/campaigns"), "workspace");
});
