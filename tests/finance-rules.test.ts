import assert from 'node:assert/strict';
import test from 'node:test';
import { type AccountingPeriod, type AccountingSubject, type Voucher, costAdjustmentDraft, planRegisteredLedgerClose, planPeriodClose, planPeriodReopen, planVoucherPosting, reconcileCosts, reversalDraft, reviewVoucher, rollForwardBalance, trialBalance, validateVoucher } from '../src/lib/finance/rules';
import { allocateLocalCost } from '../src/lib/fba-local/cost-allocation';

const scope = { organizationId: 'org', workspaceId: 'workspace', bookId: 'book', currency: 'USD' };
const period: AccountingPeriod = { ...scope, id: '2026-11', start: '2026-11-01', end: '2026-11-30', status: 'OPEN' };
const subjects: AccountingSubject[] = [
  { ...scope, id: 'inventory', enabled: true, leaf: true, normalSide: 'DEBIT' },
  { ...scope, id: 'payable', enabled: true, leaf: true, normalSide: 'CREDIT' },
];
const voucher: Voucher = { ...scope, id: 'v1', sourceKey: 'freight:bill1', periodId: period.id, date: '2026-11-12', status: 'DRAFT', kind: 'STANDARD', reversalOf: null,
  lines: [{ accountId: 'inventory', debit: '9007199254740993.000001', credit: '0' }, { accountId: 'payable', debit: '0', credit: '9007199254740993.000001' }] };
const posted = () => planVoucherPosting(reviewVoucher(voucher, period, subjects), period, subjects, []);

test('source-derived audit then posting keeps exact large decimal amounts and leaves draft untouched', () => {
  assert.deepEqual(posted().totals, { debit: '9007199254740993.000001', credit: '9007199254740993.000001' });
  assert.equal(voucher.status, 'DRAFT');
  assert.throws(() => planVoucherPosting(voucher, period, subjects, []));
  assert.throws(() => planVoucherPosting(reviewVoucher(voucher, period, subjects), period, subjects, [voucher.sourceKey]));
});

test('closed period, foreign book, disabled or parent account cannot pass review', () => {
  assert.throws(() => reviewVoucher(voucher, { ...period, status: 'CLOSED' }, subjects));
  for (const key of ['organizationId', 'workspaceId', 'bookId', 'currency'] as const) {
    assert.throws(() => validateVoucher({ ...voucher, [key]: key === 'currency' ? 'EUR' : 'foreign' }, period, subjects));
    assert.throws(() => validateVoucher(voucher, period, subjects.map(item => ({ ...item, [key]: key === 'currency' ? 'EUR' : 'foreign' }))));
  }
  for (const patch of [{ enabled: false }, { leaf: false }]) assert.throws(() => reviewVoucher(voucher, period, [{ ...subjects[0], ...patch }, subjects[1]]));
});

test('invalid dates, null/float amounts, empty entries, dual-sided and unbalanced lines fail', () => {
  for (const value of ['2026-11-31', '2026-12-01', '2026-11-12T00:00:00Z']) assert.throws(() => validateVoucher({ ...voucher, date: value }, period, subjects));
  for (const debit of [null, 1, '', '1e3', '0.0000001', '-1', '0']) {
    assert.throws(() => validateVoucher({ ...voucher, lines: [{ accountId: 'inventory', debit, credit: '0' }, voucher.lines[1]] } as Voucher, period, subjects));
  }
  assert.throws(() => validateVoucher({ ...voucher, lines: [] }, period, subjects));
  assert.throws(() => validateVoucher({ ...voucher, lines: [{ accountId: 'inventory', debit: '1', credit: '1' }, voucher.lines[1]] }, period, subjects));
});

