import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, type PrismaClient } from '@prisma/client';
import { purchaseBridgePlan } from '../src/lib/finance/purchase-open-item-rules';
import { createFinanceOpenItem, settleFinanceOpenItems } from '../src/lib/finance/open-item-service';
import { readPurchasePaymentFinanceSource } from '../src/lib/procurement/finance-source-query';
import { readWmsFinanceSource } from '../src/lib/wms/finance-source-query';
import { sourceFingerprint } from '../src/lib/finance/source-rules';
import type { Tx } from '../src/lib/wms/repository';

const expected = [{ subjectId: 'inventory', debit: '100.000001', credit: '0.000000' }, { subjectId: 'ap', debit: '0.000000', credit: '100.000001' }];
const plan = { kind: 'PAYABLE' as const, supplierId: 'supplier-id', currency: 'CNY', sourceCurrency: 'CNY', subjectId: 'ap', mappedSubject: 'ap', expected, actual: expected };
test('采购桥接沿用来源映射、供应商稳定身份和六位金额，不接受另选库存科目', () => {
  assert.deepEqual(purchaseBridgePlan(plan), { kind: 'PAYABLE', counterparty: 'supplier:supplier-id', amount: '100.000001' });
  assert.throws(() => purchaseBridgePlan({ ...plan, subjectId: 'inventory' }));
  assert.throws(() => purchaseBridgePlan({ ...plan, currency: 'USD' }));
  assert.throws(() => purchaseBridgePlan({ ...plan, actual: [{ ...expected[0], debit: '100' }, expected[1]] }));
  assert.throws(() => purchaseBridgePlan({ ...plan, mappedSubject: undefined }));
  const large = expected.map(row => ({ ...row, debit: row.subjectId === 'inventory' ? '9007199254740993.000001' : '0', credit: row.subjectId === 'ap' ? '9007199254740993.000001' : '0' }));
  assert.equal(purchaseBridgePlan({ ...plan, expected: large, actual: large }).amount, '9007199254740993.000001');
});

