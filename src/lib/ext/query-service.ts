import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { authorizeEntity, scoped } from './access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireText } from '@/lib/wms/rules';
import { cheapestQuotation, dayKey, performanceVerdict } from './rules';
import { observedTotal, readPlanActuals, readPlanForecasts } from './sales-plans';
const listLimit = 300;
const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

type SellfoxReview = {
  reviewId: string; marketplace: string; asin: string; parentAsin: string; sellerSku: string;
  rating: number; sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE"; vp: boolean;
  title: string; content: string; reviewer: string; reviewedAt: string; source: string; status: string;
};
const sentimentOfStar = (star: number): "POSITIVE" | "NEUTRAL" | "NEGATIVE" => star >= 4 ? "POSITIVE" : star === 3 ? "NEUTRAL" : "NEGATIVE";
const text = (value: unknown) => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));
const dayOf = (value: unknown) => {
  const raw = text(value);
  return raw ? raw.slice(0, 10) : "";
};

/** Read the real customer reviews already synced from Sellfox (/api/review/pageDetailList.json). */
async function readSellfoxReviews(tx: Prisma.TransactionClient, scope: WmsScope, where: { organizationId: string; workspaceId: string }): Promise<SellfoxReview[]> {
  const rows = await tx.sellfoxApiRecord.findMany({
    where: { ...where, endpointCode: "reviews" },
    orderBy: [{ syncedAt: "desc" }],
    take: 5000,
  });
  const seen = new Set<string>();
  const out: SellfoxReview[] = [];
  for (const row of rows) {
    const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload as Record<string, unknown> : {};
    const asin = text(payload.asin);
    const reviewId = text(payload.reviewId) || `${asin}:${text(payload.reviewDate)}:${text(payload.title)}`;
    if (seen.has(reviewId)) continue;
    seen.add(reviewId);
    const rating = Number(payload.star);
    const star = Number.isFinite(rating) ? Math.min(5, Math.max(1, Math.round(rating))) : 0;
    const shopList = Array.isArray(payload.shopList) ? payload.shopList as Array<Record<string, unknown>> : [];
    const shopNameList = Array.isArray(payload.shopNameList) ? payload.shopNameList as unknown[] : [];
    const shopName = text(shopList[0]?.shopName) || text(shopNameList[0]);
    out.push({
      reviewId,
      marketplace: text(payload.marketplaceName) || "—",
      asin,
      parentAsin: text(payload.parentAsin),
      sellerSku: text(payload.msku) || text(payload.sellerSku),
      rating: star,
      sentiment: star > 0 ? sentimentOfStar(star) : "NEUTRAL",
      vp: Number(payload.vp) === 1,
      title: text(payload.title),
      content: text(payload.content),
      reviewer: text(payload.reviewer) || shopName,
      reviewedAt: dayOf(payload.reviewDate),
      source: "SELLFOX",
      status: "NEW",
    });
  }
  return out;
}

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
        // 增量筛选字段：站点 / 星级 / 评论日期区间 / 关键词（命中标题、正文、ASIN）。
        const site = params.get('site') ?? '';
        const ratingRaw = params.get('rating') ?? '';
        const rating = /^[1-5]$/.test(ratingRaw) ? Number(ratingRaw) : null;
        const from = params.get('from') ?? '';
        const to = params.get('to') ?? '';
        const keyword = (params.get('keyword') ?? '').trim().slice(0, 120);
        // 服务端分页：page 从 1 起，pageSize 上限 200；未传时沿用原 take 上限（兼容旧调用）。
        const pageRaw = Number(params.get('page') ?? '0');
        const pageSizeRaw = Number(params.get('pageSize') ?? '0');
        const paginated = Number.isInteger(pageRaw) && pageRaw > 0 && Number.isInteger(pageSizeRaw) && pageSizeRaw > 0;
        const page = paginated ? Math.min(pageRaw, 10_000) : 1;
        const pageSize = paginated ? Math.min(pageSizeRaw, 200) : listLimit;
        const dateFilter: Prisma.ReviewRecordWhereInput['reviewedAt'] = (from || to)
          ? { ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) }
          : undefined;
        const reviewWhere: Prisma.ReviewRecordWhereInput = {
          ...where,
          ...(sentiment ? { sentiment } : {}),
          ...(status ? { status } : {}),
          ...(site ? { marketplace: site } : {}),
          ...(rating ? { rating } : {}),
          ...(dateFilter ? { reviewedAt: dateFilter } : {}),
          ...(keyword ? { OR: [{ title: { contains: keyword } }, { content: { contains: keyword } }, { asin: { contains: keyword } }, { sellerSku: { contains: keyword } }] } : {}),
        };
        const [items, agg, replied, matched, byDay, byDayNegative] = await Promise.all([
          tx.reviewRecord.findMany({
            where: reviewWhere,
            orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
            skip: paginated ? (page - 1) * pageSize : 0,
            take: pageSize,
          }),
          // KPI 与列表同口径：groupBy 用同一份筛选条件，不再取全量。
          tx.reviewRecord.groupBy({ by: ['sentiment'], where: reviewWhere, _count: { _all: true } }),
          tx.reviewRecord.count({ where: { ...reviewWhere, status: 'REPLIED' } }),
          tx.reviewRecord.count({ where: reviewWhere }),
          // KPI 迷你趋势：按日聚合（同一筛选口径），前端画 sparkline 与环比。
          tx.reviewRecord.groupBy({ by: ['reviewedAt'], where: reviewWhere, _count: { _all: true }, orderBy: { reviewedAt: 'asc' } }),
          tx.reviewRecord.groupBy({ by: ['reviewedAt'], where: { ...reviewWhere, sentiment: 'NEGATIVE' }, _count: { _all: true }, orderBy: { reviewedAt: 'asc' } }),
        ]);
        const counts = Object.fromEntries(agg.map(row => [row.sentiment, row._count._all]));
        const total = agg.reduce((sum, row) => sum + row._count._all, 0);
        const negativeByDay = Object.fromEntries(byDayNegative.map(row => [dayKey(row.reviewedAt), row._count._all]));
        const trend = byDay.map(row => ({ date: dayKey(row.reviewedAt), total: row._count._all, negative: negativeByDay[dayKey(row.reviewedAt)] ?? 0 }));
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
          trend,
          pagination: { page, pageSize, total: matched, pageCount: Math.max(1, Math.ceil(matched / pageSize)) },
        };
      }
      case 'reviews-by-asin': {
        // 聚合来自赛狐已同步的真实评价明细（SellfoxApiRecord endpointCode=reviews），按站点 + ASIN 归集；不补零、不造数据。
        const reviews = await readSellfoxReviews(tx, scope, where);
        const key = (m: string, a: string) => `${m}\u0000${a}`;
        type AsinDetail = { id: string; marketplace: string; asin: string; rating: number; sentiment: string; vp: boolean; title: string; content: string; status: string; reviewedAt: string };
        type Acc = { marketplace: string; asin: string; total: number; ratingSum: number; positive: number; neutral: number; negative: number; vp: number; latest: string; details: AsinDetail[] };
        const groups = new Map<string, Acc>();
        for (const row of reviews) {
          if (!row.asin) continue;
          const k = key(row.marketplace, row.asin);
          let acc = groups.get(k);
          if (!acc) {
            acc = { marketplace: row.marketplace, asin: row.asin, total: 0, ratingSum: 0, positive: 0, neutral: 0, negative: 0, vp: 0, latest: '', details: [] };
            groups.set(k, acc);
          }
          acc.total += 1;
          acc.ratingSum += row.rating;
          if (row.sentiment === 'POSITIVE') acc.positive += 1;
          else if (row.sentiment === 'NEGATIVE') acc.negative += 1;
          else acc.neutral += 1;
          if (row.vp) acc.vp += 1;
          if (row.reviewedAt > acc.latest) acc.latest = row.reviewedAt;
          if (acc.details.length < 50) acc.details.push({ id: row.reviewId, marketplace: row.marketplace, asin: row.asin, rating: row.rating, sentiment: row.sentiment, vp: row.vp, title: row.title, content: row.content, status: row.status, reviewedAt: row.reviewedAt });
        }
        const items = Array.from(groups.entries()).map(([k, acc]) => ({
          id: k,
          marketplace: acc.marketplace,
          asin: acc.asin,
          total: acc.total,
          avgRating: acc.total > 0 ? Math.round((acc.ratingSum / acc.total) * 100) / 100 : null,
          positive: acc.positive,
          neutral: acc.neutral,
          negative: acc.negative,
          vp: acc.vp,
          negativeRateBp: acc.total > 0 ? Math.round((acc.negative / acc.total) * 10_000) : 0,
          latestReviewedAt: acc.latest,
          details: acc.details.sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)),
        }));
        // 差评率优先、其次评论量，便于运营先处理问题 ASIN。
        items.sort((a, b) => b.negativeRateBp - a.negativeRateBp || b.total - a.total || b.latestReviewedAt.localeCompare(a.latestReviewedAt));
        return { items, total: items.length, reviewTotal: reviews.length };
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
        const items = await tx.salesPlan.findMany({ where, orderBy: [{ periodStart: 'desc' }], include: { lines: { select: { sellerSku: true, targetQty: true, targetRevenue: true, historyDailyAvg: true, forecastQty: true } } }, take: 100 });
        return {
          items: await Promise.all(items.map(async row => {
            const forecasts = await readPlanForecasts(tx, scope, row);
            return {
              id: row.id, name: row.name, marketplace: row.marketplace, currency: row.currency, periodType: row.periodType,
              periodStart: dayKey(row.periodStart), periodEnd: dayKey(row.periodEnd), status: row.status, revision: row.revision,
              lineCount: row.lines.length,
              targetQty: row.lines.reduce((sum, line) => sum + line.targetQty, 0),
              targetRevenue: row.lines.reduce((sum, line) => sum + num(line.targetRevenue), 0),
              forecastQty: observedTotal(row.lines.map(line => forecasts.get(line.sellerSku)?.forecastQty ?? null)),
              forecastState: row.lines.length > 0 && row.lines.every(line => forecasts.get(line.sellerSku)?.forecastState === 'READY') ? 'READY' : 'NEEDS_DATA',
            };
          })),
        };
      }
      case 'sales-plan': {
        const id = requireText(params.get('id'), '计划 ID', 64);
        const plan = await tx.salesPlan.findFirst({ where: { ...where, id }, include: { lines: { orderBy: { sellerSku: 'asc' } } } });
        if (!plan) throw new WmsError('销售计划不存在或不属于当前工作区。', 404);
        const actuals = await readPlanActuals(tx, scope, plan.periodStart, new Date(plan.periodEnd.getTime() + 86_400_000));
        const forecasts = await readPlanForecasts(tx, scope, plan);
        return {
          plan: { ...plan, periodStart: dayKey(plan.periodStart), periodEnd: dayKey(plan.periodEnd) },
          lines: plan.lines.map(line => {
            const actual = actuals.get(line.sellerSku) ?? { qty: null, revenue: null };
            const gap = actual.qty === null ? null : actual.qty - line.targetQty;
            return {
              ...line,
              actualQty: actual.qty,
              actualRevenue: actual.revenue,
              gap,
              completionBp: actual.qty !== null && line.targetQty > 0 ? Math.round((actual.qty / line.targetQty) * 10_000) : null,
              actualState: actual.qty === null || actual.revenue === null ? 'NEEDS_DATA' : 'READY',
              ...forecasts.get(line.sellerSku),
            };
          }),
          totals: {
            targetQty: plan.lines.reduce((sum, line) => sum + line.targetQty, 0),
            actualQty: observedTotal(plan.lines.map(line => actuals.get(line.sellerSku)?.qty ?? null)),
            forecastQty: observedTotal(plan.lines.map(line => forecasts.get(line.sellerSku)?.forecastQty ?? null)),
            actualState: plan.lines.length > 0 && plan.lines.every(line => actuals.get(line.sellerSku)?.qty != null && actuals.get(line.sellerSku)?.revenue != null) ? 'READY' : 'NEEDS_DATA',
            forecastState: plan.lines.length > 0 && plan.lines.every(line => forecasts.get(line.sellerSku)?.forecastState === 'READY') ? 'READY' : 'NEEDS_DATA',
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
