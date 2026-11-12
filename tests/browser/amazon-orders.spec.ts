import { build } from "esbuild";
import { test, expect } from "@playwright/test";

let bundle = "", orderCatalogBundle = "";
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { OrdersWorkbench } from "./src/components/operations/orders-workbench"; createRoot(document.getElementById("root")).render(<OrdersWorkbench getHeaders={() => new Headers({"x-workspace-id":"fixture-workspace"})} onTask={id => { document.title = id; }} canConfigure={true} requestApproval={async command => (await fetch("/api/operations/sync-center", {method:"POST",headers:{"x-workspace-id":"fixture-workspace"},body:JSON.stringify(command)})).ok} openApprovals={() => { document.title = "approvals"; }} />);', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
  orderCatalogBundle = (await build({ stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { OrderItemsWorkbench } from "./src/components/operations/order-items-workbench"; import { AmazonProductsPanel } from "./src/components/operations/amazon-products-panel"; const headers = () => new Headers({"x-workspace-id":"fixture-workspace"}); const root = createRoot(document.getElementById("root")); root.render(new URLSearchParams(location.search).get("view") === "catalog" ? <AmazonProductsPanel headers={headers} /> : <OrderItemsWorkbench getHeaders={headers} onTask={() => {}} />);', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
});

test("order SKU opens the matching seller and Marketplace Amazon snapshot", async ({ page }) => {
  const catalogQueries: URL[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: orderCatalogBundle });
    if (url.pathname === "/api/operations/sync-center") return route.fulfill({ json: { rows: [{ amazonOrderId: "ORDER-1", sourceId: "source-1", sourceRunId: "run-1", sellerAccountId: "seller-7", marketplaceId: "ATVPDKIKX0DER", createdTime: "2026-11-01T00:00:00Z", sourceUpdatedAt: "2026-11-02T00:00:00Z", rawStatus: "Shipped", capturedAt: "2026-11-02T00:00:00Z", detailsUpdatedAt: "2026-11-02T00:00:00Z", items: [{ orderItemId: "item-1", asin: "B000000007", sellerSku: "SELLER-SKU-7", quantityOrdered: 2, proceedsOriginal: null, currencyCode: null }] }], sources: [{ id: "source-1", marketplaceId: "ATVPDKIKX0DER", detailsEnabled: true, detailsComplete: true }], pagination: { total: 1, pageCount: 1 } } });
    if (url.pathname === "/api/operations/products") {
      catalogQueries.push(url);
      return route.fulfill({ json: { rows: [{ sellerAccountId: "seller-7", marketplaceId: "ATVPDKIKX0DER", sellerSku: "SELLER-SKU-7", asin: "B000000007", listingStatus: "ACTIVE", available: 3, inbound: 0, reserved: 0, unfulfillable: 0, catalogUpdatedAt: null, inventoryUpdatedAt: null, inventoryRunId: null, freshness: "FRESH", fieldSources: {}, lastError: null }], hasNextPage: false } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225/operations?view=order-items");
  await page.getByRole("link", { name: "SELLER-SKU-7", exact: true }).click();
  await expect(page).toHaveURL(/view=catalog&sku=SELLER-SKU-7&sellerAccountId=seller-7&marketplaceId=ATVPDKIKX0DER/);
  await expect(page.getByLabel("按 Seller SKU 查询", { exact: true })).toHaveValue("SELLER-SKU-7");
  await expect(page.getByRole("cell", { name: "seller-7" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("cell", { name: "SELLER-SKU-7", exact: true })).toBeVisible();
  expect(catalogQueries.at(-1)?.searchParams.get("sellerAccountId")).toBe("seller-7");
  expect(catalogQueries.at(-1)?.searchParams.get("marketplaceId")).toBe("ATVPDKIKX0DER");
});

test("orders browser shows partial coverage, UTC, null states and pagination using local HTTP fixtures", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/api/operations/sync-center") {
      expect(route.request().method()).toBe("GET");
      expect(route.request().headers()["x-workspace-id"]).toBe("fixture-workspace");
      requests.push(url);
      const second = url.searchParams.get("page") === "2";
      return route.fulfill({ json: { rows: [{ amazonOrderId: second ? "fixture-order-2" : "fixture-order-1", sourceId: "fixture-source", sourceRunId: "fixture-task", marketplaceId: "fixture-marketplace", createdTime: "2026-10-31T20:00:00Z", sourceUpdatedAt: "2026-11-01T00:10:00Z", rawStatus: null, normalizedStatus: null, marketplaceTimeZone: "UTC" }], sources: [{ id: "fixture-source", enabled: true, marketplaceId: "fixture-marketplace", seller: { displayName: "Fixture store" }, resourceCursor: { watermarkFrom: "2026-11-01T00:00:00Z", watermarkTo: "2026-11-01T01:00:00Z", lastSuccessAt: null, status: "RUNNING" } }], pagination: { total: 51, pageCount: 2 } } });
    }
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await expect(page.getByText("窗口未完成", { exact: true })).toBeVisible();
  await expect(page.getByText("2026-10-31T20:00:00.000Z", { exact: true })).toBeVisible();
  await expect(page.getByText("未映射", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "订单下一页" }).click();
  await expect(page.getByRole("cell", { name: /^fixture-order-2/ })).toBeVisible();
  await page.getByRole("button", { name: "查看来源任务" }).click();
  await expect(page).toHaveTitle("fixture-task");
  expect(requests.some(url => url.searchParams.get("page") === "2")).toBe(true);
});

test("orders browser clears prior facts when access is denied and can reload an empty scope", async ({ page }) => {
  let denied = true;
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") return denied ? route.fulfill({ status: 403, json: { error: "fixture permission denied" } }) : route.fulfill({ json: { rows: [], sources: [], pagination: { total: 0, pageCount: 0 } } });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await expect(page.getByRole("alert")).toHaveText("fixture permission denied");
  await expect(page.getByRole("table")).toHaveCount(0);
  denied = false;
  await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByText(/当前范围没有已落库订单/)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("P2 browser distinguishes pending detail and displays exact money without PII", async ({ page }) => {
  let complete = false, proceedsRequested = true, moneyReturned = true;
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") return route.fulfill({ json: {
      rows: [{ amazonOrderId: "fixture-order-1", sourceId: "fixture-source", sourceRunId: "fixture-task", marketplaceId: "fixture-marketplace", createdTime: "2026-10-31T20:00:00Z", sourceUpdatedAt: "2026-11-01T00:10:00Z", rawStatus: "UNSHIPPED", normalizedStatus: "ready", marketplaceTimeZone: "UTC", detailsCurrent: complete, grandTotalOriginal: complete && moneyReturned ? "9007199254740993.123456789012345678901234567890" : null, currencyCode: complete && moneyReturned ? "XXX" : null }],
      sources: [{ id: "fixture-source", enabled: true, detailsEnabled: true, detailsComplete: complete, proceedsRequested, marketplaceId: "fixture-marketplace", seller: { displayName: "Fixture store" }, resourceCursor: { watermarkFrom: "2026-11-01T00:00:00Z", watermarkTo: "2026-11-01T01:00:00Z", listComplete: true, lastSuccessAt: complete ? "2026-11-05T00:00:00Z" : null, status: complete ? "SUCCEEDED" : "RUNNING" } }], pagination: { total: 1, pageCount: 1 }
    } });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await expect(page.getByText("列表已完成，详情待补齐", { exact: true })).toBeVisible();
  complete = true;
  await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByText("详情补齐完成", { exact: true })).toBeVisible();
  await expect(page.getByText("9007199254740993.123456789012345678901234567890 XXX", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: /^当前版本已补齐/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("fixture-private");
  proceedsRequested = false; moneyReturned = false;
  await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByText("当前未请求订单收入数据；商品明细完整不代表金额完整。", { exact: true })).toBeVisible();
  await expect(page.getByText("金额未返回", { exact: true })).toBeVisible();
  await expect(page.getByText("详情补齐完成", { exact: true })).toBeVisible();
});

test("orders history coverage distinguishes backlog, prior windows, unknown status and revoked access", async ({ page }) => {
  let mode: "unknown" | "deferred" | "checked" | "disabled" | "list-only" | "denied" = "unknown";
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") {
      expect(route.request().method()).toBe("GET");
      if (mode === "denied") return route.fulfill({ status: 403, json: { error: "fixture access revoked" } });
      return route.fulfill({ json: { rows: [], pagination: { total: 0, pageCount: 0 }, sources: [{
        id: "fixture-source", enabled: true, marketplaceId: "fixture-marketplace", seller: { displayName: "Fixture store" },
        detailsEnabled: mode !== "list-only", detailsComplete: mode === "deferred", proceedsRequested: false,
        historicalBackfillEnabled: mode !== "disabled", historicalBackfill: mode === "deferred" || mode === "checked" ? { selected: 7, deferred: mode === "deferred" } : null,
        historicalBackfillWindow: { from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" },
        resourceCursor: { watermarkFrom: "2026-11-01T00:00:00Z", watermarkTo: "2026-11-02T00:00:00Z", lastSuccessAt: null, status: mode === "deferred" ? "SUCCEEDED" : "RUNNING", listComplete: mode === "deferred" },
      }] } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await expect(page.getByText("尚无历史补采检查记录，完整性未知。", { exact: true })).toBeVisible();
  mode = "deferred";
  await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByText("最近窗口完整", { exact: true })).toBeVisible();
  await expect(page.getByText("上次成功窗口分配 7 笔历史明细；仍有积压，后续窗口使用剩余预算继续补齐。", { exact: true })).toBeVisible();
  await expect(page.getByText("补采记录所属窗口 2026-10-01T00:00:00.000Z — 2026-10-02T00:00:00.000Z", { exact: true })).toBeVisible();
  await expect(page.getByText("当前窗口完成不代表全历史完整。", { exact: true })).toBeVisible();
  mode = "checked";
  await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByText("窗口未完成", { exact: true })).toBeVisible();
  await expect(page.getByText("上次成功窗口分配 7 笔历史明细；该次检查未发现额外积压，不代表完整历史均已采集。", { exact: true })).toBeVisible();
  mode = "disabled";
  await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByText("当前未启用历史明细补采。", { exact: true })).toBeVisible();
  await expect(page.getByText(/上次成功窗口分配/)).toHaveCount(0);
  mode = "list-only";
  await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByText("仅列表，未启用详情", { exact: true })).toBeVisible();
  await expect(page.getByTestId("order-historical-backfill")).toHaveCount(0);
  mode = "denied";
  await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByRole("alert")).toHaveText("fixture access revoked");
  await expect(page.getByText("Fixture store", { exact: false })).toHaveCount(0);
  await expect(page.getByTestId("order-historical-backfill")).toHaveCount(0);
});


