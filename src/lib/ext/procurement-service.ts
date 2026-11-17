import { prisma } from "@/lib/db/prisma";
import { auditEntity, authorizeEntity, json, scoped } from "./access";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";
import { requireRevision, requireText } from "@/lib/wms/rules";
import { Prisma } from "@prisma/client";
import { optionalDate, parseExchangeLines, requireDate, requireEnum, requireInt, requireMoney } from "./rules";
const num = (value: unknown) => Number(value);

export async function savePaymentRequest(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '请款单 ID', 64) : null;
  const draft = {
    supplierId: requireText(body.supplierId, '供应商', 64),
    purchaseOrderId: typeof body.purchaseOrderId === 'string' ? body.purchaseOrderId.trim().slice(0, 64) : '',
    currency: typeof body.currency === 'string' && body.currency ? body.currency : 'CNY',
    amount: requireMoney(body.amount, '请款金额', { min: 0.000001 }),
    dueDate: requireDate(body.dueDate, '期望付款日'),
    purpose: requireText(body.purpose, '请款事由', 300),
  };
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.purchasePaymentRequest.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('请款单不存在。', 404);
      if (current.status !== 'DRAFT') throw new WmsError('只有草稿状态的请款单可以修改。', 409);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('请款单已被他人修改，请刷新后重试。', 409);
      const updated = await tx.purchasePaymentRequest.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'payment-request.update', id, { amount: draft.amount });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const supplier = await tx.supplier.findFirst({ where: { id: draft.supplierId, organizationId: scope.organizationId }, select: { id: true } });
    if (!supplier) throw new WmsError('供应商不存在或不属于当前组织。', 400);
    const created = await tx.purchasePaymentRequest.create({
      data: { id: crypto.randomUUID(), ...where, ...draft, number: await nextNumber(tx, scope, 'payment-request', 'PR'), createdBy: scope.actorUserId },
    });
    await auditEntity(tx, scope, 'payment-request.create', created.id, { number: created.number, amount: draft.amount });
    return created;
  });
}

export async function transitionPaymentRequest(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '请款单 ID', 64);
  const action = requireEnum(body.action, '流转动作', ['submit', 'approve', 'reject', 'pay'] as const);
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    const current = await tx.purchasePaymentRequest.findFirst({ where: { ...where, id } });
    if (!current) throw new WmsError('请款单不存在。', 404);
    if (current.revision !== requireRevision(body.revision)) throw new WmsError('请款单已被他人修改，请刷新后重试。', 409);
    const rules: Record<typeof action, { from: string[]; to: string; permission: 'create' | 'approve' | 'edit' }> = {
      submit: { from: ['DRAFT'], to: 'SUBMITTED', permission: 'create' },
      approve: { from: ['SUBMITTED'], to: 'APPROVED', permission: 'approve' },
      reject: { from: ['SUBMITTED'], to: 'REJECTED', permission: 'approve' },
      pay: { from: ['APPROVED'], to: 'PAID', permission: 'approve' },
    };
    const rule = rules[action];
    if (!rule.from.includes(current.status)) throw new WmsError(`当前状态 ${current.status} 不允许执行该动作。`, 409);
    await authorizeEntity(tx, scope, rule.permission);
    if (action === 'approve' && current.createdBy === scope.actorUserId) throw new WmsError('申请人不能审批自己提交的请款单。', 403);
    const updated = await tx.purchasePaymentRequest.update({
      where: { id },
      data: {
        status: rule.to,
        revision: { increment: 1 },
        ...(action === 'approve' ? { approvedBy: scope.actorUserId, approvedAt: new Date() } : {}),
        ...(action === 'reject' ? { rejectionReason: requireText(body.reason, '驳回原因', 300) } : {}),
        ...(action === 'pay' ? { paidAt: new Date() } : {}),
      },
    });
    await auditEntity(tx, scope, `payment-request.${action}`, id, { number: current.number, to: rule.to });
    return updated;
  });
}

export async function saveExchangeOrder(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '换货单 ID', 64) : null;
  const lines = parseExchangeLines(body.lines);
  const draft = {
    supplierId: requireText(body.supplierId, '供应商', 64),
    purchaseOrderId: typeof body.purchaseOrderId === 'string' ? body.purchaseOrderId.trim().slice(0, 64) : '',
    reason: requireText(body.reason, '换货原因', 300),
    expectedAt: optionalDate(body.expectedAt, '预计换回日期'),
    lines: json(lines),
    lineCount: lines.length,
  };
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.purchaseExchangeOrder.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('换货单不存在。', 404);
      if (!['DRAFT', 'SUBMITTED'].includes(current.status)) throw new WmsError('已审批的换货单不能再修改。', 409);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('换货单已被他人修改，请刷新后重试。', 409);
      const updated = await tx.purchaseExchangeOrder.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'exchange-order.update', id, { lineCount: lines.length });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const created = await tx.purchaseExchangeOrder.create({
      data: { id: crypto.randomUUID(), ...where, ...draft, number: await nextNumber(tx, scope, 'exchange-order', 'EX'), createdBy: scope.actorUserId },
    });
    await auditEntity(tx, scope, 'exchange-order.create', created.id, { number: created.number, lineCount: lines.length });
    return created;
  });
}

