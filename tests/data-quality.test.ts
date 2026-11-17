import assert from "node:assert/strict";
import test from "node:test";
import { bucketLatency, buildReconciliationTrend, computeNullRate } from "../src/lib/operations/data-quality";

test("空值率：正常计算并保留四位小数", () => {
  assert.deepEqual(computeNullRate(8, 2), { total: 8, nullCount: 2, rate: 0.25 });
  assert.equal(computeNullRate(3, 1).rate, 0.3333);
});

test("空值率：分母为0时 rate 保留 null，不补零", () => {
  const result = computeNullRate(0, 0);
  assert.equal(result.total, 0);
  assert.equal(result.rate, null);
});

test("空值率：无效或越界输入被钳制，不产生错误比率", () => {
  assert.equal(computeNullRate(Number.NaN, 5).rate, null);
  // nullCount 越界（>total 或 <0）属非法输入，钳制为 0，避免夸大空值率。
  assert.deepEqual(computeNullRate(10, 20), { total: 10, nullCount: 0, rate: 0 });
  assert.equal(computeNullRate(10, -3).nullCount, 0);
});

test("同步延迟分桶：按边界归档，忽略无效耗时", () => {
  const result = bucketLatency([500, 1500, 20_000, 60_000, 200_000, -1, Number.NaN]);
  assert.equal(result.sampleSize, 5);
  const byLabel = Object.fromEntries(result.buckets.map((b) => [b.label, b.count]));
  assert.equal(byLabel["<1s"], 1);
  assert.equal(byLabel["1-5s"], 1);
  assert.equal(byLabel["5-30s"], 1);
  assert.equal(byLabel["30s-2m"], 1);
  assert.equal(byLabel[">=2m"], 1);
});

test("同步延迟分桶：空样本返回全0桶", () => {
  const result = bucketLatency([]);
  assert.equal(result.sampleSize, 0);
  assert.ok(result.buckets.every((b) => b.count === 0));
});

test("对账趋势：仅提取已结构化四值，跳过缺失 reconciliation 的 run", () => {
  const trend = buildReconciliationTrend([
    { resource: "sales", finishedAt: new Date("2026-01-02T00:00:00Z"), summary: { reconciliation: { persisted: 10, received: 12, requested: null, dropped: 2 } } },
    { resource: "inventory", finishedAt: new Date("2026-01-01T00:00:00Z"), summary: { result: { count: 5 } } },
  ]);
  assert.equal(trend.length, 1);
  assert.equal(trend[0].persisted, 10);
  assert.equal(trend[0].received, 12);
  assert.equal(trend[0].requested, null);
  assert.equal(trend[0].dropped, 2);
});

test("对账趋势：四值缺失保留 null，按时间升序", () => {
  const trend = buildReconciliationTrend([
    { resource: "a", finishedAt: new Date("2026-01-03T00:00:00Z"), summary: { reconciliation: { persisted: 1 } } },
    { resource: "b", finishedAt: new Date("2026-01-01T00:00:00Z"), summary: { reconciliation: {} } },
  ]);
  assert.equal(trend[0].resource, "b");
  assert.equal(trend[0].received, null);
  assert.equal(trend[1].resource, "a");
});
