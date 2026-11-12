import type {FbaRemoteAction} from '@prisma/client';
import {prisma} from '@/lib/db/prisma';
import {authorizeWms,scoped,json} from '@/lib/wms/access';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import {AmazonSpApiClient} from '@/lib/amazon/sp-api-client';
import {amazonCloudExecutionEnabled} from '@/lib/amazon/execution-role';
import {decryptAmazonSpApiCredentials} from '@/lib/amazon/integration-secrets';
import {decryptCheckpoint,encryptCheckpoint} from '@/lib/amazon-sync/checkpoint';
import {authorizeRemotePolicy,validateBinding} from './remote-action-service';
import {inboundOperationIsReadOnly,inboundAsyncOperations,inboundVoidOperations,parseInboundOperation,type InboundOperationInput} from './inbound-write-contract';
import {object} from './rules';
import {normalizeRemoteReadSnapshot} from './remote-read-snapshot';
import {closeDigest} from '@/lib/finance/close-rules';
export type InboundExecutionTransport={submit:(request:unknown)=>Promise<{body:unknown;rawBody?:string}>;poll:(operationId:string)=>Promise<{body:unknown;rawBody?:string}>};
/** Supplied only by the disposable test runner; production clients cannot inject a fetch transport. */
type ExecutionOptions={fixtureTransport?:InboundExecutionTransport};
const active=['QUEUED','WAITING'] as const;
function scopeFor(record:FbaRemoteAction):WmsScope{return {organizationId:record.organizationId,workspaceId:record.workspaceId,actorUserId:record.createdBy};}
function fixtureAllowed(options:ExecutionOptions){if(options.fixtureTransport&&process.env.WMS_OFFLINE_FIXTURE!=='1')throw new Error('Fixture transport requires disposable runner');}
async function currentAuthority(record:FbaRemoteAction,token:string,requirePlanRevision:boolean){
 return prisma.$transaction(async tx=>{
  const scope=scopeFor(record),current=await tx.fbaRemoteAction.findFirst({where:{...scoped(scope),id:record.id,leaseToken:token,status:{in:['SENDING','POLLING']}}});if(!current||!current.leaseExpiresAt||current.leaseExpiresAt<=new Date())throw new WmsError('执行租约已失效。',409);
  const granted=await authorizeRemotePolicy(tx,scope,record.planId,record.policyId,record.policyRevision);if(!(granted.policy.allowedOperations as string[]).includes(record.operation))throw new WmsError('操作已被执行策略撤权。',403);
  if(!record.reviewedBy||!record.reviewedAt)throw new WmsError('缺少独立审批。',403);await authorizeWms(tx,scope,'approve',{userId:record.reviewedBy,action:'approve'});
  if(requirePlanRevision&&(granted.plan.revision!==record.planRevision||granted.plan.status==='CANCELLED'||record.reviewedAt.getTime()<Date.now()-30*60000))throw new WmsError('计划或审批有效期已变化。',409);
  return granted;
 });
}
async function makeTransport(record:FbaRemoteAction,token:string,polling:boolean):Promise<InboundExecutionTransport>{
 const scope=scopeFor(record),grant=await currentAuthority(record,token,!polling),authorization=grant.authorization;
 const client=new AmazonSpApiClient({...decryptAmazonSpApiCredentials(authorization.credentialsCiphertext,{...scoped(scope),authorizationId:authorization.id}),region:authorization.awsRegion,endpoint:authorization.endpoint},{cacheScope:JSON.stringify([scope.organizationId,scope.workspaceId,authorization.id,authorization.revision]),beforeRequest:async()=>{await currentAuthority(record,token,!polling);}});
 return {submit:request=>client.executeInboundOperation(request as InboundOperationInput),poll:operationId=>client.getInboundOperationStatus({operationId})};
}
/** Crash after send begins => unknown, never queue another write; known operation IDs only poll. */
export async function recoverExpiredFbaRemoteActions(now=new Date()){
 const expired=await prisma.fbaRemoteAction.findMany({where:{status:{in:['SENDING','POLLING']},leaseExpiresAt:{lte:now}},orderBy:{id:'asc'},take:20});
 for(const row of expired){const readFailed=row.status==='SENDING'&&inboundOperationIsReadOnly(row.operation),waiting=!readFailed&&Boolean(row.operationId);await prisma.fbaRemoteAction.updateMany({where:{id:row.id,status:row.status,leaseToken:row.leaseToken,leaseExpiresAt:row.leaseExpiresAt},data:{status:readFailed?'FAILED':waiting?'WAITING':'RESULT_UNKNOWN',nextRunAt:waiting?now:null,errorCode:readFailed?'READ_LEASE_EXPIRED':'LEASE_EXPIRED_RESULT_UNCERTAIN',leaseToken:null,leaseExpiresAt:null,revision:{increment:1}}});}
 return expired.length;
}
export async function processFbaRemoteAction(id:string,options:ExecutionOptions={}){
 fixtureAllowed(options);if(!options.fixtureTransport&&(!amazonCloudExecutionEnabled()||process.env.AMAZON_FBA_REMOTE_EXECUTION_ENABLED!=='true'))return {status:'DISABLED'};
 const result=await prisma.$transaction(async tx=>{
  const row=await tx.fbaRemoteAction.findUnique({where:{id}});if(!row||!active.includes(row.status as typeof active[number])||row.nextRunAt&&row.nextRunAt>new Date())return null;
  const token=crypto.randomUUID(),polling=row.status==='WAITING';if(polling&&!row.operationId)throw new WmsError('缺少 Operation ID，禁止轮询或盲重发。',409);
  const changed=await tx.fbaRemoteAction.updateMany({where:{id,status:row.status,revision:row.revision},data:{status:polling?'POLLING':'SENDING',leaseToken:token,leaseExpiresAt:new Date(Date.now()+5*60000),revision:{increment:1},attempt:{increment:1}}});return changed.count?{record:row,token,polling}:null;
 });if(!result)return {status:'SKIPPED'};
 const {record,token,polling}=result,scope=scopeFor(record);let requestStarted=false;
 try{
  await currentAuthority(record,token,!polling);
  const raw=JSON.parse(decryptCheckpoint(record.requestCiphertext,scope,`fba-remote-request:${record.id}`)!),parsed=parseInboundOperation(raw);
  if(!polling)await prisma.$transaction(tx=>validateBinding(tx,scope,record.planId,object(raw),record.operation,object(record.requestMetadata??{}).lineMapping));
  const transport=options.fixtureTransport??await makeTransport(record,token,polling);
  // The actual HTTP client checks this again before token and signed request dispatch.
  await currentAuthority(record,token,!polling);requestStarted=true;
  const response=polling?await transport.poll(record.operationId!):await transport.submit(raw),body=!polling&&inboundVoidOperations.includes(record.operation)&&response.body==null?{}:object(response.body);
  const operationId=typeof body.operationId==='string'?body.operationId:record.operationId;
  if(operationId&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(operationId))throw new WmsError('外部 Operation ID 无效。',422);
  let status:'SUCCEEDED'|'FAILED'|'WAITING'|'RESULT_UNKNOWN';
  if(polling){if(body.operationId!==record.operationId||body.operation!==record.operation)throw new WmsError('Operation 回包与原操作不符。',422);if(body.operationStatus==='SUCCESS')status='SUCCEEDED';else if(body.operationStatus==='FAILED')status='FAILED';else if(body.operationStatus==='IN_PROGRESS')status='WAITING';else throw new WmsError('异步操作状态无法识别。',422);}
  else status=parsed.mutating&&inboundAsyncOperations.includes(record.operation)?(operationId?'WAITING':'RESULT_UNKNOWN'):'SUCCEEDED';
  const externalEntityId=typeof body.inboundPlanId==='string'?body.inboundPlanId:record.externalEntityId;if(record.externalEntityId&&externalEntityId!==record.externalEntityId)throw new WmsError('原外部实体 ID 不可替换。',422);
  if(externalEntityId&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(externalEntityId))throw new WmsError('外部计划 ID 无效。',422);
  const saved=response.rawBody?.trim()?response.rawBody:JSON.stringify(body);if(saved.length>32000)throw new WmsError('回包超过单操作加密证据上限，请使用分页。',413);
  await prisma.$transaction(async tx=>{
   const current=await tx.fbaRemoteAction.findFirst({where:{id,leaseToken:token,status:polling?'POLLING':'SENDING'}});if(!current)return;
   const entity=externalEntityId??current.externalEntityId;
   const path=object(raw.pathParameters??{});for(const [key,value]of Object.entries(path))if(body[key]!==undefined&&body[key]!==value)throw new WmsError('外部回包实体与原请求范围不符。',422);
   if(record.operation!=='createInboundPlan'&&typeof body.inboundPlanId==='string'){
    const bound=await tx.fbaRemotePlanBinding.findFirst({where:{...scoped(scope),planId:record.planId}});if(!bound||body.inboundPlanId!==bound.externalPlanId)throw new WmsError('回包外部计划归属不符。',422);
   }
   if(status==='SUCCEEDED'&&!polling){
    const readSnapshot=normalizeRemoteReadSnapshot(record.operation,object(raw),response.rawBody??JSON.stringify(body));
    if(readSnapshot&&record.operation==='getInboundPlan'){
     const plan=await tx.fbaLocalPlan.findFirstOrThrow({where:{...scoped(scope),id:record.planId}}),facts=object(readSnapshot.normalized.facts),marketplaces=facts.marketplaceIds;
     if(!Array.isArray(marketplaces)||marketplaces.length!==1||marketplaces[0]!==plan.marketplaceId)throw new WmsError('来源计划站点与本地绑定计划不符。',422);
    }
    if(readSnapshot)await tx.fbaRemoteReadSnapshot.create({data:{id:crypto.randomUUID(),...scoped(scope),planId:record.planId,actionId:id,operation:record.operation,capturedAt:new Date(),...readSnapshot,normalized:json({...readSnapshot.normalized,actionId:id})}});
   }
   const optionDefinitions:Record<string,{kind:string;field:string;key:string}>={listPackingOptions:{kind:'PACKING',field:'packingOptions',key:'packingOptionId'},listPlacementOptions:{kind:'PLACEMENT',field:'placementOptions',key:'placementOptionId'},listTransportationOptions:{kind:'TRANSPORTATION',field:'transportationOptions',key:'transportationOptionId'},listDeliveryWindowOptions:{kind:'DELIVERY_WINDOW',field:'deliveryWindowOptions',key:'deliveryWindowOptionId'}};
   if(status==='SUCCEEDED'&&optionDefinitions[record.operation]){
    const definition=optionDefinitions[record.operation],rows=body[definition.field];
    if(!Array.isArray(rows)||rows.length>100)throw new WmsError('方案读取回包不完整或超过 100 项。',422);
    const options=rows.map(row=>{const value=object(row);if(typeof value[definition.key]!=='string')throw new WmsError('方案回包缺少原 ID。',422);return {optionId:value[definition.key] as string,payload:value};});
    if(new Set(options.map(row=>row.optionId)).size!==options.length)throw new WmsError('方案回包 ID 重复。',422);
    const binding=await tx.fbaRemotePlanBinding.findFirst({where:{...scoped(scope),planId:record.planId}}),policy=await tx.fbaRemoteExecutionPolicy.findUniqueOrThrow({where:{id:record.policyId}});
    if(options.length&&binding&&JSON.stringify(options).length<=50000&&await tx.fbaWorkflowOptionSnapshot.count({where:{...scoped(scope),planId:record.planId}})<10){
     await tx.fbaWorkflowOptionSnapshot.create({data:{...scoped(scope),id:crypto.randomUUID(),planId:record.planId,idempotencyKey:`REMOTE:${record.id}`,kind:definition.kind,externalPlanId:binding.externalPlanId,operationId:record.operationId??record.id,capturedAt:new Date(),expiresAt:policy.expiresAt,evidence:`Remote response ${record.id}; target validity ${policy.contractReference}`,options:json(options),sourceHash:closeDigest(options),createdBy:record.createdBy}});
    }
   }
   if(status==='SUCCEEDED'&&record.operation==='createInboundPlan'){
    if(!entity)throw new WmsError('创建成功但缺少原响应计划 ID，保留待核实。',422);
    const binding=await tx.fbaRemotePlanBinding.findFirst({where:{...scoped(scope),planId:record.planId}});if(binding&&binding.externalPlanId!==entity)throw new WmsError('外部计划绑定冲突。',409);
    if(!binding)await tx.fbaRemotePlanBinding.create({data:{...scoped(scope),id:crypto.randomUUID(),planId:record.planId,externalPlanId:entity,sourceReference:record.id,createdBy:record.createdBy}});
   }
   await tx.fbaRemoteAction.update({where:{id},data:{status,operationId,externalEntityId:entity,responseCiphertext:encryptCheckpoint(saved,scope,`fba-remote-response:${id}`),nextRunAt:status==='WAITING'?new Date(Date.now()+30000):null,errorCode:status==='FAILED'?'REMOTE_OPERATION_FAILED':status==='RESULT_UNKNOWN'?'MISSING_OPERATION_ID':null,leaseToken:null,leaseExpiresAt:null,revision:{increment:1}}});
   await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'fba.remote.result',entityType:'FbaRemoteAction',entityId:id,metadata:{workspaceId:scope.workspaceId,planId:record.planId,status,operation:record.operation,operationId,evidenceEncrypted:true}}});
  });return {status};
 }catch{
  const readFailed=requestStarted&&!polling&&inboundOperationIsReadOnly(record.operation),unknown=requestStarted&&!polling&&!readFailed,status=polling?'WAITING':unknown?'RESULT_UNKNOWN':'FAILED';
  await prisma.fbaRemoteAction.updateMany({where:{id,leaseToken:token,status:polling?'POLLING':'SENDING'},data:{status,errorCode:unknown?'SUBMISSION_RESULT_UNKNOWN':polling?'POLL_FAILED':readFailed?'READ_REQUEST_FAILED':'AUTHORITY_OR_REQUEST_INVALID',nextRunAt:polling?new Date(Date.now()+60000):null,leaseToken:null,leaseExpiresAt:null,revision:{increment:1}}});return {status};
 }
}
export async function tickFbaRemoteActions(){
 if(!amazonCloudExecutionEnabled()||process.env.AMAZON_FBA_REMOTE_EXECUTION_ENABLED!=='true')return {enabled:false,processed:0};
 await recoverExpiredFbaRemoteActions();const rows=await prisma.fbaRemoteAction.findMany({where:{status:{in:[...active]},nextRunAt:{lte:new Date()}},orderBy:[{nextRunAt:'asc'},{id:'asc'}],take:2});
 for(const row of rows)await processFbaRemoteAction(row.id);return {enabled:true,processed:rows.length};
}
