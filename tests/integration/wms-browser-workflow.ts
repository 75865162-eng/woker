import assert from "node:assert/strict";
import { expect, type BrowserContext, type Page, type Locator } from "@playwright/test";
import { prisma } from "../../src/lib/db/prisma";

/** All business mutations below originate in real page controls, with two real sessions. */
export async function runWmsPageWorkflow(page: Page, approverContext: BrowserContext, base: string) {
  const supervisor = await approverContext.newPage();
  supervisor.setDefaultTimeout(20000);
  await supervisor.goto(base + "/logistics/warehouse", { waitUntil: "domcontentloaded", timeout: 60000 });
  await supervisor.getByText("MAIN", { exact: true }).waitFor();
  const paths: Record<string, string> = { "盘点": "stocktakes", "仓库": "warehouses", "区域": "areas", "库位": "locations", "商品批次": "lots", "收货单": "receipts", "库存余额": "balances", "待审批": "approvals", "预占与出库": "reservations", "库存流水": "movements", "调拨流水": "transfers", "库存核对": "reconciliation" };
  async function tab(target: Page, name: string) {
    const button = target.getByRole("tab", { name, exact: true });
    const response = target.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/wms/${paths[name]}`) && response.request().method() === "GET");
    if (await button.getAttribute("aria-selected") === "true") await target.getByRole("button", { name: "刷新", exact: true }).click(); else await button.click();
    assert.equal((await response).status(), 200);
    await expect(target.getByRole("button", { name: "刷新", exact: true })).toBeEnabled({ timeout: 20000 });
  }
  async function post(target: Page, resource: string, button: Locator) {
    const received = target.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/wms/${resource}`) && response.request().method() === "POST");
    await button.click();
    const response = await received;
    const data = await response.json();
    assert.ok(response.ok(), JSON.stringify(data));
    return data.item;
  }
  const row = (target: Page, id: string) => target.locator(`tr[data-record-id="${id}"]`);
  async function findApproval(target: Page, id: string) {
    while (await row(target, id).count() === 0) {
      const next = target.getByRole("button", { name: "下一页", exact: true });
      await expect(next).toBeEnabled();
      const response = target.waitForResponse(response => new URL(response.url()).pathname.endsWith("/wms/approvals") && response.request().method() === "GET");
      await next.click();
      assert.equal((await response).status(), 200);
      await expect(target.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
    }
  }
  let verifiedApprovalQueues = false;
  async function approvalQueue(target: Page, value: string) {
    const response = target.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/approvals") && (url.searchParams.get("workflowStatus") ?? "") === value; });
    await target.getByLabel("审批作业", { exact: true }).selectOption(value);
    assert.equal((await response).status(), 200);
    await expect(target.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
  }
  async function approveAndExecute(approvalId: string) {
    await tab(page, "待审批");
    if (!verifiedApprovalQueues) await approvalQueue(page, "MY_REQUESTS");
    await findApproval(page, approvalId);
    assert.equal(await row(page, approvalId).getByRole("button", { name: "通过审批" }).count(), 0, "requester must not receive self-approval control");
    await tab(supervisor, "待审批");
    if (!verifiedApprovalQueues) await approvalQueue(supervisor, "TO_REVIEW");
    await findApproval(supervisor, approvalId);
    await row(supervisor, approvalId).locator("summary").click();
    const requested = await prisma.wmsApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const payload = (requested.request as { payload: { action: string; targetLocationId?: string; lines?: { lineId: string; locationId?: string }[] } }).payload;
    if (["RESERVE", "TRANSFER", "RELEASE", "DISPATCH"].includes(payload.action)) {
      const sourceId = payload.action === "RESERVE" || payload.action === "TRANSFER" ? requested.aggregateId : (await prisma.wmsReservation.findUniqueOrThrow({ where: { id: requested.aggregateId } })).balanceId;
      const source = await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: sourceId }, include: { lot: true, location: { include: { area: { include: { warehouse: true } } } } } });
      for (const text of [`仓库：${source.location.area.warehouse.code} · ${source.location.area.warehouse.name}`, `库位：${source.location.code}`, `批次：${source.lot.lotCode}`, `条码：${source.lot.barcode ?? "未设置"}`]) await expect(row(supervisor, approvalId).getByText(text, { exact: true })).toBeVisible();
    }
    if (["RELEASE", "DISPATCH"].includes(payload.action)) {
      const current = await prisma.wmsReservation.findUniqueOrThrow({ where: { id: requested.aggregateId } });
      const remaining = current.requestedQty - current.releasedQty - current.dispatchedQty;
      for (const text of [`预占单号：${current.number}`, `当前版本：${current.revision}；申请版本：${requested.expectedRevision}`, `剩余预占：${remaining}；已拣：${current.pickedQty}；待拣：${remaining - current.pickedQty}`]) await expect(row(supervisor, approvalId).getByText(text, { exact: true })).toBeVisible();
    }
    if (["RECEIVE", "INSPECT", "PUTAWAY"].includes(payload.action)) {
      const receipt = await prisma.wmsReceipt.findUniqueOrThrow({ where: { id: requested.aggregateId }, include: { location: true, lines: { include: { lot: true } } } });
      await expect(row(supervisor, approvalId).getByText(`收货单号：${receipt.number}`, { exact: true })).toBeVisible();
      await expect(row(supervisor, approvalId).getByText(`收货库位：${receipt.location.code}`, { exact: true })).toBeVisible();
      for (const requestedLine of payload.lines ?? []) {
        const line = receipt.lines.find(line => line.id === requestedLine.lineId)!;
        await expect(row(supervisor, approvalId).getByText(`批次：${line.lot.lotCode}`, { exact: true })).toBeVisible();
        if (requestedLine.locationId) {
          const target = await prisma.wmsLocation.findUniqueOrThrow({ where: { id: requestedLine.locationId }, include: { area: { include: { warehouse: true } } } });
          await expect(row(supervisor, approvalId).getByText(`上架库位：${target.area.warehouse.code} / ${target.code}`, { exact: true })).toBeVisible();
        }
      }
    }
    if (payload.action === "TRANSFER") {
      await expect(row(supervisor, approvalId).getByText(`目标存储库位：${payload.targetLocationId}`, { exact: true })).toBeVisible();
      const target = await prisma.wmsLocation.findUniqueOrThrow({ where: { id: payload.targetLocationId }, include: { area: { include: { warehouse: true } } } });
      await expect(row(supervisor, approvalId).getByText(`目标仓库：${target.area.warehouse.code} · ${target.area.warehouse.name}`, { exact: true })).toBeVisible();
      await expect(row(supervisor, approvalId).getByText(`目标库位：${target.code}`, { exact: true })).toBeVisible();
    }
    await post(supervisor, "approvals", row(supervisor, approvalId).getByRole("button", { name: "通过审批" }));
    if (!verifiedApprovalQueues) {
      await expect(row(supervisor, approvalId)).toHaveCount(0);
      await approvalQueue(supervisor, "");
    }
    await tab(page, "待审批");
    if (!verifiedApprovalQueues) await approvalQueue(page, "TO_EXECUTE");
    await findApproval(page, approvalId);
    const result = await post(page, "commands", row(page, approvalId).getByRole("button", { name: "执行", exact: true }));
    if (!verifiedApprovalQueues) {
      await expect(row(page, approvalId)).toHaveCount(0);
      await approvalQueue(page, "");
      verifiedApprovalQueues = true;
      console.log("PASS: two-session approval queues locate the current member's requests, remove approved review work and remove executed work");
    }
    // Execution must leave the approvals table showing approvals rather than receipt rows.
    await tab(page, "待审批");
    await findApproval(page, approvalId);
    await row(page, approvalId).getByText("已执行", { exact: true }).waitFor();
    return result;
  }
  await tab(supervisor, "商品批次");
  await supervisor.getByRole("button", { name: "新建批次", exact: true }).click();
  const deniedPicker = supervisor.getByRole("group", { name: "选择商品主档", exact: true });
  await deniedPicker.getByLabel("SKU／商品名称", { exact: true }).fill("SYNTHETIC");
  const deniedResponse = supervisor.waitForResponse(response => new URL(response.url()).pathname === "/api/products");
  await deniedPicker.getByRole("button", { name: "搜索商品", exact: true }).click();
  assert.equal((await deniedResponse).status(), 403);
  await expect(deniedPicker.getByRole("alert")).toHaveText("当前账号没有商品读取权限，请联系管理员。");
  assert.equal(await deniedPicker.getByRole("button", { name: /^选择商品 / }).count(), 0);
  console.log("PASS: WMS product search preserves Product Center read permission");
  await tab(page, "仓库");
  await page.getByRole("button", { name: "新建仓库", exact: true }).click();
  await page.getByLabel("仓库编码", { exact: true }).fill("PAGE");
  await page.getByLabel("仓库名称", { exact: true }).fill("页面验收仓");
  const warehouse = await post(page, "warehouses", page.getByRole("button", { name: "创建", exact: true }));
  await tab(page, "区域");
  await page.getByRole("button", { name: "新建区域", exact: true }).click();
  await page.getByLabel("所属仓库").selectOption(warehouse.id);
  await page.getByLabel("区域编码", { exact: true }).fill("PAGE-A");
  await page.getByLabel("区域名称", { exact: true }).fill("验收区域");
  const area = await post(page, "areas", page.getByRole("button", { name: "创建", exact: true }));
  const disableArea = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/wms/areas") && response.request().method() === "PATCH");
  await row(page, area.id).getByRole("button", { name: "停用", exact: true }).click();
  assert.equal((await disableArea).status(), 200);
  await expect(row(page, area.id).getByText("停用", { exact: true })).toBeVisible();
  const enableArea = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/wms/areas") && response.request().method() === "PATCH");
  await row(page, area.id).getByRole("button", { name: "启用", exact: true }).click();
  assert.equal((await enableArea).status(), 200);
  await expect(row(page, area.id).getByText("启用", { exact: true })).toBeVisible();
  async function location(code: string, kind: string) {
    await tab(page, "库位");
    await page.getByRole("button", { name: "新建库位", exact: true }).click();
    await page.getByLabel("所属区域").selectOption(area.id);
    await page.getByLabel("库位编码", { exact: true }).fill(code);
    await page.getByRole("combobox", { name: /^类型/ }).selectOption(kind);
    return post(page, "locations", page.getByRole("button", { name: "创建", exact: true }));
  }
  const receiving = await location("PAGE-R", "RECEIVING");
  const storage = await location("PAGE-S", "STORAGE");
  await prisma.productRecord.createMany({ data: Array.from({ length: 21 }, (_, index) => ({ id: `wms-pick-${index}`, organizationId: "wms-org", workspaceId: "default", userId: "operator", sku: `WMS-PICK-${String(index).padStart(2, "0")}`, payload: { chineseName: "合成商品选择验收" } })) });
  await prisma.productRecord.create({ data: { id: "wms-pick-other", organizationId: "wms-org", workspaceId: "page-other", userId: "operator", sku: "WMS-PICK-FOREIGN", payload: {} } });
  await tab(page, "商品批次");
  await page.getByRole("button", { name: "新建批次", exact: true }).click();
  const picker = page.getByRole("group", { name: "选择商品主档", exact: true });
  async function searchProduct(keyword: string) {
    await picker.getByLabel("SKU／商品名称", { exact: true }).fill(keyword);
    const result = page.waitForResponse(response => new URL(response.url()).pathname === "/api/products" && new URL(response.url()).searchParams.get("search") === keyword);
    await picker.getByRole("button", { name: "搜索商品", exact: true }).click();
    assert.equal((await result).status(), 200);
    await expect(picker.getByText("正在读取商品…")).toHaveCount(0);
  }
  await searchProduct("WMS-PICK");
  assert.equal(await picker.getByRole("button", { name: /^选择商品 / }).count(), 20);
  assert.equal(await picker.getByRole("button", { name: "选择商品 WMS-PICK-FOREIGN", exact: true }).count(), 0);
  const productPage = page.waitForResponse(response => new URL(response.url()).pathname === "/api/products" && new URL(response.url()).searchParams.get("page") === "2");
  await picker.getByRole("button", { name: "下一页商品", exact: true }).click();
  assert.equal((await productPage).status(), 200);
  await expect(picker.getByRole("button", { name: /^选择商品 / })).toHaveCount(1);
  await searchProduct("NO-SUCH-WMS-PRODUCT");
  await expect(picker.getByText("未找到商品，请调整关键词或先到商品中心创建。")).toBeVisible();
  await searchProduct("SYNTHETIC");
  await picker.getByRole("button", { name: "选择商品 SYNTHETIC", exact: true }).click();
  await expect(page.getByRole("form", { name: "创建商品批次", exact: true }).getByLabel("商品主档 ID", { exact: true })).toHaveValue("fixture-product");
  console.log("PASS: product picker searches existing ERP products, paginates, handles empty results and excludes other workspaces");
  await page.getByLabel("批次编码", { exact: true }).fill("PAGE-LOT");
  await page.getByLabel("条码", { exact: true }).fill("000-PAGE-LOT");
  const lot = await post(page, "lots", page.getByRole("button", { name: "创建批次", exact: true }));
  await page.getByRole("button", { name: "新建批次", exact: true }).click();
  await searchProduct("SYNTHETIC");
  await picker.getByRole("button", { name: "选择商品 SYNTHETIC", exact: true }).click();
  await page.getByLabel("批次编码", { exact: true }).fill("PAGE-LOT-PENDING");
  const pendingLot = await post(page, "lots", page.getByRole("button", { name: "创建批次", exact: true }));
  // Put valid choices beyond a full page of earlier synthetic records.
  await prisma.wmsLocation.createMany({ data: Array.from({ length: 100 }, (_, index) => ({ id: `option-location-${index}`, organizationId: "wms-org", workspaceId: "default", warehouseId: warehouse.id, areaId: area.id, code: `OLD-${index}`, kind: "STORAGE", enabled: false, createdAt: new Date("2000-01-01") })) });
  await prisma.wmsLot.createMany({ data: Array.from({ length: 100 }, (_, index) => ({ id: `option-lot-${index}`, organizationId: "wms-org", workspaceId: "default", productRecordId: "fixture-product", lotCode: `OLD-${index}`, createdAt: new Date("2000-01-01") })) });
  await tab(page, "收货单");
  await page.getByRole("button", { name: "新建收货单", exact: true }).click();
  await page.getByLabel("收货单号", { exact: true }).fill("PAGE-RCV");
  await page.getByRole("button", { name: "加载更多收货库位", exact: true }).click();
  await page.getByLabel("收货库位").selectOption(receiving.id);
  await expect(page.getByRole("button", { name: "加载更多商品批次", exact: true })).toBeVisible();
  await page.route("**/api/operations/wms/lots?**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "合成选项读取失败" }) }), { times: 1 });
  await page.getByRole("button", { name: "加载更多商品批次", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "合成选项读取失败" })).toHaveText("合成选项读取失败");
  await page.getByRole("button", { name: "重试商品批次", exact: true }).click();
  await page.getByLabel("商品批次").selectOption(lot.id);
  await page.getByLabel("计划数量", { exact: true }).fill("10");
  await page.getByRole("button", { name: "添加商品明细" }).click();
  await page.getByLabel("商品批次").nth(1).selectOption(pendingLot.id);
  await page.getByLabel("计划数量", { exact: true }).nth(1).fill("1");
  await expect(page.getByLabel("收货库位")).toHaveValue(receiving.id);
  console.log("PASS: receipt selects locations/lots beyond 100 records; failed next-page load retries without losing the selected location");
  const receipt = await post(page, "receipts", page.getByRole("button", { name: "创建收货单", exact: true }));
  async function receiptDetails(expected: Record<string, Record<string, number>>) {
    await tab(page, "收货单");
    const details = row(page, receipt.id).locator("details");
    if (!await details.getAttribute("open").then(value => value !== null)) await details.locator("summary").click();
    await expect(details.getByRole("table", { name: "收货批次数量", exact: true })).toBeVisible();
    await expect(details.getByText(`收货库位：${receiving.code}`, { exact: true })).toBeVisible();
    for (const batch of [lot, pendingLot]) {
      await expect(details.getByText(`批次：${batch.lotCode}`, { exact: true })).toBeVisible();
    }
    await expect(details.getByText(`条码：${lot.barcode}`, { exact: true })).toBeVisible();
    for (const line of receipt.lines as Array<{ id: string; lotId: string }>) {
      const quantities = expected[line.lotId];
      for (const [key, value] of Object.entries(quantities)) await expect(details.locator(`[data-receipt-line="${line.id}"] [data-quantity="${key}"]`)).toHaveText(String(value));
    }
  }
  await receiptDetails({ [lot.id]: { expectedQty: 10, receivedQty: 0, pendingQc: 0, pendingPutaway: 0 }, [pendingLot.id]: { expectedQty: 1, receivedQty: 0 } });
  await row(page, receipt.id).getByRole("button", { name: `收货单详情 ${receipt.number}`, exact: true }).click();
  const receiptDetail = page.getByRole("dialog", { name: `收货单详情 · ${receipt.number}`, exact: true });
  await expect(receiptDetail.getByRole("region", { name: "收货单信息", exact: true })).toContainText(receipt.number);
  await expect(receiptDetail.getByRole("region", { name: "入库商品", exact: true }).getByRole("table", { name: "收货批次数量", exact: true })).toContainText("PAGE-LOT");
  await expect(receiptDetail).toContainText(receiving.code);
  await page.keyboard.press("Escape");
  await expect(receiptDetail).not.toBeVisible();
  const createdDraft = await page.evaluate(async ({ receivingLocationId, lotId }) => {
    const response = await fetch("/api/operations/wms/receipts", { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": "default" }, body: JSON.stringify({ number: "PAGE-CANCEL-RCV", receivingLocationId, lines: [{ lotId, expectedQty: 1 }] }) });
    return { status: response.status, body: await response.json() };
  }, { receivingLocationId: receiving.id, lotId: lot.id });
  assert.equal(createdDraft.status, 201, JSON.stringify(createdDraft.body));
  const cancellable = createdDraft.body.item;
  await tab(page, "收货单");
  await row(page, cancellable.id).getByRole("button", { name: "编辑草稿", exact: true }).click();
  const editor = page.getByRole("form", { name: "编辑收货草稿", exact: true });
  await expect(editor.getByText(`批次：${lot.lotCode}`, { exact: true })).toBeVisible();
  await expect(editor.getByText(`条码：${lot.barcode}`, { exact: true })).toBeVisible();
  await editor.getByLabel(`${lot.id} 计划数量`, { exact: true }).fill("2");
  const saved = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/wms/receipts") && response.request().method() === "PATCH");
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  assert.equal((await saved).status(), 200);
  await expect(editor).toHaveCount(0);
  const editedDraft = await prisma.wmsReceipt.findUniqueOrThrow({ where: { id: cancellable.id }, include: { lines: true } });
  assert.equal(editedDraft.lines[0].expectedQty, 2);assert.equal(editedDraft.revision, 2);
  await tab(page, "收货单");
  console.log("PASS: receipt creator edits draft quantity from page and saves a new revision before cancellation");
  page.once("dialog", dialog => dialog.accept());
  const cancellation = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/wms/commands") && response.request().method() === "POST");
  await row(page, cancellable.id).getByRole("button", { name: "取消草稿", exact: true }).click();
  const cancellationResponse = await cancellation;
  assert.equal(cancellationResponse.status(), 200);
  await tab(page, "收货单");
  await expect(row(page, cancellable.id).getByText("CANCELLED", { exact: true })).toBeVisible();
  console.log("PASS: receipt draft can be cancelled from its row and the cancelled state is readable");
  async function receiptAction(name: string, quantity: number, rejected?: number) {
    await tab(page, "收货单");
    if (name === "退回拒收品") await page.getByRole("button", { name: "PAGE-RCV · 退回 2 件", exact: true }).click();
    else await row(page, receipt.id).getByRole("button", { name, exact: true }).click();
    const form = page.getByRole("form", { name: `${name}作业`, exact: true });
    await expect(form.getByText(`批次：${lot.lotCode}`, { exact: true })).toBeVisible();
    await expect(form.getByText(`条码：${lot.barcode}`, { exact: true })).toBeVisible();
    await expect(form.getByText(`批次：${pendingLot.lotCode}`, { exact: true })).toBeVisible();
    await form.getByRole("spinbutton", { name: `${lot.id} 数量`, exact: true }).fill(String(quantity));
    if (rejected !== undefined) await form.getByRole("spinbutton", { name: `${lot.id} 拒收数量`, exact: true }).fill(String(rejected));
    await form.getByRole("spinbutton", { name: `${pendingLot.id} 数量`, exact: true }).fill(name === "收货" ? "1" : "0");
    if (name === "上架") {
      await form.getByRole("button", { name: "加载更多上架库位", exact: true }).click();
      const pendingRow = form.getByRole("row").filter({ has: page.getByRole("spinbutton", { name: `${pendingLot.id} 数量`, exact: true }) });
      const selectedRow = form.getByRole("row").filter({ has: page.getByRole("spinbutton", { name: `${lot.id} 数量`, exact: true }) });
      await expect(pendingRow.getByRole("combobox")).toBeDisabled();
      await selectedRow.getByRole("combobox").selectOption(storage.id);
    }
    let lostApprovalId: string | undefined;
    let lostBody: string | null = null;
    if (name === "收货") {
      // Persist the actual request, then simulate losing its HTTP response.
      await page.route(base + "/api/operations/wms/approvals", async route => {
        lostBody = route.request().postData();
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        lostApprovalId = (await response.json()).item.id;
        await route.abort("failed");
      }, { times: 1 });
      await form.getByRole("button", { name: "提交审批申请" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
    }
    const approval = await post(page, "approvals", form.getByRole("button", { name: "提交审批申请" }));
    if (lostApprovalId) {
      assert.equal(approval.id, lostApprovalId);
      const saved = await prisma.wmsApproval.findUniqueOrThrow({ where: { id: approval.id } });
      assert.equal((saved.request as { idempotencyKey: string }).idempotencyKey, JSON.parse(lostBody!).idempotencyKey);
      assert.equal(await prisma.wmsApproval.count({ where: { aggregateId: receipt.id, action: "RECEIVE" } }), 1);
      console.log("PASS: lost approval response retries the same command and returns the original approval");
    }
    await approveAndExecute(approval.id);
  }
  await receiptAction("收货", 10);
  // Partial inspection exposes putaway immediately, while the rest remains pending QC.
  await receiptAction("质检", 5, 0);
  await receiptAction("上架", 5);
  await receiptDetails({ [lot.id]: { receivedQty: 10, acceptedQty: 5, putawayQty: 5, pendingQc: 5, pendingPutaway: 0 }, [pendingLot.id]: { receivedQty: 1, pendingQc: 1, pendingPutaway: 0 } });
  await receiptAction("质检", 3, 2);
  await receiptAction("上架", 3);
  await receiptDetails({ [lot.id]: { expectedQty: 10, receivedQty: 10, acceptedQty: 8, rejectedQty: 2, putawayQty: 8, returnedQty: 0, pendingQc: 0, pendingPutaway: 0 }, [pendingLot.id]: { receivedQty: 1, acceptedQty: 0, pendingQc: 1, pendingPutaway: 0 } });
  await receiptAction("退回拒收品", 2);
  await receiptDetails({ [lot.id]: { rejectedQty: 2, returnedQty: 2 }, [pendingLot.id]: { receivedQty: 1, returnedQty: 0 } });
  console.log("PASS: receipt details display draft, partially inspected/putaway and final per-lot quantities without treating pending stock as available");
  const pending = await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: receiving.id, lotId: pendingLot.id } });
  assert.equal(pending.onHand, 1); assert.equal(pending.pendingQc, 1); assert.equal(pending.pendingPutaway, 0);
  console.log("PASS: multi-line partial inspection and putaway use storage locations beyond 100 records and leave unselected batch pending QC");
  await tab(page, "库存余额");
  const storageBalance = await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: storage.id, lotId: lot.id } });
  await row(page, storageBalance.id).getByRole("button", { name: "预占", exact: true }).click();
  let form = page.getByRole("form", { name: "预占作业", exact: true });
  for (const target of [row(page, storageBalance.id).locator('[data-column="stock"]'), form]) {
    for (const text of [`仓库：${warehouse.code} · ${warehouse.name}`, `库位：${storage.code}`, `批次：${lot.lotCode}`, `条码：${lot.barcode}`]) await expect(target.getByText(text, { exact: true })).toBeVisible();
  }
  await form.getByLabel("预占单号", { exact: true }).fill("PAGE-RSV");
  await form.getByLabel("预占数量", { exact: true }).fill("6");
  const reserveApproval = await post(page, "approvals", form.getByRole("button", { name: "申请预占", exact: true }));
  const reservation = await approveAndExecute(reserveApproval.id);
  async function reservationAction(name: string, quantity: number, approvalRequired: boolean) {
    await tab(page, "预占与出库");
    await row(page, reservation.aggregateId).getByRole("button", { name, exact: true }).click();
    form = page.getByRole("form", { name: `${name}作业`, exact: true });
    for(const text of ["仓库：PAGE · 页面验收仓", "库位：PAGE-S", "批次：PAGE-LOT", "条码：000-PAGE-LOT"]) await expect(form.getByText(text, { exact: true })).toBeVisible();
    await form.getByLabel(`${name}数量`, { exact: true }).fill(String(quantity));
    const result = await post(page, approvalRequired ? "approvals" : "commands", form.getByRole("button", { name: `${approvalRequired ? "申请" : "确认"}${name}`, exact: true }));
    if (approvalRequired) await approveAndExecute(result.id);
  }
  await tab(page, "预占与出库");
  await page.getByLabel("条码（精确）", { exact: true }).fill("UNKNOWN-PICK-BARCODE");
  let pickScan = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/reservations") && url.searchParams.get("barcode") === "UNKNOWN-PICK-BARCODE"; });
  await page.getByLabel("条码（精确）", { exact: true }).press("Enter");
  assert.equal((await pickScan).status(), 200);
  await expect(page.getByText("暂无记录", { exact: true })).toBeVisible();
  await page.getByLabel("条码（精确）", { exact: true }).fill("000-PAGE-LOT");
  pickScan = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/reservations") && url.searchParams.get("barcode") === "000-PAGE-LOT"; });
  await page.getByLabel("条码（精确）", { exact: true }).press("Enter");
  assert.equal((await pickScan).status(), 200);
  await page.getByLabel("预占作业状态", { exact: true }).selectOption("AWAITING_PICK");
  await expect(row(page, reservation.aggregateId)).toBeVisible();
  await expect(row(page, reservation.aggregateId).locator('td[data-column="workflowStatus"]')).toHaveText("待拣货");
  const pickLocation = row(page, reservation.aggregateId).locator('td[data-column="stock"]');
  for(const text of ["仓库：PAGE · 页面验收仓", "库位：PAGE-S", "批次：PAGE-LOT", "条码：000-PAGE-LOT"]) await expect(pickLocation.getByText(text, { exact: true })).toBeVisible();
  await page.getByLabel("预占作业状态", { exact: true }).selectOption("AWAITING_DISPATCH");
  await expect(row(page, reservation.aggregateId)).toHaveCount(0);
  await page.getByLabel("预占作业状态", { exact: true }).selectOption("");
  await reservationAction("拣货", 5, false);
  await page.getByLabel("预占作业状态", { exact: true }).selectOption("PARTIALLY_PICKED");
  await expect(row(page, reservation.aggregateId)).toBeVisible();
  await expect(row(page, reservation.aggregateId).locator('td[data-column="unpickedQty"]')).toHaveText("1");
  await page.getByLabel("预占作业状态", { exact: true }).selectOption("");
  await reservationAction("取消拣货", 1, false);
  await reservationAction("出库", 4, true);
  await reservationAction("释放预占", 2, true);
  await tab(page, "预占与出库");
  assert.equal(await row(page, reservation.aggregateId).getByRole("button", { name: "出库", exact: true }).isDisabled(), true);
  assert.equal(await row(page, reservation.aggregateId).getByRole("button", { name: "释放预占", exact: true }).isDisabled(), true);
  const final = await prisma.wmsStockBalance.findMany({ where: { warehouseId: warehouse.id, lotId: lot.id } });
  assert.equal(final.find(balance => balance.locationId === storage.id)!.onHand, 4);
  assert.equal(final.find(balance => balance.locationId === storage.id)!.reserved, 0);
  assert.equal(final.find(balance => balance.locationId === receiving.id)!.onHand, 0);
  assert.equal(final.find(balance => balance.locationId === receiving.id)!.rejected, 0);
  const document = await prisma.wmsReservation.findUniqueOrThrow({ where: { id: reservation.aggregateId } });
  assert.equal(document.pickedQty, 0); assert.equal(document.dispatchedQty, 4); assert.equal(document.releasedQty, 2);
  const transferTarget = await location("PAGE-S2", "STORAGE");
  await tab(page, "库存余额");
  const transferSource = await prisma.wmsStockBalance.findFirstOrThrow({ where: { locationId: storage.id, lotId: lot.id } });
  await row(page, transferSource.id).getByRole("button", { name: "调拨", exact: true }).click();
  form = page.getByRole("form", { name: "调拨作业", exact: true });
  await expect(form.getByText(`批次：${lot.lotCode}`, { exact: true })).toBeVisible();
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "加载更多存储库位", exact: true }).click();
  await form.getByLabel("目标存储库位", { exact: true }).selectOption(transferTarget.id);
  await form.getByLabel("调拨数量", { exact: true }).fill("1");
  const transferApproval = await post(page, "approvals", form.getByRole("button", { name: "申请调拨", exact: true }));
  const transfer = await approveAndExecute(transferApproval.id);
  assert.equal(transfer.movementIds.length, 2);
  const transferred = await prisma.wmsStockBalance.findMany({ where: { warehouseId: warehouse.id, lotId: lot.id } });
  assert.equal(transferred.find(balance => balance.locationId === storage.id)!.onHand, 3);
  assert.equal(transferred.find(balance => balance.locationId === transferTarget.id)!.onHand, 1);
  const transferMovements = await prisma.wmsMovement.findMany({ where: { commandId: transfer.commandId }, orderBy: { sequence: "asc" } });
  assert.equal(transferMovements.length, 2);
  assert.deepEqual(transferMovements.map(movement => movement.deltaOnHand), [-1, 1]);
  await tab(page, "调拨流水");
  await page.getByLabel("调拨命令 ID", { exact: true }).fill(transfer.commandId);
  const transferHistoryResponse = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/transfers") && url.searchParams.get("sourceId") === transfer.commandId; });
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  assert.equal((await transferHistoryResponse).status(), 200);
  await expect(page.locator("tr[data-record-id]")).toHaveCount(2);
  assert.deepEqual((await page.locator('td[data-column="deltaOnHand"]').allTextContents()).sort((a, b) => Number(a) - Number(b)), ["-1", "1"]);
  const transferHistoryIds = await page.locator("tr[data-record-id]").evaluateAll(rows => rows.map(row => row.getAttribute("data-record-id")));
  assert.deepEqual(transferHistoryIds.sort(), transferMovements.map(movement => movement.id).sort());
  await expect(page.getByRole("columnheader", { name: "库位与批次", exact: true })).toBeVisible();
  console.log("PASS: transfer history route filters by command and renders both immutable source and destination movements");
  await tab(page, "库存余额");
  await expect(row(page, transferSource.id).locator('[data-column="onHand"]')).toHaveText("3");
  await expect(row(page, transferSource.id).locator('[data-column="available"]')).toHaveText("3");
  await expect(row(page, transfer.targetBalanceId)).toBeVisible();
  console.log("PASS: warehouse page selects a paged transfer target, displays its destination for the second approver, and refreshes both balances");
  await page.getByText("按单据编号作业", { exact: true }).click();
  const numbered = page.getByRole("form", { name: "按编号库存作业", exact: true });
  await numbered.getByLabel("动作", { exact: true }).selectOption("TRANSFER");
  const returnBalance = transferred.find(balance => balance.locationId === transferTarget.id)!;
  await numbered.getByLabel("余额 ID", { exact: true }).fill(returnBalance.id);
  await numbered.getByLabel("当前版本", { exact: true }).fill(String(returnBalance.revision));
  await numbered.getByLabel("目标存储库位 ID", { exact: true }).fill(storage.id);
  await numbered.getByLabel("数量", { exact: true }).fill("1");
  let lostNumberedApproval: string | undefined;
  await page.route(base + "/api/operations/wms/approvals", async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    lostNumberedApproval = (await response.json()).item.id;
    await route.abort("failed");
  }, { times: 1 });
  await numbered.getByRole("button", { name: "提交作业", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
  const retriedNumbered = await post(page, "approvals", numbered.getByRole("button", { name: "提交作业", exact: true }));
  assert.equal(retriedNumbered.id, lostNumberedApproval);
  await expect(numbered.getByRole("button", { name: "提交作业", exact: true })).toBeEnabled();
  const repeatedNumbered = await post(page, "approvals", numbered.getByRole("button", { name: "提交作业", exact: true }));
  assert.equal(repeatedNumbered.id, retriedNumbered.id);
  assert.equal(await prisma.wmsApproval.count({ where: { aggregateId: returnBalance.id, action: "TRANSFER" } }), 1);
  await approveAndExecute(retriedNumbered.id);
  assert.equal((await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: returnBalance.id } })).onHand, 0);
  assert.equal((await prisma.wmsStockBalance.findUniqueOrThrow({ where: { id: transferSource.id } })).onHand, 4);
  console.log("PASS: numbered transfer survives a lost response and repeated submit with one approval and one stock mutation");
  await tab(page, "库存余额");
  // Switching scope must close an open stock action and keep both reads and writes scoped.
  await row(page, storageBalance.id).getByRole("button", { name: "预占", exact: true }).click();
  async function switchWorkspace(id: string, resource: string) {
    const response = page.waitForResponse(async response => new URL(response.url()).pathname.endsWith(`/wms/${resource}`) && response.request().method() === "GET" && (await response.request().allHeaders())["x-workspace-id"] === id);
    const [scopedResponse] = await Promise.all([response, page.getByTitle("选择工作区", { exact: true }).selectOption(id)]);
    assert.equal(scopedResponse.status(), 200);
    await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled({ timeout: 20000 });
  }
  await switchWorkspace("page-other", "warehouses");
  assert.equal(await page.getByRole("form", { name: "预占作业", exact: true }).count(), 0);
  assert.equal(await row(page, storageBalance.id).count(), 0);
  await tab(page, "仓库");
  await page.getByRole("button", { name: "新建仓库", exact: true }).click();
  await page.getByLabel("仓库编码", { exact: true }).fill("OTHER");
  await page.getByLabel("仓库名称", { exact: true }).fill("第二工作区验收仓");
  const other = await post(page, "warehouses", page.getByRole("button", { name: "创建", exact: true }));
  assert.equal(other.workspaceId, "page-other");
  await switchWorkspace("default", "warehouses");
  await row(page, warehouse.id).waitFor();
  assert.equal(await row(page, other.id).count(), 0);
  console.log("PASS: workspace switching closes stale stock forms and scopes both page reads and writes");
  // Synthetic page volume exercises actual three-page backward navigation.
  await prisma.wmsWarehouse.createMany({ data: Array.from({ length: 65 }, (_, index) => ({ id: `page-pagination-${index}`, organizationId: "wms-org", workspaceId: "default", code: `PAGINATION-${index}`, name: "Synthetic pagination fixture" })) });
  await tab(page, "仓库");
  const visibleIds = () => page.locator("tr[data-record-id]").evaluateAll(rows => rows.map(row => row.getAttribute("data-record-id")));
  async function move(name: string) {
    const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/wms/warehouses") && response.request().method() === "GET");
    await page.getByRole("button", { name, exact: true }).click();
    assert.equal((await response).status(), 200);
    await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled({ timeout: 20000 });
  }
  const first = await visibleIds();
  await move("下一页"); const second = await visibleIds();
  await move("下一页"); const third = await visibleIds();
  assert.notDeepEqual(first, second); assert.notDeepEqual(second, third);
  await move("上一页"); assert.deepEqual(await visibleIds(), second);
  await move("上一页"); assert.deepEqual(await visibleIds(), first);
  assert.equal(await page.getByRole("button", { name: "上一页", exact: true }).isDisabled(), true);
  console.log("PASS: three-page forward/backward navigation returns the correct prior page");
  await tab(page, "区域");
  const blockedDisable = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/wms/areas") && response.request().method() === "PATCH");
  await row(page, area.id).getByRole("button", { name: "停用", exact: true }).click();
  assert.equal((await blockedDisable).status(), 409);
  await expect(page.getByText("该范围仍有库存或预留数量，不能停用。", { exact: true })).toBeVisible();
  console.log("PASS: area with remaining physical stock cannot be disabled");
  await tab(page, "库存余额");
  await expect(page.getByRole("columnheader", { name: "可用数量", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "拒收数量", exact: true })).toBeVisible();
  async function related(resource: string, key: string, id: string, button: Locator) {
    const pending = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith(`/wms/${resource}`) && url.searchParams.get(key) === id && response.request().method() === "GET"; });
    await button.click();
    const response = await pending;assert.equal(response.status(), 200);
    const data = await response.json();assert.ok(data.items.length > 0);
    for (const item of data.items) assert.equal(item[key], id);
    await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
    await expect(page.locator("tr[data-record-id]")).toHaveCount(data.items.length);
  }
  await related("movements", "balanceId", storageBalance.id, row(page, storageBalance.id).getByRole("button", { name: "查看流水", exact: true }));
  for (const name of ["待质检变化", "待上架变化", "拒收变化"]) await expect(page.getByRole("columnheader", { name, exact: true })).toBeVisible();
  for (const cell of await page.locator('td[data-column="stock"]').all()) {
    await expect(cell.getByText(`库位：${storage.code}`, { exact: true })).toBeVisible();
    await expect(cell.getByText(`批次：${lot.lotCode}`, { exact: true })).toBeVisible();
  }
  await tab(page, "库存余额");
  await related("reservations", "balanceId", storageBalance.id, row(page, storageBalance.id).getByRole("button", { name: "查看预占", exact: true }));
  await related("movements", "sourceId", reservation.aggregateId, row(page, reservation.aggregateId).getByRole("button", { name: "查看流水", exact: true }));
  await tab(page, "收货单");
  await related("movements", "sourceId", receipt.id, row(page, receipt.id).getByRole("button", { name: "查看流水", exact: true }));
  for (const [name, id] of [["收货单", receipt.id], ["库存余额", storageBalance.id], ["预占与出库", reservation.aggregateId]]) {
    await tab(page, name);
    await related("approvals", "aggregateId", id, row(page, id).getByRole("button", { name: "查看审批", exact: true }));
    await expect(page.getByLabel("业务单据 ID", { exact: true })).toHaveValue(id);
    await page.getByLabel("业务单据 ID", { exact: true }).fill("NO-SUCH-APPROVAL-TARGET");
    const empty = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/approvals") && url.searchParams.get("aggregateId") === "NO-SUCH-APPROVAL-TARGET"; });
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    assert.equal((await empty).status(), 200);
    await expect(page.getByText("暂无记录", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "清除", exact: true }).click();
    await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
  }
  console.log("PASS: receipt, balance and reservation rows open only their approvals; exact target input and clear work");
  console.log("PASS: balance, reservation and receipt rows open scoped related queries and render only matching movement/reservation records");
  await tab(page, "商品批次");
  await page.getByLabel("条码（精确）", { exact: true }).fill("NO-SUCH-BARCODE");
  let barcodeResponse = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/lots") && url.searchParams.get("barcode") === "NO-SUCH-BARCODE"; });
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  assert.equal((await barcodeResponse).status(), 200);
  await expect(page.getByText("暂无记录", { exact: true })).toBeVisible();
  await page.getByLabel("条码（精确）", { exact: true }).fill("000-PAGE-LOT");
  barcodeResponse = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/lots") && url.searchParams.get("barcode") === "000-PAGE-LOT"; });
  await page.getByLabel("条码（精确）", { exact: true }).press("Enter");
  assert.equal((await barcodeResponse).status(), 200);
  await expect(page.locator("tr[data-record-id]")).toHaveCount(1);
  await expect(row(page, lot.id)).toBeVisible();
  await related("balances", "lotId", lot.id, row(page, lot.id).getByRole("button", { name: "查看库存", exact: true }));
  await expect(row(page, storageBalance.id)).toBeVisible();
  for (const [name, resource] of [["库存余额", "balances"], ["库存流水", "movements"], ["库存核对", "reconciliation"]]) {
    await tab(page, name);
    await page.getByRole("button", { name: "清除", exact: true }).click();
    await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
    await page.getByLabel("条码（精确）", { exact: true }).fill("NO-SUCH-BARCODE");
    const empty = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith(`/wms/${resource}`) && url.searchParams.get("barcode") === "NO-SUCH-BARCODE"; });
    await page.getByLabel("条码（精确）", { exact: true }).press("Enter");
    assert.equal((await empty).status(), 200);
    await expect(page.getByText("暂无记录", { exact: true })).toBeVisible();
    await page.getByLabel("条码（精确）", { exact: true }).fill("000-PAGE-LOT");
    const scanned = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith(`/wms/${resource}`) && url.searchParams.get("barcode") === "000-PAGE-LOT"; });
    await page.getByLabel("条码（精确）", { exact: true }).press("Enter");
    const response = await scanned;assert.equal(response.status(), 200);
    const data = await response.json();assert.ok(data.items.length > 0);
    if (resource === "movements") {
      const balances = await prisma.wmsStockBalance.findMany({ where: { warehouseId: warehouse.id, lotId: lot.id } });
      for (const item of data.items) assert.ok(balances.some(balance => balance.id === item.balanceId));
    } else for (const item of data.items) assert.equal(item.lotId, lot.id);
    await expect(page.locator("tr[data-record-id]")).toHaveCount(data.items.length);
  }
  console.log("PASS: Enter scans an exact barcode directly in stock, movement and reconciliation pages and handles unknown codes");
  await tab(page, "库存核对");
  await expect(page.getByRole("columnheader", { name: "核对结果", exact: true })).toBeVisible();
  await expect(page.locator('td[data-column="reconciliationStatus"]').first()).toHaveText("一致");
  await expect(page.getByText("逐页核对余额与全部已入账流水的数量合计。结果只覆盖当前页；发现差异后需人工核查，不自动调整库存。", { exact: true })).toBeVisible();
  console.log("PASS: reconciliation page displays matching balances and clearly limits results to the current page");
  await tab(page, "收货单");
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
  await page.getByLabel("收货单号（精确）", { exact: true }).fill("PAGE-RCV");
  let documentResponse = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/receipts") && url.searchParams.get("number") === "PAGE-RCV"; });
  await page.getByLabel("收货单号（精确）", { exact: true }).press("Enter");
  assert.equal((await documentResponse).status(), 200);
  await expect(row(page, receipt.id)).toBeVisible();
  await expect(page.locator("tr[data-record-id]")).toHaveCount(1);
  for (const [value, visible] of [["PENDING_QC", true], ["HAS_REJECTED", false], ["PENDING_PUTAWAY", false], ["SHORT_RECEIVED", false]] as const) {
    const queued = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/receipts") && url.searchParams.get("workflowStatus") === value; });
    await page.getByLabel("收货作业", { exact: true }).selectOption(value);
    assert.equal((await queued).status(), 200);
    if (visible) await expect(row(page, receipt.id)).toBeVisible();
    else await expect(page.getByText("暂无记录", { exact: true })).toBeVisible();
  }
  const clearedQueue = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/receipts") && !url.searchParams.get("workflowStatus") && url.searchParams.get("number") === "PAGE-RCV"; });
  await page.getByLabel("收货作业", { exact: true }).selectOption("");
  assert.equal((await clearedQueue).status(), 200);
  await expect(row(page, receipt.id)).toBeVisible();
  console.log("PASS: receipt page combines exact document search with pending QC/putaway, rejection and short-receipt work queues and clears the queue correctly");
  await page.getByLabel("条码（精确）", { exact: true }).fill(lot.barcode);
  const scanReceipt = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/receipts") && url.searchParams.get("barcode") === lot.barcode; });
  await page.getByLabel("条码（精确）", { exact: true }).press("Enter");
  assert.equal((await scanReceipt).status(),200);
  await expect(row(page,receipt.id)).toBeVisible();
  const scanQc = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/receipts") && url.searchParams.get("barcode") === lot.barcode && url.searchParams.get("workflowStatus") === "PENDING_QC"; });
  await page.getByLabel("收货作业", { exact: true }).selectOption("PENDING_QC");
  assert.equal((await scanQc).status(),200);
  await expect(page.getByText("暂无记录", { exact: true })).toBeVisible();
  await page.getByLabel("条码（精确）", { exact: true }).fill("");
  await page.getByLabel("批次编码（精确）", { exact: true }).fill(pendingLot.lotCode);
  const scanPending = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/receipts") && url.searchParams.get("lotCode") === pendingLot.lotCode && url.searchParams.get("workflowStatus") === "PENDING_QC"; });
  await page.getByLabel("批次编码（精确）", { exact: true }).press("Enter");
  assert.equal((await scanPending).status(),200);
  await expect(row(page,receipt.id)).toBeVisible();
  await page.getByLabel("批次编码（精确）", { exact: true }).fill("UNKNOWN-BATCH");
  const unknownBatch = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/receipts") && url.searchParams.get("lotCode") === "UNKNOWN-BATCH"; });
  await page.getByLabel("批次编码（精确）", { exact: true }).press("Enter");
  assert.equal((await unknownBatch).status(),200);
  await expect(page.getByText("暂无记录", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(row(page,receipt.id)).toBeVisible();
  await expect(page.getByLabel("条码（精确）", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("批次编码（精确）", { exact: true })).toHaveValue("");
  await page.getByLabel("收货单号（精确）", { exact: true }).fill("PAGE-RCV");
  await page.getByLabel("收货单号（精确）", { exact: true }).press("Enter");
  await expect(row(page,receipt.id)).toBeVisible();
  console.log("PASS: receipt Enter scan combines barcode/lot with the same pending-QC line; unknown batches and clear work");
  documentResponse = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/receipts") && url.searchParams.get("status") === "DRAFT"; });
  await page.getByLabel("收货状态", { exact: true }).selectOption("DRAFT");
  assert.equal((await documentResponse).status(), 200);
  await expect(page.getByText("暂无记录", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(row(page, receipt.id)).toBeVisible();
  await tab(page, "预占与出库");
  await page.getByLabel("预占单号（精确）", { exact: true }).fill("PAGE-RSV");
  const reservationResponse = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname.endsWith("/wms/reservations") && url.searchParams.get("number") === "PAGE-RSV"; });
  await page.getByLabel("预占单号（精确）", { exact: true }).press("Enter");
  assert.equal((await reservationResponse).status(), 200);
  await expect(row(page, reservation.aggregateId)).toBeVisible();
  await expect(page.locator("tr[data-record-id]")).toHaveCount(1);
  const completedReservation = row(page, reservation.aggregateId);
  await expect(completedReservation.locator('td[data-column="workflowStatus"]')).toHaveText("已结束");
  await expect(completedReservation.locator('td[data-column="remainingQty"]')).toHaveText("0");
  await expect(completedReservation.locator('td[data-column="unpickedQty"]')).toHaveText("0");
  for (const name of ["拣货", "取消拣货", "出库", "释放预占"]) await expect(completedReservation.getByRole("button", { name, exact: true })).toBeDisabled();
  console.log("PASS: receipt number and state page filters locate a document, show empty combinations, clear correctly and find a reservation by number");
  console.log("PASS: barcode entry/Enter finds an exact batch beyond the first page, handles unknown codes and opens matching per-location stock");
  await tab(page, "盘点");
  const panel = page.getByRole("region", { name: "盘点作业", exact: true });
  await panel.locator("summary").filter({ hasText: "新建盘点单" }).click();
  await panel.getByLabel("盘点单号", { exact: true }).fill("PAGE-STOCKTAKE");
  await panel.getByLabel("盘点仓库", { exact: true }).selectOption(warehouse.id);
  await panel.getByRole("button", { name: "加载更多盘点库位", exact: true }).click();
  await panel.getByLabel("盘点库位（可多选）", { exact: true }).selectOption([storage.id]);
  const stocktake = await post(page, "stocktakes", panel.getByRole("button", { name: "创建盘点单", exact: true }));
  await post(page, "commands", panel.getByRole("button", { name: "开始盘点", exact: true }));
  const baselineLines = await prisma.wmsStocktakeLine.findMany({ where: { stocktakeId: stocktake.id }, include: { lot: true } });
  assert.ok(baselineLines.length);
  for (const [index, line] of baselineLines.entries()) {
    await panel.getByRole("spinbutton", { name: storage.code + "/" + line.lot.lotCode + "实盘", exact: true }).fill(String(line.baselineOnHand + (index === 0 ? 1 : 0)));
  }
  await post(page, "commands", panel.getByRole("button", { name: "保存实盘", exact: true }));
  await post(page, "commands", panel.getByRole("button", { name: "提交审核（以已保存实盘为准）", exact: true }));
  const countApproval = await post(page, "approvals", panel.getByRole("button", { name: "申请过账审批", exact: true }));
  await tab(page, "待审批");
  if (await page.getByRole("button", { name: "清除", exact: true }).isEnabled()) await page.getByRole("button", { name: "清除", exact: true }).click();
  await tab(supervisor, "待审批");
  if (await supervisor.getByRole("button", { name: "清除", exact: true }).isEnabled()) await supervisor.getByRole("button", { name: "清除", exact: true }).click();
  await approveAndExecute(countApproval.id);
  assert.equal((await prisma.wmsStocktake.findUniqueOrThrow({ where: { id: stocktake.id } })).status, "POSTED");
  const countMovements = await prisma.wmsMovement.findMany({ where: { sourceId: stocktake.id } });
  assert.equal(countMovements.length, 1);
  assert.equal(countMovements[0].deltaOnHand, 1);
  console.log("PASS: two browser sessions create/start/count/review/approve/post stocktake; authoritative state and one gain movement verified");
  await tab(page, "库存余额");
  console.log("PASS: two browser sessions create warehouse/area/locations/lots/receipt, receive10+1, inspect/putaway8, return rejected2, reserve6, pick5/unpick1, dispatch4/release2; final balances verified");
}
