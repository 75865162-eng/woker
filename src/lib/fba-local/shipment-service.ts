import {createHash} from 'node:crypto';
import type {FbaLocalPlan} from '@prisma/client';
import {scoped} from '@/lib/wms/access';
import {lockKey,type Tx} from '@/lib/wms/repository';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import {requireText,strictKeys} from '@/lib/wms/rules';
import {readObservations} from '@/lib/amazon-sync/observations-query';
import {inboundIdentifier} from '@/lib/amazon-sync/inbound';
import {object} from './rules';
import {parseShipmentMapping,type ShipmentSourceItem} from './shipment-rules';
type Plan=FbaLocalPlan&{lines:{id:string;quantity:number}[]};
const hash=(raw:unknown)=>createHash('sha256').update(JSON.stringify(raw)).digest('hex');
function optionalString(raw:unknown){if(raw===null||raw===undefined)return null;if(typeof raw!=='string'||!raw.trim()||raw.length>500)throw new WmsError('来源文本字段无效。',409);return raw;}
function sourceQuantity(raw:unknown){
  if(typeof raw!=='string'||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1||Number(raw)>500000)throw new WmsError('来源货件数量无效，须重新同步。',409);
  return Number(raw);
}
/** Reads through the same ERP observation query used by page/MCP; pins its current published version. */
export async function previewShipment(tx:Tx,scope:WmsScope,plan:Plan,raw:unknown){
  const input=object(raw);strictKeys(input,['shipmentId']);
  let shipmentId:string;try{shipmentId=inboundIdentifier(input.shipmentId);}catch{throw new WmsError('Amazon 货件 ID 无效。',400);}
  await tx.$queryRaw`SELECT id FROM "AmazonSyncDataSource" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND "sellerAccountId"=${plan.sellerAccountId} AND "marketplaceId"=${plan.marketplaceId} AND resource='fulfillment' FOR SHARE`;
  const source=await tx.amazonSyncDataSource.findFirst({where:{...scoped(scope),sellerAccountId:plan.sellerAccountId,marketplaceId:plan.marketplaceId,resource:'fulfillment'},select:{id:true,activeRunId:true}});
  if(!source?.activeRunId)throw new WmsError('当前店铺站点尚无已发布的 FBA 同步版本。',409);
  const params=new URLSearchParams({resource:'fulfillment',sellerAccountId:plan.sellerAccountId,marketplaceId:plan.marketplaceId,sourceId:source.id,runId:source.activeRunId,kind:'INBOUND_SHIPMENT',shipmentId});
  const header=await readObservations(scoped(scope),params,scope.actorUserId,tx);
  if(!header.run?.paginationComplete||header.rows.length!==1||header.pagination.total!==1)throw new WmsError('货件不存在、来源不唯一或同步版本尚未完整发布。',409);
  const row=header.rows[0],facts=object(row.facts),inboundPlanId=inboundIdentifier(facts.inboundPlanId);
  if(facts.shipmentId!==shipmentId)throw new WmsError('来源货件身份不一致。',409);
  const planParams=new URLSearchParams(params);planParams.delete('shipmentId');planParams.set('kind','INBOUND_PLAN');planParams.set('inboundPlanId',inboundPlanId);
  const planRows=await readObservations(scoped(scope),planParams,scope.actorUserId,tx);
  const planFacts=planRows.rows.length===1?object(planRows.rows[0].facts):null;
  if(planRows.pagination.total!==1||!planFacts||!Array.isArray(planFacts.marketplaceIds)||planFacts.marketplaceIds.length!==1||planFacts.marketplaceIds[0]!==plan.marketplaceId)throw new WmsError('Amazon 入库计划没有与当前站点一致的来源证据。',409);
  params.set('kind','INBOUND_SHIPMENT_ITEM');params.set('inboundPlanId',inboundPlanId);
  const first=await readObservations(scoped(scope),params,scope.actorUserId,tx);
  if(first.pagination.total<1||first.pagination.total>500)throw new WmsError('货件明细缺失或超过本地关联容量（500 行）。',409);
  const items:ShipmentSourceItem[]=[];
  const append=(rows:typeof first.rows)=>{for(const item of rows){const values=object(item.facts);
    if(values.shipmentId!==shipmentId||values.inboundPlanId!==inboundPlanId||values.quantitySemantics!=='SHIPMENT_DECLARED')throw new WmsError('货件明细来源不一致。',409);
    const sellerSku=optionalString(values.sellerSku);if(!sellerSku||sellerSku.length>255)throw new WmsError('来源 Seller SKU 无效。',409);
    items.push({id:item.id,sellerSku,fnsku:optionalString(values.fnsku),declaredQuantity:sourceQuantity(values.declaredQuantity)});
  }};
  append(first.rows);
  for(let page=2;page<=first.pagination.pageCount;page++){params.set('page',String(page));append((await readObservations(scoped(scope),params,scope.actorUserId,tx)).rows);}
  if(items.length!==first.pagination.total||new Set(items.map(item=>item.id)).size!==items.length)throw new WmsError('货件明细不完整或来源行重复。',409);
  const sourceFacts={shipment:row.facts,plan:planRows.rows[0].facts};
  const sourceDigest=hash({sourceFacts,items:[...items].sort((a,b)=>a.id.localeCompare(b.id))});
  return{sourceId:source.id,sourceRunId:source.activeRunId,observationId:row.id,sourceDigest,spApiInboundPlanId:inboundPlanId,spApiShipmentId:shipmentId,sourceStatus:optionalString(facts.sourceStatus),warehouseId:optionalString(facts.destinationWarehouseId),capturedAt:row.capturedAt,sourceFacts,items};
}

