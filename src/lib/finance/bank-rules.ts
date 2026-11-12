import {amountUnits,unitsAmount,validFinanceDate} from './open-item-rules';
import {WmsError} from '@/lib/wms/contracts';
import {requireText,strictKeys} from '@/lib/wms/rules';
export function signedBankUnits(raw:unknown){if(typeof raw!=='string')throw new WmsError('银行金额须为有符号十进制字符串。',400);return raw.startsWith('-')?-amountUnits(raw.slice(1)):amountUnits(raw);}
export function parseBankStatementRows(raw:unknown){
 if(!Array.isArray(raw)||!raw.length||raw.length>500)throw new WmsError('银行账单须有 1–500 行。',400);const refs=new Set<string>(),origins=new Set<string>();
 return raw.map(value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new WmsError('银行账单行无效。',400);const row=value as Record<string,unknown>;strictKeys(row,['reference','date','amount','evidence','sourceSheet','sourceRow']);
  const reference=requireText(row.reference,'银行唯一流水号',120),date=validFinanceDate(row.date),amount=signedBankUnits(row.amount);if(amount===BigInt(0))throw new WmsError('银行流水金额不能为零。',400);
  const sourceSheet=requireText(row.sourceSheet,'来源 sheet',100);if(typeof row.sourceRow!=='number'||!Number.isSafeInteger(row.sourceRow)||row.sourceRow<1)throw new WmsError('银行来源行号无效。',400);
  const origin=JSON.stringify([sourceSheet,row.sourceRow]);if(refs.has(reference)||origins.has(origin))throw new WmsError('银行流水号或来源行重复。',400);refs.add(reference);origins.add(origin);
  return {reference,date,amount:unitsAmount(amount),evidence:requireText(row.evidence,'银行账单依据',1000),sourceSheet,sourceRow:row.sourceRow};
 });
}
export function validateBankMatch(amount:string,lines:readonly{debit:string;credit:string}[]){
 if(!lines.length||lines.length>200)throw new WmsError('银行匹配须选择 1–200 条凭证分录。',400);
 const total=lines.reduce((sum,line)=>sum+signedBankUnits(line.debit)-signedBankUnits(line.credit),BigInt(0));
 if(total!==signedBankUnits(amount))throw new WmsError('银行流水金额与所选过账分录净额不一致。',422);return unitsAmount(total);
}
