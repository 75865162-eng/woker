import {createHash} from 'node:crypto';
import {scoped,auditWms} from './access';
import {WmsError,type WmsScope,type WmsCommandInput} from './contracts';
import {activeLocation,ensureBalances,lockAggregate,lockKey,move,balanceId,snapshot,type Tx} from './repository';
import {availableQuantity} from './rules';
import {parseTransferOrderDraft,transferOrderStatus,validateTransferQuantities} from './transfer-order-rules';

export async function createTransferOrder(tx:Tx,scope:WmsScope,raw:unknown){
 const input=parseTransferOrderDraft(raw),identity=scoped(scope),requestHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 await lockKey(tx,JSON.stringify(['transfer-order',identity,input.idempotencyKey]));
 const prior=await tx.wmsTransferOrder.findFirst({where:{...identity,idempotencyKey:input.idempotencyKey},include:{lines:true}});
 if(prior){if(prior.requestHash!==requestHash||prior.createdBy!==scope.actorUserId)throw new WmsError('调拨草稿幂等键冲突。');return prior;}
 const sourceTotals=new Map<string,number>();
 const lines=[];
 for(const row of input.lines){
  const source=await tx.wmsStockBalance.findFirst({where:{...identity,id:row.sourceBalanceId}});if(!source)throw new WmsError('来源余额不存在。',404);
  await activeLocation(tx,scope,source.locationId,source.warehouseId,'STORAGE');
  const target=await activeLocation(tx,scope,row.targetLocationId,undefined,'STORAGE');
  if(source.locationId===target.id)throw new WmsError('调拨目的须与来源不同。',422);
  const total=(sourceTotals.get(source.id)??0)+row.quantity;sourceTotals.set(source.id,total);if(total>availableQuantity(snapshot(source)))throw new WmsError('计划合计超过来源可用数量；草稿不冻结库存。',422);
  lines.push({...identity,...row,id:crypto.randomUUID(),targetWarehouseId:target.warehouseId});
 }
 const {lines:_lines,...header}=input;void _lines;const id=crypto.randomUUID();
 await tx.wmsTransferOrder.create({data:{...identity,...header,id,requestHash,createdBy:scope.actorUserId}});
 await tx.wmsTransferOrderLine.createMany({data:lines.map(row=>({...row,orderId:id}))});
 return tx.wmsTransferOrder.findUniqueOrThrow({where:{id},include:{lines:true}});
}
export async function validateTransferOrderAction(tx:Tx,scope:WmsScope,input:WmsCommandInput){
 const payload=input.payload;if(payload.action!=='TRANSFER_ORDER_SHIP'&&payload.action!=='TRANSFER_ORDER_RECEIVE'&&payload.action!=='TRANSFER_ORDER_CANCEL')throw new WmsError('非调拨单动作。',400);
 await lockAggregate(tx,scope,input.aggregateId,'transferOrder');
 const order=await tx.wmsTransferOrder.findFirst({where:{...scoped(scope),id:input.aggregateId},include:{lines:{orderBy:{id:'asc'},include:{source:true}}}});
 if(!order)throw new WmsError('调拨单不存在。',404);
 if(order.revision!==input.expectedRevision||['COMPLETED','CANCELLED'].includes(order.status))throw new WmsError('调拨单版本已变化或已结束。');
 if(payload.action!=='TRANSFER_ORDER_RECEIVE'&&order.createdBy!==scope.actorUserId)throw new WmsError('仅创建人可发出或取消调拨。',403);
 if(payload.action==='TRANSFER_ORDER_CANCEL'){
  if(order.lines.some(line=>line.shippedQty!==0))throw new WmsError('已发出的调拨不可取消；须按实际签收处理。');
  return {order,selected:[]};
 }
 validateTransferQuantities(payload.action,payload.lines,order.lines);
 const selected=payload.lines.map(item=>({...order.lines.find(line=>line.id===item.lineId)!,operationQty:item.quantity}));
 const totals=new Map<string,number>();
 for(const line of selected){
  if(payload.action==='TRANSFER_ORDER_SHIP')await activeLocation(tx,scope,line.source.locationId,line.source.warehouseId,'STORAGE');
  await activeLocation(tx,scope,line.targetLocationId,line.targetWarehouseId,'STORAGE');
  if(payload.action==='TRANSFER_ORDER_SHIP')totals.set(line.source.id,(totals.get(line.source.id)??0)+line.operationQty);
 }
 for(const [id,quantity] of totals){const source=selected.find(line=>line.source.id===id)!.source;if(quantity>availableQuantity(snapshot(source)))throw new WmsError('发出合计超过当前可用数量。',422);}
 return {order,selected};
}
export async function executeTransferOrder(tx:Tx,scope:WmsScope,input:WmsCommandInput,commandId:string){
 const {order,selected}=await validateTransferOrderAction(tx,scope,input),payload=input.payload;
 if(payload.action==='TRANSFER_ORDER_CANCEL'){
  const updated=await tx.wmsTransferOrder.update({where:{id:order.id},data:{status:'CANCELLED',revision:{increment:1}}});
  await auditWms(tx,scope,'transfer-order.cancel',order.id,{reason:payload.reason});
  return {revision:updated.revision,movementIds:[],transferChange:{status:'CANCELLED',reason:payload.reason}};
 }
 if(payload.action!=='TRANSFER_ORDER_SHIP'&&payload.action!=='TRANSFER_ORDER_RECEIVE')throw new WmsError('非调拨单动作。',400);
 await ensureBalances(tx,scope,selected.map(line=>payload.action==='TRANSFER_ORDER_SHIP'?{locationId:line.source.locationId,warehouseId:line.source.warehouseId,lotId:line.source.lotId}:{locationId:line.targetLocationId,warehouseId:line.targetWarehouseId,lotId:line.source.lotId}));
 const movementIds:string[]=[];
 for(const line of selected){
  const id=payload.action==='TRANSFER_ORDER_SHIP'?line.source.id:balanceId(scope,line.targetLocationId,line.source.lotId);
  const balance=await tx.wmsStockBalance.findFirstOrThrow({where:{...scoped(scope),id}});
  if(payload.action==='TRANSFER_ORDER_SHIP'&&line.operationQty>availableQuantity(snapshot(balance)))throw new WmsError('来源库存已不足。',422);
  const movement=await move(tx,scope,commandId,movementIds.length,balance,{onHand:payload.action==='TRANSFER_ORDER_SHIP'?-line.operationQty:line.operationQty},{action:payload.action,sourceType:'TRANSFER_ORDER',sourceId:order.id,sourceLineId:line.id});movementIds.push(movement.id);
  await tx.wmsTransferOrderLine.update({where:{id:line.id},data:payload.action==='TRANSFER_ORDER_SHIP'?{shippedQty:{increment:line.operationQty}}:{receivedQty:{increment:line.operationQty}}});
 }
 const lines=await tx.wmsTransferOrderLine.findMany({where:{...scoped(scope),orderId:order.id}}),status=transferOrderStatus(lines);
 const updated=await tx.wmsTransferOrder.update({where:{id:order.id},data:{status,revision:{increment:1}}});
 return {revision:updated.revision,movementIds,transferChange:{reference:payload.reference,status,lines:lines.map(line=>({lineId:line.id,quantity:line.quantity,shippedQty:line.shippedQty,receivedQty:line.receivedQty,inTransitQty:line.shippedQty-line.receivedQty}))}};
}
