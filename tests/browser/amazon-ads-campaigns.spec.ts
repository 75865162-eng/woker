import { build } from "esbuild";
import { reportCompleteness, reportMetricFields } from "../../src/lib/amazon-ads/report-completeness";
import { expect, test, type Page } from "@playwright/test";

let bundle: string, styles: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: ["tests/browser/amazon-ads-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
  const [{ readFile }, { default: postcss }, { default: tailwind }] = await Promise.all([import("node:fs/promises"), import("postcss"), import("@tailwindcss/postcss")]);
  styles = (await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css + await readFile("src/components/amazon-ads/amazon-ads.css", "utf8");
});
const profiles = [
  { profileRecordId: "profile-a", amazonProfileId: "111", countryCode: "US", marketplaceId: "US-SITE", currencyCode: "USD", timezone: "America/Los_Angeles", sellerAccountId: "seller-a", sellerName: "Store US" },
  { profileRecordId: "profile-b", amazonProfileId: "222", countryCode: "CA", marketplaceId: "CA-SITE", currencyCode: "CAD", timezone: "America/Toronto", sellerAccountId: "seller-b", sellerName: "Store CA" },
];
const campaigns = Array.from({ length: 26 }, (_, index) => ({ id: `record-${index}`, profileId: index === 1 ? "profile-b" : "profile-a", externalId: index < 2 ? "100" : String(200 + index), entityType: "SP:campaign", name: index === 0 ? "Stored Alpha" : index === 1 ? "Stored Beta" : `Stored ${index}`, state: index === 1 ? "PAUSED" : "ENABLED", budgetAmount: "25.123456", budgetType: "DAILY", targetingType: "MANUAL", startDate: "2026-11-01", endDate: null, payload: { official: "fixture-only" }, sourceTaskId: "task-fixture", sourceTask: { status: "SUCCEEDED", stage: "COMPLETED_SP_STRUCTURE" }, syncedAt: "2026-11-06T00:00:00Z" }));
function envelope(url: URL) {
  const p = url.searchParams;
  const scope = profiles.filter(profile => (!p.get("internalProfileId") || profile.profileRecordId === p.get("internalProfileId")) && (!p.get("marketplaceId") || profile.marketplaceId === p.get("marketplaceId")) && (!p.get("sellerAccountId") || profile.sellerAccountId === p.get("sellerAccountId")));
  let entities = p.get("entityType") === "SP:ad-group" ? campaigns.map((row, index) => ({ ...row, id: `group-${index}`, externalId: index < 2 ? "900" : String(1000 + index), name: index < 2 ? `Group ${row.profileId}` : `Group ${index}`, entityType: "SP:ad-group", campaignId: row.externalId, bid: "0.123456" })) : campaigns;
  const entityType = p.get("entityType") ?? "SP:campaign";
  if (!["SP:campaign", "SP:ad-group"].includes(entityType)) entities = profiles.flatMap(profile => Array.from({ length: 26 }, (_, index) => ({
    ...campaigns[0], id: `${entityType}-${profile.profileRecordId}-${index}`, profileId: profile.profileRecordId, externalId: String(3000 + index), entityType,
    campaignId: "100", adGroupId: entityType.includes("campaign-negative") ? null : "900", name: `Child ${index}`, keywordText: `Stored keyword ${index}`, matchType: "EXACT", bid: "0.234567",
    expressionType: "MANUAL", targetingExpression: [{ type: "asinSameAs", value: "B0FIXTURE" }], payload: { keywordText: "stale payload keyword", bid: 999, official: "fixture-only" },
  })));
  if (p.get("kind") === "reports") {
    const reports = Array.from({ length: 31 }, (_, index) => ({ id: `fact-${index}`, profileId: p.get("internalProfileId") ?? "profile-a", reportType: "spCampaigns", adProduct: "SPONSORED_PRODUCTS", reportDate: new Date(Date.parse(`${p.get("to")}T00:00:00Z`) - Math.min(index, 29) * 86400_000).toISOString().slice(0, 10), campaignId: p.get("campaignId"), impressions: "120", clicks: "8", spend: index === 0 ? null : "12.340001", orders: "2", sales: "45.670009", units: "2", currencyCode: "CAD", attributionWindow: index === 29 ? "14d" : "7d", apiVersion: index === 29 ? "reporting-v3b" : "reporting-v3", versionId: `version-${index}`, sourceTaskId: "report-task-fixture", syncedAt: "2026-11-06T00:00:00Z", publishedAt: "2026-11-06T00:00:00Z", ctr: "6.666667", cpc: "1.5425", acos: "27.012", roas: "3.701" }));
    const selected = reports.filter(row => row.profileId === p.get("internalProfileId") && row.campaignId === p.get("campaignId") && row.reportDate >= (p.get("from") ?? "") && row.reportDate <= (p.get("to") ?? ""));
    const total = selected.length, currentPage = Number(p.get("page") ?? 1), size = Number(p.get("pageSize") ?? 25);
    const grouped = new Map<string, typeof reports>();
    for (const row of selected) { const key = `${row.currencyCode}:${row.attributionWindow}:${row.apiVersion}`; grouped.set(key, [...(grouped.get(key) ?? []), row]); }
    const totals = [...grouped.values()].map(rows => ({ reportType: rows[0].reportType, adProduct: rows[0].adProduct, currencyCode: rows[0].currencyCode, attributionWindow: rows[0].attributionWindow, apiVersion: rows[0].apiVersion, impressions: "120", clicks: "8", spend: "12.340001", orders: "2", sales: "45.670009", units: "2", ctr: "6.666667", cpc: "1.5425", acos: "27.012", roas: "3.701", completeness: reportCompleteness(BigInt(rows.length), Object.fromEntries(reportMetricFields.map(field => [field, BigInt(rows.filter(row => row[field] !== null).length)])) as Record<typeof reportMetricFields[number], bigint>) }));
    return { rows: selected.slice((currentPage - 1) * size, currentPage * size), total, source: "AmazonAdsReportFact", syncedAt: "2026-11-06T00:00:00Z", warnings: ["观察数据不代表日期完整", "归因可能继续回补"], freshness: { status: "OBSERVED_PUBLISHED", profiles: [{ profileRecordId: p.get("internalProfileId"), status: "OBSERVED_PUBLISHED", reportType: "spCampaigns", coveredFrom: selected.length ? selected.at(-1)!.reportDate : null, coveredTo: selected.length ? selected[0].reportDate : null, lastSuccessAt: selected.length ? "2026-11-06T00:00:00Z" : null, lastAttemptAt: "2026-11-06T00:00:00Z", lastTaskId: selected.length ? "report-task-fixture" : null, warningCodes: selected.length ? ["ATTRIBUTION_MAY_UPDATE"] : [] }] }, pagination: { hasMore: currentPage * size < total }, dateRange: { from: p.get("from"), to: p.get("to") }, totals };
  }
  const rows = entities.filter(row => scope.some(profile => profile.profileRecordId === row.profileId) && (!p.get("externalId") || row.externalId === p.get("externalId")) && (!p.get("campaignId") || ("campaignId" in row && row.campaignId === p.get("campaignId"))) && (!p.get("adGroupId") || ("adGroupId" in row && row.adGroupId === p.get("adGroupId"))) && (!p.get("state") || row.state === p.get("state")) && (!p.get("search") || row.name.toLowerCase().includes(p.get("search")!.toLowerCase())));
  const total = rows.length, page = Number(p.get("page") ?? 1), size = Number(p.get("pageSize") ?? 25);
  return { rows: rows.slice((page - 1) * size, page * size), total, page, source: "amazon_ads_postgres", syncedAt: "2026-11-06T00:00:00Z", warnings: ["CURRENT_SNAPSHOT_ONLY"], freshness: { status: "CURRENT" }, scope: { profiles: scope }, pagination: { hasMore: page * size < total } };
}
type Control = { legacyFreshness?: boolean; reportCompleteness?: "invalid" | "legacy"; onlyEntity?: string; mode?: number | "invalid" | "empty"; taskStatus?: number; wait?: (url: URL) => Promise<void> };
async function setup(page: Page, control: Control = {}, path = "/amazon-ads/campaigns?live=1") {
  const requests: URL[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    expect(url.origin).toBe("http://127.0.0.1:43239");
    if (url.pathname.startsWith("/api/")) {
      expect(request.method()).toBe("GET"); requests.push(url);
      if (url.pathname === "/api/integrations/amazon/ads/data") {
        await control.wait?.(url);
        const mode = !control.onlyEntity || control.onlyEntity === url.searchParams.get("entityType") || control.onlyEntity === "REPORTS" && url.searchParams.get("kind") === "reports" ? control.mode : undefined;
        if (typeof mode === "number") return route.fulfill({ status: mode, contentType: "application/json", body: '{"error":"private upstream details"}' });
        const body = envelope(url);
        if (url.searchParams.get("kind") === "reports" && control.legacyFreshness) Reflect.deleteProperty(body.freshness, "profiles");
        if (url.searchParams.get("kind") === "reports" && "totals" in body && body.totals && control.reportCompleteness) {
          for (const total of body.totals) {
            if (control.reportCompleteness === "invalid") total.completeness.metrics.spend.missingFactCount = "999";
            else Reflect.deleteProperty(total, "completeness");
          }
        }
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(mode === "invalid" ? { rows: [] } : mode === "empty" ? { ...body, rows: [], total: 0, totals: [], pagination: { hasMore: false } } : body) });
      }
      expect(url.pathname).toBe("/api/integrations/amazon/ads/sync");
      const taskId = url.searchParams.get("taskId") ?? "task-fixture";
      return route.fulfill({ status: control.taskStatus ?? 200, contentType: "application/json", body: JSON.stringify({ taskDetail: { id: taskId, status: "SUCCEEDED", stage: taskId.startsWith("report-") ? "COMPLETED_SP_REPORT" : "COMPLETED_SP_STRUCTURE", processedCount: 8, errorCode: null } }) });
    }
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname === "/styles.css") return route.fulfill({ contentType: "text/css", body: styles });
    return route.fulfill({ contentType: "text/html", body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto(`http://127.0.0.1:43239${path}`);
  return { requests, errors };
}

test("local Campaign list filters and paginates on the server without a structure date filter", async ({ page }) => {
  const { requests, errors } = await setup(page);
  await expect(page.getByRole("table", { name: "本地广告活动" }).locator("tbody tr")).toHaveCount(25);
  await expect(page.getByText("表现指标尚未接入", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Campaign Profile", { exact: true }).selectOption("profile-b");
  await expect(page.getByRole("table")).toContainText("Stored Beta");
  await expect(page.getByRole("table")).not.toContainText("Stored Alpha");
  await expect.poll(() => requests.at(-1)?.searchParams.get("page")).toBe("1");
  await page.getByLabel("Campaign 店铺", { exact: true }).selectOption("seller-b");
  await page.getByLabel("Campaign 站点", { exact: true }).selectOption("CA-SITE");
  await expect.poll(() => requests.at(-1)?.searchParams.get("marketplaceId")).toBe("CA-SITE");
  expect(requests.at(-1)?.searchParams.get("sellerAccountId")).toBe("seller-b");
  await page.getByLabel("Campaign 排序", { exact: true }).selectOption("budgetAmount");
  await expect.poll(() => requests.at(-1)?.searchParams.get("sortBy")).toBe("budgetAmount");
  await page.getByLabel("Campaign 搜索", { exact: true }).fill("  no-match  ");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByText("没有已保存的记录", { exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("search")).toBe("no-match");
  expect(requests.every(url => !url.searchParams.has("from") && !url.searchParams.has("to"))).toBe(true);
  expect(errors).toEqual([]);
});

test("duplicate Amazon Campaign IDs drill into the correct Profile and keep task permissions independent", async ({ page }) => {
  const { requests, errors } = await setup(page, { taskStatus: 403 });
  await page.getByRole("button", { name: "Stored Beta", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stored Beta", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "所属广告组" })).toContainText("Group profile-b");
  expect(requests.filter(url => url.searchParams.get("externalId") === "100" || url.searchParams.get("campaignId") === "100").every(url => url.searchParams.get("internalProfileId") === "profile-b")).toBe(true);
  await page.getByRole("region", { name: "Campaign 设置与来源" }).getByText("原始维度与来源", { exact: true }).click();
  await page.getByRole("region", { name: "Campaign 设置与来源" }).getByRole("button", { name: "来源任务 task-fixture", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("403");
  await expect(page.getByRole("table", { name: "所属广告组" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Campaign 设置与来源" })).toContainText("25.123456");
  expect(errors).toEqual([]);
});

for (const mode of [403, 500, "invalid"] as const) test(`local Campaign ${mode} response clears rows, never shows Demo, and can retry`, async ({ page }) => {
  const control: Control = {};
  await setup(page, control);
  await expect(page.getByRole("table", { name: "本地广告活动" })).toBeVisible();
  control.mode = mode;
  await page.getByRole("button", { name: "刷新广告活动", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("广告表现演示数据", { exact: true })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("private upstream details");
  control.mode = undefined;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("table", { name: "本地广告活动" })).toBeVisible();
});

test("changed filters immediately hide previous rows and late responses cannot restore them", async ({ page }) => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = new Promise<void>(resolve => { entered = resolve; });
  const control: Control = { wait: async url => { if (url.searchParams.get("search") === "slow") { entered(); await gate; } } };
  await setup(page, control);
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByLabel("Campaign 搜索", { exact: true }).fill("slow");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await pending;
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("正在读取");
  await page.getByLabel("Campaign 搜索", { exact: true }).fill("Stored Beta");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("Stored Beta");
  release();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("table")).not.toContainText("Stored Alpha");
});

test("direct scoped detail works and unimplemented ad products do not display SP records", async ({ page }) => {
  await setup(page, {}, "/amazon-ads/campaigns/profile-a/100?live=1");
  await expect(page.getByRole("heading", { name: "Stored Alpha", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "所属广告组" })).toContainText("Group profile-a");
  const settings = page.getByRole("region", { name: "Campaign 设置与来源" });
  await settings.getByText("原始维度与来源", { exact: true }).click();
  await settings.getByRole("button", { name: "来源任务 task-fixture", exact: true }).click();
  await expect(settings.getByRole("region", { name: "来源任务详情" })).toContainText("处理 8");
  await page.goto("http://127.0.0.1:43239/amazon-ads/campaigns/sb?live=1");
  await expect(page.getByRole("alert")).toContainText("尚未接入");
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("local Campaign request timeout clears loading and permits a fresh retry", async ({ page }) => {
  await page.clock.install();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let wait = true;
  await setup(page, { wait: async () => { if (wait) await gate; } });
  await expect(page.getByRole("status")).toContainText("正在读取");
  await page.clock.fastForward(15001);
  await expect(page.getByRole("alert")).toContainText("超时");
  wait = false; release();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("table", { name: "本地广告活动" })).toBeVisible();
});

test("local Campaign mobile navigation and data-browser entry stay usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(page.getByRole("table", { name: "本地广告活动" })).toBeVisible();
  const menu = page.getByRole("button", { name: "折叠广告导航", exact: true });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "已同步数据浏览器", exact: true }).click();
  await expect(page.getByRole("heading", { name: "已同步 Ads 数据", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "进入本地广告活动工作台", exact: true }).click();
  await expect(page.getByRole("table", { name: "本地广告活动" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});


test("local Ad Group list supports scoped filters, bid sort, Campaign filter and pagination", async ({ page }) => {
  const { requests, errors } = await setup(page, {}, "/amazon-ads/ad-groups?live=1");
  const table = page.getByRole("table", { name: "本地广告组", exact: true });
  await expect(table.locator("tbody tr")).toHaveCount(25);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Ad Group 店铺", { exact: true }).selectOption("seller-b");
  await page.getByLabel("Ad Group 站点", { exact: true }).selectOption("CA-SITE");
  await page.getByLabel("Ad Group Profile", { exact: true }).selectOption("profile-b");
  await page.getByLabel("Ad Group 状态", { exact: true }).selectOption("PAUSED");
  await page.getByLabel("Ad Group 排序", { exact: true }).selectOption("bid");
  await page.getByLabel("Ad Group Campaign ID", { exact: true }).fill("100");
  await page.getByLabel("Ad Group 搜索", { exact: true }).fill("Group profile-b");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("0.123456 CAD");
  await expect.poll(() => requests.at(-1)?.searchParams.get("campaignId")).toBe("100");
  const query = requests.at(-1)!.searchParams;
  expect(Object.fromEntries(query)).toMatchObject({ entityType: "SP:ad-group", internalProfileId: "profile-b", sellerAccountId: "seller-b", marketplaceId: "CA-SITE", state: "PAUSED", sortBy: "bid", page: "1" });
  expect(errors).toEqual([]);
});

test("Ad Group detail and parent navigation preserve Profile when external IDs collide", async ({ page }) => {
  const { requests, errors } = await setup(page, {}, "/amazon-ads/ad-groups?live=1");
  await page.getByRole("button", { name: "Group profile-b", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Group profile-b", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Ad Group 设置与来源" })).toContainText("0.123456");
  const detail = requests.find(url => url.searchParams.get("entityType") === "SP:ad-group" && url.searchParams.get("externalId") === "900");
  expect(detail?.searchParams.get("internalProfileId")).toBe("profile-b");
  await page.getByRole("button", { name: "查看所属广告活动", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stored Beta", exact: true })).toBeVisible();
  await page.getByRole("table", { name: "所属广告组" }).getByRole("button", { name: "Group profile-b", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Group profile-b", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回广告组", exact: true }).click();
  await expect(page.getByRole("table", { name: "本地广告组" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("direct Ad Group details handle missing records, permission revocation and retry without Demo", async ({ page }) => {
  const control: Control = {};
  await setup(page, control, "/amazon-ads/ad-groups/profile-b/900?live=1");
  await expect(page.getByRole("heading", { name: "Group profile-b", exact: true })).toBeVisible();
  control.mode = 403;
  await page.getByRole("button", { name: "刷新广告组详情", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("403");
  await expect(page.getByRole("region", { name: "Ad Group 设置与来源" })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("private upstream details");
  control.mode = undefined;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Group profile-b", exact: true })).toBeVisible();
  await page.goto("http://127.0.0.1:43239/amazon-ads/ad-groups/profile-b/missing?live=1");
  await expect(page.getByText("没有已保存的记录", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看所属广告活动", exact: true })).toHaveCount(0);
  await expect(page.getByText("广告表现演示数据", { exact: true })).toHaveCount(0);
});

test("live sidebar switches Campaign and Ad Group lists without retaining incompatible filters", async ({ page }) => {
  await setup(page);
  await page.getByLabel("Campaign 排序", { exact: true }).selectOption("budgetAmount");
  await page.getByRole("complementary", { name: "本地广告导航" }).getByRole("button", { name: "广告组", exact: true }).click();
  await expect(page.getByRole("table", { name: "本地广告组" })).toBeVisible();
  await expect(page.getByLabel("Ad Group 排序", { exact: true })).toHaveValue("name");
  await page.getByRole("complementary", { name: "本地广告导航" }).getByRole("button", { name: "广告活动", exact: true }).click();
  await expect(page.getByRole("table", { name: "本地广告活动" })).toBeVisible();
  await expect(page.getByLabel("Campaign 排序", { exact: true })).toHaveValue("name");
});


for (const [label, entityType] of [["关键词", "SP:keyword"], ["商品投放", "SP:target"], ["广告组否定关键词", "SP:negative-keyword"], ["广告组否定商品投放", "SP:negative-target"]]) test(`Ad Group ${label} reads normalized local data with scoped pagination and filters`, async ({ page }) => {
  const { requests, errors } = await setup(page, {}, "/amazon-ads/ad-groups/profile-b/900?live=1");
  const region = page.getByRole("region", { name: "广告组投放结构", exact: true });
  await region.getByRole("button", { name: label, exact: true }).click();
  const table = region.getByRole("table", { name: `本地${label}`, exact: true });
  await expect(table.locator("tbody tr")).toHaveCount(25);
  await expect(table).not.toContainText("stale payload keyword");
  if (entityType.includes("target")) await expect(table).toContainText("B0FIXTURE");
  else await expect(table).toContainText("Stored keyword 0");
  if (entityType.includes("negative")) await expect(table.getByRole("columnheader", { name: "竞价 / 币种", exact: true })).toHaveCount(0);
  else await expect(table).toContainText("0.234567 CAD");
  await region.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await region.getByLabel("下属实体搜索", { exact: true }).fill("Child 2");
  await region.getByRole("button", { name: "搜索投放", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(7);
  const scoped = requests.filter(url => url.searchParams.get("entityType") === entityType);
  expect(scoped.length).toBeGreaterThan(0);
  expect(scoped.every(url => url.searchParams.get("internalProfileId") === "profile-b" && url.searchParams.get("campaignId") === "100" && url.searchParams.get("adGroupId") === "900")).toBe(true);
  await region.getByLabel("下属实体状态", { exact: true }).selectOption("PAUSED");
  await expect(region.getByText("没有已保存的记录", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Campaign negatives remain Campaign scoped and do not inherit Ad Group filters", async ({ page }) => {
  const { requests } = await setup(page, {}, "/amazon-ads/campaigns/profile-b/100?live=1");
  const region = page.getByRole("region", { name: "活动否定结构", exact: true });
  await expect(region.getByRole("table", { name: "本地活动否定关键词" })).toBeVisible();
  await region.getByRole("button", { name: "活动否定商品投放", exact: true }).click();
  await expect(region.getByRole("table", { name: "本地活动否定商品投放" })).toContainText("B0FIXTURE");
  const scoped = requests.filter(url => url.searchParams.get("entityType")?.includes("campaign-negative"));
  expect(scoped.length).toBeGreaterThanOrEqual(2);
  expect(scoped.every(url => url.searchParams.get("internalProfileId") === "profile-b" && url.searchParams.get("campaignId") === "100" && !url.searchParams.has("adGroupId"))).toBe(true);
});

test("child request failure stays independent from parent and switching domains clears old data", async ({ page }) => {
  const control: Control = { mode: 403, onlyEntity: "SP:keyword" };
  const { requests } = await setup(page, control, "/amazon-ads/ad-groups/profile-b/900?live=1");
  const region = page.getByRole("region", { name: "广告组投放结构", exact: true });
  await expect(region.getByRole("alert")).toContainText("403");
  await expect(page.getByRole("region", { name: "Ad Group 设置与来源" })).toBeVisible();
  control.mode = undefined;
  await region.getByRole("button", { name: "重试", exact: true }).click();
  await expect(region.getByRole("table", { name: "本地关键词" })).toBeVisible();
  await region.getByLabel("下属实体搜索", { exact: true }).fill("Child 2");
  await region.getByRole("button", { name: "搜索投放", exact: true }).click();
  await expect(region.getByRole("table").locator("tbody tr")).toHaveCount(7);
  await region.getByRole("button", { name: "商品投放", exact: true }).click();
  await expect(region.getByLabel("下属实体搜索", { exact: true })).toHaveValue("");
  await expect(region.getByRole("table", { name: "本地商品投放" }).locator("tbody tr")).toHaveCount(25);
  const count = requests.length;
  await region.getByRole("button", { name: "广告商品", exact: true }).click();
  await expect(region.getByRole("status")).toContainText("尚未接入");
  await expect(region.getByRole("table")).toHaveCount(0);
  expect(requests.length).toBe(count);
});


test("Campaign detail reads only published daily facts with exact scope, date range and grouped aggregates", async ({ page }) => {
  const { requests, errors } = await setup(page, {}, "/amazon-ads/campaigns/profile-b/100?live=1");
  const region = page.getByRole("region", { name: "Campaign 已发布日报", exact: true });
  await region.getByRole("button", { name: "查看 Campaign 已发布日报", exact: true }).click();
  await expect(region.getByRole("table", { name: "Campaign 日报事实" }).locator("tbody tr")).toHaveCount(25);
  await expect(region.getByRole("table", { name: "Campaign 日报事实" })).toContainText("12.340001 CAD");
  await expect(region).toContainText("观察数据不代表日期完整");
  const freshness = region.getByRole("region", { name: "日报 Profile 新鲜度 profile-b" });
  await expect(freshness).toContainText("当前筛选内观察到的报告日期");
  await expect(freshness).toContainText("2026-10-");
  await expect(freshness).toContainText("ATTRIBUTION_MAY_UPDATE");
  await expect(freshness.getByRole("button", { name: "来源任务 report-task-fixture", exact: true })).toBeVisible();
  await expect(region.getByRole("region", { name: "日报汇总 CAD 归因未知 reporting-v3" })).toHaveCount(0);
  await expect(region.locator("section[aria-label*='reporting-v3']")).toHaveCount(2);
  await region.getByRole("button", { name: "来源任务 report-task-fixture", exact: true }).first().click();
  await expect(region.getByRole("region", { name: "来源任务详情" }).first()).toContainText("COMPLETED_SP_REPORT");
  const taskRequest = requests.find(url => url.pathname.endsWith("/sync"));
  expect(taskRequest?.searchParams.get("taskId")).toBe("report-task-fixture");
  expect(taskRequest?.searchParams.get("profileId")).toBe("profile-b");
  await region.getByLabel("Campaign 日报排序", { exact: true }).selectOption("spend");
  await expect.poll(() => requests.filter(url => url.searchParams.get("kind") === "reports").at(-1)?.searchParams.get("sortBy")).toBe("spend");
  const reportRequests = requests.filter(url => url.searchParams.get("kind") === "reports");
  expect(reportRequests.length).toBeGreaterThan(0);
  expect(reportRequests.every(url => url.searchParams.get("internalProfileId") === "profile-b" && url.searchParams.get("campaignId") === "100" && url.searchParams.get("reportType") === "spCampaigns" && url.searchParams.get("adProduct") === "SPONSORED_PRODUCTS" && url.searchParams.get("from") && url.searchParams.get("to"))).toBe(true);
  await region.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(region.getByRole("table", { name: "Campaign 日报事实" }).locator("tbody tr")).toHaveCount(6);
  await region.getByLabel("Campaign 日报开始日期", { exact: true }).fill("2026-11-03");
  await region.getByLabel("Campaign 日报结束日期", { exact: true }).fill("2026-11-08");
  await region.getByRole("button", { name: "查询日报", exact: true }).click();
  await expect(region.getByRole("table", { name: "Campaign 日报事实" }).locator("tbody tr")).toHaveCount(6);
  const latest = requests.filter(url => url.searchParams.get("kind") === "reports").at(-1)!;
  expect(latest.searchParams.get("from")).toBe("2026-11-03");
  expect(latest.searchParams.get("to")).toBe("2026-11-08");
  expect(latest.searchParams.get("page")).toBe("1");
  expect(errors).toEqual([]);
});

test("Campaign report request failures, empty results and invalid date ranges never expose stale metrics", async ({ page }) => {
  const control: Control = { mode: 403, onlyEntity: "REPORTS" };
  const { requests } = await setup(page, control, "/amazon-ads/campaigns/profile-a/100?live=1");
  const region = page.getByRole("region", { name: "Campaign 已发布日报", exact: true });
  await region.getByRole("button", { name: "查看 Campaign 已发布日报", exact: true }).click();
  await expect(region.getByRole("alert")).toContainText("403");
  await expect(region.getByRole("table", { name: "Campaign 日报事实" })).toHaveCount(0);
  await expect(region.getByRole("button", { name: "重试", exact: true })).toBeVisible();
  await region.getByLabel("Campaign 日报开始日期", { exact: true }).fill("2024-01-01");
  await region.getByLabel("Campaign 日报结束日期", { exact: true }).fill("2026-11-01");
  await region.getByRole("button", { name: "查询日报", exact: true }).click();
  await expect(region.getByRole("alert").filter({ hasText: "日期范围无效" })).toBeVisible();
  expect(requests.filter(url => url.searchParams.get("kind") === "reports")).toHaveLength(1);
  control.mode = undefined;
  await region.getByRole("button", { name: "重试", exact: true }).click();
  await expect(region.getByRole("table", { name: "Campaign 日报事实" })).toBeVisible();
  control.mode = "invalid";
  await region.getByRole("button", { name: "刷新 Campaign 日报", exact: true }).click();
  await expect(region.getByRole("alert").filter({ hasText: "响应格式无效" })).toBeVisible();
  await expect(region.getByRole("table", { name: "Campaign 日报事实" })).toHaveCount(0);
  await expect(region.locator("section[aria-label*=reporting-v3]")).toHaveCount(0);
  control.mode = "empty";
  await region.getByRole("button", { name: "重试", exact: true }).click();
  await expect(region.getByText("没有已保存的记录", { exact: true })).toBeVisible();
});

test("Campaign report summary keeps missing values and grouped currencies separate", async ({ page }) => {
  await setup(page, {}, "/amazon-ads/campaigns/profile-a/100?live=1");
  const region = page.getByRole("region", { name: "Campaign 已发布日报", exact: true });
  await region.getByRole("button", { name: "查看 Campaign 已发布日报", exact: true }).click();
  await expect(region.locator("section[aria-label*=reporting-v3]")).toHaveCount(2);
  const facts = region.getByRole("table", { name: "Campaign 日报事实" });
  await expect(facts).toContainText("—");
  await region.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(facts).toContainText("reporting-v3b");
  await expect(region).toContainText("7d");
  await expect(region).toContainText("14d");
});


test("Campaign report aggregation is only requested after explicit expansion", async ({ page }) => {
  const { requests } = await setup(page, {}, "/amazon-ads/campaigns/profile-b/100?live=1");
  const region = page.getByRole("region", { name: "Campaign 已发布日报", exact: true });
  await expect(region.getByRole("button", { name: "查看 Campaign 已发布日报", exact: true })).toBeVisible();
  expect(requests.filter(url => url.searchParams.get("kind") === "reports")).toHaveLength(0);
  await region.getByRole("button", { name: "查看 Campaign 已发布日报", exact: true }).click();
  await expect(region.getByRole("table", { name: "Campaign 日报事实" })).toBeVisible();
  await region.getByRole("button", { name: "收起 Campaign 日报", exact: true }).click();
  await expect(region.getByRole("table", { name: "Campaign 日报事实" })).toHaveCount(0);
});


test("Campaign metric completeness explains partial missing fields with saved fact counts", async ({ page }) => {
  await setup(page, {}, "/amazon-ads/campaigns/profile-b/100?live=1");
  const region = page.getByRole("region", { name: "Campaign 已发布日报", exact: true });
  await region.getByRole("button", { name: "查看 Campaign 已发布日报", exact: true }).click();
  const summary = region.getByRole("region", { name: "日报汇总 CAD 7d reporting-v3", exact: true });
  await summary.getByText("字段完整性 · 已观察 30 条事实", { exact: true }).click();
  await expect(summary).toContainText("部分缺失 · 已提供 29 · 缺失 1");
  await expect(summary).toContainText("已观察字段齐全 · 已提供 30 · 缺失 0");
  await expect(summary).toContainText("不代表日期、账户或归因完整");
});

test("legacy report responses remain readable while inconsistent completeness counts fail closed", async ({ page }) => {
  const control: Control = { reportCompleteness: "legacy" };
  await setup(page, control, "/amazon-ads/campaigns/profile-b/100?live=1");
  const region = page.getByRole("region", { name: "Campaign 已发布日报", exact: true });
  await region.getByRole("button", { name: "查看 Campaign 已发布日报", exact: true }).click();
  await expect(region.getByRole("table", { name: "Campaign 日报事实" })).toBeVisible();
  await expect(region.getByText("字段完整性计数未由接口提供，不能据此推断字段齐全。", { exact: true })).toHaveCount(2);
  control.reportCompleteness = "invalid";
  await region.getByRole("button", { name: "刷新 Campaign 日报", exact: true }).click();
  await expect(region.getByRole("alert")).toContainText("响应格式无效");
  await expect(region.getByRole("table", { name: "Campaign 日报事实" })).toHaveCount(0);
});


test("report freshness evidence keeps task permission independent and old envelopes explicitly unknown", async ({ page }) => {
  const control: Control = { taskStatus: 403 };
  const { requests } = await setup(page, control, "/amazon-ads/campaigns/profile-b/100?live=1");
  const region = page.getByRole("region", { name: "Campaign 已发布日报", exact: true });
  await region.getByRole("button", { name: "查看 Campaign 已发布日报", exact: true }).click();
  const freshness = region.getByRole("region", { name: "日报 Profile 新鲜度 profile-b", exact: true });
  await expect(freshness).toContainText("观察范围不代表连续日期覆盖");
  expect(requests.filter(url => url.pathname.endsWith("/sync"))).toHaveLength(0);
  await freshness.getByRole("button", { name: "来源任务 report-task-fixture", exact: true }).click();
  await expect(freshness.getByRole("alert")).toContainText("403");
  await expect(region.getByRole("table", { name: "Campaign 日报事实" })).toBeVisible();
  await expect(freshness).toContainText("ATTRIBUTION_MAY_UPDATE");
  control.legacyFreshness = true;
  await region.getByRole("button", { name: "刷新 Campaign 日报", exact: true }).click();
  await expect(region.getByRole("table", { name: "Campaign 日报事实" })).toBeVisible();
  await expect(region).toContainText("接口未提供逐 Profile 新鲜度明细");
  await expect(region.getByRole("region", { name: "日报 Profile 新鲜度 profile-b", exact: true })).toHaveCount(0);
});

test("standalone Keywords uses scoped server filters, pagination and normalized parent links", async ({ page }) => {
  const { requests, errors } = await setup(page, {}, "/amazon-ads/keywords?live=1");
  const table = page.getByRole("table", { name: "本地关键词", exact: true });
  await expect(table.locator("tbody tr")).toHaveCount(25);
  await page.getByLabel("关键词 店铺", { exact: true }).selectOption("seller-b");
  await page.getByLabel("关键词 站点", { exact: true }).selectOption("CA-SITE");
  await page.getByLabel("关键词 Profile", { exact: true }).selectOption("profile-b");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("关键词 Campaign ID", { exact: true }).fill(" 100 ");
  await page.getByLabel("关键词 Ad Group ID", { exact: true }).fill(" 900 ");
  await page.getByLabel("关键词 搜索", { exact: true }).fill(" Child 2 ");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByLabel("关键词 状态", { exact: true }).selectOption("ENABLED");
  await page.getByLabel("关键词 排序", { exact: true }).selectOption("bid");
  await page.getByLabel("关键词 排序方向", { exact: true }).selectOption("desc");
  await expect(table).toContainText("Stored keyword 2");
  await expect(table).toContainText("0.234567 CAD");
  await expect(table).not.toContainText("stale payload keyword");
  await expect.poll(() => requests.at(-1)?.searchParams.get("sortDirection")).toBe("desc");
  for (const [key, value] of Object.entries({ entityType: "SP:keyword", internalProfileId: "profile-b", sellerAccountId: "seller-b", marketplaceId: "CA-SITE", campaignId: "100", adGroupId: "900", search: "Child 2", state: "ENABLED", page: "1", sortBy: "bid" })) expect(requests.at(-1)?.searchParams.get(key)).toBe(value);
  await table.getByRole("button", { name: "Ad Group 900", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Group profile-b", exact: true })).toBeVisible();
  expect(requests.findLast(url => url.searchParams.get("entityType") === "SP:ad-group")?.searchParams.get("internalProfileId")).toBe("profile-b");
  expect(requests.every(url => url.searchParams.get("kind") !== "reports" && !url.searchParams.has("from") && !url.searchParams.has("to"))).toBe(true);
  expect(errors).toEqual([]);
});

test("standalone Targeting displays normalized expressions, provenance and scoped Campaign navigation", async ({ page }) => {
  const { requests } = await setup(page, {}, "/amazon-ads/targets/sp?live=1");
  const table = page.getByRole("table", { name: "本地商品投放", exact: true });
  await page.getByLabel("商品投放 Profile", { exact: true }).selectOption("profile-b");
  await expect(table).toContainText("B0FIXTURE");
  await expect(table).toContainText("MANUAL");
  await expect(table).toContainText("0.234567 CAD");
  const row = table.locator("tbody tr").first();
  await row.getByText("原始维度与来源", { exact: true }).click();
  await row.getByRole("button", { name: "来源任务 task-fixture", exact: true }).click();
  await expect(row.getByRole("region", { name: "来源任务详情" })).toContainText("SUCCEEDED");
  expect(requests.at(-1)?.searchParams.get("profileId")).toBe("profile-b");
  await row.getByRole("button", { name: "Campaign 100", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stored Beta", exact: true })).toBeVisible();
});

test("standalone negatives separate all four domains and reset filters and pages on a domain change", async ({ page }) => {
  const { requests } = await setup(page, {}, "/amazon-ads/negatives?live=1");
  const domains = [
    ["广告组否定关键词", "SP:negative-keyword"], ["广告组否定商品投放", "SP:negative-target"],
    ["活动否定关键词", "SP:campaign-negative-keyword"], ["活动否定商品投放", "SP:campaign-negative-target"],
  ];
  for (const [label, type] of domains) {
    await page.getByRole("navigation", { name: "否定投放层级与类型" }).getByRole("button", { name: label, exact: true }).click();
    const table = page.getByRole("table", { name: `本地${label}`, exact: true });
    await expect(table.locator("tbody tr")).toHaveCount(25);
    await expect.poll(() => requests.at(-1)?.searchParams.get("entityType")).toBe(type);
    expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
    expect(requests.at(-1)?.searchParams.has("search")).toBe(false);
    await expect(table.getByRole("columnheader", { name: "竞价 / 币种", exact: true })).toHaveCount(0);
    await expect(page.getByLabel(`${label} 排序`, { exact: true }).locator('option[value="bid"]')).toHaveCount(0);
    if (type.includes("campaign-negative")) {
      await expect(page.getByLabel(`${label} Ad Group ID`, { exact: true })).toHaveCount(0);
      await expect(table.getByRole("button", { name: "Ad Group 900", exact: true })).toHaveCount(0);
    }
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await expect.poll(() => requests.at(-1)?.searchParams.get("page")).toBe("2");
    await page.getByLabel(`${label} 搜索`, { exact: true }).fill("Child 1");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect.poll(() => requests.at(-1)?.searchParams.get("search")).toBe("Child 1");
  }
});

for (const mode of [403, 500, "invalid", "empty"] as const) test(`standalone Keywords ${mode} is explicit and recoverable without Demo fallback`, async ({ page }) => {
  const control: Control = {};
  await setup(page, control, "/amazon-ads/keywords?live=1");
  await expect(page.getByRole("table", { name: "本地关键词", exact: true })).toBeVisible();
  control.mode = mode;
  await page.getByRole("button", { name: "刷新关键词", exact: true }).click();
  if (mode === "empty") await expect(page.getByText("没有已保存的记录", { exact: true })).toBeVisible();
  else await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("private upstream details");
  await expect(page.getByText("广告表现演示数据", { exact: true })).toHaveCount(0);
  control.mode = undefined;
  await page.getByRole("button", { name: mode === "empty" ? "刷新关键词" : "重试", exact: true }).click();
  await expect(page.getByRole("table", { name: "本地关键词", exact: true })).toBeVisible();
});

test("local navigation reaches standalone structure domains and rejects unsupported structure detail paths", async ({ page }) => {
  const { requests } = await setup(page);
  const nav = page.getByRole("complementary", { name: "本地广告导航" });
  for (const label of ["关键词", "商品投放", "否定投放"]) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("table")).toBeVisible();
  }
  await page.goto("http://127.0.0.1:43239/amazon-ads/keywords/profile-a/3000?live=1");
  await expect(page.getByRole("alert")).toContainText("尚未接入");
  const count = requests.length;
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(requests).toHaveLength(count);
});

test("a late negative-keyword response cannot replace the newly selected targeting domain", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { entered = resolve; });
  const { errors } = await setup(page, { wait: async url => {
    if (url.searchParams.get("entityType") === "SP:negative-keyword") { entered(); await gate; }
  } }, "/amazon-ads/negatives?live=1");
  await pending;
  await expect(page.getByRole("status")).toContainText("正在读取");
  await page.getByRole("navigation", { name: "否定投放层级与类型" }).getByRole("button", { name: "活动否定商品投放", exact: true }).click();
  await expect(page.getByRole("table", { name: "本地活动否定商品投放", exact: true })).toContainText("B0FIXTURE");
  release();
  await expect(page.getByRole("table")).toHaveCount(1);
  await expect(page.getByRole("table", { name: "本地广告组否定关键词", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
