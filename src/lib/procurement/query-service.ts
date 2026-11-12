import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { scoped } from '@/lib/wms/access';
import type { WmsScope } from '@/lib/wms/contracts';
import { WmsInputError } from '@/lib/wms/rules';
import { purchaseReceiptAllocations } from './receipt-service';
import { parsePurchasePriceHistoryQuery } from './price-history';

const statuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'RECEIVING', 'CANCELLED'];
export function parsePurchaseQuery(params: URLSearchParams) {
  const search = (params.get('search') ?? '').trim();
  const status = params.get('status') ?? '';
  const supplierId = params.get('supplierId') ?? '';
  const receiptId = params.get('receiptId') ?? '';
  const rawPage = params.get('page') ?? '1';
  if (receiptId.length > 120 || search.length > 120 || supplierId.length > 120 || (status && !statuses.includes(status)) || !/^[1-9][0-9]{0,5}$/.test(rawPage)) throw new WmsInputError('采购筛选或页码无效。');
  return { search, status, supplierId, receiptId, page: Number(rawPage), pageSize: 20 };
}

/** API callers use operations.view; warehouse-derived fields retain their own live permission gate. */
export async function queryPurchaseOrders(scope: WmsScope, query: ReturnType<typeof parsePurchaseQuery>) {
  const where: Prisma.PurchaseOrderWhereInput = {
    ...scoped(scope), ...(query.receiptId ? { wmsReceiptIds: { has: query.receiptId } } : {}), ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.search ? { OR: [
      { number: { contains: query.search, mode: 'insensitive' } },
      { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
      { lines: { some: { product: { sku: { contains: query.search, mode: 'insensitive' } } } } },
    ] } : {}),
  };
  const result = await prisma.$transaction(async tx => {
    const counts = await tx.purchaseOrder.groupBy({ by: ['status'], where, _count: { _all: true } });
    const statusCounts = Object.fromEntries(counts.map(item => [item.status, item._count._all]));
    const total = query.status ? statusCounts[query.status] ?? 0 : counts.reduce((sum, item) => sum + item._count._all, 0);
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const orders = await tx.purchaseOrder.findMany({
      where: { ...where, ...(query.status ? { status: query.status } : {}) },
      include: { supplier: { select: { id: true, name: true } }, lines: { include: { product: { select: { sku: true, chineseName: true, englishName: true } } } }, approvals: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 }, payments: { orderBy: [{ paidAt: 'asc' }, { id: 'asc' }], include: { refunds: { orderBy: [{ refundedAt: 'asc' }, { id: 'asc' }] }, refundApprovals: { where: { status: { in: ['PENDING', 'APPROVED'] }, expiresAt: { gt: new Date() } }, select: { amount: true } } } }, paymentApprovals: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 }, paymentRefundApprovals: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * query.pageSize, take: query.pageSize,
    });
    return { orders, pagination: { page, pageSize: query.pageSize, total }, statusCounts };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  const allocations = await purchaseReceiptAllocations(scope, result.orders);
  return { ...result, orders: result.orders.map(order => { const { approvals, payments, paymentApprovals, paymentRefundApprovals, ...record } = order; const totalAmount = order.lines.reduce((sum, line) => sum.add(line.unitPrice.mul(line.expectedQty)), new Prisma.Decimal(0)); const grossPaidAmount = payments.reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0)); const refunds = payments.flatMap(payment => payment.refunds); const refundedAmount = refunds.reduce((sum, refund) => sum.add(refund.amount), new Prisma.Decimal(0)); const paidAmount = grossPaidAmount.sub(refundedAmount); return { ...record, approval: approvals[0] ?? null, paymentSummary: { totalAmount: totalAmount.toString(), grossPaidAmount: grossPaidAmount.toString(), refundedAmount: refundedAmount.toString(), paidAmount: paidAmount.toString(), outstandingAmount: Prisma.Decimal.max(totalAmount.sub(paidAmount), 0).toString(), payments: payments.map(({ refunds: paymentRefunds, refundApprovals: activeRefundApprovals, ...payment }) => ({ ...payment, amount: payment.amount.toString(), refunds: paymentRefunds.map(refund => ({ ...refund, amount: refund.amount.toString() })), activeRefundReservations: activeRefundApprovals.map(approval => approval.amount.toString()) })), approvals: paymentApprovals.map(approval => ({ ...approval, kind: 'PAYMENT' as const, amount: approval.amount.toString() })), refundApprovals: paymentRefundApprovals.map(approval => ({ ...approval, paidAt: approval.refundedAt, kind: 'PAYMENT_REFUND' as const, amount: approval.amount.toString() })) }, ...allocations.get(order.id), lines: order.lines.map(line => ({ ...line, unitPrice: line.unitPrice.toString() })) }; }) };
}

