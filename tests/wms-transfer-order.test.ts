import {stockAgeEstimate} from '../src/lib/wms/stock-aging-rules';
import {consumableQuantity} from '../src/lib/wms/consumable-rules';
import {inventoryHistoryRange} from '../src/lib/wms/inventory-history-query';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTransferOrderDraft, parseTransferOrderPayload, transferOrderStatus, validateTransferQuantities } from '../src/lib/wms/transfer-order-rules';
import { parseTransferDiscrepancyPayload, validateTransferDiscrepancy, sumDiscrepancyByCategory } from '../src/lib/wms/transfer-order-discrepancy-rules';
import { normalizeWmsPayload } from '../src/lib/wms/rules';
describe('WMS in-transit rules',()=>{
 const line={id:'l',quantity:10,shippedQty:6,receivedQty:2,discrepancyQty:0};
 it('keeps partial dispatch and signature separate until all goods arrive',()=>{
  assert.equal(transferOrderStatus([{...line,shippedQty:0,receivedQty:0}]),'DRAFT');
  assert.equal(transferOrderStatus([{...line,receivedQty:0}]),'PARTIALLY_SHIPPED');
  assert.equal(transferOrderStatus([{...line,shippedQty:10,receivedQty:0}]),'IN_TRANSIT');
  assert.equal(transferOrderStatus([line]),'PARTIALLY_RECEIVED');
  assert.equal(transferOrderStatus([{...line,shippedQty:10,receivedQty:10}]),'COMPLETED');
 });
 it('completes when received plus discrepancy equals shipped',()=>{
  assert.equal(transferOrderStatus([{...line,shippedQty:10,receivedQty:7,discrepancyQty:3}]),'COMPLETED');
  assert.equal(transferOrderStatus([{...line,shippedQty:10,receivedQty:0,discrepancyQty:10}]),'COMPLETED');
 });
 it('keeps PARTIALLY_RECEIVED when discrepancy does not zero out net in-transit',()=>{
  assert.equal(transferOrderStatus([{...line,shippedQty:10,receivedQty:7,discrepancyQty:1}]),'PARTIALLY_RECEIVED');
  assert.equal(transferOrderStatus([{...line,shippedQty:10,receivedQty:0,discrepancyQty:2}]),'PARTIALLY_RECEIVED');
 });
 it('treats lines without discrepancyQty as zero (old callers)',()=>{
  const legacy={id:'l',quantity:10,shippedQty:10,receivedQty:7} as {id:string;quantity:number;shippedQty:number;receivedQty:number;discrepancyQty:number};
  assert.equal(transferOrderStatus([legacy]),'PARTIALLY_RECEIVED');
 });
 it('rejects excess dispatch, excess signature and foreign lines',()=>{
  assert.throws(()=>validateTransferQuantities('TRANSFER_ORDER_SHIP',[{lineId:'l',quantity:5}],[line]));
  assert.throws(()=>validateTransferQuantities('TRANSFER_ORDER_RECEIVE',[{lineId:'l',quantity:5}],[line]));
  assert.throws(()=>validateTransferQuantities('TRANSFER_ORDER_RECEIVE',[{lineId:'foreign',quantity:1}],[line]));
  assert.doesNotThrow(()=>validateTransferQuantities('TRANSFER_ORDER_RECEIVE',[{lineId:'l',quantity:4}],[line]));
 });
 it('差异已分类数量不能再次签收入库，避免消耗已结清在途',()=>{
  const current={...line,quantity:10,shippedQty:6,receivedQty:2,discrepancyQty:4};
  assert.throws(()=>validateTransferQuantities('TRANSFER_ORDER_RECEIVE',[{lineId:'l',quantity:1}],[current]));
  assert.doesNotThrow(()=>validateTransferQuantities('TRANSFER_ORDER_RECEIVE',[{lineId:'l',quantity:1}],[{...current,discrepancyQty:3}]));
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
 it('routes discrepancy command to the discrepancy parser and enforces net in-transit',()=>{
  const raw={action:'TRANSFER_ORDER_DISCREPANCY',reference:'R',reason:'short',lines:[{lineId:'l',discrepancies:[{category:'SHORT_RECEIVED',quantity:2,evidence:'photo'},{category:'DAMAGED',quantity:2,evidence:'photo2'}]}]};
  const parsed=normalizeWmsPayload(raw) as ReturnType<typeof parseTransferDiscrepancyPayload>;
  assert.equal(parsed.action,'TRANSFER_ORDER_DISCREPANCY');
  assert.equal(parsed.lines[0].discrepancies.length,2);
  assert.deepEqual(sumDiscrepancyByCategory(parsed.lines[0].discrepancies),{SHORT_RECEIVED:2,DAMAGED:2,REJECTED:0});
  const current=[{id:'l',quantity:10,shippedQty:10,receivedQty:6,discrepancyQty:0}];
  assert.doesNotThrow(()=>validateTransferDiscrepancy(parsed.lines,current));
  assert.throws(()=>validateTransferDiscrepancy([{lineId:'l',discrepancies:[{category:'SHORT_RECEIVED',quantity:5,evidence:'x'}]}],current));
  assert.throws(()=>validateTransferDiscrepancy([{lineId:'foreign',discrepancies:[{category:'DAMAGED',quantity:1,evidence:'x'}]}],current));
 });
 it('rejects invalid category, duplicate category and blank evidence',()=>{
  const base=(discrepancies:unknown[])=>({action:'TRANSFER_ORDER_DISCREPANCY',reference:'R',reason:'why',lines:[{lineId:'l',discrepancies}]});
  assert.throws(()=>parseTransferDiscrepancyPayload(base([{category:'LOST',quantity:1,evidence:'x'}])));
  assert.throws(()=>parseTransferDiscrepancyPayload(base([{category:'DAMAGED',quantity:1,evidence:'x'},{category:'DAMAGED',quantity:1,evidence:'y'}])));
  assert.throws(()=>parseTransferDiscrepancyPayload(base([{category:'REJECTED',quantity:1,evidence:'  '}])));
  assert.throws(()=>parseTransferDiscrepancyPayload(base([{category:'REJECTED',quantity:0,evidence:'x'}])));
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
