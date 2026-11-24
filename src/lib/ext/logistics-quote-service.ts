/**
 * 采购物流升级（2026-11-24，对标 wimoor 独立 wimoor-quote 模块）。
 * 物流渠道 / 关联设置 / 集中询价 / 报价单 / 采购退货单 / 采购报表。
 *
 * 架构红线：报价为内部管理事实，不自动写回货代或 Amazon，不覆盖核心主档；
 * 报价金额一律 Decimal(20,6)，序列化走 .toString()；审批三段式复用采购域范式。
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { auditEntity, authorizeEntity, json, scoped } from './access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText } from '@/lib/wms/rules';
import { requireEnum, requireInt, requireMoney, optionalDate } from './rules';

const MODES = ['AIR', 'SEA', 'RAIL', 'EXPRESS', 'TRUCK'] as const;
const REQ_STATUS = ['DRAFT', 'SUBMITTED', 'QUOTED', 'ACCEPTED', 'CLOSED', 'CANCELLED'] as const;
const QUOTE_STATUS = ['DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED'] as const;
const RETURN_STATUS = ['DRAFT', 'SUBMITTED', 'APPROVED', 'SHIPPED', 'CLOSED', 'CANCELLED'] as const;

const dec = (value: unknown, label: string) => new Prisma.Decimal(requireMoney(value, label).toString());
const shortText = (value: unknown, label: string, max = 120) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function nextNumber(prefix: string, count: number) {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${prefix}${stamp}-${String(count + 1).padStart(4, '0')}`;
}

/** 状态机转移表导出为纯数据，供单测锁定，避免审批状态被随意跳过。 */
export const quoteRequestTransitions: Record<string, readonly string[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['QUOTED', 'CLOSED', 'CANCELLED'],
  QUOTED: ['ACCEPTED', 'CLOSED', 'CANCELLED'],
  ACCEPTED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};
export const quoteTransitions: Record<string, readonly string[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: [],
};
export const purchaseReturnTransitions: Record<string, readonly string[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

// ---------- 物流渠道 ----------

export async function saveQuoteChannel(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '渠道 ID', 64) : null;
  const draft = {
    code: requireText(body.code, '渠道编码', 40).toUpperCase(),
    name: requireText(body.name, '渠道名称', 80),
    mode: requireEnum(body.mode, '头程方式', MODES, 'SEA'),
    destination: shortText(body.destination, '目的地', 120),
    enabled: body.enabled !== false,
  };
  const pricingRule = body.pricingRule && typeof body.pricingRule === 'object' ? json(body.pricingRule) : Prisma.DbNull;
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.logisticsQuoteChannel.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('物流渠道不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('渠道已被他人修改，请刷新后重试。', 409);
      const updated = await tx.logisticsQuoteChannel.update({ where: { id }, data: { ...draft, pricingRule, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'quote-channel.update', id, { code: draft.code });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const created = await tx.logisticsQuoteChannel.create({ data: { id: crypto.randomUUID(), ...where, ...draft, pricingRule, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'quote-channel.create', created.id, { code: draft.code });
    return created;
  });
}

// ---------- 关联设置 ----------

export async function saveQuoteRule(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '规则 ID', 64) : null;
  const draft = {
    channelId: requireText(body.channelId, '物流渠道', 64),
    matchKey: shortText(body.matchKey, '匹配值', 80),
    matchType: requireEnum(body.matchType, '匹配类型', ['SKU', 'WAREHOUSE', 'DESTINATION'] as const, 'SKU'),
    priority: requireInt(body.priority ?? 100, '优先级', { min: 1, max: 9999 }),
    enabled: body.enabled !== false,
  };
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    const channel = await tx.logisticsQuoteChannel.findFirst({ where: { ...where, id: draft.channelId } });
    if (!channel) throw new WmsError('物流渠道不存在或不属于当前工作区。', 404);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.logisticsQuoteRule.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('规则不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('规则已被他人修改，请刷新后重试。', 409);
      const updated = await tx.logisticsQuoteRule.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'quote-rule.update', id, { channelId: draft.channelId });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const created = await tx.logisticsQuoteRule.create({ data: { id: crypto.randomUUID(), ...where, ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'quote-rule.create', created.id, { channelId: draft.channelId });
    return created;
  });
}

// ---------- 集中询价 ----------

export async function saveQuoteRequest(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '询价单 ID', 64) : null;
  const draft = {
    origin: shortText(body.origin, '始发地', 120),
    destination: shortText(body.destination, '目的地', 120),
    preferredMode: body.preferredMode ? requireEnum(body.preferredMode, '头程方式', MODES) : '',
    pieces: requireInt(body.pieces ?? 0, '件数', { max: 1_000_000 }),
    weightKg: dec(body.weightKg ?? 0, '重量（kg）'),
    volumeCbm: dec(body.volumeCbm ?? 0, '体积（CBM）'),
    needBy: optionalDate(body.needBy, '需求日期'),
    notes: shortText(body.notes, '备注', 500),
  };
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.logisticsQuoteRequest.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('询价单不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('询价单已被他人修改，请刷新后重试。', 409);
      // 已提交/已采纳的询价单不再改货件事实
      if (current.status !== 'DRAFT') throw new WmsError('已提交的询价单不可修改货件信息。', 400);
      const updated = await tx.logisticsQuoteRequest.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'quote-request.update', id, { number: current.number });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const count = await tx.logisticsQuoteRequest.count({ where });
    const created = await tx.logisticsQuoteRequest.create({
      data: { id: crypto.randomUUID(), ...where, number: nextNumber('QR', count), ...draft, createdBy: scope.actorUserId },
    });
    await auditEntity(tx, scope, 'quote-request.create', created.id, { number: created.number });
    return created;
  });
}

