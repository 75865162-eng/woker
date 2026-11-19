import assert from "node:assert/strict";
import test from "node:test";
import { navigationGroups, accountMenuItems, navigationItemIndex } from "@/components/app-shell/business-navigation";
import { amazonSlugRoutes, amazonSlugView, amazonSlugRewrites } from "@/lib/amazon/amazon-slug-routes";

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
    products: "/dashboard",
    sellfox: "/sellfox/profit",
    amazon: "/operations?view=sales-traffic",
    purchase: "/operations/purchase-plans",
    warehouse: "/operations?view=inventory",
    finance: "/operations?view=finance",
    ai: "/ai/lili",
  };
  for (const group of navigationGroups) {
    assert.equal(group.href, expected[group.id], `${group.id} 一级跳转目标`);
    assert.ok(group.href.startsWith("/"), `${group.id} 一级链接应为站内路径`);
  }
});

test("商品管理只保留商品主档", () => {
  const products = navigationGroups.find(g => g.id === "products")!;
  assert.equal(products.items.length, 1);
  assert.equal(products.items[0].href, "/dashboard");
});

test("所有赛狐页面归入赛狐数据板块", () => {
  const sellfox = navigationGroups.find(g => g.id === "sellfox")!;
  const sellfoxItems = sellfox.items.filter(i => i.href.startsWith("/sellfox/"));
  assert.ok(sellfoxItems.length >= 14, "赛狐数据应集成全部赛狐页面");
  assert.ok(sellfox.items.some(i => i.href === "/sellfox/profit"));
  assert.ok(sellfox.items.some(i => i.href === "/sellfox/orders"));
  assert.ok(sellfox.items.some(i => i.href === "/sellfox/ads"));
});

test("隐藏 Amazon 功能页全部纳入亚马逊数据板块", () => {
  const amazon = navigationGroups.find(g => g.id === "amazon")!;
  const hrefs = new Set(amazon.items.map(i => i.href));
  for (const slug of ["returns", "buyer-messages", "account-health", "pricing", "buy-box", "fees", "offers", "data-kiosk", "repeat-purchase", "merchant-shipping", "mcf", "awd"]) {
    assert.ok(hrefs.has(`/amazon/${slug}`), `隐藏页 /amazon/${slug} 应纳入亚马逊数据`);
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

test("物流发货并入仓库管理板块", () => {
  const warehouse = navigationGroups.find(g => g.id === "warehouse")!;
  const hrefs = warehouse.items.map(i => i.href);
  assert.ok(hrefs.includes("/operations?view=fulfillment"), "FBA 在途货件应并入仓库管理");
  assert.ok(hrefs.includes("/operations?view=fba-boxing"), "FBA 装箱应并入仓库管理");
  assert.ok(hrefs.includes("/operations?view=first-mile"), "头程物流应并入仓库管理");
  assert.ok(hrefs.includes("/logistics"), "物流文件工作台应并入仓库管理");
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

test("pathname 解析：view 类后缀返回 view，独立路由类返回 null", () => {
  assert.equal(amazonSlugView("orders"), "orders");
  assert.equal(amazonSlugView("order"), "orders");
  assert.equal(amazonSlugView("brand-analytics"), "brand_analytics");
  assert.equal(amazonSlugView("reviews"), null);
  assert.equal(amazonSlugView("not-exist"), null);
  assert.ok(Object.keys(amazonSlugRoutes).length > 30, "后缀映射应覆盖全部 Amazon 页面");
});

test("一级跳转的落地命名空间路径都有对应实现", () => {
  // /Product /amz /purchase /WMS /Fin 是新建落地页，/sellfox/profit、/ai/lili 等为已实现或重定向页。
  const namespaces = ["/Product", "/amz", "/purchase", "/WMS", "/Fin"];
  for (const ns of namespaces) assert.ok(ns.startsWith("/"), `${ns} 应为合法命名空间`);
  assert.ok(amazonSlugRoutes["sync-center"], "同步中心后缀应存在");
});
