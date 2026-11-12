import assert from 'node:assert/strict';
import { test } from 'node:test';
import { purchaseLineAmount, purchaseOrderAmount } from '../src/lib/procurement/order-amounts';

test('purchase amounts preserve six decimal precision and add without floating point', () => {
  assert.equal(purchaseLineAmount({ expectedQty: '3', unitPrice: '0.100001' }), '0.300003');
  assert.equal(purchaseOrderAmount([{ expectedQty: 3, unitPrice: '0.100001' }, { expectedQty: '7', unitPrice: '0.1' }]), '1.000003');
  assert.equal(purchaseLineAmount({ expectedQty: 1, unitPrice: '0.000000' }), '0.00');
  assert.equal(purchaseLineAmount({ expectedQty: 3, unitPrice: '12.340000' }), '37.02');
  assert.equal(purchaseLineAmount({ expectedQty: 1000, unitPrice: '99999999999999.999999' }), '99999999999999999.999');
  assert.equal(purchaseLineAmount({ expectedQty: 2147483647, unitPrice: '1' }), '2147483647.00');
});

test('incomplete or invalid amounts remain unknown instead of producing a partial total or zero', () => {
  for (const expectedQty of ['', '0', '-1', '1.2', '1e3', '2147483648', NaN, Infinity]) assert.equal(purchaseLineAmount({ expectedQty, unitPrice: '1' }), null);
  for (const unitPrice of ['', '-1', '1e3', '.1', '1.', '1.1234567', '100000000000000', 'NaN']) assert.equal(purchaseLineAmount({ expectedQty: '1', unitPrice }), null);
  assert.equal(purchaseOrderAmount([]), null);
  assert.equal(purchaseOrderAmount([{ expectedQty: '2', unitPrice: '2' }, { expectedQty: '', unitPrice: '1' }]), null);
});
