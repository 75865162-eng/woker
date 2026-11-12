import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { auditWms, json, scoped } from './access';
import { activeLocation, balanceId, ensureBalances, lockAggregate, lockKey, move, snapshot, type Tx } from './repository';
import { WmsError, type WmsCommandInput, type WmsScope } from './contracts';
import { requireText } from './rules';
import {
  allocateComponents,
  expandComponents,
  lineAmount,
  parseAssemblyDraft,
  parseBomDraft,
  rolledUnitCost,
  shortageMessage,
  totalComponentCost,
  type AllocationCandidate,
} from './assembly-rules';

/**
 * 组装服务。
 * 草稿不动库存、不预占；完成动作走 WMS 命令通道（需独立审批），在同一事务里扣组件、产成品、滚成本。
 */

export async function createBom(scope: WmsScope, raw: unknown) {
  const draft = parseBomDraft(raw);
  const identity = scoped(scope);
  return prisma.$transaction(async tx => {
    const product = await tx.productRecord.findFirst({ where: { ...identity, id: draft.productRecordId } });
    if (!product) throw new WmsError('成品商品不存在。', 404);
    const components = await tx.productRecord.findMany({ where: { ...identity, id: { in: draft.lines.map(line => line.componentProductRecordId) } }, select: { id: true } });
    if (components.length !== draft.lines.length) throw new WmsError('BOM 含不存在的组件商品。', 422);
    const existing = await tx.wmsBom.findFirst({ where: { ...identity, productRecordId: draft.productRecordId, version: draft.version } });
    if (existing) throw new WmsError('同成品同版本 BOM 已存在。', 409);
    const id = crypto.randomUUID();
    await tx.wmsBom.create({ data: { ...identity, id, productRecordId: draft.productRecordId, version: draft.version, notes: draft.notes, createdBy: scope.actorUserId } });
    await tx.wmsBomLine.createMany({ data: draft.lines.map(line => ({ ...identity, id: crypto.randomUUID(), bomId: id, componentProductRecordId: line.componentProductRecordId, quantityPer: line.quantityPer, notes: line.notes })) });
    await auditWms(tx, scope, 'assembly.bom.create', id, json({ productRecordId: draft.productRecordId, version: draft.version, lines: draft.lines.length }));
    return tx.wmsBom.findUniqueOrThrow({ where: { id }, include: { product: { select: { id: true, sku: true, chineseName: true } }, lines: { include: { component: { select: { id: true, sku: true, chineseName: true } } } } } });
  });
}

export async function setBomEnabled(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, 'BOM ID', 100);
  if (typeof body.enabled !== 'boolean') throw new WmsError('启用状态无效。', 400);
  const revision = Number(body.revision);
  if (!Number.isInteger(revision) || revision < 1) throw new WmsError('版本号无效。', 400);
  return prisma.$transaction(async tx => {
    const row = await tx.wmsBom.findFirst({ where: { ...scoped(scope), id } });
    if (!row) throw new WmsError('BOM 不存在。', 404);
    if (row.revision !== revision) throw new WmsError('BOM 已被修改，请刷新。', 409);
    const updated = await tx.wmsBom.update({ where: { id }, data: { enabled: body.enabled as boolean, revision: { increment: 1 } } });
    await auditWms(tx, scope, 'assembly.bom.toggle', id, json({ enabled: body.enabled }));
    return updated;
  });
}

