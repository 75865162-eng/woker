import {prisma} from '@/lib/db/prisma';
import {authorizeFbaAccount} from './account-access';
import type {FbaLocalPlan} from '@prisma/client';
import type {Tx} from '@/lib/wms/repository';
import {authorizeWms,scoped,json} from '@/lib/wms/access';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import {requireText,strictKeys} from '@/lib/wms/rules';
import {closeDigest} from '@/lib/finance/close-rules';
import {object} from './rules';
export const workflowOptionKinds=['PACKING','PLACEMENT','TRANSPORTATION','DELIVERY_WINDOW'] as const;
/** Source response evidence, not a verified current API schema or remote confirmation. */
export function parseWorkflowOptionSnapshot(raw:unknown){
 const body=object(raw);strictKeys(body,['idempotencyKey','kind','externalPlanId','operationId','capturedAt','expiresAt','evidence','options']);
 if(!workflowOptionKinds.includes(body.kind as typeof workflowOptionKinds[number]))throw new WmsError('外部方案类型无效。',400);
 const capturedAt=requireText(body.capturedAt,'外部观察时间'),expiresAt=requireText(body.expiresAt,'目标端有效期');
 if(!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(capturedAt)||!Number.isFinite(Date.parse(capturedAt))||!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(expiresAt)||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.parse(capturedAt)||Date.parse(capturedAt)>Date.now()+60000)throw new WmsError('方案时间须为明确时区的有效观察及到期时间。',400);
 if(!Array.isArray(body.options)||!body.options.length||body.options.length>100)throw new WmsError('方案证据须有 1–100 项。',400);
 const keys=new Set<string>(),options=body.options.map(raw=>{const option=object(raw);strictKeys(option,['optionId','payload']);const optionId=requireText(option.optionId,'亚马逊返回的方案 ID',200);if(keys.has(optionId))throw new WmsError('方案 ID 重复。',400);keys.add(optionId);const payload=object(option.payload);return {optionId,payload};});
 if(Buffer.byteLength(JSON.stringify(options))>50000)throw new WmsError('单次方案证据最多 50KB。',413);
 return {idempotencyKey:requireText(body.idempotencyKey,'幂等键'),kind:body.kind as typeof workflowOptionKinds[number],externalPlanId:requireText(body.externalPlanId,'外部计划 ID',200),operationId:requireText(body.operationId,'来源 Operation ID',200),capturedAt:new Date(capturedAt),expiresAt:new Date(expiresAt),evidence:requireText(body.evidence,'来源依据',2000),options};
}
export async function writeWorkflowOptions(tx:Tx,scope:WmsScope,plan:FbaLocalPlan,action:string,raw:unknown,revision:number){
 if(action==='CAPTURE_WORKFLOW_OPTIONS'){
  const input=parseWorkflowOptionSnapshot(raw),sourceHash=closeDigest(input),prior=await tx.fbaWorkflowOptionSnapshot.findFirst({where:{...scoped(scope),planId:plan.id,idempotencyKey:input.idempotencyKey}});
  if(prior){if(prior.createdBy!==scope.actorUserId||prior.sourceHash!==sourceHash)throw new WmsError('方案来源幂等键冲突。',409);return {snapshotId:prior.id,reused:true,remoteExecutionEnabled:false};}
  if(plan.status==='CANCELLED'||plan.revision!==revision)throw new WmsError('计划已取消或版本变化。',409);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['fba-external-plan',scope.organizationId,scope.workspaceId,input.externalPlanId])},0))`;
  if(await tx.fbaWorkflowOptionSnapshot.count({where:{...scoped(scope),externalPlanId:input.externalPlanId,planId:{not:plan.id}}}))throw new WmsError('外部计划已关联其他本地计划。',409);
  if(await tx.fbaWorkflowOptionSnapshot.count({where:{...scoped(scope),planId:plan.id}})>=10)throw new WmsError('每计划最多保存 10 份方案证据。',422);
  if(await tx.fbaWorkflowOptionSnapshot.count({where:{...scoped(scope),planId:plan.id,externalPlanId:{not:input.externalPlanId}}}))throw new WmsError('同一本地计划不能混用外部计划 ID。',409);
  if(await tx.fbaExternalOperationRecord.count({where:{...scoped(scope),planId:plan.id,step:'PLAN',status:'REVIEWED_SUCCEEDED',entityId:{not:input.externalPlanId}}}))throw new WmsError('方案外部计划与已核实的计划 ID 不符。',409);
  const snapshot=await tx.fbaWorkflowOptionSnapshot.create({data:{id:crypto.randomUUID(),...scoped(scope),...input,options:json(input.options),planId:plan.id,sourceHash,createdBy:scope.actorUserId}});
  await tx.fbaLocalPlan.update({where:{id:plan.id},data:{revision:{increment:1}}});
  await audit(tx,scope,plan.id,snapshot.id,action,sourceHash);return {snapshotId:snapshot.id,reused:false,remoteExecutionEnabled:false};
 }
 await authorizeWms(tx,scope,'approve');const body=object(raw);strictKeys(body,['snapshotId','optionId','evidence']);const snapshotId=requireText(body.snapshotId,'方案快照 ID'),optionId=requireText(body.optionId,'方案 ID'),evidence=requireText(body.evidence,'独立选择依据',2000);
 const snapshot=await tx.fbaWorkflowOptionSnapshot.findFirst({where:{...scoped(scope),planId:plan.id,id:snapshotId},include:{selection:true}});
 if(!snapshot)throw new WmsError('方案快照不存在。',404);if(snapshot.createdBy===scope.actorUserId)throw new WmsError('方案采集人不能自行复核选择。',403);
 if(snapshot.selection){if(snapshot.selection.createdBy!==scope.actorUserId||snapshot.selection.optionId!==optionId||snapshot.selection.evidence!==evidence)throw new WmsError('方案选择证据不可覆盖。',409);return {selectionId:snapshot.selection.id,reused:true,remoteExecutionEnabled:false};}
 if(plan.status==='CANCELLED'||plan.revision!==revision||snapshot.expiresAt<=new Date())throw new WmsError('计划版本变化、已取消或方案过期。',409);
 if(!Array.isArray(snapshot.options)||!snapshot.options.some(row=>row&&typeof row==='object'&&!Array.isArray(row)&&row.optionId===optionId))throw new WmsError('只能选择此快照中亚马逊返回的方案 ID。',422);
 const newer=await tx.fbaWorkflowOptionSnapshot.count({where:{...scoped(scope),planId:plan.id,kind:snapshot.kind,OR:[{capturedAt:{gt:snapshot.capturedAt}},{capturedAt:snapshot.capturedAt,createdAt:{gt:snapshot.createdAt}}]}});if(newer)throw new WmsError('已有更新的同类方案证据，请重新选择。',409);
 const selection=await tx.fbaWorkflowOptionSelection.create({data:{id:crypto.randomUUID(),...scoped(scope),snapshotId,optionId,evidence,createdBy:scope.actorUserId}});
 await tx.fbaLocalPlan.update({where:{id:plan.id},data:{revision:{increment:1}}});await audit(tx,scope,plan.id,selection.id,action,snapshot.sourceHash);return {selectionId:selection.id,reused:false,remoteExecutionEnabled:false};
}
async function audit(tx:Tx,scope:WmsScope,planId:string,id:string,action:string,sourceHash:string){await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:`fba-local.${action.toLowerCase()}`,entityType:'FbaWorkflowOptionEvidence',entityId:id,metadata:{workspaceId:scope.workspaceId,planId,sourceHash,remoteExecutionEnabled:false,origin:'OPERATOR_SUPPLIED_EXTERNAL_EVIDENCE'}}});}

export async function readWorkflowOptionEvidence(scope:WmsScope,planId:string,snapshotId:string){
 return prisma.$transaction(async tx=>{
  await authorizeWms(tx,scope,'view');const plan=await tx.fbaLocalPlan.findFirst({where:{...scoped(scope),id:requireText(planId,'计划 ID')}});if(!plan)throw new WmsError('计划不存在。',404);
  await authorizeFbaAccount(tx,scope,plan.sellerAccountId,plan.marketplaceId);
  const snapshot=await tx.fbaWorkflowOptionSnapshot.findFirst({where:{...scoped(scope),planId:plan.id,id:requireText(snapshotId,'快照 ID')},include:{selection:true}});if(!snapshot)throw new WmsError('方案证据不存在。',404);
  return {snapshot,origin:'OPERATOR_SUPPLIED_EXTERNAL_EVIDENCE',remoteExecutionEnabled:false};
 });
}
