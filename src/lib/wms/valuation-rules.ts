import {WmsError} from './contracts';
import {requireText,strictKeys} from './rules';
import {valuedActions} from './valuation-view';
export {valuedActions} from './valuation-view';
export function unitCostMicros(raw:unknown){
 if(typeof raw!=='string'||!/^\d{1,18}(?:\.\d{1,6})?$/.test(raw))throw new WmsError('单位成本须为非负十进制字符串，最多六位小数。',400);
 const [whole,fraction='']=raw.split('.');return BigInt(whole+fraction.padEnd(6,'0'));
}
export function moneyString(micros:bigint){const sign=micros<BigInt(0)?'-':'';const value=micros<BigInt(0)?-micros:micros;return `${sign}${value/BigInt(1000000)}.${(value%BigInt(1000000)).toString().padStart(6,'0')}`;}
export function valueQuantity(unitCost:string,quantity:number){if(!Number.isSafeInteger(quantity))throw new WmsError('计价数量无效。',400);const value=unitCostMicros(unitCost)*BigInt(Math.abs(quantity));if(value>=BigInt('1000000000000000000000000000000'))throw new WmsError('计价金额超出范围。',422);return moneyString(value);}
export function parseCostRule(body:Record<string,unknown>){
 strictKeys(body,['lotId','unitCost','currency','inventoryAccount','offsetAccounts','reference']);
 const currency=requireText(body.currency,'币种',3);if(!/^[A-Z]{3}$/.test(currency))throw new WmsError('币种须为三位大写字母。',400);
 const inventoryAccount=requireText(body.inventoryAccount,'库存科目');
 if(!body.offsetAccounts||typeof body.offsetAccounts!=='object'||Array.isArray(body.offsetAccounts))throw new WmsError('须显式提供各动作的对方科目。',400);
 const offsets=body.offsetAccounts as Record<string,unknown>;strictKeys(offsets,[...valuedActions]);
 const offsetAccounts=Object.fromEntries(Object.entries(offsets).map(([action,value])=>{const account=requireText(value,'对方科目');if(account===inventoryAccount)throw new WmsError('库存与对方科目须不同。',400);return [action,account];}));
 if(!Object.keys(offsetAccounts).length)throw new WmsError('至少提供一个动作的对方科目。',400);
 return {lotId:requireText(body.lotId,'批次'),unitCost:moneyString(unitCostMicros(body.unitCost)),currency,inventoryAccount,offsetAccounts,reference:requireText(body.reference,'成本依据',1000)};
}
export type ValuedEntry={movementId:string;ruleId:string;quantity:number;unitCost:string;amount:string;currency:string;debitAccount:string;creditAccount:string};
export function valuationVoucher(entries:readonly ValuedEntry[]){
 const totals=new Map<string,bigint>();
 const lines=entries.flatMap(entry=>{const amount=amountMicros(entry.amount);totals.set(entry.currency,(totals.get(entry.currency)??BigInt(0))+amount);return [{movementId:entry.movementId,account:entry.debitAccount,currency:entry.currency,debit:entry.amount,credit:'0.000000'},{movementId:entry.movementId,account:entry.creditAccount,currency:entry.currency,debit:'0.000000',credit:entry.amount}];});
 return {method:'EXPLICIT_STANDARD_COST',postingExecuted:false,lines,totals:[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([currency,value])=>({currency,debit:moneyString(value),credit:moneyString(value)}))};
}

function amountMicros(raw:string){if(!/^\d{1,24}(?:\.\d{1,6})?$/.test(raw))throw new WmsError('计价金额无效。',422);const [whole,fraction='']=raw.split('.');return BigInt(whole+fraction.padEnd(6,'0'));}