test('credit opening crossing through zero follows signed Wimoor detail ledger formula', () => {
  assert.deepEqual(rollForwardBalance({ amount: '100', side: 'CREDIT' }, '120.000001', '0'), { amount: '20.000001', side: 'DEBIT' });
  assert.deepEqual(rollForwardBalance({ amount: '100', side: 'DEBIT' }, '0', '120'), { amount: '20.000000', side: 'CREDIT' });
  assert.deepEqual(rollForwardBalance({ amount: '0', side: 'DEBIT' }, '-15', '-15'), { amount: '0.000000', side: 'DEBIT' });
  assert.throws(() => rollForwardBalance({ amount: '-1', side: 'DEBIT' }, '0', '0'));
});

test('trial balance reconciles openings and posted movements separately and rejects duplicate evidence', () => {
  const opening = [{ ...scope, accountId: 'inventory', amount: '100', side: 'DEBIT' as const }, { ...scope, accountId: 'payable', amount: '100', side: 'CREDIT' as const }];
  const trial = trialBalance(period, subjects, opening, [posted()]);
  assert.equal(trial.balanced, true);
  assert.equal(trial.rows[0].closingSigned, '9007199254741093.000001');
  assert.equal(trial.rows[1].closingSigned, '-9007199254741093.000001');
  assert.equal(trialBalance(period, subjects, opening.slice(0, 1), [posted()]).balanced, false);
  assert.throws(() => trialBalance(period, subjects, [...opening, opening[0]], []));
  assert.throws(() => trialBalance(period, subjects, opening, [posted(), posted()]));
  assert.throws(() => trialBalance(period, subjects, [], [voucher]));
  assert.throws(() => trialBalance(period, subjects, [{ ...opening[0], currency: 'EUR' }], []));
});

test('red reversal is a linked draft, exactly nets original, and cannot repeat or use a closed period', () => {
  const original = posted();
  const input = { id: 'r1', sourceKey: 'reversal:v1', date: '2026-11-13', existingReversalIds: [] };
  const draft = reversalDraft(original, period, period, subjects, input);
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.reversalOf, original.id);
  assert.equal(draft.lines[0].debit, '-9007199254740993.000001');
  const reviewed = reviewVoucher(draft, period, subjects);
  assert.throws(() => planVoucherPosting(reviewed, period, subjects, []));
  const reversal = planVoucherPosting(reviewed, period, subjects, [], { original, period, existingReversalIds: [] });
  assert.equal(trialBalance(period, subjects, [], [original, reversal]).rows.every(row => row.closingSigned === '0.000000'), true);
  assert.throws(() => reversalDraft(original, period, period, subjects, { ...input, existingReversalIds: ['r0'] }));
  assert.throws(() => reversalDraft(original, period, { ...period, status: 'CLOSED' }, subjects, input));
  assert.throws(() => reversalDraft(voucher, period, period, subjects, input));
  assert.throws(() => reversalDraft(original, period, period, subjects, { ...input, date: '2026-11-11' }));
  const tampered = { ...reviewed, lines: reviewed.lines.map(line => ({ ...line, debit: line.debit === '0.000000' ? '0' : '-1', credit: line.credit === '0.000000' ? '0' : '-1' })) };
  assert.throws(() => planVoucherPosting(tampered, period, subjects, [], { original, period, existingReversalIds: [] }));
});

test('close needs balanced scoped trial and no pending documents; reopen blocks later closed periods', () => {
  const evidence = { unpostedVouchers: 0, unreconciledDocuments: 0, missingCostDocuments: 0, trial: trialBalance(period, subjects, [], [posted()]) };
  assert.deepEqual(planPeriodClose(period, evidence), { status: 'CLOSED', changed: true });
  assert.equal(planPeriodClose({ ...period, status: 'CLOSED' }, evidence).changed, false);
  for (const key of ['unpostedVouchers', 'unreconciledDocuments', 'missingCostDocuments'] as const) {
    for (const value of [1, -1, NaN, 0.1]) assert.throws(() => planPeriodClose(period, { ...evidence, [key]: value }));
  }
  assert.throws(() => planPeriodClose(period, { ...evidence, trial: { ...evidence.trial, bookId: 'other' } }));
  assert.throws(() => planPeriodClose(period, { ...evidence, trial: { ...evidence.trial, periodId: 'other' } }));
  assert.throws(() => planPeriodClose(period, { ...evidence, trial: { ...evidence.trial, closingDifference: '0.000001' } }));
  const later: AccountingPeriod = { ...period, id: '2026-12', start: '2026-12-01', end: '2026-12-31' };
  assert.deepEqual(planPeriodReopen({ ...period, status: 'CLOSED' }, [later]), { status: 'OPEN' });
  assert.throws(() => planPeriodReopen({ ...period, status: 'CLOSED' }, [{ ...later, status: 'CLOSED' }]));
});

