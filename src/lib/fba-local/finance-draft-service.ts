import {createHash} from 'node:crypto';
import type {FbaLocalPlan} from '@prisma/client';
import {authorizeWms,scoped,json} from '@/lib/wms/access';
import type {WmsScope} from '@/lib/wms/contracts';
import {WmsError} from '@/lib/wms/contracts';
import type {Tx} from '@/lib/wms/repository';
import {requireText,strictKeys} from '@/lib/wms/rules';
import {object} from './rules';
import {readLocalCost} from './cost-allocation';
import {parseFinanceDraftInput,calculateFinanceDraft} from './finance-draft-rules';
export async function writeFinanceDraft(tx:Tx,scope:WmsScope,plan:FbaLocalPlan&{lines:{id:string;quantity:number}[]},action:string,raw:unknown,expectedRevision:number){
 const identity=scoped(scope);let id:string;
 if(action==='CREATE_FINANCE_DRAFT'){
  const input=parseFinanceDraftInput(raw);
  const adjustment=await tx.fbaLocalCostAdjustment.findFirst({where:{...identity,id:input.adjustmentId,bill:{fee:{planId:plan.id}}},include:{bill:{include:{fee:true}}}});
  if(!adjustment)throw new WmsError('差异单不属于当前计划。',404);
  const requestHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const prior=await tx.fbaLocalFinanceDraft.findFirst({where:{...identity,adjustmentId:adjustment.id,idempotencyKey:input.idempotencyKey}});
  if(prior){if(prior.requestHash!==requestHash||prior.createdBy!==scope.actorUserId)throw new WmsError('核算草稿幂等键冲突。',409);return {draftId:prior.id,revision:plan.revision,postingExecuted:false};}
  if(plan.status==='CANCELLED'||plan.revision!==expectedRevision)throw new WmsError('计划已取消或版本已变化。',409);
  if(await tx.fbaLocalFinanceDraft.count({where:{...identity,adjustmentId:adjustment.id}})>=20)throw new WmsError('每个差异单最多 20 份核算规则草稿。',422);
  id=crypto.randomUUID();
  const result=calculateFinanceDraft(identity,input,id,readLocalCost(adjustment.bill.fee.estimate,plan.lines),readLocalCost(adjustment.bill.actual,plan.lines));
  await tx.fbaLocalFinanceDraft.create({data:{...identity,id,adjustmentId:adjustment.id,idempotencyKey:input.idempotencyKey,requestHash,ruleInput:json(input),voucher:json(result.voucher),summary:json(result.summary),createdBy:scope.actorUserId}});
 }else{
  const input=object(raw);strictKeys(input,['draftId']);id=requireText(input.draftId,'核算草稿 ID');
  await authorizeWms(tx,scope,'approve');
  const draft=await tx.fbaLocalFinanceDraft.findFirst({where:{...identity,id,adjustment:{bill:{fee:{planId:plan.id}}}}});
  if(!draft)throw new WmsError('核算草稿不属于当前计划。',404);
  if(draft.createdBy===scope.actorUserId)throw new WmsError('核算规则须由另一名有审批权限的人员复核。',403);
  if(draft.status==='RULES_REVIEWED'){if(draft.reviewedBy!==scope.actorUserId)throw new WmsError('核算规则已由其他人员复核。',409);return {draftId:id,revision:plan.revision,postingExecuted:false};}
  if(plan.revision!==expectedRevision)throw new WmsError('计划版本已变化。',409);
  await tx.fbaLocalFinanceDraft.update({where:{id},data:{status:'RULES_REVIEWED',reviewedBy:scope.actorUserId,reviewedAt:new Date()}});
 }
 const updated=await tx.fbaLocalPlan.update({where:{id:plan.id},data:{revision:{increment:1}}});
 await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,entityType:'FbaLocalPlan',entityId:plan.id,action:`fba-local.finance.${action.toLowerCase()}`,metadata:{workspaceId:scope.workspaceId,draftId:id,revision:updated.revision,postingExecuted:false}}});
 return {draftId:id,revision:updated.revision,postingExecuted:false};
}
