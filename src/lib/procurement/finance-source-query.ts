import { scoped } from '@/lib/wms/access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import type { Tx } from '@/lib/wms/repository';
import type { FinanceSource } from '@/lib/finance/source-rules';
import { invoicePostingPlan } from './invoice-posting-rules';

/** Only confirmed purchase payments become accounting evidence; refund treatment is separate. */
export async function readPurchasePaymentFinanceSource(tx: Tx, scope: WmsScope, id: string): Promise<FinanceSource> {
  await tx.$queryRaw`SELECT id FROM "PurchasePayment" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR SHARE`;
  const payment = await tx.purchasePayment.findFirst({
    where: { ...scoped(scope), id },
    include: { order: { include: { supplier: { select: { name: true } } } }, approval: true },
  });
  if (!payment) throw new WmsError('采购付款不存在或不属于当前工作区。', 404);
  const approval = payment.approval;
  if (!approval || approval.status !== 'CONSUMED' || approval.settledPaymentId !== payment.id || !approval.approvedBy || approval.approvedBy === approval.requestedBy || approval.requestedBy !== payment.createdBy) {
    throw new WmsError('仅已独立复核并由申请人确认登记的采购付款可转入总账。', 409);
  }
  if (approval.organizationId !== scope.organizationId || approval.workspaceId !== scope.workspaceId || approval.purchaseOrderId !== payment.purchaseOrderId || !approval.amount.eq(payment.amount) || approval.currency !== payment.currency || approval.paidAt.getTime() !== payment.paidAt.getTime() || approval.method !== payment.method || approval.reference !== payment.reference || approval.notes !== payment.notes) {
    throw new WmsError('付款与已消费审批的范围、金额或收付依据不一致。', 409);
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

/**
 * 已核准的采购发票作为核算来源。发货/收货计价若已过账，则只补记差额与进项税；
 * 未过账时即为首次确认。金额口径由 invoicePostingPlan 统一计算，借贷不平直接拦截。
 */
export async function readPurchaseInvoiceFinanceSource(tx: Tx, scope: WmsScope, id: string): Promise<FinanceSource> {
  const fixed = (value: bigint) => {
    const negative = value < BigInt(0);
    const absolute = negative ? -value : value;
    return `${negative ? '-' : ''}${absolute / BigInt(1_000_000)}.${(absolute % BigInt(1_000_000)).toString().padStart(6, '0')}`;
  };
  const micros = (value: { toFixed: (digits: number) => string }) => BigInt(value.toFixed(6).replace('.', ''));
  await tx.$queryRaw`SELECT id FROM "PurchaseInvoice" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR SHARE`;
  const invoice = await tx.purchaseInvoice.findFirst({
    where: { ...scoped(scope), id },
    include: { lines: true, purchaseOrder: { include: { supplier: { select: { name: true } } } } },
  });
  if (!invoice) throw new WmsError('采购发票不存在或不属于当前工作区。', 404);
  if (invoice.status !== 'APPROVED') throw new WmsError('仅已核准的采购发票可转入总账。', 409);
  const approval = await tx.purchaseInvoiceApproval.findFirst({ where: { ...scoped(scope), invoiceId: id, status: 'APPROVED' }, orderBy: { createdAt: 'desc' } });
  if (!approval || !approval.approvedBy || approval.approvedBy === approval.requestedBy) throw new WmsError('发票缺少独立复核记录，不能入账。', 409);
  if (invoice.currency !== invoice.purchaseOrder.currency) throw new WmsError('发票币种与采购单不一致。', 422);

  // 已过账的收货计价：只有凭证真正过账的收货命令才会计入暂估额度。
  const receiptIds = invoice.purchaseOrder.wmsReceiptIds;
  const commands = receiptIds.length
    ? await tx.wmsCommand.findMany({ where: { ...scoped(scope), action: 'RECEIVE', aggregateId: { in: receiptIds } }, select: { id: true } })
    : [];
  let bookedCost = '0.000000';
  let bookedVoucherCount = 0;
  if (commands.length) {
    const drafts = await tx.wmsFinanceDraft.findMany({ where: { ...scoped(scope), commandId: { in: commands.map(command => command.id) } }, include: { entries: true } });
    const keys = drafts.map(draft => `WMS-COMMAND:${draft.commandId}`);
    const posted = keys.length ? await tx.financeVoucher.findMany({ where: { ...scoped(scope), status: 'POSTED', sourceKey: { in: keys } }, select: { sourceKey: true } }) : [];
    const postedKeys = new Set(posted.map(voucher => voucher.sourceKey));
    let total = BigInt(0);
    for (const draft of drafts) {
      if (!postedKeys.has(`WMS-COMMAND:${draft.commandId}`)) continue;
      bookedVoucherCount += 1;
      for (const entry of draft.entries) {
        if (entry.currency !== invoice.currency) throw new WmsError('收货计价币种与发票不一致，须先完成换汇核算。', 422);
        total += micros(entry.amount);
      }
    }
    bookedCost = fixed(total);
  }

  const prior = await tx.purchaseInvoice.findMany({
    where: { ...scoped(scope), purchaseOrderId: invoice.purchaseOrderId, status: 'APPROVED', id: { not: invoice.id } },
    select: { subtotal: true, lines: { select: { invoicedQty: true } } },
  });
  const priorInvoicedNet = prior.reduce((sum, row) => sum + micros(row.subtotal), BigInt(0));
  const priorInvoicedQty = prior.reduce((sum, row) => sum + row.lines.reduce((qty, line) => qty + line.invoicedQty, 0), 0);
  const receivedQty = receiptIds.length
    ? (await tx.wmsReceiptLine.aggregate({ where: { ...scoped(scope), receiptId: { in: receiptIds } }, _sum: { acceptedQty: true } }))._sum.acceptedQty ?? 0
    : 0;
  const thisQty = invoice.lines.reduce((sum, line) => sum + line.invoicedQty, 0);
  const fullCoverage = receivedQty > 0 ? priorInvoicedQty + thisQty >= receivedQty : false;
  const plan = invoicePostingPlan({
    net: invoice.subtotal.toFixed(6),
    tax: invoice.taxAmount.toFixed(6),
    total: invoice.totalAmount.toFixed(6),
    bookedCost,
    priorInvoicedNet: fixed(priorInvoicedNet),
    fullCoverage,
  });
  if (!plan.lines.length) throw new WmsError('该发票与已暂估成本、税额均无差额，无需再入账。', 422);
  return {
    kind: 'PURCHASE_INVOICE', id, sourceKey: `PURCHASE-INVOICE:${invoice.id}`,
    currency: invoice.currency, sourceDate: invoice.invoiceDate.toISOString().slice(0, 10),
    lines: plan.lines,
    evidence: {
      purchaseOrderId: invoice.purchaseOrderId, purchaseOrderNumber: invoice.purchaseOrder.number,
      supplierId: invoice.supplierId, supplierName: invoice.purchaseOrder.supplier.name,
      invoiceId: invoice.id, invoiceNumber: invoice.number, supplierInvoiceNo: invoice.supplierInvoiceNo,
      matchStatus: invoice.matchStatus, overrideReason: invoice.overrideReason,
      approvalId: approval.id, approvedBy: approval.approvedBy,
      subtotal: invoice.subtotal.toFixed(6), taxAmount: invoice.taxAmount.toFixed(6), totalAmount: invoice.totalAmount.toFixed(6),
      bookedCost, bookedVoucherCount, priorInvoicedNet: fixed(priorInvoicedNet),
      receivedQty, priorInvoicedQty, invoicedQty: thisQty, fullCoverage,
      accruedRemaining: plan.accruedRemaining, costDelta: plan.costDelta, payableDelta: plan.payableDelta,
      invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10), dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
    },
  };
}
