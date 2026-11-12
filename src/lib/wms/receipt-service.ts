import { scoped } from "./access";
import { WmsError, type WmsScope, type WmsCommandInput } from "./contracts";
import { activeLocation, balanceId, ensureBalances, lockAggregate, move, type Tx } from "./repository";

export async function validateReceiptAction(tx: Tx, scope: WmsScope, input: WmsCommandInput) {
  const payload = input.payload;
  if (payload.action !== "RECEIVE" && payload.action !== "INSPECT" && payload.action !== "PUTAWAY" && payload.action !== "RETURN_REJECTED" && payload.action !== "CANCEL") throw new WmsError("非收货动作。", 400);
  await lockAggregate(tx, scope, input.aggregateId, "receipt");
  const receipt = await tx.wmsReceipt.findFirst({ where: { ...scoped(scope), id: input.aggregateId }, include: { lines: true } });
  if (!receipt) throw new WmsError("收货单不存在。", 404);
  if (receipt.revision !== input.expectedRevision) throw new WmsError("收货单已变更。");
  if (payload.action === "CANCEL") {
    if (receipt.status !== "DRAFT" || receipt.createdBy !== scope.actorUserId) throw new WmsError("仅能取消自己的草稿。", 403);
    return receipt;
  }
  if (payload.action === "RECEIVE" ? receipt.status !== "DRAFT" : !["RECEIVED", "INSPECTED", "PUTAWAY"].includes(receipt.status)) throw new WmsError("收货单状态不允许此动作。");
  if (payload.action === "RECEIVE" && receipt.createdBy !== scope.actorUserId) throw new WmsError("收货须由草稿创建人提交。", 403);
  await activeLocation(tx, scope, receipt.receivingLocationId, receipt.warehouseId, "RECEIVING");
  const selected = payload.lines.map(line => {
    const stored = receipt.lines.find(candidate => candidate.id === line.lineId);
    if (!stored) throw new WmsError("明细不属于当前收货单。", 422);
    return stored;
  });
  for (const item of payload.lines) {
    const line = selected.find(candidate => candidate.id === item.lineId)!;
    if (payload.action === "RECEIVE" && "quantity" in item && item.quantity > line.expectedQty) throw new WmsError("实收超过预期数量。", 422);
    if (payload.action === "INSPECT" && "acceptedQty" in item) {
      const total = item.acceptedQty + item.rejectedQty;
      if (!total || total > line.receivedQty - line.acceptedQty - line.rejectedQty) throw new WmsError("质检数量超过待检数量。", 422);
    }
    if (payload.action === "PUTAWAY" && "locationId" in item) {
      if (item.quantity > line.acceptedQty - line.putawayQty) throw new WmsError("上架数量超过待上架数量。", 422);
      await activeLocation(tx, scope, item.locationId, receipt.warehouseId, "STORAGE");
    }
    if (payload.action === "RETURN_REJECTED" && "quantity" in item && item.quantity > line.rejectedQty - line.returnedQty) throw new WmsError("退回数量超过尚未退回的拒收数量。", 422);
  }
  return receipt;
}

export async function executeReceipt(tx: Tx, scope: WmsScope, input: WmsCommandInput, commandId: string) {
  const receipt = await validateReceiptAction(tx, scope, input);
  const payload = input.payload;
  const movementIds: string[] = [];
  if (payload.action === "CANCEL") {
    await tx.wmsReceipt.update({ where: { id: receipt.id }, data: { status: "CANCELLED", revision: { increment: 1 } } });
    return { revision: receipt.revision + 1, movementIds };
  }
  if (payload.action !== "RECEIVE" && payload.action !== "INSPECT" && payload.action !== "PUTAWAY" && payload.action !== "RETURN_REJECTED") throw new WmsError("非收货动作。", 400);
  const balances = payload.lines.map(item => {
    const line = receipt.lines.find(row => row.id === item.lineId)!;
    return { locationId: receipt.receivingLocationId, warehouseId: receipt.warehouseId, lotId: line.lotId };
  });
  if (payload.action === "PUTAWAY") for (const item of payload.lines) {
    balances.push({ locationId: item.locationId, warehouseId: receipt.warehouseId, lotId: receipt.lines.find(row => row.id === item.lineId)!.lotId });
  }
  await ensureBalances(tx, scope, balances);
  for (const raw of payload.lines) {
    const line = receipt.lines.find(row => row.id === raw.lineId)!;
    const balance = await tx.wmsStockBalance.findFirstOrThrow({ where: { ...scoped(scope), id: balanceId(scope, receipt.receivingLocationId, line.lotId) } });
    const source = { action: payload.action, sourceType: "RECEIPT", sourceId: receipt.id, sourceLineId: line.id };
    if (payload.action === "RECEIVE") {
      const item = payload.lines.find(row => row.lineId === line.id)!;
      movementIds.push((await move(tx, scope, commandId, movementIds.length, balance, { onHand: item.quantity, pendingQc: item.quantity }, source)).id);
      await tx.wmsReceiptLine.update({ where: { id: line.id }, data: { receivedQty: item.quantity, revision: { increment: 1 } } });
    } else if (payload.action === "INSPECT") {
      const item = payload.lines.find(row => row.lineId === line.id)!;
      const total = item.acceptedQty + item.rejectedQty;
      movementIds.push((await move(tx, scope, commandId, movementIds.length, balance, { pendingQc: -total, pendingPutaway: item.acceptedQty, rejected: item.rejectedQty }, source)).id);
      await tx.wmsReceiptLine.update({ where: { id: line.id }, data: { acceptedQty: { increment: item.acceptedQty }, rejectedQty: { increment: item.rejectedQty }, revision: { increment: 1 } } });
    } else if (payload.action === "PUTAWAY") {
      const item = payload.lines.find(row => row.lineId === line.id)!;
      const target = await tx.wmsStockBalance.findFirstOrThrow({ where: { ...scoped(scope), id: balanceId(scope, item.locationId, line.lotId) } });
      movementIds.push((await move(tx, scope, commandId, movementIds.length, balance, { onHand: -item.quantity, pendingPutaway: -item.quantity }, source)).id);
      movementIds.push((await move(tx, scope, commandId, movementIds.length, target, { onHand: item.quantity }, source)).id);
      await tx.wmsReceiptLine.update({ where: { id: line.id }, data: { putawayQty: { increment: item.quantity }, revision: { increment: 1 } } });
    } else {
      const item = payload.lines.find(row => row.lineId === line.id)!;
      movementIds.push((await move(tx, scope, commandId, movementIds.length, balance, { onHand: -item.quantity, rejected: -item.quantity }, source)).id);
      await tx.wmsReceiptLine.update({ where: { id: line.id }, data: { returnedQty: { increment: item.quantity }, revision: { increment: 1 } } });
    }
  }
  const lines = await tx.wmsReceiptLine.findMany({ where: { ...scoped(scope), receiptId: receipt.id } });
  const inspected = lines.every(line => line.receivedQty === line.acceptedQty + line.rejectedQty);
  const putaway = inspected && lines.every(line => line.putawayQty === line.acceptedQty);
  await tx.wmsReceipt.update({ where: { id: receipt.id }, data: { status: putaway ? "PUTAWAY" : inspected ? "INSPECTED" : "RECEIVED", revision: { increment: 1 } } });
  return { revision: receipt.revision + 1, movementIds };
}
