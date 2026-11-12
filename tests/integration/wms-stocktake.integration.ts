import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db/prisma";
import { createWmsResource } from "../../src/lib/wms/catalog-service";
import { executeWmsCommand } from "../../src/lib/wms/application-service";
import { requestApproval, decideApproval } from "../../src/lib/wms/approvals";
import { queryWms } from "../../src/lib/wms/query-service";
import type { WmsCommandInput, WmsCommandPayload } from "../../src/lib/wms/contracts";
import { createSession } from "../../src/lib/auth/session";
import * as resources from "../../src/app/api/operations/wms/[kind]/route";
import * as commands from "../../src/app/api/operations/wms/commands/route";
import * as approvals from "../../src/app/api/operations/wms/approvals/route";

async function main() {
  if (process.env.WMS_OFFLINE_FIXTURE !== "1" || !process.env.DATABASE_URL?.includes("/wms_fixture")) throw Error("Disposable WMS fixture required");
  const scope = { organizationId: "stocktake-org", workspaceId: "default", actorUserId: "stocktake-operator" };
  const supervisor = { ...scope, actorUserId: "stocktake-supervisor" };
  const grants = { wms: ["view", "create", "edit", "approve"] };
  await prisma.organization.create({ data: { id: scope.organizationId, name: "Stocktake synthetic", slug: "stocktake-synthetic" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: "other", name: "Other fixture" } });
  for (const id of [scope.actorUserId, supervisor.actorUserId]) {
    await prisma.user.create({ data: { id, email: id + "@fixture.invalid", name: id, passwordHash: "not-a-password" } });
    const role = id === scope.actorUserId ? "owner" : "warehouse_supervisor";
    await prisma.organizationMember.create({ data: { organizationId: scope.organizationId, userId: id, role } });
    await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: role, name: role, description: "fixture", permissions: grants } });
  }
  await prisma.productRecord.create({ data: { id: "stocktake-product", organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId: scope.actorUserId, sku: "STOCKTAKE-FIXTURE", payload: {} } });
  const warehouse = await createWmsResource(scope, "warehouses", { code: "COUNT", name: "Fixture" });
  const area = await createWmsResource(scope, "areas", { warehouseId: warehouse.id, code: "A", name: "Fixture" });
  const location = await createWmsResource(scope, "locations", { areaId: area.id, code: "S", kind: "STORAGE" });
  const otherLocation = await createWmsResource(scope, "locations", { areaId: area.id, code: "S2", kind: "STORAGE" });
  const lot = await createWmsResource(scope, "lots", { productRecordId: "stocktake-product", lotCode: "COUNT-LOT" });
  const lot2 = await createWmsResource(scope, "lots", { productRecordId: "stocktake-product", lotCode: "COUNT-LOT-2" });
  let seq = 0;
  function command(id: string, revision: number, payload: WmsCommandPayload): WmsCommandInput {
    return { workspaceId: scope.workspaceId, aggregateId: id, expectedRevision: revision, idempotencyKey: "stocktake-fixture-" + ++seq, payload };
  }
  const run = (id: string, revision: number, payload: WmsCommandPayload) => executeWmsCommand(scope, command(id, revision, payload));
  async function create() { return createWmsResource(scope, "stocktakes", { warehouseId: warehouse.id, number: "COUNT-" + ++seq, locationIds: [location.id] }); }
  async function count(id: string, revision: number, qty: number) { return run(id, revision, { action: "STOCKTAKE_COUNT", lines: [{ locationId: location.id, lotId: lot.id, countedQty: qty }] }); }
  async function approved(input: WmsCommandInput) {
    const row = await requestApproval(scope, input);
    await assert.rejects(() => decideApproval(scope, row.id, 1, true), /自批/);
    await decideApproval(supervisor, row.id, 1, true);
    return row.id;
  }
  const row = await create();
  await assert.rejects(() => run(row.id, 1, { action: "STOCKTAKE_REVIEW" }));
  await run(row.id, 1, { action: "STOCKTAKE_START" });
  await count(row.id, 2, 10);
  await run(row.id, 3, { action: "STOCKTAKE_REVIEW" });
  const post = command(row.id, 4, { action: "STOCKTAKE_POST" });
  await assert.rejects(() => executeWmsCommand(scope, post), /独立审批/);
  const approval = await approved(post);
  const approvalView = await queryWms(scope, "approvals", new URLSearchParams({ aggregateId: row.id }));
  assert.match(JSON.stringify(approvalView), /COUNT-LOT/);
  assert.match(JSON.stringify(approvalView), /baselineOnHand/);
  const results = await Promise.all(Array.from({ length: 8 }, () => executeWmsCommand(scope, post, approval)));
  results.forEach(result => assert.deepEqual(result, results[0]));
  assert.equal(await prisma.wmsMovement.count({ where: { sourceId: row.id } }), 1);
  assert.equal((await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: location.id, lotId: lot.id } })).onHand, 10);
  assert.equal((await prisma.wmsStocktake.findUniqueOrThrow({ where: { id: row.id } })).status, "POSTED");
  assert.equal((await prisma.wmsApproval.findUniqueOrThrow({ where: { id: approval } })).status, "CONSUMED");
  await assert.rejects(() => run(row.id, 5, { action: "STOCKTAKE_CANCEL" }));
  console.log("PASS: empty-location gain, independent approval evidence, 8 concurrent retries, one immutable movement and terminal state");

  const missing = await create();
  await run(missing.id, 1, { action: "STOCKTAKE_START" });
  await assert.rejects(() => run(missing.id, 2, { action: "STOCKTAKE_REVIEW" }), /未实盘/);
  await assert.rejects(() => count(missing.id, 1, 0), /已变更/);
  await assert.rejects(() => run(missing.id, 2, { action: "STOCKTAKE_COUNT", lines: [
    { locationId: location.id, lotId: lot.id, countedQty: 8 },
    { locationId: otherLocation.id, lotId: lot.id, countedQty: 5 },
  ] }), /范围/);
  assert.equal((await prisma.wmsStocktakeLine.findFirstOrThrow({ where: { stocktakeId: missing.id } })).countedQty, null);
  assert.equal((await prisma.wmsStocktake.findUniqueOrThrow({ where: { id: missing.id } })).revision, 2);
  await assert.rejects(() => executeWmsCommand({ ...scope, workspaceId: "other" }, { ...command(missing.id, 2, { action: "STOCKTAKE_CANCEL" }), workspaceId: "other" }), /不存在/);
  assert.equal((await queryWms({ ...scope, workspaceId: "other" }, "stocktakes", new URLSearchParams({ id: missing.id }))).items.length, 0);
  await count(missing.id, 2, 0);
  await run(missing.id, 3, { action: "STOCKTAKE_REVIEW" });
  const zeroPost = command(missing.id, 4, { action: "STOCKTAKE_POST" });
  const zeroApproval = await approved(zeroPost);
  await executeWmsCommand(scope, zeroPost, zeroApproval);
  assert.equal((await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: location.id, lotId: lot.id } })).onHand, 0);
  const reconcile = await queryWms(scope, "reconciliation", new URLSearchParams({ locationId: location.id }));
  const reconciled = reconcile.items[0] as { reconciliationStatus?: string } | undefined;
  assert.equal(reconciled?.reconciliationStatus, "MATCH");
  console.log("PASS: explicit zero loss, unobserved rejection, stale revision, multiline rollback, workspace isolation and ledger reconciliation");

  const stale = await create();
  await run(stale.id, 1, { action: "STOCKTAKE_START" }); await count(stale.id, 2, 3);
  await run(stale.id, 3, { action: "STOCKTAKE_REVIEW" });
  const stalePost = command(stale.id, 4, { action: "STOCKTAKE_POST" });
  const staleApproval = await approved(stalePost);
  const pendingApproval = await requestApproval(scope, { ...stalePost, idempotencyKey: "pending-stocktake-stale" });
  // Another approved stocktake legitimately changes the inventory after baseline capture.
  const intervening = await create();
  await run(intervening.id, 1, { action: "STOCKTAKE_START" }); await count(intervening.id, 2, 7);
  await run(intervening.id, 3, { action: "STOCKTAKE_REVIEW" });
  const interveningPost = command(intervening.id, 4, { action: "STOCKTAKE_POST" });
  await executeWmsCommand(scope, interveningPost, await approved(interveningPost));
  await assert.rejects(() => requestApproval(scope, { ...stalePost, idempotencyKey: "new-stocktake-stale" }), /基准已变化/);
  await assert.rejects(() => decideApproval(supervisor, pendingApproval.id, 1, true), /基准已变化/);
  await assert.rejects(() => executeWmsCommand(scope, stalePost, staleApproval), /基准已变化/);
  assert.equal(await prisma.wmsCommand.count({ where: { idempotencyKey: stalePost.idempotencyKey } }), 0);
  assert.equal((await prisma.wmsApproval.findUniqueOrThrow({ where: { id: staleApproval } })).status, "APPROVED");
  await run(stale.id, 4, { action: "STOCKTAKE_CANCEL" });
  console.log("PASS: changed baseline rejected at approval request, decision and execution without consuming approval");

  const balance = await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: location.id, lotId: lot.id } });
  const reserve = command(balance.id, balance.revision, { action: "RESERVE", number: "COUNT-RESERVE", quantity: 6 });
  await executeWmsCommand(scope, reserve, await approved(reserve));
  const floor = await create();
  await run(floor.id, 1, { action: "STOCKTAKE_START" }); await count(floor.id, 2, 5);
  await run(floor.id, 3, { action: "STOCKTAKE_REVIEW" });
  await assert.rejects(() => requestApproval(scope, command(floor.id, 4, { action: "STOCKTAKE_POST" })), /预占合计/);
  const phantom = await create();
  await run(phantom.id, 1, { action: "STOCKTAKE_START" }); await count(phantom.id, 2, 7);
  await run(phantom.id, 3, { action: "STOCKTAKE_REVIEW" });
  const gain = await create();
  await run(gain.id, 1, { action: "STOCKTAKE_START" });
  await run(gain.id, 2, { action: "STOCKTAKE_COUNT", lines: [
    { locationId: location.id, lotId: lot.id, countedQty: 7 },
    { locationId: location.id, lotId: lot2.id, countedQty: 2 },
  ] });
  await run(gain.id, 3, { action: "STOCKTAKE_REVIEW" });
  const gainPost = command(gain.id, 4, { action: "STOCKTAKE_POST" });
  const gainApproval = await approved(gainPost);
  await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "warehouse_supervisor" } }, data: { permissions: { wms: ["view"] } } });
  await assert.rejects(() => executeWmsCommand(scope, gainPost, gainApproval), /权限/);
  await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "warehouse_supervisor" } }, data: { permissions: grants } });
  await executeWmsCommand(scope, gainPost, gainApproval);
  assert.equal(await prisma.wmsMovement.count({ where: { sourceId: gain.id } }), 1); // unchanged line emits no movement
  await assert.rejects(() => requestApproval(scope, command(phantom.id, 4, { action: "STOCKTAKE_POST" })), /新库存/);
  console.log("PASS: reserved-stock floor, permission revocation, new balance detection and no zero-delta movement");

  const multi = await create();
  await run(multi.id, 1, { action: "STOCKTAKE_START" });
  await run(multi.id, 2, { action: "STOCKTAKE_COUNT", lines: [
    { locationId: location.id, lotId: lot.id, countedQty: 8 },
    { locationId: location.id, lotId: lot2.id, countedQty: 1 },
  ] });
  await run(multi.id, 3, { action: "STOCKTAKE_REVIEW" });
  const multiPost = command(multi.id, 4, { action: "STOCKTAKE_POST" });
  let locked!: () => void, unlock!: () => void;
  const ready = new Promise<void>(resolve => { locked = resolve; });
  const release = new Promise<void>(resolve => { unlock = resolve; });
  const holding = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "WmsLocation" WHERE id=${location.id} FOR UPDATE`;
    locked(); await release;
  });
  await ready;
  try { await assert.rejects(() => requestApproval(scope, multiPost), /正在操作/); }
  finally { unlock(); await holding; }
  await executeWmsCommand(scope, multiPost, await approved(multiPost));
  const multiMovements = await prisma.wmsMovement.findMany({ where: { sourceId: multi.id } });
  assert.deepEqual(multiMovements.map(row => row.deltaOnHand).sort(), [-1, 1]);
  assert.equal((await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: location.id, lotId: lot.id } })).onHand, 8);
  assert.equal((await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: location.id, lotId: lot2.id } })).onHand, 1);
  const afterMulti = await queryWms(scope, "reconciliation", new URLSearchParams({ locationId: location.id }));
  for (const item of afterMulti.items) assert.ok("reconciliationStatus" in item && item.reconciliationStatus === "MATCH");
  console.log("PASS: concurrent location lock returns retryable conflict; two-line gain/loss posts and reconciles atomically");

  // Authenticated real Route Handlers, without starting web/worker or reading .env.
  const cookie = (await createSession(scope.actorUserId)).sessionCookie;
  const headers = { "content-type": "application/json", "x-workspace-id": scope.workspaceId, cookie: cookie.name + "=" + cookie.value };
  const req = (path: string, body?: unknown) => new Request("http://127.0.0.1/api/operations/wms/" + path, { method: body ? "POST" : "GET", headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const context = { params: Promise.resolve({ kind: "stocktakes" }) };
  const created = await resources.POST(req("stocktakes", { workspaceId: scope.workspaceId, warehouseId: warehouse.id, number: "HTTP-COUNT", locationIds: [otherLocation.id] }), context);
  if (!created) throw new Error("Create route returned no response.");
  assert.equal(created.status, 201); const httpRow = (await created.json()).item;
  const started = await commands.POST(req("commands", command(httpRow.id, 1, { action: "STOCKTAKE_START" })));
  if (!started) throw new Error("Start route returned no response.");
  assert.equal(started.status, 200);
  const viewed = await resources.GET(req("stocktakes?id=" + httpRow.id), context);
  if (!viewed) throw new Error("Query route returned no response.");
  assert.equal(viewed.status, 200);
  assert.equal((await viewed.json()).items[0].locations[0].location.code, "S2");
  assert.equal((await commands.POST(req("commands", command(httpRow.id, 2, { action: "STOCKTAKE_REVIEW" }))))?.status, 200);
  assert.equal((await approvals.POST(req("approvals", command(httpRow.id, 3, { action: "STOCKTAKE_POST" }))))?.status, 201);
  console.log("PASS: authenticated HTTP create, start, detailed query, empty scope review and approval request");
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
