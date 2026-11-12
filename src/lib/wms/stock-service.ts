import { scoped } from "./access";
import { WmsError, type WmsScope, type WmsCommandInput } from "./contracts";
import { activeLocation, balanceId, ensureBalances, lockAggregate, snapshot, type Tx } from "./repository";
import { availableQuantity, requirePositiveQuantity } from "./rules";

export async function validateReserve(tx: Tx, scope: WmsScope, input: WmsCommandInput) {
  if (input.payload.action !== "RESERVE") throw new WmsError("非预占动作。", 400);
  let line: { id: string; warehouseId: string; productRecordId: string; outboundId: string; requestedQty: number; outbound: { id: string; status: string } } | null = null;
  if (input.payload.outboundLineId) {
    const candidate = await tx.wmsOutboundLine.findFirst({ where: { ...scoped(scope), id: input.payload.outboundLineId }, select: { outboundId: true } });
    if (!candidate) throw new WmsError("出库需求明细不存在。", 404);
    await lockAggregate(tx, scope, candidate.outboundId, "outbound");
    await lockAggregate(tx, scope, input.payload.outboundLineId, "outboundLine");
    line = await tx.wmsOutboundLine.findFirst({ where: { ...scoped(scope), id: input.payload.outboundLineId, outboundId: candidate.outboundId }, include: { outbound: { select: { id: true, status: true } } } });
    if (!line) throw new WmsError("出库需求明细已变更。", 409);
    if (line.outbound.status !== "DRAFT" && line.outbound.status !== "RELEASED") throw new WmsError("出库需求当前状态不能继续预占。", 409);
  }
  await lockAggregate(tx, scope, input.aggregateId, "balance");
  const balance = await tx.wmsStockBalance.findFirst({ where: { ...scoped(scope), id: input.aggregateId }, include: { lot: { select: { productRecordId: true } } } });
  if (!balance) throw new WmsError("余额不存在。", 404);
  if (balance.revision !== input.expectedRevision) throw new WmsError("余额已变更。");
  await activeLocation(tx, scope, balance.locationId, balance.warehouseId, "STORAGE");
  if (input.payload.quantity > availableQuantity(snapshot(balance))) throw new WmsError("预占数量超过可用库存。", 422);
  if (await tx.wmsReservation.findFirst({ where: { ...scoped(scope), number: input.payload.number }, select: { id: true } })) throw new WmsError("预占单号已存在。");
  let outboundLine: { id: string; warehouseId: string; outboundId: string } | null = null;
  if (line) {
    if (line.warehouseId !== balance.warehouseId || line.productRecordId !== balance.lot.productRecordId) throw new WmsError("出库需求明细与当前 SKU 或仓库不匹配。", 422);
    const allocations = await tx.wmsReservation.aggregate({ where: { ...scoped(scope), outboundWarehouseId: line.warehouseId, outboundLineId: line.id }, _sum: { requestedQty: true, releasedQty: true, dispatchedQty: true } });
    const allocated = (allocations._sum.requestedQty ?? 0) - (allocations._sum.releasedQty ?? 0) - (allocations._sum.dispatchedQty ?? 0);
    const allocatable = line.requestedQty - (allocations._sum.dispatchedQty ?? 0) - allocated;
    if (input.payload.quantity > allocatable) throw new WmsError("预占数量超过出库需求剩余数量。", 422);
    outboundLine = { id: line.id, warehouseId: line.warehouseId, outboundId: line.outboundId };
  }
  return { balance, outboundLine };
}

export async function validateTransfer(tx: Tx, scope: WmsScope, input: WmsCommandInput) {
  if (input.payload.action !== "TRANSFER") throw new WmsError("非调拨动作。", 400);
  const source = await tx.wmsStockBalance.findFirst({ where: { ...scoped(scope), id: input.aggregateId } });
  if (!source) throw new WmsError("源库存余额不存在。", 404);
  const sourceLocation = await activeLocation(tx, scope, source.locationId, source.warehouseId, "STORAGE");
  const targetLocation = await activeLocation(tx, scope, input.payload.targetLocationId, undefined, "STORAGE");
  if (source.locationId === targetLocation.id) throw new WmsError("目标库位必须与源库位不同。", 422);
  if (source.revision !== input.expectedRevision) throw new WmsError("源库存已变更。", 409);
  if (input.payload.quantity > availableQuantity(snapshot(source))) throw new WmsError("调拨数量超过源库位可用库存。", 422);
  return { source, sourceLocation, targetLocation };
}

