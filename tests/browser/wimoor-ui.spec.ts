import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
let bundle = '', styles = '';
const screenshotDir = 'docs/wimoor-integration/ui/screenshots';
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: ['tests/browser/wimoor-ui-harness.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } })).outputFiles[0].text;
  const [{ default: postcss }, { default: tailwind }] = await Promise.all([import('postcss'), import('@tailwindcss/postcss')]);
  styles = (await postcss([tailwind() as unknown as import('postcss').AcceptedPlugin]).process(await readFile('src/app/globals.css', 'utf8'), { from: 'src/app/globals.css' })).css;
  await mkdir(screenshotDir, { recursive: true });
});
function purchasePage<T extends { wmsReceiptIds?: string[]; number: string; status: string; supplier: { id: string; name: string }; lines: Array<{ product?: { sku: string } }> }>(orders: T[], url?: URL) {
  const query = url?.searchParams;
  const search = query?.get('search')?.toLowerCase() ?? '';
  const matched = orders.filter(order => (!query?.get('receiptId') || order.wmsReceiptIds?.includes(query.get('receiptId')!)) && (!query?.get('supplierId') || query.get('supplierId') === order.supplier.id) && (!search || [order.number, order.supplier.name, ...order.lines.map(line => line.product?.sku ?? '')].join(' ').toLowerCase().includes(search)));
  const statusCounts = Object.fromEntries(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'RECEIVING', 'CANCELLED'].map(status => [status, matched.filter(order => order.status === status).length]));
  const filtered = matched.filter(order => !query?.get('status') || query.get('status') === order.status);
  const page = Math.min(Number(query?.get('page') ?? 1), Math.max(1, Math.ceil(filtered.length / 20)));
  return { orders: filtered.slice((page - 1) * 20, page * 20), pagination: { page, pageSize: 20, total: filtered.length }, statusCounts };
}
function supplierPage<T extends { name: string; contactName: string; phone: string; email: string }>(suppliers: T[], url: URL) {
  const search = (url.searchParams.get('search') ?? '').toLowerCase();
  const matched = suppliers.filter(supplier => [supplier.name, supplier.contactName, supplier.phone, supplier.email].join(' ').toLowerCase().includes(search));
  const page = Math.min(Number(url.searchParams.get('page') ?? 1), Math.max(1, Math.ceil(matched.length / 20)));
  return { suppliers: matched.slice((page - 1) * 20, page * 20), pagination: { page, pageSize: 20, total: matched.length } };
}
async function setup(page: Page, query = '') {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const state = { denied: false, allowReceipt: false };
  const suppliers = Array.from({ length: 225 }, (_, i) => ({ id: 'supplier-' + i, name: 'Fixture 供应商 ' + String(i).padStart(2, '0'), contactName: '隔离联系人', phone: 'TEST-' + i, email: '', address: '隔离地址', notes: '' }));
  const orders = Array.from({ length: 24 }, (_, i) => ({ id: 'order-' + i, number: 'PO-FIXTURE-' + String(i).padStart(2, '0'), status: i % 2 ? 'ORDERED' : 'DRAFT', currency: 'CNY', expectedAt: null, notes: '', wmsReceiptIds: [] as string[], remainingQty: i + 1, canCreateReceipt: !!(i % 2), canCancel: true, revision: 1, updatedAt: '2026-11-11T00:00:00Z', supplier: suppliers[i], lines: [{ id: 'line-' + i, productRecordId: 'product-1', expectedQty: i + 1, receivedQty: 0, unitPrice: '12.340000', product: { sku: 'FIXTURE-SKU', chineseName: '隔离测试商品', englishName: '' } }] }));
  if (new URLSearchParams(query).get('receiptId') === 'source-fixture') orders[23].wmsReceiptIds = ['source-fixture'];
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    expect(url.origin).toBe('http://127.0.0.1:43229');
    if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'application/javascript', body: bundle });
    if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: styles });
    if (!url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    calls.push({ path: url.pathname + url.search, method: request.method(), body: request.method() === 'GET' ? null : request.postDataJSON() });
    if (state.denied) return route.fulfill({ status: 403, json: { error: '隔离测试：当前工作区禁止读取' } });
    if (url.pathname === '/api/operations/procurement') {
      if (state.allowReceipt && request.method() === 'PATCH' && request.postDataJSON().action === 'create-receipt') return route.fulfill({ json: { receipt: { id: 'receipt-fixture', number: 'RCV-FIXTURE' }, reused: false } });
      if (request.method() !== 'GET') return route.fulfill({ status: 403, json: { error: '隔离测试：保存被拒绝' } });
      if (url.searchParams.get("view") === "suppliers") return route.fulfill({ json: supplierPage(suppliers, url) });
      return route.fulfill({ json: { suppliers: suppliers.filter((supplier, index) => index < 200 || supplier.id === url.searchParams.get('supplierId')), ...purchasePage(orders, url), products: [{ productRecordId: 'product-1', sku: 'FIXTURE-SKU', chineseName: '隔离测试商品', englishName: '' }] } });
    }
    if (url.pathname === '/api/operations/sync-center') return route.fulfill({ json: { rows: [{ amazonOrderId: 'AMAZON-FIXTURE-ORDER', sellerAccountId: 'fixture-seller', sourceId: 'source-fixture', sourceRunId: 'task-fixture', marketplaceId: 'US', createdTime: '2026-11-10T00:00:00Z', sourceUpdatedAt: '2026-11-11T00:00:00Z', rawStatus: null, normalizedStatus: null, marketplaceTimeZone: 'America/Los_Angeles', detailsCurrent: false }], sources: [], pagination: { total: 1, pageCount: 1 } } });
    if (url.pathname === '/api/workspaces') return route.fulfill({ json: { workspaces: [{ id: 'fixture-workspace', name: '隔离工作区' }] } });
    if (url.pathname === '/api/operations/wms/locations') return route.fulfill({ json: { items: [{ id: 'receiving-fixture', warehouseId: 'warehouse-fixture', code: 'R-FIXTURE', kind: 'RECEIVING', enabled: true }], nextCursor: null } });
    if (url.pathname === '/api/operations/wms/reservations') return route.fulfill({ json: { items: [{ id: 'reservation-fixture', number: 'OUT-FIXTURE-01', balanceId: 'balance-fixture', requestedQty: 8, pickedQty: 3, unpickedQty: 5, dispatchedQty: 0, releasedQty: 0, remainingQty: 8, revision: 2, createdAt: '2026-11-12T02:00:00.000Z', workflowStatus: 'PARTIALLY_PICKED', stock: { warehouseId: 'warehouse-fixture', warehouseCode: 'WH-01', warehouseName: '隔离仓库', locationId: 'location-fixture', locationCode: 'A-01', locationFrozen: false, lotId: 'lot-fixture', lotCode: 'LOT-01', barcode: 'TEST-001' } }], nextCursor: null } });
    if (url.pathname.startsWith('/api/operations/wms/')) return route.fulfill({ json: { items: [], nextCursor: null } });
    throw new Error('Unexpected request ' + url.pathname);
  });
  await page.goto('http://127.0.0.1:43229/?' + query);
  return { calls, state, orders, suppliers };
}
test('补收入口复用采购操作，未读取数量不提供创建入口', async ({ page }) => {
  const { orders, calls, state } = await setup(page);
  orders[1].status = 'RECEIVING'; orders[1].remainingQty = 1; orders[1].canCreateReceipt = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'PO-FIXTURE-01', exact: true }) });
  await expect(page.getByRole('columnheader', { name: '可建收货数量' })).toBeVisible();
  await expect(row.getByRole('button', { name: '创建补收草稿', exact: true })).toBeVisible();
  await page.screenshot({ path: screenshotDir + '/procurement-supplement.png', fullPage: true });
  await row.getByRole('button', { name: '创建补收草稿', exact: true }).click();
  await row.getByLabel('选择收货库位').selectOption('receiving-fixture'); state.allowReceipt = true;
  await row.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByText(/已创建 WMS 收货草稿 RCV-FIXTURE/)).toBeVisible();
  expect(calls.find(call => call.method === 'PATCH')?.body).toMatchObject({ action: 'create-receipt', id: 'order-1', revision: 1 });
  await page.route('**/api/operations/procurement*', route => route.fulfill({ json: { suppliers: [], products: [], ...purchasePage([{ ...orders[1], remainingQty: null, canCreateReceipt: false }], new URL(route.request().url())) } }));
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(row.getByRole('cell', { name: '未读取', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: '创建补收草稿', exact: true })).toHaveCount(0);
  await page.screenshot({ path: screenshotDir + '/procurement-unread-allocation.png', fullPage: true });
});
test('采购列表分页、筛选、详情抽屉和拒绝保存', async ({ page }) => {
  const { calls } = await setup(page);
  await expect(page.getByRole('button', { name: 'PO-FIXTURE-00', exact: true })).toBeVisible();
  await expect(page.getByText('第 1 / 2 页', { exact: true })).toBeVisible();
  await page.screenshot({ path: screenshotDir + '/procurement-list.png', fullPage: true });
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('button', { name: 'PO-FIXTURE-20', exact: true })).toBeVisible();
  await page.getByLabel('搜索采购订单').fill('PO-FIXTURE-03');
  await expect(page.getByText('第 1 / 1 页', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'PO-FIXTURE-03', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '采购单详情', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('12.340000 CNY')).toBeVisible();
  await page.screenshot({ path: screenshotDir + '/procurement-detail.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '添加采购单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加采购单', exact: true });
  await dialog.getByLabel('采购单号', { exact: true }).fill('PO-ISOLATED');
  await dialog.getByLabel('供应商', { exact: true }).selectOption('supplier-0');
  await dialog.getByLabel('商品 SKU', { exact: true }).selectOption('product-1');
  await dialog.getByLabel('采购数量', { exact: true }).fill('2');
  await dialog.getByLabel('单价', { exact: true }).fill('12.340000');
  await dialog.getByRole('button', { name: '保存采购单草稿' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('隔离测试：保存被拒绝');
  expect(calls.find(call => call.method === 'POST')?.body).toMatchObject({ action: 'order', lines: [{ expectedQty: 2, unitPrice: '12.340000' }] });
});
test('采购草稿复用弹窗编辑，保存失败保留内容，新建不复用旧草稿', async ({ page }) => {
  const { calls } = await setup(page);
  const draftRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'PO-FIXTURE-00', exact: true }) });
  await draftRow.getByRole('button', { name: '编辑草稿', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑采购草稿', exact: true });
  await expect(dialog.getByLabel('采购单号', { exact: true })).toHaveValue('PO-FIXTURE-00');
  await dialog.getByLabel('采购数量', { exact: true }).fill('9');
  await dialog.getByLabel('单价', { exact: true }).fill('13.123456');
  await dialog.getByRole('button', { name: '保存草稿修改', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('隔离测试：保存被拒绝');
  await expect(dialog.getByLabel('采购数量', { exact: true })).toHaveValue('9');
  expect(calls.find(call => call.method === 'PATCH')?.body).toMatchObject({ action: 'edit-order', id: 'order-0', revision: 1, lines: [{ expectedQty: 9, unitPrice: '13.123456' }] });
  await page.screenshot({ path: screenshotDir + '/procurement-edit-draft.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '添加采购单', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('采购单号', { exact: true })).toHaveValue('');
});
test('编辑草稿保留首批选项之外的原供应商和商品', async ({ page }) => {
  const { orders } = await setup(page);
  await page.route('**/api/operations/procurement*', route => route.fulfill({ json: { suppliers: [], products: [], ...purchasePage([orders[0]], new URL(route.request().url())) } }));
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('button', { name: '编辑草稿', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑采购草稿', exact: true });
  await expect(dialog.getByLabel('供应商', { exact: true })).toHaveValue('supplier-0');
  await expect(dialog.getByLabel('商品 SKU', { exact: true })).toHaveValue('product-1');
  await expect(dialog.getByRole('button', { name: '保存草稿修改', exact: true })).toBeEnabled();
});
test('采购作废确认包含原因，失败可重试，已作废筛选无写入入口', async ({ page }) => {
  const { orders, calls } = await setup(page);
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'PO-FIXTURE-00', exact: true }) });
  await row.getByRole('button', { name: '作废采购单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '作废采购单', exact: true });
  await expect(dialog).toContainText('PO-FIXTURE-00');
  await expect(dialog.getByRole('button', { name: '确认作废', exact: true })).toBeDisabled();
  await dialog.getByLabel('作废原因').fill('供应商无法供货');
  await dialog.getByRole('button', { name: '确认作废', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('隔离测试：保存被拒绝');
  await expect(dialog.getByLabel('作废原因')).toHaveValue('供应商无法供货');
  expect(calls.find(call => call.method === 'PATCH')?.body).toMatchObject({ action: 'cancel-order', id: 'order-0', revision: 1, reason: '供应商无法供货' });
  await page.screenshot({ path: screenshotDir + '/procurement-cancel-order.png', fullPage: true });
  await page.route('**/api/operations/procurement*', route => {
    if (route.request().method() === 'PATCH') { orders[0].status = 'CANCELLED'; orders[0].canCreateReceipt = false; orders[0].canCancel = false; return route.fulfill({ json: { order: orders[0] } }); }
    return route.fulfill({ json: { suppliers: [], products: [], ...purchasePage(orders, new URL(route.request().url())) } });
  });
  await dialog.getByRole('button', { name: '确认作废', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('采购单已作废');
  await page.getByRole('tab', { name: '已作废 1', exact: true }).click();
  await expect(row).toContainText('已作废');
  await expect(row.getByRole('button')).toHaveCount(1);
});
test('采购服务端搜索覆盖第 100 条之外并丢弃旧筛选响应', async ({ page }) => {
  const { orders } = await setup(page);
  const old = { ...orders[0], id: 'older-order', number: 'PO-OLDER-105' };
  for (let index = 24; index < 105; index++) orders.push({ ...orders[0], id: 'extra-' + index, number: 'PO-EXTRA-' + index });
  orders.push(old);
  await page.getByLabel('搜索采购订单').fill('PO-OLDER-105');
  await expect(page.getByRole('button', { name: 'PO-OLDER-105', exact: true })).toBeVisible();
  await expect(page.getByText('第 1 / 1 页', { exact: true })).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/operations/procurement*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('search') !== 'old-request') return route.fallback();
    await pending;
    return route.fulfill({ json: { suppliers: [], products: [], ...purchasePage([old]) } });
  });
  const sent = page.waitForRequest(request => new URL(request.url()).searchParams.get('search') === 'old-request');
  await page.getByLabel('搜索采购订单').fill('old-request'); await sent;
  await page.getByLabel('搜索采购订单').fill('PO-FIXTURE-03');
  await expect(page.getByRole('button', { name: 'PO-FIXTURE-03', exact: true })).toBeVisible();
  const response = page.waitForResponse(result => new URL(result.url()).searchParams.get('search') === 'old-request');
  release(); await response;
  await expect(page.getByRole('button', { name: 'PO-OLDER-105', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'PO-FIXTURE-03', exact: true })).toBeVisible();
});
test('采购按明细选择分页搜索商品，拒绝读取不清除已选商品', async ({ page }) => {
  await setup(page);
  let denied = false;
  await page.route('**/api/products?**', route => {
    const url = new URL(route.request().url());
    expect(route.request().headers()['x-workspace-id']).toBe('fixture-workspace');
    if (denied) return route.fulfill({ status: 403, json: { error: 'Forbidden' } });
    const second = url.searchParams.get('page') === '2';
    return route.fulfill({ json: { products: [{ id: second ? 'remote-product' : 'first-product', sku: second ? 'REMOTE-SKU-501' : 'FIRST-SKU', chineseName: '隔离搜索商品', englishName: '' }], pagination: { page: second ? 2 : 1, pageCount: 2 } } });
  });
  await page.getByRole('button', { name: '添加采购单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加采购单', exact: true });
  await dialog.getByRole('button', { name: '添加商品明细', exact: true }).click();
  await dialog.getByRole('button', { name: '搜索更多商品', exact: true }).nth(1).click();
  const picker = dialog.getByRole('group', { name: '选择商品主档', exact: true });
  await picker.getByLabel('SKU／商品名称', { exact: true }).fill('REMOTE');
  await picker.getByRole('button', { name: '搜索商品', exact: true }).click();
  await picker.getByRole('button', { name: '下一页商品', exact: true }).click();
  await picker.getByRole('button', { name: '选择商品 REMOTE-SKU-501', exact: true }).click();
  await expect(dialog.getByLabel('商品 SKU', { exact: true }).nth(0)).toHaveValue('');
  await expect(dialog.getByLabel('商品 SKU', { exact: true }).nth(1)).toHaveValue('remote-product');
  await page.screenshot({ path: screenshotDir + '/procurement-product-selected.png', fullPage: true });
  await dialog.getByRole('button', { name: '搜索更多商品', exact: true }).nth(1).click();
  denied = true;
  await picker.getByLabel('SKU／商品名称', { exact: true }).fill('REMOTE');
  await picker.getByRole('button', { name: '搜索商品', exact: true }).click();
  await expect(picker.getByRole('alert')).toHaveText('当前账号没有商品读取权限，请联系管理员。');
  await expect(dialog.getByLabel('商品 SKU', { exact: true }).nth(1)).toHaveValue('remote-product');
  await page.screenshot({ path: screenshotDir + '/procurement-product-search.png', fullPage: true });
});
test('首批商品为空仍能搜索并选入采购单', async ({ page }) => {
  await setup(page);
  await page.route('**/api/operations/procurement*', route => route.fulfill({ json: { suppliers: [{ id: 'supplier-remote', name: 'Fixture supplier' }], products: [], ...purchasePage([]) } }));
  await page.route('**/api/products?**', route => route.fulfill({ json: { products: [{ id: 'remote-product', sku: 'REMOTE-SKU-501', chineseName: '隔离搜索商品', englishName: '' }], pagination: { pageCount: 1 } } }));
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('button', { name: '添加采购单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加采购单', exact: true });
  await expect(dialog.getByRole('button', { name: '保存采购单草稿', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '搜索更多商品', exact: true }).click();
  await dialog.getByLabel('SKU／商品名称', { exact: true }).fill('REMOTE');
  await dialog.getByRole('button', { name: '搜索商品', exact: true }).click();
  await dialog.getByRole('button', { name: '选择商品 REMOTE-SKU-501', exact: true }).click();
  await expect(dialog.getByLabel('商品 SKU', { exact: true })).toHaveValue('remote-product');
  await dialog.getByLabel('采购数量', { exact: true }).fill('1');
  await dialog.getByLabel('单价', { exact: true }).fill('1.25');
  await expect(dialog.getByRole('button', { name: '保存采购单草稿', exact: true })).toBeEnabled();
});
test('供应商统一入口、搜索、弹窗、刷新保持路由', async ({ page }) => {
  await setup(page, 'view=suppliers');
  await page.getByLabel('搜索供应商').fill('TEST-23');
  await expect(page.getByRole('cell', { name: 'Fixture 供应商 23', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑供应商' }).getByLabel('供应商名称')).toHaveValue('Fixture 供应商 23');
  await page.screenshot({ path: screenshotDir + '/supplier-dialog.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '采购订单', exact: true }).click();
  await expect(page).toHaveURL(/view=purchase-orders/);
  await page.reload();
  await expect(page.getByRole('tab', { name: '采购订单', exact: true })).toHaveAttribute('aria-selected', 'true');
});
test('只读权限禁用写入，403 清除业务行', async ({ page }) => {
  const { state } = await setup(page, 'readonly=1');
  await expect(page.getByRole('button', { name: '添加采购单', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '提交审批', exact: true }).first()).toBeDisabled();
  state.denied = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('隔离测试：当前工作区禁止读取');
  await expect(page.getByRole('button', { name: /PO-FIXTURE/ })).toHaveCount(0);
});
for (const view of ['expense-management']) test(view + ' 未接入布局不发业务请求', async ({ page }) => {
  const { calls } = await setup(page, 'view=' + view);
  await expect(page.getByRole('status')).toHaveText('后端未接入 · 布局预览');
  await page.getByRole('tab').nth(1).click();
  await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab')).toHaveCount(5);
  await expect(page.getByLabel('供应商', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('单号搜索', { exact: true })).toBeDisabled();
  await page.getByText('接入缺口与布局来源', { exact: true }).click();
  await page.screenshot({ path: 'docs/wimoor-integration/ui/2026-11-12/screenshots/' + view + '.png', fullPage: true });
  expect(calls).toEqual([]);
});
test('WMS 深链接、Tab 切换、刷新与后退', async ({ page }) => {
  const { orders } = await setup(page, 'wms=1&tab=receipts');
  orders[23].wmsReceiptIds = ['source-fixture'];
  await expect(page.getByRole('tab', { name: '收货单', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '库存余额', exact: true }).click();
  await expect(page).toHaveURL(/tab=balances/);
  await page.reload();
  await expect(page.getByRole('tab', { name: '库存余额', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page.getByRole('tab', { name: '收货单', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('WMS 出库预占列表打开真实响应详情抽屉', async ({ page }) => {
  await setup(page, 'wms=1&tab=reservations');
  const row = page.getByRole('row').filter({ hasText: 'OUT-FIXTURE-01' });
  await expect(row.getByText('部分已拣')).toBeVisible();
  await expect(row.getByText('WH-01 · 隔离仓库')).toBeVisible();
  await page.getByRole('button', { name: '查看预占单详情 OUT-FIXTURE-01' }).click();
  const dialog = page.getByRole('dialog', { name: '预占单详情 · OUT-FIXTURE-01' });
  await expect(dialog.getByText('OUT-FIXTURE-01', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('批次：LOT-01');
  await expect(dialog).toContainText('条码：TEST-001');
  await expect(dialog.locator('dd').first()).toHaveText('8');
  await page.screenshot({ path: screenshotDir + '/wms-reservation-detail.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});


test('采购工作区切换关闭详情并清除旧数据', async ({ page }) => {
  const { state } = await setup(page);
  await page.getByRole('button', { name: 'PO-FIXTURE-00', exact: true }).click();
  state.denied = true;
  await page.evaluate(() => { localStorage.setItem('amazon_bulk_ad_workspace_scope', JSON.stringify({ workspaceId: 'fixture-workspace-b' })); window.dispatchEvent(new Event('amazon-bulk-ad:workspace-scope-changed')); });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveText('隔离测试：当前工作区禁止读取');
  await expect(page.getByRole('button', { name: /PO-FIXTURE/ })).toHaveCount(0);
});
test('窄屏供应商和弹窗保持可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, 'view=suppliers');
  await page.getByRole('button', { name: '添加供应商', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const box = await page.getByRole('dialog').boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: screenshotDir + '/supplier-mobile.png', fullPage: true });
});

test('Amazon 订单详情保留缺失字段且链接订单商品', async ({ page }) => {
  await setup(page, 'orders=1');
  await page.getByRole('button', { name: 'AMAZON-FIXTURE-ORDER', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Amazon 订单详情', exact: true });
  await expect(dialog.getByText('未映射', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: '查看订单商品', exact: true })).toHaveAttribute('href', '/operations?view=order-items&amazonOrderId=AMAZON-FIXTURE-ORDER&sellerAccountId=fixture-seller&marketplaceId=US');
  await page.screenshot({ path: screenshotDir + '/amazon-order-detail.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('采购转收货调用单个事务接口并展示真实响应单号', async ({ page }) => {
  const { calls, state } = await setup(page);
  state.allowReceipt = true;
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'PO-FIXTURE-01', exact: true }) });
  await row.getByRole('button', { name: '创建收货草稿', exact: true }).click();
  await row.getByLabel('选择收货库位').selectOption('receiving-fixture');
  await row.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('RCV-FIXTURE');
  expect(calls.filter(call => call.method !== 'GET')).toEqual([{ path: '/api/operations/procurement', method: 'PATCH', body: { action: 'create-receipt', id: 'order-1', revision: 1, receivingLocationId: 'receiving-fixture' } }]);
});

test('采购收货库位加载后续页并保留选择', async ({ page }) => {
  await setup(page);
  await page.route('**/api/operations/wms/locations?**', route => {
    const later = new URL(route.request().url()).searchParams.has('cursor');
    return route.fulfill({ json: { items: later ? [{ id: 'later-receiving', code: 'LATER-R', kind: 'RECEIVING', enabled: true }] : [{ id: 'storage-only', code: 'S', kind: 'STORAGE', enabled: true }], nextCursor: later ? null : 'fixture-cursor' } });
  });
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'PO-FIXTURE-01', exact: true }) });
  await row.getByRole('button', { name: '创建收货草稿', exact: true }).click();
  await row.getByRole('button', { name: '加载更多收货库位', exact: true }).click();
  await row.getByLabel('选择收货库位').selectOption('later-receiving');
  await expect(row.getByRole('button', { name: '确认', exact: true })).toBeEnabled();
});

test('采购转收货失败保留单据和库位供重试', async ({ page }) => {
  await setup(page);
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'PO-FIXTURE-01', exact: true }) });
  await row.getByRole('button', { name: '创建收货草稿', exact: true }).click();
  await row.getByLabel('选择收货库位').selectOption('receiving-fixture');
  await row.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('隔离测试：保存被拒绝');
  await expect(row.getByLabel('选择收货库位')).toHaveValue('receiving-fixture');
  await expect(row.getByRole('button', { name: '确认', exact: true })).toBeEnabled();
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('工作区切换后忽略旧采购写入响应', async ({ page }) => {
  const { state, calls } = await setup(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/operations/procurement*', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    await pending;
    await route.fulfill({ json: { order: { status: 'ORDERED' } } });
  });
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'PO-FIXTURE-00', exact: true }) });
  const sent = page.waitForRequest(request => request.method() === 'PATCH');
  await row.getByRole('button', { name: '提交审批', exact: true }).click();
  await sent;
  state.denied = true;
  await page.evaluate(() => { localStorage.setItem('amazon_bulk_ad_workspace_scope', JSON.stringify({ workspaceId: 'fixture-other' })); window.dispatchEvent(new Event('amazon-bulk-ad:workspace-scope-changed')); });
  await expect(page.getByRole('alert')).toHaveText('隔离测试：当前工作区禁止读取');
  const before = calls.length;
  release();
  await page.waitForResponse(response => response.request().method() === 'PATCH');
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(calls).toHaveLength(before);
  await expect(page.getByRole('button', { name: /PO-FIXTURE/ })).toHaveCount(0);
});

async function setupProgress(page: Page) {
  await setup(page);
  await page.route('**/api/operations/procurement*', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { suppliers: [], products: [], ...purchasePage([{ id: 'progress-order', number: 'PO-PROGRESS', status: 'RECEIVING', currency: 'CNY', expectedAt: null, notes: '', revision: 3, updatedAt: '2026-11-11T00:00:00Z', supplier: { id: 'supplier-0', name: 'Fixture supplier' }, lines: [], wmsReceiptIds: ['progress-receipt'], remainingQty: 0, canCreateReceipt: false }], new URL(route.request().url())) } });
  });
  await page.reload();
}
test('采购详情展示实际收货阶段和数量，刷新失败清除旧进度', async ({ page }) => {
  await setupProgress(page);
  let denied = false;
  await page.route('**/api/operations/wms/receipts?**', route => route.fulfill(denied ? { status: 403, json: { error: 'Forbidden' } } : { json: { items: [{ id: 'progress-receipt', number: 'RCV-PROGRESS', status: 'RECEIVED', receivingLocationId: 'R', lines: [{ id: 'line-progress', lotId: 'lot-progress', expectedQty: 10, receivedQty: 8, acceptedQty: 5, rejectedQty: 1, returnedQty: 0, putawayQty: 3 }] }], nextCursor: null } }));
  await page.getByRole('button', { name: 'PO-PROGRESS', exact: true }).click();
  const progress = page.getByRole('region', { name: '采购收货进度' });
  await expect(progress).toContainText('RCV-PROGRESS · 待质检');
  await progress.getByText('查看收货明细', { exact: true }).click();
  await expect(progress.locator('[data-quantity="receivedQty"]')).toHaveText('8');
  await expect(progress.locator('[data-quantity="pendingQc"]')).toHaveText('2');
  await expect(progress.locator('[data-quantity="pendingPutaway"]')).toHaveText('2');
  await expect(progress.getByRole('link', { name: '处理此收货单' })).toHaveAttribute('href', '/logistics/warehouse?tab=receipts&receiptId=progress-receipt');
  denied = true;
  await progress.getByRole('button', { name: '刷新收货进度', exact: true }).click();
  await expect(progress.getByRole('alert')).toHaveText('当前账号没有仓库读取权限。');
  await expect(progress.getByText('RCV-PROGRESS · 待质检')).toHaveCount(0);
});
test('采购收货草稿不误报为短收异常', async ({ page }) => {
  await setupProgress(page);
  await page.route('**/api/operations/wms/receipts?**', route => route.fulfill({ json: { items: [{ id: 'progress-receipt', number: 'RCV-PROGRESS', status: 'DRAFT', receivingLocationId: 'R', lines: [{ id: 'line-progress', lotId: 'lot-progress', expectedQty: 10, receivedQty: 0, acceptedQty: 0, rejectedQty: 0, putawayQty: 0 }] }], nextCursor: null } }));
  await page.getByRole('button', { name: 'PO-PROGRESS', exact: true }).click();
  const progress = page.getByRole('region', { name: '采购收货进度' });
  await expect(progress).toContainText('RCV-PROGRESS · 待收货');
  await expect(progress.getByText(/收货异常：/)).toHaveCount(0);
});
test('全部收货草稿已取消时采购详情提供作废入口', async ({ page }) => {
  await setupProgress(page);
  await page.route('**/api/operations/procurement*', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    return route.fulfill({ json: { suppliers: [], products: [], ...purchasePage([{ id: 'progress-order', number: 'PO-PROGRESS', status: 'RECEIVING', currency: 'CNY', expectedAt: null, notes: '', revision: 4, updatedAt: '2026-11-11T00:00:00Z', supplier: { id: 'supplier-0', name: 'Fixture supplier' }, lines: [], wmsReceiptIds: ['progress-receipt'], remainingQty: 0, canCreateReceipt: false, canCancel: true }], url) } });
  });
  await page.reload();
  await page.getByRole('button', { name: 'PO-PROGRESS', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '采购单详情' }).getByRole('button', { name: '作废采购单', exact: true })).toBeVisible();
});
test('关联收货单不可读取时显示缺失而非零进度', async ({ page }) => {
  await setupProgress(page);
  await page.getByRole('button', { name: 'PO-PROGRESS', exact: true }).click();
  await expect(page.getByRole('region', { name: '采购收货进度' }).getByRole('alert')).toHaveText('关联收货单当前不可读取，请在仓库核对。');
});
test('收货单深链接刷新后保持筛选且离开时不污染其他查询', async ({ page }) => {
  const { calls } = await setup(page, 'wms=1&tab=receipts&receiptId=target-receipt');
  await expect(page.getByLabel('收货单 ID', { exact: true })).toHaveValue('target-receipt');
  await page.reload();
  await expect(page.getByLabel('收货单 ID', { exact: true })).toHaveValue('target-receipt');
  await page.getByRole('tab', { name: '库存余额', exact: true }).click();
  await expect(page).not.toHaveURL(/receiptId/);
  await page.goBack();
  await expect(page.getByLabel('收货单 ID', { exact: true })).toHaveValue('target-receipt');
  expect(calls.some(call => call.path.startsWith('/api/operations/wms/receipts'))).toBe(true);
});
test('采购来源异常筛选刷新和清除保持一致', async ({ page }) => {
  const { calls } = await setup(page, 'wms=1&tab=receipts&sourceReference=PO%20%26%20SHORT&workflowStatus=SHORT_RECEIVED');
  await expect(page.getByLabel('来源单号（精确）', { exact: true })).toHaveValue('PO & SHORT');
  await expect(page.getByLabel('收货作业', { exact: true })).toHaveValue('SHORT_RECEIVED');
  await expect.poll(() => calls.some(call => call.path.includes('sourceReference=PO') && call.path.includes('workflowStatus=SHORT_RECEIVED'))).toBe(true);
  await page.reload();
  await expect(page.getByLabel('来源单号（精确）', { exact: true })).toHaveValue('PO & SHORT');
  await page.getByRole('button', { name: '清除', exact: true }).click();
  await expect(page).not.toHaveURL(/sourceReference|workflowStatus/);
  await page.reload();
  await expect(page.getByLabel('来源单号（精确）', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('收货作业', { exact: true })).toHaveValue('');
});

test('超过200条供应商可查询选用、筛选，保存失败保留选项', async ({ page }) => {
  const { calls } = await setup(page, 'view=suppliers');
  await expect(page.getByText('第 1 / 12 页', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Fixture 供应商 20', exact: true })).toBeVisible();
  await page.getByLabel('搜索供应商', { exact: true }).fill('TEST-224');
  await expect(page.getByRole('cell', { name: 'Fixture 供应商 224', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toHaveCount(1);
  await page.getByRole('tab', { name: '采购订单', exact: true }).click();
  await page.getByRole('button', { name: '添加采购单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加采购单', exact: true });
  await expect(dialog.getByLabel('供应商', { exact: true }).locator('option[value="supplier-224"]')).toHaveCount(0);
  await dialog.getByRole('button', { name: '搜索更多供应商', exact: true }).click();
  const picker = dialog.getByRole('group', { name: '选择供应商档案', exact: true });
  await picker.getByLabel('查询供应商档案').fill('TEST-224');
  await picker.getByRole('button', { name: '查询供应商', exact: true }).click();
  await picker.getByRole('button', { name: '选择供应商 Fixture 供应商 224', exact: true }).click();
  await expect(dialog.getByLabel('供应商', { exact: true })).toHaveValue('supplier-224');
  await dialog.getByLabel('采购单号', { exact: true }).fill('PO-REMOTE-SUPPLIER');
  await dialog.getByLabel('商品 SKU', { exact: true }).selectOption('product-1');
  await dialog.getByLabel('采购数量', { exact: true }).fill('1');
  await dialog.getByLabel('单价', { exact: true }).fill('2.12');
  await dialog.getByRole('button', { name: '保存采购单草稿', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('隔离测试：保存被拒绝');
  await expect(dialog.getByLabel('供应商', { exact: true })).toHaveValue('supplier-224');
  expect(calls.find(call => call.method === 'POST')?.body).toMatchObject({ supplierId: 'supplier-224' });
  await page.screenshot({ path: screenshotDir + '/procurement-supplier-selected.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '查找供应商筛选', exact: true }).click();
  const filterPicker = page.getByRole('group', { name: '选择供应商档案', exact: true });
  await filterPicker.getByLabel('查询供应商档案').fill('TEST-224');
  await filterPicker.getByRole('button', { name: '查询供应商', exact: true }).click();
  await filterPicker.getByRole('button', { name: '选择供应商 Fixture 供应商 224', exact: true }).click();
  await expect(page.getByLabel('按供应商筛选')).toHaveValue('supplier-224');
  await expect(page.getByText('没有符合条件的采购单。', { exact: true })).toBeVisible();
});

test('供应商查询403清除结果且可重试，切换工作区关闭选择器', async ({ page }) => {
  const { state } = await setup(page);
  await page.getByRole('button', { name: '添加采购单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加采购单', exact: true });
  await dialog.getByRole('button', { name: '搜索更多供应商', exact: true }).click();
  const picker = dialog.getByRole('group', { name: '选择供应商档案', exact: true });
  await expect(picker.getByRole('button', { name: '选择供应商 Fixture 供应商 00', exact: true })).toBeVisible();
  state.denied = true;
  await picker.getByRole('button', { name: '查询供应商', exact: true }).click();
  await expect(picker.getByRole('alert')).toHaveText('隔离测试：当前工作区禁止读取');
  await expect(picker.getByRole('button', { name: /^选择供应商 / })).toHaveCount(0);
  state.denied = false;
  await picker.getByRole('button', { name: '查询供应商', exact: true }).click();
  await expect(picker.getByRole('button', { name: '选择供应商 Fixture 供应商 00', exact: true })).toBeVisible();
  await page.evaluate(() => { localStorage.setItem('amazon_bulk_ad_workspace_scope', JSON.stringify({ workspaceId: 'fixture-workspace-b' })); window.dispatchEvent(new Event('amazon-bulk-ad:workspace-scope-changed')); });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('group', { name: '选择供应商档案', exact: true })).toHaveCount(0);
});

test('采购明细备注、六位金额合计和重复商品校验贯穿表单与详情', async ({ page }) => {
  const { calls, orders } = await setup(page);
  await page.getByRole('button', { name: '添加采购单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加采购单', exact: true });
  await expect(dialog.getByLabel('采购金额合计')).toContainText('待填写完整有效明细');
  await dialog.getByLabel('采购单号', { exact: true }).fill('PO-AMOUNT');
  await dialog.getByLabel('供应商', { exact: true }).selectOption('supplier-0');
  await dialog.getByLabel('商品 SKU', { exact: true }).selectOption('product-1');
  await dialog.getByLabel('采购数量', { exact: true }).fill('3');
  await dialog.getByLabel('单价', { exact: true }).fill('0.100001');
  await dialog.getByLabel('商品备注', { exact: true }).fill('蓝色包装，按批次验收');
  await expect(dialog.getByLabel('采购金额合计')).toHaveText('采购金额合计：0.300003 CNY');
  await dialog.getByRole('button', { name: '添加商品明细', exact: true }).click();
  await expect(dialog.getByLabel('采购金额合计')).toContainText('待填写完整有效明细');
  await dialog.getByLabel('商品 SKU', { exact: true }).nth(1).selectOption('product-1');
  await dialog.getByLabel('采购数量', { exact: true }).nth(1).fill('7');
  await dialog.getByLabel('单价', { exact: true }).nth(1).fill('0.1');
  await expect(dialog.getByLabel('采购金额合计')).toHaveText('采购金额合计：1.000003 CNY');
  await expect(dialog.getByRole('alert')).toHaveText('同一商品不能重复，请合并采购数量。');
  await expect(dialog.getByRole('button', { name: '保存采购单草稿', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '移除', exact: true }).nth(1).click();
  await dialog.getByRole('button', { name: '保存采购单草稿', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('隔离测试：保存被拒绝');
  expect(calls.find(call => call.method === 'POST')?.body).toMatchObject({ lines: [{ notes: '蓝色包装，按批次验收', expectedQty: 3, unitPrice: '0.100001' }] });
  await expect(dialog.getByLabel('商品备注', { exact: true })).toHaveValue('蓝色包装，按批次验收');
  await page.keyboard.press('Escape');
  Object.assign(orders[0].lines[0], { notes: '蓝色包装，按批次验收', expectedQty: 3, unitPrice: '0.100001' });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('button', { name: 'PO-FIXTURE-00', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '采购单详情', exact: true });
  await expect(detail.getByRole('cell', { name: '蓝色包装，按批次验收', exact: true })).toBeVisible();
  await expect(detail.getByLabel('采购金额合计')).toHaveText('采购金额合计：0.300003 CNY');
  await page.screenshot({ path: screenshotDir + '/procurement-amount-notes.png', fullPage: true });
});

test('采购按商品分批建收货单，零数量跳过且失败保留输入', async ({ page }) => {
  const { orders, calls } = await setup(page);
  const order = { ...orders[1], remainingQty: 8, remainingLines: [{ productRecordId: 'product-1', expectedQty: 5 }, { productRecordId: 'product-2', expectedQty: 3 }], lines: [ { ...orders[1].lines[0], expectedQty: 5 }, { ...orders[1].lines[0], id: 'line-two', productRecordId: 'product-2', expectedQty: 3, product: { sku: 'SECOND-SKU', chineseName: '第二商品', englishName: '' } } ] };
  await page.route('**/api/operations/procurement*', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { suppliers: [], products: [], ...purchasePage([order]) } });
    calls.push({ path: '/api/operations/procurement', method: route.request().method(), body: route.request().postDataJSON() });
    return route.fulfill({ status: 409, json: { error: '本次计划数量已变化，请刷新核对' } });
  });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: order.number, exact: true }) });
  await row.getByRole('button', { name: '创建收货草稿', exact: true }).click();
  await expect(row.getByLabel('本次计划收货 FIXTURE-SKU', { exact: true })).toHaveValue('5');
  await row.getByLabel('选择收货库位').selectOption('receiving-fixture');
  await row.getByLabel('本次计划收货 FIXTURE-SKU', { exact: true }).fill('0');
  await row.getByLabel('本次计划收货 SECOND-SKU', { exact: true }).fill('0');
  await row.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('请填写本次计划收货数量；须为不超过可建数量的整数，0 表示本批不收。');
  expect(calls.filter(call => call.method === 'PATCH')).toHaveLength(0);
  await row.getByLabel('本次计划收货 FIXTURE-SKU', { exact: true }).fill('2');
  await row.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('本次计划数量已变化，请刷新核对');
  expect(calls.find(call => call.method === 'PATCH')?.body).toMatchObject({ action: 'create-receipt', lines: [{ productRecordId: 'product-1', expectedQty: 2 }] });
  await expect(row.getByLabel('本次计划收货 FIXTURE-SKU', { exact: true })).toHaveValue('2');
  await expect(row.getByLabel('本次计划收货 SECOND-SKU', { exact: true })).toHaveValue('0');
  await page.screenshot({ path: screenshotDir + '/procurement-partial-receipt.png', fullPage: true });
});

test('采购上架完成独立于采购状态，缺失权限不显示零进度', async ({ page }) => {
  const { orders } = await setup(page);
  const completed = { ...orders[1], status: 'RECEIVING', wmsReceiptIds: ['completed-fixture'], remainingQty: 0, canCreateReceipt: false, receiptSummary: { state: 'COMPLETED', plannedQty: 2, putawayQty: 2, receivedQty: 3, acceptedQty: 2, rejectedQty: 1, remainingToPutawayQty: 0, remainingQty: 0, activeReceipts: 0 } };
  await page.route('**/api/operations/wms/receipts?**', route => route.fulfill({ json: { items: [{ id: 'completed-fixture', number: 'RCV-COMPLETED', status: 'PUTAWAY', lines: [{ id: 'completed-line', lotId: 'completed-lot', expectedQty: 3, receivedQty: 3, acceptedQty: 2, rejectedQty: 1, putawayQty: 2 }] }] } }));
  let unreadable = false;
  await page.route('**/api/operations/procurement*', route => route.fulfill({ json: { suppliers: [], products: [], ...purchasePage([{ ...completed, receiptSummary: unreadable ? null : completed.receiptSummary }]) } }));
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: completed.number, exact: true }) });
  await expect(row.getByText('已全部上架', { exact: true })).toBeVisible();
  await expect(row.getByText('已上架 2 / 计划 2', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: '创建补收草稿', exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: completed.number, exact: true }).click();
  const summary = page.getByRole('region', { name: '采购收货汇总', exact: true });
  await expect(summary).toContainText('累计实收 3 · 累计合格 2 · 累计拒收 1');
  await expect(page.getByRole('region', { name: '采购收货进度', exact: true })).toContainText('RCV-COMPLETED · 已完成上架');
  await page.screenshot({ path: screenshotDir + '/procurement-completed-receipt.png', fullPage: true });
  await page.keyboard.press('Escape');
  unreadable = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(row.getByText('收货进度未读取', { exact: true })).toBeVisible();
  await expect(row.getByText('已全部上架', { exact: true })).toHaveCount(0);
});

test('收货回查按真实关联定位采购单，刷新、清除和Tab切换正确', async ({ page }) => {
  const { state } = await setup(page, 'view=purchase-orders&receiptId=source-fixture');
  const detail = page.getByRole('dialog', { name: '采购单详情', exact: true });
  await expect(detail).toContainText('PO-FIXTURE-23');
  await expect(page.locator('tbody').first().getByRole('row')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(detail).toContainText('PO-FIXTURE-23');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回全部采购单', exact: true }).click();
  await expect(page).not.toHaveURL(/receiptId=/);
  await expect(page.getByRole('button', { name: 'PO-FIXTURE-00', exact: true })).toBeVisible();
  await page.evaluate(() => { history.pushState(null, '', '?view=purchase-orders&receiptId=source-fixture'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(detail).toContainText('PO-FIXTURE-23');
  await page.evaluate(() => { localStorage.setItem('amazon_bulk_ad_workspace_scope', JSON.stringify({ workspaceId: 'source-other' })); window.dispatchEvent(new Event('amazon-bulk-ad:workspace-scope-changed')); });
  await expect(page).not.toHaveURL(/receiptId=/);
  await expect(detail).not.toBeVisible();
  state.denied = true;
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('隔离测试：当前工作区禁止读取');
  await expect(detail).not.toBeVisible();
  state.denied = false;
  await page.getByRole('tab', { name: '供应商档案', exact: true }).click();
  await expect(page).not.toHaveURL(/receiptId=/);
});

test('未关联的收货ID不回退到相同来源文本或全部采购单', async ({ page }) => {
  await setup(page, 'view=purchase-orders&receiptId=unlinked-fixture');
  await expect(page.getByText('没有符合条件的采购单。', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '采购单详情', exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: /^PO-FIXTURE/ })).toHaveCount(0);
});

test('仓库来源回查链接使用收货ID而非来源单号', async ({ page }) => {
  const { orders } = await setup(page, 'wms=1&tab=receipts');
  orders[23].wmsReceiptIds = ['source-fixture'];
  await page.route('**/api/operations/wms/receipts*', route => route.fulfill({ json: { items: [{ id: 'source-fixture', number: 'RCV-SOURCE', sourceReference: 'PO & SOURCE', status: 'PUTAWAY', revision: 1, lines: [] }], nextCursor: null } }));
  await page.getByRole('tab', { name: '收货单', exact: true }).click();
  await expect(page.getByRole('link', { name: '查询关联采购单', exact: true })).toHaveAttribute('href', '/operations?view=purchase-orders&receiptId=source-fixture');
  await page.screenshot({ path: screenshotDir + '/warehouse-purchase-source.png', fullPage: true });
  await page.getByRole('link', { name: '查询关联采购单', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '采购单详情', exact: true })).toContainText('PO-FIXTURE-23');
  await page.screenshot({ path: screenshotDir + '/procurement-source-receipt.png', fullPage: true });
});

test('供应商档案跳转采购记录，首批之外的筛选在刷新和前进后退时保留', async ({ page }) => {
  const { orders, suppliers, calls } = await setup(page, 'view=suppliers');
  orders[23].supplier = suppliers[224];
  await page.getByLabel('搜索供应商', { exact: true }).fill('TEST-224');
  await page.getByRole('button', { name: '查看采购记录', exact: true }).click();
  await expect(page).toHaveURL(/view=purchase-orders&supplierId=supplier-224/);
  await expect(page.getByLabel('按供应商筛选')).toHaveValue('supplier-224');
  await expect(page.getByRole('button', { name: 'PO-FIXTURE-23', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '采购订单 · 1', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('按供应商筛选')).toHaveValue('supplier-224');
  await expect(page.getByLabel('按供应商筛选').locator('option:checked')).toHaveText('Fixture 供应商 224');
  await expect(page.getByRole('button', { name: 'PO-FIXTURE-23', exact: true })).toBeVisible();
  await page.screenshot({ path: screenshotDir + '/supplier-purchase-records.png', fullPage: true });
  await page.getByLabel('按供应商筛选').selectOption('');
  await expect(page).not.toHaveURL(/supplierId=/);
  await expect(page.getByRole('heading', { name: '采购订单 · 24', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('按供应商筛选')).toHaveValue('supplier-224');
  await expect(page.getByRole('button', { name: 'PO-FIXTURE-23', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel('按供应商筛选')).toHaveValue('');
  await page.getByRole('tab', { name: '供应商档案', exact: true }).click();
  await expect(page).not.toHaveURL(/supplierId=/);
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});
test('无权或不存在的供应商筛选不回退为全部采购记录', async ({ page }) => {
  await setup(page, 'view=purchase-orders&supplierId=foreign-supplier');
  await expect(page.getByLabel('按供应商筛选')).toHaveValue('foreign-supplier');
  await expect(page.getByText('没有符合条件的采购单。')).toBeVisible();
  await expect(page.getByLabel('按供应商筛选').locator('option:checked')).toHaveText('供应商未读取（foreign-supplier）');
});

test('只读供应商仍可查询采购记录，切换工作区清除供应商来源', async ({ page }) => {
  const { calls } = await setup(page, 'view=suppliers&readonly=1');
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Fixture 供应商 00', exact: true }) });
  await expect(row.getByRole('button', { name: '编辑', exact: true })).toBeDisabled();
  await row.getByRole('button', { name: '查看采购记录', exact: true }).click();
  await expect(page.getByLabel('按供应商筛选')).toHaveValue('supplier-0');
  await expect(page.getByRole('button', { name: 'PO-FIXTURE-00', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加采购单', exact: true })).toBeDisabled();
  await page.evaluate(() => { localStorage.setItem('amazon_bulk_ad_workspace_scope', JSON.stringify({ workspaceId: 'supplier-other' })); window.dispatchEvent(new Event('amazon-bulk-ad:workspace-scope-changed')); });
  await expect(page).not.toHaveURL(/supplierId=/);
  await expect(page.getByLabel('按供应商筛选')).toHaveValue('');
  await expect(page.getByRole('heading', { name: '采购订单 · 24', exact: true })).toBeVisible();
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});

test('供应商直接新建采购草稿，失败保留内容，成功后进入该供应商采购记录', async ({ page }) => {
  const { calls, suppliers, orders } = await setup(page, 'view=suppliers');
  await page.getByLabel('搜索供应商').fill('TEST-224');
  await page.getByRole('button', { name: '新建采购单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加采购单', exact: true });
  await expect(dialog.getByLabel('供应商', { exact: true })).toHaveValue('supplier-224');
  await expect(dialog.getByLabel('采购单号', { exact: true })).toHaveValue('');
  await dialog.getByLabel('采购单号', { exact: true }).fill('PO-SUPPLIER-DIRECT');
  // The supplier view has no product options; the existing remote picker remains available.
  await expect(dialog.getByRole('button', { name: '搜索更多商品', exact: true })).toBeVisible();
  await page.route('**/api/products*', route => route.fulfill({ json: { products: [{ id: 'product-1', sku: 'FIXTURE-SKU', chineseName: '隔离测试商品' }], pagination: { total: 1, page: 1, pageSize: 20, pageCount: 1 } } }));
  await dialog.getByRole('button', { name: '搜索更多商品', exact: true }).click();
  await dialog.getByLabel('SKU／商品名称', { exact: true }).fill('FIXTURE-SKU');
  await dialog.getByRole('button', { name: '搜索商品', exact: true }).click();
  await dialog.getByRole('button', { name: '选择商品 FIXTURE-SKU', exact: true }).click();
  await dialog.getByLabel('采购数量', { exact: true }).fill('2');
  await dialog.getByLabel('单价', { exact: true }).fill('12.345678');
  await dialog.getByRole('button', { name: '保存采购单草稿', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('隔离测试：保存被拒绝');
  await expect(dialog.getByLabel('供应商', { exact: true })).toHaveValue('supplier-224');
  await expect(dialog.getByLabel('采购数量', { exact: true })).toHaveValue('2');
  expect(calls.find(call => call.method === 'POST')?.body).toMatchObject({ action: 'order', supplierId: 'supplier-224' });
  await page.route('**/api/operations/procurement*', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const order = { ...orders[0], id: 'direct-order', number: 'PO-SUPPLIER-DIRECT', supplier: suppliers[224] };
    orders.push(order);
    await route.fulfill({ status: 201, json: { order } });
  });
  await dialog.getByRole('button', { name: '保存采购单草稿', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/view=purchase-orders&supplierId=supplier-224/);
  await expect(page.getByRole('button', { name: 'PO-SUPPLIER-DIRECT', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加采购单', exact: true }).click();
  await expect(dialog.getByLabel('供应商', { exact: true })).toHaveValue('supplier-224');
  await expect(dialog.getByLabel('采购单号', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('采购数量', { exact: true })).toHaveValue('');
  await page.screenshot({ path: screenshotDir + '/supplier-create-purchase.png', fullPage: true });
});
test('供应商新建采购操作遵循创建权限，切换工作区关闭草稿', async ({ page }) => {
  await setup(page, 'view=suppliers&readonly=1');
  await expect(page.getByRole('button', { name: '新建采购单', exact: true }).first()).toBeDisabled();
  await setup(page, 'view=suppliers');
  await page.getByRole('button', { name: '新建采购单', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: '添加采购单', exact: true })).toBeVisible();
  await page.evaluate(() => { localStorage.setItem('amazon_bulk_ad_workspace_scope', JSON.stringify({ workspaceId: 'direct-other' })); window.dispatchEvent(new Event('amazon-bulk-ad:workspace-scope-changed')); });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('采购状态筛选包含审批中和待申请人下单，保持服务端筛选', async ({ page }) => {
  const { orders, calls } = await setup(page);
  orders[0].status = 'PENDING_APPROVAL'; orders[1].status = 'APPROVED';
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('tab', { name: '待审批 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'PO-FIXTURE-00', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PO-FIXTURE-01', exact: true })).toHaveCount(0);
  await expect.poll(() => calls.at(-1)?.path).toContain('status=PENDING_APPROVAL');
  await page.getByLabel('按状态筛选').selectOption('APPROVED');
  await expect(page.getByRole('button', { name: 'PO-FIXTURE-01', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '审批通过·待下单 1', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => calls.at(-1)?.path).toContain('status=APPROVED');
});

test('供应商弹窗支持选中确认，取消不修改采购单选择', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '添加采购单', exact: true }).click();
  const order = page.getByRole('dialog', { name: '添加采购单', exact: true });
  await order.getByRole('button', { name: '搜索更多供应商', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择供应商', exact: true });
  await expect(picker.getByRole('button', { name: '确认供应商', exact: true })).toBeDisabled();
  await picker.getByLabel('选中供应商 Fixture 供应商 02', { exact: true }).check();
  await page.screenshot({ path: screenshotDir + '/supplier-choice-dialog-fixture.png', fullPage: true });
  await picker.getByRole('button', { name: '确认供应商', exact: true }).click();
  await expect(order.getByLabel('供应商', { exact: true })).toHaveValue('supplier-2');
  await order.getByRole('button', { name: '搜索更多供应商', exact: true }).click();
  await picker.getByLabel('选中供应商 Fixture 供应商 03', { exact: true }).check();
  await picker.getByRole('button', { name: '取消选择', exact: true }).click();
  await expect(order.getByLabel('供应商', { exact: true })).toHaveValue('supplier-2');
});

test('采购到货卡片详情沿用关联收货单，读取失败关闭旧记录', async ({ page }) => {
  await setupProgress(page);
  let denied = false;
  await page.route('**/api/operations/wms/receipts?**', route => route.fulfill(denied ? { status: 403, json: { error: 'Forbidden' } } : { json: { items: [{ id: 'progress-receipt', number: 'RCV-PROGRESS', status: 'RECEIVED', receivingLocationId: 'R', lines: [{ id: 'line-progress', lotId: 'lot-progress', expectedQty: 10, receivedQty: 8, acceptedQty: 5, rejectedQty: 1, returnedQty: 0, putawayQty: 3 }] }], nextCursor: null } }));
  await page.getByRole('button', { name: 'PO-PROGRESS', exact: true }).click();
  const progress = page.getByRole('region', { name: '采购收货进度', exact: true });
  await progress.getByRole('button', { name: '到货记录详情', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '采购到货记录详情', exact: true });
  await expect(detail).toContainText('RCV-PROGRESS');
  await detail.getByText('查看收货明细', { exact: true }).click();
  await expect(detail.locator('[data-quantity="receivedQty"]')).toHaveText('8');
  await expect(detail.getByRole('link', { name: '在仓库处理此收货单' })).toHaveAttribute('href', '/logistics/warehouse?tab=receipts&receiptId=progress-receipt');
  await page.screenshot({ path: screenshotDir + '/purchase-arrival-detail-fixture.png', fullPage: true });
  await page.keyboard.press('Escape');
  denied = true;
  await progress.getByRole('button', { name: '刷新收货进度', exact: true }).click();
  await expect(progress.getByRole('button', { name: '到货记录详情', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '采购到货记录详情', exact: true })).not.toBeVisible();
});
