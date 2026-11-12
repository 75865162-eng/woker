import {assertFinanceAction} from './access';
import {Prisma} from '@prisma/client';
import {prisma} from '@/lib/db/prisma';
import {readFinance} from '@/lib/amazon-sync/finance-query';
import {queryPublishedAdsReports} from '@/lib/amazon-ads/report-query';
import {amazonAccountReadAccess} from '@/lib/amazon-sync/read-account';
import {amazonAdsAccountReadAccess} from '@/lib/amazon-ads/read-access';
import {assertAmazonAction} from '@/lib/amazon-sync/data-access';
import {scoped,json} from '@/lib/wms/access';
import {lockKey} from '@/lib/wms/repository';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import {requireText,strictKeys} from '@/lib/wms/rules';
import {createLedgerVoucher} from './ledger-service';
import {closeDigest} from './close-rules';
import {parseExternalSelector,amazonFinanceEvidence,adsSpendEvidence,externalDraftLines,type ExternalSelector} from './external-source-rules';

/** Always call the existing shared query services; never read external fact tables here. */
async function readSource(scope:WmsScope,selector:ExternalSelector){
 if(selector.kind==='AMAZON_FINANCE'){
  const result=await readFinance(scoped(scope),new URLSearchParams({sellerAccountId:selector.sellerAccountId,marketplaceId:selector.marketplaceId,transactionId:selector.transactionId,page:'1',pageSize:'2'}),scope.actorUserId);
  return amazonFinanceEvidence(selector,result.rows);
 }
 const result=await queryPublishedAdsReports(scoped(scope),scope.actorUserId,{kind:'reports',sellerAccountId:selector.sellerAccountId,marketplaceId:selector.marketplaceId,profileRecordId:selector.profileRecordId,reportType:selector.reportType,adProduct:selector.adProduct,from:selector.date,to:selector.date,page:1,pageSize:100,sortBy:'reportDate',sortDirection:'asc'});
 return adsSpendEvidence(selector,result.rows,result.total,result.pagination.hasMore);
}
export async function previewExternalFinanceSource(scope:WmsScope,raw:unknown){
 await assertAmazonAction(scoped(scope),scope.actorUserId,'view');const selector=parseExternalSelector(raw),source=await readSource(scope,selector);
 return {selector,source,postingExecuted:false,warnings:['广告日报仅作为目标端显式采用的暂估依据；报告修订、广告发票和平台交易不得重复确认为费用。','每次转入重新读取来源；缺少金额、币种或完整单页事实时保持阻断。']};
}
export async function queryExternalFinanceClaims(scope:WmsScope,params:URLSearchParams){
 const bookId=requireText(params.get('bookId'),'账套 ID');
 return prisma.$transaction(async tx=>{await assertAmazonAction(scoped(scope),scope.actorUserId,'view',tx);return {claims:await tx.financeExternalSourceClaim.findMany({where:{...scoped(scope),bookId},select:{id:true,kind:true,economicKey:true,sourceFingerprint:true,currency:true,sourceDate:true,policyReference:true,createdAt:true,voucherId:true},orderBy:[{createdAt:'desc'},{id:'asc'}],take:100}),limit:100};});
}
export async function importExternalFinanceSource(scope:WmsScope,body:Record<string,unknown>){
 strictKeys(body,['selector','sourceFingerprint','periodId','date','debitSubjectId','creditSubjectId','policyReference','evidence','positiveAmountSide']);
 const selector=parseExternalSelector(body.selector),fingerprint=requireText(body.sourceFingerprint,'源摘要'),periodId=requireText(body.periodId,'期间 ID'),date=requireText(body.date,'会计日期'),debitSubjectId=requireText(body.debitSubjectId,'正金额借方科目'),creditSubjectId=requireText(body.creditSubjectId,'正金额贷方科目'),policyReference=requireText(body.policyReference,'目标端核算依据',1000),evidence=requireText(body.evidence,'来源去重及核对依据',1000);
 // The source sign is not an implicit revenue/expense policy. Both positive-side accounts are explicit.
 if(body.positiveAmountSide!=='EXPLICIT_DEBIT_CREDIT')throw new WmsError('须显式确认正金额对应所选借贷科目；负金额按该映射反向。',400);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new WmsError('会计日期无效。',400);
 await assertAmazonAction(scoped(scope),scope.actorUserId,'create');const initialSource=await readSource(scope,selector);
 if(initialSource.sourceFingerprint!==fingerprint)throw new WmsError('来源已修订，须重新预览并处理原凭证调整，不能当作新费用。',409);
 return prisma.$transaction(async tx=>{
  await lockKey(tx,JSON.stringify(['external-finance-source',scoped(scope),initialSource.economicKey]));
  const periodIdentity=await tx.financePeriod.findFirst({where:{...scoped(scope),id:periodId},select:{bookId:true}});if(!periodIdentity)throw new WmsError('期间不存在。',404);
  await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${periodIdentity.bookId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "FinancePeriod" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${periodId} FOR UPDATE`;
  await assertFinanceAction(tx,scope,'create');
  // Final shared read happens after all ledger serialization waits. This immutable claim
  // records the observed revision, not a promise that Amazon will never revise it later.
  const source=await readSource(scope,selector);
  if(source.economicKey!==initialSource.economicKey||source.sourceFingerprint!==fingerprint)throw new WmsError('来源已修订，须重新预览并处理原凭证调整。',409);
  if(selector.kind==='AMAZON_FINANCE')await amazonAccountReadAccess(scoped(scope),scope.actorUserId,new URLSearchParams({sellerAccountId:selector.sellerAccountId,marketplaceId:selector.marketplaceId}),tx,'finance');
  else await amazonAdsAccountReadAccess(scoped(scope),scope.actorUserId,selector,tx);
  const period=await tx.financePeriod.findFirst({where:{...scoped(scope),id:periodId,book:{enabled:true}},include:{book:true}});if(!period)throw new WmsError('期间或账套不存在。',404);
  const requestHash=closeDigest({selector,sourceFingerprint:fingerprint,periodId,date,debitSubjectId,creditSubjectId,policyReference,evidence,positiveAmountSide:body.positiveAmountSide});
  const prior=await tx.financeExternalSourceClaim.findFirst({where:{...scoped(scope),economicKey:source.economicKey}});
  if(prior){if(prior.requestHash!==requestHash||prior.createdBy!==scope.actorUserId||prior.bookId!==period.bookId)throw new WmsError('同一经济来源已占用；报告修订/不同报表/跨账套不能重复创建费用，须走正式更正。',409);return {claim:prior,voucher:await tx.financeVoucher.findFirstOrThrow({where:{...scoped(scope),id:prior.voucherId}}),reused:true,postingExecuted:false};}
  const lines=externalDraftLines(source,period.book.currency,debitSubjectId,creditSubjectId);
  const result=await createLedgerVoucher(tx,scope,{periodId,date,idempotencyKey:'EXTERNAL:'+closeDigest(source.economicKey),sourceKey:'EXTERNAL-FINANCE:'+closeDigest(source.economicKey),memo:`${source.kind} · ${policyReference} · ${fingerprint}`.slice(0,500),lines:lines.map(line=>({...line,debit:new Prisma.Decimal(line.debit),credit:new Prisma.Decimal(line.credit),memo:''}))});
  const claim=await tx.financeExternalSourceClaim.create({data:{id:crypto.randomUUID(),...scoped(scope),bookId:period.bookId,voucherId:result.voucher.id,kind:source.kind,economicKey:source.economicKey,requestHash,sourceFingerprint:fingerprint,currency:source.currency,sourceDate:new Date(source.sourceDate+'T00:00:00Z'),policyReference,evidence,provenance:json({selector,...source.provenance,amount:source.amount,positiveAmountSide:body.positiveAmountSide,debitSubjectId,creditSubjectId}),createdBy:scope.actorUserId}});
  await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'finance.external-source.import',entityType:'FinanceExternalSourceClaim',entityId:claim.id,metadata:{workspaceId:scope.workspaceId,bookId:period.bookId,periodId,voucherId:result.voucher.id,kind:source.kind,economicKey:source.economicKey,sourceFingerprint:fingerprint,postingExecuted:false}}});
  return {claim,voucher:result.voucher,reused:false,postingExecuted:false};
 },{timeout:20000});
}
