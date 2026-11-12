import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseInventoryRiskPolicy,parseInventoryRiskEvidence,assessInventoryRisk} from '../src/lib/wms/inventory-risk-rules';
import {renderStocktakePrint} from '../src/lib/wms/stocktake-print';
import {inventoryRiskCsv} from '../src/lib/wms/inventory-risk-export';
const policy={reference:'Explicit target policy',currency:'USD',windowDays:30,maximumSoldQty:'1',expenseAccount:'IMPAIRMENT',allowanceAccount:'ALLOWANCE'};
const source={productRecordId:'P',salesFrom:'2026-10-13',salesTo:'2026-11-12',soldQty:'0',salesCoverage:'COMPLETE',salesReference:'SKU-window evidence',carryingAmount:'100.123456',netRealizableAmount:'80.000001',existingProvision:'2.000001',valuationReference:'Target valuation and provision ledger'};
const stock={productRecordId:'P',sku:'=unsafe',quantity:'5',dataStatus:'COMPLETE',estimate:{days365Plus:'5'}};
test('inventory risk preserves exact provision differences and explicit policy with source window',()=>{
 const result=assessInventoryRisk([stock],'2026-11-12',parseInventoryRiskPolicy(policy),parseInventoryRiskEvidence([source]));assert.equal(result.items[0].stagnant,true);assert.equal(result.items[0].proposedProvision,'20.123455');assert.equal(result.provisionDelta,'18.123454');assert.equal(result.voucher?.lines[0].debit,'18.123454');assert.equal(result.postingExecuted,false);
 const release=assessInventoryRisk([stock],'2026-11-12',parseInventoryRiskPolicy(policy),parseInventoryRiskEvidence([{...source,netRealizableAmount:'120',existingProvision:'2'}]));assert.equal(release.provisionDelta,'-2.000000');assert.equal(release.voucher?.lines[0].account,'ALLOWANCE');
 assert.throws(()=>parseInventoryRiskPolicy({...policy,windowDays:0}));assert.throws(()=>assessInventoryRisk([stock],'2026-11-12',parseInventoryRiskPolicy(policy),parseInventoryRiskEvidence([{...source,salesFrom:'2026-10-14'}])));
});
test('unknown sales and valuation evidence stays NEEDS_DATA instead of fabricating zero',()=>{
 const result=assessInventoryRisk([stock],'2026-11-12',parseInventoryRiskPolicy(policy),parseInventoryRiskEvidence([{...source,salesCoverage:'MISSING',soldQty:null,netRealizableAmount:null}]));assert.equal(result.status,'NEEDS_DATA');assert.equal(result.items[0].stagnant,null);assert.equal(result.items[0].proposedProvision,null);assert.equal(result.provisionDelta,null);assert.equal(result.voucher,null);
 assert.throws(()=>parseInventoryRiskEvidence([{...source,soldQty:null}]));assert.throws(()=>parseInventoryRiskEvidence([source,source]));assert.throws(()=>assessInventoryRisk([stock],'2026-11-12',parseInventoryRiskPolicy(policy),parseInventoryRiskEvidence([{...source,productRecordId:'OTHER'}])));
});
test('blind print allow-list never exposes baseline, differences or raw fields even after review',()=>{
 const raw={number:'<script>unsafe</script>',status:'REVIEW',mode:'FULL',blind:true,revision:2,secret:'987654321',locations:[{location:{code:'A&1'},lines:[{lot:{lotCode:'LOT',barcode:'B'},countedQty:1,baselineOnHand:987654321,baselineReserved:12345,secret:'987654321'}]}]};
 const result=renderStocktakePrint(raw);assert.ok(!result.html.includes('987654321'));assert.ok(!result.html.includes('12345'));assert.ok(!result.html.includes('<script>'));assert.ok(result.html.includes('&lt;script&gt;'));assert.equal(result.document.locations[0].lines[0].baselineOnHand,undefined);
 const normal=renderStocktakePrint({...raw,blind:false});assert.ok(normal.html.includes('987654321'));
});
test('risk CSV keeps unknown values empty, exact amounts and rejects spreadsheet formula execution',()=>{
 const result=assessInventoryRisk([stock],'2026-11-12',parseInventoryRiskPolicy(policy),parseInventoryRiskEvidence([source]));const csv=inventoryRiskCsv({id:'R',snapshotId:'S',status:'DRAFT',requestHash:'h',result});assert.ok(csv.includes("'=unsafe"));assert.ok(csv.includes('18.123454'));assert.ok(csv.includes('"false"'));
});

test('opposite product corrections preserve both gross provision legs when net is zero',()=>{
 const evidence=parseInventoryRiskEvidence([{...source,carryingAmount:'10',netRealizableAmount:'8',existingProvision:'0'},{...source,productRecordId:'OTHER',carryingAmount:'10',netRealizableAmount:'10',existingProvision:'2'}]);
 const result=assessInventoryRisk([stock,{...stock,productRecordId:'OTHER'}],'2026-11-12',parseInventoryRiskPolicy(policy),evidence);assert.equal(result.provisionDelta,'0.000000');assert.equal(result.provisionIncrease,'2.000000');assert.equal(result.provisionRelease,'2.000000');assert.equal(result.voucher?.lines.length,4);
});
