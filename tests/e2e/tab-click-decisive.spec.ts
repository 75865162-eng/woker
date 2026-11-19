import { test, expect, type Page } from "@playwright/test";

const testEmail = process.env.E2E_TEST_EMAIL;
const testPassword = process.env.E2E_TEST_PASSWORD;

async function login(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("账号 / 手机号").fill(testEmail!);
  await page.getByLabel("密码").fill(testPassword!);
  await page.locator("form").getByRole("button", { name: "登录", exact: true }).last().click();
  await page.waitForURL((u) => !u.pathname.includes("/login"));
  // 等 tab 栏出现，确认 restored 完成。
  await page.locator("[data-workspace-tabbar] [role=tab]").first().waitFor({ timeout: 20_000 });
}

test("decisive: does each section click eventually switch the visible view?", async ({ page }) => {
  test.skip(!testEmail || !testPassword, "needs E2E credentials");
  test.setTimeout(240_000);
  await login(page);

  const steps: Array<[string, string]> = [
    ["赛狐数据", "/sellfox/profit"],
    ["AI 与工具", "/ai/lili"],
    ["商品管理", "/product"],
    ["亚马逊数据", "/amazon/sales-traffic"],
  ];

  const results: Array<Record<string, unknown>> = [];
  for (const [label, href] of steps) {
    const t0 = Date.now();
    await page.getByRole("link", { name: label, exact: true }).first().click();
    let switched = true;
    let err = "";
    try {
      // 目标视图按 pathname 匹配：部分一级菜单会带默认 query 落地
      // （如 /operations → /operations?view=sales-traffic），精确 href 匹配会误报假死。
      await page.locator(
        `[data-workspace-view="${href}"]:not([hidden]), [data-workspace-view^="${href}?"]:not([hidden])`,
      ).waitFor({ state: "attached", timeout: 15_000 });
    } catch (e) {
      switched = false;
      err = e instanceof Error ? e.message.slice(0, 100) : String(e);
    }
    const tabHrefs = await page.locator("[data-workspace-tabbar] [role=tab]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-tab-href"))
    );
    results.push({ label, href, switched, ms: Date.now() - t0, url: page.url(), tabCount: tabHrefs.length, tabHrefs, err });
  }
  console.log("STEP_RESULTS", JSON.stringify(results, null, 2));

  const diag = await page.evaluate(() => {
    const g = (window as unknown as { __WOKER_TAB_DIAG__?: { snapshot: { counters: Record<string, number>; renderByHref: Record<string, number>; mountByHref: Record<string, number> } } }).__WOKER_TAB_DIAG__;
    return g?.snapshot ?? null;
  });
  console.log("DIAG_COUNTERS", JSON.stringify(diag?.counters));
  console.log("RENDER_BY_HREF", JSON.stringify(diag?.renderByHref));
  console.log("MOUNT_BY_HREF", JSON.stringify(diag?.mountByHref));

  // 数据收集实验：不因单步断言失败，供根因定位。
  expect(results.length).toBe(4);
});

test("control: render storm with only stable sellfox/dashboard pages", async ({ page }) => {
  test.skip(!testEmail || !testPassword, "needs E2E credentials");
  test.setTimeout(180_000);
  await login(page);

  // 只用稳定页面建立 tab（避开 lili 的重定向与轮询）。
  for (const label of ["赛狐数据", "商品管理"]) {
    await page.getByRole("link", { name: label, exact: true }).first().click();
    await page.waitForTimeout(600);
  }
  const hrefs = await page.locator("[data-workspace-tabbar] [role=tab]").evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-tab-href")).filter(Boolean) as string[]
  );
  console.log("CONTROL_TABS", JSON.stringify(hrefs));

  // 慢速切换 20 次（每次等 URL 变），测外壳重渲染。
  for (let i = 0; i < 20; i++) {
    const href = hrefs[i % hrefs.length];
    await page.locator(`[data-workspace-tabbar] [role=tab][data-tab-href="${href}"] button`).first().click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1000);
  const diag = await page.evaluate(() => {
    const g = (window as unknown as { __WOKER_TAB_DIAG__?: { snapshot: { counters: Record<string, number>; renderByHref: Record<string, number> } } }).__WOKER_TAB_DIAG__;
    return g?.snapshot ?? null;
  });
  console.log("CONTROL_DIAG", JSON.stringify({ counters: diag?.counters, renderByHref: diag?.renderByHref }));
  expect(hrefs.length).toBeGreaterThanOrEqual(2);
});
