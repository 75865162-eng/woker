import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTransferDiscrepancyPayload, validateTransferDiscrepancy, sumDiscrepancyByCategory, transferDiscrepancyCategories } from '../src/lib/wms/transfer-order-discrepancy-rules';
import type { TransferOrderLine } from '../src/lib/wms/transfer-order-rules';

const current = (over: Partial<TransferOrderLine> = {}): TransferOrderLine => ({ id: 'l', quantity: 10, shippedQty: 10, receivedQty: 7, discrepancyQty: 0, ...over });
type Item = { category: 'SHORT_RECEIVED' | 'DAMAGED' | 'REJECTED'; quantity: number; evidence: string };
const line = (discrepancies: Item[]) => [{ lineId: 'l', discrepancies }];

describe('parseTransferDiscrepancyPayload', () => {
  const valid = { action: 'TRANSFER_ORDER_DISCREPANCY', reference: 'receipt-1', reason: 'damaged in transit', lines: [{ lineId: 'l', discrepancies: [{ category: 'SHORT_RECEIVED', quantity: 2, evidence: 'photo-a' }, { category: 'DAMAGED', quantity: 1, evidence: 'photo-b' }] }] };
  it('parses a well-formed discrepancy and sorts categories deterministically', () => {
    const parsed = parseTransferDiscrepancyPayload({ ...valid, lines: [{ lineId: 'l', discrepancies: [{ category: 'REJECTED', quantity: 1, evidence: 'e3' }, { category: 'DAMAGED', quantity: 1, evidence: 'e2' }, { category: 'SHORT_RECEIVED', quantity: 1, evidence: 'e1' }] }] });
    assert.equal(parsed.action, 'TRANSFER_ORDER_DISCREPANCY');
    assert.deepEqual(parsed.lines[0].discrepancies.map(item => item.category), ['DAMAGED', 'REJECTED', 'SHORT_RECEIVED']);
    assert.equal(parsed.reference, 'receipt-1');
    assert.equal(parsed.reason, 'damaged in transit');
  });
  it('enforces strictKeys at top, line and discrepancy level', () => {
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, extra: 1 }));
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, lines: [{ lineId: 'l', discrepancies: valid.lines[0].discrepancies, extra: 1 }] }));
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, lines: [{ lineId: 'l', discrepancies: [{ category: 'DAMAGED', quantity: 1, evidence: 'e', extra: 1 }] }] }));
  });
  it('requires a known category and a positive integer quantity', () => {
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, lines: [{ lineId: 'l', discrepancies: [{ category: 'LOST', quantity: 1, evidence: 'e' }] }] }));
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, lines: [{ lineId: 'l', discrepancies: [{ category: 'DAMAGED', quantity: 0, evidence: 'e' }] }] }));
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, lines: [{ lineId: 'l', discrepancies: [{ category: 'DAMAGED', quantity: 1.5, evidence: 'e' }] }] }));
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, lines: [{ lineId: 'l', discrepancies: [{ category: 'DAMAGED', quantity: -1, evidence: 'e' }] }] }));
  });
  it('rejects duplicate categories and duplicate lines within one payload', () => {
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, lines: [{ lineId: 'l', discrepancies: [{ category: 'DAMAGED', quantity: 1, evidence: 'a' }, { category: 'DAMAGED', quantity: 1, evidence: 'b' }] }] }));
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, lines: [valid.lines[0], valid.lines[0]] }));
  });
  it('rejects blank evidence, reference, reason and empty categories', () => {
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, lines: [{ lineId: 'l', discrepancies: [{ category: 'DAMAGED', quantity: 1, evidence: '' }] }] }));
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, reference: '' }));
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, reason: '' }));
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, lines: [{ lineId: 'l', discrepancies: [] }] }));
  });
  it('rejects an action mismatch', () => {
    assert.throws(() => parseTransferDiscrepancyPayload({ ...valid, action: 'TRANSFER_ORDER_RECEIVE' }));
  });
});

describe('sumDiscrepancyByCategory', () => {
  it('totals each category from zero', () => {
    assert.deepEqual(sumDiscrepancyByCategory([{ category: 'SHORT_RECEIVED', quantity: 2 }, { category: 'SHORT_RECEIVED', quantity: 3 }, { category: 'REJECTED', quantity: 1 }]), { SHORT_RECEIVED: 5, DAMAGED: 0, REJECTED: 1 });
    assert.deepEqual(sumDiscrepancyByCategory([]), { SHORT_RECEIVED: 0, DAMAGED: 0, REJECTED: 0 });
    assert.deepEqual(transferDiscrepancyCategories, ['SHORT_RECEIVED', 'DAMAGED', 'REJECTED']);
  });
});

describe('validateTransferDiscrepancy', () => {
  it('accepts a category total exactly equal to current net in-transit', () => {
    assert.doesNotThrow(() => validateTransferDiscrepancy(line([{ category: 'SHORT_RECEIVED', quantity: 2, evidence: 'a' }, { category: 'DAMAGED', quantity: 1, evidence: 'b' }]), [current()]));
  });
  it('rejects a category total over or under current net in-transit', () => {
    assert.throws(() => validateTransferDiscrepancy(line([{ category: 'SHORT_RECEIVED', quantity: 4, evidence: 'a' }]), [current()]));
    assert.throws(() => validateTransferDiscrepancy(line([{ category: 'SHORT_RECEIVED', quantity: 2, evidence: 'a' }]), [current()]));
  });
  it('rejects a foreign lineId', () => {
    assert.throws(() => validateTransferDiscrepancy([{ lineId: 'other', discrepancies: [{ category: 'DAMAGED', quantity: 3, evidence: 'a' }] }], [current()]));
  });
  it('uses net in-transit (shipped - received - existing discrepancy)', () => {
    assert.doesNotThrow(() => validateTransferDiscrepancy(line([{ category: 'REJECTED', quantity: 1, evidence: 'a' }]), [current({ discrepancyQty: 2 })]));
    assert.throws(() => validateTransferDiscrepancy(line([{ category: 'REJECTED', quantity: 3, evidence: 'a' }]), [current({ discrepancyQty: 2 })]));
  });
  it('rejects any registration when net in-transit is already zero', () => {
    assert.throws(() => validateTransferDiscrepancy(line([{ category: 'DAMAGED', quantity: 1, evidence: 'a' }]), [current({ receivedQty: 10 })]));
  });
});