/** Parent service locks the local plan and enforces live WMS/account/ownership authorization. */
export async function linkShipment(tx:Tx,scope:WmsScope,plan:Plan,raw:unknown,expectedRevision:number){
  if(plan.status==='CANCELLED')throw new WmsError('已取消计划不能关联货件。',409);
  const input=object(raw);strictKeys(input,['shipmentId','sourceRunId','observationId','sourceDigest','mappingEvidence','idempotencyKey','mappings']);
  const shipmentId=requireText(input.shipmentId,'Amazon 货件 ID',200),idempotencyKey=requireText(input.idempotencyKey,'幂等键'),mappingEvidence=requireText(input.mappingEvidence,'人工核对依据',2000);
  const sourceRunId=requireText(input.sourceRunId,'来源版本'),observationId=requireText(input.observationId,'来源货件记录');
  const sourceDigest=requireText(input.sourceDigest,'来源摘要');
  // Canonicalize the request before replay; source publication may have advanced after a successful link.
  if(!Array.isArray(input.mappings)||!input.mappings.length||input.mappings.length>500)throw new WmsError('明细映射须为 1-500 行。',400);
  const mappings=input.mappings.map(value=>{const row=object(value);strictKeys(row,['planLineId','observationId','quantity']);return{planLineId:requireText(row.planLineId,'本地明细'),observationId:requireText(row.observationId,'来源明细'),quantity:row.quantity};}).sort((a,b)=>a.observationId.localeCompare(b.observationId)||a.planLineId.localeCompare(b.planLineId));
  const requestHash=hash({shipmentId,sourceRunId,observationId,sourceDigest,mappingEvidence,idempotencyKey,mappings});
  const prior=await tx.fbaLocalShipment.findFirst({where:{...scoped(scope),planId:plan.id,idempotencyKey}});
  if(prior){if(prior.requestHash!==requestHash||prior.createdBy!==scope.actorUserId)throw new WmsError('货件关联幂等键已用于其他内容。',409);return{shipmentId:prior.id,revision:plan.revision};}
  if(plan.revision!==expectedRevision)throw new WmsError('计划版本已变化，请刷新。',409);
  if(await tx.fbaLocalShipment.count({where:{...scoped(scope),planId:plan.id}})>=20)throw new WmsError('每计划最多关联 20 个货件。',422);
  await lockKey(tx,JSON.stringify(['fba-shipment',scope.organizationId,scope.workspaceId,plan.sellerAccountId,plan.marketplaceId,shipmentId]));
  const snapshot=await previewShipment(tx,scope,plan,{shipmentId});
  if(snapshot.sourceRunId!==sourceRunId||snapshot.observationId!==observationId||snapshot.sourceDigest!==sourceDigest)throw new WmsError('Amazon 同步版本或内容已变化，请重新核对来源。',409);
  const existing=await tx.fbaLocalShipmentItem.findMany({where:{...scoped(scope),planId:plan.id},select:{planLineId:true,quantity:true}});
  const items=parseShipmentMapping(mappings,plan.lines,snapshot.items,existing);
  const {items:_sourceItems,sourceDigest:_digest,...header}=snapshot;void _sourceItems;void _digest;
  const created=await tx.fbaLocalShipment.create({data:{...scoped(scope),id:crypto.randomUUID(),planId:plan.id,sellerAccountId:plan.sellerAccountId,marketplaceId:plan.marketplaceId,...header,mappingEvidence,idempotencyKey,requestHash,createdBy:scope.actorUserId}});
  await tx.fbaLocalShipmentItem.createMany({data:items.map(item=>({...scoped(scope),planId:plan.id,shipmentId:created.id,id:crypto.randomUUID(),...item}))});
  const updated=await tx.fbaLocalPlan.update({where:{id:plan.id},data:{revision:{increment:1}}});
  await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'fba-local.shipment.link',entityType:'FbaLocalPlan',entityId:plan.id,metadata:{workspaceId:scope.workspaceId,shipmentId:created.id,spApiShipmentId:shipmentId,sourceRunId,mappingEvidence}}});
  return{shipmentId:created.id,revision:updated.revision};
}
