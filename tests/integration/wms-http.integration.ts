import assert from 'node:assert/strict';
import {verifyWmsBrowser} from './wms-browser.integration';
import { createServer } from 'node:http';
import { prisma } from '../../src/lib/db/prisma';
import { createSession } from '../../src/lib/auth/session';
import * as resources from '../../src/app/api/operations/wms/[kind]/route';
import * as approvals from '../../src/app/api/operations/wms/approvals/route';
import * as commands from '../../src/app/api/operations/wms/commands/route';
import * as procurement from '../../src/app/api/operations/procurement/route';
import * as procurementApprovals from '../../src/app/api/operations/procurement/approvals/route';
import { reservationProgress } from '../../src/lib/wms/reservation-view';

export async function verifyWmsHttp() {
 const server=createServer(async (req,res)=>{
  try {
   const bytes=[];for await(const data of req) bytes.push(data);
   const url=`http://127.0.0.1${req.url}`;
   const headers=new Headers();for(const [key,value] of Object.entries(req.headers)) if(value) headers.set(key,Array.isArray(value)?value.join(','):value);
   const method=req.method ?? 'GET';
   const request=new Request(url,{method,headers,...(['POST','PATCH'].includes(method)?{body:Buffer.concat(bytes)}:{})});
   const pathname=new URL(url).pathname;
   const kind=pathname.split('/').at(-1)!;
   const response=pathname.endsWith('/procurement/approvals')?await procurementApprovals.PATCH(request):pathname.endsWith('/procurement')?(method==='GET'?await procurement.GET(request):method==='POST'?await procurement.POST(request):await procurement.PATCH(request)):kind==='commands'?await commands.POST(request):kind==='approvals'?(method==='POST'?await approvals.POST(request):await approvals.GET(request)):method==='POST'?await resources.POST(request,{params:Promise.resolve({kind})}):method==='PATCH'?await resources.PATCH(request,{params:Promise.resolve({kind})}):await resources.GET(request,{params:Promise.resolve({kind})});
   assert.ok(response);
   res.writeHead(response.status,Object.fromEntries(response.headers.entries()));res.end(await response.text());
  } catch(error) {res.writeHead(500);res.end(String(error));}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address && typeof address==='object');
 const serverBase=`http://127.0.0.1:${address.port}`;
 const base=`${serverBase}/api/operations/wms/`;
 const cookies:Record<string,string>={};
 for(const id of ['operator','approver']) {const {sessionCookie:c}=await createSession(id);cookies[id]=`${c.name}=${c.value}`;}
 async function call(kind:string,body?:unknown,actor='operator',expected=200) {
  const response=await fetch(base+kind,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-workspace-id':'default',...(actor?{cookie:cookies[actor]}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;
 }
 async function outboundPatch(body:Record<string,unknown>,expected=200,actor='operator') {
  const response=await fetch(base+'outbounds',{method:'PATCH',headers:{'content-type':'application/json','x-workspace-id':'default',cookie:cookies[actor]},body:JSON.stringify(body)});
  const result=await response.json();assert.equal(response.status,expected,`${actor} outbound ${String(body.action)}: ${JSON.stringify(result)}`);return result.item;
 }
 async function procurementCallAs(method:'POST'|'PATCH',body:Record<string,unknown>,actor='operator',expected=200) {
  const response=await fetch(`${serverBase}/api/operations/procurement`,{method,headers:{'content-type':'application/json','x-workspace-id':'default',cookie:cookies[actor]},body:JSON.stringify(body)});
  const result=await response.json();assert.equal(response.status,expected,`${actor} ${method} ${String(body.action ?? body.decision ?? "")}: ${JSON.stringify(result)}`);return result;
 }
 async function procurementCall(method:'POST'|'PATCH',body:Record<string,unknown>,expected=200) { return procurementCallAs(method,body,'operator',expected); }
 async function paymentApprovalCall(body:Record<string,unknown>,actor='operator',expected=200) {
  const response=await fetch(`${serverBase}/api/operations/procurement/approvals`,{method:'PATCH',headers:{'content-type':'application/json','x-workspace-id':'default',cookie:cookies[actor]},body:JSON.stringify(body)});
  const result=await response.json();assert.equal(response.status,expected,`${actor} payment approval: ${JSON.stringify(result)}`);return result;
 }
 async function placePurchaseOrder(order:{id:string;revision:number}) {
  const submitted=await procurementCall('PATCH',{action:'submit-approval',id:order.id,revision:order.revision});
  await procurementCallAs('PATCH',{id:submitted.approval.id,revision:submitted.approval.revision,decision:'APPROVE'},'approver');
  return (await procurementCall('PATCH',{action:'place-order',id:order.id,revision:submitted.order.revision+1})).order;
 }
 async function editDraft(body: Record<string, unknown>, actor = 'operator', expected = 200, workspace = 'default') {
  const response = await fetch(base+'receipts', { method:'PATCH', headers:{'content-type':'application/json','x-workspace-id':workspace,cookie:cookies[actor]},body:JSON.stringify(body) });
  const result = await response.json(); assert.equal(response.status,expected,JSON.stringify(result));return result.item;
 }
 try {
  await call('balances',undefined,'',401);
  const warehouse=(await call('warehouses',{code:'HTTP',name:'HTTP synthetic'},'operator',201)).item;
  const area=(await call('areas',{warehouseId:warehouse.id,code:'A',name:'HTTP'},'operator',201)).item;
  const location=(await call('locations',{areaId:area.id,code:'R',kind:'RECEIVING'},'operator',201)).item;
  const lot=await prisma.wmsLot.findFirstOrThrow();
  const outbound=(await call('outbounds',{warehouseId:warehouse.id,number:'HTTP-OUT',customer:'Synthetic customer',lines:[{productRecordId:'fixture-product',requestedQty:2}]},'operator',201)).item;
  assert.equal(outbound.status,'DRAFT');assert.equal(outbound.lines.length,1);assert.equal(outbound.lines[0].requestedQty,2);
  await call('outbounds',{warehouseId:warehouse.id,number:'HTTP-OUT-DUP',lines:[{productRecordId:'fixture-product',requestedQty:1},{productRecordId:'fixture-product',requestedQty:2}]},'operator',422);
  await call('outbounds',{warehouseId:warehouse.id,number:'HTTP-OUT-ZERO',lines:[{productRecordId:'fixture-product',requestedQty:0}]},'operator',400);
  await call('outbounds',{warehouseId:warehouse.id,number:'HTTP-OUT-FOREIGN',lines:[{productRecordId:'missing-workspace-product',requestedQty:1}]},'operator',422);
  const outboundList=await call('outbounds?number=HTTP-OUT');
  assert.equal(outboundList.items.length,1);assert.equal(outboundList.items[0].warehouse.code,'HTTP');
  assert.equal(outboundList.items[0].lines[0].allocatableQty,2);assert.equal(outboundList.items[0].lines[0].allocatedQty,0);assert.equal(outboundList.items[0].lines[0].dispatchedQty,0);
  const editedOutbound=await outboundPatch({action:'EDIT',id:outbound.id,revision:1,customer:'Updated synthetic customer',deliveryAddress:'Fixture address',carrier:'Fixture carrier',trackingNumber:'FIXTURE-TRACK',remark:'Edited before release',lines:[{productRecordId:'fixture-product',requestedQty:2}]});
  assert.equal(editedOutbound.revision,2);assert.equal(editedOutbound.customer,'Updated synthetic customer');assert.equal(editedOutbound.deliveryAddress,'Fixture address');
  await outboundPatch({action:'EDIT',id:outbound.id,revision:1,customer:'Stale',lines:[{productRecordId:'fixture-product',requestedQty:2}]},409);
  await outboundPatch({action:'EDIT',id:outbound.id,revision:2,customer:'Not creator',lines:[{productRecordId:'fixture-product',requestedQty:2}]},403,'approver');
  const cancellableOutbound=(await call('outbounds',{warehouseId:warehouse.id,number:'HTTP-OUT-CANCEL',lines:[{productRecordId:'fixture-product',requestedQty:1}]},'operator',201)).item;
  const cancelledOutbound=await outboundPatch({action:'CANCEL',id:cancellableOutbound.id,revision:1});
  assert.equal(cancelledOutbound.status,'CANCELLED');assert.equal(cancelledOutbound.revision,2);
  assert.equal(await prisma.auditLog.count({where:{entityId:cancellableOutbound.id,action:'wms.outbounds.cancel'}}),1);
  assert.equal(await prisma.wmsMovement.count({where:{sourceId:outbound.id}}),0,'outbound demand draft must not create inventory movements');
  const receipt=(await call('receipts',{receivingLocationId:location.id,number:'HTTP-RCV',lines:[{lotId:lot.id,expectedQty:3}]},'operator',201)).item;
  const command={workspaceId:'default',aggregateId:receipt.id,expectedRevision:1,idempotencyKey:'http-receive',payload:{action:'RECEIVE',lines:[{lineId:receipt.lines[0].id,quantity:3}]}};
  await call('approvals',{...command,idempotencyKey:'http-over-receive',payload:{action:'RECEIVE',lines:[{lineId:receipt.lines[0].id,quantity:4}]}},'operator',422);
  await call('approvals',{...command,idempotencyKey:'http-stale-receive',expectedRevision:2},'operator',409);
  assert.equal(await prisma.wmsApproval.count({where:{aggregateId:receipt.id}}),0);
  const approval=(await call('approvals',command,'operator',201)).item;
  await call('approvals',{decision:'APPROVE',approvalId:approval.id,revision:1},'operator',403);
  await prisma.wmsLocation.update({where:{id:location.id},data:{enabled:false}});
  await call('approvals',{decision:'APPROVE',approvalId:approval.id,revision:1},'approver',422);
  assert.equal((await prisma.wmsApproval.findUniqueOrThrow({where:{id:approval.id}})).status,'PENDING');
  await prisma.wmsLocation.update({where:{id:location.id},data:{enabled:true}});
  const decision={decision:'APPROVE',approvalId:approval.id,revision:1};
  const decisionResults=await Promise.all(Array.from({length:20},()=>call('approvals',decision,'approver')));
  for(const result of decisionResults) assert.deepEqual(result,decisionResults[0]);
  assert.equal(await prisma.auditLog.count({where:{entityId:approval.id,action:'wms.approval.decide'}}),1);
  await call('approvals',{...decision,decision:'REJECT'},'approver',409);
  await call('approvals',{...decision,revision:2},'approver',409);
  await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:'wms-org',id:'warehouse_supervisor'}},data:{permissions:{wms:['view']}}});
  try { await call('approvals',decision,'approver',403); }
  finally { await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:'wms-org',id:'warehouse_supervisor'}},data:{permissions:{wms:['view','create','edit','approve'],operations:['view','approve']}}}); }
  await prisma.wmsLocation.update({where:{id:location.id},data:{enabled:false}});
  await call('commands',{...command,approvalId:approval.id},'operator',422);
  assert.equal((await prisma.wmsApproval.findUniqueOrThrow({where:{id:approval.id}})).status,'APPROVED');
  assert.equal(await prisma.wmsMovement.count({where:{sourceId:receipt.id}}),0);
  await prisma.wmsLocation.update({where:{id:location.id},data:{enabled:true}});
  const first=await call('commands',{...command,approvalId:approval.id});
  console.log('PASS: actual HTTP rechecks receipt and receiving location at request, approval decision and execution');
  assert.deepEqual(await call('commands',{...command,approvalId:approval.id}),first);
  const consumedDecision=await call('approvals',decision,'approver');
  assert.equal(consumedDecision.item.status,'CONSUMED');
  assert.equal(await prisma.auditLog.count({where:{entityId:approval.id,action:'wms.approval.decide'}}),1);
  console.log('PASS: 20 actual HTTP approval decision retries return one persisted decision/audit; changed decision/revision and revoked approver are rejected; consumed replay stays consumed');
  const balances=await call(`balances?warehouseId=${warehouse.id}`);
  assert.equal(balances.items[0].onHand,3);assert.equal(balances.items[0].pendingQc,3);
  assert.equal(balances.items[0].available,0,'pending QC stock is not available');
  const movements=await call(`movements?sourceId=${receipt.id}`);assert.equal(movements.items.length,1);
  const storage=(await call('locations',{areaId:area.id,code:'S',kind:'STORAGE'},'operator',201)).item;
  let key=0;
  async function runHttp(aggregateId:string, expectedRevision:number, payload:Record<string,unknown>) {
   const next={workspaceId:'default',aggregateId,expectedRevision,idempotencyKey:`http-chain-${++key}`,payload};
   let approvalId: string | undefined;
   if(!['PICK','UNPICK','CANCEL'].includes(String(payload.action))) {
    const item=(await call('approvals',next,'operator',201)).item;
    const pending=(await call('approvals?status=PENDING&limit=100',undefined,'approver')).items.find((row:{id:string})=>row.id===item.id);
    assert.ok(pending);assert.equal('request' in pending,false);
    if(['RESERVE','TRANSFER','RELEASE','DISPATCH'].includes(String(payload.action))) {
     const sourceId=payload.action==='RESERVE'||payload.action==='TRANSFER'?aggregateId:(await prisma.wmsReservation.findUniqueOrThrow({where:{id:aggregateId}})).balanceId;
     const source=await prisma.wmsStockBalance.findUniqueOrThrow({where:{id:sourceId},include:{lot:true,location:{include:{area:{include:{warehouse:true}}}}}});
     assert.deepEqual(pending.stock,{warehouseId:source.warehouseId,warehouseCode:source.location.area.warehouse.code,warehouseName:source.location.area.warehouse.name,locationId:source.locationId,locationCode:source.location.code,locationFrozen:source.location.frozen,lotId:source.lotId,lotCode:source.lot.lotCode,productRecordId:source.lot.productRecordId,sku:'SYNTHETIC',barcode:source.lot.barcode});
     if(payload.action==='TRANSFER') {
      const target=await prisma.wmsLocation.findUniqueOrThrow({where:{id:String(payload.targetLocationId)},include:{area:{include:{warehouse:true}}}});
      assert.deepEqual(pending.targetLocation,{warehouseId:target.warehouseId,warehouseCode:target.area.warehouse.code,warehouseName:target.area.warehouse.name,locationId:target.id,locationCode:target.code});
     } else assert.equal(pending.targetLocation,null);
    } else { assert.equal(pending.stock,null);assert.equal(pending.targetLocation,null); }
    if(['RELEASE','DISPATCH'].includes(String(payload.action))) {
     const current=await prisma.wmsReservation.findUniqueOrThrow({where:{id:aggregateId}});
     assert.deepEqual(pending.reservation,{number:current.number,revision:current.revision,requestedQty:current.requestedQty,releasedQty:current.releasedQty,dispatchedQty:current.dispatchedQty,pickedQty:current.pickedQty,...reservationProgress(current)});
     const requester=(await call('approvals?aggregateId='+aggregateId+'&limit=100')).items.find((row:{id:string})=>row.id===item.id);
     assert.deepEqual(requester.reservation,pending.reservation);
    } else assert.equal(pending.reservation,null);
    await call('approvals',{decision:'APPROVE',approvalId:item.id,revision:1},'approver');approvalId=item.id;
   }
   return (await call('commands',{...next,...(approvalId?{approvalId}:{})})).item;
  }
  await runHttp(receipt.id,2,{action:'INSPECT',lines:[{lineId:receipt.lines[0].id,acceptedQty:3,rejectedQty:0}]});
  await runHttp(receipt.id,3,{action:'PUTAWAY',lines:[{lineId:receipt.lines[0].id,locationId:storage.id,quantity:3}]});
  const ready=(await call(`balances?locationId=${storage.id}`)).items[0];
  await call('approvals',{workspaceId:'default',aggregateId:ready.id,expectedRevision:ready.revision,idempotencyKey:'http-over-reserve',payload:{action:'RESERVE',number:'HTTP-TOO-MUCH',quantity:4}},'operator',422);
  await call('approvals',{workspaceId:'default',aggregateId:ready.id,expectedRevision:ready.revision,idempotencyKey:'http-over-demand',payload:{action:'RESERVE',number:'HTTP-OUT-OVER',quantity:3,outboundLineId:outbound.lines[0].id}},'operator',422);
  const reservation=await runHttp(ready.id,ready.revision,{action:'RESERVE',number:'HTTP-RSV',quantity:2,outboundLineId:outbound.lines[0].id});
  const linkedReservation=await prisma.wmsReservation.findUniqueOrThrow({where:{id:reservation.aggregateId}});
  assert.equal(linkedReservation.outboundLineId,outbound.lines[0].id);assert.equal(linkedReservation.outboundWarehouseId,warehouse.id);
  assert.equal((await call('outbounds?number=HTTP-OUT')).items[0].lines[0].allocatedQty,2);
  const activeOutbound=(await call('outbounds?number=HTTP-OUT')).items[0];
  await outboundPatch({action:'CANCEL',id:outbound.id,revision:activeOutbound.revision},409);
  const assertReservationProgress=async (id:string, remainingQty:number, unpickedQty:number, workflowStatus:string) => {
   const result=await call('reservations?limit=100');
   const item=result.items.find((row:{id:string})=>row.id===id);
   assert.ok(item);assert.equal(item.remainingQty,remainingQty);assert.equal(item.unpickedQty,unpickedQty);assert.equal(item.workflowStatus,workflowStatus);
   const expectedStock={warehouseId:warehouse.id,warehouseCode:warehouse.code,warehouseName:warehouse.name,locationId:storage.id,locationCode:storage.code,locationFrozen:false,lotId:lot.id,lotCode:lot.lotCode,productRecordId:lot.productRecordId,sku:'SYNTHETIC',barcode:lot.barcode};
   assert.deepEqual(item.stock,expectedStock);
   for (const status of ['ACTIVE','AWAITING_PICK','PARTIALLY_PICKED','AWAITING_DISPATCH','CLOSED']) {
    const filtered=await call('reservations?number='+encodeURIComponent(item.number)+'&balanceId='+encodeURIComponent(item.balanceId)+'&workflowStatus='+status);
    const expected=status==='ACTIVE' ? remainingQty>0 : status===workflowStatus;
    assert.deepEqual(filtered.items.map((row:{id:string})=>row.id),expected?[id]:[]);
    if(expected) assert.deepEqual(filtered.items[0].stock,expectedStock);
   }
  };
  await assertReservationProgress(reservation.aggregateId,2,2,'AWAITING_PICK');
  const invalidStockRequest={workspaceId:'default',aggregateId:reservation.aggregateId,expectedRevision:1,idempotencyKey:'http-unpicked-dispatch',payload:{action:'DISPATCH',quantity:1}};
  await call('approvals',invalidStockRequest,'operator',422);
  assert.equal(await prisma.wmsApproval.count({where:{aggregateId:reservation.aggregateId}}),0);
  await runHttp(reservation.aggregateId,1,{action:'PICK',quantity:1});
  await assertReservationProgress(reservation.aggregateId,2,1,'PARTIALLY_PICKED');
  await call('approvals',{...invalidStockRequest,expectedRevision:2,idempotencyKey:'http-picked-release',payload:{action:'RELEASE',quantity:2}},'operator',422);
  await prisma.wmsLocation.update({where:{id:storage.id},data:{enabled:false}});
  await call('approvals',{...invalidStockRequest,expectedRevision:2,idempotencyKey:'http-disabled-dispatch'},'operator',422);
  await prisma.wmsLocation.update({where:{id:storage.id},data:{enabled:true}});
  console.log('PASS: actual HTTP stock approval rejects insufficient inventory, unpicked dispatch, picked release and disabled storage locations');
  await runHttp(reservation.aggregateId,2,{action:'DISPATCH',quantity:1});
  await assertReservationProgress(reservation.aggregateId,1,1,'AWAITING_PICK');
  await runHttp(reservation.aggregateId,3,{action:'RELEASE',quantity:1});
  await assertReservationProgress(reservation.aggregateId,0,0,'CLOSED');
  const after=(await call(`balances?locationId=${storage.id}`)).items[0];assert.equal(after.onHand,2);assert.equal(after.reserved,0);
  const releasableDemand=(await call('outbounds?number=HTTP-OUT')).items[0];
  assert.equal(releasableDemand.status,'RELEASED');assert.equal(releasableDemand.lines[0].dispatchedQty,1);assert.equal(releasableDemand.lines[0].allocatableQty,1);
  console.log('PASS: full receive/inspect/putaway/reserve/pick/dispatch/release chain through actual HTTP routes');
  const transferTarget=(await call('locations',{areaId:area.id,code:'S2',kind:'STORAGE'},'operator',201)).item;
  const transfer=await runHttp(after.id,after.revision,{action:'TRANSFER',targetLocationId:transferTarget.id,quantity:1});
  assert.equal(transfer.movementIds.length,2);
  assert.equal((await call(`balances?locationId=${storage.id}`)).items[0].onHand,1);
  assert.equal((await call(`balances?locationId=${transferTarget.id}`)).items[0].onHand,1);
  const transferRows=await call(`movements?sourceId=${transfer.commandId}`);
  assert.equal(transferRows.items.length,2);
  assert.deepEqual(transferRows.items.map((row:Record<string,unknown>)=>Number(row.deltaOnHand)).sort((a:number,b:number)=>a-b),[-1,1]);
  const targetBalance=(await call(`balances?locationId=${transferTarget.id}`)).items[0];
  const finalReservation=await runHttp(targetBalance.id,targetBalance.revision,{action:'RESERVE',number:'HTTP-RSV-FINAL',quantity:1,outboundLineId:outbound.lines[0].id});
  await runHttp(finalReservation.aggregateId,1,{action:'PICK',quantity:1});
  await runHttp(finalReservation.aggregateId,2,{action:'DISPATCH',quantity:1});
  const completedOutbound=(await call('outbounds?number=HTTP-OUT')).items[0];
  assert.equal(completedOutbound.status,'COMPLETED');assert.equal(completedOutbound.lines[0].dispatchedQty,2);assert.equal(completedOutbound.lines[0].allocatableQty,0);
  const completedBalance=(await call(`balances?locationId=${transferTarget.id}`)).items[0];
  await call('approvals',{workspaceId:'default',aggregateId:completedBalance.id,expectedRevision:completedBalance.revision,idempotencyKey:'http-reserve-completed-outbound',payload:{action:'RESERVE',number:'HTTP-RSV-CLOSED',quantity:1,outboundLineId:outbound.lines[0].id}},'operator',409);
  console.log('PASS: outbound demand allocates through approved reservations, release restores demand, dispatch completes the line and closes the demand');
  console.log('PASS: actual HTTP transfer request, second-member approval and execution update both balances with paired movements');
  await call('commands',{...command,approvalId:approval.id,actorUserId:'spoof'},'operator',400);
  const supplier=(await procurementCall('POST',{action:'supplier',name:'HTTP procurement fixture'},201)).supplier;
  async function purchaseQuery(query='', workspace='default', expected=200) {
   const response=await fetch(`${serverBase}/api/operations/procurement?${query}`,{headers:{'x-workspace-id':workspace,cookie:cookies.operator}});
   const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;
  }
  await prisma.supplier.createMany({ data: Array.from({ length: 205 }, (_, i) => ({ id: 'supplier-query-' + i, organizationId: 'wms-org', name: 'AAA-SUPPLIER-' + String(i).padStart(3, '0'), normalizedName: 'aaa-supplier-' + i, contactName: 'contact-' + i, phone: 'phone-' + i, email: 'supplier-' + i + '@fixture.invalid' })) });
  await prisma.organization.create({ data: { id: 'supplier-foreign-org', name: 'Supplier isolated org', slug: 'supplier-foreign-org' } });
  await prisma.supplier.create({ data: { id: 'supplier-foreign', organizationId: 'supplier-foreign-org', name: 'AAA-SUPPLIER-204', normalizedName: 'aaa-supplier-204' } });
  const supplierPageOne = await purchaseQuery('view=suppliers&search=AAA-SUPPLIER');
  const supplierPageTwo = await purchaseQuery('view=suppliers&search=AAA-SUPPLIER&page=2');
  assert.equal(supplierPageOne.pagination.total, 205); assert.equal(supplierPageOne.suppliers.length, 20);
  assert.equal(new Set([...supplierPageOne.suppliers, ...supplierPageTwo.suppliers].map((item: { id: string }) => item.id)).size, 40);
  assert.equal('orders' in supplierPageOne, false); assert.equal('products' in supplierPageOne, false);
  const supplierLast = await purchaseQuery('view=suppliers&search=AAA-SUPPLIER&page=99');
  assert.equal(supplierLast.pagination.page, 11); assert.equal(supplierLast.suppliers.length, 5);
  for (const search of ['aaa-supplier-204', 'contact-204', 'phone-204', 'supplier-204@fixture.invalid']) {
    const found = await purchaseQuery('view=suppliers&search=' + encodeURIComponent(search));
    assert.equal(found.pagination.total, 1); assert.equal(found.suppliers[0].id, 'supplier-query-204');
  }
  for (const invalid of ['page=0', 'page=1.5', 'search=' + 'x'.repeat(121)]) await purchaseQuery('view=suppliers&' + invalid, 'default', 400);
  const initialOptions = await purchaseQuery();
  assert.equal(initialOptions.suppliers.length, 200);
  assert.ok(!initialOptions.suppliers.some((item: { id: string }) => item.id === 'supplier-query-204'));
  const selectedOptions = await purchaseQuery('supplierId=supplier-query-204');
  assert.equal(selectedOptions.suppliers.length, 201);
  assert.equal(selectedOptions.suppliers.filter((item: { id: string }) => item.id === 'supplier-query-204').length, 1);
  const foreignOptions = await purchaseQuery('supplierId=foreign-supplier');
  assert.equal(foreignOptions.pagination.total, 0);
  assert.ok(!foreignOptions.suppliers.some((item: { id: string }) => item.id === 'foreign-supplier'));
  console.log('PASS: supplier query searches beyond 200 with stable pages, count, input validation and organization isolation');
  const queryTime=new Date('2026-01-01T00:00:00Z');
  await prisma.purchaseOrder.createMany({data:Array.from({length:105},(_,i)=>({id:`query-order-${i}`,organizationId:'wms-org',workspaceId:'default',number:`QUERY-PO-${String(i).padStart(3,'0')}`,supplierId:supplier.id,createdBy:'operator',status:i%2?'ORDERED':'DRAFT',updatedAt:queryTime}))});
  await prisma.purchaseOrderLine.create({data:{id:'query-old-line',organizationId:'wms-org',workspaceId:'default',purchaseOrderId:'query-order-0',productRecordId:'fixture-product',expectedQty:1,unitPrice:'12.345678'}});
  const pageOne=await purchaseQuery('search=QUERY-PO&page=1');
  const pageTwo=await purchaseQuery('search=QUERY-PO&page=2');
  assert.equal(pageOne.pagination.total,105);assert.equal(pageOne.orders.length,20);assert.equal(pageTwo.orders.length,20);
  assert.equal(new Set([...pageOne.orders,...pageTwo.orders].map((item:{id:string})=>item.id)).size,40);
  assert.equal(pageOne.statusCounts.DRAFT,53);assert.equal(pageOne.statusCounts.ORDERED,52);
  const lastPage=await purchaseQuery('search=QUERY-PO&page=99');assert.equal(lastPage.pagination.page,6);assert.equal(lastPage.orders.length,5);
  const oldOrder=await purchaseQuery('search=query-po-000');assert.equal(oldOrder.orders[0].id,'query-order-0');assert.equal(oldOrder.orders[0].lines[0].unitPrice,'12.345678');
  const fixtureProduct=await prisma.productRecord.findUniqueOrThrow({where:{id:'fixture-product'}});
  assert.ok((await purchaseQuery('search='+encodeURIComponent(fixtureProduct.sku))).orders.some((item:{id:string})=>item.id==='query-order-0'));
  const filteredQuery=await purchaseQuery(`search=QUERY-PO&status=ORDERED&supplierId=${supplier.id}`);assert.equal(filteredQuery.pagination.total,52);assert.ok(filteredQuery.orders.every((item:{status:string})=>item.status==='ORDERED'));
  assert.equal((await purchaseQuery('search=QUERY-PO&supplierId=foreign-supplier')).pagination.total,0);
  for(const invalid of ['page=0','page=1.5','status=INVALID','search='+encodeURIComponent('x'.repeat(121))]) await purchaseQuery(invalid,'default',400);
  const foreignScope=await prisma.workspaceScope.create({data:{organizationId:'wms-org',id:'purchase-query-other',name:'Isolated purchase query scope'}});
  assert.equal((await purchaseQuery('search=QUERY-PO',foreignScope.id)).pagination.total,0);
  console.log('PASS: purchase server query finds orders beyond 100, pages stable tied timestamps, clamps final pages, filters SKU/status/supplier and enforces workspace/input boundaries');
  const editable=(await procurementCall('POST',{action:'order',number:'HTTP-PO-EDIT',supplierId:supplier.id,lines:[{productRecordId:'fixture-product',expectedQty:3,unitPrice:'1.25',notes:'preserve'}]},201)).order;
  const editBody={action:'edit-order',id:editable.id,revision:editable.revision,number:editable.number,supplierId:supplier.id,currency:'USD',expectedAt:'2026-12-01',notes:'updated',lines:[{productRecordId:'fixture-product',expectedQty:4,unitPrice:'12.340001',notes:'preserve'}]};
  await procurementCall('PATCH',{...editBody,expectedAt:'2026-02-30'},400);
  await procurementCall('PATCH',{...editBody,lines:[{...editBody.lines[0],productRecordId:'other-workspace-product'}]},400);
  await procurementCall('PATCH',{...editBody,id:'missing-order'},404);
  const edits=await Promise.all([200,409].map(async()=>{
   const response=await fetch(`${serverBase}/api/operations/procurement`,{method:'PATCH',headers:{'content-type':'application/json','x-workspace-id':'default',cookie:cookies.operator},body:JSON.stringify(editBody)});
   return response.status;
  }));
  assert.deepEqual(edits.sort(),[200,409]);
  const persistedEdit=await prisma.purchaseOrder.findUniqueOrThrow({where:{id:editable.id},include:{lines:true}});
  assert.equal(persistedEdit.revision,2);assert.equal(persistedEdit.currency,'USD');assert.equal(persistedEdit.lines[0].expectedQty,4);assert.equal(persistedEdit.lines[0].unitPrice.toString(),'12.340001');assert.equal(persistedEdit.lines[0].notes,'preserve');
  assert.equal(await prisma.auditLog.count({where:{entityId:editable.id,action:'procurement.order.edit-draft'}}),1);
  await procurementCall('PATCH',{action:'submit-approval',id:editable.id,revision:2});
  await procurementCall('PATCH',{...editBody,revision:3},409);
  const editRole=await prisma.organizationRosterRole.findUniqueOrThrow({where:{organizationId_id:{organizationId:'wms-org',id:'owner'}}});
  await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:'wms-org',id:'owner'}},data:{permissions:{operations:['view'],wms:['view']}}});
  try { await procurementCall('PATCH',editBody,403); }
  finally { await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:'wms-org',id:'owner'}},data:{permissions:editRole.permissions!}}); }
  console.log('PASS: purchase draft editing preserves precision, replaces lines atomically, serializes revisions, audits once and rejects invalid, revoked or ordered writes');
  const cancellable=(await procurementCall('POST',{action:'order',number:'HTTP-PO-CANCEL',supplierId:supplier.id,lines:[{productRecordId:'fixture-product',expectedQty:3,unitPrice:'12.340001'}]},201)).order;
  const cancelBody={action:'cancel-order',id:cancellable.id,revision:cancellable.revision,reason:'Supplier cannot fulfill'};
  await procurementCall('PATCH',{...cancelBody,reason:'   '},400);
  await procurementCall('PATCH',{...cancelBody,id:'missing-order'},404);
  const wrongWorkspace=await fetch(`${serverBase}/api/operations/procurement`,{method:'PATCH',headers:{'content-type':'application/json','x-workspace-id':'other',cookie:cookies.operator},body:JSON.stringify(cancelBody)});
  assert.ok([403,404].includes(wrongWorkspace.status));
  const cancellations=await Promise.all([0,1].map(async()=>{
   const response=await fetch(`${serverBase}/api/operations/procurement`,{method:'PATCH',headers:{'content-type':'application/json','x-workspace-id':'default',cookie:cookies.operator},body:JSON.stringify(cancelBody)});
   return response.status;
  }));
  assert.deepEqual(cancellations.sort(),[200,409]);
  const cancelled=await prisma.purchaseOrder.findUniqueOrThrow({where:{id:cancellable.id},include:{lines:true}});
  assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.revision,2);assert.equal(cancelled.lines[0].expectedQty,3);assert.equal(cancelled.lines[0].unitPrice.toString(),'12.340001');
  const cancellationLogs=await prisma.auditLog.findMany({where:{entityId:cancellable.id,action:'procurement.order.cancel'}});
  assert.equal(cancellationLogs.length,1);assert.equal((cancellationLogs[0].metadata as {reason:string}).reason,cancelBody.reason);
  await procurementCall('PATCH',{action:'order',id:cancellable.id,revision:2},400);
  await procurementCall('PATCH',{...editBody,id:cancellable.id,revision:2},409);
  await procurementCall('PATCH',{action:'create-receipt',id:cancellable.id,revision:2,receivingLocationId:location.id},409);
  const cancelOrdered=(await procurementCall('POST',{action:'order',number:'HTTP-PO-CANCEL-ORDERED',supplierId:supplier.id,lines:[{productRecordId:'fixture-product',expectedQty:1,unitPrice:'1'}]},201)).order;
  const toCancel=await placePurchaseOrder(cancelOrdered);
  await procurementCall('PATCH',{...cancelBody,id:toCancel.id,revision:1},409);
  await procurementCall('PATCH',{...cancelBody,id:toCancel.id,revision:toCancel.revision});
  await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:'wms-org',id:'owner'}},data:{permissions:{operations:['view'],wms:['view']}}});
  try { await procurementCall('PATCH',cancelBody,403); }
  finally { await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:'wms-org',id:'owner'}},data:{permissions:editRole.permissions!}}); }
  console.log('PASS: purchase cancellation preserves lines and reason audit, serializes concurrent writes and blocks stale, unauthorized and cancelled follow-up operations');
  const order=(await procurementCall('POST',{action:'order',number:'HTTP-PO-1',supplierId:supplier.id,lines:[{productRecordId:'fixture-product',expectedQty:3,unitPrice:'1.25'}]},201)).order;
  const ordered=await placePurchaseOrder(order);
  const paymentRequest={action:'submit-payment-approval',id:order.id,amount:'1.25',paidAt:'2026-11-12',method:'BANK_TRANSFER',reference:'BANK-REF-001',notes:'First installment'};
  const submittedPayment=await procurementCall('PATCH',paymentRequest,201);
  assert.equal(submittedPayment.approval.amount,'1.25');assert.equal(submittedPayment.reused,false);
  assert.equal((await procurementCall('PATCH',paymentRequest)).reused,true);
  await procurementCall('PATCH',{...paymentRequest,amount:'1.26'},409);
  await procurementCall('PATCH',{...paymentRequest,reference:'BANK-REF-RESERVED',amount:'2.51'},422);
  await procurementCall('PATCH',{...paymentRequest,reference:'BANK-REF-BAD-DATE',amount:'2.50',paidAt:'2026-02-30'},400);
  await paymentApprovalCall({kind:'PAYMENT',id:submittedPayment.approval.id,revision:submittedPayment.approval.revision,decision:'APPROVE'},'operator',403);
  const approvedPayment=await paymentApprovalCall({kind:'PAYMENT',id:submittedPayment.approval.id,revision:submittedPayment.approval.revision,decision:'APPROVE'},'approver');
  await procurementCallAs('PATCH',{action:'confirm-payment',id:submittedPayment.approval.id,revision:approvedPayment.approval.revision},'approver',403);
  const firstPayment=await procurementCall('PATCH',{action:'confirm-payment',id:submittedPayment.approval.id,revision:approvedPayment.approval.revision},201);
  assert.equal(firstPayment.payment.amount,'1.25');assert.equal(firstPayment.reused,false);
  assert.equal((await procurementCall('PATCH',{action:'confirm-payment',id:submittedPayment.approval.id,revision:approvedPayment.approval.revision})).reused,true);
  const secondSubmitted=await procurementCall('PATCH',{...paymentRequest,reference:'BANK-REF-002',amount:'2.50'},201);
  const secondApproved=await paymentApprovalCall({kind:'PAYMENT',id:secondSubmitted.approval.id,revision:secondSubmitted.approval.revision,decision:'APPROVE'},'approver');
  const secondPayment=await procurementCall('PATCH',{action:'confirm-payment',id:secondSubmitted.approval.id,revision:secondApproved.approval.revision},201);
  assert.equal(secondPayment.payment.amount,'2.5');
  const paidSummary=await purchaseQuery('search=HTTP-PO-1');
  assert.equal(paidSummary.orders[0].paymentSummary.totalAmount,'3.75');assert.equal(paidSummary.orders[0].paymentSummary.paidAmount,'3.75');assert.equal(paidSummary.orders[0].paymentSummary.outstandingAmount,'0');
  assert.equal(await prisma.auditLog.count({where:{entityId:firstPayment.payment.id,action:'procurement.payment.record'}}),1);
  console.log('PASS: purchase payment requires independent approval and requester confirmation; installments, retry idempotency, reservations and overpayment checks are enforced');
  const refundRequest={action:'submit-refund-approval',paymentId:firstPayment.payment.id,amount:'0.5',refundedAt:'2026-11-12',method:'BANK_TRANSFER',reference:'REFUND-001',notes:'Supplier returned overpayment'};
  const submittedRefund=await procurementCall('PATCH',refundRequest,201);
  assert.equal(submittedRefund.approval.amount,'0.5');assert.equal(submittedRefund.reused,false);
  assert.equal((await procurementCall('PATCH',refundRequest)).reused,true);
  await procurementCall('PATCH',{...refundRequest,amount:'0.6'},409);
  await procurementCall('PATCH',{...refundRequest,reference:'REFUND-OVER',amount:'1.26'},422);
  await paymentApprovalCall({kind:'PAYMENT_REFUND',id:submittedRefund.approval.id,revision:submittedRefund.approval.revision,decision:'APPROVE'},'operator',403);
  const approvedRefund=await paymentApprovalCall({kind:'PAYMENT_REFUND',id:submittedRefund.approval.id,revision:submittedRefund.approval.revision,decision:'APPROVE'},'approver');
  await procurementCallAs('PATCH',{action:'confirm-refund',id:submittedRefund.approval.id,revision:approvedRefund.approval.revision},'approver',403);
  const firstRefund=await procurementCall('PATCH',{action:'confirm-refund',id:submittedRefund.approval.id,revision:approvedRefund.approval.revision},201);
  assert.equal(firstRefund.refund.amount,'0.5');assert.equal(firstRefund.reused,false);
  assert.equal((await procurementCall('PATCH',{action:'confirm-refund',id:submittedRefund.approval.id,revision:approvedRefund.approval.revision})).reused,true);
  const cancellableRefund=await procurementCall('PATCH',{...refundRequest,amount:'0.1',reference:'REFUND-CANCEL'},201);
  await procurementCallAs('PATCH',{action:'cancel-refund-approval',id:cancellableRefund.approval.id,revision:cancellableRefund.approval.revision},'approver',403);
  const cancelledRefund=await procurementCall('PATCH',{action:'cancel-refund-approval',id:cancellableRefund.approval.id,revision:cancellableRefund.approval.revision});
  assert.equal(cancelledRefund.approval.status,'CANCELLED');assert.equal(cancelledRefund.reused,false);
  assert.equal((await procurementCall('PATCH',{action:'cancel-refund-approval',id:cancellableRefund.approval.id,revision:cancellableRefund.approval.revision})).reused,true);
  await procurementCall('PATCH',{action:'confirm-refund',id:cancellableRefund.approval.id,revision:cancelledRefund.approval.revision},409);
  const remainingRefund={...refundRequest,amount:'0.75',reference:'REFUND-002'};
  const reservedRefund=await procurementCall('PATCH',remainingRefund,201);
  await procurementCall('PATCH',{...remainingRefund,amount:'0.01',reference:'REFUND-003'},422);
  const approvedRemainingRefund=await paymentApprovalCall({kind:'PAYMENT_REFUND',id:reservedRefund.approval.id,revision:reservedRefund.approval.revision,decision:'APPROVE'},'approver');
  await procurementCall('PATCH',{action:'confirm-refund',id:reservedRefund.approval.id,revision:approvedRemainingRefund.approval.revision},201);
  const refundedSummary=await purchaseQuery('search=HTTP-PO-1');
  assert.equal(refundedSummary.orders[0].paymentSummary.grossPaidAmount,'3.75');assert.equal(refundedSummary.orders[0].paymentSummary.refundedAmount,'1.25');assert.equal(refundedSummary.orders[0].paymentSummary.paidAmount,'2.5');assert.equal(refundedSummary.orders[0].paymentSummary.outstandingAmount,'1.25');
  assert.equal(await prisma.auditLog.count({where:{entityId:firstRefund.refund.id,action:'procurement.refund.record'}}),1);
  console.log('PASS: supplier refunds require independent approval and requester confirmation; original payment remains immutable, per-payment refund capacity includes active requests, retries are idempotent and net payable summary reconciles');
  const procurementLot=await prisma.wmsLot.create({data:{id:crypto.randomUUID(),organizationId:'wms-org',workspaceId:'default',productRecordId:'fixture-product',lotCode:'HTTP-PO-LOT'}});
  async function createLinkedReceipt(number:string, sourceReference:string, quantity:number) {
   return (await call('receipts',{receivingLocationId:location.id,number,sourceReference,lines:[{lotId:procurementLot.id,expectedQty:quantity}]},'operator',201)).item;
  }
  const wrongSource=await createLinkedReceipt('HTTP-PO-WRONG-SOURCE','OTHER-PO',3);
  await procurementCall('PATCH',{action:'link-receipt',id:order.id,revision:ordered.revision,receiptId:wrongSource.id},400);
  const wrongQuantity=await createLinkedReceipt('HTTP-PO-WRONG-QTY','HTTP-PO-1',2);
  await procurementCall('PATCH',{action:'link-receipt',id:order.id,revision:ordered.revision,receiptId:wrongQuantity.id},400);
  const linkedReceipt=await createLinkedReceipt('HTTP-PO-CORRECT','HTTP-PO-1',3);
  const linkRequest={action:'link-receipt',id:order.id,revision:ordered.revision,receiptId:linkedReceipt.id};
  const concurrentLinks=await Promise.all([procurementCall('PATCH',linkRequest),procurementCall('PATCH',linkRequest)]);
  const linked=concurrentLinks[0].order;
  await procurementCall('PATCH',{action:'cancel-order',id:order.id,revision:linked.revision,reason:'Cannot cancel linked stock'},409);
  assert.equal(linked.status,'RECEIVING');assert.deepEqual(linked.wmsReceiptIds,[linkedReceipt.id]);
  for(const result of concurrentLinks) {assert.equal(result.order.revision,linked.revision);assert.deepEqual(result.order.wmsReceiptIds,[linkedReceipt.id]);}
  assert.equal(await prisma.auditLog.count({where:{entityId:order.id,action:'procurement.order.link-receipt'}}),1);
  console.log('PASS: procurement rejects mismatched scoped WMS receipts and serializes concurrent link retries');
  const abandonedOrder=(await procurementCall('POST',{action:'order',number:'HTTP-PO-ABANDONED',supplierId:supplier.id,lines:[{productRecordId:'fixture-product',expectedQty:2,unitPrice:'1'}]},201)).order;
  const abandonedOrdered=await placePurchaseOrder(abandonedOrder);
  const abandonedReceipt=(await procurementCall('PATCH',{action:'create-receipt',id:abandonedOrder.id,revision:abandonedOrdered.revision,receivingLocationId:location.id})).receipt;
  await call('commands',{workspaceId:'default',aggregateId:abandonedReceipt.id,expectedRevision:1,idempotencyKey:'cancel-abandoned-receipt',payload:{action:'CANCEL'}},'operator');
  const cancellableAfterReceipt=await purchaseQuery('search=HTTP-PO-ABANDONED');
  assert.equal(cancellableAfterReceipt.orders[0].canCancel,true);
  const abandonedCancelled=await procurementCall('PATCH',{action:'cancel-order',id:abandonedOrder.id,revision:abandonedOrdered.revision+1,reason:'Purchase abandoned after cancelling receipt drafts'});
  assert.equal(abandonedCancelled.order.status,'CANCELLED');
  console.log('PASS: purchase order can be cancelled after every linked WMS receipt draft is cancelled; active receipt blocks cancellation');
  const atomicOrder=(await procurementCall('POST',{action:'order',number:'HTTP-PO-ATOMIC',supplierId:supplier.id,lines:[{productRecordId:'fixture-product',expectedQty:2,unitPrice:'12.340000'}]},201)).order;
  const atomicOrdered=await placePurchaseOrder(atomicOrder);
  const atomicRequest={action:'create-receipt',id:atomicOrder.id,revision:atomicOrdered.revision,receivingLocationId:location.id};
  const lotsBefore=await prisma.wmsLot.count();
  await procurementCall('PATCH',{...atomicRequest,receivingLocationId:'missing-location'},422);
  assert.equal(await prisma.wmsLot.count(),lotsBefore,'failed receipt rolls back its new lots');
  assert.equal((await prisma.purchaseOrder.findUniqueOrThrow({where:{id:atomicOrder.id}})).status,'ORDERED');
  const atomicResults=await Promise.all([procurementCall('PATCH',atomicRequest),procurementCall('PATCH',atomicRequest)]);
  assert.equal(atomicResults[0].receipt.id,atomicResults[1].receipt.id);
  assert.equal(atomicResults.filter(item=>item.reused).length,1);
  assert.equal(await prisma.wmsLot.count(),lotsBefore+1);
  assert.equal(await prisma.wmsReceipt.count({where:{sourceReference:atomicOrder.number}}),1);
  const sourceQuery = await purchaseQuery('receiptId=' + atomicResults[0].receipt.id);
  assert.equal(sourceQuery.pagination.total, 1); assert.equal(sourceQuery.orders[0].id, atomicOrder.id);
  assert.equal((await purchaseQuery('receiptId=' + atomicResults[0].receipt.id + '&search=NONMATCHING')).pagination.total, 0);
  assert.equal((await purchaseQuery('receiptId=unlinked-receipt')).pagination.total, 0);
  assert.equal((await purchaseQuery('receiptId=' + atomicResults[0].receipt.id, 'purchase-query-other')).pagination.total, 0);
  await purchaseQuery('receiptId=' + 'x'.repeat(121), 'default', 400);
  const sourceRole = await prisma.organizationRosterRole.findUniqueOrThrow({ where: { organizationId_id: { organizationId: 'wms-org', id: 'owner' } } });
  await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: 'wms-org', id: 'owner' } }, data: { permissions: { operations: [], wms: ['view'] } } });
  try { await purchaseQuery('receiptId=' + atomicResults[0].receipt.id, 'default', 403); }
  finally { await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: 'wms-org', id: 'owner' } }, data: { permissions: sourceRole.permissions! } }); }
  console.log('PASS: receipt-to-purchase query uses persisted links, composes filters and enforces workspace, input and operations permission boundaries');

  assert.equal(await prisma.wmsMovement.count({where:{sourceId:atomicResults[0].receipt.id}}),0,'draft creation must not post inventory');
  await procurementCall('PATCH',{...atomicRequest,revision:99},409);
  const ownerRole=await prisma.organizationRosterRole.findUniqueOrThrow({where:{organizationId_id:{organizationId:'wms-org',id:'owner'}}});
  await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:'wms-org',id:'owner'}},data:{permissions:{operations:['view','create','edit'],wms:['view']}}});
  try { await procurementCall('PATCH',atomicRequest,403); }
  finally { await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:'wms-org',id:'owner'}},data:{permissions:ownerRole.permissions!}}); }
  console.log('PASS: atomic purchase receipt rolls back partial failure, serializes retries, preserves inventory and rechecks WMS permissions');
  const partialOrder = (await procurementCall('POST', { action: 'order', number: 'HTTP-PO-PARTIAL', supplierId: supplier.id, lines: [{ productRecordId: 'fixture-product', expectedQty: 10, unitPrice: '1' }] }, 201)).order;
  const placedPartial = await placePurchaseOrder(partialOrder);
  const partialRequest = { action: 'create-receipt', id: partialOrder.id, revision: placedPartial.revision, receivingLocationId: location.id, lines: [{ productRecordId: 'fixture-product', expectedQty: 4 }] };
  await procurementCall('PATCH', { ...partialRequest, lines: [] }, 400);
  await procurementCall('PATCH', { ...partialRequest, lines: [{ productRecordId: 'fixture-product', expectedQty: 11 }] }, 409);
  await procurementCall('PATCH', { ...partialRequest, lines: [{ productRecordId: 'foreign-product', expectedQty: 1 }] }, 409);
  const partialResults = await Promise.all([procurementCall('PATCH', partialRequest), procurementCall('PATCH', partialRequest)]);
  assert.equal(partialResults[0].receipt.id, partialResults[1].receipt.id); assert.equal(partialResults[0].receipt.lines[0].expectedQty, 4);
  await procurementCall('PATCH', { ...partialRequest, lines: [{ productRecordId: 'fixture-product', expectedQty: 5 }] }, 409);
  await procurementCall('PATCH', { action: partialRequest.action, id: partialRequest.id, revision: partialRequest.revision, receivingLocationId: partialRequest.receivingLocationId }, 409);
  const partialQuery = await purchaseQuery('search=HTTP-PO-PARTIAL');
  assert.equal(partialQuery.orders[0].remainingQty, 6);
  assert.deepEqual(partialQuery.orders[0].remainingLines, [{ productRecordId: 'fixture-product', expectedQty: 6 }]);
  const nextPartial = { ...partialRequest, revision: partialQuery.orders[0].revision, lines: [{ productRecordId: 'fixture-product', expectedQty: 6 }] };
  const finalPartial = await procurementCall('PATCH', nextPartial);
  assert.notEqual(finalPartial.receipt.id, partialResults[0].receipt.id);
  assert.equal((await purchaseQuery('search=HTTP-PO-PARTIAL')).orders[0].remainingQty, 0);
  await procurementCall('PATCH', { ...nextPartial, revision: nextPartial.revision + 1 }, 409);
  assert.equal(await prisma.wmsMovement.count({ where: { sourceId: { in: [partialResults[0].receipt.id, finalPartial.receipt.id] } } }), 0);
  console.log('PASS: partial purchase receipts reserve only the chosen quantities, serialize retries, reject changed retry payloads and prevent over-allocation');

  async function allocation() {
   const {purchaseReceiptAllocations}=await import('../../src/lib/procurement/receipt-service');
   const current=await prisma.purchaseOrder.findUniqueOrThrow({where:{id:atomicOrder.id},include:{lines:true}});
   return (await purchaseReceiptAllocations({organizationId:'wms-org',workspaceId:'default',actorUserId:'operator'},[current])).get(current.id)!;
  }
  async function freshRequest() {
   const current=await prisma.purchaseOrder.findUniqueOrThrow({where:{id:atomicOrder.id}});
   return {...atomicRequest,revision:current.revision};
  }
  assert.equal((await allocation()).remainingQty,0,'active draft reserves ordered quantities');
  assert.equal((await allocation()).receiptSummary?.state,'IN_PROGRESS');
  assert.equal((await allocation()).receiptSummary?.putawayQty,0);
  await procurementCall('PATCH',await freshRequest(),409);
  const initialReceipt=atomicResults[0].receipt;
  await runHttp(initialReceipt.id,1,{action:'CANCEL'});
  assert.equal((await allocation()).remainingQty,2);
  const replacementRequest=await freshRequest();
  const replacements=await Promise.all([procurementCall('PATCH',replacementRequest),procurementCall('PATCH',replacementRequest)]);
  assert.equal(replacements[0].receipt.id,replacements[1].receipt.id);
  assert.equal(replacements.filter(item=>item.reused).length,1);
  const replacement=replacements[0].receipt;
  assert.notEqual(replacement.number,initialReceipt.number);
  await procurementCall('PATCH',{...replacementRequest,receivingLocationId:storage.id},409);
  await runHttp(replacement.id,1,{action:'RECEIVE',lines:[{lineId:replacement.lines[0].id,quantity:1}]});
  assert.equal((await allocation()).remainingQty,0,'short receipt remains reserved until inspection');
  await runHttp(replacement.id,2,{action:'INSPECT',lines:[{lineId:replacement.lines[0].id,acceptedQty:0,rejectedQty:1}]});
  assert.equal((await allocation()).remainingQty,2,'short and rejected goods can be received again');
  const supplement=(await procurementCall('PATCH',await freshRequest())).receipt;
  assert.equal(supplement.lines[0].expectedQty,2);
  await runHttp(supplement.id,1,{action:'RECEIVE',lines:[{lineId:supplement.lines[0].id,quantity:2}]});
  await runHttp(supplement.id,2,{action:'INSPECT',lines:[{lineId:supplement.lines[0].id,acceptedQty:1,rejectedQty:1}]});
  assert.equal((await allocation()).remainingQty,0,'stock awaiting putaway cannot be allocated twice');
  await runHttp(supplement.id,3,{action:'PUTAWAY',lines:[{lineId:supplement.lines[0].id,locationId:storage.id,quantity:1}]});
  assert.equal((await allocation()).remainingQty,1);
  assert.equal((await allocation()).receiptSummary?.state,'NEEDS_RECEIPT');
  assert.equal((await allocation()).receiptSummary?.putawayQty,1);
  const finalReceipt=(await procurementCall('PATCH',await freshRequest())).receipt;
  assert.equal(finalReceipt.lines[0].expectedQty,1);
  await runHttp(finalReceipt.id,1,{action:'RECEIVE',lines:[{lineId:finalReceipt.lines[0].id,quantity:1}]});
  await runHttp(finalReceipt.id,2,{action:'INSPECT',lines:[{lineId:finalReceipt.lines[0].id,acceptedQty:1,rejectedQty:0}]});
  await runHttp(finalReceipt.id,3,{action:'PUTAWAY',lines:[{lineId:finalReceipt.lines[0].id,locationId:storage.id,quantity:1}]});
  assert.equal((await allocation()).remainingQty,0);assert.equal((await allocation()).canCreateReceipt,false);
  assert.equal((await allocation()).receiptSummary?.state,'COMPLETED');
  const completedSummary=(await purchaseQuery('search=HTTP-PO-ATOMIC')).orders[0].receiptSummary;
  assert.equal(completedSummary.putawayQty,2);assert.equal(completedSummary.remainingToPutawayQty,0);
  const completedLots=await prisma.wmsLot.count();
  await procurementCall('PATCH',await freshRequest(),409);
  assert.equal(await prisma.wmsLot.count(),completedLots);
  assert.equal((await procurementCall('PATCH',atomicRequest)).receipt.id,initialReceipt.id);
  await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:'wms-org',id:'owner'}},data:{permissions:{operations:['view','create','edit'],wms:['create']}}});
  try { const unreadable=await allocation();assert.equal(unreadable.remainingQty,null);assert.equal(unreadable.receiptSummary,null);assert.equal(unreadable.canCreateReceipt,false); }
  finally { await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:'wms-org',id:'owner'}},data:{permissions:ownerRole.permissions!}}); }
  await prisma.purchaseOrder.update({where:{id:atomicOrder.id},data:{wmsReceiptIds:{push:'missing-linked-receipt'}}});
  try { assert.equal((await allocation()).remainingQty,null);await procurementCall('PATCH',await freshRequest(),409); }
  finally { await prisma.purchaseOrder.update({where:{id:atomicOrder.id},data:{wmsReceiptIds:[initialReceipt.id,replacement.id,supplement.id,finalReceipt.id]}}); }
  console.log('PASS: cancelled, short and rejected receipts permit exact supplements; active stock and completion block excess; retries and read revocation are enforced');
  const linkedPatch={id:linkedReceipt.id,revision:linkedReceipt.revision,lines:linkedReceipt.lines.map((line:{id:string})=>({lineId:line.id,expectedQty:4}))};
  await editDraft(linkedPatch,'operator',409);
  const draft=(await call('receipts',{receivingLocationId:location.id,number:'HTTP-EDIT-DRAFT',lines:[{lotId:lot.id,expectedQty:2}]},'operator',201)).item;
  const patch={id:draft.id,revision:draft.revision,lines:[{lineId:draft.lines[0].id,expectedQty:3}]};
  await editDraft(patch,'approver',403);
  await editDraft({...patch,lines:[{lineId:'foreign-line',expectedQty:3}]},'operator',422);
  await editDraft({...patch,lines:[{lineId:draft.lines[0].id,expectedQty:0}]},'operator',400);
  const stale={workspaceId:'default',aggregateId:draft.id,expectedRevision:1,idempotencyKey:'http-edit-stale',payload:{action:'RECEIVE',lines:[{lineId:draft.lines[0].id,quantity:2}]}};
  const staleApproval=(await call('approvals',stale,'operator',201)).item;
  const edited=await editDraft(patch);assert.equal(edited.revision,2);assert.equal(edited.lines[0].expectedQty,3);
  await editDraft(patch,'operator',409);
  await editDraft({...patch,revision:2},'operator',200);
  assert.equal(await prisma.auditLog.count({where:{entityId:draft.id,action:'wms.receipts.edit-draft'}}),1);
  await call('approvals',{decision:'APPROVE',approvalId:staleApproval.id,revision:1},'approver',409);
  await runHttp(draft.id,2,{action:'RECEIVE',lines:[{lineId:draft.lines[0].id,quantity:3}]});
  await editDraft({...patch,revision:3},'operator',409);
  console.log('PASS: HTTP draft edit enforces owner, revision, line identity, quantities and procurement link; old approval is stale and received stock cannot be edited');
  const barcodeLot=(await call('lots',{productRecordId:'fixture-product',lotCode:'HTTP-BARCODE',barcode:'000123-A'},'operator',201)).item;
  await prisma.workspaceScope.create({data:{organizationId:'wms-org',id:'barcode-other',name:'Synthetic barcode scope'}});
  await prisma.productRecord.create({data:{id:'barcode-other-product',organizationId:'wms-org',workspaceId:'barcode-other',userId:'operator',sku:'SYNTHETIC-BARCODE',payload:{}}});
  await prisma.wmsLot.create({data:{id:'barcode-other-lot',organizationId:'wms-org',workspaceId:'barcode-other',productRecordId:'barcode-other-product',lotCode:'HTTP-BARCODE',barcode:'000123-A'}});
  const matched=await call('lots?barcode='+encodeURIComponent(' 000123-A '));
  assert.deepEqual(matched.items.map((item:{id:string})=>item.id),[barcodeLot.id]);
  assert.equal(matched.nextCursor,null);
  assert.equal((await call('lots?barcode=000123')).items.length,0);
  assert.equal((await call('lots?barcode=000123-a')).items.length,0);
  assert.equal((await call('lots?barcode=NO-SUCH-BARCODE')).items.length,0);
  assert.equal((await call('lots?barcode=000123-A&lotCode=OTHER')).items.length,0);
  assert.deepEqual((await call('lots?lotCode=HTTP-BARCODE')).items.map((item:{id:string})=>item.id),[barcodeLot.id]);
  const lotPage=await call('lots?limit=1');assert.ok(lotPage.nextCursor);
  await call('lots?barcode=000123-A&cursor='+encodeURIComponent(lotPage.nextCursor),undefined,'operator',400);
  await call('lots?barcode='+encodeURIComponent('x'.repeat(121)),undefined,'operator',400);
  await call('lots?barcode=000123-A',undefined,'',401);
  console.log('PASS: exact barcode/lot-code HTTP queries preserve leading zeros and scope, combine filters, reject incompatible cursors and bound input length');
  const scanReceipt=(await call('receipts',{receivingLocationId:location.id,number:'HTTP-SCAN-RCV',lines:[{lotId:barcodeLot.id,expectedQty:2}]},'operator',201)).item;
  await runHttp(scanReceipt.id,1,{action:'RECEIVE',lines:[{lineId:scanReceipt.lines[0].id,quantity:2}]});
  await runHttp(scanReceipt.id,2,{action:'INSPECT',lines:[{lineId:scanReceipt.lines[0].id,acceptedQty:2,rejectedQty:0}]});
  await runHttp(scanReceipt.id,3,{action:'PUTAWAY',lines:[{lineId:scanReceipt.lines[0].id,locationId:storage.id,quantity:2}]});
  const scanBalances=await prisma.wmsStockBalance.findMany({where:{organizationId:'wms-org',workspaceId:'default',lotId:barcodeLot.id}});
  assert.equal(scanBalances.length,2);
  const scanMovements=await prisma.wmsMovement.findMany({where:{organizationId:'wms-org',workspaceId:'default',sourceId:scanReceipt.id},orderBy:[{occurredAt:'asc'},{id:'asc'}]});
  for(const resource of ['balances','reconciliation','movements']) {
   const query='barcode='+encodeURIComponent(' 000123-A ')+'&lotCode=HTTP-BARCODE&warehouseId='+warehouse.id;
   const scanned=await call(resource+'?'+query+'&limit=100');
   assert.deepEqual(scanned.items.map((row:{id:string})=>row.id).sort(),(resource==='movements'?scanMovements:scanBalances).map(row=>row.id).sort());
   if(resource==='balances'||resource==='movements') for(const row of scanned.items) {
    const stored: (typeof scanBalances)[number]=scanBalances.find(balance=>balance.id===(resource==='movements'?row.balanceId:row.id))!;
    assert.deepEqual(row.stock,{warehouseId:warehouse.id,warehouseCode:warehouse.code,warehouseName:warehouse.name,locationId:stored.locationId,locationCode:stored.locationId===storage.id?storage.code:location.code,locationFrozen:false,lotId:barcodeLot.id,lotCode:barcodeLot.lotCode,productRecordId:barcodeLot.productRecordId,sku:'SYNTHETIC',barcode:barcodeLot.barcode});
    if(resource==='balances') assert.equal(row.available,stored.onHand-stored.pendingQc-stored.pendingPutaway-stored.rejected-stored.reserved);
    assert.equal('productRecord' in row.stock,false,'WMS context must not expose Product Center data');
   }
   const located=await call(resource+'?'+query+'&locationId='+storage.id);
   const storageId=scanBalances.find(row=>row.locationId===storage.id)!.id;
   assert.ok(located.items.length>0);
   for(const row of located.items) assert.equal(resource==='movements'?row.balanceId:row.id,storageId);
   for(const suffix of ['barcode=000123','barcode=000123-a','barcode=NO-SUCH-BARCODE','barcode=000123-A&lotCode=OTHER','barcode=000123-A&lotId='+lot.id]) assert.equal((await call(resource+'?'+suffix)).items.length,0);
   const first=await call(resource+'?'+query+'&limit=1');assert.ok(first.nextCursor);
   const second=await call(resource+'?'+query+'&limit=1&cursor='+encodeURIComponent(first.nextCursor));
   assert.equal(second.items.length,1);assert.notEqual(first.items[0].id,second.items[0].id);
   await call(resource+'?barcode=OTHER&cursor='+encodeURIComponent(first.nextCursor),undefined,'operator',400);
   await call(resource+'?barcode='+encodeURIComponent('x'.repeat(121)),undefined,'operator',400);
   await call(resource+'?barcode=000123-A',undefined,'',401);
   const foreign=await fetch(base+resource+'?barcode=000123-A',{headers:{cookie:cookies.operator,'x-workspace-id':'barcode-other'}});
   assert.equal(foreign.status,200);assert.deepEqual((await foreign.json()).items,[]);
  }
  console.log('PASS: barcode directly finds scoped stock, reconciliation and complete movements; exact codes, combined warehouse/location/lot filters and pagination remain correct');
  const supervisorBalances=await call('balances?barcode=000123-A',undefined,'approver');
  assert.equal(supervisorBalances.items.length,2);
  assert.ok(supervisorBalances.items.every((row:{stock:{lotCode:string}})=>row.stock.lotCode==='HTTP-BARCODE'));
  console.log('PASS: balances and movements identify scoped warehouse/location/lot without Product Center access; available quantities exclude pending and reserved buckets');
  const scanReservations: Array<{ aggregateId: string }> = [];
  for(const number of ['HTTP-SCAN-RSV-1','HTTP-SCAN-RSV-2']) {
   const balance=await prisma.wmsStockBalance.findFirstOrThrow({where:{organizationId:'wms-org',workspaceId:'default',locationId:storage.id,lotId:barcodeLot.id}});
   scanReservations.push(await runHttp(balance.id,balance.revision,{action:'RESERVE',number,quantity:1}));
  }
  await runHttp(scanReservations[0].aggregateId,1,{action:'PICK',quantity:1});
  for(const status of ['', 'ACTIVE','AWAITING_PICK','AWAITING_DISPATCH','PARTIALLY_PICKED','CLOSED']) {
   const query='barcode=000123-A&lotCode=HTTP-BARCODE&warehouseId='+warehouse.id+'&locationId='+storage.id+'&workflowStatus='+status;
   const result=await call('reservations?'+query);
   const expected: string[]=status===''||status==='ACTIVE'?scanReservations.map(row=>row.aggregateId):status==='AWAITING_DISPATCH'?[scanReservations[0].aggregateId]:status==='AWAITING_PICK'?[scanReservations[1].aggregateId]:[];
   assert.deepEqual(result.items.map((row:{id:string})=>row.id).sort(),expected.sort());
   for(const row of result.items) assert.deepEqual(row.stock,{warehouseId:warehouse.id,warehouseCode:warehouse.code,warehouseName:warehouse.name,locationId:storage.id,locationCode:storage.code,locationFrozen:false,lotId:barcodeLot.id,lotCode:barcodeLot.lotCode,productRecordId:barcodeLot.productRecordId,sku:'SYNTHETIC',barcode:barcodeLot.barcode});
   assert.equal((await call('reservations?'+query+'&lotId='+lot.id)).items.length,0);
   assert.equal((await call('reservations?'+query+'&number=HTTP-SCAN-RSV-2')).items.length,expected.includes(scanReservations[1].aggregateId)?1:0);
  }
  for(const status of ['', 'ACTIVE']) {
   const query='barcode=000123-A&workflowStatus='+status;
   const first=await call('reservations?'+query+'&limit=1');assert.ok(first.nextCursor);
   const second=await call('reservations?'+query+'&limit=1&cursor='+encodeURIComponent(first.nextCursor));
   assert.equal(second.items.length,1);assert.notEqual(first.items[0].id,second.items[0].id);
   await call('reservations?barcode=OTHER&workflowStatus='+status+'&cursor='+encodeURIComponent(first.nextCursor),undefined,'operator',400);
   for(const suffix of ['barcode=000123','barcode=000123-a','barcode=UNKNOWN','barcode=000123-A&lotCode=OTHER']) assert.equal((await call('reservations?workflowStatus='+status+'&'+suffix)).items.length,0);
   const foreign=await fetch(base+'reservations?'+query,{headers:{cookie:cookies.operator,'x-workspace-id':'barcode-other'}});
   assert.equal(foreign.status,200);assert.deepEqual((await foreign.json()).items,[]);
  }
  await call('reservations?barcode='+encodeURIComponent('x'.repeat(121)),undefined,'operator',400);
  await call('reservations?barcode=000123-A&workflowStatus=ACTIVE',undefined,'',401);
  console.log('PASS: barcode picking queues combine exact batch/location/number and derived states, page both query paths and isolate workspaces');
  const receiptLookup = await call('receipts?id='+encodeURIComponent(atomicResults[0].receipt.id));
  assert.deepEqual(receiptLookup.items.map((item:{id:string})=>item.id), [atomicResults[0].receipt.id]);
  const receiptContext=(await call('receipts?id='+encodeURIComponent(atomicResults[0].receipt.id),undefined,'approver')).items[0];
  const contextReceipt=await prisma.wmsReceipt.findUniqueOrThrow({where:{id:receiptContext.id},include:{lines:{include:{lot:true}},location:{include:{area:{include:{warehouse:true}}}}}});
  assert.equal(receiptContext.receivingLocation.locationCode,contextReceipt.location.code);
  assert.equal(receiptContext.receivingLocation.warehouseCode,contextReceipt.location.area.warehouse.code);
  for(const line of contextReceipt.lines) {
   const actual=receiptContext.lines.find((item:{id:string})=>item.id===line.id);
   assert.deepEqual(actual.lot,{lotCode:line.lot.lotCode,barcode:line.lot.barcode});
   assert.equal(actual.expectedQty,line.expectedQty);
  }
  console.log('PASS: scoped receipt query supplies exact batch/barcode and receiving location for a supervisor without Product Center access');
  assert.equal((await call('receipts?id=missing-receipt')).items.length,0);
  const foreignReceipt=await prisma.wmsReceipt.findFirst({where:{workspaceId:{not:'default'}}});
  if(foreignReceipt) assert.equal((await call('receipts?id='+encodeURIComponent(foreignReceipt.id))).items.length,0);
  await call('receipts?id='+encodeURIComponent('x'.repeat(121)),undefined,'operator',400);
  console.log('PASS: receipt ID lookup uses scoped WMS query and rejects oversized identifiers');
  const numbered=await call('receipts?number='+encodeURIComponent(' HTTP-RCV '));
  assert.deepEqual(numbered.items.map((item:{id:string})=>item.id),[receipt.id]);
  assert.equal((await call('receipts?number=HTTP-RC')).items.length,0);
  assert.equal((await call('receipts?number=HTTP-RCV&status=DRAFT')).items.length,0);
  assert.deepEqual((await call('reservations?number=HTTP-RSV')).items.map((item:{id:string})=>item.id),[reservation.aggregateId]);
  const bySource=await call('receipts?sourceReference=HTTP-PO-1&limit=1');
  assert.equal(bySource.items.length,1);assert.equal(bySource.items[0].sourceReference,'HTTP-PO-1');assert.ok(bySource.nextCursor);
  const nextSource=await call('receipts?sourceReference=HTTP-PO-1&limit=1&cursor='+encodeURIComponent(bySource.nextCursor));
  assert.equal(nextSource.items.length,1);assert.notEqual(nextSource.items[0].id,bySource.items[0].id);
  await call('receipts?sourceReference=OTHER&cursor='+encodeURIComponent(bySource.nextCursor),undefined,'operator',400);
  await call('receipts?status=INVALID',undefined,'operator',400);
  await call('receipts?number='+encodeURIComponent('x'.repeat(121)),undefined,'operator',400);
  await call('reservations?number='+encodeURIComponent('x'.repeat(121)),undefined,'operator',400);
  console.log('PASS: exact receipt/reservation numbers, source and receipt state filters combine correctly and bind pagination to the source');
  await call('reservations?workflowStatus=INVALID',undefined,'operator',400);
  await call('reservations?workflowStatus=ACTIVE',undefined,'',401);
  const closedPage=await call('reservations?workflowStatus=CLOSED&limit=1');
  assert.ok(closedPage.nextCursor,'closed reservations span more than one page');
  const closedNext=await call('reservations?workflowStatus=CLOSED&limit=1&cursor='+encodeURIComponent(closedPage.nextCursor));
  assert.equal(closedNext.items.length,1);assert.notEqual(closedNext.items[0].id,closedPage.items[0].id);
  await call('reservations?workflowStatus=ACTIVE&cursor='+encodeURIComponent(closedPage.nextCursor),undefined,'operator',400);
  await call('reservations?workflowStatus=CLOSED&number=HTTP-RSV&cursor='+encodeURIComponent(closedPage.nextCursor),undefined,'operator',400);
  const scopeResponse=await fetch(base+'reservations?workflowStatus=CLOSED&number=HTTP-RSV',{headers:{cookie:cookies.operator,'x-workspace-id':'barcode-other'}});
  assert.equal(scopeResponse.status,200);assert.deepEqual((await scopeResponse.json()).items,[]);
  console.log('PASS: reservation work queues filter all derived states before pagination, combine number/balance filters and enforce cursor, scope and authentication boundaries');
  await verifyWmsBrowser(cookies.operator,cookies.approver);
  const checked=await call('reconciliation?limit=100');
  assert.ok(checked.items.length>0);
  assert.ok(checked.items.every((row:{reconciliationStatus:string})=>row.reconciliationStatus==='MATCH'));
  const reservedDocument = await prisma.wmsReservation.findUniqueOrThrow({where:{id:reservation.aggregateId}});
  const priorBalance = await prisma.wmsStockBalance.findUniqueOrThrow({where:{id:reservedDocument.balanceId}});
  // Only the synthetic reservation is altered; the matching balance and ledger stay intact.
  await prisma.wmsReservation.update({where:{id:reservedDocument.id},data:{requestedQty:{increment:1}}});
  try {
   const mismatch=await call('reconciliation?locationId='+storage.id);
   const row=mismatch.items.find((item:{id:string})=>item.id===priorBalance.id);
   assert.equal(row.reconciliationStatus,'MISMATCH');
   assert.deepEqual(row.differences,[]);
   assert.deepEqual(row.reservationDifference,{recorded:String(priorBalance.reserved),reservationRemaining:String(priorBalance.reserved+1)});
   assert.deepEqual(await prisma.wmsStockBalance.findUniqueOrThrow({where:{id:priorBalance.id}}),priorBalance);
  } finally {await prisma.wmsReservation.update({where:{id:reservedDocument.id},data:{requestedQty:reservedDocument.requestedQty}});}
  const activeBalance=await prisma.wmsStockBalance.findUniqueOrThrow({where:{id:priorBalance.id}});
  const activeReservation=await runHttp(activeBalance.id,activeBalance.revision,{action:'RESERVE',number:'HTTP-RECONCILE-ACTIVE',quantity:1});
  await runHttp(activeReservation.aggregateId,1,{action:'PICK',quantity:1});
  await assertReservationProgress(activeReservation.aggregateId,1,0,'AWAITING_DISPATCH');
  const pickedCheck=await call('reconciliation?locationId='+storage.id);
  const pickedRow=pickedCheck.items.find((item:{id:string})=>item.id===activeBalance.id);
  assert.equal(pickedRow.reconciliationStatus,'MATCH');assert.equal(pickedRow.reservationRemaining,'1');assert.equal(pickedRow.reservationDifference,null);
  await runHttp(activeReservation.aggregateId,2,{action:'DISPATCH',quantity:1});
  const dispatchedCheck=await call('reconciliation?locationId='+storage.id);
  const dispatchedRow=dispatchedCheck.items.find((item:{id:string})=>item.id===activeBalance.id);
  assert.equal(dispatchedRow.reconciliationStatus,'MATCH');assert.equal(dispatchedRow.reservationRemaining,'0');
  console.log('PASS: reconciliation detects reservation-only drift without changing stock; picked stock remains reserved and dispatch closes it');
  const checkBalance=await prisma.wmsStockBalance.findFirstOrThrow({where:{organizationId:'wms-org',workspaceId:'default',locationId:storage.id}});
  // Intentional fixture-only corruption verifies detection; restore in finally.
  await prisma.wmsStockBalance.update({where:{id:checkBalance.id},data:{onHand:{increment:1}}});
  try {
   const mismatch=await call('reconciliation?locationId='+storage.id);
   const row=mismatch.items.find((item:{id:string})=>item.id===checkBalance.id);
   assert.equal(row.reconciliationStatus,'MISMATCH');
   assert.deepEqual(row.differences,[{bucket:'onHand',recorded:String(checkBalance.onHand+1),movementTotal:String(checkBalance.onHand)}]);
  } finally {await prisma.wmsStockBalance.update({where:{id:checkBalance.id},data:{onHand:checkBalance.onHand}});}
  await call('reconciliation',undefined,'',401);
  const checkPage=await call('reconciliation?limit=1');assert.ok(checkPage.nextCursor);
  await call('reconciliation?locationId='+storage.id+'&cursor='+encodeURIComponent(checkPage.nextCursor),undefined,'operator',400);
  const shortageLot=(await call('lots',{productRecordId:lot.productRecordId,lotCode:'HTTP-SHORTAGE'},'operator',201)).item;
  const shortageReceipt=(await call('receipts',{receivingLocationId:location.id,number:'HTTP-SHORTAGE-RCV',lines:[{lotId:lot.id,expectedQty:1},{lotId:shortageLot.id,expectedQty:2}]},'operator',201)).item;
  await runHttp(shortageReceipt.id,1,{action:'RECEIVE',lines:[{lineId:shortageReceipt.lines.find((line:{lotId:string})=>line.lotId===lot.id)!.id,quantity:1}]});
  let shortageState=await prisma.wmsReceipt.findUniqueOrThrow({where:{id:shortageReceipt.id},include:{lines:true}});
  assert.equal(shortageState.lines.find(line=>line.lotId===lot.id)!.receivedQty,1);assert.equal(shortageState.lines.find(line=>line.lotId===shortageLot.id)!.receivedQty,0);
  await runHttp(shortageReceipt.id,2,{action:'INSPECT',lines:[{lineId:shortageReceipt.lines.find((line:{lotId:string})=>line.lotId===lot.id)!.id,acceptedQty:1,rejectedQty:0}]});
  await runHttp(shortageReceipt.id,3,{action:'PUTAWAY',lines:[{lineId:shortageReceipt.lines.find((line:{lotId:string})=>line.lotId===lot.id)!.id,locationId:storage.id,quantity:1}]});
  shortageState=await prisma.wmsReceipt.findUniqueOrThrow({where:{id:shortageReceipt.id},include:{lines:true}});
  assert.equal(shortageState.status,'PUTAWAY');assert.equal(shortageState.lines.find(line=>line.lotId===shortageLot.id)!.expectedQty-shortageState.lines.find(line=>line.lotId===shortageLot.id)!.receivedQty,2);
  const shortageRead=await call(`receipts?id=${shortageReceipt.id}`);
  assert.equal(shortageRead.items[0].lines.find((line:{lotId:string})=>line.lotId===shortageLot.id)!.receivedQty,0);
  assert.equal(shortageRead.items[0].status,'PUTAWAY');
  console.log('PASS: omitted zero-receipt batch remains explicit shortfall through inspection and putaway, with actual scoped HTTP readback');
  // Put the actionable records behind more than one default page of drafts.
  for(let i=0;i<35;i++) await call('receipts',{receivingLocationId:location.id,number:`HTTP-QUEUE-DRAFT-${i}`,lines:[{lotId:lot.id,expectedQty:10}]},'operator',201);
  for(let i=0;i<3;i++) {
   const queued=(await call('receipts',{receivingLocationId:location.id,number:`HTTP-QUEUE-${i}`,sourceReference:'QUEUE-SOURCE',lines:[{lotId:lot.id,expectedQty:10}]},'operator',201)).item;
   await runHttp(queued.id,1,{action:'RECEIVE',lines:[{lineId:queued.lines[0].id,quantity:8}]});
   await runHttp(queued.id,2,{action:'INSPECT',lines:[{lineId:queued.lines[0].id,acceptedQty:4,rejectedQty:2}]});
   await runHttp(queued.id,3,{action:'PUTAWAY',lines:[{lineId:queued.lines[0].id,locationId:storage.id,quantity:2}]});
  }
  const queueReceipts=await prisma.wmsReceipt.findMany({where:{organizationId:'wms-org',workspaceId:'default'},include:{lines:true},orderBy:[{createdAt:'asc'},{id:'asc'}]});
  for(const workflowStatus of ['PENDING_QC','PENDING_PUTAWAY','HAS_REJECTED','SHORT_RECEIVED']) {
   const expected=queueReceipts.filter(receipt=>!['DRAFT','CANCELLED'].includes(receipt.status)&&receipt.lines.some(line=>workflowStatus==='PENDING_QC'?line.receivedQty>line.acceptedQty+line.rejectedQty:workflowStatus==='PENDING_PUTAWAY'?line.acceptedQty>line.putawayQty:workflowStatus==='HAS_REJECTED'?line.rejectedQty>line.returnedQty:line.expectedQty>line.receivedQty)).map(row=>row.id);
   const collected:string[]=[];let cursor:string|null=null;
   do {
    const page=await call('receipts?workflowStatus='+workflowStatus+'&limit=2'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
    collected.push(...page.items.map((row:{id:string})=>row.id));cursor=page.nextCursor;
    assert.ok(collected.length<=expected.length,'cursor must advance without duplication');
   } while(cursor);
   assert.deepEqual(collected,expected);
   const filtered=await call('receipts?workflowStatus='+workflowStatus+'&sourceReference=QUEUE-SOURCE&warehouseId='+warehouse.id+'&status=RECEIVED');
   assert.equal(filtered.items.length,3);
   for(const row of filtered.items) assert.ok(row.number.startsWith('HTTP-QUEUE-'));
   assert.equal((await call('receipts?workflowStatus='+workflowStatus+'&number=HTTP-QUEUE-1')).items.length,1);
   assert.equal((await call('receipts?workflowStatus='+workflowStatus+'&id='+shortageReceipt.id)).items.length,workflowStatus==='SHORT_RECEIVED'?1:0);
   const contextQueue=await call('receipts?workflowStatus='+workflowStatus,undefined,'approver');
   for(const item of contextQueue.items) {
    assert.ok(item.receivingLocation?.locationCode);
    for(const line of item.lines) assert.equal(line.lot?.lotCode,(await prisma.wmsLot.findUniqueOrThrow({where:{id:line.lotId}})).lotCode);
   }
   assert.equal((await call('receipts?workflowStatus='+workflowStatus+'&status=DRAFT')).items.length,0);
   assert.equal((await call('receipts?workflowStatus='+workflowStatus+'&status=CANCELLED')).items.length,0);
   const first=await call('receipts?workflowStatus='+workflowStatus+'&limit=1');assert.ok(first.nextCursor);
   await call('receipts?workflowStatus='+workflowStatus+'&sourceReference=CHANGED&cursor='+encodeURIComponent(first.nextCursor),undefined,'operator',400);
   const foreign=await fetch(base+'receipts?workflowStatus='+workflowStatus,{headers:{cookie:cookies.operator,'x-workspace-id':'barcode-other'}});
   assert.equal(foreign.status,200);assert.deepEqual((await foreign.json()).items,[]);
   await call('receipts?workflowStatus='+workflowStatus,undefined,'',401);
  }
  // Scan filters and the work predicate must match the same receipt line.
  const scanReceiptIds:string[]=[];
  for(let i=0;i<3;i++) {
   const scanned=(await call('receipts',{receivingLocationId:location.id,number:`HTTP-SCAN-${i}`,sourceReference:'SCAN-SOURCE',lines:[{lotId:barcodeLot.id,expectedQty:10},{lotId:shortageLot.id,expectedQty:2}]},'operator',201)).item;
   const lineId=scanned.lines.find((line:{lotId:string})=>line.lotId===barcodeLot.id)!.id;
   await runHttp(scanned.id,1,{action:'RECEIVE',lines:[{lineId,quantity:8}]});
   await runHttp(scanned.id,2,{action:'INSPECT',lines:[{lineId,acceptedQty:4,rejectedQty:2}]});
   await runHttp(scanned.id,3,{action:'PUTAWAY',lines:[{lineId,locationId:storage.id,quantity:2}]});
   scanReceiptIds.push(scanned.id);
  }
  for(const workflowStatus of ['', 'PENDING_QC','PENDING_PUTAWAY','HAS_REJECTED','SHORT_RECEIVED']) {
   const query='receipts?barcode='+encodeURIComponent(' 000123-A ')+'&lotCode=HTTP-BARCODE&sourceReference=SCAN-SOURCE&warehouseId='+warehouse.id+'&status=RECEIVED'+(workflowStatus?'&workflowStatus='+workflowStatus:'');
   const ids:string[]=[];let cursor:string|null=null;
   do {
    const result=await call(query+'&limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''),undefined,'approver');
    ids.push(...result.items.map((item:{id:string})=>item.id));cursor=result.nextCursor;
    for(const item of result.items) assert.equal(item.lines.length,2,'scanning locates whole receipts and preserves all their lines');
   }while(cursor);
   assert.deepEqual(ids,scanReceiptIds);
   const first=await call(query+'&limit=1');assert.ok(first.nextCursor);
   await call(query.replace('HTTP-BARCODE','OTHER')+'&limit=1&cursor='+encodeURIComponent(first.nextCursor),undefined,'operator',400);
   const foreign=await fetch(base+query,{headers:{cookie:cookies.operator,'x-workspace-id':'barcode-other'}});
   assert.equal(foreign.status,200);assert.deepEqual((await foreign.json()).items,[]);
   for(const suffix of ['barcode=000123','barcode=000123-a','barcode=UNKNOWN','barcode=000123-A&lotCode=HTTP-SHORTAGE']) assert.equal((await call('receipts?sourceReference=SCAN-SOURCE&'+suffix+(workflowStatus?'&workflowStatus='+workflowStatus:''))).items.length,0);
  }
  for(const workflowStatus of ['PENDING_QC','PENDING_PUTAWAY','HAS_REJECTED']) assert.equal((await call('receipts?sourceReference=SCAN-SOURCE&lotCode=HTTP-SHORTAGE&workflowStatus='+workflowStatus)).items.length,0,'other line work must not match the scanned batch');
  assert.equal((await call('receipts?sourceReference=SCAN-SOURCE&lotCode=HTTP-SHORTAGE&workflowStatus=SHORT_RECEIVED')).items.length,3);
  assert.equal((await call('receipts?number=HTTP-SCAN-1&barcode=000123-A')).items.length,1);
  await call('receipts?barcode='+encodeURIComponent('x'.repeat(121)),undefined,'operator',400);
  await call('receipts?lotCode='+encodeURIComponent('x'.repeat(121)),undefined,'operator',400);
  await call('receipts?barcode=000123-A',undefined,'',401);
  console.log('PASS: receipt barcode and lot-code scans match the same actionable line, preserve whole receipt details and enforce exact codes, pagination, combined filters, cursors and scope');
  await call('receipts?workflowStatus=UNKNOWN',undefined,'operator',400);
  console.log('PASS: receipt work queues filter partial QC/putaway, rejected and short receipts before pagination; combine exact source/warehouse/status/id filters and enforce scope/cursor/auth boundaries');
  const approvalReceipt=(await call('receipts',{receivingLocationId:location.id,number:'HTTP-APPROVAL-QUEUE',lines:[{lotId:lot.id,expectedQty:1}]},'operator',201)).item;
  const queueApprovals:string[]=[];
  for(let i=0;i<4;i++) {
   const input={workspaceId:'default',aggregateId:approvalReceipt.id,expectedRevision:1,idempotencyKey:`approval-queue-${i}`,payload:{action:'RECEIVE',lines:[{lineId:approvalReceipt.lines[0].id,quantity:1}]}};
   const created=(await call('approvals',input,'operator',201)).item;
   if(i%2===1) await call('approvals',{decision:'APPROVE',approvalId:created.id,revision:1},'approver');
   if(i>=2) await prisma.wmsApproval.update({where:{id:created.id},data:{expiresAt:new Date('2020-01-01T00:00:00Z')}});
   queueApprovals.push(created.id);
  }
  const receiptApprovalContext=(await call('approvals?workflowStatus=TO_REVIEW&limit=100',undefined,'approver')).items.find((row:{id:string})=>row.id===queueApprovals[0]);
  assert.equal(receiptApprovalContext.receipt.number,'HTTP-APPROVAL-QUEUE');
  assert.equal(receiptApprovalContext.receipt.receivingLocation.locationId,location.id);
  assert.deepEqual(receiptApprovalContext.receipt.lines.map((line:{lineId:string;lotId:string})=>({lineId:line.lineId,lotId:line.lotId})),[{lineId:approvalReceipt.lines[0].id,lotId:lot.id}]);
  assert.equal(receiptApprovalContext.command.payload.lines[0].quantity,1);
  const approvalRows=await prisma.wmsApproval.findMany({where:{organizationId:'wms-org',workspaceId:'default'},orderBy:[{createdAt:'asc'},{id:'asc'}]});
  assert.ok(approvalRows.length>30);
  for(const actor of ['operator','approver']) for(const workflowStatus of ['TO_REVIEW','TO_EXECUTE','MY_REQUESTS','EXPIRED']) {
   const expected=approvalRows.filter(row=>workflowStatus==='MY_REQUESTS'?row.requestedBy===actor:workflowStatus==='EXPIRED'?['PENDING','APPROVED'].includes(row.status)&&row.expiresAt.getTime()<=Date.now():workflowStatus==='TO_REVIEW'?row.status==='PENDING'&&row.requestedBy!==actor&&row.expiresAt.getTime()>Date.now():row.status==='APPROVED'&&row.requestedBy===actor&&row.approvedBy&&row.approvedBy!==actor&&row.expiresAt.getTime()>Date.now()).map(row=>row.id);
   const ids:string[]=[];let cursor:string|null=null;
   do {
    const result=await call('approvals?workflowStatus='+workflowStatus+'&limit=7'+(cursor?'&cursor='+encodeURIComponent(cursor):''),undefined,actor);
    ids.push(...result.items.map((row:{id:string})=>row.id));cursor=result.nextCursor;
    assert.ok(ids.length<=expected.length);
    if(workflowStatus==='TO_REVIEW') assert.ok(result.items.every((row:{canDecide:boolean})=>row.canDecide));
    if(workflowStatus==='TO_EXECUTE') assert.ok(result.items.every((row:{canExecute:boolean})=>row.canExecute));
    if(workflowStatus==='EXPIRED') assert.ok(result.items.every((row:{canDecide:boolean;canExecute:boolean})=>!row.canDecide&&!row.canExecute));
   }while(cursor);
   assert.deepEqual(ids,expected);
  }
  const targetParams='approvals?aggregateId='+approvalReceipt.id;
  const targetAll=await call(targetParams);
  assert.deepEqual(targetAll.items.map((item:{id:string})=>item.id),queueApprovals);
  const targetFirst=await call(targetParams+'&limit=1');assert.ok(targetFirst.nextCursor);
  const targetSecond=await call(targetParams+'&limit=1&cursor='+encodeURIComponent(targetFirst.nextCursor));
  assert.equal(targetSecond.items[0].id,queueApprovals[1]);
  await call('approvals?aggregateId=OTHER&limit=1&cursor='+encodeURIComponent(targetFirst.nextCursor),undefined,'operator',400);
  const targetReview=await call(targetParams+'&workflowStatus=TO_REVIEW&status=PENDING',undefined,'approver');
  assert.deepEqual(targetReview.items.map((item:{id:string})=>item.id),[queueApprovals[0]]);
  assert.equal((await call('approvals?aggregateId=NO-SUCH-TARGET')).items.length,0);
  await call('approvals?aggregateId='+encodeURIComponent('x'.repeat(121)),undefined,'operator',400);
  const foreignTarget=await fetch(base+targetParams,{headers:{cookie:cookies.operator,'x-workspace-id':'barcode-other'}});
  assert.equal(foreignTarget.status,200);assert.deepEqual((await foreignTarget.json()).items,[]);
  console.log('PASS: exact approval target filters before pagination, combines with work/status queues and enforces cursor, length and workspace scope');
  const ownApproved=await call('approvals?workflowStatus=TO_EXECUTE&status=APPROVED');
  assert.ok(ownApproved.items.some((row:{id:string})=>row.id===queueApprovals[1]));
  assert.equal((await call('approvals?workflowStatus=TO_EXECUTE&status=REJECTED')).items.length,0);
  const actorPage=await call('approvals?limit=1');assert.ok(actorPage.nextCursor);
  await call('approvals?limit=1&cursor='+encodeURIComponent(actorPage.nextCursor),undefined,'approver',400);
  await call('approvals?workflowStatus=EXPIRED&cursor='+encodeURIComponent(actorPage.nextCursor),undefined,'operator',400);
  await call('approvals?workflowStatus=UNKNOWN',undefined,'operator',400);
  await call('approvals?status=UNKNOWN',undefined,'operator',400);
  await call('approvals?workflowStatus=TO_REVIEW',undefined,'',401);
  const foreignApprovals=await fetch(base+'approvals?workflowStatus=MY_REQUESTS',{headers:{cookie:cookies.operator,'x-workspace-id':'barcode-other'}});
  assert.equal(foreignApprovals.status,200);assert.deepEqual((await foreignApprovals.json()).items,[]);
  const approvalQueueOwnerRole=await prisma.organizationRosterRole.findUniqueOrThrow({where:{organizationId_id:{organizationId:'wms-org',id:'owner'}}});
  await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:'wms-org',id:'owner'}},data:{permissions:{wms:['view']}}});
  try {
   for(const workflowStatus of ['TO_REVIEW','TO_EXECUTE']) assert.equal((await call('approvals?workflowStatus='+workflowStatus)).items.length,0);
   const readOnly=await call('approvals?workflowStatus=MY_REQUESTS&limit=100');
   assert.ok(readOnly.items.length>0);assert.ok(readOnly.items.every((row:{canDecide:boolean;canExecute:boolean})=>!row.canDecide&&!row.canExecute));
  }finally{await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:'wms-org',id:'owner'}},data:{permissions:approvalQueueOwnerRole.permissions!}});}
  console.log('PASS: approval queues apply actor/status/expiry and current permissions before pagination, bind actor-specific cursors and suppress expired/read-only controls');
  console.log('PASS: read-only reconciliation matches ledger totals, detects synthetic corruption, scopes filters and binds pagination');
  console.log('PASS: real loopback HTTP with actual Next Route Handlers, database sessions, create/request/approve/execute/retry/query and anonymous/spoofed/self-approval rejection');
 } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
}
