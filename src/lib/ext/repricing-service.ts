import { prisma } from '@/lib/db/prisma';
import { auditEntity, authorizeEntity, scoped } from './access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText } from '@/lib/wms/rules';
import { moneyInput } from './pricing';
import { requireEnum, requireInt, suggestPrice, type RepricingRuleLike } from './rules';

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

export async function saveRepricingRule(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '规则 ID', 64) : null;
  const floorPrice = moneyInput(body, 'floorPrice', '地板价');
  const ceilingPrice = moneyInput(body, 'ceilingPrice', '天花板价', { min: floorPrice });
  const draft = {
    name: requireText(body.name, '规则名称', 80),
    marketplace: typeof body.marketplace === 'string' && body.marketplace ? body.marketplace : 'US',
    strategy: requireEnum(body.strategy, '调价策略', ['MATCH_LOWEST', 'BEAT_LOWEST', 'HOLD'] as const, 'MATCH_LOWEST'),
    floorPrice, ceilingPrice,
    stepAmount: moneyInput(body, 'stepAmount', '步长'),
    minMarginBp: requireInt(body.minMarginBp ?? 0, '最低毛利（万分比）', { min: -10_000, max: 10_000 }),
    enabled: body.enabled !== false,
    notes: typeof body.notes === 'string' ? body.notes.slice(0, 500) : '',
  };
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, id ? 'edit' : 'create');
    if (id) {
      const current = await tx.repricingRule.findFirst({ where: { ...scoped(scope), id } });
      if (!current) throw new WmsError('调价规则不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('规则已被他人修改，请刷新后重试。', 409);
      const updated = await tx.repricingRule.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'repricing-rule.update', id, { name: draft.name });
      return updated;
    }
    const created = await tx.repricingRule.create({ data: { id: crypto.randomUUID(), ...scoped(scope), ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'repricing-rule.create', created.id, { name: draft.name });
    return created;
  });
}

export async function saveOfferWatch(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '观察 ID', 64) : null;
  const asin = requireText(body.asin, 'ASIN', 20);
  const marketplace = typeof body.marketplace === 'string' && body.marketplace ? body.marketplace : 'US';
  const myPrice = moneyInput(body, 'myPrice', '我的价格');
  const buyBoxPrice = moneyInput(body, 'buyBoxPrice', '购物车价');
  const lowestCompetitorPrice = moneyInput(body, 'lowestCompetitorPrice', '最低竞争价');
  const competitorCount = requireInt(body.competitorCount ?? 0, '跟卖数量', { max: 9999 });
  const buyBoxOwner = typeof body.buyBoxOwner === 'string' ? body.buyBoxOwner.trim().slice(0, 120) : '';
  const buyBoxStatus = competitorCount === 0 ? 'WINNING' : (buyBoxPrice > 0 && myPrice <= buyBoxPrice ? 'WINNING' : 'LOSING');
  const draft = {
    marketplace, asin,
    sellerSku: typeof body.sellerSku === 'string' ? body.sellerSku.trim().slice(0, 120) : '',
    myPrice, buyBoxPrice, lowestCompetitorPrice, competitorCount, buyBoxOwner, buyBoxStatus,
    lastSeenAt: new Date(),
  };
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, id ? 'edit' : 'create');
    if (id) {
      const current = await tx.competitorOfferWatch.findFirst({ where: { ...scoped(scope), id } });
      if (!current) throw new WmsError('跟卖观察不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('观察记录已被他人修改，请刷新后重试。', 409);
      const updated = await tx.competitorOfferWatch.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'offer-watch.update', id, { asin, buyBoxStatus });
      return updated;
    }
    const created = await tx.competitorOfferWatch.create({ data: { id: crypto.randomUUID(), ...scoped(scope), ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'offer-watch.create', created.id, { asin, buyBoxStatus });
    return created;
  });
}

/** 生成调价建议：只入队列，不改线上价。规则未启用的 ASIN 跳过。 */
export async function generateRepricingQueue(scope: WmsScope, body: Record<string, unknown>) {
  const ruleId = body.ruleId ? requireText(body.ruleId, '规则 ID', 64) : '';
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'create');
    const where = scoped(scope);
    const rule = ruleId
      ? await tx.repricingRule.findFirst({ where: { ...where, id: ruleId } })
      : await tx.repricingRule.findFirst({ where: { ...where, enabled: true }, orderBy: { createdAt: 'asc' } });
    if (!rule) throw new WmsError('没有可用的调价规则，请先新建并启用一条。', 400);
    if (!rule.enabled) throw new WmsError('该规则已停用，不能生成调价建议。', 400);
    const offers = await tx.competitorOfferWatch.findMany({ where: { ...where, marketplace: rule.marketplace }, take: 500 });
    if (!offers.length) throw new WmsError('当前站点还没有跟卖观察数据，先录入或同步竞品报价。', 400);
    const ruleLike: RepricingRuleLike = {
      strategy: rule.strategy as RepricingRuleLike['strategy'],
      floorPrice: num(rule.floorPrice), ceilingPrice: num(rule.ceilingPrice),
      stepAmount: num(rule.stepAmount), minMarginBp: rule.minMarginBp,
    };
    const pendingAsins = new Set((await tx.repricingQueueItem.findMany({ where: { ...where, status: 'PENDING' }, select: { asin: true } })).map(row => row.asin));
    let created = 0;
    for (const offer of offers) {
      if (pendingAsins.has(offer.asin)) continue;
      const suggestion = suggestPrice({
        myPrice: num(offer.myPrice), buyBoxPrice: num(offer.buyBoxPrice),
        lowestCompetitorPrice: num(offer.lowestCompetitorPrice), rule: ruleLike,
      });
      if (Math.abs(suggestion.price - num(offer.myPrice)) < 0.005) continue;
      await tx.repricingQueueItem.create({
        data: {
          id: crypto.randomUUID(), ...where, marketplace: offer.marketplace, asin: offer.asin,
          sellerSku: offer.sellerSku, ruleId: rule.id, currentPrice: num(offer.myPrice),
          suggestedPrice: suggestion.price, reason: suggestion.reason, createdBy: scope.actorUserId,
        },
      });
      created += 1;
    }
    await auditEntity(tx, scope, 'repricing.generate', rule.id, { ruleId: rule.id, created, offers: offers.length });
    return { created, scanned: offers.length, rule: rule.name };
  });
}

export async function decideQueueItem(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '队列 ID', 64);
  const decision = requireEnum(body.decision, '处理结果', ['apply', 'dismiss'] as const);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'approve');
    const current = await tx.repricingQueueItem.findFirst({ where: { ...scoped(scope), id } });
    if (!current) throw new WmsError('调价建议不存在。', 404);
    if (current.status !== 'PENDING') throw new WmsError('该建议已处理，不能重复操作。', 409);
    const appliedPrice = decision === 'apply' ? moneyInput(body, 'appliedPrice', '落地价') : null;
    const updated = await tx.repricingQueueItem.update({
      where: { id },
      data: {
        status: decision === 'apply' ? 'APPLIED' : 'DISMISSED',
        appliedPrice,
        decidedBy: scope.actorUserId,
        decidedAt: new Date(),
      },
    });
    await auditEntity(tx, scope, `repricing.${decision}`, id, { asin: current.asin, from: num(current.currentPrice), to: appliedPrice });
    return updated;
  });
}
