import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

let bundle: string;
let styles: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: ["tests/browser/sellfox-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  bundle = result.outputFiles[0].text;
  const [{ readFile }, { default: postcss }, { default: tailwind }] = await Promise.all([import("node:fs/promises"), import("postcss"), import("@tailwindcss/postcss")]);
  styles = (await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css;
});
async function switchWorkspace(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-b" }));
    window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed"));
  });
}
async function setup(page: Page, params = "domain=sales&from=2026-10-24&to=2026-10-24", rowCount = 1, tkStore = false) {
  const calls: Array<{ path: string; query: URLSearchParams; workspace: string; body: unknown }> = [];
  const state = { configured: true, delayPath: "", pending: false, release: () => {} };
  // Context routing also intercepts the original image opened in a new tab.
  await page.context().route("https://m.media-amazon.com/**", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=", "base64") }));
  await page.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === "https://m.media-amazon.com") return route.fallback();
    expect(url.origin).toBe("http://127.0.0.1:43221");
    if (url.pathname === "/styles.css") return route.fulfill({ contentType: "text/css", body: styles });
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    const workspace = request.headers()["x-workspace-id"] ?? "";
    const call = { path: url.pathname, query: url.searchParams, workspace, body: request.method() === "POST" ? request.postDataJSON() : null }; calls.push(call);
    expect(request.headers()["authorization"]).toBeUndefined();
    if (state.delayPath === url.pathname && workspace === "workspace-a") {
      state.pending = true; await new Promise<void>((resolve) => { state.release = resolve; });
      // Even if the transport completes after abort, old scope must never render.
    }
    const store = { id: `store-${workspace}`, externalId: tkStore ? "124687" : `shop-${workspace}`, name: `店铺-${workspace}`, marketplace: "US", country: "US", status: "active", lastSyncedAt: "2026-10-24T00:00:00Z" };
    if (url.pathname.endsWith("/overview")) return route.fulfill({ json: { configured: state.configured, stores: [store], counts: { stores: 1, inventory: 1, sales: 1, performance: 1, hourly: 0 }, latestRuns: [], latestSuccessByResource: {}, workerOnline: true } });
    if (url.pathname.endsWith("/schedules")) return route.fulfill({ json: { schedules: ["performance", "ads_campaign", "ads_ad_group", "ads_placement"].map(resource => ({ resource, enabled: false, intervalMinutes: 1440 })) } });
    if (url.pathname.endsWith("/sync")) return route.fulfill({ status: 202, json: { runId: "test-run", status: "queued" } });
    if (/\/(sales|performance|runs|ads_targeting|ads_search_term|ads_campaign|ads_ad_group|ads_placement)\/row$/.test(url.pathname)) return route.fulfill({ json: { payload: { msku: "test-msku", token: "[已隐藏]" }, truncated: true } });
    const domain = url.pathname.split("/").pop();
    const from = url.searchParams.get("from") || (domain === "performance" ? "2026-10-16" : "2026-10-24"), to = url.searchParams.get("to") || from;
    const dates = Array.from({length: Math.min(90,Math.max(1,(Date.parse(to)-Date.parse(from))/86400000+1))}, (_,i)=>new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10));
    const daily = Object.fromEntries(dates.map(d=>[d,2]));
    if (["sales", "performance", "runs", "inventory", "hourly", "stores", "listings", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"].includes(domain ?? "")) return route.fulfill({ json: { facets: domain === "performance" ? { salespersons: ["温见清", "陈馨"] } : {}, totals: domain === "performance" ? [{currency:"USD", grossProfit:10, saleRevenue:200, netRevenue:180, orderNum:4, saleQuantity:5, adCost:2, promotionDiscount:url.searchParams.has("onlySettle") ? "0" : "12.5", giftWrapFee:0}] : ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"].includes(domain ?? "") ? [{currency:null,cost:10,clicks:20,adOrders:2,adSales:200}] : domain === "sales" ? [{ currency:"USD", subtotal:2, daily }] : [], dates: domain === "sales" || domain === "performance" ? dates : [], rows: Array.from({length: rowCount}, (_, index) => ({ id: index ? `row-${index}` : "row", identity: `${workspace}-entity-page${url.searchParams.get("page") || 1}${index ? `-${index}` : ""}`, asin: `B0SAMPLE${String(index).padStart(3,"0")}`, daily, dailyQuantity: daily, ...Object.fromEntries(dates.map(d=>[`day:${d}`,2])), mainImage: index === 0 ? "https://m.media-amazon.com/images/I/fixture.jpg?width=80&format=jpg" : null, average7:2, title: `布局样本商品标题 ${index+1}`, userNameList: domain === "performance" ? ["温见清", "陈馨"] : undefined, grossProfit: -10, saleRevenue:200, netRevenue:180, orderNum:4, adCost:2, promotionDiscount:url.searchParams.has("onlySettle") ? 0 : "0", giftWrapFee:url.searchParams.has("onlySettle") ? "0" : "1234.5", subtotal: 2, reportDate: "2026-10-24", sku: `${workspace}-SKU-page${url.searchParams.get("page") || 1}`, msku: "test-msku", campaignId: "campaign-fixture", campaignName: "fixture campaign", adGroupId: "group-fixture", adGroupName: "fixture group", placement: "搜索结果顶部", targetingId: "target-fixture", targetingText: "keyword", searchTerm: "customer query", matchType: "EXACT", quantity: null, revenue: 20, currency: "USD", saleQuantity: 2, fbaQuantity: 1, fbmQuantity: 1, grossProfitRate: 0.1, refundRate: 0.05, impressions: 100, clicks: 2, cost: 1.5, adOrders: 1, adSales: 12, acos:0.125, roas:8, sales7: 2, fulfillable: 0, resource: domain === "runs" ? "performance" : undefined, status: domain === "runs" ? "running" : domain === "listings" ? "active" : undefined, ...(domain === "listings" ? { dxmPublishState: "delete" } : {}), summary: { progress: { count: 42 } }, SellfoxStore: store })), pagination: { page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 50), total: 51 } } });
    throw new Error(`Unexpected test request: ${url.pathname}`);
  });
  await page.goto(`http://127.0.0.1:43221/?${params}`);
  return { calls, state };
}

test("daily multi-store browsing, shared filters, pagination and browser navigation", async ({ page }) => {
  const { calls } = await setup(page);
  await expect(page.getByText("workspace-a-entity-page1", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "小计", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "10-24", exact: true })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "库存", exact: true })).toHaveCount(0);
  await page.getByLabel("展开店铺筛选").click();
  await page.getByLabel("搜索店铺").fill("workspace-a");
  await page.getByRole("checkbox", { name: "店铺-workspace-a · US", exact: true }).check();
  await page.getByLabel("站点筛选").selectOption("US");
  await page.getByLabel("搜索记录").fill("SKU");
  await expect(page.getByRole("link", { name: "CSV", exact: true })).toHaveAttribute("href", /site=US.*shopExternalId=shop-workspace-a/);
  await expect.poll(() => calls.filter((call) => call.path.endsWith("/sales")).at(-1)?.query.get("search")).toBe("SKU");
  const latest = calls.filter((call) => call.path.endsWith("/sales")).at(-1)!;
  expect(latest.query.get("from")).toBe("2026-10-24"); expect(latest.workspace).toBe("workspace-a");
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByText("workspace-a-entity-page2", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText("workspace-a-entity-page1", { exact: true })).toBeVisible();
  await page.getByLabel("日期快捷").selectOption("-29");
  await expect.poll(() => calls.filter(call => call.path.endsWith("/sales")).at(-1)?.query.get("layout")).toBe("workbench");
});

