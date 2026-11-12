import {writeWorkflowOptions} from './workflow-options';
import { writeExternalOperationRecord } from './external-operation-service';
import { inboundWriteReadiness } from './external-operation-contract';
import { isDeepStrictEqual } from "node:util";
import { allocateLocalCost, readLocalCost } from "./cost-allocation";
import { writeFeeLedger } from "./fee-ledger";
import { validateCostHierarchy } from './cost-hierarchy-service';
import { writeCustoms, cancelPlanCustoms } from './customs-service';
import { writeFinanceDraft } from './finance-draft-service';
import { writeShipmentDocument } from './shipment-document-service';
import { writeTransport, cancelBookedTransport } from "./transport-service";
import { previewShipment, linkShipment } from "./shipment-service";
import { reconcileCosts } from "@/lib/finance/rules";
import { parseLocalPacking } from "./packing";
import { planFulfillment } from "./fulfillment";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { authorizeFbaAccount } from "./account-access";
import { authorizeWms, scoped } from "@/lib/wms/access";
import { activeLocation, lockKey, type Tx } from "@/lib/wms/repository";
import { requestApprovalInTransaction } from "@/lib/wms/approvals";
import { executeWmsCommandInTransaction } from "@/lib/wms/application-service";
import { approvalActionFlags } from "@/lib/wms/approval-query";
import { queryStockContexts } from "@/lib/wms/stock-context-query";
import { assertWmsAccess } from "@/lib/wms/access";
import { availableQuantity, parseWmsCommand, requireRevision, requireText, strictKeys } from "@/lib/wms/rules";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";
import { assertPlanCancellable, draftHash, object, parseFbaPlanDraft, reservationCommand, reservationProgress } from "./rules";

type PlanApproval = { id: string; revision: number; requestedBy: string; approvedBy: string | null; status: string; expiresAt: Date; request: Prisma.JsonValue; number: string };
async function latestApprovals(tx: Tx, scope: WmsScope, lineIds: string[]) {
  if (!lineIds.length) return new Map<string, PlanApproval>();
  const rows = await tx.$queryRaw<PlanApproval[]>(Prisma.sql`SELECT DISTINCT ON (request #>> '{payload,number}')
    id, revision, "requestedBy", "approvedBy", status, "expiresAt", request, request #>> '{payload,number}' AS number
    FROM "WmsApproval" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId}
    AND action='RESERVE' AND request #>> '{payload,number}' IN (${Prisma.join(lineIds.map(id => `FBA-LOCAL:${id}`))})
    ORDER BY request #>> '{payload,number}', "createdAt" DESC, id DESC`);
  return new Map(rows.map(row => [row.number, row]));
}


async function audit(tx: Tx, scope: WmsScope, action: string, id: string, metadata: Prisma.InputJsonValue = {}) {
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId,
    action: `fba-local.${action}`, entityType: "FbaLocalPlan", entityId: id, metadata: { workspaceId: scope.workspaceId, detail: metadata } } });
}

export async function createFbaLocalPlan(scope: WmsScope, raw: unknown) {
  const draft = parseFbaPlanDraft(raw);
  return prisma.$transaction(async tx => {
    await authorizeWms(tx, scope, "create");
    await authorizeFbaAccount(tx, scope, draft.sellerAccountId, draft.marketplaceId);
    await lockKey(tx, JSON.stringify(["fba-create", ...Object.values(scoped(scope)), draft.idempotencyKey]));
    const prior = await tx.fbaLocalPlan.findFirst({ where: { ...scoped(scope), idempotencyKey: draft.idempotencyKey }, include: { lines: true } });
    if (prior) {
      if (prior.createdBy !== scope.actorUserId || prior.requestHash !== draftHash(draft)) throw new WmsError("幂等键已用于其他计划。", 409);
      return prior;
    }
    for (const line of draft.lines) {
      const balance = await tx.wmsStockBalance.findFirst({ where: { ...scoped(scope), id: line.balanceId } });
      if (!balance) throw new WmsError("库存余额不存在。", 404);
      await activeLocation(tx, scope, balance.locationId, balance.warehouseId, "STORAGE");
      if (line.quantity > availableQuantity(balance)) throw new WmsError("计划数量超过当前可用库存；草稿不预占库存。", 422);
    }
    const { lines, ...header } = draft;
    const result = await tx.fbaLocalPlan.create({ data: { ...scoped(scope), ...header, id: crypto.randomUUID(), createdBy: scope.actorUserId,
      requestHash: draftHash(draft), lines: { create: lines.map(line => ({ ...line, id: crypto.randomUUID() })) } }, include: { lines: true } });
    await audit(tx, scope, "create", result.id);
    return result;
  });
}

