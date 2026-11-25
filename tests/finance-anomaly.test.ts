import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFinanceAnomalies } from '../src/lib/finance/finance-anomaly';

const thresholds = { costDeviationBp: 3000, minSamples: 3 };

test('费用漏算（expected 且缺金额/依据）→ HIGH 告警', () => {
  const r = detectFinanceAnomalies({ thresholds, costs: [], fees: [
    { scope: 'sku1', period: '2026-11', category: 'ADS', amount: null, expected: true, evidenceId: null },
  ], reconciliationGaps: [] });
  assert.equal(r.status, 'ANALYZED');
  assert.equal(r.anomalies.filter(a => a.code === 'FEE_MISSING').length, 1);
  assert.equal(r.anomalies[0].severity, 'HIGH');
});

test('非 expected 的缺费用不告警', () => {
  const r = detectFinanceAnomalies({ thresholds, costs: [], fees: [
    { scope: 'sku1', period: '2026-11', category: 'MISC', amount: null, expected: false, evidenceId: null },
  ], reconciliationGaps: [] });
  assert.equal(r.anomalies.length, 0);
});

test('成本偏离中位数超阈值 → 告警；不超 → 无', () => {
  const costs = [
    { sku: 'A', period: 'p1', unitCost: '10.000000', currency: 'CNY', evidenceId: 'e1' },
    { sku: 'A', period: 'p2', unitCost: '10.100000', currency: 'CNY', evidenceId: 'e2' },
    { sku: 'A', period: 'p3', unitCost: '20.000000', currency: 'CNY', evidenceId: 'e3' }, // +100%
  ];
  const r = detectFinanceAnomalies({ thresholds, costs, fees: [], reconciliationGaps: [] });
  const outliers = r.anomalies.filter(a => a.code === 'COST_OUTLIER');
  assert.equal(outliers.length, 1);
  assert.match(outliers[0].scope, /A\|CNY/);
});

test('样本不足 → NEEDS_DATA，不臆断异常', () => {
  const r = detectFinanceAnomalies({ thresholds, costs: [
    { sku: 'B', period: 'p1', unitCost: '10.000000', currency: 'CNY', evidenceId: 'e1' },
  ], fees: [], reconciliationGaps: [] });
  assert.equal(r.status, 'NEEDS_DATA');
  assert.deepEqual(r.needsData, ['cost:B|CNY:样本不足']);
});

test('对账差异显式列出，且从不自动修正', () => {
  const r = detectFinanceAnomalies({ thresholds, costs: [], fees: [], reconciliationGaps: [
    { key: 'supplier-x', amount: '5.000000', currency: 'CNY', evidenceId: 'ev' },
  ] });
  assert.equal(r.anomalies.filter(a => a.code === 'RECON_GAP').length, 1);
  assert.equal(r.autoCorrected, 0);
});

test('无效阈值被拒绝', () => {
  assert.throws(() => detectFinanceAnomalies({ thresholds: { costDeviationBp: 20000, minSamples: 3 }, costs: [], fees: [], reconciliationGaps: [] }), /阈值/);
});
