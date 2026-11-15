import assert from 'node:assert/strict';
import test from 'node:test';
import { amountText, amountUnits, assertInvoiceSubmittable, invoiceHash, matchInvoice, parseInvoiceDraft } from '../src/lib/procurement/invoice-rules';

const orderLines = [
  { productRecordId: 'p1', expectedQty: 100, unitPrice: '10.000000' },
  { productRecordId: 'p2', expectedQty: 50, unitPrice: '4.250000' },
];

function match(lines: Array<{ productRecordId: string; invoicedQty: number; unitPrice: string; amount?: string; taxAmount?: string }>, overrides: Partial<{ received: Record<string, number>; prior: Record<string, number>; priceToleranceBp: number; qtyToleranceBp: number; amountTolerance: string }> = {}) {
  return matchInvoice({
    orderLines,
    receivedByProduct: new Map(Object.entries(overrides.received ?? { p1: 100, p2: 50 })),
    priorInvoicedByProduct: new Map(Object.entries(overrides.prior ?? {})),
    invoiceLines: lines,
    qtyToleranceBp: overrides.qtyToleranceBp ?? 0,
    priceToleranceBp: overrides.priceToleranceBp ?? 50,
    amountTolerance: overrides.amountTolerance ?? '0',
  });
}

test('三单一致时判为 MATCHED，金额按分位精度累计', () => {
  const result = match([
    { productRecordId: 'p1', invoicedQty: 100, unitPrice: '10.000000' },
    { productRecordId: 'p2', invoicedQty: 50, unitPrice: '4.250000' },
  ]);
  assert.equal(result.matchStatus, 'MATCHED');
  assert.equal(result.exceptionSummary, '');
  assert.equal(result.subtotal, '1212.50');
  assert.equal(result.totalAmount, '1212.50');
  assert.deepEqual(result.lines.map(line => line.exceptionCodes), [[], []]);
  assert.equal(result.lines[0].varianceQty, 0);
});

test('部分开票（数量小于验收量）是允许的，不产生差异', () => {
  const result = match([{ productRecordId: 'p1', invoicedQty: 40, unitPrice: '10.000000' }]);
  assert.equal(result.matchStatus, 'MATCHED');
  assert.equal(result.lines[0].varianceQty, -60);
});

test('开票数量超过已验收数量判为差异', () => {
  const result = match([{ productRecordId: 'p1', invoicedQty: 120, unitPrice: '10.000000' }], { received: { p1: 100 } });
  assert.equal(result.matchStatus, 'EXCEPTION');
  assert.ok(result.lines[0].exceptionCodes.includes('QTY_OVER_RECEIPT'));
  assert.ok(result.lines[0].exceptionCodes.includes('QTY_OVER_ORDER'));
});

test('数量容差按万分之一放大允许上限', () => {
  // 订单 50、实际验收 45、开票 46：超出验收 2.2%，0 容差拒绝，5% 容差放行
  const strict = match([{ productRecordId: 'p2', invoicedQty: 46, unitPrice: '4.250000' }], { received: { p1: 0, p2: 45 } });
  assert.ok(strict.lines[0].exceptionCodes.includes('QTY_OVER_RECEIPT'));
  const loose = match([{ productRecordId: 'p2', invoicedQty: 46, unitPrice: '4.250000' }], { received: { p1: 0, p2: 45 }, qtyToleranceBp: 500 });
  assert.equal(loose.matchStatus, 'MATCHED');
});

test('未收货直接开票单独标记 NO_RECEIPT', () => {
  const result = match([{ productRecordId: 'p1', invoicedQty: 10, unitPrice: '10.000000' }], { received: { p1: 0 } });
  assert.ok(result.lines[0].exceptionCodes.includes('NO_RECEIPT'));
  assert.equal(result.matchStatus, 'EXCEPTION');
});

test('单价差异在容差内放行，超出容差标记 PRICE_VARIANCE', () => {
  const inside = match([{ productRecordId: 'p1', invoicedQty: 100, unitPrice: '10.040000' }]);
  assert.equal(inside.matchStatus, 'MATCHED');
  const outside = match([{ productRecordId: 'p1', invoicedQty: 100, unitPrice: '10.060000' }]);
  assert.ok(outside.lines[0].exceptionCodes.includes('PRICE_VARIANCE'));
});

test('容差为 0 时任何单价差都必须解释', () => {
  const result = match([{ productRecordId: 'p1', invoicedQty: 100, unitPrice: '10.000001' }], { priceToleranceBp: 0 });
  assert.ok(result.lines[0].exceptionCodes.includes('PRICE_VARIANCE'));
});

test('历史发票已占用验收量时，分次开票不能绕过验收', () => {
  const result = match([{ productRecordId: 'p1', invoicedQty: 60, unitPrice: '10.000000' }], { received: { p1: 100 }, prior: { p1: 50 } });
  assert.ok(result.lines[0].exceptionCodes.includes('CUMULATIVE_OVER_RECEIPT'));
});

