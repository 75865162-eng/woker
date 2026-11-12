import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adsBusinessFingerprint, assertAdsDraftTransition, parseAdsBusinessPatch } from '../src/lib/amazon-ads/change-contract';
import { assertProductCompositionAcyclic, emptyProductManagement, parseProductManagement } from '../src/lib/products/management-contract';

test('business draft preserves exact decimals and refuses invented fields or unsupported products', () => {
  assert.deepEqual(parseAdsBusinessPatch('SP:keyword', { bid: '0.123456' }), { bid: '0.123456' });
  for (const value of [0.1, '0', '-1', 'NaN', '1e3', '0.0000001']) assert.throws(() => parseAdsBusinessPatch('SP:keyword', { bid: value }));
  for (const entity of ['SB:campaign', 'SD:campaign', 'unknown']) assert.throws(() => parseAdsBusinessPatch(entity, { state: 'PAUSED' }));
  assert.throws(() => parseAdsBusinessPatch('SP:negative-keyword', { bid: '1' }));
  assert.throws(() => parseAdsBusinessPatch('SP:campaign', { budget: '1' }));
  assert.throws(() => parseAdsBusinessPatch('SP:campaign', { placements: [{ placement: 'PLACEMENT_TOP', percentage: 901 }] }));
  assert.throws(() => parseAdsBusinessPatch('SP:campaign', { placements: [{ placement: 'PLACEMENT_TOP', percentage: 10 }, { placement: 'PLACEMENT_TOP', percentage: 20 }] }));
});
test('draft review requires another actor and terminal states cannot reopen', () => {
  assert.equal(assertAdsDraftTransition('DRAFT', 'submit', 'owner', 'owner'), 'SUBMITTED');
  assert.equal(assertAdsDraftTransition('SUBMITTED', 'approve', 'reviewer', 'owner'), 'APPROVED');
  assert.throws(() => assertAdsDraftTransition('SUBMITTED', 'approve', 'owner', 'owner'));
  assert.throws(() => assertAdsDraftTransition('DRAFT', 'submit', 'reviewer', 'owner'));
  assert.throws(() => assertAdsDraftTransition('APPROVED', 'execute', 'owner', 'owner'));
  assert.throws(() => assertAdsDraftTransition('REJECTED', 'submit', 'owner', 'owner'));
  assert.equal(adsBusinessFingerprint({ a: 1, b: { x: '1', y: null } }), adsBusinessFingerprint({ b: { y: null, x: '1' }, a: 1 }));
  assert.notEqual(adsBusinessFingerprint({ bid: '1.000001' }), adsBusinessFingerprint({ bid: '1.000002' }));
});
test('product contract preserves unknown packaging, scoped identifiers and positive bundle quantities', () => {
  const management = emptyProductManagement();
  assert.deepEqual(parseProductManagement(management), management);
  management.carton = { lengthCm: '12.000001', widthCm: null, heightCm: null, grossWeightG: null, unitsPerCarton: 12 };
  management.components = [{ productRecordId: 'part', quantity: 2, notes: '' }];
  assert.equal(parseProductManagement(management).carton!.lengthCm, '12.000001');
  assert.throws(() => parseProductManagement({ ...management, components: [{ productRecordId: 'part', quantity: 0, notes: '' }] }));
  assert.throws(() => parseProductManagement({ ...management, carton: { ...management.carton, lengthCm: 12 } }));
  assert.throws(() => parseProductManagement({ ...management, extra: true }));
  assert.throws(() => parseProductManagement({ ...management, components: [...management.components, ...management.components] }));
});
test('composition permits shared subcomponents but rejects direct and indirect cycles', () => {
  assertProductCompositionAcyclic('a', new Map([['a', ['b', 'c']], ['b', ['d']], ['c', ['d']]]));
  assert.throws(() => assertProductCompositionAcyclic('a', new Map([['a', ['a']]])));
  assert.throws(() => assertProductCompositionAcyclic('a', new Map([['a', ['b']], ['b', ['c']], ['c', ['a']]])));
});
