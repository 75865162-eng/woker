import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "@/lib/amazon-sync/approval-policy";
import { parseAdsReportReplica } from "@/lib/amazon-ads/report-replica-contract";
const sign = (input: Record<string, unknown>) => { const { digest: unused, ...body } = input; void unused; return { ...body, digest: digest(body) }; };
function fixture() {
  return sign({ version: 1, domain: "ads-reports", profileRecordId: "profile", amazonProfileId: "official-profile", sellerAccountId: "seller", marketplaceId: "site", region: "NA", currencyCode: "USD", timezone: "America/Los_Angeles", versions: [{ id: "version", requestedFrom: "2026-11-01T00:00:00.000Z", requestedTo: "2026-11-01T00:00:00.000Z", rowCount: 1, publishedAt: "2026-11-02T01:00:00.000Z", sourceTask: { id: "task", stage: "COMPLETED_REPORT", finishedAt: "2026-11-02T01:00:00.000Z" }, facts: [{ reportType: "spCampaigns", adProduct: "SP", reportDate: "2026-11-01T00:00:00.000Z", factKey: "fact", campaignId: "campaign", adGroupId: null, targetingId: null, advertisedAsin: null, searchTerm: null, placement: null, impressions: "9007199254740993", clicks: null, spend: "12345678901234.123456", orders: "0", sales: null, units: null, currencyCode: "USD", attributionWindow: "7d", apiVersion: "fixture-v1", rawDimensions: { future: [{ metric: "1.2300" }] }, syncedAt: "2026-11-02T01:00:00.000Z" }] }] });
}
test("report replica preserves exact big integers, decimals, nulls, dates and unknown dimensions", () => {
  const value = parseAdsReportReplica(fixture());
  assert.equal(value.versions[0].facts[0].impressions, "9007199254740993");
  assert.equal(value.versions[0].facts[0].spend, "12345678901234.123456");
  assert.equal(value.versions[0].facts[0].clicks, null);
  assert.deepEqual(value.versions[0].facts[0].rawDimensions, { future: [{ metric: "1.2300" }] });
});
test("report replica rejects count mismatches, out-of-window facts, secrets and corrupt data", () => {
  const value = parseAdsReportReplica(fixture()), version = value.versions[0], row = version.facts[0];
  const changeFact = (change: Record<string, unknown>) => sign({ ...value, versions: [{ ...version, facts: [{ ...row, ...change }] }] });
  assert.throws(() => parseAdsReportReplica(sign({ ...value, versions: [{ ...version, rowCount: 2 }] })));
  assert.throws(() => parseAdsReportReplica(changeFact({ reportDate: "2026-11-03T00:00:00.000Z" })));
  assert.throws(() => parseAdsReportReplica(changeFact({ impressions: "9223372036854775808" })));
  assert.throws(() => parseAdsReportReplica(changeFact({ impressions: 9007199254740992 })));
  assert.throws(() => parseAdsReportReplica(changeFact({ spend: "0.1234567" })));
  assert.throws(() => parseAdsReportReplica(changeFact({ rawDimensions: { nested: { accessToken: "secret" } } })));
  assert.throws(() => parseAdsReportReplica(changeFact({ unknownColumn: true })));
  assert.throws(() => parseAdsReportReplica({ ...value, versions: [] }));
});
test("report replica accepts explicitly empty published versions, rejects duplicate identities and capacity overflow", () => {
  const value = parseAdsReportReplica(fixture()), version = value.versions[0];
  assert.equal(parseAdsReportReplica(sign({ ...value, versions: [{ ...version, rowCount: 0, facts: [] }] })).versions[0].rowCount, 0);
  assert.throws(() => parseAdsReportReplica(sign({ ...value, versions: [version, version] })));
  assert.throws(() => parseAdsReportReplica(sign({ ...value, versions: [{ ...version, rowCount: 2, facts: [version.facts[0], version.facts[0]] }] })));
  assert.throws(() => parseAdsReportReplica(sign({ ...value, versions: Array.from({ length: 51 }, (_, index) => ({ ...version, id: `version-${index}`, sourceTask: { ...version.sourceTask, id: `task-${index}` } })) })));
});
