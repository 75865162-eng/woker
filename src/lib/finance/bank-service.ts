import {prisma} from '@/lib/db/prisma';
import {scoped,json} from '@/lib/wms/access';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import {requireText,requireRevision,strictKeys} from '@/lib/wms/rules';
import {assertFinanceReviewer,assertFinanceAction} from './access';
import {closeDigest} from './close-rules';
import {parseBankStatementRows,validateBankMatch} from './bank-rules';
export async function queryFinanceBank(scope:WmsScope,params:URLSearchParams){
 const bookId=requireText(params.get('bookId'),'账套 ID'),accountId=params.get('accountId'),periodId=params.get('periodId');
 return prisma.$transaction(async tx=>{
  await assertFinanceAction(tx,scope,'view');
  const where={...scoped(scope),bookId},accounts=await tx.financeBankAccount.findMany({where,orderBy:{code:'asc'},take:100});
  if(!accountId)return {accounts,statements:[],matches:[],journal:[],candidates:[],limits:{statements:200,journal:200}};
  const account=accounts.find(row=>row.id===accountId);if(!account)throw new WmsError('银行账户不存在。',404);
  const period=periodId?await tx.financePeriod.findFirst({where:{...where,id:periodId}}):null;if(periodId&&!period)throw new WmsError('期间不存在。',404);
  const statements=await tx.financeBankStatement.findMany({where:{...where,accountId,...(period?{date:{gte:period.start,lte:period.end}}:{})},orderBy:[{date:'asc'},{id:'asc'}],take:201});
  const matches=await tx.financeBankMatch.findMany({where:{...where,statement:{accountId},...(periodId?{periodId}:{})},include:{entries:true},orderBy:{matchedAt:'desc'},take:201});
  const journal=periodId?await tx.financeVoucherLine.findMany({where:{...where,subjectId:account.subjectId,voucher:{status:'POSTED',periodId}},include:{voucher:{select:{date:true,sourceKey:true,kind:true}}},orderBy:[{voucher:{date:'asc'}},{voucherId:'asc'},{lineNumber:'asc'}],take:201}):[];
  const occupied=await tx.financeBankMatchEntry.findMany({where:{...where,active:true,voucherLineId:{in:journal.map(row=>row.id)}},select:{voucherLineId:true}}),used=new Set(occupied.map(row=>row.voucherLineId)),matched=new Set(matches.filter(row=>!row.reversedAt).map(row=>row.statementId));
  const candidates=statements.slice(0,200).filter(row=>!matched.has(row.id)).map(row=>({statementId:row.id,voucherLineIds:journal.slice(0,200).filter(line=>!used.has(line.id)&&line.voucher.date.getTime()===row.date.getTime()&&line.debit.minus(line.credit).equals(row.amount)).map(line=>line.id),basis:'SAME_DATE_EXACT_SIGNED_AMOUNT',automatic:false}));
  return {accounts,statements:statements.slice(0,200).map(row=>({...row,amount:row.amount.toFixed(6)})),matches:matches.slice(0,200).map(row=>({...row,amount:row.amount.toFixed(6)})),journal:journal.slice(0,200).map(row=>({...row,debit:row.debit.toFixed(6),credit:row.credit.toFixed(6),matched:used.has(row.id)})),candidates,truncated:{statements:statements.length>200,journal:journal.length>200,matches:matches.length>200},basis:'POSTED_LEDGER',limits:{statements:200,journal:200}};
 },{isolationLevel:'RepeatableRead'});
}
export async function mutateFinanceBank(scope:WmsScope,body:Record<string,unknown>){
 const action=requireText(body.action,'银行动作'),bookId=requireText(body.bookId,'账套 ID'),fields:Record<string,string[]>={'create-account':['subjectId','code','name','maskedNumber','policyReference'],'import-statements':['accountId','rows'],'match-statement':['statementId','periodId','voucherLineIds','evidence'],'reverse-match':['matchId','evidence'],'update-account':['accountId','revision','name','maskedNumber','paymentMethod','enabled','isDefault']};if(!fields[action])throw new WmsError('银行动作无效。',400);strictKeys(body,['action','bookId',...fields[action]]);
 return prisma.$transaction(async tx=>{
  await assertFinanceAction(tx,scope,action==='import-statements'?'create':'approve');
  await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${bookId} FOR UPDATE`;
  const where={...scoped(scope),bookId},book=await tx.financeBook.findFirst({where:{...scoped(scope),id:bookId,enabled:true}});if(!book)throw new WmsError('账套不存在或已停用。',404);let result:object;
  if(action==='update-account'){
   const id=requireText(body.accountId,'账户 ID'),revision=requireRevision(body.revision),account=await tx.financeBankAccount.findFirst({where:{...where,id}});if(!account||account.revision!==revision)throw new WmsError('账户不存在或版本已变化。',409);
   if(typeof body.enabled!=='boolean'||typeof body.isDefault!=='boolean'||(body.isDefault&&!body.enabled))throw new WmsError('默认账户须启用，状态须明确。',400);
   if(body.isDefault)await tx.financeBankAccount.updateMany({where:{...where,isDefault:true,id:{not:id}},data:{isDefault:false,revision:{increment:1}}});
   result={account:await tx.financeBankAccount.update({where:{id},data:{name:requireText(body.name,'账户名称',120),maskedNumber:requireText(body.maskedNumber,'账户遮罩',40),paymentMethod:requireText(body.paymentMethod,'支付方式',80),enabled:body.enabled,isDefault:body.isDefault,revision:{increment:1}}})};
  }else if(action==='create-account'){
   await assertFinanceReviewer(tx,scope,scope.actorUserId);const subjectId=requireText(body.subjectId,'银行科目 ID');if(!await tx.financeSubject.findFirst({where:{...where,id:subjectId,enabled:true,leaf:true,normalSide:'DEBIT'}}))throw new WmsError('银行账户须绑定本账套启用的借方末级科目。',422);
   result={account:await tx.financeBankAccount.create({data:{...where,id:crypto.randomUUID(),subjectId,code:requireText(body.code,'账户编码',40),name:requireText(body.name,'账户名称',120),maskedNumber:requireText(body.maskedNumber,'账户尾号或遮罩',40),currency:book.currency,policyReference:requireText(body.policyReference,'银行核算依据',1000),createdBy:scope.actorUserId}})};
  }else if(action==='import-statements'){
   const accountId=requireText(body.accountId,'银行账户 ID');if(!await tx.financeBankAccount.findFirst({where:{...where,id:accountId,enabled:true}}))throw new WmsError('银行账户不存在。',404);
   const rows=parseBankStatementRows(body.rows),ids:string[]=[];
   for(const row of rows){const requestHash=closeDigest(row),prior=await tx.financeBankStatement.findFirst({where:{...where,accountId,reference:row.reference}});if(prior){if(prior.requestHash!==requestHash)throw new WmsError('银行同流水号内容冲突。',409);ids.push(prior.id);continue;}
    const saved=await tx.financeBankStatement.create({data:{...where,...row,date:new Date(row.date+'T00:00:00Z'),id:crypto.randomUUID(),accountId,requestHash,createdBy:scope.actorUserId}});ids.push(saved.id);
   }result={statementIds:ids};
  }else if(action==='match-statement'){
   await assertFinanceReviewer(tx,scope,scope.actorUserId);const statementId=requireText(body.statementId,'银行流水 ID'),periodId=requireText(body.periodId,'期间 ID'),evidence=requireText(body.evidence,'对账依据',1000);
   const statement=await tx.financeBankStatement.findFirst({where:{...where,id:statementId},include:{account:true}}),period=await tx.financePeriod.findFirst({where:{...where,id:periodId,status:'OPEN'}});if(!statement||!period||statement.date<period.start||statement.date>period.end)throw new WmsError('银行流水须属于所选开放期间。',409);
   if(statement.createdBy===scope.actorUserId)throw new WmsError('银行账单导入人不能复核自身账单。',403);
   if(!Array.isArray(body.voucherLineIds)||!body.voucherLineIds.length||body.voucherLineIds.length>200||new Set(body.voucherLineIds).size!==body.voucherLineIds.length)throw new WmsError('匹配分录清单无效。',400);const ids=body.voucherLineIds.map(id=>requireText(id,'凭证分录 ID')).sort();
   const prior=await tx.financeBankMatch.findFirst({where:{...where,statementId,reversedAt:null},include:{entries:true}});if(prior){if(prior.matchedBy!==scope.actorUserId||prior.evidence!==evidence||prior.periodId!==periodId||closeDigest(prior.entries.map(row=>row.voucherLineId).sort())!==closeDigest(ids))throw new WmsError('银行流水已完成其他匹配。',409);return {match:prior,reused:true};}
   const lines=await tx.financeVoucherLine.findMany({where:{...where,id:{in:ids},subjectId:statement.account.subjectId,voucher:{status:'POSTED',periodId}}});if(lines.length!==ids.length)throw new WmsError('所选分录须为同账套账户科目和期间的已过账凭证。',422);
   if(await tx.financeBankMatchEntry.count({where:{...where,voucherLineId:{in:ids},active:true}}))throw new WmsError('凭证分录已被其他银行流水占用。',409);
   const amount=validateBankMatch(statement.amount.toFixed(6),lines.map(row=>({debit:row.debit.toFixed(6),credit:row.credit.toFixed(6)}))),id=crypto.randomUUID();
   const match=await tx.financeBankMatch.create({data:{...where,id,statementId,periodId,amount,evidence,matchedBy:scope.actorUserId}});await tx.financeBankMatchEntry.createMany({data:ids.map(voucherLineId=>({...where,id:crypto.randomUUID(),matchId:id,voucherLineId}))});result={match,reused:false};
  }else{
   await assertFinanceReviewer(tx,scope,scope.actorUserId);const matchId=requireText(body.matchId,'对账记录 ID'),evidence=requireText(body.evidence,'撤销依据',1000),prior=await tx.financeBankMatch.findFirst({where:{...where,id:matchId}});if(!prior)throw new WmsError('对账记录不存在。',404);
   if(!await tx.financePeriod.findFirst({where:{...where,id:prior.periodId,status:'OPEN'}}))throw new WmsError('已关闭期间不能撤销对账。',409);
   if(prior.reversedAt){if(prior.reversedBy!==scope.actorUserId||prior.reversalEvidence!==evidence)throw new WmsError('撤销依据不可覆盖。',409);return {match:prior,reused:true};}
   const match=await tx.financeBankMatch.update({where:{id:matchId},data:{reversedAt:new Date(),reversedBy:scope.actorUserId,reversalEvidence:evidence}});await tx.financeBankMatchEntry.updateMany({where:{...where,matchId,active:true},data:{active:false}});result={match};
  }
  await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:`finance.bank.${action}`,entityType:'FinanceBook',entityId:bookId,metadata:{workspaceId:scope.workspaceId,request:json(body)}}});return result;
 });
}
