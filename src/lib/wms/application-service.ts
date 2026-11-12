import {executeValuationAction} from './valuation-service';
import {executeConsumableIssue} from './consumable-service';
import {executeSkuConversion,executeConversionReversal} from './sku-conversion-service';
import {executeTransferOrder} from './transfer-order-service';
import { reservationProgress } from "./reservation-view";
import { executeLocationFreeze } from "./location-freeze-service";
import { prisma } from "@/lib/db/prisma";
import { authorizeWms, auditWms, scoped, json } from "./access";
import { WmsError, type WmsScope, type WmsCommandInput } from "./contracts";
import { requestHash, verifyApproval } from "./approvals";
import { lockKey, move, type Tx } from "./repository";
import { parseWmsCommand } from "./rules";
import { prepareTransferBalances, validateReserve, validateReservationAction } from "./stock-service";
import { executeStocktake } from "./stocktake-service";
import { executeReceipt } from "./receipt-service";
import { appendWmsCommandEvent } from "./domain-events";

export async function executeWmsCommand(scope: WmsScope, input: WmsCommandInput, approvalId?: string) {
  input = parseWmsCommand(input);
  if (input.idempotencyKey.startsWith("fba-reserve:") || (input.payload.action === "RESERVE" && input.payload.number.startsWith("FBA-LOCAL:"))) throw new WmsError("FBA 预占必须经本地计划入口执行。", 409);
  return prisma.$transaction(tx => executeWmsCommandInTransaction(tx, scope, input, approvalId));
}

