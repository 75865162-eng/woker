import {requirePositiveQuantity,requireText,strictKeys,WmsInputError} from './rules';
export type TransferOrderLine={id:string;quantity:number;shippedQty:number;receivedQty:number};
export const transferOrderActions=['TRANSFER_ORDER_SHIP','TRANSFER_ORDER_RECEIVE','TRANSFER_ORDER_CANCEL'] as const;
function object(raw:unknown){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new WmsInputError('调拨资料须为对象。');return raw as Record<string,unknown>;}
export function transferOrderStatus(lines:readonly TransferOrderLine[]){
 if(lines.every(line=>line.receivedQty===line.quantity))return 'COMPLETED';
 if(lines.some(line=>line.receivedQty>0))return 'PARTIALLY_RECEIVED';
 if(lines.every(line=>line.shippedQty===line.quantity))return 'IN_TRANSIT';
 return lines.some(line=>line.shippedQty>0)?'PARTIALLY_SHIPPED':'DRAFT';
}
export function parseTransferOrderDraft(raw:unknown){
 const input=object(raw);strictKeys(input,['number','reason','idempotencyKey','lines']);
 if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>100)throw new WmsInputError('调拨明细须为 1-100 行。');
 const seen=new Set<string>();
 const lines=input.lines.map(value=>{const row=object(value);strictKeys(row,['sourceBalanceId','targetLocationId','quantity']);const sourceBalanceId=requireText(row.sourceBalanceId,'来源余额'),targetLocationId=requireText(row.targetLocationId,'目的库位'),key=JSON.stringify([sourceBalanceId,targetLocationId]);if(seen.has(key))throw new WmsInputError('同一来源及目的库位请合并填写。');seen.add(key);return {sourceBalanceId,targetLocationId,quantity:requirePositiveQuantity(row.quantity)};}).sort((a,b)=>a.sourceBalanceId.localeCompare(b.sourceBalanceId)||a.targetLocationId.localeCompare(b.targetLocationId));
 return {number:requireText(input.number,'调拨单号'),reason:requireText(input.reason,'调拨依据',1000),idempotencyKey:requireText(input.idempotencyKey,'幂等键'),lines};
}
export function parseTransferOrderPayload(raw:unknown){
 const value=object(raw);const action=value.action;
 if(action==='TRANSFER_ORDER_CANCEL'){strictKeys(value,['action','reason']);return {action,reason:requireText(value.reason,'取消原因',1000)} as const;}
 if(action!=='TRANSFER_ORDER_SHIP'&&action!=='TRANSFER_ORDER_RECEIVE')throw new WmsInputError('调拨动作无效。');
 strictKeys(value,['action','lines','reference']);
 if(!Array.isArray(value.lines)||!value.lines.length||value.lines.length>100)throw new WmsInputError('调拨作业须为 1-100 行。');
 const seen=new Set<string>();const lines=value.lines.map(raw=>{const row=object(raw);strictKeys(row,['lineId','quantity']);const lineId=requireText(row.lineId,'调拨明细');if(seen.has(lineId))throw new WmsInputError('作业明细重复。');seen.add(lineId);return {lineId,quantity:requirePositiveQuantity(row.quantity)};}).sort((a,b)=>a.lineId.localeCompare(b.lineId));
 return {action,lines,reference:requireText(value.reference,action==='TRANSFER_ORDER_SHIP'?'发运凭据':'签收凭据',1000)} as const;
}
export function validateTransferQuantities(action:'TRANSFER_ORDER_SHIP'|'TRANSFER_ORDER_RECEIVE',selected:readonly{lineId:string;quantity:number}[],lines:readonly TransferOrderLine[]){
 for(const item of selected){const line=lines.find(line=>line.id===item.lineId);if(!line)throw new WmsInputError('明细不属于本调拨单。',422);const remaining=action==='TRANSFER_ORDER_SHIP'?line.quantity-line.shippedQty:line.shippedQty-line.receivedQty;if(item.quantity>remaining)throw new WmsInputError(action==='TRANSFER_ORDER_SHIP'?'发出超过计划剩余量。':'签收超过在途剩余量。',422);}
}
