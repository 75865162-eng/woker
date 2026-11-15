import assert from 'node:assert/strict';
import test from 'node:test';
import { invoicePostingPlan, INVOICE_COST_ACCOUNT, INVOICE_INPUT_VAT_ACCOUNT, INVOICE_PAYABLE_ACCOUNT } from '../src/lib/procurement/invoice-posting-rules';

const plan = (input: { net: string; tax: string; total: string; bookedCost: string; priorInvoicedNet?: string; fullCoverage?: boolean }) =>
  invoicePostingPlan({ priorInvoicedNet: '0', fullCoverage: true, ...input });

test('收货未入账时，发票首次确认存货成本、进项税与应付', () => {
  const result = plan({ net: '1000', tax: '130', total: '1130', bookedCost: '0' });
  assert.deepEqual(result.lines, [
    { account: INVOICE_COST_ACCOUNT, debit: '1000.000000', credit: '0.000000' },
    { account: INVOICE_INPUT_VAT_ACCOUNT, debit: '130.000000', credit: '0.000000' },
    { account: INVOICE_PAYABLE_ACCOUNT, debit: '0.000000', credit: '1130.000000' },
  ]);
  assert.equal(result.costDelta, '1000.000000');
  assert.equal(result.payableDelta, '1130.000000');
});

test('收货已按同额暂估时只补进项税，不重复确认应付', () => {
  const result = plan({ net: '1000', tax: '130', total: '1130', bookedCost: '1000' });
  assert.equal(result.costDelta, '0.000000');
  assert.equal(result.payableDelta, '130.000000');
  assert.deepEqual(result.lines.map(line => line.account), [INVOICE_INPUT_VAT_ACCOUNT, INVOICE_PAYABLE_ACCOUNT]);
});

test('收尾发票按票面替换暂估：多暂估部分冲回成本与应付', () => {
  const result = plan({ net: '800', tax: '104', total: '904', bookedCost: '1000' });
  assert.equal(result.accruedRemaining, '1000.000000');
  assert.equal(result.costDelta, '-200.000000');
  assert.equal(result.payableDelta, '-96.000000');
});

test('发票高于暂估时差额补记成本并相应增加应付', () => {
  const result = plan({ net: '1000', tax: '130', total: '1130', bookedCost: '900' });
  assert.equal(result.costDelta, '100.000000');
  assert.equal(result.payableDelta, '230.000000');
  assert.equal(result.accruedRemaining, '900.000000');
});

test('部分开票：首张吃掉暂估额度，第二张不再重复冲抵成本', () => {
  const first = plan({ net: '600', tax: '78', total: '678', bookedCost: '1000', fullCoverage: false });
  assert.equal(first.costDelta, '0.000000');
  assert.equal(first.payableDelta, '78.000000');
  const second = plan({ net: '400', tax: '52', total: '452', bookedCost: '1000', priorInvoicedNet: '600', fullCoverage: false });
  assert.equal(second.costDelta, '0.000000');
  assert.equal(second.payableDelta, '52.000000');
  assert.equal(second.accruedRemaining, '400.000000');
});

test('暂估额度用尽后，剩余开票额全部补记成本', () => {
  const result = plan({ net: '300', tax: '39', total: '339', bookedCost: '1000', priorInvoicedNet: '900', fullCoverage: false });
  assert.equal(result.accruedRemaining, '100.000000');
  assert.equal(result.costDelta, '200.000000');
  assert.equal(result.payableDelta, '239.000000');
});

test('未开完票时不提前冲回暂估', () => {
  const result = plan({ net: '800', tax: '104', total: '904', bookedCost: '1000', fullCoverage: false });
  assert.equal(result.costDelta, '0.000000');
  assert.equal(result.payableDelta, '104.000000');
});

test('价税不符、负数金额与空分录都被拦截', () => {
  assert.throws(() => plan({ net: '100', tax: '13', total: '120', bookedCost: '0' }), /价税合计/);
  assert.throws(() => plan({ net: '-100', tax: '0', total: '-100', bookedCost: '0' }), /不能为负/);
  const empty = plan({ net: '0', tax: '0', total: '0', bookedCost: '0' });
  assert.equal(empty.lines.length, 0);
});

test('每张发票草稿借贷恒等', () => {
  for (const input of [
    { net: '1000', tax: '130', total: '1130', bookedCost: '0' },
    { net: '1000', tax: '130', total: '1130', bookedCost: '1000' },
    { net: '800', tax: '104', total: '904', bookedCost: '1000' },
    { net: '300', tax: '39', total: '339', bookedCost: '1000', priorInvoicedNet: '900', fullCoverage: false },
  ]) {
    const result = plan(input);
    const debit = result.lines.reduce((sum, line) => sum + Number(line.debit), 0);
    const credit = result.lines.reduce((sum, line) => sum + Number(line.credit), 0);
    assert.equal(debit.toFixed(6), credit.toFixed(6));
  }
});