export async function actOnFbaLocalPlan(scope: WmsScope, raw: unknown) {
  const body = object(raw);
  strictKeys(body, ["action", "id", "expectedRevision", "lineId", "balanceRevision", "approvalId", "packing", "costAllocation", "feeRecord", "forwarderBill", "forwarderOrder", "trackingEvent", "shipmentLink", "customs", "financeDraft", "shipmentDocument", "externalOperation", "workflowOption"]);
  const id = requireText(body.id, "计划 ID");
  const expectedRevision = requireRevision(body.expectedRevision);
  const action = body.action;
  const customsActions=['CREATE_CUSTOMS_DRAFT','REVIEW_CUSTOMS_DRAFT','CANCEL_CUSTOMS_DRAFT','APPEND_CLEARANCE','EXPORT_CUSTOMS_DRAFT'];
  const financeActions=['CREATE_FINANCE_DRAFT','REVIEW_FINANCE_DRAFT'];
  const optionActions=['CAPTURE_WORKFLOW_OPTIONS','SELECT_WORKFLOW_OPTION'];
  const externalActions=['REGISTER_EXTERNAL_UNCERTAINTY','RESOLVE_EXTERNAL_UNCERTAINTY'];
  const documentActions=['CREATE_SHIPMENT_DOCUMENT','CANCEL_SHIPMENT_DOCUMENT'];
  if (!["REQUEST_RESERVATION", "EXECUTE_RESERVATION", "CANCEL", "SAVE_PACKING", "SAVE_COST_ALLOCATION", "CREATE_FEE_RECORD", "CONFIRM_FORWARDER_BILL", "CREATE_FORWARDER_ORDER", "APPEND_TRACKING", "PREVIEW_SHIPMENT_LINK", "LINK_AMAZON_SHIPMENT",...customsActions,...financeActions,...documentActions,...externalActions,...optionActions].includes(String(action))) throw new WmsError("不支持的本地计划动作。", 400);
  return prisma.$transaction(async tx => {
    await authorizeWms(tx, scope, "edit");
    await tx.$queryRaw`SELECT id FROM "FbaLocalPlan" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const plan = await tx.fbaLocalPlan.findFirst({ where: { ...scoped(scope), id }, include: { lines: { include: { reservation: true } } } });
    if (!plan) throw new WmsError("计划不存在。", 404);
    if (plan.createdBy !== scope.actorUserId && action!=='REVIEW_CUSTOMS_DRAFT' && action!=='REVIEW_FINANCE_DRAFT' && action!=='RESOLVE_EXTERNAL_UNCERTAINTY' && action!=='SELECT_WORKFLOW_OPTION') throw new WmsError("仅计划创建人可以操作该计划。", 403);
    await authorizeFbaAccount(tx, scope, plan.sellerAccountId, plan.marketplaceId);
    if(['CANCEL','SAVE_PACKING','REQUEST_RESERVATION','EXECUTE_RESERVATION','LINK_AMAZON_SHIPMENT'].includes(String(action))&&await tx.fbaRemoteAction.count({where:{...scoped(scope),planId:plan.id,status:{in:['QUEUED','SENDING','WAITING','POLLING','RESULT_UNKNOWN']}}}))throw new WmsError('计划存在外部执行或待核实结果，先完成原操作核实。',409);
    if(optionActions.includes(String(action))){strictKeys(body,['action','id','expectedRevision','workflowOption']);return writeWorkflowOptions(tx,scope,plan,String(action),body.workflowOption,expectedRevision);}
    if(body.workflowOption!==undefined)throw new WmsError('此动作不接受工作流方案。',400);
    if(externalActions.includes(String(action))){strictKeys(body,['action','id','expectedRevision','externalOperation']);return writeExternalOperationRecord(tx,scope,plan,String(action),body.externalOperation,expectedRevision);}
    if(body.externalOperation!==undefined)throw new WmsError('此动作不接受外部操作登记。',400);
    if(documentActions.includes(String(action))){strictKeys(body,['action','id','expectedRevision','shipmentDocument']);return writeShipmentDocument(tx,scope,plan,String(action),body.shipmentDocument,expectedRevision);}
    if(body.shipmentDocument!==undefined)throw new WmsError('此动作不接受货件资料。',400);
    if(financeActions.includes(String(action))){strictKeys(body,['action','id','expectedRevision','financeDraft']);return writeFinanceDraft(tx,scope,plan,String(action),body.financeDraft,expectedRevision);}
    if(body.financeDraft!==undefined)throw new WmsError('此动作不接受核算规则草稿。',400);
    if(customsActions.includes(String(action))){
      strictKeys(body,['action','id','expectedRevision','customs']);
      return writeCustoms(tx,scope,plan,String(action),body.customs,expectedRevision);
    }
    if(body.customs!==undefined)throw new WmsError('此动作不接受报关资料。',400);
    if (action === "PREVIEW_SHIPMENT_LINK" || action === "LINK_AMAZON_SHIPMENT") {
      strictKeys(body,["action","id","expectedRevision","shipmentLink"]);
      if (plan.status === "CANCELLED") throw new WmsError("已取消计划不能关联货件。",409);
      return action === "PREVIEW_SHIPMENT_LINK" ? previewShipment(tx,scope,plan,body.shipmentLink) : linkShipment(tx,scope,plan,body.shipmentLink,expectedRevision);
    }
    if (body.shipmentLink !== undefined) throw new WmsError("此动作不接受货件关联参数。",400);
    if (action === "CREATE_FORWARDER_ORDER" || action === "APPEND_TRACKING") {
      strictKeys(body,["action","id","expectedRevision",action === "CREATE_FORWARDER_ORDER" ? "forwarderOrder" : "trackingEvent"]);
      return writeTransport(tx,scope,plan,action,action === "CREATE_FORWARDER_ORDER" ? body.forwarderOrder : body.trackingEvent,expectedRevision);
    }
    if (body.forwarderOrder !== undefined || body.trackingEvent !== undefined) throw new WmsError("此动作不接受运输资料。",400);
    if (action === "CREATE_FEE_RECORD" || action === "CONFIRM_FORWARDER_BILL") {
      strictKeys(body, ["action", "id", "expectedRevision", action === "CREATE_FEE_RECORD" ? "feeRecord" : "forwarderBill"]);
      return writeFeeLedger(tx, scope, plan, action, action === "CREATE_FEE_RECORD" ? body.feeRecord : body.forwarderBill, expectedRevision);
    }
    if (body.feeRecord !== undefined || body.forwarderBill !== undefined) throw new WmsError("此动作不接受费用台账或账单资料。", 400);
    if (action === "SAVE_COST_ALLOCATION") {
      if (body.lineId !== undefined || body.balanceRevision !== undefined || body.approvalId !== undefined || body.packing !== undefined) throw new WmsError("费用分摊不接受库存或装箱命令参数。", 400);
      if (plan.status === "CANCELLED") throw new WmsError("已取消计划不能保存费用分摊。", 409);
      const costAllocation = allocateLocalCost(body.costAllocation, plan.lines);
      await validateCostHierarchy(tx,scope,plan,costAllocation);
      if (plan.costAllocation !== null && isDeepStrictEqual(readLocalCost(plan.costAllocation, plan.lines), costAllocation)) {
        if (plan.revision === expectedRevision || plan.revision === expectedRevision + 1) return { id, revision: plan.revision, costAllocation };
      }
      if (plan.revision !== expectedRevision) throw new WmsError("计划版本已变化，请刷新后重新分摊。", 409);
      if (plan.costAllocation !== null && readLocalCost(plan.costAllocation, plan.lines).stage === "ACTUAL") throw new WmsError("实际账单已确认，不能覆盖；如需更正，请保留原账单并创建新的费用记录。", 409);
      const updated = await tx.fbaLocalPlan.update({ where: { id }, data: { costAllocation, revision: { increment: 1 } } });
      await audit(tx, scope, "cost.allocate", id, { revision: updated.revision, costAllocation });
      return { id, revision: updated.revision, costAllocation };
    }
    if (body.costAllocation !== undefined) throw new WmsError("此动作不接受费用资料。", 400);
    if (action === "SAVE_PACKING") {
      if (body.lineId !== undefined || body.balanceRevision !== undefined || body.approvalId !== undefined) throw new WmsError("装箱动作不接受库存命令参数。", 400);
      const reservationIds = plan.lines.flatMap(line => line.reservationId ? [line.reservationId] : []).sort();
      // Serialize with WMS release/dispatch; the plan lock alone cannot protect reservation facts.
      if (reservationIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "WmsReservation" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id IN (${Prisma.join(reservationIds)}) ORDER BY id FOR UPDATE`);
      const reservations = reservationIds.length ? await tx.wmsReservation.findMany({ where: { ...scoped(scope), id: { in: reservationIds } }, select: { dispatchedQty: true, releasedQty: true } }) : [];
      if (plan.status === "CANCELLED" || reservations.some(row => row.dispatchedQty > 0 || row.releasedQty > 0)) throw new WmsError("计划已取消、已释放或已出库，不能修改装箱资料。", 409);
      const packing = parseLocalPacking(body.packing, plan.lines);
      // Lost responses may replay the immediately committed document, never a different revision.
      if (plan.revision === expectedRevision + 1 && plan.packing !== null && JSON.stringify(parseLocalPacking(plan.packing, plan.lines)) === JSON.stringify(packing)) return { id: plan.id, revision: plan.revision, packing };
      if (plan.revision !== expectedRevision) throw new WmsError("计划版本已变化，请刷新后重新装箱。", 409);
      if(plan.packing!==null&&!isDeepStrictEqual(parseLocalPacking(plan.packing,plan.lines),packing)&&await tx.fbaLocalShipmentDocument.count({where:{...scoped(scope),planId:plan.id,kind:'CONTAINER',status:'REGISTERED'}}))throw new WmsError('装箱资料已关联有效柜单；更正前须先注销相关柜单登记。',409);
      const updated = await tx.fbaLocalPlan.update({ where: { id }, data: { packing, revision: { increment: 1 } } });
      await audit(tx, scope, "packing.save", id, { revision: updated.revision, packing });
      return { id, revision: updated.revision, packing };
    }
    if (body.packing !== undefined) throw new WmsError("此动作不接受装箱资料。", 400);
    if (action === "CANCEL") {
      if (body.lineId !== undefined || body.balanceRevision !== undefined || body.approvalId !== undefined) throw new WmsError("取消动作不接受库存命令参数。", 400);
      if (plan.status === "CANCELLED" && plan.revision === expectedRevision + 1) return plan;
      if (plan.revision !== expectedRevision || plan.status === "CANCELLED") throw new WmsError("计划版本已变化。", 409);
      if(await tx.fbaExternalOperationRecord.count({where:{...scoped(scope),planId:plan.id,status:'RESULT_UNKNOWN'}}))throw new WmsError('存在未知外部结果，须先核实后取消本地计划。',409);
      assertPlanCancellable(plan.lines.map(line => line.reservation));
      await cancelPlanCustoms(tx,scope,id);
      await cancelBookedTransport(tx,scope,id);
      const result = await tx.fbaLocalPlan.update({ where: { id }, data: { status: "CANCELLED", revision: { increment: 1 } } });
      await audit(tx, scope, "cancel", id);
      return result;
    }
    if (plan.status === "CANCELLED") throw new WmsError("已取消计划不能交接库存。", 409);
    const lineId = requireText(body.lineId, "计划明细 ID");
    const line = plan.lines.find(row => row.id === lineId);
    if (!line) throw new WmsError("计划明细不存在。", 404);
    const balanceRevision = requireRevision(body.balanceRevision);
    let command = reservationCommand(scope.workspaceId, line, balanceRevision);
    if (action === "EXECUTE_RESERVATION") {
      const approval = await tx.wmsApproval.findFirst({ where: { ...scoped(scope), id: requireText(body.approvalId, "审批 ID"), requestedBy: scope.actorUserId } });
      if (!approval) throw new WmsError("预占审批不存在。", 409);
      const approvedCommand = parseWmsCommand(approval.request);
      if (approvedCommand.workspaceId !== command.workspaceId || approvedCommand.aggregateId !== command.aggregateId || approvedCommand.expectedRevision !== command.expectedRevision || JSON.stringify(approvedCommand.payload) !== JSON.stringify(command.payload)) throw new WmsError("审批与计划明细不一致。", 409);
      command = approvedCommand;
    }
    if (line.reservationId) {
      if (action !== "EXECUTE_RESERVATION") throw new WmsError("明细已关联预占，不可重复申请。", 409);
      // Only acknowledge the exact persisted approval/command; never create a replacement reservation.
      const approval = await tx.wmsApproval.findFirst({ where: { ...scoped(scope), id: requireText(body.approvalId, "审批 ID"), requestedBy: scope.actorUserId, status: "CONSUMED" } });
      if (!approval) throw new WmsError("原执行审批不存在。", 409);
      const result = await executeWmsCommandInTransaction(tx, scope, command, approval.id);
      if (object(result).aggregateId !== line.reservationId) throw new WmsError("审批与已关联预占不一致。", 409);
      return { planId: id, lineId, revision: plan.revision, result };
    }
    if (plan.revision !== expectedRevision) throw new WmsError("计划版本已变化。", 409);
    if (action === "REQUEST_RESERVATION") {
      if (body.approvalId !== undefined) throw new WmsError("申请动作不接受审批 ID。", 400);
      const previous = (await latestApprovals(tx, scope, [line.id])).get(`FBA-LOCAL:${line.id}`);
      if (previous) {
        const priorCommand = parseWmsCommand(previous.request);
        if (priorCommand.expectedRevision === balanceRevision && ["PENDING", "APPROVED"].includes(previous.status) && previous.expiresAt.getTime() > Date.now()) return previous;
        command = { ...command, idempotencyKey: `${command.idempotencyKey}:${crypto.randomUUID()}` };
      }
      return requestApprovalInTransaction(tx, scope, command);
    }
    const result = await executeWmsCommandInTransaction(tx, scope, command, requireText(body.approvalId, "审批 ID"));
    const reservationId = requireText(object(result).aggregateId, "预占单 ID");
    await tx.fbaLocalPlanLine.update({ where: { id: lineId }, data: { reservationId } });
    const updated = await tx.fbaLocalPlan.update({ where: { id }, data: { status: "ACTIVE", revision: { increment: 1 } } });
    await audit(tx, scope, "reserve", id, { lineId, reservationId });
    return { planId: id, lineId, revision: updated.revision, result };
  });
}

