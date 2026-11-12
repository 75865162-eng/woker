import {requireText,strictKeys,WmsInputError} from '@/lib/wms/rules';
type Snapshot={currency:string;lines:readonly{lineId:string;allocatedAmount:string}[]};
export type FxRuleSnapshot={sourceCurrency:string;targetCurrency:string;rate:string;observedAt:string;reference:string;evidence:string};
export function parseFxRuleSnapshot(raw:unknown):FxRuleSnapshot{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new WmsInputError('汇率快照须为对象。');
 const input=raw as Record<string,unknown>;strictKeys(input,['sourceCurrency','targetCurrency','rate','observedAt','reference','evidence']);
 const sourceCurrency=requireText(input.sourceCurrency,'原币'),targetCurrency=requireText(input.targetCurrency,'目标币');
 if(!/^[A-Z]{3}$/.test(sourceCurrency)||!/^[A-Z]{3}$/.test(targetCurrency)||sourceCurrency===targetCurrency)throw new WmsInputError('换算须提供不同的三位大写币种。');
 if(typeof input.rate!=='string'||!/^\d{1,12}(?:\.\d{1,12})?$/.test(input.rate))throw new WmsInputError('汇率须为正十进制字符串，最多十二位小数。');
 const [whole,fraction='']=input.rate.split('.');if(BigInt(whole+fraction)===BigInt(0))throw new WmsInputError('汇率须大于零。');
 const observedAt=requireText(input.observedAt,'汇率时点');if(!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(observedAt)||!Number.isFinite(Date.parse(observedAt))||new Date(observedAt.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==observedAt.slice(0,10))throw new WmsInputError('汇率时点须含有效时区。');
 return {sourceCurrency,targetCurrency,rate:`${BigInt(whole)}${fraction.replace(/0+$/,'')?'.'+fraction.replace(/0+$/,''):''}`,observedAt:new Date(observedAt).toISOString(),reference:requireText(input.reference,'汇率来源编号'),evidence:requireText(input.evidence,'汇率依据',2000)};
}
/** Rate is target units per source unit. Round the document half-up, reconcile line tails. */
export function convertCostSnapshot(snapshot:Snapshot,fx:FxRuleSnapshot){
 if(snapshot.currency!==fx.sourceCurrency||!snapshot.lines.length)throw new WmsInputError('费用币种与汇率方向不符。');
 const [whole,fraction='']=fx.rate.split('.'),denominator=BigInt(10)**BigInt(fraction.length),numerator=BigInt(whole+fraction),seen=new Set<string>();
 const rows=snapshot.lines.map(row=>{
  if(seen.has(row.lineId)||!/^\d{1,24}(?:\.\d{1,6})?$/.test(row.allocatedAmount))throw new WmsInputError('换算明细重复或金额无效。');seen.add(row.lineId);
  const [whole,fraction='']=row.allocatedAmount.split('.'),value=BigInt(whole)*BigInt(1000000)+BigInt(fraction.padEnd(6,'0'));
  return {lineId:row.lineId,raw:value*numerator,converted:value*numerator/denominator};
 });
 const rawTotal=rows.reduce((sum,row)=>sum+row.raw,BigInt(0)),total=(rawTotal+denominator/BigInt(2))/denominator;
 const remainder=total-rows.reduce((sum,row)=>sum+row.converted,BigInt(0));
 const ranked=[...rows].sort((a,b)=>a.raw%denominator===b.raw%denominator?a.lineId.localeCompare(b.lineId):a.raw%denominator>b.raw%denominator?-1:1);
 for(let i=0;i<Number(remainder);i++)ranked[i].converted++;
 const amount=(value:bigint)=>`${value/BigInt(1000000)}.${String(value%BigInt(1000000)).padStart(6,'0')}`;
 return {currency:fx.targetCurrency,amount:amount(total),lines:rows.sort((a,b)=>a.lineId.localeCompare(b.lineId)).map(row=>({lineId:row.lineId,allocatedAmount:amount(row.converted)}))};
}
