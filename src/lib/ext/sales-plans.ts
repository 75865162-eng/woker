import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { auditEntity, authorizeEntity, scoped } from './access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText } from '@/lib/wms/rules';
import { forecastQty, requireDate, requireEnum, requireInt, requireMoney } from './rules';

export async function readPlanActuals(tx: Prisma.TransactionClient, scope: WmsScope, start: Date, end: Date) {
  const rows = await tx.$queryRaw<Array<{ sku: string; qty: number | null; revenue: number | null }>>(Prisma.sql`
    SELECT i."sellerSku" AS sku, CASE WHEN COUNT(i."quantityOrdered") = COUNT(*) THEN SUM(i."quantityOrdered") END::int AS qty,
      CASE WHEN COUNT(i."proceedsAmount") = COUNT(*) THEN SUM(i."proceedsAmount") END::float8 AS revenue
    FROM "AmazonOrderItemRecord" i
    JOIN "AmazonOrderRecord" o ON o."id" = i."orderRecordId" AND o."organizationId" = i."organizationId" AND o."workspaceId" = i."workspaceId" AND o."sourceId" = i."sourceId"
    WHERE i."organizationId" = ${scope.organizationId} AND i."workspaceId" = ${scope.workspaceId}
      AND o."createdTime" >= ${start} AND o."createdTime" < ${end}
      AND COALESCE(o."rawStatus", '') NOT IN ('Cancelled', 'Canceled')
      AND i."sellerSku" IS NOT NULL
    GROUP BY i."sellerSku"`);
  return new Map(rows.map(row => [row.sku, { qty: row.qty === null ? null : Number(row.qty), revenue: row.revenue === null ? null : Number(row.revenue) }]));
}

export async function readPlanForecasts(
  tx: Prisma.TransactionClient,
  scope: WmsScope,
  plan: { periodStart: Date; periodEnd: Date; forecastWindowDays: number; seasonalityBp: number; lines: Array<{ sellerSku: string; historyDailyAvg: unknown; forecastQty: number | null }> },
) {
  const history = await readPlanActuals(tx, scope, new Date(plan.periodStart.getTime() - plan.forecastWindowDays * 86_400_000), plan.periodStart);
  const days = Math.max(1, Math.round((plan.periodEnd.getTime() - plan.periodStart.getTime()) / 86_400_000) + 1);
  return new Map(plan.lines.map(line => {
    const qty = history.get(line.sellerSku)?.qty ?? null;
    const dailyAvg = qty === null ? null : qty / plan.forecastWindowDays;
    const ready = dailyAvg !== null && line.historyDailyAvg != null && line.forecastQty !== null;
    return [line.sellerSku, {
      historyDailyAvg: ready ? Math.round(dailyAvg * 1_000_000) / 1_000_000 : null,
      forecastQty: ready ? forecastQty(dailyAvg, days, plan.seasonalityBp) : null,
      forecastState: ready ? 'READY' as const : 'NEEDS_DATA' as const,
    }];
  }));
}

export function observedTotal(values: Array<number | null>): number | null {
  return !values.length || values.some(value => value === null) ? null : values.reduce<number>((sum, value) => sum + value!, 0);
}

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
      const historyQty = history.get(sellerSku)?.qty ?? null;
      const dailyAvg = historyQty === null ? null : historyQty / forecastWindowDays;
      return {
        sellerSku,
        asin: typeof row.asin === 'string' ? row.asin.trim().slice(0, 20) : '',
        targetQty: requireInt(row.targetQty, `第 ${index + 1} 行目标数量`),
        targetRevenue: requireMoney(row.targetRevenue, `第 ${index + 1} 行目标销售额`),
        unitCost: requireMoney(row.unitCost, `第 ${index + 1} 行单位成本`),
        historyDailyAvg: dailyAvg === null ? null : Math.round(dailyAvg * 1_000_000) / 1_000_000,
        forecastQty: dailyAvg === null ? null : forecastQty(dailyAvg, days, seasonalityBp),
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