test('票面金额与数量乘单价不符且超出金额容差时标记 AMOUNT_MISMATCH', () => {
  const result = match([{ productRecordId: 'p1', invoicedQty: 100, unitPrice: '10.000000', amount: '1010.00' }], { amountTolerance: '1' });
  assert.ok(result.lines[0].exceptionCodes.includes('AMOUNT_MISMATCH'));
  const tolerated = match([{ productRecordId: 'p1', invoicedQty: 100, unitPrice: '10.000000', amount: '1000.50' }], { amountTolerance: '1' });
  assert.equal(tolerated.matchStatus, 'MATCHED');
});

test('发票品项不在采购单内直接拒绝，不静默丢弃', () => {
  assert.throws(() => match([{ productRecordId: 'p9', invoicedQty: 1, unitPrice: '1' }]), /采购单以外/);
});

test('差异摘要按差异类型聚合，能直接看出几行哪类问题', () => {
  const result = match([
    { productRecordId: 'p1', invoicedQty: 120, unitPrice: '10.000000' },
    { productRecordId: 'p2', invoicedQty: 50, unitPrice: '4.500000' },
  ], { received: { p1: 100, p2: 50 } });
  assert.match(result.exceptionSummary, /^2 行差异：/);
  assert.match(result.exceptionSummary, /开票数量超已验收数量 1 行/);
  assert.match(result.exceptionSummary, /单价超出容差 1 行/);
});

test('金额定点运算不产生浮点误差', () => {
  assert.equal(amountText(amountUnits('0.1')! + amountUnits('0.2')!), '0.30');
  assert.equal(amountUnits('1.1234567'), null);
  assert.equal(amountUnits('-1'), null);
});

const validBody = {
  number: 'PI-2026-11-001',
  supplierInvoiceNo: 'INV-9001',
  purchaseOrderId: 'po-1',
  invoiceDate: '2026-11-10',
  dueDate: '2026-12-10',
  lines: [{ productRecordId: 'p1', invoicedQty: 10, unitPrice: '12.5' }],
};

test('草稿解析给出默认容差口径并归一化日期', () => {
  const draft = parseInvoiceDraft(validBody);
  assert.equal(draft.priceToleranceBp, 50);
  assert.equal(draft.qtyToleranceBp, 0);
  assert.equal(draft.amountTolerance, '0');
  assert.equal(draft.invoiceDate.toISOString().slice(0, 10), '2026-11-10');
  assert.equal(draft.dueDate?.toISOString().slice(0, 10), '2026-12-10');
});

test('草稿解析拒绝重复商品、非法日期与越界容差', () => {
  assert.throws(() => parseInvoiceDraft({ ...validBody, lines: [...validBody.lines, ...validBody.lines] }), /重复/);
  assert.throws(() => parseInvoiceDraft({ ...validBody, invoiceDate: '2026-02-30' }), /有效日期/);
  assert.throws(() => parseInvoiceDraft({ ...validBody, priceToleranceBp: 10001 }), /单价容差/);
  assert.throws(() => parseInvoiceDraft({ ...validBody, lines: [{ productRecordId: 'p1', invoicedQty: 0, unitPrice: '1' }] }), /开票数量/);
  assert.throws(() => parseInvoiceDraft({ ...validBody, dueDate: '2026-11-01' }), /不能早于/);
});

test('审批指纹对行顺序不敏感，但任何金额变化都会变', () => {
  const base = {
    number: 'PI-1', supplierInvoiceNo: 'A-1', purchaseOrderId: 'po-1',
    invoiceDate: new Date('2026-11-10T00:00:00.000Z'), dueDate: null, currency: 'CNY',
    qtyToleranceBp: 0, priceToleranceBp: 50, amountTolerance: '0', overrideReason: '', notes: '',
    lines: [
      { productRecordId: 'p1', invoicedQty: 1, unitPrice: '10.000000', taxAmount: '0', notes: '' },
      { productRecordId: 'p2', invoicedQty: 2, unitPrice: '5.000000', taxAmount: '0', notes: '' },
    ],
  };
  const reversed = { ...base, lines: [...base.lines].reverse() };
  assert.equal(invoiceHash(base), invoiceHash(reversed));
  const changed = { ...base, lines: [base.lines[0], { ...base.lines[1], unitPrice: '5.010000' }] };
  assert.notEqual(invoiceHash(base), invoiceHash(changed));
});

test('差异发票必须有放行理由才能提交审批', () => {
  assert.throws(() => assertInvoiceSubmittable({ status: 'DRAFT', matchStatus: 'EXCEPTION', overrideReason: '  ' }), /放行理由/);
  assert.doesNotThrow(() => assertInvoiceSubmittable({ status: 'DRAFT', matchStatus: 'EXCEPTION', overrideReason: '供应商确认按实际到货数量结算' }));
  assert.doesNotThrow(() => assertInvoiceSubmittable({ status: 'DRAFT', matchStatus: 'MATCHED', overrideReason: '' }));
  assert.throws(() => assertInvoiceSubmittable({ status: 'DRAFT', matchStatus: 'PENDING', overrideReason: '' }), /三单匹配/);
  assert.throws(() => assertInvoiceSubmittable({ status: 'APPROVED', matchStatus: 'MATCHED', overrideReason: '' }), /仅草稿/);
});
