import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDomains, closeDigest, parseClosePolicy, parseCloseEvidence } from '../src/lib/finance/close-rules';
const policy = { reference: 'target-policy-2026', requiredDomains: [...closeDomains], allowReopen: false };
test('business closing needs an explicit target policy and all source domains', () => {
  assert.deepEqual(parseClosePolicy(policy), policy);
  assert.throws(() => parseClosePolicy(null));
  assert.throws(() => parseClosePolicy({ ...policy, requiredDomains: ['COST'] }));
  assert.throws(() => parseClosePolicy({ ...policy, requiredDomains: [...closeDomains.slice(1), 'COST'] }));
  assert.throws(() => parseClosePolicy({ ...policy, allowReopen: 'true' }));
});
test('complete evidence is canonical and requires source references even for inapplicable domains', () => {
  const rows = closeDomains.map(domain => ({ domain, status: domain === 'ADS' ? 'NOT_APPLICABLE' : 'RECONCILED', evidence: `${domain}:source-scope-and-confirmation` }));
  assert.equal(closeDigest(parseCloseEvidence(rows, policy)), closeDigest(parseCloseEvidence([...rows].reverse(), policy)));
  assert.throws(() => parseCloseEvidence(rows.slice(1), policy));
  assert.throws(() => parseCloseEvidence(rows.map(row => row.domain === 'ADS' ? { ...row, evidence: '' } : row), policy));
  assert.throws(() => parseCloseEvidence(rows.map(row => row.domain === 'COST' ? { ...row, status: 'NEEDS_DATA' } : row), policy));
});

test('evidence digest survives JSONB object key order without hiding changed values or array order',()=>{
 assert.equal(closeDigest({b:2,a:{y:3,x:[{z:1,a:2}]}}),closeDigest({a:{x:[{a:2,z:1}],y:3},b:2}));
 assert.notEqual(closeDigest({a:[1,2]}),closeDigest({a:[2,1]}));
 assert.notEqual(closeDigest({a:'1'}),closeDigest({a:1}));
});
