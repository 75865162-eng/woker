import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { scoped, authorizeWms } from './access';
import { lockKey, type Tx } from './repository';
import { WmsError, type WmsScope } from './contracts';
import { requireText, requireRevision, strictKeys } from './rules';
import { validFinanceDate, amountUnits, unitsAmount } from '@/lib/finance/open-item-rules';
import type { FinanceSource } from '@/lib/finance/source-rules';

export function parseCostDelta(value: unknown) {
  if(typeof value!=='string')throw new WmsError('成本调整额须为有符号十进制字符串。',400);
  const negative=value.startsWith('-'), units=amountUnits(negative?value.slice(1):value);
  if(units===BigInt(0))throw new WmsError('成本调整额不能为零。',400);
  return unitsAmount(negative?-units:units);
}
export async function queryCostAdjustments(scope: WmsScope, params: URLSearchParams) {
  const costEntryId=requireText(params.get('costEntryId'),'原成本流水 ID');
  return prisma.$transaction(async tx=>{
    await authorizeWms(tx,scope,'view');
    const entry=await tx.wmsCostEntry.findFirst({where:{...scoped(scope),id:costEntryId}});
    if(!entry)throw new WmsError('成本流水不存在。',404);
    const rows=await tx.wmsCostAdjustment.findMany({where:{...scoped(scope),costEntryId},orderBy:[{createdAt:'asc'},{id:'asc'}],take:201});
    return {entry:{...entry,unitCost:entry.unitCost.toFixed(6),amount:entry.amount.toFixed(6)},items:rows.slice(0,200).map(row=>({...row,delta:row.delta.toFixed(6)})),hasMore:rows.length>200};
  });
}
export async function mutateCostAdjustment(scope: WmsScope, body: Record<string,unknown>) {
  const action=requireText(body.action,'成本调整动作');
  if(action!=='create'&&action!=='review')throw new WmsError('成本调整动作无效。',400);
  strictKeys(body,action==='create'?['action','costEntryId','delta','date','policyReference','evidence','idempotencyKey']:['action','id','revision','approve','evidence']);
  return prisma.$transaction(async tx=>{
    await authorizeWms(tx,scope,action==='create'?'create':'approve');
    if(action==='create'){
      const costEntryId=requireText(body.costEntryId,'原成本流水 ID'),delta=parseCostDelta(body.delta),date=validFinanceDate(body.date),policyReference=requireText(body.policyReference,'目标端成本政策依据',1000),evidence=requireText(body.evidence,'调整依据',2000),idempotencyKey=requireText(body.idempotencyKey,'幂等键');
      const requestHash=createHash('sha256').update(JSON.stringify({costEntryId,delta,date,policyReference,evidence})).digest('hex');
      await lockKey(tx,JSON.stringify(['wms-cost-adjustment',scoped(scope),idempotencyKey]));
      const prior=await tx.wmsCostAdjustment.findFirst({where:{...scoped(scope),idempotencyKey}});
      if(prior){if(prior.createdBy!==scope.actorUserId||prior.requestHash!==requestHash)throw new WmsError('成本调整幂等键冲突。',409);return {item:{...prior,delta:prior.delta.toFixed(6)},reused:true};}
      const entry=await tx.wmsCostEntry.findFirst({where:{...scoped(scope),id:costEntryId},include:{movement:true}});
      if(!entry)throw new WmsError('成本流水不存在。',404);
      if(date<entry.movement.occurredAt.toISOString().slice(0,10))throw new WmsError('调整日期不得早于原实物流日期。',422);
      const item=await tx.wmsCostAdjustment.create({data:{id:crypto.randomUUID(),...scoped(scope),costEntryId,delta,date:new Date(date),policyReference,evidence,idempotencyKey,requestHash,createdBy:scope.actorUserId}});
      await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'wms.cost-adjustment.create',entityType:'WmsCostAdjustment',entityId:item.id,metadata:{workspaceId:scope.workspaceId,costEntryId,delta,policyReference}}});
      return {item:{...item,delta:item.delta.toFixed(6)},reused:false};
    }
    const id=requireText(body.id,'调整 ID'),revision=requireRevision(body.revision),evidence=requireText(body.evidence,'复核依据',2000);
    if(typeof body.approve!=='boolean')throw new WmsError('须明确复核决定。',400);
    const identity=await tx.wmsCostAdjustment.findFirst({where:{...scoped(scope),id},select:{costEntryId:true}});
    if(!identity)throw new WmsError('成本调整不存在。',404);
    await lockKey(tx,JSON.stringify(['wms-cost-entry-adjustment',scoped(scope),identity.costEntryId]));
    const row=await tx.wmsCostAdjustment.findFirstOrThrow({where:{...scoped(scope),id},include:{entry:true}});
    if(row.createdBy===scope.actorUserId)throw new WmsError('成本调整禁止申请人自审。',403);
    const status=body.approve?'REVIEWED':'REJECTED';
    if(row.status!=='DRAFT'){
      if(row.status!==status||row.reviewedBy!==scope.actorUserId||row.decisionEvidence!==evidence||row.revision!==revision+1)throw new WmsError('成本调整复核不可覆盖。',409);
      return {item:{...row,delta:row.delta.toFixed(6)},reused:true};
    }
    if(row.revision!==revision)throw new WmsError('成本调整版本已变化。',409);
    if(body.approve){
      const total=await tx.wmsCostAdjustment.aggregate({where:{...scoped(scope),costEntryId:row.costEntryId,status:'REVIEWED'},_sum:{delta:true}});
      if(row.entry.amount.plus(total._sum.delta??0).plus(row.delta).lt(0))throw new WmsError('累计调整不能使原成本流水金额为负。',422);
    }
    const item=await tx.wmsCostAdjustment.update({where:{id},data:{status,revision:{increment:1},reviewedBy:scope.actorUserId,reviewedAt:new Date(),decisionEvidence:evidence}});
    await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'wms.cost-adjustment.review',entityType:'WmsCostAdjustment',entityId:id,metadata:{workspaceId:scope.workspaceId,status,revision:item.revision}}});
    return {item:{...item,delta:item.delta.toFixed(6)},reused:false};
  });
}
export async function readWmsCostAdjustmentSource(tx: Tx, scope: WmsScope, id: string): Promise<FinanceSource> {
  await authorizeWms(tx,scope,'view');
  const row=await tx.wmsCostAdjustment.findFirst({where:{...scoped(scope),id},include:{entry:true}});
  if(!row||row.status!=='REVIEWED'||!row.reviewedBy)throw new WmsError('成本调整尚未独立复核。',409);
  await authorizeWms(tx,scope,'view',{userId:row.reviewedBy,action:'approve'});
  const amount=row.delta.abs().toFixed(6),debit=row.delta.gt(0)?row.entry.debitAccount:row.entry.creditAccount,credit=row.delta.gt(0)?row.entry.creditAccount:row.entry.debitAccount;
  return {kind:'WMS_COST_ADJUSTMENT',id,sourceKey:`WMS-COST-ADJUSTMENT:${id}`,currency:row.entry.currency,sourceDate:row.date.toISOString().slice(0,10),lines:[{account:debit,debit:amount,credit:'0.000000'},{account:credit,debit:'0.000000',credit:amount}],evidence:{costEntryId:row.costEntryId,movementId:row.entry.movementId,revision:row.revision,delta:row.delta.toFixed(6),policyReference:row.policyReference,reviewedBy:row.reviewedBy}};
}
