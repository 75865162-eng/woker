/**
 * 运营资料与滞销快照冒烟：在已有的验收演练组织里调真实服务，验证主数据写入、
 * revision 乐观锁、只读库存判定与快照幂等。
 * 用法：node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs scripts/smoke-ops-extensions.ts
 */
import { prisma } from '@/lib/db/prisma';
import { captureUnsalable, queryOps, saveOpsMaster } from '@/lib/operations/ops-service';
import type { WmsScope } from '@/lib/wms/contracts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function main() {
  const inPlace = process.argv.includes('--in-place');
  const org = inPlace
    ? await prisma.organization.findUnique({ where: { id: 'cmwdhm9ph0000o4ug8gd68zhd' } })
    : await prisma.organization.findFirst({ where: { id: { startsWith: 'acc-org-' } }, orderBy: { createdAt: 'desc' } });
  assert(org, '需先运行 scripts/acceptance-run.ts 生成验收组织');
  const operator = inPlace
    ? await prisma.user.findFirst({ where: { id: { startsWith: 'acc-operator-' } }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    : { id: `acc-operator-${org.id}` };
  assert(operator, '需先运行 scripts/acceptance-run.ts 生成双账号');
  const scope: WmsScope = { organizationId: org.id, workspaceId: 'default', actorUserId: operator.id };
  const warehouse = await prisma.wmsWarehouse.findFirst({ where: { organizationId: org.id, workspaceId: 'default' } });
  assert(warehouse, '验收组织应有仓库');
  // 可重复运行：先清掉本脚本产出的主数据与当天快照。
  const asOfDate = new Date().toISOString().slice(0, 10);
  await prisma.unsalableAssessment.deleteMany({ where: { organizationId: org.id, workspaceId: 'default', asOfDate: new Date(`${asOfDate}T00:00:00Z`) } });
  await prisma.carrier.deleteMany({ where: { organizationId: org.id, workspaceId: 'default', code: 'ACC-SMOKE-CARRIER' } });
  await prisma.thirdPartyWarehouse.deleteMany({ where: { organizationId: org.id, workspaceId: 'default', code: 'ACC-SMOKE-3PL' } });
  let checks = 0;

  const carrier = await saveOpsMaster(scope, 'carrier', { action: 'create-carrier', code: 'ACC-SMOKE-CARRIER', name: '验收承运商', serviceLevel: '快船', enabled: true }) as { id: string; revision: number; code: string };
  assert(carrier.code === 'ACC-SMOKE-CARRIER', '承运商编码应大写归一');
  checks += 1;
  const disabled = await saveOpsMaster(scope, 'carrier', { action: 'update-carrier', id: carrier.id, revision: carrier.revision, code: carrier.code, name: '验收承运商', enabled: false }) as { revision: number; enabled: boolean };
  assert(disabled.revision === carrier.revision + 1 && disabled.enabled === false, '承运商停用应带版本递增');
  checks += 1;
  let staleRejected = false;
  try { await saveOpsMaster(scope, 'carrier', { action: 'update-carrier', id: carrier.id, revision: carrier.revision, code: carrier.code, name: '验收承运商', enabled: true }); }
  catch { staleRejected = true; }
  assert(staleRejected, '过期版本必须被拒绝');
  checks += 1;

  const thirdParty = await saveOpsMaster(scope, 'warehouse', { action: 'create-warehouse', code: 'ACC-SMOKE-3PL', name: '验收三方仓', provider: '验收服务商', status: 'active', enabled: true }) as { code: string; status: string };
  assert(thirdParty.code === 'ACC-SMOKE-3PL' && thirdParty.status === 'ACTIVE', '三方仓编码与状态应归一');
  checks += 1;

  const baseline = {
    action: 'capture-unsalable', warehouseId: warehouse.id, asOfDate,
    policyReference: '库龄 ≥ 90 天且近 90 天销量为 0 判滞销',
    slowDays: 90, minSalesQty: 0, salesWindowDays: 90,
  };
  const first = await captureUnsalable(scope, baseline) as { reused: boolean; assessment: { recordCount: number; records: unknown } };
  assert(first.reused === false && first.assessment.recordCount >= 1, `快照应包含验收商品，实际 ${first.assessment.recordCount}`);
  const records = first.assessment.records as Array<{ sku: string; level: string; onHand: number }>;
  assert(records.some(item => item.sku.startsWith('ACC-SKU-') && item.onHand === 100), '快照应含 100 件在库的验收 SKU');
  checks += 1;
  const replay = await captureUnsalable(scope, baseline) as { reused: boolean };
  assert(replay.reused === true, '同源重复采集应幂等复用');
  checks += 1;
  let changedRejected = false;
  try { await captureUnsalable(scope, { ...baseline, slowDays: 30 }); } catch { changedRejected = true; }
  assert(changedRejected, '同日不同口径不得静默覆盖');
  checks += 1;

  const listed = await queryOps(scope, 'carriers') as { items: unknown[] };
  assert(listed.items.length >= 1, '承运商列表可读');
  checks += 1;
  console.log(`运营扩展冒烟通过：${checks} 项断言；承运商 / 三方仓主数据与滞销快照已留在组织 ${org.id}。`);
  await prisma.$disconnect();
}

main().catch(async error => {
  console.error('运营扩展冒烟失败：', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
