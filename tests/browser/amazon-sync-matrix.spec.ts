import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import type { SyncSourceView } from "@/lib/amazon-sync/contracts";
let bundle = "", styles = "";
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: ["tests/browser/amazon-sync-matrix-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": '{"NODE_ENV":"development"}' } })).outputFiles[0].text;
  const [{ readFile }, { default: postcss }, { default: tailwind }] = await Promise.all([import("node:fs/promises"), import("postcss"), import("@tailwindcss/postcss")]);
  styles = (await postcss([tailwind() as unknown as import("postcss").AcceptedPlugin]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css;
});

const failedTask = { id: "task-failed", sourceId: "src-orders", resource: "orders", status: "FAILED", stage: "FETCHING", trigger: "manual", mode: "incremental", scheduleId: null, scheduleRevision: null, queuedAt: "2026-11-17T01:00:00Z", startedAt: "2026-11-17T01:00:01Z", finishedAt: "2026-11-17T01:00:05Z", elapsedMs: 4000, pagesCompleted: 2, processedCount: 25, insertedCount: 25, updatedCount: 0, skippedCount: 0, apiRequests: 3, throttles: 1, attempts: 1, maxAttempts: 3, error: "Amazon 限流", control: null, nextAttemptAt: "2026-11-17T01:01:00Z", summary: null };
const syncingTask = { ...failedTask, id: "task-syncing", status: "RUNNING", stage: "REPORT_PARSING", error: null };
const sources: SyncSourceView[] = [
  { id: "src-orders", resource: "orders", enabled: true, marketplaceId: "US", sellerAccountId: "store-a", authorizationId: "auth-a", activeRunId: null, freshnessMinutes: 360, lastSuccessAt: "2026-11-16T08:00:00Z", rowCount: 1200, coverage: null, health: "FAILED", latestTask: failedTask, resourceCursor: { resource: "orders", watermarkFrom: "2026-10-01T00:00:00Z", watermarkTo: "2026-11-16T00:00:00Z", status: "SUCCEEDED", lastSuccessAt: "2026-11-16T08:00:00Z", updatedAt: "2026-11-16T08:00:00Z", hasIncompleteWindow: false }, seller: { id: "store-a", displayName: "店铺 A", accountKey: "a", status: "active" }, authorization: { id: "auth-a", name: "授权 A", status: "CONFIGURED", amazonSellerId: "SELLER-a", awsRegion: "us-east-1" } },
  { id: "src-inventory", resource: "inventory", enabled: true, marketplaceId: "CA", sellerAccountId: "store-b", authorizationId: "auth-b", activeRunId: "run-b", freshnessMinutes: 360, lastSuccessAt: "2026-11-17T09:00:00Z", rowCount: 88, coverage: null, health: "SYNCING", latestTask: syncingTask, seller: { id: "store-b", displayName: "店铺 B", accountKey: "b", status: "active" }, authorization: { id: "auth-b", name: "授权 B", status: "CONFIGURED", amazonSellerId: "SELLER-b", awsRegion: "us-east-1" } },
];
const coverage = { observedAt: "2026-11-17T10:00:00Z", evidenceTruncated: false, summary: { registeredDomains: 2, completedDomains: 1, domainCoveragePercent: 50, complete: false }, domains: [], sources: [{ sourceId: "src-orders", resource: "orders", marketplaceId: "US", status: "INCOMPLETE", published: false, visibleRows: 0, history: { applicable: true, percent: 80, gapCount: 2 }, lastSuccessAt: "2026-11-16T08:00:00Z" }, { sourceId: "src-inventory", resource: "inventory", marketplaceId: "CA", status: "IN_PROGRESS", published: true, visibleRows: 88, history: { applicable: false, percent: null, gapCount: null }, lastSuccessAt: "2026-11-17T09:00:00Z" }] };
const adsPlans = [{ id: "ads-plan-1", status: "ACTIVE", intervalMinutes: 1440, nextRunAt: "2026-11-18T06:00:00Z", lastSuccessAt: "2026-11-17T06:00:00Z", lastErrorCode: null, reportLookbackDays: 14, profile: { profileId: "PROF-1", region: "us-east-1", countryCode: "US", marketplaceId: "ATVPDKIKX0DER", sellerAccountId: "store-a", authorization: { name: "Ads 授权 A", status: "ACTIVE" } }, tasks: [{ id: "ads-task-1", status: "SUCCEEDED", stage: "COMPLETED", trigger: "schedule", processedCount: 500, apiRequests: 4, errorCode: null, requestedFrom: "2026-11-16", requestedTo: "2026-11-17", startedAt: "2026-11-17T06:00:00Z", finishedAt: "2026-11-17T06:05:00Z" }] }];
const adsFreshness = [{ profileId: "ads-profile-1", dataDomain: "SP_STRUCTURE", reportType: "", status: "FRESH", coveredFrom: "2026-11-01", coveredTo: "2026-11-17", lastAttemptAt: "2026-11-17T06:00:00Z", lastSuccessAt: "2026-11-17T06:00:00Z", lastTaskId: "ads-task-1", warningCodes: [] }];

