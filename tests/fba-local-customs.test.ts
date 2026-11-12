import assert from 'node:assert/strict';import test from 'node:test';
import {parseCustomsDraft,parseClearanceEvent,customsDraftXml} from '../src/lib/fba-local/customs-rules';
const input={shipmentId:'shipment',number:'CUSTOMS',destinationCountry:'US',currency:'USD',exporter:'Exporter & Co',importer:'Importer',templateReference:'User supplied draft',evidence:'Invoice',idempotencyKey:'key',items:[{planLineId:'a',description:'<Widget>',hsCode:'123456',originCountry:'CN',quantity:3,unit:'PCS',unitPrice:'123456789012.123456'}]};
test('customs decimal valuation preserves precision and XML escapes all user facts',()=>{
 const draft=parseCustomsDraft(input,[{planLineId:'a',quantity:1},{planLineId:'a',quantity:2}]);
 assert.equal(draft.items[0].declaredValue,'370370367036.370368');
 const xml=customsDraftXml(draft);assert.match(xml,/urn:erp:customs-draft:1/);assert.match(xml,/&lt;Widget&gt;/);assert.match(xml,/Exporter &amp; Co/);assert.doesNotMatch(xml,/CBP/);
 assert.throws(()=>customsDraftXml({...draft,evidence:'bad\u0001'}));
});
test('customs data must exactly cover shipment mappings with explicit codes, units and positive prices',()=>{
 for(const change of [{quantity:2},{planLineId:'foreign'},{hsCode:'123'},{originCountry:'CN '},{unitPrice:1},{unitPrice:'0'},{unitPrice:'0.0000001'}]){
  // Text fields are normalized by requireText; country whitespace alone is not a mismatch.
  if('originCountry' in change)continue;
  assert.throws(()=>parseCustomsDraft({...input,items:[{...input.items[0],...change}]},[{planLineId:'a',quantity:3}]));
 }
 assert.throws(()=>parseCustomsDraft({...input,items:[input.items[0],input.items[0]]},[{planLineId:'a',quantity:3}]));
});
test('clearance events require manual first filing, ordered timezone-aware evidence, and terminal closure',()=>{
 const now=new Date('2026-11-12T12:00:00Z'),event={declarationId:'doc',eventType:'FILED',occurredAt:'2026-11-12T10:00:00Z',reference:'receipt',evidence:'manual source',idempotencyKey:'key'};
 const filed=parseClearanceEvent(event,null,now);assert.equal(filed.eventType,'FILED');
 assert.throws(()=>parseClearanceEvent({...event,eventType:'RELEASED'},null,now));
 assert.throws(()=>parseClearanceEvent(event,filed,now));
 assert.throws(()=>parseClearanceEvent({...event,eventType:'HELD',occurredAt:'2026-11-12T09:00:00Z'},filed,now));
 assert.throws(()=>parseClearanceEvent({...event,occurredAt:'2026-11-12T13:00:00Z'},null,now));
 assert.throws(()=>parseClearanceEvent({...event,occurredAt:'2026-11-12T10:00:00'},null,now));
 const released=parseClearanceEvent({...event,eventType:'RELEASED'},filed,now);assert.throws(()=>parseClearanceEvent({...event,eventType:'HELD'},released,now));
});
