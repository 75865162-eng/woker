import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { prisma } from "../../src/lib/db/prisma";
import { queryWms } from "../../src/lib/wms/query-service";
import { executeWmsCommand } from "../../src/lib/wms/application-service";
import { requestApproval, decideApproval } from "../../src/lib/wms/approvals";
import { balanceId } from "../../src/lib/wms/repository";
import type { WmsCommandInput } from "../../src/lib/wms/contracts";

const scope = { organizationId: "wms-capacity-fixture", workspaceId: "default", actorUserId: "capacity-operator" };
const approver = { ...scope, actorUserId: "capacity-approver" };
const scoped = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
const productCount = 10_000, concurrency = 30;
const timings: Record<string, number[]> = {};

async function timed<T>(name: string, run: () => Promise<T>) {
  const start = performance.now();
  try { return await run(); }
  finally { (timings[name] ??= []).push(performance.now() - start); }
}

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => Number(sorted[Math.ceil(sorted.length * p) - 1].toFixed(2));
  return { samples: sorted.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: percentile(1) };
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert.equal(process.env.WMS_OFFLINE_FIXTURE, "1");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/wms_fixture");
  await prisma.organization.create({ data: { id: scope.organizationId, name: "Synthetic capacity fixture", slug: scope.organizationId } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Synthetic capacity" } });
  for (const [userId, role] of [[scope.actorUserId, "owner"], [approver.actorUserId, "warehouse_supervisor"]] as const) {
    await prisma.user.create({ data: { id: userId, email: `${userId}@fixture.invalid`, name: userId, passwordHash: "not-a-password" } });
    await prisma.organizationMember.create({ data: { organizationId: scope.organizationId, userId, role } });
    await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: role, name: role, description: "Synthetic capacity", permissions: { wms: ["view", "create", "edit", "approve"] } } });
  }
  const warehouseId = "capacity-warehouse", areaId = "capacity-area", locationId = "capacity-storage";
  await prisma.wmsWarehouse.create({ data: { ...scoped, id: warehouseId, code: "CAP", name: "Synthetic capacity" } });
  await prisma.wmsArea.create({ data: { ...scoped, id: areaId, warehouseId, code: "A", name: "Synthetic capacity" } });
  await prisma.wmsLocation.create({ data: { ...scoped, id: locationId, warehouseId, areaId, code: "S", kind: "STORAGE" } });
  const lotId = (i: number) => `capacity-lot-${String(i).padStart(5, "0")}`;
  const id = (i: number) => balanceId(scope, locationId, lotId(i));
  // Synthetic SQL/Prisma seeds are fixture setup only. All measured reads and
  // writes below use the actual ERP query/command/approval services.
  for (let from = 0; from < productCount; from += 500) {
    const indexes = Array.from({ length: 500 }, (_, i) => from + i);
    await prisma.productRecord.createMany({ data: indexes.map(i => ({ ...scoped, id: `capacity-product-${i}`, userId: scope.actorUserId, sku: `CAP-${i}`, payload: {} })) });
    await prisma.wmsLot.createMany({ data: indexes.map(i => ({ ...scoped, id: lotId(i), productRecordId: `capacity-product-${i}`, lotCode: `CAP-${i}`, barcode: `000-CAP-${i}` })) });
    await prisma.wmsStockBalance.createMany({ data: indexes.map(i => ({ ...scoped, id: id(i), warehouseId, locationId, lotId: lotId(i), onHand: 10, revision: 11 })) });
    await prisma.wmsCommand.createMany({ data: indexes.map(i => ({ ...scoped, id: `capacity-seed-${i}`, idempotencyKey: `seed-${i}`, action: "RECEIVE", requestHash: "synthetic-fixture-only", aggregateId: `capacity-receipt-${i}`, expectedRevision: 1, result: {}, actorUserId: scope.actorUserId })) });
    await prisma.wmsMovement.createMany({ data: indexes.flatMap(i => Array.from({ length: 10 }, (_, sequence) => ({
      ...scoped, id: `capacity-movement-${i}-${sequence}`, commandId: `capacity-seed-${i}`, sequence, balanceId: id(i),
      sourceType: "RECEIPT", sourceId: `capacity-receipt-${i}`, action: "RECEIVE", deltaOnHand: 1,
      deltaPendingQc: 0, deltaPendingPutaway: 0, deltaRejected: 0, deltaReserved: 0,
      beforeRevision: sequence + 1, afterRevision: sequence + 2,
      balanceAfter: { onHand: sequence + 1, pendingQc: 0, pendingPutaway: 0, rejected: 0, reserved: 0, revision: sequence + 2 }, actorUserId: scope.actorUserId,
    }))) });
  }
  assert.equal(await prisma.productRecord.count({ where: scoped }), productCount);
  assert.equal(await prisma.wmsMovement.count({ where: scoped }), 100_000);
  await prisma.$executeRaw`ANALYZE "WmsStockBalance"`;
  await prisma.$executeRaw`ANALYZE "WmsMovement"`;
  await prisma.$executeRaw`ANALYZE "WmsLot"`;
  console.log("PASS: isolated capacity fixture contains 10,000 SKU/balances and 100,000 reconciled movement rows");

  for (const kind of ["balances", "movements", "reconciliation"] as const) {
    const params = new URLSearchParams({ warehouseId, limit: "100" });
    await queryWms(scope, kind, params); // Warm the query independently of samples.
    for (let round = 0; round < 2; round++) await Promise.all(Array.from({ length: concurrency }, () => timed(kind, async () => {
      const page = await queryWms(scope, kind, params);
      assert.equal(page.items.length, 100); assert.ok(page.nextCursor);
      if (kind === "reconciliation") assert.ok(page.items.every(row => "reconciliationStatus" in row && row.reconciliationStatus === "MATCH"));
    })));
  }
  await Promise.all(Array.from({ length: concurrency }, (_, i) => timed("barcode", async () => {
    const page = await queryWms(scope, "balances", new URLSearchParams({ barcode: `000-CAP-${productCount - 1 - i}` }));
    assert.equal(page.items.length, 1);
    assert.ok("id" in page.items[0]); assert.equal(page.items[0].id, id(productCount - 1 - i));
  })));

  const command = (i: number, aggregateId = id(i)): WmsCommandInput => ({ workspaceId: scope.workspaceId, aggregateId, expectedRevision: 11, idempotencyKey: `capacity-reserve-${i}`, payload: { action: "RESERVE", number: `CAP-RSV-${i}`, quantity: 1 } });
  const inputs = Array.from({ length: concurrency }, (_, i) => command(i));
  const approvals: string[] = [];
  for (const input of inputs) {
    const approval = await requestApproval(scope, input);
    await decideApproval(approver, approval.id, 1, true);
    approvals.push(approval.id);
  }
  await Promise.all(inputs.map((input, i) => timed("independent_reserve", () => executeWmsCommand(scope, input, approvals[i]))));
  assert.equal(await prisma.wmsReservation.count({ where: scoped }), concurrency);

  const contended = Array.from({ length: concurrency }, (_, i) => command(100 + i, id(100)));
  const contentionApprovals: string[] = [];
  for (const input of contended) {
    const approval = await requestApproval(scope, input);
    await decideApproval(approver, approval.id, 1, true);
    contentionApprovals.push(approval.id);
  }
  // Sample PostgreSQL lock waits on a dedicated connection so the service pool
  // does not hide waits behind its own connection queue. This is sampled wait
  // duration, not exact per-transaction lock acquisition latency.
  const { Client } = await import("pg");
  const monitor = new Client({ connectionString: process.env.DATABASE_URL });
  await monitor.connect();
  let sampling = true, samples = 0, maxWaiting = 0, sampledWaiterMs = 0;
  const watch = (async () => {
    let last = performance.now();
    while (sampling) {
      const result = await monitor.query<{ waiting: number }>(`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()`);
      const now = performance.now(), waiting = result.rows[0].waiting;
      sampledWaiterMs += waiting * (now - last); last = now;
      maxWaiting = Math.max(maxWaiting, waiting); samples++;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  })();
  let outcomes;
  try {
    outcomes = await Promise.allSettled(contended.map((input, i) => timed("contended_reserve", () => executeWmsCommand(scope, input, contentionApprovals[i]))));
  } finally { sampling = false; await watch; await monitor.end(); }
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  for (const outcome of outcomes) if (outcome.status === "rejected") assert.equal(outcome.reason.status, 409, "only stale revision conflicts are expected");
  assert.equal((await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: id(100) } })).reserved, 1);
  assert.equal(await prisma.wmsReservation.count({ where: scoped }), concurrency + 1);
  assert.equal(await prisma.wmsMovement.count({ where: scoped }), 100_000 + concurrency + 1);
  const checked = await queryWms(scope, "reconciliation", new URLSearchParams({ warehouseId, limit: "100" }));
  assert.ok(checked.items.every(row => "reconciliationStatus" in row && row.reconciliationStatus === "MATCH"));
  const report = {
    environment: "Disposable PostgreSQL 16 container: 1 CPU, 512 MiB; synthetic local service baseline; no HTTP/browser timings or production SLA",
    skuCount: productCount, initialMovementCount: 100_000, concurrency,
    timings: Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, summary(values)])),
    lockWaitSampling: { intervalMs: 10, samples, maxWaiting, sampledWaiterMs: Number(sampledWaiterMs.toFixed(2)) },
    contention: { success: 1, expectedRevisionConflicts: concurrency - 1, oversold: false },
  };
  mkdirSync("outputs/wms-p0b-local", { recursive: true });
  writeFileSync("outputs/wms-p0b-local/capacity.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  console.log("PASS: 30 concurrent reads/writes complete; conflicting reservations commit once with no stock/ledger drift");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
