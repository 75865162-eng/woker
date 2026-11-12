import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { createSession } from "../../src/lib/auth/session";
import { verifyWmsBrowser } from "./wms-browser.integration";
import { prisma } from "../../src/lib/db/prisma";
import { createWmsResource } from "../../src/lib/wms/catalog-service";
import { executeWmsCommand } from "../../src/lib/wms/application-service";
import { requestApproval, decideApproval } from "../../src/lib/wms/approvals";
import { queryWms } from "../../src/lib/wms/query-service";
import type { WmsCommandInput, WmsCommandPayload } from "../../src/lib/wms/contracts";

async function main() {
  if (process.env.WMS_OFFLINE_FIXTURE !== "1") throw Error("Disposable fixture required");
  const scope = { organizationId: "transfer-org", workspaceId: "default", actorUserId: "transfer-operator" };
  const supervisor = { ...scope, actorUserId: "transfer-supervisor" };
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Synthetic transfer" } });
  for (const id of ["default", "other"]) await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id, name: id } });
  await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: "warehouse", name: "Fixture", description: "fixture", permissions: { wms: ["view", "create", "edit", "approve"], operations: ["view"] } } });
  for (const id of [scope.actorUserId, supervisor.actorUserId]) {
    await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: id, passwordHash: "not-a-password" } });
    await prisma.organizationMember.create({ data: { organizationId: scope.organizationId, userId: id, role: "warehouse" } });
  }
  await prisma.productRecord.create({ data: { id: "transfer-product", organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId: scope.actorUserId, sku: "TRANSFER", payload: {} } });
  const warehouse = await createWmsResource(scope, "warehouses", { code: "MAIN", name: "Fixture" });
  const area = await createWmsResource(scope, "areas", { warehouseId: warehouse.id, code: "A", name: "Fixture" });
  const storage = await createWmsResource(scope, "locations", { areaId: area.id, code: "S", kind: "STORAGE" });
  const target = await createWmsResource(scope, "locations", { areaId: area.id, code: "T", kind: "STORAGE" });
  const lot = await createWmsResource(scope, "lots", { productRecordId: "transfer-product", lotCode: "TRANSFER-LOT" });
  let sequence = 0;
  const command = (aggregateId: string, expectedRevision: number, payload: WmsCommandPayload): WmsCommandInput => ({ workspaceId: scope.workspaceId, aggregateId, expectedRevision, payload, idempotencyKey: "transfer-" + ++sequence });
  async function approved(input: WmsCommandInput) {
    const approval = await requestApproval(scope, input);
    await decideApproval(supervisor, approval.id, 1, true);
    return approval.id;
  }
  async function run(input: WmsCommandInput) { return executeWmsCommand(scope, input, await approved(input)); }
  const sheet = await createWmsResource(scope, "stocktakes", { warehouseId: warehouse.id, number: "TRANSFER-COUNT", locationIds: [storage.id] });
  await executeWmsCommand(scope, command(sheet.id, 1, { action: "STOCKTAKE_START" }));
  await executeWmsCommand(scope, command(sheet.id, 2, { action: "STOCKTAKE_COUNT", lines: [{ locationId: storage.id, lotId: lot.id, countedQty: 10 }] }));
  await executeWmsCommand(scope, command(sheet.id, 3, { action: "STOCKTAKE_REVIEW" }));
  await run(command(sheet.id, 4, { action: "STOCKTAKE_POST" }));
  const balance = await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: storage.id } });
  const input = command(balance.id, balance.revision, { action: "TRANSFER", targetLocationId: target.id, quantity: 3 });
  const approvalId = await approved(input);
  const results = await Promise.all(Array.from({ length: 4 }, () => executeWmsCommand(scope, input, approvalId)));
  results.forEach(result => assert.deepEqual(result, results[0]));
  const result = results[0] as { commandId: string };
  assert.equal(typeof result.commandId, "string");
  const commandId = result.commandId;
  const rows = () => prisma.wmsMovement.findMany({ where: { organizationId: scope.organizationId, sourceId: commandId } });
  const movements = await rows();
  assert.equal(movements.length, 2);
  assert.deepEqual(movements.map(row => row.deltaOnHand).sort((a, b) => a - b), [-3, 3]);
  assert.equal((await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: balance.id } })).onHand, 7);
  assert.equal((await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: target.id } })).onHand, 3);
  const params = new URLSearchParams({ sourceId: commandId, limit: "1" });
  const first = await queryWms(scope, "transfers", params);
  assert.equal(first.items.length, 1); assert.ok(first.nextCursor);
  const second = await queryWms(scope, "transfers", new URLSearchParams({ ...Object.fromEntries(params), cursor: first.nextCursor }));
  assert.equal(second.items.length, 1); assert.equal(second.nextCursor, null);
  assert.notDeepEqual(first.items[0], second.items[0]);
  const changedFilters: Array<Record<string, string>> = [{ locationId: storage.id }, { sourceId: "other" }];
  for (const changed of changedFilters) {
    await assert.rejects(() => queryWms(scope, "transfers", new URLSearchParams({ ...Object.fromEntries(params), ...changed, cursor: first.nextCursor! })));
  }
  const oneSide = await queryWms(scope, "transfers", new URLSearchParams({ sourceId: commandId, locationId: storage.id }));
  assert.equal(oneSide.items.length, 1);
  assert.equal((oneSide.items[0] as unknown as { deltaOnHand: number }).deltaOnHand, -3);
  assert.equal((await queryWms(scope, "transfers", new URLSearchParams({ barcode: "nonexistent" }))).items.length, 0);
  assert.equal((await queryWms({ ...scope, workspaceId: "other" }, "transfers", new URLSearchParams({ sourceId: commandId }))).items.length, 0);
  console.log("PASS: concurrent transfer retries conserve stock with one pair; transfer query paginates and enforces scope/filter-bound cursors");
  if (process.env.WMS_TRANSFER_BROWSER === "1") {
    const cookies = await Promise.all([scope.actorUserId, supervisor.actorUserId].map(async id => { const { sessionCookie: c } = await createSession(id); return `${c.name}=${c.value}`; }));
    await verifyWmsBrowser(cookies[0], cookies[1], { organizationId: scope.organizationId, async run(page) {
      const transferEntry = page.getByRole("link", { name: "调拨流水", exact: true });
      await expect(transferEntry).toHaveAttribute("href", "/logistics/warehouse?tab=transfers");
      await transferEntry.click();
      await expect(page.locator("h1")).toHaveText("调拨流水");
      await expect(page.getByRole("tab", { name: "调拨流水", exact: true })).toHaveAttribute("aria-selected", "true");
      const row = (id: string) => page.locator(`tr[data-record-id="${id}"]`);
      const out = movements.find(m => m.deltaOnHand < 0)!;
      const incoming = movements.find(m => m.deltaOnHand > 0)!;
      await expect(row(out.id).locator('[data-column="direction"]')).toHaveText("调出");
      await expect(row(incoming.id).locator('[data-column="direction"]')).toHaveText("调入");
      await page.getByLabel("库位 ID", { exact: true }).selectOption(storage.id);
      await page.getByRole("button", { name: "筛选", exact: true }).click();
      await expect(row(incoming.id)).toHaveCount(0);
      await expect(row(out.id)).toBeVisible();
      await row(out.id).getByRole("button", { name: "查看成对流水", exact: true }).click();
      await expect(page.getByRole("tab", { name: "库存流水", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByLabel("来源单据", { exact: true })).toHaveValue(commandId);
      await expect(row(out.id)).toBeVisible();
      await expect(row(incoming.id)).toBeVisible();
      await expect(page.locator("tbody tr[data-record-id]")).toHaveCount(2);
      await page.screenshot({ path: "docs/wimoor-integration/ui/screenshots/wms-transfer-ledger.png", fullPage: true });
      assert.deepEqual(await rows(), movements, "reading trace leaves immutable movements unchanged");
      console.log("PASS: Chromium transfer direction, location filtering and cross-location paired movement drilldown match database");
    } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
