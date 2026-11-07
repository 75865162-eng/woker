import { prisma } from '../src/lib/db/prisma';
import { decryptAmazonSpApiCredentials } from '../src/lib/amazon/integration-secrets';
import { AmazonSpApiClient, type AmazonRequestEvent } from '../src/lib/amazon/sp-api-client';
import { requestChange, decideChange, applyChange } from '../src/lib/amazon-sync/change-approval';
import { assertAmazonScopeAdmin } from '../src/lib/amazon-sync/data-access';
import { orderAccessEvidence } from '../src/lib/amazon-sync/order-access-evidence';
import { parseOrderDetail, parseOrderSyncPolicy } from '../src/lib/amazon-sync/orders';
import { setTimeout as pause } from 'node:timers/promises';
const scope={organizationId:'amazon-live-local',workspaceId:'default'};
const sites=['ATVPDKIKX0DER','A2EUQ1WTGCTBG2','A1AM78C64UM0Y8','A2Q3Y263D00KWC'];
const expected=['406f3b73-d57e-4a1a-95fa-f521c939eeb9','8133a1dc-c3c0-40c5-891f-eebe609413d3','98e1fb54-970c-441a-9a0a-a5b285a6f361','c673f4ba-d892-43c7-9257-c45d910a84ce'];
async function main(){
 const url=new URL(process.env.DATABASE_URL??'invalid:');
 if(process.argv[2]!=='--apply-approved-local'||url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/amazon_sync_live_local')throw Error('Explicit reviewed local target required');
 const sources=await prisma.amazonSyncDataSource.findMany({where:{...scope,resource:'orders',id:{in:expected},marketplaceId:{in:sites},enabled:true},include:{authorization:true}});
 if(sources.length!==4)throw Error('Reviewed scope changed');
 const pending=new Set(sources.map(s=>s.id));const deadline=Date.now()+15*60*1000;
 for(const s of sources){await assertAmazonScopeAdmin(scope,s.authorization.updatedByUserId);if(s.authorization.id!=='3895911f-89c4-4ebd-8212-dc58bede447e'||s.authorization.revision!==3)throw Error('Authorization changed');}
 async function approved(actor:string,command:Record<string,unknown>){const r=await requestChange(scope,actor,command);if((await decideChange(scope,actor,String(r.id),'APPROVED','用户批准本地四站订单商品详情恢复：核心商品字段、短期能力证据、窗口完成后切换并补齐已有订单；保留旧任务游标。')).status!=='APPROVED')throw Error('Stale approval');await applyChange(scope,actor,String(r.id));return String(r.id);}
 while(pending.size&&Date.now()<deadline){
  for(const id of [...pending]){
   const s=await prisma.amazonSyncDataSource.findFirstOrThrow({where:{...scope,id},include:{authorization:true,resourceCursor:true}});
   if(parseOrderSyncPolicy(s.orderPolicy).details){console.log(JSON.stringify({marketplaceId:s.marketplaceId,status:'ALREADY_CONFIGURED'}));pending.delete(id);continue;}
   if(s.authorization.id!=='3895911f-89c4-4ebd-8212-dc58bede447e'||s.authorization.revision!==3||s.authorization.status!=='CONFIGURED')throw Error('Authorization changed during recovery');
   if(s.resourceCursor?.status!=='SUCCEEDED')continue;
   const active=await prisma.amazonSyncRun.count({where:{...scope,sourceId:id,status:{in:['WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED']}}});if(active)continue;
   const actor=s.authorization.updatedByUserId;
   const plan=await prisma.amazonSyncSchedule.findFirstOrThrow({where:{...scope,resource:'orders',targets:{some:{sourceId:id}},enabled:true,planKey:{startsWith:'auto-v1:'}}});
   const order=await prisma.amazonOrderRecord.findFirst({where:{...scope,sourceId:id},orderBy:{sourceUpdatedAt:'desc'},select:{amazonOrderId:true,sourceUpdatedAt:true}});
   if(!order){console.log(JSON.stringify({marketplaceId:s.marketplaceId,status:'NO_ORDER_FOR_CAPABILITY_CHECK'}));pending.delete(id);continue;}
   // Pause only at a completed cursor; existing tasks and frozen windows stay intact.
   await approved(actor,{action:'save-plan',id:plan.id,revision:plan.revision,name:plan.name,resource:'orders',enabled:false,mode:plan.mode,intervalMinutes:plan.intervalMinutes,priority:plan.priority,maxAttempts:plan.maxAttempts,retentionDays:plan.retentionDays,sourceIds:[id]});
   const cursor=await prisma.amazonSyncResourceCursor.findUniqueOrThrow({where:{sourceId:id}});
   if(cursor.status!=='SUCCEEDED'||await prisma.amazonSyncRun.count({where:{...scope,sourceId:id,status:{in:['WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED']}}}))throw Error('Window raced; plan paused, preserve cursor and review');
   const events:AmazonRequestEvent[]=[];const a=s.authorization;
   const client=new AmazonSpApiClient({...decryptAmazonSpApiCredentials(a.credentialsCiphertext,{...scope,authorizationId:a.id}),region:a.awsRegion,endpoint:a.endpoint},{requestTimeoutMs:20000,cacheScope:'approved-order-items-recovery',onResponse:e=>events.push(e)});
   const response=await client.getOrder({orderId:order.amazonOrderId,includedData:[]});
   parseOrderDetail(response.body,order.amazonOrderId,s.marketplaceId,parseOrderSyncPolicy(s.orderPolicy),order.sourceUpdatedAt);
   const event=events.findLast(e=>e.operation==='getOrder');
   const proof=orderAccessEvidence({...scope,authorizationId:a.id,authorizationRevision:a.revision,marketplaceId:s.marketplaceId},{status:event?.status??0,requestId:event?.requestId??null,parsed:true});
   await approved(actor,{action:'save-source',revision:s.revision,authorizationId:a.id,sellerAccountId:s.sellerAccountId,marketplaceId:s.marketplaceId,resource:'orders',enabled:true,freshnessMinutes:s.freshnessMinutes,orderPolicy:{...parseOrderSyncPolicy(s.orderPolicy),details:{includedData:[],requiredRoles:['Inventory and Order Tracking'],purpose:'operations_order_items',requestsPerSecond:.2,burst:1,maxOrders:5000,backfillExisting:true,accessEvidence:proof}}});
   const approvalId=await approved(actor,{action:'run',sourceIds:[id]});
   const run=await prisma.amazonSyncRun.findFirstOrThrow({where:{...scope,sourceId:id,executionApprovalId:approvalId},select:{id:true,status:true}});
   console.log(JSON.stringify({marketplaceId:s.marketplaceId,status:'DETAIL_BACKFILL_STARTED',taskId:run.id,planPaused:true,capabilityHours:24}));pending.delete(id);
  }
  if(pending.size)await pause(2000);
 }
 console.log(JSON.stringify({done:true,pending:[...pending],plansRemainPausedForConfiguredSources:true}));
}
main().catch(e=>{console.error(JSON.stringify({stopped:true,name:e.name,reason:e.name==='SyncInputError'?e.message:undefined}));process.exitCode=1}).finally(()=>prisma.$disconnect());
