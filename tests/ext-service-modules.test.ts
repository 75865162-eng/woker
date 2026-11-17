import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import { saveRepricingRule, generateRepricingQueue, decideQueueItem } from '../src/lib/ext/repricing-service';
import { closeSalesPlan, saveSalesPlan } from '../src/lib/ext/sales-plans';
import { capturePerformance } from '../src/lib/ext/review-performance-service';
import { requireMoney, requireInt } from '../src/lib/ext/rules';
import { parseSellfoxHourlyMetric } from '../src/lib/sellfox/sync-service';
import { createAssemblyOrder } from '../src/lib/wms/assembly-service';
import { invoiceReconciliation } from '../src/lib/procurement/invoice-service';
import { researchError } from '../src/lib/selection-research/server';
import { quoteOnly } from '../src/lib/ext/pricing';

const scope = { organizationId: 'fixture-org', workspaceId: 'fixture-workspace', actorUserId: 'fixture-actor' };

test('扩展域复用现有价格测算，不建立平行费率口径', () => {
  const quote = quoteOnly('fee', { price: 20, shipping: 0, weightOz: 8, lengthIn: 1, widthIn: 1, heightIn: 1 });
  assert.equal(quote.revenue, 20);
  assert.ok(quote.totalFee > 0);
});

test('调价与销售域保留事务授权、隔离、revision、审计及只生成建议', async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  const writes: string[] = [];
  let query = 0;
  let stale = false;
  const tx = {
    $queryRaw: async (sql: { strings?: string[] }) => {
      if (sql.strings?.join('').includes('AmazonOrderItemRecord')) return [];
      const index = query++ % 4;
      return index === 1 ? [{ role: 'fixture-role' }] : index === 3 ? [{ permissions: { wms: ['create', 'edit', 'approve'] } }] : [];
    },
    workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
    organizationMember: { findUnique: async () => ({ role: 'member', user: { status: 'active' } }) },
    workspaceMembership: { findUnique: async () => ({ userId: scope.actorUserId }) },
    repricingRule: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        assert.equal(where.organizationId, scope.organizationId); assert.equal(where.workspaceId, scope.workspaceId);
        return { id: 'rule', name: '测试', enabled: true, marketplace: 'US', strategy: 'MATCH_LOWEST', floorPrice: 10, ceilingPrice: 30, stepAmount: 1, minMarginBp: 0, revision: 2 };
      },
      update: async () => { writes.push('rule'); return { id: 'rule' }; },
    },
    competitorOfferWatch: { findMany: async () => [{ asin: 'A', marketplace: 'US', sellerSku: 'SKU', myPrice: 25, buyBoxPrice: 20, lowestCompetitorPrice: 19 }] },
    repricingQueueItem: {
      findMany: async () => [],
      create: async ({ data }: { data: { suggestedPrice: number } }) => { writes.push('queue'); assert.equal(data.suggestedPrice, 19); },
      findFirst: async () => ({ id: 'queue', status: 'APPLIED' }),
      update: async () => { throw new Error('不应重复处理建议'); },
    },
    salesPlan: {
      findFirst: async () => ({ id: 'plan', name: '测试计划', revision: stale ? 2 : 1 }),
      update: async () => { writes.push('plan'); return { id: 'plan' }; },
    },
    auditLog: { create: async () => { writes.push('audit'); } },
  };
  globals.prisma = { $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
  try {
    await assert.rejects(saveRepricingRule(scope, { id: 'rule', revision: 1, name: '测试', floorPrice: 10, ceilingPrice: 30, stepAmount: 1 }), /已被他人修改/);
    assert.deepEqual(writes, []);
    await saveRepricingRule(scope, { id: 'rule', revision: 2, name: '测试', floorPrice: 10, ceilingPrice: 30, stepAmount: 1 });
    const result = await generateRepricingQueue(scope, { ruleId: 'rule' });
    assert.equal(result.created, 1);
    await assert.rejects(decideQueueItem(scope, { id: 'queue', decision: 'apply' }), /已处理/);
    for (const field of ['targetQty', 'targetRevenue', 'unitCost']) {
      await assert.rejects(saveSalesPlan(scope, { periodStart: '2026-01-01', periodEnd: '2026-01-31', lines: [{ sellerSku: 'SKU', targetQty: 0, targetRevenue: 0, unitCost: 0, [field]: undefined }] }));
    }
    await closeSalesPlan(scope, { id: 'plan', revision: 1 });
    stale = true;
    await assert.rejects(closeSalesPlan(scope, { id: 'plan', revision: 1 }), /已被他人修改/);
    assert.deepEqual(writes, ['rule', 'audit', 'queue', 'audit', 'plan', 'audit']);
  } finally { globals.prisma = previous; }
});

