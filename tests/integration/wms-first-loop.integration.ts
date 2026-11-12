import assert from 'node:assert/strict';
import { verifyWmsHttp } from './wms-http.integration';
import { prisma } from '../../src/lib/db/prisma';
import { createWmsResource } from '../../src/lib/wms/catalog-service';
import { requestApproval, decideApproval, needsApproval } from '../../src/lib/wms/approvals';
import { executeWmsCommand } from '../../src/lib/wms/application-service';
import { queryWms } from '../../src/lib/wms/query-service';
import type { WmsCommandInput, WmsCommandPayload } from '../../src/lib/wms/contracts';
async function main() {
if (process.env.WMS_OFFLINE_FIXTURE !== '1' || !process.env.DATABASE_URL?.includes('/wms_fixture')) throw Error('Disposable WMS fixture required');
const scope = { organizationId: 'wms-org', workspaceId: 'default', actorUserId: 'operator' };
const approver = { ...scope, actorUserId: 'approver' };
const grants = { wms: ['view','create','edit','approve'], operations: ['view','create','edit','approve'] };
await prisma.organization.create({ data: { id: scope.organizationId, name: 'Synthetic WMS', slug: 'synthetic-wms' } });
await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: 'Synthetic fixture' } });
for (const id of ['operator','approver']) {
  await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: id, passwordHash: 'not-a-password' } });
  await prisma.organizationMember.create({ data: { organizationId: scope.organizationId, userId: id, role: id === 'operator' ? 'owner' : 'warehouse_supervisor' } });
  if (id === 'operator') await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: 'owner', name: id, description: 'fixture', permissions: {...grants, products: ['view']} } });
}
await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: 'warehouse_supervisor', name: 'approver', description: 'fixture', permissions: {...grants, operations: ['view', 'approve']} } });
await prisma.productRecord.create({ data: { id:'fixture-product', organizationId: scope.organizationId, workspaceId:scope.workspaceId,userId:'operator',sku:'SYNTHETIC',payload:{} } });
const warehouse = await createWmsResource(scope,'warehouses',{code:'MAIN',name:'Fixture'});
const area = await createWmsResource(scope,'areas',{warehouseId:warehouse.id,code:'A',name:'Fixture'});
const receiving = await createWmsResource(scope,'locations',{areaId:area.id,code:'R',kind:'RECEIVING'});
const storage = await createWmsResource(scope,'locations',{areaId:area.id,code:'S',kind:'STORAGE'});
const lot = await createWmsResource(scope,'lots',{productRecordId:'fixture-product',lotCode:'FIXTURE'});
const receipt = await prisma.wmsReceipt.findUniqueOrThrow({ where:{id:(await createWmsResource(scope,'receipts',{receivingLocationId:receiving.id,number:'RCV-1',lines:[{lotId:lot.id,expectedQty:10}]})).id},include:{lines:true} });
let seq=0;
function command(aggregateId:string, expectedRevision:number, payload:WmsCommandPayload):WmsCommandInput {return {workspaceId:scope.workspaceId,aggregateId,expectedRevision,idempotencyKey:`fixture-${++seq}`,payload};}
async function approved(input:WmsCommandInput) {
 const approval=await requestApproval(scope,input);
 await assert.rejects(()=>decideApproval(scope,approval.id,1,true));
 await decideApproval(approver,approval.id,1,true);
 return approval.id;
}
async function run(input:WmsCommandInput) {
 const id=needsApproval(input.payload.action)?await approved(input):undefined;
 return await executeWmsCommand(scope,input,id) as unknown as {aggregateId:string;revision:number;movementIds:string[]};
}
const receive=command(receipt.id,1,{action:'RECEIVE',lines:[{lineId:receipt.lines[0].id,quantity:10}]});
const approvalRetries = await Promise.all(Array.from({length:20},()=>requestApproval(scope,receive)));
assert.equal(new Set(approvalRetries.map(row=>row.id)).size,1);
await assert.rejects(()=>requestApproval(scope,{...receive,payload:{action:'RECEIVE',lines:[{lineId:receipt.lines[0].id,quantity:9}]}}));
assert.equal(await prisma.wmsApproval.count(),1);
console.log('PASS: 20 concurrent approval requests create one approval; changed content under the same key is rejected');
const receiveApproval=await approved(receive);
const staleReceive = {...receive,idempotencyKey:'stale-receive-approval'};
const staleReceiveApproval=await approved(staleReceive);
const pendingStaleReceive=await requestApproval(scope,{...receive,idempotencyKey:'pending-stale-receive'});
const duplicates=await Promise.all(Array.from({length:20},()=>executeWmsCommand(scope,receive,receiveApproval)));
for (const row of duplicates) assert.deepEqual(row, duplicates[0]);
assert.equal(await prisma.wmsCommand.count(),1);
assert.equal(await prisma.wmsMovement.count(),1);
await assert.rejects(()=>decideApproval(approver,pendingStaleReceive.id,1,true));
assert.equal((await prisma.wmsApproval.findUniqueOrThrow({where:{id:pendingStaleReceive.id}})).status,'PENDING');
const rejectedDecision=await decideApproval(approver,pendingStaleReceive.id,1,false);
assert.equal(rejectedDecision.status,'REJECTED');
const rejectRetries=await Promise.all(Array.from({length:20},()=>decideApproval(approver,pendingStaleReceive.id,1,false)));
for(const row of rejectRetries) assert.deepEqual(row,rejectedDecision);
assert.equal(await prisma.auditLog.count({where:{entityId:pendingStaleReceive.id,action:'wms.approval.decide'}}),1);
await assert.rejects(()=>decideApproval(approver,pendingStaleReceive.id,1,true));
await prisma.user.create({data:{id:'other-approver',email:'other-approver@fixture.invalid',name:'Synthetic other approver',passwordHash:'not-a-password'}});
await prisma.organizationMember.create({data:{organizationId:scope.organizationId,userId:'other-approver',role:'warehouse_supervisor'}});
await assert.rejects(()=>decideApproval({...approver,actorUserId:'other-approver'},pendingStaleReceive.id,1,false));
assert.equal(await prisma.auditLog.count({where:{entityId:pendingStaleReceive.id,action:'wms.approval.decide'}}),1);
console.log('PASS: concurrent rejection retries preserve one decision/audit; another approver cannot claim the original decision');
await assert.rejects(()=>executeWmsCommand(scope,staleReceive,staleReceiveApproval));
assert.equal((await prisma.wmsApproval.findUniqueOrThrow({where:{id:staleReceiveApproval}})).status,'APPROVED');
assert.equal((await requestApproval(scope,receive)).id,receiveApproval);
console.log('PASS: execution rechecks receipt revision after approval; idempotent approval replay still returns the original after execution');
await assert.rejects(()=>executeWmsCommand(scope,{...receive,payload:{action:'RECEIVE',lines:[{lineId:receipt.lines[0].id,quantity:9}]}},receiveApproval));
await assert.rejects(()=>requestApproval(scope,command(receipt.id,2,{action:'INSPECT',lines:[{lineId:receipt.lines[0].id,acceptedQty:10,rejectedQty:1}]})));
await assert.rejects(()=>requestApproval(scope,command(receipt.id,2,{action:'INSPECT',lines:[{lineId:receipt.lines[0].id,acceptedQty:0,rejectedQty:0}]})));
await run(command(receipt.id,2,{action:'INSPECT',lines:[{lineId:receipt.lines[0].id,acceptedQty:8,rejectedQty:2}]}));
await assert.rejects(()=>requestApproval(scope,command(receipt.id,3,{action:'PUTAWAY',lines:[{lineId:receipt.lines[0].id,locationId:storage.id,quantity:9}]})));
await assert.rejects(()=>requestApproval(scope,command(receipt.id,3,{action:'PUTAWAY',lines:[{lineId:receipt.lines[0].id,locationId:receiving.id,quantity:8}]})));
await run(command(receipt.id,3,{action:'PUTAWAY',lines:[{lineId:receipt.lines[0].id,locationId:storage.id,quantity:8}]}));
const returnRejected = command(receipt.id,4,{action:'RETURN_REJECTED',lines:[{lineId:receipt.lines[0].id,quantity:1} ]});
await assert.rejects(()=>requestApproval(scope,command(receipt.id,4,{action:'RETURN_REJECTED',lines:[{lineId:receipt.lines[0].id,quantity:3}]})));
const returned = await run(returnRejected);
assert.equal(returned.movementIds.length,1);
const returnedReceipt = await prisma.wmsReceiptLine.findUniqueOrThrow({where:{id:receipt.lines[0].id}});
assert.equal(returnedReceipt.rejectedQty,2);
assert.equal(returnedReceipt.returnedQty,1);
await assert.rejects(()=>requestApproval(scope,command(receipt.id,5,{action:'RETURN_REJECTED',lines:[{lineId:receipt.lines[0].id,quantity:2}]})));
await run(command(receipt.id,5,{action:'RETURN_REJECTED',lines:[{lineId:receipt.lines[0].id,quantity:1}]}));
const returnBalance = await prisma.wmsStockBalance.findFirstOrThrow({where:{locationId:receiving.id,lotId:lot.id}});
assert.equal(returnBalance.rejected,0);
assert.equal(returnBalance.onHand,0);
assert.equal((await prisma.wmsReceiptLine.findUniqueOrThrow({where:{id:receipt.lines[0].id}})).returnedQty,2);
const b=await prisma.wmsStockBalance.findFirstOrThrow({where:{locationId:storage.id}});
const stockApprovalCount=await prisma.wmsApproval.count();
for (const invalid of [
 command('missing-balance',1,{action:'RESERVE',number:'INVALID-MISSING',quantity:1}),
 command(b.id,b.revision+1,{action:'RESERVE',number:'INVALID-REVISION',quantity:1}),
 command(b.id,b.revision,{action:'RESERVE',number:'INVALID-AVAILABLE',quantity:9}),
]) await assert.rejects(()=>requestApproval(scope,invalid));
assert.equal(await prisma.wmsApproval.count(),stockApprovalCount);
const reserve=await run(command(b.id,b.revision,{action:'RESERVE',number:'RSV-1',quantity:6}));
const reservationApprovalCount=await prisma.wmsApproval.count();
await assert.rejects(()=>requestApproval(scope,command(reserve.aggregateId,1,{action:'DISPATCH',quantity:1})));
await assert.rejects(()=>requestApproval(scope,command(reserve.aggregateId,1,{action:'RELEASE',quantity:7})));
const balanceAfterReserve=await prisma.wmsStockBalance.findUniqueOrThrow({where:{id:b.id}});
await assert.rejects(()=>requestApproval(scope,command(b.id,balanceAfterReserve.revision,{action:'RESERVE',number:'RSV-1',quantity:1})));
assert.equal(await prisma.wmsApproval.count(),reservationApprovalCount);
const staleRelease=command(reserve.aggregateId,1,{action:'RELEASE',quantity:1});
const staleReleaseApproval=await approved(staleRelease);
const pendingStaleRelease=await requestApproval(scope,{...staleRelease,idempotencyKey:'pending-stale-release'});
await run(command(reserve.aggregateId,1,{action:'PICK',quantity:4}));
await assert.rejects(()=>executeWmsCommand(scope,staleRelease,staleReleaseApproval));
await assert.rejects(()=>decideApproval(approver,pendingStaleRelease.id,1,true));
assert.equal((await prisma.wmsApproval.findUniqueOrThrow({where:{id:pendingStaleRelease.id}})).status,'PENDING');
assert.equal((await prisma.wmsApproval.findUniqueOrThrow({where:{id:staleReleaseApproval}})).status,'APPROVED');
await assert.rejects(()=>requestApproval(scope,command(reserve.aggregateId,1,{action:'RELEASE',quantity:1})));
await assert.rejects(()=>requestApproval(scope,command(reserve.aggregateId,2,{action:'RELEASE',quantity:3})));
await assert.rejects(()=>requestApproval(scope,command(reserve.aggregateId,2,{action:'DISPATCH',quantity:5})));
console.log('PASS: stock approval preflight rejects unavailable stock, duplicate number, stale revision, unpicked dispatch and release of picked quantities; execution still rejects approval invalidated by picking');
await run(command(reserve.aggregateId,2,{action:'DISPATCH',quantity:4}));
await run(command(reserve.aggregateId,3,{action:'RELEASE',quantity:2}));
const balances=await prisma.wmsStockBalance.findMany();
assert.equal(balances.find(row=>row.locationId===storage.id)!.onHand,4);
assert.equal(balances.find(row=>row.locationId===storage.id)!.reserved,0);
assert.equal(balances.find(row=>row.locationId===receiving.id)!.onHand,0);
assert.equal(balances.find(row=>row.locationId===receiving.id)!.rejected,0);
for (const balance of balances) {
 const movements=await prisma.wmsMovement.findMany({where:{balanceId:balance.id}});
 for (const [field,delta] of [['onHand','deltaOnHand'],['pendingQc','deltaPendingQc'],['pendingPutaway','deltaPendingPutaway'],['rejected','deltaRejected'],['reserved','deltaReserved']] as const) assert.equal(balance[field],movements.reduce((total,row)=>total+row[delta],0));
}
console.log('PASS: receive10 / accept8 reject2 / return rejected2 / putaway8 / reserve6 / pick4 / dispatch4 / release2; all movements reconcile');
const transferTarget = await createWmsResource(scope,'locations',{areaId:area.id,code:'S2',kind:'STORAGE'});
const transferSource = await prisma.wmsStockBalance.findFirstOrThrow({where:{locationId:storage.id}});
for (const invalid of [
 command(transferSource.id,transferSource.revision,{action:'TRANSFER',targetLocationId:storage.id,quantity:1}),
 command(transferSource.id,transferSource.revision,{action:'TRANSFER',targetLocationId:receiving.id,quantity:1}),
 command(transferSource.id,transferSource.revision,{action:'TRANSFER',targetLocationId:transferTarget.id,quantity:5}),
]) await assert.rejects(()=>requestApproval(scope,invalid));
const disabledTarget = await createWmsResource(scope,'locations',{areaId:area.id,code:'S3',kind:'STORAGE'});
await prisma.wmsLocation.update({where:{id:disabledTarget.id},data:{enabled:false}});
await assert.rejects(()=>requestApproval(scope,command(transferSource.id,transferSource.revision,{action:'TRANSFER',targetLocationId:disabledTarget.id,quantity:1})));
await prisma.wmsLocation.update({where:{id:disabledTarget.id},data:{enabled:true}});
const transfer = command(transferSource.id,transferSource.revision,{action:'TRANSFER',targetLocationId:transferTarget.id,quantity:1});
const transferApproval = await approved(transfer);
const transferResults = await Promise.all(Array.from({length:10},()=>executeWmsCommand(scope,transfer,transferApproval) as unknown as Promise<{commandId:string;movementIds:string[];targetBalanceId:string}>));
for (const row of transferResults) assert.deepEqual(row,transferResults[0]);
assert.equal(transferResults[0].movementIds.length,2);
const transferCommand = await prisma.wmsCommand.findUniqueOrThrow({where:{id:transferResults[0].commandId}});
assert.equal(transferCommand.action,'TRANSFER');
const transferMovements = await prisma.wmsMovement.findMany({where:{commandId:transferCommand.id},orderBy:{sequence:'asc'}});
assert.equal(transferMovements.length,2);
assert.equal(transferMovements[0].balanceId,transferSource.id);
assert.equal(transferMovements[0].deltaOnHand,-1);
assert.equal(transferMovements[1].balanceId,transferResults[0].targetBalanceId);
assert.equal(transferMovements[1].deltaOnHand,1);
assert.equal(transferMovements[0].sequence,0);
assert.equal(transferMovements[1].sequence,1);
assert.equal((await prisma.wmsStockBalance.findUniqueOrThrow({where:{id:transferSource.id}})).onHand,3);
assert.equal((await prisma.wmsStockBalance.findUniqueOrThrow({where:{id:transferResults[0].targetBalanceId}})).onHand,1);
const transferHistory = await queryWms(scope,'transfers',new URLSearchParams({sourceId:transferCommand.id})) as {items:Array<{id:string;deltaOnHand:number}>;nextCursor:string|null};
assert.equal(transferHistory.items.length,2);
assert.deepEqual(transferHistory.items.map(row=>(row as {id:string}).id).sort(),transferMovements.map(row=>row.id).sort());
assert.deepEqual(transferHistory.items.map(row=>(row as {deltaOnHand:number}).deltaOnHand).sort((a,b)=>a-b),[-1,1]);
await assert.rejects(()=>queryWms({...scope,workspaceId:'other'},'transfers',new URLSearchParams({sourceId:transferCommand.id})));
console.log('PASS: approved transfer moves one lot atomically across two storage balances, writes paired movements once, and rejects invalid targets/insufficient stock');
console.log('PASS: 20 concurrent same-key requests mutate once; changed content and self-approval rejected');
// Partial-line failure must roll back the first line and leave approval reusable.
const lot2 = await createWmsResource(scope,'lots',{productRecordId:'fixture-product',lotCode:'ROLLBACK'});
const rollbackReceipt = await prisma.wmsReceipt.findUniqueOrThrow({where:{id:(await createWmsResource(scope,'receipts',{receivingLocationId:receiving.id,number:'ROLLBACK',lines:[{lotId:lot.id,expectedQty:1},{lotId:lot2.id,expectedQty:1}]})).id},include:{lines:true}});
const invalidReceiptCount = await prisma.wmsApproval.count();
const invalidRequests = [
 command('missing-receipt',1,{action:'RECEIVE',lines:[{lineId:receipt.lines[0].id,quantity:1}]}),
 command(rollbackReceipt.id,2,{action:'RECEIVE',lines:rollbackReceipt.lines.map(line=>({lineId:line.id,quantity:1}))}),
 command(rollbackReceipt.id,1,{action:'RECEIVE',lines:rollbackReceipt.lines.map((line,index)=>({lineId:line.id,quantity:index===0?1:2}))}),
 command(rollbackReceipt.id,1,{action:'RECEIVE',lines:[{lineId:receipt.lines[0].id,quantity:1},{lineId:rollbackReceipt.lines[1].id,quantity:1}]}),
 command(rollbackReceipt.id,1,{action:'INSPECT',lines:[{lineId:rollbackReceipt.lines[0].id,acceptedQty:1,rejectedQty:0}]}),
];
for (const invalid of invalidRequests) await assert.rejects(()=>requestApproval(scope,invalid));
assert.equal(await prisma.wmsApproval.count(),invalidReceiptCount);
console.log('PASS: missing/stale/over-quantity/foreign-line/wrong-state receipt approvals are rejected without storing approvals');
const failed = command(rollbackReceipt.id,1,{action:'RECEIVE',lines:rollbackReceipt.lines.map(line=>({lineId:line.id,quantity:1}))});
const failedApproval = await approved(failed);
const beforeMovements = await prisma.wmsMovement.count();
// Inject a storage failure on the second line after the first line has mutated.
await prisma.$executeRawUnsafe(`CREATE FUNCTION wms_fixture_second_line_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."sourceLineId" = '${rollbackReceipt.lines[1].id}' THEN RAISE EXCEPTION 'synthetic second-line storage failure'; END IF; RETURN NEW; END $$`);
await prisma.$executeRawUnsafe('CREATE TRIGGER wms_fixture_second_line_failure BEFORE INSERT ON "WmsMovement" FOR EACH ROW EXECUTE FUNCTION wms_fixture_second_line_failure()');
try { await assert.rejects(()=>executeWmsCommand(scope,failed,failedApproval)); }
finally {
 await prisma.$executeRawUnsafe('DROP TRIGGER wms_fixture_second_line_failure ON "WmsMovement"');
 await prisma.$executeRawUnsafe('DROP FUNCTION wms_fixture_second_line_failure()');
}
assert.equal(await prisma.wmsMovement.count(),beforeMovements);
assert.equal((await prisma.wmsReceipt.findUniqueOrThrow({where:{id:rollbackReceipt.id}})).revision,1);
assert.equal((await prisma.wmsApproval.findUniqueOrThrow({where:{id:failedApproval}})).status,'APPROVED');
const expire = command(rollbackReceipt.id,1,{action:'RECEIVE',lines:rollbackReceipt.lines.map(line=>({lineId:line.id,quantity:1}))});
const expireApproval = await approved(expire);
await prisma.wmsApproval.update({where:{id:expireApproval},data:{expiresAt:new Date(Date.now()-1000)}});
await assert.rejects(()=>executeWmsCommand(scope,expire,expireApproval));
const revoked = command(rollbackReceipt.id,1,{action:'RECEIVE',lines:rollbackReceipt.lines.map(line=>({lineId:line.id,quantity:1}))});
const revokedApproval = await approved(revoked);
await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:scope.organizationId,id:'warehouse_supervisor'}},data:{permissions:{wms:['view']}}});
assert.deepEqual((await prisma.organizationRosterRole.findUniqueOrThrow({where:{organizationId_id:{organizationId:scope.organizationId,id:'warehouse_supervisor'}}})).permissions,{wms:['view']});
await assert.rejects(()=>executeWmsCommand(scope,revoked,revokedApproval));
await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:scope.organizationId,id:'warehouse_supervisor'}},data:{permissions:grants}});
await assert.rejects(()=>executeWmsCommand({...scope,workspaceId:'other'},{...revoked,workspaceId:'other'},revokedApproval));
assert.equal(await prisma.wmsMovement.count(),beforeMovements);
console.log('PASS: second-line failure rolls back entire receipt; expired, revoked approver and cross-workspace approvals cannot mutate inventory');
const requesterRevoked=await requestApproval(scope,command(rollbackReceipt.id,1,{action:'RECEIVE',lines:rollbackReceipt.lines.map(line=>({lineId:line.id,quantity:1}))}));
const approvalAuditCount=await prisma.auditLog.count({where:{entityId:requesterRevoked.id,action:'wms.approval.decide'}});
await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:scope.organizationId,id:'owner'}},data:{permissions:{wms:['view']}}});
try {
 await assert.rejects(()=>decideApproval(approver,requesterRevoked.id,1,true));
 const pending=await prisma.wmsApproval.findUniqueOrThrow({where:{id:requesterRevoked.id}});
 assert.equal(pending.status,'PENDING'); assert.equal(pending.revision,1); assert.equal(pending.approvedBy,null);
 assert.equal(await prisma.auditLog.count({where:{entityId:requesterRevoked.id,action:'wms.approval.decide'}}),approvalAuditCount);
 // Supervisors must still be able to reject a request whose requester lost access.
 assert.equal((await decideApproval(approver,requesterRevoked.id,1,false)).status,'REJECTED');
} finally {
 await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:scope.organizationId,id:'owner'}},data:{permissions:{...grants,products:['view']}}});
}
console.log('PASS: approval decision rechecks receipt/reservation revision and requester authorization; rejected approval attempts leave status/revision/audit unchanged, while rejection remains available');
await verifyWmsHttp();
const reservationCount=await prisma.wmsReservation.count();
const count=await prisma.wmsCommand.count();
const bad=command(b.id,(await prisma.wmsStockBalance.findUniqueOrThrow({where:{id:b.id}})).revision,{action:'RESERVE',number:'TOO-MUCH',quantity:100});
await assert.rejects(()=>run(bad));
assert.equal(await prisma.wmsCommand.count(),count);
assert.equal(await prisma.wmsReservation.count(),reservationCount);
console.log('PASS: insufficient inventory rolls back command, reservation, movement and approval consumption');
const current=await prisma.wmsStockBalance.findUniqueOrThrow({where:{id:b.id}});
const concurrent=[command(b.id,current.revision,{action:'RESERVE',number:'RACE-1',quantity:3}),command(b.id,current.revision,{action:'RESERVE',number:'RACE-2',quantity:3})];
const approvals=await Promise.all(concurrent.map(approved));
const raced=await Promise.allSettled(concurrent.map((input,i)=>executeWmsCommand(scope,input,approvals[i])));
assert.equal(raced.filter(row=>row.status==='fulfilled').length,1);
console.log('PASS: concurrent reservations cannot oversell');
await assert.rejects(()=>prisma.$executeRaw`UPDATE "WmsMovement" SET action='TAMPER'`);
await assert.rejects(()=>prisma.wmsStockBalance.update({where:{id:b.id},data:{onHand:-1}}));
const page=await queryWms(scope,'movements',new URLSearchParams({limit:'2'}));
assert.equal(page.items.length,2); assert.ok(page.nextCursor);
await assert.rejects(()=>queryWms({...scope,workspaceId:'other'},'movements',new URLSearchParams({cursor:page.nextCursor!})));
await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:scope.organizationId,id:'owner'}},data:{permissions:{}}});
await assert.rejects(()=>queryWms(scope,'balances',new URLSearchParams()));
await assert.rejects(()=>executeWmsCommand(scope,receive,receiveApproval));
console.log('PASS: immutable movements, quantity checks, scope-bound pagination and live permission revocation');
await prisma.$disconnect();

}
main().catch(async error=>{console.error(error);await prisma.$disconnect();process.exitCode=1;});
