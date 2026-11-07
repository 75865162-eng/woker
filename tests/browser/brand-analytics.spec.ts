import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
let bundle: string;
test.beforeAll(async () => { const r = await build({ entryPoints: ["tests/browser/brand-analytics-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } }); bundle = r.outputFiles[0].text; });
async function setup(page: Page, repeat = false, emptyReports = false) {
  const calls: Array<Record<string, unknown>> = [], reads: URLSearchParams[] = []; let denied = false, pendingStatus = "MISSING";
  const configuration = { id: "brand-source", revision: 2, authorizationId: "fixture-auth", sellerAccountId: "fixture-seller", marketplaceId: "ATVPDKIKX0DER", enabled: true, freshnessMinutes: 1440, seller: { displayName: "Fixture Brand" }, domainPolicy: { resource: "brand_analytics", applicationId: "fixture", reportKind: "search_terms", reportPeriod: "WEEK", from: "2025-01-05", to: "2025-01-11", asins: [], maxRequests: 30, maxRows: 1000, requestsPerSecond: .01, brandEligibilityAttested: true, marketplaceTimeZone: "America/Los_Angeles" } };
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()); expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    expect(request.headers()["x-workspace-id"]).toBe("brand-fixture");
    if (request.method() === "POST") { calls.push(request.postDataJSON()); return route.fulfill({ status: 202, json: { approvalRequired: true } }); }
    const p = url.searchParams; reads.push(p);
    if (denied) return route.fulfill({ status: 403, json: { error: "品牌来源不可访问。" } });
    if (p.get("section") === "brand-asins") return route.fulfill({ json: { manifest: { total: 1, ids: ["B123456789"], runId: "catalog-fixture" }, note: "需核验品牌资格" } });
    const reportKind = p.get("reportKind"), coverage = { reportKind, reportPeriod: "WEEK", from: "2025-01-05", to: "2025-01-11", asins: [] };
    const facts = { ...coverage, asin: "B123456789", clickedAsin: "B123456789", searchTerm: "fixture-query", searchFrequencyRank: "10", clickShare: "0.0771", searchQueryData: { searchQuery: "fixture-query", searchQueryScore: "7", searchQueryVolume: "120" }, impressionData: { asinImpressionCount: "12", impressionCount: "20", impressionMedianPrice: { amount: "12.30", currencyCode: "USD" } }, purchaseData: { searchTrafficSales: { amount: "12.30", currencyCode: "USD" } }, purchasedWithAsin: "B987654321", combinationPct: "0.1", orders: "1256", uniqueCustomers: "1201", repeatCustomersPctTotal: "0.0083", repeatPurchaseRevenue: { amount: "2246.13", currencyCode: "USD" }, repeatPurchaseRevenuePctTotal: "0.0217" };
    const product = { asin: "B123456789", title: "Scoped product", brand: "Scoped Brand", skus: ["sku-a", "sku-b"], thumbnailUrl: null, catalogRunId: null, capturedAt: null, detailRunIds: [] };
    const products = { B123456789: product, B987654321: { ...product, asin: "B987654321", title: "Basket partner" } };
    if (p.get("section") === "brand-asin-analysis") return route.fulfill({ json: { asin: p.get("asin"), reportPeriod: p.get("reportPeriod"), source: configuration, products, productWarnings: [], reports: ["search_terms", "search_query", "search_catalog", "market_basket", "repeat_purchase"].map(reportKind => ({ reportKind, unavailable: false, result: { rows: [{ id: reportKind, sourceRunId: "brand-run", facts, capturedAt: "2025-01-15T00:00:00Z" }], run: { id: "brand-run", coverage }, batchCount: 1, pagination: { total: 51, pageCount: 2 } } })) } });
    return route.fulfill({ json: { products, productWarnings: [], sources: [configuration], source: configuration, configuration, plans: [], collection: p.get("coverage") === "1" ? { definition: { from: "2025-01-05", to: "2025-01-11", asins: ["B123456789"] }, total: 2, completed: pendingStatus === "EMPTY" ? 2 : 1, complete: pendingStatus === "EMPTY", items: [{ ...coverage, key: "one", status: "SUCCEEDED", rows: 1, taskId: "brand-run" }, { ...coverage, key: "two", reportKind: "repeat_purchase", status: pendingStatus, rows: pendingStatus === "EMPTY" ? 0 : null, taskId: pendingStatus === "MISSING" ? null : "pending-run" }] } : null, rows: emptyReports ? [] : [{ id: "row", sourceRunId: "brand-run", facts, capturedAt: "2025-01-15T00:00:00Z" }], versions: [{ id: "brand-run", finishedAt: "2025-01-15T00:00:00Z", coverage }], versionsTruncated: false, run: { id: "brand-run", coverage }, batchCount: 1, latestTask: null, pagination: { total: 51, pageCount: 2 } } });
  });
  await page.goto(`http://127.0.0.1:43225/${repeat ? "?repeat=1" : ""}`);
  return { calls, reads, deny: () => { denied = true; }, setPendingStatus: (status: string) => { pendingStatus = status; } };
}
test("all five pages expose metrics, all fields, history, filters and source without external calls", async ({ page }) => {
  const { calls, reads } = await setup(page);
  await expect(page.getByText("1 / 2 份报告完成 · 尚未全量完成")).toBeVisible();
  for (const label of ["搜索词分析", "搜索查询绩效 SQP", "搜索目录绩效 SCP", "购买组合", "复购分析"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("cell", { name: "B123456789", exact: true })).toBeVisible();
  }
  await expect(page.getByRole("cell", { name: "2246.13 USD", exact: true })).toBeVisible();
  await page.getByText("查看全部业务字段", { exact: true }).click();
  await expect(page.getByText("复购买家比例 (repeatCustomersPctTotal)", { exact: true })).toBeVisible();
  await page.getByLabel("ASIN", { exact: true }).fill("B123456789");
  await expect.poll(() => reads.at(-1)?.get("asin")).toBe("B123456789");
  await page.getByRole("button", { name: "下一页", exact: true }).click(); await expect.poll(() => reads.at(-1)?.get("page")).toBe("2");
  await page.getByRole("button", { name: "来源任务", exact: true }).click(); await expect(page.locator("body")).toHaveAttribute("data-task", "brand-run");
  expect(calls).toHaveLength(0);
});
test("collection previews five reports, discovers frozen ASIN candidates, and only submits an approval request", async ({ page }) => {
  const { calls } = await setup(page);
  await page.getByLabel("回补范围开始", { exact: true }).fill("2025-01-05"); await page.getByLabel("回补范围结束", { exact: true }).fill("2025-01-11");
  await page.getByRole("button", { name: "从完整商品快照载入 ASIN", exact: true }).click();
  await expect(page.getByText(/5 份报告；每份最多 30 次请求/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /已核实所选店铺/ })).toHaveCount(0);
  await page.getByRole("button", { name: "申请保存回补清单", exact: true }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].action).toBe("save-source");
  expect((calls[0].domainPolicy as { collection: { asins: string[]; selections: unknown[] } }).collection.selections).toHaveLength(5);
  expect((calls[0].domainPolicy as { collection: { asins: string[] } }).collection.asins).toEqual(["B123456789"]);
  expect(calls.some(c => c.action === "run" || c.action === "save-plan")).toBe(false);
});
test("repeat entry is immediately usable and denied refresh removes stale business data", async ({ page }) => {
  const { deny, calls } = await setup(page, true);
  await expect(page.getByRole("cell", { name: "2246.13 USD", exact: true })).toBeVisible(); deny();
  await page.getByRole("button", { name: "刷新品牌数据", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("品牌来源不可访问。");
  await expect(page.getByRole("cell", { name: "2246.13 USD", exact: true })).toHaveCount(0); expect(calls).toHaveLength(0);
});

test("report subpage deep links survive reload", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "搜索查询绩效 SQP", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "查询搜索量", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/brandReport=search_query/);
  await page.reload();
  await expect(page.getByRole("columnheader", { name: "查询搜索量", exact: true })).toBeVisible();
});

