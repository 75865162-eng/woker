import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizePurchaseReceipts } from '../src/lib/procurement/receipt-summary';
const order = [{ productRecordId: 'a', expectedQty: 10 }];
const line = { productRecordId: 'a', expectedQty: 10, receivedQty: 0, acceptedQty: 0, rejectedQty: 0, putawayQty: 0 };
test('reserved quantities do not imply receipt completion', () => {
  const result = summarizePurchaseReceipts(order, [{ status: 'DRAFT', lines: [line] }])!;
  assert.equal(result.remainingQty, 0); assert.equal(result.state, 'IN_PROGRESS'); assert.equal(result.remainingToPutawayQty, 10);
  assert.equal(summarizePurchaseReceipts(order, [])?.state, 'NOT_STARTED');
});
test('short and rejected receipts need supplementation; completed only after all products are put away', () => {
  const short = { status: 'PUTAWAY', lines: [{ ...line, receivedQty: 8, acceptedQty: 6, rejectedQty: 2, putawayQty: 6 }] };
  const result = summarizePurchaseReceipts(order, [short])!;
  assert.equal(result.state, 'NEEDS_RECEIPT'); assert.equal(result.remainingQty, 4); assert.equal(result.remainingToPutawayQty, 4);
  const completed = summarizePurchaseReceipts(order, [short, { status: 'PUTAWAY', lines: [{ ...line, expectedQty: 4, receivedQty: 4, acceptedQty: 4, putawayQty: 4 }] }])!;
  assert.equal(completed.state, 'COMPLETED'); assert.equal(completed.receivedQty, 12); assert.equal(completed.rejectedQty, 2); assert.equal(completed.putawayQty, 10);
  assert.equal(summarizePurchaseReceipts([...order, { productRecordId: 'b', expectedQty: 1 }], [short])?.state, 'NEEDS_RECEIPT');
});
test('cancelled drafts are excluded and inconsistent or unknown data stays unknown', () => {
  assert.equal(summarizePurchaseReceipts(order, [{ status: 'CANCELLED', lines: [line] }])?.receivedQty, 0);
  for (const receipt of [{ status: 'BAD', lines: [line] }, { status: 'PUTAWAY', lines: [{ ...line, receivedQty: 10, acceptedQty: 10, putawayQty: 9 }] }, { status: 'RECEIVED', lines: [{ ...line, receivedQty: -1 }] }, { status: 'RECEIVED', lines: [{ ...line, receivedQty: 11 }] }]) assert.equal(summarizePurchaseReceipts(order, [receipt]), null);
  assert.equal(summarizePurchaseReceipts([], []), null);
});
