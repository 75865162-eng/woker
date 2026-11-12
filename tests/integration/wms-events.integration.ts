import assert from "node:assert/strict";
import { Worker } from "bullmq";
import { prisma } from "../../src/lib/db/prisma";
import { createWmsResource } from "../../src/lib/wms/catalog-service";
import { executeWmsCommand, executeWmsCommandInTransaction } from "../../src/lib/wms/application-service";
import { requestApproval, decideApproval } from "../../src/lib/wms/approvals";
import { pendingWmsEventDeliveries, processWmsEventDelivery, wmsEventMaxAttempts } from "../../src/lib/wms/event-bus";
import { inventoryEvidenceConsumer, type WmsEventConsumer } from "../../src/lib/wms/event-consumers";
import { wmsCommandCompleted } from "../../src/lib/wms/domain-events";
import { dispatchPendingWmsEvents } from "../../src/lib/wms/event-dispatch";
import { createRedisConnectionOptions, getWmsEventQueue, wmsEventQueueName } from "../../src/lib/queue/redis-queue";
import type { WmsCommandInput, WmsCommandPayload } from "../../src/lib/wms/contracts";

async function main() {
  if (process.env.WMS_OFFLINE_FIXTURE !== "1" || new URL(process.env.REDIS_URL!).hostname !== "127.0.0.1") throw Error("Disposable event fixture required");
  const scope = { organizationId: "wms-event-org", workspaceId: "default", actorUserId: "event-operator" };
  const supervisor = { ...scope, actorUserId: "event-supervisor" };
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Synthetic events" } });
  for (const id of ["default", "other"]) await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id, name: id } });
  await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: "warehouse", name: "Fixture", description: "fixture", permissions: { wms: ["view", "create", "edit", "approve"] } } });
  for (const id of [scope.actorUserId, supervisor.actorUserId]) {
    await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: id, passwordHash: "not-a-password" } });
    await prisma.organizationMember.create({ data: { organizationId: scope.organizationId, userId: id, role: "warehouse" } });
  }
  await prisma.productRecord.create({ data: { id: "wms-event-product", organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId: scope.actorUserId, sku: "EVENT-FIXTURE", payload: {} } });
  const warehouse = await createWmsResource(scope, "warehouses", { code: "EVENT", name: "Fixture" });
  const area = await createWmsResource(scope, "areas", { warehouseId: warehouse.id, code: "A", name: "Fixture" });
  const location = await createWmsResource(scope, "locations", { areaId: area.id, code: "S", kind: "STORAGE" });
  const lot = await createWmsResource(scope, "lots", { productRecordId: "wms-event-product", lotCode: "EVENT-LOT" });
  const sheet = await createWmsResource(scope, "stocktakes", { warehouseId: warehouse.id, number: "EVENT-COUNT", locationIds: [location.id] });
  let sequence = 0;
  const command = (expectedRevision: number, payload: WmsCommandPayload): WmsCommandInput => ({
    workspaceId: scope.workspaceId, aggregateId: sheet.id, expectedRevision, payload, idempotencyKey: "event-" + ++sequence,
  });
  const start = command(1, { action: "STOCKTAKE_START" });
  await assert.rejects(() => prisma.$transaction(async tx => {
    await executeWmsCommandInTransaction(tx, scope, start);
    throw Error("Synthetic business rollback");
  }), /Synthetic business rollback/);
  assert.equal(await prisma.wmsCommand.count({ where: { organizationId: scope.organizationId } }), 0);
  assert.equal(await prisma.wmsDomainEvent.count({ where: { organizationId: scope.organizationId } }), 0);
  assert.equal((await prisma.wmsStocktake.findUniqueOrThrow({ where: { id: sheet.id } })).status, "DRAFT");
  const starts = await Promise.all(Array.from({ length: 8 }, () => executeWmsCommand(scope, start)));
  starts.forEach(result => assert.deepEqual(result, starts[0]));
  assert.equal(await prisma.wmsDomainEvent.count({ where: { organizationId: scope.organizationId } }), 1);
  await executeWmsCommand(scope, command(2, { action: "STOCKTAKE_COUNT", lines: [{ locationId: location.id, lotId: lot.id, countedQty: 5 }] }));
  await executeWmsCommand(scope, command(3, { action: "STOCKTAKE_REVIEW" }));
  const post = command(4, { action: "STOCKTAKE_POST" });
  const approval = await requestApproval(scope, post);
  await decideApproval(supervisor, approval.id, 1, true);
  await executeWmsCommand(scope, post, approval.id);
  const event = await prisma.wmsDomainEvent.findFirstOrThrow({ where: { organizationId: scope.organizationId, command: { action: "STOCKTAKE_POST" } } });
  assert.equal(await prisma.wmsDomainEvent.count({ where: { organizationId: scope.organizationId } }), 4);
  assert.match(JSON.stringify(event.payload), /"deltaOnHand":5/);
  assert.match(JSON.stringify(event.payload), /wms-event-product/);
  await assert.rejects(() => executeWmsCommand(scope, command(5, { action: "STOCKTAKE_CANCEL" })));
  assert.equal(await prisma.wmsDomainEvent.count({ where: { organizationId: scope.organizationId } }), 4);
  await assert.rejects(() => prisma.wmsDomainEvent.update({ where: { id: event.id }, data: { payload: {} } }), /append-only/);
  await assert.rejects(() => prisma.wmsDomainEvent.delete({ where: { id: event.id } }), /append-only/);
  await assert.rejects(() => prisma.wmsEventDelivery.create({ data: { id: crypto.randomUUID(), organizationId: scope.organizationId, workspaceId: "other", eventId: event.id, consumerId: "foreign" } }));
  console.log("PASS: stocktake and immutable event commit/rollback together; 8 retries append once, movement/SKU evidence and scoped FKs verified");

  // PICK/UNPICK have no quantity movements: their event must preserve document facts.
  const balance = await prisma.wmsStockBalance.findFirstOrThrow({ where: { organizationId: scope.organizationId, locationId: location.id } });
  const reserve = { ...command(balance.revision, { action: "RESERVE", number: "EVENT-RESERVE", quantity: 3 }), aggregateId: balance.id };
  const reserveApproval = await requestApproval(scope, reserve);
  await decideApproval(supervisor, reserveApproval.id, 1, true);
  await executeWmsCommand(scope, reserve, reserveApproval.id);
  const reservation = await prisma.wmsReservation.findFirstOrThrow({ where: { organizationId: scope.organizationId, number: "EVENT-RESERVE" } });
  const pick = { ...command(1, { action: "PICK", quantity: 2 }), aggregateId: reservation.id };
  const picked = await executeWmsCommand(scope, pick);
  assert.deepEqual(await executeWmsCommand(scope, pick), picked);
  const pickEvent = await prisma.wmsDomainEvent.findFirstOrThrow({ where: { organizationId: scope.organizationId, command: { aggregateId: reservation.id, action: "PICK" } } });
  const pickFact = pickEvent.payload as { result: { reservationChange: { quantity: number; before: { pickedQty: number; revision: number }; after: { pickedQty: number; revision: number; unpickedQty: number; workflowStatus: string } } }; movements: unknown[] };
  assert.equal(pickFact.movements.length, 0);
  assert.equal(pickFact.result.reservationChange.quantity, 2);
  assert.equal(pickFact.result.reservationChange.before.pickedQty, 0);
  assert.equal(pickFact.result.reservationChange.after.pickedQty, 2);
  assert.equal(pickFact.result.reservationChange.after.revision, 2);
  assert.equal(pickFact.result.reservationChange.after.unpickedQty, 1);
  assert.equal(pickFact.result.reservationChange.after.workflowStatus, "PARTIALLY_PICKED");
  const countBeforeFailure = await prisma.wmsDomainEvent.count({ where: { organizationId: scope.organizationId } });
  for (const payload of [{ action: "PICK", quantity: 2 }, { action: "UNPICK", quantity: 3 }, { action: "PICK", quantity: 0 }] as const) {
    await assert.rejects(() => executeWmsCommand(scope, { ...command(2, payload), aggregateId: reservation.id }));
  }
  assert.equal(await prisma.wmsDomainEvent.count({ where: { organizationId: scope.organizationId } }), countBeforeFailure);
  await executeWmsCommand(scope, { ...command(2, { action: "UNPICK", quantity: 1 }), aggregateId: reservation.id });
  assert.deepEqual((await prisma.wmsDomainEvent.findUniqueOrThrow({ where: { id: pickEvent.id } })).payload, pickEvent.payload);
  // The evidence consumer must reconstruct from committed command data, never current reservation state.
  await prisma.$transaction(tx => inventoryEvidenceConsumer.handle(tx, pickEvent));
  console.log("PASS: pick/unpick retain immutable before/after quantities and revisions; invalid transitions append no event; duplicate execution and later changes preserve replay evidence");

  // Real database side effects are written through the consumer transaction, not mocked.
  let fail = false;
  const consumer: WmsEventConsumer = { id: "fixture.atomic.v1", eventType: wmsCommandCompleted, schemaVersion: 1,
    async handle(tx, input) {
      await tx.auditLog.create({ data: { organizationId: input.organizationId, action: "fixture.wms-event", entityId: input.id, metadata: { workspaceId: input.workspaceId } } });
      if (fail) throw Error("Synthetic consumer failure with secret-like detail");
    } };
  async function enrollment(target: WmsEventConsumer) {
    // Full regression may already have events from other synthetic organizations.
    for (let i = 0; i < 100; i++) {
      await pendingWmsEventDeliveries([target]);
      const row = await prisma.wmsEventDelivery.findUnique({ where: { eventId_consumerId: { eventId: event.id, consumerId: target.id } } });
      if (row) return row;
    }
    throw Error("Fixture enrollment limit exceeded");
  }
  const receipt = await enrollment(consumer);
  fail = true;
  await assert.rejects(() => processWmsEventDelivery(receipt.id, [consumer]), /Synthetic consumer failure/);
  assert.equal(await prisma.auditLog.count({ where: { action: "fixture.wms-event", entityId: event.id } }), 0);
  const failed = await prisma.wmsEventDelivery.findUniqueOrThrow({ where: { id: receipt.id } });
  assert.equal(failed.attempts, 1); assert.equal(failed.processedAt, null);
  assert.equal(failed.lastError, "WMS_EVENT_CONSUMER_FAILED");
  assert.ok(failed.availableAt > new Date());
  assert.equal(await processWmsEventDelivery(receipt.id, [consumer]), "skipped");
  await prisma.wmsEventDelivery.update({ where: { id: receipt.id }, data: { availableAt: new Date(0) } });
  fail = false;
  await Promise.all(Array.from({ length: 12 }, () => processWmsEventDelivery(receipt.id, [consumer])));
  assert.equal(await prisma.auditLog.count({ where: { action: "fixture.wms-event", entityId: event.id } }), 1);
  const delivered = await prisma.wmsEventDelivery.findUniqueOrThrow({ where: { id: receipt.id } });
  assert.equal(delivered.attempts, 2); assert.ok(delivered.processedAt); assert.equal(delivered.lastError, null);
  assert.equal(await processWmsEventDelivery(receipt.id, []), "skipped");
  const exhaustedConsumer = { ...consumer, id: "fixture.exhausted.v1" };
  const exhausted = await enrollment(exhaustedConsumer);
  fail = true;
  for (let i = 0; i < wmsEventMaxAttempts; i++) {
    await prisma.wmsEventDelivery.update({ where: { id: exhausted.id }, data: { availableAt: new Date(0) } });
    await assert.rejects(() => processWmsEventDelivery(exhausted.id, [exhaustedConsumer]));
  }
  assert.equal(await processWmsEventDelivery(exhausted.id, [exhaustedConsumer]), "skipped");
  assert.equal((await prisma.wmsEventDelivery.findUniqueOrThrow({ where: { id: exhausted.id } })).attempts, wmsEventMaxAttempts);
  assert.equal(await prisma.auditLog.count({ where: { action: "fixture.wms-event", entityId: event.id } }), 1);
  console.log("PASS: failed consumer effects roll back; database backoff, 12 concurrent duplicates, isolated receipts and bounded retry verified");

  const builtIn = await enrollment(inventoryEvidenceConsumer);
  const queue = getWmsEventQueue();
  let worker: Worker<{ deliveryId: string }> | undefined;
  try {
    await queue.waitUntilReady();
    await dispatchPendingWmsEvents();
    assert.ok(await queue.getWaitingCount() > 0);
    // This Redis instance is created exclusively for this runner; no existing queues are touched.
    await queue.drain();
    assert.equal(await queue.getWaitingCount(), 0);
    await dispatchPendingWmsEvents();
    assert.ok(await queue.getWaitingCount() > 0, "database intent rebuilds missing queue jobs");
    const errors: Error[] = [];
    worker = new Worker<{ deliveryId: string }>(wmsEventQueueName, async job => { await processWmsEventDelivery(job.data.deliveryId); }, { connection: createRedisConnectionOptions(), concurrency: 4 });
    worker.on("error", error => errors.push(error));
    worker.on("failed", (_job, error) => errors.push(error));
    await worker.waitUntilReady();
    for (let i = 0; i < 200; i++) {
      if ((await prisma.wmsEventDelivery.findUniqueOrThrow({ where: { id: builtIn.id } })).processedAt) break;
      if (i % 10 === 0) await dispatchPendingWmsEvents();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok((await prisma.wmsEventDelivery.findUniqueOrThrow({ where: { id: builtIn.id } })).processedAt);
    assert.deepEqual(errors, []);
    assert.equal((await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: location.id, lotId: lot.id } })).onHand, 5);
    console.log("PASS: real BullMQ delivery, lost-queue reconstruction and default inventory evidence consumer acknowledge without changing inventory");
  } finally { await worker?.close(); await queue.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
