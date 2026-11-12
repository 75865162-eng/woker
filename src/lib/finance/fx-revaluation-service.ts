import {prisma} from '@/lib/db/prisma';
import {scoped,json} from '@/lib/wms/access';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import type {Tx} from '@/lib/wms/repository';
import {requireText,strictKeys} from '@/lib/wms/rules';
import {assertAmazonAction} from '@/lib/amazon-sync/data-access';
import {assertFinanceReviewer} from './access';
import {closeDigest} from './close-rules';
import {parseFxRuleSnapshot} from './fx-rules';
import {parseFxRevaluationItems,calculateFxRevaluation} from './fx-revaluation-rules';
import {amountUnits} from './open-item-rules';
import type {FinanceSource} from './source-rules';
async function validatedCalculation(tx:Tx,scope:WmsScope,bookId:string,periodId:string,rateId:string,rawItems:unknown){
 const where={...scoped(scope),bookId},period=await tx.financePeriod.findFirst({where:{...where,id:periodId,status:'OPEN'},include:{book:true}});if(!period||!period.book.enabled)throw new WmsError('汇兑重估须属于启用账套的开放期间。',409);
 const rate=await tx.financeExchangeRate.findFirst({where:{...where,id:rateId,status:'ACTIVE',targetCurrency:period.book.currency}});if(!rate||!rate.reviewedBy)throw new WmsError('须选择本账套已独立复核、转为本位币的汇率。',422);await assertFinanceReviewer(tx,scope,rate.reviewedBy);
 if(rate.observedAt>new Date(period.end.getTime()+86400000-1))throw new WmsError('目标汇率时点晚于重估期间。',422);
 const fx=parseFxRuleSnapshot({sourceCurrency:rate.sourceCurrency,targetCurrency:rate.targetCurrency,rate:rate.rate.toFixed(12),observedAt:rate.observedAt.toISOString(),reference:rate.reference,evidence:rate.evidence}),items=parseFxRevaluationItems(rawItems),used=new Set<string>();
 const allSubjects=[...new Set(items.flatMap(row=>[row.monetarySubjectId,row.gainSubjectId,row.lossSubjectId]))];if(await tx.financeSubject.count({where:{...where,id:{in:allSubjects},enabled:true,leaf:true}})!==allSubjects.length)throw new WmsError('重估须使用本账套启用的末级科目。',422);
 for(const item of items){
  if(item.sourceVoucherLineIds.some(id=>used.has(id)))throw new WmsError('不同货币项目不能重复占用同一账面分录。',422);item.sourceVoucherLineIds.forEach(id=>used.add(id));
  const lines=await tx.financeVoucherLine.findMany({where:{...where,id:{in:item.sourceVoucherLineIds},subjectId:item.monetarySubjectId,voucher:{status:'POSTED',date:{lte:period.end}}}});if(lines.length!==item.sourceVoucherLineIds.length)throw new WmsError('账面依据须为截至本期末同科目已过账分录。',422);
  const signed=lines.reduce((sum,row)=>sum+amountUnits(row.debit.toFixed(6))-amountUnits(row.credit.toFixed(6)),BigInt(0)),balance=item.balanceSide==='DEBIT'?signed:-signed;
  if(balance<BigInt(0)||(item.carryingBase!==null&&balance!==amountUnits(item.carryingBase)))throw new WmsError('原本位币账面余额与所选已过账分录净额不符。',422);
 }
 return {period,rate,items,fx,calculation:calculateFxRevaluation(items,fx)};
}
export async function queryFxRevaluations(scope:WmsScope,params:URLSearchParams){const bookId=requireText(params.get('bookId'),'账套 ID');return prisma.$transaction(async tx=>{await assertAmazonAction(scoped(scope),scope.actorUserId,'view',tx);return {revaluations:await tx.financeFxRevaluation.findMany({where:{...scoped(scope),bookId,...(params.get('periodId')?{periodId:params.get('periodId')!}:{})},orderBy:[{createdAt:'desc'},{id:'asc'}],take:50}),limit:50};});}
export async function mutateFxRevaluation(scope:WmsScope,body:Record<string,unknown>){
 const action=requireText(body.action,'重估动作'),bookId=requireText(body.bookId,'账套 ID');if(!['create-revaluation','review-revaluation','cancel-revaluation'].includes(action))throw new WmsError('重估动作无效。',400);strictKeys(body,action==='create-revaluation'?['action','bookId','periodId','rateId','policyReference','evidence','idempotencyKey','items']:['action','bookId','revaluationId','evidence']);
 return prisma.$transaction(async tx=>{
  await assertAmazonAction(scoped(scope),scope.actorUserId,action==='review-revaluation'?'approve':'create',tx);await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${bookId} FOR UPDATE`;
  if(action==='create-revaluation'){
   const periodId=requireText(body.periodId,'期间 ID'),rateId=requireText(body.rateId,'汇率 ID'),policyReference=requireText(body.policyReference,'目标重估政策',1000),evidence=requireText(body.evidence,'外币货币项目完整性与核对依据',1000),idempotencyKey=requireText(body.idempotencyKey,'幂等键');
   const input={periodId,rateId,policyReference,evidence,items:parseFxRevaluationItems(body.items)},requestHash=closeDigest(input),prior=await tx.financeFxRevaluation.findFirst({where:{...scoped(scope),bookId,idempotencyKey}});if(prior){if(prior.createdBy!==scope.actorUserId||prior.requestHash!==requestHash)throw new WmsError('汇兑重估幂等键冲突。',409);return {revaluation:prior,reused:true};}
   const checked=await validatedCalculation(tx,scope,bookId,periodId,rateId,input.items);const revaluation=await tx.financeFxRevaluation.create({data:{id:crypto.randomUUID(),...scoped(scope),bookId,periodId,rateId,sourceCurrency:checked.rate.sourceCurrency,policyReference,evidence,idempotencyKey,requestHash,items:json(checked.items),calculation:json({fx:checked.fx,...checked.calculation}),status:checked.calculation.status,createdBy:scope.actorUserId}});await audit(tx,scope,revaluation.id,'create',bookId);return {revaluation,reused:false};
  }
  if(action==='cancel-revaluation'){
   const id=requireText(body.revaluationId,'重估单 ID'),evidence=requireText(body.evidence,'作废原因',1000),row=await tx.financeFxRevaluation.findFirst({where:{...scoped(scope),bookId,id}});if(!row)throw new WmsError('重估单不存在。',404);if(row.createdBy!==scope.actorUserId)throw new WmsError('仅原制单人可作废未复核重估。',403);
   if(row.status==='CANCELLED'){if(row.reviewedBy!==scope.actorUserId||row.reviewEvidence!==evidence)throw new WmsError('作废依据不可覆盖。',409);return {revaluation:row,reused:true};}if(!['DRAFT','NEEDS_DATA'].includes(row.status))throw new WmsError('已复核重估不能作废。',409);
   const revaluation=await tx.financeFxRevaluation.update({where:{id},data:{status:'CANCELLED',reviewedBy:scope.actorUserId,reviewedAt:new Date(),reviewEvidence:evidence}});await audit(tx,scope,id,'cancel',bookId,evidence);return {revaluation,reused:false};
  }
  await assertFinanceReviewer(tx,scope,scope.actorUserId);const id=requireText(body.revaluationId,'重估单 ID'),evidence=requireText(body.evidence,'独立复核依据',1000),row=await tx.financeFxRevaluation.findFirst({where:{...scoped(scope),bookId,id}});if(!row)throw new WmsError('重估单不存在。',404);if(row.createdBy===scope.actorUserId)throw new WmsError('重估制单人不能自审。',403);if(row.status==='REVIEWED'){if(row.reviewedBy!==scope.actorUserId||row.reviewEvidence!==evidence)throw new WmsError('独立复核依据不可覆盖。',409);return {revaluation:row,reused:true};}if(row.status!=='DRAFT')throw new WmsError('缺少外币余额或本位币账面证据，不能复核。',409);
  const checked=await validatedCalculation(tx,scope,bookId,row.periodId,row.rateId,row.items);if(closeDigest({fx:checked.fx,...checked.calculation})!==closeDigest(row.calculation))throw new WmsError('重估依据已变化，请重新制单。',409);
  if(await tx.financeFxRevaluation.count({where:{...scoped(scope),bookId,periodId:row.periodId,sourceCurrency:row.sourceCurrency,status:'REVIEWED'}}))throw new WmsError('同期间同原币已有复核重估，须走正式更正，不能重复评估入账。',409);
  const updated=await tx.financeFxRevaluation.update({where:{id},data:{status:'REVIEWED',reviewedBy:scope.actorUserId,reviewedAt:new Date(),reviewEvidence:evidence}});await audit(tx,scope,id,'review',bookId,evidence);return {revaluation:updated,reused:false};
 });
}
async function audit(tx:Tx,scope:WmsScope,id:string,action:string,bookId:string,evidence?:string){await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:`finance.fx-revaluation.${action}`,entityType:'FinanceFxRevaluation',entityId:id,metadata:{workspaceId:scope.workspaceId,bookId,...(evidence?{evidence}:{}),postingExecuted:false}}});}
export async function readFxRevaluationSource(tx:Tx,scope:WmsScope,id:string):Promise<FinanceSource>{
 await assertAmazonAction(scoped(scope),scope.actorUserId,'view',tx);const row=await tx.financeFxRevaluation.findFirst({where:{...scoped(scope),id}});if(!row||row.status!=='REVIEWED'||!row.reviewedBy)throw new WmsError('仅已独立复核的汇兑重估可转入总账。',409);await assertFinanceReviewer(tx,scope,row.reviewedBy);const checked=await validatedCalculation(tx,scope,row.bookId,row.periodId,row.rateId,row.items);if(closeDigest({fx:checked.fx,...checked.calculation})!==closeDigest(row.calculation))throw new WmsError('已复核重估依据已变化。',409);if(!checked.calculation.lines.length)throw new WmsError('本次重估无差额，无需生成凭证。',422);
 return {kind:'FX_REVALUATION',id,sourceKey:`FX-REVALUATION:${row.periodId}:${row.sourceCurrency}`,currency:checked.period.book.currency,sourceDate:checked.period.end.toISOString().slice(0,10),lines:checked.calculation.lines,evidence:{bookId:row.bookId,periodId:row.periodId,revaluationId:id,policyReference:row.policyReference,requestHash:row.requestHash,rateId:row.rateId,reviewedBy:row.reviewedBy,reviewedAt:row.reviewedAt?.toISOString()}};
}
