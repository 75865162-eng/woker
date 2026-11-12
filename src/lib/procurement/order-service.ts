import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { scoped } from '@/lib/wms/access';
import { requireRevision, requireText, strictKeys } from '@/lib/wms/rules';
import { parsePurchaseDraft } from './order-input';

const purchaseApprovalLifetimeMs = 7 * 24 * 60 * 60 * 1000;
function purchaseOrderHash(order: { number: string; supplierId: string; currency: string; expectedAt: Date | null; notes: string; lines: Array<{ productRecordId: string; expectedQty: number; unitPrice: Prisma.Decimal; notes: string }> }) {
  const body = { number: order.number, supplierId: order.supplierId, currency: order.currency, expectedAt: order.expectedAt?.toISOString() ?? null, notes: order.notes,
    lines: [...order.lines].sort((a, b) => a.productRecordId.localeCompare(b.productRecordId)).map(line => ({ productRecordId: line.productRecordId, expectedQty: line.expectedQty, unitPrice: line.unitPrice.toString(), notes: line.notes })) };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export async function submitPurchaseOrderApproval(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'revision']);
  const id = requireText(body.id, '采购单 ID');
  const revision = requireRevision(body.revision);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({ where: { ...scoped(scope), id }, include: { lines: true } });
    if (!order) throw new WmsError('采购单不存在或不属于当前工作区。', 404);
    if (order.status !== 'DRAFT' || order.revision !== revision || order.wmsReceiptIds.length) throw new WmsError('仅当前版本且未关联收货单的采购草稿可以提交审批。', 409);
    const updated = await tx.purchaseOrder.update({ where: { id }, data: { status: 'PENDING_APPROVAL', revision: { increment: 1 } } });
    const approval = await tx.purchaseOrderApproval.create({ data: { id: crypto.randomUUID(), organizationId: scope.organizationId, workspaceId: scope.workspaceId, purchaseOrderId: id, expectedRevision: updated.revision, requestHash: purchaseOrderHash(order), requestedBy: scope.actorUserId, expiresAt: new Date(Date.now() + purchaseApprovalLifetimeMs) } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.order.submit-approval', entityType: 'PurchaseOrder', entityId: id, metadata: { workspaceId: scope.workspaceId, approvalId: approval.id, revision: updated.revision } } });
    return { order: updated, approval };
  });
}

export async function decidePurchaseOrderApproval(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['id', 'revision', 'decision', 'reason']);
  const id = requireText(body.id, '审批 ID');
  const revision = requireRevision(body.revision);
  if (body.decision !== 'APPROVE' && body.decision !== 'REJECT') throw new WmsError('审批决定无效。', 400);
  const approved = body.decision === 'APPROVE';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!approved && !reason) throw new WmsError('拒绝时必须填写原因。', 400);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchaseOrderApproval" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const approval = await tx.purchaseOrderApproval.findFirst({ where: { ...scoped(scope), id } });
    if (!approval) throw new WmsError('采购审批不存在。', 404);
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${approval.purchaseOrderId} FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({ where: { ...scoped(scope), id: approval.purchaseOrderId }, include: { lines: true } });
    if (!order) throw new WmsError('采购单不存在。', 404);
    if (approval.requestedBy === scope.actorUserId) throw new WmsError('采购审批禁止申请人自批。', 403);
    if (approval.status !== 'PENDING' || approval.revision !== revision || approval.expiresAt.getTime() <= Date.now() || order.status !== 'PENDING_APPROVAL' || order.revision !== approval.expectedRevision || purchaseOrderHash(order) !== approval.requestHash) throw new WmsError('采购审批已过期、单据已变化或版本不匹配。', 409);
    const nextStatus = approved ? 'APPROVED' : 'REJECTED';
    const decided = await tx.purchaseOrderApproval.update({ where: { id }, data: { status: nextStatus, approvedBy: scope.actorUserId, decisionReason: reason, revision: { increment: 1 } } });
    await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: approved ? 'APPROVED' : 'DRAFT', revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: `procurement.order.approval.${approved ? 'approve' : 'reject'}`, entityType: 'PurchaseOrder', entityId: order.id, metadata: { workspaceId: scope.workspaceId, approvalId: id, reason } } });
    return decided;
  });
}

