import { build } from "esbuild";
import { amazonReadDomains } from "@/lib/operations/types";
import { expect, test, type Page } from "@playwright/test";
import type { SyncSourceView, SyncTaskView, SyncPlanView } from "@/lib/amazon-sync/contracts";
let bundle = "", styles = "";
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: ["tests/browser/sync-center-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": '{"NODE_ENV":"development"}' }, plugins: [{ name: "isolated-next-navigation", setup(builder) { builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" })); builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export function useSearchParams(){return new URLSearchParams(window.location.search)}" })); } }] })).outputFiles[0].text;
  const [{ readFile }, { default: postcss }, { default: tailwind }] = await Promise.all([import("node:fs/promises"), import("postcss"), import("@tailwindcss/postcss")]);
  // The installed Tailwind plugin resolves a second PostCSS copy. The public plugin
  // contract is identical, but its nominal node classes differ between packages.
  styles = (await postcss([tailwind() as unknown as import("postcss").AcceptedPlugin]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css;
});
const task: SyncTaskView = { id: "fixture-task", sourceId: "source-a", resource: "inventory", status: "FAILED", stage: "FETCHING", trigger: "manual", mode: "snapshot", scheduleId: null, scheduleRevision: null, queuedAt: "2026-11-04T01:00:00Z", startedAt: "2026-11-04T01:00:01Z", finishedAt: "2026-11-04T01:00:05Z", elapsedMs: 4000, pagesCompleted: 2, processedCount: 25, insertedCount: 25, updatedCount: 0, skippedCount: 0, apiRequests: 3, throttles: 1, attempts: 1, maxAttempts: 3, error: "Amazon 请求限流，未发布新快照。", control: null, nextAttemptAt: "2026-11-04T01:01:00Z", summary: null };
const sources: SyncSourceView[] = ["a", "b"].map((v, i) => ({ id: `source-${v}`, resource: "inventory", enabled: true, marketplaceId: i ? "CA" : "US", sellerAccountId: `store-${v}`, authorizationId: `auth-${v}`, activeRunId: i ? "prior-b" : null, freshnessMinutes: 360, lastSuccessAt: i ? "2026-11-04T01:00:00Z" : null, rowCount: i ? 10 : 0, coverage: null, health: i ? "FRESH" : "FAILED", latestTask: i ? null : task, seller: { id: `store-${v}`, displayName: `店铺 ${v.toUpperCase()}`, accountKey: v, status: "active" }, authorization: { id: `auth-${v}`, name: `授权 ${v}`, status: "CONFIGURED", amazonSellerId: `SELLER-${v}`, awsRegion: "us-east-1" } }));
async function setup(page: Page, readOnly = false, entry = false) {
  page.on("pageerror", error => console.error("SYNC UI FIXTURE:", error.message));
  const businessCalls: string[] = [];
  const calls: Array<{ section: string; params: URLSearchParams; body?: Record<string, unknown> }> = [];
  const state = { grants: [] as Array<{ id: string; userId: string; sellerAccountId: string; enabled: boolean; revision: number }>, salesSources: [] as SyncSourceView[], exportStatus: "QUEUED", plans: [] as SyncPlanView[], approvalStatus: "REQUESTED", approvalOperation: "save-authorization", ordersTask: false, recoveryBlocked: false, disabledAuth: false, denied: false, succeeded: false, listingTask: false, cancelledCatalog: false, invalidAuth: false, workerOnline: false, delayed: false, release: () => {} };
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()); expect(url.origin).toBe("http://127.0.0.1:43224");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname === "/styles.css") return route.fulfill({ contentType: "text/css", body: styles });
    if (url.pathname.startsWith("/api/") && url.pathname !== "/api/operations/sync-center") {
      if (url.pathname === "/api/operations/amazon-stores") return route.fulfill({ json: { stores: [] } });
      if (url.pathname === "/api/operations/amazon-mcp") return route.fulfill({ json: { credentials: [], scopes: [], tools: [], toolCatalog: [] } });
      if (url.pathname === "/api/operations/sync-center/exports") {
        const body = request.method() === "POST" ? request.postDataJSON() : undefined;
        calls.push({ section: "sales-export", params: url.searchParams, body });
        if (url.searchParams.get("download") === "1") return route.fulfill({ contentType: "application/x-ndjson", body: '{"type":"manifest","fixture":true}\n' });
        return route.fulfill({ status: body ? 202 : 200, json: { id: "export-fixture", status: state.exportStatus, rowCount: 1 } });
      }
      if (url.pathname === "/api/operations/sync-center/approvals") {
        const body = request.postDataJSON() as { decision?: string };
        calls.push({ section: "approval-action", params: url.searchParams, body });
        if (body.decision) state.approvalStatus = body.decision === "APPROVED" ? "APPROVED" : body.decision;
        return route.fulfill({ json: { request: { id: "approval-1", status: state.approvalStatus } } });
      }
      businessCalls.push(url.pathname);
      expect(request.method()).toBe("GET");
      if (url.pathname.endsWith("/freshness")) return route.fulfill({ json: { scope: { workspaceId: "default", accountId: "", marketplace: "" }, connection: { status: "NOT_CONFIGURED", runtimeConfiguration: { configured: false, missingEnvironmentVariables: [] }, marketplaceParticipations: [], enabledDomains: [] }, inventory: { status: "NOT_SYNCED", snapshotCount: 0 }, domains: Object.fromEntries(amazonReadDomains.map(resource => [resource, { resource, status: "NOT_SYNCED", source: "fixture", reason: null }])), runs: [] } });
      if (url.pathname.endsWith("/inventory/snapshots")) return route.fulfill({ json: { rows: [], pagination: { page: 1, pageSize: 20, total: 0, pageCount: 0 }, snapshot: { status: "NOT_SYNCED", syncRunId: null, capturedAt: null } } });
      if (url.pathname.endsWith("/products")) return route.fulfill({ json: { rows: [], hasNextPage: false } });
      if (url.pathname.endsWith("/replenishment")) return route.fulfill({ json: { rows: [], sellerAccounts: [], canEdit: false, canReadSellfox: false } });
      if (url.pathname.endsWith("/metrics/daily")) return route.fulfill({ json: { rows: [], pagination: { hasNextPage: false }, sourceNote: "PPC fixture", emptyReason: "暂无指标" } });
      throw new Error(`Unexpected business request ${url.pathname}`);
    }
    if (url.pathname !== "/api/operations/sync-center") return route.fulfill({ contentType: "text/html", body: '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    const section = url.searchParams.get("section") ?? ""; const body = request.method() === "POST" ? request.postDataJSON() : undefined;
    calls.push({ section, params: url.searchParams, body });
    const access = { canEdit: !readOnly, canCreate: !readOnly, canConfigure: !readOnly, canApprove: !readOnly, canExport: !readOnly };
    if (state.denied) return route.fulfill({ status: 403, json: { error: "当前工作区禁止读取。" } });
    if (body) {
      if (body.action === "save-plan") { const p = { ...body, id: body.id ?? "fixture-plan", revision: Number(body.revision ?? 0) + 1, nextRunAt: "2026-11-04T02:00:00Z", targets: (body.sourceIds as string[]).map(sourceId => ({ sourceId })) } as unknown as SyncPlanView; state.plans = [p]; }
      return route.fulfill({ status: ["run", "control-task"].includes(body.action) ? 202 : 200, json: { saved: true } });
    }
    if (state.delayed && section === "task") { await new Promise<void>(r => { state.release = r; }); }
    const visible = sources.filter(s => (!url.searchParams.get("sellerAccountId") || s.sellerAccountId === url.searchParams.get("sellerAccountId")) && (!url.searchParams.get("marketplaceId") || s.marketplaceId === url.searchParams.get("marketplaceId")));
    const common = { access, sources: visible };
    if (section === "overview") return route.fulfill({ json: { ...common, metrics: { connectedStores: visible.length, enabledDomains: 1, running: 0, issues: 1, expired: 0, lastSuccessAt: "2026-11-04T01:00:00Z" }, trend: [], legacyActive: 0 } });
    if (section === "approvals") return route.fulfill({ json: { ...common, requests: [{ id: "approval-1", targetEnvironment: "local", changeType: "CredentialChange", operation: state.approvalOperation, targetId: "auth-a", beforeSummary: { credentials: "已配置" }, afterSummary: { refreshToken: "将替换／新增" }, sellerIds: ["SELLER-a"], marketplaceIds: ["US"], domains: ["inventory"], sourceIds: [], baseRevision: 1, changeDigest: "fixture-digest", requestedByUserId: "requester", approvedByUserId: state.approvalStatus === "APPROVED" ? "approver" : null, status: state.approvalStatus, expiresAt: "2026-11-04T02:00:00Z", appliedAt: null, createdAt: "2026-11-04T01:00:00Z" }] } });
    if (section === "coverage") return route.fulfill({ json: { observedAt: "2026-11-09T00:00:00Z", universe: "OFFLINE_FIXTURE", evidenceTruncated: false, summary: { registeredDomains: 0, completedDomains: 0, domainCoveragePercent: null, complete: false }, domains: [], sources: [] } });
    if (section === "skill-readiness") return route.fulfill({ json: { skills: [] } });
    if (section === "sources") return route.fulfill({ json: { ...common, sources: state.salesSources.length ? state.salesSources : sources } });
    if (section === "orders") return route.fulfill({ json: { access, rows: [], sources: [], pagination: { total: 0, pageCount: 0 } } });
    if (section === "domain-reports") {
      const eventSource = { id: "inventory-event-source", resource: "inventory_events", sellerAccountId: "store-a", marketplaceId: "US", seller: { displayName: "店铺 A" } };
      return route.fulfill({ json: { resource: url.searchParams.get("resource"), source: eventSource, sources: [eventSource], documents: [], rows: [], pagination: { page: 1, pageSize: 50, total: 0, pageCount: 0 }, dateMeaning: "Amazon ledger event date", amountMeaning: "Original report values" } });
    }
    if (section === "plans") return route.fulfill({ json: { ...common, sources, plans: state.plans } });
    if (section === "tasks") return route.fulfill({ json: { ...common, rows: [{ ...task, scope: { sellerAccountId: "store-a", marketplaceId: "US", seller: sources[0].seller } }], pagination: { total: 31, page: Number(url.searchParams.get("page")), pageSize: 30, pageCount: 2 } } });
    if (section === "task") return route.fulfill({ json: { ...common, orderRecovery: state.ordersTask ? { state: state.recoveryBlocked ? "BLOCKED" : "CHECKPOINT_VALID", reason: state.recoveryBlocked ? "CHECKPOINT_INVALID" : null, message: state.recoveryBlocked ? "检查点缺失，不能从头覆盖。" : "检查点可继续，仍须审批。", approvalRequired: true, started: false, checkedAt: "2026-11-09T01:00:00Z", checkpoint: state.recoveryBlocked ? null : { mode: "RESUME_COMMITTED_ORDER_CHECKPOINT", window: { from: "2024-11-20T00:00:00Z", to: "2024-11-21T00:00:00Z" }, pagesCompleted: 2, detailsCompleted: 491, pendingDetails: 9, archivedResponses: 493, listComplete: false, nextOperation: "getOrder", restartsFromBeginning: false } } : null, task: { ...task, ...(state.ordersTask ? { resource: "orders", status: "FAILED", stage: "FETCHING_DETAILS" } : {}), ...(state.listingTask ? { resource: "catalog" } : {}), ...(state.cancelledCatalog ? { resource: "catalog_items", status: "CANCELLED", stage: "FETCHING" } : {}), ...(state.succeeded ? { status: "SUCCEEDED", stage: "COMPLETED", error: null } : {}) }, source: state.listingTask ? { ...sources[0], resource: "catalog" } : sources[0], logs: [{ id: "log", attempt: 1, event: "FAILED", stage: "FETCHING", page: 2, code: "THROTTLE", statusCode: 429, rateLimit: "1", requestId: "fixture-request", createdAt: "2026-11-04T01:00:05Z" }], nextAfter: null } });
    if (section === "snapshots") return route.fulfill({ json: { snapshot: { taskId: task.id, sourceId: "source-a", sellerAccountId: "store-a", amazonSellerId: "SELLER-a", marketplaceId: "US", resource: "inventory", publishedAt: task.finishedAt, isCurrent: true }, snapshotRows: [{ sellerSku: "FIXTURE-SNAPSHOT-SKU", asin: "B-FIXTURE", condition: "NewItem", fulfillableQuantity: 5, reservedQuantity: 1, capturedAt: task.finishedAt, sourceUpdatedAt: null, dataVersion: 1 }], pagination: { page: Number(url.searchParams.get("page")), pageSize: 50, total: 51, pageCount: 2 } } });
    if (section === "sales-traffic") return route.fulfill({ json: { ...common, rows: [{ id: "sale-row", businessDate: "2026-11-01", sellerName: "报告店铺", amazonSellerId: "REAL_TRANSPORT_FIXTURE", marketplaceId: "ATVPDKIKX0DER", metrics: { unitsOrdered: 2, totalOrderItems: 1, sessions: 10, pageViews: 15, orderedProductSales: { amount: 20, currencyCode: "USD" } }, quality: "VALID", reportId: "report-fixture", documentId: "doc-fixture", syncRunId: "sale-task", capturedAt: "2026-11-04T01:00:00Z", publishedAt: "2026-11-04T01:01:00Z" }], pagination: { total: 60, pageCount: 2 }, asOf: "2026-11-04T02:00:00.000Z" } });
    if (section === "connections") return route.fulfill({ json: { ...common, sources, grants: state.grants, grantMembers: [{ userId: "member-a", user: { name: "运营成员" } }], authorizations: [{ id: "auth-a", name: "授权 a", amazonSellerId: "SELLER-a", awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", revision: 1, status: state.disabledAuth ? "DISABLED" : state.invalidAuth ? "ERROR" : "CONFIGURED", lastValidatedAt: null, validationErrorCode: state.invalidAuth ? "AUTH_REJECTED" : null, validationAttemptedAt: "2026-11-04T01:00:00Z", marketplaceParticipations: [{ marketplaceId: "US", countryCode: "US", name: "US" }] }], sellers: [{ id: "store-a", displayName: "店铺 A", accountKey: "a" }] } });
    if (section === "settings") return route.fulfill({ json: { ...common, heartbeats: state.workerOnline ? [{ workerName: "fixture-worker", concurrency: 1, online: true, lastSeenAt: "2026-11-04T01:00:00Z" }] : [], queueConfigured: true } });
    throw new Error(`unexpected section ${section}`);
  });
  await page.goto(`http://127.0.0.1:43224/${entry ? "?entry=1" : ""}`); await expect(page.getByRole("heading", { name: "数据同步健康状态" })).toBeVisible();
  return { calls, state, businessCalls };
}
test("sync views and merged business navigation remain reachable with real styles and explicit planned domains", async ({ page }) => {
  await setup(page);
  for (const label of ["订单列表", "同步计划", "同步任务", "数据域管理", "数据质量", "店铺与授权", "同步设置", "数据总览"]) { await page.getByRole("button", { name: label, exact: true }).click(); await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible(); }
  await expect(page.getByRole("navigation", { name: "业务数据导航" }).getByRole("button", { name: "补货计划", exact: true })).toBeVisible();
  await expect(page.getByText("原有业务入口 · 保留", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "数据域管理", exact: true }).click(); await page.getByRole("button", { name: "订单 已接入", exact: true }).click(); await expect(page.getByText("Orders 2026-01-01 / searchOrders + getOrder（详情按审批选择）", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("plan creation, custom frequency, pause, copy and history use persisted contracts", async ({ page }) => {
  const { calls } = await setup(page); await page.getByRole("button", { name: "同步计划", exact: true }).click(); await page.getByRole("button", { name: "新建计划", exact: true }).click();
  await page.getByLabel("计划名称", { exact: true }).fill("库存试点"); await page.getByLabel("周期分钟（15–10080）", { exact: true }).fill("120"); await page.getByRole("checkbox", { name: "店铺 A / US" }).check(); await page.getByRole("button", { name: "保存计划", exact: true }).click();
  await expect(page.getByRole("heading", { name: "库存试点", exact: true })).toBeVisible(); expect(calls.find(c => c.body?.action === "save-plan")?.body?.intervalMinutes).toBe(120);
  await page.getByRole("button", { name: "恢复计划", exact: true }).click(); await expect(page.getByRole("button", { name: "暂停计划", exact: true })).toBeVisible(); await page.getByRole("button", { name: "暂停计划", exact: true }).click();
  await page.getByRole("button", { name: "复制计划", exact: true }).click(); await expect(page.getByLabel("计划名称", { exact: true })).toHaveValue("库存试点 · 副本"); await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "执行历史", exact: true }).click(); await expect.poll(() => calls.some(c => c.section === "tasks" && c.params.get("scheduleId") === "fixture-plan")).toBe(true);
});
test("server filters/pagination and failure retry never claim success before worker publication", async ({ page }) => {
  const { calls } = await setup(page); await page.getByRole("button", { name: "同步任务", exact: true }).click(); await page.getByLabel("任务状态", { exact: true }).selectOption("FAILED");
  await page.getByRole("button", { name: "下一页", exact: true }).click(); await expect.poll(() => calls.some(c => c.section === "tasks" && c.params.get("status") === "FAILED" && c.params.get("page") === "2")).toBe(true);
  await page.getByRole("button", { name: "详情", exact: true }).click(); await expect(page.getByText("THROTTLE", { exact: false })).toBeVisible(); await page.getByRole("button", { name: "重试完整快照", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "审批请求已创建" })).toContainText("尚未应用配置或启动任务");
  expect(calls.find(c => c.body?.action === "control-task")?.body).toMatchObject({ control: "retry", id: "fixture-task" });
});
test("read-only access disables writes and permission failure clears stale task content", async ({ page }) => {
  const { state } = await setup(page, true); await page.getByRole("button", { name: "同步计划", exact: true }).click(); await expect(page.getByRole("button", { name: "新建计划", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click(); await expect(page.getByRole("button", { name: "新增授权", exact: true })).toBeDisabled();
  state.denied = true; await page.getByRole("button", { name: "刷新", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("禁止读取"); await expect(page.getByRole("heading", { name: "授权 a", exact: true })).toHaveCount(0);
});

test("authorization configuration remains discoverable after a read failure and recovers on refresh", async ({ page }) => {
  const { calls } = await setup(page);
  let unavailable = true;
  await page.route("**/api/operations/sync-center?*", route => unavailable
    ? route.fulfill({ status: 500, json: { error: "同步中心请求失败。" } })
    : route.fallback());
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("同步中心请求失败");
  await expect(page.getByRole("heading", { name: "Amazon SP-API 配置", exact: true })).toBeVisible();
  await expect(page.getByText(/配置数据及权限尚未读取成功/)).toBeVisible();
  await expect(page.getByRole("button", { name: "新增授权", exact: true })).toBeDisabled();
  await expect(page.getByText(/读取配置列表不调用 Amazon API/)).toBeVisible();
  expect(calls.some(c => c.body)).toBe(false);
  unavailable = false;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByRole("button", { name: "新增授权", exact: true }).click();
  await expect(page.getByLabel("lwaClientId", { exact: true })).toBeVisible();
  await expect(page.getByLabel("lwaClientSecret", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByLabel("refreshToken", { exact: true })).toHaveAttribute("type", "password");
  expect(calls.some(c => c.body)).toBe(false);
});

test("inventory event page submits a bounded report request through approval", async ({ page }) => {
  const { calls } = await setup(page);
  await page.getByRole("button", { name: "FBA 库存事件", exact: true }).click();
  await expect(page.getByTestId("amazon-inventory_events-workbench")).toBeVisible();
  await page.getByRole("combobox", { name: "事件类型", exact: true }).selectOption("Adjustments");
  await page.getByRole("textbox", { name: "开始日期", exact: true }).fill("2026-11-02");
  await page.getByRole("textbox", { name: "结束日期（含）", exact: true }).fill("2026-11-04");
  await page.getByRole("button", { name: "申请库存事件采集", exact: true }).click();
  await expect.poll(() => calls.some(call => call.body?.action === "run" && call.body?.eventType === "Adjustments")).toBe(true);
  expect(calls.find(call => call.body?.action === "run")?.body).toMatchObject({ dateFrom: "2026-11-02", dateTo: "2026-11-04", eventType: "Adjustments", sourceIds: ["inventory-event-source"] });
  await expect(page.getByText("申请经审批后才可执行；本页面不直接请求 Amazon。", { exact: true })).toBeVisible();
});

test("entry probe failure explains configuration prerequisites and can retry", async ({ page }) => {
  await setup(page);
  let unavailable = true;
  await page.route("**/api/operations/sync-center?*", route => unavailable
    ? route.fulfill({ status: 500, json: { error: "同步中心请求失败。" } })
    : route.fallback());
  await page.goto("http://127.0.0.1:43224/?entry=1&view=connections");
  await expect(page.getByRole("heading", { name: "Amazon SP-API 配置", exact: true })).toBeVisible();
  await expect(page.getByText(/AMAZON_SP_API_ENCRYPTION_KEY/)).toBeVisible();
  await expect(page.getByLabel("refreshToken", { exact: true })).toHaveCount(0);
  unavailable = false;
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByRole("button", { name: "新增授权", exact: true })).toBeEnabled();
});


test("switching workspace clears a delayed old task response and rechecks permissions", async ({ page }) => {
  const { state, calls } = await setup(page, false, true);
  state.delayed = true;
  await page.getByRole("button", { name: "同步任务", exact: true }).click();
  await page.getByRole("button", { name: "详情", exact: true }).click();
  await expect.poll(() => calls.some(c => c.section === "task")).toBe(true);
  state.denied = true;
  await page.evaluate(() => { localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-b" })); window.dispatchEvent(new Event("amazon-bulk-ad:workspace-scope-changed")); });
  await expect(page.getByRole("alert")).toContainText("禁止读取");
  state.release();
  await expect(page.getByRole("heading", { name: "任务 fixture-task", exact: true })).toHaveCount(0);
});

test("successful task opens seller-bound snapshot pages and failed authorization remains visible", async ({ page }) => {
  const { state, calls } = await setup(page);
  state.succeeded = true;
  await page.getByRole("button", { name: "同步任务", exact: true }).click();
  await page.getByRole("button", { name: "详情", exact: true }).click();
  await page.getByRole("button", { name: "查看本次快照", exact: true }).click();
  await expect(page.getByRole("cell", { name: "FIXTURE-SNAPSHOT-SKU B-FIXTURE", exact: true })).toBeVisible();
  await expect(page.getByText(/Seller SELLER-a/)).toBeVisible();
  await page.getByRole("button", { name: "快照下一页", exact: true }).click();
  await expect.poll(() => calls.some(c => c.section === "snapshots" && c.params.get("id") === task.id && c.params.get("page") === "2")).toBe(true);
  state.invalidAuth = true;
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("AUTH_REJECTED");
  await expect(page.getByRole("alert")).toContainText("亚马逊返回：");
  await expect(page.getByRole("alert")).toContainText("排查建议");
  await page.getByRole("button", { name: "更新授权／凭证", exact: true }).click();
  await expect(page.getByLabel("refreshToken（留空保留）")).toHaveAttribute("type", "password");
});

test("overview follows the reviewed desktop layout and remains usable on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1355 });
  await setup(page);
  const now = new Date(), recent = new Date(now.getTime() - 25 * 60000).toISOString();
  const next = new Date(now.getTime() + 35 * 60000).toISOString();
  const demoSources: SyncSourceView[] = [
    { ...sources[0], health: "SYNCING", nextScheduledAt: next, latestTask: { ...task, status: "RUNNING", error: null } },
    { ...sources[0], id: "catalog-a", resource: "catalog", health: "FRESH", activeRunId: "catalog-published", lastSuccessAt: recent, rowCount: 1234, nextScheduledAt: next, latestTask: null },
    { ...sources[0], id: "inventory-ca", marketplaceId: "CA", health: "FRESH", activeRunId: "ca-published", lastSuccessAt: recent, rowCount: 622, nextScheduledAt: next, latestTask: null },
    { ...sources[0], id: "catalog-ca", marketplaceId: "CA", resource: "catalog", health: "NOT_SYNCED", nextScheduledAt: next, latestTask: null },
    { ...sources[1], marketplaceId: "US", health: "STALE", lastSuccessAt: new Date(now.getTime() - 8 * 3600000).toISOString(), rowCount: 312, nextScheduledAt: next },
    { ...sources[1], id: "catalog-b", marketplaceId: "US", resource: "catalog", health: "FAILED", activeRunId: null, lastSuccessAt: null, rowCount: 0, nextScheduledAt: next, latestTask: { ...task, error: "在线商品分页校验失败，未发布新快照。" } },
  ];
  const bucketMs = 7200000, end = Math.floor(now.getTime() / bucketMs) * bucketMs;
  const trend = Array.from({ length: 12 }, (_, i) => ({ bucket: new Date(end - (11 - i) * bucketMs).toISOString(), succeeded: [8, 11, 7, 10, 9, 12, 8, 10, 11, 9, 12, 8][i], failed: i === 6 || i === 11 ? 2 : 0, averageDurationMs: 42000, throttles: i === 6 ? 1 : 0, apiRequests: 24 }));
  await page.route("**/api/operations/sync-center?*", async route => {
    if (new URL(route.request().url()).searchParams.get("section") !== "overview") return route.fallback();
    return route.fulfill({ json: { access: { canCreate: true, canEdit: true, canConfigure: true }, sources: demoSources, metrics: { connectedStores: 2, enabledDomains: 2, running: 1, issues: 2, expired: 1, lastSuccessAt: recent }, trend, legacyActive: 0 } });
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByRole("img", { name: "最近 24 小时成功与失败任务柱形图" })).toBeVisible();
  const metrics = page.getByTestId("sync-center-metrics");
  expect(await metrics.locator(":scope > div").count()).toBe(7);
  const boxes = await metrics.locator(":scope > div").evaluateAll(items => items.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
  expect(boxes[0].y).toBe(boxes[2].y); expect(boxes[3].y).toBeGreaterThan(boxes[0].y);
  const panels = page.getByTestId("sync-center-lower-panels").locator(":scope > section");
  const first = await panels.nth(0).boundingBox(), second = await panels.nth(1).boundingBox();
  expect(first!.y).toBe(second!.y); expect(second!.x).toBeGreaterThan(first!.x);
  await page.screenshot({ path: "tmp/amazon-sync-ui-overview.png", fullPage: true });
  await page.getByRole("button", { name: "配置计划", exact: true }).click();
  await expect(page.getByRole("heading", { name: "同步计划", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("plan domain navigation selects real defaults, blocks planned domains and preserves draft actions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await setup(page);
  await page.getByRole("button", { name: "同步计划", exact: true }).click();
  const picker = page.getByRole("navigation", { name: "同步计划数据域", exact: true });
  await picker.getByRole("button", { name: "在线商品 已接入", exact: true }).click();
  await page.getByRole("button", { name: "新建计划", exact: true }).click();
  await expect(page.getByLabel("数据域", { exact: true })).toHaveValue("catalog");
  await expect(page.getByLabel("周期分钟（15–10080）", { exact: true })).toHaveValue("1440");
  await picker.getByRole("button", { name: "订单 已接入", exact: true }).click();
  await expect(page.getByRole("button", { name: "新建计划", exact: true })).toBeDisabled();
  await expect(page.getByText("后台自动分段回溯并每日增量；单次手动执行仍需审批。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("计划名称", { exact: true })).toHaveCount(0);
  await picker.getByRole("button", { name: "FBA 库存 已接入", exact: true }).click();
  await page.getByRole("button", { name: "新建计划", exact: true }).click();
  await page.getByLabel("计划名称", { exact: true }).fill("FBA 库存每小时校准");
  await expect(page.getByLabel("周期分钟（15–10080）", { exact: true })).toHaveValue("1440");
  await page.getByRole("checkbox", { name: "店铺 A / US", exact: true }).check();
  const planLayout = page.getByTestId("sync-center-plan-layout");
  const columns = await planLayout.locator(":scope > *").evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
  expect(columns[0].y).toBe(columns[1].y); expect(columns[1].x).toBeGreaterThan(columns[0].x);
  await page.screenshot({ path: "tmp/amazon-sync-ui-plans.png", fullPage: true });
  await page.getByRole("button", { name: "保存计划", exact: true }).click();
  await expect(page.getByRole("heading", { name: "FBA 库存每小时校准", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "同步任务", exact: true }).click();
  await page.screenshot({ path: "tmp/amazon-sync-ui-tasks.png", fullPage: true });
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click();
  await page.screenshot({ path: "tmp/amazon-sync-ui-connections.png", fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("button", { name: "同步计划", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("bounded catalog guidance distinguishes existing full listing plans without starting sync", async ({ page }) => {
  const { state, calls } = await setup(page);
  state.plans = [{ id: "amazon-sync-auto-fixture", revision: 1, name: "在线商品自动计划", resource: "catalog", enabled: true, mode: "snapshot", intervalMinutes: 1440, priority: 1, maxAttempts: 3, retentionDays: 30, nextRunAt: null, targets: [{ sourceId: "source-a" }] }];
  await page.getByRole("button", { name: "同步计划", exact: true }).click();
  const picker = page.getByRole("navigation", { name: "同步计划数据域", exact: true });
  await picker.getByRole("button", { name: "商品目录 已接入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "需配置采集范围", exact: true })).toBeVisible();
  await expect(page.getByText("商品目录仅读取来源策略明确列出的 ASIN", { exact: false })).toBeVisible();
  await expect(page.getByTestId("sync-plan-coverage")).toContainText("当前工作区可见计划共 1 个");
  await expect(page.getByRole("button", { name: "新建计划", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "查看在线商品全量计划", exact: true }).click();
  await expect(page.getByRole("heading", { name: "在线商品自动计划", exact: true })).toBeVisible();
  await page.getByLabel("店铺", { exact: true }).selectOption("store-b");
  await expect(page.getByRole("heading", { name: "当前筛选下无计划", exact: true })).toBeVisible();
  await expect(page.getByTestId("sync-plan-coverage")).toContainText("在线商品 1 个，当前筛选显示 0 个");
  await page.getByRole("button", { name: "清除店铺／站点筛选", exact: true }).click();
  await expect(page.getByRole("heading", { name: "在线商品自动计划", exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "搜索词与品牌分析 已接入", exact: true }).click();
  await expect(page.getByText("当前不自动建立品牌分析计划", { exact: false })).toBeVisible();
  expect(calls.filter(call => call.body)).toHaveLength(0);
});

test("quality issues link to the correct task and secondary pages remain usable on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { state } = await setup(page);
  await page.getByRole("button", { name: "数据质量", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "建议操作", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "店铺 A US", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "店铺 B CA", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "tmp/amazon-sync-ui-quality.png", fullPage: true });
  await page.getByRole("button", { name: "查看任务", exact: true }).click();
  await expect(page.getByRole("heading", { name: "任务 fixture-task", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("未发布新快照");
  await expect(page.getByText("FBA 库存 / 手动同步", { exact: true })).toBeVisible();
  await page.screenshot({ path: "tmp/amazon-sync-ui-task-detail.png", fullPage: true });
  for (const label of ["数据质量", "同步设置", "店铺与授权"]) {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "同步设置", exact: true }).click();
  await expect(page.getByText("尚无 Worker 心跳，不能据此认定后台在线。", { exact: true })).toBeVisible();
  state.workerOnline = true;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByRole("cell", { name: "fixture-worker", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "心跳在线", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("business pages use one navigation, load only their own data and inventory creates new center tasks", async ({ page }) => {
  const { calls, businessCalls } = await setup(page);
  const entries = [["库存浏览", "/api/operations/inventory/snapshots"], ["在线商品", "/api/operations/products"], ["补货计划", "/api/operations/replenishment"], ["PPC 经营指标", "/api/operations/metrics/daily"]];
  for (const [label, endpoint] of entries) {
    businessCalls.length = 0;
    await page.getByRole("navigation", { name: "业务数据导航" }).getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: label, level: 1, exact: true })).toBeVisible();
    await expect.poll(() => businessCalls.includes(endpoint)).toBe(true);
    expect(businessCalls.filter(path => path !== endpoint && !(label === "库存浏览" && path.endsWith("/freshness"))), label).toEqual([]);
    await expect(page.getByRole("navigation", { name: "经营中台分区" })).toHaveCount(0);
    await expect(page.getByLabel("店铺", { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "库存浏览", exact: true }).click();
  await page.getByRole("button", { name: "立即同步库存", exact: true }).click();
  await expect.poll(() => calls.some(c => c.body?.action === "run")).toBe(true);
  expect(calls.find(c => c.body?.action === "run")?.body?.sourceIds).toEqual(["source-a", "source-b"]);
  expect(businessCalls).not.toContain("/api/operations/sync-runs");
});

test("new page URLs restore navigation and disabled center never falls back to the old UI", async ({ page }) => {
  await setup(page, false, true);
  await page.getByRole("button", { name: "在线商品", exact: true }).click();
  await expect(page).toHaveURL(/view=catalog/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "在线商品", exact: true, level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "同步计划", exact: true }).click();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "在线商品", exact: true, level: 1 })).toBeVisible();
  await page.route("**/api/operations/sync-center?*", route => route.fulfill({ status: 409, json: { code: "SYNC_CENTER_DISABLED", error: "当前工作区未启用同步中心。" } }));
  await page.goto("http://127.0.0.1:43224/?entry=1&legacy=1&tab=inventory");
  await expect(page.getByRole("alert")).toContainText("当前工作区未启用同步中心");
  await expect(page.getByRole("navigation", { name: "经营中台分区" })).toHaveCount(0);
});

test("approval page lists only masked summaries and separates approval from application", async ({ page }) => {
  const { calls } = await setup(page);
  await page.getByRole("button", { name: "变更审批", exact: true }).click();
  await expect(page.getByText(/具备审批权限的组织所有者／数据库管理员可批准自己的申请/)).toBeVisible();
  await expect(page.getByTestId("amazon-change-request")).toContainText("local");
  await expect(page.getByTestId("amazon-change-request")).toContainText("已配置");
  await expect(page.getByText("fixture-secret", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "批准", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "应用已批准变更", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "批准", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已批准；尚未应用。" })).toBeVisible();
  expect(calls.some(c => c.body?.decision === "APPROVED")).toBe(true);
  await expect(page.getByRole("button", { name: "应用已批准变更", exact: true })).toBeVisible();
});


test("sales report custom dates are submitted for approval and business filters reach the backend", async ({ page }) => {
  const { calls, state } = await setup(page);
  state.salesSources = [{ ...sources[0], id: "sales-source", resource: "sales_traffic", marketplaceId: "ATVPDKIKX0DER" }];
  await page.getByRole("button", { name: "销售流量日报", exact: true }).click();
  await expect(page.getByTestId("sales-traffic-workbench")).toBeVisible();
  await page.getByLabel("报告同步来源").selectOption("sales-source");
  await page.getByLabel("同步日期", { exact: true }).selectOption("custom");
  await page.getByLabel("同步开始日期", { exact: true }).fill("2026-11-01");
  await page.getByLabel("同步结束日期", { exact: true }).fill("2026-11-02");
  await page.getByRole("button", { name: "申请报告同步", exact: true }).click();
  await expect.poll(() => calls.some(c => c.body?.action === "run" && c.body.dateFrom === "2026-11-01" && c.body.dateTo === "2026-11-02")).toBe(true);
  await expect(page.getByText("日期与站点范围已冻结", { exact: false })).toBeVisible();
  await page.getByLabel("业务开始日期", { exact: true }).fill("2026-11-01");
  await page.getByLabel("业务结束日期", { exact: true }).fill("2026-11-02");
  await page.getByLabel("业务日期排序", { exact: true }).selectOption("asc");
  await page.getByRole("button", { name: "日报下一页", exact: true }).click();
  await expect.poll(() => calls.some(c => c.section === "sales-traffic" && c.params.get("page") === "2" && c.params.get("from") === "2026-11-01" && c.params.get("to") === "2026-11-02" && c.params.get("direction") === "asc")).toBe(true);
  await page.getByText("来源与版本", { exact: true }).click();
  await expect(page.getByText("报告 report-fixture", { exact: false })).toBeVisible();
});
test("sales asynchronous export freezes displayed filters/version and downloads through scoped API", async ({ page }) => {
  const { calls, state } = await setup(page);
  state.salesSources = [{ ...sources[0], id: "sales-source", resource: "sales_traffic", marketplaceId: "ATVPDKIKX0DER" }];
  await page.getByRole("button", { name: "销售流量日报", exact: true }).click();
  await page.getByLabel("业务开始日期", { exact: true }).fill("2026-11-01");
  await page.getByRole("button", { name: "按当前条件异步导出", exact: true }).click();
  await expect.poll(() => calls.find(c => c.section === "sales-export" && c.body)?.body).toMatchObject({ asOf: "2026-11-04T02:00:00.000Z", filters: { from: "2026-11-01" } });
  state.exportStatus = "SUCCEEDED";
  await page.getByRole("button", { name: "下载 JSONL（含来源与版本）", exact: true }).click();
  await expect.poll(() => calls.some(c => c.section === "sales-export" && c.params.get("download") === "1")).toBe(true);
});
test("sales read-only users can inspect facts while sync and export controls remain disabled", async ({ page }) => {
  const { state } = await setup(page, true);
  state.salesSources = [{ ...sources[0], id: "sales-source", resource: "sales_traffic", marketplaceId: "ATVPDKIKX0DER" }];
  await page.getByRole("button", { name: "销售流量日报", exact: true }).click();
  await expect(page.getByRole("button", { name: "申请报告同步", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "按当前条件异步导出", exact: true })).toBeDisabled();
  await expect(page.getByText("20 USD", { exact: true })).toBeVisible();
});

test("scope grants and revocations submit explicit revisions for approval", async ({ page }) => {
  const { calls, state } = await setup(page);
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click();
  await page.getByLabel("成员／角色", { exact: true }).selectOption("member-a");
  await page.getByLabel("授权 Seller", { exact: true }).selectOption("store-a");
  await page.getByRole("button", { name: "申请保存授权", exact: true }).click();
  await expect.poll(() => calls.find(c => c.body?.action === "save-access-grant")?.body).toMatchObject({ userId: "member-a", sellerAccountId: "store-a", revision: 0, enabled: true });
  state.grants = [{ id: "grant-a", userId: "member-a", sellerAccountId: "store-a", enabled: true, revision: 3 }];
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByLabel("成员／角色", { exact: true }).selectOption("member-a");
  await page.getByLabel("授权 Seller", { exact: true }).selectOption("store-a");
  await expect(page.getByRole("button", { name: "申请保存授权", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "申请撤销范围", exact: true }).click();
  await expect.poll(() => calls.find(c => c.body?.action === "save-access-grant" && c.body.enabled === false)?.body).toMatchObject({ userId: "member-a", sellerAccountId: "store-a", revision: 3, enabled: false });
});


test("authorization save shows pending and inline failure, preserves input, and focuses approval success", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 900, height: 550 });
  let attempts = 0;
  let finish: () => void = () => {};
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route("**/api/operations/sync-center", async route => {
    const body = route.request().postDataJSON();
    expect(body.action).toBe("save-authorization");
    expect(body.amazonSellerId).toBe("");
    attempts++;
    if (attempts === 1) {
      await pending;
      return route.fulfill({ status: 400, json: { error: "模拟授权配置校验失败，请检查服务端配置。" } });
    }
    return route.fulfill({ status: 202, json: { approvalRequired: true } });
  });
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click();
  await page.getByRole("button", { name: "新增授权", exact: true }).click();
  await page.getByLabel("授权名称", { exact: true }).fill("模拟授权");
  await expect(page.getByLabel("Amazon Seller ID（业务同步时填写真实编号）")).toBeHidden();
  for (const field of ["lwaClientId", "lwaClientSecret", "refreshToken"]) await page.getByLabel(field, { exact: true }).fill(`mock-${field}`);
  await page.getByRole("button", { name: "保存授权", exact: true }).click();
  await expect(page.getByRole("button", { name: "正在提交…", exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "正在提交授权审批请求" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "关闭", exact: true })).toBeDisabled();
  expect(attempts).toBe(1);
  finish();
  const error = page.getByRole("alert").filter({ hasText: "模拟授权配置校验失败" });
  await expect(error).toBeInViewport();
  await expect(page.getByLabel("refreshToken", { exact: true })).toHaveValue("mock-refreshToken");
  await expect(page.getByRole("button", { name: "保存授权", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "保存授权", exact: true }).click();
  const success = page.getByRole("status").filter({ hasText: "审批请求已创建" });
  await expect(success).toContainText("尚未应用配置或启动任务");
  await expect(success).toBeFocused();
  await expect(success).toBeInViewport();
  await expect(page.getByLabel("refreshToken", { exact: true })).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("authorization update shows network failure beside save and closing never submits", async ({ page }) => {
  await setup(page);
  let attempts = 0;
  await page.route("**/api/operations/sync-center", route => { attempts++; return route.abort("failed"); });
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click();
  await page.getByRole("button", { name: "更新授权／凭证", exact: true }).click();
  await page.getByRole("button", { name: "保存授权", exact: true }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "保存授权", exact: true }) });
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(form.getByRole("button", { name: "保存授权", exact: true })).toBeEnabled();
  await expect(page.getByLabel("授权名称", { exact: true })).toHaveValue("授权 a");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByLabel("授权名称", { exact: true })).toHaveCount(0);
  expect(attempts).toBe(1);
});


for (const kind of ["validate", "disable"] as const) test(`${kind} authorization shows local submission feedback and opens approvals without applying`, async ({ page }) => {
  const { calls } = await setup(page);
  await page.setViewportSize({ width: 900, height: 550 });
  let finish: () => void = () => {};
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let submissions = 0;
  await page.route("**/api/operations/sync-center", async route => {
    expect(route.request().postDataJSON()).toEqual({ action: `${kind}-authorization`, id: "auth-a", ...(kind === "disable" ? { revision: 1 } : {}) });
    submissions++;
    await pending;
    return route.fulfill({ status: 202, json: { approvalRequired: true } });
  });
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click();
  await page.getByRole("button", { name: kind === "validate" ? "验证参与站点" : "停用授权", exact: true }).click();
  const feedback = page.getByTestId(`authorization-${kind === "validate" ? "validation" : "disable"}-auth-a`);
  await expect(page.getByRole("button", { name: kind === "validate" ? "正在提交验证申请…" : "正在提交停用申请…", exact: true })).toBeDisabled();
  await expect(feedback.getByRole("status")).toBeInViewport();
  expect(submissions).toBe(1);
  finish();
  await expect(feedback.getByRole("status")).toContainText(kind === "validate" ? "尚未请求 Amazon" : "授权尚未停用");
  await expect(feedback.getByRole("status")).toBeInViewport();
  await expect(page.getByText(/尚未成功验证/)).toBeVisible();
  await feedback.getByRole("button", { name: "前往变更审批", exact: true }).click();
  await expect(page.getByRole("heading", { name: "变更审批", exact: true })).toBeVisible();
  expect(calls.some(c => c.body?.decision)).toBe(false);
  expect(submissions).toBe(1);
});

for (const kind of ["validate", "disable"] as const) test(`${kind} authorization request failure is visible at the clicked authorization and can retry`, async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 900, height: 550 });
  let submissions = 0;
  await page.route("**/api/operations/sync-center", route => {
    submissions++;
    return submissions === 1
      ? route.fulfill({ status: 403, json: { error: "模拟验证申请被拒绝。" } })
      : route.fulfill({ status: 202, json: { approvalRequired: true } });
  });
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click();
  await page.getByRole("button", { name: kind === "validate" ? "验证参与站点" : "停用授权", exact: true }).click();
  const feedback = page.getByTestId(`authorization-${kind === "validate" ? "validation" : "disable"}-auth-a`);
  await expect(feedback.getByRole("alert")).toContainText("模拟验证申请被拒绝");
  await expect(feedback.getByRole("alert")).toBeInViewport();
  await expect(feedback.getByRole("button", { name: "前往变更审批", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: kind === "validate" ? "验证参与站点" : "停用授权", exact: true }).click();
  await expect(feedback.getByRole("status")).toContainText(kind === "validate" ? "验证申请已创建" : "停用申请已创建");
  await expect(feedback.getByRole("alert")).toHaveCount(0);
  expect(submissions).toBe(2);
});


test("failed validation application refreshes terminal state, retains error and links to authorization result", async ({ page }) => {
  const { state, calls } = await setup(page);
  state.approvalStatus = "APPROVED";
  await page.route("**/api/operations/sync-center?*", async route => {
    if (new URL(route.request().url()).searchParams.get("section") !== "approvals") return route.fallback();
    return route.fulfill({ json: { access: { canApprove: true, canConfigure: true }, requests: [{ id: "validation-fixture", targetEnvironment: "local", changeType: "SyncExecutionRequest", operation: "validate-authorization", targetId: "auth-a", sellerIds: [], marketplaceIds: [], domains: [], sourceIds: [], baseRevision: 1, changeDigest: "fixture", status: state.approvalStatus, expiresAt: "2099-01-01T00:00:00Z", beforeSummary: {}, afterSummary: {} }] } });
  });
  let applications = 0;
  await page.route("**/api/operations/sync-center/approvals", route => {
    applications++;
    state.approvalStatus = "FAILED"; state.invalidAuth = true;
    return route.fulfill({ status: 409, json: { error: "Amazon 授权验证失败；错误信息已脱敏记录。" } });
  });
  await page.getByRole("button", { name: "变更审批", exact: true }).click();
  await page.getByRole("button", { name: "应用已批准变更", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Amazon 授权验证失败" })).toBeVisible();
  await expect(page.getByTestId("amazon-change-request")).toContainText("不能重复应用");
  await expect(page.getByRole("button", { name: "应用已批准变更", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "查看授权验证结果", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("AUTH_REJECTED");
  await expect(page.getByRole("alert")).toContainText("亚马逊返回：");
  await expect(page.getByRole("alert")).toContainText("排查建议");
  expect(applications).toBe(1);
  expect(calls.some(c => c.body?.action === "validate-authorization")).toBe(false);
});


test("authorization disable stays pending until explicit approval and application then disables all authorization actions", async ({ page }) => {
  const { state } = await setup(page);
  state.approvalOperation = "disable-authorization";
  let submissions = 0, applications = 0;
  await page.route("**/api/operations/sync-center", route => {
    expect(route.request().postDataJSON()).toEqual({ action: "disable-authorization", id: "auth-a", revision: 1 });
    submissions++;
    return route.fulfill({ status: 202, json: { approvalRequired: true } });
  });
  await page.route("**/api/operations/sync-center/approvals", route => {
    if (route.request().postDataJSON().decision !== "APPLY") return route.fallback();
    applications++; state.disabledAuth = true; state.approvalStatus = "APPLIED";
    return route.fulfill({ json: { applied: true } });
  });
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click();
  await page.getByRole("button", { name: "停用授权", exact: true }).click();
  const feedback = page.getByTestId("authorization-disable-auth-a");
  await expect(feedback.getByRole("status")).toContainText("授权尚未停用");
  await expect(page.getByRole("button", { name: "停用授权", exact: true })).toBeEnabled();
  expect(applications).toBe(0);
  await feedback.getByRole("button", { name: "前往变更审批", exact: true }).click();
  await page.getByRole("button", { name: "批准", exact: true }).click();
  expect(applications).toBe(0);
  await page.getByRole("button", { name: "应用已批准变更", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已应用本次批准变更" })).toBeVisible();
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click();
  await expect(page.getByText("已停用", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "停用授权", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "更新授权／凭证", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "验证参与站点", exact: true })).toBeDisabled();
  expect(submissions).toBe(1); expect(applications).toBe(1);
});

test("observation domains expose inbound layers, own prices, brand analyses and history without snapshot fallback", async ({ page }) => {
  await setup(page);
  const observed: URLSearchParams[] = [];
  await page.route("**/api/operations/sync-center?*", async route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("section") === "brand-analytics") {
      const coverage = { reportKind: params.get("reportKind"), from: "2026-10-01", to: "2026-10-31", reportPeriod: "MONTH" };
      return route.fulfill({ json: { sources: [], source: null, plans: [], collection: null, configuration: null, versions: [], run: { id: "brand", coverage }, batchCount: 1, rows: [{ id: "brand", sourceRunId: "brand", capturedAt: "2026-11-01T01:00:00Z", facts: { asin: "B123456789", clickedAsin: "B123456789", searchTerm: "fixture search", searchQueryData: { searchQuery: "fixture search" } } }], pagination: { total: 1, pageCount: 1 } } });
    }
    if (params.get("section") !== "observations") return route.fallback();
    observed.push(params);
    const resource = params.get("resource"), kind = params.get("kind")!;
    const facts = resource === "fulfillment" ? { inboundPlanId: "fixture-plan", shipmentId: "fixture-shipment", sourceStatus: "SHIPPED", sellerSku: "OBSERVATION-SKU", declaredQuantity: 20, quantitySemantics: "SHIPMENT_DECLARED", inTransitQuantity: null } : resource === "buy_box_history" ? { businessDate: "2026-11-01", asin: "B123456789", buyBoxPercentage: "0", sessions: "10", pageViews: "15" } : resource === "pricing" ? { asin: "B123456789", marketplaceId: "US", offers: [], featuredBuyingOptions: [], referencePrices: [], availability: "NO_OFFER_RETURNED" } : { from: "2026-10-01", to: "2026-10-31", searchTerm: "fixture search", searchFrequencyRank: "10", clickShare: "0.2" };
    return route.fulfill({ json: { resource, sources: [{ id: "observation-source", marketplaceId: "US", seller: { displayName: "店铺 A" } }], source: { id: "observation-source", lastSuccessAt: "2026-11-01T01:00:00Z" }, versions: [{ id: "observation-run", finishedAt: "2026-11-01T01:00:00Z" }], rows: [{ id: "observation-row", sourceRunId: "observation-run", kind, asin: "B123456789", sellerSku: "OBSERVATION-SKU", searchTerm: null, facts, capturedAt: "2026-11-01T01:00:00Z" }], pagination: { total: 51, pageCount: 2 } } });
  });
  await page.getByRole("button", { name: "FBA 在途货件", exact: true }).click();
  const inbound = page.getByTestId("amazon-fulfillment-observations");
  await expect(inbound.getByText("fixture-plan", { exact: true })).toBeVisible();
  await inbound.getByRole("button", { name: "货件商品", exact: true }).click();
  await expect(inbound.getByText("SHIPMENT_DECLARED", { exact: true })).toBeVisible();
  await inbound.getByLabel("ASIN", { exact: true }).fill("B123456789");
  await expect.poll(() => observed.at(-1)?.get("asin")).toBe("B123456789");
  await inbound.getByRole("button", { name: "下一页", exact: true }).click();
  await expect.poll(() => observed.at(-1)?.get("page")).toBe("2");
  await page.getByRole("button", { name: "价格与 Featured Offer", exact: true }).click();
  await expect(page.getByTestId("amazon-pricing-observations").getByText("NO_OFFER_RETURNED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "品牌分析", exact: true }).click();
  for (const label of ["搜索查询绩效 SQP", "搜索目录绩效 SCP", "购买组合", "搜索词分析", "复购分析"]) {
    await page.getByTestId("amazon-brand_analytics-observations").getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("cell", { name: "B123456789", exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Buy Box 历史日报", exact: true }).click();
  await expect(page.getByTestId("amazon-buy_box_history-observations").getByText("0%", { exact: true })).toBeVisible();
});

test("observation read errors show retryable UI and clear stale records", async ({ page }) => {
  await setup(page); let denied = false;
  await page.route("**/api/operations/sync-center?*", route => {
    if (new URL(route.request().url()).searchParams.get("section") !== "observations") return route.fallback();
    return route.fulfill(denied ? { status: 403, json: { error: "该来源不可访问。" } } : { json: { sources: [], source: null, versions: [], rows: [], pagination: { total: 0, pageCount: 0 } } });
  });
  await page.getByRole("button", { name: "FBA 在途货件", exact: true }).click();
  const panel = page.getByTestId("amazon-fulfillment-observations"); await expect(panel.getByText(/暂无已发布数据/)).toBeVisible();
  denied = true; await panel.getByRole("button", { name: "刷新列表", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("该来源不可访问。");
  await expect(panel.getByRole("table")).toHaveCount(0);
  denied = false; await panel.getByRole("button", { name: "刷新列表", exact: true }).click();
  await expect(panel.getByText(/暂无已发布数据/)).toBeVisible();
});

test("Listing and Catalog source configuration submits only the selected bounded identifiers", async ({ page }) => {
  const { calls } = await setup(page);
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click();
  await page.getByLabel("ERP 店铺", { exact: true }).selectOption("store-a");
  await page.getByLabel("已验证 Marketplace", { exact: true }).selectOption("US");
  await page.getByLabel("数据域", { exact: true }).selectOption("listing_details");
  await page.getByLabel("应用标识（非敏感）", { exact: true }).fill("fixture-app");
  await page.getByLabel("Seller SKU（最多 100 个，每项最多 255 字符，逗号或换行分隔）", { exact: true }).fill("sku-1\nsku-2");
  await page.getByRole("button", { name: "保存数据源", exact: true }).click();
  await expect.poll(() => calls.find(c => c.body && (c.body as { resource?: string }).resource === "listing_details")?.body).toMatchObject({ resource: "listing_details", domainPolicy: { sellerSkus: ["sku-1", "sku-2"], requestsPerSecond: 1 } });
});

test("Catalog source configuration submits only the selected bounded ASINs", async ({ page }) => {
  const { calls } = await setup(page);
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click();
  await page.getByLabel("ERP 店铺", { exact: true }).selectOption("store-a");
  await page.getByLabel("已验证 Marketplace", { exact: true }).selectOption("US");
  await page.getByLabel("数据域", { exact: true }).selectOption("catalog_items");
  await page.getByLabel("应用标识（非敏感）", { exact: true }).fill("fixture-app");
  await page.getByLabel("ASIN（最多 100 个，逗号或换行分隔）", { exact: true }).fill("B123456789\nB987654321");
  await page.getByRole("button", { name: "保存数据源", exact: true }).click();
  await expect.poll(() => calls.find(c => c.body && (c.body as { resource?: string }).resource === "catalog_items")?.body).toMatchObject({ resource: "catalog_items", domainPolicy: { asins: ["B123456789", "B987654321"] } });
});

test("operations organizes existing readers and procurement into nine sections and keeps capability gaps explicit", async ({ page }) => {
  const { calls, businessCalls } = await setup(page);
  const cards = page.getByRole("region", { name: "经营中台业务板块", exact: true });
  await expect(cards.locator(":scope > article")).toHaveCount(9);
  const navigation = page.getByRole("navigation", { name: "业务数据导航", exact: true });
  for (const label of ["商品与 Listing", "订单与销售", "库存与仓储", "物流与履约", "价格与竞争报价", "财务、结算与税务", "经营与品牌分析", "退货、售后与账户健康"]) {
    await expect(navigation.getByRole("region", { name: label, exact: true })).toBeVisible();
  }
  await cards.getByRole("button", { name: "进入库存与仓储 →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Amazon 库存快照", exact: true })).toBeVisible();
  await expect.poll(() => businessCalls.includes("/api/operations/inventory/snapshots") && businessCalls.includes("/api/operations/freshness")).toBe(true);
  const beforeBusiness = businessCalls.length;
  for (const label of ["商品类型与属性定义", "A+ 内容与关联 ASIN", "AWD 库存", "自配送运费与面单", "MCF 履约单与包裹", "佣金与 FBA 费用预估", "报价变动通知", "税务与发票", "Data Kiosk 查询", "买家消息与邀评", "账户健康与卖家绩效"]) {
    await navigation.getByRole("button", { name: `${label}· 待接入`, exact: true }).click();
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "板块字段与来源" })).toContainText("当前没有此能力的已接入查询或采集操作");
    await expect(page.getByText("读取同步状态…", { exact: true })).toHaveCount(0);
  }
  expect(calls.some(call => call.body)).toBe(false);
  expect(businessCalls.length).toBe(beforeBusiness);
  expect(calls.every(call => ["overview", "sources"].includes(call.section))).toBe(true);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("capability URLs restore on reload and browser history without inventing backend sections", async ({ page }) => {
  const { calls } = await setup(page);
  await page.goto("http://127.0.0.1:43224/?view=a-plus");
  await expect(page.getByRole("heading", { name: "A+ 内容与关联 ASIN", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "订单列表", exact: true }).click();
  await expect(page.getByRole("heading", { name: "订单列表", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "A+ 内容与关联 ASIN", exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "订单列表", exact: true })).toBeVisible();
  expect(calls.some(call => call.section === "a-plus" || call.body)).toBe(false);
});

test("Listing and Catalog navigation use the existing sources contract alongside observation queries", async ({ page }) => {
  const { calls } = await setup(page);
  await page.route("**/api/operations/sync-center?*", route => {
    if (new URL(route.request().url()).searchParams.get("section") !== "observations") return route.fallback();
    return route.fulfill({ json: { sources: [], source: null, versions: [], rows: [], pagination: { total: 0, pageCount: 0 } } });
  });
  for (const [label, resource] of [["Listing 完整信息", "listing_details"], ["商品目录", "catalog_items"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByTestId(`amazon-${resource}-observations`)).toContainText("暂无已发布数据");
  }
  expect(calls.every(call => ["overview", "sources"].includes(call.section))).toBe(true);
  expect(calls.some(call => call.body)).toBe(false);
});

test("Listing empty version shows active progress and failure without exposing staged rows", async ({ page }) => {
  await setup(page);
  let error: string | null = null;
  await page.route("**/api/operations/sync-center?*", route => {
    if (new URL(route.request().url()).searchParams.get("section") !== "observations") return route.fallback();
    return route.fulfill({ json: { sources: [{ id: "listing-source", marketplaceId: "US", seller: { displayName: "店铺 A" } }], source: { id: "listing-source", lastSuccessAt: null }, latestTask: { id: "listing-task", status: error ? "BLOCKED" : "WAITING", stage: "FETCHING", processedCount: 153, failedCount: 0, updatedAt: "2026-11-06T09:20:00Z", error }, versions: [], rows: [], pagination: { total: 0, pageCount: 0 } } });
  });
  await page.getByRole("button", { name: "Listing 完整信息", exact: true }).click();
  const panel = page.getByTestId("amazon-listing_details-observations");
  await expect(panel).toContainText("已处理 153 个对象");
  await expect(panel).toContainText("无需重复提供商品清单");
  error = "详情接口能力证据已过期";
  await panel.getByRole("button", { name: "刷新列表", exact: true }).click();
  await expect(panel).toContainText(error);
});

test("Order items distinguishes disabled detail collection from pending collection", async ({ page }) => {
  await setup(page);
  let enabled = false;
  await page.route("**/api/operations/sync-center?*", route => {
    if (new URL(route.request().url()).searchParams.get("section") !== "orders") return route.fallback();
    return route.fulfill({ json: { rows: [], sources: [{ id: "orders-source", marketplaceId: "US", detailsEnabled: enabled, detailsComplete: false }], pagination: { total: 0, pageCount: 0 } } });
  });
  await page.getByRole("button", { name: "订单商品", exact: true }).click();
  const panel = page.getByTestId("amazon-order-items-workbench");
  await expect(panel).toContainText("订单商品详情采集尚未启用");
  enabled = true;
  await panel.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(panel).toContainText("详情采集已启用");
});

test("Inventory age displays the selected marketplace report failure", async ({ page }) => {
  await setup(page);
  await page.route("**/api/operations/sync-center?*", route => {
    if (new URL(route.request().url()).searchParams.get("section") !== "domain-reports") return route.fallback();
    const source = { id: "age-source", marketplaceId: "MX", seller: { displayName: "店铺 A" }, lastSuccessAt: null, resourceCursor: { status: "FAILED" } };
    return route.fulfill({ json: { source, sources: [source], latestTask: { id: "age-task", status: "FAILED", error: "REPORT_CANCELLED：Amazon 已取消报告" }, documents: [], rows: [], pagination: { total: 0, pageCount: 0 }, dateMeaning: "snapshot", amountMeaning: "original" } });
  });
  await page.getByRole("button", { name: "库龄", exact: true }).click();
  await expect(page.getByTestId("amazon-inventory_age-workbench").getByRole("alert")).toContainText("REPORT_CANCELLED");
});


for (const readOnly of [false, true]) test(`Listing recovery entry follows successful task and configuration permission (${readOnly ? "read-only" : "admin"})`, async ({ page }) => {
  const { state } = await setup(page, readOnly); state.listingTask = true; state.succeeded = true;
  await page.getByRole("button", { name: "同步任务", exact: true }).click();
  await page.getByRole("button", { name: "详情", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Listing 历史属性补齐", exact: true })).toHaveCount(readOnly ? 0 : 1);
  if (!readOnly) {
    state.succeeded = false; await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Listing 历史属性补齐", exact: true })).toHaveCount(0);
  }
});

for (const blocked of [false, true]) test(`Orders recovery shows checkpoint-only evidence and blocks invalid retries (${blocked})`, async ({ page }) => {
  const { state, calls } = await setup(page);
  state.ordersTask = true; state.recoveryBlocked = blocked;
  await page.getByRole("button", { name: "同步任务", exact: true }).click();
  await page.getByRole("button", { name: "详情", exact: true }).click();
  const panel = page.getByTestId("order-recovery-readiness");
  await expect(panel).toBeVisible();
  const retry = page.getByRole("button", { name: "从增量游标重试", exact: true });
  if (blocked) {
    await expect(panel).toContainText("不能从头覆盖");
    await expect(retry).toBeDisabled();
  } else {
    await expect(panel).toContainText("当前窗口待处理 9 笔");
    await expect(panel).toContainText("已补齐 491 笔");
    await expect(panel).toContainText("继续采集订单详情");
    await expect(retry).toBeEnabled();
  }
  expect(calls.filter(call => call.body?.action === "control-task")).toHaveLength(0);
});

for (const readOnly of [false, true]) test(`Cancelled Catalog recovery preserves approval boundary (${readOnly ? "read-only" : "admin"})`, async ({ page }) => {
  const { state, calls } = await setup(page, readOnly); state.cancelledCatalog = true;
  await page.getByRole("button", { name: "同步任务", exact: true }).click();
  await page.getByRole("button", { name: "详情", exact: true }).click();
  const retry = page.getByRole("button", { name: "申请恢复已取消任务（保留进度）", exact: true });
  if (readOnly) await expect(retry).toBeDisabled();
  else {
    await retry.click();
    await expect(page.getByRole("status").filter({ hasText: "审批请求已创建" })).toContainText("尚未应用配置或启动任务");
    expect(calls.filter(c => c.body?.action === "control-task").map(c => c.body)).toEqual([{ action: "control-task", id: "fixture-task", control: "retry" }]);
  }
});
