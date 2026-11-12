import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remainingPurchaseQuantities } from '../src/lib/procurement/receipt-allocation';

test('purchase allocation tracks each product independently across completed and active receipts', () => {
  const result = remainingPurchaseQuantities([{ productRecordId: 'a', expectedQty: 10 }, { productRecordId: 'b', expectedQty: 5 }], [
    { status: 'PUTAWAY', lines: [{ productRecordId: 'a', expectedQty: 8, acceptedQty: 6 }] },
    { status: 'INSPECTED', lines: [{ productRecordId: 'a', expectedQty: 3, acceptedQty: 2 }, { productRecordId: 'b', expectedQty: 2, acceptedQty: 1 }] },
    { status: 'CANCELLED', lines: [{ productRecordId: 'b', expectedQty: 3, acceptedQty: 0 }] },
  ]);
  assert.deepEqual(result, new Map([['a', 1], ['b', 3]]));
});

test('unexpected receipt state or product cannot become available allocation', () => {
  const lines = [{ productRecordId: 'a', expectedQty: 2 }];
  assert.equal(remainingPurchaseQuantities(lines, [{ status: 'UNKNOWN', lines: [] }]), null);
  assert.equal(remainingPurchaseQuantities(lines, [{ status: 'DRAFT', lines: [{ productRecordId: 'b', expectedQty: 1, acceptedQty: 0 }] }]), null);
});

test('over-allocation stays negative for callers to reject instead of being clamped to zero', () => {
  assert.equal(remainingPurchaseQuantities([{ productRecordId: 'a', expectedQty: 2 }], [{ status: 'DRAFT', lines: [{ productRecordId: 'a', expectedQty: 3, acceptedQty: 0 }] }])?.get('a'), -1);
});