test('小时广告缺字段和无效小时拒绝，显式零与别名保留', () => {
  const observed = { hour: 0, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
  assert.deepEqual(parseSellfoxHourlyMetric(observed), observed);
  for (const key of Object.keys(observed)) {
    for (const value of [undefined, null, '', ' ', false, 'bad', -1]) {
      assert.throws(() => parseSellfoxHourlyMetric({ ...observed, [key]: value }), /NEEDS_DATA/);
    }
  }
  for (const hour of [24, 1.5]) assert.throws(() => parseSellfoxHourlyMetric({ ...observed, hour }), /NEEDS_DATA/);
  assert.equal(parseSellfoxHourlyMetric({ ...observed, cost: undefined, spend: '2.5' }).cost, 2.5);
});

test('金额和整数输入空白不再变零，价格测算缺重量拒绝', () => {
  for (const value of [undefined, null, '', ' ', false]) {
    assert.throws(() => requireMoney(value, '金额'));
    assert.throws(() => requireInt(value, '数量'));
    assert.throws(() => quoteOnly('fee', { price: 20, shipping: 0, weightOz: value }));
  }
  assert.equal(requireMoney('0', '金额'), 0);
});

test('绩效快照任一必需观测缺失均在事务前拒绝', async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  let transactions = 0;
  globals.prisma = { $transaction: async () => { transactions++; throw new Error('不应开启事务'); } } as unknown as PrismaClient;
  const observed = { totalOrders: 0, orderDefectRateBp: 0, lateShipmentRateBp: 0, cancellationRateBp: 0, validTrackingRateBp: 0, negativeFeedbackRateBp: 0 };
  try {
    for (const key of Object.keys(observed)) for (const value of [undefined, null, '', ' ']) {
      await assert.rejects(capturePerformance(scope, { periodStart: '2026-01-01', periodEnd: '2026-01-31', policyReference: '测试口径', ...observed, [key]: value }));
    }
    assert.equal(transactions, 0);
  } finally { globals.prisma = previous; }
});

test('绩效快照显式零完整持久化，旧入口使用同一实现', async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  let query = 0;
  let captured: Record<string, unknown> | undefined;
  const tx = {
    $queryRaw: async () => { const index = query++ % 4; return index === 1 ? [{ role: 'fixture-role' }] : index === 3 ? [{ permissions: { wms: ['edit'] } }] : []; },
    workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
    organizationMember: { findUnique: async () => ({ role: 'member', user: { status: 'active' } }) },
    workspaceMembership: { findUnique: async () => ({ userId: scope.actorUserId }) },
    storePerformanceSnapshot: { findFirst: async () => null, create: async ({ data }: { data: Record<string, unknown> }) => { captured = data; return data; } },
    auditLog: { create: async () => undefined },
  };
  globals.prisma = { $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
  try {
    const observed = { totalOrders: 0, orderDefectRateBp: 0, lateShipmentRateBp: 0, cancellationRateBp: 0, validTrackingRateBp: 0, negativeFeedbackRateBp: 0 };
    await capturePerformance(scope, { periodStart: '2026-01-01', periodEnd: '2026-01-31', policyReference: '测试口径', ...observed });
    for (const key of Object.keys(observed)) assert.equal(captured?.[key], 0);
    const service = await import('../src/lib/ext/service');
    assert.equal(service.capturePerformance, capturePerformance);
  } finally { globals.prisma = previous; }
});