/** Caller must commit related business changes in this same transaction. */
export async function executeWmsCommandInTransaction(tx: Tx, scope: WmsScope, input: WmsCommandInput, approvalId?: string) {
  input = parseWmsCommand(input);
  if (input.workspaceId !== scope.workspaceId) throw new WmsError("工作区不一致。", 403);
    const approval = await verifyApproval(tx, scope, input, approvalId);
    if (!approval) await authorizeWms(tx, scope, "edit");
    await lockKey(tx, JSON.stringify([scope.organizationId, scope.workspaceId, input.idempotencyKey]));
    const hash = requestHash(input);
    const prior = await tx.wmsCommand.findFirst({ where: { ...scoped(scope), idempotencyKey: input.idempotencyKey } });
    if (prior) {
      if (prior.requestHash !== hash || prior.actorUserId !== scope.actorUserId) throw new WmsError("幂等键已用于其他命令。");
      return prior.result;
    }
    if (approval && (approval.status !== "APPROVED" || approval.expiresAt.getTime() <= Date.now())) throw new WmsError("审批已失效或已消费。", 403);
    const payload = input.payload;
    const commandId = crypto.randomUUID();
    await tx.wmsCommand.create({ data: { ...scoped(scope), id: commandId, idempotencyKey: input.idempotencyKey, action: payload.action, requestHash: hash, aggregateId: input.aggregateId, expectedRevision: input.expectedRevision, actorUserId: scope.actorUserId, result: {} } });
    let revision: number;
    let aggregateId = input.aggregateId;
    let targetBalanceId: string | undefined;
    let transferChange: unknown;
    let valuation: unknown;
    let conversion: unknown;
    let reversesCommandId: string|undefined;
    let consumableChange: unknown;
    const movementIds: string[] = [];
    let reservationChange: { quantity: number; before: Record<string, number | string>; after: Record<string, number | string> } | undefined;
    const reservationState = (row: { id: string; balanceId: string; requestedQty: number; pickedQty: number; releasedQty: number; dispatchedQty: number; revision: number }) => ({
      id: row.id, balanceId: row.balanceId, requestedQty: row.requestedQty, pickedQty: row.pickedQty,
      releasedQty: row.releasedQty, dispatchedQty: row.dispatchedQty, revision: row.revision, ...reservationProgress(row),
    });
    if(payload.action==="ACTIVATE_COST_RULE"||payload.action==="VALUE_COMMAND"){const result=await executeValuationAction(tx,scope,input);revision=result.revision;valuation=result.valuation;
    }else if(payload.action==="TRANSFER_ORDER_SHIP"||payload.action==="TRANSFER_ORDER_RECEIVE"||payload.action==="TRANSFER_ORDER_CANCEL"){
      const result=await executeTransferOrder(tx,scope,input,commandId);revision=result.revision;movementIds.push(...result.movementIds);transferChange=result.transferChange;
    } else if (payload.action === "LOCATION_FREEZE" || payload.action === "LOCATION_UNFREEZE") {
      revision = await executeLocationFreeze(tx, scope, input);
    } else if (payload.action === "STOCKTAKE_START" || payload.action === "STOCKTAKE_COUNT" || payload.action === "STOCKTAKE_REVIEW" || payload.action === "STOCKTAKE_CANCEL" || payload.action === "STOCKTAKE_POST") {
      const result = await executeStocktake(tx, scope, input, commandId);
      revision = result.revision;
      movementIds.push(...result.movementIds);
    } else if (payload.action === "RECEIVE" || payload.action === "INSPECT" || payload.action === "PUTAWAY" || payload.action === "RETURN_REJECTED" || payload.action === "CANCEL") {
      const result = await executeReceipt(tx, scope, input, commandId);
      revision = result.revision;
      movementIds.push(...result.movementIds);
    } else if (payload.action === "RESERVE") {
      const { balance, outboundLine } = await validateReserve(tx, scope, input);
      const reservation = await tx.wmsReservation.create({ data: { ...scoped(scope), id: crypto.randomUUID(), number: payload.number, balanceId: balance.id, ...(outboundLine ? { outboundWarehouseId: outboundLine.warehouseId, outboundLineId: outboundLine.id } : {}), createdBy: scope.actorUserId, requestedQty: payload.quantity } });
      if (outboundLine) await tx.wmsOutbound.update({ where: { id: outboundLine.outboundId }, data: { status: "RELEASED", revision: { increment: 1 } } });
      aggregateId = reservation.id;
      revision = reservation.revision;
      movementIds.push((await move(tx, scope, commandId, 0, balance, { reserved: payload.quantity }, { action: payload.action, sourceType: "RESERVATION", sourceId: reservation.id })).id);
    } else if (payload.action === "CONSUMABLE_ISSUE") {
      const result=await executeConsumableIssue(tx,scope,input,commandId);revision=result.revision;movementIds.push(...result.movementIds);consumableChange=result.consumableChange;
    } else if (payload.action === "SKU_CONVERSION_REVERSE") {
      const result=await executeConversionReversal(tx,scope,input,commandId);revision=result.revision;movementIds.push(...result.movementIds);reversesCommandId=result.reversesCommandId;
    } else if (payload.action === "SKU_CONVERT") {
      const result = await executeSkuConversion(tx, scope, input, commandId);
      revision = result.revision; targetBalanceId = result.targetBalanceId; conversion = result.conversion; movementIds.push(...result.movementIds);
    } else if (payload.action === "TRANSFER") {
      const { source, target } = await prepareTransferBalances(tx, scope, input);
      targetBalanceId = target.id;
      movementIds.push((await move(tx, scope, commandId, 0, source, { onHand: -payload.quantity }, { action: payload.action, sourceType: "TRANSFER", sourceId: commandId })).id);
      movementIds.push((await move(tx, scope, commandId, 1, target, { onHand: payload.quantity }, { action: payload.action, sourceType: "TRANSFER", sourceId: commandId })).id);
      revision = source.revision + 1;
    } else if (payload.action === "RELEASE" || payload.action === "PICK" || payload.action === "UNPICK" || payload.action === "DISPATCH") {
      const { reservation, balance, data, outboundLine } = await validateReservationAction(tx, scope, input);
      const qty = payload.quantity;
      if (payload.action === "RELEASE" || payload.action === "DISPATCH") movementIds.push((await move(tx, scope, commandId, 0, balance, { reserved: -qty, ...(payload.action === "DISPATCH" ? { onHand: -qty } : {}) }, { action: payload.action, sourceType: "RESERVATION", sourceId: reservation.id })).id);
      await tx.wmsReservation.update({ where: { id: reservation.id }, data });
      if (payload.action === "DISPATCH" && outboundLine) {
        const outbound = await tx.wmsOutbound.findUniqueOrThrow({ where: { id: outboundLine.outboundId }, include: { lines: { include: { reservations: { select: { dispatchedQty: true } } } } } });
        const complete = outbound.lines.every(line => line.reservations.reduce((sum, linked) => sum + linked.dispatchedQty, 0) >= line.requestedQty);
        await tx.wmsOutbound.update({ where: { id: outbound.id }, data: { status: complete ? "COMPLETED" : "RELEASED", revision: { increment: 1 } } });
      }
      revision = data.revision;
      reservationChange = { quantity: qty, before: reservationState(reservation), after: reservationState({ ...reservation, ...data }) };
    } else {
      throw new WmsError("不支持的库存动作。", 400);
    }
    const result = { commandId, aggregateId, revision, movementIds, ...(consumableChange?{consumableChange}:{}), ...(reversesCommandId?{reversesCommandId}:{}), ...(conversion?{conversion}:{}), ...(valuation?{valuation}:{}),...(transferChange?{transferChange}:{}), ...(reservationChange ? { reservationChange } : {}), ...(targetBalanceId ? { targetBalanceId } : {}), ...((payload.action === "LOCATION_FREEZE" || payload.action === "LOCATION_UNFREEZE") ? { frozen: payload.action === "LOCATION_FREEZE", reason: payload.reason } : {}) };
    const completed = await tx.wmsCommand.update({ where: { id: commandId }, data: { result: json(result) } });
    await appendWmsCommandEvent(tx, completed);
    if (approval) await tx.wmsApproval.update({ where: { id: approval.id }, data: { status: "CONSUMED", consumedCommandId: commandId, revision: { increment: 1 } } });
    await auditWms(tx, scope, payload.action, aggregateId, json({ commandId, movementIds }));
    return json(result);
}
