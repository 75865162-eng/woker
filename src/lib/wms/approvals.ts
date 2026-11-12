import {validateValuationAction} from './valuation-service';
import {validateConsumableIssue} from './consumable-service';
import {validateSkuConversion,validateConversionReversal} from './sku-conversion-service';
import {validateTransferOrderAction} from './transfer-order-service';
import { validateLocationFreeze } from "./location-freeze-service";
import { prisma } from "@/lib/db/prisma";
import { authorizeWms, auditWms, scoped, json } from "./access";
import { WmsError, type WmsScope, type WmsCommandInput } from "./contracts";
import { hashWmsRequest, wmsApprovalLifetimeMs, parseWmsCommand } from "./rules";
import { validateReserve, validateReservationAction, validateTransfer } from "./stock-service";
import { validateReceiptAction } from "./receipt-service";
import { lockAggregate, lockKey, type Tx } from "./repository";
import { validateStocktakePost } from "./stocktake-service";
export const needsApproval = (action: string) => !["TRANSFER_ORDER_CANCEL", "PICK", "UNPICK", "CANCEL", "STOCKTAKE_START", "STOCKTAKE_COUNT", "STOCKTAKE_REVIEW", "STOCKTAKE_CANCEL"].includes(action);
export const requestHash = (input: WmsCommandInput) => hashWmsRequest({ action: input.payload.action, aggregateId: input.aggregateId, expectedRevision: input.expectedRevision, payload: input.payload });
async function validateApprovalTarget(tx: Tx, scope: WmsScope, command: WmsCommandInput) {
 if(command.payload.action==="ACTIVATE_COST_RULE"||command.payload.action==="VALUE_COMMAND")await validateValuationAction(tx,scope,command);
  if(command.payload.action==="TRANSFER_ORDER_SHIP"||command.payload.action==="TRANSFER_ORDER_RECEIVE")await validateTransferOrderAction(tx,scope,command);
  if (command.payload.action === "LOCATION_FREEZE" || command.payload.action === "LOCATION_UNFREEZE") await validateLocationFreeze(tx, scope, command);
  if (command.payload.action === "STOCKTAKE_POST") await validateStocktakePost(tx, scope, command);
  if (["RECEIVE", "INSPECT", "PUTAWAY", "RETURN_REJECTED"].includes(command.payload.action)) await validateReceiptAction(tx, scope, command);
  if (command.payload.action === "RESERVE") await validateReserve(tx, scope, command);
  if (command.payload.action === "CONSUMABLE_ISSUE") await validateConsumableIssue(tx,scope,command);
  if (command.payload.action === "SKU_CONVERSION_REVERSE") await validateConversionReversal(tx,scope,command);
  if (command.payload.action === "SKU_CONVERT") await validateSkuConversion(tx, scope, command);
  if (command.payload.action === "TRANSFER") await validateTransfer(tx, scope, command);
  if (command.payload.action === "RELEASE" || command.payload.action === "DISPATCH") await validateReservationAction(tx, scope, command);
}
export async function requestApproval(scope: WmsScope, command: WmsCommandInput) {
  command = parseWmsCommand(command);
  if (command.payload.action === "RESERVE" && command.payload.number.startsWith("FBA-LOCAL:")) throw new WmsError("FBA 预占必须经本地计划入口申请。", 409);
  return prisma.$transaction(tx => requestApprovalInTransaction(tx, scope, command));
}

