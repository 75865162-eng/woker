import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { scoped, json } from '@/lib/wms/access';
import { WmsError,type WmsScope } from '@/lib/wms/contracts';
import { requireText,requireRevision,strictKeys } from '@/lib/wms/rules';
import { parseReportDefinition,renderFinancialReport,profitLossClosingLines } from './report-rules';
import { createLedgerVoucher, readTrialInTransaction } from './ledger-service';
import { assertFinanceReviewer } from './access';
import { closeDigest } from './close-rules';

export async function queryFinanceReports(scope:WmsScope,params:URLSearchParams){
 const bookId=requireText(params.get('bookId'),'账套 ID'),periodId=params.get('periodId'),templateId=params.get('templateId');
 return prisma.$transaction(async tx=>{
  if(params.has('subjectId')){
   const subjectId=requireText(params.get('subjectId'),'明细科目 ID');
   if(!periodId)throw new WmsError('明细账须选择期间。',400);
   if(!await tx.financePeriod.findFirst({where:{...scoped(scope),id:periodId,bookId}}))throw new WmsError('期间不存在。',404);
   const page=Number(params.get('page')??1);if(!Number.isSafeInteger(page)||page<1||page>10000)throw new WmsError('页码无效。',400);
   const lines=await tx.financeVoucherLine.findMany({where:{...scoped(scope),bookId,subjectId,voucher:{periodId,status:'POSTED'}},include:{voucher:{select:{date:true,sourceKey:true,kind:true}}},orderBy:[{voucher:{date:'asc'}},{voucherId:'asc'},{lineNumber:'asc'}],skip:(page-1)*100,take:101});
   return {templates:[],report:null,detail:{subjectId,periodId,bookId,page,hasMore:lines.length>100,lines:lines.slice(0,100).map(row=>({...row,debit:row.debit.toFixed(6),credit:row.credit.toFixed(6)}))}};
  }
  const templates=await tx.financeReportTemplate.findMany({where:{...scoped(scope),bookId,kind:{not:'VOUCHER_MAPPING'}},orderBy:[{code:'asc'},{version:'desc'}],take:200});
  if(!periodId||!templateId)return {templates,report:null,limits:{templates:200}};
  const template=templates.find(row=>row.id===templateId&&row.status==='ACTIVE');if(!template||template.kind==='VOUCHER_MAPPING')throw new WmsError('报表模板不存在或尚未独立复核。',404);
  const trial=await readTrialInTransaction(tx,scope,bookId,periodId);
  const subjects=await tx.financeSubject.findMany({where:{...scoped(scope),bookId},select:{id:true}});
  const definition=parseReportDefinition(template.definition);
  return {templates,limits:{templates:200},report:{periodId,bookId,currency:trial.currency,templateId,policyReference:template.policyReference,templateVersion:template.version,basis:'POSTED_LEDGER',rows:renderFinancialReport(definition,trial.rows,subjects.map(row=>row.id)),closingPreview:definition.closing?profitLossClosingLines(definition,trial.rows):null,balanced:trial.balanced,trialFingerprint:closeDigest(trial)}};
 },{isolationLevel:'RepeatableRead'});
}
export async function mutateFinanceReports(scope:WmsScope,body:Record<string,unknown>){
 const action=requireText(body.action,'报表动作');if(!['create-template','review-template','create-closing-draft'].includes(action))throw new WmsError('报表动作不支持。',400);
 strictKeys(body,action==='create-template'?['action','bookId','code','version','kind','definition','policyReference']:action==='review-template'?['action','bookId','templateId']:['action','bookId','periodId','templateId','date','trialFingerprint']);
 const bookId=requireText(body.bookId,'账套 ID');
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${bookId} FOR UPDATE`;
  if(!await tx.financeBook.findFirst({where:{...scoped(scope),id:bookId,enabled:true}}))throw new WmsError('账套不存在或已停用。',404);
  if(action==='create-template'){
   const code=requireText(body.code,'模板编码',40),version=requireRevision(body.version),kind=requireText(body.kind,'模板类型'),policyReference=requireText(body.policyReference,'目标端报表制度依据',1000),definition=parseReportDefinition(body.definition);
   if(!['BALANCE_SHEET','PROFIT_LOSS','CUSTOM'].includes(kind))throw new WmsError('模板类型无效。',400);
   const ids=[...new Set([...definition.rows.flatMap(row=>row.subjectIds),...(definition.closing?[...definition.closing.subjectIds,definition.closing.destinationSubjectId]:[])])];
   if(await tx.financeSubject.count({where:{...scoped(scope),bookId,id:{in:ids},enabled:true,leaf:true}})!==ids.length)throw new WmsError('模板须映射本账套启用的末级科目。',422);
   const template=await tx.financeReportTemplate.create({data:{id:crypto.randomUUID(),...scoped(scope),bookId,code,version,kind,definition:json({rows:definition.rows.map(row=>row.formula?{code:row.code,label:row.label,formula:row.formula}:row),closing:definition.closing}),policyReference,createdBy:scope.actorUserId}});
   await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'finance.report.create-template',entityType:'FinanceReportTemplate',entityId:template.id,metadata:{workspaceId:scope.workspaceId,bookId,code,version,policyReference}}});return {template};
  }
  const templateId=requireText(body.templateId,'模板 ID'),template=await tx.financeReportTemplate.findFirst({where:{...scoped(scope),bookId,id:templateId}});
  if(!template||template.kind==='VOUCHER_MAPPING')throw new WmsError('报表模板不存在。',404);
  if(action==='review-template'){
   await assertFinanceReviewer(tx,scope,scope.actorUserId);
   if(template.createdBy===scope.actorUserId)throw new WmsError('模板禁止申请人自审。',403);
   if(template.status==='ACTIVE')return {template,reused:true};
   const updated=await tx.financeReportTemplate.update({where:{id:templateId},data:{status:'ACTIVE',reviewedBy:scope.actorUserId,reviewedAt:new Date()}});
   await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'finance.report.review-template',entityType:'FinanceReportTemplate',entityId:templateId,metadata:{workspaceId:scope.workspaceId,bookId}}});return {template:updated};
  }
  if(template.kind!=='PROFIT_LOSS')throw new WmsError('损益结转仅允许使用目标端损益模板。',422);
  if(template.status!=='ACTIVE'||!template.reviewedBy)throw new WmsError('损益结转须使用已复核模板。',409);
  await assertFinanceReviewer(tx,scope,template.reviewedBy);
  const periodId=requireText(body.periodId,'期间 ID'),trial=await readTrialInTransaction(tx,scope,bookId,periodId),trialFingerprint=requireText(body.trialFingerprint,'试算摘要');
  if(closeDigest(trial)!==trialFingerprint)throw new WmsError('试算已变化，请重新预览。',409);
  const lines=profitLossClosingLines(parseReportDefinition(template.definition),trial.rows);
  if(lines.length>200)throw new WmsError('结转凭证最多 200 条分录。',422);
  if(!lines.length)throw new WmsError('配置科目无待结转余额。',422);
  return createLedgerVoucher(tx,scope,{periodId,idempotencyKey:`PL:${periodId}:${template.code}`,sourceKey:`PROFIT-LOSS:${periodId}:${template.code}`,date:requireText(body.date,'会计日期'),memo:`${template.policyReference} · template ${template.version}`,lines:lines.map(line=>({...line,debit:new Prisma.Decimal(line.debit),credit:new Prisma.Decimal(line.credit),memo:''}))});
 });
}
