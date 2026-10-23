import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import { amazonReadDomains, type OperationsReadiness } from "@/lib/operations/types";

let bundle: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: ["tests/browser/operations-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  bundle = result.outputFiles[0].text;
});

function readiness(workspaceId: string): OperationsReadiness {
  return {
    scope: { workspaceId, accountId: "", marketplace: "US" },
    connection: { id: null, provider: "amazon_sp_api", status: "NOT_CONFIGURED", enabledDomains: [], marketplaceParticipations: [], statusMessage: "等待配置", lastValidatedAt: null, lastSyncAt: null, runtimeConfiguration: { configured: false, missingEnvironmentVariables: ["AMAZON_SP_API_REFRESH_TOKEN"], region: "NA" } },
    runs: [], inventory: { status: "NOT_SYNCED", syncRunId: null, capturedAt: null, snapshotCount: 0, fulfillableQuantity: 0, inboundQuantity: 0, reservedQuantity: 0, unfulfillableQuantity: 0 },
    domains: Object.fromEntries(amazonReadDomains.map((resource) => [resource, { resource, status: "NOT_SYNCED", source: resource === "ads" ? "现有 PPC 模块" : "Amazon SP-API", syncRunId: null, lastSuccessAt: null, lastAttemptAt: null, lastAttemptStatus: null, lastAttemptError: null, reason: "尚未接通测试域", recommendedAction: null, nextScheduledAt: null }])) as OperationsReadiness["domains"],
    generatedAt: "2026-10-23T00:00:00Z",
  };
}

async function setup(page: Page, tab = "overview") {
  const calls: Array<{ path: string; method: string; workspace: string | undefined; body: unknown }> = [];
  const state = { canEdit: false, stale: false, denied: false, delayInventory: false, releaseInventory: () => {}, inventoryStarted: false, enabled: false };
  await page.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    expect(url.origin, "browser must never call Amazon or another external host").toBe("http://127.0.0.1:43220");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    const workspace = request.headers()["x-workspace-id"];
    expect(request.headers()["authorization"]).toBeUndefined();
    calls.push({ path: url.pathname, method: request.method(), workspace, body: request.method() === "GET" ? null : request.postDataJSON() });
    if (state.denied) return route.fulfill({ status: 403, json: { error: "无经营中台权限" } });
    if (url.pathname.endsWith("/freshness")) {
      const result = readiness(workspace ?? "missing");
      if (state.stale) { result.inventory.status = "STALE"; result.domains.inventory.status = "STALE"; result.domains.inventory.reason = "库存快照已超过 120 分钟"; result.domains.inventory.recommendedAction = "立即同步库存并检查 worker"; }
      return route.fulfill({ json: result });
    }
    if (url.pathname.endsWith("/inventory/snapshots")) {
      if (state.delayInventory && workspace === "workspace-a") {
        state.inventoryStarted = true;
        await new Promise<void>((resolve) => { state.releaseInventory = resolve; });
        return route.fulfill({ status: 403, json: { error: "旧工作区库存读取失败" } });
      }
      return route.fulfill({ json: { rows: [], pagination: { page: 1, pageSize: 20, total: 0, pageCount: 0 }, snapshot: { status: "NOT_SYNCED", syncRunId: null, capturedAt: null } } });
    }
    if (url.pathname.endsWith("/metrics/daily")) return route.fulfill({ json: { rows: [], pagination: { page: 1, pageSize: 30, hasNextPage: false }, sourceNote: "现有 PPC 日投影尚未接通", emptyReason: "缺少同步数据" } });
    if (url.pathname.endsWith("/schedules")) {
      if (request.method() === "PATCH") state.enabled = request.postDataJSON().enabled;
      return route.fulfill({ json: { canEdit: state.canEdit, schedules: amazonReadDomains.map((resource) => ({ resource, enabled: resource === "inventory" && state.enabled, intervalMinutes: resource === "inventory" ? 60 : 1440, supported: resource === "inventory" || resource === "catalog", source: resource === "ads" ? "sourced_from_ppc" : "amazon_sp_api", lastEnqueuedAt: null, nextScheduledAt: null })) } });
    }
    if (url.pathname.endsWith("/products")) return route.fulfill({ json: { rows: [{ sellerAccountId: "store", marketplaceId: "US", sellerSku: "TEST-SKU", asin: null, listingStatus: null, available: null, inbound: null, reserved: null, unfulfillable: null, catalogUpdatedAt: null, inventoryUpdatedAt: null, inventoryRunId: null, freshness: "NOT_SYNCED", fieldSources: {}, lastError: null }], hasNextPage: false } });
    if (url.pathname.endsWith("/replenishment")) return route.fulfill({ json: { rows: [], canEdit: false } });
    if (url.pathname.endsWith("/sync-runs")) return route.fulfill({ json: { run: { id: "blocked-test", error: "未配置 Seller ID，已阻断", status: "BLOCKED" } } });
    throw new Error(`Unexpected API: ${request.method()} ${url.pathname}`);
  });
  await page.goto(`http://127.0.0.1:43220/?tab=${tab}`);
  return { state, calls };
}

