import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { scoped } from '@/lib/wms/access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText, strictKeys } from '@/lib/wms/rules';

const lifetimeMs = 7 * 24 * 60 * 60 * 1000;
type RefundInput = { amount: Prisma.Decimal; refundedAt: Date; method: string; reference: string; notes: string };

function parseInput(body: Record<string, unknown>) {
  const paymentId = requireText(body.paymentId, '原付款 ID');
  const amountText = typeof body.amount === 'string' ? body.amount.trim() : '';
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(amountText) || new Prisma.Decimal(amountText).lte(0)) throw new WmsError('退款金额须为大于 0 且最多 6 位小数的有效金额。', 400);
  const dateText = typeof body.refundedAt === 'string' ? body.refundedAt : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || Number.isNaN(Date.parse(`${dateText}T00:00:00Z`)) || new Date(`${dateText}T00:00:00Z`).toISOString().slice(0, 10) !== dateText) throw new WmsError('退款日期无效。', 400);
  const method = requireText(body.method, '退款方式', 40);
  const reference = requireText(body.reference, '退款流水号', 120);
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (notes.length > 500) throw new WmsError('退款备注不能超过 500 字。', 400);
  return { paymentId, input: { amount: new Prisma.Decimal(amountText), refundedAt: new Date(`${dateText}T00:00:00.000Z`), method, reference, notes } };
}

function requestHash(input: RefundInput, currency: string) {
  return createHash('sha256').update(JSON.stringify({ ...input, amount: input.amount.toString(), refundedAt: input.refundedAt.toISOString(), currency })).digest('hex');
}

async function assertRefundCapacity(tx: Prisma.TransactionClient, scope: WmsScope, payment: { id: string; amount: Prisma.Decimal }, amount: Prisma.Decimal, excludeApprovalId?: string) {
  const [settled, reserved] = await Promise.all([
    tx.purchasePaymentRefund.aggregate({ where: { ...scoped(scope), paymentId: payment.id }, _sum: { amount: true } }),
    tx.purchasePaymentRefundApproval.aggregate({ where: { ...scoped(scope), paymentId: payment.id, ...(excludeApprovalId ? { id: { not: excludeApprovalId } } : {}), status: { in: ['PENDING', 'APPROVED'] }, expiresAt: { gt: new Date() } }, _sum: { amount: true } }),
  ]);
  if (amount.add(settled._sum.amount ?? 0).add(reserved._sum.amount ?? 0).gt(payment.amount)) throw new WmsError('退款金额超过该笔原付款的未退余额（含待复核退款）。', 422);
}

