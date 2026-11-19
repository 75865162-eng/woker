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
