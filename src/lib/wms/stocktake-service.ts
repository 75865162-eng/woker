import { Prisma } from "@prisma/client";
import { scoped } from "./access";
import { WmsError, type WmsCommandInput, type WmsScope } from "./contracts";
import { activeLocation, balanceId, lockAggregate, move, type Tx } from "./repository";
import { requireText, strictKeys, wmsMaxReceiptLines } from "./rules";

const key = (locationId: string, lotId: string) => JSON.stringify([locationId, lotId]);

export async function createStocktake(tx: Tx, scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ["warehouseId", "number", "locationIds", "mode", "blind", "selectionEvidence"]);
  const warehouseId = requireText(body.warehouseId, "仓库 ID");
  const number = requireText(body.number, "盘点单号");
  const mode = body.mode == null ? 'SAMPLE' : requireText(body.mode, '盘点模式');
  if (!['FULL', 'SAMPLE', 'ACTIVITY'].includes(mode)) throw new WmsError('盘点范围模式无效。', 400);
  if (body.blind != null && typeof body.blind !== 'boolean') throw new WmsError('须明确是否盲盘。', 400);
  const blind = body.blind === true;
  const selectionEvidence = mode === 'ACTIVITY' ? requireText(body.selectionEvidence, '动销范围依据', 1000) : (body.selectionEvidence == null || body.selectionEvidence === '' ? '' : requireText(body.selectionEvidence, '选取依据', 1000));
  if (mode === 'FULL') {
    const locations = await tx.wmsLocation.findMany({ where: { ...scoped(scope), warehouseId, enabled: true, kind: 'STORAGE' }, select: { id: true }, orderBy: { id: 'asc' }, take: 101 });
    if (locations.length > 100) throw new WmsError('全盘超过 100 个库位，须先拆分审批范围。', 422);
    if (body.locationIds != null && (!Array.isArray(body.locationIds) || body.locationIds.length)) throw new WmsError('全盘范围由服务端确定，请勿指定部分库位。', 400);
    body = { ...body, locationIds: locations.map(row => row.id) };
  }
  if (!Array.isArray(body.locationIds) || !body.locationIds.length || body.locationIds.length > 100) throw new WmsError("请选择 1-100 个盘点库位。", 400);
  const ids = body.locationIds.map(id => requireText(id, "库位 ID")).sort();
  if (new Set(ids).size !== ids.length) throw new WmsError("盘点库位不能重复。", 400);
  for (const id of ids) await activeLocation(tx, scope, id, warehouseId, "STORAGE");
  const id = crypto.randomUUID();
  const row = await tx.wmsStocktake.create({ data: { ...scoped(scope), id, warehouseId, number, mode, blind, selectionEvidence, createdBy: scope.actorUserId } });
  await tx.wmsStocktakeLocation.createMany({ data: ids.map(locationId => ({
    ...scoped(scope), id: crypto.randomUUID(), stocktakeId: id, warehouseId, locationId,
  })) });
  return row;
}

async function loadStocktake(tx: Tx, scope: WmsScope, input: WmsCommandInput) {
  await lockAggregate(tx, scope, input.aggregateId, "stocktake");
  const row = await tx.wmsStocktake.findFirst({ where: { ...scoped(scope), id: input.aggregateId },
    include: { locations: { orderBy: { locationId: "asc" }, include: { lines: { orderBy: { id: "asc" } } } } } });
  if (!row) throw new WmsError("盘点单不存在。", 404);
  if (row.revision !== input.expectedRevision) throw new WmsError("盘点单已变更，请刷新。");
  return row;
}

function requireCounted(row: Awaited<ReturnType<typeof loadStocktake>>) {
  const lines = row.locations.flatMap(location => location.lines);
  if (lines.some(line => line.countedQty === null)) throw new WmsError("仍有未实盘明细；实盘为零也必须明确录入。", 422);
  return lines;
}

