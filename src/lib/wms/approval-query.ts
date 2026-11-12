import type { Tx } from "./repository";
import type { WmsScope } from "./contracts";
import { scoped } from "./access";
import { parseWmsCommand } from "./rules";
import { queryStockContexts } from "./stock-context-query";
import { reservationProgress, type ApprovalReservationContext, type WmsLocationContext } from "./reservation-view";
import type { ApprovalReceiptContext } from "./approval-receipt-view";
import type { Prisma } from "@prisma/client";

export const approvalWorkFilters = ["TO_REVIEW", "TO_EXECUTE", "MY_REQUESTS", "EXPIRED"] as const;
export type ApprovalWorkFilter = typeof approvalWorkFilters[number];
export type ApprovalReadAccess = { canApprove: boolean; canEdit: boolean; now: Date };

export function approvalActionFlags(scope: WmsScope, item: Record<string, unknown>, access: ApprovalReadAccess) {
  const expiresAt = item.expiresAt instanceof Date ? item.expiresAt.getTime() : Date.parse(String(item.expiresAt));
  const live = expiresAt > access.now.getTime();
  return {
    canDecide: live && access.canApprove && item.status === "PENDING" && item.requestedBy !== scope.actorUserId,
    canExecute: live && access.canEdit && item.status === "APPROVED" && item.requestedBy === scope.actorUserId && typeof item.approvedBy === "string" && item.approvedBy !== scope.actorUserId,
  };
}

/** Candidate work queues only; decisions/execution still revalidate the target
 * and both members in their own write transaction. Apply before pagination. */
export function approvalWorkWhere(scope: WmsScope, filter: ApprovalWorkFilter, access: ApprovalReadAccess): Prisma.WmsApprovalWhereInput {
  if (filter === "MY_REQUESTS") return { requestedBy: scope.actorUserId };
  if (filter === "EXPIRED") return { status: { in: ["PENDING", "APPROVED"] }, expiresAt: { lte: access.now } };
  if (filter === "TO_REVIEW") return access.canApprove
    ? { status: "PENDING", requestedBy: { not: scope.actorUserId }, expiresAt: { gt: access.now } }
    : { id: { in: [] } };
  return access.canEdit
    ? { status: "APPROVED", requestedBy: scope.actorUserId, approvedBy: { not: null }, NOT: { approvedBy: scope.actorUserId }, expiresAt: { gt: access.now } }
    : { id: { in: [] } };
}