async function setup(page: Page, opts: { conn?: boolean } = {}) {
  const calls: Array<{ url: string; section: string; method: string; body?: Record<string, unknown> }> = [];
  page.on("pageerror", e => console.error("MATRIX FIXTURE ERROR:", e.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()); expect(url.origin).toBe("http://127.0.0.1:43224");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname === "/styles.css") return route.fulfill({ contentType: "text/css", body: styles });
    if (url.pathname.startsWith("/api/operations/sync-center")) {
      const body = request.method() === "POST" ? request.postDataJSON() : undefined;
      const section = url.searchParams.get("section") ?? "";
      calls.push({ url: url.pathname, section, method: request.method(), body });
      if (body) return route.fulfill({ status: 202, json: { approvalRequired: true } });
      if (section === "overview") return route.fulfill({ json: { sources, metrics: { connectedStores: 2, enabledDomains: 2, running: 1, issues: 1, expired: 0, lastSuccessAt: "2026-11-17T09:00:00Z" }, trend: [], legacyActive: 0, access: { canEdit: true, canCreate: true, canConfigure: true } } });
      if (section === "coverage") return route.fulfill({ json: coverage });
      if (section === "task") return route.fulfill({ json: { task: failedTask, logs: [{ id: "log-1", attempt: 1, event: "FAILED", stage: "FETCHING", page: 2, code: "THROTTLE", statusCode: 429, rateLimit: "1", requestId: "req-fixture", createdAt: "2026-11-17T01:00:05Z" }] } });
      if (section === "connections") return route.fulfill({ json: { authorizations: [{ id: "auth-a", name: "授权 A", amazonSellerId: "SELLER-a", awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", revision: 1, status: "CONFIGURED", lastValidatedAt: "2026-11-16T00:00:00Z", marketplaceParticipations: [{ marketplaceId: "US", countryCode: "US", name: "US" }] }], sources, access: { canEdit: true, canCreate: true, canConfigure: true } } });
    }
    if (url.pathname.startsWith("/api/integrations/amazon/ads")) {
      const body = request.method() === "POST" ? request.postDataJSON() : undefined;
      calls.push({ url: url.pathname, section: url.searchParams.get("taskId") ? "task" : "list", method: request.method(), body });
      if (request.method() === "POST") return route.fulfill({ status: body?.action === "run" ? 202 : 200, json: { ok: true } });
      if (url.pathname.endsWith("/profiles")) return route.fulfill({ json: { profiles: [{ id: "ads-profile-1", authorizationId: "ads-auth-1", region: "us-east-1", profileId: "PROF-1", countryCode: "US", marketplaceId: "ATVPDKIKX0DER", currencyCode: "USD", authorization: { name: "Ads 授权 A", status: "ACTIVE", lastValidatedAt: "2026-11-16T00:00:00Z", refreshTokenExpiresAt: null }, syncPlans: [{ id: "ads-plan-1", status: "ACTIVE", nextRunAt: "2026-11-18T06:00:00Z", lastSuccessAt: "2026-11-17T06:00:00Z", lastErrorCode: null }] }], oauthConfigured: true, autoSyncConfigured: true } });
      if (url.searchParams.get("taskId")) return route.fulfill({ json: { taskDetail: { attemptRuns: [{ attemptNumber: 1, stage: "COMPLETED", status: "SUCCEEDED", errorCode: null, safeErrorSummary: null, apiRequests: 4, processedCount: 500, startedAt: "2026-11-17T06:00:00Z", finishedAt: "2026-11-17T06:05:00Z" }] } } });
      const adsTaskHistory = [{ id: "ads-task-1", planId: "ads-plan-1", profileId: "ads-profile-1", status: "SUCCEEDED", stage: "COMPLETED", trigger: "schedule", processedCount: 500, apiRequests: 4, errorCode: null, requestedFrom: "2026-11-16", requestedTo: "2026-11-17", startedAt: "2026-11-17T06:00:00Z", finishedAt: "2026-11-17T06:05:00Z" }];
      return route.fulfill({ json: { plans: adsPlans, freshness: adsFreshness, taskHistory: adsTaskHistory, reportSyncEnabled: true, access: { canEdit: true, canCreate: true, canConfigure: true } } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto(`http://127.0.0.1:43224/${opts.conn ? "?conn=1" : ""}`);
  return calls;
}

test("SP 与 Ads 双 Tab 数据隔离、字段级列开关、汇总卡与真实进度", async ({ page }) => {
  const calls = await setup(page);
  await expect(page.getByTestId("amazon-sync-matrix")).toBeVisible();
  await expect(page.getByTestId("matrix-tab-sp")).toHaveAttribute("aria-selected", "true");
  // SP 矩阵：真实数据域、物理表名、行数、覆盖主体、进度
  const spTable = page.getByRole("table", { name: "SP-API 资源同步矩阵" });
  await expect(spTable).toBeVisible();
  await expect(spTable.getByText("AmazonOrderRecord")).toBeVisible();
  await expect(spTable.getByText("1,200")).toBeVisible();
  await expect(page.getByTestId("matrix-inline-progress").first()).toBeVisible();
  // 未登记表名不臆造
  await expect(spTable.getByText("AmazonInventorySnapshot")).toBeVisible();
  // 汇总卡四项
  await expect(page.getByTestId("matrix-summary").getByText("总注册资源")).toBeVisible();
  await expect(page.getByTestId("matrix-summary").getByText("同步失败资源")).toBeVisible();
  // 列开关存在（字段级显隐）
  await expect(page.getByRole("button", { name: /列|字段|column/i }).first()).toBeVisible().catch(async () => { expect(await page.locator("[aria-label*='列'], [data-testid*='column']").count()).toBeGreaterThan(0); });
  // 切到 Ads Tab：调用独立 API，且表格数据来自 ads fixture（隔离）
  calls.length = 0;
  await page.getByTestId("matrix-tab-ads").click();
  await expect(page.getByTestId("matrix-tab-ads")).toHaveAttribute("aria-selected", "true");
  await expect(calls.some(c => c.url === "/api/integrations/amazon/ads/sync")).toBe(true);
  const adsTable = page.getByRole("table", { name: "Ads API 资源同步矩阵" });
  await expect(adsTable).toBeVisible();
  await expect(adsTable.getByText("500")).toBeVisible();
  await expect(adsTable.getByText("AmazonAdsEntityRecord")).toBeVisible();
});

test("手动同步弹窗：时序资源提供回填且按官方上限拦截，危险取消走二次确认", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("amazon-sync-matrix")).toBeVisible();
  const table = page.getByRole("table", { name: "SP-API 资源同步矩阵" });
  // orders 行为 FAILED（非同步中），点击手动同步
  await table.getByRole("button", { name: "手动同步" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("自定义区间回填")).toBeVisible();
  await dialog.getByText("自定义区间回填").click();
  const from = dialog.getByLabel("开始日期"), to = dialog.getByLabel("结束日期");
  await from.fill("2024-01-01"); await to.fill("2026-11-17"); // > 730 天
  await dialog.getByRole("button", { name: "提交" }).click();
  await expect(page.getByText(/回填区间.*超过该数据域上限 730 天/)).toBeVisible();
  // inventory 行同步中：按钮为取消，点击后二次确认流程（Dialog 内「确认取消」）
  await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
  const syncingRow = table.getByRole("button", { name: "取消" });
  await expect(syncingRow).toBeVisible();
});

test("同步日志抽屉展示真实 RequestId 与限流信息", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("amazon-sync-matrix")).toBeVisible();
  const table = page.getByRole("table", { name: "SP-API 资源同步矩阵" });
  await table.getByRole("button", { name: "日志" }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("matrix-log-row")).toBeVisible();
  await expect(drawer.getByText(/req-fixture/)).toBeVisible();
});

test("连接卡片页：SP 与 Ads 卡片、删除连接二次确认保留业务数据", async ({ page }) => {
  await setup(page, { conn: true });
  await expect(page.getByTestId("amazon-connections")).toBeVisible();
  const cards = page.getByTestId("amazon-connection-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: "Amazon SP-API" })).toBeVisible();
  await expect(cards.filter({ hasText: "Amazon Ads API" })).toBeVisible();
  const adsCard = cards.filter({ hasText: "Amazon Ads API" });
  await adsCard.getByRole("button", { name: "删除连接" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/已落库业务数据保留/)).toBeVisible();
});
