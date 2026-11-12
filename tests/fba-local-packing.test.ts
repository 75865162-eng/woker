import assert from "node:assert/strict";
import test from "node:test";
import { parseLocalPacking } from "../src/lib/fba-local/packing";

const lines = [{ id: "a", quantity: 3 }, { id: "b", quantity: 2 }];
const box = { number: "B1", lengthCm: "030.500", widthCm: "20", heightCm: "10", grossWeightKg: "1.200", items: [{ lineId: "a", quantity: 3 }, { lineId: "b", quantity: 2 }] };
test("packing canonicalizes measurements, box order and line order without inventing units", () => {
  const result = parseLocalPacking({ boxes: [box] }, lines);
  assert.equal(result.boxes[0].lengthCm, "30.5");
  assert.equal(result.boxes[0].grossWeightKg, "1.2");
  assert.deepEqual(result, parseLocalPacking({ boxes: [{ ...box, items: [...box.items].reverse() }] }, lines));
  assert.deepEqual(result, parseLocalPacking(result, lines));
});
test("mixed and split cartons account for every planned line exactly once in totals", () => {
  const result = parseLocalPacking({ boxes: [{ ...box, items: [{lineId: "a", quantity: 1}] }, { ...box, number: "B2", items: [{lineId: "a", quantity: 2}, {lineId: "b", quantity: 2}] }] }, lines);
  assert.equal(result.boxes.length, 2);
  assert.equal(result.boxes.flatMap(row => row.items).reduce((sum, item) => sum + item.quantity, 0), 5);
});
test("packing rejects missing, excess, foreign, duplicate and malformed quantities", () => {
  for (const items of [[], [{lineId: "a",quantity: 3}], [{lineId: "foreign", quantity: 5}], [{lineId:"a",quantity:2},{lineId:"a",quantity:1},{lineId:"b",quantity:2}], [{lineId:"a",quantity:4},{lineId:"b",quantity:2}], [{lineId:"a",quantity:0},{lineId:"b",quantity:2}], [{lineId:"a",quantity:1.5},{lineId:"b",quantity:2}]]) assert.throws(() => parseLocalPacking({boxes:[{...box,items}]},lines));
  assert.throws(() => parseLocalPacking({boxes:[box,box]},lines));
  assert.throws(() => parseLocalPacking({boxes:[{...box,amazonPlacementId:"fake"}]},lines));
  assert.throws(() => parseLocalPacking({boxes:[]},lines));
  assert.throws(() => parseLocalPacking({boxes:Array(201).fill(box)},lines));
});
test("packing requires positive decimal strings in fixed cm/kg units", () => {
  for(const field of ["lengthCm","widthCm","heightCm","grossWeightKg"]) for(const value of [0,"0","-1","NaN","1e3","1.2345","1000000","1 kg",null]) assert.throws(() => parseLocalPacking({boxes:[{...box,[field]:value}]},lines));
});
test('optional net weight remains unknown when absent and cannot exceed gross weight',()=>{
 assert.equal(parseLocalPacking({boxes:[box]},lines).boxes[0].netWeightKg,undefined);
 assert.equal(parseLocalPacking({boxes:[{...box,netWeightKg:'1.100'}]},lines).boxes[0].netWeightKg,'1.1');
 assert.throws(()=>parseLocalPacking({boxes:[{...box,netWeightKg:'1.201'}]},lines));
 assert.throws(()=>parseLocalPacking({boxes:[{...box,netWeightKg:null}]},lines));
});
