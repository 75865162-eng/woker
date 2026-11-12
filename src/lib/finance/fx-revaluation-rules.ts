import {WmsError} from '@/lib/wms/contracts';
import {requireText,strictKeys} from '@/lib/wms/rules';
import {amountUnits,unitsAmount} from './open-item-rules';
import {convertCostSnapshot,type FxRuleSnapshot} from './fx-rules';
export type FxRevaluationItem={itemKey:string;foreignBalance:string|null;carryingBase:string|null;balanceSide:'DEBIT'|'CREDIT';monetarySubjectId:string;gainSubjectId:string;lossSubjectId:string;sourceVoucherLineIds:string[];sourceEvidence:string};
export function parseFxRevaluationItems(raw:unknown):FxRevaluationItem[]{
 if(!Array.isArray(raw)||!raw.length||raw.length>50)throw new WmsError('外币货币项目须有 1–50 项。',400);const seen=new Set<string>();
 return raw.map(value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new WmsError('外币项目无效。',400);const row=value as Record<string,unknown>;strictKeys(row,['itemKey','foreignBalance','carryingBase','balanceSide','monetarySubjectId','gainSubjectId','lossSubjectId','sourceVoucherLineIds','sourceEvidence']);const itemKey=requireText(row.itemKey,'外币项目键',100);if(seen.has(itemKey))throw new WmsError('外币项目键重复。',400);seen.add(itemKey);if(row.balanceSide!=='DEBIT'&&row.balanceSide!=='CREDIT')throw new WmsError('须明确货币项目借贷余额方向。',400);const amount=(key:string)=>{if(row[key]==null||row[key]==='')return null;if(typeof row[key]!=='string')throw new WmsError('外币/本位币余额须为明确金额字符串。',400);return unitsAmount(amountUnits(row[key]));};
 if(!Array.isArray(row.sourceVoucherLineIds)||!row.sourceVoucherLineIds.length||row.sourceVoucherLineIds.length>100||new Set(row.sourceVoucherLineIds).size!==row.sourceVoucherLineIds.length)throw new WmsError('须提供 1–100 个无重复的已过账货币科目分录。',400);
 const monetarySubjectId=requireText(row.monetarySubjectId,'货币科目'),gainSubjectId=requireText(row.gainSubjectId,'目标汇兑收益科目'),lossSubjectId=requireText(row.lossSubjectId,'目标汇兑损失科目');if(monetarySubjectId===gainSubjectId||monetarySubjectId===lossSubjectId)throw new WmsError('货币科目不能同时作为汇兑损益科目。',400);
 return {itemKey,foreignBalance:amount('foreignBalance'),carryingBase:amount('carryingBase'),balanceSide:row.balanceSide,monetarySubjectId,gainSubjectId,lossSubjectId,sourceVoucherLineIds:row.sourceVoucherLineIds.map(id=>requireText(id,'来源凭证分录 ID')),sourceEvidence:requireText(row.sourceEvidence,'外币子账余额与原本位币账面核对依据',1000)};
 });
}
export function calculateFxRevaluation(items:readonly FxRevaluationItem[],fx:FxRuleSnapshot){
 const missing=items.filter(row=>row.foreignBalance===null||row.carryingBase===null).map(row=>row.itemKey);
 if(missing.length)return {status:'NEEDS_DATA' as const,missing,items:[],lines:[] as {account:string;debit:string;credit:string}[]};
 const lines:{account:string;debit:string;credit:string}[]=[],calculated=items.map(row=>{
  // Each monetary item is rounded independently, preserving per-item gross differences.
  const target=convertCostSnapshot({currency:fx.sourceCurrency,lines:[{lineId:row.itemKey,allocatedAmount:row.foreignBalance!}]},fx).amount,difference=amountUnits(target)-amountUnits(row.carryingBase!);
  if(difference!==BigInt(0)){
   const monetaryDebit=row.balanceSide==='DEBIT'?difference>BigInt(0):difference<BigInt(0),amount=unitsAmount(difference<BigInt(0)?-difference:difference),offset=monetaryDebit?row.gainSubjectId:row.lossSubjectId;
   lines.push({account:row.monetarySubjectId,debit:monetaryDebit?amount:'0.000000',credit:monetaryDebit?'0.000000':amount},{account:offset,debit:monetaryDebit?'0.000000':amount,credit:monetaryDebit?amount:'0.000000'});
  }
  return {itemKey:row.itemKey,foreignBalance:row.foreignBalance,carryingBase:row.carryingBase,targetBase:target,difference:unitsAmount(difference),balanceSide:row.balanceSide};
 });
 return {status:'DRAFT' as const,missing:[],items:calculated,lines};
}
