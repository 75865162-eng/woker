import {createHash} from 'node:crypto';
import type {FbaLocalPlan} from '@prisma/client';
import {scoped,authorizeWms} from '@/lib/wms/access';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import type {Tx} from '@/lib/wms/repository';
import {requireText,strictKeys} from '@/lib/wms/rules';
import {object} from './rules';
import {parseCustomsDraft,parseClearanceEvent,customsDraftXml} from './customs-rules';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function writeCustoms(tx:Tx,scope:WmsScope,plan:FbaLocalPlan,action:string,raw:unknown,expectedRevision:number){
 const identity=scoped(scope),input=object(raw);
 let detail:Record<string,string>;
 let result:{declarationId:string;eventId?:string};
 if(action==='CREATE_CUSTOMS_DRAFT'){
  const shipmentId=requireText(input.shipmentId,'关联货件 ID');
  const shipment=await tx.fbaLocalShipment.findFirst({where:{...identity,planId:plan.id,id:shipmentId},include:{items:true}});
  if(!shipment)throw new WmsError('货件不属于当前计划。',404);
  const parsed=parseCustomsDraft(raw,shipment.items),requestHash=hash(parsed);
  const prior=await tx.fbaLocalCustomsDeclaration.findFirst({where:{...identity,planId:plan.id,idempotencyKey:parsed.idempotencyKey}});
  if(prior){if(prior.requestHash!==requestHash||prior.createdBy!==scope.actorUserId)throw new WmsError('报关幂等键已被其他内容使用。',409);return {declarationId:prior.id,revision:plan.revision};}
  if(plan.status==='CANCELLED'||plan.revision!==expectedRevision)throw new WmsError('计划已取消或版本已变化。',409);
  if(await tx.fbaLocalCustomsDeclaration.count({where:{...identity,planId:plan.id}})>=20)throw new WmsError('每计划最多 20 份报关资料。',422);
  const {items,...header}=parsed,id=crypto.randomUUID();
  await tx.fbaLocalCustomsDeclaration.create({data:{...identity,...header,id,planId:plan.id,requestHash,createdBy:scope.actorUserId}});
  await tx.fbaLocalCustomsItem.createMany({data:items.map(item=>({...identity,...item,id:crypto.randomUUID(),planId:plan.id,declarationId:id}))});
  result={declarationId:id};detail={declarationId:id,number:parsed.number};
 }else{
  const declarationId=requireText(input.declarationId,'报关资料 ID');
  const declaration=await tx.fbaLocalCustomsDeclaration.findFirst({where:{...identity,planId:plan.id,id:declarationId},include:{items:{orderBy:{planLineId:'asc'}},events:{orderBy:[{occurredAt:'desc'},{createdAt:'desc'},{id:'desc'}],take:1},_count:{select:{events:true}}}});
  if(!declaration)throw new WmsError('报关资料不属于当前计划。',404);
  if(action==='EXPORT_CUSTOMS_DRAFT'){
   strictKeys(input,['declarationId']);
   return {declarationId,xml:customsDraftXml(declaration),format:'ERP_INTERNAL_DRAFT',officialSchemaValidated:false};
  }
  if(action==='APPEND_CLEARANCE'){
   // Recognize exact retries before terminal status/time validation; authority is always checked by the caller.
   const idempotencyKey=requireText(input.idempotencyKey,'幂等键'),prior=await tx.fbaLocalClearanceEvent.findFirst({where:{...identity,declarationId,idempotencyKey}});
   if(prior){
    const replay=parseClearanceEvent(raw,input.eventType==='FILED'?null:{eventType:'FILED',occurredAt:new Date(0)},new Date());
    if(prior.requestHash!==hash(replay)||prior.createdBy!==scope.actorUserId)throw new WmsError('清关幂等键已被其他内容使用。',409);
    return {declarationId,eventId:prior.id,revision:plan.revision};
   }
   if(declaration.status!=='REVIEWED'||plan.status==='CANCELLED'||plan.revision!==expectedRevision)throw new WmsError('须先完成资料复核，且计划版本有效。',409);
   if(declaration._count.events>=100)throw new WmsError('每份报关资料最多 100 条清关节点。',422);
   const parsed=parseClearanceEvent(raw,declaration.events[0]??null,new Date());
   const event=await tx.fbaLocalClearanceEvent.create({data:{...identity,...parsed,id:crypto.randomUUID(),planId:plan.id,requestHash:hash(parsed),createdBy:scope.actorUserId}});
   result={declarationId,eventId:event.id};detail={declarationId,eventId:event.id,eventType:parsed.eventType};
  }else{
   strictKeys(input,['declarationId']);
   if(action==='REVIEW_CUSTOMS_DRAFT'){
    await authorizeWms(tx,scope,'approve');
    if(declaration.createdBy===scope.actorUserId)throw new WmsError('须由另一名有审批权限的人员复核报关资料。',403);
    if(declaration.status==='REVIEWED'&&declaration.reviewedBy===scope.actorUserId)return {declarationId,revision:plan.revision};
    if(declaration.status!=='DRAFT')throw new WmsError('仅草稿资料可以复核。',409);
   }else{
    if(declaration.status==='CANCELLED')return {declarationId,revision:plan.revision};
    if(declaration._count.events)throw new WmsError('已有清关登记，不能取消本地资料。',409);
   }
   if(plan.status==='CANCELLED'||plan.revision!==expectedRevision)throw new WmsError('计划已取消或版本已变化。',409);
   await tx.fbaLocalCustomsDeclaration.update({where:{id:declarationId},data:action==='REVIEW_CUSTOMS_DRAFT'?{status:'REVIEWED',reviewedBy:scope.actorUserId,reviewedAt:new Date()}:{status:'CANCELLED'}});
   result={declarationId};detail={declarationId};
  }
 }
 const updated=await tx.fbaLocalPlan.update({where:{id:plan.id},data:{revision:{increment:1}}});
 await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,entityType:'FbaLocalPlan',entityId:plan.id,action:`fba-local.customs.${action.toLowerCase()}`,metadata:{workspaceId:scope.workspaceId,detail:{...detail,revision:updated.revision}}}});
 return {...result,revision:updated.revision};
}
export async function cancelPlanCustoms(tx:Tx,scope:WmsScope,planId:string){
 if(await tx.fbaLocalClearanceEvent.count({where:{...scoped(scope),planId}}))throw new WmsError('计划存在清关登记，不能取消。',409);
 await tx.fbaLocalCustomsDeclaration.updateMany({where:{...scoped(scope),planId,status:{not:'CANCELLED'}},data:{status:'CANCELLED'}});
}
