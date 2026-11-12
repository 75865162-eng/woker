import type {WmsDomainEvent} from '@prisma/client';
import {scoped,json} from './access';
import {WmsError,type WmsScope,type WmsCommandInput} from './contracts';
import {lockAggregate,lockKey,type Tx} from './repository';
import {parseCostRule,valueQuantity,valuationVoucher,type ValuedEntry} from './valuation-rules';
import {commandEventPayload} from './domain-events';
import {isDeepStrictEqual} from 'node:util';
export async function createCostRule(tx:Tx,scope:WmsScope,body:Record<string,unknown>){
 const input=parseCostRule(body);if(!await tx.wmsLot.findFirst({where:{...scoped(scope),id:input.lotId}}))throw new WmsError('批次不属于当前工作区。',422);
 return tx.wmsCostRule.create({data:{...scoped(scope),...input,id:crypto.randomUUID(),createdBy:scope.actorUserId}});
}
export async function validateValuationAction(tx:Tx,scope:WmsScope,input:WmsCommandInput){
 if(input.payload.action==='ACTIVATE_COST_RULE'){
  await lockAggregate(tx,scope,input.aggregateId,'costRule');const rule=await tx.wmsCostRule.findFirst({where:{...scoped(scope),id:input.aggregateId}});
  if(!rule||rule.createdBy!==scope.actorUserId)throw new WmsError('成本规则不可访问或申请人不匹配。',403);
  if(rule.status!=='DRAFT'||rule.revision!==input.expectedRevision)throw new WmsError('成本规则已激活或版本已变化。');return {rule};
 }
 if(input.payload.action!=='VALUE_COMMAND')throw new WmsError('非计价动作。',400);
 await lockAggregate(tx,scope,input.aggregateId,'financeDraft');const draft=await tx.wmsFinanceDraft.findFirst({where:{...scoped(scope),id:input.aggregateId}});
 if(!draft||draft.status!=='NEEDS_DATA'||draft.revision!==input.expectedRevision)throw new WmsError('计价草稿不存在、已完成或版本已变化。');
 await calculateValuation(tx,scoped(scope),draft.commandId,input.payload.rules);return {draft};
}
async function calculateValuation(tx:Tx,scope:Pick<WmsScope,'organizationId'|'workspaceId'>,commandId:string,explicit?:{movementId:string;ruleId:string}[]){
 const identity={organizationId:scope.organizationId,workspaceId:scope.workspaceId};
 const movements=await tx.wmsMovement.findMany({where:{...identity,commandId,deltaOnHand:{not:0}},orderBy:{sequence:'asc'},include:{balance:{select:{lotId:true}}}});
 if(explicit&&(explicit.length!==movements.length||new Set(explicit.map(row=>row.movementId)).size!==explicit.length||explicit.some(row=>!movements.some(m=>m.id===row.movementId))))throw new WmsError('须逐一明确当前命令的全部实物流水成本规则。',422);
 const sourceCommand=await tx.wmsCommand.findFirstOrThrow({where:{...identity,id:commandId}});
 const entries:ValuedEntry[]=[],missingData:{movementId:string;lotId:string;reason:string}[]=[];
 for(const movement of movements){
  let ruleId=explicit?.find(row=>row.movementId===movement.id)?.ruleId;
  if(sourceCommand.action==='SKU_CONVERSION_REVERSE'){
   const original=await tx.wmsMovement.findFirst({where:{...identity,commandId:sourceCommand.aggregateId,balanceId:movement.balanceId,deltaOnHand:-movement.deltaOnHand},include:{costEntry:true}});
   const cost=original?.costEntry;
   if(!cost){missingData.push({movementId:movement.id,lotId:movement.balance.lotId,reason:'ORIGINAL_VALUATION_REQUIRED'});continue;}
   if(ruleId&&ruleId!==cost.ruleId)throw new WmsError('冲销必须使用原流水成本规则。',422);
   entries.push({movementId:movement.id,ruleId:cost.ruleId,quantity:movement.deltaOnHand,unitCost:cost.unitCost.toFixed(6),amount:cost.amount.toFixed(6),currency:cost.currency,debitAccount:cost.creditAccount,creditAccount:cost.debitAccount});continue;
  }
  if(movement.action==='TRANSFER_ORDER_SHIP'||movement.action==='TRANSFER_ORDER_RECEIVE'){
   // Freeze a transfer line's valuation to its first dispatch, so transit clears
   // at the same cost even when a newer lot rule is activated during transport.
   const first=await tx.wmsMovement.findFirst({where:{...identity,sourceId:movement.sourceId,sourceLineId:movement.sourceLineId,action:'TRANSFER_ORDER_SHIP'},orderBy:[{occurredAt:'asc'},{id:'asc'}],include:{costEntry:true}});
   if(first&&first.id!==movement.id){
    if(!first.costEntry){missingData.push({movementId:movement.id,lotId:movement.balance.lotId,reason:'FIRST_DISPATCH_VALUATION_REQUIRED'});continue;}
    if(ruleId&&ruleId!==first.costEntry.ruleId)throw new WmsError('调拨须沿用首次发出成本规则以结清在途。',422);
    ruleId=first.costEntry.ruleId;
   }
  }
  const rule=await tx.wmsCostRule.findFirst({where:{...identity,lotId:movement.balance.lotId,status:'ACTIVE',...(ruleId?{id:ruleId}:{activatedAt:{lte:movement.occurredAt}})},orderBy:[{activatedAt:'desc'},{id:'desc'}]});
  const offset=rule?(rule.offsetAccounts as Record<string,string>)[movement.action]:undefined;
  if(!rule||!offset){missingData.push({movementId:movement.id,lotId:movement.balance.lotId,reason:!rule?'MISSING_APPROVED_COST_RULE':'MISSING_OFFSET_ACCOUNT'});continue;}
  entries.push({movementId:movement.id,ruleId:rule.id,quantity:movement.deltaOnHand,unitCost:rule.unitCost.toFixed(6),amount:valueQuantity(rule.unitCost.toFixed(6),movement.deltaOnHand),currency:rule.currency,debitAccount:movement.deltaOnHand>0?rule.inventoryAccount:offset,creditAccount:movement.deltaOnHand>0?offset:rule.inventoryAccount});
 }
 if(explicit&&missingData.length)throw new WmsError('明确指定的成本规则未生效、批次不匹配或缺少科目。',422);
 return {entries,missingData,movements};
}
async function persistEntries(tx:Tx,scope:Pick<WmsScope,'organizationId'|'workspaceId'>,draftId:string,entries:ValuedEntry[]){
 if(entries.length)await tx.wmsCostEntry.createMany({data:entries.map(entry=>({...scope,...entry,draftId,id:crypto.randomUUID()}))});
}
export async function consumeInventoryValuation(tx:Tx,event:WmsDomainEvent){
 const scope={organizationId:event.organizationId,workspaceId:event.workspaceId};
 const command=await tx.wmsCommand.findFirstOrThrow({where:{...scope,id:event.commandId}});
 if(!isDeepStrictEqual(event.payload,await commandEventPayload(tx,command)))throw new Error('WMS_VALUATION_EVIDENCE_MISMATCH');
 await lockKey(tx,JSON.stringify(['wms-valuation',scope,event.commandId]));
 if(await tx.wmsFinanceDraft.findFirst({where:{...scope,commandId:event.commandId}}))return;
 const result=await calculateValuation(tx,scope,event.commandId);if(!result.movements.length)return;
 const ready=result.missingData.length===0;
 const draft=await tx.wmsFinanceDraft.create({data:{...scope,id:crypto.randomUUID(),commandId:event.commandId,status:ready?'DRAFT':'NEEDS_DATA',voucher:ready?json(valuationVoucher(result.entries)):{},missingData:json(ready?[]:result.movements.map(movement=>({movementId:movement.id,lotId:movement.balance.lotId,reason:result.missingData.find(row=>row.movementId===movement.id)?.reason??'RECONFIRM_COMPLETE_COMMAND_COST'}))),...(ready?{valuedAt:new Date()}: {})}});
 if(ready)await persistEntries(tx,scope,draft.id,result.entries);
}
export async function executeValuationAction(tx:Tx,scope:WmsScope,input:WmsCommandInput){
 const validated=await validateValuationAction(tx,scope,input);
 if(input.payload.action==='ACTIVATE_COST_RULE'&&validated.rule){
  // Serialize effective versions for this lot; time is assigned only after approval.
  await lockKey(tx,JSON.stringify(['wms-cost-rule',scoped(scope),validated.rule.lotId]));
  const rule=await tx.wmsCostRule.update({where:{id:validated.rule.id},data:{status:'ACTIVE',activatedAt:new Date(),revision:{increment:1}}});return {revision:rule.revision,valuation:{ruleId:rule.id,status:rule.status,reference:input.payload.reason}};
 }
 if(input.payload.action!=='VALUE_COMMAND'||!validated.draft)throw new WmsError('非计价动作。',400);
 const {entries}=await calculateValuation(tx,scoped(scope),validated.draft.commandId,input.payload.rules);
 await persistEntries(tx,scoped(scope),validated.draft.id,entries);
 const draft=await tx.wmsFinanceDraft.update({where:{id:validated.draft.id},data:{status:'DRAFT',revision:{increment:1},voucher:json({...valuationVoucher(entries),basis:'EXPLICIT_APPROVED_REVALUATION',reference:input.payload.reason}),missingData:[],valuedBy:scope.actorUserId,valuedAt:new Date()}});
 return {revision:draft.revision,valuation:{draftId:draft.id,status:draft.status,postingExecuted:false}};
}
