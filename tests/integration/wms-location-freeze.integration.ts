import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { createSession } from "../../src/lib/auth/session";
import { verifyWmsBrowser } from "./wms-browser.integration";
import { prisma } from "../../src/lib/db/prisma";
import { createWmsResource } from "../../src/lib/wms/catalog-service";
import { executeWmsCommand } from "../../src/lib/wms/application-service";
import { requestApproval, decideApproval } from "../../src/lib/wms/approvals";
import { activeLocation } from "../../src/lib/wms/repository";
import { presentBalances } from "../../src/lib/wms/stock-context-query";
import { stockActionLimit } from "../../src/lib/wms/stock-action-view";
import type { WmsCommandInput, WmsCommandPayload } from "../../src/lib/wms/contracts";

async function main() {
  if (process.env.WMS_OFFLINE_FIXTURE !== "1") throw Error("Disposable fixture required");
  const scope = { organizationId: "freeze-org", workspaceId: "default", actorUserId: "freeze-operator" };
  const supervisor = { ...scope, actorUserId: "freeze-supervisor" };
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Synthetic freeze" } });
  for (const id of ["default", "other"]) await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id, name: id } });
  await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: "warehouse", name: "Fixture", description: "fixture", permissions: { wms: ["view", "create", "edit", "approve"], operations: ["view"] } } });
  for (const id of [scope.actorUserId, supervisor.actorUserId]) {
    await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: id, passwordHash: "not-a-password" } });
    await prisma.organizationMember.create({ data: { organizationId: scope.organizationId, userId: id, role: "warehouse" } });
  }
  await prisma.productRecord.create({ data: { id: "freeze-product", organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId: scope.actorUserId, sku: "FREEZE", payload: {} } });
  const warehouse = await createWmsResource(scope, "warehouses", { code: "MAIN", name: "Fixture" });
  const area = await createWmsResource(scope, "areas", { warehouseId: warehouse.id, code: "A", name: "Fixture" });
  const storage = await createWmsResource(scope, "locations", { areaId: area.id, code: "S", kind: "STORAGE" });
  const target = await createWmsResource(scope, "locations", { areaId: area.id, code: "T", kind: "STORAGE" });
  const receiving = await createWmsResource(scope, "locations", { areaId: area.id, code: "R", kind: "RECEIVING" });
  const lot = await createWmsResource(scope, "lots", { productRecordId: "freeze-product", lotCode: "FREEZE-LOT" });
  let sequence = 0;
  const command = (aggregateId: string, expectedRevision: number, payload: WmsCommandPayload): WmsCommandInput => ({ workspaceId: scope.workspaceId, aggregateId, expectedRevision, payload, idempotencyKey: "freeze-" + ++sequence });
  async function approved(input: WmsCommandInput) {
    const approval = await requestApproval(scope, input);
    await decideApproval(supervisor, approval.id, 1, true);
    return approval.id;
  }
  async function run(input: WmsCommandInput) { return executeWmsCommand(scope, input, await approved(input)); }
  const sheet = await createWmsResource(scope, "stocktakes", { warehouseId: warehouse.id, number: "FREEZE-COUNT", locationIds: [storage.id] });
  await executeWmsCommand(scope, command(sheet.id, 1, { action: "STOCKTAKE_START" }));
  await executeWmsCommand(scope, command(sheet.id, 2, { action: "STOCKTAKE_COUNT", lines: [{ locationId: storage.id, lotId: lot.id, countedQty: 10 }] }));
  await executeWmsCommand(scope, command(sheet.id, 3, { action: "STOCKTAKE_REVIEW" }));
  await run(command(sheet.id, 4, { action: "STOCKTAKE_POST" }));
  let balance = await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: storage.id } });
  await run(command(balance.id, balance.revision, { action: "RESERVE", number: "FREEZE-RES", quantity: 2 }));
  const reservation = await prisma.wmsReservation.findFirstOrThrow({ where: { balanceId: balance.id } });
  await executeWmsCommand(scope, command(reservation.id, 1, { action: "PICK", quantity: 1 }));
  balance = await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: balance.id } });
  const draftSheet = await createWmsResource(scope, "stocktakes", { warehouseId: warehouse.id, number: "DRAFT-BEFORE-FREEZE", locationIds: [storage.id] });
  const pendingSheet = await createWmsResource(scope, "stocktakes", { warehouseId: warehouse.id, number: "POST-BEFORE-FREEZE", locationIds: [storage.id] });
  await executeWmsCommand(scope, command(pendingSheet.id, 1, { action: "STOCKTAKE_START" }));
  await executeWmsCommand(scope, command(pendingSheet.id, 2, { action: "STOCKTAKE_COUNT", lines: [{ locationId: storage.id, lotId: lot.id, countedQty: 10 }] }));
  await executeWmsCommand(scope, command(pendingSheet.id, 3, { action: "STOCKTAKE_REVIEW" }));
  const pendingPost = command(pendingSheet.id, 4, { action: "STOCKTAKE_POST" });
  const postApproval = await approved(pendingPost);
  const oldReserve = command(balance.id, balance.revision, { action: "RESERVE", number: "BEFORE-FREEZE", quantity: 1 });
  const oldApproval = await approved(oldReserve);
  const freeze = command(storage.id, 1, { action: "LOCATION_FREEZE", reason: "隔离检查" });
  await assert.rejects(() => requestApproval(scope, { ...freeze, payload: { action: "LOCATION_FREEZE", reason: " " } }));
  await assert.rejects(() => requestApproval({ ...scope, workspaceId: "other" }, { ...freeze, workspaceId: "other" }));
  await assert.rejects(() => executeWmsCommand(scope, freeze), /审批/);
  const a = await requestApproval(scope, freeze);
  assert.equal((await requestApproval(scope, freeze)).id, a.id);
  await assert.rejects(() => decideApproval(scope, a.id, 1, true), /自批/);
  await decideApproval(supervisor, a.id, 1, true);
  const beforeMovements = await prisma.wmsMovement.count();
  const results = await Promise.all(Array.from({ length: 6 }, () => executeWmsCommand(scope, freeze, a.id)));
  results.forEach(result => assert.deepEqual(result, results[0]));
  assert.equal(await prisma.wmsCommand.count({ where: { organizationId: scope.organizationId, action: "LOCATION_FREEZE" } }), 1);
  assert.equal(await prisma.wmsDomainEvent.count({ where: { organizationId: scope.organizationId, command: { action: "LOCATION_FREEZE" } } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: scope.organizationId, action: "wms.LOCATION_FREEZE", entityId: storage.id } }), 1);
  assert.match(JSON.stringify((await prisma.wmsDomainEvent.findFirstOrThrow({ where: { command: { action: "LOCATION_FREEZE", aggregateId: storage.id } } })).payload), /隔离检查/);
  assert.equal(await prisma.wmsMovement.count(), beforeMovements);
  assert.deepEqual(await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: balance.id } }), balance);
  assert.equal((await prisma.wmsLocation.findUniqueOrThrow({ where: { id: storage.id } })).frozen, true);
  await assert.rejects(() => executeWmsCommand(scope, oldReserve, oldApproval), /冻结/);
  await assert.rejects(() => executeWmsCommand(scope, pendingPost, postApproval), /冻结/);
  await assert.rejects(() => executeWmsCommand(scope, command(draftSheet.id, 1, { action: "STOCKTAKE_START" })), /冻结/);
  await executeWmsCommand(scope, command(draftSheet.id, 1, { action: "STOCKTAKE_CANCEL" }));
  for (const action of ["PICK", "UNPICK", "RELEASE", "DISPATCH"] as const) {
    const input = command(reservation.id, 2, { action, quantity: 1 });
    await assert.rejects(() => action === "PICK" || action === "UNPICK" ? executeWmsCommand(scope, input) : requestApproval(scope, input), /冻结/);
  }
  await assert.rejects(() => requestApproval(scope, command(balance.id, balance.revision, { action: "TRANSFER", quantity: 1, targetLocationId: target.id })), /冻结/);
  await assert.rejects(() => createWmsResource(scope, "stocktakes", { warehouseId: warehouse.id, number: "BLOCKED", locationIds: [storage.id] }), /冻结/);
  const view = await prisma.$transaction(tx => presentBalances(tx, scope, [balance]));
  assert.equal(view[0].available, 8); assert.equal(view[0].stock?.locationFrozen, true);
  assert.equal(stockActionLimit(view[0], "RESERVE"), 0);
  console.log("PASS: independent approval, scoped access, six duplicate executions, immutable event, unchanged stock and frozen operation gates");

  // Both approvals initially valid; only one can consume the location revision.
  const unfreeze = command(storage.id, 2, { action: "LOCATION_UNFREEZE", reason: "检查完成" });
  const stale = command(storage.id, 2, { action: "LOCATION_UNFREEZE", reason: "并行申请" });
  const u = await approved(unfreeze), s = await approved(stale);
  await executeWmsCommand(scope, unfreeze, u);
  await assert.rejects(() => executeWmsCommand(scope, stale, s), /变更/);
  await executeWmsCommand(scope, oldReserve, oldApproval);
  assert.equal((await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: balance.id } })).reserved, 3);
  await run(command(target.id, 1, { action: "LOCATION_FREEZE", reason: "目标库位检查" }));
  balance = await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: balance.id } });
  await assert.rejects(() => requestApproval(scope, command(balance.id, balance.revision, { action: "TRANSFER", quantity: 1, targetLocationId: target.id })), /冻结/);
  const receipt = await createWmsResource(scope, "receipts", { receivingLocationId: receiving.id, number: "BEFORE-R", lines: [{ lotId: lot.id, expectedQty: 2 }] });
  const line = await prisma.wmsReceiptLine.findFirstOrThrow({ where: { receiptId: receipt.id } });
  const receive = command(receipt.id, 1, { action: "RECEIVE", lines: [{ lineId: line.id, quantity: 2 }] });
  const receiveApproval = await approved(receive);
  const cancelReceipt = await createWmsResource(scope, "receipts", { receivingLocationId: receiving.id, number: "CANCEL-R", lines: [{ lotId: lot.id, expectedQty: 1 }] });
  const inspected = await createWmsResource(scope, "receipts", { receivingLocationId: receiving.id, number: "INSPECT-R", lines: [{ lotId: lot.id, expectedQty: 1 }] });
  const inspectedLine = await prisma.wmsReceiptLine.findFirstOrThrow({ where: { receiptId: inspected.id } });
  await run(command(inspected.id, 1, { action: "RECEIVE", lines: [{ lineId: inspectedLine.id, quantity: 1 }] }));
  const inspect = command(inspected.id, 2, { action: "INSPECT", lines: [{ lineId: inspectedLine.id, acceptedQty: 1, rejectedQty: 0 }] });
  const inspectApproval = await approved(inspect);
  await run(command(receiving.id, 1, { action: "LOCATION_FREEZE", reason: "收货区检查" }));
  await assert.rejects(() => createWmsResource(scope, "receipts", { receivingLocationId: receiving.id, number: "BLOCKED-R", lines: [{ lotId: lot.id, expectedQty: 1 }] }), /冻结/);
  await assert.rejects(() => executeWmsCommand(scope, receive, receiveApproval), /冻结/);
  await assert.rejects(() => executeWmsCommand(scope, inspect, inspectApproval), /冻结/);
  await executeWmsCommand(scope, command(cancelReceipt.id, 1, { action: "CANCEL" }));
  console.log("PASS: frozen receiving blocks previously approved receive/inspect; cancel remains available");
  console.log("PASS: stale unfreeze rejected; original approved reservation resumes; frozen transfer target and receiving location rejected");

  const again = command(storage.id, 3, { action: "LOCATION_FREEZE", reason: "并发序列化" });
  const againApproval = await approved(again);
  let unlock!: () => void, locked!: () => void;
  const held = new Promise<void>(resolve => { locked = resolve; });
  const release = new Promise<void>(resolve => { unlock = resolve; });
  const operation = prisma.$transaction(async tx => { await activeLocation(tx, scope, storage.id); locked(); await release; });
  await held;
  // Observe the actual database lock wait instead of relying on elapsed time.
  const freezing = executeWmsCommand(scope, again, againApproval);
  try {
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%WmsLocation%'`;
      waiting = rows[0].n > BigInt(0);
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, "freeze waits for in-flight operation's location SHARE lock");
  } finally { unlock(); await operation; await freezing; }
  await assert.rejects(() => prisma.$transaction(tx => activeLocation(tx, scope, storage.id)), /冻结/);
  const restore = command(storage.id, 4, { action: "LOCATION_UNFREEZE", reason: "权限校验" });
  const restoreApproval = await approved(restore);
  await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "warehouse" } }, data: { permissions: { wms: ["view"] } } });
  await assert.rejects(() => executeWmsCommand(scope, restore, restoreApproval), /权限/);
  assert.equal((await prisma.wmsLocation.findUniqueOrThrow({ where: { id: storage.id } })).frozen, true);
  assert.equal((await prisma.wmsApproval.findUniqueOrThrow({ where: { id: restoreApproval } })).status, "APPROVED");
  console.log("PASS: revoked permission cannot unfreeze or consume approval");
  console.log("PASS: PostgreSQL lock observation proves freeze serializes with in-flight stock operations");
  if (process.env.WMS_FREEZE_BROWSER === "1") {
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "warehouse" } }, data: { permissions: { wms: ["view", "create", "edit", "approve"], operations: ["view"] } } });
    const cookies = await Promise.all([scope.actorUserId, supervisor.actorUserId].map(async id => { const { sessionCookie: c } = await createSession(id); return `${c.name}=${c.value}`; }));
    await verifyWmsBrowser(cookies[0], cookies[1], { organizationId: scope.organizationId, async run(page, approverContext, base) {
      const approverPage = await approverContext.newPage();
      await approverPage.goto(base + "/logistics/warehouse", { waitUntil: "domcontentloaded", timeout: 60000 });
      const before = await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: balance.id } });
      const row = (id: string) => page.locator(`tr[data-record-id="${id}"]`);
      for (const frozen of [false, true]) {
        await page.getByRole("tab", { name: "库位", exact: true }).click();
        await row(storage.id).getByRole("button", { name: frozen ? "冻结" : "解冻", exact: true }).click();
        const form = page.getByRole("form", { name: frozen ? "冻结库位作业" : "解冻库位作业" });
        await form.getByRole("textbox").fill("双会话浏览器核验");
        const requested = page.waitForResponse(r => r.url().endsWith("/wms/approvals") && r.request().method() === "POST");
        await form.getByRole("button", { name: frozen ? "申请冻结" : "申请解冻", exact: true }).click();
        const response = await requested; assert.equal(response.status(), 201);
        const { item } = await response.json();
        await approverPage.getByRole("tab", { name: "待审批", exact: true }).click();
        await approverPage.getByRole("button", { name: "刷新", exact: true }).click();
        const approvalRow = approverPage.locator(`tr[data-record-id="${item.id}"]`);
        await approvalRow.locator("summary").click();
        await expect(approvalRow.getByText(/双会话浏览器核验/)).toBeVisible();
        await expect(approvalRow.getByText("目标库位：S", { exact: true })).toBeVisible();
        const decided = approverPage.waitForResponse(r => r.url().endsWith("/wms/approvals") && r.request().method() === "POST");
        await approvalRow.getByRole("button", { name: "通过审批", exact: true }).click();
        assert.equal((await decided).status(), 200);
        await page.getByRole("button", { name: "刷新", exact: true }).click();
        const executed = page.waitForResponse(r => r.url().endsWith("/wms/commands") && r.request().method() === "POST");
        await row(item.id).getByRole("button", { name: "执行", exact: true }).click();
        assert.equal((await executed).status(), 200);
        assert.equal((await prisma.wmsLocation.findUniqueOrThrow({ where: { id: storage.id } })).frozen, frozen);
        assert.deepEqual(await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: balance.id } }), before);
        await page.getByRole("tab", { name: "库存余额", exact: true }).click();
        const reserveButton = row(balance.id).getByRole("button", { name: "预占", exact: true });
        if (frozen) { await expect(reserveButton).toBeDisabled(); await expect(row(balance.id).getByText("库位已冻结，暂停库存作业。", { exact: true })).toBeVisible(); }
        else await expect(reserveButton).toBeEnabled();
      }
      console.log("PASS: browser unfreeze/freeze, independent reason review, execution and frozen inventory controls verified against database");
    } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
