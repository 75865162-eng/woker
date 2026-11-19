import { expect, test, type Page } from "@playwright/test";

/**
 * 多标签导航"点击失效"复现测试（文档第三阶段 A–H）。
 *
 * 真实浏览器 + 真实 WorkspaceShell + dev-only 诊断快照。
 * 登录一次后用【真实 SPA 点击】操作（侧栏一级菜单 + tab 栏），
 * 不用 page.goto 做连续导航——goto 是整页硬导航，测不到保活/竞态逻辑。
 *
 * 需要隔离测试账号：E2E_TEST_EMAIL / E2E_TEST_PASSWORD。
 */

const testEmail = process.env.E2E_TEST_EMAIL;
const testPassword = process.env.E2E_TEST_PASSWORD;

// 7 个一级板块的落地页（对应侧栏可见的一级 Link；2026-11 命名空间重构后）。
// 均为侧栏 href，服务端 rewrite 不改变浏览器 URL，故点击后 URL 保持这些路径。
const SECTIONS = [
  { label: "商品管理", href: "/product" },
  { label: "赛狐数据", href: "/sellfox/profit" },
  { label: "亚马逊数据", href: "/amazon/sales-traffic" },
  { label: "采购管理", href: "/purchase/plans" },
  { label: "仓库管理", href: "/wms/logistics" },
  { label: "财务管理", href: "/fin/transactions" },
  { label: "AI 与工具", href: "/ai/lili" },
];

type DiagSnapshot = {
  enabled: boolean;
  counters: {
    clicks: number; routes: number; mounts: number; unmounts: number; renders: number;
    requestsStarted: number; requestsEnded: number; requestsPending: number; errors: number; longtasks: number;
  };
  mountByHref: Record<string, number>;
  renderByHref: Record<string, number>;
  events: Array<{ t: string; at: number; href?: string; target?: string; phase?: string; ms?: number }>;
};

async function diag(page: Page): Promise<DiagSnapshot | null> {
  return page.evaluate(() => {
    const g = (window as unknown as { __WOKER_TAB_DIAG__?: { installed: boolean; snapshot: DiagSnapshot } }).__WOKER_TAB_DIAG__;
    const snap = g?.snapshot ?? null;
    return snap ? JSON.parse(JSON.stringify(snap)) as DiagSnapshot : null;
  });
}

async function login(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("账号 / 手机号").fill(testEmail!);
  await page.getByLabel("密码").fill(testPassword!);
  await page.locator("form").getByRole("button", { name: "登录", exact: true }).last().click();
  await expect(page).not.toHaveURL(/\/login/);
  // 等外壳与诊断挂载。
  await expect(page.locator('[data-workspace-view]:not([hidden])')).toHaveCount(1, { timeout: 20_000 });
}

/** 真实点击侧栏一级板块 Link（SPA 导航），并断言切到目标路径。 */
async function clickSection(page: Page, label: string, hrefPattern: RegExp) {
  await page.getByRole("link", { name: label, exact: true }).first().click();
  await expect(page).toHaveURL(hrefPattern, { timeout: 15_000 });
}

/** 可见视图唯一性：任意时刻只有一个未隐藏的工作区视图。 */
async function assertSingleVisibleView(page: Page) {
  await expect(page.locator('[data-workspace-view]:not([hidden])')).toHaveCount(1);
}

function assertNoUnboundedMounts(snap: DiagSnapshot, maxPerHref = 3) {
  for (const [href, count] of Object.entries(snap.mountByHref)) {
    expect(count, `${href} mounted ${count} times`).toBeLessThanOrEqual(maxPerHref);
  }
}

function assertNoErrors(snap: DiagSnapshot | null, context: string) {
  expect(snap?.counters.errors ?? 0, `${context}: unexpected errors`).toBe(0);
}

