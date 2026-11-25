import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateMinuteBuckets, windowAggregate, type MinuteEvent } from '../src/lib/sellfox/minute-metric-bucket';

const ev = (o: Partial<MinuteEvent>): MinuteEvent => ({
  ts: '2026-11-24T10:00:00Z', dimensionKey: 'S1|SP|ad|A1', currency: 'USD',
  impressions: 100, clicks: 5, cost: '2.000000', sales: '10.000000', orders: 1, ...o,
});

test('同分钟同维度事件合并', () => {
  const r = aggregateMinuteBuckets([
    ev({ cost: '2.000000', sales: '10.000000', clicks: 3 }),
    ev({ cost: '1.000000', sales: '5.000000', clicks: 2 }),
  ]);
  assert.equal(r.bucketCount, 1);
  assert.equal(r.buckets[0].costMicros, 3_000_000n);
  assert.equal(r.buckets[0].salesMicros, 15_000_000n);
  assert.equal(r.buckets[0].clicks, 5);
  assert.equal(r.buckets[0].eventCount, 2);
});

test('比率先求和后算：CTR/ACOS', () => {
  const r = aggregateMinuteBuckets([ev({ impressions: 100, clicks: 5, cost: '2.000000', sales: '10.000000' })]);
  assert.equal(r.buckets[0].ctrBp, 500); // 5/100
  assert.equal(r.buckets[0].acosBp, 2000); // 2/10
});

test('分母为0 → 比率 null，不臆造', () => {
  const r = aggregateMinuteBuckets([ev({ impressions: 0, clicks: 0, sales: '0.000000' })]);
  assert.equal(r.buckets[0].ctrBp, null);
  assert.equal(r.buckets[0].acosBp, null);
});

test('不同分钟/维度/币种分桶', () => {
  const r = aggregateMinuteBuckets([
    ev({ ts: '2026-11-24T10:00:00Z' }),
    ev({ ts: '2026-11-24T10:01:00Z' }),
    ev({ dimensionKey: 'S1|SP|ad|A2' }),
  ]);
  assert.equal(r.bucketCount, 3);
});

test('跨币种不混算（分桶）', () => {
  const r = aggregateMinuteBuckets([ev({ currency: 'USD' }), ev({ currency: 'EUR' })]);
  assert.equal(r.bucketCount, 2);
});

test('窗口聚合：无数据返回 NEEDS_DATA', () => {
  const r = windowAggregate([], 15);
  assert.equal(r.status, 'NEEDS_DATA');
});

test('窗口聚合：按最新桶回溯 N 分钟', () => {
  const r = aggregateMinuteBuckets([
    ev({ ts: '2026-11-24T10:00:00Z', cost: '1.000000' }),
    ev({ ts: '2026-11-24T10:10:00Z', cost: '1.000000' }),
  ]);
  const w = windowAggregate(r.buckets, 5);
  assert.equal(w.status, 'READY');
  assert.equal((w as any).buckets.length, 1); // 只含 10:10 桶
});

test('无效时间戳被拒绝', () => {
  assert.throws(() => aggregateMinuteBuckets([ev({ ts: 'not-a-time' })]), /时间戳/);
});
