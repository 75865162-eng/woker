import assert from "node:assert/strict";
import { createServer } from "node:http";
import { prisma } from "../../src/lib/db/prisma";
import { createSession } from "../../src/lib/auth/session";
import * as route from "../../src/app/api/operations/fba-local-plans/route";
import { createFbaLocalPlan, actOnFbaLocalPlan, queryFbaLocalPlans } from "../../src/lib/fba-local/service";
import { runPlanBatch } from "../../src/lib/fba-local/batch";
import { object, reservationCommand } from "../../src/lib/fba-local/rules";
import { createWmsResource } from "../../src/lib/wms/catalog-service";
import { requestApproval, decideApproval } from "../../src/lib/wms/approvals";
import { executeWmsCommand } from "../../src/lib/wms/application-service";
import type { WmsCommandInput } from "../../src/lib/wms/contracts";
import { verifyFbaLocalBrowser } from "./fba-local-browser.integration";
import { verifyShipmentLinks } from "./fba-shipment-link.integration";

async function main() {
  if (process.env.WMS_OFFLINE_FIXTURE !== "1") throw Error("Disposable fixture required");
  const scope = { organizationId: "fba-fixture", workspaceId: "default", actorUserId: "operator" };
  const supervisor = { ...scope, actorUserId: "supervisor" };
  await prisma.organization.create({ data: { id: scope.organizationId, name: "Synthetic FBA", slug: "synthetic-fba" } });
  await prisma.workspaceScope.create({ data: { ...scopeFields(), id: "default", name: "Synthetic" } });
  function scopeFields() { return { organizationId: scope.organizationId }; }
  for (const actor of [scope, supervisor]) {
    const id = actor.actorUserId, role = id === "operator" ? "owner" : "warehouse_supervisor";
    await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: id, passwordHash: "synthetic-only" } });
    await prisma.organizationMember.create({ data: { ...scopeFields(), userId: id, role } });
    await prisma.organizationRosterRole.create({ data: { ...scopeFields(), id: role, name: id, description: "fixture", permissions: { operations: ["view"], wms: ["view", "create", "edit", "approve"], products: ["view"] } } });
  }
  const scoped = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  await prisma.sellerAccount.create({ data: { ...scoped, id: "seller", accountKey: "synthetic", marketplaceCode: "US" } });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scoped, id: "auth", name: "Synthetic", amazonSellerId: "synthetic-seller", awsRegion: "us-east-1", endpoint: "https://fixture.invalid", credentialsCiphertext: "synthetic-not-credentials", updatedByUserId: "operator", status: "CONFIGURED", identityVerifiedAt: new Date() } });
  await prisma.amazonSyncDataSource.create({ data: { ...scoped, id: "source", sellerAccountId: "seller", marketplaceId: "SITE", authorizationId: "auth", resource: "fulfillment", domainPolicy: { resource: "fulfillment", applicationId: "fixture", maxRequests: 10, maxRows: 100, requestsPerSecond: 0.5, planIds: [], discoverPlans: true }, freshnessMinutes: 60 } });
  await prisma.amazonSellerIdentity.create({ data: { ...scoped, id: "identity", sellerAccountId: "seller", marketplaceId: "SITE", amazonSellerId: "synthetic-seller", authorizationId: "auth", region: "NA", verifiedAt: new Date() } });
  for (const userId of ["operator", "supervisor"]) await prisma.amazonDataAccessGrant.create({ data: { ...scoped, id: `grant-${userId}`, userId, sellerAccountId: "seller" } });
  await prisma.productRecord.create({ data: { ...scoped, id: "product", userId: "operator", sku: "SYNTHETIC", payload: {} } });
  const warehouse = await createWmsResource(scope, "warehouses", { code: "MAIN", name: "Synthetic" });
  const area = await createWmsResource(scope, "areas", { warehouseId: warehouse.id, code: "A", name: "Synthetic" });
  const receiving = await createWmsResource(scope, "locations", { areaId: area.id, code: "R", kind: "RECEIVING" });
  const storage = await createWmsResource(scope, "locations", { areaId: area.id, code: "S", kind: "STORAGE" });
  const lot = await createWmsResource(scope, "lots", { productRecordId: "product", lotCode: "SYNTHETIC" });
  const receipt = await createWmsResource(scope, "receipts", { receivingLocationId: receiving.id, number: "RCV", lines: [{ lotId: lot.id, expectedQty: 10 }] });
  const line = await prisma.wmsReceiptLine.findFirstOrThrow({ where: { receiptId: receipt.id } });
  let key = 0;
  async function executeStock(input: WmsCommandInput) {
    const approval = await requestApproval(scope, input);
    await decideApproval(supervisor, approval.id, 1, true);
    return executeWmsCommand(scope, input, approval.id);
  }
  for (const [revision, payload] of [
    [1, { action: "RECEIVE", lines: [{ lineId: line.id, quantity: 10 }] }],
    [2, { action: "INSPECT", lines: [{ lineId: line.id, acceptedQty: 10, rejectedQty: 0 }] }],
    [3, { action: "PUTAWAY", lines: [{ lineId: line.id, locationId: storage.id, quantity: 10 }] }],
  ] as const) await executeStock({ workspaceId: "default", aggregateId: receipt.id, expectedRevision: revision, idempotencyKey: `setup-${++key}`, payload: JSON.parse(JSON.stringify(payload)) });
  const balance = await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: storage.id } });
  const draft = { number: "LOCAL-1", sellerAccountId: "seller", marketplaceId: "SITE", idempotencyKey: "create-1", lines: [{ balanceId: balance.id, quantity: 6 }] };
  const cookies: Record<string, string> = {};
  for (const userId of ["operator", "supervisor"]) { const { sessionCookie } = await createSession(userId); cookies[userId] = `${sessionCookie.name}=${sessionCookie.value}`; }
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(",") : value);
      const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}) });
      const response = req.method === "POST" ? await route.POST(request) : await route.GET(request);
      assert.ok(response);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch { res.writeHead(500); res.end("fixture server failure"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/operations/fba-local-plans`;
  async function call(body?: unknown, actor = "operator", expected = 200, query = "", workspace = "default") {
    const response = await fetch(base + query, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-workspace-id": workspace, ...(actor ? { cookie: cookies[actor] } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = object(await response.json()); assert.equal(response.status, expected, JSON.stringify(value)); return value;
  }
  const params = new URLSearchParams({ sellerAccountId: "seller", marketplaceId: "SITE" });
  try {
    await call(draft, "", 401);
    await call({ ...draft, organizationId: "spoof" }, "operator", 400);
    await call({ ...draft, marketplaceId: "OTHER" }, "operator", 409);
    await call(draft, "operator", 403, "", "other-workspace");
    await createFbaLocalPlan(scope, draft);
    const packingPlan = await createFbaLocalPlan(scope, { ...draft, number: "PACKING", idempotencyKey: "packing" });
    const packing = { boxes: [{ number: "BOX-1", lengthCm: "30", widthCm: "20", heightCm: "10", grossWeightKg: "2.50", items: [{ lineId: packingPlan.lines[0].id, quantity: 6 }] }] };
    const packingSave = { action: "SAVE_PACKING", id: packingPlan.id, expectedRevision: 1, packing };
    await call({ ...packingSave, packing: { boxes: [{ ...packing.boxes[0], items: [{lineId: "foreign", quantity: 6}] }] } }, "operator", 400);
    await call(packingSave, "supervisor", 403);
    await prisma.amazonDataAccessGrant.update({ where: { id: "grant-operator" }, data: { enabled: false } });
    await call(packingSave, "operator", 403);
    await prisma.amazonDataAccessGrant.update({ where: { id: "grant-operator" }, data: { enabled: true } });
    const packingResponses = await Promise.all(Array.from({length: 10}, () => call(packingSave)));
    const saved = packingResponses[0];
    for (const response of packingResponses) assert.deepEqual(response, saved);
    assert.equal(object(saved.item).revision, 2);
    assert.deepEqual(await call(packingSave), saved);
    assert.equal(await prisma.auditLog.count({ where: { entityId: packingPlan.id, action: "fba-local.packing.save" } }), 1);
    await call({ ...packingSave, packing: {boxes:[{...packing.boxes[0], number:"OTHER"}]} }, "operator", 409);
    const packed = (await queryFbaLocalPlans(scope, new URLSearchParams({ ...Object.fromEntries(params), id: packingPlan.id }))).items[0];
    assert.equal(packed.packing?.boxes[0].grossWeightKg, "2.5");
    assert.equal(packed.packing?.boxes[0].items[0].quantity, 6);
    await actOnFbaLocalPlan(scope, { action: "CANCEL", id: packingPlan.id, expectedRevision: 2 });
    await call({ ...packingSave, expectedRevision: 3 }, "operator", 409);
    console.log("PASS: packing validates exact line quantities, actor/account permissions, revision, replay, audit, persistence and cancelled-plan lock");
    const feePlan = await createFbaLocalPlan(scope, { ...draft, number: "COST", idempotencyKey: "cost" });
    const costAllocation = { reference: "FORWARDER-1", stage: "ESTIMATE", amount: "100.000001", currency: "USD", method: "QUANTITY", basis: [{ lineId: feePlan.lines[0].id }] };
    const feeSave = { action: "SAVE_COST_ALLOCATION", id: feePlan.id, expectedRevision: 1, costAllocation };
    await call(feeSave, "supervisor", 403);
    await call({ ...feeSave, costAllocation: { ...costAllocation, basis: [{lineId: "foreign"}] } }, "operator", 400);
    await prisma.amazonDataAccessGrant.update({where:{id:"grant-operator"},data:{enabled:false}});
    await call(feeSave,"operator",403);
    await prisma.amazonDataAccessGrant.update({where:{id:"grant-operator"},data:{enabled:true}});
    const feeResponses = await Promise.all(Array.from({length:10}, () => call(feeSave)));
    for(const value of feeResponses) assert.deepEqual(value,feeResponses[0]);
    await call(feeSave);
    assert.equal(await prisma.auditLog.count({where:{entityId:feePlan.id,action:"fba-local.cost.allocate"}}),1);
    await call({...feeSave,costAllocation:{...costAllocation,amount:"101"}},"operator",409);
    const feeRead = (await queryFbaLocalPlans(scope,new URLSearchParams({...Object.fromEntries(params),id:feePlan.id}))).items[0];
    assert.equal(feeRead.costAllocation?.amount,"100.000001");
    assert.equal(feeRead.costAllocation?.lines[0].allocatedAmount,"100.000001");
    const actualFee = {...costAllocation,stage:"ACTUAL",amount:"110"};
    await call({...feeSave,expectedRevision:2,costAllocation:actualFee});
    assert.equal(await prisma.auditLog.count({where:{entityId:feePlan.id,action:"fba-local.cost.allocate"}}),2);
    await call({...feeSave,expectedRevision:3,costAllocation:{...actualFee,amount:"111"}},"operator",409);
    await call({...feeSave,expectedRevision:3,costAllocation:actualFee});
    assert.equal(await prisma.auditLog.count({where:{entityId:feePlan.id,action:"fba-local.cost.allocate"}}),2);
    await actOnFbaLocalPlan(scope,{action:"CANCEL",id:feePlan.id,expectedRevision:3});
    await call({...feeSave,expectedRevision:4},"operator",409);
    console.log("PASS: fees enforce live permissions, exact allocation, idempotency, immutable actual bills and revision conflicts");
    const ledgerPlan = await createFbaLocalPlan(scope, { ...draft, number: 'LEDGER', idempotencyKey: 'ledger' });
    const allocation = { ...costAllocation, basis: [{ lineId: ledgerPlan.lines[0].id }] };
    const feeRecord = { number: 'OCEAN-1', feeType: 'OCEAN', idempotencyKey: 'ocean-1', allocation };
    const recordBody = { action: 'CREATE_FEE_RECORD', id: ledgerPlan.id, expectedRevision: 1, feeRecord };
    await call(recordBody, 'supervisor', 403);
    await call(recordBody, 'operator', 403, '', 'other-workspace');
    await prisma.amazonDataAccessGrant.update({where:{id:'grant-operator'},data:{enabled:false}});
    await call(recordBody, 'operator', 403);
    await prisma.amazonDataAccessGrant.update({where:{id:'grant-operator'},data:{enabled:true}});
    const records = await Promise.all(Array.from({length:10},()=>call(recordBody)));
    for(const record of records) assert.deepEqual(record,records[0]);
    const feeId = String(object(records[0].item).feeId);
    assert.equal(await prisma.fbaLocalFee.count({where:{planId:ledgerPlan.id}}),1);
    await call({...recordBody,feeRecord:{...feeRecord,number:'ALTERED'}},'operator',409);
    await call({...recordBody,feeRecord:{...feeRecord,number:'OCEAN-2',idempotencyKey:'ocean-2'}},'operator',409);
    const forwarderBill = {feeId,number:'BILL-1',forwarder:'Synthetic carrier',idempotencyKey:'bill-1',allocation:{...allocation,stage:'ACTUAL',amount:'90'}};
    const billBody = {action:'CONFIRM_FORWARDER_BILL',id:ledgerPlan.id,expectedRevision:2,forwarderBill};
    await call({...billBody,forwarderBill:{...forwarderBill,allocation:{...forwarderBill.allocation,currency:'EUR'}}},'operator',400);
    await call({...billBody,id:feePlan.id,expectedRevision:4},'operator',409);
    await call(billBody,'supervisor',403);
    const operatorRole = await prisma.organizationRosterRole.findUniqueOrThrow({where:{organizationId_id:{organizationId:scope.organizationId,id:'owner'}}});
    await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:scope.organizationId,id:'owner'}},data:{permissions:{operations:['view'],wms:['view'],products:['view']}}});
    await call(billBody,'operator',403);
    await prisma.organizationRosterRole.update({where:{organizationId_id:{organizationId:scope.organizationId,id:'owner'}},data:{permissions:operatorRole.permissions!}});
    // A failure after bill insert must roll back bill, adjustment, revision and audit together.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_fail_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture adjustment failure'; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_adjustment_failure BEFORE INSERT ON "FbaLocalCostAdjustment" FOR EACH ROW EXECUTE FUNCTION fixture_fail_adjustment()`);
    await call(billBody,'operator',500);
    assert.equal(await prisma.fbaLocalForwarderBill.count({where:{feeId}}),0);
    assert.equal((await prisma.fbaLocalPlan.findUniqueOrThrow({where:{id:ledgerPlan.id}})).revision,2);
    await prisma.$executeRawUnsafe(`DROP TRIGGER fixture_adjustment_failure ON "FbaLocalCostAdjustment"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION fixture_fail_adjustment()`);
    const bills = await Promise.all(Array.from({length:10},()=>call(billBody)));
    for(const bill of bills) assert.deepEqual(bill,bills[0]);
    assert.equal(await prisma.fbaLocalForwarderBill.count({where:{feeId}}),1);
    const billId = String(object(bills[0].item).billId);
    const adjustment = await prisma.fbaLocalCostAdjustment.findFirstOrThrow({where:{billId}});
    assert.equal(adjustment.difference,'-10.000001');
    assert.equal(adjustment.status,'NEEDS_ACCOUNT_MAPPING');
    assert.equal(await prisma.auditLog.count({where:{entityId:ledgerPlan.id,action:'fba-local.bill.confirm'}}),1);
    await call({...billBody,expectedRevision:3,forwarderBill:{...forwarderBill,number:'CHANGED'}},'operator',409);
    const ledgerRead = (await queryFbaLocalPlans(scope,new URLSearchParams({...Object.fromEntries(params),id:ledgerPlan.id}))).items[0];
    assert.equal(ledgerRead.fees[0].estimate.amount,'100.000001');
    assert.equal(ledgerRead.fees[0].bill?.actual.amount,'90.000000');
    assert.equal(ledgerRead.fees[0].bill?.reconciliation.difference,'-10.000001');
    await call({...recordBody,expectedRevision:3,feeRecord:{...feeRecord,number:'INSURANCE-1',feeType:'INSURANCE',idempotencyKey:'insurance-1'}});
    const insurance = await prisma.fbaLocalFee.findFirstOrThrow({where:{planId:ledgerPlan.id,number:'INSURANCE-1'}});
    await call({...billBody,expectedRevision:4,forwarderBill:{...forwarderBill,feeId:insurance.id,idempotencyKey:'insurance-bill',allocation:{...allocation,stage:'ACTUAL'}}});
    const insuranceBill = await prisma.fbaLocalForwarderBill.findFirstOrThrow({where:{feeId:insurance.id},include:{adjustment:true}});
    assert.equal(insuranceBill.adjustment,null,'equal estimate and actual creates no adjustment');
    await actOnFbaLocalPlan(scope,{action:'CANCEL',id:ledgerPlan.id,expectedRevision:5});
    await call({...recordBody,expectedRevision:6},'operator',409);
    assert.equal(await prisma.fbaLocalFee.count({where:{planId:ledgerPlan.id}}),2,'cancellation preserves immutable fee/bill evidence');
    console.log('PASS: fee ledger and bill reconciliation persist immutable snapshots with exact differences, concurrent replay, live auth, revision checks and atomic rollback');
    const transportPlan = await createFbaLocalPlan(scope,{...draft,number:'TRANSPORT',idempotencyKey:'transport'});
    const forwarderOrder={number:'FWD-1',forwarder:'Synthetic carrier',channel:'Ocean LCL',mode:'OCEAN',destination:'Synthetic destination',containerNumber:'CONT-1',billOfLading:'BOL-1',vesselOrFlight:'V001',idempotencyKey:'fwd-1'};
    const orderBody={action:'CREATE_FORWARDER_ORDER',id:transportPlan.id,expectedRevision:1,forwarderOrder};
    await call(orderBody,'supervisor',403);
    await call(orderBody,'operator',403,'','other-workspace');
    const orderResponses=await Promise.all(Array.from({length:10},()=>call(orderBody)));
    for(const response of orderResponses)assert.deepEqual(response,orderResponses[0]);
    const orderId=String(object(orderResponses[0].item).orderId);
    assert.equal(await prisma.fbaLocalForwarderOrder.count({where:{planId:transportPlan.id}}),1);
    await call({...orderBody,forwarderOrder:{...forwarderOrder,number:'CHANGED'}},'operator',409);
    const trackingEvent={eventType:'DEPARTED',occurredAt:new Date(Date.now()-120000).toISOString(),location:'Origin',evidence:'Synthetic dispatch evidence',idempotencyKey:'depart-1'};
    const eventBody={action:'APPEND_TRACKING',id:transportPlan.id,expectedRevision:2,trackingEvent};
    await call(eventBody,'operator',409);
    const noteBody={...eventBody,trackingEvent:{...trackingEvent,eventType:'NOTE',idempotencyKey:'note-1'}};
    await prisma.amazonDataAccessGrant.update({where:{id:'grant-operator'},data:{enabled:false}});
    await call(noteBody,'operator',403);
    await prisma.amazonDataAccessGrant.update({where:{id:'grant-operator'},data:{enabled:true}});
    const notes=await Promise.all(Array.from({length:10},()=>call(noteBody)));
    for(const note of notes)assert.deepEqual(note,notes[0]);
    assert.equal(await prisma.fbaLocalTracking.count({where:{orderId}}),1);
    assert.equal(await prisma.auditLog.count({where:{entityId:transportPlan.id,action:'fba-local.tracking.append'}}),1);
    await call({...noteBody,expectedRevision:3,trackingEvent:{...noteBody.trackingEvent,evidence:'CHANGED'}},'operator',409);
    await call({...noteBody,expectedRevision:3,trackingEvent:{...noteBody.trackingEvent,idempotencyKey:'older',occurredAt:new Date(Date.now()-3600000).toISOString()}},'operator',409);
    const rollbackNote={...noteBody,expectedRevision:3,trackingEvent:{...noteBody.trackingEvent,idempotencyKey:'rollback',occurredAt:new Date(Date.now()-60000).toISOString()}};
    await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_tracking_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'fba-local.tracking.append' THEN RAISE EXCEPTION 'fixture transport audit failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_tracking_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fixture_tracking_audit_fail()`);
    await call(rollbackNote,'operator',500);
    assert.equal(await prisma.fbaLocalTracking.count({where:{orderId}}),1);
    assert.equal((await prisma.fbaLocalPlan.findUniqueOrThrow({where:{id:transportPlan.id}})).revision,3);
    assert.equal((await prisma.fbaLocalForwarderOrder.findUniqueOrThrow({where:{id:orderId}})).lastEventAt?.toISOString(),trackingEvent.occurredAt);
    await prisma.$executeRawUnsafe(`DROP TRIGGER fixture_tracking_audit_failure ON "AuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION fixture_tracking_audit_fail()`);
    const transportAllocation={...allocation,basis:[{lineId:transportPlan.lines[0].id}]};
    const transportFee=object((await call({action:'CREATE_FEE_RECORD',id:transportPlan.id,expectedRevision:3,feeRecord:{number:'TRANSPORT-FEE',feeType:'OCEAN',idempotencyKey:'transport-fee',allocation:transportAllocation}})).item);
    const linkedBill={action:'CONFIRM_FORWARDER_BILL',id:transportPlan.id,expectedRevision:4,forwarderBill:{...forwarderBill,feeId:transportFee.feeId,forwarderOrderId:orderId,forwarder:forwarderOrder.forwarder,idempotencyKey:'transport-bill',allocation:{...transportAllocation,stage:'ACTUAL'}}};
    await call({...linkedBill,forwarderBill:{...linkedBill.forwarderBill,forwarderOrderId:'foreign'}},'operator',409);
    await call({...linkedBill,forwarderBill:{...linkedBill.forwarderBill,forwarder:'wrong carrier'}},'operator',409);
    await call(linkedBill);
    const transportRead=(await queryFbaLocalPlans(scope,new URLSearchParams({...Object.fromEntries(params),id:transportPlan.id}))).items[0];
    assert.equal(transportRead.forwarderOrder?.events[0].source,'MANUAL');
    assert.equal(transportRead.fees[0].bill?.forwarderOrderId,orderId);
    await call({action:'CANCEL',id:transportPlan.id,expectedRevision:5});
    assert.equal((await prisma.fbaLocalForwarderOrder.findUniqueOrThrow({where:{id:orderId}})).status,'CANCELLED');
    assert.equal(await prisma.fbaLocalTracking.count({where:{orderId}}),1);
    await call({...noteBody,expectedRevision:6},'operator',409);
    console.log('PASS: transport orders and manual tracking enforce live access, physical-dispatch prerequisite, chronology, concurrency, atomic audit rollback, bill linkage and retained cancellation evidence');
    await verifyShipmentLinks(scope,draft,call);
    const created = await Promise.all(Array.from({ length: 10 }, () => call(draft)));
    const planId = String(object(created[0].item).id);
    assert.equal(new Set(created.map(row => object(row.item).id)).size, 1);
    await call({ ...draft, lines: [{ balanceId: balance.id, quantity: 5 }] }, "operator", 409);
    const plan = await prisma.fbaLocalPlan.findUniqueOrThrow({ where: { id: planId }, include: { lines: true } });
    params.set("id", planId);
    const linkedQuery = `?lineId=${encodeURIComponent(plan.lines[0].id)}`;
    const linkedRead = await call(undefined, "operator", 200, linkedQuery);
    assert.equal((linkedRead.items as Array<{id: string}>)[0].id, planId);
    assert.equal((linkedRead.items as unknown[]).length, 1);
    await call(undefined, "", 401, linkedQuery);
    await call(undefined, "operator", 403, linkedQuery, "other-workspace");
    await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: "empty", name: "Synthetic empty" } });
    await call(undefined, "operator", 404, linkedQuery, "empty");
    await call(undefined, "operator", 404, "?lineId=missing");
    await call(undefined, "operator", 400, linkedQuery + "&sellerAccountId=other");
    await call(undefined, "operator", 400, linkedQuery + "&marketplaceId=other");
    await call(undefined, "operator", 404, linkedQuery + "&id=other");
    await call(undefined, "operator", 400, linkedQuery + "&page=2");
    console.log("PASS: line deep link resolves only the exact scoped plan; forged account, site, plan and workspace are rejected");
    const command = reservationCommand("default", plan.lines[0], balance.revision);
    const action = { id: planId, expectedRevision: 1, lineId: plan.lines[0].id, balanceRevision: balance.revision };
    const pending = object((await call({ ...action, action: "REQUEST_RESERVATION" })).item);
    assert.equal(object((await call({ ...action, action: "REQUEST_RESERVATION" })).item).id, pending.id);
    const pendingRead = await queryFbaLocalPlans(scope, params);
    assert.equal(pendingRead.items[0].lines[0].approval?.id, pending.id);
    assert.equal(pendingRead.items[0].lines[0].approval?.canDecide, false);
    assert.equal((await queryFbaLocalPlans(supervisor, params)).items[0].lines[0].approval?.canDecide, true);
    await assert.rejects(() => decideApproval(scope, String(pending.id), 1, true));
    await decideApproval(supervisor, String(pending.id), 1, true);
    await prisma.wmsApproval.update({ where: { id: String(pending.id) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await call({ ...action, action: "EXECUTE_RESERVATION", approvalId: pending.id }, "operator", 403);
    await prisma.wmsApproval.update({ where: { id: String(pending.id) }, data: { expiresAt: new Date(Date.now() + 600000) } });
    await assert.rejects(() => executeWmsCommand(scope, { ...command, idempotencyKey: "bypass" }, String(pending.id)), /本地计划入口/);
    await call({ ...action, action: "EXECUTE_RESERVATION", approvalId: pending.id }, "supervisor", 403);
    await prisma.amazonDataAccessGrant.update({ where: { id: "grant-operator" }, data: { enabled: false } });
    await call({ ...action, action: "EXECUTE_RESERVATION", approvalId: pending.id }, "operator", 403);
    await call(undefined, "operator", 403, linkedQuery);
    await prisma.amazonDataAccessGrant.update({ where: { id: "grant-operator" }, data: { enabled: true } });
    // Failure after WMS mutation must undo the reservation, movement, command and consumed approval.
    const before = await prisma.wmsMovement.count();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION fba_fixture_link_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic association failure'; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER fba_fixture_link_failure BEFORE UPDATE ON "FbaLocalPlanLine" FOR EACH ROW EXECUTE FUNCTION fba_fixture_link_failure()');
    await assert.rejects(() => actOnFbaLocalPlan(scope, { ...action, action: "EXECUTE_RESERVATION", approvalId: pending.id }));
    await prisma.$executeRawUnsafe('DROP TRIGGER fba_fixture_link_failure ON "FbaLocalPlanLine"');
    await prisma.$executeRawUnsafe('DROP FUNCTION fba_fixture_link_failure()');
    assert.equal(await prisma.wmsMovement.count(), before);
    assert.equal(await prisma.wmsReservation.count(), 0);
    assert.equal((await prisma.wmsApproval.findUniqueOrThrow({ where: { id: String(pending.id) } })).status, "APPROVED");
    const execution = { ...action, action: "EXECUTE_RESERVATION", approvalId: pending.id };
    const retries = await Promise.all(Array.from({ length: 10 }, () => call(execution)));
    for (const result of retries) assert.deepEqual(result, retries[0]);
    assert.equal(await prisma.wmsReservation.count(), 1);
    assert.equal(await prisma.wmsMovement.count(), before + 1);
    assert.equal((await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: balance.id } })).reserved, 6);
    const read = await queryFbaLocalPlans(scope, params);
    assert.equal(read.items[0].stockReady, true);
    assert.equal(read.items[0].fulfillment.stage, "AWAITING_PICK");
    assert.equal(read.items[0].fulfillment.unpickedQty, 6);
    assert.equal(read.items[0].amazonSubmission, "NOT_IMPLEMENTED");
    await call(undefined, "operator", 200, `?${params}`);
    await call({ action: "CANCEL", id: planId, expectedRevision: 2 }, "operator", 409);
    console.log("PASS: real HTTP auth, scoped create/replay, two-person approval, revoked account, atomic rollback and 10 concurrent execution retries");

    const reservation = await prisma.wmsReservation.findFirstOrThrow();
    await executeStock({ workspaceId: "default", aggregateId: reservation.id, expectedRevision: reservation.revision, idempotencyKey: "release", payload: { action: "RELEASE", quantity: 6 } });
    const releasedRead = (await queryFbaLocalPlans(scope, params)).items[0];
    assert.equal(releasedRead.stockReady, false);
    assert.equal(releasedRead.fulfillment.stage, "RELEASED");
    assert.equal(releasedRead.fulfillment.releasedQty, 6);
    await call({ action: "SAVE_PACKING", id: planId, expectedRevision: 2, packing: { boxes: [{ ...packing.boxes[0], items: [{ lineId: plan.lines[0].id, quantity: 6 }] }] } }, "operator", 409);
    await call({ action: "CANCEL", id: planId, expectedRevision: 2 });
    await call({ action: "CANCEL", id: planId, expectedRevision: 2 });
    await call(execution, "operator", 409);
    console.log("PASS: live release invalidates stock readiness; cancellation is idempotent and blocks old approval replay");

    const retryPlan = await createFbaLocalPlan(scope, { ...draft, number: "REAPPLY", idempotencyKey: "reapply" });
    const currentBalance = await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: balance.id } });
    const retryInput = { action: "REQUEST_RESERVATION", id: retryPlan.id, expectedRevision: 1, lineId: retryPlan.lines[0].id, balanceRevision: currentBalance.revision };
    const first = object(await actOnFbaLocalPlan(scope, retryInput));
    await decideApproval(supervisor, String(first.id), 1, false);
    const second = object(await actOnFbaLocalPlan(scope, retryInput));
    assert.notEqual(first.id, second.id);
    await prisma.wmsApproval.update({ where: { id: String(second.id) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const third = object(await actOnFbaLocalPlan(scope, retryInput));
    assert.notEqual(second.id, third.id);
    assert.equal(object(await actOnFbaLocalPlan(scope, retryInput)).id, third.id);
    await actOnFbaLocalPlan(scope, { action: "CANCEL", id: retryPlan.id, expectedRevision: 1 });
    console.log("PASS: rejected and expired approvals can be reapplied without changing stock; reload exposes live approval controls");

    if (process.env.FBA_BROWSER_FIXTURE === "1") {
      const secondStorage = await createWmsResource(scope, "locations", { areaId: area.id, code: "S2", kind: "STORAGE" });
      const extraReceipt = await createWmsResource(scope, "receipts", { receivingLocationId: receiving.id, number: "RCV-MULTI", lines: [{ lotId: lot.id, expectedQty: 3 }] });
      const extraLine = await prisma.wmsReceiptLine.findFirstOrThrow({ where: { receiptId: extraReceipt.id } });
      for (const [revision, payload] of [
        [1, { action: "RECEIVE", lines: [{ lineId: extraLine.id, quantity: 3 }] }],
        [2, { action: "INSPECT", lines: [{ lineId: extraLine.id, acceptedQty: 3, rejectedQty: 0 }] }],
        [3, { action: "PUTAWAY", lines: [{ lineId: extraLine.id, locationId: secondStorage.id, quantity: 3 }] }],
      ] as const) await executeStock({ workspaceId: "default", aggregateId: extraReceipt.id, expectedRevision: revision, idempotencyKey: `multi-setup-${revision}`, payload: JSON.parse(JSON.stringify(payload)) });
      const secondBalance = await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: secondStorage.id } });
      const multi = await createFbaLocalPlan(scope, { ...draft, number: "MULTI-RECOVER", idempotencyKey: "multi-recover", lines: [{ balanceId: balance.id, quantity: 1 }, { balanceId: secondBalance.id, quantity: 1 }] });
      const readMulti = async () => (await queryFbaLocalPlans(scope, new URLSearchParams({ ...Object.fromEntries(params), id: multi.id }))).items[0];
      const sendMulti = async (_path: string, body: unknown) => { await call(body); };
      await runPlanBatch({ plan: await readMulti(), action: "REQUEST", userId: "operator", canEdit: true, read: readMulti, send: sendMulti, active: () => true, progress: () => {} });
      for (const row of (await readMulti()).lines) await decideApproval(supervisor, row.approval!.id, row.approval!.revision, true);
      const multiRead = await readMulti();
      let attempts = 0;
      await assert.rejects(() => runPlanBatch({ plan: multiRead, action: "EXECUTE", userId: "operator", canEdit: true, read: readMulti,
        send: async (path, body) => { if (++attempts === 2) throw Error("synthetic second-line failure"); await sendMulti(path, body); },
        active: () => true, progress: () => {} }), /synthetic second-line failure/);
      const partialMulti = await readMulti();
      assert.equal(partialMulti.lines.filter(row => row.reservationId).length, 1);
      assert.equal(partialMulti.revision, 2);
      await runPlanBatch({ plan: partialMulti, action: "EXECUTE", userId: "operator", canEdit: true, read: readMulti, send: sendMulti, active: () => true, progress: () => {} });
      const completeMulti = await readMulti();
      assert.equal(completeMulti.revision, 3);
      assert.equal(completeMulti.lines.filter(row => row.reservationId).length, 2);
      for (const row of completeMulti.lines) await executeStock({ workspaceId: "default", aggregateId: row.reservationId!, expectedRevision: row.reservation!.revision, idempotencyKey: `multi-release-${row.id}`, payload: { action: "RELEASE", quantity: 1 } });
      await actOnFbaLocalPlan(scope, { action: "CANCEL", id: multi.id, expectedRevision: 3 });
      console.log("PASS: multi-line execution stops at failure, preserves the first reservation and resumes with fresh revision without duplicates");
      await verifyFbaLocalBrowser(cookies.operator, cookies.supervisor);
      const reallocation = await createFbaLocalPlan(scope, { ...draft, number: 'REALLOCATION', idempotencyKey: 'reallocation', lines: [{ balanceId: balance.id, quantity: 1 }, { balanceId: secondBalance.id, quantity: 1 }] });
      const weightBasis = reallocation.lines.map((line,index)=>({lineId:line.id,unitValue:index===0?'1':'3'}));
      const quote = {reference:'REALLOCATION',stage:'ESTIMATE',amount:'100',currency:'USD',method:'VALUE',basis:weightBasis};
      const reallocatedFee = object(await actOnFbaLocalPlan(scope,{action:'CREATE_FEE_RECORD',id:reallocation.id,expectedRevision:1,feeRecord:{number:'REALLOCATION',feeType:'AIR',idempotencyKey:'reallocation',allocation:quote}}));
      const reallocatedBill = object(await actOnFbaLocalPlan(scope,{action:'CONFIRM_FORWARDER_BILL',id:reallocation.id,expectedRevision:2,forwarderBill:{feeId:reallocatedFee.feeId,number:'REALLOCATION-BILL',forwarder:'Synthetic carrier',idempotencyKey:'reallocation-bill',allocation:{...quote,stage:'ACTUAL',basis:weightBasis.map(row=>({...row,unitValue:row.unitValue==='1'?'3':'1'}))}}}));
      const reallocationAdjustment = await prisma.fbaLocalCostAdjustment.findFirstOrThrow({where:{billId:String(reallocatedBill.billId)}});
      assert.equal(reallocationAdjustment.difference,'0.000000','zero net amount still requires SKU cost reallocation evidence');
      const reallocationRead=(await queryFbaLocalPlans(scope,new URLSearchParams({...Object.fromEntries(params),id:reallocation.id}))).items[0];
      assert.deepEqual(reallocationRead.fees[0].bill?.reconciliation.lines.map(row=>row.difference).sort(),['-50.000000','50.000000']);
      console.log('PASS: unchanged total with changed SKU allocation retains a zero-net adjustment and both SKU cost differences');
    }

    const sharedBalance = await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: balance.id } });
    const plans = await Promise.all(["A", "B"].map(number => createFbaLocalPlan(scope, { ...draft, number, idempotencyKey: number, lines: [{ balanceId: balance.id, quantity: 7 }] })));
    const inputs = plans.map(plan => ({ action: "REQUEST_RESERVATION", id: plan.id, expectedRevision: 1, lineId: plan.lines[0].id, balanceRevision: sharedBalance.revision }));
    const approvals: Array<Record<string, unknown>> = [];
    for (const input of inputs) {
      const approval = object(await actOnFbaLocalPlan(scope, input));
      await decideApproval(supervisor, String(approval.id), 1, true); approvals.push(approval);
    }
    const competing = await Promise.allSettled(inputs.map((input, index) => actOnFbaLocalPlan(scope, { ...input, action: "EXECUTE_RESERVATION", approvalId: approvals[index].id })));
    assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: balance.id } })).reserved, 7);
    for (const current of await prisma.wmsStockBalance.findMany()) {
      const movements = await prisma.wmsMovement.findMany({ where: { balanceId: current.id } });
      assert.equal(current.onHand, movements.reduce((sum, movement) => sum + movement.deltaOnHand, 0));
      assert.equal(current.reserved, movements.reduce((sum, movement) => sum + movement.deltaReserved, 0));
    }
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "warehouse_supervisor" } }, data: { permissions: { wms: ["view"] } } });
    const winner = competing.findIndex(result => result.status === "fulfilled");
    await assert.rejects(() => actOnFbaLocalPlan(scope, { ...inputs[winner], action: "EXECUTE_RESERVATION", approvalId: approvals[winner].id }));
    console.log("PASS: two approved plans compete for the same stock without over-reservation; revoked approver cannot authorize replay; all quantity movements reconcile");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
