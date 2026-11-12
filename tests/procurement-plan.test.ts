import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPlanConvertible, parsePurchasePlanDraft, planProductWhere, purchasePlanHash, suggestPurchaseQty } from '../src/lib/procurement/plan-rules';

const window = { salesWindowDays: 90, coverageDays: 60, safetyDays: 15 };

test('建议量按日均销量推算覆盖期目标，并扣掉可用与在途', () => {
  // 90 天卖 900 → 日均 10；覆盖 60 + 安全 15 = 75 天 → 目标 750；可用 100 + 在途 50 → 缺 600
  assert.equal(suggestPurchaseQty({ ...window, availableQty: 100, inboundQty: 50, salesQty: 900 }), 600);
});

test('目标被小数截断时向上取整，避免系统性少买', () => {
  // 90 天卖 100 → 日均 1.111；75 天 → 83.33 → 84
  assert.equal(suggestPurchaseQty({ ...window, availableQty: 0, inboundQty: 0, salesQty: 100 }), 84);
});

test('没有销量基线时不给建议量，由人工决定', () => {
  assert.equal(suggestPurchaseQty({ ...window, availableQty: 0, inboundQty: 0, salesQty: 0 }), 0);
});

test('供给已经覆盖目标时不建议采购', () => {
  assert.equal(suggestPurchaseQty({ ...window, availableQty: 800, inboundQty: 0, salesQty: 900 }), 0);
  assert.equal(suggestPurchaseQty({ ...window, availableQty: 300, inboundQty: 500, salesQty: 900 }), 0);
});

test('负数供给快照按 0 处理，不会反向放大建议量', () => {
  assert.equal(suggestPurchaseQty({ ...window, availableQty: -50, inboundQty: -10, salesQty: 900 }), 750);
});

const validBody = {
  action: 'plan',
  number: 'PP-2026-11',
  supplierId: 'supplier-1',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-30',
  lines: [{ productRecordId: 'product-1', plannedQty: 120, unitPrice: '12.500000', notes: '' }],
};

test('草稿解析保留默认推算口径并归一化日期', () => {
  const draft = parsePurchasePlanDraft(validBody);
  assert.equal(draft.salesWindowDays, 90);
  assert.equal(draft.coverageDays, 60);
  assert.equal(draft.safetyDays, 15);
  assert.equal(draft.periodStart.toISOString().slice(0, 10), '2026-11-01');
  assert.equal(draft.lines[0].plannedQty, 120);
  assert.equal(draft.supplierId, 'supplier-1');
});

test('未指定供应商时允许先做计划，留空而不是报错', () => {
  assert.equal(parsePurchasePlanDraft({ ...validBody, supplierId: undefined }).supplierId, null);
  assert.equal(parsePurchasePlanDraft({ ...validBody, supplierId: '' }).supplierId, null);
});

test('计划期结束早于开始被拒绝', () => {
  assert.throws(() => parsePurchasePlanDraft({ ...validBody, periodEnd: '2026-10-01' }), /计划期结束不能早于开始/);
});

test('同一计划内重复商品被拒绝，避免同 SKU 两行数量打架', () => {
  const lines = [validBody.lines[0], { ...validBody.lines[0], plannedQty: 5 }];
  assert.throws(() => parsePurchasePlanDraft({ ...validBody, lines }), /商品不能重复/);
});

test('计划数量必须是正整数，单价必须是十进制文本', () => {
  assert.throws(() => parsePurchasePlanDraft({ ...validBody, lines: [{ ...validBody.lines[0], plannedQty: 0 }] }), /计划数量/);
  assert.throws(() => parsePurchasePlanDraft({ ...validBody, lines: [{ ...validBody.lines[0], plannedQty: 1.5 }] }), /计划数量/);
  assert.throws(() => parsePurchasePlanDraft({ ...validBody, lines: [{ ...validBody.lines[0], unitPrice: 12.5 }] }), /单价/);
});

test('未知字段被拒绝，防止前端拼错字段静默丢失数量', () => {
  assert.throws(() => parsePurchasePlanDraft({ ...validBody, expectQty: 1 }), Error);
  assert.throws(() => parsePurchasePlanDraft({ ...validBody, lines: [{ ...validBody.lines[0], quantity: 1 }] }), Error);
});

test('推算口径超出边界被拒绝', () => {
  assert.throws(() => parsePurchasePlanDraft({ ...validBody, coverageDays: 0 }), /覆盖天数/);
  assert.throws(() => parsePurchasePlanDraft({ ...validBody, safetyDays: 400 }), /安全天数/);
});

test('审批指纹与明细顺序无关，但数量变化会改变指纹', () => {
  const base = { number: 'PP-1', supplierId: 's1', periodStart: new Date('2026-11-01T00:00:00Z'), periodEnd: new Date('2026-11-30T00:00:00Z') };
  const a = { productRecordId: 'p1', plannedQty: 10, unitPrice: '1.000000' };
  const b = { productRecordId: 'p2', plannedQty: 20, unitPrice: '2.000000' };
  assert.equal(purchasePlanHash({ ...base, lines: [a, b] }), purchasePlanHash({ ...base, lines: [b, a] }));
  assert.notEqual(purchasePlanHash({ ...base, lines: [a, b] }), purchasePlanHash({ ...base, lines: [{ ...a, plannedQty: 11 }, b] }));
});

test('只有已批准且未转换的计划可以转采购单', () => {
  assert.doesNotThrow(() => assertPlanConvertible('APPROVED', null));
  assert.throws(() => assertPlanConvertible('DRAFT', null), /只有已批准/);
  assert.throws(() => assertPlanConvertible('APPROVED', 'order-1'), /已转采购单/);
});

test('需求推算的商品查询条件不得夹带操作者等上下文字段', () => {
  const scope = { organizationId: 'o1', workspaceId: 'default', actorUserId: 'u1' };
  const all = planProductWhere(scope);
  assert.deepEqual(all, { organizationId: 'o1', workspaceId: 'default' });
  assert.equal('actorUserId' in all, false);
  const filtered = planProductWhere(scope, ['p1', 'p2']);
  assert.deepEqual(filtered.id, { in: ['p1', 'p2'] });
  assert.equal('actorUserId' in filtered, false);
});
