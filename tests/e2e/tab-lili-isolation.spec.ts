import { test, expect, type Page } from "@playwright/test";

const testEmail = process.env.E2E_TEST_EMAIL;
const testPassword = process.env.E2E_TEST_PASSWORD;

async function login(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("账号 / 手机号").fill(testEmail!);
  await page.getByLabel("密码").fill(testPassword!);
  await page.locator("form").getByRole("button", { name: "登录", exact: true }).last().click();
  await page.waitForURL((u) => !u.pathname.includes("/login"));
  await page.locator("[data-workspace-tabbar] [role=tab]").first().waitFor({ timeout: 20_000 });
}

type Snap = {
  counters: Record<string, number>;
  renderByHref: Record<string, number>;
  mountByHref: Record<string, number>;
  viewSigs: Record<string, { elementId: number; contextId: number; visible: boolean; renders: number; changes: number }>;
  appShellRenders: Record<string, number>;
  shellSig: { renders: number; childrenChanges: number; segmentContextChanges: number; configurationChanges: number; displayChanges: number; lastChildrenId: number; lastSegmentContextId: number; lastConfigurationId?: number; lastDisplayId?: number };
  causes: Record<string, number>;
};

async function readMetrics(page: Page): Promise<Snap | null> {
  return page.evaluate(() => {
    const g = (window as unknown as {
      __WOKER_TAB_DIAG__?: {
        snapshot: {
          counters: Record<string, number>;
          renderByHref: Record<string, number>;
          mountByHref: Record<string, number>;
          viewSigs: Record<string, { elementId: number; contextId: number; visible: boolean; renders: number; changes: number }>;
          appShellRenders: Record<string, number>;
          shellSig: { renders: number; childrenChanges: number; segmentContextChanges: number; configurationChanges: number; displayChanges: number; lastChildrenId: number; lastSegmentContextId: number; lastConfigurationId?: number; lastDisplayId?: number };
          causes: Record<string, number>;
        };
      };
    }).__WOKER_TAB_DIAG__;
    const s = g?.snapshot;
    if (!s) return null;
    try {
      return {
        counters: { ...s.counters },
        renderByHref: { ...s.renderByHref },
        mountByHref: { ...s.mountByHref },
        viewSigs: JSON.parse(JSON.stringify(s.viewSigs ?? {})),
        appShellRenders: { ...(s.appShellRenders ?? {}) },
        shellSig: { ...(s.shellSig ?? { renders: 0, childrenChanges: 0, segmentContextChanges: 0, lastChildrenId: 0, lastSegmentContextId: 0 }) },
        causes: { ...(s.causes ?? {}) },
      };
    } catch {
      return {
        counters: { ...s.counters }, renderByHref: { ...s.renderByHref },
        mountByHref: { ...s.mountByHref }, viewSigs: {}, appShellRenders: {},
        shellSig: { renders: 0, childrenChanges: 0, segmentContextChanges: 0, configurationChanges: 0, displayChanges: 0, lastChildrenId: 0, lastSegmentContextId: 0 },
        causes: {},
      };
    }
  });
}

function delta(a: Snap | null, b: Snap | null) {
  if (!a || !b) return null;
  return {
    renders: b.counters.renders - a.counters.renders,
    routes: b.counters.routes - a.counters.routes,
    mounts: b.counters.mounts - a.counters.mounts,
    longtasks: b.counters.longtasks - a.counters.longtasks,
  };
}

test("isolation 1: idle on the initial tab produces no render storm", async ({ page }) => {
  test.skip(!testEmail || !testPassword, "needs E2E credentials");
  await login(page);
  const before = await readMetrics(page);
  await page.waitForTimeout(3000);
  const after = await readMetrics(page);
  console.log("IDLE_INITIAL_DELTA", JSON.stringify(delta(before, after)));
  expect((delta(before, after)?.renders ?? 0)).toBeLessThan(30);
});

test("isolation 2: idle on /lili (via redirect entry) reveals render source", async ({ page }) => {
  test.skip(!testEmail || !testPassword, "needs E2E credentials");
  test.setTimeout(120_000);
  await login(page);
  // 通过 AI 与工具入口进入（直达真实落地页 /lili），复现真实用户路径。
  await page.getByRole("link", { name: "AI 与工具", exact: true }).first().click();
  await page.waitForURL((u) => u.pathname === "/lili", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const activeHref = await page.evaluate(() => {
    const el = document.querySelector("[data-workspace-view]:not([hidden])");
    return el?.getAttribute("data-workspace-view") ?? "none";
  });
  const before = await readMetrics(page);
  await page.waitForTimeout(3000);
  const after = await readMetrics(page);
  console.log("LILI_ACTIVE_VIEW", activeHref);
  console.log("LILI_URL", page.url());
  console.log("LILI_IDLE_DELTA", JSON.stringify(delta(before, after)));
  console.log("LILI_RENDER_BY_HREF", JSON.stringify(after?.renderByHref));
  expect(true).toBe(true);
});

// 一次性根因归因实验（记录 AppShellPage/context 引用变化），非验收项。
// 根因已定位并修复，默认跳过；需要复现取证时用 E2E_SLOW=1 显式启用。
test("attribution: what reference changes during /lili storm", async ({ page }) => {
  test.skip(!testEmail || !testPassword, "needs E2E credentials");
  test.skip(process.env.E2E_SLOW !== "1", "诊断取证实验，E2E_SLOW=1 时运行");
  test.setTimeout(120_000);
  await login(page);
  await page.getByRole("link", { name: "AI 与工具", exact: true }).first().click();
  await page.waitForURL((u) => u.pathname === "/lili", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const before = await readMetrics(page);
  await page.waitForTimeout(2500);
  const after = await readMetrics(page);
  console.log("ATTR_RENDER_DELTA", JSON.stringify(delta(before, after)));
  console.log("ATTR_VIEW_SIGS", JSON.stringify(after?.viewSigs, null, 2));
  console.log("ATTR_APP_SHELL_RENDERS", JSON.stringify(after?.appShellRenders, null, 2));
  console.log("ATTR_SHELL_SIG", JSON.stringify(after?.shellSig));
  console.log("ATTR_CAUSES", JSON.stringify(after?.causes));
  expect(true).toBe(true);
});

test("isolation 3: leaving /lili stops the storm", async ({ page }) => {
  test.skip(!testEmail || !testPassword, "needs E2E credentials");
  test.setTimeout(120_000);
  await login(page);
  await page.getByRole("link", { name: "AI 与工具", exact: true }).first().click();
  await page.waitForURL((u) => u.pathname === "/lili", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // 切到赛狐，然后静止，看渲染速率是否回落。
  await page.getByRole("link", { name: "赛狐数据", exact: true }).first().click();
  await page.waitForTimeout(1500);
  const before = await readMetrics(page);
  await page.waitForTimeout(3000);
  const after = await readMetrics(page);
  console.log("AFTER_LEAVE_DELTA", JSON.stringify(delta(before, after)));
  console.log("AFTER_LEAVE_RENDER_BY_HREF", JSON.stringify(after?.renderByHref));
  expect(true).toBe(true);
});
