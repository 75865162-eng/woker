import assert from "node:assert/strict";
import test from "node:test";
import { buildSellfoxReconciliation } from "@/lib/sellfox/reconciliation";

test("从 writes/synced/count 提取入库数，按可信度依次取用", () => {
  assert.equal(buildSellfoxReconciliation({ writes: 120 }).persisted, 120);
  assert.equal(buildSellfoxReconciliation({ synced: 55 }).persisted, 55);
  assert.equal(buildSellfoxReconciliation({ count: 7 }).persisted, 7);
  assert.equal(buildSellfoxReconciliation({}, { count: 33 }).persisted, 33);
});

test("上游返回条数可得时计算丢弃数；缺失字段保留 null，绝不补零伪造", () => {
  const r = buildSellfoxReconciliation({ writes: 90, rows: 100 });
  assert.equal(r.received, 100);
  assert.equal(r.dropped, 10);
  assert.equal(r.requested, null);

  const missing = buildSellfoxReconciliation({ writes: 90 });
  assert.equal(missing.received, null);
  assert.equal(missing.dropped, null);
  assert.equal(missing.requested, null);
});

test("入库数未获得时明确标注，不伪造数值", () => {
  const r = buildSellfoxReconciliation({ storeCount: 3 });
  assert.equal(r.persisted, null);
  assert.match(r.note, /未从同步结果中获得/);
});
