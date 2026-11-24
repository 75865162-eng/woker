/**
 * 回归：订单工作台「完整窗口」指标曾只看游标的瞬时 status===SUCCEEDED，
 * 但游标在完成窗口后随即被规划下一窗口置回 RUNNING，导致长期误报 0/4。
 * 修复后用「曾成功提交（lastSuccessAt 有效）或当前 SUCCEEDED」判定。
 */
import { orderWindowRecentlyCompleted } from "@/components/operations/orders-workbench";
import assert from "node:assert/strict";
import test from "node:test";

test("最近窗口已完成：瞬时 SUCCEEDED 视为完成", () => {
  assert.equal(orderWindowRecentlyCompleted({ status: "SUCCEEDED", lastSuccessAt: null }), true);
});

test("最近窗口已完成：RUNNING 但今天已成功提交过窗口，视为完成（修复 0/4 误报）", () => {
  assert.equal(orderWindowRecentlyCompleted({ status: "RUNNING", lastSuccessAt: "2026-11-24T07:42:06.780Z" }), true);
  assert.equal(orderWindowRecentlyCompleted({ status: "WAITING", lastSuccessAt: "2026-11-24T07:59:03.992Z" }), true);
});

test("最近窗口未完成：RUNNING 且从未成功提交", () => {
  assert.equal(orderWindowRecentlyCompleted({ status: "RUNNING", lastSuccessAt: null }), false);
  assert.equal(orderWindowRecentlyCompleted({ status: "WAITING", lastSuccessAt: "" }), false);
});

test("最近窗口未完成：lastSuccessAt 非有效时间", () => {
  assert.equal(orderWindowRecentlyCompleted({ status: "RUNNING", lastSuccessAt: "not-a-date" }), false);
});

test("最近窗口未完成：无游标（尚未同步）", () => {
  assert.equal(orderWindowRecentlyCompleted(null), false);
  assert.equal(orderWindowRecentlyCompleted(undefined), false);
});
