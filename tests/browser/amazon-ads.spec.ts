import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
let bundle: string, styles: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: ["tests/browser/amazon-ads-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
  const [{ readFile }, { default: postcss }, { default: tailwind }] = await Promise.all([import("node:fs/promises"), import("postcss"), import("@tailwindcss/postcss")]);
  styles = (await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css + await readFile("src/components/amazon-ads/amazon-ads.css", "utf8");
});
async function setup(page: Page, mockAccounts = false, refreshTokenExpiresAt: string | null = "2027-11-05T08:00:00.000Z", syncedDataMode: "rows" | "empty" = "rows", fixtureTaskStatus = "SUCCEEDED") {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  let boundSeller = "", taskStatus = fixtureTaskStatus;
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe("http://127.0.0.1:43239");
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/integrations/amazon/ads/data") {
        const rows = syncedDataMode === "empty" ? [] : url.searchParams.get("kind") === "reports" ? [{ id: "fact-1", profileId: "profile-db-1", reportType: "campaigns", adProduct: "SPONSORED_PRODUCTS", reportDate: "2026-11-05", campaignId: "amazon-campaign-1", adGroupId: null, targetingId: null, advertisedAsin: null, searchTerm: null, placement: null, impressions: "120", clicks: "8", spend: "12.34", orders: "2", sales: "45.67", units: "2", attributionWindow: "7d", apiVersion: "v3", rawDimensions: { campaignName: "Stored campaign" }, sourceTaskId: "task-report-1", syncedAt: "2026-11-06T01:02:00.000Z" }] : [{ id: "entity-1", profileId: "profile-db-1", entityType: "SP:campaign", externalId: "amazon-campaign-1", parentExternalId: null, state: "enabled", payload: { campaignName: "Stored campaign", dailyBudget: 25 }, sourceUpdatedAt: "2026-11-05T12:00:00.000Z", sourceTaskId: "task-entity-1", syncedAt: "2026-11-06T01:02:00.000Z" }];
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ rows, page: Number(url.searchParams.get("page") ?? 1), pageSize: 100, ...(url.searchParams.get("kind") === "reports" ? { from: "2026-10-08", to: "2026-11-06" } : {}) }) });
      }
      expect(mockAccounts).toBe(true);
      if (url.pathname === "/api/integrations/amazon/ads/sync") {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON();
          if (body.action === "cancel") taskStatus = "CANCELLED";
          return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, status: taskStatus, alreadyFinished: false }) });
        }
        const statusFilter = url.searchParams.get("status") ?? "";
        const profileFilter = url.searchParams.get("profileId") ?? "";
        const task = { id: "task-entity-1", planId: "plan-1", profileId: "ads-profile-1", status: taskStatus, stage: taskStatus === "SUCCEEDED" ? "COMPLETED_SP_STRUCTURE" : "campaigns", trigger: "scheduled-structure", attempts: 0, maxAttempts: 5, processedCount: 8, apiRequests: 8, errorCode: null, requestedFrom: null, requestedTo: null, startedAt: "2026-11-06T01:00:00.000Z", finishedAt: taskStatus === "RUNNING" ? null : "2026-11-06T01:02:00.000Z", createdAt: "2026-11-06T01:00:00.000Z", profile: { profileId: "189000123456789", region: "NA", countryCode: "US", marketplaceId: "ATVPDKIKX0DER", sellerAccountId: "seller-us" }, attemptRuns: [{ attemptNumber: 1, stage: "campaigns", status: taskStatus, startedAt: "2026-11-06T01:00:00.000Z", finishedAt: taskStatus === "RUNNING" ? null : "2026-11-06T01:02:00.000Z", retryAt: null, errorCode: null, safeErrorSummary: null, apiRequests: 1, processedCount: 1 }] };
        const history = (!statusFilter || statusFilter === taskStatus) && (!profileFilter || profileFilter === task.profileId) ? [task] : [];
        const plan = { id: "plan-1", profileId: "ads-profile-1", status: "ACTIVE", nextRunAt: "2026-11-07T01:02:00.000Z", lastSuccessAt: "2026-11-06T01:02:00.000Z", lastErrorCode: null, profile: { profileId: "189000123456789", region: "NA", countryCode: "US", marketplaceId: "ATVPDKIKX0DER", sellerAccountId: "seller-us", authorization: { name: "Northstar Ads", status: "CONNECTED" } }, tasks: [task] };
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ dataDomain: "SP_STRUCTURE", reportSyncEnabled: false, freshness: [{ profileId: "ads-profile-1", dataDomain: "entities", reportType: "", status: "CURRENT", coveredFrom: null, coveredTo: null, lastAttemptAt: "2026-11-06T01:02:00.000Z", lastSuccessAt: "2026-11-06T01:02:00.000Z", lastTaskId: "task-entity-1", warningCodes: [] }], taskHistory: history, taskPagination: { page: Number(url.searchParams.get("page") ?? 1), pageSize: 20, total: history.length, pageCount: history.length ? 1 : 0, hasMore: false }, taskFilters: { profileId: profileFilter || null, status: statusFilter || null }, plans: [plan] }) });
      }
      expect(url.pathname).toBe("/api/integrations/amazon/ads/profiles");
      if (route.request().method() === "POST") {
        boundSeller = String(route.request().postDataJSON().sellerAccountId ?? "");
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ oauthConfigured: false, sellers: [{ id: "seller-us", displayName: "Northstar US", marketplaceCode: "US" }], profiles: [{ id: "ads-profile-1", authorizationId: "ads-auth-1", region: "NA", profileId: "189000123456789", countryCode: "US", marketplaceId: "ATVPDKIKX0DER", currencyCode: "USD", timezone: "America/Los_Angeles", sellerAccountId: boundSeller || null, lastDiscoveredAt: "2026-11-05T08:00:00.000Z", accountInfo: { name: "Northstar Ads", type: "seller" }, authorization: { name: "Northstar Ads", status: "CONNECTED", lastValidatedAt: "2026-11-05T08:00:00.000Z", refreshTokenExpiresAt } }] }) });
    }
    if (url.pathname === "/styles.css") return route.fulfill({ contentType: "text/css", body: styles });
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    return route.fulfill({ contentType: "text/html", body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43239/amazon-ads/campaigns");
  return errors;
}
const table = (p: Page) => p.locator(".ads-table-panel");
test("campaign table search, sort, columns, pagination, selection and CSV", async ({ page }) => {
  const errors = await setup(page);
  await expect(table(page).locator("tbody tr")).toHaveCount(25);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".ads-pagination")).toContainText("26–50");
  await page.getByLabel("每页显示数量").selectOption("100");
  await expect(table(page).locator("tbody tr")).toHaveCount(64);
  await page.getByLabel("查找广告活动名称").fill("Bamboo");
  await expect(table(page).locator("tbody tr")).toHaveCount(8);
  await page.getByRole("button", { name: "列", exact: true }).click();
  await page.locator(".ads-column-popover").getByText("开始日期", { exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(table(page).getByRole("columnheader", { name: "开始日期" })).toHaveCount(0);
  await table(page).getByRole("button", { name: "花费", exact: true }).click();
  await expect(table(page).getByRole("columnheader", { name: "花费" })).toHaveAttribute("aria-sort", "ascending");
  await page.getByLabel("选择当前页").check();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(table(page).locator("tbody")).not.toContainText("正在投放");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toContain("DEMO-campaigns-8");
  await page.getByLabel("查找广告活动名称").fill("impossible-no-results");
  await expect(table(page)).toContainText("没有符合条件的记录");
  expect(errors).toEqual([]);
});
test("accounts page displays persisted Profiles and binds an ERP seller without starting OAuth", async ({ page }) => {
  const errors = await setup(page, true);
  await page.locator(".ads-sidebar").getByRole("button", { name: "广告账户与授权", exact: true }).click();
  await expect(page.locator(".ads-account-panel > .ads-account-heading h2")).toHaveText("广告账户与授权");
  await expect(page.locator(".ads-account-panel > .ads-table-scroll tbody")).toContainText("Northstar Ads");
  await expect(page.locator(".ads-account-panel > .ads-table-scroll tbody")).toContainText("189000123456789");
  await expect(page.getByRole("heading", { name: "任务历史", exact: true })).toBeVisible();
  await expect(page.locator(".ads-sync-history-panel")).toContainText("COMPLETED_SP_STRUCTURE");
  await expect(page.getByRole("button", { name: "连接 Amazon Ads", exact: true })).toBeDisabled();
  await page.getByLabel("189000123456789 ERP 店铺绑定").selectOption("seller-us");
  await expect(page.getByRole("status")).toContainText("店铺绑定已保存");
  expect(errors).toEqual([]);
});
test("sync task history filters every authorized Profile, paginates server results and refreshes cancellation", async ({ page }) => {
  const errors = await setup(page, true);
  let activeStatus = "RUNNING";
  const requests: URL[] = [];
  const detailRequests: URL[] = [];
  await page.route("**/api/integrations/amazon/ads/profiles", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    oauthConfigured: false, autoSyncConfigured: false,
    sellers: [{ id: "seller-us", displayName: "Northstar US", marketplaceCode: "US" }],
    profiles: [
      { id: "profile-one", authorizationId: "auth-one", region: "NA", profileId: "189000123456789", countryCode: "US", marketplaceId: "ATVPDKIKX0DER", currencyCode: "USD", timezone: "America/Los_Angeles", sellerAccountId: "seller-us", lastDiscoveredAt: "2026-11-05T08:00:00.000Z", accountInfo: { name: "Northstar Ads", type: "seller" }, authorization: { name: "Northstar Ads", status: "CONNECTED", lastValidatedAt: "2026-11-05T08:00:00.000Z", refreshTokenExpiresAt: null } },
      { id: "profile-two", authorizationId: "auth-two", region: "EU", profileId: "298000123456789", countryCode: "DE", marketplaceId: "A1PA6795UKMFR9", currencyCode: "EUR", timezone: "Europe/Berlin", sellerAccountId: null, lastDiscoveredAt: "2026-11-05T08:00:00.000Z", accountInfo: { name: "Northstar EU", type: "seller" }, authorization: { name: "Northstar EU", status: "CONNECTED", lastValidatedAt: "2026-11-05T08:00:00.000Z", refreshTokenExpiresAt: null } },
    ],
  }) }));
  await page.route("**/api/integrations/amazon/ads/sync**", async route => {
    if (route.request().method() === "POST") {
      activeStatus = "CANCELLED";
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, taskId: "task-active", status: activeStatus, alreadyFinished: false }) });
    }
    const url = new URL(route.request().url()); requests.push(url);
    const status = url.searchParams.get("status") ?? "";
    const profileId = url.searchParams.get("profileId") ?? "";
    const allTasks = Array.from({ length: 25 }, (_, index) => {
      const isActive = index === 0;
      const taskStatus = isActive ? activeStatus : "SUCCEEDED";
      return { id: isActive ? "task-active" : `task-${index + 1}`, planId: "plan-one", profileId: "profile-one", status: taskStatus, stage: taskStatus === "SUCCEEDED" ? "COMPLETED_SP_STRUCTURE" : "campaigns", trigger: "manual-structure", attempts: isActive ? 1 : 0, maxAttempts: 5, processedCount: index, apiRequests: index, errorCode: null, requestedFrom: null, requestedTo: null, startedAt: "2026-11-06T01:00:00.000Z", finishedAt: taskStatus === "RUNNING" ? null : "2026-11-06T01:02:00.000Z", createdAt: `2026-11-06T01:${String(index).padStart(2, "0")}:00.000Z`, profile: { profileId: "189000123456789", region: "NA", countryCode: "US", marketplaceId: "ATVPDKIKX0DER", sellerAccountId: "seller-us" }, attemptRuns: [{ attemptNumber: 1, stage: "campaigns", status: taskStatus, startedAt: "2026-11-06T01:00:00.000Z", finishedAt: taskStatus === "RUNNING" ? null : "2026-11-06T01:02:00.000Z", retryAt: null, errorCode: null, safeErrorSummary: null, apiRequests: 1, processedCount: index }] };
    }).filter(task => (!status || task.status === status) && (!profileId || task.profileId === profileId));
    if (url.searchParams.has("taskId")) {
      detailRequests.push(url);
      const attemptPage = Number(url.searchParams.get("attemptPage") ?? 1);
      const allAttempts = Array.from({ length: 12 }, (_, index) => ({ attemptNumber: index + 1, stage: `stage-${index + 1}`, status: "SUCCEEDED", startedAt: "2026-11-06T01:00:00.000Z", finishedAt: "2026-11-06T01:02:00.000Z", retryAt: null, errorCode: null, safeErrorSummary: null, apiRequests: 1, processedCount: 1 }));
      const task = allTasks.find(candidate => candidate.id === url.searchParams.get("taskId")) ?? allTasks[0];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ taskDetail: {
        ...task, insertedCount: 1, updatedCount: 0, failedCount: 0, throttles: 0,
        profile: { ...task.profile, currencyCode: "USD", timezone: "America/Los_Angeles", authorization: { name: "Northstar Ads", status: "CONNECTED" } },
        plan: { id: "plan-one", status: "ACTIVE", intervalMinutes: 1440, reportLookbackDays: 14, attributionLagDays: 14 },
        attemptRuns: allAttempts.slice((attemptPage - 1) * 10, attemptPage * 10),
        attemptPagination: { page: attemptPage, pageSize: 10, total: allAttempts.length, pageCount: 2, hasMore: attemptPage < 2 },
        reportRequests: [{ id: "report-request-1", versionId: "report-version-1", reportType: "spCampaigns", adProduct: "SPONSORED_PRODUCTS", apiVersion: "v3", requestedFrom: "2026-11-01", requestedTo: "2026-11-01", status: "COMPLETED", warningCodes: [], errorCode: null, requestedAt: "2026-11-06T01:00:00.000Z", lastPolledAt: "2026-11-06T01:01:00.000Z", completedAt: "2026-11-06T01:02:00.000Z", documents: [{ id: "document-1", partIndex: 0, format: "GZIP_JSON", compression: "GZIP", status: "DOWNLOADED", byteSize: "1024", rowCount: 18, downloadedAt: "2026-11-06T01:02:00.000Z" }], documentsTotal: 1, documentsTruncated: false }], reportRequestTotal: 1, reportRequestsTruncated: false,
        reportVersions: [{ id: "report-version-1", status: "PUBLISHED", requestedFrom: "2026-11-01", requestedTo: "2026-11-01", rowCount: 18, publishedAt: "2026-11-06T01:02:00.000Z", createdAt: "2026-11-06T01:01:00.000Z", updatedAt: "2026-11-06T01:02:00.000Z" }], reportVersionTotal: 1, reportVersionsTruncated: false,
        freshness: [{ profileId: "profile-one", dataDomain: "reports", reportType: "spCampaigns", status: "CURRENT", coveredFrom: "2026-11-01", coveredTo: "2026-11-01", lastAttemptAt: "2026-11-06T01:00:00.000Z", lastSuccessAt: "2026-11-06T01:02:00.000Z", lastTaskId: "task-active", warningCodes: [] }],
      } }) });
    }
    const pageNumber = Number(url.searchParams.get("page") ?? 1);
    const pageSize = Number(url.searchParams.get("pageSize") ?? 20);
    const plan = { id: "plan-one", profileId: "profile-one", status: "ACTIVE", nextRunAt: "2026-11-07T01:02:00.000Z", lastSuccessAt: "2026-11-06T01:02:00.000Z", lastErrorCode: null, profile: { profileId: "189000123456789", region: "NA", countryCode: "US", marketplaceId: "ATVPDKIKX0DER", sellerAccountId: "seller-us", authorization: { name: "Northstar Ads", status: "CONNECTED" } }, tasks: [] };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ dataDomain: "SP_STRUCTURE", reportSyncEnabled: false, freshness: [], plans: [plan], taskHistory: allTasks.slice((pageNumber - 1) * pageSize, pageNumber * pageSize), taskPagination: { page: pageNumber, pageSize, total: allTasks.length, pageCount: Math.ceil(allTasks.length / pageSize), hasMore: pageNumber * pageSize < allTasks.length }, taskFilters: { profileId: profileId || null, status: status || null } }) });
  });
  await page.locator(".ads-sidebar").getByRole("button", { name: "广告账户与授权", exact: true }).click();
  await expect(page.getByLabel("同步任务 Profile 筛选").locator("option")).toHaveCount(3);
  await expect(page.locator(".ads-sync-history-panel .ads-simple-table tbody tr")).toHaveCount(20);
  await expect(page.locator(".ads-sync-history-panel .ads-pagination")).toContainText("共 25 项 · 第 1 / 2 页");
  await page.locator(".ads-sync-history-panel").getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".ads-sync-history-panel .ads-simple-table tbody tr")).toHaveCount(5);
  await page.locator(".ads-sync-history-panel").getByRole("button", { name: "上一页", exact: true }).click();
  const row = page.locator(".ads-sync-history-panel tbody tr").filter({ hasText: "task-active" });
  await row.getByRole("button", { name: "详情", exact: true }).click();
  const detail = page.getByRole("region", { name: "同步任务详情" });
  await expect(detail).toContainText("Attempt 明细");
  await expect(detail).toContainText("spCampaigns · SPONSORED_PRODUCTS");
  await expect(detail).toContainText("PUBLISHED");
  await expect(detail.locator(".ads-table-scroll").first().locator("tbody tr")).toHaveCount(10);
  await detail.locator(".ads-task-detail-pagination").getByRole("button", { name: "下一页", exact: true }).click();
  await expect.poll(() => detailRequests.at(-1)?.searchParams.get("attemptPage")).toBe("2");
  await expect(detail.locator(".ads-table-scroll").first().locator("tbody tr")).toHaveCount(2);
  await page.once("dialog", dialog => dialog.accept());
  await row.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".ads-account-message")).toContainText("已取消");
  await expect(row).toContainText("CANCELLED");
  await page.getByLabel("同步任务状态筛选").selectOption("CANCELLED");
  await expect.poll(() => requests.at(-1)?.searchParams.get("status")).toBe("CANCELLED");
  await expect(page.locator(".ads-sync-history-panel:not([aria-label]) > .ads-table-scroll tbody tr")).toHaveCount(1);
  await page.getByLabel("同步任务 Profile 筛选").selectOption("profile-two");
  await expect.poll(() => requests.at(-1)?.searchParams.get("profileId")).toBe("profile-two");
  await expect(page.locator(".ads-sync-history-panel .ads-empty")).toContainText("没有同步任务");
  expect(errors).toEqual([]);
});
test("accounts page marks a missing refresh-token expiry date as unknown", async ({ page }) => {
  const errors = await setup(page, true, null);
  await page.locator(".ads-sidebar").getByRole("button", { name: "广告账户与授权", exact: true }).click();
  await expect(page.locator(".ads-account-expiry.unknown")).toContainText("到期状态未知");
  expect(errors).toEqual([]);
});
test("synced-data view reads persisted facts without falling back to demo fixtures", async ({ page }) => {
  const errors = await setup(page);
  await page.getByRole("button", { name: "已同步数据", exact: true }).click();
  await expect(page.getByRole("heading", { name: "已同步 Ads 数据" })).toBeVisible();
  await expect(page.locator(".ads-synced-table")).toContainText("内部 Profile ID");
  await expect(page.locator(".ads-synced-notice")).toContainText("不是 Amazon Profile ID");
  await expect(page.locator(".ads-synced-table tbody")).toContainText("amazon-campaign-1");
  await expect(page.locator(".ads-synced-table tbody")).toContainText("SP:campaign");
  await expect(page.locator(".ads-metric-grid")).toHaveCount(0);
  await page.getByRole("tab", { name: "日报事实" }).click();
  const reportTypeRequest = page.waitForRequest(request => new URL(request.url()).searchParams.get("reportType") === "campaigns");
  await page.getByLabel("报告类型筛选").fill("campaigns");
  await reportTypeRequest;
  await expect(page.locator(".ads-synced-table tbody")).toContainText("12.34");
  await expect(page.locator(".ads-synced-table tbody")).toContainText("v3");
  await page.getByRole("button", { name: "返回演示工作台" }).click();
  await expect(page.locator(".ads-demo-banner")).toContainText("Mock Fixture 驱动");
  expect(errors).toEqual([]);
});
test("synced-data empty state does not show fixture rows", async ({ page }) => {
  const errors = await setup(page, false, "2027-11-05T08:00:00.000Z", "empty");
  await page.getByRole("button", { name: "已同步数据", exact: true }).click();
  await expect(page.locator(".ads-synced-empty")).toContainText("没有已保存的广告结构");
  await expect(page.locator(".ads-synced-table")).toHaveCount(0);
  await expect(page.getByText("Bamboo Kitchen Organizer", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("campaign detail, dates, KPI, group navigation, settings and creation", async ({ page }) => {
  const errors = await setup(page);
  await table(page).locator("tbody .ads-name-col button").first().click();
  await expect(page.getByRole("tab", { name: "广告组", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(table(page).locator("tbody tr")).toHaveCount(6);
  const before = await page.locator(".ads-metric-value").first().textContent();
  await page.locator(".ads-page-toolbar").getByRole("button", { name: /2026-10-30/ }).click();
  await page.getByRole("button", { name: "昨天", exact: true }).click();
  expect(await page.locator(".ads-metric-value").first().textContent()).not.toBe(before);
  await page.getByRole("button", { name: "隐藏图表", exact: true }).click();
  await expect(page.locator(".ads-chart")).toHaveCount(0);
  await page.getByRole("button", { name: "显示图表", exact: true }).click();
  await page.getByRole("button", { name: "选择指标", exact: true }).click();
  await page.locator(".ads-metric-picker").getByText("展示量", { exact: true }).click();
  await expect(page.locator(".ads-metric-grid article")).toHaveCount(7);
  await page.getByRole("tab", { name: "设置", exact: true }).click();
  await page.locator('input[name="budget"]').fill("88");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator(".ads-campaign-meta")).toContainText("$88.00");
  await page.getByRole("tab", { name: "广告组", exact: true }).click();
  await page.getByLabel("查找广告组名称").fill("Core keywords");
  await expect(table(page).locator("tbody tr")).toHaveCount(1);
  await table(page).locator("tbody .ads-name-col button").first().click();
  await page.getByRole("tab", { name: "关键词", exact: true }).click();
  await expect(table(page).locator("tbody tr")).toHaveCount(4);
  await page.locator(".ads-breadcrumb button").first().click();
  await page.locator(".ads-page-toolbar").getByRole("button", { name: "创建广告活动", exact: true }).click();
  await page.getByLabel("新建名称").fill("Fixture campaign test");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: "确认创建演示记录", exact: true }).click();
  await page.getByLabel("查找广告活动名称").fill("Fixture campaign test");
  await expect(table(page).locator("tbody")).toContainText("Fixture campaign test");
  expect(errors).toEqual([]);
});
test("navigation, scopes, reports, preferences, fixed layout at desktop widths", async ({ page }) => {
  const errors = await setup(page);
  await page.getByLabel("国家地区", { exact: true }).selectOption("UK");
  await expect(table(page).locator("tbody tr").first()).toContainText("UK |");
  await expect(table(page).locator("tbody tr").first()).toContainText("£");
  await page.getByLabel("广告账户", { exact: true }).selectOption("evergreen");
  await page.locator(".ads-sidebar").getByRole("button", { name: "搜索词", exact: true }).click();
  await page.getByLabel("Campaign 筛选").selectOption({ index: 1 });
  await expect(table(page).locator("tbody tr")).toHaveCount(24);
  await table(page).locator(".ads-table-toolbar").getByLabel("广告类型筛选").selectOption("SP");
  await expect(table(page).locator("tbody tr")).toHaveCount(24);
  const scopedSpend = await page.locator(".ads-metric-grid article").filter({ hasText: "总成本" }).locator(".ads-metric-value").textContent();
  expect(scopedSpend).not.toBe("$0.00");
  await page.getByLabel("Ad Group 筛选").selectOption({ index: 1 });
  await expect(table(page).locator("tbody tr")).toHaveCount(4);
  const groupSpend = await page.locator(".ads-metric-grid article").filter({ hasText: "总成本" }).locator(".ads-metric-value").textContent();
  expect(groupSpend).not.toBe(scopedSpend);
  await page.locator(".ads-sidebar").getByRole("button", { name: "搜索广告报告", exact: true }).click();
  await page.getByLabel("报告广告类型").selectOption("SB");
  await page.getByRole("button", { name: "生成演示报告", exact: true }).click();
  await expect(page.locator(".ads-simple-table tbody tr")).toHaveCount(4);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 CSV", exact: true }).first().click();
  expect((await download).suggestedFilename()).toContain("DEMO-report-");
  await page.getByLabel("偏好设置", { exact: true }).click();
  await page.getByRole("button", { name: "设为默认首页", exact: true }).click();
  await page.getByRole("button", { name: "保存偏好", exact: true }).click();
  await page.locator(".ads-sidebar").getByRole("button", { name: "营销组合模型", exact: false }).click();
  await expect(page.locator(".ads-planned")).toContainText("规划中");
  await page.getByRole("button", { name: "我的广告首页", exact: true }).click();
  await expect(page.locator(".ads-title-line h1")).toHaveText("偏好设置");
  await page.locator(".ads-nav-item").filter({ hasText: /^广告活动$/ }).click();
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await page.locator(".ads-table-scroll").boundingBox();
    expect(box!.width).toBeGreaterThan(width - 400);
  }
  await page.getByLabel("折叠广告导航", { exact: true }).click();
  await expect(page.locator(".ads-workspace")).toHaveClass(/ads-collapsed/);
  await page.getByLabel("折叠广告导航", { exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await table(page).locator("tbody .ads-name-col button").first().click();
  await page.screenshot({ path: "tmp/amazon-ads-campaign-detail-1440.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("negative targets, bid adjustments, budget rules and session preferences retain state", async ({ page }) => {
  const errors = await setup(page);
  await table(page).locator("tbody .ads-name-col button").first().click();
  await page.getByRole("tab", { name: "竞价调整", exact: true }).click();
  await page.getByLabel("商品页面竞价调整").fill("35");
  await page.getByRole("button", { name: "保存演示竞价调整", exact: true }).click();
  await page.getByRole("tab", { name: "竞价调整", exact: true }).click();
  await expect(page.getByLabel("商品页面竞价调整")).toHaveValue("35");
  await page.getByRole("tab", { name: "预算规则", exact: true }).click();
  await page.getByRole("button", { name: "创建预算规则", exact: true }).click();
  await page.locator('input[name="name"]').fill("Weekend budget");
  await page.getByRole("button", { name: "保存演示草稿", exact: true }).click();
  await expect(page.locator(".ads-simple-table")).toContainText("Weekend budget");
  await page.getByRole("tab", { name: "否定投放", exact: true }).click();
  await expect(table(page).locator("tbody tr")).toHaveCount(12);
  await page.getByRole("tab", { name: "广告组", exact: true }).click();
  await table(page).locator("tbody .ads-name-col button").first().click();
  await page.getByRole("tab", { name: "否定商品投放", exact: true }).click();
  await expect(table(page).locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("偏好设置", { exact: true }).click();
  await page.getByLabel("紧凑表格行高").uncheck();
  await expect(page.locator(".ads-workspace")).toHaveClass(/ads-comfortable/);
  await page.getByRole("button", { name: "保存偏好", exact: true }).click();
  await page.reload();
  await expect(page.locator(".ads-workspace")).toHaveClass(/ads-comfortable/);
  await page.getByLabel("偏好设置", { exact: true }).click();
  await expect(page.getByLabel("紧凑表格行高")).not.toBeChecked();
  await page.goto("http://127.0.0.1:43239/amazon-ads/missing-route");
  await expect(page.locator(".ads-planned")).toContainText("页面不存在");
  expect(errors).toEqual([]);
});
test("narrow viewport keeps the document inside the screen and exposes horizontal table scrolling", async ({ page }) => {
  const errors = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "tmp/amazon-ads-mobile-390.png", fullPage: true });
  const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, offenders: Array.from(document.querySelectorAll<HTMLElement>("body *")).filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(el => [el.className, el.getBoundingClientRect().right, el.getBoundingClientRect().width]) }));
  expect(overflow, JSON.stringify(overflow)).toMatchObject({ width: 390 });
  const tableBox = await page.locator(".ads-table-scroll").boundingBox();
  expect(tableBox!.width).toBeLessThanOrEqual(390);
  expect(await page.locator(".ads-table-scroll").evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  const metricCards = await page.locator(".ads-metric-grid article").evaluateAll(cards => cards.map(card => { const box = card.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }; }));
  expect(metricCards.every(card => card.left >= 76 && card.right <= 390)).toBe(true);
  await page.getByRole("button", { name: "折叠广告导航", exact: true }).click();
  await expect(page.locator(".ads-workspace")).toHaveClass(/ads-collapsed/);
  await expect(page.locator(".ads-sidebar").getByRole("button", { name: "关键词", exact: true })).toBeVisible();
  await page.locator(".ads-sidebar").getByRole("button", { name: "关键词", exact: true }).click();
  await expect(page.locator(".ads-workspace")).not.toHaveClass(/ads-collapsed/);
  await expect(page.locator(".ads-title-line h1")).toHaveText("关键词");
  expect(errors).toEqual([]);
});

test("inline amounts, new SB groups and negative targets complete isolated edit flows", async ({ page }) => {
  const errors = await setup(page);
  await table(page).locator("tbody tr").first().getByRole("button", { name: /编辑每日预算/ }).click();
  await page.getByLabel("编辑金额").fill("92.50");
  await page.getByRole("button", { name: "保存金额", exact: true }).click();
  await expect(table(page).locator("tbody tr").first()).toContainText("$92.50");
  await page.locator(".ads-sidebar").getByRole("button", { name: "品牌推广", exact: true }).click();
  await table(page).locator("tbody .ads-name-col button").first().click();
  await page.getByRole("button", { name: "创建广告组", exact: true }).click();
  await page.getByLabel("新建名称").fill("SB new group isolated");
  await page.getByLabel("新建预算或竞价").fill("0.65");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: "确认创建演示记录", exact: true }).click();
  await page.getByLabel("查找广告组名称").fill("SB new group isolated");
  await expect(table(page).locator("tbody tr")).toHaveCount(1);
  await table(page).getByRole("button", { name: /编辑默认竞价/ }).click();
  await page.getByLabel("编辑金额").fill("1.25");
  await page.getByRole("button", { name: "保存金额", exact: true }).click();
  await expect(table(page).locator("tbody tr")).toContainText("$1.25");
  await table(page).locator("tbody .ads-name-col button").click();
  await expect(page.locator(".ads-campaign-meta")).toContainText("品牌推广");
  await expect(table(page)).toContainText("没有符合条件的记录");
  await page.getByRole("tab", { name: "关键词", exact: true }).click();
  await expect(table(page)).toContainText("没有符合条件的记录");
  await page.getByRole("tab", { name: "否定商品投放", exact: true }).click();
  await page.getByRole("button", { name: "创建否定投放", exact: true }).click();
  await page.getByLabel("否定内容").fill("BAD");
  await page.getByRole("button", { name: "添加演示否定投放", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("10 位");
  await page.getByLabel("否定内容").fill("B0DEMO9999");
  await page.getByRole("button", { name: "添加演示否定投放", exact: true }).click();
  await expect(table(page).locator("tbody")).toContainText('asin="B0DEMO9999"');
  await expect(table(page).getByRole("columnheader", { name: "竞价", exact: true })).toHaveCount(0);
  await expect(page.locator(".ads-performance")).toHaveCount(0);
  await page.getByRole("button", { name: "创建否定投放", exact: true }).click();
  await page.getByLabel("否定内容").fill("B0DEMO9999");
  await page.getByRole("button", { name: "添加演示否定投放", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("已存在");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("tab", { name: "否定关键词", exact: true }).click();
  await expect(table(page)).not.toContainText("B0DEMO9999");
  await page.getByLabel("国家地区", { exact: true }).selectOption("CA");
  await expect(page.locator(".ads-title-line h1")).toHaveText("广告活动");
  await page.locator(".ads-sidebar").getByRole("button", { name: "否定投放", exact: true }).click();
  await page.getByLabel("查找否定投放").fill("B0DEMO9999");
  await expect(table(page)).toContainText("没有符合条件的记录");
  expect(errors).toEqual([]);
});
test("campaign history keeps list-wide and other-campaign events out of detail", async ({ page }) => {
  const errors = await setup(page);
  await page.getByLabel("选择当前页").check();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await table(page).locator("tbody .ads-name-col button").first().click();
  await page.getByRole("tab", { name: "历史", exact: true }).click();
  await expect(page.locator(".ads-simple-panel")).toContainText("暂无更改记录");
  await page.getByRole("tab", { name: "设置", exact: true }).click();
  await page.locator('input[name="budget"]').fill("77");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByRole("tab", { name: "历史", exact: true }).click();
  await expect(page.locator(".ads-simple-table tbody")).toContainText("保存广告活动设置");
  await expect(page.locator(".ads-simple-table tbody tr")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("search term rows expose their actual trigger and omit irrelevant bid columns", async ({ page }) => {
  const errors = await setup(page);
  await page.locator(".ads-sidebar").getByRole("button", { name: "搜索词", exact: true }).click();
  await expect(table(page).getByRole("columnheader", { name: "搜索词", exact: true })).toBeVisible();
  await expect(table(page).getByRole("columnheader", { name: "触发关键词 / 商品投放", exact: true })).toBeVisible();
  await expect(table(page).getByRole("columnheader", { name: "触发类型", exact: true })).toBeVisible();
  await expect(table(page).getByRole("columnheader", { name: "竞价", exact: true })).toHaveCount(0);
  await expect(table(page).locator("tbody")).toContainText("关键词");
  await page.getByLabel("查找搜索词").fill("large");
  await expect(table(page).locator("tbody")).toContainText("商品投放");
  await expect(table(page).locator("tbody")).toContainText('asin="B0DEMO');
  await page.getByLabel("查找搜索词").clear();
  await page.getByLabel("Campaign 筛选").selectOption({ index: 1 });
  await expect(table(page).locator("tbody tr")).toHaveCount(24);
  const campaign = await table(page).locator("tbody .ads-name-col").first().textContent();
  await expect(table(page).locator("tbody")).toContainText(campaign!.split(" - ")[0]);
  expect(errors).toEqual([]);
});

test("real workspace uses server totals, entity filters and server pagination without demo KPI", async ({ page }) => {
  const errors = await setup(page);
  const requests: URL[] = [];
  await page.route("**/api/integrations/amazon/ads/data?*", route => {
    const url = new URL(route.request().url()); requests.push(url);
    const current = Number(url.searchParams.get("page") ?? 1);
    const rows = Array.from({ length: current === 1 ? 100 : 1 }, (_, i) => ({ id: `stored-${current}-${i}`, profileId: "profile-db", entityType: url.searchParams.get("entityType") || "SP:campaign", externalId: String(current * 100 + i), parentExternalId: null, state: "ENABLED", payload: { name: "Stored only" }, sourceTaskId: "task-db", syncedAt: "2026-11-06T00:00:00Z" }));
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ rows, total: 101, page: current, pageSize: 100, meta: { source: "AmazonAdsEntityRecord", lastSyncAt: "2026-11-06T00:00:00Z", coverage: "CURRENT_OBSERVED_ROWS_NO_DELETION_INFERENCE", profiles: [] } }) });
  });
  await page.goto("http://127.0.0.1:43239/amazon-ads/campaigns?real=1");
  await expect(page.getByRole("heading", { name: "已同步 Ads 数据" })).toBeVisible();
  await expect(page.locator(".ads-metric-grid")).toHaveCount(0);
  await expect(page.locator(".ads-synced-pagination")).toContainText("筛选总量 101 条");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".ads-synced-page")).toContainText("第 2 页");
  await expect(page.locator(".ads-synced-table tbody tr")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Campaign 否定词", exact: true }).click();
  await expect(page.locator(".ads-synced-page")).toContainText("第 1 页");
  await expect.poll(() => requests.at(-1)?.searchParams.get("entityType")).toBe("SP:campaign-negative-keyword");
  await page.getByLabel("真实状态筛选").selectOption("ARCHIVED");
  await expect.poll(() => requests.at(-1)?.searchParams.get("state")).toBe("ARCHIVED");
  await page.getByLabel("真实排序字段").selectOption("syncedAt");
  await expect.poll(() => requests.at(-1)?.searchParams.get("sort")).toBe("syncedAt");
  expect(errors).toEqual([]);
});

test("stored entity details navigate the real hierarchy and keep campaign negatives distinct", async ({ page }) => {
  const errors = await setup(page);
  const requests: URL[] = [];
  await page.route("**/api/integrations/amazon/ads/data?*", route => {
    const url = new URL(route.request().url()); requests.push(url);
    const entityType = url.searchParams.get("entityType") || "SP:campaign";
    const row = { id: "stored-detail", profileId: "internal-profile", amazonProfileId: "external-profile", entityType, externalId: entityType === "SP:campaign" ? "campaign-100" : "negative-100", parentExternalId: entityType === "SP:campaign" ? null : "campaign-100", state: "ARCHIVED", payload: { name: "Stored detail", campaignId: "campaign-100", keywordText: "negative exact", matchType: "NEGATIVE_EXACT" }, sourceTask: { status: "SUCCEEDED", stage: "COMPLETED_SP_STRUCTURE" }, sourceTaskId: "source-task", syncedAt: "2026-11-06T00:00:00Z" };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [row], total: 1, page: 1, pageSize: 100 }) });
  });
  await page.goto("http://127.0.0.1:43239/amazon-ads/campaigns?real=1");
  await page.getByRole("button", { name: "查看实体 campaign-100", exact: true }).click();
  const detail = page.getByRole("region", { name: "广告实体详情" });
  await expect(detail).toContainText("internal-profile");
  await expect(detail).toContainText("external-profile");
  await expect(detail).toContainText("source-task");
  await expect(detail).toContainText("ARCHIVED");
  await detail.getByRole("button", { name: "查看 Campaign 否定词", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("entityType")).toBe("SP:campaign-negative-keyword");
  expect(requests.at(-1)?.searchParams.get("campaignId")).toBe("campaign-100");
  expect(requests.at(-1)?.searchParams.get("internalProfileId")).toBe("internal-profile");
  expect(requests.at(-1)?.searchParams.has("adGroupId")).toBe(false);
  await expect(detail).toHaveCount(0);
  await page.getByRole("button", { name: "查看实体 negative-100", exact: true }).click();
  await expect(detail).toContainText("Campaign 级否定项，直接属于 Campaign，不属于 Ad Group");
  await expect(detail.getByRole("button", { name: /查看下属/ })).toHaveCount(0);
  await detail.getByRole("button", { name: "关闭实体详情", exact: true }).click();
  await expect(detail).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("normalized entities override stale payload values and retain hierarchy when drilling down", async ({ page }) => {
  const errors = await setup(page);
  const requests: URL[] = [];
  await page.route("**/api/integrations/amazon/ads/data?*", route => {
    const url = new URL(route.request().url()); requests.push(url);
    const target = url.searchParams.get("entityType") === "SP:target";
    const row = { id: "normalized", profileId: "normalized-profile", amazonProfileId: "amazon-profile", entityType: target ? "SP:target" : "SP:ad-group", externalId: target ? "target-normalized" : "group-normalized", parentExternalId: "campaign-normalized", campaignId: "campaign-normalized", adGroupId: "group-normalized", name: "Normalized name", bid: "0", budgetAmount: "24.50", budgetType: "DAILY", matchType: "EXACT", targetingType: "MANUAL", expressionType: "MANUAL", targetingExpression: [{ type: "ASIN_SAME_AS", value: "B0TESTONLY" }], startDate: "2026-11-01", endDate: null, state: "ENABLED", payload: target ? {} : { name: "Stale payload name", bid: "9.99", campaignId: "stale-campaign", budget: { budget: 999 } }, sourceTaskId: "task-normalized", syncedAt: "2026-11-06T00:00:00Z" };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [row], total: 1, page: 1, pageSize: 100 }) });
  });
  await page.goto("http://127.0.0.1:43239/amazon-ads/campaigns?real=1");
  const storedTable = page.locator(".ads-synced-table");
  await expect(storedTable.locator("tbody tr")).toContainText("Normalized name");
  await expect(storedTable.locator("tbody tr td").nth(4)).toHaveText("0");
  await page.getByLabel("真实排序字段").selectOption("bid");
  await expect.poll(() => requests.at(-1)?.searchParams.get("sort")).toBe("bid");
  await expect(storedTable).toBeVisible();
  await page.getByRole("button", { name: "查看实体 group-normalized", exact: true }).click();
  const detail = page.getByRole("region", { name: "广告实体详情" });
  await expect(detail.getByRole("heading")).toContainText("Normalized name");
  await expect(detail).not.toContainText("Stale payload name");
  await expect(detail).toContainText("24.50"); await expect(detail).toContainText("2026-11-01");
  await detail.getByText("投放表达式", { exact: true }).click();
  await expect(detail.locator("pre")).toContainText("B0TESTONLY");
  await detail.getByRole("button", { name: "查看下属 Target", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("campaignId")).toBe("campaign-normalized");
  expect(requests.at(-1)?.searchParams.get("adGroupId")).toBe("group-normalized");
  expect(requests.at(-1)?.searchParams.get("internalProfileId")).toBe("normalized-profile");
  await expect(storedTable).toContainText("Normalized name");
  await page.getByRole("button", { name: "查看实体 target-normalized", exact: true }).click();
  await expect(detail.getByRole("heading")).toContainText("Normalized name");
  expect(errors).toEqual([]);
});

