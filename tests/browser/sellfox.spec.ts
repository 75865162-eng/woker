import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

let bundle: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: ["tests/browser/sellfox-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  bundle = result.outputFiles[0].text;
});
async function switchWorkspace(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-b" }));
    window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed"));
  });
}
async function setup(page: Page, params = "domain=sales&from=2026-10-24&to=2026-10-24") {
  const calls: Array<{ path: string; query: URLSearchParams; workspace: string; body: unknown }> = [];
  const state = { configured: true, delayPath: "", pending: false, release: () => {} };
  await page.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    expect(url.origin).toBe("http://127.0.0.1:43221");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    const workspace = request.headers()["x-workspace-id"] ?? "";
    const call = { path: url.pathname, query: url.searchParams, workspace, body: request.method() === "POST" ? request.postDataJSON() : null }; calls.push(call);
    expect(request.headers()["authorization"]).toBeUndefined();
    if (state.delayPath === url.pathname && workspace === "workspace-a") {
      state.pending = true; await new Promise<void>((resolve) => { state.release = resolve; });
      // Even if the transport completes after abort, old scope must never render.
    }
    const store = { id: `store-${workspace}`, externalId: `shop-${workspace}`, name: `店铺-${workspace}`, marketplace: "US", country: "US", status: "active", lastSyncedAt: "2026-10-24T00:00:00Z" };
    if (url.pathname.endsWith("/overview")) return route.fulfill({ json: { configured: state.configured, stores: [store], counts: { stores: 1, inventory: 1, sales: 1, performance: 1, hourly: 0 }, latestRuns: [], latestSuccessByResource: {}, workerOnline: true } });
    if (url.pathname.endsWith("/schedules")) return route.fulfill({ json: { schedules: [{ resource: "performance", enabled: false, intervalMinutes: 1440 }] } });
    if (url.pathname.endsWith("/sync")) return route.fulfill({ status: 202, json: { runId: "test-run", status: "queued" } });
    if (/\/(sales|performance|runs)\/row$/.test(url.pathname)) return route.fulfill({ json: { payload: { msku: "test-msku", token: "[已隐藏]" }, truncated: true } });
    const domain = url.pathname.split("/").pop();
    if (["sales", "performance", "runs", "inventory", "hourly", "stores", "listings", "ads_report"].includes(domain ?? "")) return route.fulfill({ json: { rows: [{ id: "row", reportDate: "2026-10-24", sku: `${workspace}-SKU-page${url.searchParams.get("page") || 1}`, msku: "test-msku", quantity: null, revenue: 20, currency: "USD", saleQuantity: 2, fbaQuantity: 1, fbmQuantity: 1, grossProfitRate: 0.1, refundRate: 0.05, impressions: 100, clicks: 2, cost: 1.5, adOrders: 1, adSales: 12, sales7: 2, fulfillable: 0, resource: domain === "runs" ? "performance" : undefined, status: domain === "runs" ? "running" : domain === "listings" ? "active" : undefined, summary: { progress: { count: 42 } }, SellfoxStore: store }], pagination: { page: Number(url.searchParams.get("page") || 1), pageSize: 50, total: 51 } } });
    throw new Error(`Unexpected test request: ${url.pathname}`);
  });
  await page.goto(`http://127.0.0.1:43221/?${params}`);
  return { calls, state };
}

