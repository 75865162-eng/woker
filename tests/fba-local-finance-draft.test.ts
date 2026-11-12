import assert from 'node:assert/strict';import test from 'node:test';
import {parseFinanceDraftInput,calculateFinanceDraft} from '../src/lib/fba-local/finance-draft-rules';
const scope={organizationId:'org',workspaceId:'ws'};
const input={adjustmentId:'adjustment',idempotencyKey:'key',bookReference:'proposed',periodReference:'period',periodStart:'2026-01-01',periodEnd:'2026-12-31',date:'2026-11-12',payableAccountId:'payable',costAccounts:[{lineId:'a',accountId:'cost-a'},{lineId:'b',accountId:'cost-b'}],proposedSubjects:[{id:'cost-a',enabled:true,leaf:true,normalSide:'DEBIT'},{id:'cost-b',enabled:true,leaf:true,normalSide:'DEBIT'},{id:'payable',enabled:true,leaf:true,normalSide:'CREDIT'}],evidence:'Proposed mapping'};
const estimate={currency:'USD',lines:[{lineId:'a',allocatedAmount:'1'},{lineId:'b',allocatedAmount:'2'}]},actual={currency:'USD',lines:[{lineId:'a',allocatedAmount:'2'},{lineId:'b',allocatedAmount:'1'}]};
test('zero net difference retains opposing per-SKU adjustments with an exactly balanced draft',()=>{
 const result=calculateFinanceDraft(scope,parseFinanceDraftInput(input),'id',estimate,actual);
 assert.equal(result.summary.difference,'0.000000');assert.equal(result.voucher.lines.length,4);assert.equal(result.summary.debit,'2.000000');assert.equal(result.summary.credit,'2.000000');assert.equal(result.voucher.status,'DRAFT');assert.equal(result.summary.postingExecuted,false);assert.equal(result.summary.accountingConfigurationVerified,false);
});
test('mapping, dates, currency, enabled leaf subjects and values are explicit; missing facts never default',()=>{
 for(const change of [{periodStart:'2026-02-30'},{date:'2027-01-01'},{costAccounts:[{lineId:'foreign',accountId:'cost-a'}]},{proposedSubjects:input.proposedSubjects.map(row=>({...row,enabled:false}))},{costAccounts:input.costAccounts.map(row=>({...row,accountId:'payable'}))}])assert.throws(()=>calculateFinanceDraft(scope,parseFinanceDraftInput({...input,...change}),'id',estimate,actual));
 assert.throws(()=>calculateFinanceDraft(scope,parseFinanceDraftInput(input),'id',estimate,{...actual,currency:'EUR'}));
 assert.throws(()=>parseFinanceDraftInput({...input,postingExecuted:true}));
 assert.throws(()=>calculateFinanceDraft(scope,parseFinanceDraftInput(input),'id',estimate,estimate));
});
test('explicit FX evidence converts immutable estimate and actual before generating proposed-book entries',()=>{
 const conversion={sourceCurrency:'USD',targetCurrency:'CNY',rate:'7.123456789012',observedAt:'2026-11-12T00:00:00Z',reference:'Synthetic manual snapshot',evidence:'Synthetic rate evidence'};
 const result=calculateFinanceDraft(scope,parseFinanceDraftInput({...input,conversion}),'id',estimate,actual);
 assert.equal(result.voucher.currency,'CNY');assert.equal(result.summary.currency,'CNY');assert.equal(result.summary.debit,result.summary.credit);assert.deepEqual(result.summary.conversion,{...conversion,observedAt:'2026-11-12T00:00:00.000Z'});assert.equal(result.summary.accountingConfigurationVerified,false);
 assert.equal(estimate.currency,'USD');assert.equal(actual.lines[0].allocatedAmount,'2');
});
