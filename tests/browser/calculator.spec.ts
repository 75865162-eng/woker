import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

test('输入商品参数即时测算，单位切换与手册可用，且不写入方案', async ({ page }) => {
  const result = await build({ entryPoints: ['tests/browser/calculator-harness.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
  let writes = 0;
  await page.route('http://127.0.0.1:43219/**', route => {
    const request = route.request();
    if (request.url().includes('/api/') && request.method() !== 'GET') writes++;
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/operations/ext') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
    }
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
  await page.goto('http://127.0.0.1:43219/');
  await page.addScriptTag({ content: result.outputFiles[0].text });
  await page.getByLabel('商品品类').selectOption('家居及厨房用品');
  await page.getByLabel('商品售价（USD）').fill('2');
  await page.getByLabel('实际单件重量（lb）').fill('2.2046226218');
  await page.getByLabel('包装长（in）').fill('1.5748031496');
  await page.getByLabel('包装宽（in）').fill('0.7874015748');
  await page.getByLabel('包装高（in）').fill('0.157480315');
  const shipping = page.locator('div').filter({ has: page.getByText('FBA 配送基础费', { exact: true }) }).filter({ hasText: '$5.47' });
  await expect(shipping.last()).toBeVisible();
  await page.getByRole('group', { name: '包装长单位（长宽高同步）' }).getByRole('button', { name: 'cm' }).click();
  expect(Number(await page.getByLabel('包装长（cm）').inputValue())).toBeCloseTo(4, 8);
  expect(Number(await page.getByLabel('包装宽（cm）').inputValue())).toBeCloseTo(2, 8);
  await expect(page.getByRole('heading', { name: '美国站 2026 · 完整费用手册' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存方案' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '已保存方案' })).toBeVisible();
  expect(writes).toBe(0);
});