test("daily multi-store browsing, shared filters, pagination and browser navigation", async ({ page }) => {
  const { calls } = await setup(page);
  await expect(page.getByRole("cell", { name: "workspace-a-SKU-page1", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "销量", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "库存", exact: true })).toHaveCount(0);
  await page.getByLabel("店铺筛选").selectOption(["shop-workspace-a"]);
  await page.getByLabel("站点筛选").selectOption("US");
  await page.getByLabel("搜索记录").fill("SKU");
  await expect(page.getByRole("link", { name: "CSV", exact: true })).toHaveAttribute("href", /site=US.*shopExternalId=shop-workspace-a/);
  await expect.poll(() => calls.filter((call) => call.path.endsWith("/sales")).at(-1)?.query.get("search")).toBe("SKU");
  const latest = calls.filter((call) => call.path.endsWith("/sales")).at(-1)!;
  expect(latest.query.get("from")).toBe("2026-10-24"); expect(latest.workspace).toBe("workspace-a");
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByRole("cell", { name: "workspace-a-SKU-page2", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("cell", { name: "workspace-a-SKU-page1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "全部历史", exact: true }).click();
  await expect(page.getByRole("link", { name: "CSV", exact: true })).toHaveAttribute("href", /allDates=1/);
  const href = await page.getByRole("link", { name: "CSV", exact: true }).getAttribute("href"); expect(href).not.toContain("reportDate");
});

test("performance retains metrics and Excel; raw details load only on explicit expansion", async ({ page }) => {
  const { calls } = await setup(page, "domain=performance");
  await expect(page.getByRole("columnheader", { name: "FBA 销量", exact: true })).toBeVisible();
  for (const name of ["FBM 销量", "毛利率", "退款率", "币种"]) await expect(page.getByRole("columnheader", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Excel", exact: true })).toHaveAttribute("href", /format=xlsx/);
  await page.getByRole("button", { name: "查看记录 row" }).click();
  expect(calls.some((call) => call.path.endsWith("/row"))).toBe(false);
  await page.getByText("展开原始摘要", { exact: true }).click();
  await expect(page.getByText("内容已截断。", { exact: true })).toBeVisible();
  expect(calls.filter((call) => call.path.endsWith("/row"))).toHaveLength(1);
  await switchWorkspace(page);
  await expect(page.getByRole("region", { name: "记录摘要" })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "workspace-b-SKU-page1", exact: true })).toBeVisible();
});

test("late old-workspace overview and table responses cannot restore previous store data", async ({ page }) => {
  const { state } = await setup(page);
  await expect(page.getByRole("cell", { name: "workspace-a-SKU-page1", exact: true })).toBeVisible();
  state.delayPath = "/api/sellfox/overview";
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect.poll(() => state.pending).toBe(true);
  await switchWorkspace(page);
  await expect(page.getByLabel("店铺筛选").locator("option")).toHaveText(["店铺-workspace-b · US"]);
  state.release();
  await expect(page.getByLabel("店铺筛选").locator("option")).toHaveText(["店铺-workspace-b · US"]);
  state.pending = false; state.delayPath = "/api/sellfox/sales";
  await page.evaluate(() => { localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-a" })); window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed")); });
  await expect.poll(() => state.pending).toBe(true);
  await switchWorkspace(page);
  await expect(page.getByRole("cell", { name: "workspace-b-SKU-page1", exact: true })).toBeVisible();
  state.release();
  await expect(page.getByRole("cell", { name: "workspace-a-SKU-page1", exact: true })).toHaveCount(0);
});

test("late sync completion stays in its workspace and does not navigate or notify the new scope", async ({ page }) => {
  const { state } = await setup(page);
  await expect(page.getByRole("cell", { name: "workspace-a-SKU-page1", exact: true })).toBeVisible();
  state.delayPath = "/api/sellfox/sync";
  await page.getByRole("button", { name: "立即同步", exact: true }).click();
  await expect.poll(() => state.pending).toBe(true);
  await switchWorkspace(page); state.release();
  await expect(page.getByRole("cell", { name: "workspace-b-SKU-page1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "销量", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/已加入.*同步队列/)).toHaveCount(0);
});

test("run polling preserves filters when switching to verified listing and advertising domains", async ({ page }) => {
  const { calls } = await setup(page, "domain=runs&from=2026-10-24&to=2026-10-24&search=running");
  await expect(page.getByRole("cell", { name: "42", exact: true })).toBeVisible();
  await expect.poll(() => calls.filter((call) => call.path.endsWith("/runs")).length, { timeout: 8000 }).toBeGreaterThan(1);
  for (const call of calls.filter((call) => call.path.endsWith("/runs"))) { expect(call.query.get("from")).toBe("2026-10-24"); expect(call.query.get("search")).toBe("running"); }
  await page.getByRole("button", { name: "在线 Listing", exact: true }).click();
  await expect(page.getByLabel("Listing 状态")).toBeVisible();
  await page.getByRole("button", { name: "广告", exact: true }).click();
  await expect(page.getByText(/广告产品日报：默认 SP/)).toBeVisible();
});


test("listing current and advertising product daily browse locally and expose narrow Agent exports", async ({ page }) => {
  const { calls } = await setup(page, "domain=listings");
  await expect(page.getByRole("columnheader", { name: "7天销量", exact: true })).toBeVisible();
  await expect(page.getByLabel("开始日期")).toBeDisabled();
  await page.getByLabel("Listing 状态").selectOption("active");
  await expect.poll(() => calls.filter((call) => call.path.endsWith("/listings")).at(-1)?.query.get("status")).toBe("active");
  await expect(page.getByRole("link", { name: "给 Agent 的导出 CSV（业务窄列）" })).toHaveAttribute("href", /listings\/export.*agent=1/);
  await page.getByRole("button", { name: "广告", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "广告订单", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "广告销售额", exact: true })).toBeVisible();
  await expect.poll(() => calls.some((call) => call.path.endsWith("/ads_report"))).toBe(true);
  expect(calls.some((call) => call.path.endsWith("/hourly"))).toBe(false);
  await expect(page.getByRole("link", { name: "给 Agent 的导出 CSV（业务窄列）" })).toHaveAttribute("href", /ads_report\/export.*agent=1/);
});
