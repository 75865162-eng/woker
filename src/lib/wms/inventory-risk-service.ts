import {prisma} from '@/lib/db/prisma';
import {authorizeWms,scoped,json,auditWms} from './access';
import {lockKey,type Tx} from './repository';
import {WmsError,type WmsScope} from './contracts';
import {requireText,requireRevision,strictKeys} from './rules';
import {closeDigest} from '@/lib/finance/close-rules';
import {assessInventoryRisk,parseInventoryRiskPolicy,parseInventoryRiskEvidence,type InventoryRiskStock} from './inventory-risk-rules';
export async function queryInventoryRisk(scope:WmsScope,params:URLSearchParams){return prisma.$transaction(async tx=>{await authorizeWms(tx,scope,'view');const snapshotId=params.get('snapshotId'),id=params.get('id');return {items:await tx.wmsInventoryRiskAssessment.findMany({where:{...scoped(scope),...(snapshotId?{snapshotId}:{}),...(id?{id}:{})},orderBy:[{createdAt:'desc'},{id:'asc'}],take:30}),limit:30};});}
export async function mutateInventoryRisk(scope:WmsScope,body:Record<string,unknown>){
 const action=requireText(body.action,'库存风险动作');if(!['create','review'].includes(action))throw new WmsError('库存风险动作无效。',400);
 strictKeys(body,action==='create'?['action','snapshotId','idempotencyKey','policy','evidence']:['action','id','revision','approve','decisionEvidence']);
 return prisma.$transaction(async tx=>{
  await authorizeWms(tx,scope,action==='create'?'create':'approve');
  if(action==='create'){
   const snapshotId=requireText(body.snapshotId,'库龄快照 ID'),idempotencyKey=requireText(body.idempotencyKey,'幂等键'),policy=parseInventoryRiskPolicy(body.policy),evidence=parseInventoryRiskEvidence(body.evidence),requestHash=closeDigest({snapshotId,policy,evidence});
   await lockKey(tx,JSON.stringify(['inventory-risk',scoped(scope),idempotencyKey]));const prior=await tx.wmsInventoryRiskAssessment.findFirst({where:{...scoped(scope),idempotencyKey}});if(prior){if(prior.createdBy!==scope.actorUserId||prior.requestHash!==requestHash)throw new WmsError('库存风险评估幂等键冲突。',409);return {item:prior,reused:true};}
   const snapshot=await tx.wmsAgingSnapshot.findFirst({where:{...scoped(scope),id:snapshotId}});if(!snapshot)throw new WmsError('库龄快照不存在。',404);if(!Array.isArray(snapshot.records)||snapshot.records.length>500)throw new WmsError('快照超过单次评估 500 个商品的边界，须采用专用评估任务。',422);
   const result=assessInventoryRisk(snapshot.records as unknown as InventoryRiskStock[],snapshot.snapshotDate.toISOString().slice(0,10),policy,evidence),item=await tx.wmsInventoryRiskAssessment.create({data:{id:crypto.randomUUID(),...scoped(scope),snapshotId,idempotencyKey,requestHash,policy:json(policy),evidence:json(evidence),result:json({...result,snapshotHash:snapshot.sourceHash}),createdBy:scope.actorUserId}});
   await auditWms(tx,scope,'inventory-risk.create',item.id,{snapshotId,requestHash,status:result.status,postingExecuted:false});return {item,reused:false};
  }
  const id=requireText(body.id,'库存风险评估 ID'),revision=requireRevision(body.revision),decisionEvidence=requireText(body.decisionEvidence,'评估复核依据',2000);if(typeof body.approve!=='boolean')throw new WmsError('须明确复核决定。',400);
  const identity=await tx.wmsInventoryRiskAssessment.findFirst({where:{...scoped(scope),id},select:{snapshotId:true}});if(!identity)throw new WmsError('库存风险评估不存在。',404);
  await lockKey(tx,JSON.stringify(['inventory-risk-review',scoped(scope),identity.snapshotId]));const item=await tx.wmsInventoryRiskAssessment.findFirst({where:{...scoped(scope),id}});if(!item)throw new WmsError('库存风险评估不存在。',404);if(item.createdBy===scope.actorUserId)throw new WmsError('库存风险评估禁止申请人自审。',403);
  const status=body.approve?'REVIEWED':'REJECTED';if(item.status!=='DRAFT'){if(item.status!==status||item.revision!==revision+1||item.reviewedBy!==scope.actorUserId||item.decisionEvidence!==decisionEvidence)throw new WmsError('复核结果不可覆盖。',409);return {item,reused:true};}if(item.revision!==revision)throw new WmsError('评估版本已变化。',409);
  if(body.approve&&(!item.result||typeof item.result!=='object'||Array.isArray(item.result)||item.result.status!=='COMPLETE'))throw new WmsError('依据不完整的评估不能复核通过，请保留原证据并创建新评估。',422);
  if(body.approve&&await tx.wmsInventoryRiskAssessment.count({where:{...scoped(scope),snapshotId:item.snapshotId,status:'REVIEWED',id:{not:item.id}}}))throw new WmsError('该快照已有已复核评估，不得重复确认准备。',409);
  const updated=await tx.wmsInventoryRiskAssessment.update({where:{id},data:{status,revision:{increment:1},reviewedBy:scope.actorUserId,reviewedAt:new Date(),decisionEvidence}});await auditWms(tx,scope,'inventory-risk.review',id,{status,revision:updated.revision,postingExecuted:false});return {item:updated,reused:false};
 });
}
export async function readWmsInventoryRiskSource(tx:Tx,scope:WmsScope,id:string){
 await authorizeWms(tx,scope,'view');const row=await tx.wmsInventoryRiskAssessment.findFirst({where:{...scoped(scope),id}});if(!row||row.status!=='REVIEWED'||!row.reviewedBy)throw new WmsError('库存风险评估尚未独立复核。',409);await authorizeWms(tx,scope,'view',{userId:row.reviewedBy,action:'approve'});
 const result=row.result as unknown as {status:string;currency:string;snapshotDate:string;provisionDelta:string;voucher:{lines:{account:string;debit:string;credit:string}[]}|null};if(result.status!=='COMPLETE'||!result.voucher?.lines.length)throw new WmsError('评估没有可交接的非零准备调整。',422);
 return {kind:'WMS_INVENTORY_RISK' as const,id,sourceKey:`WMS-INVENTORY-RISK:${row.snapshotId}`,currency:result.currency,sourceDate:result.snapshotDate,lines:result.voucher.lines,evidence:{snapshotId:row.snapshotId,requestHash:row.requestHash,policy:row.policy,reviewedBy:row.reviewedBy,provisionDelta:result.provisionDelta}};
}
