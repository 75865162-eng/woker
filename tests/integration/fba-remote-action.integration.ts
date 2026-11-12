import assert from 'node:assert/strict';
import {prisma} from '../../src/lib/db/prisma';
import type {WmsScope} from '../../src/lib/wms/contracts';
import {mutateRemoteAction,queryRemoteActions} from '../../src/lib/fba-local/remote-action-service';
import {processFbaRemoteAction,recoverExpiredFbaRemoteActions} from '../../src/lib/fba-local/remote-action-executor';
export async function remoteActionFixture(scope:WmsScope,reviewer:WmsScope){
 process.env.AMAZON_SP_API_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
 const plan=await prisma.fbaLocalPlan.create({data:{id:'remote-fixture-plan',organizationId:scope.organizationId,workspaceId:scope.workspaceId,sellerAccountId:'port-seller',marketplaceId:'SITE',number:'REMOTE-FIXTURE',idempotencyKey:'remote-fixture',requestHash:'fixture',createdBy:scope.actorUserId}});
 const policyInput={action:'configure-policy',planId:plan.id,revision:0,authorizationId:'port-auth',allowedOperations:['generatePlacementOptions','getInboundPlan','listInboundPlans','updateInboundPlanName','createMarketplaceItemLabels','listInboundPlanBoxes','getShipment'],enabled:true,contractReference:'Explicit offline fixture contract approval',expiresAt:new Date(Date.now()+3600000).toISOString()};
 await mutateRemoteAction(scope,policyInput);await assert.rejects(()=>mutateRemoteAction(scope,policyInput));
 await prisma.fbaRemotePlanBinding.create({data:{id:'remote-binding',organizationId:scope.organizationId,workspaceId:scope.workspaceId,planId:plan.id,externalPlanId:'AMZ-REMOTE-PLAN',sourceReference:'Synthetic original verified plan',createdBy:scope.actorUserId}});
 const draftInput={action:'draft',planId:plan.id,expectedRevision:1,idempotencyKey:'remote-generate',request:{operation:'generatePlacementOptions',pathParameters:{inboundPlanId:'AMZ-REMOTE-PLAN'},body:{}}};
 await assert.rejects(()=>mutateRemoteAction(scope,{...draftInput,request:{operation:'listInboundPlans'}}));await assert.rejects(()=>mutateRemoteAction(scope,{...draftInput,request:{...draftInput.request,pathParameters:{inboundPlanId:'FOREIGN'}}}));
 const draft=await mutateRemoteAction(scope,draftInput) as {record:{id:string}},id=draft.record.id;assert.equal((await mutateRemoteAction(scope,draftInput) as {reused:boolean}).reused,true);
 assert.ok(!(JSON.stringify(await queryRemoteActions(scope,new URLSearchParams({planId:plan.id})))).includes('requestCiphertext'));
 await assert.rejects(()=>mutateRemoteAction(scope,{action:'approve',planId:plan.id,actionId:id,revision:1,evidence:'Self review'}));
 await mutateRemoteAction(reviewer,{action:'approve',planId:plan.id,actionId:id,revision:1,evidence:'Independent request review'});await mutateRemoteAction(scope,{action:'enqueue',planId:plan.id,actionId:id,revision:2,evidence:'Explicit queue'});
 let submitted=0,polled=0;const fixtureTransport={submit:async()=>{submitted++;return {body:{operationId:'REMOTE-OP'}};},poll:async()=>{polled++;return {body:{operationId:'REMOTE-OP',operation:'generatePlacementOptions',operationStatus:'SUCCESS'}};}};
 const executions=await Promise.all(Array.from({length:6},()=>processFbaRemoteAction(id,{fixtureTransport})));assert.equal(submitted,1);assert.equal(executions.filter(row=>row.status==='WAITING').length,1);
 await prisma.fbaRemoteAction.update({where:{id},data:{status:'POLLING',leaseToken:'expired',leaseExpiresAt:new Date(0)}});await recoverExpiredFbaRemoteActions();assert.equal((await prisma.fbaRemoteAction.findUniqueOrThrow({where:{id}})).status,'WAITING');
 await prisma.fbaRemoteAction.update({where:{id},data:{status:'POLLING',leaseToken:'expired-again',leaseExpiresAt:new Date(0)}});await recoverExpiredFbaRemoteActions();
 assert.equal((await processFbaRemoteAction(id,{fixtureTransport})).status,'SUCCEEDED');assert.equal(polled,1);assert.equal(submitted,1);
 await assert.rejects(()=>prisma.fbaRemoteAction.update({where:{id},data:{requestHash:'replacement'}}));
 const second=await mutateRemoteAction(scope,{...draftInput,idempotencyKey:'remote-unknown'}) as {record:{id:string}};await mutateRemoteAction(reviewer,{action:'approve',planId:plan.id,actionId:second.record.id,revision:1,evidence:'Independent unknown fixture'});await mutateRemoteAction(scope,{action:'enqueue',planId:plan.id,actionId:second.record.id,revision:2,evidence:'Queue uncertain fixture'});
 const uncertain={submit:async()=>{throw Error('Synthetic network lost after dispatch');},poll:fixtureTransport.poll};assert.equal((await processFbaRemoteAction(second.record.id,{fixtureTransport:uncertain})).status,'RESULT_UNKNOWN');assert.equal((await processFbaRemoteAction(second.record.id,{fixtureTransport})).status,'SKIPPED');
 await assert.rejects(()=>prisma.fbaRemoteAction.update({where:{id:second.record.id},data:{status:'QUEUED'}}));
 const unknown=await prisma.fbaRemoteAction.findUniqueOrThrow({where:{id:second.record.id}});await mutateRemoteAction(reviewer,{action:'recover-known-operation',planId:plan.id,actionId:unknown.id,revision:unknown.revision,operationId:'REMOTE-OP',evidence:'Independent original operation ID recovery'});
 assert.equal((await processFbaRemoteAction(unknown.id,{fixtureTransport:{...fixtureTransport,poll:async()=>({body:{operationId:'FOREIGN-OP',operation:'generatePlacementOptions',operationStatus:'SUCCESS'}})}})).status,'WAITING');

 await prisma.fbaRemoteAction.update({where:{id:unknown.id},data:{status:'POLLING',leaseToken:'fixture-expired-poll',leaseExpiresAt:new Date(0)}});await recoverExpiredFbaRemoteActions();assert.equal((await processFbaRemoteAction(unknown.id,{fixtureTransport})).status,'SUCCEEDED');
 const rename=await mutateRemoteAction(scope,{...draftInput,idempotencyKey:'remote-sync-void',request:{operation:'updateInboundPlanName',pathParameters:{inboundPlanId:'AMZ-REMOTE-PLAN'},body:{name:'Synthetic rename'}}}) as {record:{id:string}};
 await mutateRemoteAction(reviewer,{action:'approve',planId:plan.id,actionId:rename.record.id,revision:1,evidence:'Independent synchronous request review'});await mutateRemoteAction(scope,{action:'enqueue',planId:plan.id,actionId:rename.record.id,revision:2,evidence:'Explicit synchronous fixture queue'});
 assert.equal((await processFbaRemoteAction(rename.record.id,{fixtureTransport:{submit:async()=>({body:null}),poll:async()=>{throw Error('Synchronous operation must not poll');}}})).status,'SUCCEEDED');

 const identity={organizationId:scope.organizationId,workspaceId:scope.workspaceId};
 await prisma.productRecord.create({data:{...identity,id:'remote-product',userId:scope.actorUserId,sku:'REMOTE-LABEL',payload:{}}});
 await prisma.wmsWarehouse.create({data:{...identity,id:'remote-warehouse',code:'REMOTE',name:'Synthetic label warehouse'}});
 await prisma.wmsArea.create({data:{...identity,id:'remote-area',warehouseId:'remote-warehouse',code:'REMOTE',name:'Synthetic label area'}});
 await prisma.wmsLocation.create({data:{...identity,id:'remote-location',warehouseId:'remote-warehouse',areaId:'remote-area',code:'REMOTE',kind:'STORAGE'}});
 await prisma.wmsLot.create({data:{...identity,id:'remote-lot',productRecordId:'remote-product',lotCode:'REMOTE'}});
 const balance=await prisma.wmsStockBalance.create({data:{...identity,id:'remote-balance',warehouseId:'remote-warehouse',locationId:'remote-location',lotId:'remote-lot'}});
 await prisma.fbaLocalPlanLine.create({data:{id:'remote-label-line',organizationId:scope.organizationId,workspaceId:scope.workspaceId,planId:plan.id,balanceId:balance.id,quantity:2}});
 const labels=await mutateRemoteAction(scope,{...draftInput,idempotencyKey:'remote-label',lineMapping:[{planLineId:'remote-label-line',sellerSku:'FIXTURE-MSKU',evidence:'Explicit synthetic mapping'}],request:{operation:'createMarketplaceItemLabels',body:{marketplaceId:'SITE',labelType:'STANDARD_FORMAT',mskuQuantities:[{msku:'FIXTURE-MSKU',quantity:2}]}}}) as {record:{id:string}};
 await mutateRemoteAction(reviewer,{action:'approve',planId:plan.id,actionId:labels.record.id,revision:1,evidence:'Independent label mapping review'});await mutateRemoteAction(scope,{action:'enqueue',planId:plan.id,actionId:labels.record.id,revision:2,evidence:'Explicit label fixture queue'});
 assert.equal((await processFbaRemoteAction(labels.record.id,{fixtureTransport:{submit:async()=>({body:{documentUrl:'https://fixture.invalid/never-downloaded-label.pdf'}}),poll:async()=>{throw Error('Synchronous label must not poll');}}})).status,'SUCCEEDED');
 assert.ok(JSON.stringify(await queryRemoteActions(scope,new URLSearchParams({planId:plan.id,actionId:labels.record.id}))).includes('never-downloaded-label.pdf'));
 async function queueRead(key:string){const value=await mutateRemoteAction(scope,{...draftInput,idempotencyKey:key,request:{operation:'listInboundPlanBoxes',pathParameters:{inboundPlanId:'AMZ-REMOTE-PLAN'}}}) as {record:{id:string}};await mutateRemoteAction(reviewer,{action:'approve',planId:plan.id,actionId:value.record.id,revision:1,evidence:'Independent read retry review'});await mutateRemoteAction(scope,{action:'enqueue',planId:plan.id,actionId:value.record.id,revision:2,evidence:'Explicit separate read queue'});return value.record.id;}
 const failedRead=await queueRead('remote-read-failed');let readAttempts=0;
 assert.equal((await processFbaRemoteAction(failedRead,{fixtureTransport:{submit:async()=>{readAttempts++;throw Error('Synthetic GET connection lost');},poll:fixtureTransport.poll}})).status,'FAILED');assert.equal(readAttempts,1);
 assert.equal((await processFbaRemoteAction(failedRead,{fixtureTransport})).status,'SKIPPED');
 const expiredRead=await queueRead('remote-read-expired');await prisma.fbaRemoteAction.update({where:{id:expiredRead},data:{status:'SENDING',leaseToken:'expired-get',leaseExpiresAt:new Date(0)}});await recoverExpiredFbaRemoteActions();const expired=await prisma.fbaRemoteAction.findUniqueOrThrow({where:{id:expiredRead}});assert.equal(expired.status,'FAILED');assert.equal(expired.nextRunAt,null);assert.equal(expired.errorCode,'READ_LEASE_EXPIRED');
 // This separately approved operation proves neither failed GET leaves a plan-wide unknown-result lock.
 const boxes=await mutateRemoteAction(scope,{...draftInput,idempotencyKey:'remote-box-read',request:{operation:'listInboundPlanBoxes',pathParameters:{inboundPlanId:'AMZ-REMOTE-PLAN'}}}) as {record:{id:string}};
 await mutateRemoteAction(reviewer,{action:'approve',planId:plan.id,actionId:boxes.record.id,revision:1,evidence:'Independent source read review'});await mutateRemoteAction(scope,{action:'enqueue',planId:plan.id,actionId:boxes.record.id,revision:2,evidence:'Explicit source read queue'});
 const rawBoxes='{"boxes":[{"boxId":"REMOTE-BOX","quantity":1,"weight":{"unit":"KG","value":9007199254740993.000001},"items":[{"msku":"FIXTURE-MSKU","quantity":2}]}],"pagination":{"nextToken":"PRIVATE-CONTINUATION"}}';
 assert.equal((await processFbaRemoteAction(boxes.record.id,{fixtureTransport:{submit:async()=>({body:JSON.parse(rawBoxes),rawBody:rawBoxes}),poll:async()=>{throw Error('Read must not poll');}}})).status,'SUCCEEDED');
 const read=await prisma.fbaRemoteReadSnapshot.findFirstOrThrow({where:{...identity,actionId:boxes.record.id}});assert.equal(read.continuationTokenPresent,true);assert.equal(read.pageComplete,true);assert.ok(JSON.stringify(read.normalized).includes('9007199254740993.000001'));assert.ok(!JSON.stringify(read.normalized).includes('PRIVATE-CONTINUATION'));
 assert.equal((await prisma.fbaLocalPlan.findUniqueOrThrow({where:{id:plan.id}})).packing,null);assert.equal((await prisma.wmsStockBalance.findUniqueOrThrow({where:{id:balance.id}})).onHand,0);
 await assert.rejects(()=>prisma.fbaRemoteReadSnapshot.update({where:{id:read.id},data:{sourceHash:'replacement'}}));
 const queried=await queryRemoteActions(scope,new URLSearchParams({planId:plan.id,actionId:boxes.record.id}));assert.ok(JSON.stringify(queried).includes('AMAZON_DECLARED_NOT_PHYSICAL_RECEIPT'));
 await assert.rejects(()=>queryRemoteActions({...scope,workspaceId:'other'},new URLSearchParams({planId:plan.id})));
 console.log('PASS: encrypted FBA request/policy/scope, independent approval, six-way one submit, async correlation, crash poll recovery, no unknown resend, immutable terminal state and scoped reads');
}