/** 询价单状态流转：SUBMITTED / ACCEPTED / CLOSED / CANCELLED。 */
export async function transitionQuoteRequest(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '询价单 ID', 64);
  const target = requireEnum(body.target, '目标状态', REQ_STATUS);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, target === 'CLOSED' || target === 'CANCELLED' ? 'approve' : 'edit');
    const where = scoped(scope);
    const current = await tx.logisticsQuoteRequest.findFirst({ where: { ...where, id } });
    if (!current) throw new WmsError('询价单不存在。', 404);
    if (current.revision !== requireRevision(body.revision)) throw new WmsError('询价单已被他人修改，请刷新后重试。', 409);
    if (!quoteRequestTransitions[current.status]?.includes(target)) throw new WmsError(`当前状态 ${current.status} 不能流转到 ${target}。`, 400);
    const updated = await tx.logisticsQuoteRequest.update({ where: { id }, data: { status: target, revision: { increment: 1 } } });
    await auditEntity(tx, scope, 'quote-request.transition', id, { from: current.status, to: target });
    return updated;
  });
}

// ---------- 报价单 ----------

export async function saveQuote(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '报价单 ID', 64) : null;
  const requestId = requireText(body.requestId, '关联询价单', 64);
  const draft = {
    requestId,
    channelId: typeof body.channelId === 'string' && body.channelId ? body.channelId : null,
    carrier: shortText(body.carrier, '承运商', 80),
    currency: (shortText(body.currency, '币种', 10) || 'CNY').toUpperCase(),
    totalAmount: dec(body.totalAmount ?? 0, '报价金额'),
    transitDays: requireInt(body.transitDays ?? 0, '运输时效（天）', { max: 365 }),
    validUntil: optionalDate(body.validUntil, '有效期至'),
    notes: shortText(body.notes, '备注', 500),
  };
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    const request = await tx.logisticsQuoteRequest.findFirst({ where: { ...where, id: requestId } });
    if (!request) throw new WmsError('询价单不存在或不属于当前工作区。', 404);
    if (draft.channelId) {
      const channel = await tx.logisticsQuoteChannel.findFirst({ where: { ...where, id: draft.channelId } });
      if (!channel) throw new WmsError('物流渠道不存在或不属于当前工作区。', 404);
    }
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.logisticsQuote.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('报价单不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('报价单已被他人修改，请刷新后重试。', 409);
      if (current.status !== 'DRAFT') throw new WmsError('已提交的报价单不可修改。', 400);
      const updated = await tx.logisticsQuote.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'quote.update', id, { number: current.number });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const count = await tx.logisticsQuote.count({ where });
    const created = await tx.logisticsQuote.create({
      data: { id: crypto.randomUUID(), ...where, number: nextNumber('LQ', count), ...draft, createdBy: scope.actorUserId },
    });
    // 首次报价回填询价状态 QUOTED
    if (request.status === 'SUBMITTED') {
      await tx.logisticsQuoteRequest.update({ where: { id: requestId }, data: { status: 'QUOTED', revision: { increment: 1 } } });
    }
    await auditEntity(tx, scope, 'quote.create', created.id, { number: created.number, requestId });
    return created;
  });
}