test("detail gap selection is sent to the server, resets paging and clears stale results on denial", async ({ page }) => {
  let denied = false;
  const requests: URL[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url()); expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") {
      expect(route.request().method()).toBe("GET"); requests.push(url);
      if (denied) return route.fulfill({ status: 403, json: { error: "fixture gap access revoked" } });
      const filtered = !!url.searchParams.get("detailsStatus");
      return route.fulfill({ json: { rows: [], sources: [], pagination: { total: filtered ? 7 : 51, pageCount: filtered ? 1 : 2 } } });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await page.getByRole("button", { name: "订单下一页" }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("page")).toBe("2");
  await page.getByLabel("明细状态", { exact: true }).selectOption("MISSING_OR_STALE");
  await expect(page.getByText(/当前筛选共 7 条已落库订单/)).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("detailsStatus")).toBe("MISSING_OR_STALE"); expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
  await page.getByLabel("明细状态", { exact: true }).selectOption("CURRENT");
  await expect.poll(() => requests.at(-1)?.searchParams.get("detailsStatus")).toBe("CURRENT");
  denied = true; await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByRole("alert")).toHaveText("fixture gap access revoked");
  await expect(page.getByText(/当前筛选共/)).toHaveCount(0); await expect(page.getByRole("table")).toHaveCount(0);
});