test("overview shows six domains, stale reason/action and honest orders/ads placeholders", async ({ page }) => {
  const { state } = await setup(page);
  state.stale = true;
  await page.getByRole("button", { name: "刷新数据", exact: true }).click();
  await expect(page.getByText("库存快照已超过 120 分钟", { exact: true })).toBeVisible();
  await expect(page.getByText("建议：立即同步库存并检查 worker", { exact: true })).toBeVisible();
  for (const label of ["广告", "订单", "库存", "商品目录", "财务", "履约"]) await expect(page.locator("p").getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText(/今日广告花费：未接通日投影/)).toBeVisible();
  await page.getByRole("link", { name: "订单", exact: true }).click();
  await expect(page.getByRole("heading", { name: "订单 · NOT_SYNCED" })).toBeVisible();
  await page.getByRole("link", { name: "广告联看", exact: true }).click();
  await expect(page.getByRole("link", { name: "广告优化工作台" })).toHaveAttribute("href", "/workspace");
  await expect(page.getByText("缺少同步数据", { exact: true })).toBeVisible();
});

test("unsynced inventory quantities and catalog fields stay unknown", async ({ page }) => {
  await setup(page, "inventory");
  await expect(page.getByText(/可售 未同步 · 在途 未同步 · 预留 未同步 · 不可售 未同步/)).toBeVisible();
  await page.getByRole("link", { name: "在线产品", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "TEST-SKU" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell").nth(4)).toHaveText("未同步");
  await expect(row.getByRole("cell").nth(3)).toHaveText("未同步");
});

test("read-only schedules cannot be edited; manual sync uses scope and idempotency", async ({ page }) => {
  const { calls } = await setup(page, "sync");
  await expect(page.getByLabel("库存同步间隔")).toBeDisabled();
  await expect(page.getByRole("button", { name: "启用", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "立即同步库存", exact: true }).click();
  await expect(page.getByText("未配置 Seller ID，已阻断", { exact: true })).toBeVisible();
  const call = calls.find((call) => call.path.endsWith("/sync-runs"));
  expect(call?.workspace).toBe("workspace-a");
  expect(call?.body).toMatchObject({ resource: "inventory", idempotencyKey: expect.stringMatching(/^manual-inventory-/) });
  expect(calls.some((call) => call.method === "PATCH")).toBe(false);
});

test("edit schedules persist explicit domain/interval and unsupported domains stay closed", async ({ page }) => {
  const { state, calls } = await setup(page);
  state.canEdit = true;
  await page.getByRole("link", { name: "同步与计划", exact: true }).click();
  const inventory = page.getByRole("row").filter({ has: page.getByLabel("库存同步间隔") });
  await expect(page.getByLabel("订单同步间隔")).toBeDisabled();
  await inventory.getByRole("button", { name: "启用", exact: true }).click();
  await expect(inventory.getByRole("button", { name: "停用", exact: true })).toBeVisible();
  expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ resource: "inventory", intervalMinutes: 60, enabled: true });
});

test("late failures from the previous workspace cannot contaminate the current workspace", async ({ page }) => {
  const { state } = await setup(page);
  state.delayInventory = true;
  await page.getByRole("button", { name: "刷新数据", exact: true }).click();
  await expect.poll(() => state.inventoryStarted).toBe(true);
  await page.evaluate(() => {
    localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-b", marketplace: "US" }));
    window.dispatchEvent(new Event("amazon-bulk-ad:workspace-scope-changed"));
  });
  await expect(page.getByText(/工作区：workspace-b/)).toBeVisible();
  const oldResponse = page.waitForResponse((response) => response.url().includes("/inventory/snapshots") && response.status() === 403);
  state.releaseInventory();
  await oldResponse;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("link", { name: "补货计划", exact: true }).click();
  await expect(page.getByText("尚无人工维护的补货策略。", { exact: true })).toBeVisible();
});

test("403 is visible and does not become a successful empty-data state", async ({ page }) => {
  const { state } = await setup(page);
  state.denied = true;
  await page.getByRole("button", { name: "刷新数据", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("无经营中台权限");
});
