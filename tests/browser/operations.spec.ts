import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import { amazonReadDomains, type OperationsReadiness } from "@/lib/operations/types";

let bundle: string;
let styles: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: ["tests/browser/operations-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  bundle = result.outputFiles[0].text;
  const [{ readFile }, { default: postcss }, { default: tailwind }] = await Promise.all([import("node:fs/promises"), import("postcss"), import("@tailwindcss/postcss")]);
  styles = (await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css;
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
  const state = { canEdit: false, stale: false, denied: false, delayPath: "", releaseInventory: () => {}, inventoryStarted: false, enabled: false, policyRows: [] as Record<string, unknown>[], salesComplete: false, sellfoxDenied: false };
  await page.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    expect(url.origin, "browser must never call Amazon or another external host").toBe("http://127.0.0.1:43220");
    if (url.pathname === "/styles.css") return route.fulfill({ contentType: "text/css", body: styles });
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    const workspace = request.headers()["x-workspace-id"];
    expect(request.headers()["authorization"]).toBeUndefined();
    calls.push({ path: url.pathname, method: request.method(), workspace, body: request.method() === "GET" ? null : request.postDataJSON() });
    if (state.denied) return route.fulfill({ status: 403, json: { error: "无经营中台权限" } });
    if (state.delayPath === url.pathname && workspace === "workspace-a") {
      state.inventoryStarted = true;
      await new Promise<void>((resolve) => { state.releaseInventory = resolve; });
      return route.fulfill({ status: 403, json: { error: "旧工作区请求失败" } });
    }
    if (url.pathname.endsWith("/freshness")) {
      const result = readiness(workspace ?? "missing");
      if (state.stale) { result.inventory.status = "STALE"; result.domains.inventory.status = "STALE"; result.domains.inventory.reason = "库存快照已超过 120 分钟"; result.domains.inventory.recommendedAction = "立即同步库存并检查 worker"; }
      return route.fulfill({ json: result });
    }
    if (url.pathname.endsWith("/inventory/snapshots")) {
      return route.fulfill({ json: { rows: [], pagination: { page: 1, pageSize: 20, total: 0, pageCount: 0 }, snapshot: { status: "NOT_SYNCED", syncRunId: null, capturedAt: null } } });
    }
    if (url.pathname.endsWith("/metrics/daily")) return route.fulfill({ json: { rows: [], pagination: { page: 1, pageSize: 30, hasNextPage: false }, sourceNote: "现有 PPC 日投影尚未接通", emptyReason: "缺少同步数据" } });
    if (url.pathname.endsWith("/schedules")) {
      if (request.method() === "PATCH") state.enabled = request.postDataJSON().enabled;
      return route.fulfill({ json: { canEdit: state.canEdit, schedules: amazonReadDomains.map((resource) => ({ resource, enabled: resource === "inventory" && state.enabled, intervalMinutes: resource === "inventory" ? 60 : 1440, supported: resource === "inventory" || resource === "catalog", source: resource === "ads" ? "sourced_from_ppc" : "amazon_sp_api", lastEnqueuedAt: null, nextScheduledAt: null })) } });
    }
    if (url.pathname.endsWith("/products")) return route.fulfill({ json: { rows: [{ sellerAccountId: "store", marketplaceId: "US", sellerSku: "TEST-SKU", asin: null, listingStatus: null, available: null, inbound: null, reserved: null, unfulfillable: null, catalogUpdatedAt: null, inventoryUpdatedAt: null, inventoryRunId: null, freshness: "NOT_SYNCED", fieldSources: {}, lastError: null }], hasNextPage: false } });
    if (url.pathname === "/api/sellfox/stores") return route.fulfill({ json: { rows: [
      { id: "tk-local-us", externalId: "124687", name: "TK店-US", marketplace: "US" },
      { id: "tk-local-ca", externalId: "124688", name: "TK店-CA", marketplace: "CA" },
      { id: "tk-local-mx", externalId: "426997", name: "TK店-MX", marketplace: "MX" },
      { id: "tk-local-br", externalId: "245097", name: "TK店-BR", marketplace: "BR" },
    ], pagination: { page: 1, pageSize: 200, total: 4 } } });
    if (url.pathname === "/api/sellfox/listings") return route.fulfill({ json: { rows: [{ msku: "TK-EXACT-MSKU", sku: "" }, { msku: null }], pagination: { total: 1 } } });
    if (url.pathname === "/api/sellfox/sales") {
      expect(url.searchParams.get("searchType")).toBe("msku");
      expect(url.searchParams.get("exactMatch")).toBe("1");
      expect(url.searchParams.get("shopExternalId")).toBe("124687");
      const dates = Array.from({ length: 28 }, (_, i) => new Date(Date.parse(url.searchParams.get("to")!) - i * 86400000).toISOString().slice(0, 10));
      if (state.sellfoxDenied) return route.fulfill({ status: 403, json: { error: "无赛狐读取权限" } });
      return route.fulfill({ json: { rows: [{ storeId: "tk-local-us", msku: "TK-EXACT-MSKU", dailyQuantity: Object.fromEntries(dates.map((date, i) => [date, !state.salesComplete && i === 0 ? null : 2])) }], pagination: { total: 1 } } });
    }
    if (url.pathname.endsWith("/replenishment")) return route.fulfill({ json: request.method() === "PATCH" ? { message: "参数已保存；等待 worker 计算" } : { rows: state.policyRows, canEdit: state.canEdit, canReadSellfox: state.canEdit, sellerAccounts: [{ id: "actual-seller-id", displayName: "TK运营归属店铺", accountKey: "tk", marketplaceCode: "US", marketplaceId: "ATVPDKIKX0DER" }] } });
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

for (const path of ["/inventory/snapshots", "/metrics/daily", "/freshness", "/sync-runs"]) {
 test(`late ${path} failures cannot contaminate the current workspace`, async ({ page }) => {
  const { state } = await setup(page);
  state.delayPath = `/api/operations${path}`;
  await page.getByRole("button", { name: path === "/sync-runs" ? "请求只读同步" : "刷新数据", exact: true }).click();
  await expect.poll(() => state.inventoryStarted).toBe(true);
  await page.evaluate(() => {
    localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-b", marketplace: "US" }));
    window.dispatchEvent(new Event("amazon-bulk-ad:workspace-scope-changed"));
  });
  await expect(page.getByText(/工作区：workspace-b/)).toBeVisible();
  const oldResponse = page.waitForResponse((response) => new URL(response.url()).pathname === state.delayPath && response.status() === 403);
  state.releaseInventory();
  await oldResponse;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("link", { name: "补货计划", exact: true }).click();
  await expect(page.getByText("尚无人工维护的补货策略。", { exact: true })).toBeVisible();
});
}

test("403 is visible and does not become a successful empty-data state", async ({ page }) => {
  const { state } = await setup(page);
  state.denied = true;
  await page.getByRole("button", { name: "刷新数据", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("无经营中台权限");
});


test("TK dropdown and exact MSKU save without UUID entry, with missing-day evidence and scoped deep links", async ({ page }) => {
  const { state, calls } = await setup(page);
  state.canEdit = true;
  await page.getByRole("link", { name: "补货计划", exact: true }).click();
  await page.getByLabel("赛狐数据店铺", { exact: true }).selectOption({ label: "TK店-US" });
  await page.getByLabel("策略归属店铺", { exact: true }).selectOption("actual-seller-id");
  await expect(page.getByLabel("补货站点")).toHaveValue("ATVPDKIKX0DER");
  await page.getByLabel("补货 MSKU", { exact: true }).selectOption("TK-EXACT-MSKU");
  await expect(page.getByRole("status")).toContainText("NEEDS_DATA · 最近28日缺失或无效 1 天");
  await page.getByText("查看缺失日期", { exact: true }).click();
  await expect(page.getByRole("status")).toContainText("不补0");
  const link = page.getByRole("link", { name: "打开赛狐销量", exact: true }).filter({ visible: true });
  await expect(link).toHaveAttribute("href", /workspaceId=workspace-a&shopExternalId=124687/);
  await expect(link).toHaveAttribute("href", /search=TK-EXACT-MSKU&searchType=msku&exactMatch=1/);
  await page.getByLabel("生产天数", { exact: true }).fill("5");
  await page.getByLabel("国内运输天数", { exact: true }).fill("3");
  await page.getByLabel("海运天数", { exact: true }).fill("20");
  await page.getByLabel("来源说明", { exact: true }).fill("赛狐精确 MSKU 日销与供应商确认周期");
  await page.getByRole("button", { name: "保存并启用", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("参数已保存");
  const save = calls.find(call => call.method === "PATCH" && call.path.endsWith("/replenishment"));
  expect(save?.workspace).toBe("workspace-a");
  expect(save?.body).toMatchObject({ sellerAccountId: "actual-seller-id", marketplaceId: "ATVPDKIKX0DER", sellerSku: "TK-EXACT-MSKU", inputs: { historicalSource: { storeId: "tk-local-us" }, salesHistory: [] }, enabled: true });
  expect(calls.some(call => call.path.includes("/sync") && call.method !== "GET")).toBe(false);
  await page.screenshot({ path: "tmp/operations-round-f-form.png", fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("result rows show READY source, NEEDS_DATA inputs, urgency and expandable reasons", async ({ page }) => {
  const { state } = await setup(page);
  const date = "2026-10-25T00:00:00Z";
  const policy = { id: "ready", sellerAccountId: "actual-seller-id", marketplaceId: "ATVPDKIKX0DER", sellerSku: "READY-SKU", enabled: true, updatedAt: date, inputs: {}, plan: { policyUpdatedAt: date, nextCalculationAt: "2099-01-01", generatedAt: date, lastError: null, result: { status: "READY", urgency: "URGENT", inventorySource: "sellfox_inventory_current", daysOfCover: 2, suggestedQuantity: 20, missingInputs: [], reasons: ["周期与来源已验证", "库存将在到货前不足"] } } };
  state.policyRows = [policy, { ...policy, id: "needs", sellerSku: "NEEDS-SKU", plan: { ...policy.plan, result: { ...policy.plan.result, status: "NEEDS_DATA", urgency: "UNKNOWN", inventorySource: "AmazonInventorySnapshot", suggestedQuantity: null, missingInputs: ["最近完整 28 天销量（缺失日不视为零）"] } } }];
  await page.getByRole("link", { name: "补货计划", exact: true }).click();
  const ready = page.getByRole("row").filter({ hasText: "READY-SKU" });
  await expect(ready).toContainText("READY · URGENT");
  await expect(ready).toContainText("sellfox_inventory_current");
  await expect(ready.locator("span.bg-red-500")).toBeVisible();
  await ready.locator("summary").click();
  await expect(ready.getByText("库存将在到货前不足", { exact: true })).toBeVisible();
  const needs = page.getByRole("row").filter({ hasText: "NEEDS-SKU" });
  await expect(needs).toContainText("NEEDS_DATA");
  await expect(needs).toContainText("缺失日不视为零");
  await expect(needs).toContainText("AmazonInventorySnapshot");
  await page.screenshot({ path: "tmp/operations-round-f-results.png", fullPage: true });
});

test("blank manual quantity is rejected instead of becoming zero; read errors stay NEEDS_DATA", async ({ page }) => {
  const { state, calls } = await setup(page);
  state.canEdit = true; state.sellfoxDenied = true;
  await page.getByRole("link", { name: "补货计划", exact: true }).click();
  await page.getByLabel("赛狐数据店铺", { exact: true }).selectOption("tk-local-us");
  await page.getByLabel("补货 MSKU", { exact: true }).selectOption("TK-EXACT-MSKU");
  await expect(page.getByRole("status")).toContainText("NEEDS_DATA · 无赛狐读取权限");
  await page.getByLabel("赛狐数据店铺", { exact: true }).selectOption("");
  await page.getByLabel("策略归属店铺", { exact: true }).selectOption("actual-seller-id");
  await page.getByLabel("补货 MSKU", { exact: true }).fill("MANUAL");
  await page.getByText("高级兜底：手工每日销量", { exact: true }).click();
  await page.getByLabel("手工每日销量", { exact: true }).fill("2026-10-24,");
  await page.getByRole("button", { name: "保存并启用", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("销量件数缺失，不可按0保存");
  expect(calls.some(call => call.method === "PATCH")).toBe(false);
});

test("complete daily sales preview does not prematurely claim READY and overview links stay scoped", async ({ page }) => {
  const { state } = await setup(page);
  const links = page.getByRole("navigation", { name: "赛狐只读入口" }).filter({ visible: true });
  await links.getByLabel("TK 快捷店铺").selectOption("245097");
  await expect(links.getByRole("link", { name: "打开赛狐FBA库存" })).toHaveAttribute("href", /workspaceId=workspace-a&shopExternalId=245097/);
  state.canEdit = true; state.salesComplete = true;
  await page.getByRole("link", { name: "补货计划", exact: true }).click();
  await page.getByLabel("赛狐数据店铺", { exact: true }).selectOption("tk-local-us");
  await page.getByLabel("补货 MSKU", { exact: true }).selectOption("TK-EXACT-MSKU");
  await expect(page.getByRole("status")).toContainText("最近28日销量完整 · 仍须库存新鲜与周期齐全");
  await page.evaluate(() => {
    localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-b", marketplace: "US" }));
    window.dispatchEvent(new Event("amazon-bulk-ad:workspace-scope-changed"));
  });
  await expect(page.getByLabel("补货 MSKU", { exact: true })).toHaveValue("");
  await expect(page.getByRole("status")).toHaveCount(0);
});
