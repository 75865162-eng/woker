import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePurchaseDraft } from '../src/lib/procurement/order-input';
import { parsePurchasePriceHistoryQuery } from '../src/lib/procurement/price-history';
const draft = { number: 'PO-INPUT', supplierId: 'supplier', currency: 'CNY', expectedAt: '2026-11-12', lines: [{ productRecordId: 'product', expectedQty: 3, unitPrice: '12.340000' }] };
test('purchase draft preserves decimal price and normalizes an optional date', () => {
  assert.equal(parsePurchaseDraft(draft).lines[0].unitPrice, '12.340000');
  assert.equal(parsePurchaseDraft(draft).expectedAt?.toISOString(), '2026-11-12T00:00:00.000Z');
  assert.equal(parsePurchaseDraft({ ...draft, expectedAt: '' }).expectedAt, null);
});
test('invalid dates, currency, quantities, duplicate products and unknown fields are rejected', () => {
  for (const patch of [{ expectedAt: '2026-02-30' }, { expectedAt: 'invalid' }, { currency: 'bad' }, { lines: [null] }, { lines: [draft.lines[0], draft.lines[0]] }, { lines: [{ ...draft.lines[0], expectedQty: 2147483648 }] }, { lines: [{ ...draft.lines[0], unitPrice: 12.34 }] }, { lines: [{ ...draft.lines[0], unitPrice: '1.1234567' }] }, { status: 'ORDERED' }]) {
    assert.throws(() => parsePurchaseDraft({ ...draft, ...patch }));
  }
});
test('purchase price history query validates supplier and bounded product ids', () => {
  const query = new URLSearchParams({ view: 'price-history', supplierId: 'supplier', productRecordId: ' product ' });
  assert.deepEqual(parsePurchasePriceHistoryQuery(query), { supplierId: 'supplier', productRecordIds: ['product'] });
  assert.throws(() => parsePurchasePriceHistoryQuery(new URLSearchParams({ supplierId: 'supplier', productRecordId: 'product', unknown: 'x' })));
  assert.throws(() => parsePurchasePriceHistoryQuery(new URLSearchParams({ supplierId: 'supplier' })));
  const tooMany = new URLSearchParams({ supplierId: 'supplier' });
  for (let index = 0; index < 101; index++) tooMany.append('productRecordId', `product-${index}`);
  assert.throws(() => parsePurchasePriceHistoryQuery(tooMany));
});
