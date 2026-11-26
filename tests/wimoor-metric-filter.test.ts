/**
 * WIMOOR「指标筛选」弹窗（data_filter.vue）功能契约测试。
 * 固化原版 6 指标 / 3 运算符 / 多条件 / 保存搜索 / 我的搜索条件 / 清除 / 筛选 契约，
 * 确保广告管理等 18 个页面的深层筛选功能不回归。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const component = read('src/components/wimoor-migration/metric-filter-popover.tsx');
const workbench = read('src/components/wimoor-migration/master-data-workbench.tsx');
const adsManager = read('src/app/(erp)/wimoor/ads/manager/page.tsx');

test('指标筛选组件还原原版 6 个指标', () => {
  for (const metric of ['CSRT', 'impressions', 'ACOS', 'ROAS', 'cost', 'CTR']) {
    assert.match(component, new RegExp(`value: '${metric}'`), `缺少指标 ${metric}`);
  }
  assert.match(component, /label: '转化率'/);
  assert.match(component, /label: '曝光量'/);
  assert.match(component, /label: '点击率'/);
});

test('还原原版 3 个运算符与百分号后缀', () => {
  for (const op of ['>', '=', '<']) {
    assert.match(component, new RegExp(`value: '${op.replace('<', '<')}'`), `缺少运算符 ${op}`);
  }
  assert.match(component, /percent: true/);
  assert.match(component, /percent \? 'pr-8'/);
});

test('还原多条件 / 保存搜索 / 我的搜索条件 / 清除 / 筛选', () => {
  for (const fn of ['addCondition', 'removeCondition', 'clearAll', 'saveCurrent', 'removeSaved']) {
    assert.match(component, new RegExp(`(?:function|const) ${fn}\\b`), `缺少 ${fn}`);
  }
  assert.match(component, /我的搜索条件/);
  assert.match(component, /保存这次搜索/);
  assert.match(component, /清空所有/);
  assert.match(component, /localStorage/);
});

test('功能项暴露到 DOM，便于自动化验收', () => {
  assert.match(component, /data-wimoor-features="metric-filter,add-condition,save-search,clear-all,apply-filter"/);
});

test('通用工作台可配置并挂载指标筛选', () => {
  assert.match(workbench, /metricFilter\?:/);
  assert.match(workbench, /MetricFilterPopover/);
  assert.match(workbench, /appliedMetrics/);
  assert.match(workbench, /指标筛选/);
});

test('广告管理页已启用指标筛选（截图案例）', () => {
  assert.match(adsManager, /metricFilter:\s*\{/);
  assert.match(adsManager, /storageKey:\s*'ads\.manager'/);
});

test('指标筛选推广到含该弹窗的共性页面（MasterData + AmazonDataset）', () => {
  const pages = [
    'product/master', 'product/consumable', 'product/package',
    'purchase/orders', 'purchase/payment-request',
    'shipment/customs', 'shipment/quote', 'shipment/quote-order',
  ];
  for (const p of pages) {
    const src = read(`src/app/(erp)/wimoor/${p}/page.tsx`);
    assert.match(src, /metricFilter:\s*\{/, `${p} 未启用指标筛选`);
  }
  const datasetPages = [
    'sales/shangpin-fenxi', 'sales/dingdan-liebiao', 'sales/jinri-dingdan',
    'shipment/ship-plan', 'shipment/handling', 'shipment/track',
    'account/profit-report', 'account/performance',
  ];
  for (const p of datasetPages) {
    const src = read(`src/app/(erp)/wimoor/${p}/page.tsx`);
    assert.match(src, /enableMetricFilter/, `${p} 未启用指标筛选`);
  }
});
