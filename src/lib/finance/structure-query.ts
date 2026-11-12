import {prisma} from '@/lib/db/prisma';
import {scoped} from '@/lib/wms/access';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import {requireText} from '@/lib/wms/rules';
import {assertFinanceAction} from './access';
import {amountUnits,unitsAmount} from './open-item-rules';
/** Project/receipt/payment summaries are projections of posted voucher lines, never a second balance. */
export async function queryFinanceStructure(scope:WmsScope,params:URLSearchParams){
 const bookId=requireText(params.get('bookId'),'账套 ID'),periodId=requireText(params.get('periodId'),'期间 ID');
 return prisma.$transaction(async tx=>{
  await assertFinanceAction(tx,scope,'view');const where={...scoped(scope),bookId};
  const period=await tx.financePeriod.findFirst({where:{...where,id:periodId},include:{book:true}});if(!period)throw new WmsError('期间不存在。',404);
  const voucherId=params.get('voucherId');
  if(voucherId){
   const voucher=await tx.financeVoucher.findFirst({where:{...where,id:voucherId,periodId}});if(!voucher)throw new WmsError('凭证不存在。',404);
   const audit=await tx.auditLog.findFirst({where:{organizationId:scope.organizationId,entityType:'FinanceVoucher',entityId:voucher.reversalOf??voucher.id,action:'finance.source.import'},select:{metadata:true}});
   const metadata=audit?.metadata as Record<string,unknown>|undefined;
   return {basis:'IMMUTABLE_SOURCE_HANDOFF',bookId,periodId,voucherId,inventoryDetails:metadata?.workspaceId===scope.workspaceId&&Array.isArray(metadata.inventoryDetails)?metadata.inventoryDetails.map(value=>({...value as object,reversal:voucher.kind==='REVERSAL'})):[],historicalEvidence:true};
  }
  const typeId=requireText(params.get('typeId'),'项目分类（辅助类型）ID');if(!await tx.financeAuxiliaryType.findFirst({where:{...where,id:typeId}}))throw new WmsError('项目分类不存在。',404);
  const accounts=await tx.financeBankAccount.findMany({where,orderBy:{code:'asc'},take:201});if(accounts.length>200)throw new WmsError('账户超过汇总边界。',422);
  const lines=await tx.financeVoucherLine.findMany({where:{...where,subjectId:{in:accounts.map(row=>row.subjectId)},voucher:{status:'POSTED',periodId}},include:{voucher:{select:{date:true}},auxiliaries:{where:{typeId},include:{item:true}}},take:10001});
  if(lines.length>10000)throw new WmsError('月汇总超过 10000 条已过账银行分录，请缩小账套或使用专用报表任务。',422);
  const rows=new Map<string,{accountId:string;projectId:string|null;projectCode:string|null;projectName:string|null;month:string;received:bigint;paid:bigint}>();
  for(const line of lines){if(line.voucher.date<period.start)continue;const account=accounts.find(row=>row.subjectId===line.subjectId)!,project=line.auxiliaries[0]?.item,month=line.voucher.date.toISOString().slice(0,7),key=JSON.stringify([account.id,project?.id??null,month]);let row=rows.get(key);if(!row){row={accountId:account.id,projectId:project?.id??null,projectCode:project?.code??null,projectName:project?.name??null,month,received:BigInt(0),paid:BigInt(0)};rows.set(key,row);}row.received+=amountUnits(line.debit.toFixed(6));row.paid+=amountUnits(line.credit.toFixed(6));}
  const openings=await tx.financeOpeningBalance.findMany({where:{...where,periodId,subjectId:{in:accounts.map(row=>row.subjectId)}}});
  const balances=accounts.map(account=>{const own=lines.filter(line=>line.subjectId===account.subjectId),opening=openings.filter(row=>row.subjectId===account.subjectId).reduce((sum,row)=>sum+(row.side==='DEBIT'?amountUnits(row.amount.toFixed(6)):-amountUnits(row.amount.toFixed(6))),BigInt(0)),movement=own.filter(line=>line.voucher.date>=period.start).reduce((sum,line)=>sum+amountUnits(line.debit.toFixed(6))-amountUnits(line.credit.toFixed(6)),BigInt(0));return {accountId:account.id,opening:unitsAmount(opening),movement:unitsAmount(movement),closing:unitsAmount(opening+movement)};});
  return {basis:'POSTED_LEDGER',bookId,periodId,currency:period.book.currency,typeId,rows:[...rows.values()].sort((a,b)=>a.month.localeCompare(b.month)||a.accountId.localeCompare(b.accountId)||(a.projectId??'').localeCompare(b.projectId??'')).map(row=>({...row,received:unitsAmount(row.received),paid:unitsAmount(row.paid)})),balances,unclassifiedIsNull:true,automaticExternalReconciliation:false};
 },{isolationLevel:'RepeatableRead'});
}