test('组装缺成本在写入前拒绝，真实零采购成本允许', async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  let purchasePrice: number | null = null;
  const writes: string[] = [];
  const tx = {
    $queryRaw: async (query: { strings?: string[] } | TemplateStringsArray) => {
      const text = Array.isArray(query) ? query.join('') : (query as { strings?: string[] }).strings?.join('') ?? '';
      return text.includes('WmsLocation') ? [{ id: 'loc', warehouseId: 'wh', kind: 'STORAGE' }] : [];
    },
    productRecord: { findFirst: async () => ({ id: 'finished' }), findMany: async () => [{ id: 'component', purchasePrice }] },
    wmsBom: { findFirst: async () => ({ id: 'bom', productRecordId: 'finished', lines: [{ componentProductRecordId: 'component', quantityPer: 1 }] }) },
    wmsStockBalance: { findMany: async () => [{ id: 'balance', lot: { productRecordId: 'component' }, lotId: 'lot', locationId: 'loc', warehouseId: 'wh', onHand: 10, pendingQc: 0, pendingPutaway: 0, rejected: 0, reserved: 0, createdAt: new Date() }] },
    wmsAssemblyOrder: { findFirst: async () => null, create: async () => { writes.push('order'); }, findUniqueOrThrow: async () => ({ id: 'order' }) },
    wmsAssemblyOrderLine: { createMany: async ({ data }: { data: Array<{ unitCost: { toString(): string } }> }) => { assert.equal(data[0].unitCost.toString(), '0'); writes.push('lines'); } },
    auditLog: { create: async () => { writes.push('audit'); } },
  };
  globals.prisma = { $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
  const draft = { number: 'ASM', productRecordId: 'finished', warehouseId: 'wh', locationId: 'loc', plannedQty: 1, idempotencyKey: 'key' };
  try {
    await assert.rejects(createAssemblyOrder(scope, draft), /NEEDS_DATA/);
    assert.deepEqual(writes, []);
    purchasePrice = 0;
    await createAssemblyOrder(scope, draft);
    assert.deepEqual(writes, ['order', 'lines', 'audit']);
  } finally { globals.prisma = previous; }
});

test('无发票金额保留null，真实零元发票保留零字符串', async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  let invoices: unknown[] = [];
  globals.prisma = {
    purchaseOrder: { findFirst: async () => ({ id: 'order', wmsReceiptIds: [], lines: [{ productRecordId: 'p', expectedQty: 1, unitPrice: 10, product: { sku: 'SKU' } }] }) },
    $queryRaw: async () => invoices,
  } as unknown as PrismaClient;
  try {
    assert.equal((await invoiceReconciliation(scope, 'order')).lines[0].invoicedAmount, null);
    invoices = [{ productRecordId: 'p', qty: 1, amount: '0.00' }];
    assert.equal((await invoiceReconciliation(scope, 'order')).lines[0].invoicedAmount, '0.00');
  } finally { globals.prisma = previous; }
});

test('研究服务未知基础设施故障返回500且不泄漏异常', async () => {
  const result = researchError(new Error('数据库连接敏感信息'));
  assert.equal(result.status, 500);
  assert.deepEqual(await result.json(), { error: 'RESEARCH_UNAVAILABLE_OR_INVALID_REQUEST' });
  assert.equal(researchError(new Error('RESEARCH_NOT_FOUND')).status, 404);
});

test('离线迁移删除全部11项观测默认值且与非空schema一致', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const sql = await readFile(new URL('../prisma/migrations/20261217010000_remove_observation_zero_defaults/migration.sql', import.meta.url), 'utf8');
  const tables = {
    SellfoxHourlyMetric: ['impressions', 'clicks', 'cost', 'sales', 'orders'],
    StorePerformanceSnapshot: ['totalOrders', 'orderDefectRateBp', 'lateShipmentRateBp', 'cancellationRateBp', 'validTrackingRateBp', 'negativeFeedbackRateBp'],
  };
  for (const [table, fields] of Object.entries(tables)) {
    const model = schema.split(`model ${table} {`)[1].split('}')[0];
    const statement = sql.split(`ALTER TABLE "${table}"`)[1].split(';')[0];
    for (const field of fields) {
      assert.match(model, new RegExp(`\\n  ${field}\\s+(Int|Float|Decimal)(\\s+@db\\.\\w+\\([^)]*\\))?\\s*\\n`));
      assert.ok(statement.includes(`ALTER COLUMN "${field}" DROP DEFAULT`));
    }
  }
  assert.equal((sql.match(/DROP DEFAULT/g) ?? []).length, 11);
  assert.doesNotMatch(sql, /UPDATE|DELETE|DROP TABLE|DROP NOT NULL/i);
});

test('原服务入口继续导出实际调用方使用的全部迁移函数', async () => {
  const service = await readFile(new URL('../src/lib/ext/service.ts', import.meta.url), 'utf8');
  assert.match(service, /export \{ saveRepricingRule, saveOfferWatch, generateRepricingQueue, decideQueueItem \} from '.\/repricing-service'/);
  assert.match(service, /export \{ saveSalesPlan, closeSalesPlan \} from '.\/sales-plans'/);
  assert.match(service, /export \{ quoteOnly, moneyInput \} from '.\/pricing'/);
});