test('existing FBA allocations reconcile by line id with exact positive and negative cost differences', () => {
  const lines = [{ id: 'a', quantity: 1 }, { id: 'b', quantity: 2 }];
  const input = { reference: 'freight', stage: 'ESTIMATE', amount: '100', currency: 'USD', method: 'QUANTITY', basis: lines.map(line => ({ lineId: line.id })) };
  const estimated = allocateLocalCost(input, lines);
  const actual = allocateLocalCost({ ...input, stage: 'ACTUAL', amount: '99.999999' }, lines);
  const result = reconcileCosts(estimated, { ...actual, lines: [...actual.lines].reverse() });
  assert.equal(result.difference, '-0.000001');
  assert.deepEqual(result.lines.map(line => line.difference), ['0.000000', '-0.000001']);
  assert.equal(reconcileCosts(actual, estimated).difference, '0.000001');
  assert.throws(() => reconcileCosts(estimated, { ...actual, currency: 'EUR' }));
  assert.throws(() => reconcileCosts(estimated, { ...actual, lines: [actual.lines[0], actual.lines[0]] }));
  assert.throws(() => reconcileCosts(estimated, { ...actual, lines: actual.lines.slice(0, 1) }));
});

test('bill differences produce balanced adjustment drafts only with explicit account mapping', () => {
  const estimate = { currency: 'USD', lines: [{ lineId: 'sku1', allocatedAmount: '100' }] };
  const input = { id: 'adjust1', sourceKey: 'freight:bill1:adjustment', date: '2026-11-12', costAccountId: 'inventory', payableAccountId: 'payable', estimate, actual: { ...estimate, lines: [{ lineId: 'sku1', allocatedAmount: '90' }] } };
  const result = costAdjustmentDraft(period, subjects, input);
  assert.equal(result.draft?.status, 'DRAFT');
  assert.deepEqual(result.draft?.lines, [{ accountId: 'inventory', debit: '0.000000', credit: '10.000000' }, { accountId: 'payable', debit: '10.000000', credit: '0.000000' }]);
  assert.deepEqual(validateVoucher(result.draft!, period, subjects), { debit: '10.000000', credit: '10.000000' });
  assert.equal(costAdjustmentDraft(period, subjects, { ...input, actual: estimate }).draft, null);
  assert.equal(costAdjustmentDraft(period, subjects, { ...input, actual: { ...estimate, lines: [{ lineId: 'sku1', allocatedAmount: '110' }] } }).draft?.lines[0].debit, '10.000000');
  assert.throws(() => costAdjustmentDraft(period, subjects, { ...input, costAccountId: 'missing' }));
  assert.throws(() => costAdjustmentDraft(period, subjects, { ...input, actual: { ...estimate, currency: 'EUR' } }));
});

 test('registered ledger close reports limited coverage without inventing external reconciliation counts', () => {
  const evidence = { unpostedVouchers: 0, trial: trialBalance(period, subjects, [], [posted()]) };
  assert.deepEqual(planRegisteredLedgerClose(period, evidence), { status: 'CLOSED', changed: true, coverage: 'REGISTERED_LEDGER_ONLY' });
  assert.throws(() => planRegisteredLedgerClose(period, { ...evidence, unpostedVouchers: 1 }));
  assert.throws(() => planRegisteredLedgerClose(period, { ...evidence, trial: { ...evidence.trial, balanced: false } }));
});