test("performance retains metrics and Excel; raw details load only on explicit expansion", async ({ page }) => {
  const { calls } = await setup(page, "domain=performance");
  await page.getByText("自定义列", { exact: true }).click();
  await page.getByRole("button", { name: "完整", exact: true }).click();
  await expect(page.getByRole("checkbox", {name:"只统计已结算",exact:true})).toBeEnabled();
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
  await expect(page.getByText("workspace-b-entity-page1", { exact: true })).toBeVisible();
});

test("late old-workspace overview and table responses cannot restore previous store data", async ({ page }) => {
  const { state } = await setup(page);
  await expect(page.getByText("workspace-a-entity-page1", { exact: true })).toBeVisible();
  state.delayPath = "/api/sellfox/overview";
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect.poll(() => state.pending).toBe(true);
  await switchWorkspace(page);
  await expect(page.getByLabel("店铺筛选", {exact:true}).locator("label")).toHaveText(["店铺-workspace-b · US"]);
  state.release();
  await expect(page.getByLabel("店铺筛选", {exact:true}).locator("label")).toHaveText(["店铺-workspace-b · US"]);
  state.pending = false; state.delayPath = "/api/sellfox/sales";
  await page.evaluate(() => { localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-a" })); window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed")); });
  await expect.poll(() => state.pending).toBe(true);
  await switchWorkspace(page);
  await expect(page.getByText("workspace-b-entity-page1", { exact: true })).toBeVisible();
  state.release();
  await expect(page.getByText("workspace-a-entity-page1", { exact: true })).toHaveCount(0);
});

test("late sync completion stays in its workspace and does not navigate or notify the new scope", async ({ page }) => {
  const { state } = await setup(page);
  await expect(page.getByText("workspace-a-entity-page1", { exact: true })).toBeVisible();
  state.delayPath = "/api/sellfox/sync";
  await page.getByRole("button", { name: "立即同步", exact: true }).click();
  await expect.poll(() => state.pending).toBe(true);
  await switchWorkspace(page); state.release();
  await expect(page.getByText("workspace-b-entity-page1", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", {name:"赛狐数据域"}).getByRole("button", { name: "销量", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/已加入.*同步队列/)).toHaveCount(0);
});

test("run polling preserves filters when switching to verified listing and advertising domains", async ({ page }) => {
  const { calls } = await setup(page, "domain=runs&from=2026-10-24&to=2026-10-24&search=running");
  await expect(page.getByRole("cell", { name: "42", exact: true })).toBeVisible();
  await expect.poll(() => calls.filter((call) => call.path.endsWith("/runs")).length, { timeout: 8000 }).toBeGreaterThan(1);
  for (const call of calls.filter((call) => call.path.endsWith("/runs"))) { expect(call.query.get("from")).toBe("2026-10-24"); expect(call.query.get("search")).toBe("running"); }
  await page.getByRole("button", { name: "在线商品", exact: true }).click();
  await expect(page.getByLabel("Listing 状态")).toBeVisible();
  await page.getByRole("button", { name: "广告", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "广告类型", exact: true })).toBeVisible();
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

test("sales matrix filters debounce, serialize dimensions and preserve visible export columns", async ({ page }) => {
  const { calls } = await setup(page);
  await expect(page.getByRole("columnheader", { name: "均值", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "总库存", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "均值", exact: true }).getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "总库存", exact: true }).getByRole("button")).toHaveCount(0);
  const defaultExport = await page.getByRole("link", { name: "CSV", exact: true }).getAttribute("href");
  expect(new URL(defaultExport!, "http://localhost").searchParams.getAll("column").slice(-3)).toEqual(["trend", "average7", "totalInventory"]);
  await page.getByRole("button", {name:"日矩阵（高级）", exact:true}).click();
  await expect(page.getByRole("columnheader", { name: "10-24", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "父ASIN", exact: true }).click();
  await page.getByRole("button", {name:"销售额",exact:true}).click();
  await page.getByLabel("隐藏销量为 0").check();
  await expect.poll(() => calls.filter(c => c.path.endsWith("/sales")).at(-1)?.query.get("hideZero")).toBe("1");
  const last = calls.filter(c => c.path.endsWith("/sales")).at(-1)!;
  expect(last.query.get("dimension")).toBe("parentAsin"); expect(last.query.get("metric")).toBe("revenue");
  await expect(page.getByRole("button", { name: "SPU", exact: true })).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: "实时统计", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "实时统计", exact: true })).not.toBeChecked();
  await page.getByText("自定义列", { exact: true }).click();
  await expect(page.getByLabel("显示均值列", { exact: true })).toBeChecked();
  await expect(page.getByLabel("显示总库存列", { exact: true })).toBeChecked();
  await page.getByLabel("显示均值列", { exact: true }).uncheck();
  await expect(page.getByRole("columnheader", { name: "均值", exact: true })).toHaveCount(0);
  await page.getByLabel("显示总库存列", { exact: true }).uncheck();
  await expect(page.getByRole("columnheader", { name: "总库存", exact: true })).toHaveCount(0);
  await page.getByLabel("显示标题列", { exact: true }).check();
  await expect(page.getByRole("columnheader", { name:"标题",exact:true })).toBeVisible();
  await page.getByLabel("显示标题列", { exact: true }).uncheck();
  const href = await page.getByRole("link", { name: "CSV", exact: true }).getAttribute("href");
  const params = new URL(href!, "http://localhost").searchParams;
  expect(params.getAll("column")).not.toContain("title"); expect(params.getAll("column")).toContain("subtotal");
  expect(params.getAll("column")).not.toContain("average7");
  expect(params.getAll("column")).not.toContain("totalInventory");
  await page.setViewportSize({ width: 720, height: 800 });
  await expect(page.getByRole("columnheader", { name: "父ASIN", exact: true }).first()).toHaveClass(/sticky left-0/);
  const writes = calls.filter(c => c.body !== null); expect(writes).toEqual([]);
});

test("listing and ads expose only verified read filters and disabled web operations", async ({ page }) => {
  const { calls } = await setup(page, "domain=listings");
  expect((await page.getByLabel("只读工具条",{exact:true}).getByRole("button").allTextContents()).slice(0,4)).toEqual(["配对","自动配对","同步","调价"]);
  for (const name of ["父体", "调价", "打印", "配对"]) await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  for (const name of ["7天销量", "14天销售额", "30天广告花费", "可售"]) await expect(page.getByRole("columnheader", { name, exact: true })).toBeVisible();
  await page.getByLabel("Listing 状态").selectOption("delete");
  await expect.poll(() => calls.filter(c => c.path.endsWith("/listings")).at(-1)?.query.get("status")).toBe("delete");
  await page.getByRole("button", { name: "广告", exact: true }).click();
  await expect(page.getByRole("button", { name: "广告产品", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "投放", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "搜索词", exact: true })).toBeEnabled();
  await page.getByRole("combobox", { name: "广告类型", exact: true }).selectOption("sb");
  await page.getByRole("button", { name: "有点击无订单", exact: true }).click();
  await expect.poll(() => calls.filter(c => c.path.endsWith("/ads_report")).at(-1)?.query.get("quickFilter")).toBe("clicksNoOrders");
  expect(calls.filter(c => c.path.endsWith("/ads_report")).at(-1)?.query.get("adType")).toBe("sb");
  await expect(page.getByRole("button", { name: "归档", exact: true })).toBeDisabled();
  expect(calls.filter(c => c.body !== null)).toEqual([]);
});


