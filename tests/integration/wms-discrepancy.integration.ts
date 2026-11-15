import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/db/prisma';
import { createWmsResource } from '../../src/lib/wms/catalog-service';
import { requestApproval, decideApproval } from '../../src/lib/wms/approvals';
import { executeWmsCommand } from '../../src/lib/wms/application-service';
import type { WmsCommandInput, WmsCommandPayload } from '../../src/lib/wms/contracts';

async function main() {
  if (process.env.WMS_OFFLINE_FIXTURE !== '1' || new URL(process.env.DATABASE_URL!).pathname !== '/wms_fixture') throw Error('仅允许隔离夹具');
  const scope = { organizationId: 'discrepancy-fixture', workspaceId: 'default', actorUserId: 'discrepancy-owner' };
  const reviewer = { ...scope, actorUserId: 'discrepancy-reviewer' };
  const identity = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const grants = { wms: ['view', 'create', 'edit', 'approve'] };
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: '隔离差异矩阵' } });
  for (const id of ['default', 'other']) await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id, name: id } });
  for (const [actor, role] of [[scope, 'owner'], [reviewer, 'warehouse_supervisor']] as const) {
    await prisma.user.create({ data: { id: actor.actorUserId, email: `${actor.actorUserId}@fixture.invalid`, name: '隔离用户', passwordHash: 'not-a-password' } });
    await prisma.organizationMember.create({ data: { organizationId: scope.organizationId, userId: actor.actorUserId, role } });
    await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: role, name: role, description: '隔离角色', permissions: grants } });
  }
  const setGrants = (id: string, permissions: typeof grants) => prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id } }, data: { permissions } });
  await prisma.productRecord.create({ data: { ...identity, id: 'discrepancy-product', userId: scope.actorUserId, sku: 'DISCREPANCY', payload: {} } });
  const warehouse = await createWmsResource(scope, 'warehouses', { code: 'DIFF', name: '隔离仓' });
  const area = await createWmsResource(scope, 'areas', { warehouseId: warehouse.id, code: 'DIFF-A', name: '隔离区域' });
  const receiving = await createWmsResource(scope, 'locations', { areaId: area.id, code: 'DIFF-R', kind: 'RECEIVING' });
  const source = await createWmsResource(scope, 'locations', { areaId: area.id, code: 'DIFF-S', kind: 'STORAGE' });
  const target = await createWmsResource(scope, 'locations', { areaId: area.id, code: 'DIFF-T', kind: 'STORAGE' });
  const lot = await createWmsResource(scope, 'lots', { productRecordId: 'discrepancy-product', lotCode: 'DIFF-LOT' });
  const receiptResource = await createWmsResource(scope, 'receipts', { number: 'DIFF-RCV', receivingLocationId: receiving.id, lines: [{ lotId: lot.id, expectedQty: 40 }] });
  const receipt = await prisma.wmsReceipt.findUniqueOrThrow({ where: { id: receiptResource.id }, include: { lines: true } });
  let sequence = 0;
  const command = (aggregateId: string, expectedRevision: number, payload: WmsCommandPayload): WmsCommandInput => ({ workspaceId: scope.workspaceId, aggregateId, expectedRevision, idempotencyKey: `discrepancy-${++sequence}`, payload });
  async function approve(input: WmsCommandInput) {
    const approval = await requestApproval(scope, input);
    await decideApproval(reviewer, approval.id, 1, true);
    return approval.id;
  }
  async function run(input: WmsCommandInput) { return executeWmsCommand(scope, input, await approve(input)); }
  await run(command(receipt.id, 1, { action: 'RECEIVE', lines: [{ lineId: receipt.lines[0].id, quantity: 40 }] }));
  await run(command(receipt.id, 2, { action: 'INSPECT', lines: [{ lineId: receipt.lines[0].id, acceptedQty: 40, rejectedQty: 0 }] }));
  await run(command(receipt.id, 3, { action: 'PUTAWAY', lines: [{ lineId: receipt.lines[0].id, locationId: source.id, quantity: 40 }] }));
  const balance = await prisma.wmsStockBalance.findFirstOrThrow({ where: { ...identity, locationId: source.id, lotId: lot.id } });
  async function shipped() {
    const key = `diff-order-${++sequence}`;
    const resource = await createWmsResource(scope, 'transfer-orders', { number: key, reason: '隔离运输', idempotencyKey: key, lines: [{ sourceBalanceId: balance.id, targetLocationId: target.id, quantity: 5 }] });
    const order = await prisma.wmsTransferOrder.findUniqueOrThrow({ where: { id: resource.id }, include: { lines: true } });
    await run(command(order.id, 1, { action: 'TRANSFER_ORDER_SHIP', reference: key, lines: [{ lineId: order.lines[0].id, quantity: 5 }] }));
    return order;
  }
  const order = await shipped();
  const input = command(order.id, 2, { action: 'TRANSFER_ORDER_DISCREPANCY', reference: 'DIFF-PROOF', reason: '隔离差异证据', lines: [{ lineId: order.lines[0].id, discrepancies: [{ category: 'SHORT_RECEIVED', quantity: 2, evidence: '隔离签收短缺凭证' }, { category: 'DAMAGED', quantity: 3, evidence: '隔离破损凭证' }] }] });
  const approvals = await Promise.all(Array.from({ length: 6 }, () => requestApproval(scope, input)));
  assert.equal(new Set(approvals.map(row => row.id)).size, 1);
  const approval = approvals[0];
  await assert.rejects(() => decideApproval(scope, approval.id, 1, true));
  await assert.rejects(() => executeWmsCommand(scope, input));
  await setGrants('owner', { wms: ['view'] });
  try {
    await assert.rejects(() => requestApproval(scope, input));
    await assert.rejects(() => decideApproval(reviewer, approval.id, 1, true));
    assert.equal((await prisma.wmsApproval.findUniqueOrThrow({ where: { id: approval.id } })).revision, 1);
  } finally { await setGrants('owner', grants); }
  await decideApproval(reviewer, approval.id, 1, true);
  const before = async () => ({
    order: await prisma.wmsTransferOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } }),
    approval: await prisma.wmsApproval.findUniqueOrThrow({ where: { id: approval.id } }),
    discrepancies: await prisma.wmsTransferDiscrepancy.findMany({ where: { ...identity, orderId: order.id } }),
    commands: await prisma.wmsCommand.count({ where: { ...identity, aggregateId: order.id } }),
    events: await prisma.wmsDomainEvent.count({ where: identity }),
    audits: await prisma.auditLog.count({ where: { organizationId: scope.organizationId } }),
    balances: await prisma.wmsStockBalance.findMany({ where: identity, orderBy: { id: 'asc' } }),
    movements: await prisma.wmsMovement.count({ where: identity }),
  });
  const unchanged = await before();
  await setGrants('warehouse_supervisor', { wms: ['view'] });
  try { await assert.rejects(() => executeWmsCommand(scope, input, approval.id)); }
  finally { await setGrants('warehouse_supervisor', grants); }
  await setGrants('owner', { wms: ['view'] });
  try { await assert.rejects(() => executeWmsCommand(scope, input, approval.id)); }
  finally { await setGrants('owner', grants); }
  await assert.rejects(() => executeWmsCommand({ ...scope, workspaceId: 'other' }, { ...input, workspaceId: 'other' }, approval.id));
  await assert.rejects(() => executeWmsCommand({ ...scope, organizationId: 'missing-organization' }, input, approval.id));
  assert.deepEqual(await before(), unchanged);
  const expiry = unchanged.approval.expiresAt;
  await prisma.wmsApproval.update({ where: { id: approval.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  try { await assert.rejects(() => executeWmsCommand(scope, input, approval.id)); }
  finally { await prisma.wmsApproval.update({ where: { id: approval.id }, data: { expiresAt: expiry, updatedAt: unchanged.approval.updatedAt } }); }
  assert.deepEqual(await before(), unchanged);
  // 故障发生在差异行、总数、revision、事件及审批消费之后，必须全部回滚。
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_discrepancy_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='wms.TRANSFER_ORDER_DISCREPANCY' THEN RAISE EXCEPTION 'fixture discrepancy audit failure'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_discrepancy_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fixture_discrepancy_audit_fail()`);
  try {
    await assert.rejects(() => executeWmsCommand(scope, input, approval.id), /fixture discrepancy audit failure/);
    assert.deepEqual(await before(), unchanged);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER fixture_discrepancy_audit_failure ON "AuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION fixture_discrepancy_audit_fail()`);
  }
  const results = await Promise.all(Array.from({ length: 6 }, () => executeWmsCommand(scope, input, approval.id)));
  results.forEach(result => assert.deepEqual(result, results[0]));
  const after = await before();
  assert.equal(after.order.revision, 3);
  assert.equal(after.order.status, 'COMPLETED');
  assert.equal(after.order.lines[0].discrepancyQty, 5);
  assert.equal(after.order.lines[0].shippedQty - after.order.lines[0].receivedQty - after.order.lines[0].discrepancyQty, 0);
  assert.equal(after.discrepancies.length, 2);
  for (const row of after.discrepancies) { assert.equal(row.status, 'REVIEWED'); assert.equal(row.reviewedBy, reviewer.actorUserId); assert.equal(row.claimReference, null); }
  assert.equal(after.commands, unchanged.commands + 1);
  assert.equal(after.events, unchanged.events + 1);
  assert.equal(after.audits, unchanged.audits + 2);
  assert.equal(after.approval.status, 'CONSUMED');
  assert.equal(after.approval.revision, 3);
  assert.deepEqual(after.balances, unchanged.balances);
  assert.equal(after.movements, unchanged.movements);
  await assert.rejects(() => requestApproval(scope, { ...input, expectedRevision: 3 }));
  await assert.rejects(() => executeWmsCommand(scope, { ...input, expectedRevision: 3 }, approval.id));
  assert.deepEqual(await before(), after);
  console.log('PASS: discrepancy 真实权限/双向撤权/自批拒绝/租户隔离/末端审计故障全事务回滚/六并发幂等/改载荷冲突；差异分类与净在途守恒且无库存流水');
  const racedOrder = await shipped();
  const races = [1, 2].map(quantity => command(racedOrder.id, 2, { action: 'TRANSFER_ORDER_DISCREPANCY', reference: `RACE-${quantity}`, reason: '隔离并发', lines: [{ lineId: racedOrder.lines[0].id, discrepancies: [{ category: quantity === 1 ? 'SHORT_RECEIVED' : 'DAMAGED', quantity: 5, evidence: '隔离证据' }] }] }));
  const raceApprovals: string[] = [];
  for (const item of races) raceApprovals.push(await approve(item));
  const raceResults = await Promise.allSettled(races.map((item, index) => executeWmsCommand(scope, item, raceApprovals[index])));
  assert.equal(raceResults.filter(row => row.status === 'fulfilled').length, 1);
  const loser = raceResults.findIndex(row => row.status === 'rejected');
  assert.equal((await prisma.wmsApproval.findUniqueOrThrow({ where: { id: raceApprovals[loser] } })).status, 'APPROVED');
  assert.equal((await prisma.wmsTransferOrder.findUniqueOrThrow({ where: { id: racedOrder.id } })).revision, 3);
  assert.equal(await prisma.wmsTransferDiscrepancy.count({ where: { orderId: racedOrder.id } }), 1);
  assert.equal(await prisma.wmsCommand.count({ where: { aggregateId: racedOrder.id, action: 'TRANSFER_ORDER_DISCREPANCY' } }), 1);
  console.log('PASS: 两个独立批准的同 revision discrepancy 仅一个提交，失败方审批不消费、无多余差异或命令');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
