import assert from 'node:assert/strict';
import test from 'node:test';
import {parseShipmentLabelRequest,renderShipmentLabels} from '../src/lib/fba-local/shipment-label-rules';
import {shipmentLabelKinds} from '../src/lib/fba-local/shipment-label-contract';

const boxes = [
  {number: 'B-1', lengthCm: '30', widthCm: '20', heightCm: '10', grossWeightKg: '2.5', items: [
    {sellerSku: 'SKU-1', fnsku: 'FNSKU-1', quantity: 3},
    {sellerSku: 'SKU-2', quantity: 1},
  ]},
  {number: 'B-2', lengthCm: '40', widthCm: '30', heightCm: '20', grossWeightKg: '5', items: [
    {sellerSku: 'SKU-3', fnsku: 'FNSKU-3', quantity: 2},
  ]},
];
const base = () => ({planNumber: 'PLAN-1', shipmentName: 'SHP-1', kind: 'BOX_LABEL' as const, boxes, generatedAt: '2026-11-14T10:00:00.000Z'});

test('shipmentLabelKinds 为封闭白名单', () => {
  assert.deepEqual(shipmentLabelKinds, ['BOX_LABEL', 'ITEM_LABEL']);
});

test('parseShipmentLabelRequest 解析并对 boxNumbers 去重排序', () => {
  const parsed = parseShipmentLabelRequest({shipmentId: ' s1 ', kind: 'BOX_LABEL', boxNumbers: ['3', '1', '3', '2'], idempotencyKey: ' k '});
  assert.equal(parsed.shipmentId, 's1');
  assert.equal(parsed.kind, 'BOX_LABEL');
  assert.equal(parsed.idempotencyKey, 'k');
  assert.deepEqual(parsed.boxNumbers, ['1', '2', '3']);
});

test('parseShipmentLabelRequest 未提供 boxNumbers 时不含该字段', () => {
  const parsed = parseShipmentLabelRequest({shipmentId: 's1', kind: 'ITEM_LABEL', idempotencyKey: 'k'});
  assert.equal('boxNumbers' in parsed, false);
  assert.equal(parsed.boxNumbers, undefined);
});

test('parseShipmentLabelRequest strictKeys 拒绝多余字段', () => {
  assert.throws(() => parseShipmentLabelRequest({shipmentId: 's1', kind: 'BOX_LABEL', idempotencyKey: 'k', planId: 'p1'}), /包含未知字段/);
  assert.throws(() => parseShipmentLabelRequest({shipmentId: 's1', kind: 'BOX_LABEL', idempotencyKey: 'k', fbaBoxCode: 'FAKE'}), /包含未知字段/);
  assert.throws(() => parseShipmentLabelRequest({shipmentId: 's1', kind: 'BOX_LABEL', idempotencyKey: 'k', shipmentName: 'FAKE'}), /包含未知字段/);
});

test('parseShipmentLabelRequest kind 白名单校验', () => {
  for (const kind of shipmentLabelKinds) assert.doesNotThrow(() => parseShipmentLabelRequest({shipmentId: 's1', kind, idempotencyKey: 'k'}));
  assert.throws(() => parseShipmentLabelRequest({shipmentId: 's1', kind: 'AMAZON_BOX_LABEL', idempotencyKey: 'k'}), /标签类型无效/);
  assert.throws(() => parseShipmentLabelRequest({shipmentId: 's1', kind: null, idempotencyKey: 'k'}), /标签类型无效/);
  assert.throws(() => parseShipmentLabelRequest({shipmentId: 's1', idempotencyKey: 'k'}), /标签类型无效/);
});

test('parseShipmentLabelRequest boxNumbers 数量与类型校验', () => {
  const ok = (boxNumbers: unknown) => parseShipmentLabelRequest({shipmentId: 's1', kind: 'BOX_LABEL', idempotencyKey: 'k', boxNumbers});
  assert.throws(() => ok([]), /1-200/);
  assert.throws(() => ok(Array.from({length: 201}, (_, i) => String(i))), /1-200/);
  assert.throws(() => ok('1'), /1-200/);
  assert.throws(() => ok(['1', 42]), /箱号/);
  assert.throws(() => ok([{}]), /箱号/);
  assert.deepEqual(ok(['2', '1']).boxNumbers, ['1', '2']);
});

