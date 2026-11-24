import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_FIELD_MAPPINGS,
  FIELD_GROUPS,
  STATE_LABELS,
  coverageSummary,
  prioritySummary,
  implementedRatio,
  type CoverageState,
} from "../src/lib/amazon-sync/wimoor-field-catalog";

test("目录覆盖文档 §3.1–§3.9 全部 10 个页面组（§3.6 拆为结算SKU+费用分摊）", () => {
  const pages = FIELD_GROUPS.map(g => g.page);
  assert.equal(FIELD_GROUPS.length, 10);
  for (const p of [
    "listing/products", "order/order_manager", "order/refund", "inventory/fba/detail",
    "inventory/planning", "payment/settlement_sku", "payment/costSharing",
    "payment/profitReport/child", "report/pageview", "advertisement/manager",
  ]) assert.ok(pages.includes(p), `缺页面 ${p}`);
  // 文档 §3.6 拆为 settlement_sku + costSharing 两组，共 10 个唯一 key + 说明
  assert.equal(new Set(pages).size, pages.length, "页面 key 不应重复");
});

test("全量字段条目非空且字段结构完整", () => {
  assert.ok(ALL_FIELD_MAPPINGS.length > 100, `字段数偏少: ${ALL_FIELD_MAPPINGS.length}`);
  for (const f of ALL_FIELD_MAPPINGS) {
    assert.ok(f.label.length > 0, "label 不可空");
    assert.ok(f.prop.length > 0, `${f.label} prop 不可空`);
    assert.ok(f.modelField.length > 0, `${f.label} modelField 不可空`);
    assert.ok(f.spapi.length > 0, `${f.label} spapi 不可空`);
    assert.ok(f.note.length > 0, `${f.label} note 不可空`);
    assert.ok(["P0", "P1", "P2", "-"].includes(f.priority), `${f.label} 非法优先级 ${f.priority}`);
    assert.ok(f.state in STATE_LABELS, `${f.label} 非法状态 ${f.state}`);
  }
});

test("五态均被覆盖，且每态都有中文标签", () => {
  const sum = coverageSummary();
  const states: CoverageState[] = ["explicit", "extractable", "derived", "pending-data", "pending-decision"];
  for (const s of states) {
    assert.ok(sum[s] > 0, `状态 ${s} 无字段`);
    assert.ok(STATE_LABELS[s].length > 0);
  }
  const total = states.reduce((n, s) => n + sum[s], 0);
  assert.equal(total, ALL_FIELD_MAPPINGS.length, "状态聚合总数应等于字段总数");
});

test("P0/P1/P2 缺口均存在（全量升级范围可达）", () => {
  const p = prioritySummary();
  assert.ok(p.P0 > 0, "应有 P0 缺口");
  assert.ok(p.P1 > 0, "应有 P1 缺口");
  assert.ok(p.P2 > 0, "应有 P2 缺口");
});

test("派生字段必须指向派生层，待拍板字段标注清晰", () => {
  const derived = ALL_FIELD_MAPPINGS.filter(f => f.state === "derived");
  for (const f of derived) {
    assert.ok(f.note.includes("派生") || f.note.includes("Wimoor") || f.note.includes("见派生") || f.note.includes("sum") || f.note.includes("公式"),
      `派生字段 ${f.label} 的 note 应说明公式出处`);
  }
  const pending = ALL_FIELD_MAPPINGS.filter(f => f.state === "pending-decision");
  for (const f of pending) {
    assert.ok(["待", "缺", "未", "需", "非 SP-API"].some(k => f.note.includes(k)),
      `待拍板字段 ${f.label} 的 note 应说明原因`);
  }
});

test("已落地占比在 0-100 之间且计算正确", () => {
  const r = implementedRatio();
  assert.ok(r >= 0 && r <= 100);
  const done = ALL_FIELD_MAPPINGS.filter(f => ["explicit", "extractable", "derived"].includes(f.state)).length;
  assert.equal(r, Math.round((done / ALL_FIELD_MAPPINGS.length) * 1000) / 10);
});
