import {Prisma} from '@prisma/client';
import {prisma} from '@/lib/db/prisma';
import {scoped,json} from '@/lib/wms/access';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import {requireText,strictKeys} from '@/lib/wms/rules';
import {parseVoucherImportRows,groupVoucherImportRows} from './voucher-import-rules';
import {closeDigest} from './close-rules';
import {createLedgerVoucher} from './ledger-service';
export async function queryVoucherImports(scope:WmsScope,params:URLSearchParams){
 const bookId=requireText(params.get('bookId'),'账套 ID');
 return {imports:await prisma.financeVoucherImport.findMany({where:{...scoped(scope),bookId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:50}),limit:50};
}
export async function mutateVoucherImport(scope:WmsScope,body:Record<string,unknown>){
 const action=requireText(body.action,'凭证导入动作'),bookId=requireText(body.bookId,'账套 ID');
 if(!['stage-import','import-drafts'].includes(action))throw new WmsError('凭证导入动作无效。',400);
 strictKeys(body,action==='stage-import'?['action','bookId','sourceName','evidence','idempotencyKey','records']:['action','bookId','importId','periodId','requestHash']);
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${bookId} FOR UPDATE`;
  const where={...scoped(scope),bookId};
  if(!await tx.financeBook.findFirst({where:{...scoped(scope),id:bookId,enabled:true}}))throw new WmsError('账套不存在或已停用。',404);
  if(action==='stage-import'){
   const records=parseVoucherImportRows(body.records),sourceName=requireText(body.sourceName,'来源文件名',200),evidence=requireText(body.evidence,'导入依据',1000),idempotencyKey=requireText(body.idempotencyKey,'导入幂等键',100),requestHash=closeDigest({records,sourceName,evidence});
   const prior=await tx.financeVoucherImport.findFirst({where:{...where,idempotencyKey}});
   if(prior){if(prior.requestHash!==requestHash||prior.createdBy!==scope.actorUserId)throw new WmsError('导入幂等键冲突。',409);return {import:prior,reused:true};}
   const {errors}=groupVoucherImportRows(records),subjects=await tx.financeSubject.findMany({where:{...where,enabled:true,leaf:true},select:{code:true}}),codes=new Set(subjects.map(row=>row.code));
   for(const row of records)if(!codes.has(row.subjectCode))errors.push({voucherKey:row.voucherKey,message:`${row.sourceSheet}:${row.sourceRow} 科目编码不存在或非启用末级。`});
   const staged=await tx.financeVoucherImport.create({data:{id:crypto.randomUUID(),...where,idempotencyKey,requestHash,sourceName,evidence,records:json(records),errors:json(errors),voucherIds:[],status:errors.length?'NEEDS_REVIEW':'VALIDATED',createdBy:scope.actorUserId}});
   await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'finance.import.stage',entityType:'FinanceVoucherImport',entityId:staged.id,metadata:{workspaceId:scope.workspaceId,bookId,requestHash,rowCount:records.length,errorCount:errors.length}}});return {import:staged,reused:false};
  }
  const importId=requireText(body.importId,'导入批次 ID'),periodId=requireText(body.periodId,'期间 ID'),requestHash=requireText(body.requestHash,'导入摘要');
  const staged=await tx.financeVoucherImport.findFirst({where:{...where,id:importId}});
  if(!staged||staged.requestHash!==requestHash)throw new WmsError('导入批次不存在或摘要已变化。',409);
  const period=await tx.financePeriod.findFirst({where:{...where,id:periodId}});if(!period)throw new WmsError('导入期间不存在。',404);
  const records=parseVoucherImportRows(staged.records),{groups,errors}=groupVoucherImportRows(records);
  if(staged.status==='IMPORTED'){
   const ids=staged.voucherIds as string[],count=await tx.financeVoucher.count({where:{...where,id:{in:ids},periodId}});
   if(count!==ids.length)throw new WmsError('已导入批次不能更换期间。',409);return {import:staged,reused:true};
  }
  if(staged.status!=='VALIDATED'||errors.length||period.status!=='OPEN')throw new WmsError('仅已校验批次可转入开放期间。',409);
  const subjects=await tx.financeSubject.findMany({where:{...where,enabled:true,leaf:true}}),mapping=new Map(subjects.map(row=>[row.code,row.id])),voucherIds:string[]=[];
  for(const group of groups){
   const lines=group.lines.map(row=>{const subjectId=mapping.get(row.subjectCode);if(!subjectId)throw new WmsError('正式科目已变化，请重新暂存新批次。',409);return {subjectId,debit:new Prisma.Decimal(row.debit),credit:new Prisma.Decimal(row.credit),memo:row.memo};});
   const result=await createLedgerVoucher(tx,scope,{periodId,idempotencyKey:`IMPORT:${staged.id}:${group.voucherKey}`,sourceKey:`VOUCHER-IMPORT:${closeDigest({sourceName:staged.sourceName,voucherKey:group.voucherKey})}`,date:group.date,memo:`${staged.sourceName} · ${group.voucherKey}`,lines});voucherIds.push(result.voucher.id);
  }
  const updated=await tx.financeVoucherImport.update({where:{id:staged.id},data:{status:'IMPORTED',voucherIds:json(voucherIds),importedAt:new Date()}});
  await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'finance.import.drafts',entityType:'FinanceVoucherImport',entityId:staged.id,metadata:{workspaceId:scope.workspaceId,bookId,periodId,voucherIds,requestHash}}});return {import:updated,reused:false};
 },{timeout:20000});
}
