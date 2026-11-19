import { test } from "@playwright/test";

const testEmail = process.env.E2E_TEST_EMAIL;
const testPassword = process.env.E2E_TEST_PASSWORD;

type Diag = {
  counters: Record<string, number>;
  mountByHref: Record<string, number>;
  renderByHref: Record<string, number>;
  events: Array<{ t: string; at: number; kind?: string; ms?: number; url?: string; message?: string; usedJSHeapSize?: number; totalJSHeapSize?: number }>;
};

test("dump tab diagnostics after a realistic multi-page session", async ({ page }) => {
  test.skip(!testEmail || !testPassword, "needs E2E credentials");
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("账号 / 手机号").fill(testEmail!);
  await page.getByLabel("密码").fill(testPassword!);
  await page.locator("form").getByRole("button", { name: "登录", exact: true }).last().click();
  await page.waitForURL((u) => !u.pathname.includes("/login"));
  await page.locator("[data-workspace-tabbar] [role=tab]").first().waitFor();

  const sections = ["商品管理", "赛狐数据", "亚马逊数据", "采购管理", "仓库管理", "财务管理", "AI 与工具"];
  for (const label of sections) {
    await page.getByRole("link", { name: label, exact: true }).first().click();
    await page.waitForTimeout(150);
  }
  // 反复切换 tab
  const tabs = page.locator("[data-workspace-tabbar] [role=tab]");
  for (let i = 0; i < 40; i++) {
    const c = await tabs.count();
    await tabs.nth(i % c).locator("button").first().click({ noWaitAfter: true }).catch(() => {});
  }
  await page.waitForTimeout(1000);

  const diag = await page.evaluate(() => {
    const g = (window as unknown as { __WOKER_TAB_DIAG__?: { snapshot: Diag } }).__WOKER_TAB_DIAG__;
    return g?.snapshot ? JSON.parse(JSON.stringify(g.snapshot)) as Diag : null;
  });
  if (!diag) {
    console.log("DIAG_UNAVAILABLE");
    return;
  }
  const longtasks = diag.events.filter((e) => e.t === "longtask");
  const errors = diag.events.filter((e) => e.t === "error");
  const heap = diag.events.filter((e) => e.t === "heap");
  const reqs = diag.events.filter((e) => e.t === "request" && e.kind === "end") as Array<{ ms?: number }>;
  const slowest = reqs.map((r) => r.ms ?? 0).sort((a, b) => b - a).slice(0, 5);

  console.log("DIAG_SUMMARY", JSON.stringify({
    counters: diag.counters,
    maxMountsPerHref: Object.values(diag.mountByHref).sort((a, b) => b - a).slice(0, 5),
    maxRendersPerHref: Object.values(diag.renderByHref).sort((a, b) => b - a).slice(0, 5),
    longtaskCount: longtasks.length,
    longtaskMaxMs: Math.max(0, ...longtasks.map((e) => e.ms ?? 0)),
    errorCount: errors.length,
    errorSample: errors.slice(0, 5).map((e) => e.message),
    heapFirst: heap[0]?.usedJSHeapSize ?? null,
    heapLast: heap[heap.length - 1]?.usedJSHeapSize ?? null,
    slowestRequestsMs: slowest,
  }, null, 2));
});
