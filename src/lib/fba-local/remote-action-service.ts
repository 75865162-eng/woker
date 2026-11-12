import {prisma} from '@/lib/db/prisma';
import {authorizeWms,scoped,json} from '@/lib/wms/access';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import {requireText,requireRevision,strictKeys} from '@/lib/wms/rules';
import type {Tx} from '@/lib/wms/repository';
import {authorizeFbaAccount} from './account-access';
import {closeDigest} from '@/lib/finance/close-rules';
import {encryptCheckpoint,decryptCheckpoint} from '@/lib/amazon-sync/checkpoint';
import {parseInboundOperation,inboundOperationNames} from './inbound-write-contract';
import {object} from './rules';
export const remoteActionSummary={id:true,requestMetadata:true,planId:true,planRevision:true,policyId:true,policyRevision:true,operation:true,requestHash:true,status:true,revision:true,createdBy:true,reviewedBy:true,reviewedAt:true,reviewEvidence:true,operationId:true,externalEntityId:true,errorCode:true,attempt:true,nextRunAt:true,createdAt:true,updatedAt:true} as const;
export async function authorizeRemotePolicy(tx:Tx,scope:WmsScope,planId:string,policyId?:string,expectedPolicyRevision?:number){
 await authorizeWms(tx,scope,'edit');
 const plan=await tx.fbaLocalPlan.findFirst({where:{...scoped(scope),id:planId}});if(!plan)throw new WmsError('计划不存在。',404);
 await authorizeFbaAccount(tx,scope,plan.sellerAccountId,plan.marketplaceId);
 const policy=await tx.fbaRemoteExecutionPolicy.findFirst({where:{...scoped(scope),sellerAccountId:plan.sellerAccountId,marketplaceId:plan.marketplaceId,...(policyId?{id:policyId}:{})}});
 if(!policy||!policy.enabled||policy.expiresAt<=new Date()||expectedPolicyRevision!==undefined&&policy.revision!==expectedPolicyRevision)throw new WmsError('外部执行策略未启用、已过期或版本变化。',409);
 const identity=await tx.amazonSellerIdentity.findFirst({where:{...scoped(scope),sellerAccountId:plan.sellerAccountId,marketplaceId:plan.marketplaceId,authorizationId:policy.authorizationId}});
 const authorization=await tx.amazonSpApiAuthorization.findFirst({where:{...scoped(scope),id:policy.authorizationId,status:'CONFIGURED',identityVerifiedAt:{not:null}}});
 if(!identity||!authorization)throw new WmsError('执行授权与已核实店铺/站点不符。',403);
 return {plan,policy,authorization};
}
export async function queryRemoteActions(scope:WmsScope,params:URLSearchParams){
 const planId=requireText(params.get('planId'),'计划 ID');
 return prisma.$transaction(async tx=>{await authorizeWms(tx,scope,'view');const plan=await tx.fbaLocalPlan.findFirst({where:{...scoped(scope),id:planId}});if(!plan)throw new WmsError('计划不存在。',404);await authorizeFbaAccount(tx,scope,plan.sellerAccountId,plan.marketplaceId);
 const policy=await tx.fbaRemoteExecutionPolicy.findFirst({where:{...scoped(scope),sellerAccountId:plan.sellerAccountId,marketplaceId:plan.marketplaceId}}),binding=await tx.fbaRemotePlanBinding.findFirst({where:{...scoped(scope),planId}}),actions=await tx.fbaRemoteAction.findMany({where:{...scoped(scope),planId},select:remoteActionSummary,orderBy:[{createdAt:'desc'},{id:'asc'}],take:100});
 const readSnapshots=await tx.fbaRemoteReadSnapshot.findMany({where:{...scoped(scope),planId},select:{id:true,actionId:true,operation:true,externalPlanId:true,shipmentId:true,capturedAt:true,sourceHash:true,pageComplete:true,continuationTokenPresent:true},orderBy:[{capturedAt:'desc'},{id:'desc'}],take:100});
 const actionId=params.get('actionId');let request:unknown=null;if(actionId){await authorizeWms(tx,scope,'edit');const record=await tx.fbaRemoteAction.findFirst({where:{...scoped(scope),planId,id:actionId}});if(!record)throw new WmsError('执行草稿不存在。',404);request={request:JSON.parse(decryptCheckpoint(record.requestCiphertext,scope,`fba-remote-request:${record.id}`)!),response:record.responseCiphertext?JSON.parse(decryptCheckpoint(record.responseCiphertext,scope,`fba-remote-response:${record.id}`)!):null,metadata:record.requestMetadata,readSnapshot:await tx.fbaRemoteReadSnapshot.findFirst({where:{...scoped(scope),planId,actionId}})};await audit(tx,scope,record.id,'read-evidence',{planId});}
 return {policy,binding,actions,readSnapshots,request,operationNames:inboundOperationNames,automaticWriteRetry:false,limit:100};});
}
export async function mutateRemoteAction(scope:WmsScope,body:Record<string,unknown>){
 const action=requireText(body.action,'外部动作'),planId=requireText(body.planId,'计划 ID');
 return prisma.$transaction(async tx=>{
  await authorizeWms(tx,scope,'edit');await tx.$queryRaw`SELECT id FROM "FbaLocalPlan" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${planId} FOR UPDATE`;
  const plan=await tx.fbaLocalPlan.findFirst({where:{...scoped(scope),id:planId}});if(!plan)throw new WmsError('计划不存在。',404);await authorizeFbaAccount(tx,scope,plan.sellerAccountId,plan.marketplaceId);
  if(action==='configure-policy'){
   strictKeys(body,['action','planId','revision','authorizationId','allowedOperations','enabled','contractReference','expiresAt']);await authorizeWms(tx,scope,'approve');
   const member=await tx.organizationMember.findUnique({where:{organizationId_userId:{organizationId:scope.organizationId,userId:scope.actorUserId}}});if(!member||!['owner','database_admin'].includes(member.role))throw new WmsError('执行策略须由组织管理员配置。',403);
   if(typeof body.enabled!=='boolean'||!Number.isSafeInteger(body.revision)||Number(body.revision)<0||!Array.isArray(body.allowedOperations)||!body.allowedOperations.length||body.allowedOperations.length>100||new Set(body.allowedOperations).size!==body.allowedOperations.length||body.allowedOperations.some(name=>!(inboundOperationNames as readonly string[]).includes(String(name))))throw new WmsError('策略状态、版本或操作白名单无效。',400);
   const authorizationId=requireText(body.authorizationId,'授权 ID'),contractReference=requireText(body.contractReference,'目标端操作合同复核依据',1000),expiresAt=new Date(requireText(body.expiresAt,'策略到期时间'));
   if(!Number.isFinite(expiresAt.getTime())||expiresAt<=new Date()||expiresAt.getTime()>Date.now()+90*86400000)throw new WmsError('策略有效期须为未来 90 天内。',400);
   if(!await tx.amazonSellerIdentity.findFirst({where:{...scoped(scope),sellerAccountId:plan.sellerAccountId,marketplaceId:plan.marketplaceId,authorizationId}}))throw new WmsError('授权与店铺/站点身份不符。',403);
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['fba-remote-policy',scope.organizationId,scope.workspaceId,plan.sellerAccountId,plan.marketplaceId])},0))`;
   const prior=await tx.fbaRemoteExecutionPolicy.findFirst({where:{...scoped(scope),sellerAccountId:plan.sellerAccountId,marketplaceId:plan.marketplaceId}});if((prior?.revision??0)!==body.revision)throw new WmsError('策略版本已变化。',409);
   const data={authorizationId,allowedOperations:json(body.allowedOperations),enabled:body.enabled,contractReference,expiresAt,createdBy:scope.actorUserId};
   const policy=prior?await tx.fbaRemoteExecutionPolicy.update({where:{id:prior.id},data:{...data,revision:{increment:1}}}):await tx.fbaRemoteExecutionPolicy.create({data:{...scoped(scope),id:crypto.randomUUID(),sellerAccountId:plan.sellerAccountId,marketplaceId:plan.marketplaceId,...data}});
   await audit(tx,scope,policy.id,action,{planId,revision:policy.revision,enabled:policy.enabled});return {policy};
  }
  if(action==='bind-plan'){
   strictKeys(body,['action','planId','recordId']);await authorizeWms(tx,scope,'approve');const recordId=requireText(body.recordId,'已核实外部计划记录 ID');
   const record=await tx.fbaExternalOperationRecord.findFirst({where:{...scoped(scope),planId,id:recordId,step:'PLAN',status:'REVIEWED_SUCCEEDED'}});if(!record?.entityId||!record.reviewedBy)throw new WmsError('须提供已独立核实的外部计划记录。',422);await authorizeWms(tx,scope,'approve',{userId:record.reviewedBy,action:'approve'});
   const prior=await tx.fbaRemotePlanBinding.findFirst({where:{...scoped(scope),planId}});if(prior){if(prior.externalPlanId!==record.entityId)throw new WmsError('外部计划绑定不可替换。',409);return {binding:prior,reused:true};}
   const binding=await tx.fbaRemotePlanBinding.create({data:{...scoped(scope),id:crypto.randomUUID(),planId,externalPlanId:record.entityId,sourceReference:record.id,createdBy:scope.actorUserId}});await audit(tx,scope,binding.id,action,{planId,recordId});return {binding};
  }
  if(action==='draft'){
   strictKeys(body,['action','planId','expectedRevision','idempotencyKey','request','lineMapping']);const expectedRevision=requireRevision(body.expectedRevision),idempotencyKey=requireText(body.idempotencyKey,'幂等键'),request=object(body.request),parsed=parseInboundOperation(request),requestHash=closeDigest({request,lineMapping:body.lineMapping??null,planRevision:expectedRevision});
   const prior=await tx.fbaRemoteAction.findFirst({where:{...scoped(scope),planId,idempotencyKey}});if(prior){if(prior.requestHash!==requestHash||prior.createdBy!==scope.actorUserId)throw new WmsError('执行草稿幂等键冲突。',409);return {record:summary(prior),reused:true};}
   if(plan.createdBy!==scope.actorUserId||plan.status==='CANCELLED'||plan.revision!==expectedRevision)throw new WmsError('须由计划创建人使用当前有效版本生成草稿。',409);
   const {policy}=await authorizeRemotePolicy(tx,scope,planId);if(!(policy.allowedOperations as string[]).includes(parsed.operation))throw new WmsError('此操作不在执行策略白名单。',403);
   await validateBinding(tx,scope,planId,request,parsed.operation,body.lineMapping);
   const lineMapping=body.lineMapping??null;
   if(parsed.operation==='createInboundPlan')validatePlanLineMapping(await tx.fbaLocalPlanLine.findMany({where:{...scoped(scope),planId}}),lineMapping,object(request.body).items);
   else if(parsed.operation!=='createMarketplaceItemLabels'&&lineMapping!==null)throw new WmsError('此操作不接受计划行 SKU 映射。',400);
   const serialized=JSON.stringify(request);if(serialized.length>24000)throw new WmsError('单操作请求最多 24000 字符；拆分方案须沿目标端工作流。',413);
   const id=crypto.randomUUID(),record=await tx.fbaRemoteAction.create({data:{...scoped(scope),id,planId,planRevision:expectedRevision,policyId:policy.id,policyRevision:policy.revision,idempotencyKey,operation:parsed.operation,requestHash,requestMetadata:json({lineMapping}),requestCiphertext:encryptCheckpoint(serialized,scope,`fba-remote-request:${id}`)!,createdBy:scope.actorUserId}});
   await audit(tx,scope,id,action,{planId,operation:parsed.operation,requestHash});return {record:summary(record),reused:false};
  }
  strictKeys(body,['action','planId','actionId','revision','evidence',...(action==='recover-known-operation'?['operationId']:[])]);if(!['approve','enqueue','cancel','recover-known-operation'].includes(action))throw new WmsError('外部动作无效。',400);
  const actionId=requireText(body.actionId,'执行草稿 ID'),revision=requireRevision(body.revision),evidence=requireText(body.evidence,'操作依据',1000),record=await tx.fbaRemoteAction.findFirst({where:{...scoped(scope),planId,id:actionId}});if(!record)throw new WmsError('执行草稿不存在。',404);
  if(record.revision!==revision)throw new WmsError('执行草稿版本变化。',409);
  if(action==='cancel'){
   if(record.createdBy!==scope.actorUserId||!['DRAFT','APPROVED','QUEUED'].includes(record.status))throw new WmsError('仅申请人可取消尚未开始的本地请求；远程取消须独立操作。',409);
   const result=await tx.fbaRemoteAction.update({where:{id:actionId},data:{status:'CANCELLED',revision:{increment:1},errorCode:'CANCELLED_BEFORE_SEND'}});await audit(tx,scope,actionId,action,{planId,evidence});return {record:summary(result)};
  }
  await authorizeRemotePolicy(tx,scope,planId,record.policyId,record.policyRevision);
  if(action==='recover-known-operation'){
   await authorizeWms(tx,scope,'approve');if(record.createdBy===scope.actorUserId||record.status!=='RESULT_UNKNOWN')throw new WmsError('须由独立人员补核未知结果的原 Operation ID。',409);const operationId=requireText(body.operationId,'原 Operation ID',200);if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(operationId)||record.operationId&&record.operationId!==operationId)throw new WmsError('Operation ID 无效或与原记录冲突。',409);
   const result=await tx.fbaRemoteAction.update({where:{id:actionId},data:{operationId,status:'WAITING',nextRunAt:new Date(),leaseToken:null,leaseExpiresAt:null,errorCode:null,revision:{increment:1}}});await audit(tx,scope,actionId,action,{planId,evidence,operationId});return {record:summary(result)};
  }
  if(plan.status==='CANCELLED'||plan.revision!==record.planRevision)throw new WmsError('计划版本已变化，须创建新草稿。',409);
  if(action==='approve'){
   await authorizeWms(tx,scope,'approve');if(record.createdBy===scope.actorUserId||record.status!=='DRAFT')throw new WmsError('外部请求须独立审批且仍为草稿。',403);
   const result=await tx.fbaRemoteAction.update({where:{id:actionId},data:{status:'APPROVED',reviewedBy:scope.actorUserId,reviewedAt:new Date(),reviewEvidence:evidence,revision:{increment:1}}});await audit(tx,scope,actionId,action,{planId,evidence});return {record:summary(result)};
  }
  if(record.createdBy!==scope.actorUserId||record.status!=='APPROVED'||!record.reviewedBy||!record.reviewedAt||record.reviewedAt.getTime()<Date.now()-30*60000)throw new WmsError('仅申请人可将 30 分钟内独立批准的请求排队。',409);
  await authorizeWms(tx,scope,'approve',{userId:record.reviewedBy,action:'approve'});
  if(await tx.fbaRemoteAction.count({where:{...scoped(scope),planId,id:{not:actionId},status:{in:['QUEUED','SENDING','WAITING','POLLING','RESULT_UNKNOWN']}}}))throw new WmsError('计划已有待执行或结果待核实的外部操作。',409);
  const result=await tx.fbaRemoteAction.update({where:{id:actionId},data:{status:'QUEUED',nextRunAt:new Date(),revision:{increment:1}}});await audit(tx,scope,actionId,action,{planId,evidence});return {record:summary(result)};
 });
}
export function validatePlanLineMapping(lines:readonly {id:string;quantity:number}[],lineMapping:unknown,items:unknown){
 if(!Array.isArray(lineMapping)||!lineMapping.length)throw new WmsError('须逐行提供本地计划到外部 MSKU 的映射依据。',422);
 const seen=new Set<string>(),totals=new Map<string,number>();
 for(const raw of lineMapping){const row=object(raw);strictKeys(row,['planLineId','sellerSku','evidence']);const lineId=requireText(row.planLineId,'计划行 ID'),sellerSku=requireText(row.sellerSku,'卖家 SKU',200);requireText(row.evidence,'SKU 映射依据',1000);const line=lines.find(item=>item.id===lineId);if(!line||seen.has(lineId))throw new WmsError('本地计划行缺失或重复。',422);seen.add(lineId);const total=(totals.get(sellerSku)??0)+line.quantity;if(!Number.isSafeInteger(total))throw new WmsError('计划数量超出安全整数范围。',422);totals.set(sellerSku,total);}
 if(seen.size!==lines.length||!Array.isArray(items)||items.length!==totals.size)throw new WmsError('SKU 映射须精确覆盖本地全部计划数量。',422);
 for(const raw of items){const row=object(raw);if(typeof row.msku!=='string'||totals.get(row.msku)!==row.quantity)throw new WmsError('外部 MSKU/数量与本地计划映射不符。',422);totals.delete(row.msku);}if(totals.size)throw new WmsError('外部请求未覆盖全部 SKU。',422);
}
export async function validateBinding(tx:Tx,scope:WmsScope,planId:string,request:Record<string,unknown>,operation:string,lineMapping?:unknown){
 const binding=await tx.fbaRemotePlanBinding.findFirst({where:{...scoped(scope),planId}}),path=object(request.pathParameters??{});
 if(operation!=='createInboundPlan'&&operation!=='getInboundOperationStatus'&&operation!=='createMarketplaceItemLabels'&&path.inboundPlanId===undefined)throw new WmsError('此全账号操作尚未建立本地计划范围合同，请使用专属授权接入。',422);
 if(operation==='createMarketplaceItemLabels'){const plan=await tx.fbaLocalPlan.findFirstOrThrow({where:{...scoped(scope),id:planId}}),body=object(request.body);if(body.marketplaceId!==plan.marketplaceId)throw new WmsError('标签站点须等于本地计划站点。',422);validatePlanLineMapping(await tx.fbaLocalPlanLine.findMany({where:{...scoped(scope),planId}}),lineMapping,body.mskuQuantities);}
 if(operation==='createInboundPlan'){if(binding)throw new WmsError('本地计划已绑定外部计划，禁止再次创建。',409);const plan=await tx.fbaLocalPlan.findFirstOrThrow({where:{...scoped(scope),id:planId}}),body=object(request.body);if(!Array.isArray(body.destinationMarketplaces)||body.destinationMarketplaces.length!==1||body.destinationMarketplaces[0]!==plan.marketplaceId)throw new WmsError('创建计划的目的站点必须等于本地计划的已核实站点。',422);}
 else if(path.inboundPlanId!==undefined&&(!binding||path.inboundPlanId!==binding.externalPlanId))throw new WmsError('操作必须使用当前本地计划绑定的外部计划 ID。',403);
 const referenceNames=new Set(['shipmentId','packingGroupId','packingOptionId','placementOptionId','transportationOptionId','deliveryWindowOptionId','contentUpdatePreviewId','slotId']);
 const requested: {key:string;id:string}[]=[];
 function collect(value:unknown,visit:(key:string,id:string)=>void){if(Array.isArray(value)){for(const item of value)collect(item,visit);}else if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){if(referenceNames.has(key)&&typeof item==='string')visit(key,item);else if(key==='packingGroups'&&Array.isArray(item)){for(const id of item)if(typeof id==='string')visit('packingGroupId',id);}else if(key.endsWith('Ids')&&referenceNames.has(key.slice(0,-1))&&Array.isArray(item)){for(const id of item)if(typeof id==='string')visit(key.slice(0,-1),id);}else collect(item,visit);}}
 collect(request,(key,id)=>requested.push({key,id}));
 if(requested.length){
  const known=new Set<string>(),add=(key:string,id:string)=>known.add(JSON.stringify([key,id]));
  const shipments=await tx.fbaLocalShipment.findMany({where:{...scoped(scope),planId},select:{spApiShipmentId:true}});for(const row of shipments)add('shipmentId',row.spApiShipmentId);
  const snapshots=await tx.fbaWorkflowOptionSnapshot.findMany({where:{...scoped(scope),planId,externalPlanId:binding?.externalPlanId,expiresAt:{gt:new Date()}},include:{selection:true},take:10});
  for(const snapshot of snapshots){collect(snapshot.options,add);if(snapshot.selection){const key=({PACKING:'packingOptionId',PLACEMENT:'placementOptionId',TRANSPORTATION:'transportationOptionId',DELIVERY_WINDOW:'deliveryWindowOptionId'} as Record<string,string>)[snapshot.kind];add(key,snapshot.selection.optionId);} }
  const results=await tx.fbaRemoteAction.findMany({where:{...scoped(scope),planId,status:'SUCCEEDED',responseCiphertext:{not:null}},orderBy:{createdAt:'desc'},take:100});
  const evidence:unknown[]=snapshots.map(row=>row.options),confirmed=new Map<string,Record<string,unknown>>();
  for(const row of results){
   const response=JSON.parse(decryptCheckpoint(row.responseCiphertext,scope,`fba-remote-response:${row.id}`)!);collect(response,add);evidence.push(response);
   const original=object(JSON.parse(decryptCheckpoint(row.requestCiphertext,scope,`fba-remote-request:${row.id}`)!)),originalPath=object(original.pathParameters??{});
   if(!confirmed.has(row.operation))confirmed.set(row.operation,original);
   if(row.operation==='listDeliveryWindowOptions'&&typeof originalPath.shipmentId==='string'){
    const values=object(response).deliveryWindowOptions;if(Array.isArray(values))for(const value of values)evidence.push({...object(value),shipmentId:originalPath.shipmentId});
   }
  }
  if(requested.some(row=>!known.has(JSON.stringify([row.key,row.id]))))throw new WmsError('请求包含未由当前计划来源证据确认的货件/组/方案标识。',403);
  // IDs within one plan are still separate child identities. Preserve their associations.
  function paired(optionKey:string,optionId:string,shipmentId:string){
   let found=false;
   function visit(value:unknown){if(Array.isArray(value)){for(const row of value)visit(row);}else if(value&&typeof value==='object'){const row=value as Record<string,unknown>;if(row[optionKey]===optionId&&row.shipmentId===shipmentId)found=true;for(const item of Object.values(row))visit(item);}}
   for(const value of evidence)visit(value);return found;
  }
  const requestBody=object(request.body??{});
  if(operation==='confirmTransportationOptions'){
   const rows=requestBody.transportationSelections;if(!Array.isArray(rows)||rows.some(raw=>{const row=object(raw);return typeof row.shipmentId!=='string'||typeof row.transportationOptionId!=='string'||!paired('transportationOptionId',row.transportationOptionId,row.shipmentId);}))throw new WmsError('运输方案与货件的来源关联不符。',403);
  }
  if(operation==='confirmDeliveryWindowOptions'&&(typeof path.shipmentId!=='string'||typeof path.deliveryWindowOptionId!=='string'||!paired('deliveryWindowOptionId',path.deliveryWindowOptionId,path.shipmentId)))throw new WmsError('送仓时间窗与货件的来源关联不符。',403);
  if(operation==='setPackingInformation'){
   const packing=confirmed.get('confirmPackingOption'),placement=confirmed.get('confirmPlacementOption'),rows=requestBody.packageGroupings;
   const packingId=packing?object(packing.pathParameters).packingOptionId:undefined,placementId=placement?object(placement.pathParameters).placementOptionId:undefined;
   function members(optionKey:string,optionId:unknown,memberKey:string){const ids=new Set<string>();function visit(value:unknown){if(Array.isArray(value)){for(const row of value)visit(row);}else if(value&&typeof value==='object'){const row=value as Record<string,unknown>;if(row[optionKey]===optionId&&Array.isArray(row[memberKey]))for(const id of row[memberKey])if(typeof id==='string')ids.add(id);for(const item of Object.values(row))visit(item);}}for(const value of evidence)visit(value);return ids;}
   const groups=packing?members('packingOptionId',packingId,'packingGroups'):new Set<string>(),shipments=placement?members('placementOptionId',placementId,'shipmentIds'):new Set<string>();
   if(!Array.isArray(rows)||!rows.length||rows.some(raw=>{const row=object(raw);return placement?typeof row.shipmentId!=='string'||row.packingGroupId!==undefined||!shipments.has(row.shipmentId):typeof row.packingGroupId!=='string'||row.shipmentId!==undefined||!groups.has(row.packingGroupId);}))throw new WmsError('装箱分组须遵循已确认 Packing/Placement 方案及对应工作流阶段。',409);
  }
  const confirmationKinds:Record<string,string>={confirmPackingOption:'PACKING',confirmPlacementOption:'PLACEMENT',confirmTransportationOptions:'TRANSPORTATION',confirmDeliveryWindowOptions:'DELIVERY_WINDOW'};
  if(confirmationKinds[operation]){const key=({PACKING:'packingOptionId',PLACEMENT:'placementOptionId',TRANSPORTATION:'transportationOptionId',DELIVERY_WINDOW:'deliveryWindowOptionId'} as Record<string,string>)[confirmationKinds[operation]];const selected=new Set(snapshots.filter(row=>row.kind===confirmationKinds[operation]&&row.selection).map(row=>row.selection!.optionId));if(requested.filter(row=>row.key===key).some(row=>!selected.has(row.id)))throw new WmsError('确认方案须先完成当前有效方案的独立选择。',409);}
 }
 // Generic operation polling cannot be used to read another plan's operation.
 if(path.operationId!==undefined&&!await tx.fbaRemoteAction.findFirst({where:{...scoped(scope),planId,operationId:String(path.operationId)}}))throw new WmsError('Operation ID 不属于当前计划执行记录。',403);
}
export function summary<T extends Record<string,unknown>>(record:T){return Object.fromEntries(Object.keys(remoteActionSummary).map(key=>[key,record[key]]));}
async function audit(tx:Tx,scope:WmsScope,id:string,action:string,detail:Record<string,unknown>){await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:`fba.remote.${action}`,entityType:'FbaRemoteAction',entityId:id,metadata:{workspaceId:scope.workspaceId,...json(detail) as object}}});}