export async function prepareTransferBalances(tx: Tx, scope: WmsScope, input: WmsCommandInput) {
  const validated = await validateTransfer(tx, scope, input);
  const source = validated.source;
  await ensureBalances(tx, scope, [
    { locationId: source.locationId, warehouseId: source.warehouseId, lotId: source.lotId },
    { locationId: validated.targetLocation.id, warehouseId: validated.targetLocation.warehouseId, lotId: source.lotId },
  ]);
  const lockedSource = await tx.wmsStockBalance.findFirstOrThrow({ where: { ...scoped(scope), id: source.id } });
  const targetId = balanceId(scope, validated.targetLocation.id, source.lotId);
  const target = await tx.wmsStockBalance.findFirstOrThrow({ where: { ...scoped(scope), id: targetId } });
  if (lockedSource.revision !== input.expectedRevision) throw new WmsError("源库存已变更。", 409);
  if (input.payload.action !== "TRANSFER" || input.payload.quantity > availableQuantity(snapshot(lockedSource))) throw new WmsError("调拨数量超过源库位可用库存。", 422);
  return { source: lockedSource, target };
}

export async function validateReservationAction(tx: Tx, scope: WmsScope, input: WmsCommandInput) {
  const payload = input.payload;
  if (payload.action !== "PICK" && payload.action !== "UNPICK" && payload.action !== "RELEASE" && payload.action !== "DISPATCH") throw new WmsError("非预占单动作。", 400);
  await lockAggregate(tx, scope, input.aggregateId, "reservation");
  const reservation = await tx.wmsReservation.findFirst({ where: { ...scoped(scope), id: input.aggregateId } });
  if (!reservation) throw new WmsError("预占单不存在。", 404);
  if (reservation.revision !== input.expectedRevision) throw new WmsError("预占单已变更。");
  let outboundLine: { id: string; warehouseId: string; outboundId: string; status: string } | null = null;
  if (reservation.outboundLineId && reservation.outboundWarehouseId) {
    const candidate = await tx.wmsOutboundLine.findFirst({ where: { ...scoped(scope), id: reservation.outboundLineId, warehouseId: reservation.outboundWarehouseId }, select: { outboundId: true } });
    if (!candidate) throw new WmsError("关联出库需求明细不存在。");
    await lockAggregate(tx, scope, candidate.outboundId, "outbound");
    await lockAggregate(tx, scope, reservation.outboundLineId, "outboundLine");
    const line = await tx.wmsOutboundLine.findFirst({ where: { ...scoped(scope), id: reservation.outboundLineId, warehouseId: reservation.outboundWarehouseId, outboundId: candidate.outboundId }, include: { outbound: { select: { id: true, status: true } } } });
    if (!line) throw new WmsError("关联出库需求明细不存在。");
    if (line.outbound.status === "CANCELLED" || line.outbound.status === "COMPLETED") throw new WmsError("关联出库需求已结束，不能继续操作。");
    outboundLine = { id: line.id, warehouseId: line.warehouseId, outboundId: line.outboundId, status: line.outbound.status };
  }
  await lockAggregate(tx, scope, reservation.balanceId, "balance");
  const balance = await tx.wmsStockBalance.findFirstOrThrow({ where: { ...scoped(scope), id: reservation.balanceId } });
  await activeLocation(tx, scope, balance.locationId, balance.warehouseId, "STORAGE");
  const remaining = reservation.requestedQty - reservation.releasedQty - reservation.dispatchedQty;
  const qty = requirePositiveQuantity(payload.quantity);
  const data = { revision: reservation.revision + 1, pickedQty: reservation.pickedQty, releasedQty: reservation.releasedQty, dispatchedQty: reservation.dispatchedQty };
  if (payload.action === "PICK" || payload.action === "RELEASE") {
    if (qty > remaining - reservation.pickedQty) throw new WmsError("数量超过未拣货预占数量。", 422);
    if (payload.action === "PICK") data.pickedQty += qty; else data.releasedQty += qty;
  } else {
    if (qty > reservation.pickedQty) throw new WmsError("数量超过已拣数量。", 422);
    data.pickedQty -= qty;
    if (payload.action === "DISPATCH") data.dispatchedQty += qty;
  }
  return { reservation, balance, data, outboundLine };
}
