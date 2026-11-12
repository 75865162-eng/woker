import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { scoped, authorizeWms, auditWms } from './access';
import { WmsError, type WmsScope } from './contracts';
import { lockKey, type Tx } from './repository';
import { requireText, requireRevision, strictKeys } from './rules';
export function positiveDecimal(value: unknown, label: string) {
 if(typeof value!=='string'||!/^\d{1,12}(\.\d{1,6})?$/.test(value)||!new Prisma.Decimal(value).isPositive())throw new WmsError(`${label}须为正十进制字符串，最多六位小数。`,400);
 return new Prisma.Decimal(value);
}
const addressKeys=['warehouseId','label','countryCode','region','city','addressLine1','addressLine2','postalCode','contactName','phone'];
function addressData(body:Record<string,unknown>){
 const countryCode=requireText(body.countryCode,'国家代码',2).toUpperCase();if(!/^[A-Z]{2}$/.test(countryCode))throw new WmsError('国家代码须为两位字母。',400);
 return {warehouseId:requireText(body.warehouseId,'仓库'),label:requireText(body.label,'地址名称'),countryCode,city:requireText(body.city,'城市'),addressLine1:requireText(body.addressLine1,'地址',500),postalCode:requireText(body.postalCode,'邮编'),contactName:requireText(body.contactName,'联系人'),...Object.fromEntries(['region','addressLine2','phone'].map(key=>[key,body[key]?requireText(body[key],key,500):null]))};
}
export async function createCatalogDetails(tx:Tx,scope:WmsScope,kind:'warehouse-types'|'warehouse-addresses',body:Record<string,unknown>){
 const base={...scoped(scope),id:crypto.randomUUID()};
 if(kind==='warehouse-types'){strictKeys(body,['name','remark']);return tx.wmsWarehouseType.create({data:{...base,name:requireText(body.name,'仓库类型名称'),remark:body.remark?requireText(body.remark,'备注',1000):null}});}
 strictKeys(body,addressKeys);const data=addressData(body);
 if(!await tx.wmsWarehouse.findFirst({where:{...scoped(scope),id:data.warehouseId,enabled:true}}))throw new WmsError('仓库不可用。',422);
 return tx.wmsWarehouseAddress.create({data:{...base,...data}});
}
export async function updateCatalogDetails(scope:WmsScope,kind:'lots'|'warehouses'|'locations'|'warehouse-addresses',body:Record<string,unknown>){
 return prisma.$transaction(async tx=>{
  await authorizeWms(tx,scope,'edit');const id=requireText(body.id,'记录'),revision=requireRevision(body.revision);
  await lockKey(tx,JSON.stringify(['wms-profile',scoped(scope),kind,id]));
  let changed;
  if(kind==='lots'){
   strictKeys(body,['id','revision','action','unitVolumeCubicMeters']);
   const volume=body.unitVolumeCubicMeters;
   if(typeof volume!=='string'||!/^\d{1,15}(?:\.\d{1,9})?$/.test(volume)||!new Prisma.Decimal(volume).isPositive())throw new WmsError('单件体积须为正十进制字符串，最多九位小数。',400);
   await tx.$queryRaw`SELECT id FROM "WmsLot" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
   if(await tx.wmsMovement.findFirst({where:{...scoped(scope),balance:{is:{...scoped(scope),lotId:id}}}}))throw new WmsError('批次已有库存流水，体积资料不可追溯改写。',409);
   changed=await tx.wmsLot.updateMany({where:{...scoped(scope),id,revision},data:{unitVolumeCubicMeters:volume,revision:{increment:1}}});
  }else if(kind==='warehouses'){
   strictKeys(body,['id','revision','action','name','typeId']);const typeId=body.typeId===null?null:requireText(body.typeId,'仓库类型');
   if(typeId&&!await tx.wmsWarehouseType.findFirst({where:{...scoped(scope),id:typeId}}))throw new WmsError('仓库类型不属于当前工作区。',422);
   changed=await tx.wmsWarehouse.updateMany({where:{...scoped(scope),id,revision},data:{name:requireText(body.name,'仓库名称'),typeId,revision:{increment:1}}});
  }else if(kind==='locations'){
   const fields=['lengthCm','widthCm','heightCm','capacityCubicMeters'];strictKeys(body,['id','revision','action','parentId',...fields]);
   const data=Object.fromEntries(fields.map(field=>[field,body[field]===null?null:positiveDecimal(body[field],field)]));
   const location=await tx.wmsLocation.findFirst({where:{...scoped(scope),id}});if(!location)throw new WmsError('库位不存在。',404);
   await lockKey(tx,JSON.stringify(['wms-location-tree',scoped(scope),location.warehouseId]));
   const parentId=body.parentId===undefined?location.parentId:body.parentId===null?null:requireText(body.parentId,'上级库位');
   let ancestor=parentId;const seen=new Set([id]);
   while(ancestor){if(seen.has(ancestor))throw new WmsError('库位层级不能循环。',422);seen.add(ancestor);if(seen.size>32)throw new WmsError('库位层级不能超过 32 层。',422);const parent=await tx.wmsLocation.findFirst({where:{...scoped(scope),id:ancestor,warehouseId:location.warehouseId}});if(!parent)throw new WmsError('上级库位须属于同一仓库。',422);ancestor=parent.parentId;}
   changed=await tx.wmsLocation.updateMany({where:{...scoped(scope),id,revision},data:{...data,parentId,revision:{increment:1}}});
  }else{
   strictKeys(body,['id','revision','action',...addressKeys]);const data=addressData(body);
   changed=await tx.wmsWarehouseAddress.updateMany({where:{...scoped(scope),id,revision,warehouseId:data.warehouseId},data:{...data,revision:{increment:1}}});
  }
  if(changed.count!==1)throw new WmsError('记录不可访问或已变更，请刷新。',409);
  await auditWms(tx,scope,`${kind}.profile`,id);return {id,revision:revision+1};
 });
}
