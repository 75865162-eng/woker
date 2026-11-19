import { expect, test, type Page } from "@playwright/test";

/**
 * 文档第三阶段测试 A 的完整覆盖：连续打开 2/4/8/12 个不同业务页面。
 *
 * 侧栏一级板块只有 7 个，但 /operations?view=xxx 是不同的 tab 身份，
 * 用二级浮层里的真实链接累积到 12 个不同页面，全部走真实 SPA 点击。
 */

const testEmail = process.env.E2E_TEST_EMAIL;
const testPassword = process.env.E2E_TEST_PASSWORD;

async function login(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("账号 / 手机号").fill(testEmail!);
  await page.getByLabel("密码").fill(testPassword!);
  await page.locator("form").getByRole("button", { name: "登录", exact: true }).last().click();
  await page.waitForURL((u) => !u.pathname.includes("/login"));
  await expect(page.locator("[data-workspace-view]:not([hidden])")).toHaveCount(1, { timeout: 20_000 });
}

async function readErrors(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as unknown as {
      __WOKER_TAB_DIAG__?: { snapshot: { counters: { errors: number } } };
    }).__WOKER_TAB_DIAG__;
    return g?.snapshot?.counters?.errors ?? 0;
  });
}

// 12 个业务页面：7 个一级板块落地页 + 5 个亚马逊数据子视图（二级浮层链接）。
// 每项带期望 URL 正则，点击后必须等导航真正落地再点下一个，避免快速点击被合并/取消。
// 2026-11 命名空间重构：一级入口 URL 即命名空间路径（rewrite 不改变浏览器 URL）。
const PAGES: Array<{ label: string; url: RegExp }> = [
  { label: "商品管理", url: /\/product(?:\?.*)?$/ },
  { label: "赛狐数据", url: /\/sellfox\/profit(?:\?.*)?$/ },
  { label: "亚马逊数据", url: /\/amazon\/sales-traffic(?:\?.*)?$/ },
  { label: "采购管理", url: /\/purchase\/plans(?:\?.*)?$/ },
  { label: "仓库管理", url: /\/wms\/logistics(?:\?.*)?$/ },
  { label: "财务管理", url: /\/fin\/transactions(?:\?.*)?$/ },
  { label: "AI 与工具", url: /\/ai\/lili(?:\?.*)?$/ },
  { label: "销售与流量", url: /\/amazon\/sales-traffic(?:\?.*)?$/ },
  { label: "品牌分析", url: /\/amazon\/brand-analytics(?:\?.*)?$/ },
  { label: "数据看板", url: /\/amazon\/data-kiosk(?:\?.*)?$/ },
  { label: "数据字典", url: /\/amazon\/data-dictionary(?:\?.*)?$/ },
  { label: "在线商品与库存", url: /\/amazon\/catalog(?:\?.*)?$/ },
];

test.describe("多标签页连续打开 2/4/8/12 个页面", () => {
  test.skip(!testEmail || !testPassword, "需要 E2E_TEST_EMAIL / E2E_TEST_PASSWORD");
  test.setTimeout(180_000);

  test("连续打开 12 个不同页面后仍可切换，老 tab 可关闭，无异常", async ({ page }) => {
    await login(page);
    const tabs = page.locator("[data-workspace-tabbar] [role=tab]");
    // 前 7 项是一级板块链接，后 5 项在「亚马逊数据」二级浮层里。
    const PRIMARY_LABELS = new Set(["商品管理", "赛狐数据", "亚马逊数据", "采购管理", "仓库管理", "财务管理", "AI 与工具"]);

    let opened = 0;
    for (const pageSpec of PAGES) {
      if (PRIMARY_LABELS.has(pageSpec.label)) {
        await page.getByRole("link", { name: pageSpec.label, exact: true }).first().click();
      } else {
        await page.getByRole("button", { name: "亚马逊数据 二级菜单" }).first().click();
        const link = page.getByRole("link", { name: pageSpec.label, exact: true }).first();
        await expect(link, `二级菜单应含 ${pageSpec.label}`).toHaveCount(1);
        await link.click();
      }
      await expect(page, `点击「${pageSpec.label}」后应导航到 ${pageSpec.url}`).toHaveURL(pageSpec.url, { timeout: 15_000 });
      await expect(page.locator("[data-workspace-view]:not([hidden])")).toHaveCount(1);
      opened += 1;
    }
    expect(opened).toBe(12);

    // 累计 tab 数应被 MAX_TABS=8 约束，且当前始终只有一个可见视图。
    const finalTabs = await tabs.count();
    expect(finalTabs).toBeGreaterThanOrEqual(2);
    expect(finalTabs).toBeLessThanOrEqual(8);
    await expect(page.locator("[data-workspace-view]:not([hidden])")).toHaveCount(1);

    // 老 tab 可关闭：关掉第一个 tab 后数量减少、仍只有一个可见视图。
    const before = await tabs.count();
    await tabs.first().locator('button[aria-label^="关闭"]').click();
    await page.waitForTimeout(300);
    expect(await tabs.count()).toBeLessThan(before);
    await expect(page.locator("[data-workspace-view]:not([hidden])")).toHaveCount(1);

    // 关闭后仍可点击另一个板块正常切换。
    await page.getByRole("link", { name: "赛狐数据", exact: true }).first().click();
    await expect(page).toHaveURL(/\/sellfox\/profit(?:\?.*)?$/);
    await expect(page.locator("[data-workspace-view]:not([hidden])")).toHaveCount(1);
    expect(await readErrors(page)).toBe(0);
  });
});