test("recovery progress opens the current failed task even with no order rows and never submits a mutation", async ({ page }) => {
  let mode = "FAILED";
  await page.route("**/*", route => {
    const url = new URL(route.request().url()); expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") {
      expect(route.request().method()).toBe("GET");
      if (mode === "DENIED") return route.fulfill({ status: 403, json: { error: "fixture recovery access revoked" } });
      return route.fulfill({ json: { rows: [], pagination: { total: 0, pageCount: 0 }, sources: [{ id: "fixture-source", enabled: true, marketplaceId: "fixture-marketplace", seller: { displayName: "Fixture store" }, resourceCursor: null,
        recoveryTask: { recoveryOutcome: { state: mode === "SUCCEEDED" ? "WINDOW_COMPLETED" : mode === "FAILED" ? "FAILED_AGAIN" : "ADVANCED", pagesAdvanced: 1, detailsAdvanced: 2, pendingDetails: mode === "SUCCEEDED" ? 0 : 7 }, id: "current-failed-task", status: mode, stage: "FETCHING_DETAILS", pagesCompleted: 2, detailsCompletedCount: 491, attempts: 3, maxAttempts: 3, apiRequests: 493, throttles: 0,
          failureReason: mode === "FAILED" ? "自动重试次数已用尽；原件、已提交页和游标保留。" : mode === "RETRY_WAIT" ? "请求暂时失败，等待限流退避或有限重试。" : null,
          progress: { state: mode === "RETRY_WAIT" ? "SCHEDULED_WAIT" : "ACTION_REQUIRED", needsAttention: mode !== "RETRY_WAIT", progressBasis: "COMMITTED_PAGE_OR_DETAIL", lastProgressAt: "2026-11-01T00:10:00Z", message: mode === "RETRY_WAIT" ? "尚未到下次执行时间，可能处于持久限流或重试退避。" : "任务需要人工核对，恢复仍须通过现有审批。" },
          lastHttpErrorStatus: mode === "FAILED" ? 500 : null, operatorAction: null, canRequestRetry: mode === "FAILED" } }] } });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await expect(page.getByTestId("order-recovery-task")).toContainText("已补齐 491 笔明细");
  await expect(page.getByTestId("order-recovery-outcome")).toContainText("恢复后再次失败");
  await expect(page.getByTestId("order-recovery-outcome")).toContainText("当前窗口待处理 7 笔");
  await expect(page.getByTestId("order-recovery-task")).toContainText("最近失败 HTTP 500");
  await expect(page.getByTestId("order-progress-health")).toContainText("最近提交 2026-11-01T00:10:00.000Z");
  await page.getByRole("button", { name: "查看失败任务并申请重试" }).click(); await expect(page).toHaveTitle("current-failed-task");
  await expect(page.getByText(/此入口仅打开任务/)).toBeVisible();
  mode = "RETRY_WAIT"; await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByText("请求暂时失败，等待限流退避或有限重试。", { exact: true })).toBeVisible();
  await expect(page.getByTestId("order-progress-health")).toContainText("尚未到下次执行时间");
  await expect(page.getByRole("button", { name: "查看失败任务并申请重试" })).toHaveCount(0);
  mode = "SUCCEEDED"; await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByTestId("order-recovery-task")).not.toContainText("最近失败 HTTP");
  await expect(page.getByTestId("order-recovery-outcome")).toContainText("当前窗口已完成");
  await expect(page.getByTestId("order-recovery-outcome")).toContainText("新补齐 2 笔");
  await expect(page.getByTestId("order-recovery-outcome")).toContainText("当前窗口待处理 0 笔");
  mode = "DENIED"; await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByRole("alert")).toHaveText("fixture recovery access revoked"); await expect(page.getByTestId("order-recovery-task")).toHaveCount(0);
});


