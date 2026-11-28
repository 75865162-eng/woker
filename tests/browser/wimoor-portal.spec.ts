import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

let bundle = '', styles = '';
test.beforeAll(async () => {
  bundle = (await build({
    entryPoints: ['tests/browser/wimoor-portal-harness.tsx'],
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', charset: 'utf8',
    define: { 'process.env': '{"NODE_ENV":"development"}' },
  })).outputFiles[0].text;
  const [{ default: postcss }, { default: tailwind }] = await Promise.all([import('postcss'), import('@tailwindcss/postcss')]);
  styles = (await postcss([tailwind() as unknown as import('postcss').AcceptedPlugin])
    .process(await readFile('src/app/globals.css', 'utf8'), { from: 'src/app/globals.css' })).css;
});

async function setup(page: Page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: bundle });
    if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css; charset=utf-8', body: styles });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto('http://127.0.0.1:43231/');
}

test('门户页按原版树形渲染：左侧模块栏 + 右侧抽屉子菜单，不再平铺网格', async ({ page }) => {
  await setup(page);
  const portal = page.locator('[data-wimoor-portal="1"]');
  await expect(portal).toBeVisible();
  // 左侧 10 个一级模块
  const modules = page.locator('[data-module-id]');
  expect(await modules.count()).toBe(10);
  // 默认选中「产品」，右侧显示其二级分组
  await expect(page.locator('[data-module-id="产品"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-testid="portal-groups"] [data-group]').first()).toBeVisible();
  // 入口是链接而非平铺卡片墙（分组体在抽屉内）
  await expect(page.locator('[data-group-body] a').first()).toBeVisible();
  await page.screenshot({ path: 'docs/wimoor-integration/ui/screenshots/portal-tree-original.png', fullPage: false });
});

test('点击一级模块即展开对应抽屉（点击即下拉）', async ({ page }) => {
  await setup(page);
  await page.locator('[data-module-id="采购"]').click();
  await expect(page.locator('[data-module-id="采购"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-module-id="产品"]')).toHaveAttribute('aria-expanded', 'false');
  // 采购的 3 个二级分组出现
  const groups = await page.locator('[data-testid="portal-groups"] [data-group-header]').allTextContents();
  expect(groups.join('|')).toContain('采购管理');
  expect(groups.join('|')).toContain('采购报表');
});

test('二级分组点击即折叠/展开（原版 handleExpend）', async ({ page }) => {
  await setup(page);
  const header = page.locator('[data-group-header]').first();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
});

test('搜索按原版逻辑实时过滤并跨模块自动展开命中分组', async ({ page }) => {
  await setup(page);
  const search = page.getByLabel('搜索页面');
  await search.fill('库存报表');
  await page.waitForTimeout(200);
  const count = await page.locator('[data-testid="portal-match-count"]').textContent();
  expect(count).toContain('命中');
  // 命中项被高亮
  await expect(page.locator('mark').first()).toBeVisible();
  // 命中的入口可见（库存报表在仓库/报表组）
  const entryTexts = await page.locator('[data-group-body] a, [data-group-body] div[data-entry-id]').allTextContents();
  expect(entryTexts.join('|')).toContain('库存报表');
  await page.screenshot({ path: 'docs/wimoor-integration/ui/screenshots/portal-search-filter.png', fullPage: false });
});

test('入口链接保留真实 localHref 可跳转', async ({ page }) => {
  await setup(page);
  const firstLink = page.locator('[data-group-body] a').first();
  const href = await firstLink.getAttribute('href');
  expect(href).toMatch(/^\/wimoor\//);
});
