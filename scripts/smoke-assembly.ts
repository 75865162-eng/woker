/**
 * 组装链路冒烟：在单个事务里造一套最小主数据，跑「BOM 展开 → 组装单 → 完成扣料产出」，
 * 断言库存与成本结果后整单回滚，不在库里留任何数据。
 * 用法：npx tsx scripts/smoke-assembly.ts
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { executeAssembly } from '@/lib/wms/assembly-service';
import { allocateComponents, expandComponents, rolledUnitCost } from '@/lib/wms/assembly-rules';
import { ensureBalances, balanceId, snapshot } from '@/lib/wms/repository';
import type { WmsCommandInput, WmsScope } from '@/lib/wms/contracts';

const ROLLBACK = 'SMOKE_ROLLBACK';
const org = 'smoke-asm-org';
const ws = 'default';
const actor = 'smoke-asm-user';
const wh = 'smoke-asm-wh';
const area = 'smoke-asm-area';
const loc = 'smoke-asm-loc';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function main() {
  let checked = 0;
  try {
    await prisma.$transaction(async tx => {
      await tx.organization.create({ data: { id: org, name: '组装冒烟', slug: 'smoke-asm' } });
      await tx.workspaceScope.create({ data: { organizationId: org, id: ws, name: '默认空间' } });
      await tx.user.create({ data: { id: actor, email: 'smoke-asm@example.com', name: '组装冒烟', passwordHash: 'x' } });
      await tx.wmsWarehouse.create({ data: { id: wh, organizationId: org, workspaceId: ws, code: 'WH1', name: '冒烟仓' } });
      await tx.wmsArea.create({ data: { id: area, organizationId: org, workspaceId: ws, warehouseId: wh, code: 'A1', name: '存储区' } });
      await tx.wmsLocation.create({ data: { id: loc, organizationId: org, workspaceId: ws, warehouseId: wh, areaId: area, code: 'L1', kind: 'STORAGE' } });

      const components = [
        { id: 'smoke-asm-c1', sku: 'C1' },
        { id: 'smoke-asm-c2', sku: 'C2' },
      ];
      const finished = { id: 'smoke-asm-fg', sku: 'FG' };
      for (const product of [...components, finished]) {
        await tx.productRecord.create({ data: { id: product.id, organizationId: org, workspaceId: ws, userId: actor, sku: product.sku, chineseName: product.sku, payload: {} } });
      }

      const lots = new Map<string, string>();
      for (const product of components) {
        const lotId = `smoke-asm-lot-${product.id}`;
        lots.set(product.id, lotId);
        await tx.wmsLot.create({ data: { id: lotId, organizationId: org, workspaceId: ws, productRecordId: product.id, lotCode: `LOT-${product.sku}` } });
      }
      const scope: WmsScope = { organizationId: org, workspaceId: ws, actorUserId: actor };
      await ensureBalances(tx, scope, components.map(product => ({ locationId: loc, warehouseId: wh, lotId: lots.get(product.id)! })));
      await tx.wmsStockBalance.updateMany({ where: { organizationId: org, workspaceId: ws }, data: { onHand: 0 } });
      // C1 两个批次：先入库的批次应优先被消耗
      await tx.wmsStockBalance.update({ where: { id: balanceId(scope, loc, lots.get('smoke-asm-c1')!) }, data: { onHand: 8 } });
      await tx.wmsStockBalance.update({ where: { id: balanceId(scope, loc, lots.get('smoke-asm-c2')!) }, data: { onHand: 5 } });

      // 1) BOM 展开：C1 每件 2，C2 每件 1，计划 4 件
      const demand = expandComponents(
        [{ componentProductRecordId: 'smoke-asm-c1', quantityPer: 2 }, { componentProductRecordId: 'smoke-asm-c2', quantityPer: 1 }],
        4,
      );
      assert(demand.length === 2 && demand[0].quantity === 8 && demand[1].quantity === 4, 'BOM 展开数量不对');
      checked += 1;

      // 2) 组件分配
      const balances = await tx.wmsStockBalance.findMany({ where: { organizationId: org, workspaceId: ws }, include: { lot: true } });
      const { lines, shortages } = allocateComponents(
        demand,
        balances.map(row => ({
          balanceId: row.id, productRecordId: row.lot.productRecordId, lotId: row.lotId,
          locationId: row.locationId, warehouseId: row.warehouseId,
          available: snapshot(row).onHand - snapshot(row).reserved, createdAt: row.createdAt,
        })),
        wh,
      );
      assert(shortages.length === 0, `不应缺料：${JSON.stringify(shortages)}`);
      assert(lines.length === 2, '分配行数不对');
      checked += 1;

      // 3) 建 BOM 与组装单（直接落库，服务层的幂等/权限不在本冒烟范围）
      const bomId = 'smoke-asm-bom';
      await tx.wmsBom.create({ data: { id: bomId, organizationId: org, workspaceId: ws, productRecordId: finished.id, version: 'V1', createdBy: actor } });
      await tx.wmsBomLine.createMany({
        data: [
          { id: 'smoke-asm-boml1', organizationId: org, workspaceId: ws, bomId, componentProductRecordId: components[0].id, quantityPer: 2 },
          { id: 'smoke-asm-boml2', organizationId: org, workspaceId: ws, bomId, componentProductRecordId: components[1].id, quantityPer: 1 },
        ],
      });
      const orderId = 'smoke-asm-order';
      await tx.wmsAssemblyOrder.create({
        data: {
          id: orderId, organizationId: org, workspaceId: ws, number: 'ASM-SMOKE-1', bomId,
          productRecordId: finished.id, warehouseId: wh, locationId: loc, plannedQty: 4,
          idempotencyKey: 'smoke-1', requestHash: 'h', createdBy: actor,
        },
      });
      await tx.wmsAssemblyOrderLine.createMany({
        data: lines.map((line, index) => ({
          id: `smoke-asm-line${index}`, organizationId: org, workspaceId: ws, orderId,
          componentProductRecordId: line.componentProductRecordId, balanceId: line.balanceId,
          lotId: line.lotId, locationId: line.locationId, warehouseId: line.warehouseId,
          quantityPer: line.componentProductRecordId === components[0].id ? 2 : 1,
          plannedQty: line.plannedQty,
          unitCost: new Prisma.Decimal(line.componentProductRecordId === components[0].id ? '2.500000' : '1.000000'),
        })),
      });
      const commandId = 'smoke-asm-command';
      await tx.wmsCommand.create({
        data: { id: commandId, organizationId: org, workspaceId: ws, idempotencyKey: 'smoke-1', action: 'ASSEMBLY_COMPLETE', requestHash: 'h', aggregateId: orderId, expectedRevision: 1, result: {}, actorUserId: actor },
      });
      checked += 1;

      // 4) 完成：扣料 + 产出 + 滚成本
      const input: WmsCommandInput = {
        workspaceId: ws, aggregateId: orderId, expectedRevision: 1, idempotencyKey: 'smoke-1',
        payload: { action: 'ASSEMBLY_COMPLETE', reason: '冒烟' },
      };
      const result = await executeAssembly(tx, scope, input, commandId);
      assert(result.movementIds.length === 3, `应产生 3 条流水，实际 ${result.movementIds.length}`);
      const change = result.assemblyChange;
      assert(change.outputQty === 4, `产出应为 4，实际 ${change.outputQty}`);
      assert(change.componentCost === '24.000000', `组件成本应为 24，实际 ${change.componentCost}`);
      assert(change.unitCost === '6.000000', `单位成本应为 6，实际 ${change.unitCost}`);
      assert(rolledUnitCost(change.componentCost, change.outputQty) === change.unitCost, '单位成本滚动不一致');
      checked += 2;

      // 5) 库存结果：组件清零、成品入库 4
      const after = await tx.wmsStockBalance.findMany({ where: { organizationId: org, workspaceId: ws }, include: { lot: true } });
      const balanceOf = (productId: string) => after.filter(row => row.lot.productRecordId === productId).reduce((sum, row) => sum + row.onHand, 0);
      assert(balanceOf('smoke-asm-c1') === 0, `C1 应清零，实际 ${balanceOf('smoke-asm-c1')}`);
      assert(balanceOf('smoke-asm-c2') === 1, `C2 应剩 1，实际 ${balanceOf('smoke-asm-c2')}`);
      assert(balanceOf(finished.id) === 4, `成品应入库 4，实际 ${balanceOf(finished.id)}`);
      checked += 1;

      // 6) 单据状态与重复完成保护
      const stored = await tx.wmsAssemblyOrder.findUniqueOrThrow({ where: { id: orderId } });
      assert(stored.status === 'COMPLETED' && stored.outputQty === 4, '组装单状态不正确');
      const repeated = await executeAssembly(tx, scope, { ...input, expectedRevision: stored.revision, idempotencyKey: 'smoke-2' }, 'smoke-asm-command-2').then(() => 'NO_ERROR', (error: Error) => error.message);
      assert(repeated !== 'NO_ERROR', '重复完成应当被拒绝');
      checked += 1;

      throw new Error(ROLLBACK);
    });
  } catch (error) {
    if (error instanceof Error && error.message === ROLLBACK) {
      console.log(`组装冒烟通过：${checked} 项断言，事务已回滚，未落库。`);
      return;
    }
    throw error;
  }
}

main()
  .catch(error => {
    console.error('组装冒烟失败：', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
