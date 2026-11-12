import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseExternalOperationRecord, parseExternalResolution } from '../src/lib/fba-local/external-operation-rules';
import { inboundWriteReadiness } from '../src/lib/fba-local/external-operation-contract';
const input = { idempotencyKey: 'one', step: 'PLAN', operationName: 'createInboundPlan', requestDigest: 'a'.repeat(64), evidence: 'Original attempt evidence' };
test('uncertainty record has a business digest and never enables remote execution', () => {
  assert.equal(parseExternalOperationRecord(input).requestDigest, input.requestDigest);
  assert.equal(inboundWriteReadiness.enabled, false);
  assert.equal(inboundWriteReadiness.apiVersion, '2024-03-20');
  assert.throws(() => parseExternalOperationRecord({ ...input, requestDigest: 'request-id' }));
  assert.throws(() => parseExternalOperationRecord({ ...input, step: 'arbitrary' }));
  assert.throws(() => parseExternalOperationRecord({ ...input, accessToken: 'not-accepted' }));
});
test('resolution requires evidence and successful external identity, never retry command', () => {
  assert.equal(parseExternalResolution({ recordId: 'r', result: 'SUCCEEDED', operationId: 'op', evidence: 'Independent verification' }).result, 'SUCCEEDED');
  assert.throws(() => parseExternalResolution({ recordId: 'r', result: 'SUCCEEDED', evidence: 'no identity' }));
  assert.throws(() => parseExternalResolution({ recordId: 'r', result: 'RETRY', evidence: 'unsafe retry' }));
});

test('V2 workflow evidence requires unique returned IDs, explicit timezones and bounded payloads',async()=>{
 const {parseWorkflowOptionSnapshot}=await import('../src/lib/fba-local/workflow-options');
 const input={idempotencyKey:'options',kind:'PLACEMENT',externalPlanId:'AMZ-PLAN',operationId:'AMZ-OPERATION',capturedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),evidence:'Returned option evidence',options:[{optionId:'AMZ-ID',payload:{shipmentIds:['SHIPMENT']}}]};
 assert.equal(parseWorkflowOptionSnapshot(input).options[0].optionId,'AMZ-ID');
 assert.throws(()=>parseWorkflowOptionSnapshot({...input,options:[input.options[0],input.options[0]]}));
 assert.throws(()=>parseWorkflowOptionSnapshot({...input,expiresAt:'2026-12-01T00:00:00'}));
 assert.throws(()=>parseWorkflowOptionSnapshot({...input,options:[{optionId:'AMZ-ID',payload:{oversized:'x'.repeat(50001)}}]}));
});