async function lockPostingInventory(tx: Tx, scope: WmsScope, locationIds: string[]) {
  // NOWAIT avoids lock inversion with existing commands that lock a balance before its location.
  // Location exclusivity also prevents a new balance from appearing during posting.
  try {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "WmsLocation"
      WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId}
      AND id IN (${Prisma.join(locationIds)}) ORDER BY id FOR UPDATE NOWAIT`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "WmsStockBalance"
      WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId}
      AND "locationId" IN (${Prisma.join(locationIds)}) ORDER BY id FOR UPDATE NOWAIT`);
  } catch (error) {
    const databaseError = error && typeof error === "object" ? error as { code?: unknown; message?: unknown; meta?: { code?: unknown } } : null;
    const lockUnavailable = databaseError?.code === "P2010" && (databaseError.meta?.code === "55P03" || (typeof databaseError.message === "string" && databaseError.message.includes("55P03")));
    if (lockUnavailable) throw new WmsError("盘点库位或库存正在操作，请稍后重试。");
    throw error;
  }
}

export async function validateStocktakePost(tx: Tx, scope: WmsScope, input: WmsCommandInput) {
  const row = await loadStocktake(tx, scope, input);
  if (row.status !== "REVIEW") throw new WmsError("仅待审核盘点单可以申请或执行过账。");
  const lines = requireCounted(row);
  const locationIds = row.locations.map(location => location.locationId);
  await lockPostingInventory(tx, scope, locationIds);
  for (const location of row.locations) await activeLocation(tx, scope, location.locationId, row.warehouseId, "STORAGE");
  const balances = await tx.wmsStockBalance.findMany({ where: { ...scoped(scope), locationId: { in: locationIds } } });
  const byKey = new Map(balances.map(balance => [key(balance.locationId, balance.lotId), balance]));
  const countedKeys = new Set(lines.map(line => key(line.locationId, line.lotId)));
  if (balances.some(balance => !countedKeys.has(key(balance.locationId, balance.lotId)))) throw new WmsError("盘点范围出现新库存，请取消后重新盘点。");
  for (const line of lines) {
    const balance = byKey.get(key(line.locationId, line.lotId));
    if (line.baselineRevision === null ? Boolean(balance) : !balance || balance.revision !== line.baselineRevision ||
      balance.onHand !== line.baselineOnHand || balance.pendingQc !== line.baselinePendingQc ||
      balance.pendingPutaway !== line.baselinePendingPutaway || balance.rejected !== line.baselineRejected ||
      balance.reserved !== line.baselineReserved) throw new WmsError("账面基准已变化，请取消后重新盘点。");
    if (line.countedQty! < line.baselinePendingQc + line.baselinePendingPutaway + line.baselineRejected + line.baselineReserved) throw new WmsError("实盘数量低于待处理及预占合计，请先处理相关库存后重新盘点。", 422);
  }
  return { row, lines, byKey };
}

