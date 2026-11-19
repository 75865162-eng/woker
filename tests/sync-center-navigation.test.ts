import assert from "node:assert/strict";
import test from "node:test";
import {
  operationsAdminNav,
  operationsEntries,
  operationsSections,
  syncNavGroups,
  adminLabelByView,
  businessViewEntries,
  pendingEntries,
  localBusinessEntries,
  localBusinessSubgroups,
  adsNavLinks,
  groupLabelForView,
  syncCenterDrawerLinks,
} from "@/components/operations/operations-sections";

test("A-G 七组齐全且顺序稳定", () => {
  assert.deepEqual(syncNavGroups.map(g => g.id), ["A", "B", "C", "D", "E", "F", "G"]);
});

test("旧运维 view 全部保留，sync 作为新别名入口", () => {
  for (const [key, label] of operationsAdminNav) {
    assert.ok(adminLabelByView.get(key) === label, `旧条目 ${key} 标签应保留`);
  }
  assert.equal(adminLabelByView.get("sync"), "同步编排");
});

test("每个业务板块的 real/pending 拆分完整，且不丢条目", () => {
  for (const section of operationsSections) {
    const real = businessViewEntries(section.id);
    const pending = pendingEntries(section.id);
    const local = section.entries.filter(e => e.href);
    assert.equal(real.length + pending.length + local.length, section.entries.length, `${section.id} 拆分应无遗漏`);
    assert.ok(pending.every(e => e.pending), "pending 列表只含待接入项");
    assert.ok(real.every(e => !e.pending && !e.href), "real 列表只含已接入内部视图");
  }
});

test("本地业务条目全部抽出，且归入 G 三子组", () => {
  assert.ok(localBusinessEntries.length > 0);
  const grouped = localBusinessSubgroups.flatMap(s => s.entries);
  assert.equal(grouped.length, localBusinessEntries.length, "G 子组应覆盖全部本地业务条目");
  const g = syncNavGroups.find(x => x.id === "G");
  assert.equal(g?.kind, "local");
});

test("广告入口区分真实接口与演示原型", () => {
  assert.ok(adsNavLinks.some(l => l.real));
  assert.ok(adsNavLinks.some(l => !l.real));
  const accounts = adsNavLinks.find(l => l.href === "/amazon-ads/accounts");
  assert.equal(accounts?.real, true);
});

test("面包屑分组标签对运维与业务 view 均可解析", () => {
  assert.equal(groupLabelForView("overview"), "同步总览");
  assert.equal(groupLabelForView("connections"), "接入与授权");
  assert.equal(groupLabelForView("sync"), "同步编排");
  assert.ok(groupLabelForView("catalog"), "业务 view 应能解析到所属板块");
});

test("分组引用的 view 均可在运维导航或业务条目中解析（无孤儿引用）", () => {
  const known = new Set([...operationsEntries.map(e => e.view), ...operationsAdminNav.map(([key]) => key), "sync"]);
  for (const group of syncNavGroups) {
    for (const v of group.viewKeys ?? []) assert.ok(known.has(v), `分组视图 ${v} 应在运维导航、业务条目或 sync 别名中`);
    for (const s of group.sectionIds ?? []) assert.ok(operationsSections.some(sec => sec.id === s), `板块 ${s} 应存在`);
  }
});

test("已落库的 report / observation 域均有可导航的承接页 view（无孤儿数据域）", () => {
  // 15 个 report 域 + promotions/notifications 已落库、有只读 API；必须能在运营页导航到。
  const views = new Set(operationsEntries.map(e => e.view));
  const landingViews = [
    "fba_customer_sales", "mfn_returns", "fba_shipments", "fba_inventory_by_country",
    "fba_fulfilled_inventory", "fba_inventory_report", "reserved_inventory", "stranded_inventory",
    "recommended_removals", "storage_fees", "long_term_storage_fees", "fba_overage_fees",
    "fee_preview", "removal_order_report", "removal_shipment_report", "promotions", "notifications",
  ];
  for (const view of landingViews) assert.ok(views.has(view), `承接页 view=${view} 未注册到运营导航`);
  // 报告中心板块必须挂到 E 组，否则左侧浮层不显示。
  const e = syncNavGroups.find(g => g.id === "E");
  assert.ok(e?.sectionIds?.includes("reports"), "报告中心板块应挂在 Amazon 业务数据（E）组");
  // 承接页均为真实内部视图，不带 pending 占位。
  for (const view of landingViews) {
    const entry = operationsEntries.find(e => e.view === view)!;
    assert.equal(entry.pending, undefined, `${view} 应为已接入视图，不是待接入占位`);
  }
});

test("业务菜单抽屉入口覆盖 A-G 全部可访问 view，且不丢项", () => {
  const links = syncCenterDrawerLinks();
  const hrefs = new Set(links.map(l => l.href));
  const sections = new Set(links.map(l => l.sectionLabel));
  // A-D 运维 view
  for (const group of syncNavGroups.filter(g => g.kind === "admin")) {
    for (const v of group.viewKeys ?? []) assert.ok(hrefs.has(`/operations?view=${v}`), `运维视图 ${v} 应在抽屉入口中`);
  }
  // E 业务板块已接入 view（排除 pending）
  for (const group of syncNavGroups.filter(g => g.kind === "business")) {
    assert.ok(sections.has(`${group.id} ${group.label}`), "业务分组标签应出现在抽屉");
    for (const id of group.sectionIds ?? []) {
      for (const entry of businessViewEntries(id)) {
        assert.ok(hrefs.has(entry.href ?? `/operations?view=${entry.view}`), `业务视图 ${entry.view} 应在抽屉入口中`);
      }
    }
  }
  // F 广告 + G 本地外链
  for (const link of adsNavLinks) assert.ok(hrefs.has(link.href), `广告入口 ${link.href} 应在抽屉`);
  for (const entry of localBusinessEntries) assert.ok(hrefs.has(entry.href ?? `/operations?view=${entry.view}`), `本地入口 ${entry.view} 应在抽屉`);
  assert.equal(sections.size, syncNavGroups.length, "A-G 七个分组标签应齐全");
});
