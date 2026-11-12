import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyUnsalable, parseCarrierDraft, parseUnsalablePolicy, parseWarehouseDraft,
  unsalableFingerprint, unsalableRows, type UnsalablePolicy,
} from '../src/lib/operations/ops-rules';

const policy: UnsalablePolicy = { slowDays: 90, minSalesQty: 0, salesWindowDays: 90 };
const row = (over: Partial<Parameters<typeof classifyUnsalable>[0]> = {}) => ({
  sku: 'SKU-1', productRecordId: 'p1', onHand: 10, ageDays: 10, salesQty: 50, ...over,
});

test('承运商编码统一大写，轨迹模板必须为 HTTPS', () => {
  const draft = parseCarrierDraft({ code: 'matson', name: '美森', enabled: true, serviceLevel: '快船' });
  assert.equal(draft.code, 'MATSON');
  assert.equal(draft.name, '美森');
  assert.equal(draft.serviceLevel, '快船');
  assert.equal(draft.notes, '');
  assert.throws(() => parseCarrierDraft({ code: 'BAD CODE', name: 'x', enabled: true }), /编码/);
  assert.throws(() => parseCarrierDraft({ code: 'OK', name: 'x', enabled: 'yes' }), /布尔/);
  assert.throws(() => parseCarrierDraft({ code: 'OK', name: 'x', enabled: true, trackingUrlPattern: 'http://x' }), /HTTPS/);
  assert.throws(() => parseCarrierDraft({ code: 'OK', name: 'x', enabled: true, unexpected: 1 }), /未知字段/);
});

test('三方仓状态与编码受控', () => {
  const draft = parseWarehouseDraft({ code: '3pl-us-1', name: '美西仓', provider: '第三方', status: 'active', enabled: true });
  assert.equal(draft.code, '3PL-US-1');
  assert.equal(draft.status, 'ACTIVE');
  assert.throws(() => parseWarehouseDraft({ code: 'X', name: 'x', provider: 'p', status: 'UNKNOWN', enabled: true }), /状态/);
  assert.throws(() => parseWarehouseDraft({ code: 'X', name: 'x', enabled: true }), /服务商/);
});

test('滞销判定：库龄与销量同时触发才判滞销', () => {
  assert.equal(classifyUnsalable(row(), policy).level, 'NORMAL');
  assert.equal(classifyUnsalable(row({ ageDays: 120, salesQty: 30 }), policy).level, 'SLOW');
  assert.equal(classifyUnsalable(row({ ageDays: 10, salesQty: 0 }), policy).level, 'SLOW');
  assert.equal(classifyUnsalable(row({ ageDays: 120, salesQty: 0 }), policy).level, 'UNSALABLE');
  assert.match(classifyUnsalable(row({ ageDays: 120, salesQty: 0 }), policy).action, /清仓/);
});

test('滞销列表剔除零库存并按严重程度排序', () => {
  const rows = unsalableRows([
    row({ sku: 'B', onHand: 3, ageDays: 200, salesQty: 0 }),
    row({ sku: 'A', onHand: 80, ageDays: 200, salesQty: 0 }),
    row({ sku: 'C', onHand: 0, ageDays: 300, salesQty: 0 }),
    row({ sku: 'D', onHand: 5, ageDays: 3, salesQty: 90 }),
  ], policy);
  assert.deepEqual(rows.map(item => item.sku), ['A', 'B', 'D']);
  assert.equal(rows[0].level, 'UNSALABLE');
  assert.equal(rows.at(-1)?.level, 'NORMAL');
});

test('判定口径参数边界受控', () => {
  assert.deepEqual(parseUnsalablePolicy({ slowDays: 90, minSalesQty: 2, salesWindowDays: 60 }), { slowDays: 90, minSalesQty: 2, salesWindowDays: 60 });
  assert.throws(() => parseUnsalablePolicy({ slowDays: 0 }), /库龄阈值/);
  assert.throws(() => parseUnsalablePolicy({ slowDays: 90, salesWindowDays: 400 }), /销量窗口/);
});

test('来源摘要在同一来源下稳定，来源变化即变化', () => {
  const identity = { organizationId: 'o1', workspaceId: 'default', warehouseId: 'w1', asOfDate: '2026-11-13' };
  const rows = unsalableRows([row()], policy);
  const first = unsalableFingerprint(rows, policy, identity);
  assert.equal(first, unsalableFingerprint(unsalableRows([row()], policy), policy, identity));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, unsalableFingerprint(rows, policy, { ...identity, asOfDate: '2026-11-14' }));
  assert.notEqual(first, unsalableFingerprint(unsalableRows([row({ onHand: 11 })], policy), policy, identity));
  assert.notEqual(first, unsalableFingerprint(rows, { ...policy, slowDays: 60 }, identity));
});
