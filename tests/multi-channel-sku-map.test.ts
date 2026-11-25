import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSkuMap, resolveOrderSku, type SkuMapping } from '../src/lib/amazon-sync/multi-channel-sku-map';

const m = (o: Partial<SkuMapping> = {}): SkuMapping => ({
  platform: 'AMAZON', sellerSku: 'SKU-A', asin: 'B0XXX', wokerSku: 'W-001',
  confidence: 'EXACT', evidence: 'mapping-table-v1', ...o,
});

test('同平台SKU多映射冲突被阻断', () => {
  const r = resolveSkuMap([m(), m({ wokerSku: 'W-002', evidence: 'other' })]);
  assert.deepEqual(r.conflicts, ['AMAZON|SKU-A']);
  assert.equal(r.resolved.length, 0);
});

test('同组取置信度最高映射', () => {
  const r = resolveSkuMap([
    m({ confidence: 'LOW', evidence: 'guess' }),
    m({ confidence: 'EXACT', evidence: 'authoritative' }),
  ]);
  assert.equal(r.resolved.length, 1);
  assert.equal(r.resolved[0].confidence, 'EXACT');
});

test('低置信度映射被标记', () => {
  const r = resolveSkuMap([m({ confidence: 'LOW' })]);
  assert.deepEqual(r.lowConfidence, ['AMAZON|SKU-A']);
});

test('无依据映射被拒绝（禁止无依据归并）', () => {
  assert.throws(() => resolveSkuMap([m({ evidence: '' })]), /依据/);
});

test('订单兜底：显式映射优先', () => {
  const r = resolveOrderSku({ platform: 'AMAZON', sellerSku: 'SKU-A', asin: 'B0XXX', mappings: [m()] });
  assert.equal(r.wokerSku, 'W-001');
  assert.equal(r.confidence, 'EXACT');
});

test('订单兜底：无映射时用 sellerSku 但标 LOW，绝不静默', () => {
  const r = resolveOrderSku({ platform: 'WALMART', sellerSku: 'WM-9', asin: null, mappings: [] });
  assert.equal(r.wokerSku, 'WM-9');
  assert.equal(r.confidence, 'LOW');
  assert.match(r.reason, /需人工确认/);
});

test('订单兜底：完全无标识返回 NONE', () => {
  const r = resolveOrderSku({ platform: 'AMAZON', sellerSku: null, asin: null, mappings: [] });
  assert.equal(r.wokerSku, null);
  assert.equal(r.confidence, 'NONE');
});
