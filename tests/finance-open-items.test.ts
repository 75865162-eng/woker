import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amountUnits, unitsAmount, itemAmount, planSettlement, validFinanceDate } from '../src/lib/finance/open-item-rules';
const scope = { organizationId: 'org', workspaceId: 'w', bookId: 'b', subjectId: 'ap', counterparty: 'supplier:1', currency: 'USD', status: 'OPEN', allocated: '0.000000' };
const document = { ...scope, id: 'd', kind: 'PAYABLE', amount: '100.000001' };
const payment = { ...scope, id: 'p', kind: 'PAYMENT', amount: '80.000001' };
test('posted subject net is the sole amount source for all four item directions', () => {
  assert.equal(itemAmount('PAYABLE', [{ debit: '1', credit: '101.000001' }]), '100.000001');
  assert.equal(itemAmount('PAYMENT', [{ debit: '80.000001', credit: '0' }]), '80.000001');
  assert.equal(itemAmount('RECEIVABLE', [{ debit: '80.000001', credit: '0' }]), '80.000001');
  assert.equal(itemAmount('RECEIPT', [{ debit: '0', credit: '80.000001' }]), '80.000001');
  assert.throws(() => itemAmount('PAYABLE', [{ debit: '1', credit: '0' }]));
});
test('partial settlement conserves six decimal precision and rejects over-allocation', () => {
  assert.deepEqual(planSettlement(document, payment, '30.000001'), { amount: '30.000001', documentRemaining: '70.000000', paymentRemaining: '50.000000' });
  assert.throws(() => planSettlement({ ...document, allocated: '99' }, payment, '2'));
  assert.throws(() => planSettlement(document, { ...payment, allocated: '80' }, '0.000002'));
  assert.throws(() => planSettlement(document, payment, '0'));
  assert.equal(unitsAmount(amountUnits('999999999999999999999999.123456')), '999999999999999999999999.123456');
});
test('cross scope, party, account, currency and wrong item pairs cannot match', () => {
  for (const key of ['organizationId','workspaceId','bookId','subjectId','counterparty','currency']) assert.throws(() => planSettlement(document, { ...payment, [key]: 'other' }, '1'));
  assert.throws(() => planSettlement(document, { ...payment, kind: 'RECEIPT' }, '1'));
  assert.throws(() => planSettlement(document, { ...payment, status: 'VOIDED' }, '1'));
  assert.throws(() => planSettlement(document, { ...payment, id: document.id }, '1'));
});
test('malformed dates and monetary values are rejected', () => {
  for (const raw of ['-1','1e3','1.0000001','NaN','01',' 1']) assert.throws(() => amountUnits(raw));
  for (const raw of ['2026-02-30','2026-13-01','2026-1-01','2026-01-01T00:00:00Z']) assert.throws(() => validFinanceDate(raw));
});
