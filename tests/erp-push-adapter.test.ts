import test from 'node:test';
import assert from 'node:assert/strict';
import { buildErpPushPayload, pushEconomicKey, type PushDocument } from '../src/lib/finance/erp-push-adapter';

const doc = (over: Partial<PushDocument> = {}): PushDocument => ({
  target: 'KINGDEE', docType: 'VOUCHER', date: '2026-11-24', bookCurrency: 'CNY',
  claimId: 'claim-1', reference: 'voucher-2026-001',
  lines: [
    { subjectCode: '1001', debit: '100.000000', credit: '0.000000', currency: 'CNY' },
    { subjectCode: '6001', debit: '0.000000', credit: '100.000000', currency: 'CNY' },
  ],
  ...over,
});

test('幂等键稳定且跨目标/单据隔离', () => {
  const k1 = pushEconomicKey(doc());
  assert.equal(k1, pushEconomicKey(doc()));
  assert.notEqual(k1, pushEconomicKey(doc({ docType: 'AR' })));
  assert.notEqual(k1, pushEconomicKey(doc({ target: 'SAP' })));
  assert.match(k1, /^KINGDEE:VOUCHER:/);
});

test('金蝶 dry-run 载荷含字段映射，借贷平衡', () => {
  const r = buildErpPushPayload(doc());
  assert.equal(r.mode, 'DRY_RUN');
  assert.equal((r.payload as any).FNumber, 'claim-1');
  assert.equal((r.payload as any).FEntries.length, 2);
  assert.equal((r.payload as any).FEntries[0].FAccountID, '1001');
  assert.equal(r.totals.balanced, true);
});

test('NetSuite/SAP 字段映射正确', () => {
  const ns = buildErpPushPayload(doc({ target: 'NETSUITE' }));
  assert.equal((ns.payload as any).tranId, 'claim-1');
  assert.equal((ns.payload as any).lineitems[0].account, '1001');
  const sap = buildErpPushPayload(doc({ target: 'SAP' }));
  assert.equal((sap.payload as any).BELNR, 'claim-1');
  assert.equal((sap.payload as any).ITEMS[0].HKONT, '1001');
});

test('借贷不平被拒绝，不允许推送', () => {
  assert.throws(() => buildErpPushPayload(doc({ lines: [
    { subjectCode: '1001', debit: '100.000000', credit: '0.000000', currency: 'CNY' },
    { subjectCode: '6001', debit: '0.000000', credit: '90.000000', currency: 'CNY' },
  ] })), /借贷不平/);
});

test('缺科目编码不臆造默认科目', () => {
  assert.throws(() => buildErpPushPayload(doc({ lines: [
    { subjectCode: '', debit: '1.000000', credit: '0.000000', currency: 'CNY' },
  ] })), /缺科目编码/);
});

test('跨币种分录被拒绝，须先显式汇率核算', () => {
  assert.throws(() => buildErpPushPayload(doc({ lines: [
    { subjectCode: '1001', debit: '100.000000', credit: '0.000000', currency: 'USD' },
    { subjectCode: '6001', debit: '0.000000', credit: '100.000000', currency: 'USD' },
  ] })), /币种/);
});

test('不支持的目标系统被拒绝', () => {
  assert.throws(() => buildErpPushPayload(doc({ target: 'XERO' as any })), /不支持/);
});