test.describe("多标签导航点击失效复现 A-H", () => {
  test.skip(!testEmail || !testPassword, "需要 E2E_TEST_EMAIL / E2E_TEST_PASSWORD 指向隔离测试账号");

  test("A: 连续打开 2/4/7 个板块后仍可点击切换", async ({ page }) => {
    await login(page);
    for (const count of [2, 4, 7]) {
      for (const section of SECTIONS.slice(0, count)) {
        await clickSection(page, section.label, new RegExp(`${section.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?.*)?$`));
      }
      await assertSingleVisibleView(page);
      assertNoErrors(await diag(page), `A @ ${count} sections`);
    }
    // 点回第一个 tab（老 tab 可正常关闭/激活）。
    const tabCount = await page.locator('[data-workspace-tabbar] [role="tab"]').count();
    expect(tabCount).toBeGreaterThanOrEqual(2);
    await page.locator('[data-workspace-tabbar] [role="tab"]').first().locator("button").first().click();
    await assertSingleVisibleView(page);
  });

  test("B: 连续切换 Tab 50 次无失效", async ({ page }) => {
    await login(page);
    for (const section of SECTIONS.slice(0, 4)) {
      await clickSection(page, section.label, new RegExp(`${section.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?.*)?$`));
    }
    const tabs = page.locator('[data-workspace-tabbar] [role="tab"]');
    const n = await tabs.count();
    expect(n).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 50; i++) {
      // tab 数量可能因 LRU/重定向变化，每次按当前数量取安全索引。
      const current = await tabs.count();
      const idx = i % current;
      await tabs.nth(idx).locator("button").first().click({ noWaitAfter: true, timeout: 8000 });
    }
    await page.waitForTimeout(1000);
    await assertSingleVisibleView(page);
    const snap = await diag(page);
    assertNoErrors(snap, "B");
    assertNoUnboundedMounts(snap!);
  });

  test("C: 快速连续点击不同菜单 30 次", async ({ page }) => {
    await login(page);
    for (const section of SECTIONS.slice(0, 4)) {
      await clickSection(page, section.label, new RegExp(`${section.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?.*)?$`));
    }
    const tabs = page.locator('[data-workspace-tabbar] [role="tab"]');
    for (let i = 0; i < 30; i++) {
      const current = await tabs.count();
      if (!current) break;
      await tabs.nth(i % current).locator("button").first().click({ noWaitAfter: true, timeout: 8000 });
    }
    await page.waitForTimeout(1200);
    await assertSingleVisibleView(page);
    assertNoErrors(await diag(page), "C");
  });

  test("D: 关闭部分 Tab 后重新打开", async ({ page }) => {
    await login(page);
    for (const section of SECTIONS.slice(0, 5)) {
      await clickSection(page, section.label, new RegExp(`(${SECTIONS.map(s => s.href).join("|")})(?:\\?.*)?$`));
    }
    const before = await page.locator('[data-workspace-tabbar] [role="tab"]').count();
    // 关闭最后一个 tab。
    await page.locator('[data-workspace-tabbar] [role="tab"]').last().locator('button[aria-label^="关闭"]').click();
    await page.waitForTimeout(400);
    const after = await page.locator('[data-workspace-tabbar] [role="tab"]').count();
    expect(after).toBeLessThan(before);
    // 重新打开一个板块。
    await clickSection(page, "赛狐数据", /\/sellfox\/profit(?:\?.*)?$/);
    await assertSingleVisibleView(page);
    assertNoErrors(await diag(page), "D");
  });

  test("F: 接口延迟/失败/超时不会使导航失效", async ({ page }) => {
    await login(page);
    await page.route("**/api/operations/ext**", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      return route.abort(); // 模拟超时后中断
    });
    for (const section of SECTIONS.slice(0, 3)) {
      await page.getByRole("link", { name: section.label, exact: true }).first().click();
      await expect(page).not.toHaveURL(/\/login/);
    }
    await assertSingleVisibleView(page);
    expect(await diag(page)).not.toBeNull();
  });

  test("G: 打开大量页面后仍可打开新页面", async ({ page }) => {
    await login(page);
    for (const section of SECTIONS) {
      await page.getByRole("link", { name: section.label, exact: true }).first().click();
    }
    // 再连续切换，验证仍可打开/激活。
    await page.locator('[data-workspace-tabbar] [role="tab"]').last().locator("button").first().click();
    await assertSingleVisibleView(page);
    const snap = await diag(page);
    assertNoErrors(snap, "G");
    assertNoUnboundedMounts(snap!);
  });

  test("H: 刷新后 Tab 恢复与状态同步", async ({ page }) => {
    await login(page);
    for (const section of SECTIONS.slice(0, 4)) {
      await page.getByRole("link", { name: section.label, exact: true }).first().click();
    }
    const before = await page.locator('[data-workspace-tabbar] [role="tab"]').count();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('[data-workspace-view]:not([hidden])')).toHaveCount(1, { timeout: 20_000 });
    const after = await page.locator('[data-workspace-tabbar] [role="tab"]').count();
    expect(after).toBeGreaterThanOrEqual(1);
    expect(after).toBeLessThanOrEqual(before + 1);
    assertNoErrors(await diag(page), "H");
  });

  // E 耗时 10 分钟，默认跳过；用 E2E_SLOW=1 显式启用。
  test("E: 页面运行 10 分钟后仍可操作", async ({ page }) => {
    test.skip(process.env.E2E_SLOW !== "1", "设置 E2E_SLOW=1 运行 10 分钟长稳测试");
    test.setTimeout(15 * 60_000);
    await login(page);
    const before = await diag(page);
    await page.waitForTimeout(10 * 60_000);
    await page.getByRole("link", { name: "商品管理", exact: true }).first().click();
    await assertSingleVisibleView(page);
    const after = await diag(page);
    expect((after?.counters.requestsPending ?? 0) - (before?.counters.requestsPending ?? 0)).toBeLessThan(50);
    assertNoErrors(after, "E");
  });
});
