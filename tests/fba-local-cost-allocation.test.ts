import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateLocalCost, readLocalCost } from '../src/lib/fba-local/cost-allocation';
const lines=[{id:'a',quantity:1},{id:'b',quantity:2}];
const input={reference:'FEE-1',stage:'ESTIMATE',amount:'100',currency:'USD',method:'QUANTITY',basis:[{lineId:'a'},{lineId:'b'}]};
function micros(value:string){return BigInt(value.replace('.',''));}
test('quantity allocation reconciles the entire source amount including the last micro-unit',()=>{
 const result=allocateLocalCost(input,lines);
 assert.equal(result.lines[0].allocatedAmount,'33.333333');assert.equal(result.lines[1].allocatedAmount,'66.666667');
 assert.equal(result.lines.reduce((n,row)=>n+micros(row.allocatedAmount),BigInt(0)),micros(result.amount));
 for(const row of result.lines)assert.equal(micros(row.unitCost)*BigInt(row.quantity)+micros(row.unitCostRemainder),micros(row.allocatedAmount));
 assert.deepEqual(readLocalCost(JSON.parse(JSON.stringify(result)),lines),result);
 assert.deepEqual(allocateLocalCost({...input,basis:[...input.basis].reverse()},lines),result);
});
test('Wimoor chargeable-weight basis uses max actual/dimensional per unit multiplied by quantity',()=>{
 const result=allocateLocalCost({...input,method:'CHARGEABLE_WEIGHT',basis:[{lineId:'a',unitWeightKg:'1',unitDimensionalWeightKg:'4'},{lineId:'b',unitWeightKg:'2',unitDimensionalWeightKg:'1'}]},lines);
 assert.deepEqual(result.lines.map(row=>row.allocatedAmount),['50.000000','50.000000']);
});
test('volume and same-currency value bases reconcile without using binary floating point',()=>{
 for(const [method,key] of [['VOLUME','unitVolumeM3'],['VALUE','unitValue']]){
  const result=allocateLocalCost({...input,method,basis:[{lineId:'a',[key]:'2'},{lineId:'b',[key]:'1'}]},lines);
  assert.deepEqual(result.lines.map(row=>row.allocatedAmount),['50.000000','50.000000']);
 }
});
test('small fees and many lines retain total and deterministic tie breaking',()=>{
 const rows=Array.from({length:100},(_,index)=>({id:String(index).padStart(3,'0'),quantity:3}));
 const result=allocateLocalCost({...input,amount:'0.000001',basis:rows.map(row=>({lineId:row.id}))},rows);
 assert.equal(result.lines[0].allocatedAmount,'0.000001');
 assert.equal(result.lines.reduce((n,row)=>n+micros(row.allocatedAmount),BigInt(0)),BigInt(1));
});
test('missing or foreign basis and invalid currency/precision never produce fabricated zero costs',()=>{
 for(const change of [{currency:'usd'},{amount:'-1'},{amount:'0'},{amount:'0.0000001'},{amount:1},{method:'other'},{basis:[{lineId:'a'},{lineId:'a'}]},{basis:[{lineId:'a'},{lineId:'foreign'}]},{basis:[]},{method:'CHARGEABLE_WEIGHT',basis:[{lineId:'a',unitWeightKg:'0',unitDimensionalWeightKg:'0'},{lineId:'b',unitWeightKg:'2',unitDimensionalWeightKg:'1'}]}])assert.throws(()=>allocateLocalCost({...input,...change},lines));
});
test('explicitly confirmed zero actual bill allocates zero without fabricating missing amounts',()=>{
 const result=allocateLocalCost({...input,stage:'ACTUAL',amount:'0'},lines);
 assert.equal(result.amount,'0.000000');
 assert.ok(result.lines.every(row=>row.allocatedAmount==='0.000000'));
 assert.deepEqual(readLocalCost(result,lines),result);
 assert.throws(()=>allocateLocalCost({...input,stage:'ACTUAL',amount:null},lines));
});
test('shipment-box-SKU allocation reconciles at every tier and persists the rounding path',()=>{
 const rows=[{id:'a',quantity:2},{id:'b',quantity:1},{id:'c',quantity:1}];
 const raw={...input,amount:'0.000002',basis:rows.map(row=>({lineId:row.id})),hierarchy:{shipments:[{shipmentId:'s1',boxes:[{number:'b1',items:[{lineId:'a',quantity:1},{lineId:'b',quantity:1}]},{number:'b2',items:[{lineId:'a',quantity:1}]}]},{shipmentId:'s2',boxes:[{number:'b3',items:[{lineId:'c',quantity:1}]}]}]}};
 const result=allocateLocalCost(raw,rows);
 assert.ok(result.hierarchy);
 for(const shipment of result.hierarchy.shipments){
  assert.equal(shipment.boxes.reduce((n,box)=>n+micros(box.allocatedAmount),BigInt(0)),micros(shipment.allocatedAmount));
  for(const box of shipment.boxes)assert.equal(box.items.reduce((n,item)=>n+micros(item.allocatedAmount),BigInt(0)),micros(box.allocatedAmount));
 }
 assert.equal(result.lines.reduce((n,row)=>n+micros(row.allocatedAmount),BigInt(0)),BigInt(2));
 assert.deepEqual(readLocalCost(JSON.parse(JSON.stringify(result)),rows),result);
 assert.deepEqual(allocateLocalCost({...raw,hierarchy:{shipments:[...raw.hierarchy.shipments].reverse()}},rows),result);
 assert.throws(()=>allocateLocalCost({...raw,hierarchy:{shipments:[raw.hierarchy.shipments[0]]}},rows));
 assert.throws(()=>allocateLocalCost({...raw,hierarchy:{shipments:[raw.hierarchy.shipments[0],raw.hierarchy.shipments[0]]}},rows));
});
