import { Prisma } from '@prisma/client';
import { scoped } from '@/lib/wms/access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import type { Tx } from '@/lib/wms/repository';
import { readWmsFinanceSource } from '@/lib/wms/finance-source-query';
import { readPurchasePaymentFinanceSource, readPurchaseInvoiceFinanceSource } from '@/lib/procurement/finance-source-query';
import { mapSourceLines, sourceFingerprint } from './source-rules';
import { purchaseBridgePlan } from './purchase-open-item-rules';

type PostedVoucher = { id: string; bookId: string; sourceKey: string; createdBy: string; reviewedBy: string | null; book: { currency: string }; lines: Array<{ subjectId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }> };

// 只解析既有过账来源，不新增会计分录或采购债务事实。
export async function resolvePurchaseOpenItem(tx: Tx, scope: WmsScope, voucher: PostedVoucher, subjectId: string, orderId: string, revision: number) {
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${orderId} FOR SHARE`;
  const order = await tx.purchaseOrder.findFirst({ where: { ...scoped(scope), id: orderId }, include: { supplier: true } });
  if (!order || order.supplier.organizationId !== scope.organizationId) throw new WmsError('采购单或供应商不存在。', 404);
  if (order.revision !== revision) throw new WmsError('采购单版本已变化。', 409);
  if (!voucher.reviewedBy || voucher.reviewedBy === voucher.createdBy) throw new WmsError('采购往来源凭证须先独立复核。', 409);
  const audit = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, entityId: voucher.id, entityType: 'FinanceVoucher', action: 'finance.source.import' }, orderBy: { createdAt: 'asc' } });
  const metadata = audit?.metadata as Record<string, unknown> | undefined;
  if (!metadata || metadata.workspaceId !== scope.workspaceId || metadata.bookId !== voucher.bookId || metadata.sourceKey !== voucher.sourceKey) throw new WmsError('缺少可追溯的总账来源导入记录。', 409);
  let source;
  let sourceAccount: string;
  let kind: 'PAYABLE' | 'PAYMENT';
  if (voucher.sourceKey.startsWith('WMS-COMMAND:')) {
    const commandId = voucher.sourceKey.slice('WMS-COMMAND:'.length);
    const draft = await tx.wmsFinanceDraft.findFirst({ where: { ...scoped(scope), commandId }, include: { command: true, entries: true } });
    if (!draft || draft.command.action !== 'RECEIVE' || !order.wmsReceiptIds.includes(draft.command.aggregateId)) throw new WmsError('来源不是当前采购单的收货计价凭证。', 409);
    await tx.$queryRaw`SELECT id FROM "WmsReceipt" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${draft.command.aggregateId} FOR SHARE`;
    const receipt = await tx.wmsReceipt.findFirst({ where: { ...scoped(scope), id: draft.command.aggregateId, sourceReference: order.number } });
    if (!receipt || !['RECEIVED', 'INSPECTED', 'PUTAWAY'].includes(receipt.status)) throw new WmsError('采购收货尚未执行或已取消。', 409);
    source = await readWmsFinanceSource(tx, scope, draft.id);
    const credits = new Set(draft.entries.filter(entry => entry.amount.gt(0)).map(entry => entry.creditAccount));
    if (credits.size !== 1) throw new WmsError('收货贷方不唯一，须先明确拆分会计处理，不能整体确认为应付。', 422);
    sourceAccount = [...credits][0];
    kind = 'PAYABLE';
  } else if (voucher.sourceKey.startsWith('PURCHASE-PAYMENT:')) {
    const id = voucher.sourceKey.slice('PURCHASE-PAYMENT:'.length);
    source = await readPurchasePaymentFinanceSource(tx, scope, id);
    const identity = source.evidence as { purchaseOrderId: string; supplierId: string };
    if (identity.purchaseOrderId !== order.id || identity.supplierId !== order.supplierId) throw new WmsError('付款不属于当前采购单或供应商。', 409);
    sourceAccount = 'PURCHASE_PAYABLE';
    kind = 'PAYMENT';
  } else if (voucher.sourceKey.startsWith('PURCHASE-INVOICE:')) {
    const id = voucher.sourceKey.slice('PURCHASE-INVOICE:'.length);
    source = await readPurchaseInvoiceFinanceSource(tx, scope, id);
    const identity = source.evidence as { purchaseOrderId: string; supplierId: string; bookedVoucherCount: number };
    if (identity.purchaseOrderId !== order.id || identity.supplierId !== order.supplierId) throw new WmsError('发票不属于当前采购单或供应商。', 409);
    // 收货已过账时应付已在收货计价确认，发票只做价差与税额，不能再重复登记应付。
    if (identity.bookedVoucherCount > 0) throw new WmsError('该发票对应的收货已确认应付，价差已在总账调整，不能再登记应付。', 422);
    sourceAccount = 'PURCHASE_PAYABLE';
    kind = 'PAYABLE';
  } else throw new WmsError('仅支持已过账的采购收货、独立确认付款及已核准发票来源。', 422);
  if (metadata.kind !== source.kind || metadata.sourceId !== source.id || metadata.fingerprint !== sourceFingerprint(source)) throw new WmsError('总账来源身份与导入记录不一致。', 409);
  const mapped = mapSourceLines(source, voucher.book.currency, metadata.accountMapping);
  const mapping = metadata.accountMapping as Array<{ sourceAccount: string; subjectId: string }>;
  const mappedSubject = mapping.find(row => row.sourceAccount === sourceAccount)?.subjectId;
  return purchaseBridgePlan({ kind, supplierId: order.supplierId, currency: order.currency, sourceCurrency: source.currency, subjectId, mappedSubject, expected: mapped, actual: voucher.lines.map(line => ({ subjectId: line.subjectId, debit: line.debit.toFixed(6), credit: line.credit.toFixed(6) })) });
}
