import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePurchaseReceiptLines } from '../src/lib/procurement/receipt-input';

test('purchase receipt accepts explicit partial lines and omitted lines retain full allocation', () => {
  assert.equal(parsePurchaseReceiptLines(undefined), undefined);
  assert.deepEqual(parsePurchaseReceiptLines([{ productRecordId: 'a', expectedQty: 2 }]), [{ productRecordId: 'a', expectedQty: 2 }]);
});
test('purchase receipt rejects empty, repeated, invalid and extra line fields', () => {
  for (const raw of [null, [], {}, [null], [{ productRecordId: 'a', expectedQty: 0 }], [{ productRecordId: 'a', expectedQty: 1.5 }], [{ productRecordId: 'a', expectedQty: 2147483648 }], [{ productRecordId: 'a', expectedQty: 1, actor: 'spoof' }], [{ productRecordId: 'a', expectedQty: 1 }, { productRecordId: 'a', expectedQty: 2 }]]) assert.throws(() => parsePurchaseReceiptLines(raw));
});
