import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {parseLocalPacking} from '@/lib/fba-local/packing';
import {scoped,json,auditWms,authorizeWms} from './access';
import {WmsError,type WmsScope} from './contracts';
import {lockAggregate,type Tx} from './repository';
import {requireText,requireRevision,strictKeys} from './rules';
import {positiveDecimal} from './catalog-details-service';
import {prisma} from '@/lib/db/prisma';
function object(raw:unknown){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new WmsError('海外调拨资料须为对象。',400);return raw as Record<string,unknown>;}
function transportData(raw:unknown){
 const input=object(raw);strictKeys(input,['carrier','channel','containerNumber','billOfLading','trackingNumber','departureAt','expectedArrivalAt','chargeableWeightKg','currency','estimatedFee','unitPrice','surcharge','reference']);
 const date=(value:unknown)=>{if(value===undefined||value===null||value==='')return null;const text=requireText(value,'运输时间');if(!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)||!Number.isFinite(Date.parse(text)))throw new WmsError('运输时间须为带时区的有效时间。',400);return new Date(text);};
 const departureAt=date(input.departureAt),expectedArrivalAt=date(input.expectedArrivalAt);if(departureAt&&expectedArrivalAt&&expectedArrivalAt<departureAt)throw new WmsError('预计到达不能早于发运。',422);
 const currency=input.currency?requireText(input.currency,'币种',3):null;if(currency&&!/^[A-Z]{3}$/.test(currency))throw new WmsError('币种无效。',400);
 if((input.estimatedFee!==undefined&&input.estimatedFee!==null&&!currency)||(currency&&(input.estimatedFee===undefined||input.estimatedFee===null)))throw new WmsError('预估费用与币种须一并提供。',400);
 if((input.unitPrice!==undefined||input.surcharge!==undefined)&&!currency)throw new WmsError('单价和附加费须注明费用币种及总费用。',400);
 const optionalMoney=(value:unknown,label:string)=>value===undefined||value===null?null:value==='0'?new Prisma.Decimal(0):positiveDecimal(value,label);
 return {unitPrice:optionalMoney(input.unitPrice,'运输单价'),surcharge:optionalMoney(input.surcharge,'附加费'),carrier:requireText(input.carrier,'承运商'),channel:requireText(input.channel,'运输渠道'),trackingNumber:requireText(input.trackingNumber,'运单号'),reference:requireText(input.reference,'运输依据',1000),containerNumber:input.containerNumber?requireText(input.containerNumber,'柜号'):null,billOfLading:input.billOfLading?requireText(input.billOfLading,'提单号'):null,departureAt,expectedArrivalAt,chargeableWeightKg:input.chargeableWeightKg?positiveDecimal(input.chargeableWeightKg,'计费重（千克）'):null,currency,estimatedFee:input.estimatedFee===undefined||input.estimatedFee===null?null:input.estimatedFee==='0'?new Prisma.Decimal(0):positiveDecimal(input.estimatedFee,'预估费用')};
}
export async function createOverseasManifest(tx:Tx,scope:WmsScope,body:Record<string,unknown>){
 strictKeys(body,['orderId','expectedRevision','destinationAddressId','reference','lines','packing','transport']);
 const orderId=requireText(body.orderId,'调拨单'),revision=requireRevision(body.expectedRevision);await lockAggregate(tx,scope,orderId,'transferOrder');
 const order=await tx.wmsTransferOrder.findFirst({where:{...scoped(scope),id:orderId},include:{lines:{include:{source:true}}}});
 if(!order||order.createdBy!==scope.actorUserId)throw new WmsError('调拨单不可访问或申请人不匹配。',403);
 if(new Set(order.lines.map(line=>line.source.warehouseId)).size!==1||new Set(order.lines.map(line=>line.targetWarehouseId)).size!==1||order.lines.some(line=>line.source.warehouseId===line.targetWarehouseId))throw new WmsError('海外调拨须为明确的单一来源仓及另一目的仓。',422);
 const address=await tx.wmsWarehouseAddress.findFirst({where:{...scoped(scope),id:requireText(body.destinationAddressId,'目的仓地址'),warehouseId:order.lines[0].targetWarehouseId}});if(!address)throw new WmsError('地址不属于调拨目的仓。',422);
 const packing=parseLocalPacking(body.packing,order.lines),transport=transportData(body.transport),reference=requireText(body.reference,'海外调拨依据',1000);
 if(!Array.isArray(body.lines)||body.lines.length!==order.lines.length)throw new WmsError('须明确提供全部调拨明细的外部编码。',422);
 const seen=new Set<string>();const lines=body.lines.map(raw=>{const row=object(raw);strictKeys(row,['transferLineId','sellerSku','fnsku']);const transferLineId=requireText(row.transferLineId,'调拨明细');if(seen.has(transferLineId)||!order.lines.some(line=>line.id===transferLineId))throw new WmsError('海外明细重复或不属于当前单。',422);seen.add(transferLineId);return {transferLineId,sellerSku:row.sellerSku?requireText(row.sellerSku,'外部 SKU'):null,fnsku:row.fnsku?requireText(row.fnsku,'FNSKU'):null};}).sort((a,b)=>a.transferLineId.localeCompare(b.transferLineId));
 const destinationAddress={sourceAddressId:address.id,sourceRevision:address.revision,countryCode:address.countryCode,region:address.region,city:address.city,addressLine1:address.addressLine1,addressLine2:address.addressLine2,postalCode:address.postalCode,contactName:address.contactName,phone:address.phone};
 const requestHash=createHash('sha256').update(JSON.stringify({destinationAddressId:address.id,reference,lines,packing,transport})).digest('hex');
 const prior=await tx.wmsOverseasManifest.findFirst({where:{...scoped(scope),orderId}});
 if(prior){if(prior.requestHash!==requestHash)throw new WmsError('此调拨单已有不同的海外装箱资料。');return prior;}
 if(order.status!=='DRAFT'||order.revision!==revision)throw new WmsError('仅当前未发运草稿可建立海外装箱资料。');
 const manifest=await tx.wmsOverseasManifest.create({data:{...scoped(scope),id:crypto.randomUUID(),orderId,countryCode:address.countryCode,destinationAddress:json(destinationAddress),reference,requestHash}});
 await tx.wmsOverseasLine.createMany({data:lines.map(line=>({...scoped(scope),...line,id:crypto.randomUUID(),manifestId:manifest.id}))});
 for(const box of packing.boxes){const {items,...fields}=box;const stored=await tx.wmsOverseasBox.create({data:{...scoped(scope),...fields,id:crypto.randomUUID(),manifestId:manifest.id}});await tx.wmsOverseasBoxItem.createMany({data:items.map(item=>({...scoped(scope),id:crypto.randomUUID(),boxId:stored.id,transferLineId:item.lineId,quantity:item.quantity}))});}
 await tx.wmsOverseasTransport.create({data:{...scoped(scope),...transport,id:crypto.randomUUID(),manifestId:manifest.id}});
 await tx.wmsTransferOrder.update({where:{id:order.id},data:{revision:{increment:1}}});return manifest;
}
export async function updateOverseasTransport(scope:WmsScope,body:Record<string,unknown>){
 strictKeys(body,['manifestId','revision','transport']);const manifestId=requireText(body.manifestId,'海外调拨资料'),revision=requireRevision(body.revision),data=transportData(body.transport);
 return prisma.$transaction(async tx=>{await authorizeWms(tx,scope,'edit');const manifest=await tx.wmsOverseasManifest.findFirst({where:{...scoped(scope),id:manifestId},select:{orderId:true}});if(!manifest)throw new WmsError('海外调拨资料不存在。',404);await lockAggregate(tx,scope,manifest.orderId,'transferOrder');const order=await tx.wmsTransferOrder.findFirstOrThrow({where:{...scoped(scope),id:manifest.orderId}});if(order.createdBy!==scope.actorUserId||order.status==='CANCELLED'||order.status==='COMPLETED')throw new WmsError('运输资料不可修改。',409);
 const changed=await tx.wmsOverseasTransport.updateMany({where:{...scoped(scope),manifestId,revision},data:{...data,revision:{increment:1}}});if(changed.count!==1)throw new WmsError('运输资料版本已变化。');await auditWms(tx,scope,'overseas.transport',manifestId,json({revision:revision+1,...data}));return {id:manifestId,revision:revision+1};});
}