export async function placeApprovedPurchaseOrder(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'revision']);
  const id = requireText(body.id, '采购单 ID');
  const revision = requireRevision(body.revision);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({ where: { ...scoped(scope), id } });
    if (!order) throw new WmsError('采购单不存在或不属于当前工作区。', 404);
    const approval = await tx.purchaseOrderApproval.findFirst({ where: { ...scoped(scope), purchaseOrderId: id, status: 'APPROVED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (order.status !== 'APPROVED' || order.revision !== revision || !approval || approval.requestedBy !== scope.actorUserId || approval.approvedBy === scope.actorUserId) throw new WmsError('只有审批通过的采购申请人可以确认下单。', 409);
    const updated = await tx.purchaseOrder.update({ where: { id }, data: { status: 'ORDERED', revision: { increment: 1 } } });
    await tx.purchaseOrderApproval.update({ where: { id: approval.id }, data: { status: 'CONSUMED', revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.order.place', entityType: 'PurchaseOrder', entityId: id, metadata: { workspaceId: scope.workspaceId, approvalId: approval.id, revision: updated.revision } } });
    return updated;
  });
}

const purchasePaymentApprovalLifetimeMs = 7 * 24 * 60 * 60 * 1000;
type PurchasePaymentInput = { amount: Prisma.Decimal; paidAt: Date; method: string; reference: string; notes: string };
function parsePurchasePaymentInput(body: Record<string, unknown>): { id: string; input: PurchasePaymentInput } {
  const id = requireText(body.id, '采购单 ID');
  const amountText = typeof body.amount === 'string' ? body.amount.trim() : '';
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(amountText) || new Prisma.Decimal(amountText).lte(0)) throw new WmsError('付款金额须为大于 0 且最多 6 位小数的有效金额。', 400);
  const paidAtText = typeof body.paidAt === 'string' ? body.paidAt : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAtText) || Number.isNaN(Date.parse(`${paidAtText}T00:00:00Z`)) || new Date(`${paidAtText}T00:00:00Z`).toISOString().slice(0, 10) !== paidAtText) throw new WmsError('付款日期无效。', 400);
  const method = requireText(body.method, '付款方式', 40);
  const reference = requireText(body.reference, '付款流水号', 120);
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (notes.length > 500) throw new WmsError('付款备注不能超过 500 字。', 400);
  return { id, input: { amount: new Prisma.Decimal(amountText), paidAt: new Date(`${paidAtText}T00:00:00.000Z`), method, reference, notes } };
}
function purchasePaymentHash(input: PurchasePaymentInput, currency: string) {
  return createHash('sha256').update(JSON.stringify({ amount: input.amount.toString(), paidAt: input.paidAt.toISOString(), method: input.method, reference: input.reference, notes: input.notes, currency })).digest('hex');
}
function purchaseAmountTotal(lines: Array<{ expectedQty: number; unitPrice: Prisma.Decimal }>) {
  return lines.reduce((sum, line) => sum.add(line.unitPrice.mul(line.expectedQty)), new Prisma.Decimal(0));
}

