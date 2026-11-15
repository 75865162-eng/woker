import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { scoped } from '@/lib/wms/access';
import { requireRevision, requireText, strictKeys } from '@/lib/wms/rules';
import { assertInvoiceSubmittable, invoiceHash, matchInvoice, parseInvoiceDraft, type InvoiceDraft, type MatchResult, type OrderLineSnapshot } from './invoice-rules';

const approvalLifetimeMs = 7 * 24 * 60 * 60 * 1000;
/** 可开票的采购单状态：已下单之后才可能有收货。 */
const invoiceableOrderStatuses = ['ORDERED', 'RECEIVING'];

type Tx = Prisma.TransactionClient;

type OrderContext = {
  order: { id: string; number: string; supplierId: string; currency: string; status: string; lines: Array<{ productRecordId: string; expectedQty: number; unitPrice: Prisma.Decimal }> };
  orderLines: OrderLineSnapshot[];
  receivedByProduct: Map<string, number>;
  priorInvoicedByProduct: Map<string, number>;
};

/**
 * 只认可「质检合格数量」作为可开票依据：
 * 收货中 / 已质检 / 已上架的收货单，按明细累计 acceptedQty。被拒收的数量不能开票。
 */
async function receivedQtyByProduct(tx: Tx, scope: WmsScope, order: { id: string; wmsReceiptIds: string[] }) {
  const result = new Map<string, number>();
  if (!order.wmsReceiptIds.length) return result;
  const rows = await tx.$queryRaw<Array<{ productRecordId: string; qty: number }>>(Prisma.sql`
    SELECT l."productRecordId" AS "productRecordId", SUM(rl."acceptedQty")::int AS qty
    FROM "WmsReceiptLine" rl
    JOIN "WmsReceipt" r ON r."id" = rl."receiptId" AND r."organizationId" = rl."organizationId" AND r."workspaceId" = rl."workspaceId"
    JOIN "WmsLot" l ON l."id" = rl."lotId" AND l."organizationId" = rl."organizationId" AND l."workspaceId" = rl."workspaceId"
    WHERE rl."organizationId" = ${scope.organizationId} AND rl."workspaceId" = ${scope.workspaceId}
      AND r."id" IN (${Prisma.join(order.wmsReceiptIds)})
      AND r."status" IN ('RECEIVED', 'INSPECTED', 'PUTAWAY')
    GROUP BY l."productRecordId"`);
  for (const row of rows) result.set(row.productRecordId, Number(row.qty ?? 0));
  return result;
}

/** 同一采购单下其它有效发票已开票数量，用于拦截「分次开票绕过验收」。 */
async function priorInvoicedByProduct(tx: Tx, scope: WmsScope, orderId: string, excludeInvoiceId?: string) {
  const result = new Map<string, number>();
  const rows = await tx.$queryRaw<Array<{ productRecordId: string; qty: number }>>(Prisma.sql`
    SELECT il."productRecordId" AS "productRecordId", SUM(il."invoicedQty")::int AS qty
    FROM "PurchaseInvoiceLine" il
    JOIN "PurchaseInvoice" i ON i."id" = il."invoiceId" AND i."organizationId" = il."organizationId" AND i."workspaceId" = il."workspaceId"
    WHERE il."organizationId" = ${scope.organizationId} AND il."workspaceId" = ${scope.workspaceId}
      AND i."purchaseOrderId" = ${orderId} AND i."status" <> 'VOID'
      ${excludeInvoiceId ? Prisma.sql`AND i."id" <> ${excludeInvoiceId}` : Prisma.empty}
    GROUP BY il."productRecordId"`);
  for (const row of rows) result.set(row.productRecordId, Number(row.qty ?? 0));
  return result;
}

