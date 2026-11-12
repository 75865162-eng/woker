import {prisma} from '@/lib/db/prisma';
import {scoped,authorizeWms,auditWms,json} from './access';
import {WmsError,type WmsScope} from './contracts';
import {lockKey} from './repository';
import {requireText,strictKeys} from './rules';
import {closeDigest} from '@/lib/finance/close-rules';
import {overseasChargeAllocation} from './overseas-charge-rules';
export async function queryOverseasCharges(scope:WmsScope,params:URLSearchParams){return prisma.$transaction(async tx=>{await authorizeWms(tx,scope,'view');return {items:await tx.wmsOverseasCharge.findMany({where:{...scoped(scope),...(params.get('manifestId')?{manifestId:requireText(params.get('manifestId'),'海外资料 ID')}:{})},orderBy:[{createdAt:'desc'},{id:'asc'}],take:100}),limit:100};});}
export async function mutateOverseasCharge(scope:WmsScope,body:Record<string,unknown>){
 const action=requireText(body.action,'海外费用动作');if(!['create','review'].includes(action))throw new WmsError('海外费用动作无效。',400);
 return prisma.$transaction(async tx=>{await authorizeWms(tx,scope,action==='review'?'approve':'create');
 if(action==='review'){
 strictKeys(body,['action','id']);const id=requireText(body.id,'海外费用 ID');await lockKey(tx,JSON.stringify(['overseas-charge-review',scoped(scope),id]));const row=await tx.wmsOverseasCharge.findFirst({where:{...scoped(scope),id}});if(!row)throw new WmsError('海外费用不存在。',404);if(row.createdBy===scope.actorUserId)throw new WmsError('海外费用禁止制单人自审。',403);if(row.status==='REVIEWED'){if(row.reviewedBy!==scope.actorUserId)throw new WmsError('原审核证据不可覆盖。',409);return {item:row,reused:true};}if(row.status!=='DRAFT')throw new WmsError('海外费用状态无效。',409);
 const item=await tx.wmsOverseasCharge.update({where:{id},data:{status:'REVIEWED',reviewedBy:scope.actorUserId,reviewedAt:new Date()}});await auditWms(tx,scope,'overseas-charge.review',id,{requestHash:row.requestHash});return {item,reused:false};
 }
 strictKeys(body,['action','manifestId','number','currency','amount','allocationMethod','reference','evidence','idempotencyKey','basis']);const manifestId=requireText(body.manifestId,'海外资料 ID'),number=requireText(body.number,'海外费用单号'),reference=requireText(body.reference,'费用来源依据',1000),evidence=requireText(body.evidence,'费用核对依据',2000),idempotencyKey=requireText(body.idempotencyKey,'幂等键');
 const manifest=await tx.wmsOverseasManifest.findFirst({where:{...scoped(scope),id:manifestId},include:{order:{include:{lines:true}},boxes:{include:{items:true}},transport:true}});if(!manifest||manifest.order.status==='CANCELLED')throw new WmsError('海外调拨资料不存在或已取消。',404);
 await lockKey(tx,JSON.stringify(['overseas-charge',scoped(scope),idempotencyKey]));const requestHash=closeDigest({manifestId,number,reference,evidence,allocationMethod:body.allocationMethod,amount:body.amount,currency:body.currency,basis:body.basis});const prior=await tx.wmsOverseasCharge.findFirst({where:{...scoped(scope),idempotencyKey}});if(prior){if(prior.createdBy!==scope.actorUserId||prior.requestHash!==requestHash)throw new WmsError('海外费用幂等键冲突。',409);return {item:prior,reused:true};}
 const allocation=overseasChargeAllocation({...body,reference},manifest.order.lines,manifest.boxes,manifest.transport);const item=await tx.wmsOverseasCharge.create({data:{id:crypto.randomUUID(),...scoped(scope),manifestId,number,currency:allocation.currency,amount:allocation.amount,allocationMethod:allocation.allocationMethod,reference,evidence,idempotencyKey,requestHash,allocation:json(allocation),createdBy:scope.actorUserId}});await auditWms(tx,scope,'overseas-charge.create',item.id,{manifestId,requestHash,postingExecuted:false,inventoryCostUpdated:false});return {item,reused:false};
 });
}
/** Formal ledger handoff consumes reviewed evidence; target account mapping stays explicit. */
export async function readWmsOverseasChargeSource(tx:import('./repository').Tx,scope:WmsScope,id:string):Promise<import('@/lib/finance/source-rules').FinanceSource>{
 await authorizeWms(tx,scope,'view');const row=await tx.wmsOverseasCharge.findFirst({where:{...scoped(scope),id:requireText(id,'海外费用 ID')},include:{manifest:{include:{order:true}}}});if(!row||row.status!=='REVIEWED'||!row.reviewedBy||row.manifest.order.status==='CANCELLED')throw new WmsError('海外费用须已独立复核且原调拨有效。',409);await authorizeWms(tx,scope,'view',{userId:row.reviewedBy,action:'approve'});if(row.amount.isZero())throw new WmsError('零金额海外费用不生成凭证。',422);
 const amount=row.amount.toFixed(6);return {kind:'WMS_OVERSEAS_CHARGE',id:row.id,sourceKey:'WMS-OVERSEAS-CHARGE:'+row.id,currency:row.currency,sourceDate:row.createdAt.toISOString().slice(0,10),lines:[{account:'WMS_OVERSEAS_FREIGHT',debit:amount,credit:'0.000000'},{account:'WMS_FORWARDER_PAYABLE',debit:'0.000000',credit:amount}],evidence:{manifestId:row.manifestId,orderId:row.manifest.orderId,reference:row.reference,evidence:row.evidence,requestHash:row.requestHash,allocation:row.allocation,reviewedBy:row.reviewedBy,reviewedAt:row.reviewedAt?.toISOString(),inventoryCostUpdated:false}};
}
