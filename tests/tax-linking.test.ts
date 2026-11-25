import test from 'node:test';
import assert from 'node:assert/strict';
import { linkTaxToLedger } from '../src/lib/finance/tax-linking';

const base = {
  period: '2026-11', currency: 'CNY',
  entities: [{ entityId: 'CN', weight: '0.700000' }, { entityId: 'US', weight: '0.300000' }],
  profitAmount: '100.000000',
};

test('勾稽一致 + 权重合计=1 → RECONCILED', () => {
  const r = linkTaxToLedger({ ...base,
    traces: [{ feeType: 'VAT', currency: 'CNY', amount: '13.000000', voucherLineId: 'vl1', evidenceId: 'ev1', deductionEligible: true }],
    ledgerLines: [{ subjectCode: 'TAX_VAT', currency: 'CNY', amount: '13.000000', voucherId: 'v1', period: '2026-11' }],
  });
  assert.equal(r.status, 'RECONCILED');
  assert.equal(r.difference, '0.000000');
  assert.equal(r.profitShares[0].amount, '70.000000');
  assert.equal(r.profitShares[1].amount, '30.000000');
});

test('可抵扣但缺依据 → NEEDS_DATA，不臆造抵扣', () => {
  const r = linkTaxToLedger({ ...base,
    traces: [{ feeType: 'VAT', currency: 'CNY', amount: '13.000000', voucherLineId: null, evidenceId: 'ev1', deductionEligible: true }],
    ledgerLines: [],
  });
  assert.equal(r.status, 'NEEDS_DATA');
  assert.deepEqual(r.blockedDeductions, ['VAT']);
});

test('勾稽差额显式列出', () => {
  const r = linkTaxToLedger({ ...base,
    traces: [{ feeType: 'VAT', currency: 'CNY', amount: '13.000000', voucherLineId: 'vl1', evidenceId: 'ev1', deductionEligible: true }],
    ledgerLines: [{ subjectCode: 'TAX_VAT', currency: 'CNY', amount: '12.000000', voucherId: 'v1', period: '2026-11' }],
  });
  assert.equal(r.status, 'NEEDS_DATA');
  assert.equal(r.difference, '1.000000');
});

test('跨币种记录被排除并标记', () => {
  const r = linkTaxToLedger({ ...base,
    traces: [{ feeType: 'USD_FEE', currency: 'USD', amount: '1.000000', voucherLineId: 'x', evidenceId: 'y', deductionEligible: true }],
    ledgerLines: [],
  });
  assert.deepEqual(r.crossCurrencyExcluded, ['trace:USD_FEE']);
});

test('主体权重合计≠1 被拒绝', () => {
  assert.throws(() => linkTaxToLedger({ ...base,
    entities: [{ entityId: 'CN', weight: '0.5' }], traces: [], ledgerLines: [],
  }), /权重合计/);
});

test('利润划分尾差归最后一主体，合计精确', () => {
  const r = linkTaxToLedger({ ...base,
    entities: [{ entityId: 'A', weight: '0.333333' }, { entityId: 'B', weight: '0.333333' }, { entityId: 'C', weight: '0.333334' }],
    profitAmount: '1.000000', traces: [], ledgerLines: [
      { subjectCode: 'X', currency: 'CNY', amount: '0', voucherId: 'v', period: '2026-11' },
    ],
    // 让勾稽一致不影响 shares
  });
  const sum = r.profitShares.reduce((s, x) => s + Number(x.amount), 0);
  assert.equal(sum.toFixed(6), '1.000000');
});
