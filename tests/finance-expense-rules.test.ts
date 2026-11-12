import assert from 'node:assert/strict';
import test from 'node:test';
import { nextExpenseState, validateExpenseDraft } from '../src/lib/finance/expense-rules';

const draft = {
  number: 'EXP-2026-001', category: '样品运费', payee: 'Forwarder Ltd', description: '寄送样品',
  expenseDate: '2026-11-12', amount: '9007199254740993.000001', currency: 'USD',
  debitSubjectId: 'freight', creditSubjectId: 'payable',
};

test('expense input keeps exact decimal text and requires explicit same-currency accounts', () => {
  assert.equal(validateExpenseDraft(draft).amount, '9007199254740993.000001');
  for (const amount of ['0', '0.000000', '-1', '1e3', '0.0000001', 1]) {
    assert.throws(() => validateExpenseDraft({ ...draft, amount: amount as string }));
  }
  assert.throws(() => validateExpenseDraft({ ...draft, expenseDate: '2026-02-30' }));
  assert.throws(() => validateExpenseDraft({ ...draft, currency: 'usd' }));
  assert.throws(() => validateExpenseDraft({ ...draft, debitSubjectId: 'payable' }));
});

test('expense approvals require the ordered draft, submission, and independent decision states', () => {
  assert.equal(nextExpenseState('DRAFT', 'SUBMIT'), 'SUBMITTED');
  assert.equal(nextExpenseState('SUBMITTED', 'APPROVE'), 'APPROVED');
  assert.equal(nextExpenseState('SUBMITTED', 'REJECT'), 'REJECTED');
  for (const [state, action] of [['DRAFT', 'APPROVE'], ['APPROVED', 'REJECT'], ['REJECTED', 'SUBMIT']] as const) {
    assert.throws(() => nextExpenseState(state, action));
  }
});
