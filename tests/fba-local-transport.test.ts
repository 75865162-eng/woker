import assert from 'node:assert/strict';
import test from 'node:test';
import {nextTransportStatus,parseForwarderOrder,parseTrackingEvent} from '../src/lib/fba-local/transport-rules';
const order={number:'FWD-1',forwarder:'Carrier',channel:'Ocean LCL',mode:'OCEAN',destination:'Destination',idempotencyKey:'order-1'};
test('transport order preserves Wimoor carrier/channel references and explicit schedule timezone',()=>{
  const parsed=parseForwarderOrder({...order,containerNumber:'CONT',billOfLading:'BOL',vesselOrFlight:'V001',cutoffAt:'2026-11-01T10:00:00+08:00',departureEta:'2026-11-02T10:00:00+08:00',arrivalEta:'2026-12-02T10:00:00+08:00'});
  assert.equal(parsed.cutoffAt,'2026-11-01T02:00:00.000Z');
  assert.equal(parsed.vesselOrFlight,'V001');assert.equal(parseForwarderOrder(order).arrivalEta,null);
});
test('missing identities, fabricated Amazon IDs and invalid calendar or schedule are rejected',()=>{
  for(const patch of [{forwarder:''},{mode:'FBA'},{spApiShipmentId:'fake'},{cutoffAt:'2026-11-31T10:00:00Z'},{departureEta:'2026-11-01T10:00:00'},{departureEta:'2026-11-03T10:00:00Z',arrivalEta:'2026-11-02T10:00:00Z'},{cutoffAt:'2026-11-03T10:00:00Z',departureEta:'2026-11-02T10:00:00Z'}])assert.throws(()=>parseForwarderOrder({...order,...patch}));
});
test('tracking requires actual timestamp, place, evidence and bounded future tolerance',()=>{
  const raw={eventType:'DEPARTED',occurredAt:'2026-11-12T10:00:00Z',location:'Origin',evidence:'Carrier dispatch document',idempotencyKey:'event-1'};
  const now=Date.parse('2026-11-12T10:00:00Z');
  assert.equal(parseTrackingEvent(raw,now).occurredAt,'2026-11-12T10:00:00.000Z');
  for(const patch of [{evidence:''},{location:''},{source:'AMAZON'},{eventType:'RECEIVED_BY_AMAZON'},{occurredAt:'2026-11-12T10:06:00Z'},{occurredAt:'2026-11-12T24:00:00Z'}])assert.throws(()=>parseTrackingEvent({...raw,...patch},now));
});
test('transport state advances through actual milestones and terminal states cannot be rewritten',()=>{
  assert.equal(nextTransportStatus('BOOKED','NOTE'),'BOOKED');
  assert.equal(nextTransportStatus('BOOKED','DEPARTED'),'IN_TRANSIT');
  assert.equal(nextTransportStatus('IN_TRANSIT','ARRIVED'),'ARRIVED');
  assert.equal(nextTransportStatus('ARRIVED','CLEARED'),'CLEARED');
  assert.equal(nextTransportStatus('CLEARED','DELIVERED'),'DELIVERED');
  assert.equal(nextTransportStatus('IN_TRANSIT','DELIVERED'),'DELIVERED');
  for(const [state,event] of [['BOOKED','DELIVERED'],['IN_TRANSIT','DEPARTED'],['CLEARED','ARRIVED'],['DELIVERED','NOTE'],['CANCELLED','DEPARTED'],['unknown','NOTE']])assert.throws(()=>nextTransportStatus(state,event));
});
