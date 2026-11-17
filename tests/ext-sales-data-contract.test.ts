import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { Prisma, PrismaClient } from '@prisma/client';
import { observedTotal, readPlanActuals, saveSalesPlan } from '../src/lib/ext/sales-plans';
import { queryExt } from '../src/lib/ext/service';

const scope = { organizationId: 'fixture-org', workspaceId: 'fixture-workspace', actorUserId: 'fixture-user' };

test('实际观测 SQL 不补零，部分空字段保留 null，组织与工作区参与事实关联', async () => {
  const tx = { $queryRaw: async (sql: Prisma.Sql) => {
    assert.deepEqual(sql.values.slice(0, 2), [scope.organizationId, scope.workspaceId]);
    const text = sql.strings.join('');
    assert.match(text, /COUNT\(i\."proceedsAmount"\) = COUNT\(\*\)/);
    assert.match(text, /o\."workspaceId" = i\."workspaceId"/);
    assert.match(text, /o\."sourceId" = i\."sourceId"/);
    assert.doesNotMatch(text, /COALESCE\(SUM/);
    return [{ sku: 'zero', qty: 0, revenue: 0 }, { sku: 'partial', qty: 2, revenue: null }];
  } } as unknown as Prisma.TransactionClient;
  const result = await readPlanActuals(tx, scope, new Date('2026-01-01'), new Date('2026-02-01'));
  assert.deepEqual(result.get('zero'), { qty: 0, revenue: 0 });
  assert.deepEqual(result.get('partial'), { qty: 2, revenue: null });
  assert.equal(result.get('missing'), undefined);
  assert.equal(observedTotal([]), null);
  assert.equal(observedTotal([0, null]), null);
  assert.equal(observedTotal([0, 2]), 2);
});

test('计划历史无数据持久化 null，真实零保留，明细与总计不将部分缺失伪装完整', async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  let permission = true;
  let authQuery = 0;
  let facts: Array<{ sku: string; qty: number | null; revenue: number | null }> = [];
  let saved: Record<string, unknown> | undefined;
  const lines = ['zero', 'missing'].map(sellerSku => ({ id: sellerSku, sellerSku, targetQty: 10, targetRevenue: 10, unitCost: 0, forecastQty: sellerSku === 'zero' ? 0 : null, historyDailyAvg: sellerSku === 'zero' ? 0 : null }));
  const plan = { id: 'plan', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-31'), forecastWindowDays: 90, seasonalityBp: 10000, lines };
  const tx = {
    $queryRaw: async (sql: { strings?: string[] }) => {
      if (sql.strings?.join('').includes('AmazonOrderItemRecord')) {
        const values = (sql as Prisma.Sql).values;
        assert.equal(values[0], scope.organizationId); assert.equal(values[1], scope.workspaceId);
        const end = values[3] as Date;
        assert.ok(['2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'].includes(end.toISOString()), '历史区间排除计划首日，实际区间包含计划结束日');
        return facts;
      }
      const index = authQuery++ % 4;
      return index === 1 ? [{ role: 'fixture-role' }] : index === 3 ? [{ permissions: { wms: permission ? ['view', 'create'] : [] } }] : [];
    },
    workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
    organizationMember: { findUnique: async () => ({ role: 'member', user: { status: 'active' } }) },
    workspaceMembership: { findUnique: async () => permission ? ({ userId: scope.actorUserId }) : null },
    salesPlan: {
      create: async ({ data }: { data: Record<string, unknown> }) => { saved = data; return data; },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => { assert.equal(where.organizationId, scope.organizationId); assert.equal(where.workspaceId, scope.workspaceId); return plan; },
      findMany: async () => [plan],
    },
    auditLog: { create: async () => undefined },
  };
  globals.prisma = { $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
  const draft = { name: '计划', periodStart: '2026-01-01', periodEnd: '2026-01-31', lines: lines.map(line => ({ sellerSku: line.sellerSku, targetQty: 10, targetRevenue: 10, unitCost: 0 })) };
  try {
    await saveSalesPlan(scope, draft);
    assert.ok((saved?.lines as { create: Array<{ forecastQty: unknown; historyDailyAvg: unknown }> }).create.every(line => line.forecastQty === null && line.historyDailyAvg === null));
    facts = [{ sku: 'zero', qty: 0, revenue: 0 }];
    await saveSalesPlan(scope, draft);
    const persisted = (saved?.lines as { create: Array<{ forecastQty: unknown; historyDailyAvg: unknown }> }).create;
    assert.equal(persisted[0].forecastQty, 0); assert.equal(persisted[0].historyDailyAvg, 0);
    assert.equal(persisted[1].forecastQty, null);
    const detail = await queryExt(scope, 'sales-plan', new URLSearchParams({ id: 'plan' })) as { lines: Array<{ actualQty: number | null; gap: number | null; completionBp: number | null; actualState: string }>; totals: { actualQty: number | null; forecastQty: number | null; actualState: string } };
    assert.equal(detail.lines[0].actualQty, 0); assert.equal(detail.lines[0].completionBp, 0);
    assert.equal(detail.lines[1].actualQty, null); assert.equal(detail.lines[1].gap, null); assert.equal(detail.lines[1].completionBp, null);
    assert.equal(detail.lines[1].actualState, 'NEEDS_DATA');
    assert.deepEqual(detail.totals.actualQty, null); assert.equal(detail.totals.forecastQty, null); assert.equal(detail.totals.actualState, 'NEEDS_DATA');
    facts = [];
    lines[1].forecastQty = 0; lines[1].historyDailyAvg = 0;
    const legacy = await queryExt(scope, 'sales-plan', new URLSearchParams({ id: 'plan' })) as { lines: Array<{ forecastQty: number | null; historyDailyAvg: number | null; forecastState: string }> };
    assert.ok(legacy.lines.every(line => line.forecastQty === null && line.historyDailyAvg === null && line.forecastState === 'NEEDS_DATA'), '旧伪零没有历史来源时必须待补数据');
    const listing = await queryExt(scope, 'sales-plans', new URLSearchParams()) as { items: Array<{ forecastQty: number | null; forecastState: string }> };
    assert.equal(listing.items[0].forecastQty, null); assert.equal(listing.items[0].forecastState, 'NEEDS_DATA');
    facts = [{ sku: 'zero', qty: 0, revenue: null }, { sku: 'missing', qty: 90, revenue: 10 }];
    const covered = await queryExt(scope, 'sales-plan', new URLSearchParams({ id: 'plan' })) as { lines: Array<{ forecastQty: number | null; forecastState: string; actualState: string }> };
    assert.equal(covered.lines[0].forecastQty, 0); assert.equal(covered.lines[0].forecastState, 'READY');
    assert.equal(covered.lines[0].actualState, 'NEEDS_DATA', '缺金额不能伪造完整实际');
    assert.equal(covered.lines[1].forecastQty, 31, '读取重新依据真实数量计算，不信任旧持久化零');
    permission = false;
    await assert.rejects(queryExt(scope, 'sales-plan', new URLSearchParams({ id: 'plan' })));
    await assert.rejects(saveSalesPlan(scope, draft));
  } finally { globals.prisma = previous; }
});

test('销售预测离线迁移只开放未知观测，不改写既存真实零', async () => {
  const sql = await readFile(new URL('../prisma/migrations/20261218020000_sales_plan_unknown_observations/migration.sql', import.meta.url), 'utf8');
  for (const field of ['historyDailyAvg', 'forecastQty']) {
    assert.ok(sql.includes(`ALTER COLUMN "${field}" DROP DEFAULT`));
    assert.ok(sql.includes(`ALTER COLUMN "${field}" DROP NOT NULL`));
  }
  assert.doesNotMatch(sql, /UPDATE|DELETE|INSERT|DROP TABLE/i);
});

test('原服务测算与评论入口严格指向唯一领域实现', async () => {
  const service = await import('../src/lib/ext/service');
  const calc = await import('../src/lib/ext/calculation-service');
  const review = await import('../src/lib/ext/review-performance-service');
  assert.equal(service.saveCalcScheme, calc.saveCalcScheme);
  assert.equal(service.deleteCalcScheme, calc.deleteCalcScheme);
  assert.equal(service.saveReview, review.saveReview);
  assert.equal(service.decideReview, review.decideReview);
});
