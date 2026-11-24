import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateReplicaRowHeight, shouldVirtualizeRows } from "../src/lib/sellfox/virtual-row-height";

test("行高估算：含图片列取 64px（48px 缩略图 + padding）", () => {
  assert.equal(estimateReplicaRowHeight([{ kind: "image" }, { kind: "qty" }]), 64);
});

test("行高估算：含双行 stack 列取 52px", () => {
  for (const kind of ["store", "mskuPrice", "skuName", "titleAsin", "asinMsku", "stack"]) {
    assert.equal(estimateReplicaRowHeight([{ kind }]), 52, `${kind} 应为双行`);
  }
});

test("行高估算：纯单行文本/数字列取 40px", () => {
  assert.equal(estimateReplicaRowHeight([{ kind: "text" }, { kind: "qty" }, { kind: "money" }]), 40);
  assert.equal(estimateReplicaRowHeight([]), 40);
});

test("虚拟化阈值：仅大页窗口化，小页保留全量渲染", () => {
  assert.equal(shouldVirtualizeRows(0), false);
  assert.equal(shouldVirtualizeRows(20), false);
  assert.equal(shouldVirtualizeRows(40), false);
  assert.equal(shouldVirtualizeRows(41), true);
  assert.equal(shouldVirtualizeRows(200), true);
  assert.equal(shouldVirtualizeRows(100, 100), false);
});
