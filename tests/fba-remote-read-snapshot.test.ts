import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeRemoteReadSnapshot} from '../src/lib/fba-local/remote-read-snapshot';
const request={pathParameters:{inboundPlanId:'PLAN',shipmentId:'SHIP'}};
test('remote read persists exact source DTO fields and decimal lexemes without physical receipt inference',()=>{
 const value=normalizeRemoteReadSnapshot('listShipmentBoxes',request,'{"boxes":[{"boxId":"BOX","quantity":1,"weight":{"unit":"KG","value":9007199254740993.000001},"dimensions":{"height":1.2,"length":2,"width":3,"unitOfMeasurement":"CM"},"items":[{"msku":"SKU","quantity":2,"fnsku":"FNSKU","manufacturingLotCode":"LOT"}],"inventedReceived":999}],"pagination":{"nextToken":"SECRET"}}')!;
 assert.equal(value.continuationTokenPresent,true);assert.equal(value.pageComplete,true);
 const data=JSON.stringify(value.normalized);assert.ok(data.includes('9007199254740993.000001'));assert.ok(!data.includes('SECRET'));assert.ok(!data.includes('inventedReceived'));
 assert.equal(value.normalized.quantitySemantics,'AMAZON_DECLARED_NOT_PHYSICAL_RECEIPT');assert.equal(value.normalized.planReceiptCompletenessVerified,false);
});
test('remote shipment status remains a source observation, including DELIVERED',()=>{
 const result=normalizeRemoteReadSnapshot('getShipment',request,'{"shipmentId":"SHIP","status":"DELIVERED","destination":{"warehouseId":"WAREHOUSE"},"selectedTransportationOptionId":"TRANSPORT","trackingDetails":{}}')!;
 assert.equal((result.normalized.facts as {status:string}).status,'DELIVERED');assert.equal(result.shipmentId,'SHIP');assert.equal(result.normalized.planReceiptCompletenessVerified,false);
 assert.throws(()=>normalizeRemoteReadSnapshot('getShipment',request,'{"shipmentId":"OTHER"}'));
 assert.throws(()=>normalizeRemoteReadSnapshot('getInboundPlan',request,'{"inboundPlanId":"OTHER"}'));
});
test('list shape and bounded source identity required; empty pages are explicit and retain scope',()=>{
 assert.throws(()=>normalizeRemoteReadSnapshot('listShipmentItems',request,'{}'));
 const result=normalizeRemoteReadSnapshot('listShipmentItems',request,'{"items":[],"pagination":{}}')!;
 assert.equal(result.continuationTokenPresent,false);assert.equal(result.normalized.coverage,'ONE_RESPONSE_PAGE');
 assert.equal(normalizeRemoteReadSnapshot('generatePlacementOptions',request,'{}'),null);
});