test("profit and advertising footers use filter totals and recompute ratios rather than averaging row rates", async ({ page }) => {
  await setup(page, "domain=performance");
  await expect(page.getByLabel("筛选合计")).toContainText("毛利率 5.00%");
  await expect(page.getByLabel("筛选合计")).toContainText("销售额 200");
  await page.getByRole("button", { name: "广告", exact: true }).click();
  await expect(page.getByLabel("筛选合计")).toContainText("ACoS 5.00%");
  await expect(page.getByLabel("筛选合计")).toContainText("未知币种");
});


test("narrow viewport scrolls metrics while keeping the identity header fixed", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await setup(page);
  const scroll = page.getByTestId("sellfox-table-scroll");
  await expect(page.getByRole("columnheader", { name: "FBA可售", exact: true })).toBeAttached();
  const identity = page.getByRole("columnheader", { name: "ASIN", exact: true }).first();
  const before = await identity.boundingBox();
  await scroll.evaluate(el => { el.scrollLeft = 600; });
  const after = await identity.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);
  expect(await scroll.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/sellfox-ui-sales.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [tab, file, header] of [["销量", "sales", "小计"], ["销售利润", "performance", "毛利润"], ["在线商品", "listings", "7天销量"], ["广告", "ads", "广告订单"]]) {
    await page.getByRole("navigation", {name:"赛狐数据域"}).getByRole("button", { name: tab, exact: true }).click();
    await expect(page.getByRole("columnheader", { name: header, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "查看记录 row", exact: true })).toBeVisible();
    await scroll.evaluate(el => { el.scrollLeft = 0; });
    await page.screenshot({ path: `/tmp/sellfox-ui-${file}-desktop.png`, fullPage: true });
  }
});


test("typed exact search, reset and pagination remain local readonly requests", async ({ page }) => {
  const { calls } = await setup(page);
  await page.getByLabel("搜索类型", { exact:true }).selectOption("asin");
  await page.getByLabel("搜索记录").fill("B0EXAMPLE");
  await page.getByLabel("精确匹配", { exact:true }).check();
  await expect.poll(() => calls.filter(c=>c.path.endsWith("/sales")).at(-1)?.query.get("exactMatch")).toBe("1");
  expect(calls.filter(c=>c.path.endsWith("/sales")).at(-1)?.query.get("searchType")).toBe("asin");
  await expect(page.getByLabel("表内汇总")).toContainText("2");
  await page.getByLabel("每页条数").selectOption("20");
  await expect.poll(() => calls.filter(c=>c.path.endsWith("/sales")).at(-1)?.query.get("pageSize")).toBe("20");
  await expect(page.getByRole("button", {name:"下一页",exact:true})).toBeEnabled();
  await page.getByLabel("跳转页码").fill("3");
  await page.getByRole("button", {name:"确定",exact:true}).click();
  await expect.poll(() => calls.filter(c=>c.path.endsWith("/sales")).at(-1)?.query.get("page")).toBe("3");
  await page.getByRole("button", {name:"重置",exact:true}).click();
  await expect.poll(() => calls.filter(c=>c.path.endsWith("/sales")).at(-1)?.query.get("search")).toBeNull();
  expect(calls.filter(c=>c.path.endsWith("/sales")).at(-1)?.query.get("exactMatch")).toBeNull();
  await page.getByRole("button", {name:"广告",exact:true}).click();
  await expect(page.getByRole("button", {name:"添加广告产品",exact:true})).toBeDisabled();
  await page.getByRole("button", {name:"有花费无点击",exact:true}).click();
  await expect.poll(() => calls.filter(c=>c.path.endsWith("/ads_report")).at(-1)?.query.get("quickFilter")).toBe("spendNoClicks");
  expect(calls.filter(c=>c.body !== null)).toEqual([]);
});


test("reference layout keeps compact filter bands and domain-specific identity columns", async ({ page }) => {
  await page.setViewportSize({width:1440,height:960});
  const {calls} = await setup(page, "domain=sales&from=2026-10-18&to=2026-10-24",20);
  const expected: Record<string,string[]> = {
    sales:["图片","ASIN","店铺/站点","分析","父ASIN","MSKU","品名/SKU","标题","FBA可售","小计"],
    performance:["图片","标题/ASIN","店铺/站点","分析","毛利润"],
    listings:["","状态","图片","ASIN/MSKU","标题"],
    ads:["","图片","产品信息","有效未接","服务状态未接","FBA可售","价格","广告活动","广告组"],
  };
  for (const [domain,tab] of [["sales","销量"],["performance","销售利润"],["listings","在线商品"],["ads","广告"]]) {
    await page.getByRole("navigation", {name:"赛狐数据域"}).getByRole("button",{name:tab,exact:true}).click();
    await expect(page.getByRole("button",{name:"查看记录 row",exact:true})).toBeVisible();
    const headers=await page.locator("thead th").allTextContents();
    expect(headers.map(h=>h.replace(/星期./g,"").trim()).slice(0,expected[domain].length)).toEqual(expected[domain]);
    const filter=await page.getByLabel("筛选区",{exact:true}).boundingBox();
    expect(filter!.height).toBeLessThan(domain === "sales" ? 265 : domain === "ads" ? 255 : 215);
    await expect(page.locator("tbody tr")).toHaveCount(20);
    if (domain === "listings" || domain === "ads") {
      await page.getByLabel("选择本页记录",{exact:true}).check();
      await expect(page.locator("footer")).toContainText("本页已选 20 条");
    }
    await page.screenshot({path:`/tmp/sellfox-layout-${domain}.png`,fullPage:true});
    if (domain === "performance") await expect(page.getByRole("cell",{name:"-10",exact:true}).first()).toHaveClass(/text-emerald-600/);
    await page.setViewportSize({width:720,height:900});
    const scroller = page.getByTestId("sellfox-table-scroll");
    const identity = page.locator("thead th.sticky").last();
    const action = page.getByRole("columnheader", {name:"操作",exact:true});
    const actionBefore = ["sales", "performance"].includes(domain) ? null : await action.boundingBox();
    if (domain === "listings" || domain === "ads") expect(actionBefore!.x + actionBefore!.width).toBeLessThanOrEqual(721);
    const before = await identity.boundingBox();
    await scroller.evaluate(el=>{el.scrollLeft=500});
    const after = await identity.boundingBox();
    expect(Math.abs(before!.x-after!.x)).toBeLessThan(2);
    const actionAfter = ["sales", "performance"].includes(domain) ? null : await action.boundingBox();
    if (actionBefore && actionAfter) expect(Math.abs(actionBefore.x-actionAfter.x)).toBeLessThan(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path:`/tmp/sellfox-layout-${domain}-mobile.png`,fullPage:true});
    await page.getByRole("button",{name:"查看记录 row",exact:true}).click();
    await expect(page.getByRole("region",{name:"记录摘要",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"关闭详情",exact:true}).click();
    await page.setViewportSize({width:360,height:800});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({width:1440,height:960});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(calls.filter(c=>c.body !== null)).toEqual([]);
});


test("AWD hover details stay unknown and column settings fit the narrow viewport", async ({ page }) => {
  await page.setViewportSize({width:1440,height:900});
  const {calls} = await setup(page, "domain=sales&from=2026-10-18&to=2026-10-24",20);
  await page.getByRole("button",{name:"日矩阵（高级）",exact:true}).click();
  await page.getByText("自定义列",{exact:true}).click();
  await page.getByLabel("显示AWD库存列",{exact:true}).check();
  await page.keyboard.press("Escape");
  const trigger=page.getByRole("button",{name:"查看AWD库存明细",exact:true}).first();
  await trigger.hover();
  const hint=page.getByRole("tooltip",{name:"AWD库存明细",exact:true});
  await expect(hint).toBeVisible();
  for (const label of ["AWD可售","AWD预留","小计"]) await expect(hint.getByText(label,{exact:true})).toBeVisible();
  await expect(hint.locator("dd")).toHaveText(["—","—","—"]);
  await expect(hint).toContainText("赛狐有、API/本地无");
  await hint.getByText("AWD预留",{exact:true}).click();
  await expect(page.getByRole("region",{name:"记录摘要",exact:true})).toHaveCount(0);
  await expect(hint).toBeVisible();
  await page.screenshot({path:"/tmp/sellfox-awd-hover.png",fullPage:false});
  await page.keyboard.press("Escape");
  await expect(hint).toHaveCount(0);
  await trigger.focus();
  await expect(hint).toBeVisible();
  await page.getByTestId("sellfox-table-scroll").evaluate(el=>{el.scrollTop=120});
  await expect(hint).toHaveCount(0);
  const last=page.getByRole("button",{name:"查看AWD库存明细",exact:true}).last();
  await last.hover();
  await expect(hint).toBeVisible();
  const hintBox=await hint.boundingBox();
  expect(hintBox!.y).toBeGreaterThanOrEqual(0);expect(hintBox!.y+hintBox!.height).toBeLessThanOrEqual(900);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("columnheader",{name:"10-18",exact:true})).toHaveAttribute("title","业务日 2026-10-18");
  await page.setViewportSize({width:360,height:640});
  const summary=page.getByText("自定义列",{exact:true});
  await summary.click();
  const menu=page.getByLabel("自定义列面板",{exact:true});
  await expect(menu).toBeVisible();
  const box=await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(360);
  expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(640);
  await page.screenshot({path:"/tmp/sellfox-columns-mobile.png",fullPage:true});
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(summary).toBeFocused();
  expect(calls.filter(c=>c.body !== null)).toEqual([]);
});


