import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import type { SyncSourceView, SyncTaskView, SyncPlanView } from "@/lib/amazon-sync/contracts";
let bundle = "", styles = "";
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: ["tests/browser/sync-center-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
  const [{ readFile }, { default: postcss }, { default: tailwind }] = await Promise.all([import("node:fs/promises"), import("postcss"), import("@tailwindcss/postcss")]);
  // The installed Tailwind plugin resolves a second PostCSS copy. The public plugin
  // contract is identical, but its nominal node classes differ between packages.
  styles = (await postcss([tailwind() as unknown as import("postcss").AcceptedPlugin]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css;
});
const task: SyncTaskView = { id: "fixture-task", sourceId: "source-a", resource: "inventory", status: "FAILED", stage: "FETCHING", trigger: "manual", mode: "snapshot", scheduleId: null, scheduleRevision: null, queuedAt: "2026-11-04T01:00:00Z", startedAt: "2026-11-04T01:00:01Z", finishedAt: "2026-11-04T01:00:05Z", elapsedMs: 4000, pagesCompleted: 2, processedCount: 25, insertedCount: 25, updatedCount: 0, skippedCount: 0, apiRequests: 3, throttles: 1, attempts: 1, maxAttempts: 3, error: "Amazon 请求限流，未发布新快照。", control: null, nextAttemptAt: "2026-11-04T01:01:00Z", summary: null };
const sources: SyncSourceView[] = ["a", "b"].map((v, i) => ({ id: `source-${v}`, resource: "inventory", enabled: true, marketplaceId: i ? "CA" : "US", sellerAccountId: `store-${v}`, authorizationId: `auth-${v}`, activeRunId: i ? "prior-b" : null, freshnessMinutes: 360, lastSuccessAt: i ? "2026-11-04T01:00:00Z" : null, rowCount: i ? 10 : 0, coverage: null, health: i ? "FRESH" : "FAILED", latestTask: i ? null : task, seller: { id: `store-${v}`, displayName: `店铺 ${v.toUpperCase()}`, accountKey: v, status: "active" }, authorization: { id: `auth-${v}`, name: `授权 ${v}`, status: "CONFIGURED", amazonSellerId: `SELLER-${v}`, awsRegion: "us-east-1" } }));
async function setup(page: Page, readOnly = false, entry = false) {
  const calls: Array<{ section: string; params: URLSearchParams; body?: Record<string, unknown> }> = [];
  const state = { plans: [] as SyncPlanView[], denied: false, delayed: false, release: () => {} };
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()); expect(url.origin).toBe("http://127.0.0.1:43224");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname === "/styles.css") return route.fulfill({ contentType: "text/css", body: styles });
    if (url.pathname !== "/api/operations/sync-center") return route.fulfill({ contentType: "text/html", body: '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    const section = url.searchParams.get("section") ?? ""; const body = request.method() === "POST" ? request.postDataJSON() : undefined;
    calls.push({ section, params: url.searchParams, body });
    const access = { canEdit: !readOnly, canCreate: !readOnly, canConfigure: !readOnly };
    if (state.denied) return route.fulfill({ status: 403, json: { error: "当前工作区禁止读取。" } });
    if (body) {
      if (body.action === "save-plan") { const p = { ...body, id: body.id ?? "fixture-plan", revision: Number(body.revision ?? 0) + 1, nextRunAt: "2026-11-04T02:00:00Z", targets: (body.sourceIds as string[]).map(sourceId => ({ sourceId })) } as unknown as SyncPlanView; state.plans = [p]; }
      return route.fulfill({ status: ["run", "control-task"].includes(body.action) ? 202 : 200, json: { saved: true } });
    }
    if (state.delayed && section === "task") { await new Promise<void>(r => { state.release = r; }); }
    const visible = sources.filter(s => (!url.searchParams.get("sellerAccountId") || s.sellerAccountId === url.searchParams.get("sellerAccountId")) && (!url.searchParams.get("marketplaceId") || s.marketplaceId === url.searchParams.get("marketplaceId")));
    const common = { access, sources: visible };
    if (section === "overview") return route.fulfill({ json: { ...common, metrics: { connectedStores: visible.length, enabledDomains: 1, running: 0, issues: 1, expired: 0, lastSuccessAt: "2026-11-04T01:00:00Z" }, trend: [], legacyActive: 0 } });
    if (section === "sources") return route.fulfill({ json: { ...common, sources } });
    if (section === "plans") return route.fulfill({ json: { ...common, sources, plans: state.plans } });
    if (section === "tasks") return route.fulfill({ json: { ...common, rows: [{ ...task, scope: { sellerAccountId: "store-a", marketplaceId: "US", seller: sources[0].seller } }], pagination: { total: 31, page: Number(url.searchParams.get("page")), pageSize: 30, pageCount: 2 } } });
    if (section === "task") return route.fulfill({ json: { ...common, task, source: sources[0], logs: [{ id: "log", attempt: 1, event: "FAILED", stage: "FETCHING", page: 2, code: "THROTTLE", statusCode: 429, rateLimit: "1", requestId: "fixture-request", createdAt: "2026-11-04T01:00:05Z" }], nextAfter: null } });
    if (section === "connections") return route.fulfill({ json: { ...common, sources, authorizations: [{ id: "auth-a", name: "授权 a", amazonSellerId: "SELLER-a", awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", revision: 1, status: "CONFIGURED", lastValidatedAt: null, marketplaceParticipations: [{ marketplaceId: "US", countryCode: "US", name: "US" }] }], sellers: [{ id: "store-a", displayName: "店铺 A", accountKey: "a" }] } });
    if (section === "settings") return route.fulfill({ json: { ...common, heartbeats: [], queueConfigured: true } });
    throw new Error(`unexpected section ${section}`);
  });
  await page.goto(`http://127.0.0.1:43224/${entry ? "?entry=1" : ""}`); await expect(page.getByRole("heading", { name: "数据同步健康状态" })).toBeVisible();
  return { calls, state };
}
test("all seven views remain reachable with real styles, explicit planned domains and legacy entries", async ({ page }) => {
  await setup(page);
  for (const label of ["同步计划", "同步任务", "数据域管理", "数据质量", "店铺与授权", "同步设置", "数据总览"]) { await page.getByRole("button", { name: label, exact: true }).click(); await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible(); }
  await expect(page.getByRole("link", { name: "补货计划", exact: true })).toHaveAttribute("href", "?legacy=1&tab=replenishment");
  await page.getByRole("button", { name: "数据域管理", exact: true }).click(); await page.getByRole("button", { name: "订单 规划中", exact: true }).click(); await expect(page.getByText("尚未接入；实施前核验官方版本、角色和店铺资格。", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "详情", exact: true }).click(); await expect(page.getByText("THROTTLE", { exact: false })).toBeVisible(); await page.getByRole("button", { name: "重试完整快照", exact: true }).click(); await expect(page.getByRole("status")).toContainText("不代表同步成功");
  expect(calls.find(c => c.body?.action === "control-task")?.body).toMatchObject({ control: "retry", id: "fixture-task" });
});
test("read-only access disables writes and permission failure clears stale task content", async ({ page }) => {
  const { state } = await setup(page, true); await page.getByRole("button", { name: "同步计划", exact: true }).click(); await expect(page.getByRole("button", { name: "新建计划", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "店铺与授权", exact: true }).click(); await expect(page.getByRole("button", { name: "新增授权", exact: true })).toBeDisabled();
  state.denied = true; await page.getByRole("button", { name: "刷新", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("禁止读取"); await expect(page.getByRole("heading", { name: "授权 a", exact: true })).toHaveCount(0);
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
