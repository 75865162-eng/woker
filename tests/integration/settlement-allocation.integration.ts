import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/db/prisma';
import { WmsError } from '../../src/lib/wms/contracts';
import { WmsInputError } from '../../src/lib/wms/rules';
import { mutateFinanceLedger } from '../../src/lib/finance/ledger-service';
import { mutateFinanceOpenItems } from '../../src/lib/finance/open-item-service';
import { stageSettlementAllocation as stage, publishSettlementAllocation as publish, reverseSettlementAllocation as reverse, querySettlementAllocations as query } from '../../src/lib/amazon-sync/settlement-allocation-service';

const scope = { organizationId: 'allocation-fixture', workspaceId: 'default', actorUserId: 'allocation-owner' };
const identity = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
const reviewer = { ...scope, actorUserId: 'allocation-reviewer' };
const denied = { ...scope, actorUserId: 'allocation-denied' };
function entity(value: unknown, key: string): { id: string } {
  const row = (value as Record<string, { id: string }>)[key]; assert.ok(row); return row;
}
const statusError = (status: number) => (error: unknown) => (error instanceof WmsError || error instanceof WmsInputError) && error.status === status;
async function fixtureIdentity() {
  assert.equal(process.env.WMS_OFFLINE_FIXTURE, '1');
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/wms_fixture');
  const token = process.env.SETTLEMENT_ALLOCATION_FIXTURE_TOKEN;
  assert.match(token ?? '', /^[a-f0-9-]{36}$/);
  const rows = await prisma.$queryRaw<Array<{ token: string }>>`SELECT token FROM settlement_allocation_fixture_identity`;
  assert.deepEqual(rows, [{ token }], '仅允许本次运行器创建的数据库');
}
async function seedReport(id: string) {
  await prisma.amazonSettlementReport.create({ data: {
    ...identity, id, amazonSellerId: 'synthetic', region: 'NA', reportType: 'SETTLEMENT', reportId: id,
    authorizationId: 'allocation-auth', authorizationRevision: 1, sourceRunId: 'allocation-run',
    reportMarketplaceIds: ['SITE'], collectionMarketplaceIds: ['SITE'], siteBindings: {}, status: 'PUBLISHED',
  } });
  await prisma.amazonSettlementRow.createMany({ data: [
    { rowNumber: 1, sellerSku: 'SKU-A', orderId: 'ORDER-A', amountOriginal: '100.00', transactionType: 'Order', amountType: 'ItemPrice', amountDescription: 'Principal' },
    { rowNumber: 2, sellerSku: null, orderId: null, amountOriginal: '-3.00', transactionType: 'ServiceFee', amountType: 'ServiceFee', amountDescription: 'Storage Fee' },
  ].map(row => ({ ...identity, ...row, id: `${id}-${row.rowNumber}`, reportDocumentId: id, rowHash: `${id}-hash-${row.rowNumber}`,
    attributionStatus: 'ATTRIBUTED', marketplaceId: 'SITE', businessDate: '2026-11-10', businessDateRaw: '2026-11-10',
    currencyCode: 'USD', currencySource: 'row', currencySourceRowNumber: row.rowNumber,
    fields: { 'settlement-id': id, 'marketplace-id': 'SITE', quantity: '1' },
  })) });
  return { settlementReportId: id, settlementId: id, currency: 'USD', marketplaceId: 'SITE', evidence: '合成结算来源' };
}
async function snapshot() {
  return {
    allocations: await prisma.amazonSettlementAllocation.findMany({ where: identity, orderBy: { id: 'asc' } }),
    lines: await prisma.amazonSettlementAllocationLine.findMany({ where: identity, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { organizationId: scope.organizationId, entityType: 'AmazonSettlementAllocation' }, orderBy: { id: 'asc' } }),
  };
}
async function withFailure(table: 'AuditLog' | 'AmazonSettlementAllocationLine', action: () => Promise<unknown>) {
  await fixtureIdentity();
  // 名称与表名全部固定；触发器只拒绝本次组织的数据，结束时核验身份并删除。
  await prisma.$executeRawUnsafe(`CREATE FUNCTION allocation_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId" = 'allocation-fixture' THEN RAISE EXCEPTION 'allocation fixture injected failure'; END IF; RETURN NEW; END $$`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TRIGGER allocation_fixture_failure BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION allocation_fixture_fail()`);
    const before = await snapshot();
    await assert.rejects(action, /allocation fixture injected failure/);
    assert.deepEqual(await snapshot(), before, '明细或审计写失败必须完整回滚');
  } finally {
    await fixtureIdentity();
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS allocation_fixture_failure ON "${table}"`);
    await prisma.$executeRawUnsafe('DROP FUNCTION allocation_fixture_fail()');
    const leftovers = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_trigger WHERE tgname='allocation_fixture_failure'`;
    assert.equal(Number(leftovers[0].count), 0);
    const functions = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_proc WHERE proname='allocation_fixture_fail'`;
    assert.equal(Number(functions[0].count), 0);
  }
}
async function main() {
  await fixtureIdentity();
  await prisma.organization.create({ data: { id: scope.organizationId, name: '合成分摊专项', slug: scope.organizationId } });
  for (const id of ['default', 'other']) await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id, name: id } });
  for (const [actor, role, permissions] of [
    [scope, 'owner', ['view', 'create']], [reviewer, 'finance', ['view', 'approve']], [denied, 'warehouse_supervisor', ['view']],
  ] as const) {
    await prisma.user.create({ data: { id: actor.actorUserId, name: '合成成员', email: `${actor.actorUserId}@fixture.invalid`, passwordHash: 'fixture-not-password' } });
    await prisma.organizationMember.create({ data: { organizationId: scope.organizationId, userId: actor.actorUserId, role } });
    await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: role, name: role, description: 'fixture', permissions: { operations: [...permissions] } } });
  }
  await prisma.amazonSpApiAuthorization.create({ data: { ...identity, id: 'allocation-auth', name: '合成授权', amazonSellerId: 'synthetic', awsRegion: 'us-east-1', endpoint: 'https://fixture.invalid', credentialsCiphertext: 'not-credentials', updatedByUserId: scope.actorUserId } });
  await prisma.amazonSyncRun.create({ data: { ...identity, id: 'allocation-run', requestedByUserId: scope.actorUserId } });
  const input = await seedReport('ALLOCATION-MAIN');
  const sourceRow = await prisma.amazonSettlementRow.findUniqueOrThrow({ where: { id: 'ALLOCATION-MAIN-1' } });
  await prisma.amazonSettlementRow.create({ data: { ...sourceRow, fields: {}, id: 'unattributed-row', rowNumber: 99, rowHash: 'unattributed', attributionStatus: 'UNATTRIBUTED', currencyCode: 'EUR', amountOriginal: '9999' } });
  await assert.rejects(() => stage(denied, input), statusError(403));
  await assert.rejects(() => stage({ ...scope, workspaceId: 'other' }, input), statusError(404));
  const staged = await Promise.all(Array.from({ length: 6 }, () => stage(scope, input)));
  assert.equal(new Set(staged.map(row => row.allocationId)).size, 1);
  assert.equal(staged.filter(row => !row.reused).length, 1);
  const allocationId = staged[0].allocationId;
  assert.equal((await stage(scope, { ...input, evidence: '重放依据不进入请求哈希' })).reused, true);
  await assert.rejects(() => stage(scope, { ...input, remainderPolicy: 'MAX_PRINCIPAL_SKU' }), statusError(409));
  await assert.rejects(() => stage(scope, { ...input, revision: 1 }), statusError(400));
  assert.equal((await query(scope, new URLSearchParams({ allocationId }))).lines.length, 1);
  assert.equal((await query({ ...scope, workspaceId: 'other' }, new URLSearchParams({ allocationId }))).lines.length, 0);

  // 复用 three-core-port 的真实总账→已过账凭证→往来项路径，不伪造交接引用。
  const book = entity(await mutateFinanceLedger(scope, { action: 'create-book', code: 'ALLOC', name: '合成账簿', currency: 'USD' }), 'book');
  const period = entity(await mutateFinanceLedger(scope, { action: 'create-period', bookId: book.id, code: '2026-11', start: '2026-11-01', end: '2026-11-30' }), 'period');
  await mutateFinanceLedger(reviewer, { action: 'open-period', periodId: period.id, revision: 1 });
  const debit = entity(await mutateFinanceLedger(scope, { action: 'create-subject', bookId: book.id, code: 'INV', name: '合成存货', normalSide: 'DEBIT' }), 'subject');
  const credit = entity(await mutateFinanceLedger(scope, { action: 'create-subject', bookId: book.id, code: 'AP', name: '合成应付', normalSide: 'CREDIT' }), 'subject');
  const voucher = entity(await mutateFinanceLedger(scope, { action: 'create-voucher', periodId: period.id, idempotencyKey: 'ALLOC-INVOICE', sourceKey: 'ALLOC-INVOICE', date: '2026-11-10', memo: '合成凭证', lines: [{ subjectId: debit.id, debit: '97', credit: '0' }, { subjectId: credit.id, debit: '0', credit: '97' }] }), 'voucher');
  await mutateFinanceLedger(reviewer, { action: 'review-voucher', voucherId: voucher.id, revision: 1 });
  await mutateFinanceLedger(reviewer, { action: 'post-voucher', voucherId: voucher.id, revision: 2 });
  const item = entity(await mutateFinanceOpenItems(scope, { action: 'register', bookId: book.id, voucherId: voucher.id, subjectId: credit.id, counterparty: 'supplier:fixture', kind: 'PAYABLE', dueDate: '2026-11-20', evidence: '合成供应商账单' }), 'item');
  const financialBefore = { items: await prisma.financeOpenItem.findMany({ where: identity }), vouchers: await prisma.financeVoucher.count({ where: identity }), settlements: await prisma.financeSettlement.count({ where: identity }) };
  const handoff = { allocationId, openItemId: item.id, evidence: '合成交接依据' };
  for (const actor of [scope, denied]) {
    await assert.rejects(() => publish(actor, handoff), statusError(403));
    await assert.rejects(() => reverse(actor, { allocationId, evidence: '合成冲销依据' }), statusError(403));
  }
  await assert.rejects(() => publish({ ...reviewer, workspaceId: 'other' }, handoff), statusError(404));
  await assert.rejects(() => reverse({ ...reviewer, workspaceId: 'other' }, { allocationId, evidence: '跨工作区' }), statusError(404));
  await assert.rejects(() => publish(reviewer, { ...handoff, openItemId: 'missing' }), statusError(422));
  await assert.rejects(() => publish(reviewer, { ...handoff, openItemId: null }), statusError(400));
  for (const table of ['AmazonSettlementAllocationLine', 'AuditLog'] as const) {
    const failureInput = await seedReport(`FAIL-${table}`);
    await withFailure(table, () => stage(scope, failureInput));
    assert.equal((await stage(scope, failureInput)).reused, false, '清理故障后可正常重试');
  }
  await withFailure('AuditLog', () => publish(reviewer, handoff));
  // 没有 revision 参数：同状态竞态允许成功重放或明确 409，但只能落一次状态/审计。
  const published = await Promise.allSettled(Array.from({ length: 6 }, () => publish(reviewer, handoff)));
  assert.ok(published.some(row => row.status === 'fulfilled'));
  for (const row of published) if (row.status === 'rejected') assert.ok(statusError(409)(row.reason));
  assert.equal((await publish(reviewer, handoff)).reused, true);
  await assert.rejects(() => publish(reviewer, { ...handoff, settlementRef: 'different' }), statusError(409));
  await withFailure('AuditLog', () => reverse(reviewer, { allocationId, evidence: '合成冲销依据' }));
  const reversed = await Promise.allSettled(Array.from({ length: 6 }, () => reverse(reviewer, { allocationId, evidence: '合成冲销依据' })));
  assert.ok(reversed.some(row => row.status === 'fulfilled'));
  for (const row of reversed) if (row.status === 'rejected') assert.ok(statusError(409)(row.reason));
  const final = await prisma.amazonSettlementAllocation.findUniqueOrThrow({ where: { id: allocationId } });
  assert.equal(final.status, 'REVERSED'); assert.equal(final.reversedBy, reviewer.actorUserId); assert.ok(final.reversedAt);
  const timestamps = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='AmazonSettlementAllocation' AND column_name IN ('createdAt','reversedAt') ORDER BY column_name`;
  assert.deepEqual(timestamps, [{ column_name: 'createdAt', data_type: 'timestamp without time zone' }, { column_name: 'reversedAt', data_type: 'timestamp without time zone' }], '当前迁移与无原生类型标注的 Prisma DateTime 一致，不能只添加 Timestamptz 标注');
  const epochs = await prisma.$queryRaw<Array<{ milliseconds: number }>>`SELECT (extract(epoch FROM ("reversedAt" AT TIME ZONE 'UTC')) * 1000)::float8 AS milliseconds FROM "AmazonSettlementAllocation" WHERE id=${allocationId}`;
  assert.equal(epochs[0].milliseconds, final.reversedAt.getTime(), '应用 new Date 的 UTC 值与数据库存储一致');
  assert.equal((await reverse(reviewer, { allocationId, evidence: '重放' })).reused, true);
  assert.equal((await stage(scope, input)).status, 'REVERSED', '冲销后相同输入仍重用原批次');
  await assert.rejects(() => publish(reviewer, handoff), statusError(409));
  await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: 'finance' } }, data: { permissions: { operations: ['view'] } } });
  await assert.rejects(() => publish(reviewer, handoff), statusError(403));
  await assert.rejects(() => reverse(reviewer, { allocationId, evidence: '撤权后重放' }), statusError(403));
  await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: 'owner' } }, data: { permissions: { operations: ['view'] } } });
  await assert.rejects(() => stage(scope, input), statusError(403));
  for (const action of ['stage', 'publish', 'reverse']) assert.equal(await prisma.auditLog.count({ where: { entityId: allocationId, action: `amazon.settlement-allocation.${action}` } }), 1);
  assert.equal(await prisma.amazonSettlementAllocationLine.count({ where: { allocationId } }), 1);
  assert.deepEqual({ items: await prisma.financeOpenItem.findMany({ where: identity }), vouchers: await prisma.financeVoucher.count({ where: identity }), settlements: await prisma.financeSettlement.count({ where: identity }) }, financialBefore, '分摊交接与冲销不执行财务过账');
  console.log('PASS: 真实结算分摊权限、工作区隔离、六路幂等/状态竞争、明细/审计故障完整回滚、单次审计及无过账副作用');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
