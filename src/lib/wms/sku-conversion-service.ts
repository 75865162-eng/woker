import { scoped } from './access';
import { WmsError, type WmsScope, type WmsCommandInput } from './contracts';
import { activeLocation, balanceId, ensureBalances, lockKey, move, snapshot, type Tx } from './repository';
import { availableQuantity } from './rules';

/** Wimoor's same-warehouse, equal-quantity conversion. Lots retain their product identity. */
export async function validateSkuConversion(tx: Tx, scope: WmsScope, input: WmsCommandInput) {
  const payload = input.payload;
  if (payload.action !== 'SKU_CONVERT') throw new WmsError('非 SKU 转换动作。', 400);
  const source = await tx.wmsStockBalance.findFirst({ where: { ...scoped(scope), id: input.aggregateId }, include: { lot: true } });
  if (!source) throw new WmsError('转换来源库存不存在。', 404);
  await activeLocation(tx, scope, source.locationId, source.warehouseId, 'STORAGE');
  const targetLot = await tx.wmsLot.findFirst({ where: { ...scoped(scope), id: payload.targetLotId } });
  if (!targetLot || targetLot.productRecordId === source.lot.productRecordId) throw new WmsError('目标批次须属于当前工作区的另一商品。', 422);
  if (source.revision !== input.expectedRevision) throw new WmsError('转换来源库存已变更。');
  if (payload.quantity > availableQuantity(snapshot(source))) throw new WmsError('转换数量超过可用库存。', 422);
  return { source, targetLot };
}
export async function executeSkuConversion(tx: Tx, scope: WmsScope, input: WmsCommandInput, commandId: string) {
  const { source, targetLot } = await validateSkuConversion(tx, scope, input);
  const payload = input.payload;
  if (payload.action !== 'SKU_CONVERT') throw new WmsError('非 SKU 转换动作。', 400);
  await ensureBalances(tx, scope, [source, { locationId: source.locationId, warehouseId: source.warehouseId, lotId: targetLot.id }]);
  const locked = await tx.wmsStockBalance.findFirstOrThrow({ where: { ...scoped(scope), id: source.id } });
  if (locked.revision !== input.expectedRevision || payload.quantity > availableQuantity(snapshot(locked))) throw new WmsError('转换来源库存已变更。');
  const target = await tx.wmsStockBalance.findFirstOrThrow({ where: { ...scoped(scope), id: balanceId(scope, source.locationId, targetLot.id) } });
  const facts = { action: payload.action, sourceType: 'SKU_CONVERSION', sourceId: commandId };
  const debit = await move(tx, scope, commandId, 0, locked, { onHand: -payload.quantity }, facts);
  const credit = await move(tx, scope, commandId, 1, target, { onHand: payload.quantity }, facts);
  return { revision: locked.revision + 1, targetBalanceId: target.id, movementIds: [debit.id, credit.id], conversion: { reason: payload.reason, quantity: payload.quantity, sourceLotId: source.lotId, sourceProductRecordId: source.lot.productRecordId, targetLotId: targetLot.id, targetProductRecordId: targetLot.productRecordId } };
}

export async function validateConversionReversal(tx: Tx, scope: WmsScope, input: WmsCommandInput) {
  if(input.payload.action!=='SKU_CONVERSION_REVERSE')throw new WmsError('非转换冲销动作。',400);
  await lockKey(tx,JSON.stringify(['wms-conversion-reverse',scoped(scope),input.aggregateId]));
  const original=await tx.wmsCommand.findFirst({where:{...scoped(scope),id:input.aggregateId,action:'SKU_CONVERT'}});
  if(!original||original.actorUserId!==scope.actorUserId)throw new WmsError('仅原转换申请人可申请冲销。',403);
  if(await tx.wmsCommand.findFirst({where:{...scoped(scope),action:'SKU_CONVERSION_REVERSE',result:{path:['reversesCommandId'],equals:original.id}}}))throw new WmsError('转换已冲销，不可重复冲销。');
  const result=original.result as {targetBalanceId?:string;conversion?:{quantity:number;sourceLotId:string;targetLotId:string}};
  if(!result.targetBalanceId||!result.conversion)throw new WmsError('转换流水证据不完整。');
  const source=await tx.wmsStockBalance.findFirst({where:{...scoped(scope),id:result.targetBalanceId}});
  const target=await tx.wmsStockBalance.findFirst({where:{...scoped(scope),id:original.aggregateId}});
  if(!source||!target||source.lotId!==result.conversion.targetLotId||target.lotId!==result.conversion.sourceLotId||source.locationId!==target.locationId)throw new WmsError('原转换库存证据不匹配。');
  await activeLocation(tx,scope,source.locationId,source.warehouseId,'STORAGE');
  if(source.revision!==input.expectedRevision||availableQuantity(snapshot(source))<result.conversion.quantity)throw new WmsError('转换目标库存已变化或不足以完整冲销。');
  return {source,target,original,quantity:result.conversion.quantity};
}
export async function executeConversionReversal(tx:Tx,scope:WmsScope,input:WmsCommandInput,commandId:string){
 const {source,target,original,quantity}=await validateConversionReversal(tx,scope,input);
 await ensureBalances(tx,scope,[source,target]);
 const locked=await tx.wmsStockBalance.findFirstOrThrow({where:{...scoped(scope),id:source.id}}),destination=await tx.wmsStockBalance.findFirstOrThrow({where:{...scoped(scope),id:target.id}});
 if(locked.revision!==input.expectedRevision||availableQuantity(snapshot(locked))<quantity)throw new WmsError('转换目标库存已变化或不足以完整冲销。');
 const facts={action:'SKU_CONVERSION_REVERSE',sourceType:'SKU_CONVERSION_REVERSAL',sourceId:original.id};
 const debit=await move(tx,scope,commandId,0,locked,{onHand:-quantity},facts),credit=await move(tx,scope,commandId,1,destination,{onHand:quantity},facts);
 return {revision:locked.revision+1,movementIds:[debit.id,credit.id],reversesCommandId:original.id};
}
