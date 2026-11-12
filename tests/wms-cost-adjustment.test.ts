import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amountUnits, unitsAmount } from '../src/lib/finance/open-item-rules';
test('signed cost differences retain exact micros without floating point',()=>{
  assert.equal(unitsAmount(-amountUnits('999999999999999999999999.000001')),'-999999999999999999999999.000001');
  assert.equal(unitsAmount(amountUnits('1.000001')-amountUnits('1')),'0.000001');
});
