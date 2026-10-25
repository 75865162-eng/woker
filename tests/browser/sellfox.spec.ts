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
async function setup(page: Page, params = "domain=sales&from=2026-10-24&to=2026-10-24", rowCount = 1) {
  const calls: Array<{ path: string; query: URLSearchParams; workspace: string; body: unknown }> = [];
  const state = { configured: true, delayPath: "", pending: false, release: () => {} };
  await page.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
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
    const store = { id: `store-${workspace}`, externalId: `shop-${workspace}`, name: `店铺-${workspace}`, marketplace: "US", country: "US", status: "active", lastSyncedAt: "2026-10-24T00:00:00Z" };
    if (url.pathname.endsWith("/overview")) return route.fulfill({ json: { configured: state.configured, stores: [store], counts: { stores: 1, inventory: 1, sales: 1, performance: 1, hourly: 0 }, latestRuns: [], latestSuccessByResource: {}, workerOnline: true } });
    if (url.pathname.endsWith("/schedules")) return route.fulfill({ json: { schedules: [{ resource: "performance", enabled: false, intervalMinutes: 1440 }] } });
    if (url.pathname.endsWith("/sync")) return route.fulfill({ status: 202, json: { runId: "test-run", status: "queued" } });
    if (/\/(sales|performance|runs)\/row$/.test(url.pathname)) return route.fulfill({ json: { payload: { msku: "test-msku", token: "[已隐藏]" }, truncated: true } });
    const domain = url.pathname.split("/").pop();
    const from = url.searchParams.get("from") || "2026-10-24", to = url.searchParams.get("to") || from;
    const dates = Array.from({length: Math.min(90,Math.max(1,(Date.parse(to)-Date.parse(from))/86400000+1))}, (_,i)=>new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10));
    const daily = Object.fromEntries(dates.map(d=>[d,2]));
    if (["sales", "performance", "runs", "inventory", "hourly", "stores", "listings", "ads_report"].includes(domain ?? "")) return route.fulfill({ json: { totals: domain === "performance" ? [{currency:"USD", grossProfit:10, saleRevenue:200, netRevenue:180, orderNum:4, saleQuantity:5, adCost:2}] : domain === "ads_report" ? [{currency:null,cost:10,clicks:20,adOrders:2,adSales:200}] : domain === "sales" ? [{ currency:"USD", subtotal:2, daily }] : [], dates: domain === "sales" ? dates : [], rows: Array.from({length: rowCount}, (_, index) => ({ id: index ? `row-${index}` : "row", identity: `${workspace}-entity-page${url.searchParams.get("page") || 1}${index ? `-${index}` : ""}`, asin: `B0SAMPLE${String(index).padStart(3,"0")}`, daily, dailyQuantity: daily, ...Object.fromEntries(dates.map(d=>[`day:${d}`,2])), average7:2, title: `布局样本商品标题 ${index+1}`, grossProfit: -10, saleRevenue:200, netRevenue:180, orderNum:4, adCost:2, subtotal: 2, reportDate: "2026-10-24", sku: `${workspace}-SKU-page${url.searchParams.get("page") || 1}`, msku: "test-msku", quantity: null, revenue: 20, currency: "USD", saleQuantity: 2, fbaQuantity: 1, fbmQuantity: 1, grossProfitRate: 0.1, refundRate: 0.05, impressions: 100, clicks: 2, cost: 1.5, adOrders: 1, adSales: 12, acos:0.125, roas:8, sales7: 2, fulfillable: 0, resource: domain === "runs" ? "performance" : undefined, status: domain === "runs" ? "running" : domain === "listings" ? "active" : undefined, summary: { progress: { count: 42 } }, SellfoxStore: store })), pagination: { page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 50), total: 51 } } });
    throw new Error(`Unexpected test request: ${url.pathname}`);
  });
  await page.goto(`http://127.0.0.1:43221/?${params}`);
  return { calls, state };
}