async function loadOrderContext(tx: Tx, scope: WmsScope, orderId: string, excludeInvoiceId?: string, lock = false): Promise<OrderContext> {
  if (lock) await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${orderId} FOR UPDATE`;
  const order = await tx.purchaseOrder.findFirst({ where: { ...scoped(scope), id: orderId }, include: { lines: true } });
  if (!order) throw new WmsError('采购订单不存在或不属于当前工作区。', 404);
  if (!invoiceableOrderStatuses.includes(order.status)) throw new WmsError('仅已下单或收货中的采购订单可以登记发票。', 409);
  const [receivedByProduct, priorInvoiced] = await Promise.all([
    receivedQtyByProduct(tx, scope, order),
    priorInvoicedByProduct(tx, scope, order.id, excludeInvoiceId),
  ]);
  return {
    order: { id: order.id, number: order.number, supplierId: order.supplierId, currency: order.currency, status: order.status, lines: order.lines },
    orderLines: order.lines.map(line => ({ productRecordId: line.productRecordId, expectedQty: line.expectedQty, unitPrice: line.unitPrice.toString() })),
    receivedByProduct,
    priorInvoicedByProduct: priorInvoiced,
  };
}

function runMatch(context: OrderContext, draft: Pick<InvoiceDraft, 'lines' | 'qtyToleranceBp' | 'priceToleranceBp' | 'amountTolerance'>): MatchResult {
  return matchInvoice({
    orderLines: context.orderLines,
    receivedByProduct: context.receivedByProduct,
    priorInvoicedByProduct: context.priorInvoicedByProduct,
    invoiceLines: draft.lines,
    qtyToleranceBp: draft.qtyToleranceBp,
    priceToleranceBp: draft.priceToleranceBp,
    amountTolerance: draft.amountTolerance,
  });
}

const toDateOnly = (value: Date) => new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);

export async function createPurchaseInvoice(scope: WmsScope, body: Record<string, unknown>) {
  const draft = parseInvoiceDraft(body);
  return prisma.$transaction(async tx => {
    const context = await loadOrderContext(tx, scope, draft.purchaseOrderId);
    const match = runMatch(context, draft);
    const invoice = await tx.purchaseInvoice.create({
      data: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        number: draft.number,
        supplierInvoiceNo: draft.supplierInvoiceNo,
        purchaseOrderId: context.order.id,
        supplierId: context.order.supplierId,
        currency: context.order.currency,
        invoiceDate: toDateOnly(draft.invoiceDate),
        dueDate: draft.dueDate ? toDateOnly(draft.dueDate) : null,
        qtyToleranceBp: draft.qtyToleranceBp,
        priceToleranceBp: draft.priceToleranceBp,
        amountTolerance: new Prisma.Decimal(draft.amountTolerance),
        subtotal: new Prisma.Decimal(match.subtotal),
        taxAmount: new Prisma.Decimal(match.taxAmount),
        totalAmount: new Prisma.Decimal(match.totalAmount),
        matchStatus: match.matchStatus,
        exceptionSummary: match.exceptionSummary,
        matchedAt: new Date(),
        overrideReason: draft.overrideReason,
        notes: draft.notes,
        createdBy: scope.actorUserId,
        lines: {
          create: match.lines.map(line => ({
            productRecordId: line.productRecordId,
            orderedQty: line.orderedQty,
            receivedQty: line.receivedQty,
            invoicedQty: line.invoicedQty,
            poUnitPrice: new Prisma.Decimal(line.poUnitPrice),
            unitPrice: new Prisma.Decimal(line.unitPrice),
            amount: new Prisma.Decimal(line.amount),
            taxAmount: new Prisma.Decimal(line.taxAmount),
            varianceQty: line.varianceQty,
            varianceAmount: new Prisma.Decimal(line.varianceAmount),
            exceptionCodes: line.exceptionCodes,
            notes: draft.lines.find(item => item.productRecordId === line.productRecordId)?.notes ?? '',
          })),
        },
      },
      include: { lines: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        userId: scope.actorUserId,
        action: 'procurement.invoice.create',
        entityType: 'PurchaseInvoice',
        entityId: invoice.id,
        metadata: { workspaceId: scope.workspaceId, purchaseOrderId: context.order.id, matchStatus: match.matchStatus, totalAmount: match.totalAmount },
      },
    });
    return invoice;
  });
}

/**
 * 重新匹配：单据内容、收货进度、历史开票任何一项变化都会改变结论。
 * 已提交审批或已核准的发票不接受静默重算，避免审批指纹与事实脱节。
 */
export async function rematchPurchaseInvoice(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'revision', 'lines', 'qtyToleranceBp', 'priceToleranceBp', 'amountTolerance', 'overrideReason', 'dueDate', 'notes']);
  const id = requireText(body.id, '发票 ID');
  const revision = requireRevision(body.revision);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchaseInvoice" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const invoice = await tx.purchaseInvoice.findFirst({ where: { ...scoped(scope), id }, include: { lines: { orderBy: { createdAt: 'asc' } } } });
    if (!invoice) throw new WmsError('发票不存在或不属于当前工作区。', 404);
    if (invoice.status !== 'DRAFT' || invoice.revision !== revision) throw new WmsError('仅当前版本草稿发票可以重新匹配。', 409);
    const context = await loadOrderContext(tx, scope, invoice.purchaseOrderId, invoice.id, true);

    const rawLines = Array.isArray(body.lines) && body.lines.length
      ? body.lines
      : invoice.lines.map(line => ({ productRecordId: line.productRecordId, invoicedQty: line.invoicedQty, unitPrice: line.unitPrice.toString(), amount: line.amount.toString(), taxAmount: line.taxAmount.toString(), notes: line.notes }));

    const draft = parseInvoiceDraft({
      number: invoice.number,
      supplierInvoiceNo: invoice.supplierInvoiceNo,
      purchaseOrderId: invoice.purchaseOrderId,
      invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
      dueDate: body.dueDate ?? (invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : null),
      qtyToleranceBp: body.qtyToleranceBp ?? invoice.qtyToleranceBp,
      priceToleranceBp: body.priceToleranceBp ?? invoice.priceToleranceBp,
      amountTolerance: body.amountTolerance ?? invoice.amountTolerance.toString(),
      overrideReason: body.overrideReason ?? invoice.overrideReason,
      notes: body.notes ?? invoice.notes,
      lines: rawLines,
    });
    const match = runMatch(context, draft);
    await tx.purchaseInvoiceLine.deleteMany({ where: { ...scoped(scope), invoiceId: invoice.id } });
    const updated = await tx.purchaseInvoice.update({
      where: { id: invoice.id },
      data: {
        dueDate: draft.dueDate ? toDateOnly(draft.dueDate) : null,
        qtyToleranceBp: draft.qtyToleranceBp,
        priceToleranceBp: draft.priceToleranceBp,
        amountTolerance: new Prisma.Decimal(draft.amountTolerance),
        subtotal: new Prisma.Decimal(match.subtotal),
        taxAmount: new Prisma.Decimal(match.taxAmount),
        totalAmount: new Prisma.Decimal(match.totalAmount),
        matchStatus: match.matchStatus,
        exceptionSummary: match.exceptionSummary,
        matchedAt: new Date(),
        overrideReason: draft.overrideReason,
        notes: draft.notes,
        revision: { increment: 1 },
        lines: {
          create: match.lines.map(line => ({
            productRecordId: line.productRecordId,
            orderedQty: line.orderedQty,
            receivedQty: line.receivedQty,
            invoicedQty: line.invoicedQty,
            poUnitPrice: new Prisma.Decimal(line.poUnitPrice),
            unitPrice: new Prisma.Decimal(line.unitPrice),
            amount: new Prisma.Decimal(line.amount),
            taxAmount: new Prisma.Decimal(line.taxAmount),
            varianceQty: line.varianceQty,
            varianceAmount: new Prisma.Decimal(line.varianceAmount),
            exceptionCodes: line.exceptionCodes,
            notes: draft.lines.find(item => item.productRecordId === line.productRecordId)?.notes ?? '',
          })),
        },
      },
      include: { lines: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        userId: scope.actorUserId,
        action: 'procurement.invoice.rematch',
        entityType: 'PurchaseInvoice',
        entityId: invoice.id,
        metadata: { workspaceId: scope.workspaceId, matchStatus: match.matchStatus, exceptionSummary: match.exceptionSummary, totalAmount: match.totalAmount },
      },
    });
    return updated;
  });
}

export async function submitPurchaseInvoiceApproval(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'revision', 'overrideReason']);
  const id = requireText(body.id, '发票 ID');
  const revision = requireRevision(body.revision);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchaseInvoice" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const invoice = await tx.purchaseInvoice.findFirst({ where: { ...scoped(scope), id }, include: { lines: true } });
    if (!invoice) throw new WmsError('发票不存在或不属于当前工作区。', 404);
    if (invoice.revision !== revision) throw new WmsError('发票内容已变化，请刷新后重试。', 409);
    const overrideReason = typeof body.overrideReason === 'string' ? body.overrideReason.trim().slice(0, 500) : invoice.overrideReason;
    assertInvoiceSubmittable({ status: invoice.status, matchStatus: invoice.matchStatus, overrideReason });
    const hash = invoiceHash({
      ...invoice,
      amountTolerance: invoice.amountTolerance.toString(),
      lines: invoice.lines.map(line => ({ productRecordId: line.productRecordId, invoicedQty: line.invoicedQty, unitPrice: line.unitPrice.toString(), taxAmount: line.taxAmount.toString(), notes: line.notes })),
    });
    const updated = await tx.purchaseInvoice.update({ where: { id }, data: { status: 'PENDING_APPROVAL', overrideReason, revision: { increment: 1 } } });
    const approval = await tx.purchaseInvoiceApproval.create({
      data: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        invoiceId: invoice.id,
        expectedRevision: updated.revision,
        requestHash: hash,
        requestedBy: scope.actorUserId,
        overrideReason,
        expiresAt: new Date(Date.now() + approvalLifetimeMs),
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        userId: scope.actorUserId,
        action: 'procurement.invoice.submit-approval',
        entityType: 'PurchaseInvoice',
        entityId: invoice.id,
        metadata: { workspaceId: scope.workspaceId, approvalId: approval.id, revision: updated.revision, matchStatus: invoice.matchStatus, overrideReason },
      },
    });
    return { invoice: updated, approval };
  });
}

export async function decidePurchaseInvoiceApproval(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['decision', 'id', 'revision', 'reason']);
  const id = requireText(body.id, '审批 ID');
  const revision = requireRevision(body.revision);
  const approved = body.decision === 'APPROVE';
  if (!approved && body.decision !== 'REJECT') throw new WmsError('审批结论无效。', 400);
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchaseInvoiceApproval" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const approval = await tx.purchaseInvoiceApproval.findFirst({ where: { ...scoped(scope), id } });
    if (!approval) throw new WmsError('发票审批不存在。', 404);
    if (approval.requestedBy === scope.actorUserId) throw new WmsError('发票审批禁止申请人自批。', 403);
    await tx.$queryRaw`SELECT id FROM "PurchaseInvoice" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${approval.invoiceId} FOR UPDATE`;
    const invoice = await tx.purchaseInvoice.findFirst({ where: { ...scoped(scope), id: approval.invoiceId }, include: { lines: true } });
    if (!invoice) throw new WmsError('发票不存在。', 404);
    if (approval.status !== 'PENDING' || approval.revision !== revision || approval.expiresAt.getTime() <= Date.now() || invoice.status !== 'PENDING_APPROVAL' || invoice.revision !== approval.expectedRevision
      || invoiceHash({ ...invoice, amountTolerance: invoice.amountTolerance.toString(), lines: invoice.lines.map(line => ({ productRecordId: line.productRecordId, invoicedQty: line.invoicedQty, unitPrice: line.unitPrice.toString(), taxAmount: line.taxAmount.toString(), notes: line.notes })) }) !== approval.requestHash) {
      throw new WmsError('发票审批已过期、单据已变化或版本不匹配。', 409);
    }
    const decided = await tx.purchaseInvoiceApproval.update({ where: { id }, data: { status: approved ? 'APPROVED' : 'REJECTED', approvedBy: scope.actorUserId, decisionReason: reason, revision: { increment: 1 } } });
    const updated = await tx.purchaseInvoice.update({ where: { id: invoice.id }, data: { status: approved ? 'APPROVED' : 'DRAFT', revision: { increment: 1 } } });
    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        userId: scope.actorUserId,
        action: `procurement.invoice.approval.${approved ? 'approve' : 'reject'}`,
        entityType: 'PurchaseInvoice',
        entityId: invoice.id,
        metadata: { workspaceId: scope.workspaceId, approvalId: id, reason, matchStatus: invoice.matchStatus, overrideReason: approval.overrideReason },
      },
    });
    return { approval: decided, invoice: updated };
  });
}

export async function voidPurchaseInvoice(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'revision', 'reason']);
  const id = requireText(body.id, '发票 ID');
  const revision = requireRevision(body.revision);
  const reason = requireText(body.reason, '作废原因', 500);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchaseInvoice" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const invoice = await tx.purchaseInvoice.findFirst({ where: { ...scoped(scope), id } });
    if (!invoice) throw new WmsError('发票不存在或不属于当前工作区。', 404);
    if (invoice.status === 'VOID') throw new WmsError('发票已作废。', 409);
    if (invoice.revision !== revision) throw new WmsError('发票内容已变化，请刷新后重试。', 409);
    // 已转入总账的发票必须先冲销凭证，否则总账与业务单据会脱钩。
    const posted = await tx.financeVoucher.count({ where: { ...scoped(scope), sourceKey: `PURCHASE-INVOICE:${id}` } });
    if (posted) throw new WmsError('发票已转入总账，须先在总账冲销凭证后再作废。', 409);
    const updated = await tx.purchaseInvoice.update({ where: { id }, data: { status: 'VOID', revision: { increment: 1 } } });
    await tx.purchaseInvoiceApproval.updateMany({ where: { ...scoped(scope), invoiceId: id, status: 'PENDING' }, data: { status: 'CANCELLED', decisionReason: reason, revision: { increment: 1 } } });
    await tx.auditLog.create({
      data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.invoice.void', entityType: 'PurchaseInvoice', entityId: id, metadata: { workspaceId: scope.workspaceId, reason } },
    });
    return updated;
  });
}

/** 采购单维度的三单对账视图：订单 / 已验收 / 已开票，直接回答「这单还能开多少票」。 */
export async function invoiceReconciliation(scope: WmsScope, orderId: string) {
  const order = await prisma.purchaseOrder.findFirst({ where: { ...scoped(scope), id: orderId }, include: { lines: { include: { product: { select: { sku: true, chineseName: true, englishName: true } } } }, supplier: { select: { id: true, name: true } } } });
  if (!order) throw new WmsError('采购订单不存在。', 404);
  const [received, invoiced] = await Promise.all([
    order.wmsReceiptIds.length
      ? prisma.$queryRaw<Array<{ productRecordId: string; qty: number }>>(Prisma.sql`
          SELECT l."productRecordId" AS "productRecordId", SUM(rl."acceptedQty")::int AS qty
          FROM "WmsReceiptLine" rl
          JOIN "WmsReceipt" r ON r."id" = rl."receiptId" AND r."organizationId" = rl."organizationId" AND r."workspaceId" = rl."workspaceId"
          JOIN "WmsLot" l ON l."id" = rl."lotId" AND l."organizationId" = rl."organizationId" AND l."workspaceId" = rl."workspaceId"
          WHERE rl."organizationId" = ${scope.organizationId} AND rl."workspaceId" = ${scope.workspaceId}
            AND r."id" IN (${Prisma.join(order.wmsReceiptIds)})
            AND r."status" IN ('RECEIVED', 'INSPECTED', 'PUTAWAY')
          GROUP BY l."productRecordId"`)
      : Promise.resolve([] as Array<{ productRecordId: string; qty: number }>),
    prisma.$queryRaw<Array<{ productRecordId: string; qty: number; amount: string }>>(Prisma.sql`
      SELECT il."productRecordId" AS "productRecordId", SUM(il."invoicedQty")::int AS qty, SUM(il."amount")::text AS amount
      FROM "PurchaseInvoiceLine" il
      JOIN "PurchaseInvoice" i ON i."id" = il."invoiceId" AND i."organizationId" = il."organizationId" AND i."workspaceId" = il."workspaceId"
      WHERE il."organizationId" = ${scope.organizationId} AND il."workspaceId" = ${scope.workspaceId}
        AND i."purchaseOrderId" = ${orderId} AND i."status" <> 'VOID'
      GROUP BY il."productRecordId"`),
  ]);
  const receivedMap = new Map(received.map(row => [row.productRecordId, Number(row.qty ?? 0)]));
  const invoicedMap = new Map(invoiced.map(row => [row.productRecordId, { qty: Number(row.qty ?? 0), amount: row.amount ?? '0' }]));
  return {
    order: { id: order.id, number: order.number, status: order.status, currency: order.currency, supplier: order.supplier },
    lines: order.lines.map(line => {
      const receivedQty = receivedMap.get(line.productRecordId) ?? 0;
      const invoicedRow = invoicedMap.get(line.productRecordId);
      return {
        productRecordId: line.productRecordId,
        sku: line.product.sku,
        name: line.product.chineseName || line.product.englishName || line.product.sku,
        orderedQty: line.expectedQty,
        receivedQty,
        invoicedQty: invoicedRow?.qty ?? 0,
        remainingQty: Math.max(0, receivedQty - (invoicedRow?.qty ?? 0)),
        unitPrice: line.unitPrice.toString(),
        orderedAmount: (Number(line.unitPrice) * line.expectedQty).toFixed(2),
        invoicedAmount: invoicedRow?.amount ?? '0',
      };
    }),
  };
}
