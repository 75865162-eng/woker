import {stocktakeSummary} from './stocktake-summary';
import {inventoryPeriodBoundaries,appendInventoryPeriods,type InventoryGranularity} from './inventory-period-summary';
import {presentInventoryValuation} from './inventory-valuation-query';
import {queryStockAging} from './stock-aging-query';
import {presentConversions} from './conversion-query';
import {inventoryHistoryRange,presentInventoryHistory} from './inventory-history-query';
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertWmsAccess, scoped } from "./access";
import { requireText } from "./rules";
import { WmsError, type WmsScope } from "./contracts";
import { presentReservations, queryReservations, reservationStatusFilters, type ReservationStatusFilter } from "./reservation-query";
import { presentApprovals, approvalWorkFilters, approvalWorkWhere, type ApprovalWorkFilter } from "./approval-query";
import { reconcileBalances } from "./reconciliation";
import { presentBalances, presentMovements } from "./stock-context-query";
import { presentReceipts } from "./receipt-context-query";
import { queryReceiptWork, receiptWorkFilters, type ReceiptWorkFilter } from "./receipt-query";
export const queryKinds = ["inventory-valuation","overseas-transfers","cost-rules","finance-drafts","cost-entries","stock-aging","conversions","inventory-history","consumables","warehouse-types", "warehouse-addresses", "transfer-orders", "warehouses", "areas", "locations", "lots", "receipts", "outbounds", "reservations", "balances", "movements", "transfers", "approvals", "reconciliation", "stocktakes"] as const;
export type QueryKind = typeof queryKinds[number];
export async function queryWms(scope: WmsScope, kind: QueryKind, params: URLSearchParams) {
  const limit = Number(params.get("limit") ?? 30);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new WmsError("分页大小须为 1-100。", 400);
  const filters: Record<string, string> = {};
  const allowed: Partial<Record<QueryKind, string[]>> = { "inventory-valuation":["warehouseId","locationId","lotId","barcode","lotCode"],"overseas-transfers":["id","orderId"],"cost-rules":["id","lotId","status"],"finance-drafts":["id","commandId","status"],"cost-entries":["draftId","movementId"], "stock-aging":["warehouseId","productRecordId"], "inventory-history":["from","to","granularity","warehouseId","locationId","lotId"], consumables:["outboundLineId","warehouseId"], "warehouse-addresses":["warehouseId"], "transfer-orders":["id","number","status"], stocktakes: ["id", "number", "warehouseId", "status"], outbounds: ["id", "number", "warehouseId", "status", "productRecordId"], areas: ["warehouseId"], locations: ["warehouseId", "areaId"], lots: ["productRecordId", "barcode", "lotCode"], receipts: ["warehouseId", "id", "number", "sourceReference", "status", "workflowStatus", "barcode", "lotCode"], balances: ["warehouseId", "locationId", "lotId", "barcode", "lotCode"], reconciliation: ["warehouseId", "locationId", "lotId", "barcode", "lotCode"], movements: ["balanceId", "sourceId", "warehouseId", "locationId", "lotId", "barcode", "lotCode"], transfers: ["sourceId", "warehouseId", "locationId", "lotId", "barcode", "lotCode"], reservations: ["balanceId", "number", "workflowStatus", "warehouseId", "locationId", "lotId", "barcode", "lotCode"], approvals: ["status", "workflowStatus", "aggregateId"] };
  for (const key of allowed[kind] ?? []) if (params.get(key)) filters[key] = params.get(key)!;
  if (kind === "transfer-orders") {
    for (const field of ["id", "number"]) if (filters[field]) filters[field] = requireText(filters[field], field);
    if (filters.status && !["DRAFT", "PARTIALLY_SHIPPED", "IN_TRANSIT", "PARTIALLY_RECEIVED", "COMPLETED", "CANCELLED"].includes(filters.status)) throw new WmsError("调拨状态无效。", 400);
  }
  if (kind === "stocktakes") {
    for (const field of ["id", "number", "warehouseId"]) if (filters[field]) filters[field] = requireText(filters[field], field);
    if (filters.status && !["DRAFT", "COUNTING", "REVIEW", "POSTED", "CANCELLED"].includes(filters.status)) throw new WmsError("盘点状态无效。", 400);
  }
  if (kind === "outbounds") {
    for (const field of ["id", "number", "warehouseId"]) if (filters[field]) filters[field] = requireText(filters[field], field);
    if (filters.productRecordId) filters.productRecordId = requireText(filters.productRecordId, "商品 ID");
    if (filters.status && !["DRAFT", "RELEASED", "COMPLETED", "CANCELLED"].includes(filters.status)) throw new WmsError("出库单状态无效。", 400);
  }
  if (kind === "approvals" && filters.aggregateId) filters.aggregateId = requireText(filters.aggregateId, "业务单据 ID");
  if (kind === "receipts" && filters.id) filters.id = requireText(filters.id, "收货单 ID");
  if (["lots", "balances", "reconciliation", "movements", "transfers", "reservations", "receipts"].includes(kind)) for (const key of ["barcode", "lotCode"]) if (filters[key]) filters[key] = requireText(filters[key], key === "barcode" ? "条码" : "批次编码");
  if (kind === "receipts" || kind === "reservations") for (const key of ["number", "sourceReference"]) if (filters[key]) filters[key] = requireText(filters[key], key === "number" ? "单号" : "来源单号");
  if (kind === "receipts" && filters.status && !["DRAFT", "RECEIVED", "INSPECTED", "PUTAWAY", "CANCELLED"].includes(filters.status)) throw new WmsError("收货状态无效。", 400);
  if (kind === "receipts" && filters.workflowStatus && !receiptWorkFilters.includes(filters.workflowStatus as ReceiptWorkFilter)) throw new WmsError("收货作业筛选无效。", 400);
  if (kind === "reservations" && filters.workflowStatus && !reservationStatusFilters.includes(filters.workflowStatus as ReservationStatusFilter)) throw new WmsError("预占作业状态无效。", 400);
  if (kind === "approvals" && filters.workflowStatus && !approvalWorkFilters.includes(filters.workflowStatus as ApprovalWorkFilter)) throw new WmsError("审批作业筛选无效。", 400);
  if (kind === "approvals" && filters.status && !["PENDING", "APPROVED", "REJECTED", "CONSUMED"].includes(filters.status)) throw new WmsError("审批状态无效。", 400);
  const historyRange=kind === "inventory-history" ? inventoryHistoryRange(filters.from,filters.to) : null;
  const historyGranularity=kind==='inventory-history'&&filters.granularity?inventoryPeriodBoundaries(historyRange!.from,historyRange!.to,filters.granularity).granularity:null;
  const fingerprint = createHash("sha256").update(JSON.stringify([scoped(scope), kind, filters, ...(kind === "approvals" ? [scope.actorUserId] : [])])).digest("hex");
  let after: { id: string; time: string } | undefined;
  if (params.get("cursor")) {
    try {
      const cursor = JSON.parse(Buffer.from(params.get("cursor")!, "base64url").toString()) as { fingerprint: string; id: string; time: string };
      if (cursor.fingerprint !== fingerprint || !cursor.id || !Number.isFinite(Date.parse(cursor.time))) throw new Error();
      after = cursor;
    } catch { throw new WmsError("游标与查询范围不一致。", 400); }
  }
  return prisma.$transaction(async tx => {
    const access = await assertWmsAccess(tx, { ...scope, userId: scope.actorUserId, action: "view" });
    if(kind === "stock-aging")return queryStockAging(tx,scope,filters,limit,fingerprint,after?.id);
    const approvalAccess = { canApprove: access.permissions.wms?.includes("approve") ?? false, canEdit: access.permissions.wms?.includes("edit") ?? false, now: new Date() };
    const timeKey = kind === "movements" || kind === "transfers" ? "occurredAt" : "createdAt";
    // Barcode and lot code belong to the WMS lot. Movement locations belong to
    // their balance; apply relations before pagination, never filter a fetched page.
    let modelFilters: Record<string, unknown> = filters;
    if (kind === "receipts") {
      const { barcode, lotCode, ...directFilters } = filters;
      delete directFilters.workflowStatus;
      modelFilters = { ...directFilters, ...(barcode || lotCode ? { lines: { some: { ...scoped(scope), lot: { is: { ...scoped(scope), ...(barcode ? { barcode } : {}), ...(lotCode ? { lotCode } : {}) } } } } } : {}) };
    }
    if (kind === "outbounds" && filters.productRecordId) {
      const { productRecordId, ...directFilters } = filters;
      modelFilters = { ...directFilters, lines: { some: { ...scoped(scope), productRecordId } } };
    }
    if (kind === "approvals") {
      const { workflowStatus, ...directFilters } = filters;
      modelFilters = { ...directFilters, ...(workflowStatus ? { AND: [approvalWorkWhere(scope, workflowStatus as ApprovalWorkFilter, approvalAccess)] } : {}) };
    }
    if (kind === "inventory-history") {const {from:_from,to:_to,granularity:_granularity,...direct}=filters;void _from;void _to;void _granularity;modelFilters={...direct,createdAt:{lt:historyRange!.to}};}
    if (kind === "inventory-valuation" || kind === "balances" || kind === "reconciliation" || kind === "movements" || kind === "transfers" || kind === "reservations") {
      const { barcode, lotCode, warehouseId, locationId, lotId, ...directFilters } = filters;
      const balanceFilters = { ...(warehouseId ? { warehouseId } : {}), ...(locationId ? { locationId } : {}), ...(lotId ? { lotId } : {}),
        ...(barcode || lotCode ? { lot: { is: { ...scoped(scope), ...(barcode ? { barcode } : {}), ...(lotCode ? { lotCode } : {}) } } } : {}) };
      modelFilters = kind === "movements" || kind === "transfers" || kind === "reservations" ? { ...directFilters, ...(kind === "transfers" ? { action: "TRANSFER" } : {}), ...(Object.keys(balanceFilters).length ? { balance: { is: { ...scoped(scope), ...balanceFilters } } } : {}) } : { ...directFilters, ...balanceFilters };
    }
    const where = { ...scoped(scope), ...modelFilters, ...(after ? { OR: [{ [timeKey]: { gt: new Date(after.time) } }, { [timeKey]: new Date(after.time), id: { gt: after.id } }] } : {}) };
    const args = { where, take: limit + 1, orderBy: [{ [timeKey]: "asc" }, { id: "asc" }] };
    // Closed dispatch preserves each Prisma model's typed query boundary.
    let rows;
    switch (kind) {
      case "overseas-transfers": rows=await tx.wmsOverseasManifest.findMany({...args,include:{order:{select:{number:true,status:true,revision:true}},lines:true,boxes:{include:{items:true}},transport:true}} as Prisma.WmsOverseasManifestFindManyArgs);break;
      case "cost-rules": rows=await tx.wmsCostRule.findMany({...args,include:{lot:{select:{lotCode:true,product:{select:{sku:true}}}}}} as Prisma.WmsCostRuleFindManyArgs);break;
      case "finance-drafts": rows=await tx.wmsFinanceDraft.findMany({...args,include:{entries:true,command:{select:{action:true,aggregateId:true}}}} as Prisma.WmsFinanceDraftFindManyArgs);break;
      case "cost-entries": rows=await tx.wmsCostEntry.findMany(args as Prisma.WmsCostEntryFindManyArgs);break;
      case "conversions": rows=await tx.wmsCommand.findMany({...args,where:{...where,action:"SKU_CONVERT"}} as Prisma.WmsCommandFindManyArgs);break;
      case "consumables": rows=await tx.wmsOutboundConsumable.findMany({...args,include:{product:{select:{sku:true}},line:{include:{outbound:{select:{number:true,status:true}},product:{select:{sku:true}},reservations:{select:{dispatchedQty:true}}}}}} as Prisma.WmsOutboundConsumableFindManyArgs);break;
      case "warehouse-types": rows=await tx.wmsWarehouseType.findMany(args as Prisma.WmsWarehouseTypeFindManyArgs);break;
      case "warehouse-addresses": rows=await tx.wmsWarehouseAddress.findMany(args as Prisma.WmsWarehouseAddressFindManyArgs);break;
      case "transfer-orders": rows=await tx.wmsTransferOrder.findMany({...args,include:{lines:{orderBy:{id:"asc"},include:{source:{include:{lot:{select:{lotCode:true,productRecordId:true}},location:{select:{code:true}}}},target:{select:{code:true,warehouseId:true}}}}}} as Prisma.WmsTransferOrderFindManyArgs);break;
      case "stocktakes": rows = await tx.wmsStocktake.findMany({ ...args,
        ...(filters.id ? { include: { locations: { orderBy: { locationId: "asc" }, include: { location: { select: { code: true } }, lines: { orderBy: { id: "asc" }, include: { lot: { select: { lotCode: true, barcode: true } } } } } } } } : {}),
      } as Prisma.WmsStocktakeFindManyArgs); break;
      case "outbounds": rows = await tx.wmsOutbound.findMany({ ...args, include: { warehouse: { select: { code: true, name: true } }, lines: { ...(filters.productRecordId ? { where: { ...scoped(scope), productRecordId: filters.productRecordId } } : {}), include: { product: { select: { sku: true } }, reservations: { select: { requestedQty: true, releasedQty: true, dispatchedQty: true } } } } } } as Prisma.WmsOutboundFindManyArgs); break;
      case "warehouses": rows = await tx.wmsWarehouse.findMany(args as Prisma.WmsWarehouseFindManyArgs); break;
      case "areas": rows = await tx.wmsArea.findMany(args as Prisma.WmsAreaFindManyArgs); break;
      case "locations": rows = await tx.wmsLocation.findMany(args as Prisma.WmsLocationFindManyArgs); break;
      case "lots": rows = await tx.wmsLot.findMany(args as Prisma.WmsLotFindManyArgs); break;
      case "receipts": rows = filters.workflowStatus
        ? await queryReceiptWork(tx, scope, { ...filters, workflowStatus: filters.workflowStatus as ReceiptWorkFilter }, limit, after)
        : await tx.wmsReceipt.findMany({ ...args, include: { lines: true } } as Prisma.WmsReceiptFindManyArgs); break;
      case "reservations": rows = filters.workflowStatus
        ? await queryReservations(tx, scope, { ...filters, workflowStatus: filters.workflowStatus as ReservationStatusFilter }, limit, after)
        : await tx.wmsReservation.findMany(args as Prisma.WmsReservationFindManyArgs); break;
      case "inventory-valuation":
      case "inventory-history":
      case "reconciliation":
      case "balances": rows = await tx.wmsStockBalance.findMany(args as Prisma.WmsStockBalanceFindManyArgs); break;
      case "movements":
      case "transfers": rows = await tx.wmsMovement.findMany(args as Prisma.WmsMovementFindManyArgs); break;
      case "approvals": rows = await tx.wmsApproval.findMany({ ...args, select: { id: true, action: true, aggregateId: true, expectedRevision: true, requestedBy: true, approvedBy: true, status: true, revision: true, expiresAt: true, createdAt: true, request: true } } as Prisma.WmsApprovalFindManyArgs); break;
    }
    const items = rows.slice(0, limit);
    const last = items.at(-1) as unknown as Record<string, unknown> | undefined;
    const publicItems = kind === "inventory-valuation" ? await presentInventoryValuation(tx,scope,await presentBalances(tx,scope,items as Prisma.WmsStockBalanceGetPayload<Record<string,never>>[])) : kind === "conversions" ? await presentConversions(tx,scope,items as Prisma.WmsCommandGetPayload<Record<string,never>>[]) : kind === "inventory-history" ? await presentInventoryHistory(tx,scope,await presentBalances(tx,scope,items as Prisma.WmsStockBalanceGetPayload<Record<string,never>>[]),historyRange!.from,historyRange!.to) : kind === "outbounds" ? (items as unknown as Array<Record<string, unknown> & { lines: Array<Record<string, unknown> & { requestedQty: number; reservations: Array<{ requestedQty: number; releasedQty: number; dispatchedQty: number }> }> }>).map(item => ({ ...item, lines: item.lines.map(line => {
      const dispatchedQty = line.reservations.reduce((sum, reservation) => sum + reservation.dispatchedQty, 0);
      const allocatedQty = line.reservations.reduce((sum, reservation) => sum + reservation.requestedQty - reservation.releasedQty - reservation.dispatchedQty, 0);
      return { ...line, dispatchedQty, allocatedQty, allocatableQty: Math.max(0, line.requestedQty - dispatchedQty - allocatedQty) };
    }) })) : kind === "receipts" ? await presentReceipts(tx, scope, items as (Prisma.WmsReceiptGetPayload<{ include: { lines: true } }>)[]) : kind === "reconciliation" ? await reconcileBalances(tx, scope, items as unknown as Array<{ id: string; onHand: number; pendingQc: number; pendingPutaway: number; rejected: number; reserved: number }>) : kind === "approvals" ? await presentApprovals(tx, scope, items as unknown as Record<string, unknown>[], approvalAccess) : kind === "reservations" ? await presentReservations(tx, scope, items as Prisma.WmsReservationGetPayload<Record<string, never>>[]) : kind === "balances" ? await presentBalances(tx, scope, items as Prisma.WmsStockBalanceGetPayload<Record<string, never>>[]) : kind === "movements" || kind === "transfers" ? await presentMovements(tx, scope, items as Prisma.WmsMovementGetPayload<Record<string, never>>[]) : kind === "stocktakes" ? items.map(value => {
      const row = value as unknown as Record<string, unknown> & { blind: boolean; status: string; locations?: Array<Record<string, unknown> & { lines: Array<Record<string, unknown>> }> };
      const summary=row.locations?stocktakeSummary(row as unknown as Parameters<typeof stocktakeSummary>[0]):undefined;
      return row.blind && (row.status === "DRAFT" || row.status === "COUNTING") ? { ...row,summary, locations: row.locations?.map(location => ({ ...location, lines: location.lines.map(line => Object.fromEntries(Object.entries(line).filter(([key]) => !key.startsWith("baseline")))) })) } : {...row,summary};
    }) : items;
    const resultItems=historyGranularity?await appendInventoryPeriods(tx,scope,publicItems as unknown as {id:string;openingQty:unknown}[],historyRange!.from,historyRange!.to,historyGranularity as InventoryGranularity):publicItems;
    return { items: resultItems, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ fingerprint, id: last.id, time: (last[timeKey] as Date).toISOString() })).toString("base64url") : null };
  }, kind === "stock-aging" || kind === "inventory-valuation" || kind === "inventory-history" || kind === "reconciliation" || (kind === "receipts" && filters.workflowStatus) ? { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead } : undefined);
}
