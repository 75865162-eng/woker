import { createHash } from 'node:crypto';
import { Prisma, type FbaLocalPlan } from '@prisma/client';
import { scoped } from '@/lib/wms/access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import type { Tx } from '@/lib/wms/repository';
import { nextTransportStatus, parseForwarderOrder, parseTrackingEvent } from './transport-rules';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Plan = FbaLocalPlan & {lines: {reservationId: string | null; quantity: number}[]};
/** The caller holds the plan lock and checks live membership, account access and ownership. */
export async function writeTransport(tx: Tx, scope: WmsScope, plan: Plan, action: 'CREATE_FORWARDER_ORDER'|'APPEND_TRACKING', raw: unknown, expectedRevision: number) {
  if (plan.status === 'CANCELLED') throw new WmsError('已取消计划不能委托运输或追加轨迹。',409);
  const identity = scoped(scope);
  const order = await tx.fbaLocalForwarderOrder.findFirst({where:{...identity,planId:plan.id}});
  let result: {orderId:string; eventId?:string};
  let metadata: Prisma.InputJsonObject;
  if (action === 'CREATE_FORWARDER_ORDER') {
    const input = parseForwarderOrder(raw), requestHash = hash(input);
    if (order) {
      if (order.idempotencyKey !== input.idempotencyKey || order.requestHash !== requestHash || order.createdBy !== scope.actorUserId) throw new WmsError('计划已关联委托单，不可覆盖。',409);
      return {orderId:order.id,revision:plan.revision};
    }
    if (plan.revision !== expectedRevision) throw new WmsError('计划版本已变化，请刷新。',409);
    const created = await tx.fbaLocalForwarderOrder.create({data:{...identity,id:crypto.randomUUID(),planId:plan.id,...input,requestHash,createdBy:scope.actorUserId}});
    result={orderId:created.id};metadata={orderId:created.id,number:created.number};
  } else {
    if (!order) throw new WmsError('请先创建货代委托单。',409);
    const input = parseTrackingEvent(raw),requestHash = hash(input);
    const prior = await tx.fbaLocalTracking.findFirst({where:{...identity,orderId:order.id,idempotencyKey:input.idempotencyKey}});
    if (prior) {
      if (prior.requestHash !== requestHash || prior.createdBy !== scope.actorUserId) throw new WmsError('轨迹幂等键已用于其他内容。',409);
      return {orderId:order.id,eventId:prior.id,revision:plan.revision};
    }
    if (plan.revision !== expectedRevision) throw new WmsError('计划版本已变化，请刷新。',409);
    if (order.lastEventAt && Date.parse(input.occurredAt) < order.lastEventAt.getTime()) throw new WmsError('新节点不能早于上一物流节点。',409);
    const status=nextTransportStatus(order.status,input.eventType);
    if (await tx.fbaLocalTracking.count({where:{...identity,orderId:order.id}})>=1000) throw new WmsError('单张委托单最多记录 1000 条轨迹。',422);
    if (input.eventType === 'DEPARTED') {
      const ids=plan.lines.flatMap(line=>line.reservationId?[line.reservationId]:[]).sort();
      if (!plan.packing || ids.length!==plan.lines.length) throw new WmsError('发运前须完成装箱及公司仓全部出库。',409);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "WmsReservation" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
      const reservations=await tx.wmsReservation.findMany({where:{...identity,id:{in:ids}},select:{id:true,dispatchedQty:true}});
      if (plan.lines.some(line=>reservations.find(row=>row.id===line.reservationId)?.dispatchedQty!==line.quantity)) throw new WmsError('公司仓尚未完成全部出库，不能记录发运。',409);
    }
    const event=await tx.fbaLocalTracking.create({data:{...identity,id:crypto.randomUUID(),orderId:order.id,...input,requestHash,createdBy:scope.actorUserId}});
    await tx.fbaLocalForwarderOrder.update({where:{id:order.id},data:{status,lastEventAt:input.occurredAt}});
    result={orderId:order.id,eventId:event.id};metadata={orderId:order.id,eventId:event.id,eventType:event.eventType,status};
  }
  const updated=await tx.fbaLocalPlan.update({where:{id:plan.id},data:{revision:{increment:1}}});
  await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:`fba-local.${action==='CREATE_FORWARDER_ORDER'?'transport.create':'tracking.append'}`,entityType:'FbaLocalPlan',entityId:plan.id,metadata:{workspaceId:scope.workspaceId,detail:{...metadata,revision:updated.revision}}}});
  return {...result,revision:updated.revision};
}

export async function cancelBookedTransport(tx:Tx,scope:WmsScope,planId:string) {
  const order=await tx.fbaLocalForwarderOrder.findFirst({where:{...scoped(scope),planId}});
  if (!order || order.status==='CANCELLED') return;
  if (order.status!=='BOOKED') throw new WmsError('委托单已发运，不能取消关联计划。',409);
  await tx.fbaLocalForwarderOrder.update({where:{id:order.id},data:{status:'CANCELLED'}});
  await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'fba-local.transport.cancel',entityType:'FbaLocalPlan',entityId:planId,metadata:{workspaceId:scope.workspaceId,orderId:order.id}}});
}
