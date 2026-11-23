import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
let bundle = '', styles = '';
const screenshotDir = 'docs/wimoor-integration/ui/2026-11-12/screenshots';
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: ['tests/browser/wimoor-port-harness.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env': '{"NODE_ENV":"development"}' }, plugins: [{ name: 'isolated-next-navigation', setup(builder) { builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' })); builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export function useSearchParams(){return new URLSearchParams(window.location.search)}' })); } }] })).outputFiles[0].text;
  const [{ default: postcss }, { default: tailwind }] = await Promise.all([import('postcss'), import('@tailwindcss/postcss')]);
  styles = (await postcss([tailwind() as unknown as import('postcss').AcceptedPlugin]).process(await readFile('src/app/globals.css', 'utf8'), { from: 'src/app/globals.css' })).css;
  await mkdir(screenshotDir, { recursive: true });
});
async function setup(page: Page, query = '') {
  page.on('pageerror', error => console.error('PORT FIXTURE:', error.stack));
  const calls: Array<{ url: URL; method: string; body?: Record<string, unknown>; workspace: string | undefined }> = [];
  const state = { denied: false, failSave: false, packing: null as null | { boxes: unknown[] } };
  const plan = { id: 'fixture-plan', number: 'FIXTURE-PLAN-01', status: 'DRAFT', createdBy: 'fixture-user', revision: 7, customsDeclarations: [], shipments: [], fees: [], packing: state.packing, forwarderOrder: query.includes('transport=1') ? { id: 'fixture-forwarder', number: 'FIXTURE-TRANSPORT-01', forwarder: '隔离货代', channel: '隔离渠道', mode: 'OCEAN', status: 'BOOKED', destination: '隔离目的地址', containerNumber: 'FIXTURE-CONTAINER', billOfLading: 'FIXTURE-BILL', vesselOrFlight: null, cutoffAt: null, departureEta: null, arrivalEta: null, _count: { events: 1 }, events: [{ id: 'fixture-event', occurredAt: '2026-11-12T00:00:00Z', eventType: 'NOTE', location: '隔离节点', evidence: 'FIXTURE-EVIDENCE' }] } : null, costAllocation: null, stockReady: false,
    fulfillment: { plannedQty: 3, dispatchedQty: 0, releasedQty: 0, reservedQty: 0, unreservedQty: 3, unpickedQty: 0, pickedQty: 0, stage: 'NEEDS_RESERVATION' },
    lines: [{ id: 'fixture-line', quantity: 3, stock: { warehouseCode: 'FIXTURE-WH', warehouseName: '隔离仓', locationCode: 'A-01', lotCode: 'LOT-TEST', barcode: null }, balance: { revision: 2 }, reservation: null, approval: null, progress: { status: 'NEEDS_RESERVATION', reservedQty: 0, unpickedQty: 0, pickedQty: 0, dispatchedQty: 0, releasedQty: 0 } }] };
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    expect(url.origin).toBe('http://127.0.0.1:43229');
    if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: styles });
    if (!url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    const body = request.method() === 'POST' ? request.postDataJSON() : undefined;
    calls.push({ url, method: request.method(), body, workspace: request.headers()['x-workspace-id'] });
    if (state.denied) return route.fulfill({ status: 403, json: { error: '隔离测试：读取权限已撤回' } });
    if (url.pathname === '/api/operations/sync-center') return route.fulfill({ json: { sources: [{ id: 'fixture-source', sellerAccountId: 'fixture-seller', marketplaceId: 'SITE', seller: { displayName: '隔离店铺' } }] } });
    if (url.pathname === '/api/operations/fba-local-plans') {
      if (request.method() === 'POST') {
        if (state.failSave) return route.fulfill({ status: 409, json: { error: '隔离测试：计划版本冲突' } });
        state.packing = body.packing; return route.fulfill({ json: { item: { id: plan.id } } });
      }
      return route.fulfill({ json: { items: url.searchParams.get('page') === '2' ? [] : [{ ...plan, packing: state.packing }], hasMore: url.searchParams.get('page') !== '2' } });
    }
    throw Error('Unexpected fixture request ' + url.pathname);
  });
  await page.goto('http://127.0.0.1:43229/operations?view=fba-boxing' + query);
  return { calls, state };
}
async function chooseSite(page: Page) {
  await page.getByLabel('店铺', { exact: true }).selectOption('fixture-seller');
  await page.getByLabel('站点', { exact: true }).selectOption('SITE');
  await expect(page.getByRole('table', { name: '本地计划装箱列表' })).toBeVisible();
}
test('装箱入口使用现有 API，详情与保存保留 revision，刷新及翻页沿用范围', async ({ page }) => {
  const { calls, state } = await setup(page);
  await chooseSite(page);
  await page.screenshot({ path: screenshotDir + '/fba-packing-list.png', fullPage: true });
  await page.getByRole('button', { name: '装箱详情', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '本地计划与装箱详情', exact: true });
  await expect(drawer.getByText('FIXTURE-PLAN-01', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: '填写装箱资料', exact: true }).click();
  const form = page.getByRole('form', { name: '本地装箱资料', exact: true });
  for (const [label, value] of [['箱号', 'FIXTURE-BOX'], ['长（厘米）', '30'], ['宽（厘米）', '20'], ['高（厘米）', '10'], ['毛重（千克）', '2']]) await form.getByLabel('第1箱' + label, { exact: true }).fill(value);
  await form.getByLabel('第1箱明细1数量', { exact: true }).fill('3');
  await page.screenshot({ path: screenshotDir + '/fba-packing-form.png', fullPage: true });
  state.failSave = true;
  await form.getByRole('button', { name: '保存装箱资料', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('版本冲突');
  await expect(form.getByLabel('第1箱箱号', { exact: true })).toHaveValue('FIXTURE-BOX');
  state.failSave = false;
  await form.getByRole('button', { name: '保存装箱资料', exact: true }).click();
  await expect(drawer.getByLabel('计划装箱资料')).toContainText('已保存 1 箱');
  await page.screenshot({ path: screenshotDir + '/fba-packing-detail.png', fullPage: true });
  expect(calls.find(call => call.method === 'POST')?.body).toMatchObject({ action: 'SAVE_PACKING', id: 'fixture-plan', expectedRevision: 7 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '下一页计划', exact: true }).click();
  await expect.poll(() => calls.filter(call => call.url.pathname.includes('fba-local-plans')).at(-1)?.url.searchParams.get('page')).toBe('2');
  await page.reload(); await chooseSite(page);
  await expect(page.getByRole('table')).toContainText('1 箱 · 本地已保存');
  expect(calls.every(call => call.workspace === 'fixture-workspace')).toBe(true);
  expect(calls.filter(call => call.url.pathname.includes('fba-local-plans') && call.method === 'GET').every(call => call.url.searchParams.get('sellerAccountId') === 'fixture-seller' && call.url.searchParams.get('marketplaceId') === 'SITE')).toBe(true);
});
test('只读与撤权时不出现假成功；工作区切换清除装箱详情', async ({ page }) => {
  const { state } = await setup(page, '&readonly=1'); await chooseSite(page);
  await page.getByRole('button', { name: '装箱详情', exact: true }).click();
  await expect(page.getByRole('button', { name: '填写装箱资料', exact: true })).toHaveCount(0);
  await page.evaluate(() => { localStorage.setItem('amazon_bulk_ad_workspace_scope', JSON.stringify({ workspaceId: 'other-fixture' })); window.dispatchEvent(new Event('amazon-bulk-ad:workspace-scope-changed')); });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await chooseSite(page);
  state.denied = true;
  await page.getByRole('button', { name: '刷新计划', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('读取权限已撤回');
  await expect(page.getByRole('button', { name: '装箱详情', exact: true })).toHaveCount(0);
});
test('菜单复用实际入口和权限过滤，可搜索、关闭并返回焦点', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '打开业务菜单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '业务菜单', exact: true });
  await expect(dialog.getByRole('link', { name: '账号权限', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Amazon 账号与站点', exact: true })).toHaveAttribute('href', '/operations?view=connections');
  await expect(dialog.getByRole('link', { name: 'FBA 装箱', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: screenshotDir + '/business-navigation.png', fullPage: true });
  await dialog.getByLabel('搜索业务入口').fill('采购');
  await expect(dialog.getByRole('link', { name: '采购订单', exact: true })).toHaveAttribute('href', '/operations?view=purchase-orders');
  await expect(dialog.getByRole('link', { name: 'FBA 装箱', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '打开业务菜单', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '打开业务菜单', exact: true }).click();
  await expect(dialog.getByLabel('搜索业务入口')).toHaveValue('');
});

async function setupEvidence(page: Page, mode: string) {
  const calls: URL[] = [], state = { denied: false };
  const stamp = '2026-11-12T00:00:00Z';
  const source = { id: 'fixture-source', sellerAccountId: 'fixture-seller', marketplaceId: 'SITE', seller: { displayName: '隔离店铺' }, lastSuccessAt: stamp, resourceCursor: { status: 'SUCCEEDED' }, coverage: {} };
  const document = { reportId: 'REPORT-FIXTURE', reportCreatedAt: stamp, businessDateField: 'posted-date', rowCount: 1, capturedAt: stamp, publishedAt: stamp, sourceRunId: 'fixture-run' };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe('http://127.0.0.1:43229');
    if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: styles });
    if (!url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    expect(route.request().method()).toBe('GET');
    expect(url.pathname).toBe('/api/operations/sync-center');
    calls.push(url);
    if (state.denied) return route.fulfill({ status: 403, json: { error: '隔离测试：读取权限已撤回' } });
    const kind = url.searchParams.get('kind');
    const facts = kind === 'INBOUND_PLAN' ? { inboundPlanId: 'PLAN-FIXTURE', name: '隔离入库计划', sourceStatus: 'ACTIVE', sourceCreatedAt: stamp, sourceUpdatedAt: stamp } : kind === 'INBOUND_SHIPMENT' ? { inboundPlanId: 'PLAN-FIXTURE', shipmentId: 'SHIP-FIXTURE', name: '隔离货件', sourceStatus: 'WORKING', destinationWarehouseId: 'WH-FIXTURE' } : kind === 'LISTING_DETAIL' ? { summaries: [{ itemName: '隔离商品', brand: 'Fixture' }], attributes: { bullet_point: [{ value: '测试要点' }] }, relationships: [], missing: null } : { inboundPlanId: 'PLAN-FIXTURE', shipmentId: 'SHIP-FIXTURE', sellerSku: 'SKU-FIXTURE', asin: 'B000000001', fnsku: 'FN-FIXTURE', declaredQuantity: '9007199254740993', quantitySemantics: 'SHIPMENT_DECLARED', receivedQuantity: null };
    const rows = url.searchParams.get('page') === '2' ? [] : [{ id: 'fixture-row', sourceRunId: 'fixture-run', kind, sellerSku: 'SKU-FIXTURE', asin: 'B000000001', searchTerm: null, facts, capturedAt: stamp }];
    return route.fulfill({ json: { source, sources: [source], run: { id: 'fixture-run', finishedAt: stamp }, versions: [{ id: 'fixture-run', finishedAt: stamp }], rows: url.searchParams.get('section') === 'domain-reports' ? [{ id: 'report-row', reportId: document.reportId, rowNumber: 12, businessDate: '2026-11-11', businessDateRaw: null, orderId: 'ORDER-FIXTURE', sellerSku: 'SKU-FIXTURE', asin: 'B000000001', transactionType: 'Order', amountType: 'ItemPrice', amountDescription: 'Principal', amountOriginal: '12345678901234567890.123456', currencyCode: 'USD', quantityOriginal: '1', fields: url.searchParams.get('resource') === 'inventory_age' ? { 'available': '0', 'inv-age-0-to-90-days': '9007199254740993', 'inv-age-61-to-90-days': '7', 'fnsku': 'FN-AGE' } : url.searchParams.get('resource') === 'inventory_events' ? { 'event-type': 'Adjustments', 'reference-id': 'EVENT-FIXTURE', 'quantity': '-2', 'reconciled-quantity': '0', 'unreconciled-quantity': '-2', 'fulfillment-center': 'WH-FIXTURE' } : url.searchParams.get('resource') === 'reimbursements' ? { 'reimbursement-id': 'REIMB-FIXTURE', 'reason': 'Lost_Warehouse', 'amount-total': '12345678901234567890.123456', 'quantity-reimbursed-cash': '1', 'quantity-reimbursed-inventory': '0' } : { 'amount': '12345678901234567890.123456', 'posted-date': '2026-11-11', 'transaction-type': 'Order' }, document }] : rows, documents: [document], pagination: { total: 51, pageCount: 2 }, dateMeaning: '业务日期，非采集日期', amountMeaning: '原始币种金额，不跨币种相加' } });
  });
  await page.goto('http://127.0.0.1:43229/operations?' + mode);
  return { calls, state };
}
test('FBA 观察从计划逐级查看货件和商品，保留来源版本与精确原值', async ({ page }) => {
  const { calls, state } = await setupEvidence(page, 'observations=fulfillment');
  const table = page.getByRole('table', { name: '已发布观察记录' });
  await expect(table).toContainText('隔离入库计划');
  await expect(table.locator('[data-amazon-status=ACTIVE]')).toContainText('ACTIVE');
  await page.screenshot({ path: screenshotDir + '/fba-observation-list-fixture.png', fullPage: true });
  await table.getByRole('button', { name: '查看货件', exact: true }).click();
  await expect(table).toContainText('WH-FIXTURE');
  await expect(table.locator('[data-amazon-status=WORKING]')).toContainText('WORKING');
  expect(calls.at(-1)?.searchParams.get('inboundPlanId')).toBe('PLAN-FIXTURE');
  await table.getByRole('button', { name: '货件商品', exact: true }).click();
  await expect(table).toContainText('9007199254740993');
  expect(calls.at(-1)?.searchParams.get('shipmentId')).toBe('SHIP-FIXTURE');
  await table.getByRole('button', { name: '查看详情', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'FBA 观察详情', exact: true });
  await expect(drawer).toContainText('未返回（null）');
  await drawer.getByLabel('查找字段').fill('declaredQuantity');
  await expect(drawer.getByRole('definition').filter({ hasText: '9007199254740993' })).toHaveCount(1);
  await drawer.getByRole('button', { name: '查看来源任务', exact: true }).click();
  await page.screenshot({ path: screenshotDir + '/fba-observation-detail.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('所选来源任务')).toHaveText('fixture-run');
  await page.getByRole('button', { name: '返回全部计划', exact: true }).click();
  await expect(table).toContainText('隔离入库计划');
  expect(calls.at(-1)?.searchParams.get('shipmentId')).toBe('');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(table.getByRole('button', { name: '查看详情' })).toHaveCount(0);
  expect(calls.at(-1)?.searchParams.get('page')).toBe('2');
  state.denied = true;
  await page.getByRole('button', { name: '刷新列表', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('读取权限已撤回');
  await expect(table).toHaveCount(0);
  expect(calls.every(url => url.searchParams.get('sellerAccountId') === 'fixture-seller' && url.searchParams.get('marketplaceId') === 'SITE')).toBe(true);
});
test('商品观察详情保留实际属性，筛选和版本继续使用原接口', async ({ page }) => {
  const { calls } = await setupEvidence(page, 'observations=listing_details');
  await page.getByRole('button', { name: '查看详情', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '商品与业务观察详情' });
  await expect(drawer).toContainText('测试要点');
  await page.screenshot({ path: screenshotDir + '/listing-observation-detail.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByLabel('观察版本').selectOption('fixture-run');
  await page.getByLabel('SKU', { exact: true }).fill('SKU-SEARCH');
  await expect.poll(() => calls.at(-1)?.searchParams.get('sellerSku')).toBe('SKU-SEARCH');
  expect(calls.at(-1)?.searchParams.get('runId')).toBe('fixture-run');
  await expect(drawer).not.toBeVisible();
});
test('结算报告选账期、读原始行、分页，撤权后清空旧报告', async ({ page }) => {
  const { calls, state } = await setupEvidence(page, 'reports=settlements');
  await page.getByRole('table', { name: '报告与来源任务' }).getByRole('button', { name: 'REPORT-FIXTURE', exact: true }).click();
  await expect(page.getByText('当前报告：REPORT-FIXTURE', { exact: true })).toBeVisible();
  expect(calls.at(-1)?.searchParams.get('reportId')).toBe('REPORT-FIXTURE');
  const table = page.getByRole('table', { name: '已发布报告明细' });
  await table.getByRole('button', { name: '查看明细' }).click();
  const drawer = page.getByRole('dialog', { name: '结算明细', exact: true });
  await expect(drawer).toContainText('12345678901234567890.123456');
  await expect(drawer).toContainText('posted-date');
  await drawer.getByRole('button', { name: '查看来源任务' }).click();
  await page.screenshot({ path: screenshotDir + '/settlement-row-detail.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('所选来源任务')).toHaveText('fixture-run');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => calls.at(-1)?.searchParams.get('page')).toBe('2');
  await page.getByRole('button', { name: '查看全部报告' }).click();
  await expect.poll(() => calls.at(-1)?.searchParams.get('page')).toBe('1');
  expect(calls.at(-1)?.searchParams.get('reportId')).toBe('');
  state.denied = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('读取权限已撤回');
  await expect(table).toHaveCount(0);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(calls.every(url => url.searchParams.get('sellerAccountId') === 'fixture-seller' && url.searchParams.get('marketplaceId') === 'SITE')).toBe(true);
});

test('库龄使用来源分桶而非财务列，缺失不补零且保留重叠桶', async ({ page }) => {
  await setupEvidence(page, 'reports=inventory_age');
  const table = page.getByRole('table', { name: '已发布报告明细' });
  await expect(table.getByRole('columnheader', { name: '61–90 天', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: '9007199254740993', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: '0', exact: true })).toHaveCount(1);
  await expect(table.getByRole('cell', { name: '—', exact: true })).toHaveCount(1);
  await expect(table.getByRole('columnheader', { name: '金额（原值）', exact: true })).toHaveCount(0);
  await page.screenshot({ path: screenshotDir + '/inventory-age.png', fullPage: true });
});
test('库存事件显示事件、仓库和正负数量，不推断余额或已获赔', async ({ page }) => {
  await setupEvidence(page, 'reports=inventory_events');
  const table = page.getByRole('table', { name: '已发布报告明细' });
  await expect(table).toContainText('EVENT-FIXTURE');
  await expect(table).toContainText('WH-FIXTURE');
  await expect(table.getByRole('cell', { name: '-2', exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: '申请库存事件采集', exact: true })).toBeDisabled();
});
test('赔偿明细区分现金与库存数量并保留精确原币金额', async ({ page }) => {
  await setupEvidence(page, 'reports=reimbursements');
  const table = page.getByRole('table', { name: '已发布报告明细' });
  await expect(table).toContainText('REIMB-FIXTURE');
  await expect(table).toContainText('Lost_Warehouse');
  await expect(table.getByRole('columnheader', { name: '库存赔偿数量', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: '12345678901234567890.123456', exact: true })).toBeVisible();
  await page.screenshot({ path: screenshotDir + '/reimbursements.png', fullPage: true });
});

async function setupTransactions(page: Page, workbench: string) {
  const calls: URL[] = [], state = { denied: false };
  const stamp = '2026-11-12T00:00:00Z';
  const source = { id: 'fixture-source', sellerAccountId: 'fixture-seller', marketplaceId: 'SITE', seller: { displayName: '隔离店铺' }, enabled: true, resourceCursor: null };
  const order = { amazonOrderId: 'ORDER-FIXTURE', sourceId: source.id, sourceRunId: 'fixture-run', sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, createdTime: stamp, sourceUpdatedAt: stamp, capturedAt: stamp, detailsUpdatedAt: stamp, detailsCurrent: true, rawStatus: 'SHIPPED', normalizedStatus: null, marketplaceTimeZone: 'UTC', grandTotalOriginal: '12345678901234567890.123456', currencyCode: 'USD', items: [{ orderItemId: 'ITEM-FIXTURE', asin: 'B000000001', sellerSku: 'SKU-FIXTURE', quantityOrdered: 3, proceedsOriginal: null, currencyCode: null }] };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe('http://127.0.0.1:43229');
    if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: styles });
    if (!url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    expect(route.request().method()).toBe('GET'); calls.push(url);
    if (state.denied) return route.fulfill({ status: 403, json: { error: '隔离测试：读取权限已撤回' } });
    const pagination = { total: 21, page: Number(url.searchParams.get('page') || '1'), pageSize: 20, pageCount: 2 };
    if (url.pathname.endsWith('/freshness')) return route.fulfill({ json: { connection: { status: 'NOT_CONFIGURED', runtimeConfiguration: { configured: false, missingEnvironmentVariables: [] }, enabledDomains: [] }, inventory: { status: 'NOT_SYNCED', capturedAt: null, snapshotCount: 0 }, domains: { inventory: {} }, runs: [] } });
    if (url.pathname.endsWith('/inventory/snapshots')) return route.fulfill({ json: { rows: url.searchParams.get('page') === '2' ? [] : [{ id: 'inventory-fixture', sellerAccountId: source.sellerAccountId, marketplaceId: 'SITE', syncRunId: 'inventory-run', sellerSku: 'SKU-FIXTURE', asin: 'B000000001', fnSku: 'FN-FIXTURE', condition: 'New', fulfillableQuantity: 0, inboundWorkingQuantity: 1, inboundShippedQuantity: 2, inboundReceivingQuantity: 3, reservedQuantity: 4, unfulfillableQuantity: 5, capturedAt: stamp }], pagination, snapshot: { status: 'FRESH', capturedAt: stamp, syncRunId: 'inventory-run' } } });
    expect(url.pathname).toBe('/api/operations/sync-center');
    const section = url.searchParams.get('section');
    if (section === 'sources') return route.fulfill({ json: { sources: [source], access: { canCreate: false, canEdit: false, canConfigure: false } } });
    if (section === 'orders') return route.fulfill({ json: { sources: [source], rows: url.searchParams.get('page') === '2' ? [] : [order], pagination } });
    if (section === 'finance') return route.fulfill({ json: { sources: [source], rows: [{ transactionId: 'TRANSACTION-FIXTURE', sourceId: source.id, sellerAccountId: source.sellerAccountId, sourceRunId: 'fixture-run', marketplaceId: 'SITE', postedAt: stamp, transactionType: 'Shipment', rawStatus: 'DEFERRED', orderId: order.amazonOrderId, classification: 'ORDER_RELATED', originalAmount: '12345678901234567890.123456', currency: 'USD', convertedAmount: null, convertedCurrency: null, conversionStatus: 'UNCONVERTED', marketplaceTimeZone: 'UTC', capturedAt: stamp, fxEvidence: { rate: '7.123456789012345678', source: 'fixture' } }], pagination, quarantinedCount: 0, unconvertedCount: 1 } });
    throw Error('Unexpected fixture section ' + section);
  });
  await page.goto('http://127.0.0.1:43229/operations?workbench=' + workbench);
  return { calls, state };
}
test('财务详情保留原币和汇率依据，关联订单与商品跳转保持店铺站点并可刷新', async ({ page }) => {
  const { calls } = await setupTransactions(page, 'finance');
  await page.getByRole('button', { name: '交易详情', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '财务交易详情', exact: true });
  await expect(dialog).toContainText('12345678901234567890.123456');
  await expect(dialog).toContainText('7.123456789012345678');
  await expect(dialog).toContainText('未配置有效汇率');
  await page.screenshot({ path: screenshotDir + '/finance-transaction-detail.png', fullPage: true });
  await dialog.getByRole('link', { name: '查看关联订单' }).click();
  await expect(page.getByLabel('订单 ID', { exact: true })).toHaveValue('ORDER-FIXTURE');
  await expect(page.getByRole('button', { name: 'ORDER-FIXTURE', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'ORDER-FIXTURE', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Amazon 订单详情' });
  await dialog.getByRole('link', { name: '查看订单商品' }).click();
  await expect(page.getByRole('table', { name: '订单商品明细' })).toContainText('SKU-FIXTURE');
  await expect(page.getByLabel('订单 ID', { exact: true })).toHaveValue('ORDER-FIXTURE');
  const queries = calls.filter(url => url.searchParams.get('section') === 'orders');
  expect(queries.length).toBeGreaterThan(2);
  expect(queries.every(url => url.searchParams.get('sellerAccountId') === 'fixture-seller' && url.searchParams.get('marketplaceId') === 'SITE' && url.searchParams.get('amazonOrderId') === 'ORDER-FIXTURE')).toBe(true);
});
test('订单商品详情与来源、列设置、分页及撤权保持一致', async ({ page }) => {
  const { calls, state } = await setupTransactions(page, 'order-items');
  await page.getByRole('button', { name: '商品明细', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '订单商品详情' });
  await expect(drawer).toContainText('ITEM-FIXTURE');
  await expect(drawer).toContainText('未返回');
  await expect(drawer.getByRole('link', { name: '查看在线商品' })).toHaveAttribute('href', '/operations?view=catalog&sku=SKU-FIXTURE&sellerAccountId=fixture-seller&marketplaceId=SITE');
  await page.screenshot({ path: screenshotDir + '/order-item-detail.png', fullPage: true });
  await drawer.getByRole('button', { name: '查看来源任务' }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByLabel('所选来源任务')).toHaveText('fixture-run');
  await page.getByText('列设置', { exact: true }).click();
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.uncheck();
  await expect(page.getByRole('button', { name: '商品明细', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => calls.at(-1)?.searchParams.get('page')).toBe('2');
  await expect(page.getByRole('button', { name: '商品明细', exact: true })).toHaveCount(0);
  state.denied = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('读取权限已撤回');
  await expect(page.getByRole('table', { name: '订单商品明细' })).toHaveCount(0);
});
test('财务状态筛选与重置沿用查询，来源任务关闭详情，403 清空记录', async ({ page }) => {
  const { calls, state } = await setupTransactions(page, 'finance');
  await page.getByLabel('原始状态', { exact: true }).fill('DEFERRED');
  await expect.poll(() => calls.at(-1)?.searchParams.get('rawStatus')).toBe('DEFERRED');
  await page.getByRole('button', { name: '交易详情' }).click();
  await page.getByRole('button', { name: '查看来源任务' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByLabel('所选来源任务')).toHaveText('fixture-run');
  await page.getByRole('button', { name: '重置筛选', exact: true }).click();
  await expect.poll(() => calls.at(-1)?.searchParams.get('rawStatus')).toBe('');
  state.denied = true;
  await page.getByRole('button', { name: '刷新财务' }).click();
  await expect(page.getByRole('alert')).toContainText('读取权限已撤回');
  await expect(page.getByRole('button', { name: '交易详情' })).toHaveCount(0);
});
test('库存详情区分三个入库阶段，翻页、刷新失败和工作区切换清除旧记录', async ({ page }) => {
  const { state } = await setupTransactions(page, 'inventory');
  await page.getByRole('button', { name: '库存详情', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Amazon 库存详情', exact: true });
  for (const label of ['入库待发货', '入库已发货', '入库接收中']) await expect(drawer.getByText(label, { exact: true })).toBeVisible();
  await expect(drawer).toContainText('inventory-run');
  await expect(drawer.getByRole('link', { name: '查看在线商品' })).toHaveAttribute('href', '/operations?view=catalog&sku=SKU-FIXTURE&sellerAccountId=fixture-seller&marketplaceId=SITE');
  await page.screenshot({ path: screenshotDir + '/inventory-snapshot-detail.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '下一页库存', exact: true }).click();
  await expect(page.getByRole('button', { name: '库存详情', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '上一页库存', exact: true }).click();
  await page.getByRole('button', { name: '库存详情', exact: true }).click();
  state.denied = true;
  await page.evaluate(() => { localStorage.setItem('amazon_bulk_ad_workspace_scope', JSON.stringify({ workspaceId: 'other-fixture' })); window.dispatchEvent(new Event('amazon-bulk-ad:workspace-scope-changed')); });
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('alert')).toContainText('读取权限已撤回');
  await expect(page.getByRole('button', { name: '库存详情', exact: true })).toHaveCount(0);
});

test('本地发货单据列表复用计划接口，货代详情展示真实字段与轨迹', async ({ page }) => {
  const { calls } = await setup(page, '&transport=1');
  await page.goto('http://127.0.0.1:43229/operations?view=first-mile&transport=1');
  await page.getByLabel('店铺', { exact: true }).selectOption('fixture-seller');
  await page.getByLabel('站点', { exact: true }).selectOption('SITE');
  await page.getByRole('button', { name: '单据列表', exact: true }).click();
  const table = page.getByRole('table', { name: '本地发货计划列表', exact: true });
  await expect(table).toContainText('FIXTURE-BILL');
  await expect(table).toContainText('隔离货代');
  await table.getByRole('button', { name: '发货详情', exact: true }).click();
  const plan = page.getByRole('dialog', { name: '本地计划与装箱详情', exact: true });
  await plan.getByRole('button', { name: '运输详情', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '货代运输详情', exact: true });
  await expect(detail.getByLabel('运输单据信息')).toContainText('FIXTURE-TRANSPORT-01');
  await expect(detail.getByLabel('运输轨迹明细')).toContainText('FIXTURE-EVIDENCE');
  await page.screenshot({ path: screenshotDir + '/forwarder-transport-detail-fixture.png', fullPage: true });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.screenshot({ path: screenshotDir + '/fba-shipping-list-fixture.png', fullPage: true });
  await page.getByRole('button', { name: '展开计划', exact: true }).click();
  await expect(page.locator('[data-plan-id="fixture-plan"]')).toBeVisible();
  expect(calls.filter(call => call.method !== 'GET')).toHaveLength(0);
});
