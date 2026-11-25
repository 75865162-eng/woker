import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidate, type EntityBalance, type FxQuote, type Intercompany } from '../src/lib/finance/consolidation';

const entities = [{ entityId: 'CN', name: '中国主体' }, { entityId: 'US', name: '美国主体' }];
const quotes: FxQuote[] = [
  { source: 'USD', target: 'CNY', rate: '7.10000000', reference: 'rev-1', observedAt: '2026-11-20', reviewedBy: 'cfo' },
  { source: 'USD', target: 'CNY', rate: '7.20000000', reference: 'rev-2', observedAt: '2026-11-21', reviewedBy: 'cfo' },
  { source: 'USD', target: 'CNY', rate: '9.90000000', reference: 'draft', observedAt: '2026-11-22', reviewedBy: '' },
];

test('缺已复核汇率 → NEEDS_DATA，不臆造', () => {
  const balances: EntityBalance[] = [{ entityId: 'US', currency: 'EUR', subjectCode: 'CASH', balanceSide: 'DEBIT', amount: '100.000000', isMonetary: true }];
  const r = consolidate({ reportingCurrency: 'CNY', entities, balances, quotes, intercompany: [] });
  assert.equal(r.status, 'NEEDS_DATA');
  assert.deepEqual(r.missing, ['fx:EUR->CNY']);
});

test('同币种主体余额直加，无需汇率', () => {
  const balances: EntityBalance[] = [
    { entityId: 'CN', currency: 'CNY', subjectCode: 'CASH', balanceSide: 'DEBIT', amount: '100.000000', isMonetary: true },
    { entityId: 'US', currency: 'CNY', subjectCode: 'CASH', balanceSide: 'CREDIT', amount: '30.000000', isMonetary: true },
  ];
  const r = consolidate({ reportingCurrency: 'CNY', entities, balances, quotes, intercompany: [] });
  assert.equal(r.status, 'CONSOLIDATED');
  assert.equal(r.lines[0].signedBase, '100.000000');
  assert.equal(r.lines[1].signedBase, '-30.000000');
});

test('外币折算取最新已复核汇率，草稿汇率被忽略', () => {
  const balances: EntityBalance[] = [{ entityId: 'US', currency: 'USD', subjectCode: 'AR', balanceSide: 'DEBIT', amount: '10.000000', isMonetary: true }];
  const r = consolidate({ reportingCurrency: 'CNY', entities, balances, quotes, intercompany: [] });
  assert.equal(r.status, 'CONSOLIDATED');
  assert.equal(r.lines[0].fxRate, '7.20000000'); // 取 11-21 最新，忽略 11-22 草稿
  assert.equal(r.lines[0].signedBase, '72.000000'); // 10*7.2
});

test('非货币项目折算差额计入 OCI，不进损益', () => {
  const balances: EntityBalance[] = [{ entityId: 'US', currency: 'USD', subjectCode: 'INVENTORY', balanceSide: 'DEBIT', amount: '10.000000', isMonetary: false }];
  const r = consolidate({ reportingCurrency: 'CNY', entities, balances, quotes, intercompany: [] });
  assert.equal(r.status, 'CONSOLIDATED');
  assert.equal(r.oci.length, 1);
  assert.match(r.oci[0].note, /OCI/);
});

test('内部往来双边一致才抵消，金额不符列为差异', () => {
  const ic: Intercompany[] = [
    { key: 'ic-1', entityId: 'CN', counterpartyId: 'US', direction: 'RECEIVABLE', currency: 'CNY', amount: '50.000000', evidence: 'contract-1' },
    { key: 'ic-1', entityId: 'US', counterpartyId: 'CN', direction: 'PAYABLE', currency: 'CNY', amount: '50.000000', evidence: 'contract-1' },
  ];
  const ok = consolidate({ reportingCurrency: 'CNY', entities, balances: [], quotes, intercompany: ic });
  assert.equal(ok.eliminations.length, 1);
  assert.equal(ok.differences.length, 0);
  const bad = consolidate({ reportingCurrency: 'CNY', entities, balances: [], quotes, intercompany: [
    ic[0], { ...ic[1], amount: '60.000000' },
  ] });
  assert.equal(bad.eliminations.length, 0);
  assert.equal(bad.differences.length, 1);
  assert.match(bad.differences[0].reason, /不一致/);
});

test('内部往来币种不一致禁止抵消', () => {
  const ic: Intercompany[] = [
    { key: 'x', entityId: 'CN', counterpartyId: 'US', direction: 'RECEIVABLE', currency: 'USD', amount: '10.000000', evidence: 'c' },
    { key: 'x', entityId: 'US', counterpartyId: 'CN', direction: 'PAYABLE', currency: 'EUR', amount: '10.000000', evidence: 'c' },
  ];
  const r = consolidate({ reportingCurrency: 'CNY', entities, balances: [], quotes: [], intercompany: ic });
  assert.equal(r.status, 'CONSOLIDATED');
  assert.equal(r.eliminations.length, 0);
  assert.equal((r as any).differences.length, 1);
  assert.match((r as any).differences[0].reason, /币种不一致/);
});

test('未知主体引用被拒绝', () => {
  const balances: EntityBalance[] = [{ entityId: 'XX', currency: 'CNY', subjectCode: 'CASH', balanceSide: 'DEBIT', amount: '1.000000', isMonetary: true }];
  assert.throws(() => consolidate({ reportingCurrency: 'CNY', entities, balances, quotes, intercompany: [] }), /未知主体/);
});
