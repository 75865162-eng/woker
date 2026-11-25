import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProfitState, applyProfitEvents, type ProfitEvent } from '../src/lib/finance/live-profit';

const ev = (o: Partial<ProfitEvent>): ProfitEvent => ({
  eventKey: 'e1', kind: 'ORDER', currency: 'CNY', amount: '100.000000',
  occurredAt: '2026-11-24T10:00:00Z', confirmed: true, sourceRunId: 'run-1', ...o,
});

test('增量计算净利润（收入-广告-费用-退款）', () => {
  const s = emptyProfitState();
  const r = applyProfitEvents(s, [
    ev({ eventKey: 'o1', kind: 'ORDER', amount: '100.000000' }),
    ev({ eventKey: 'a1', kind: 'ADS_SPEND', amount: '20.000000' }),
    ev({ eventKey: 'f1', kind: 'FEE', amount: '5.000000' }),
    ev({ eventKey: 'r1', kind: 'REFUND', amount: '3.000000' }),
  ], 'CNY');
  assert.equal(r.profit, '72.000000');
  assert.equal(r.final, true);
});

test('未确认来源进 pendingSources，不展示为最终利润', () => {
  const s = emptyProfitState();
  const r = applyProfitEvents(s, [ev({ confirmed: false, sourceRunId: 'run-x' })], 'CNY');
  assert.equal(r.final, false);
  assert.deepEqual(r.pendingSources, ['run-x']);
  // 来源随后确认 → final
  const r2 = applyProfitEvents(s, [ev({ eventKey: 'e2', confirmed: true, sourceRunId: 'run-x' })], 'CNY');
  assert.equal(r2.final, true);
  assert.deepEqual(r2.pendingSources, []);
});

test('幂等：同 eventKey 不重复计入', () => {
  const s = emptyProfitState();
  applyProfitEvents(s, [ev({ eventKey: 'dup', amount: '10.000000' })], 'CNY');
  const r = applyProfitEvents(s, [ev({ eventKey: 'dup', amount: '10.000000' })], 'CNY');
  assert.equal(r.changed, false);
  assert.equal(r.components.revenue, '10.000000');
});

test('水位单调，不回退', () => {
  const s = emptyProfitState('2026-11-24T12:00:00Z');
  const r = applyProfitEvents(s, [ev({ occurredAt: '2026-11-24T09:00:00Z' })], 'CNY');
  assert.equal(r.watermark, '2026-11-24T12:00:00Z');
});

test('跨币种混算被拒绝', () => {
  const s = emptyProfitState();
  assert.throws(() => applyProfitEvents(s, [ev({ currency: 'USD' })], 'CNY'), /混算/);
});

test('缺项不补零：无事件时利润为 0 但不标 final 依赖 pending', () => {
  const s = emptyProfitState();
  const r = applyProfitEvents(s, [], 'CNY');
  assert.equal(r.changed, false);
  assert.equal(r.profit, '0.000000');
  assert.equal(r.final, true);
});