export async function submitPurchaseRefundApproval(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'paymentId', 'amount', 'refundedAt', 'method', 'reference', 'notes']);
  const { paymentId, input } = parseInput(body);
  return prisma.$transaction(async tx => {
    const identity = await tx.purchasePayment.findFirst({ where: { ...scoped(scope), id: paymentId }, select: { purchaseOrderId: true } });
    if (!identity) throw new WmsError('原付款不存在或不属于当前工作区。', 404);
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.purchaseOrderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "PurchasePayment" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${paymentId} FOR UPDATE`;
    const payment = await tx.purchasePayment.findFirst({ where: { ...scoped(scope), id: paymentId } });
    if (!payment) throw new WmsError('原付款不存在或不属于当前工作区。', 404);
    const hash = requestHash(input, payment.currency);
    const existing = await tx.purchasePaymentRefundApproval.findFirst({ where: { ...scoped(scope), purchaseOrderId: payment.purchaseOrderId, reference: input.reference, status: { in: ['PENDING', 'APPROVED'] }, expiresAt: { gt: new Date() } } });
    if (existing) {
      if (existing.requestedBy === scope.actorUserId && existing.requestHash === hash) return { approval: existing, reused: true };
      throw new WmsError('该退款流水号已有待处理复核。', 409);
    }
    if (await tx.purchasePaymentRefund.findFirst({ where: { ...scoped(scope), purchaseOrderId: payment.purchaseOrderId, reference: input.reference }, select: { id: true } })) throw new WmsError('该退款流水号已登记。', 409);
    await assertRefundCapacity(tx, scope, payment, input.amount);
    const approval = await tx.purchasePaymentRefundApproval.create({ data: { id: crypto.randomUUID(), organizationId: scope.organizationId, workspaceId: scope.workspaceId, purchaseOrderId: payment.purchaseOrderId, paymentId, ...input, currency: payment.currency, requestHash: hash, requestedBy: scope.actorUserId, expiresAt: new Date(Date.now() + lifetimeMs) } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.refund.submit-approval', entityType: 'PurchasePaymentRefundApproval', entityId: approval.id, metadata: { workspaceId: scope.workspaceId, purchaseOrderId: payment.purchaseOrderId, paymentId, reference: input.reference, amount: input.amount.toString(), currency: payment.currency } } });
    return { approval, reused: false };
  });
}

export async function decidePurchaseRefundApproval(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['id', 'revision', 'decision', 'reason']);
  const id = requireText(body.id, '退款复核 ID');
  const revision = requireRevision(body.revision);
  if (body.decision !== 'APPROVE' && body.decision !== 'REJECT') throw new WmsError('复核决定无效。', 400);
  const approved = body.decision === 'APPROVE';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!approved && !reason) throw new WmsError('拒绝退款复核时必须填写原因。', 400);
  return prisma.$transaction(async tx => {
    const identity = await tx.purchasePaymentRefundApproval.findFirst({ where: { ...scoped(scope), id }, select: { purchaseOrderId: true, paymentId: true } });
    if (!identity) throw new WmsError('退款复核记录不存在。', 404);
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.purchaseOrderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "PurchasePayment" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.paymentId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "PurchasePaymentRefundApproval" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const row = await tx.purchasePaymentRefundApproval.findFirst({ where: { ...scoped(scope), id } });
    if (!row) throw new WmsError('退款复核记录不存在。', 404);
    if (row.requestedBy === scope.actorUserId) throw new WmsError('退款复核禁止申请人自批。', 403);
    const nextStatus = approved ? 'APPROVED' : 'REJECTED';
    if (row.approvedBy === scope.actorUserId && row.status === nextStatus && row.revision === revision + 1) return row;
    if (approved && row.approvedBy === scope.actorUserId && row.status === 'CONSUMED' && row.revision === revision + 2) return row;
    if (row.status !== 'PENDING' || row.revision !== revision || row.expiresAt.getTime() <= Date.now()) throw new WmsError('退款复核已过期或版本已变化。', 409);
    const payment = await tx.purchasePayment.findFirst({ where: { ...scoped(scope), id: row.paymentId } });
    if (!payment || row.purchaseOrderId !== payment.purchaseOrderId || row.currency !== payment.currency || requestHash({ amount: row.amount, refundedAt: row.refundedAt, method: row.method, reference: row.reference, notes: row.notes }, row.currency) !== row.requestHash) throw new WmsError('原付款或退款凭证内容已变化。', 409);
    if (approved) await assertRefundCapacity(tx, scope, payment, row.amount, id);
    const decided = await tx.purchasePaymentRefundApproval.update({ where: { id }, data: { status: nextStatus, approvedBy: scope.actorUserId, decisionReason: reason, revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: `procurement.refund.approval.${approved ? 'approve' : 'reject'}`, entityType: 'PurchasePaymentRefundApproval', entityId: id, metadata: { workspaceId: scope.workspaceId, purchaseOrderId: row.purchaseOrderId, paymentId: row.paymentId, reference: row.reference, reason } } });
    return decided;
  });
}

export async function cancelPurchaseRefundApproval(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'revision']);
  const id = requireText(body.id, '退款复核 ID');
  const revision = requireRevision(body.revision);
  return prisma.$transaction(async tx => {
    const identity = await tx.purchasePaymentRefundApproval.findFirst({ where: { ...scoped(scope), id }, select: { purchaseOrderId: true, paymentId: true } });
    if (!identity) throw new WmsError('退款复核记录不存在。', 404);
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.purchaseOrderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "PurchasePayment" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.paymentId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "PurchasePaymentRefundApproval" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const row = await tx.purchasePaymentRefundApproval.findFirst({ where: { ...scoped(scope), id } });
    if (!row) throw new WmsError('退款复核记录不存在。', 404);
    if (row.status === 'CANCELLED' && row.requestedBy === scope.actorUserId && row.revision === revision + 1) return { approval: row, reused: true };
    if (row.requestedBy !== scope.actorUserId) throw new WmsError('只有原申请人可以撤销退款申请。', 403);
    if (row.status !== 'PENDING' || row.revision !== revision) throw new WmsError('只有当前版本的待复核退款申请可以撤销。', 409);
    const approval = await tx.purchasePaymentRefundApproval.update({ where: { id }, data: { status: 'CANCELLED', decisionReason: '申请人撤销', revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.refund.cancel-approval', entityType: 'PurchasePaymentRefundApproval', entityId: id, metadata: { workspaceId: scope.workspaceId, purchaseOrderId: row.purchaseOrderId, paymentId: row.paymentId, reference: row.reference, amount: row.amount.toString(), currency: row.currency } } });
    return { approval, reused: false };
  });
}

export async function confirmPurchaseRefund(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'revision']);
  const id = requireText(body.id, '退款复核 ID');
  const revision = requireRevision(body.revision);
  return prisma.$transaction(async tx => {
    const identity = await tx.purchasePaymentRefundApproval.findFirst({ where: { ...scoped(scope), id }, select: { purchaseOrderId: true, paymentId: true } });
    if (!identity) throw new WmsError('退款复核记录不存在。', 404);
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.purchaseOrderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "PurchasePayment" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.paymentId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "PurchasePaymentRefundApproval" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const row = await tx.purchasePaymentRefundApproval.findFirst({ where: { ...scoped(scope), id } });
    if (!row) throw new WmsError('退款复核记录不存在。', 404);
    if (row.status === 'CONSUMED' && row.requestedBy === scope.actorUserId && row.settledRefundId) {
      const refund = await tx.purchasePaymentRefund.findFirst({ where: { ...scoped(scope), id: row.settledRefundId } });
      if (refund) return { refund, reused: true };
    }
    const payment = await tx.purchasePayment.findFirst({ where: { ...scoped(scope), id: row.paymentId } });
    if (!payment || row.purchaseOrderId !== payment.purchaseOrderId || row.currency !== payment.currency || row.status !== 'APPROVED' || row.revision !== revision || row.expiresAt.getTime() <= Date.now() || row.requestedBy !== scope.actorUserId || !row.approvedBy || row.approvedBy === scope.actorUserId) throw new WmsError('只有原申请人可以确认有效的已批准退款。', 409);
    if (requestHash({ amount: row.amount, refundedAt: row.refundedAt, method: row.method, reference: row.reference, notes: row.notes }, row.currency) !== row.requestHash) throw new WmsError('退款凭证内容已变化。', 409);
    await assertRefundCapacity(tx, scope, payment, row.amount, id);
    const refund = await tx.purchasePaymentRefund.create({ data: { id: crypto.randomUUID(), organizationId: scope.organizationId, workspaceId: scope.workspaceId, purchaseOrderId: row.purchaseOrderId, paymentId: payment.id, amount: row.amount, currency: row.currency, refundedAt: row.refundedAt, method: row.method, reference: row.reference, notes: row.notes, createdBy: scope.actorUserId } });
    await tx.purchasePaymentRefundApproval.update({ where: { id }, data: { status: 'CONSUMED', settledRefundId: refund.id, revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.refund.record', entityType: 'PurchasePaymentRefund', entityId: refund.id, metadata: { workspaceId: scope.workspaceId, purchaseOrderId: row.purchaseOrderId, paymentId: payment.id, approvalId: id, reference: row.reference, amount: row.amount.toString(), currency: row.currency } } });
    return { refund, reused: false };
  });
}