export function parseSupplierQuery(params: URLSearchParams) {
  const search = (params.get('search') ?? '').trim();
  const rawPage = params.get('page') ?? '1';
  if (search.length > 120 || !/^[1-9][0-9]{0,5}$/.test(rawPage)) throw new WmsInputError('供应商筛选或页码无效。');
  return { search, page: Number(rawPage), pageSize: 20 };
}

/** Suppliers belong to the organization; callers retain the operations.view gate. */
export async function querySuppliers(organizationId: string, query: ReturnType<typeof parseSupplierQuery>) {
  const where: Prisma.SupplierWhereInput = { organizationId, ...(query.search ? { OR: [
    { name: { contains: query.search, mode: 'insensitive' } },
    { contactName: { contains: query.search, mode: 'insensitive' } },
    { phone: { contains: query.search, mode: 'insensitive' } },
    { email: { contains: query.search, mode: 'insensitive' } },
  ] } : {}) };
  return prisma.$transaction(async tx => {
    const total = await tx.supplier.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const suppliers = await tx.supplier.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page - 1) * query.pageSize, take: query.pageSize });
    return { suppliers, pagination: { page, pageSize: query.pageSize, total } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

/** The active filter must remain selectable beyond the initial supplier options. */
export async function queryPurchaseSupplierOptions(organizationId: string, supplierId: string) {
  const suppliers = await prisma.supplier.findMany({ where: { organizationId }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 200 });
  if (supplierId && !suppliers.some(supplier => supplier.id === supplierId)) {
    const selected = await prisma.supplier.findFirst({ where: { organizationId, id: supplierId } });
    if (selected) suppliers.push(selected);
  }
  return suppliers;
}

/** Last placed supplier price by exact product and currency, scoped to the active workspace. */
export async function queryPurchasePriceReferences(scope: WmsScope, params: URLSearchParams) {
  const query = parsePurchasePriceHistoryQuery(params);
  const supplier = await prisma.supplier.findFirst({ where: { organizationId: scope.organizationId, id: query.supplierId }, select: { id: true } });
  if (!supplier) throw new WmsInputError('供应商不属于当前组织。');
  return prisma.$queryRaw<Array<{ productRecordId: string; price: string; currency: string; orderNumber: string; orderedAt: Date }>>`
    WITH ranked AS (
      SELECT line."productRecordId", line."unitPrice"::text AS price, order_row.currency,
        order_row.number AS "orderNumber", order_row."createdAt" AS "orderedAt",
        row_number() OVER (PARTITION BY line."productRecordId", order_row.currency ORDER BY order_row."createdAt" DESC, order_row.id ASC, line.id ASC) AS rank
      FROM "PurchaseOrderLine" line
      JOIN "PurchaseOrder" order_row
        ON order_row."organizationId"=line."organizationId"
        AND order_row."workspaceId"=line."workspaceId"
        AND order_row.id=line."purchaseOrderId"
      WHERE line."organizationId"=${scope.organizationId}
        AND line."workspaceId"=${scope.workspaceId}
        AND order_row."supplierId"=${query.supplierId}
        AND order_row.status IN ('ORDERED', 'RECEIVING')
        AND line."productRecordId" IN (${Prisma.join(query.productRecordIds)})
    )
    SELECT "productRecordId", price, currency, "orderNumber", "orderedAt"
    FROM ranked WHERE rank=1 ORDER BY "productRecordId" ASC, currency ASC
  `;
}
