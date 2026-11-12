import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCostRule,valueQuantity,valuationVoucher} from '../src/lib/wms/valuation-rules';
import {parseWmsCommand} from '../src/lib/wms/rules';
test('exact standard cost quantities, supported amount width and independent currencies',()=>{
 assert.equal(valueQuantity('0.100001',3),'0.300003');assert.equal(valueQuantity('999999999999999999.999999',200000),'199999999999999999999999.800000');
 assert.throws(()=>valueQuantity('999999999999999999.999999',2147483647));assert.throws(()=>valueQuantity(1 as unknown as string,1));assert.throws(()=>valueQuantity('0.0000001',1));
 const base={movementId:'m',ruleId:'r',quantity:3,unitCost:'0.100001',amount:'0.300003',debitAccount:'Inventory',creditAccount:'Offset'};
 const voucher=valuationVoucher([{...base,currency:'USD'},{...base,currency:'EUR'},{...base,currency:'USD',amount:'199999999999999999999999.800000'}]);
 assert.equal(voucher.postingExecuted,false);assert.deepEqual(voucher.totals,[{currency:'EUR',debit:'0.300003',credit:'0.300003'},{currency:'USD',debit:'200000000000000000000000.100003',credit:'200000000000000000000000.100003'}]);
});
test('cost sources and accounting explicitly supplied; no fallback accounts',()=>{
 const rule={lotId:'l',unitCost:'0',currency:'USD',inventoryAccount:'Inventory',offsetAccounts:{RECEIVE:'Payable'},reference:'Approved source'};
 assert.equal(parseCostRule(rule).unitCost,'0.000000');assert.throws(()=>parseCostRule({...rule,offsetAccounts:{}}));assert.throws(()=>parseCostRule({...rule,offsetAccounts:{RECEIVE:'Inventory'}}));assert.throws(()=>parseCostRule({...rule,currency:'usd'}));
 assert.throws(()=>parseWmsCommand({workspaceId:'default',aggregateId:'d',expectedRevision:1,idempotencyKey:'key',payload:{action:'VALUE_COMMAND',reason:'source',rules:[{movementId:'m',ruleId:'r'},{movementId:'m',ruleId:'x'}]}}));
});
