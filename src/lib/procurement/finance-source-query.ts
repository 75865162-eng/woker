import { scoped } from '@/lib/wms/access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import type { Tx } from '@/lib/wms/repository';
import type { FinanceSource } from '@/lib/finance/source-rules';

/** Only confirmed purchase payments become accounting evidence; refund treatment is separate. */
export async function readPurchasePaymentFinanceSource(tx: Tx, scope: WmsScope, id: string): Promise<FinanceSource> {
  await tx.$queryRaw`SELECT id FROM "PurchasePayment" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR SHARE`;
  const payment = await tx.purchasePayment.findFirst({
    where: { ...scoped(scope), id },
    include: { order: { include: { supplier: { select: { name: true } } } }, approval: true },
  });
  if (!payment) throw new WmsError('采购付款不存在或不属于当前工作区。', 404);
  const approval = payment.approval;
  if (!approval || approval.status !== 'CONSUMED' || approval.settledPaymentId !== payment.id || !approval.approvedBy || approval.requestedBy !== payment.createdBy) {
    throw new WmsError('仅已独立复核并由申请人确认登记的采购付款可转入总账。', 409);
  }
  const amount = payment.amount.toFixed(6);
  const cashAccount = `PURCHASE_CASH_${payment.method}`;
  return {
    kind: 'PURCHASE_PAYMENT', id, sourceKey: `PURCHASE-PAYMENT:${payment.id}`,
    currency: payment.currency, sourceDate: payment.paidAt.toISOString().slice(0, 10),
    lines: [
      { account: 'PURCHASE_PAYABLE', debit: amount, credit: '0.000000' },
      { account: cashAccount, debit: '0.000000', credit: amount },
    ],
    evidence: {
      purchaseOrderId: payment.purchaseOrderId, purchaseOrderNumber: payment.order.number,
      supplierId: payment.order.supplierId, supplierName: payment.order.supplier.name,
      paymentId: payment.id, approvalId: approval.id, approvedBy: approval.approvedBy,
      reference: payment.reference, method: payment.method, notes: payment.notes,
      amount, currency: payment.currency, paidAt: payment.paidAt.toISOString(),
    },
  };
}

/** A reviewed, confirmed supplier refund reduces the payable and returns funds. */
export async function readPurchaseRefundFinanceSource(tx: Tx, scope: WmsScope, id: string): Promise<FinanceSource> {
  await tx.$queryRaw`SELECT id FROM "PurchasePaymentRefund" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR SHARE`;
  const refund = await tx.purchasePaymentRefund.findFirst({
    where: { ...scoped(scope), id },
    include: { payment: { include: { order: { include: { supplier: { select: { name: true } } } } } }, approval: true },
  });
  if (!refund) throw new WmsError('采购退款不存在或不属于当前工作区。', 404);
  const approval = refund.approval;
  if (!approval || approval.status !== 'CONSUMED' || approval.settledRefundId !== refund.id || !approval.approvedBy || approval.requestedBy !== refund.createdBy) {
    throw new WmsError('仅已独立复核并由申请人确认登记的采购退款可转入总账。', 409);
  }
  const amount = refund.amount.toFixed(6);
  return {
    kind: 'PURCHASE_REFUND', id, sourceKey: `PURCHASE-REFUND:${refund.id}`,
    currency: refund.currency, sourceDate: refund.refundedAt.toISOString().slice(0, 10),
    lines: [
      { account: `PURCHASE_CASH_${refund.method}`, debit: amount, credit: '0.000000' },
      { account: 'PURCHASE_PAYABLE', debit: '0.000000', credit: amount },
    ],
    evidence: {
      purchaseOrderId: refund.purchaseOrderId, purchaseOrderNumber: refund.payment.order.number,
      supplierId: refund.payment.order.supplierId, supplierName: refund.payment.order.supplier.name,
      refundId: refund.id, originalPaymentId: refund.paymentId, approvalId: approval.id,
      approvedBy: approval.approvedBy, reference: refund.reference, method: refund.method,
      notes: refund.notes, amount, currency: refund.currency, refundedAt: refund.refundedAt.toISOString(),
    },
  };
}
