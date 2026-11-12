import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseExternalSelector,amazonFinanceEvidence,adsSpendEvidence,externalDraftLines} from '../src/lib/finance/external-source-rules';
const financeSelector={kind:'AMAZON_FINANCE' as const,sellerAccountId:'S',marketplaceId:'US',transactionId:'T'};
const financeRow={...financeSelector,attributionStatus:'ATTRIBUTED',postedAt:'2026-11-12T10:00:00Z',amount:'-12.123456',currency:'USD',sourceId:'source',sourceRunId:'run',rowHash:'hash',observationSequence:1,classification:'fees',transactionType:'settlement',rawStatus:'released',marketplaceTimeZone:'America/Los_Angeles'};
const adsSelector={kind:'ADS_SPEND' as const,sellerAccountId:'S',marketplaceId:'US',profileRecordId:'P',reportType:'campaign',adProduct:'SP',date:'2026-11-12'};
const adsRow={amazonProfileId:'NATIVE-P',profileId:'P',sellerAccountId:'S',marketplaceId:'US',reportDate:'2026-11-12',reportType:'campaign',adProduct:'SP',versionStatus:'PUBLISHED',sourceTaskStatus:'SUCCEEDED',currencyCode:'USD',attributionWindow:'7d',factKey:'K',versionId:'V1',sourceTaskId:'TASK1',apiVersion:'source-v3',spend:'12.123456'};
test('Amazon finance source identity survives observations but fingerprint captures revised exact signed amount',()=>{
 assert.deepEqual(parseExternalSelector(financeSelector),financeSelector);const first=amazonFinanceEvidence(financeSelector,[financeRow]),second=amazonFinanceEvidence(financeSelector,[{...financeRow,amount:'-12.123457',observationSequence:2,rowHash:'revision'}]);assert.equal(first.economicKey,second.economicKey);assert.notEqual(first.sourceFingerprint,second.sourceFingerprint);assert.equal(first.amount,'-12.123456');assert.throws(()=>amazonFinanceEvidence(financeSelector,[{...financeRow,marketplaceId:null}]));assert.throws(()=>amazonFinanceEvidence(financeSelector,[{...financeRow,amount:null}]));
});
test('Ads claim covers daily economic spend across reports and revisions, rejects missing or truncated facts',()=>{
 const first=adsSpendEvidence(adsSelector,[adsRow],1,false),second=adsSpendEvidence({...adsSelector,reportType:'searchTerms'},[{...adsRow,reportType:'searchTerms',versionId:'V2',spend:'15'}],1,false);assert.equal(first.economicKey,second.economicKey);const reconnected=adsSpendEvidence({...adsSelector,profileRecordId:'NEW-INTERNAL-P'},[{...adsRow,profileId:'NEW-INTERNAL-P'}],1,false);assert.equal(first.economicKey,reconnected.economicKey);assert.notEqual(first.sourceFingerprint,second.sourceFingerprint);assert.equal(first.amount,'12.123456');assert.throws(()=>adsSpendEvidence(adsSelector,[{...adsRow,spend:null}],1,false));assert.throws(()=>adsSpendEvidence(adsSelector,[adsRow],2,true));assert.throws(()=>adsSpendEvidence(adsSelector,[adsRow,adsRow],2,false));
});
test('External amount sign only reverses explicitly mapped accounts without implicit business classification',()=>{
 const source=amazonFinanceEvidence(financeSelector,[financeRow]);assert.deepEqual(externalDraftLines(source,'USD','chosen-debit','chosen-credit'),[{subjectId:'chosen-debit',debit:'0.000000',credit:'12.123456'},{subjectId:'chosen-credit',debit:'12.123456',credit:'0.000000'}]);assert.throws(()=>externalDraftLines(source,'CNY','D','C'));assert.throws(()=>externalDraftLines(source,'USD','D','D'));
});

test('Ads accounting does not combine API generations with unrelated fact identities',()=>{
 assert.throws(()=>adsSpendEvidence(adsSelector,[adsRow,{...adsRow,factKey:'K2',apiVersion:'different-source-contract'}],2,false),/API 合同/);
 const exact=adsSpendEvidence(adsSelector,[adsRow,{...adsRow,factKey:'K2',spend:'0.000001'}],2,false);assert.equal(exact.amount,'12.123457');assert.equal(exact.provenance.apiVersion,'source-v3');
});
