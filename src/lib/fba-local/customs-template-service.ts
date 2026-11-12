import {createHash} from 'node:crypto';
import {prisma} from '@/lib/db/prisma';
import {authorizeWms,scoped,json,auditWms} from '@/lib/wms/access';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import {requireText,requireRevision,strictKeys} from '@/lib/wms/rules';
import {lockKey} from '@/lib/wms/repository';
import {closeDigest} from '@/lib/finance/close-rules';
import {customsTarget} from './customs-profile-rules';
import {parseCustomsTemplateDefinition,renderTargetCustomsXml} from './customs-template-rules';
import {authorizeFbaAccount} from './account-access';
export async function queryCustomsTemplates(scope:WmsScope){return prisma.$transaction(async tx=>{await authorizeWms(tx,scope,'view');return {templates:await tx.fbaCustomsTemplate.findMany({where:scoped(scope),orderBy:[{code:'asc'},{version:'desc'}],take:100}),limit:100};});}
export async function mutateCustomsTemplate(scope:WmsScope,body:Record<string,unknown>){
 const action=requireText(body.action,'报关模板动作');if(!['create','review','export'].includes(action))throw new WmsError('报关模板动作无效。',400);
 return prisma.$transaction(async tx=>{
  await authorizeWms(tx,scope,action==='review'?'approve':'create');
  if(action==='create'){
   strictKeys(body,['action','code','version','destinationCountry','forwarder','schemaReference','definition']);const input={code:requireText(body.code,'模板编码',80),version:requireRevision(body.version),...customsTarget(body),schemaReference:requireText(body.schemaReference,'目标模板/Schema 来源与版本依据',2000),definition:parseCustomsTemplateDefinition(body.definition)},requestHash=closeDigest(input);
   await lockKey(tx,JSON.stringify(['customs-template',scoped(scope),input.code,input.version]));const prior=await tx.fbaCustomsTemplate.findFirst({where:{...scoped(scope),code:input.code,version:input.version}});if(prior){if(prior.requestHash!==requestHash||prior.createdBy!==scope.actorUserId)throw new WmsError('模板版本不能覆盖。',409);return {item:prior,reused:true};}
   const item=await tx.fbaCustomsTemplate.create({data:{...input,definition:json(input.definition),id:crypto.randomUUID(),...scoped(scope),requestHash,createdBy:scope.actorUserId}});await auditWms(tx,scope,'customs-template.create',item.id,{code:input.code,version:input.version,requestHash});return {item,reused:false};
  }
  if(action==='review'){
   strictKeys(body,['action','id']);const id=requireText(body.id,'模板 ID');await lockKey(tx,JSON.stringify(['customs-template-review',scoped(scope),id]));const row=await tx.fbaCustomsTemplate.findFirst({where:{...scoped(scope),id}});if(!row)throw new WmsError('模板不存在。',404);if(row.createdBy===scope.actorUserId)throw new WmsError('模板禁止申请人自审。',403);if(row.status==='ACTIVE'){if(row.reviewedBy!==scope.actorUserId)throw new WmsError('原模板复核证据不可覆盖。',409);return {item:row,reused:true};}
   const item=await tx.fbaCustomsTemplate.update({where:{id},data:{status:'ACTIVE',reviewedBy:scope.actorUserId,reviewedAt:new Date()}});await auditWms(tx,scope,'customs-template.review',id,{requestHash:row.requestHash});return {item,reused:false};
  }
  strictKeys(body,['action','declarationId','templateId','idempotencyKey']);const declarationId=requireText(body.declarationId,'报关资料 ID'),templateId=requireText(body.templateId,'模板 ID'),idempotencyKey=requireText(body.idempotencyKey,'导出幂等键');
  const declaration=await tx.fbaLocalCustomsDeclaration.findFirst({where:{...scoped(scope),id:declarationId},include:{plan:true,shipment:true,items:{orderBy:{planLineId:'asc'}}}}),template=await tx.fbaCustomsTemplate.findFirst({where:{...scoped(scope),id:templateId}});if(!declaration||!template)throw new WmsError('报关资料或模板不存在。',404);
  await authorizeFbaAccount(tx,scope,declaration.plan.sellerAccountId,declaration.plan.marketplaceId);
  if(declaration.plan.status==='CANCELLED'||declaration.status!=='REVIEWED'||!declaration.reviewedBy||template.status!=='ACTIVE'||!template.reviewedBy)throw new WmsError('报关资料与模板须有效且已独立复核。',409);
  await authorizeWms(tx,scope,'create',{userId:template.reviewedBy,action:'approve'});await authorizeWms(tx,scope,'create',{userId:declaration.reviewedBy,action:'approve'});
  if(template.destinationCountry!==declaration.destinationCountry||template.schemaReference!==declaration.templateReference)throw new WmsError('模板目的国或来源依据与已审核报关资料不符。',422);
  const forwarder=await tx.fbaLocalForwarderOrder.findFirst({where:{...scoped(scope),planId:declaration.planId}});if(!forwarder||forwarder.forwarder!==template.forwarder)throw new WmsError('报关模板须匹配计划已登记的货代。',422);
  const rendered=renderTargetCustomsXml(parseCustomsTemplateDefinition(template.definition),declaration,declaration.items),xmlHash=createHash('sha256').update(rendered.xml).digest('hex'),requestHash=closeDigest({declarationId,declarationHash:declaration.requestHash,templateId,templateHash:template.requestHash,xmlHash});
  await lockKey(tx,JSON.stringify(['customs-export',scoped(scope),idempotencyKey]));const prior=await tx.fbaCustomsExport.findFirst({where:{...scoped(scope),idempotencyKey}});if(prior){if(prior.requestHash!==requestHash||prior.createdBy!==scope.actorUserId)throw new WmsError('导出幂等键冲突。',409);return {item:prior,reused:true,validation:rendered.validation};}
  const item=await tx.fbaCustomsExport.create({data:{id:crypto.randomUUID(),...scoped(scope),declarationId,templateId,idempotencyKey,requestHash,xml:rendered.xml,xmlHash,createdBy:scope.actorUserId}});await auditWms(tx,scope,'customs-template.export',item.id,{declarationId,templateId,xmlHash,validation:json(rendered.validation)});return {item,reused:false,validation:rendered.validation};
 });
}
export async function readCustomsExport(scope:WmsScope,id:string){
 return prisma.$transaction(async tx=>{await authorizeWms(tx,scope,'view');const item=await tx.fbaCustomsExport.findFirst({where:{...scoped(scope),id:requireText(id,'导出证据 ID')}});if(!item)throw new WmsError('导出证据不存在。',404);const declaration=await tx.fbaLocalCustomsDeclaration.findFirst({where:{...scoped(scope),id:item.declarationId},include:{plan:true}}),template=await tx.fbaCustomsTemplate.findFirst({where:{...scoped(scope),id:item.templateId}});if(!declaration||!template||declaration.status!=='REVIEWED'||declaration.plan.status==='CANCELLED'||!declaration.reviewedBy||template.status!=='ACTIVE'||!template.reviewedBy)throw new WmsError('原申报资料或模板不再有效。',409);await authorizeFbaAccount(tx,scope,declaration.plan.sellerAccountId,declaration.plan.marketplaceId);await authorizeWms(tx,scope,'view',{userId:template.reviewedBy,action:'approve'});await authorizeWms(tx,scope,'view',{userId:declaration.reviewedBy,action:'approve'});if(createHash('sha256').update(item.xml).digest('hex')!==item.xmlHash)throw new WmsError('XML 导出证据摘要不符。',409);await auditWms(tx,scope,'customs-template.download',id,{declarationId:item.declarationId,templateId:item.templateId,xmlHash:item.xmlHash,officialSchemaValidated:false});return item;});
}
