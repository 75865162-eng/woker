import {scoped} from './access';
import {WmsError,type WmsScope,type WmsCommandInput} from './contracts';
import {lockAggregate,activeLocation,move,snapshot,type Tx} from './repository';
import {availableQuantity,requireText,strictKeys} from './rules';
import {positiveDecimal} from './catalog-details-service';
import {consumableQuantity} from './consumable-rules';
export async function createConsumable(tx:Tx,scope:WmsScope,body:Record<string,unknown>){
 strictKeys(body,['outboundLineId','productRecordId','units']);
 const outboundLineId=requireText(body.outboundLineId,'出库需求行'),productRecordId=requireText(body.productRecordId,'耗材商品'),units=positiveDecimal(body.units,'单件耗用量');
 const candidate=await tx.wmsOutboundLine.findFirst({where:{...scoped(scope),id:outboundLineId},select:{outboundId:true}});if(!candidate)throw new WmsError('出库需求行不存在。',404);
 await lockAggregate(tx,scope,candidate.outboundId,'outbound');await lockAggregate(tx,scope,outboundLineId,'outboundLine');
 const line=await tx.wmsOutboundLine.findFirstOrThrow({where:{...scoped(scope),id:outboundLineId},include:{outbound:true}});
 if(line.outbound.status!=='DRAFT'||line.outbound.createdBy!==scope.actorUserId)throw new WmsError('仅创建人可在出库草稿中配置耗材。',409);
 if(productRecordId===line.productRecordId||!await tx.productRecord.findFirst({where:{...scoped(scope),id:productRecordId}}))throw new WmsError('耗材须为当前工作区另一商品。',422);
 consumableQuantity(units.toFixed(),line.requestedQty);
 const result=await tx.wmsOutboundConsumable.create({data:{...scoped(scope),id:crypto.randomUUID(),warehouseId:line.warehouseId,outboundLineId,productRecordId,units,createdBy:scope.actorUserId}});
 await tx.wmsOutbound.update({where:{id:line.outboundId},data:{revision:{increment:1}}});
 return result;
}
export async function validateConsumableIssue(tx:Tx,scope:WmsScope,input:WmsCommandInput){
 const payload=input.payload;if(payload.action!=='CONSUMABLE_ISSUE')throw new WmsError('非耗材发料动作。',400);
 const candidate=await tx.wmsOutboundConsumable.findFirst({where:{...scoped(scope),id:input.aggregateId},include:{line:{select:{outboundId:true}}}});if(!candidate)throw new WmsError('耗材规则不存在。',404);
 await lockAggregate(tx,scope,candidate.line.outboundId,'outbound');await lockAggregate(tx,scope,candidate.outboundLineId,'outboundLine');await lockAggregate(tx,scope,candidate.id,'consumable');
 const rule=await tx.wmsOutboundConsumable.findFirstOrThrow({where:{...scoped(scope),id:candidate.id}});
 if(rule.revision!==input.expectedRevision)throw new WmsError('耗材发料版本已变更。');
 const dispatched=await tx.wmsReservation.aggregate({where:{...scoped(scope),outboundLineId:rule.outboundLineId},_sum:{dispatchedQty:true}});
 if(rule.accountedMainQty+payload.mainQuantity>(dispatched._sum.dispatchedQty??0))throw new WmsError('耗材计量主商品数量超过已实际出库且未发料数量。',422);
 const quantity=consumableQuantity(rule.units.toFixed(),payload.mainQuantity);
 consumableQuantity(rule.units.toFixed(),rule.accountedMainQty+payload.mainQuantity);
 await lockAggregate(tx,scope,payload.sourceBalanceId,'balance');
 const balance=await tx.wmsStockBalance.findFirst({where:{...scoped(scope),id:payload.sourceBalanceId},include:{lot:{select:{productRecordId:true}}}});
 if(!balance||balance.warehouseId!==rule.warehouseId||balance.lot.productRecordId!==rule.productRecordId)throw new WmsError('耗材来源商品或仓库不匹配。',422);
 await activeLocation(tx,scope,balance.locationId,balance.warehouseId,'STORAGE');
 if(quantity>availableQuantity(snapshot(balance)))throw new WmsError('耗材可用库存不足。',422);
 return {rule,balance,quantity};
}
export async function executeConsumableIssue(tx:Tx,scope:WmsScope,input:WmsCommandInput,commandId:string){
 const {rule,balance,quantity}=await validateConsumableIssue(tx,scope,input);if(input.payload.action!=='CONSUMABLE_ISSUE')throw new WmsError('非耗材动作。',400);
 const movement=await move(tx,scope,commandId,0,balance,{onHand:-quantity},{action:input.payload.action,sourceType:'OUTBOUND_CONSUMABLE',sourceId:rule.id,sourceLineId:rule.outboundLineId});
 const updated=await tx.wmsOutboundConsumable.update({where:{id:rule.id},data:{accountedMainQty:{increment:input.payload.mainQuantity},issuedQty:{increment:quantity},revision:{increment:1}}});
 return {revision:updated.revision,movementIds:[movement.id],consumableChange:{units:rule.units.toFixed(),mainQuantity:input.payload.mainQuantity,issuedQuantity:quantity,reason:input.payload.reason,outboundLineId:rule.outboundLineId}};
}
