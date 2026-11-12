import {prisma} from '@/lib/db/prisma';
import {authorizeWms,scoped,json,auditWms} from '@/lib/wms/access';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import {requireText,strictKeys} from '@/lib/wms/rules';
import {lockKey} from '@/lib/wms/repository';
import {closeDigest} from '@/lib/finance/close-rules';
import {parseCustomsProfile} from './customs-profile-rules';
import {authorizeFbaAccount} from './account-access';
export async function queryCustomsProfiles(scope:WmsScope,params:URLSearchParams){return prisma.$transaction(async tx=>{await authorizeWms(tx,scope,'view');const productRecordId=params.get('productRecordId');return {items:await tx.fbaCustomsProfile.findMany({where:{...scoped(scope),...(productRecordId?{productRecordId}:{})},orderBy:[{createdAt:'desc'},{id:'asc'}],take:100}),limit:100};});}
export async function mutateCustomsProfile(scope:WmsScope,body:Record<string,unknown>){
 const action=requireText(body.action,'商品报关设置动作');if(!['create','review','preview-shipment'].includes(action))throw new WmsError('商品报关设置动作无效。',400);
 return prisma.$transaction(async tx=>{
  await authorizeWms(tx,scope,action==='review'?'approve':action==='create'?'create':'view');
  if(action==='create'){
   strictKeys(body,['action','profile']);const input=parseCustomsProfile(body.profile),requestHash=closeDigest(input);
   if(!await tx.productRecord.findFirst({where:{...scoped(scope),id:input.productRecordId}}))throw new WmsError('商品主档不存在。',404);
   await lockKey(tx,JSON.stringify(['customs-profile',scoped(scope),input.productRecordId,input.destinationCountry,input.forwarder,input.version]));
   const prior=await tx.fbaCustomsProfile.findFirst({where:{...scoped(scope),productRecordId:input.productRecordId,destinationCountry:input.destinationCountry,forwarder:input.forwarder,version:input.version}});if(prior){if(prior.requestHash!==requestHash||prior.createdBy!==scope.actorUserId)throw new WmsError('商品报关设置版本不可覆盖。',409);return {item:prior,reused:true};}
   const item=await tx.fbaCustomsProfile.create({data:{...input,values:json(input.values),id:crypto.randomUUID(),...scoped(scope),requestHash,createdBy:scope.actorUserId}});await auditWms(tx,scope,'customs-profile.create',item.id,{productRecordId:input.productRecordId,requestHash});return {item,reused:false};
  }
  if(action==='review'){
   strictKeys(body,['action','id']);const id=requireText(body.id,'商品报关设置 ID');await lockKey(tx,JSON.stringify(['customs-profile-review',scoped(scope),id]));const row=await tx.fbaCustomsProfile.findFirst({where:{...scoped(scope),id}});if(!row)throw new WmsError('商品报关设置不存在。',404);if(row.createdBy===scope.actorUserId)throw new WmsError('商品报关设置禁止自审。',403);if(row.status==='ACTIVE'){if(row.reviewedBy!==scope.actorUserId)throw new WmsError('原复核证据不可覆盖。',409);return {item:row,reused:true};}
   const item=await tx.fbaCustomsProfile.update({where:{id},data:{status:'ACTIVE',reviewedBy:scope.actorUserId,reviewedAt:new Date()}});await auditWms(tx,scope,'customs-profile.review',id,{requestHash:row.requestHash});return {item,reused:false};
  }
  strictKeys(body,['action','shipmentId','profileIds']);const shipmentId=requireText(body.shipmentId,'货件 ID');if(!Array.isArray(body.profileIds)||!body.profileIds.length||body.profileIds.length>100||new Set(body.profileIds).size!==body.profileIds.length)throw new WmsError('须明确选择 1–100 个商品申报设置版本。',400);
  const ids=body.profileIds.map(value=>requireText(value,'商品报关设置 ID')),shipment=await tx.fbaLocalShipment.findFirst({where:{...scoped(scope),id:shipmentId},include:{plan:true,items:{include:{planLine:{include:{balance:{include:{lot:true}}}}}}}});if(!shipment)throw new WmsError('货件不存在。',404);await authorizeFbaAccount(tx,scope,shipment.plan.sellerAccountId,shipment.plan.marketplaceId);
  const profiles=await tx.fbaCustomsProfile.findMany({where:{...scoped(scope),id:{in:ids},status:'ACTIVE'}});if(profiles.length!==ids.length)throw new WmsError('所有商品报关设置须已复核。',422);for(const row of profiles){if(!row.reviewedBy)throw new WmsError('缺少商品设置复核人。',422);await authorizeWms(tx,scope,'view',{userId:row.reviewedBy,action:'approve'});}
  if(new Set(profiles.map(row=>row.productRecordId)).size!==profiles.length||new Set(profiles.map(row=>JSON.stringify([row.destinationCountry,row.forwarder]))).size!==1)throw new WmsError('设置须每商品一个版本且目的国/货代一致。',422);
  if(new Set(profiles.map(row=>(row.values as Record<string,unknown>).currency)).size!==1)throw new WmsError('同一货件商品申报币种须一致。',422);
  const byProduct=new Map(profiles.map(row=>[row.productRecordId,row])),quantity=new Map<string,number>();for(const item of shipment.items)quantity.set(item.planLineId,(quantity.get(item.planLineId)??0)+item.quantity);
  const used=new Set<string>(),items=[...quantity].map(([planLineId,count])=>{const line=shipment.items.find(row=>row.planLineId===planLineId)!.planLine,profile=byProduct.get(line.balance.lot.productRecordId);if(!profile)throw new WmsError('商品报关设置未覆盖货件全部商品。',422);used.add(profile.id);const values=profile.values as Record<string,unknown>;return {planLineId,quantity:count,description:values.description,hsCode:values.hsCode,originCountry:values.originCountry,unit:values.unit,unitPrice:values.unitPrice,currency:values.currency,priceBasis:values.priceBasis,priceRate:values.priceRate,profileId:profile.id,profileHash:profile.requestHash};});if(used.size!==profiles.length)throw new WmsError('设置中包含货件之外的商品。',422);
  await auditWms(tx,scope,'customs-profile.preview',shipmentId,{profileIds:ids});return {shipmentId,items,destinationCountry:profiles[0].destinationCountry,forwarder:profiles[0].forwarder,basis:'EXPLICIT_REVIEWED_PROFILE_VERSIONS',createsDeclaration:false,remoteSubmitted:false};
 });
}