export async function transitionExchangeOrder(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '换货单 ID', 64);
  const action = requireEnum(body.action, '流转动作', ['submit', 'approve', 'ship', 'close'] as const);
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    const current = await tx.purchaseExchangeOrder.findFirst({ where: { ...where, id } });
    if (!current) throw new WmsError('换货单不存在。', 404);
    if (current.revision !== requireRevision(body.revision)) throw new WmsError('换货单已被他人修改，请刷新后重试。', 409);
    const rules: Record<typeof action, { from: string[]; to: string; permission: 'create' | 'approve' | 'edit' }> = {
      submit: { from: ['DRAFT'], to: 'SUBMITTED', permission: 'create' },
      approve: { from: ['SUBMITTED'], to: 'APPROVED', permission: 'approve' },
      ship: { from: ['APPROVED'], to: 'SHIPPED', permission: 'edit' },
      close: { from: ['SHIPPED'], to: 'CLOSED', permission: 'approve' },
    };
    const rule = rules[action];
    if (!rule.from.includes(current.status)) throw new WmsError(`当前状态 ${current.status} 不允许执行该动作。`, 409);
    await authorizeEntity(tx, scope, rule.permission);
    const updated = await tx.purchaseExchangeOrder.update({ where: { id }, data: { status: rule.to, revision: { increment: 1 } } });
    await auditEntity(tx, scope, `exchange-order.${action}`, id, { number: current.number, to: rule.to });
    return updated;
  });
}

export async function saveQuotation(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '报价单 ID', 64) : null;
  const draft = {
    supplierId: requireText(body.supplierId, '供应商', 64),
    productRecordId: typeof body.productRecordId === 'string' ? body.productRecordId.trim().slice(0, 64) : '',
    sellerSku: typeof body.sellerSku === 'string' ? body.sellerSku.trim().slice(0, 120) : '',
    currency: typeof body.currency === 'string' && body.currency ? body.currency : 'CNY',
    unitPrice: requireMoney(body.unitPrice, '单价', { min: 0.000001 }),
    moq: requireInt(body.moq ?? 1, '起订量', { min: 1 }),
    leadTimeDays: requireInt(body.leadTimeDays ?? 0, '交期（天）', { max: 365 }),
    validUntil: optionalDate(body.validUntil, '有效期至'),
    status: requireEnum(body.status, '报价状态', ['ACTIVE', 'EXPIRED', 'SELECTED'] as const, 'ACTIVE'),
    notes: typeof body.notes === 'string' ? body.notes.slice(0, 500) : '',
  };
  if (!draft.productRecordId && !draft.sellerSku) throw new WmsError('报价单必须关联商品或填写 SKU。', 400);
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.supplierQuotation.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('报价单不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('报价单已被他人修改，请刷新后重试。', 409);
      const updated = await tx.supplierQuotation.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'quotation.update', id, { unitPrice: draft.unitPrice });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const created = await tx.supplierQuotation.create({
      data: { id: crypto.randomUUID(), ...where, ...draft, number: await nextNumber(tx, scope, 'quotation', 'QT'), createdBy: scope.actorUserId },
    });
    await auditEntity(tx, scope, 'quotation.create', created.id, { number: created.number, unitPrice: draft.unitPrice });
    return created;
  });
}

export async function selectQuotation(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '报价单 ID', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'approve');
    const where = scoped(scope);
    const current = await tx.supplierQuotation.findFirst({ where: { ...where, id } });
    if (!current) throw new WmsError('报价单不存在。', 404);
    if (current.status !== 'ACTIVE') throw new WmsError('只有生效中的报价可以选定。', 409);
    await tx.supplierQuotation.updateMany({
      where: { ...where, status: 'SELECTED', productRecordId: current.productRecordId, sellerSku: current.sellerSku },
      data: { status: 'ACTIVE' },
    });
    const updated = await tx.supplierQuotation.update({ where: { id }, data: { status: 'SELECTED', revision: { increment: 1 } } });
    await auditEntity(tx, scope, 'quotation.select', id, { number: current.number, unitPrice: num(current.unitPrice) });
    return updated;
  });
}

async function nextNumber(tx: Prisma.TransactionClient, scope: WmsScope, kind: 'payment-request' | 'exchange-order' | 'quotation', prefix: string) {
  const stamp = new Date();
  const head = `${prefix}${stamp.getUTCFullYear()}${String(stamp.getUTCMonth() + 1).padStart(2, '0')}`;
  const table = { 'payment-request': 'PurchasePaymentRequest', 'exchange-order': 'PurchaseExchangeOrder', quotation: 'SupplierQuotation' }[kind];
  const rows = await tx.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    `SELECT count(*) AS c FROM "${table}" WHERE "organizationId"=$1 AND "workspaceId"=$2 AND "number" LIKE $3`,
    scope.organizationId, scope.workspaceId, `${head}%`,
  );
  return `${head}${String(Number(rows[0]?.c ?? 0) + 1).padStart(4, '0')}`;
}