test("structure status and warnings remain visible for syncing and unknown stored data", async ({ page }) => {
  const errors = await setup(page);
  let status = "SYNCING";
  await page.route("**/api/integrations/amazon/ads/data?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    rows: [], total: 0, page: 1, pageSize: 100, warnings: ["来源快照缺少完整覆盖证据"],
    meta: { coverage: status, source: "amazon_ads_postgres", lastSyncAt: null, profiles: [{ id: "stored-profile", amazonProfileId: "amazon-profile", freshness: status, syncPlans: [] }] },
  }) }));
  await page.goto("http://127.0.0.1:43239/amazon-ads/campaigns?real=1");
  await expect(page.locator(".ads-synced-view")).toContainText("结构域状态 SYNCING");
  await expect(page.locator(".ads-synced-view")).toContainText("最近结构成功 —");
  await expect(page.locator(".ads-synced-view")).toContainText("来源快照缺少完整覆盖证据");
  await expect(page.locator("summary").filter({ hasText: "amazon-profile" })).toContainText("SYNCING");
  status = "UNKNOWN";
  await page.getByRole("button", { name: "重新读取已保存数据", exact: true }).click();
  await expect(page.locator(".ads-synced-view")).toContainText("结构域状态 UNKNOWN");
  await expect(page.locator("summary").filter({ hasText: "amazon-profile" })).toContainText("UNKNOWN");
  expect(errors).toEqual([]);
});