test('隔离服务集成：收货及付款桥接→部分核销→幂等重试，拒绝草稿、串租户、撤权和来源篡改', async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  const scope = { organizationId: 'org', workspaceId: 'ws', actorUserId: 'reviewer' };
  const decimal = (s: string) => new Prisma.Decimal(s);
  const paidAt = new Date('2026-11-01');
  const payment = { id: 'p', purchaseOrderId: 'order', createdBy: 'payer', amount: decimal('30.000001'), currency: 'CNY', paidAt, method: 'BANK', reference: 'bank-ref', notes: '', order: { number: 'PO-1', supplierId: 'supplier-id', supplier: { name: '同名供应商' } }, approval: { id: 'approval', organizationId: 'org', workspaceId: 'ws', purchaseOrderId: 'order', amount: decimal('30.000001'), currency: 'CNY', paidAt, method: 'BANK', reference: 'bank-ref', notes: '', status: 'CONSUMED', settledPaymentId: 'p', approvedBy: 'approver', requestedBy: 'payer' } };
  const makeVoucher = (id: string, sourceKey: string, lines: typeof expected) => ({ id, bookId: 'book', revision: 3, sourceKey, createdBy: 'maker', reviewedBy: 'reviewer' as string | null, kind: 'STANDARD', periodId: 'period', book: { currency: 'CNY' }, date: paidAt, lines: lines.map(row => ({ ...row, debit: decimal(row.debit), credit: decimal(row.credit) })) });
  const voucher = makeVoucher('v', 'PURCHASE-PAYMENT:p', [{ subjectId: 'ap', debit: '30.000001', credit: '0' }, { subjectId: 'cash', debit: '0', credit: '30.000001' }]);
  const receiptVoucher = makeVoucher('rv', 'WMS-COMMAND:command', expected);
  const order = { id: 'order', number: 'PO-1', revision: 5, supplierId: 'supplier-id', currency: 'CNY', wmsReceiptIds: ['receipt'], supplier: { organizationId: 'org' } };
  const draft = { id: 'draft', commandId: 'command', status: 'DRAFT', revision: 1, command: { action: 'RECEIVE', aggregateId: 'receipt', createdAt: paidAt }, entries: [{ debitAccount: 'INVENTORY', creditAccount: 'GOODS_RECEIVED', amount: decimal('100.000001'), currency: 'CNY', unitCost: decimal('100.000001'), quantity: 1, movementId: 'move', ruleId: 'rule', movement: { balance: { lotId: 'lot', warehouseId: 'warehouse', lot: { productRecordId: 'product', lotCode: 'batch' } } } }] };
  type FixtureItem = { id: string; revision: number; status: string; voucherId: string; amount: Prisma.Decimal; [key: string]: unknown };
  const items: FixtureItem[] = [];
  let settlement: { amount: Prisma.Decimal; createdBy: string; requestHash: string; [key: string]: unknown } | null = null;
  let permitted = true, receiptStatus = 'RECEIVED', reversed = false, corrupted = false;
  const tx = {
    $queryRaw: async () => [{ role: 'role', permissions: { operations: permitted ? ['view', 'create', 'approve'] : [], wms: ['view'] }, status: 'active' }],
    workspaceScope: { findUnique: async () => ({ id: 'ws' }) },
    financeBook: { findFirst: async () => ({ id: 'book' }) },
    financeVoucher: { findFirst: async ({ where }: { where: { id: string; bookId?: string; organizationId: string; workspaceId: string } }) => where.organizationId === 'org' && where.workspaceId === 'ws' && (!where.bookId || where.bookId === 'book') ? (where.id === 'rv' ? receiptVoucher : voucher) : null, count: async () => reversed ? 1 : 0, findMany: async () => [voucher, receiptVoucher].map(row => ({ ...row, reversals: reversed ? [{ id: 'reversal' }] : [] })) },
    financeSubject: { findFirst: async () => ({ id: 'ap' }) },
    purchaseOrder: { findFirst: async () => order },
    purchasePayment: { findFirst: async () => payment },
    wmsCommand: { findFirst: async () => ({ action: 'RECEIVE' }) },
    wmsFinanceDraft: { findFirst: async () => draft },
    wmsReceipt: { findFirst: async () => ({ status: receiptStatus }) },
    financePeriod: { findFirst: async () => ({ status: 'OPEN', start: new Date('2026-11-01'), end: new Date('2026-11-30') }) },
    auditLog: { findFirst: async ({ where }: { where: { entityId: string } }) => {
      const isReceipt = where.entityId === 'rv';
      const source = isReceipt ? await readWmsFinanceSource(tx as unknown as Tx, scope, 'draft') : await readPurchasePaymentFinanceSource(tx as unknown as Tx, scope, 'p');
      return { metadata: { workspaceId: 'ws', bookId: 'book', sourceKey: isReceipt ? receiptVoucher.sourceKey : voucher.sourceKey, kind: source.kind, sourceId: source.id, fingerprint: corrupted ? 'changed' : sourceFingerprint(source), accountMapping: isReceipt ? [{ sourceAccount: 'INVENTORY', subjectId: 'inventory' }, { sourceAccount: 'GOODS_RECEIVED', subjectId: 'ap' }] : [{ sourceAccount: 'PURCHASE_PAYABLE', subjectId: 'ap' }, { sourceAccount: 'PURCHASE_CASH_BANK', subjectId: 'cash' }] } };
    }, create: async () => ({}) },
    financeOpenItem: { findFirst: async ({ where }: { where: { id?: string; voucherId?: string } }) => items.find(row => where.id ? row.id === where.id : row.voucherId === where.voucherId) ?? null, create: async ({ data }: { data: FixtureItem }) => { const item = { ...data, revision: 1, status: 'OPEN' }; items.push(item); return item; }, updateMany: async () => { items.forEach(row => row.revision++); return { count: 2 }; } },
    financeSettlement: { findFirst: async () => settlement, findMany: async () => settlement ? [settlement] : [], create: async ({ data }: { data: NonNullable<typeof settlement> }) => { settlement = data; return data; } },
  };
  globals.prisma = { $transaction: async (fn: (db: unknown) => unknown) => fn(tx) } as unknown as PrismaClient;
  const body = { action: 'confirm-purchase', bookId: 'book', voucherId: 'v', subjectId: 'ap', purchaseOrderId: 'order', orderRevision: 5, voucherRevision: 3, dueDate: '2026-11-30', evidence: '独立确认来源往来' };
  try {
    const first = await createFinanceOpenItem(scope, body);
    assert.equal(first.reused, false);
    assert.equal(first.item.counterparty, 'supplier:supplier-id');
    assert.equal(first.item.amount, '30.000001');
    assert.equal(first.item.kind, 'PAYMENT');
    assert.equal((await createFinanceOpenItem(scope, body)).reused, true);
    await assert.rejects(createFinanceOpenItem(scope, { ...body, evidence: '改写' }));
    await assert.rejects(createFinanceOpenItem(scope, { ...body, voucherRevision: 2 }));
    await assert.rejects(createFinanceOpenItem(scope, { ...body, orderRevision: 4 }));
    await assert.rejects(createFinanceOpenItem(scope, { ...body, bookId: 'other' }));
    await assert.rejects(createFinanceOpenItem({ ...scope, workspaceId: 'other' }, body));
    await assert.rejects(createFinanceOpenItem({ ...scope, organizationId: 'other' }, body));
    order.supplierId = 'other-supplier';
    await assert.rejects(createFinanceOpenItem(scope, body));
    order.supplierId = 'supplier-id';
    corrupted = true;
    await assert.rejects(createFinanceOpenItem(scope, body));
    corrupted = false;
    payment.approval.amount = decimal('31');
    await assert.rejects(createFinanceOpenItem(scope, body));
    payment.approval.amount = payment.amount;
    payment.approval.approvedBy = 'payer';
    await assert.rejects(createFinanceOpenItem(scope, body));
    payment.approval.approvedBy = 'approver';
    voucher.reviewedBy = 'maker';
    await assert.rejects(createFinanceOpenItem(scope, body));
    voucher.reviewedBy = 'reviewer';
    const receiptBody = { ...body, voucherId: 'rv' };
    receiptStatus = 'DRAFT';
    await assert.rejects(createFinanceOpenItem(scope, receiptBody));
    receiptStatus = 'CANCELLED';
    await assert.rejects(createFinanceOpenItem(scope, receiptBody));
    receiptStatus = 'RECEIVED';
    reversed = true;
    await assert.rejects(createFinanceOpenItem(scope, receiptBody));
    reversed = false;
    const payable = await createFinanceOpenItem(scope, receiptBody);
    assert.equal(payable.item.kind, 'PAYABLE');
    assert.equal(payable.item.amount, '100.000001');
    assert.equal((await createFinanceOpenItem(scope, receiptBody)).reused, true);
    assert.equal(items.length, 2);
    const settle = { action: 'settle', bookId: 'book', documentId: payable.item.id, paymentId: first.item.id, documentRevision: 1, paymentRevision: 1, periodId: 'period', date: '2026-11-02', amount: '30.000001', idempotencyKey: 'settle-one', evidence: '银行流水核销' };
    await assert.rejects(settleFinanceOpenItems(scope, { ...settle, documentRevision: 2 }));
    await assert.rejects(settleFinanceOpenItems(scope, { ...settle, amount: '30.000002' }));
    assert.equal((await settleFinanceOpenItems(scope, settle)).settlement.amount, '30.000001');
    assert.equal((await settleFinanceOpenItems(scope, settle)).reused, true);
    await assert.rejects(settleFinanceOpenItems(scope, { ...settle, amount: '1' }));
    permitted = false;
    await assert.rejects(createFinanceOpenItem(scope, body));
    await assert.rejects(settleFinanceOpenItems(scope, settle));
  } finally { globals.prisma = previous; }
});