export async function queryFbaLocalPlans(scope: WmsScope, params: URLSearchParams) {
  const lineId = params.has("lineId") ? requireText(params.get("lineId"), "计划明细 ID", 100) : undefined;
  const id = params.get("id") ? requireText(params.get("id"), "计划 ID") : undefined;
  const page = Number(params.get("page") ?? "1");
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new WmsError("页码须为 1-1000。", 400);
  return prisma.$transaction(async tx => {
    const access = await assertWmsAccess(tx, { ...scope, userId: scope.actorUserId, action: "view" });
    const linked = lineId ? await tx.fbaLocalPlan.findFirst({ where: { ...scoped(scope), lines: { some: { id: lineId } } }, select: { id: true, sellerAccountId: true, marketplaceId: true } }) : null;
    if (lineId && (!linked || (id && id !== linked.id))) throw new WmsError("当前工作区没有此关联计划。", 404);
    if (lineId && page !== 1) throw new WmsError("关联计划只能读取第一页。", 400);
    const sellerAccountId = linked?.sellerAccountId ?? requireText(params.get("sellerAccountId"), "Amazon 账号");
    const marketplaceId = linked?.marketplaceId ?? requireText(params.get("marketplaceId"), "Amazon 站点");
    if (linked && ((params.has("sellerAccountId") && params.get("sellerAccountId") !== sellerAccountId) || (params.has("marketplaceId") && params.get("marketplaceId") !== marketplaceId))) throw new WmsError("关联计划与账号或站点不一致。", 400);
    await authorizeFbaAccount(tx, scope, sellerAccountId, marketplaceId);
    const rows = await tx.fbaLocalPlan.findMany({ where: { ...scoped(scope), sellerAccountId, marketplaceId, ...((linked?.id ?? id) ? { id: linked?.id ?? id } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 20, take: 21,
      select: { id: true, number: true, sellerAccountId: true, marketplaceId: true, status: true, packing: true, costAllocation: true, revision: true, createdBy: true, createdAt: true,
        workflowOptions:{select:{id:true,kind:true,externalPlanId:true,operationId:true,capturedAt:true,expiresAt:true,evidence:true,sourceHash:true,createdBy:true,selection:true},orderBy:[{capturedAt:'desc'},{id:'asc'}],take:10},
        externalOperations:{orderBy:[{createdAt:'asc'},{id:'asc'}],take:100},
        customsDeclarations:{orderBy:[{createdAt:'asc'},{id:'asc'}],take:20,select:{id:true,shipmentId:true,number:true,destinationCountry:true,currency:true,exporter:true,importer:true,templateReference:true,evidence:true,status:true,createdBy:true,reviewedBy:true,reviewedAt:true,createdAt:true,
          items:{orderBy:{planLineId:'asc'},select:{planLineId:true,description:true,hsCode:true,originCountry:true,quantity:true,unit:true,unitPrice:true,declaredValue:true}},
          events:{orderBy:[{occurredAt:'asc'},{createdAt:'asc'},{id:'asc'}],take:100,select:{id:true,eventType:true,occurredAt:true,reference:true,evidence:true,createdBy:true}}}},
        shipments: {orderBy:[{createdAt:"asc"},{id:"asc"}],take:20,select:{id:true,spApiInboundPlanId:true,spApiShipmentId:true,sourceStatus:true,warehouseId:true,sourceId:true,sourceRunId:true,capturedAt:true,mappingEvidence:true,
          documents:{orderBy:[{createdAt:'asc'},{id:'asc'}],take:100,select:{id:true,kind:true,number:true,evidence:true,payload:true,status:true,cancellationEvidence:true,cancelledAt:true,createdAt:true}},
          items:{orderBy:{id:"asc"},select:{id:true,planLineId:true,observationId:true,sellerSku:true,fnsku:true,quantity:true}}}},
        forwarderOrder: { select: {id:true,number:true,forwarder:true,channel:true,mode:true,destination:true,containerNumber:true,billOfLading:true,vesselOrFlight:true,cutoffAt:true,departureEta:true,arrivalEta:true,status:true,lastEventAt:true,
          _count:{select:{events:true}},events:{orderBy:[{occurredAt:"desc"},{createdAt:"desc"},{id:"desc"}],take:50,select:{id:true,eventType:true,occurredAt:true,location:true,evidence:true,source:true}} } },
        fees: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100, select: { id: true, number: true, feeType: true, estimate: true, createdAt: true,
          bill: { select: { id: true, number: true, forwarder: true, forwarderOrderId: true, actual: true, createdAt: true, adjustment: { select: { id: true, currency: true, difference: true, status: true,
            drafts:{orderBy:[{createdAt:'asc'},{id:'asc'}],take:20,select:{id:true,ruleInput:true,voucher:true,summary:true,status:true,createdBy:true,reviewedBy:true,reviewedAt:true,createdAt:true}} } } } } } },
        lines: { orderBy: { id: "asc" }, select: { id: true, balanceId: true, quantity: true, reservationId: true,
          balance: { select: { revision: true, warehouseId: true, locationId: true, lot: { select: { productRecordId: true, lotCode: true } } } },
          reservation: { select: { requestedQty: true, releasedQty: true, dispatchedQty: true, pickedQty: true, revision: true } } } } } });
    const visible = rows.slice(0, 20);
    const approvals = await latestApprovals(tx, scope, visible.flatMap(row => row.lines.map(line => line.id)));
    const stocks = await queryStockContexts(tx, scope, visible.flatMap(row => row.lines.map(line => line.balanceId)));
    return { items: visible.map(row => ({ ...row, fees: row.fees.map(fee => {
      const estimate = readLocalCost(fee.estimate, row.lines);
      const actual = fee.bill ? readLocalCost(fee.bill.actual, row.lines) : null;
      return { ...fee, estimate, bill: fee.bill && actual ? { ...fee.bill, actual, reconciliation: reconcileCosts(estimate, actual) } : null };
    }), costAllocation: row.costAllocation === null ? null : readLocalCost(row.costAllocation, row.lines), packing: row.packing === null ? null : parseLocalPacking(row.packing, row.lines), fulfillment: planFulfillment(row.status, row.lines), lines: row.lines.map(line => {
      const approval = approvals.get(`FBA-LOCAL:${line.id}`);
      const command = approval ? parseWmsCommand(approval.request) : null;
      return { ...line, stock: stocks.get(line.balanceId) ?? null, progress: reservationProgress(line.quantity, line.reservation),
        approval: approval && command ? { id: approval.id, revision: approval.revision, status: approval.status, expiresAt: approval.expiresAt,
          balanceRevision: command.expectedRevision, ...approvalActionFlags(scope, approval, { canEdit: access.permissions.wms?.includes("edit") ?? false, canApprove: access.permissions.wms?.includes("approve") ?? false, now: new Date() }) } : null };
    }),
      stockReady: row.status !== "CANCELLED" && row.lines.every(line => reservationProgress(line.quantity, line.reservation).status === "RESERVED"),
      externalWriteReadiness: inboundWriteReadiness, amazonSubmission: "NOT_IMPLEMENTED" as const })), page, hasMore: rows.length > 20 };
  }, { isolationLevel: "RepeatableRead" });
}

export type FbaLocalPlansResult = Awaited<ReturnType<typeof queryFbaLocalPlans>>;