test('parseShipmentLabelRequest 拒绝非对象输入', () => {
  for (const raw of [null, undefined, 1, 'x', ['a']]) assert.throws(() => parseShipmentLabelRequest(raw), /标签请求内容须为对象/);
});

test('renderShipmentLabels 转义所有动态文本', () => {
  const html = renderShipmentLabels({
    planNumber: '<PLAN>&"\'', shipmentName: '<SHP>', kind: 'BOX_LABEL', generatedAt: '<TIME>',
    boxes: [{number: '<BOX>', lengthCm: '10', widthCm: '20', heightCm: '30', grossWeightKg: '1.5', items: [{sellerSku: '<SKU>', fnsku: '<FN>', quantity: 7}]}],
  });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('&lt;PLAN&gt;&amp;&quot;&#39;'));
  assert.ok(html.includes('&lt;SHP&gt;'));
  assert.ok(html.includes('&lt;TIME&gt;'));
  assert.ok(html.includes('&lt;BOX&gt;'));
  assert.ok(html.includes('&lt;SKU&gt;'));
  assert.ok(html.includes('&lt;FN&gt;'));
  assert.ok(!html.includes('<PLAN>'));
  assert.ok(!html.includes('<SHP>'));
  assert.ok(!html.includes('<script'));
});

test('renderShipmentLabels 每箱一页且含打印样式', () => {
  const html = renderShipmentLabels(base());
  assert.equal((html.match(/<section class="label"/g) ?? []).length, 2);
  assert.ok(html.includes('@media print'));
  assert.ok(html.includes('break-inside:avoid'));
  assert.ok(html.includes('break-after:page'));
  assert.ok(html.includes('B-1'));
  assert.ok(html.includes('B-2'));
  assert.ok(html.includes('30 × 20 × 10'));
  assert.ok(html.includes('2.5'));
});

test('renderShipmentLabels 含醒目内部标签标注且无伪造 Amazon 生成字段', () => {
  const html = renderShipmentLabels(base());
  assert.ok(html.includes('内部标签，非 Amazon 官方箱唛'));
  assert.ok(html.includes('本地内部标签'));
  for (const token of ['fbaBoxCode', 'positionCode', 'warehouseCode', 'FBA 箱码']) {
    assert.ok(!html.includes(token), `不应出现伪造字段 ${token}`);
  }
});

test('renderShipmentLabels SKU/FNSKU/数量来自输入，ITEM_LABEL 逐条列出', () => {
  const html = renderShipmentLabels({...base(), kind: 'ITEM_LABEL'});
  assert.ok(html.includes('SKU-1'));
  assert.ok(html.includes('FNSKU-1'));
  assert.ok(html.includes('SKU-2'));
  assert.ok(html.includes('SKU-3'));
  assert.ok(html.includes('FNSKU-3'));
  assert.ok(html.includes('商品标签明细（逐条）'));
  assert.equal((html.match(/class="qty"/g) ?? []).length, 3);
  assert.ok(html.includes('class="qty">3<'));
  assert.ok(html.includes('class="qty">1<'));
  assert.ok(html.includes('class="qty">2<'));
  assert.ok(!html.includes('FAKE-SKU'));
  assert.ok(!html.includes('FAKE-FNSKU'));
});

test('renderShipmentLabels BOX_LABEL 也逐箱列出箱内明细', () => {
  const html = renderShipmentLabels(base());
  assert.ok(html.includes('箱内商品明细'));
  assert.ok(html.includes('SKU-1'));
  assert.ok(html.includes('内容摘要'));
  assert.equal((html.match(/<section class="label"/g) ?? []).length, 2);
});

test('renderShipmentLabels 为纯函数：相同输入得到相同输出', () => {
  assert.equal(renderShipmentLabels(base()), renderShipmentLabels(base()));
});