test("ASIN analysis links multiple SKUs once, opens scoped reports and survives reload", async ({ page }) => {
  const { calls, reads } = await setup(page);
  await page.getByRole("button", { name: "复购分析", exact: true }).click();
  await expect(page.getByText("关联 SKU：sku-a / sku-b", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看 ASIN 分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ASIN 品牌分析", exact: true })).toBeVisible();
  await expect(page.getByText("品牌：Scoped Brand", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "1256", exact: true })).toHaveCount(1);
  await expect.poll(() => reads.some(p => p.get("section") === "brand-asin-analysis" && p.get("asin") === "B123456789")).toBe(true);
  await expect(page).toHaveURL(/brandReport=asin/); await page.reload();
  await expect(page.getByText("关联 SKU：sku-a / sku-b", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看完整报表与历史版本", exact: true }).last().click();
  await expect(page.getByLabel("ASIN", { exact: true })).toHaveValue("B123456789");
  await expect(page.getByRole("cell", { name: "1256", exact: true })).toHaveCount(1);
  expect(calls).toHaveLength(0);
});


test("all report receivers expose their complete field guide before data is collected", async ({ page }) => {
  const { calls } = await setup(page, false, true);
  for (const [label, count, path] of [
    ["搜索词分析", 7, "conversionShare"],
    ["搜索查询绩效 SQP", 36, "purchaseData.totalTwoDayShippingPurchaseCount"],
    ["搜索目录绩效 SCP", 26, "clickData.clickedMedianPrice"],
    ["购买组合", 6, "combinationPct"],
    ["复购分析", 8, "repeatPurchaseRevenuePctTotal"],
  ] as const) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByText(`${label} · 全部 ${count} 项业务字段说明`, { exact: true }).click();
    await expect(page.getByText(path, { exact: true })).toBeVisible();
    if (label === "搜索查询绩效 SQP") await expect(page.getByText(/SQP 份额与比率保留 Amazon 原始值/)).toBeVisible();
  }
  expect(calls).toHaveLength(0);
});


test("coverage separates unselected reports and opens the exact report period", async ({ page }) => {
  const { calls, reads } = await setup(page);
  const summary = page.getByRole("region", { name: "各类品牌报告同步进度" });
  await expect(summary.getByText("未纳入当前清单", { exact: true })).toHaveCount(3);
  await expect(summary.getByText("0 / 1 份完成", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看复购分析 · 周", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "报告粒度", exact: true })).toHaveValue("WEEK");
  await expect(page.getByLabel("窗口范围起", { exact: true })).toHaveValue("2025-01-05");
  await expect(page.getByLabel("窗口范围止", { exact: true })).toHaveValue("2025-01-11");
  await expect.poll(() => reads.at(-1)?.get("reportKind")).toBe("repeat_purchase");
  expect(reads.at(-1)?.get("from")).toBe("2025-01-05");
  expect(reads.at(-1)?.get("to")).toBe("2025-01-11");
  expect(calls).toHaveLength(0);
});


test("collection blocks duplicate requests and directs recovery to the original task", async ({ page }) => {
  const { calls, setPendingStatus } = await setup(page);
  const request = page.getByRole("button", { name: "申请采集下一份报告", exact: true });
  await expect(request).toBeEnabled();
  for (const status of ["WAITING", "FAILED", "PAUSED"]) {
    setPendingStatus(status);
    await page.getByRole("button", { name: "刷新品牌数据", exact: true }).click();
    await expect(request).toBeDisabled();
    await expect(page.getByText(/请查看原任务；不会重复创建报告/)).toBeVisible();
  }
  await page.getByRole("button", { name: "来源任务", exact: true }).last().click();
  await expect(page.locator("body")).toHaveAttribute("data-task", "pending-run");
  setPendingStatus("EMPTY");
  await page.getByRole("button", { name: "刷新品牌数据", exact: true }).click();
  await expect(page.getByText("当前批准清单已完成。", { exact: true })).toBeVisible();
  await expect(request).toBeDisabled();
  expect(calls).toHaveLength(0);
});


test("report subpages return to coverage before requesting collection or retrying", async ({ page }) => {
  const { calls, reads, setPendingStatus } = await setup(page);
  for (const status of ["FAILED", "EMPTY"]) {
    setPendingStatus(status);
    await page.getByRole("button", { name: "搜索查询绩效 SQP", exact: true }).click();
    await expect(page.getByRole("button", { name: "申请采集下一份报告", exact: true })).toHaveCount(0);
    await expect.poll(() => reads.at(-1)?.get("coverage")).toBe("0");
    await page.getByRole("button", { name: "管理报告采集", exact: true }).click();
    await expect(page.getByRole("button", { name: "申请采集下一份报告", exact: true })).toBeDisabled();
    await expect(page.getByText(status === "EMPTY" ? "当前批准清单已完成。" : /请查看原任务；不会重复创建报告/)).toBeVisible();
    await expect.poll(() => reads.at(-1)?.get("coverage")).toBe("1");
  }
  expect(calls).toHaveLength(0);
});


test("coverage report links preserve source, period, dates and version across reload", async ({ page }) => {
  const { calls, reads } = await setup(page);
  await page.getByRole("combobox", { name: "品牌数据来源", exact: true }).selectOption("brand-source");
  await page.getByRole("button", { name: "查看复购分析 · 周", exact: true }).click();
  await page.getByRole("combobox", { name: "已发布版本", exact: true }).selectOption("brand-run");
  await expect(page).toHaveURL(/brandRun=brand-run/);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "品牌数据来源", exact: true })).toHaveValue("brand-source");
  await expect(page.getByRole("combobox", { name: "报告粒度", exact: true })).toHaveValue("WEEK");
  await expect(page.getByLabel("窗口范围起", { exact: true })).toHaveValue("2025-01-05");
  await expect(page.getByLabel("窗口范围止", { exact: true })).toHaveValue("2025-01-11");
  await expect(page.getByRole("combobox", { name: "已发布版本", exact: true })).toHaveValue("brand-run");
  await expect.poll(() => reads.at(-1)?.get("runId")).toBe("brand-run");
  for (const [name, value] of [["sourceId", "brand-source"], ["reportKind", "repeat_purchase"], ["reportPeriod", "WEEK"], ["from", "2025-01-05"], ["to", "2025-01-11"]]) expect(reads.at(-1)?.get(name)).toBe(value);
  await page.getByRole("button", { name: "搜索查询绩效 SQP", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "报告粒度", exact: true })).toHaveValue("");
  await expect(page.getByLabel("窗口范围起", { exact: true })).toHaveValue("");
  await expect(page).not.toHaveURL(/brandRun=|brandFrom=|brandTo=|brandPeriod=/);
  expect(calls).toHaveLength(0);
});