/** Reserves payable capacity, but does not create a payment ledger entry before independent approval. */
export async function submitPurchasePaymentApproval(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'amount', 'paidAt', 'method', 'reference', 'notes']);
  const { id, input } = parsePurchasePaymentInput(body);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({ where: { ...scoped(scope), id }, include: { lines: true } });
    if (!order) throw new WmsError('采购单不存在或不属于当前工作区。', 404);
    if (!['ORDERED', 'RECEIVING'].includes(order.status)) throw new WmsError('仅已下单或收货中的采购单可以申请付款复核。', 409);
    const hash = purchasePaymentHash(input, order.currency);
    const existing = await tx.purchasePaymentApproval.findFirst({ where: { ...scoped(scope), purchaseOrderId: id, reference: input.reference, status: { in: ['PENDING', 'APPROVED'] }, expiresAt: { gt: new Date() } } });
    if (existing) {
      if (existing.requestedBy === scope.actorUserId && existing.requestHash === hash) return { approval: existing, reused: true };
      throw new WmsError('该付款流水号已有待处理复核，不能重复申请。', 409);
    }
    if (await tx.purchasePayment.findUnique({ where: { organizationId_workspaceId_purchaseOrderId_reference: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, purchaseOrderId: id, reference: input.reference } } })) throw new WmsError('该付款流水号已登记。', 409);
    const [paid, activeApprovals] = await Promise.all([
      tx.purchasePayment.aggregate({ where: { ...scoped(scope), purchaseOrderId: id }, _sum: { amount: true } }),
      tx.purchasePaymentApproval.aggregate({ where: { ...scoped(scope), purchaseOrderId: id, status: { in: ['PENDING', 'APPROVED'] }, expiresAt: { gt: new Date() } }, _sum: { amount: true } }),
    ]);
    const total = purchaseAmountTotal(order.lines);
    const reserved = activeApprovals._sum.amount ?? new Prisma.Decimal(0);
    if (total.lte(0) || input.amount.add(paid._sum.amount ?? 0).add(reserved).gt(total)) throw new WmsError('付款申请金额超过采购单可付余额（含待复核金额）。', 422);
    const approval = await tx.purchasePaymentApproval.create({ data: { id: crypto.randomUUID(), organizationId: scope.organizationId, workspaceId: scope.workspaceId, purchaseOrderId: id, ...input, currency: order.currency, requestHash: hash, requestedBy: scope.actorUserId, expiresAt: new Date(Date.now() + purchasePaymentApprovalLifetimeMs) } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.payment.submit-approval', entityType: 'PurchasePaymentApproval', entityId: approval.id, metadata: { workspaceId: scope.workspaceId, purchaseOrderId: id, reference: input.reference, amount: input.amount.toString(), currency: order.currency } } });
    return { approval, reused: false };
  });
}

export async function decidePurchasePaymentApproval(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['id', 'revision', 'decision', 'reason']);
  const id = requireText(body.id, '付款复核 ID');
  const revision = requireRevision(body.revision);
  if (body.decision !== 'APPROVE' && body.decision !== 'REJECT') throw new WmsError('复核决定无效。', 400);
  const approved = body.decision === 'APPROVE';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!approved && !reason) throw new WmsError('拒绝付款复核时必须填写原因。', 400);
  return prisma.$transaction(async tx => {
    const identity = await tx.purchasePaymentApproval.findFirst({ where: { ...scoped(scope), id }, select: { purchaseOrderId: true } });
    if (!identity) throw new WmsError('付款复核记录不存在。', 404);
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.purchaseOrderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "PurchasePaymentApproval" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const row = await tx.purchasePaymentApproval.findFirst({ where: { ...scoped(scope), id } });
    if (!row) throw new WmsError('付款复核记录不存在。', 404);
    if (row.requestedBy === scope.actorUserId) throw new WmsError('付款复核禁止申请人自批。', 403);
    const nextStatus = approved ? 'APPROVED' : 'REJECTED';
    if (row.approvedBy === scope.actorUserId && row.status === nextStatus && row.revision === revision + 1) return row;
    if (approved && row.approvedBy === scope.actorUserId && row.status === 'CONSUMED' && row.revision === revision + 2) return row;
    if (row.status !== 'PENDING' || row.revision !== revision || row.expiresAt.getTime() <= Date.now()) throw new WmsError('付款复核已过期或版本已变化。', 409);
    const order = await tx.purchaseOrder.findFirst({ where: { ...scoped(scope), id: row.purchaseOrderId }, include: { lines: true } });
    if (!order || !['ORDERED', 'RECEIVING'].includes(order.status) || row.currency !== order.currency || purchasePaymentHash({ amount: row.amount, paidAt: row.paidAt, method: row.method, reference: row.reference, notes: row.notes }, row.currency) !== row.requestHash) throw new WmsError('采购单状态或付款凭证内容已变化。', 409);
    if (approved) {
      const [paid, otherReserved] = await Promise.all([
        tx.purchasePayment.aggregate({ where: { ...scoped(scope), purchaseOrderId: order.id }, _sum: { amount: true } }),
        tx.purchasePaymentApproval.aggregate({ where: { ...scoped(scope), purchaseOrderId: order.id, id: { not: id }, status: { in: ['PENDING', 'APPROVED'] }, expiresAt: { gt: new Date() } }, _sum: { amount: true } }),
      ]);
      if (row.amount.add(paid._sum.amount ?? 0).add(otherReserved._sum.amount ?? 0).gt(purchaseAmountTotal(order.lines))) throw new WmsError('付款复核金额已超过采购单可付余额。', 422);
    }
    const decided = await tx.purchasePaymentApproval.update({ where: { id }, data: { status: nextStatus, approvedBy: scope.actorUserId, decisionReason: reason, revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: `procurement.payment.approval.${approved ? 'approve' : 'reject'}`, entityType: 'PurchasePaymentApproval', entityId: id, metadata: { workspaceId: scope.workspaceId, purchaseOrderId: row.purchaseOrderId, reference: row.reference, reason } } });
    return decided;
  });
}

