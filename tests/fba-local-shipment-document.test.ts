import assert from 'node:assert/strict';import test from 'node:test';
import {parseShipmentDocument} from '../src/lib/fba-local/shipment-document-rules';
const base={shipmentId:'shipment',number:'doc',evidence:'Manual receipt',idempotencyKey:'key'};
test('appointments, insurance and containers have separate strict contracts with explicit references',()=>{
 const appointment=parseShipmentDocument({...base,kind:'DELIVERY_APPOINTMENT',payload:{startsAt:'2026-11-12T10:00:00-05:00',endsAt:'2026-11-12T11:00:00-05:00',facilityReference:'Warehouse receipt',bookingReference:'Booking receipt'}});assert.equal(appointment.payload.startsAt,'2026-11-12T15:00:00.000Z');
 const insurance=parseShipmentDocument({...base,kind:'INSURANCE',payload:{insurer:'Insurer',currency:'USD',insuredAmount:'9007199254740993.000001',coverFrom:'2026-11-12T00:00:00Z',coverTo:'2026-12-12T00:00:00Z'}});assert.equal(insurance.payload.insuredAmount,'9007199254740993.000001');
 const container=parseShipmentDocument({...base,kind:'CONTAINER',payload:{containerNumber:'Container',sealNumber:'Seal',billOfLading:'BOL',boxNumbers:['B2','B1']}});assert.deepEqual(container.payload.boxNumbers,['B1','B2']);
 assert.throws(()=>parseShipmentDocument({...base,kind:'CONTAINER',payload:{containerNumber:'C',sealNumber:'S',billOfLading:'B',boxNumbers:['B','B']}}));
 assert.throws(()=>parseShipmentDocument({...base,kind:'DELIVERY_APPOINTMENT',payload:{...appointment.payload,endsAt:appointment.payload.startsAt}}));
 assert.throws(()=>parseShipmentDocument({...base,kind:'INSURANCE',payload:{...insurance.payload,insuredAmount:1}}));
 assert.throws(()=>parseShipmentDocument({...base,kind:'DELIVERY_APPOINTMENT',payload:{...appointment.payload,startsAt:'2026-02-30T10:00:00Z'}}));
 assert.throws(()=>parseShipmentDocument({...base,kind:'QUOTA',payload:{}}));
});
