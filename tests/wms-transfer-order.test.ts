import {stockAgeEstimate} from '../src/lib/wms/stock-aging-rules';
import {consumableQuantity} from '../src/lib/wms/consumable-rules';
import {inventoryHistoryRange} from '../src/lib/wms/inventory-history-query';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTransferOrderDraft, parseTransferOrderPayload, transferOrderStatus, validateTransferQuantities } from '../src/lib/wms/transfer-order-rules';
import { normalizeWmsPayload } from '../src/lib/wms/rules';
describe('WMS in-transit rules',()=>{
 const line={id:'l',quantity:10,shippedQty:6,receivedQty:2};
 it('keeps partial dispatch and signature separate until all goods arrive',()=>{
  assert.equal(transferOrderStatus([{...line,shippedQty:0,receivedQty:0}]),'DRAFT');
  assert.equal(transferOrderStatus([{...line,receivedQty:0}]),'PARTIALLY_SHIPPED');
  assert.equal(transferOrderStatus([{...line,shippedQty:10,receivedQty:0}]),'IN_TRANSIT');
  assert.equal(transferOrderStatus([line]),'PARTIALLY_RECEIVED');
  assert.equal(transferOrderStatus([{...line,shippedQty:10,receivedQty:10}]),'COMPLETED');
 });
 it('rejects excess dispatch, excess signature and foreign lines',()=>{
  assert.throws(()=>validateTransferQuantities('TRANSFER_ORDER_SHIP',[{lineId:'l',quantity:5}],[line]));
  assert.throws(()=>validateTransferQuantities('TRANSFER_ORDER_RECEIVE',[{lineId:'l',quantity:5}],[line]));
  assert.throws(()=>validateTransferQuantities('TRANSFER_ORDER_RECEIVE',[{lineId:'foreign',quantity:1}],[line]));
  assert.doesNotThrow(()=>validateTransferQuantities('TRANSFER_ORDER_RECEIVE',[{lineId:'l',quantity:4}],[line]));
 });
 it('requires explicit distinct routes, integral quantities and evidence',()=>{
  const row={sourceBalanceId:'b',targetLocationId:'t',quantity:1},draft={number:'N',reason:'R',idempotencyKey:'key',lines:[row]};
  assert.throws(()=>parseTransferOrderDraft({...draft,lines:[row,row]}));
  assert.throws(()=>parseTransferOrderDraft({...draft,lines:[{...row,quantity:1.5}]}));
  assert.throws(()=>parseTransferOrderPayload({action:'TRANSFER_ORDER_SHIP',reference:'',lines:[{lineId:'l',quantity:1}]}));
  assert.throws(()=>parseTransferOrderPayload({action:'TRANSFER_ORDER_CANCEL',reason:'R',approved:true}));
 });
 it('normalizes conversion with explicit target and justification',()=>{
  assert.deepEqual(normalizeWmsPayload({action:'SKU_CONVERT',targetLotId:'lot',reason:'Repack',quantity:2}),{action:'SKU_CONVERT',targetLotId:'lot',reason:'Repack',quantity:2});
  assert.throws(()=>normalizeWmsPayload({action:'SKU_CONVERT',targetLotId:'lot',reason:'',quantity:2}));
 });
});

it('keeps decimal material ratios exact and refuses fractional stock or overflow',()=>{
 assert.equal(consumableQuantity('0.5',2),1);
 assert.equal(consumableQuantity('0.000001',1000000),1);
 assert.throws(()=>consumableQuantity('0.5',1));
 assert.throws(()=>consumableQuantity('2',2147483647));
});
it('requires bounded explicit UTC history and half-open ordered periods',()=>{
 assert.throws(()=>inventoryHistoryRange('2026-01-01','2026-02-01'));
 assert.throws(()=>inventoryHistoryRange('2026-01-01T00:00:00Z','2025-01-01T00:00:00Z'));
 assert.throws(()=>inventoryHistoryRange('2020-01-01T00:00:00Z','2026-01-01T00:00:00Z'));
 assert.equal(inventoryHistoryRange('2026-01-01T00:00:00Z','2026-02-01T00:00:00Z').from.toISOString(),'2026-01-01T00:00:00.000Z');
});

it('ports Wimoor snapshot minus outbound buckets without inventing missing windows',()=>{
 const windows=[{days:30,snapshotQty:'80',outboundQty:'20'},{days:60,snapshotQty:'60',outboundQty:'20'},{days:90,snapshotQty:'50',outboundQty:'30'},{days:180,snapshotQty:'30',outboundQty:'20'},{days:365,snapshotQty:'10',outboundQty:'5'}];
 assert.deepEqual(stockAgeEstimate({quantity:'100',windows}),{days0To30:'40',days30To60:'20',days60To90:'20',days90To180:'10',days180To365:'5',days365Plus:'5',excessOver90DayOutbound:'70'});
 assert.equal(stockAgeEstimate({quantity:'100',windows:windows.map(row=>row.days===60?{...row,snapshotQty:null}:row)}),null);
 assert.equal(stockAgeEstimate({quantity:'1',windows}),null);
});