export async function requestApprovalInTransaction(tx: Tx, scope: WmsScope, command: WmsCommandInput) {
  command = parseWmsCommand(command);
  if (command.workspaceId !== scope.workspaceId) throw new WmsError("工作区不一致。", 403);
    await authorizeWms(tx, scope, "edit");
    if (!needsApproval(command.payload.action)) throw new WmsError("此动作无需审批。", 400);
    await lockKey(tx, JSON.stringify(["wms-approval-request", scope.organizationId, scope.workspaceId, scope.actorUserId, command.idempotencyKey]));
    const existing = await tx.wmsApproval.findFirst({ where: { ...scoped(scope), requestedBy: scope.actorUserId, request: { path: ["idempotencyKey"], equals: command.idempotencyKey } } });
    if (existing) {
      if (existing.requestHash !== requestHash(command)) throw new WmsError("同一幂等键不能用于不同审批内容。");
      return existing;
    }
    await validateApprovalTarget(tx, scope, command);
    const row = await tx.wmsApproval.create({ data: { ...scoped(scope), id: crypto.randomUUID(), action: command.payload.action, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, requestHash: requestHash(command), request: json(command), requestedBy: scope.actorUserId, expiresAt: new Date(Date.now() + wmsApprovalLifetimeMs) } });
    await auditWms(tx, scope, "approval.request", row.id);
    return row;
}
export async function decideApproval(scope: WmsScope, id: string, revision: number, approved: boolean) {
  return prisma.$transaction(async tx => {
    // Resolve both identities before taking locks, as execution does.
    const identity = approved ? await tx.wmsApproval.findFirst({ where: { ...scoped(scope), id }, select: { requestedBy: true } }) : null;
    await authorizeWms(tx, scope, "approve", identity ? { userId: identity.requestedBy, action: "edit" } : undefined);
    await lockAggregate(tx, scope, id, "approval");
    const row = await tx.wmsApproval.findFirst({ where: { ...scoped(scope), id } });
    if (!row) throw new WmsError("审批不存在。", 404);
    if (row.requestedBy === scope.actorUserId) throw new WmsError("库存动作禁止自批。", 403);
    // A decision retry acknowledges persisted state; it never grants a new execution.
    const decidedStatus = approved ? "APPROVED" : "REJECTED";
    const sameDecision = row.status === decidedStatus && row.revision === revision + 1;
    const alreadyExecuted = approved && row.status === "CONSUMED" && row.revision === revision + 2;
    if (row.approvedBy === scope.actorUserId && (sameDecision || alreadyExecuted)) return row;
    if (row.revision !== revision || row.status !== "PENDING" || row.expiresAt.getTime() <= Date.now()) throw new WmsError("审批已过期或已变更。");
    if (approved) {
      if (row.requestedBy !== identity?.requestedBy) throw new WmsError("审批申请人已变更。");
      const command = parseWmsCommand(row.request);
      if (command.workspaceId !== scope.workspaceId || requestHash(command) !== row.requestHash) throw new WmsError("审批内容不一致。");
      await validateApprovalTarget(tx, { ...scope, actorUserId: row.requestedBy }, command);
    }
    const result = await tx.wmsApproval.update({ where: { id }, data: { approvedBy: scope.actorUserId, status: approved ? "APPROVED" : "REJECTED", revision: { increment: 1 } } });
    await auditWms(tx, scope, "approval.decide", id, { approved });
    return result;
  });
}
export async function verifyApproval(tx: Tx, scope: WmsScope, input: WmsCommandInput, id?: string) {
  if (!needsApproval(input.payload.action)) return;
  if (!id) throw new WmsError("此动作需要独立审批。", 403);
  // Read approver before locks so identities are always locked in sorted order.
  const identity = await tx.wmsApproval.findFirst({ where: { ...scoped(scope), id } });
  if (!identity?.approvedBy || identity.approvedBy === scope.actorUserId) throw new WmsError("审批无效。", 403);
  await authorizeWms(tx, scope, "edit", { userId: identity.approvedBy, action: "approve" });
  await lockAggregate(tx, scope, id, "approval");
  const row = await tx.wmsApproval.findFirstOrThrow({ where: { ...scoped(scope), id } });
  if (row.requestedBy !== scope.actorUserId || row.approvedBy !== identity.approvedBy || row.requestHash !== requestHash(input)) throw new WmsError("审批失效、已消费或与命令不一致。", 403);
  return row;
}