/** 报价状态流转；ACCEPTED 时会拒绝同一询价单下的其它报价，并标记询价 ACCEPTED。 */
export async function transitionQuote(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '报价单 ID', 64);
  const target = requireEnum(body.target, '目标状态', QUOTE_STATUS);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'approve');
    const where = scoped(scope);
    const current = await tx.logisticsQuote.findFirst({ where: { ...where, id } });
    if (!current) throw new WmsError('报价单不存在。', 404);
    if (current.revision !== requireRevision(body.revision)) throw new WmsError('报价单已被他人修改，请刷新后重试。', 409);
    if (!quoteTransitions[current.status]?.includes(target)) throw new WmsError(`当前状态 ${current.status} 不能流转到 ${target}。`, 400);
    const updated = await tx.logisticsQuote.update({ where: { id }, data: { status: target, revision: { increment: 1 } } });
    if (target === 'ACCEPTED') {
      await tx.logisticsQuote.updateMany({
        where: { ...where, requestId: current.requestId, id: { not: id }, status: { in: ['SUBMITTED', 'DRAFT'] } },
        data: { status: 'REJECTED', revision: { increment: 1 } },
      });
      await tx.logisticsQuoteRequest.update({ where: { id: current.requestId }, data: { status: 'ACCEPTED', revision: { increment: 1 } } });
    }
    await auditEntity(tx, scope, 'quote.transition', id, { from: current.status, to: target });
    return updated;
  });
}

// ---------- 采购退货单 ----------

export async function savePurchaseReturn(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '退货单 ID', 64) : null;
  const draft = {
    supplierId: shortText(body.supplierId, '供应商', 64),
    purchaseOrderId: shortText(body.purchaseOrderId, '采购单', 64),
    reason: shortText(body.reason, '退货原因', 300),
    lines: body.lines && typeof body.lines === 'object' ? json(body.lines) : Prisma.DbNull,
    amount: dec(body.amount ?? 0, '退货金额'),
    currency: (shortText(body.currency, '币种', 10) || 'CNY').toUpperCase(),
  };
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.purchaseReturn.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('退货单不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('退货单已被他人修改，请刷新后重试。', 409);
      if (current.status !== 'DRAFT') throw new WmsError('已提交的退货单不可修改。', 400);
      const updated = await tx.purchaseReturn.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'purchase-return.update', id, { number: current.number });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const count = await tx.purchaseReturn.count({ where });
    const created = await tx.purchaseReturn.create({
      data: { id: crypto.randomUUID(), ...where, number: nextNumber('PR', count), ...draft, createdBy: scope.actorUserId },
    });
    await auditEntity(tx, scope, 'purchase-return.create', created.id, { number: created.number });
    return created;
  });
}

export async function transitionPurchaseReturn(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '退货单 ID', 64);
  const target = requireEnum(body.target, '目标状态', RETURN_STATUS);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, target === 'APPROVED' || target === 'CLOSED' ? 'approve' : 'edit');
    const where = scoped(scope);
    const current = await tx.purchaseReturn.findFirst({ where: { ...where, id } });
    if (!current) throw new WmsError('退货单不存在。', 404);
    if (current.revision !== requireRevision(body.revision)) throw new WmsError('退货单已被他人修改，请刷新后重试。', 409);
    if (!purchaseReturnTransitions[current.status]?.includes(target)) throw new WmsError(`当前状态 ${current.status} 不能流转到 ${target}。`, 400);
    const updated = await tx.purchaseReturn.update({ where: { id }, data: { status: target, revision: { increment: 1 } } });
    await auditEntity(tx, scope, 'purchase-return.transition', id, { from: current.status, to: target });
    return updated;
  });
}