/** Only the original applicant can consume an approved payment request into the immutable ledger. */
export async function confirmPurchasePayment(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'revision']);
  const id = requireText(body.id, '付款复核 ID');
  const revision = requireRevision(body.revision);
  return prisma.$transaction(async tx => {
    const identity = await tx.purchasePaymentApproval.findFirst({ where: { ...scoped(scope), id }, select: { purchaseOrderId: true } });
    if (!identity) throw new WmsError('付款复核记录不存在。', 404);
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.purchaseOrderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "PurchasePaymentApproval" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const row = await tx.purchasePaymentApproval.findFirst({ where: { ...scoped(scope), id } });
    if (!row) throw new WmsError('付款复核记录不存在。', 404);
    if (row.status === 'CONSUMED' && row.requestedBy === scope.actorUserId && row.settledPaymentId) {
      const payment = await tx.purchasePayment.findFirst({ where: { ...scoped(scope), id: row.settledPaymentId } });
      if (payment) return { payment, reused: true };
    }
    const order = await tx.purchaseOrder.findFirst({ where: { ...scoped(scope), id: row.purchaseOrderId }, include: { lines: true } });
    if (row.status !== 'APPROVED' || row.revision !== revision || row.expiresAt.getTime() <= Date.now() || row.requestedBy !== scope.actorUserId || !row.approvedBy || row.approvedBy === scope.actorUserId) throw new WmsError('只有原申请人可以确认有效的已批准付款复核。', 409);
    if (!order || !['ORDERED', 'RECEIVING'].includes(order.status) || row.currency !== order.currency || purchasePaymentHash({ amount: row.amount, paidAt: row.paidAt, method: row.method, reference: row.reference, notes: row.notes }, row.currency) !== row.requestHash) throw new WmsError('采购单状态或付款凭证内容已变化。', 409);
    const [paid, otherReserved] = await Promise.all([
      tx.purchasePayment.aggregate({ where: { ...scoped(scope), purchaseOrderId: order.id }, _sum: { amount: true } }),
      tx.purchasePaymentApproval.aggregate({ where: { ...scoped(scope), purchaseOrderId: order.id, id: { not: id }, status: { in: ['PENDING', 'APPROVED'] }, expiresAt: { gt: new Date() } }, _sum: { amount: true } }),
    ]);
    if (row.amount.add(paid._sum.amount ?? 0).add(otherReserved._sum.amount ?? 0).gt(purchaseAmountTotal(order.lines))) throw new WmsError('付款确认金额已超过采购单可付余额。', 422);
    const payment = await tx.purchasePayment.create({ data: { id: crypto.randomUUID(), organizationId: scope.organizationId, workspaceId: scope.workspaceId, purchaseOrderId: order.id, amount: row.amount, currency: row.currency, paidAt: row.paidAt, method: row.method, reference: row.reference, notes: row.notes, createdBy: scope.actorUserId } });
    await tx.purchasePaymentApproval.update({ where: { id }, data: { status: 'CONSUMED', settledPaymentId: payment.id, revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.payment.record', entityType: 'PurchasePayment', entityId: payment.id, metadata: { workspaceId: scope.workspaceId, purchaseOrderId: order.id, approvalId: id, reference: row.reference, amount: row.amount.toString(), currency: row.currency } } });
    return { payment, reused: false };
  });
}

/** Caller authorizes operations.edit through the existing API permission gate. */
export async function editPurchaseDraft(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '采购单 ID');
  const revision = requireRevision(body.revision);
  const draft = parsePurchaseDraft(body);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const current = await tx.purchaseOrder.findFirst({ where: { ...scoped(scope), id } });
    if (!current) throw new WmsError('采购单不存在或不属于当前工作区。', 404);
    if (current.status !== 'DRAFT' || current.wmsReceiptIds.length || current.revision !== revision) throw new WmsError('仅可编辑当前版本且未关联收货单的采购草稿，请刷新后重试。', 409);
    if (!await tx.supplier.findFirst({ where: { organizationId: scope.organizationId, id: draft.supplierId } })) throw new WmsError('供应商不属于当前组织。', 400);
    if (await tx.productRecord.count({ where: { ...scoped(scope), id: { in: draft.lines.map(line => line.productRecordId) } } }) !== draft.lines.length) throw new WmsError('部分商品不属于当前工作区。', 400);
    const { lines, ...header } = draft;
    const order = await tx.purchaseOrder.update({ where: { id }, data: { ...header, revision: { increment: 1 }, lines: { deleteMany: {}, create: lines.map(line => ({ ...line, id: crypto.randomUUID(), unitPrice: new Prisma.Decimal(line.unitPrice) })) } }, include: { supplier: { select: { id: true, name: true } }, lines: { include: { product: { select: { sku: true, chineseName: true, englishName: true } } } } } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.order.edit-draft', entityType: 'PurchaseOrder', entityId: id, metadata: { workspaceId: scope.workspaceId, previousRevision: revision, revision: order.revision, lineCount: lines.length } } });
    return { ...order, lines: order.lines.map(line => ({ ...line, unitPrice: line.unitPrice.toString() })) };
  });
}

/** Cancellation preserves purchase evidence and never mutates WMS inventory. */
export async function cancelPurchaseOrder(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'revision', 'reason']);
  const id = requireText(body.id, '采购单 ID');
  const revision = requireRevision(body.revision);
  const reason = requireText(body.reason, '作废原因', 500);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const current = await tx.purchaseOrder.findFirst({ where: { ...scoped(scope), id } });
    if (!current) throw new WmsError('采购单不存在或不属于当前工作区。', 404);
    if (current.revision !== revision) throw new WmsError('采购单版本已变化，请刷新后核对。', 409);
    const directlyCancellable = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED'].includes(current.status) && current.wmsReceiptIds.length === 0;
    let cancelledReceipts = current.status === 'RECEIVING' && current.wmsReceiptIds.length > 0;
    if (cancelledReceipts) {
      for (const receiptId of [...current.wmsReceiptIds].sort()) await tx.$queryRaw`SELECT id FROM "WmsReceipt" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${receiptId} FOR UPDATE`;
      const receipts = await tx.wmsReceipt.findMany({ where: { ...scoped(scope), id: { in: current.wmsReceiptIds } }, select: { id: true, status: true } });
      cancelledReceipts = receipts.length === current.wmsReceiptIds.length && receipts.every(receipt => receipt.status === 'CANCELLED');
    }
    if (!directlyCancellable && !cancelledReceipts) throw new WmsError('仅可作废未关联收货单的草稿/已下单采购单，或所有关联 WMS 收货草稿均已取消的采购单。', 409);
    const order = await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED', revision: { increment: 1 } } });
    await tx.purchaseOrderApproval.updateMany({ where: { ...scoped(scope), purchaseOrderId: id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'CANCELLED', revision: { increment: 1 }, decisionReason: reason } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.order.cancel', entityType: 'PurchaseOrder', entityId: id, metadata: { workspaceId: scope.workspaceId, previousStatus: current.status, previousRevision: revision, revision: order.revision, reason } } });
    return order;
  });
}
