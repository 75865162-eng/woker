import {WmsError} from '@/lib/wms/contracts';
import {requireText,strictKeys} from '@/lib/wms/rules';
import {amountUnits,unitsAmount,validFinanceDate} from './open-item-rules';
export type VoucherImportRow={sourceRow:number;sourceSheet:string;voucherKey:string;date:string;subjectCode:string;debit:string;credit:string;memo:string};
export type VoucherImportGroup={voucherKey:string;date:string;lines:VoucherImportRow[]};
/** Shared normalized row contract for JSON staging and the strict XLSX template parser. */
export function parseVoucherImportRows(value:unknown):VoucherImportRow[]{
 if(!Array.isArray(value)||!value.length||value.length>1000)throw new WmsError('导入须包含 1–1000 行。',400);
 const keys=new Set<string>();
 return value.map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new WmsError('导入行无效。',400);
  const row=raw as Record<string,unknown>;strictKeys(row,['sourceRow','sourceSheet','voucherKey','date','subjectCode','debit','credit','memo']);
  if(typeof row.sourceRow!=='number'||!Number.isSafeInteger(row.sourceRow)||row.sourceRow<1)throw new WmsError('来源行须为正整数。',400);
  const sourceSheet=requireText(row.sourceSheet,'来源 sheet',100),voucherKey=requireText(row.voucherKey,'来源凭证键',100),subjectCode=requireText(row.subjectCode,'正式科目编码',40),date=requireText(row.date,'会计日期');validFinanceDate(date);
  const key=JSON.stringify([sourceSheet,row.sourceRow]);if(keys.has(key))throw new WmsError('来源 sheet/row 重复。',400);keys.add(key);
  if(typeof row.debit!=='string'||typeof row.credit!=='string')throw new WmsError('借贷金额须为十进制字符串。',400);
  const debit=amountUnits(row.debit),credit=amountUnits(row.credit);if((debit===BigInt(0))===(credit===BigInt(0)))throw new WmsError('每行须恰有一方正金额。',422);
  if(row.memo!=null&&(typeof row.memo!=='string'||row.memo.length>500))throw new WmsError('分录摘要无效。',400);
  const memo=typeof row.memo==='string'?row.memo.trim():'';
  return {sourceRow:row.sourceRow,sourceSheet,voucherKey,date,subjectCode,debit:unitsAmount(debit),credit:unitsAmount(credit),memo};
 });
}
export function groupVoucherImportRows(rows:VoucherImportRow[]){
 const groups=new Map<string,VoucherImportGroup>(),errors:Array<{voucherKey:string;message:string}>=[];
 for(const row of rows){const group=groups.get(row.voucherKey)??{voucherKey:row.voucherKey,date:row.date,lines:[]};group.lines.push(row);groups.set(row.voucherKey,group);}
 for(const group of groups.values()){
  if(group.lines.some(row=>row.date!==group.date))errors.push({voucherKey:group.voucherKey,message:'同凭证日期不一致。'});
  if(group.lines.length<2||group.lines.length>200)errors.push({voucherKey:group.voucherKey,message:'每张凭证须有 2–200 行。'});
  if(group.lines.reduce((sum,row)=>sum+amountUnits(row.debit)-amountUnits(row.credit),BigInt(0))!==BigInt(0))errors.push({voucherKey:group.voucherKey,message:'凭证借贷不平。'});
 }
 if(groups.size>100)throw new WmsError('单批最多 100 张凭证。',400);
 return {groups:[...groups.values()],errors};
}
