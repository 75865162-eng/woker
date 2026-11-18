import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalMeasurement, displayMeasurement, sizeLimitInCentimeters } from '../src/lib/ext/calculator-units';
import { quoteReferenceFba } from '../src/lib/ext/fba-reference';

test('重量及尺寸在切换单位后保留物理量，空值不变零',()=>{
  assert.equal(displayMeasurement('2','kg'),'0.90718474');
  assert.equal(displayMeasurement('2','oz'),'32');
  assert.equal(canonicalMeasurement('32','oz'),'2');
  assert.equal(canonicalMeasurement('0.90718474','kg'),'2');
  assert.equal(displayMeasurement('23','cm'),'58.42');
  assert.equal(canonicalMeasurement('58.42','cm'),'23');
  assert.equal(displayMeasurement('','kg'),'');
  assert.equal(canonicalMeasurement('','cm'),'');
});
test('相同商品使用kg/cm和lb/in录入，费用与尺寸分段相同',()=>{
  const base={category:'服装和配饰',date:'2026-11-18',price:'20',weightLb:'1',lengthIn:'15',widthIn:'12',heightIn:'0.75'};
  const converted={...base,weightLb:canonicalMeasurement('0.45359237','kg'),lengthIn:canonicalMeasurement('38.1','cm'),widthIn:canonicalMeasurement('30.48','cm'),heightIn:canonicalMeasurement('1.905','cm')};
  assert.deepEqual(quoteReferenceFba(converted),quoteReferenceFba(base));
});

test('尺寸上限厘米列同时换算三边与围长，保留不等号和说明',()=>{
  assert.equal(sizeLimitInCentimeters('≤15 × 12 × 0.75 英寸'),'≤38.1 × 30.48 × 1.905 厘米');
  assert.equal(sizeLimitInCentimeters('≤37 × 28 × 20 英寸，围长 ≤130 英寸'),'≤93.98 × 71.12 × 50.8 厘米，围长 ≤330.2 厘米');
  assert.equal(sizeLimitInCentimeters('超过大件任一维度'),'超过大件任一维度');
});