test("changing data domains clears the previous scope totals and source metadata while loading", async ({ page }) => {
  const errors = await setup(page);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/integrations/amazon/ads/data?*", async route => {
    const reports = new URL(route.request().url()).searchParams.get("kind") === "reports";
    if (reports) await gate;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], total: reports ? 0 : 77, page: 1, pageSize: 100, meta: { profiles: [], source: reports ? "Report source" : "Previous entity source", lastSyncAt: "2026-11-06T00:00:00Z" } }) });
  });
  await page.goto("http://127.0.0.1:43239/amazon-ads/campaigns?real=1");
  await expect(page.locator(".ads-synced-pagination")).toContainText("筛选总量 77 条");
  await page.getByRole("tab", { name: "日报事实", exact: true }).click();
  try {
    await expect(page.getByText("正在读取数据库记录…", { exact: true })).toBeVisible();
    await expect(page.locator(".ads-synced-pagination")).not.toContainText("77");
    await expect(page.locator(".ads-synced-view")).not.toContainText("Previous entity source");
  } finally { release(); }
  await expect(page.locator(".ads-synced-pagination")).toContainText("筛选总量 0 条");
  expect(errors).toEqual([]);
});

test("published reports show versions, nulls and server-side scope filters", async ({ page }) => {
  const errors = await setup(page);
  const requests: URL[] = [];
  await page.route("**/api/integrations/amazon/ads/data?*", route => {
    const url = new URL(route.request().url()); requests.push(url);
    const profiles = [{ id: "internal-profile", amazonProfileId: "amazon-profile", authorizationId: "ads-auth", sellerAccountId: "store-id", seller: { displayName: "Stored store" }, currencyCode: "USD", timezone: "America/Los_Angeles", freshness: "report_age_not_evaluated", syncPlans: [] }];
    const reports = url.searchParams.get("kind") === "reports";
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: reports ? [{ id: "report-fact", profileId: "internal-profile", reportType: "fixture-campaign", adProduct: "SPONSORED_PRODUCTS", reportDate: "2026-11-01", campaignId: "campaign-100", impressions: null, clicks: "0", spend: null, orders: null, sales: null, apiVersion: "fixture-only", sourceTaskId: "task-report", syncedAt: "2026-11-06T00:00:00Z", versionId: "published-version", versionStatus: "PUBLISHED", publishedAt: "2026-11-06T00:00:00Z" }] : [], total: reports ? 1 : 0, page: 1, pageSize: 100, meta: { profiles, source: reports ? "AmazonAdsReportFact" : "AmazonAdsEntityRecord", lastSyncAt: "2026-11-06T00:00:00Z" } }) });
  });
  await page.goto("http://127.0.0.1:43239/amazon-ads/campaigns?real=1");
  await page.getByRole("tab", { name: "日报事实", exact: true }).click();
  await expect(page.locator(".ads-synced-table")).toContainText("published-version");
  await expect(page.locator(".ads-synced-table")).toContainText("PUBLISHED");
  await expect(page.locator(".ads-synced-table")).toContainText("—");
  await expect(page.locator(".ads-synced-table")).not.toContainText("null");
  await page.getByLabel("日报 Profile 筛选").selectOption("internal-profile");
  await expect.poll(() => requests.at(-1)?.searchParams.get("internalProfileId")).toBe("internal-profile");
  await page.getByLabel("日报排序字段").selectOption("spend");
  await expect.poll(() => requests.at(-1)?.searchParams.get("sortBy")).toBe("spend");
  await expect(page.locator(".ads-metric-grid")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Campaign detail opens its published daily reports with internal Profile and exact contract", async ({ page }) => {
  const errors = await setup(page);
  const requests: URL[] = [];
  await page.route("**/api/integrations/amazon/ads/data?*", route => {
    const url = new URL(route.request().url()); requests.push(url);
    const reports = url.searchParams.get("kind") === "reports";
    const profiles = [{ id: "internal-profile", amazonProfileId: "amazon-profile", syncPlans: [] }];
    const entity = { id: "campaign-record", profileId: "internal-profile", amazonProfileId: "amazon-profile", entityType: "SP:campaign", externalId: "campaign-100", name: "Stored Campaign", payload: {}, sourceTaskId: "structure-task", syncedAt: "2026-11-06T00:00:00Z" };
    const fact = { id: "daily-fact", profileId: "internal-profile", reportType: "spCampaigns", adProduct: "SPONSORED_PRODUCTS", reportDate: "2026-11-01", campaignId: "campaign-100", clicks: "0", spend: null, sourceTaskId: "report-task", apiVersion: "reporting-v3", versionId: "published-version", versionStatus: "PUBLISHED" };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [reports ? fact : entity], total: 1, page: 1, pageSize: 100, meta: { profiles, source: reports ? "AmazonAdsReportFact" : "AmazonAdsEntityRecord" } }) });
  });
  await page.goto("http://127.0.0.1:43239/amazon-ads/campaigns?real=1");
  await page.getByRole("button", { name: "查看实体 campaign-100", exact: true }).click();
  await page.getByRole("button", { name: "查看 Campaign 已发布日报", exact: true }).click();
  await expect(page.getByLabel("日报 Profile 筛选")).toHaveValue("internal-profile");
  await expect(page.getByLabel("日报 Campaign 筛选")).toHaveValue("campaign-100");
  await expect(page.getByLabel("报告类型筛选")).toHaveValue("spCampaigns");
  await expect.poll(() => requests.at(-1)?.searchParams.get("kind")).toBe("reports");
  const query = requests.at(-1)!.searchParams;
  expect(query.get("internalProfileId")).toBe("internal-profile");
  expect(query.get("campaignId")).toBe("campaign-100");
  expect(query.get("reportType")).toBe("spCampaigns");
  expect(query.get("adProduct")).toBe("SPONSORED_PRODUCTS");
  expect(query.get("adGroupId")).toBeNull();
  const row = page.locator(".ads-synced-table tbody tr");
  await expect(row).toContainText("published-version");
  await expect(row).toContainText("report-task");
  await expect(row.locator("td").nth(6)).toHaveText("0");
  await expect(row.locator("td").nth(7)).toHaveText("—");
  await expect(page.getByRole("region", { name: "广告实体详情" })).toHaveCount(0);
  await expect(page.locator(".ads-metric-grid")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("report totals use server-wide groups across pages and preserve precision, zero and null", async ({ page }) => {
  const errors = await setup(page);
  await page.route("**/api/integrations/amazon/ads/data?*", route => {
    const url = new URL(route.request().url());
    const reports = url.searchParams.get("kind") === "reports";
    const filtered = url.searchParams.get("campaignId") === "none";
    const current = Number(url.searchParams.get("page") ?? 1);
    const base = { reportType: "fixture_campaign", adProduct: "SPONSORED_PRODUCTS", apiVersion: "fixture-v1", impressions: "18446744073709551614", clicks: "0", orders: null, sales: null, units: "0" };
    const totals = [{ ...base, currencyCode: "USD", attributionWindow: "7d", spend: "199999999999999.999998" }, { ...base, currencyCode: "EUR", attributionWindow: "14d", spend: "2.5" }, { ...base, currencyCode: null, attributionWindow: null, spend: null }];
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      rows: reports && !filtered ? [{ id: `fact-${current}`, profileId: "internal-profile", reportType: "fixture_campaign", adProduct: base.adProduct, reportDate: "2026-11-01", spend: "1", clicks: "0", sourceTaskId: "task", syncedAt: "2026-11-06T00:00:00Z", apiVersion: base.apiVersion }] : [],
      total: reports && !filtered ? 101 : 0, totals: reports && !filtered ? totals : [], page: current, pageSize: 100,
      dateRange: { from: "2026-11-01", to: "2026-11-06" }, meta: { profiles: [], source: "AmazonAdsReportFact", lastSyncAt: null },
    }) });
  });
  await page.goto("http://127.0.0.1:43239/amazon-ads/campaigns?real=1");
  await expect(page.getByRole("region", { name: "日报筛选范围汇总" })).toHaveCount(0);
  await page.getByRole("tab", { name: "日报事实", exact: true }).click();
  const totals = page.getByRole("region", { name: "日报筛选范围汇总" });
  await expect(totals).toContainText("101 条已发布事实，跨全部分页");
  await expect(totals).toContainText("报告日期 2026-11-01 至 2026-11-06");
  await expect(totals.locator("tbody tr")).toHaveCount(3);
  await expect(totals).toContainText("18446744073709551614");
  await expect(totals).toContainText("199999999999999.999998");
  await expect(totals).toContainText("未知币种"); await expect(totals).toContainText("未知归因窗口");
  await expect(totals.locator("tbody tr").first().locator("td").nth(4)).toHaveText("0");
  await expect(totals.locator("tbody tr").first().locator("td").nth(7)).toHaveText("—");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".ads-synced-page")).toContainText("第 2 页");
  await expect(totals).toContainText("101 条已发布事实，跨全部分页");
  await expect(totals.locator("tbody tr")).toHaveCount(3);
  await page.getByLabel("日报 Campaign 筛选").fill("none");
  await expect(page.locator(".ads-synced-pagination")).toContainText("筛选总量 0 条");
  await expect(totals).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Bulk export retains identity and immutable source while blocking stale or unchecked drafts", async ({ page }) => {
  const regression = (await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
    import * as XLSX from "xlsx";
    import { exportSelectedDrafts, validateBulkExport } from "./src/lib/excel/bulk-export";
    window.runBulkRegression = async () => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ["Entity", "Operation", "Campaign ID", "Ad Group ID", "Keyword ID", "Bid", "State", "Keyword Text"],
        ["Keyword", "", "campaign-1", "group-1", "keyword-1", 0.5, "enabled", "fixture keyword"],
      ]), "Sponsored Products Campaigns");
      const buffer = XLSX.write(workbook, {type:"array",bookType:"xlsx"});
      const original = new Uint8Array(buffer).join(",");
      const draft = { id:"fixture-draft",campaignGroupId:"group",rowId:"keyword-1",sheetName:"Sponsored Products Campaigns",sourceRowIndex:2,field:"bid",oldValue:0.5,newValue:0.4,keyword:"fixture",target:"fixture",currentBid:0.5,suggestedBid:0.4,deltaPercent:-20,reason:"regression",matchedRule:"fixture",selected:true };
      const changed = await exportSelectedDrafts({workbookBuffer:buffer,drafts:[draft]});
      const stale = await exportSelectedDrafts({workbookBuffer:buffer,drafts:[{...draft,oldValue:999}]});
      const unchecked = await exportSelectedDrafts({workbookBuffer:buffer,drafts:[{...draft,selected:false}]});
      const row = XLSX.read(changed.data,{type:"array"}).Sheets[draft.sheetName];
      return { writable:changed.writableCount, valid:validateBulkExport(buffer,changed.data).valid, bid:row.F2.v, operation:row.B2.v, campaign:row.C2.v, group:row.D2.v, keyword:row.E2.v, state:row.G2.v, immutable:new Uint8Array(buffer).join(",")===original, conflict:stale.conflictCount, staleWritable:stale.writableCount, uncheckedWritable:unchecked.writableCount, uncheckedBid:XLSX.read(unchecked.data,{type:"array"}).Sheets[draft.sheetName].F2.v };
    };
  ` }, bundle: true, write: false, platform: "browser", format: "iife" })).outputFiles[0].text;
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body>Isolated Bulk regression</body></html>" }));
  await page.goto("http://127.0.0.1:43239/bulk-regression");
  await page.addScriptTag({ content: regression });
  const result = await page.evaluate(() => (window as unknown as { runBulkRegression: () => Promise<Record<string, unknown>> }).runBulkRegression());
  expect(result).toEqual({ writable: 1, valid: true, bid: 0.4, operation: "Update", campaign: "campaign-1", group: "group-1", keyword: "keyword-1", state: "enabled", immutable: true, conflict: 1, staleWritable: 0, uncheckedWritable: 0, uncheckedBid: 0.5 });
});