export async function executeStocktake(tx: Tx, scope: WmsScope, input: WmsCommandInput, commandId: string) {
  const payload = input.payload;
  const movementIds: string[] = [];
  if (payload.action === "STOCKTAKE_POST") {
    const { row, lines, byKey } = await validateStocktakePost(tx, scope, input);
    for (const line of lines) {
      const delta = line.countedQty! - line.baselineOnHand;
      if (!delta) continue;
      let balance = byKey.get(key(line.locationId, line.lotId));
      if (!balance) {
        balance = await tx.wmsStockBalance.create({ data: { ...scoped(scope), id: balanceId(scope, line.locationId, line.lotId),
          warehouseId: row.warehouseId, locationId: line.locationId, lotId: line.lotId } });
      }
      movementIds.push((await move(tx, scope, commandId, movementIds.length, balance, { onHand: delta },
        { action: payload.action, sourceType: "STOCKTAKE", sourceId: row.id, sourceLineId: line.id })).id);
    }
    const updated = await tx.wmsStocktake.update({ where: { id: row.id }, data: {
      status: "POSTED", postedAt: new Date(), postedCommandId: commandId, revision: { increment: 1 },
    } });
    return { revision: updated.revision, movementIds };
  }
  const row = await loadStocktake(tx, scope, input);
  if (payload.action === "STOCKTAKE_CANCEL") {
    if (!["DRAFT", "COUNTING", "REVIEW"].includes(row.status)) throw new WmsError("当前盘点状态不能取消。");
    const updated = await tx.wmsStocktake.update({ where: { id: row.id }, data: { status: "CANCELLED", revision: { increment: 1 } } });
    return { revision: updated.revision, movementIds };
  }
  if (payload.action === "STOCKTAKE_START") {
    if (row.status !== "DRAFT") throw new WmsError("仅草稿可以开始盘点。");
    for (const location of row.locations) await activeLocation(tx, scope, location.locationId, row.warehouseId, "STORAGE");
    if (row.mode === 'FULL') {
      const active = await tx.wmsLocation.findMany({ where: { ...scoped(scope), warehouseId: row.warehouseId, enabled: true, kind: 'STORAGE' }, select: { id: true } });
      if (active.length !== row.locations.length || active.some(location => !row.locations.some(selected => selected.locationId === location.id))) throw new WmsError('全盘库位范围已变化，请取消重建。', 409);
    }
    // One SELECT gives every captured balance the same committed snapshot.
    const balances = await tx.wmsStockBalance.findMany({ where: { ...scoped(scope), locationId: { in: row.locations.map(location => location.locationId) } },
      take: wmsMaxReceiptLines + 1, orderBy: { id: "asc" } });
    if (balances.length > wmsMaxReceiptLines) throw new WmsError("单次盘点最多 100 个库位批次，请拆分库位范围。", 422);
    if (balances.length) await tx.wmsStocktakeLine.createMany({ data: balances.map(balance => ({
      ...scoped(scope), id: crypto.randomUUID(), stocktakeId: row.id, locationId: balance.locationId, lotId: balance.lotId,
      baselineRevision: balance.revision, baselineOnHand: balance.onHand, baselinePendingQc: balance.pendingQc,
      baselinePendingPutaway: balance.pendingPutaway, baselineRejected: balance.rejected, baselineReserved: balance.reserved,
    })) });
    const updated = await tx.wmsStocktake.update({ where: { id: row.id }, data: { status: "COUNTING", startedAt: new Date(), revision: { increment: 1 } } });
    return { revision: updated.revision, movementIds };
  }
  if (payload.action === "STOCKTAKE_REVIEW") {
    if (row.status !== "COUNTING") throw new WmsError("仅盘点中单据可以提交审核。");
    requireCounted(row);
    const updated = await tx.wmsStocktake.update({ where: { id: row.id }, data: { status: "REVIEW", revision: { increment: 1 } } });
    return { revision: updated.revision, movementIds };
  }
  if (payload.action !== "STOCKTAKE_COUNT" || row.status !== "COUNTING") throw new WmsError("当前状态不允许录入实盘。");
  let lineCount = row.locations.reduce((sum, location) => sum + location.lines.length, 0);
  for (const entry of payload.lines) {
    const location = row.locations.find(location => location.locationId === entry.locationId);
    if (!location) throw new WmsError("实盘库位不在当前盘点范围。", 422);
    const existing = location.lines.find(line => line.lotId === entry.lotId);
    const data = { countedQty: entry.countedQty, countedBy: scope.actorUserId, countedAt: new Date() };
    if (existing) await tx.wmsStocktakeLine.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } });
    else {
      if (++lineCount > wmsMaxReceiptLines) throw new WmsError("单次盘点最多 100 个库位批次。", 422);
      if (!await tx.wmsLot.findFirst({ where: { ...scoped(scope), id: entry.lotId } })) throw new WmsError("批次不属于当前工作区。", 422);
      if (await tx.wmsStockBalance.findFirst({ where: { ...scoped(scope), locationId: entry.locationId, lotId: entry.lotId } })) throw new WmsError("盘点开始后出现新余额，请取消后重新盘点。");
      await tx.wmsStocktakeLine.create({ data: { ...scoped(scope), id: crypto.randomUUID(), stocktakeId: row.id,
        locationId: entry.locationId, lotId: entry.lotId, baselineRevision: null, baselineOnHand: 0,
        baselinePendingQc: 0, baselinePendingPutaway: 0, baselineRejected: 0, baselineReserved: 0, ...data } });
    }
  }
  const updated = await tx.wmsStocktake.update({ where: { id: row.id }, data: { revision: { increment: 1 } } });
  return { revision: updated.revision, movementIds };
}
