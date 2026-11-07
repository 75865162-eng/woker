import { previewReportRecovery } from "./report-recovery";
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@prisma/client';
import { AmazonSpApiClient, type AmazonRequestEvent, type AmazonSpApiClientOptions } from '@/lib/amazon/sp-api-client';
import { decryptAmazonSpApiCredentials } from '@/lib/amazon/integration-secrets';
import { requestChange, decideChange, applyChange } from './change-approval';
import { assertAmazonAction, assertAmazonScopeAdmin } from './data-access';
import { scopeLock } from './service';
import { continuityGrant } from './continuity-access';
import { continuityPolicyDigest } from './continuity-policy';
import { orderAccessEvidence } from './order-access-evidence';
import { productAccessEvidence } from './product-access-evidence';
import { parseOrderDetail, parseOrderSyncPolicy } from './orders';
import { parseObservationPolicy } from './observation-policy';
import { parseProductDetail } from './product-observations';
import { orderBucketKey, reserveOrderToken } from './orders-rate-limit';
import { digest } from './approval-policy';
import { officialEndpoint, type SyncScope } from './policy';
const active=['WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED'];
async function approved(scope:SyncScope,actor:string,command:Record<string,unknown>){
 const r=await requestChange(scope,actor,command);
 if((await decideChange(scope,actor,String(r.id),'APPROVED','用户批准本地四站长期恢复；依持久授权与当前权限核验，保留任务和游标。')).status!=='APPROVED')throw Error('Stale approval');
 await applyChange(scope,actor,String(r.id));
}
/** Registered worker maintenance; explicit persisted grant, durable lease, bounded probes. */
export async function maintainContinuity(scopes:SyncScope[],now=new Date(),options?:AmazonSpApiClientOptions){
 const sources=await prisma.amazonSyncDataSource.findMany({where:{OR:scopes,enabled:true,resource:{in:['orders','listing_details','inventory_age']}},include:{authorization:true,resourceCursor:true},take:200});
 for(const source of sources){
  const g=await continuityGrant(prisma,source);if(!g||!g.grant.userId||source.authorization.status!=='CONFIGURED')continue;
  if(typeof g.metadata.nextCheckAt==='string'&&Date.parse(g.metadata.nextCheckAt)>now.getTime())continue;
  if(g.metadata.policyDigest!==continuityPolicyDigest(source.resource==='orders'?source.orderPolicy:source.domainPolicy))continue;
  const scope={organizationId:source.organizationId,workspaceId:source.workspaceId},actor=g.grant.userId;
  try{
   await assertAmazonScopeAdmin(scope,actor);await assertAmazonAction(scope,actor,'create');await assertAmazonAction(scope,actor,'approve');
   const claimed=await prisma.$transaction(async tx=>{await scopeLock(tx,scope);const current=await continuityGrant(tx,source);if(!current||typeof current.metadata.nextCheckAt==='string'&&Date.parse(current.metadata.nextCheckAt)>now.getTime())return false;await tx.auditLog.update({where:{id:current.grant.id},data:{metadata:{...current.metadata,nextCheckAt:new Date(now.getTime()+60000).toISOString()}}});return true;});
   if(!claimed)continue;
   if(source.resource==='inventory_age'){
    // Persist restoration intent before pausing. A worker crash between the
    // approved changes must not strand an originally enabled plan.
    const pending=g.metadata.reportRecoveryResume as Prisma.JsonObject|undefined;
    if(pending&&typeof pending.planId==='string'){
     const plan=await prisma.amazonSyncSchedule.findFirst({where:{...scope,id:pending.planId,resource:'inventory_age',targets:{some:{sourceId:source.id}}}});
     if(plan&&!plan.enabled&&plan.revision===pending.pausedRevision)await approved(scope,actor,{action:'save-plan',id:plan.id,revision:plan.revision,name:plan.name,resource:plan.resource,enabled:true,mode:plan.mode,intervalMinutes:plan.intervalMinutes,priority:plan.priority,maxAttempts:plan.maxAttempts,retentionDays:plan.retentionDays,sourceIds:[source.id]});
     const current=await prisma.auditLog.findUniqueOrThrow({where:{id:g.grant.id}});
     const metadata={...(current.metadata as Prisma.JsonObject)};delete metadata.reportRecoveryResume;
     if(typeof pending.sourceRevision==='number'&&source.revision>pending.sourceRevision&&typeof pending.day==='string')metadata.reportRecoveryDay=pending.day;
     await prisma.auditLog.update({where:{id:g.grant.id},data:{metadata}});
    }
    const current=await prisma.auditLog.findUniqueOrThrow({where:{id:g.grant.id}});
    const last=await prisma.amazonSyncRun.findFirst({where:{...scope,sourceId:source.id},orderBy:{startedAt:'desc'},select:{status:true,error:true}});
    const day=now.toISOString().slice(0,10);
    if(source.marketplaceId==='A1AM78C64UM0Y8'&&!source.lastSuccessAt&&last?.status==='FAILED'&&last.error?.includes('REPORT_CANCELLED')&&(current.metadata as Prisma.JsonObject).reportRecoveryDay!==day){
     const plan=await prisma.amazonSyncSchedule.findFirstOrThrow({where:{...scope,resource:'inventory_age',targets:{some:{sourceId:source.id}},planKey:{startsWith:'auto-v1:'}}});
     // A manually paused plan stays paused. Only restore pauses made here.
     if(plan.enabled){
      await prisma.auditLog.update({where:{id:g.grant.id},data:{metadata:{...(current.metadata as Prisma.JsonObject),reportRecoveryResume:{planId:plan.id,pausedRevision:plan.revision+1,sourceRevision:source.revision,day}}}});
      await approved(scope,actor,{action:'save-plan',id:plan.id,revision:plan.revision,name:plan.name,resource:plan.resource,enabled:false,mode:plan.mode,intervalMinutes:plan.intervalMinutes,priority:plan.priority,maxAttempts:plan.maxAttempts,retentionDays:plan.retentionDays,sourceIds:[source.id]});
     }
     try{
      const preview=await previewReportRecovery(prisma,scope,source.id);
      await approved(scope,actor,{action:'recover-report',id:source.id,revision:source.revision,recoveryDigest:preview.recoveryDigest});
      const latest=await prisma.auditLog.findUniqueOrThrow({where:{id:g.grant.id}});
      await prisma.auditLog.update({where:{id:g.grant.id},data:{metadata:{...(latest.metadata as Prisma.JsonObject),reportRecoveryDay:day}}});
     }finally{
      if(plan.enabled){
       const paused=await prisma.amazonSyncSchedule.findUniqueOrThrow({where:{id:plan.id}});
       if(!paused.enabled&&paused.revision===plan.revision+1)await approved(scope,actor,{action:'save-plan',id:paused.id,revision:paused.revision,name:paused.name,resource:paused.resource,enabled:true,mode:paused.mode,intervalMinutes:paused.intervalMinutes,priority:paused.priority,maxAttempts:paused.maxAttempts,retentionDays:paused.retentionDays,sourceIds:[source.id]});
       const latest=await prisma.auditLog.findUniqueOrThrow({where:{id:g.grant.id}});
       const metadata={...(latest.metadata as Prisma.JsonObject)};delete metadata.reportRecoveryResume;
       await prisma.auditLog.update({where:{id:g.grant.id},data:{metadata}});
      }
     }
    }
   }
   let evidence=typeof g.metadata.accessEvidence==='string'?g.metadata.accessEvidence:undefined;
   if(source.resource!=='inventory_age'&&(!evidence||typeof g.metadata.proofExpiresAt!=='string'||Date.parse(g.metadata.proofExpiresAt)<now.getTime()+3600000)){
    const auth=source.authorization;officialEndpoint(auth.awsRegion,auth.endpoint);
    const op=source.resource==='orders'?parseOrderSyncPolicy(source.orderPolicy):null;
    if(op?.details?.includedData.length)throw Error('Optional data excluded');
    const listing=source.resource==='listing_details'?parseObservationPolicy(source.domainPolicy,source.resource):null;
    const order=op?await prisma.amazonOrderRecord.findFirst({where:{...scope,sourceId:source.id},orderBy:{sourceUpdatedAt:'desc'},select:{amazonOrderId:true,sourceUpdatedAt:true}}):null;
    let sku=listing?.resource==='listing_details'?listing.sellerSkus[0]:undefined;
    if(listing?.resource==='listing_details'&&!sku&&listing.discovery){const head=await prisma.amazonSyncDataSource.findFirst({where:{...scope,id:listing.discovery.sourceId,resource:'catalog',authorizationId:source.authorizationId,marketplaceId:source.marketplaceId},select:{activeRunId:true}});sku=(await prisma.amazonCatalogSnapshot.findFirst({where:{...scope,sellerAccountId:source.sellerAccountId,marketplaceId:source.marketplaceId,sourceRunId:head?.activeRunId??'__none__'},orderBy:{sellerSku:'asc'},select:{sellerSku:true}}))?.sellerSku;}
    if(op&&!order||listing&&!sku)continue;
    const app=op?.applicationId??listing!.applicationId,rate=op?(op.details?.requestsPerSecond??.2):listing!.requestsPerSecond;
    const bucketKey=op?orderBucketKey(auth.amazonSellerId,app,'getOrder'):digest(['getListingsItem.2021-08-01',auth.amazonSellerId,app]);
    const reserve=await prisma.$transaction(async tx=>{await scopeLock(tx,scope);await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',bucketKey);const key={...scope,authorizationId:auth.id,operation:op?'getOrder':'getListingsItem'};const budget=await tx.amazonSyncApiBudget.findUnique({where:{organizationId_workspaceId_authorizationId_operation:key}});if(budget&&budget.nextRequestAt>now)return{allowed:false};const bucket=await tx.amazonSyncTokenBucket.findUnique({where:{bucketKey}});const r=reserveOrderToken(bucket,{requestsPerSecond:rate,burst:1},now);await tx.amazonSyncTokenBucket.upsert({where:{bucketKey},create:{bucketKey,tokens:r.tokens,replenishedAt:r.replenishedAt},update:{tokens:r.tokens,replenishedAt:r.replenishedAt}});if(r.allowed){const nextRequestAt=new Date(now.getTime()+Math.ceil(1000/Math.min(rate,budget?.observedLimit??rate)));await tx.amazonSyncApiBudget.upsert({where:{organizationId_workspaceId_authorizationId_operation:key},create:{...key,nextRequestAt},update:{nextRequestAt}});}return r;});
    if(!reserve.allowed)continue;
    const events:AmazonRequestEvent[]=[];
    const client=new AmazonSpApiClient({...decryptAmazonSpApiCredentials(auth.credentialsCiphertext,{...scope,authorizationId:auth.id}),region:auth.awsRegion,endpoint:auth.endpoint},{...options,requestTimeoutMs:20000,cacheScope:'local-continuity',onResponse:e=>events.push(e)});
    const context={...scope,authorizationId:auth.id,authorizationRevision:auth.revision,marketplaceId:source.marketplaceId};
    try{
     if(op&&order){const r=await client.getOrder({orderId:order.amazonOrderId,includedData:[]});parseOrderDetail(r.body,order.amazonOrderId,source.marketplaceId,op,order.sourceUpdatedAt);const e=events.findLast(e=>e.operation==='getOrder');evidence=orderAccessEvidence(context,{status:e?.status??0,requestId:e?.requestId??null,parsed:true},now);}
     else if(listing?.resource==='listing_details'&&sku){const r=await client.getListingDetail({sellerId:auth.amazonSellerId,sellerSku:sku,marketplaceId:source.marketplaceId});parseProductDetail(r.rawBody,{...listing,sellerSkus:[sku]},0,source.marketplaceId);const e=events.findLast(e=>e.operation==='getListingsItem');evidence=productAccessEvidence({...context,resource:'listing_details'},{status:e?.status??0,requestId:e?.requestId??null,parsed:true},now);}
    }catch(error){await prisma.amazonSyncTokenBucket.update({where:{bucketKey},data:{tokens:0,blockedUntil:new Date(now.getTime()+300000)}});throw error;}
    await prisma.$transaction(async tx=>{await scopeLock(tx,scope);const live=await tx.amazonSyncDataSource.findUniqueOrThrow({where:{id:source.id},include:{authorization:true}});if(live.revision!==source.revision||live.authorization.revision!==auth.revision||live.authorization.status!=='CONFIGURED')throw Error('Binding changed');const current=await continuityGrant(tx,live);if(!current)throw Error('Grant revoked');await tx.auditLog.update({where:{id:current.grant.id},data:{metadata:{...current.metadata,accessEvidence:evidence,proofExpiresAt:new Date(now.getTime()+86400000).toISOString(),policyDigest:continuityPolicyDigest(op??listing)}}});await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:actor,action:'amazon.sync.continuity.capability_checked',entityType:'AmazonSyncDataSource',entityId:source.id,metadata:{workspaceId:scope.workspaceId,authorizationRevision:auth.revision,marketplaceId:source.marketplaceId,operation:op?'getOrder':'getListingsItem',apiRequests:events.length,expiresAt:new Date(now.getTime()+86400000).toISOString()}}});});
   }
   if(source.resource==='orders'&&!parseOrderSyncPolicy(source.orderPolicy).details){
    if(!evidence||source.resourceCursor?.status!=='SUCCEEDED'||await prisma.amazonSyncRun.count({where:{...scope,sourceId:source.id,status:{in:active}}}))continue;
    const plan=await prisma.amazonSyncSchedule.findFirstOrThrow({where:{...scope,resource:'orders',targets:{some:{sourceId:source.id}},planKey:{startsWith:'auto-v1:'}}});
    const command={action:'save-plan',id:plan.id,revision:plan.revision,name:plan.name,resource:'orders',enabled:false,mode:plan.mode,intervalMinutes:plan.intervalMinutes,priority:plan.priority,maxAttempts:plan.maxAttempts,retentionDays:plan.retentionDays,sourceIds:[source.id]};
    if(plan.enabled)await approved(scope,actor,command);
    const policy={...parseOrderSyncPolicy(source.orderPolicy),details:{includedData:[],requiredRoles:['Inventory and Order Tracking'],purpose:'operations_order_items',requestsPerSecond:.2,burst:1,maxOrders:5000,backfillExisting:true,accessEvidence:evidence}};
    const transitionGrant=await prisma.auditLog.findUniqueOrThrow({where:{id:g.grant.id}});await prisma.auditLog.update({where:{id:g.grant.id},data:{metadata:{...(transitionGrant.metadata as Prisma.JsonObject),transitionPolicyDigest:continuityPolicyDigest(policy)}}});
    await approved(scope,actor,{action:'save-source',revision:source.revision,authorizationId:source.authorizationId,sellerAccountId:source.sellerAccountId,marketplaceId:source.marketplaceId,resource:'orders',enabled:true,freshnessMinutes:source.freshnessMinutes,orderPolicy:policy});
    const latest=await prisma.auditLog.findUniqueOrThrow({where:{id:g.grant.id}});await prisma.auditLog.update({where:{id:latest.id},data:{metadata:{...(latest.metadata as Prisma.JsonObject),policyDigest:continuityPolicyDigest(policy)}}});
   }
   // Renew only the execution deadline of previously applied manual work.
   // Binding, approval, checkpoints, generations and fact policy remain fixed.
   await prisma.$transaction(async tx=>{
    await scopeLock(tx,scope);
    const live=await tx.amazonSyncDataSource.findUniqueOrThrow({where:{id:source.id},include:{authorization:true}});
    if(!await continuityGrant(tx,live)||live.authorization.status!=='CONFIGURED')return;
    const runs=await tx.amazonSyncRun.findMany({where:{...scope,sourceId:source.id,trigger:{not:'schedule'},status:{in:['WAITING','QUEUED','RETRY_WAIT']}},take:2});
    for(const run of runs){const frozen=run.frozenScope as Prisma.JsonObject;const expires=typeof frozen.executionExpiresAt==='string'?Date.parse(frozen.executionExpiresAt):0;
     if(expires>now.getTime()+3600000)continue;
     if(frozen.sourceRevision!==live.revision||frozen.authorizationRevision!==live.authorization.revision||frozen.authorizationId!==live.authorizationId||frozen.marketplaceId!==live.marketplaceId||digest(frozen)!==run.frozenScopeDigest)continue;
     const approval=await tx.amazonDataCenterChangeRequest.findFirst({where:{id:run.executionApprovalId??'',...scope,status:'APPLIED',changeType:'SyncExecutionRequest',sourceIds:{has:source.id}}});
     if(!approval?.approvedByUserId)continue;
     await assertAmazonAction(scope,run.requestedByUserId,'create',tx);await assertAmazonAction(scope,approval.approvedByUserId,'approve',tx);
     const renewed={...frozen,executionExpiresAt:new Date(now.getTime()+86400000).toISOString()};
     await tx.amazonSyncRun.update({where:{id:run.id},data:{frozenScope:renewed,frozenScopeDigest:digest(renewed)}});
     await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:actor,action:'amazon.sync.continuity.execution_renewed',entityType:'AmazonSyncRun',entityId:run.id,metadata:{workspaceId:scope.workspaceId,grantId:g.grant.id,expiresAt:renewed.executionExpiresAt}}});
    }
   });
   if(source.resource==='orders'&&g.metadata.resumePlan===true){const plan=await prisma.amazonSyncSchedule.findFirst({where:{...scope,resource:'orders',enabled:false,targets:{some:{sourceId:source.id}},planKey:{startsWith:'auto-v1:'}}});if(plan)await approved(scope,actor,{action:'save-plan',id:plan.id,revision:plan.revision,name:plan.name,resource:'orders',enabled:true,mode:plan.mode,intervalMinutes:plan.intervalMinutes,priority:plan.priority,maxAttempts:plan.maxAttempts,retentionDays:plan.retentionDays,sourceIds:[source.id]});const current=await prisma.auditLog.findUniqueOrThrow({where:{id:g.grant.id}});await prisma.auditLog.update({where:{id:g.grant.id},data:{metadata:{...(current.metadata as Prisma.JsonObject),resumePlan:false}}});}
  }catch{await prisma.auditLog.create({data:{organizationId:scope.organizationId,userId:actor,action:'amazon.sync.continuity.deferred',entityType:'AmazonSyncDataSource',entityId:source.id,metadata:{workspaceId:scope.workspaceId,code:'RECHECK_REQUIRED',retryAfterSeconds:60}}});}
 }
}