test("daily multi-store browsing, shared filters, pagination and browser navigation", async ({ page }) => {
  const { calls } = await setup(page);
  await expect(page.getByText("workspace-a-entity-page1", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "小计", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "10-24", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "库存", exact: true })).toHaveCount(0);
  await page.getByLabel("展开店铺筛选").click();
  await page.getByLabel("店铺筛选", {exact:true}).selectOption(["shop-workspace-a"]);
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
  await expect(page.getByRole("checkbox", {name:"只统计已结算",exact:true})).toBeDisabled();
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
  await expect(page.getByLabel("店铺筛选", {exact:true}).locator("option")).toHaveText(["店铺-workspace-b · US"]);
  state.release();
  await expect(page.getByLabel("店铺筛选", {exact:true}).locator("option")).toHaveText(["店铺-workspace-b · US"]);
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
  await page.getByRole("button", { name: "在线 Listing", exact: true }).click();
  await expect(page.getByLabel("Listing 状态")).toBeVisible();
  await page.getByRole("button", { name: "广告", exact: true }).click();
  await expect(page.getByLabel("广告类型",{exact:true})).toBeVisible();
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
  await expect(page.getByRole("columnheader", { name: "10-24", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "父ASIN", exact: true }).click();
  await page.getByRole("button", {name:"销售额",exact:true}).click();
  await page.getByLabel("隐藏销量为 0").check();
  await expect.poll(() => calls.filter(c => c.path.endsWith("/sales")).at(-1)?.query.get("hideZero")).toBe("1");
  const last = calls.filter(c => c.path.endsWith("/sales")).at(-1)!;
  expect(last.query.get("dimension")).toBe("parentAsin"); expect(last.query.get("metric")).toBe("revenue");
  await expect(page.getByRole("button", { name: "SPU", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "实时统计", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "实时统计", exact: true })).not.toBeChecked();
  await page.getByText("自定义列", { exact: true }).click();
  await page.getByLabel("显示标题列", { exact: true }).check();
  await expect(page.getByRole("columnheader", { name:"标题",exact:true })).toBeVisible();
  await page.getByLabel("显示标题列", { exact: true }).uncheck();
  const href = await page.getByRole("link", { name: "CSV", exact: true }).getAttribute("href");
  const params = new URL(href!, "http://localhost").searchParams;
  expect(params.getAll("column")).not.toContain("title"); expect(params.getAll("column")).toContain("subtotal");
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
  await expect(page.getByRole("button", { name: "搜索词 · 待接", exact: true })).toBeDisabled();
  await page.getByLabel("广告类型", { exact: true }).selectOption("sb");
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
  await expect(page.getByRole("columnheader", { name: "10-24", exact: true })).toBeAttached();
  const identity = page.getByRole("columnheader", { name: "ASIN", exact: true }).first();
  const before = await identity.boundingBox();
  await scroll.evaluate(el => { el.scrollLeft = 600; });
  const after = await identity.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);
  expect(await scroll.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/sellfox-ui-sales.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [tab, file, header] of [["销量", "sales", "小计"], ["销售利润", "performance", "毛利润"], ["在线 Listing", "listings", "7天销量"], ["广告", "ads", "广告订单"]]) {
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
    sales:["图片","ASIN","店铺/站点","总库存","AWD库存未接","AWD在途未接","近7天销量趋势","均值","小计",...Array.from({length:7},(_,i)=>`10-${18+i}`),"操作"],
    performance:["图片","标题/ASIN","父ASIN","品名/SKU","毛利润"],
    listings:["","状态","图片","ASIN/MSKU","标题"],
    ads:["","产品信息","有效未接","服务状态未接","FBA可售","价格","广告活动","广告组"],
  };
  for (const [domain,tab] of [["sales","销量"],["performance","销售利润"],["listings","在线 Listing"],["ads","广告"]]) {
    await page.getByRole("navigation", {name:"赛狐数据域"}).getByRole("button",{name:tab,exact:true}).click();
    await expect(page.getByRole("button",{name:"查看记录 row",exact:true})).toBeVisible();
    const headers=await page.locator("thead th").allTextContents();
    expect(headers.map(h=>h.replace(/星期./g,"").trim()).slice(0,expected[domain].length)).toEqual(expected[domain]);
    const filter=await page.getByLabel("筛选区",{exact:true}).boundingBox();
    expect(filter!.height).toBeLessThan(domain === "ads" ? 255 : 215);
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
    const actionBefore = await action.boundingBox();
    expect(actionBefore!.x + actionBefore!.width).toBeLessThanOrEqual(721);
    const before = await identity.boundingBox();
    await scroller.evaluate(el=>{el.scrollLeft=500});
    const after = await identity.boundingBox();
    expect(Math.abs(before!.x-after!.x)).toBeLessThan(2);
    const actionAfter = await action.boundingBox();
    expect(Math.abs(actionBefore!.x-actionAfter!.x)).toBeLessThan(2);
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
