import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateComponents,
  expandComponents,
  lineAmount,
  parseAssemblyDraft,
  parseBomDraft,
  rolledUnitCost,
  shortageMessage,
  totalComponentCost,
  type AllocationCandidate,
} from '../src/lib/wms/assembly-rules';

const bom = [
  { componentProductRecordId: 'c1', quantityPer: 2 },
  { componentProductRecordId: 'c2', quantityPer: 1 },
];

function candidate(overrides: Partial<AllocationCandidate> & { balanceId: string }): AllocationCandidate {
  return {
    productRecordId: 'c1',
    lotId: `lot-${overrides.balanceId}`,
    locationId: 'loc-1',
    warehouseId: 'wh-1',
    available: 10,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

test('BOM 展开：单位用量 × 计划产量', () => {
  const demand = expandComponents(bom, 5);
  assert.deepEqual(demand, [
    { componentProductRecordId: 'c1', quantity: 10 },
    { componentProductRecordId: 'c2', quantity: 5 },
  ]);
});

test('BOM 展开：人工调整覆盖计算量，且只允许覆盖 BOM 内物料', () => {
  const demand = expandComponents(bom, 5, [{ componentProductRecordId: 'c1', quantity: 12 }]);
  assert.equal(demand.find(row => row.componentProductRecordId === 'c1')!.quantity, 12);
  assert.throws(() => expandComponents(bom, 5, [{ componentProductRecordId: 'c9', quantity: 1 }]), /BOM 之外/);
});

test('组件分配：同仓库可用余额按入库先后取料', () => {
  const candidates = [
    candidate({ balanceId: 'b-new', available: 10, createdAt: new Date('2026-03-01T00:00:00Z') }),
    candidate({ balanceId: 'b-old', available: 6, createdAt: new Date('2026-01-01T00:00:00Z') }),
  ];
  const { lines, shortages } = allocateComponents([{ componentProductRecordId: 'c1', quantity: 9 }], candidates, 'wh-1');
  assert.equal(shortages.length, 0);
  assert.deepEqual(lines.map(line => [line.balanceId, line.plannedQty]), [['b-old', 6], ['b-new', 3]]);
});

test('组件分配：跨批次拆行，且不越仓取料', () => {
  const candidates = [
    candidate({ balanceId: 'b-1', available: 4 }),
    candidate({ balanceId: 'b-2', available: 100, warehouseId: 'wh-2' }),
  ];
  const { shortages } = allocateComponents([{ componentProductRecordId: 'c1', quantity: 8 }], candidates, 'wh-1');
  assert.equal(shortages.length, 1);
  assert.deepEqual(shortages[0], { componentProductRecordId: 'c1', required: 8, available: 4 });
  assert.match(shortageMessage(shortages), /需 8 可用 4/);
});

test('组件分配：任一组件不足即整体不给行，避免扣一半料', () => {
  const candidates = [candidate({ balanceId: 'b-1', available: 100 })];
  const { lines, shortages } = allocateComponents(
    [{ componentProductRecordId: 'c1', quantity: 10 }, { componentProductRecordId: 'c2', quantity: 5 }],
    candidates,
    'wh-1',
  );
  assert.equal(shortages.length, 1);
  assert.equal(shortages[0].componentProductRecordId, 'c2');
  assert.deepEqual(lines.map(line => line.componentProductRecordId), ['c1']);
});

test('产成品单位成本：总分摊到产出，四舍五入 6 位', () => {
  assert.equal(rolledUnitCost('30.000000', 4), '7.500000');
  assert.equal(rolledUnitCost('10.000000', 3), '3.333333');
  assert.equal(rolledUnitCost('10.000002', 3), '3.333334');
  assert.throws(() => rolledUnitCost('10.000000', 0), /产出数量/);
});

test('行金额与总成本保持 6 位定点，不出现浮点误差', () => {
  assert.equal(lineAmount(3, '0.100000'), '0.300000');
  assert.equal(lineAmount(7, '1.234567'), '8.641969');
  assert.equal(totalComponentCost([{ consumedQty: 3, unitCost: '0.100000' }, { consumedQty: 2, unitCost: '1.000000' }]), '2.300000');
});

test('BOM 校验：成品不能当自己的组件，组件不可重复', () => {
  assert.throws(() => parseBomDraft({ productRecordId: 'p1', lines: [{ componentProductRecordId: 'p1', quantityPer: 1 }] }), /自己的组件/);
  assert.throws(() => parseBomDraft({ productRecordId: 'p1', lines: [{ componentProductRecordId: 'c1', quantityPer: 1 }, { componentProductRecordId: 'c1', quantityPer: 2 }] }), /重复/);
});

test('BOM 校验：单位用量须为正整数', () => {
  assert.throws(() => parseBomDraft({ productRecordId: 'p1', lines: [{ componentProductRecordId: 'c1', quantityPer: 0 }] }), /整数/);
  assert.throws(() => parseBomDraft({ productRecordId: 'p1', lines: [{ componentProductRecordId: 'c1', quantityPer: 1.5 }] }), /整数/);
});

test('组装单校验：缺必填字段与超量产量都会被拒绝', () => {
  const base = { number: 'ASM-1', productRecordId: 'p1', warehouseId: 'wh-1', locationId: 'loc-1', plannedQty: 5, idempotencyKey: 'k1' };
  const draft = parseAssemblyDraft(base);
  assert.equal(draft.plannedQty, 5);
  assert.equal(draft.currency, 'CNY');
  assert.deepEqual(draft.overrides, []);
  assert.throws(() => parseAssemblyDraft({ ...base, plannedQty: 100001 }), /上限/);
  assert.throws(() => parseAssemblyDraft({ ...base, unknown: 1 }), /未知字段/);
});
