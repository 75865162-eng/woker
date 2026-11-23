import assert from "node:assert/strict";
import test from "node:test";
import { getDomainArchitecture, auditDomainArchitecture } from "@/lib/amazon/domain-architecture";
import { syncDomains, implementedDomain } from "@/lib/amazon-sync/policy";
import { automaticAdapters } from "@/lib/amazon-sync/automatic-adapters";
import { listAdsCapabilities } from "@/lib/amazon-ads/capabilities";

test("架构账本覆盖全部 SP 域与 Ads SP 能力，无重复 ID", () => {
  const rows = getDomainArchitecture();
  const sp = rows.filter(r => r.provider === "amazon_sp_api");
  const ads = rows.filter(r => r.provider === "amazon_ads");
  assert.equal(sp.length, syncDomains.length);
  assert.equal(ads.length, listAdsCapabilities("SP").length);
  assert.deepEqual([...new Set(rows.map(r => r.id))].sort(), rows.map(r => r.id).sort());
});

test("全部已实现 SP 域都有真实落地路由与已注册自动计划", () => {
  const registered = new Set<string>(automaticAdapters.map(a => a.resource));
  for (const domain of syncDomains.filter(d => d.implemented && d.id !== "order_items")) {
    const row = getDomainArchitecture().find(r => r.provider === "amazon_sp_api" && r.id === domain.id);
    assert.ok(row, `${domain.id} 缺账本行`);
    assert.notEqual(row.landing.surface, "none", `${domain.id} 缺落地页`);
    assert.match(row.landing.route, /^\/(operations|amazon-ads)/, `${domain.id} 落地路由无效`);
    assert.equal(row.schedule.registered, true, `${domain.id} 缺自动计划`);
    assert.ok(row.schedule.intervalMinutes! >= 15, `${domain.id} 计划间隔无效`);
    assert.equal(registered.has(domain.id), true, `${domain.id} 未出现在自动适配器注册表`);
  }
});

test("落地 workbench 路由与 operations 视图约定一致（连字符/下划线不串用）", () => {
  const knownViews = new Set([
    "catalog", "inventory", "orders", "finance", "returns", "order-items", "sales-traffic", "seller-feedback",
    "settlements", "reimbursements", "inventory_age", "inventory_events", "fulfillment",
    "listing_details", "catalog_items", "pricing", "buy_box_history", "brand_analytics",
    "fba_customer_sales", "mfn_returns", "fba_shipments", "fba_inventory_by_country",
    "fba_fulfilled_inventory", "fba_inventory_report", "reserved_inventory", "stranded_inventory",
    "recommended_removals", "storage_fees", "long_term_storage_fees", "fba_overage_fees",
    "fee_preview", "removal_order_report", "removal_shipment_report", "promotions", "notifications",
  ]);
  const spWorkbenches = getDomainArchitecture().filter(r => r.provider === "amazon_sp_api" && r.landing.surface === "workbench");
  assert.ok(spWorkbenches.length > 0);
  for (const row of spWorkbenches) {
    const view = row.landing.route.split("view=")[1];
    assert.ok(knownViews.has(view), `${row.id} 的 view=${view} 未在运营页注册`);
  }
  // 命名口径：报告族沿用下划线域 ID，orders/sales-traffic 走连字符专用页。
  assert.equal(getDomainArchitecture().find(r => r.id === "sales_traffic")!.landing.route, "/operations?view=sales-traffic");
  assert.equal(getDomainArchitecture().find(r => r.id === "order_items")!.landing.route, "/operations?view=order-items");
  assert.equal(getDomainArchitecture().find(r => r.id === "inventory_age")!.landing.route, "/operations?view=inventory_age");
});

test("ImplementedDomain 类型与账本已实现域一一对应（含 mfn_returns）", () => {
  for (const domain of syncDomains.filter(d => d.implemented && d.id !== "order_items")) {
    assert.doesNotThrow(() => implementedDomain(domain.id), `${domain.id} 不在 ImplementedDomain 类型`);
  }
  assert.throws(() => implementedDomain("order_items"), /订单商品复用/);
  assert.throws(() => implementedDomain("buy_box"), /复用 pricing/);
});

test("Ads 已实现能力有落地与计划；未实现的 P1 域诚实标注为 none", () => {
  const ads = getDomainArchitecture().filter(r => r.provider === "amazon_ads");
  for (const row of ads.filter(r => r.implemented)) {
    assert.notEqual(row.landing.surface, "none", `${row.id} 缺落地页`);
    assert.ok(row.schedule.registered || row.schedule.scheduler === "authorization-flow", `${row.id} 缺计划`);
  }
  const planned = ads.filter(r => !r.implemented);
  assert.ok(planned.every(r => r.landing.surface === "none" && !r.schedule.registered));
  assert.ok(planned.some(r => r.id === "sp:portfolios"));
  assert.ok(planned.some(r => r.id === "sp:budget-bidding"));
  assert.ok(planned.some(r => r.id === "sp:creative-brand"));
});

test("架构自检全通过且不伪造真实数据验收结论", () => {
  const audit = auditDomainArchitecture();
  assert.equal(audit.ok, true, audit.gaps.join("；"));
  assert.equal(audit.gaps.length, 0);
  assert.equal(audit.counts.spImplemented, 34);
  assert.equal(audit.counts.adsImplemented, 15);
  const ledger = getDomainArchitecture();
  assert.ok(ledger.every(r => r.acceptance.trim().length >= 6), "每行都应保留真实验收前置说明（非伪造接通结论）");
  // 15 个 report 域 + promotions / notifications 已补齐 workbench 承接页，全部走 Amazon 数据源。
  assert.equal(getDomainArchitecture().find(r => r.id === "promotions")!.landing.surface, "workbench");
  assert.equal(getDomainArchitecture().find(r => r.id === "notifications")!.landing.surface, "workbench");
  const reportIds = ["fba_customer_sales", "mfn_returns", "fba_shipments", "fba_inventory_by_country", "fba_fulfilled_inventory", "fba_inventory_report", "reserved_inventory", "stranded_inventory", "recommended_removals", "storage_fees", "long_term_storage_fees", "fba_overage_fees", "fee_preview", "removal_order_report", "removal_shipment_report"];
  for (const id of reportIds) {
    const row = getDomainArchitecture().find(r => r.id === id)!;
    assert.equal(row.landing.surface, "workbench", `${id} 应有 workbench 承接页`);
    assert.equal(row.landing.route, `/operations?view=${id}`, `${id} 承接页路由应与 view 一致`);
  }
});
