import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

let bundle = '', styles = '';
test.beforeAll(async () => {
  bundle = (await build({
    entryPoints: ['tests/browser/wimoor-feature-layout-harness.tsx'],
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', charset: 'utf8',
    define: { 'process.env': '{"NODE_ENV":"development"}' },
  })).outputFiles[0].text;
  const [{ default: postcss }, { default: tailwind }] = await Promise.all([import('postcss'), import('@tailwindcss/postcss')]);
  styles = (await postcss([tailwind() as unknown as import('postcss').AcceptedPlugin])
    .process(await readFile('src/app/globals.css', 'utf8'), { from: 'src/app/globals.css' })).css;
});

async function setup(page: Page, query = '') {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: bundle });
    if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css; charset=utf-8', body: styles });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto('http://127.0.0.1:43231/' + query);
}

test('功能面板按原版分区布局：页签→工具栏→筛选区→折叠列字段，默认展开', async ({ page }) => {
  await setup(page, '?account=1');
  const panel = page.locator('[data-wimoor-feature-panel="1"]');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-wimoor-layout', 'original');
  // 有 bridge → 默认展开
  await expect(panel.locator('[data-testid="wimoor-feature-search-bar"]')).toBeVisible();
  // 分区顺序：页面标签 < 工具栏(下拉动作) < 筛选区 < 表格列字段
  const labels = await panel.locator('.text-label.font-semibold').allTextContents();
  const joined = labels.join('|');
  const iTab = joined.indexOf('页面标签');
  const iDrop = joined.indexOf('下拉动作');
  const iFilter = joined.indexOf('筛选字段');
  const iCol = joined.indexOf('表格列字段');
  expect(iTab).toBeGreaterThanOrEqual(0);
  expect(iTab).toBeLessThan(iDrop);
  expect(iDrop).toBeLessThan(iFilter);
  expect(iFilter).toBeLessThan(iCol);
  await page.screenshot({ path: 'docs/wimoor-integration/ui/screenshots/feature-layout-zones.png', fullPage: true });
});

test('下拉动作点击即展开菜单', async ({ page }) => {
  await setup(page, '?account=1');
  const panel = page.locator('[data-wimoor-feature-panel="1"]');
  const trigger = panel.getByRole('button', { name: '展开下拉动作' });
  await expect(trigger).toBeVisible();
  await trigger.click();
  // Popover 展开后可见菜单项
  await expect(page.getByText('原版下拉菜单')).toBeVisible();
  await page.screenshot({ path: 'docs/wimoor-integration/ui/screenshots/feature-layout-dropdown.png', fullPage: false });
});

test('下拉筛选字段选项来自本页真实数据（非伪造「指定XX」）', async ({ page }) => {
  await setup(page);
  const panel = page.locator('[data-wimoor-feature-panel="1"]');
  // 仓库字段（全部仓库）的选项应为真实仓库名
  const warehouseSelect = panel.locator('select[aria-label="全部仓库"]');
  const opts = await warehouseSelect.locator('option').allTextContents();
  expect(opts.join('|')).toContain('美国西部仓');
  expect(opts.join('|')).toContain('美国东部仓');
  expect(opts.join('|')).not.toContain('指定');
});

test('面板搜索字段真实驱动表格过滤（3行→1行）', async ({ page }) => {
  await setup(page);
  const table = page.getByRole('table', { name: '库存报表验收表' });
  await expect(table.locator('tbody tr')).toHaveCount(3);
  const panel = page.locator('[data-wimoor-feature-panel="1"]');
  // 在 SKU 文本字段输入并点搜索
  const skuInput = panel.locator('input[aria-label="请输入SKU"]');
  await skuInput.fill('SKU-BETA');
  await panel.locator('button.bg-brand', { hasText: '搜索' }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByTestId('active-filters')).toHaveAttribute('data-value', /SKU-BETA/);
  await page.screenshot({ path: 'docs/wimoor-integration/ui/screenshots/feature-layout-filter.png', fullPage: true });
});

test('重置清除所有面板筛选，表格恢复', async ({ page }) => {
  await setup(page);
  const table = page.getByRole('table', { name: '库存报表验收表' });
  const panel = page.locator('[data-wimoor-feature-panel="1"]');
  await panel.locator('input[aria-label="请输入SKU"]').fill('SKU-ALPHA');
  await panel.locator('button.bg-brand', { hasText: '搜索' }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await panel.locator('button.bg-surface:not(.bg-brand)', { hasText: '重置' }).first().click();
  await expect(table.locator('tbody tr')).toHaveCount(3);
});
