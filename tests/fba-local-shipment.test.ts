import assert from 'node:assert/strict';
import test from 'node:test';
import {parseShipmentMapping} from '../src/lib/fba-local/shipment-rules';
const lines=[{id:'lot-a',quantity:3},{id:'lot-b',quantity:4}];
const items=[{id:'source-row-1',sellerSku:'SKU',fnsku:'FNSKU',declaredQuantity:2},{id:'source-row-2',sellerSku:'SKU',fnsku:'FNSKU',declaredQuantity:3}];
const mappings=[{observationId:'source-row-1',planLineId:'lot-a',quantity:1},{observationId:'source-row-1',planLineId:'lot-b',quantity:1},{observationId:'source-row-2',planLineId:'lot-b',quantity:3}];
test('shipment mapping preserves distinct source occurrences for identical SKU and allows explicit lot splitting',()=>{
 const result=parseShipmentMapping(mappings,lines,items,[]);
 assert.equal(result.length,3);assert.equal(result.reduce((sum,row)=>sum+row.quantity,0),5);
 assert.deepEqual(parseShipmentMapping([...mappings].reverse(),lines,items,[]),result);
 assert.equal(result[0].sellerSku,'SKU');
});
test('every observed row must reconcile exactly rather than merging same-SKU rows',()=>{
 for(const change of [mappings.slice(1),[...mappings,{observationId:'source-row-2',planLineId:'lot-a',quantity:1}],[{observationId:'source-row-1',planLineId:'lot-b',quantity:5}]])assert.throws(()=>parseShipmentMapping(change,lines,items,[]));
});
test('current and prior shipments cannot allocate more than the local plan quantity',()=>{
 assert.throws(()=>parseShipmentMapping(mappings,lines,items,[{planLineId:'lot-b',quantity:1}]));
 assert.doesNotThrow(()=>parseShipmentMapping(mappings,lines,items,[{planLineId:'lot-a',quantity:2}]));
});
test('foreign identities, duplicate mappings, ambiguous counts and spoofed source fields are rejected',()=>{
 for(const patch of [{planLineId:'foreign'},{observationId:'foreign'},{quantity:0},{quantity:1.5},{quantity:'1'},{sellerSku:'spoof'}])assert.throws(()=>parseShipmentMapping([{...mappings[0],...patch},...mappings.slice(1)],lines,items,[]));
 assert.throws(()=>parseShipmentMapping([...mappings,mappings[0]],lines,items,[]));
 assert.throws(()=>parseShipmentMapping(mappings,lines,[items[0],items[0]],[]));
});