test("completed order window exposes fulfillment recovery without starting or applying a sync", async ({ page }) => {
  const writes: unknown[] = [];
  await page.route("**/*", route => {
    const request = route.request(), url = new URL(request.url()); expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") {
      if (request.method() === "POST") { writes.push(request.postDataJSON()); return route.fulfill({ json: { status: "REQUESTED" } }); }
      const section = url.searchParams.get("section");
      if (section === "order-fulfillment-pages") {
        expect(url.searchParams.get("sourceId")).toBe("fixture-source"); expect(url.searchParams.get("taskId")).toBe("fixture-completed");
        return route.fulfill({ json: { pages: [1001], hasNext: false, nextCursor: null, batchSize: 10 } });
      }
      if (section === "order-fulfillment-preview") return route.fulfill({ json: { manifest: { checkedRows: 1, changedRows: 1, addedFields: 2, parserVersion: "orders.2026-01-01.v2", archives: [{ page: 1001 }] }, command: { action: "recover-report", id: "fixture-source", taskId: "fixture-completed", rawPages: [1001], orderFulfillmentOnly: true, revision: 2, recoveryDigest: "fixture-digest" } } });
      expect(section).toBe("orders");
      return route.fulfill({ json: { rows: [], pagination: { total: 0, pageCount: 0 }, sources: [{ id: "fixture-source", enabled: true, marketplaceId: "fixture-marketplace", detailsEnabled: true, detailsComplete: true, seller: { displayName: "Fixture store" }, resourceCursor: null,
        recoveryTask: { id: "fixture-completed", status: "SUCCEEDED", stage: "COMPLETED", pagesCompleted: 1, detailsCompletedCount: 1, apiRequests: 2, throttles: 0, attempts: 1, maxAttempts: 3, canRequestRetry: false } }] } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await page.getByText("补齐本窗口历史履约字段", { exact: true }).click();
  await page.getByRole("button", { name: "自动查找原件页" }).click();
  await expect(page.getByLabel("原件页（最多 10 页）")).toHaveValue("1001");
  await page.getByRole("button", { name: "预览履约补齐" }).click();
  await expect(page.getByText("已核对 1 行，拟补齐 1 行、2 个字段值。", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "提交履约补齐审批" }).click();
  await expect(page.getByRole("status")).toContainText("尚未改写数据");
  expect(writes).toEqual([{ action: "recover-report", id: "fixture-source", taskId: "fixture-completed", rawPages: [1001], orderFulfillmentOnly: true, revision: 2, recoveryDigest: "fixture-digest" }]);
  await page.getByRole("button", { name: "前往变更审批" }).click(); await expect(page).toHaveTitle("approvals");
});


test("fulfillment filters reset pagination and combine with current-detail filtering", async ({ page }) => {
  const reads: URL[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url()); expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") {
      expect(route.request().method()).toBe("GET"); reads.push(url);
      return route.fulfill({ json: { rows: [], sources: [], pagination: { total: 51, pageCount: 2 } } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await page.getByRole("button", { name: "订单下一页" }).click();
  await expect.poll(() => reads.at(-1)?.searchParams.get("page")).toBe("2");
  await page.getByLabel("履约方", { exact: true }).fill("AMAZON");
  await expect.poll(() => reads.at(-1)?.searchParams.get("fulfilledBy")).toBe("AMAZON");
  expect(reads.at(-1)?.searchParams.get("page")).toBe("1");
  await page.getByLabel("配送服务等级", { exact: true }).fill("Standard");
  await expect.poll(() => reads.at(-1)?.searchParams.get("fulfillmentServiceLevel")).toBe("Standard");
  await page.getByLabel("明细状态", { exact: true }).selectOption("CURRENT");
  await expect.poll(() => reads.at(-1)?.searchParams.get("detailsStatus")).toBe("CURRENT");
  expect(reads.at(-1)?.searchParams.get("fulfilledBy")).toBe("AMAZON");
  expect(reads.at(-1)?.searchParams.get("fulfillmentServiceLevel")).toBe("Standard");
});
