import { build } from 'esbuild';
import { test, expect } from '@playwright/test';
let bundle = '';
test.beforeAll(async () => { bundle = (await build({ entryPoints: ['tests/browser/management-port-harness.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic' })).outputFiles[0].text; });
test('real forms use authorized identities, save drafts and display conflicts without pretending execution', async ({ page }) => {
  const mutations: Record<string, unknown>[] = [];
  let status = 'DRAFT', revision = 1, fail = false;
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    expect(url.origin).toBe('http://127.0.0.1:43239');
    if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script src="/bundle.js"></script>' });
    if (url.pathname === '/api/products/catalogs') {
      expect(request.headers()['x-workspace-id']).toBe('fixture-workspace');
      return route.fulfill({ json: { catalogs: [{ id: 'brand-fixture', kind: 'BRAND', name: '隔离品牌', enabled: true }], suppliers: [], products: [{ id: 'part-fixture', sku: 'PART-FIXTURE', chineseName: '隔离子件' }], listingChoices: [{ sellerAccountId: 'seller-fixture', marketplaceId: 'SITE-FIXTURE', sellerName: '隔离授权店铺' }], truncated: false } });
    }
    if (url.pathname === '/api/integrations/amazon/ads/changes') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); mutations.push(body);
        if (fail) return route.fulfill({ status: 409, json: { error: '隔离版本冲突，请刷新' } });
        if (body.action === 'submit') { status = 'SUBMITTED'; revision++; }
        return route.fulfill({ json: { draft: { id: 'draft-fixture', revision, status }, executionEnabled: false } });
      }
      expect(url.searchParams.get('profileRecordId')).toBe('fixture-profile');
      return route.fulfill({ json: { drafts: mutations.length ? [{ id: 'draft-fixture', revision, status, reason: '隔离预算调整', before: { budget: '25' }, patch: { dailyBudget: '30.000001' }, expiresAt: '2026-11-13T00:00:00Z', availableActions: status === 'DRAFT' ? ['submit', 'cancel'] : ['cancel'] }] : [], history: [], page: 1, hasMore: false, editableFields: ['dailyBudget', 'state'], historyCoverage: 'OBSERVED_SNAPSHOT_CHANGES', historyRecordingEnabled: false, execution: { enabled: false } } });
    }
    throw Error('Unexpected request: ' + url.pathname);
  });
  await page.goto('http://127.0.0.1:43239/');
  await page.getByRole('button', { name: '添加刊登标识' }).click();
  await page.getByLabel('刊登店铺与站点').selectOption(JSON.stringify(['seller-fixture', 'SITE-FIXTURE']));
  await page.getByLabel('卖家 SKU', { exact: true }).fill('SELLER-FIXTURE');
  await page.getByLabel('FNSKU', { exact: true }).fill('X001FIXTURE');
  await expect(page.getByLabel('商品表单值')).toContainText('seller-fixture');
  await page.getByRole('button', { name: '添加子商品' }).click();
  await page.getByLabel('子商品', { exact: true }).selectOption('part-fixture');
  await page.getByLabel('组成用量').fill('2');
  await expect(page.getByLabel('商品表单值')).toContainText('"quantity":2');
  await page.getByRole('button', { name: '变更草稿与历史' }).click();
  await page.getByLabel('变更字段').selectOption('dailyBudget');
  await page.getByLabel('每日预算', { exact: true }).fill('30.000001');
  await page.getByLabel('变更原因').fill('隔离预算调整');
  await page.getByRole('button', { name: '保存变更草稿' }).click();
  await expect(page.getByText('已保存至 ERP；尚未执行到 Amazon。')).toBeVisible();
  expect(mutations[0].patch).toEqual({ dailyBudget: '30.000001' });
  await page.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(page.getByRole('heading', { name: '待审核 · 版本 2' })).toBeVisible();
  expect(mutations[1]).toMatchObject({ action: 'submit', id: 'draft-fixture', revision: 1 });
  fail = true;
  await page.getByRole('button', { name: '取消草稿', exact: true }).click();
  await expect(page.getByText('隔离版本冲突，请刷新')).toBeVisible();
  await expect(page.getByRole('heading', { name: '待审核 · 版本 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: '执行到 Amazon' })).toHaveCount(0);
});
