import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "@/lib/amazon-sync/approval-policy";
import { parseAdsEntityReplica, adsReplicaVersion, adsEntityReplicaLimit } from "@/lib/amazon-ads/entity-replica-contract";
const sign = (body: Record<string, unknown>) => { const { digest: ignored, ...rest } = body; void ignored; return { ...rest, digest: digest(rest) }; };
function fixture() {
  return sign({ version: 1, domain: "ads-entities", profileRecordId: "profile", amazonProfileId: "official-profile", sellerAccountId: "seller", marketplaceId: "site", region: "NA", currencyCode: "USD", timezone: "America/Los_Angeles", exportedAt: "2026-11-10T02:00:00.000Z", rows: [{ entityType: "SP:keyword", externalId: "keyword", parentExternalId: "group", state: "ENABLED", name: null, adProduct: "SP", campaignId: "campaign", adGroupId: "group", startDate: null, endDate: null, targetingType: null, budgetAmount: "12345678901234.123456", budgetType: null, bid: "0.420001", keywordText: "fixture", matchType: "EXACT", expressionType: null, targetingExpression: null, payload: { futureMetric: "1.2300", nested: [{ extra: true }] }, sourceUpdatedAt: null, syncedAt: "2026-11-10T01:00:00.000Z", sourceTask: { id: "task", status: "SUCCEEDED", stage: "COMPLETED_SP_STRUCTURE", finishedAt: "2026-11-10T01:30:00.000Z" } }] });
}
test("ad entity replica retains exact decimals, nested unknown fields and source task", () => {
  const value = parseAdsEntityReplica(fixture());
  assert.equal(value.rows[0].budgetAmount, "12345678901234.123456");
  assert.deepEqual(value.rows[0].payload, { futureMetric: "1.2300", nested: [{ extra: true }] });
  const later = parseAdsEntityReplica(sign({ ...value, exportedAt: "2026-11-10T03:00:00.000Z" }));
  assert.equal(adsReplicaVersion(value), adsReplicaVersion(later));
});
test("ad replica rejects corrupted bodies, pending tasks, secrets and unknown schemas", () => {
  const value = parseAdsEntityReplica(fixture()), row = value.rows[0];
  assert.throws(() => parseAdsEntityReplica({ ...value, rows: [] }));
  assert.throws(() => parseAdsEntityReplica(sign({ ...value, rows: [{ ...row, sourceTask: { ...row.sourceTask, status: "RUNNING" } }] })));
  assert.throws(() => parseAdsEntityReplica(sign({ ...value, rows: [{ ...row, payload: { nested: { refreshToken: "secret" } } }] })));
  assert.throws(() => parseAdsEntityReplica(sign({ ...value, rows: [{ ...row, bid: 0.42 }] })));
  assert.throws(() => parseAdsEntityReplica(sign({ ...value, rows: [{ ...row, bid: "0.1234567" }] })));
  assert.throws(() => parseAdsEntityReplica(sign({ ...value, version: 2 })));
  assert.throws(() => parseAdsEntityReplica(sign({ ...value, rows: [{ ...row, unknownColumn: true }] })));
});
test("ad replica refuses duplicate identities, inconsistent tasks and partial capacity", () => {
  const value = parseAdsEntityReplica(fixture()), row = value.rows[0];
  assert.throws(() => parseAdsEntityReplica(sign({ ...value, rows: [row, row] })));
  assert.throws(() => parseAdsEntityReplica(sign({ ...value, rows: [row, { ...row, externalId: "second", sourceTask: { ...row.sourceTask, stage: "different" } }] })));
  assert.throws(() => parseAdsEntityReplica(sign({ ...value, rows: Array.from({ length: adsEntityReplicaLimit + 1 }, (_, index) => ({ ...row, externalId: `key-${index}` })) })));
});