export async function queryBoms(scope: WmsScope, params: URLSearchParams) {
  const productRecordId = params.get('productRecordId');
  const rows = await prisma.wmsBom.findMany({
    where: { ...scoped(scope), ...(productRecordId ? { productRecordId } : {}) },
    include: {
      product: { select: { id: true, sku: true, chineseName: true } },
      lines: { include: { component: { select: { id: true, sku: true, chineseName: true } } }, orderBy: { id: 'asc' } },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 100,
  });
  return { items: rows };
}

type CostRow = { productRecordId: string; unitCost: string };

async function componentCosts(tx: Tx, scope: WmsScope, productRecordIds: string[]) {
  const costs = new Map<string, string>();
  if (!productRecordIds.length) return costs;
  const rows = await tx.$queryRaw<CostRow[]>(Prisma.sql`
    SELECT DISTINCT ON (l."productRecordId") l."productRecordId" AS "productRecordId", e."unitCost"::text AS "unitCost"
    FROM "WmsCostEntry" e
    JOIN "WmsMovement" m ON m."id" = e."movementId" AND m."organizationId" = e."organizationId" AND m."workspaceId" = e."workspaceId"
    JOIN "WmsStockBalance" b ON b."id" = m."balanceId" AND b."organizationId" = m."organizationId" AND b."workspaceId" = m."workspaceId"
    JOIN "WmsLot" l ON l."id" = b."lotId" AND l."organizationId" = b."organizationId" AND l."workspaceId" = b."workspaceId"
    WHERE e."organizationId" = ${scope.organizationId} AND e."workspaceId" = ${scope.workspaceId}
      AND l."productRecordId" IN (${Prisma.join(productRecordIds)})
    ORDER BY l."productRecordId", e."createdAt" DESC`);
  for (const row of rows) costs.set(row.productRecordId, row.unitCost);
  const missing = productRecordIds.filter(id => !costs.has(id));
  if (missing.length) {
    // 没有历史计价分录时退回商品档案采购价，避免成本为 0 让财务误判
    const products = await tx.productRecord.findMany({ where: { ...scoped(scope), id: { in: missing } }, select: { id: true, purchasePrice: true } });
    for (const product of products) costs.set(product.id, Number(product.purchasePrice ?? 0).toFixed(6));
  }
  return costs;
}

export async function createAssemblyOrder(scope: WmsScope, raw: unknown) {
  const draft = parseAssemblyDraft(raw);
  const identity = scoped(scope);
  const requestHash = createHash('sha256').update(JSON.stringify(draft)).digest('hex');
  return prisma.$transaction(async tx => {
    await lockKey(tx, JSON.stringify(['assembly-order', identity, draft.idempotencyKey]));
    const prior = await tx.wmsAssemblyOrder.findFirst({ where: { ...identity, idempotencyKey: draft.idempotencyKey }, include: { lines: true } });
    if (prior) {
      if (prior.requestHash !== requestHash || prior.createdBy !== scope.actorUserId) throw new WmsError('组装单幂等键冲突。', 409);
      return prior;
    }
    const product = await tx.productRecord.findFirst({ where: { ...identity, id: draft.productRecordId } });
    if (!product) throw new WmsError('成品商品不存在。', 404);
    const bom = draft.bomId
      ? await tx.wmsBom.findFirst({ where: { ...identity, id: draft.bomId }, include: { lines: true } })
      : await tx.wmsBom.findFirst({ where: { ...identity, productRecordId: draft.productRecordId, enabled: true }, include: { lines: true }, orderBy: { createdAt: 'desc' } });
    if (!bom) throw new WmsError('该成品没有可用 BOM，请先维护 BOM。', 422);
    if (bom.productRecordId !== draft.productRecordId) throw new WmsError('BOM 与成品不匹配。', 422);
    const demand = expandComponents(bom.lines, draft.plannedQty, draft.overrides);
    const location = await activeLocation(tx, scope, draft.locationId, draft.warehouseId, 'STORAGE');
    const balances = await tx.wmsStockBalance.findMany({
      where: { ...identity, warehouseId: draft.warehouseId, lot: { productRecordId: { in: demand.map(row => row.componentProductRecordId) } } },
      include: { lot: { select: { productRecordId: true } } },
    });
    const candidates: AllocationCandidate[] = balances.map(row => ({
      balanceId: row.id,
      productRecordId: row.lot.productRecordId,
      lotId: row.lotId,
      locationId: row.locationId,
      warehouseId: row.warehouseId,
      available: snapshot(row).onHand - snapshot(row).pendingQc - snapshot(row).pendingPutaway - snapshot(row).rejected - snapshot(row).reserved,
      createdAt: row.createdAt,
    }));
    const { lines: allocated, shortages } = allocateComponents(demand, candidates, location.warehouseId);
    if (shortages.length) throw new WmsError(shortageMessage(shortages), 422);
    const costs = await componentCosts(tx, scope, demand.map(row => row.componentProductRecordId));
    const quantityPer = new Map(bom.lines.map(line => [line.componentProductRecordId, line.quantityPer]));
    const id = crypto.randomUUID();
    await tx.wmsAssemblyOrder.create({
      data: {
        ...identity, id, number: draft.number, bomId: bom.id, productRecordId: draft.productRecordId,
        warehouseId: location.warehouseId, locationId: location.id, lotId: draft.lotId,
        plannedQty: draft.plannedQty, currency: draft.currency, notes: draft.notes,
        idempotencyKey: draft.idempotencyKey, requestHash, createdBy: scope.actorUserId,
      },
    });
    await tx.wmsAssemblyOrderLine.createMany({
      data: allocated.map(line => {
        const unitCost = costs.get(line.componentProductRecordId) ?? '0.000000';
        return {
          ...identity, id: crypto.randomUUID(), orderId: id, componentProductRecordId: line.componentProductRecordId,
          balanceId: line.balanceId, lotId: line.lotId, locationId: line.locationId, warehouseId: line.warehouseId,
          quantityPer: quantityPer.get(line.componentProductRecordId) ?? 0, plannedQty: line.plannedQty,
          unitCost: new Prisma.Decimal(unitCost), amount: new Prisma.Decimal(lineAmount(line.plannedQty, unitCost)),
        };
      }),
    });
    await auditWms(tx, scope, 'assembly.order.create', id, json({ number: draft.number, plannedQty: draft.plannedQty, lines: allocated.length }));
    return tx.wmsAssemblyOrder.findUniqueOrThrow({
      where: { id },
      include: { product: { select: { id: true, sku: true, chineseName: true } }, lines: { include: { component: { select: { id: true, sku: true, chineseName: true } } } } },
    });
  });
}

export async function queryAssemblyOrders(scope: WmsScope, params: URLSearchParams) {
  const status = params.get('status');
  const number = params.get('number');
  const id = params.get('id');
  const rows = await prisma.wmsAssemblyOrder.findMany({
    where: { ...scoped(scope), ...(status ? { status } : {}), ...(number ? { number } : {}), ...(id ? { id } : {}) },
    include: {
      product: { select: { id: true, sku: true, chineseName: true } },
      targetLocation: { select: { id: true, code: true, warehouseId: true } },
      lines: { include: { component: { select: { id: true, sku: true, chineseName: true } } }, orderBy: { id: 'asc' } },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 100,
  });
  return { items: rows };
}

export async function cancelAssemblyOrder(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '组装单 ID', 100);
  const revision = Number(body.revision);
  if (!Number.isInteger(revision) || revision < 1) throw new WmsError('版本号无效。', 400);
  const reason = body.reason === undefined ? '' : requireText(body.reason, '作废原因', 500);
  return prisma.$transaction(async tx => {
    await lockAggregate(tx, scope, id, 'assemblyOrder');
    const order = await tx.wmsAssemblyOrder.findFirst({ where: { ...scoped(scope), id } });
    if (!order) throw new WmsError('组装单不存在。', 404);
    if (order.status !== 'DRAFT') throw new WmsError('只有草稿组装单可以作废。', 409);
    if (order.revision !== revision) throw new WmsError('组装单已变更，请刷新。', 409);
    if (order.createdBy !== scope.actorUserId) throw new WmsError('仅创建人可作废组装单。', 403);
    const updated = await tx.wmsAssemblyOrder.update({ where: { id }, data: { status: 'CANCELLED', revision: { increment: 1 } } });
    await auditWms(tx, scope, 'assembly.order.cancel', id, json({ reason }));
    return updated;
  });
}

/**
 * 组装完成校验：一次完成整单，按计划产量全额耗用组件。
 * 部分完成会让「扣料」和「产出」脱钩，这里直接不做——要分次做请拆成多张组装单。
 */
export async function validateAssemblyCompletion(tx: Tx, scope: WmsScope, input: WmsCommandInput) {
  if (input.payload.action !== 'ASSEMBLY_COMPLETE') throw new WmsError('非组装完成动作。', 400);
  await lockAggregate(tx, scope, input.aggregateId, 'assemblyOrder');
  const order = await tx.wmsAssemblyOrder.findFirst({ where: { ...scoped(scope), id: input.aggregateId }, include: { lines: true } });
  if (!order) throw new WmsError('组装单不存在。', 404);
  if (order.status !== 'DRAFT') throw new WmsError('组装单已完成或已作废。', 409);
  if (order.revision !== input.expectedRevision) throw new WmsError('组装单已变更，请刷新。', 409);
  if (order.createdBy !== scope.actorUserId) throw new WmsError('仅创建人可提交组装完成。', 403);
  if (!order.lines.length) throw new WmsError('组装单没有组件明细。', 422);
  await activeLocation(tx, scope, order.locationId, order.warehouseId, 'STORAGE');
  const selected = order.lines.map(line => ({ line, quantity: line.plannedQty - line.consumedQty })).filter(item => item.quantity > 0);
  if (!selected.length) throw new WmsError('组件已全部耗用，无需重复完成。', 409);
  const totals = new Map<string, number>();
  for (const item of selected) totals.set(item.line.balanceId, (totals.get(item.line.balanceId) ?? 0) + item.quantity);
  for (const [id, quantity] of totals) {
    const balance = await tx.wmsStockBalance.findFirstOrThrow({ where: { ...scoped(scope), id } });
    const state = snapshot(balance);
    const available = state.onHand - state.pendingQc - state.pendingPutaway - state.rejected - state.reserved;
    if (quantity > available) throw new WmsError('组件可用库存不足，请刷新后重新创建组装单。', 422);
  }
  return { order, selected };
}

async function resolveFinishedLot(tx: Tx, scope: WmsScope, order: { number: string; productRecordId: string; lotId: string | null }) {
  if (order.lotId) {
    const lot = await tx.wmsLot.findFirst({ where: { ...scoped(scope), id: order.lotId } });
    if (!lot) throw new WmsError('成品批次不存在。', 404);
    if (lot.productRecordId !== order.productRecordId) throw new WmsError('成品批次与成品商品不匹配。', 422);
    return lot;
  }
  const lotCode = `ASM-${order.number}`;
  const existing = await tx.wmsLot.findFirst({ where: { ...scoped(scope), productRecordId: order.productRecordId, lotCode } });
  if (existing) return existing;
  return tx.wmsLot.create({ data: { ...scoped(scope), id: crypto.randomUUID(), productRecordId: order.productRecordId, lotCode } });
}

export async function executeAssembly(tx: Tx, scope: WmsScope, input: WmsCommandInput, commandId: string) {
  const { order, selected } = await validateAssemblyCompletion(tx, scope, input);
  if (input.payload.action !== 'ASSEMBLY_COMPLETE') throw new WmsError('非组装完成动作。', 400);
  const finishedLot = await resolveFinishedLot(tx, scope, order);
  await ensureBalances(tx, scope, [
    ...selected.map(item => ({ locationId: item.line.locationId, warehouseId: item.line.warehouseId, lotId: item.line.lotId })),
    { locationId: order.locationId, warehouseId: order.warehouseId, lotId: finishedLot.id },
  ]);
  const movementIds: string[] = [];
  const costLines: Array<{ consumedQty: number; unitCost: string }> = [];
  for (const item of selected) {
    const balance = await tx.wmsStockBalance.findFirstOrThrow({ where: { ...scoped(scope), id: item.line.balanceId } });
    const state = snapshot(balance);
    const available = state.onHand - state.pendingQc - state.pendingPutaway - state.rejected - state.reserved;
    if (item.quantity > available) throw new WmsError('组件可用库存已变化，请刷新后重试。', 422);
    const movement = await move(tx, scope, commandId, movementIds.length, balance, { onHand: -item.quantity }, { action: input.payload.action, sourceType: 'ASSEMBLY_ORDER', sourceId: order.id, sourceLineId: item.line.id });
    movementIds.push(movement.id);
    const amount = lineAmount(item.quantity, item.line.unitCost.toString());
    await tx.wmsAssemblyOrderLine.update({ where: { id: item.line.id }, data: { consumedQty: { increment: item.quantity }, amount: new Prisma.Decimal(amount) } });
    costLines.push({ consumedQty: item.quantity, unitCost: item.line.unitCost.toString() });
  }
  const finishedBalance = await tx.wmsStockBalance.findFirstOrThrow({ where: { ...scoped(scope), id: balanceId(scope, order.locationId, finishedLot.id) } });
  movementIds.push((await move(tx, scope, commandId, movementIds.length, finishedBalance, { onHand: order.plannedQty }, { action: input.payload.action, sourceType: 'ASSEMBLY_ORDER', sourceId: order.id })).id);
  const componentCost = totalComponentCost(costLines);
  const unitCost = rolledUnitCost(componentCost, order.plannedQty);
  const updated = await tx.wmsAssemblyOrder.update({
    where: { id: order.id },
    data: { status: 'COMPLETED', outputQty: order.plannedQty, componentCost: new Prisma.Decimal(componentCost), unitCost: new Prisma.Decimal(unitCost), completedCommandId: commandId, revision: { increment: 1 } },
  });
  return {
    revision: updated.revision,
    movementIds,
    assemblyChange: {
      orderId: order.id, number: order.number, status: 'COMPLETED', outputQty: order.plannedQty,
      finishedLotId: finishedLot.id, componentCost, unitCost,
      lines: selected.map(item => ({ lineId: item.line.id, consumedQty: item.quantity })),
    },
  };
}

/** 页面初始化用的一次性选项：商品、可用库位、BOM 列表。 */
export async function queryAssemblyOptions(scope: WmsScope) {
  const identity = scoped(scope);
  const [products, locations, boms] = await Promise.all([
    prisma.productRecord.findMany({ where: identity, select: { id: true, sku: true, chineseName: true }, orderBy: { sku: 'asc' }, take: 500 }),
    prisma.wmsLocation.findMany({
      where: { ...identity, enabled: true, kind: 'STORAGE', warehouse: { enabled: true } },
      select: { id: true, code: true, warehouseId: true, warehouse: { select: { name: true } } },
      orderBy: [{ warehouseId: 'asc' }, { code: 'asc' }],
      take: 1000,
    }),
    prisma.wmsBom.findMany({ where: { ...identity, enabled: true }, select: { id: true, productRecordId: true, version: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
  ]);
  return { products, locations, boms };
}