export async function presentApprovals(tx: Tx, scope: WmsScope, items: readonly Record<string, unknown>[], access: ApprovalReadAccess) {
  const rows = items.map(item => {
    const { request, ...fields } = item;
    return { ...fields, ...approvalActionFlags(scope, item, access), command: parseWmsCommand(request) };
  });
  const reservationIds = rows.filter(row => ["RELEASE", "DISPATCH"].includes(row.command.payload.action)).map(row => row.command.aggregateId);
  const reservations = reservationIds.length ? await tx.wmsReservation.findMany({
    where: { ...scoped(scope), id: { in: reservationIds } },
    select: { id: true, balanceId: true, number: true, revision: true, requestedQty: true, releasedQty: true, dispatchedQty: true, pickedQty: true },
  }) : [];
  const balanceByReservation = new Map(reservations.map(row => [row.id, row.balanceId]));
  const reservationById = new Map<string, ApprovalReservationContext>(reservations.map(reservation => [reservation.id, { number: reservation.number, revision: reservation.revision, requestedQty: reservation.requestedQty, releasedQty: reservation.releasedQty, dispatchedQty: reservation.dispatchedQty, pickedQty: reservation.pickedQty, ...reservationProgress(reservation) }]));
  const reversalIds=rows.filter(row=>row.command.payload.action==='SKU_CONVERSION_REVERSE').map(row=>row.command.aggregateId);
  const originals=reversalIds.length?await tx.wmsCommand.findMany({where:{...scoped(scope),id:{in:reversalIds},action:'SKU_CONVERT'}}):[];
  const originalsById=new Map(originals.map(original=>[original.id,{original,result:original.result as {targetBalanceId:string;conversion:{quantity:number}}}]));
  const sourceId = (command: typeof rows[number]["command"]) => command.payload.action === "SKU_CONVERSION_REVERSE" ? originalsById.get(command.aggregateId)?.result.targetBalanceId : command.payload.action === "CONSUMABLE_ISSUE" ? command.payload.sourceBalanceId : ["SKU_CONVERT", "RESERVE", "TRANSFER"].includes(command.payload.action) ? command.aggregateId : ["RELEASE", "DISPATCH"].includes(command.payload.action) ? balanceByReservation.get(command.aggregateId) : undefined;
  const stocks = await queryStockContexts(tx, scope, [...originals.map(row=>row.aggregateId), ...rows.flatMap(row => { const id = sourceId(row.command); return id ? [id] : []; })]);
  const receiptCommands = rows.map(row => row.command).filter(command => command.payload.action === "RECEIVE" || command.payload.action === "INSPECT" || command.payload.action === "PUTAWAY" || command.payload.action === "RETURN_REJECTED" || command.payload.action === "CANCEL");
  const receipts = receiptCommands.length ? await tx.wmsReceipt.findMany({
    where: { ...scoped(scope), id: { in: receiptCommands.map(command => command.aggregateId) } },
    select: { id: true, number: true, sourceReference: true, receivingLocationId: true },
  }) : [];
  const receiptLines = receiptCommands.length ? await tx.wmsReceiptLine.findMany({
    where: { ...scoped(scope), OR: receiptCommands.flatMap(command => "lines" in command.payload ? [{ receiptId: command.aggregateId, id: { in: command.payload.lines.flatMap(line => "lineId" in line ? [line.lineId] : []) } }] : []) },
    select: { id: true, receiptId: true, lotId: true, lot: { select: { lotCode: true, barcode: true } } },
  }) : [];
  const receiptById = new Map(receipts.map(receipt => [receipt.id, receipt]));
  const lineById = new Map(receiptLines.map(line => [line.id, line]));
  const targetIds = [...receipts.map(receipt => receipt.receivingLocationId), ...rows.flatMap(({ command }) => ["LOCATION_FREEZE", "LOCATION_UNFREEZE"].includes(command.payload.action) ? [command.aggregateId] : command.payload.action === "TRANSFER" ? [command.payload.targetLocationId] : command.payload.action === "PUTAWAY" ? command.payload.lines.map(line => line.locationId) : [])];
  const locations = targetIds.length ? await tx.wmsLocation.findMany({
    where: { ...scoped(scope), id: { in: targetIds } },
    select: { id: true, code: true, warehouseId: true, area: { select: { warehouse: { select: { code: true, name: true } } } } },
  }) : [];
  const targets = new Map<string, WmsLocationContext>(locations.map(row => [row.id, {
    warehouseId: row.warehouseId, warehouseCode: row.area.warehouse.code, warehouseName: row.area.warehouse.name,
    locationId: row.id, locationCode: row.code,
  }]));
  const stocktakeIds = rows.filter(row => row.command.payload.action === "STOCKTAKE_POST").map(row => row.command.aggregateId);
  const stocktakes = stocktakeIds.length ? await tx.wmsStocktake.findMany({
    where: { ...scoped(scope), id: { in: stocktakeIds } },
    select: { id: true, number: true, status: true, revision: true, locations: {
      select: { location: { select: { code: true } }, lines: { select: {
        id: true, baselineOnHand: true, countedQty: true, lot: { select: { lotCode: true } },
      } } },
    } },
  }) : [];
  const stocktakeById = new Map(stocktakes.map(row => [row.id, {
    number: row.number, status: row.status, revision: row.revision,
    lines: row.locations.flatMap(location => location.lines.map(line => ({
      id: line.id, locationCode: location.location.code, lotCode: line.lot.lotCode,
      baselineOnHand: line.baselineOnHand, countedQty: line.countedQty,
    }))),
  }]));
  const consumableIds=rows.filter(row=>row.command.payload.action==='CONSUMABLE_ISSUE').map(row=>row.command.aggregateId);
  const consumables=consumableIds.length?await tx.wmsOutboundConsumable.findMany({where:{...scoped(scope),id:{in:consumableIds}},include:{product:{select:{sku:true}},line:{include:{product:{select:{sku:true}},outbound:{select:{number:true}},reservations:{select:{dispatchedQty:true}}}}}}):[];
  const consumableById=new Map(consumables.map(rule=>[rule.id,{number:rule.line.outbound.number,mainSku:rule.line.product.sku,consumableSku:rule.product.sku,units:rule.units.toFixed(),accountedMainQty:rule.accountedMainQty,issuedQty:rule.issuedQty,dispatchedMainQty:rule.line.reservations.reduce((sum,row)=>sum+row.dispatchedQty,0)}]));
  const conversionLotIds = rows.flatMap(row => row.command.payload.action === 'SKU_CONVERT' ? [row.command.payload.targetLotId] : []);
  const conversionLots = conversionLotIds.length ? await tx.wmsLot.findMany({where:{...scoped(scope),id:{in:conversionLotIds}},select:{id:true,lotCode:true,productRecordId:true,product:{select:{sku:true}}}}) : [];
  const conversionByLot = new Map(conversionLots.map(lot => [lot.id,{lotCode:lot.lotCode,productRecordId:lot.productRecordId,sku:lot.product.sku}]));
  const transferIds=rows.filter(row=>row.command.payload.action==='TRANSFER_ORDER_SHIP'||row.command.payload.action==='TRANSFER_ORDER_RECEIVE').map(row=>row.command.aggregateId);
  const transferOrders=transferIds.length?await tx.wmsTransferOrder.findMany({where:{...scoped(scope),id:{in:transferIds}},include:{lines:{include:{source:{include:{lot:{select:{lotCode:true}},location:{select:{code:true}}}},target:{select:{code:true}}}}}}):[];
  const transferById=new Map(transferOrders.map(order=>[order.id,{number:order.number,status:order.status,revision:order.revision,lines:order.lines.map(line=>({lineId:line.id,sourceLocation:line.source.location.code,lotCode:line.source.lot.lotCode,targetLocation:line.target.code,quantity:line.quantity,shippedQty:line.shippedQty,receivedQty:line.receivedQty}))}]));
  const valuationRuleIds=rows.flatMap(row=>row.command.payload.action==='ACTIVATE_COST_RULE'?[row.command.aggregateId]:row.command.payload.action==='VALUE_COMMAND'?row.command.payload.rules.map(rule=>rule.ruleId):[]);
  const valuationRules=valuationRuleIds.length?await tx.wmsCostRule.findMany({where:{...scoped(scope),id:{in:valuationRuleIds}},include:{lot:{select:{lotCode:true}}}}):[];
  const financeIds=rows.filter(row=>row.command.payload.action==='VALUE_COMMAND').map(row=>row.command.aggregateId);
  const financeDrafts=financeIds.length?await tx.wmsFinanceDraft.findMany({where:{...scoped(scope),id:{in:financeIds}},include:{command:{include:{movements:{select:{id:true,deltaOnHand:true,balance:{select:{lotId:true}}}}}}}}):[];
  return rows.map(row => {
    const receipt = receiptById.get(row.command.aggregateId);
    const receivingLocation = receipt ? targets.get(receipt.receivingLocationId) : undefined;
    const receiptContext: ApprovalReceiptContext | null = receipt && receivingLocation ? {
      number: receipt.number, sourceReference: receipt.sourceReference, receivingLocation,
      lines: "lines" in row.command.payload ? row.command.payload.lines.flatMap(requestedLine => {
        if (!("lineId" in requestedLine)) return [];
        const line = lineById.get(requestedLine.lineId);
        if (!line || line.receiptId !== receipt.id) return [];
        return [{ lineId: line.id, lotId: line.lotId, lotCode: line.lot.lotCode, barcode: line.lot.barcode,
          targetLocation: "locationId" in requestedLine ? targets.get(requestedLine.locationId) ?? null : null }];
      }) : [],
    } : null;
    return { ...row, valuation:row.command.payload.action==='ACTIVATE_COST_RULE'?{rules:valuationRules.filter(rule=>rule.id===row.command.aggregateId)}:row.command.payload.action==='VALUE_COMMAND'?{rules:valuationRules.filter(rule=>row.command.payload.action==='VALUE_COMMAND'&&row.command.payload.rules.some(selected=>selected.ruleId===rule.id)),draft:financeDrafts.find(draft=>draft.id===row.command.aggregateId)??null}:null, conversionReversal: row.command.payload.action === "SKU_CONVERSION_REVERSE" && originalsById.has(row.command.aggregateId) ? {originalCommandId:row.command.aggregateId,quantity:originalsById.get(row.command.aggregateId)!.result.conversion.quantity,originalSource:stocks.get(originalsById.get(row.command.aggregateId)!.original.aggregateId)??null} : null, consumable: row.command.payload.action === "CONSUMABLE_ISSUE" ? consumableById.get(row.command.aggregateId) ?? null : null, conversionTarget: row.command.payload.action === 'SKU_CONVERT' ? conversionByLot.get(row.command.payload.targetLotId) ?? null : null, transferOrder:transferById.get(row.command.aggregateId)??null, stocktake: row.command.payload.action === "STOCKTAKE_POST" ? stocktakeById.get(row.command.aggregateId) ?? null : null, receipt: receiptContext, reservation: ["RELEASE", "DISPATCH"].includes(row.command.payload.action) ? reservationById.get(row.command.aggregateId) ?? null : null, stock: stocks.get(sourceId(row.command) ?? "") ?? null,
    targetLocation: ["LOCATION_FREEZE", "LOCATION_UNFREEZE"].includes(row.command.payload.action) ? targets.get(row.command.aggregateId) ?? null : row.command.payload.action === "TRANSFER" ? targets.get(row.command.payload.targetLocationId) ?? null : null };
  });
}
