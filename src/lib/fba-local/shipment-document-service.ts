import {createHash} from 'node:crypto';
import type {FbaLocalPlan} from '@prisma/client';
import {scoped,json} from '@/lib/wms/access';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import type {Tx} from '@/lib/wms/repository';
import {requireText,strictKeys} from '@/lib/wms/rules';
import {object} from './rules';
import {parseShipmentDocument} from './shipment-document-rules';
import {parseLocalPacking} from './packing';
export async function writeShipmentDocument(tx:Tx,scope:WmsScope,plan:FbaLocalPlan&{lines:{id:string;quantity:number}[]},action:string,raw:unknown,expectedRevision:number){
 const identity=scoped(scope);let id:string;
 if(action==='CREATE_SHIPMENT_DOCUMENT'){
  const input=parseShipmentDocument(raw),requestHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const prior=await tx.fbaLocalShipmentDocument.findFirst({where:{...identity,planId:plan.id,idempotencyKey:input.idempotencyKey}});
  if(prior){if(prior.requestHash!==requestHash||prior.createdBy!==scope.actorUserId)throw new WmsError('货件资料幂等键冲突。',409);return {documentId:prior.id,revision:plan.revision};}
  if(plan.status==='CANCELLED'||plan.revision!==expectedRevision)throw new WmsError('计划已取消或版本已变化。',409);
  const shipment=await tx.fbaLocalShipment.findFirst({where:{...identity,planId:plan.id,id:input.shipmentId},include:{items:true}});
  if(!shipment)throw new WmsError('货件不属于当前计划。',404);
  if(await tx.fbaLocalShipmentDocument.count({where:{...identity,planId:plan.id}})>=100)throw new WmsError('每计划最多登记 100 份货件资料。',422);
  const payload=input.payload;
  if(input.kind==='INSURANCE'&&payload.premiumFeeId){
   const fee=await tx.fbaLocalFee.findFirst({where:{...identity,planId:plan.id,id:payload.premiumFeeId,feeType:'INSURANCE'}});
   if(!fee)throw new WmsError('保险费不属于当前计划或费用类型不符。',409);
  }
  if(input.kind==='CONTAINER'){
   if(!plan.packing)throw new WmsError('柜单须先保存装箱资料。',409);
   const packing=parseLocalPacking(plan.packing,plan.lines),expected=new Map<string,number>(),actual=new Map<string,number>();
   for(const item of shipment.items)expected.set(item.planLineId,(expected.get(item.planLineId)??0)+item.quantity);
   const occupied=await tx.fbaLocalShipmentDocument.findMany({where:{...identity,planId:plan.id,kind:'CONTAINER',status:'REGISTERED'},select:{payload:true,shipmentId:true}});
   const allCurrent=occupied.flatMap(row=>{const boxes=object(row.payload).boxNumbers;if(!Array.isArray(boxes))throw new WmsError('既有柜单箱号无效。',409);return boxes.map(number=>({number,shipmentId:row.shipmentId}));});
   const selected=payload.boxNumbers!;
   if(allCurrent.some(box=>selected.includes(String(box.number))))throw new WmsError('箱号已登记到其他有效柜单。',409);
   for(const number of [...allCurrent.filter(box=>box.shipmentId===shipment.id).map(box=>String(box.number)),...selected]){
    const box=packing.boxes.find(box=>box.number===number);if(!box)throw new WmsError('柜单箱号不属于当前装箱资料。',409);
    for(const item of box.items)actual.set(item.lineId,(actual.get(item.lineId)??0)+item.quantity);
   }
   if([...actual].some(([lineId,qty])=>!expected.has(lineId)||qty>expected.get(lineId)!))throw new WmsError('柜单累计数量超过关联货件明细。',409);
  }
  id=crypto.randomUUID();await tx.fbaLocalShipmentDocument.create({data:{...identity,...input,payload:json(payload),id,planId:plan.id,requestHash,createdBy:scope.actorUserId}});
 }else{
  const input=object(raw);strictKeys(input,['documentId','cancellationEvidence']);id=requireText(input.documentId,'资料 ID');const cancellationEvidence=requireText(input.cancellationEvidence,'注销依据',2000);
  const prior=await tx.fbaLocalShipmentDocument.findFirst({where:{...identity,planId:plan.id,id}});if(!prior)throw new WmsError('货件资料不属于当前计划。',404);
  if(prior.status==='CANCELLED'){if(prior.cancellationEvidence!==cancellationEvidence||prior.cancelledBy!==scope.actorUserId)throw new WmsError('原注销依据不可覆盖。',409);return {documentId:id,revision:plan.revision};}
  if(plan.revision!==expectedRevision)throw new WmsError('计划版本已变化。',409);
  await tx.fbaLocalShipmentDocument.update({where:{id},data:{status:'CANCELLED',cancellationEvidence,cancelledBy:scope.actorUserId,cancelledAt:new Date()}});
 }
 const updated=await tx.fbaLocalPlan.update({where:{id:plan.id},data:{revision:{increment:1}}});
 await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,entityType:'FbaLocalPlan',entityId:plan.id,action:`fba-local.document.${action.toLowerCase()}`,metadata:{workspaceId:scope.workspaceId,documentId:id,revision:updated.revision}}});
 return {documentId:id,revision:updated.revision};
}
