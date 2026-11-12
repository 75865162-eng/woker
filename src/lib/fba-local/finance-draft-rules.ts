import {object} from './rules';
import {requireText,strictKeys,WmsInputError} from '@/lib/wms/rules';
import {lineCostAdjustmentDraft,validateVoucher,FinanceRuleError,type AccountingSubject,type AccountingPeriod} from '@/lib/finance/rules';
import {parseFxRuleSnapshot,convertCostSnapshot} from '@/lib/finance/fx-rules';
export function parseFinanceDraftInput(raw:unknown){
 const row=object(raw);strictKeys(row,['adjustmentId','idempotencyKey','bookReference','periodReference','periodStart','periodEnd','date','payableAccountId','costAccounts','proposedSubjects','evidence','conversion']);
 const fields={adjustmentId:requireText(row.adjustmentId,'差异单 ID'),idempotencyKey:requireText(row.idempotencyKey,'幂等键'),bookReference:requireText(row.bookReference,'拟用账套'),periodReference:requireText(row.periodReference,'拟用期间'),periodStart:requireText(row.periodStart,'期间开始'),periodEnd:requireText(row.periodEnd,'期间结束'),date:requireText(row.date,'拟用会计日期'),payableAccountId:requireText(row.payableAccountId,'拟用应付科目'),evidence:requireText(row.evidence,'核算规则依据',2000)};
 if(!Array.isArray(row.costAccounts)||!row.costAccounts.length||row.costAccounts.length>100||!Array.isArray(row.proposedSubjects)||!row.proposedSubjects.length||row.proposedSubjects.length>101)throw new WmsInputError('成本映射及拟用科目数量无效。');
 const costAccounts=row.costAccounts.map(value=>{const item=object(value);strictKeys(item,['lineId','accountId']);return {lineId:requireText(item.lineId,'计划明细'),accountId:requireText(item.accountId,'拟用成本科目')};}).sort((a,b)=>a.lineId.localeCompare(b.lineId));
 const proposedSubjects=row.proposedSubjects.map(value=>{
  const item=object(value);strictKeys(item,['id','enabled','leaf','normalSide']);
  if(typeof item.enabled!=='boolean'||typeof item.leaf!=='boolean'||!['DEBIT','CREDIT'].includes(String(item.normalSide)))throw new WmsInputError('须明确拟用科目状态、末级及方向。');
  return {id:requireText(item.id,'拟用科目 ID'),enabled:item.enabled,leaf:item.leaf,normalSide:item.normalSide as 'DEBIT'|'CREDIT'};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 return {...fields,costAccounts,proposedSubjects,...(row.conversion===undefined?{}:{conversion:parseFxRuleSnapshot(row.conversion)})};
}
export function calculateFinanceDraft(scope:{organizationId:string;workspaceId:string},input:ReturnType<typeof parseFinanceDraftInput>,id:string,estimate:Parameters<typeof lineCostAdjustmentDraft>[2]['estimate'],actual:Parameters<typeof lineCostAdjustmentDraft>[2]['actual']){
 const convertedEstimate=input.conversion?convertCostSnapshot(estimate,input.conversion):estimate;
 const convertedActual=input.conversion?convertCostSnapshot(actual,input.conversion):actual;
 const identity={...scope,bookId:input.bookReference,currency:convertedActual.currency};
 const period:AccountingPeriod={...identity,id:input.periodReference,start:input.periodStart,end:input.periodEnd,status:'OPEN'};
 const subjects:AccountingSubject[]=input.proposedSubjects.map(row=>({...identity,...row}));
 try{
  const calculation=lineCostAdjustmentDraft(period,subjects,{id,sourceKey:`FBA-ADJUSTMENT:${input.adjustmentId}`,date:input.date,payableAccountId:input.payableAccountId,costAccounts:input.costAccounts,estimate:convertedEstimate,actual:convertedActual});
  if(!calculation.draft)throw new WmsInputError('费用没有明细差异，无需生成凭证草稿。',409);
  return {voucher:calculation.draft,summary:{...validateVoucher(calculation.draft,period,subjects),currency:identity.currency,difference:calculation.reconciliation.difference,lines:calculation.reconciliation.lines,...(input.conversion?{conversion:input.conversion,convertedEstimate,convertedActual}:{}),postingExecuted:false,accountingConfigurationVerified:false}};
 }catch(error){if(error instanceof FinanceRuleError)throw new WmsInputError(error.message);throw error;}
}
