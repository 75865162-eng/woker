import {WmsError} from './contracts';
import {requireText,strictKeys} from './rules';
import {amountUnits,unitsAmount,validFinanceDate} from '@/lib/finance/open-item-rules';
export type InventoryRiskPolicy={reference:string;currency:string;windowDays:number;maximumSoldQty:string;expenseAccount:string;allowanceAccount:string};
export type InventoryRiskEvidence={productRecordId:string;salesFrom:string;salesTo:string;soldQty:string|null;salesCoverage:'COMPLETE'|'PARTIAL'|'MISSING';salesReference:string;carryingAmount:string|null;netRealizableAmount:string|null;existingProvision:string|null;valuationReference:string};
export type InventoryRiskStock={productRecordId:string;sku:string;quantity:string;dataStatus:string;estimate:unknown};
const quantity=(value:unknown,label:string)=>{if(typeof value!=='string'||! /^(?:0|[1-9]\d{0,23})$/.test(value))throw new WmsError(label+'须为非负整数字符串。',400);return value;};
export function parseInventoryRiskPolicy(raw:unknown):InventoryRiskPolicy{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new WmsError('库存风险政策无效。',400);const body=raw as Record<string,unknown>;
 strictKeys(body,['reference','currency','windowDays','maximumSoldQty','expenseAccount','allowanceAccount']);
 if(typeof body.windowDays!=='number'||!Number.isSafeInteger(body.windowDays)||body.windowDays<1||body.windowDays>366)throw new WmsError('销售窗口须为 1–366 天。',400);
 const currency=requireText(body.currency,'评估币种');if(!/^[A-Z]{3}$/.test(currency))throw new WmsError('评估币种须为三位大写编码。',400);
 const expenseAccount=requireText(body.expenseAccount,'目标端减值损益科目'),allowanceAccount=requireText(body.allowanceAccount,'目标端跌价准备科目');if(expenseAccount===allowanceAccount)throw new WmsError('减值损益科目与准备科目不能相同。',400);
 return {reference:requireText(body.reference,'目标端库存风险政策依据',1000),currency,windowDays:body.windowDays,maximumSoldQty:quantity(body.maximumSoldQty,'滞销阈值'),expenseAccount,allowanceAccount};
}
export function parseInventoryRiskEvidence(raw:unknown):InventoryRiskEvidence[]{
 if(!Array.isArray(raw)||!raw.length||raw.length>500)throw new WmsError('库存风险依据须有 1–500 个商品。',400);
 const seen=new Set<string>();return raw.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new WmsError('库存风险依据行无效。',400);const row=value as Record<string,unknown>;strictKeys(row,['productRecordId','salesFrom','salesTo','soldQty','salesCoverage','salesReference','carryingAmount','netRealizableAmount','existingProvision','valuationReference']);
  const productRecordId=requireText(row.productRecordId,'商品主档 ID');if(seen.has(productRecordId))throw new WmsError('商品依据重复。',400);seen.add(productRecordId);
  if(!['COMPLETE','PARTIAL','MISSING'].includes(String(row.salesCoverage)))throw new WmsError('须明确销售窗口覆盖状态。',400);
  const nullableAmount=(value:unknown)=>value==null?null:unitsAmount(amountUnits(requireText(value,'核算依据金额')));
  const soldQty=row.soldQty==null?null:quantity(row.soldQty,'窗口销售数量');if(row.salesCoverage==='COMPLETE'&&soldQty===null)throw new WmsError('完整窗口须提供明确销售数量，零须明确提供。',400);
  return {productRecordId,salesFrom:validFinanceDate(row.salesFrom,'销售窗口起始'),salesTo:validFinanceDate(row.salesTo,'销售窗口结束（不含）'),soldQty,salesCoverage:row.salesCoverage as InventoryRiskEvidence['salesCoverage'],salesReference:requireText(row.salesReference,'销售窗口来源依据',2000),carryingAmount:nullableAmount(row.carryingAmount),netRealizableAmount:nullableAmount(row.netRealizableAmount),existingProvision:nullableAmount(row.existingProvision),valuationReference:requireText(row.valuationReference,'目标估值/已有准备依据',2000)};
 });
}
export function assessInventoryRisk(stocks:InventoryRiskStock[],snapshotDate:string,policy:InventoryRiskPolicy,evidence:InventoryRiskEvidence[]){
 validFinanceDate(snapshotDate,'快照日期');const end=new Date(snapshotDate+'T00:00:00Z'),start=new Date(end.getTime()-policy.windowDays*86400000).toISOString().slice(0,10),byProduct=new Map(evidence.map(row=>[row.productRecordId,row]));
 if(stocks.length!==evidence.length||stocks.some(row=>!byProduct.has(row.productRecordId)))throw new WmsError('评估依据须恰好覆盖快照内全部商品；单次最多 500 个。',422);
 if(new Set(stocks.map(row=>row.productRecordId)).size!==stocks.length)throw new WmsError('快照商品重复，不能核算。',422);
 const items=stocks.map(stock=>{
  quantity(stock.quantity,'快照数量');const source=byProduct.get(stock.productRecordId)!;
  if(source.salesFrom!==start||source.salesTo!==snapshotDate)throw new WmsError('销售窗口须与快照日期及政策天数严格一致，结束日期不含。',422);
  const salesComplete=source.salesCoverage==='COMPLETE'&&source.soldQty!==null,valuationComplete=source.carryingAmount!==null&&source.netRealizableAmount!==null&&source.existingProvision!==null;
  const proposedProvision=valuationComplete?unitsAmount(amountUnits(source.carryingAmount!)-amountUnits(source.netRealizableAmount!)>BigInt(0)?amountUnits(source.carryingAmount!)-amountUnits(source.netRealizableAmount!):BigInt(0)):null;
  const provisionDelta=proposedProvision===null?null:unitsAmount(amountUnits(proposedProvision)-amountUnits(source.existingProvision!));
  return {productRecordId:stock.productRecordId,sku:stock.sku,quantity:stock.quantity,agingBasis:stock.estimate,stagnant:salesComplete?BigInt(stock.quantity)>BigInt(0)&&BigInt(source.soldQty!)<=BigInt(policy.maximumSoldQty):null,proposedProvision,provisionDelta,status:salesComplete&&valuationComplete&&stock.dataStatus==='COMPLETE'?'COMPLETE':'NEEDS_DATA'};
 });
 const complete=items.every(row=>row.status==='COMPLETE'),totalDelta=complete?items.reduce((sum,row)=>{const amount=row.provisionDelta!;return sum+(amount.startsWith('-')?-amountUnits(amount.slice(1)):amountUnits(amount));},BigInt(0)):null;
 const signed=(raw:string)=>raw.startsWith('-')?-amountUnits(raw.slice(1)):amountUnits(raw);
 const increase=complete?items.reduce((sum,row)=>sum+(signed(row.provisionDelta!)>BigInt(0)?signed(row.provisionDelta!):BigInt(0)),BigInt(0)):null;
 const release=complete?items.reduce((sum,row)=>sum+(signed(row.provisionDelta!)<BigInt(0)?-signed(row.provisionDelta!):BigInt(0)),BigInt(0)):null;
 if(totalDelta!==null)amountUnits(unitsAmount(totalDelta<BigInt(0)?-totalDelta:totalDelta));
 if(increase!==null)amountUnits(unitsAmount(increase));if(release!==null)amountUnits(unitsAmount(release));
 const pair=(amount:bigint,debit:string,credit:string)=>amount===BigInt(0)?[]:[{account:debit,debit:unitsAmount(amount),credit:'0.000000'},{account:credit,debit:'0.000000',credit:unitsAmount(amount)}];
 return {snapshotDate,salesWindow:{from:start,to:snapshotDate,endExclusive:true},currency:policy.currency,status:complete?'COMPLETE':'NEEDS_DATA',items,provisionDelta:totalDelta===null?null:unitsAmount(totalDelta),provisionIncrease:increase===null?null:unitsAmount(increase),provisionRelease:release===null?null:unitsAmount(release),voucher:increase===null||release===null?null:{currency:policy.currency,date:snapshotDate,lines:[...pair(increase,policy.expenseAccount,policy.allowanceAccount),...pair(release,policy.allowanceAccount,policy.expenseAccount)],postingExecuted:false},basis:'TARGET_POLICY_AND_OPERATOR_SUPPLIED_EVIDENCE',postingExecuted:false};
}
