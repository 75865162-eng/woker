import { prisma } from '@/lib/db/prisma';
import { auditEntity, authorizeEntity, scoped } from './access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText } from '@/lib/wms/rules';
import { dayKey, performanceVerdict, requireDate, requireEnum, requireInt, sentimentOf } from './rules';

export async function saveReview(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '评论 ID', 64) : null;
  const rating = requireInt(body.rating, '星级', { min: 1, max: 5 });
  const reviewedAt = requireDate(body.reviewedAt, '评论日期');
  const draft = {
    marketplace: typeof body.marketplace === 'string' && body.marketplace ? body.marketplace : 'US',
    asin: typeof body.asin === 'string' ? body.asin.trim().slice(0, 20) : '',
    sellerSku: typeof body.sellerSku === 'string' ? body.sellerSku.trim().slice(0, 120) : '',
    rating, sentiment: sentimentOf(rating),
    title: typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '',
    content: typeof body.content === 'string' ? body.content.trim().slice(0, 4000) : '',
    reviewer: typeof body.reviewer === 'string' ? body.reviewer.trim().slice(0, 80) : '',
    reviewedAt,
    source: requireEnum(body.source, '来源', ['MANUAL', 'SPAPI_REPORT', 'IMPORT'] as const, 'MANUAL'),
    externalId: typeof body.externalId === 'string' && body.externalId.trim() ? body.externalId.trim().slice(0, 120) : null,
  };
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, id ? 'edit' : 'create');
    if (id) {
      const current = await tx.reviewRecord.findFirst({ where: { ...scoped(scope), id } });
      if (!current) throw new WmsError('评论不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('评论已被他人修改，请刷新后重试。', 409);
      const updated = await tx.reviewRecord.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'review.update', id, { rating, sentiment: draft.sentiment });
      return updated;
    }
    const created = await tx.reviewRecord.create({ data: { id: crypto.randomUUID(), ...scoped(scope), ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'review.create', created.id, { rating, sentiment: draft.sentiment });
    return created;
  });
}

export async function decideReview(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '评论 ID', 64);
  const action = requireEnum(body.action, '处理动作', ['reply', 'ignore', 'reopen'] as const);
  const replyText = action === 'reply' ? requireText(body.replyText, '回复内容', 2000) : '';
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const current = await tx.reviewRecord.findFirst({ where: { ...scoped(scope), id } });
    if (!current) throw new WmsError('评论不存在。', 404);
    if (current.revision !== requireRevision(body.revision)) throw new WmsError('评论已被他人修改，请刷新后重试。', 409);
    const updated = await tx.reviewRecord.update({
      where: { id },
      data: {
        status: action === 'reply' ? 'REPLIED' : action === 'ignore' ? 'IGNORED' : 'NEW',
        replyText: action === 'reply' ? replyText : '', repliedAt: action === 'reply' ? new Date() : null,
        revision: { increment: 1 },
      },
    });
    await auditEntity(tx, scope, `review.${action}`, id, { rating: current.rating });
    return updated;
  });
}

export async function capturePerformance(scope: WmsScope, body: Record<string, unknown>) {
  const periodStart = requireDate(body.periodStart, '统计开始日');
  const periodEnd = requireDate(body.periodEnd, '统计结束日');
  if (periodEnd < periodStart) throw new WmsError('统计结束日不能早于开始日。', 400);
  const draft = {
    marketplace: typeof body.marketplace === 'string' && body.marketplace ? body.marketplace : 'US',
    periodStart, periodEnd,
    totalOrders: requireInt(body.totalOrders, '订单量'),
    orderDefectRateBp: requireInt(body.orderDefectRateBp, '订单缺陷率（万分比）', { max: 10_000 }),
    lateShipmentRateBp: requireInt(body.lateShipmentRateBp, '迟发率（万分比）', { max: 10_000 }),
    cancellationRateBp: requireInt(body.cancellationRateBp, '取消率（万分比）', { max: 10_000 }),
    validTrackingRateBp: requireInt(body.validTrackingRateBp, '有效追踪率（万分比）', { max: 10_000 }),
    negativeFeedbackRateBp: requireInt(body.negativeFeedbackRateBp, '差评率（万分比）', { max: 10_000 }),
    policyReference: requireText(body.policyReference, '口径依据', 300),
  };
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const exist = await tx.storePerformanceSnapshot.findFirst({ where: { ...scoped(scope), marketplace: draft.marketplace, periodStart } });
    if (exist) throw new WmsError(`${draft.marketplace} ${dayKey(periodStart)} 已有绩效快照，不允许静默覆盖。`, 409);
    const created = await tx.storePerformanceSnapshot.create({ data: { id: crypto.randomUUID(), ...scoped(scope), ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'performance.capture', created.id, { marketplace: draft.marketplace, period: dayKey(periodStart) });
    return { ...created, verdict: performanceVerdict(draft) };
  });
}
