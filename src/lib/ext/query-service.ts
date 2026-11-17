import { prisma } from '@/lib/db/prisma';
import { authorizeEntity, scoped } from './access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireText } from '@/lib/wms/rules';
import { cheapestQuotation, dayKey, performanceVerdict } from './rules';
import { observedTotal, readPlanActuals, readPlanForecasts } from './sales-plans';
const listLimit = 300;
const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

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
