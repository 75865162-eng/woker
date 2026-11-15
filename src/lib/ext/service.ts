/**
 * 功能补全域服务层：8 个业务域的查询与写入。
 * 统一口径：先 authorize 再读写、每次写入留审计、主数据带 revision 乐观锁、金额 6 位定点。
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { auditEntity, authorizeEntity, json, scoped } from './access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText } from '@/lib/wms/rules';
import {
  cheapestQuotation,
  dayKey,
  forecastQty,
  optionalDate,
  parseExchangeLines,
  performanceVerdict,
  priceForMargin,
  quoteFbaFee,
  quoteProfit,
  requireDate,
  requireEnum,
  requireInt,
  requireMoney,
  sentimentOf,
  suggestPrice,
  taxAmountOf,
  taxPeriodOf,
  type FeeInput,
  type ProfitInput,
  type RepricingRuleLike,
} from './rules';

const listLimit = 300;
const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

const moneyInput = (row: Record<string, unknown>, key: string, label: string, options?: { min?: number }) =>
  requireMoney(row[key], label, options);

function feeInputFrom(row: Record<string, unknown>): FeeInput {
  return {
    price: moneyInput(row, 'price', '售价'),
    shipping: moneyInput(row, 'shipping', '买家运费'),
    weightOz: requireMoney(row.weightOz ?? 0, '单件重量（oz）'),
    lengthIn: requireMoney(row.lengthIn ?? 0, '长度（in）'),
    widthIn: requireMoney(row.widthIn ?? 0, '宽度（in）'),
    heightIn: requireMoney(row.heightIn ?? 0, '高度（in）'),
    oversize: row.oversize === true || row.oversize === 'true',
    referralRateBp: row.referralRateBp === undefined || row.referralRateBp === '' ? undefined : requireInt(row.referralRateBp, '佣金比例（万分比）', { max: 10_000 }),
    storageDays: row.storageDays === undefined || row.storageDays === '' ? 30 : requireInt(row.storageDays, '仓储天数', { max: 365 }),
  };
}

function profitInputFrom(row: Record<string, unknown>): ProfitInput {
  return {
    ...feeInputFrom(row),
    unitCost: moneyInput(row, 'unitCost', '采购成本'),
    inboundCost: moneyInput(row, 'inboundCost', '头程成本'),
    adCost: moneyInput(row, 'adCost', '广告费'),
    otherCost: moneyInput(row, 'otherCost', '其它费用'),
    returnRateBp: row.returnRateBp === undefined || row.returnRateBp === '' ? 0 : requireInt(row.returnRateBp, '退货率（万分比）', { max: 10_000 }),
  };
}

export function quoteOnly(kind: string, body: Record<string, unknown>) {
  if (kind === 'fee') return quoteFbaFee(feeInputFrom(body));
  const input = profitInputFrom(body);
  const result = quoteProfit(input);
  const targetMarginBp = requireInt(body.targetMarginBp ?? 2000, '目标毛利率（万分比）', { max: 9000 });
  return { ...result, targetMarginBp, targetPrice: priceForMargin(input, targetMarginBp) };
}

// ───────────────────────────── 查询 ─────────────────────────────

export async function queryExt(scope: WmsScope, kind: string, params: URLSearchParams) {
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'view');
    const where = scoped(scope);
    switch (kind) {
      case 'options': {
        const [suppliers, products, channels] = await Promise.all([
          tx.supplier.findMany({ where: { organizationId: scope.organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 }),
          tx.productRecord.findMany({ where, select: { id: true, sku: true, asin: true, chineseName: true, purchasePrice: true }, orderBy: { sku: 'asc' }, take: 500 }),
          tx.multiChannelAccount.findMany({ where: { ...where, status: 'ACTIVE' }, select: { id: true, channel: true, name: true }, orderBy: { name: 'asc' }, take: 100 }),
        ]);
        return { suppliers, products, channels };
      }
      case 'calc-schemes':
        return { items: await tx.calcScheme.findMany({ where, orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }], take: listLimit }) };
      case 'reviews': {
        const sentiment = params.get('sentiment') ?? '';
        const status = params.get('status') ?? '';
        const items = await tx.reviewRecord.findMany({
          where: { ...where, ...(sentiment ? { sentiment } : {}), ...(status ? { status } : {}) },
          orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
          take: listLimit,
        });
        const agg = await tx.reviewRecord.groupBy({ by: ['sentiment'], where, _count: { _all: true } });
        const counts = Object.fromEntries(agg.map(row => [row.sentiment, row._count._all]));
        const total = agg.reduce((sum, row) => sum + row._count._all, 0);
        const replied = await tx.reviewRecord.count({ where: { ...where, status: 'REPLIED' } });
        return {
          items: items.map(row => ({ ...row, reviewedAt: dayKey(row.reviewedAt) })),
          summary: {
            total,
            positive: counts.POSITIVE ?? 0,
            neutral: counts.NEUTRAL ?? 0,
            negative: counts.NEGATIVE ?? 0,
            replied,
            negativeRateBp: total > 0 ? Math.round(((counts.NEGATIVE ?? 0) / total) * 10_000) : 0,
            replyRateBp: total > 0 ? Math.round((replied / total) * 10_000) : 0,
          },
        };
      }
      case 'performance': {
        const items = await tx.storePerformanceSnapshot.findMany({ where, orderBy: [{ periodStart: 'desc' }], take: 60 });
        return {
          items: items.map(row => ({
            ...row,
            periodStart: dayKey(row.periodStart),
            periodEnd: dayKey(row.periodEnd),
            verdict: performanceVerdict(row),
          })),
        };
      }
      case 'repricing-rules':
        return { items: await tx.repricingRule.findMany({ where, orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }], take: 100 }) };
      case 'offers': {
        const items = await tx.competitorOfferWatch.findMany({ where, orderBy: [{ lastSeenAt: 'desc' }], take: listLimit });
        const losing = items.filter(row => row.buyBoxStatus === 'LOSING').length;
        return { items, summary: { total: items.length, losing, winning: items.filter(row => row.buyBoxStatus === 'WINNING').length } };
      }
      case 'queue': {
        const status = params.get('status') ?? 'PENDING';
        const items = await tx.repricingQueueItem.findMany({ where: { ...where, ...(status === 'ALL' ? {} : { status }) }, orderBy: { createdAt: 'desc' }, take: listLimit });
        return { items, pending: await tx.repricingQueueItem.count({ where: { ...where, status: 'PENDING' } }) };
      }
      case 'sales-plans': {
        const items = await tx.salesPlan.findMany({ where, orderBy: [{ periodStart: 'desc' }], include: { lines: { select: { targetQty: true, targetRevenue: true, forecastQty: true } } }, take: 100 });
        return {
          items: items.map(row => ({
            id: row.id, name: row.name, marketplace: row.marketplace, currency: row.currency, periodType: row.periodType,
            periodStart: dayKey(row.periodStart), periodEnd: dayKey(row.periodEnd), status: row.status, revision: row.revision,
            lineCount: row.lines.length,
            targetQty: row.lines.reduce((sum, line) => sum + line.targetQty, 0),
            targetRevenue: row.lines.reduce((sum, line) => sum + num(line.targetRevenue), 0),
            forecastQty: row.lines.reduce((sum, line) => sum + line.forecastQty, 0),
          })),
        };
      }
      case 'sales-plan': {
        const id = requireText(params.get('id'), '计划 ID', 64);
        const plan = await tx.salesPlan.findFirst({ where: { ...where, id }, include: { lines: { orderBy: { sellerSku: 'asc' } } } });
        if (!plan) throw new WmsError('销售计划不存在或不属于当前工作区。', 404);
        const actuals = await readPlanActuals(tx, scope, plan.periodStart, plan.periodEnd);
        return {
          plan: { ...plan, periodStart: dayKey(plan.periodStart), periodEnd: dayKey(plan.periodEnd) },
          lines: plan.lines.map(line => {
            const actual = actuals.get(line.sellerSku) ?? { qty: 0, revenue: 0 };
            const gap = actual.qty - line.targetQty;
            return {
              ...line,
              actualQty: actual.qty,
              actualRevenue: actual.revenue,
              gap,
              completionBp: line.targetQty > 0 ? Math.round((actual.qty / line.targetQty) * 10_000) : 0,
            };
          }),
          totals: {
            targetQty: plan.lines.reduce((sum, line) => sum + line.targetQty, 0),
            actualQty: plan.lines.reduce((sum, line) => sum + (actuals.get(line.sellerSku)?.qty ?? 0), 0),
            forecastQty: plan.lines.reduce((sum, line) => sum + line.forecastQty, 0),
          },
        };
      }
      case 'payment-requests':
        return { items: await tx.purchasePaymentRequest.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: listLimit }) };
      case 'exchange-orders':
        return { items: await tx.purchaseExchangeOrder.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: listLimit }) };
      case 'quotations': {
        const items = await tx.supplierQuotation.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: listLimit });
        const groups = new Map<string, typeof items>();
        for (const row of items) {
          const key = row.productRecordId || row.sellerSku || row.number;
          groups.set(key, [...(groups.get(key) ?? []), row]);
        }
        return {
          items,
          best: [...groups.entries()].map(([key, rows]) => ({ key, quotation: cheapestQuotation(rows.map(row => ({ id: row.id, unitPrice: num(row.unitPrice), leadTimeDays: row.leadTimeDays, number: row.number, supplierId: row.supplierId }))) })),
        };
      }
      case 'tax-invoices': {
        const period = params.get('period') ?? '';
        const items = await tx.taxInvoice.findMany({ where: { ...where, ...(period ? { filingPeriod: period } : {}) }, orderBy: [{ invoiceDate: 'desc' }], take: listLimit });
        const byDirection = { INPUT: { taxable: 0, tax: 0 }, OUTPUT: { taxable: 0, tax: 0 } };
        for (const row of items) {
          const bucket = row.direction === 'INPUT' ? byDirection.INPUT : byDirection.OUTPUT;
          bucket.taxable += num(row.taxableAmount);
          bucket.tax += num(row.taxAmount);
        }
        return {
          items: items.map(row => ({ ...row, invoiceDate: dayKey(row.invoiceDate) })),
          summary: { ...byDirection, payable: Math.round((byDirection.OUTPUT.tax - byDirection.INPUT.tax) * 1_000_000) / 1_000_000 },
        };
      }
      case 'tax-periods': {
        const items = await tx.taxFilingPeriod.findMany({ where, orderBy: [{ period: 'desc' }, { country: 'asc' }], take: 100 });
        return { items };
      }
      case 'channel-accounts':
        return { items: await tx.multiChannelAccount.findMany({ where, orderBy: [{ channel: 'asc' }, { name: 'asc' }], take: 100 }) };
      case 'channel-orders': {
        const channel = params.get('channel') ?? '';
        const items = await tx.multiChannelOrder.findMany({ where: { ...where, ...(channel ? { channel } : {}) }, orderBy: [{ orderedAt: 'desc' }], take: listLimit });
        const agg = await tx.multiChannelOrder.groupBy({ by: ['channel'], where, _sum: { amount: true }, _count: { _all: true } });
        return {
          items: items.map(row => ({ ...row, orderedAt: dayKey(row.orderedAt) })),
          summary: agg.map(row => ({ channel: row.channel, orders: row._count._all, amount: num(row._sum.amount) })),
        };
      }
      case 'dictionaries': {
        const items = await tx.dataDictionary.findMany({ where, orderBy: { code: 'asc' }, include: { items: { orderBy: [{ sort: 'asc' }, { value: 'asc' }] } }, take: 100 });
        return { items };
      }
      case 'custom-fields':
        return { items: await tx.customFieldDefinition.findMany({ where, orderBy: [{ entity: 'asc' }, { sortOrder: 'asc' }], take: 200 }) };
      default:
        throw new WmsError('不支持的域查询类型。', 400);
    }
  });
}

async function readPlanActuals(tx: Prisma.TransactionClient, scope: WmsScope, start: Date, end: Date) {
  const rows = await tx.$queryRaw<Array<{ sku: string; qty: number; revenue: number }>>(Prisma.sql`
    SELECT i."sellerSku" AS sku, SUM(i."quantityOrdered")::int AS qty, COALESCE(SUM(i."proceedsAmount"), 0)::float8 AS revenue
    FROM "AmazonOrderItemRecord" i
    JOIN "AmazonOrderRecord" o ON o."id" = i."orderRecordId" AND o."organizationId" = i."organizationId" AND o."workspaceId" = i."workspaceId" AND o."sourceId" = i."sourceId"
    WHERE i."organizationId" = ${scope.organizationId} AND i."workspaceId" = ${scope.workspaceId}
      AND o."createdTime" >= ${start} AND o."createdTime" < ${end}
      AND COALESCE(o."rawStatus", '') NOT IN ('Cancelled', 'Canceled')
      AND i."sellerSku" IS NOT NULL
    GROUP BY i."sellerSku"`);
  return new Map(rows.map(row => [row.sku, { qty: Number(row.qty), revenue: Number(row.revenue) }]));
}

// ───────────────────────────── 计算方案 ─────────────────────────────

export async function saveCalcScheme(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '方案 ID', 64) : null;
  const name = requireText(body.name, '方案名称', 80);
  const kind = requireEnum(body.kind, '测算类型', ['FBA_FEE', 'PROFIT'] as const, 'PROFIT');
  const inputs = body.inputs && typeof body.inputs === 'object' ? body.inputs as Record<string, unknown> : {};
  const result = quoteOnly(kind === 'FBA_FEE' ? 'fee' : 'profit', { ...inputs, ...(body.targetMarginBp === undefined ? {} : { targetMarginBp: body.targetMarginBp }) });
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const payload = {
      name, kind,
      marketplace: typeof body.marketplace === 'string' && body.marketplace ? body.marketplace : 'US',
      currency: typeof body.currency === 'string' && body.currency ? body.currency : 'CNY',
      inputs: json(inputs),
      result: json(result),
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 500) : '',
    };
    if (id) {
      const current = await tx.calcScheme.findFirst({ where: { ...scoped(scope), id } });
      if (!current) throw new WmsError('测算方案不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('方案已被他人修改，请刷新后重试。', 409);
      const updated = await tx.calcScheme.update({ where: { id }, data: { ...payload, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'calc-scheme.update', id, { name, kind });
      return updated;
    }
    const created = await tx.calcScheme.create({ data: { id: crypto.randomUUID(), ...scoped(scope), ...payload, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'calc-scheme.create', created.id, { name, kind });
    return created;
  });
}

export async function deleteCalcScheme(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '方案 ID', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const current = await tx.calcScheme.findFirst({ where: { ...scoped(scope), id } });
    if (!current) throw new WmsError('测算方案不存在。', 404);
    if (current.revision !== requireRevision(body.revision)) throw new WmsError('方案已被他人修改，请刷新后重试。', 409);
    await tx.calcScheme.delete({ where: { id } });
    await auditEntity(tx, scope, 'calc-scheme.delete', id, { name: current.name });
    return { ok: true };
  });
}

// ───────────────────────────── 评论与绩效 ─────────────────────────────

export async function saveReview(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '评论 ID', 64) : null;
  const rating = requireInt(body.rating, '星级', { min: 1, max: 5 });
  const reviewedAt = requireDate(body.reviewedAt, '评论日期');
  const draft = {
    marketplace: typeof body.marketplace === 'string' && body.marketplace ? body.marketplace : 'US',
    asin: typeof body.asin === 'string' ? body.asin.trim().slice(0, 20) : '',
    sellerSku: typeof body.sellerSku === 'string' ? body.sellerSku.trim().slice(0, 120) : '',
    rating,
    sentiment: sentimentOf(rating),
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
        replyText: action === 'reply' ? replyText : '',
        repliedAt: action === 'reply' ? new Date() : null,
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
    totalOrders: requireInt(body.totalOrders ?? 0, '订单量'),
    orderDefectRateBp: requireInt(body.orderDefectRateBp ?? 0, '订单缺陷率（万分比）', { max: 10_000 }),
    lateShipmentRateBp: requireInt(body.lateShipmentRateBp ?? 0, '迟发率（万分比）', { max: 10_000 }),
    cancellationRateBp: requireInt(body.cancellationRateBp ?? 0, '取消率（万分比）', { max: 10_000 }),
    validTrackingRateBp: requireInt(body.validTrackingRateBp ?? 0, '有效追踪率（万分比）', { max: 10_000 }),
    negativeFeedbackRateBp: requireInt(body.negativeFeedbackRateBp ?? 0, '差评率（万分比）', { max: 10_000 }),
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

// ───────────────────────────── 跟卖与调价 ─────────────────────────────

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

// ───────────────────────────── 销售计划 ─────────────────────────────

export async function saveSalesPlan(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '计划 ID', 64) : null;
  const periodStart = requireDate(body.periodStart, '计划开始日');
  const periodEnd = requireDate(body.periodEnd, '计划结束日');
  if (periodEnd < periodStart) throw new WmsError('计划结束日不能早于开始日。', 400);
  const forecastWindowDays = requireInt(body.forecastWindowDays ?? 90, '预测窗口（天）', { min: 7, max: 365 });
  const seasonalityBp = requireInt(body.seasonalityBp ?? 10_000, '季节系数（万分比）', { max: 50_000 });
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) throw new WmsError('销售计划至少需要一行 SKU 目标。', 400);
  if (rawLines.length > 500) throw new WmsError('单个计划最多 500 行。', 400);
  const days = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) + 1);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, id ? 'edit' : 'create');
    const where = scoped(scope);
    const history = await readPlanActuals(tx, scope, new Date(periodStart.getTime() - forecastWindowDays * 86_400_000), periodStart);
    const lines = rawLines.map((raw, index) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const sellerSku = requireText(row.sellerSku, `第 ${index + 1} 行 SKU`, 120);
      const historyQty = history.get(sellerSku)?.qty ?? 0;
      const dailyAvg = historyQty > 0 ? historyQty / forecastWindowDays : 0;
      return {
        sellerSku,
        asin: typeof row.asin === 'string' ? row.asin.trim().slice(0, 20) : '',
        targetQty: requireInt(row.targetQty ?? 0, `第 ${index + 1} 行目标数量`),
        targetRevenue: requireMoney(row.targetRevenue ?? 0, `第 ${index + 1} 行目标销售额`),
        unitCost: requireMoney(row.unitCost ?? 0, `第 ${index + 1} 行单位成本`),
        historyDailyAvg: Math.round(dailyAvg * 1_000_000) / 1_000_000,
        forecastQty: forecastQty(dailyAvg, days, seasonalityBp),
      };
    });
    const duplicates = lines.map(line => line.sellerSku).filter((sku, index, all) => all.indexOf(sku) !== index);
    if (duplicates.length) throw new WmsError(`SKU ${duplicates[0]} 重复，同一计划内不能重复。`, 400);
    const header = {
      name: requireText(body.name, '计划名称', 80),
      marketplace: typeof body.marketplace === 'string' && body.marketplace ? body.marketplace : 'US',
      currency: typeof body.currency === 'string' && body.currency ? body.currency : 'CNY',
      periodType: requireEnum(body.periodType, '计划周期', ['MONTH', 'QUARTER'] as const, 'MONTH'),
      periodStart, periodEnd,
      status: requireEnum(body.status, '计划状态', ['DRAFT', 'ACTIVE', 'CLOSED'] as const, 'DRAFT'),
      forecastWindowDays, seasonalityBp,
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 500) : '',
    };
    if (id) {
      const current = await tx.salesPlan.findFirst({ where: { ...where, id }, include: { lines: true } });
      if (!current) throw new WmsError('销售计划不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('计划已被他人修改，请刷新后重试。', 409);
      if (current.status === 'CLOSED') throw new WmsError('已关闭的计划不能再修改。', 409);
      await tx.salesPlanLine.deleteMany({ where: { ...where, planId: id } });
      const updated = await tx.salesPlan.update({ where: { id }, data: { ...header, revision: { increment: 1 }, lines: { create: lines } }, include: { lines: true } });
      await auditEntity(tx, scope, 'sales-plan.update', id, { name: header.name, lines: lines.length });
      return updated;
    }
    const created = await tx.salesPlan.create({
      data: { id: crypto.randomUUID(), ...where, ...header, createdBy: scope.actorUserId, lines: { create: lines } },
      include: { lines: true },
    });
    await auditEntity(tx, scope, 'sales-plan.create', created.id, { name: header.name, lines: lines.length });
    return created;
  });
}

export async function closeSalesPlan(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '计划 ID', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'approve');
    const current = await tx.salesPlan.findFirst({ where: { ...scoped(scope), id } });
    if (!current) throw new WmsError('销售计划不存在。', 404);
    if (current.revision !== requireRevision(body.revision)) throw new WmsError('计划已被他人修改，请刷新后重试。', 409);
    const updated = await tx.salesPlan.update({ where: { id }, data: { status: 'CLOSED', revision: { increment: 1 } } });
    await auditEntity(tx, scope, 'sales-plan.close', id, { name: current.name });
    return updated;
  });
}

// ───────────────────────────── 采购协同 ─────────────────────────────

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

// ───────────────────────────── 税务台账 ─────────────────────────────

export async function saveTaxInvoice(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '发票 ID', 64) : null;
  const taxableAmount = requireMoney(body.taxableAmount, '计税金额');
  const taxRateBp = requireInt(body.taxRateBp, '税率（万分比）', { max: 10_000 });
  const invoiceDate = requireDate(body.invoiceDate, '开票日期');
  const draft = {
    country: requireText(body.country, '国家/地区', 8).toUpperCase(),
    taxType: requireEnum(body.taxType, '税种', ['VAT', 'GST', 'SALES_TAX'] as const, 'VAT'),
    invoiceNo: requireText(body.invoiceNo, '发票号', 60),
    invoiceDate,
    counterparty: typeof body.counterparty === 'string' ? body.counterparty.trim().slice(0, 200) : '',
    currency: typeof body.currency === 'string' && body.currency ? body.currency.toUpperCase() : 'EUR',
    taxableAmount,
    taxRateBp,
    taxAmount: taxAmountOf(taxableAmount, taxRateBp),
    direction: requireEnum(body.direction, '进销项', ['INPUT', 'OUTPUT'] as const, 'OUTPUT'),
    status: requireEnum(body.status, '发票状态', ['DRAFT', 'FILED', 'PAID', 'VOID'] as const, 'DRAFT'),
    filingPeriod: body.filingPeriod ? requireText(body.filingPeriod, '申报期', 7) : taxPeriodOf(invoiceDate),
  };
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.taxInvoice.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('税务发票不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('发票已被他人修改，请刷新后重试。', 409);
      if (current.status === 'VOID') throw new WmsError('已作废发票不能再修改。', 409);
      const updated = await tx.taxInvoice.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'tax-invoice.update', id, { invoiceNo: draft.invoiceNo, taxAmount: draft.taxAmount });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const created = await tx.taxInvoice.create({ data: { id: crypto.randomUUID(), ...where, ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'tax-invoice.create', created.id, { invoiceNo: draft.invoiceNo, taxAmount: draft.taxAmount });
    return created;
  });
}

export async function computeTaxPeriod(scope: WmsScope, body: Record<string, unknown>) {
  const country = requireText(body.country, '国家/地区', 8).toUpperCase();
  const taxType = requireEnum(body.taxType, '税种', ['VAT', 'GST', 'SALES_TAX'] as const, 'VAT');
  const period = requireText(body.period, '申报期', 7);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'export');
    const where = scoped(scope);
    const invoices = await tx.taxInvoice.findMany({ where: { ...where, country, taxType, filingPeriod: period, status: { not: 'VOID' } } });
    if (!invoices.length) throw new WmsError('该申报期没有有效发票，无法归集。', 400);
    const taxableAmount = Math.round(invoices.reduce((sum, row) => sum + num(row.taxableAmount), 0) * 1_000_000) / 1_000_000;
    const taxAmount = Math.round(invoices.reduce((sum, row) => sum + num(row.taxAmount), 0) * 1_000_000) / 1_000_000;
    const saved = await tx.taxFilingPeriod.upsert({
      where: { organizationId_workspaceId_country_taxType_period: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, country, taxType, period } },
      create: { id: crypto.randomUUID(), ...where, country, taxType, period, taxableAmount, taxAmount, createdBy: scope.actorUserId },
      update: { taxableAmount, taxAmount, revision: { increment: 1 } },
    });
    await auditEntity(tx, scope, 'tax-period.compute', saved.id, { country, period, invoices: invoices.length });
    return { ...saved, invoiceCount: invoices.length };
  });
}

export async function fileTaxPeriod(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '申报期 ID', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'approve');
    const current = await tx.taxFilingPeriod.findFirst({ where: { ...scoped(scope), id } });
    if (!current) throw new WmsError('申报期不存在。', 404);
    if (current.status === 'FILED') throw new WmsError('该申报期已申报，不能重复操作。', 409);
    if (current.revision !== requireRevision(body.revision)) throw new WmsError('申报期已被他人修改，请刷新后重试。', 409);
    const reference = requireText(body.reference, '申报凭证号', 80);
    const updated = await tx.taxFilingPeriod.update({
      where: { id },
      data: { status: 'FILED', filedAt: new Date(), reference, revision: { increment: 1 } },
    });
    await tx.taxInvoice.updateMany({ where: { ...scoped(scope), country: current.country, taxType: current.taxType, filingPeriod: current.period, status: 'DRAFT' }, data: { status: 'FILED' } });
    await auditEntity(tx, scope, 'tax-period.file', id, { period: current.period, reference });
    return updated;
  });
}

// ───────────────────────────── 多渠道 ─────────────────────────────

export async function saveChannelAccount(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '账号 ID', 64) : null;
  const draft = {
    channel: requireEnum(body.channel, '渠道', ['EBAY', 'WALMART', 'TEMU', 'TIKTOK', 'SHOPIFY', 'OTHER'] as const),
    name: requireText(body.name, '店铺名称', 80),
    sellerId: requireText(body.sellerId, '平台卖家 ID', 80),
    marketplace: typeof body.marketplace === 'string' ? body.marketplace.trim().toUpperCase().slice(0, 8) : '',
    credentialsRef: typeof body.credentialsRef === 'string' ? body.credentialsRef.trim().slice(0, 200) : '',
    status: requireEnum(body.status, '账号状态', ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const, 'ACTIVE'),
  };
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.multiChannelAccount.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('渠道账号不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('账号已被他人修改，请刷新后重试。', 409);
      const updated = await tx.multiChannelAccount.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'channel-account.update', id, { channel: draft.channel });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const created = await tx.multiChannelAccount.create({ data: { id: crypto.randomUUID(), ...where, ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'channel-account.create', created.id, { channel: draft.channel, sellerId: draft.sellerId });
    return created;
  });
}

export async function saveChannelOrder(scope: WmsScope, body: Record<string, unknown>) {
  const accountId = requireText(body.accountId, '渠道账号', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'create');
    const where = scoped(scope);
    const account = await tx.multiChannelAccount.findFirst({ where: { ...where, id: accountId } });
    if (!account) throw new WmsError('渠道账号不存在或不属于当前工作区。', 400);
    const created = await tx.multiChannelOrder.create({
      data: {
        id: crypto.randomUUID(), ...where, accountId,
        channel: account.channel,
        externalOrderNo: requireText(body.externalOrderNo, '平台订单号', 80),
        sellerSku: requireText(body.sellerSku, 'SKU', 120),
        quantity: requireInt(body.quantity, '数量', { min: 1 }),
        currency: typeof body.currency === 'string' && body.currency ? body.currency.toUpperCase() : 'USD',
        amount: requireMoney(body.amount, '订单金额'),
        status: requireEnum(body.status, '订单状态', ['PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const, 'PENDING'),
        orderedAt: requireDate(body.orderedAt, '下单日期'),
        buyerCountry: typeof body.buyerCountry === 'string' ? body.buyerCountry.trim().toUpperCase().slice(0, 8) : '',
        trackingNo: typeof body.trackingNo === 'string' ? body.trackingNo.trim().slice(0, 80) : '',
        createdBy: scope.actorUserId,
      },
    });
    await auditEntity(tx, scope, 'channel-order.create', created.id, { channel: account.channel, orderNo: created.externalOrderNo });
    return created;
  });
}

export async function transitionChannelOrder(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '订单 ID', 64);
  const status = requireEnum(body.status, '订单状态', ['SHIPPED', 'DELIVERED', 'CANCELLED'] as const);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const current = await tx.multiChannelOrder.findFirst({ where: { ...scoped(scope), id } });
    if (!current) throw new WmsError('渠道订单不存在。', 404);
    if (current.revision !== requireRevision(body.revision)) throw new WmsError('订单已被他人修改，请刷新后重试。', 409);
    if (current.status === 'CANCELLED') throw new WmsError('已取消订单不能再流转。', 409);
    const updated = await tx.multiChannelOrder.update({
      where: { id },
      data: { status, revision: { increment: 1 }, ...(typeof body.trackingNo === 'string' && body.trackingNo ? { trackingNo: body.trackingNo.trim().slice(0, 80) } : {}) },
    });
    await auditEntity(tx, scope, 'channel-order.transition', id, { from: current.status, to: status });
    return updated;
  });
}

// ───────────────────────────── 字典与自定义字段 ─────────────────────────────

export async function saveDictionary(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '字典 ID', 64) : null;
  const draft = {
    code: requireText(body.code, '字典编码', 60).toUpperCase(),
    name: requireText(body.name, '字典名称', 80),
    description: typeof body.description === 'string' ? body.description.slice(0, 300) : '',
  };
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.dataDictionary.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('字典不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('字典已被他人修改，请刷新后重试。', 409);
      const updated = await tx.dataDictionary.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'dictionary.update', id, { code: draft.code });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const created = await tx.dataDictionary.create({ data: { id: crypto.randomUUID(), ...where, ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'dictionary.create', created.id, { code: draft.code });
    return created;
  });
}

export async function saveDictionaryItem(scope: WmsScope, body: Record<string, unknown>) {
  const dictionaryId = requireText(body.dictionaryId, '字典', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const where = scoped(scope);
    const dictionary = await tx.dataDictionary.findFirst({ where: { ...where, id: dictionaryId } });
    if (!dictionary) throw new WmsError('字典不存在或不属于当前工作区。', 404);
    const value = requireText(body.value, '字典值', 60);
    const label = requireText(body.label, '显示名', 80);
    const sort = requireInt(body.sort ?? 0, '排序', { max: 99_999 });
    const enabled = body.enabled !== false;
    const saved = await tx.dataDictionaryItem.upsert({
      where: { organizationId_workspaceId_dictionaryId_value: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, dictionaryId, value } },
      create: { id: crypto.randomUUID(), ...where, dictionaryId, value, label, sort, enabled },
      update: { label, sort, enabled },
    });
    const itemCount = await tx.dataDictionaryItem.count({ where: { ...where, dictionaryId } });
    await tx.dataDictionary.update({ where: { id: dictionaryId }, data: { itemCount, revision: { increment: 1 } } });
    await auditEntity(tx, scope, 'dictionary-item.save', saved.id, { dictionaryId, value });
    return saved;
  });
}

export async function deleteDictionaryItem(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '字典项 ID', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const where = scoped(scope);
    const current = await tx.dataDictionaryItem.findFirst({ where: { ...where, id } });
    if (!current) throw new WmsError('字典项不存在。', 404);
    await tx.dataDictionaryItem.delete({ where: { id } });
    const itemCount = await tx.dataDictionaryItem.count({ where: { ...where, dictionaryId: current.dictionaryId } });
    await tx.dataDictionary.update({ where: { id: current.dictionaryId }, data: { itemCount, revision: { increment: 1 } } });
    await auditEntity(tx, scope, 'dictionary-item.delete', id, { dictionaryId: current.dictionaryId, value: current.value });
    return { ok: true };
  });
}

export async function saveCustomField(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '字段 ID', 64) : null;
  const options = Array.isArray(body.options) ? body.options.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim().slice(0, 60)) : [];
  const draft = {
    entity: requireEnum(body.entity, '目标实体', ['PRODUCT', 'SUPPLIER', 'PURCHASE_ORDER', 'ORDER'] as const),
    code: requireText(body.code, '字段编码', 40),
    label: requireText(body.label, '字段名称', 60),
    fieldType: requireEnum(body.fieldType, '字段类型', ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN'] as const, 'TEXT'),
    required: body.required === true,
    options: options.length ? json(options) : Prisma.DbNull,
    enabled: body.enabled !== false,
    sortOrder: requireInt(body.sortOrder ?? 0, '排序', { max: 99_999 }),
  };
  if (draft.fieldType === 'SELECT' && !options.length) throw new WmsError('选择型字段必须至少提供一个选项。', 400);
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.customFieldDefinition.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('自定义字段不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('字段已被他人修改，请刷新后重试。', 409);
      const updated = await tx.customFieldDefinition.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'custom-field.update', id, { entity: draft.entity, code: draft.code });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const created = await tx.customFieldDefinition.create({ data: { id: crypto.randomUUID(), ...where, ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'custom-field.create', created.id, { entity: draft.entity, code: draft.code });
    return created;
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
