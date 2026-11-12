import assert from 'node:assert/strict';
import test from 'node:test';
import { mapSourceLines, parseSourceIdentity, sourceFingerprint, validateSourceDate, type FinanceSource } from '../src/lib/finance/source-rules';
import { sumLedgerAmounts } from '../src/lib/finance/amount-view';
const source: FinanceSource = { kind: 'FBA_ADJUSTMENT', id: 'draft', sourceKey: 'FBA-ADJUSTMENT:bill', currency: 'USD', sourceDate: '2026-11-12', evidence: { reviewedBy: 'reviewer' }, lines: [{ account: 'cost', debit: '9007199254740993.000001', credit: '0.000000' }, { account: 'payable', debit: '0.000000', credit: '9007199254740993.000001' }] };
const mapping = [{ sourceAccount: 'cost', subjectId: 'formal-cost' }, { sourceAccount: 'payable', subjectId: 'formal-payable' }];
test('source handoff maps only formal subjects and preserves exact immutable money', () => {
  assert.deepEqual(mapSourceLines(source, 'USD', mapping), [{ subjectId: 'formal-cost', debit: source.lines[0].debit, credit: '0.000000' }, { subjectId: 'formal-payable', debit: '0.000000', credit: source.lines[1].credit }]);
  assert.equal(mapSourceLines(source, 'USD', [...mapping].reverse())[0].subjectId, 'formal-cost');
  assert.equal(sourceFingerprint(source), sourceFingerprint(structuredClone(source)));
  assert.notEqual(sourceFingerprint(source), sourceFingerprint({ ...source, evidence: { reviewedBy: 'other' } }));
});
test('confirmed purchase-payment source identity and payable-to-cash mapping preserve currency and precision', () => {
  const payment: FinanceSource = {
    kind: 'PURCHASE_PAYMENT', id: 'payment-1', sourceKey: 'PURCHASE-PAYMENT:payment-1', currency: 'USD', sourceDate: '2026-11-12',
    evidence: { approvalId: 'approval-1', method: 'BANK_TRANSFER' },
    lines: [
      { account: 'PURCHASE_PAYABLE', debit: '12345.670001', credit: '0.000000' },
      { account: 'PURCHASE_CASH_BANK_TRANSFER', debit: '0.000000', credit: '12345.670001' },
    ],
  };
  assert.deepEqual(parseSourceIdentity('PURCHASE_PAYMENT', 'payment-1'), { kind: 'PURCHASE_PAYMENT', id: 'payment-1' });
  assert.deepEqual(mapSourceLines(payment, 'USD', [
    { sourceAccount: 'PURCHASE_PAYABLE', subjectId: 'ap' },
    { sourceAccount: 'PURCHASE_CASH_BANK_TRANSFER', subjectId: 'bank' },
  ]), [
    { subjectId: 'ap', debit: '12345.670001', credit: '0.000000' },
    { subjectId: 'bank', debit: '0.000000', credit: '12345.670001' },
  ]);
  assert.throws(() => mapSourceLines(payment, 'CNY', [
    { sourceAccount: 'PURCHASE_PAYABLE', subjectId: 'ap' },
    { sourceAccount: 'PURCHASE_CASH_BANK_TRANSFER', subjectId: 'bank' },
  ]));
});
test('confirmed purchase-refund source identity and cash-to-payable mapping preserve exact amount', () => {
  const refund: FinanceSource = {
    kind: 'PURCHASE_REFUND', id: 'refund-1', sourceKey: 'PURCHASE-REFUND:refund-1', currency: 'EUR', sourceDate: '2026-11-11',
    evidence: { approvalId: 'refund-approval-1', originalPaymentId: 'payment-1', method: 'BANK_TRANSFER' },
    lines: [
      { account: 'PURCHASE_CASH_BANK_TRANSFER', debit: '320.125001', credit: '0.000000' },
      { account: 'PURCHASE_PAYABLE', debit: '0.000000', credit: '320.125001' },
    ],
  };
  assert.deepEqual(parseSourceIdentity('PURCHASE_REFUND', 'refund-1'), { kind: 'PURCHASE_REFUND', id: 'refund-1' });
  assert.deepEqual(mapSourceLines(refund, 'EUR', [
    { sourceAccount: 'PURCHASE_CASH_BANK_TRANSFER', subjectId: 'bank' },
    { sourceAccount: 'PURCHASE_PAYABLE', subjectId: 'ap' },
  ]), [
    { subjectId: 'bank', debit: '320.125001', credit: '0.000000' },
    { subjectId: 'ap', debit: '0.000000', credit: '320.125001' },
  ]);
  validateSourceDate(refund, refund.sourceDate);
  assert.throws(() => validateSourceDate(refund, '2026-11-12'));
});
test('currency mismatch, unknown/missing/duplicate or merged account mapping fails', () => {
  assert.throws(() => mapSourceLines(source, 'CNY', mapping));
  for (const value of [null, [], mapping.slice(0, 1), [...mapping, mapping[0]], [...mapping, { sourceAccount: 'extra', subjectId: 'extra' }], mapping.map(row => ({ ...row, subjectId: 'same' })), [{ ...mapping[0], amount: '1' }, mapping[1]]]) assert.throws(() => mapSourceLines(source, 'USD', value));
  assert.throws(() => parseSourceIdentity('ORDER', 'id'));
});
test('ledger display preserves large values, micro-unit tails, red entries and empty totals', () => {
  assert.equal(sumLedgerAmounts(['9007199254740993.000001', '0.000001']), '9007199254740993.000002');
  assert.equal(sumLedgerAmounts(['9007199254740993.000001', '-9007199254740993.000001']), '0.000000');
  assert.equal(sumLedgerAmounts(['-1', '0.999999']), '-0.000001');
  assert.equal(sumLedgerAmounts([]), '0.000000');
  for (const value of ['1e6', 'NaN', '0.0000001']) assert.throws(() => sumLedgerAmounts([value]));
});
