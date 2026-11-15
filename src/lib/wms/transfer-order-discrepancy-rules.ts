import {requirePositiveQuantity,requireText,strictKeys,WmsInputError} from './rules';
import type {TransferOrderLine} from './transfer-order-rules';

export const transferDiscrepancyCategories=['SHORT_RECEIVED','DAMAGED','REJECTED'] as const;
export type TransferDiscrepancyCategory=typeof transferDiscrepancyCategories[number];
export type TransferDiscrepancyItem={category:TransferDiscrepancyCategory;quantity:number;evidence:string};
export type TransferDiscrepancyLine={lineId:string;discrepancies:TransferDiscrepancyItem[]};
export type TransferDiscrepancyPayload={action:'TRANSFER_ORDER_DISCREPANCY';lines:TransferDiscrepancyLine[];reference:string;reason:string};

function object(raw:unknown){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new WmsInputError('差异资料须为对象。');return raw as Record<string,unknown>;}

// Parses a discrepancy command. It never mutates shippedQty/receivedQty: the
// net in-transit quantity is only reclassified into discrepancy categories.
export function parseTransferDiscrepancyPayload(raw:unknown):TransferDiscrepancyPayload{
 const value=object(raw);
 if(value.action!=='TRANSFER_ORDER_DISCREPANCY')throw new WmsInputError('差异动作无效。');
 strictKeys(value,['action','lines','reference','reason']);
 if(!Array.isArray(value.lines)||!value.lines.length||value.lines.length>100)throw new WmsInputError('差异明细须为 1-100 行。');
 const seenLines=new Set<string>();
 const lines=value.lines.map(rawLine=>{
  const row=object(rawLine);
  strictKeys(row,['lineId','discrepancies']);
  const lineId=requireText(row.lineId,'调拨明细');
  if(seenLines.has(lineId))throw new WmsInputError('差异明细重复。');
  seenLines.add(lineId);
  if(!Array.isArray(row.discrepancies)||!row.discrepancies.length||row.discrepancies.length>100)throw new WmsInputError('差异分类须为 1-100 行。');
  const seenCategories=new Set<string>();
  const discrepancies=row.discrepancies.map(rawItem=>{
   const item=object(rawItem);
   strictKeys(item,['category','quantity','evidence']);
   const category=item.category;
   if(typeof category!=='string'||!transferDiscrepancyCategories.includes(category as TransferDiscrepancyCategory))throw new WmsInputError('差异分类无效。');
   if(seenCategories.has(category))throw new WmsInputError('同一明细差异分类重复。');
   seenCategories.add(category);
   return {category:category as TransferDiscrepancyCategory,quantity:requirePositiveQuantity(item.quantity,'差异数量'),evidence:requireText(item.evidence,'差异凭据',1000)};
  }).sort((a,b)=>a.category.localeCompare(b.category));
  return {lineId,discrepancies};
 }).sort((a,b)=>a.lineId.localeCompare(b.lineId));
 return {action:'TRANSFER_ORDER_DISCREPANCY',lines,reference:requireText(value.reference,'签收差异凭据',1000),reason:requireText(value.reason,'差异原因',1000)};
}

export function sumDiscrepancyByCategory(items:readonly {category:TransferDiscrepancyCategory;quantity:number}[]){
 const totals:Record<TransferDiscrepancyCategory,number>={SHORT_RECEIVED:0,DAMAGED:0,REJECTED:0};
 for(const item of items)totals[item.category]+=item.quantity;
 return totals;
}

// Whole-batch validation: for every requested line the category total must
// equal the current net in-transit quantity (shipped-received-discrepancy).
export function validateTransferDiscrepancy(lines:readonly TransferDiscrepancyLine[],current:readonly TransferOrderLine[]){
 for(const line of lines){
  const state=current.find(row=>row.id===line.lineId);
  if(!state)throw new WmsInputError('差异明细不属于本调拨单。',422);
  const netInTransit=state.shippedQty-state.receivedQty-(state.discrepancyQty??0);
  const total=line.discrepancies.reduce((sum,item)=>sum+item.quantity,0);
  if(total!==netInTransit)throw new WmsInputError('分类合计须恰好等于当前净在途量。',422);
 }
}