test("TK shortcuts preserve scoped deep-link filters and unavailable chips stay disabled", async ({ page }) => {
  const { calls } = await setup(page, "domain=sales&shopExternalId=124687&workspaceId=workspace-a&dimension=msku", 1, true);
  // Use the labelled container because these chips do not introduce another navigation region.
  await expect(page.locator('[aria-label="TK 四店快捷"]').getByRole("button", { name: "TK店-US", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "TK店-CA", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "TK店-US", exact: true }).click();
  await expect.poll(() => calls.filter(call => call.path === "/api/sellfox/sales").at(-1)?.query.get("shopExternalId")).toBe("124687");
  await expect(page.getByRole("button", { name: "订单量", exact: true })).toBeEnabled();
  expect(calls.filter(call => call.path === "/api/sellfox/sales").at(-1)?.workspace).toBe("workspace-a");
  expect(calls.some(call => call.path === "/api/sellfox/sync")).toBe(false);
});


test("Round H2 wide default, checkbox shops, visible summary and local matrix toggle", async ({page}) => {
  const {calls} = await setup(page);
  await expect(page.getByRole("button", {name:"宽表（赛狐默认）",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByLabel("每页条数")).toHaveValue("20");
  await expect(page.getByRole("columnheader",{name:"10-24",exact:true})).toHaveCount(0);
  await expect(page.getByRole("columnheader",{name:"操作",exact:true})).toHaveCount(0);
  await expect(page.getByLabel("筛选合计",{exact:true})).toBeVisible();
  await expect(page.getByLabel("表内汇总")).toContainText("本页 0");
  await page.getByLabel("展开店铺筛选").click();
  await expect(page.locator("select[multiple]")).toHaveCount(0);
  await page.getByLabel("搜索店铺").fill("no-match");
  await expect(page.getByText("无匹配店铺",{exact:true})).toBeVisible();
  await page.getByLabel("搜索店铺").fill("workspace-a");
  await page.getByRole("button",{name:"全选搜索结果",exact:true}).click();
  await expect(page.getByRole("checkbox",{name:"店铺-workspace-a · US",exact:true})).toBeChecked();
  await page.getByRole("button",{name:"清空店铺选择",exact:true}).click();
  await expect(page.getByRole("checkbox",{name:"店铺-workspace-a · US",exact:true})).not.toBeChecked();
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"日矩阵（高级）",exact:true}).click();
  await expect(page.getByRole("columnheader",{name:"10-24",exact:true})).toBeVisible();
  await expect(page).toHaveURL(/salesView=matrix/);
  const matrixExport = await page.getByRole("link",{name:"CSV",exact:true}).getAttribute("href");
  expect(new URL(matrixExport!,"http://localhost").searchParams.getAll("column")).toContain("day:2026-10-24");
  await page.getByRole("button",{name:"宽表（赛狐默认）",exact:true}).click();
  await expect(page.getByRole("columnheader",{name:"10-24",exact:true})).toHaveCount(0);
  const wideExport = await page.getByRole("link",{name:"CSV",exact:true}).getAttribute("href");
  expect(new URL(wideExport!,"http://localhost").searchParams.getAll("column")).not.toContain("day:2026-10-24");
  await page.getByRole("button",{name:"在线商品",exact:true}).click();
  await expect(page.getByRole("button",{name:"查看记录 row",exact:true})).toHaveText("详情");
  expect(calls.filter(call=>call.body !== null)).toEqual([]);
});


test("sales currency is enabled, follows browse and export requests, and resets to all", async ({ page }) => {
  const { calls } = await setup(page);
  const currency = page.getByLabel("币种筛选");
  await expect(currency).toBeEnabled();
  await expect(currency).toHaveValue("");
  await expect.poll(() => calls.filter(c => c.path.endsWith("/sales")).at(-1)?.query.has("currency")).toBe(false);
  await currency.selectOption("CAD");
  await expect.poll(() => calls.filter(c => c.path.endsWith("/sales")).at(-1)?.query.get("currency")).toBe("CAD");
  await expect(page.getByRole("link", { name: "CSV", exact: true })).toHaveAttribute("href", /currency=CAD/);
  await page.reload();
  await expect(currency).toHaveValue("CAD");
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect(currency).toHaveValue("");
  await expect.poll(() => calls.filter(c => c.path.endsWith("/sales")).at(-1)?.query.has("currency")).toBe(false);
  await expect(page.getByRole("link", { name: "CSV", exact: true })).not.toHaveAttribute("href", /currency=/);
});

for (const domain of ["sales", "performance"] as const) {
  test(`${domain} store dimension follows URL and exports with unsupported dimensions still disabled`, async ({ page }) => {
    const { calls } = await setup(page, `domain=${domain}&dimension=store&from=2026-10-24&to=2026-10-24`);
    const tabs = page.getByRole("navigation", { name: "统计维度", exact: true });
    const store = tabs.getByRole("button", { name: "店铺", exact: true });
    const asin = page.getByRole("checkbox", { name: "按 ASIN 汇总", exact: true });
    await expect(store).toBeEnabled();
    await expect(store).toHaveAttribute("aria-pressed", "true");
    await expect(asin).not.toBeChecked();
    const latestDimension = () => calls.filter(call => call.path.endsWith(`/${domain}`)).at(-1)?.query.get("dimension");
    await expect.poll(latestDimension).toBe("store");
    await expect(page.getByRole("columnheader", { name: "店铺", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "CSV", exact: true })).toHaveAttribute("href", /dimension=store/);
    if (domain === "performance") await expect(page.getByRole("link", { name: "Excel", exact: true })).toHaveAttribute("href", /dimension=store/);
    for (const name of ["业务员"]) {
      const tab = tabs.getByRole("button", { name, exact: true });
      await expect(tab).toBeDisabled();
    }
    const developer = tabs.getByRole("button", { name: "开发员", exact: true });
    await expect(developer).toBeEnabled();
    await developer.click();
    await expect.poll(latestDimension).toBe("developer");
    if (domain === "sales") {
      const spu = tabs.getByRole("button", { name: "SPU", exact: true });
      await expect(spu).toBeEnabled();
      await spu.click();
      await expect.poll(latestDimension).toBe("spu");
      await expect(page).toHaveURL(/dimension=spu/);
    }
    if (domain === "performance") await expect(tabs.getByRole("button", { name: "SPU", exact: true })).toHaveCount(0);
    const lastDimension = domain === "sales" ? "spu" : "developer";
    await page.reload();
    await expect(tabs.getByRole("button", { name: domain === "sales" ? "SPU" : "开发员", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(latestDimension).toBe(lastDimension);
    await asin.check();
    await expect.poll(latestDimension).toBe("asin");
    await asin.uncheck();
    await expect.poll(latestDimension).toBe("msku");
    await store.click();
    await expect.poll(latestDimension).toBe("store");
    await expect(page).toHaveURL(/dimension=store/);
    expect(calls.filter(call => call.body !== null)).toEqual([]);
  });
}

test("P0 orders, settlement scope, current image and KPI follow browse and export filters", async ({ page }) => {
  const { calls } = await setup(page);
  await page.getByRole("button", {name:"订单量",exact:true}).click();
  await expect.poll(() => calls.filter(c=>c.path.endsWith("/sales")).at(-1)?.query.get("metric")).toBe("orders");
  await expect(page.getByRole("link", {name:"CSV",exact:true})).toHaveAttribute("href", /metric=orders/);
  const kpi = page.getByLabel("关键指标汇总");
  await expect(kpi).toContainText("订单量"); await expect(kpi).toContainText("USD"); await expect(kpi).toContainText("2");
  await expect(page.getByRole("link", {name:"商品主图",exact:true})).toHaveAttribute("href", "https://m.media-amazon.com/images/I/fixture.jpg?width=80&format=jpg");
  await page.getByRole("button", {name:"下一页"}).click();
  await expect(page.getByText("workspace-a-entity-page2",{exact:true})).toBeVisible();
  await expect(kpi).toContainText("订单量2");
  await page.getByRole("button", {name:"销售利润",exact:true}).click();
  await page.getByRole("checkbox", {name:"只统计已结算",exact:true}).check();
  await expect.poll(() => calls.filter(c=>c.path.endsWith("/performance")).at(-1)?.query.get("onlySettle")).toBe("1");
  await expect(page.getByRole("link",{name:"Excel",exact:true})).toHaveAttribute("href", /onlySettle=1/);
  await expect(kpi).toContainText("毛利润10"); // filtered totals, row grossProfit is -10
  await page.reload();
  await expect(page.getByRole("checkbox", {name:"只统计已结算",exact:true})).toBeChecked();
  await page.getByRole("button",{name:"重置",exact:true}).click();
  await expect(page.getByRole("checkbox", {name:"只统计已结算",exact:true})).not.toBeChecked();
});

for (const domain of ["sales", "performance"] as const) {
  test(`${domain} fallback dates populate inputs and URL once, with stable refresh and currency`, async ({ page }) => {
    const { calls } = await setup(page, `domain=${domain}&currency=&onlySettle=1`);
    const date = domain === "sales" ? "2026-10-24" : "2026-10-16";
    const browseCalls = () => calls.filter(call => call.path.endsWith(`/${domain}`));
    await expect(page.getByLabel("开始日期")).toHaveValue(date);
    await expect(page.getByLabel("结束日期")).toHaveValue(date);
    await expect.poll(() => browseCalls().length).toBe(2);
    expect(browseCalls()[0].query.has("from")).toBe(false);
    expect(new URL(page.url()).searchParams.get("from")).toBe(date);
    expect(new URL(page.url()).searchParams.get("to")).toBe(date);
    await expect(page.getByLabel("币种筛选")).toHaveValue("");
    const expected = browseCalls()[1].query.toString();
    await expect(page.getByRole("link", { name: "CSV", exact: true })).toHaveAttribute("href", new RegExp(`from=${date}&to=${date}`));
    await page.waitForTimeout(750); // More than two request debounce windows: no backfill loop.
    expect(browseCalls()).toHaveLength(2);
    await page.getByRole("button", { name: "刷新本地列表", exact: true }).click();
    await expect.poll(() => browseCalls().length).toBe(3);
    expect(browseCalls()[2].query.toString()).toBe(expected);
    await page.reload();
    await expect.poll(() => browseCalls().length).toBe(4);
    expect(browseCalls()[3].query.toString()).toBe(expected);
    await expect(page.getByLabel("开始日期")).toHaveValue(date);
    await expect(page.getByLabel("币种筛选")).toHaveValue("");
  });
}

test("profit thumbnails load safely, missing images stay blank and fee zeros/numbers reach rows and KPI", async ({ page }) => {
  const { calls } = await setup(page, "domain=performance", 2);
  const image = page.getByRole("img", { name: "商品主图", exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(image).toHaveAttribute("loading", "lazy");
  await expect(image.locator("..")).toHaveAttribute("href", "https://m.media-amazon.com/images/I/fixture.jpg?width=80&format=jpg");
  await expect(image.locator("..")).toHaveAttribute("target", "_blank");
  const popupPromise = page.waitForEvent("popup");
  await image.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://m.media-amazon.com/images/I/fixture.jpg?width=80&format=jpg");
  await popup.close();
  await expect(page.getByRole("region", { name: "记录摘要" })).toHaveCount(0);
  const rows = page.locator("tbody tr");
  const headers = await page.getByRole("columnheader").allTextContents();
  const promotion = headers.indexOf("促销折扣"), gift = headers.indexOf("礼品包装费");
  await expect(rows.nth(0).locator("td").nth(promotion)).toHaveText("0");
  await expect(rows.nth(0).locator("td").nth(gift)).toHaveText("1,234.5");
  await expect(rows.nth(1).locator("td").first()).toHaveText("—");
  await expect(page.getByLabel("关键指标汇总")).toContainText("促销折扣12.5");
  await expect(page.getByLabel("关键指标汇总")).toContainText("礼品包装费0");
  await expect(page.getByLabel("立即同步资源")).toContainText("销售利润");
  await expect(page.getByLabel("开始日期")).toHaveValue("2026-10-16");
  await expect(page.getByLabel("结束日期")).toHaveValue("2026-10-16");
  await expect(page.getByRole("cell", { name: "图", exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "只统计已结算", exact: true }).check();
  await expect.poll(() => calls.filter(call => call.path.endsWith("/performance")).at(-1)?.query.get("onlySettle")).toBe("1");
  await expect(rows.nth(0).locator("td").nth(promotion)).toHaveText("0");
  await expect(rows.nth(0).locator("td").nth(gift)).toHaveText("0");
  await expect(page.getByLabel("关键指标汇总")).toContainText("促销折扣0");
  await expect(page.getByLabel("关键指标汇总")).toContainText("礼品包装费0");
  await expect(image).toBeVisible();
  await expect(page.getByRole("cell", { name: "图", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("开始日期")).toHaveValue("2026-10-16");
  await expect(page.getByLabel("结束日期")).toHaveValue("2026-10-16");
  expect(calls.filter(call => call.body !== null)).toEqual([]);
});


test("ads default image precedes product info with tags, brand and fulfillment across six tabs and explicit column selections survive tab changes", async ({ page }) => {
  await setup(page, "domain=ads&from=2026-10-24&to=2026-10-24");
  for (const label of ["广告产品", "投放", "搜索词", "广告活动", "广告组", "广告位"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const image = page.getByRole("columnheader", { name: "图片", exact: true });
    await expect(image).toBeVisible();
    await expect(image.getByRole("button")).toHaveCount(0);
    const headers = await page.locator("thead th").allTextContents();
    expect(headers[headers.indexOf("图片") + 1]).toBe("产品信息");
    for (const name of ["标签", "品牌", "发货方式"]) await expect(page.getByRole("columnheader", { name, exact: true })).toBeVisible();
    await page.getByText("自定义列", { exact: true }).click();
    for (const name of ["图片", "星级", "评论数", "标签", "品牌", "发货方式", "Buy Box"]) await expect(page.getByRole("checkbox", { name: `显示${name}列`, exact: true })).toBeChecked();
    for (const name of ["MSKU", "标题", "店铺", "站点"]) await expect(page.getByRole("checkbox", { name: `显示${name}列`, exact: true })).not.toBeChecked();
    await page.getByText("自定义列", { exact: true }).click();
    for (const name of ["CSV", "Excel"]) {
      const href = await page.getByRole("link", { name, exact: true }).getAttribute("href");
      expect(new URL(href!, page.url()).searchParams.has("column")).toBe(false);
    }
  }
  await page.getByText("自定义列", { exact: true }).click();
  await page.getByRole("checkbox", { name: "显示图片列", exact: true }).uncheck();
  for (const name of ["星级", "评论数", "标签", "品牌", "发货方式", "Buy Box"]) {
    await page.getByRole("checkbox", { name: `显示${name}列`, exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole("columnheader", { name: "图片", exact: true })).toHaveCount(0);
  for (const name of ["CSV", "Excel"]) {
    const href = await page.getByRole("link", { name, exact: true }).getAttribute("href");
    const params = new URL(href!, page.url()).searchParams;
    expect(params.get("columns")).toBe("custom");
    for (const key of ["image", "rating", "ratingCount", "productTags", "brand", "fulfillment", "buyBoxWinner"]) expect(params.getAll("column")).not.toContain(key);
  }
  await page.getByText("自定义列", { exact: true }).click();
  await page.getByRole("button", { name: "广告产品", exact: true }).click();
  for (const name of ["图片", "星级", "评论数", "标签", "品牌", "发货方式", "Buy Box"]) await expect(page.getByRole("columnheader", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "广告位", exact: true }).click();
  for (const name of ["图片", "星级", "评论数", "标签", "品牌", "发货方式", "Buy Box"]) await expect(page.getByRole("columnheader", { name, exact: true })).toHaveCount(0);
});

test("ads targeting/search-term tabs navigate endpoints, columns, export, history and active sync resource", async ({ page }) => {
  const { calls } = await setup(page, "domain=ads&from=2026-10-24&to=2026-10-24&adType=sb");
  for (const [label, tab, resource, column] of [["投放", "targeting", "ads_targeting", "投放ID"], ["搜索词", "searchTerm", "ads_search_term", "用户搜索词"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(new RegExp(`adsTab=${tab}`));
    await expect.poll(() => calls.filter(c => c.path.endsWith(`/${resource}`)).at(-1)?.query.get("layout")).toBe("workbench");
    await expect(page.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "CSV", exact: true })).toHaveAttribute("href", new RegExp(`${resource}/export`));
    await expect(page.getByLabel("立即同步资源")).toHaveValue(resource);
  }
  for (const label of ["广告组合", "否定", "AMC"]) await expect(page.getByRole("button", { name: `${label} · 待接`, exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "查看记录 row", exact: true }).click();
  await page.getByText("展开原始摘要", { exact: true }).click();
  await expect.poll(() => calls.some(c => c.path.endsWith("/ads_search_term/row"))).toBe(true);
  await page.goBack();
  await expect(page.getByLabel("立即同步资源")).toHaveValue("ads_targeting");
  await page.getByRole("button", { name: "同步当前报表", exact: true }).click();
  await expect.poll(() => calls.filter(c => c.path.endsWith("/sync")).at(-1)?.body).toEqual({ resource: "ads_targeting", shopExternalIds: [], startDate: "2026-10-24", endDate: "2026-10-24", adTypes: ["sb"] });
});

test("ads campaign/group/placement tabs expose daily reports, typed search, exports and active sync", async ({ page }) => {
  const { calls } = await setup(page, "domain=ads&from=2026-10-24&to=2026-10-24&adType=sp");
  for (const [label, tab, resource, column, searchType] of [["广告活动", "campaign", "ads_campaign", "活动名称", "campaignId"], ["广告组", "adGroup", "ads_ad_group", "广告组名称", "adGroupId"], ["广告位", "placement", "ads_placement", "广告位", "placement"]]) {
    const button = page.getByRole("button", { name: label, exact: true });
    await expect(button).toBeEnabled(); await button.click();
    await expect(button).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(new RegExp(`adsTab=${tab}`));
    await expect.poll(() => calls.filter(c => c.path.endsWith(`/${resource}`)).at(-1)?.query.get("layout")).toBe("workbench");
    await expect(page.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
    if (tab === "campaign") await expect(page.getByRole("columnheader", { name: "广告组", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "CSV", exact: true })).toHaveAttribute("href", new RegExp(`${resource}/export`));
    await expect(page.getByLabel("立即同步资源")).toHaveValue(resource);
    await page.getByLabel("搜索类型", { exact: true }).selectOption(searchType);
    await page.getByLabel("搜索记录").fill("fixture");
    await expect.poll(() => calls.filter(c => c.path.endsWith(`/${resource}`)).at(-1)?.query.get("searchType")).toBe(searchType);
    await page.getByRole("button", { name: "同步当前报表", exact: true }).click();
    await expect.poll(() => calls.filter(c => c.path.endsWith("/sync")).at(-1)?.body).toEqual({ resource, shopExternalIds: [], startDate: "2026-10-24", endDate: "2026-10-24", adTypes: ["sp"] });
    await expect(page).toHaveURL(/domain=runs/);
    await page.goBack();
    await expect(button).toHaveAttribute("aria-current", "page");
  }
  for (const label of ["广告组合", "否定", "AMC"]) {
    const button = page.getByRole("button", { name: `${label} · 待接`, exact: true });
    await expect(button).toBeDisabled(); await expect(button).toHaveAttribute("title", /portfolios|结构 API|暂无已知|domain=runs/);
  }
  await page.getByRole("button", { name: "查看记录 row", exact: true }).click();
  await page.getByText("展开原始摘要", { exact: true }).click();
  await expect.poll(() => calls.some(c => c.path.endsWith("/ads_placement/row"))).toBe(true);
  await page.getByRole("button", { name: "概览", exact: true }).click();
  for (const resource of ["广告活动日报", "广告组日报", "广告位日报"]) {
    const checkbox = page.getByRole("checkbox", { name: `${resource}定时同步`, exact: true });
    await expect(checkbox).toBeEnabled(); await expect(checkbox).not.toBeChecked();
    await expect(checkbox.locator("..")).toContainText("每日 06:30（北京时间）");
  }
});

for (const [domain, adsTab, endpoint, column, sortBy] of [
  ["sales", "", "sales", "小计", "subtotal"],
  ["performance", "", "performance", "毛利润", "grossProfit"],
  ["listings", "", "listings", "7天销量", "sales7"],
  ["ads", "product", "ads_report", "花费", "cost"],
  ["ads", "targeting", "ads_targeting", "投放ID", "targetingId"],
  ["ads", "searchTerm", "ads_search_term", "用户搜索词", "searchTerm"],
  ["ads", "campaign", "ads_campaign", "活动名称", "campaignName"],
  ["ads", "adGroup", "ads_ad_group", "广告组名称", "adGroupName"],
  ["ads", "placement", "ads_placement", "广告位", "placement"],
  ["stores", "", "stores", "店铺", "name"],
  ["inventory", "", "inventory", "可售库存", "quantity"],
  ["runs", "", "runs", "开始时间", "startedAt"],
]) test(`${endpoint} headers toggle server sort, preserve filters and reset pagination`, async ({ page }) => {
  const { calls } = await setup(page, `domain=${domain}&adsTab=${adsTab}&from=2026-10-24&to=2026-10-24&page=2&site=US&search=needle`);
  const header = page.getByRole("columnheader", { name: column, exact: true });
  const button = header.getByRole("button", { name: `按${column}排序`, exact: true });
  await expect(button).toBeEnabled();
  await expect(header).not.toHaveAttribute("aria-sort");
  await button.click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await expect(button).toBeEnabled();
  let latest = calls.filter(call => call.path === `/api/sellfox/${endpoint}`).at(-1)!;
  expect(latest.query.get("sortBy")).toBe(sortBy); expect(latest.query.get("sortOrder")).toBe("asc");
  expect(latest.query.get("page")).toBe("1"); expect(latest.query.get("search")).toBe("needle");
  expect(latest.query.get("from")).toBe("2026-10-24");
  expect(latest.query.get("site")).toBe(domain === "runs" ? null : "US");
  await expect(page).toHaveURL(new RegExp(`sortBy=${sortBy}&sortOrder=asc`));
  await expect(page.getByRole("link", { name: "CSV", exact: true })).toHaveAttribute("href", new RegExp(`sortBy=${sortBy}&sortOrder=asc`));
  if (!["stores", "runs"].includes(domain)) {
    const agent = page.getByRole("link", { name: "给 Agent 的导出 CSV（业务窄列）", exact: true });
    await expect(agent).toHaveAttribute("href", /agent=1/);
    await expect(agent).not.toHaveAttribute("href", /sortBy=/);
  }
  await button.click();
  await expect(header).toHaveAttribute("aria-sort", "descending");
  await expect(button).toBeEnabled();
  latest = calls.filter(call => call.path === `/api/sellfox/${endpoint}`).at(-1)!;
  expect(latest.query.get("sortOrder")).toBe("desc");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(button).toBeEnabled();
  latest = calls.filter(call => call.path === `/api/sellfox/${endpoint}`).at(-1)!;
  expect(latest.query.get("page")).toBe("2"); expect(latest.query.get("sortOrder")).toBe("desc");
  await page.reload();
  await expect(header).toHaveAttribute("aria-sort", "descending");
  await expect(button).toBeEnabled();
  await page.goBack();
  await expect(button).toBeEnabled();
  expect(new URL(page.url()).searchParams.get("page")).toBeNull();
  expect(new URL(page.url()).searchParams.get("sortOrder")).toBe("desc");
  expect(calls.filter(call => call.body !== null)).toEqual([]);
});

test("changing domains or ad subtabs clears stale sort and unsupported columns stay plain", async ({ page }) => {
  await setup(page, "domain=sales&sortBy=subtotal&sortOrder=desc&from=2026-10-24&to=2026-10-24");
  await expect(page.getByRole("columnheader", { name: "小计", exact: true })).toHaveAttribute("aria-sort", "descending");
  for (const name of ["图片", "分析", "FBA可售"]) await expect(page.getByRole("columnheader", { name, exact: true }).getByRole("button")).toHaveCount(0);
  await page.getByRole("navigation", { name: "赛狐数据域" }).getByRole("button", { name: "广告", exact: true }).click();
  await expect(page.getByRole("button", { name: "按花费排序", exact: true })).toBeEnabled();
  expect(new URL(page.url()).searchParams.has("sortBy")).toBe(false);
  await page.getByRole("button", { name: "按花费排序", exact: true }).click();
  await expect(page.getByRole("button", { name: "按花费排序", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "广告活动", exact: true }).click();
  await expect(page.getByRole("button", { name: "按活动名称排序", exact: true })).toBeEnabled();
  expect(new URL(page.url()).searchParams.has("sortBy")).toBe(false);
});


test("ads log navigation opens existing sync runs without submitting a sync", async ({ page }) => {
  const { calls } = await setup(page, "domain=ads&adsTab=targeting&page=2&searchType=targetingId&adType=sb&sortBy=cost&sortOrder=desc");
  const logs = page.getByRole("button", { name: "日志", exact: true });
  await expect(logs).toBeEnabled();
  await expect(logs).toHaveAttribute("title", /同步日志.*domain=runs.*非广告专属/);
  await expect(page.getByRole("button", { name: "日志 · 待接", exact: true })).toHaveCount(0);
  await logs.click();
  await expect(page).toHaveURL(/domain=runs/);
  await expect.poll(() => calls.filter(call => call.path.endsWith("/runs")).at(-1)?.query.get("page")).toBe("1");
  for (const key of ["searchType", "sortBy"]) expect(new URL(page.url()).searchParams.has(key)).toBe(false);
  // Existing navigation retains inactive ad choices in the URL, but runs requests omit them.
  for (const key of ["searchType", "adsTab", "adType", "sortBy"]) expect(calls.filter(call => call.path.endsWith("/runs")).at(-1)!.query.has(key)).toBe(false);
  expect(calls.filter(call => call.body !== null)).toEqual([]);
  await page.goBack();
  await expect(page.getByRole("button", { name: "投放", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/page=2/);
});

test("listings default brand, amazonBrand, rating, ratingCount, productTags, openDate, firstSaleDate, BSR, BSR类目, fee cluster, Buy Box, profit/shipping, totalInventory, inventory extras and fulfillment remain checked until explicitly hidden in the session", async ({ page }) => {
  await setup(page, "domain=listings");
  for (const label of ["发货方式", "品牌", "亚马逊品牌", "星级", "评论数", "产品标签", "上架时间", "首次售出", "BSR", "BSR类目", "采购成本", "FBA费用", "佣金", "总费用", "头程", "Buy Box", "预留", "运费", "预估利润", "利润率", "总库存", "库存快照时间", "Listing库存", "不可售", "入库中"]) await expect(page.getByRole("columnheader", { name: label, exact: true })).toBeVisible();
  for (const name of ["CSV", "Excel"]) await expect(page.getByRole("link", { name, exact: true })).not.toHaveAttribute("href", /column=/);
  await page.getByText("自定义列", { exact: true }).click();
  for (const label of ["发货方式", "品牌", "亚马逊品牌", "星级", "评论数", "产品标签", "上架时间", "首次售出", "BSR", "BSR类目", "采购成本", "FBA费用", "佣金", "总费用", "头程", "Buy Box", "预留", "运费", "预估利润", "利润率", "总库存", "库存快照时间", "Listing库存", "不可售", "入库中"]) {
    const checkbox = page.getByRole("checkbox", { name: `显示${label}列`, exact: true });
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
  }
  await page.keyboard.press("Escape");
  for (const name of ["CSV", "Excel"]) {
    const href = await page.getByRole("link", { name, exact: true }).getAttribute("href");
    const selected = new URL(href!, "http://127.0.0.1:43221").searchParams.getAll("column");
    expect(selected).toContain("title");
    expect(selected).not.toContain("brand");
    expect(selected).not.toContain("amazonBrand");
    expect(selected).not.toContain("productTags");
    expect(selected).not.toContain("rating");
    expect(selected).not.toContain("ratingCount");
    expect(selected).not.toContain("buyBoxWinner");
    expect(selected).not.toContain("openDate");
    expect(selected).not.toContain("firstSaleDate");
    expect(selected).not.toContain("bsrRank");
    expect(selected).not.toContain("bsrCategory");
    for (const key of ["purchaseCost", "fbaFees", "referralFee", "totalFee", "headTripCost"]) expect(selected).not.toContain(key);
    for (const key of ["reservedQty", "shippingPrice", "profitPrice", "profitRate"]) expect(selected).not.toContain(key);
    expect(selected).not.toContain("totalInventory");
    for (const key of ["inventoryCapturedAt", "listingQuantity", "unsellable", "warehousing"]) expect(selected).not.toContain(key);
    expect(selected).not.toContain("fulfillment");
  }
  const tabs = page.getByRole("navigation", { name: "赛狐数据域" });
  await tabs.getByRole("button", { name: "销量", exact: true }).click();
  await tabs.getByRole("button", { name: "在线商品", exact: true }).click();
  for (const label of ["发货方式", "品牌", "亚马逊品牌", "星级", "评论数", "产品标签", "上架时间", "首次售出", "BSR", "BSR类目", "采购成本", "FBA费用", "佣金", "总费用", "头程", "Buy Box", "预留", "运费", "预估利润", "利润率", "总库存", "库存快照时间", "Listing库存", "不可售", "入库中"]) await expect(page.getByRole("columnheader", { name: label, exact: true })).toHaveCount(0);
  for (const name of ["CSV", "Excel"]) {
    const href = await page.getByRole("link", { name, exact: true }).getAttribute("href");
    const selected = new URL(href!, "http://127.0.0.1:43221").searchParams.getAll("column");
    expect(selected).not.toContain("amazonBrand");
    expect(selected).not.toContain("productTags");
    expect(selected).not.toContain("openDate");
    expect(selected).not.toContain("firstSaleDate");
    expect(selected).not.toContain("bsrRank");
    expect(selected).not.toContain("bsrCategory");
    for (const key of ["purchaseCost", "fbaFees", "referralFee", "totalFee", "headTripCost"]) expect(selected).not.toContain(key);
    for (const key of ["reservedQty", "shippingPrice", "profitPrice", "profitRate"]) expect(selected).not.toContain(key);
    expect(selected).not.toContain("totalInventory");
    for (const key of ["inventoryCapturedAt", "listingQuantity", "unsellable", "warehousing"]) expect(selected).not.toContain(key);
    expect(selected).not.toContain("fulfillment");
  }
  await page.getByText("自定义列", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "显示亚马逊品牌列", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "显示上架时间列", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "显示首次售出列", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "显示BSR列", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "显示BSR类目列", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "显示总库存列", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "显示发货方式列", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "显示产品标签列", exact: true })).not.toBeChecked();
  for (const label of ["采购成本", "FBA费用", "佣金", "总费用", "头程", "预留", "运费", "预估利润", "利润率", "库存快照时间", "Listing库存", "不可售", "入库中"]) await expect(page.getByRole("checkbox", { name: `显示${label}列`, exact: true })).not.toBeChecked();
});

test("listing DXM publish state is optional and does not imply pairing or strikethrough price type", async ({ page }) => {
  await setup(page, "domain=listings");
  await expect(page.getByRole("columnheader", { name: "DXM 发布状态", exact: true })).toHaveCount(0);
  for (const [label, reason] of [["配对状态", /dxmPublishState.*尚无配对状态字段与稳定枚举/], ["划线价类型", /listingPrice\/listingPricing.*枚举尚未验证/]] as const) {
    const select = page.getByLabel(`${label}（未同步）`, { exact: true });
    await expect(select).toBeDisabled();
    await expect(select.locator("..")).toHaveAttribute("title", reason);
  }
  await page.getByText("自定义列", { exact: true }).click();
  await page.getByLabel("显示DXM 发布状态列", { exact: true }).check();
  const header = page.getByRole("columnheader", { name: "DXM 发布状态", exact: true });
  await expect(header).toBeVisible();
  await expect(header.getByRole("button")).toHaveCount(0);
  const headers = await page.locator("thead th").allTextContents();
  await expect(page.locator("tbody tr").first().locator("td").nth(headers.indexOf("DXM 发布状态"))).toHaveText("delete");
  await expect(page.getByRole("link", { name: "CSV", exact: true })).toHaveAttribute("href", /column=dxmPublishState/);
});


test("performance salesperson selection, default names column, URL, exports and reset; sales stays disabled", async ({ page }) => {
  const { calls } = await setup(page, "domain=performance&from=2026-10-24&to=2026-10-24");
  await expect(page.getByRole("columnheader", { name: "业务员", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "温见清、陈馨", exact: true })).toBeVisible();
  for (const name of ["CSV", "Excel"]) await expect(page.getByRole("link", { name, exact: true })).not.toHaveAttribute("href", /column=/);
  const select = page.getByRole("combobox", { name: "业务员", exact: true });
  await expect(select).toBeEnabled(); await select.selectOption("温见清");
  await expect.poll(() => calls.filter(c => c.path.endsWith("/performance")).at(-1)?.query.get("salesperson")).toBe("温见清");
  const tabs = page.getByRole("navigation", { name: "统计维度", exact: true });
  await expect(tabs.getByRole("button", { name: "业务员", exact: true })).toBeDisabled();
  await page.getByText("自定义列", { exact: true }).click();
  const column = page.getByRole("checkbox", { name: "显示业务员列", exact: true });
  await expect(column).toBeEnabled(); await expect(column).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("columnheader", { name: "业务员", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "温见清、陈馨", exact: true })).toBeVisible();
  for (const name of ["CSV", "Excel"]) await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute("href", /salesperson=/);
  await page.reload(); await expect(select).toHaveValue("温见清");
  await page.getByRole("button", { name: "重置", exact: true }).click(); await expect(select).toHaveValue("");
  await expect.poll(() => calls.filter(c => c.path.endsWith("/performance")).at(-1)?.query.has("salesperson")).toBe(false);
  await page.goto("http://127.0.0.1:43221/?domain=sales&from=2026-10-24&to=2026-10-24");
  await expect(page.getByRole("combobox", { name: "业务员（未同步）", exact: true })).toBeDisabled();
});
