/**
 * WIMOOR 状态页签过滤回归测试。
 *
 * 复现并锁定一个真实 bug：FEATURE_MAP 中 18 个页把首个页签写成 value="全部"，
 * 旧逻辑把 activeTab 当作 status 字段的字面量值过滤，导致没有任何行匹配
 * （status 从来不等于「全部」），这些页默认展示空列表。
 *
 * 修复：把「全部/所有/all/ALL」作为「不过滤」哨兵，原样返回全部行。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterRowsByTab, TAB_NO_FILTER_VALUES } from '../src/components/wimoor-migration/master-data-workbench';

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

type Row = { id: string; status: string };

const rows: Row[] = [
  { id: '1', status: 'ACTIVE' },
  { id: '2', status: 'INACTIVE' },
  { id: '3', status: 'ACTIVE' },
];

test('「全部」页签不按字面量过滤 status，返回全部行', () => {
  for (const sentinel of ['全部', '所有', 'all', 'ALL']) {
    assert.equal(TAB_NO_FILTER_VALUES.has(sentinel), true);
    const result = filterRowsByTab(rows, sentinel, r => r.status);
    assert.equal(result.length, rows.length, `${sentinel} 页签应不过滤`);
  }
});

test('具体状态页签按字段值精确过滤', () => {
  const active = filterRowsByTab(rows, 'ACTIVE', r => r.status);
  assert.deepEqual(active.map(r => r.id), ['1', '3']);
  const inactive = filterRowsByTab(rows, 'INACTIVE', r => r.status);
  assert.deepEqual(inactive.map(r => r.id), ['2']);
});

test('空 activeTab 表示未选页签，不过滤', () => {
  assert.equal(filterRowsByTab(rows, '', r => r.status).length, rows.length);
});

test('FEATURE_MAP 中确实存在以「全部」为首页签的页（回归场景真实存在）', () => {
  const src = read('src/lib/wimoor-migration/feature-map.generated.ts');
  const count = (src.match(/statusTabs: \[\{ value: "全部"/g) ?? []).length;
  assert.ok(count >= 10, `预期多个页以「全部」为首页签，实际 ${count}`);
});

test('工作台已使用 filterRowsByTab 修复默认空列表', () => {
  const workbench = read('src/components/wimoor-migration/master-data-workbench.tsx');
  assert.match(workbench, /filterRowsByTab\(/);
  assert.match(workbench, /TAB_NO_FILTER_VALUES/);
});
