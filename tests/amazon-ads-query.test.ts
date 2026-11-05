import { test } from "node:test";
import assert from "node:assert/strict";
import { AdsQueryError, parseAdsQuery } from "../src/lib/amazon-ads/query-contract";
import { buildAdsProfileWhere, queryAmazonAdsData, type AdsQueryRepository } from "../src/lib/amazon-ads/query-service";
import { parseAdsEntityQuery } from "../src/lib/amazon-ads/data-query";

const scope = { organizationId: "org-a", workspaceId: "ws-a" };

test("Ads parsers reject conflicting repeated parameters and aliases before choosing scope", () => {
  for (const raw of [
    "internalProfileId=internal-a&profileId=amazon-external-id",
    "profileRecordId=internal-a&internalProfileId=internal-b",
    "profileRecordId=internal-a&profileId=internal-b",
    "internalProfileId=one&internalProfileId=two",
    "sellerAccountId=one&sellerAccountId=two", "page=1&page=2",
    "sort=state&sortBy=externalId", "direction=asc&sortDirection=desc",
  ]) {
    for (const parse of [parseAdsQuery, parseAdsEntityQuery]) assert.throws(() => parse(new URLSearchParams(raw)), /冲突/);
  }
  for (const kind of ["entities", "reports"]) {
    const parsed = parseAdsQuery(new URLSearchParams(`kind=${kind}&profileRecordId=internal-a&internalProfileId=internal-a&profileId=internal-a&profileId=internal-a`));
    assert.equal(parsed.profileRecordId, "internal-a");
  }
  assert.equal(parseAdsEntityQuery(new URLSearchParams("internalProfileId=internal-a&profileId=internal-a")).internalProfileId, "internal-a");
});

test("Ads query contract bounds pagination, date range and supported sort fields", () => {
  const query = parseAdsQuery(new URLSearchParams({
    kind: "reports", profileId: "profile-a", from: "2026-11-01", to: "2026-11-05",
    page: "2", pageSize: "25", sortBy: "spend", sortDirection: "asc",
  }), new Date("2026-11-06T00:00:00Z"));
  assert.equal(query.kind, "reports");
  assert.equal(query.profileRecordId, "profile-a");
  assert.equal(query.from, "2026-11-01");
  assert.equal(query.to, "2026-11-05");
  assert.equal(query.page, 2);
  assert.equal(query.sortBy, "spend");
  assert.throws(() => parseAdsQuery(new URLSearchParams({ sortBy: "rawDimensions" })), AdsQueryError);
  assert.throws(() => parseAdsQuery(new URLSearchParams({ from: "2026-11-01" })), AdsQueryError);
  assert.throws(() => parseAdsQuery(new URLSearchParams({ from: "2025-01-01", to: "2026-11-05" })), AdsQueryError);
});

test("Ads profile scope preserves seller and marketplace grant pairs", () => {
  const where = buildAdsProfileWhere(scope, {
    allSellers: false,
    sellerIds: ["seller-a"],
    scopes: [{ sellerAccountId: "seller-a", marketplaceIds: ["US"] }],
  }, { profileRecordId: undefined, sellerAccountId: undefined, authorizationId: undefined, marketplaceId: undefined });
  assert.deepEqual(where, {
    AND: [
      { organizationId: "org-a" },
      { workspaceId: "ws-a" },
      { OR: [{ sellerAccountId: "seller-a", marketplaceId: { in: ["US"] } }] },
    ],
  });
});

test("Ads query service returns structure pagination, freshness and source metadata", async () => {
  const repository: AdsQueryRepository = {
    async listProfiles() {
      return [{
        id: "profile-a", authorizationId: "auth-a", profileId: "amazon-profile-a", region: "NA", countryCode: "US",
        marketplaceId: "ATVPDKIKX0DER", currencyCode: "USD", timezone: "America/Los_Angeles", sellerAccountId: "seller-a",
        authorization: { id: "auth-a", name: "fixture", status: "CONNECTED" }, seller: { displayName: "Store A" },
        syncPlans: [{ id: "plan-a", status: "ACTIVE", lastSuccessAt: new Date("2026-11-06T01:00:00Z"), lastErrorCode: null, tasks: [] }],
      }];
    },
    async countEntities() { return 0; },
    async listEntities() { return []; },
    async listFreshness() { return [{ profileId: "profile-a", dataDomain: "entities", reportType: "", status: "CURRENT", coveredFrom: new Date("2026-11-05T00:00:00Z"), coveredTo: new Date("2026-11-05T00:00:00Z"), lastAttemptAt: new Date("2026-11-06T00:00:00Z"), lastSuccessAt: new Date("2026-11-06T01:00:00Z"), warningCodes: [], lastTaskId: "task-a" }]; },
  };
  const result = await queryAmazonAdsData(scope, "user-a", parseAdsQuery(new URLSearchParams({ kind: "entities", profileId: "profile-a" }), new Date("2026-11-06T00:00:00Z")), {
    repository,
    resolveAccess: async () => ({ allSellers: false, sellerIds: ["seller-a"], scopes: [{ sellerAccountId: "seller-a", marketplaceIds: ["ATVPDKIKX0DER"] }] }),
    audit: async () => undefined,
  });
  assert.equal(result.pagination.total, 0);
  assert.deepEqual(result.rows, []);
  assert.equal(result.totals, null);
  assert.equal(result.freshness.status, "CURRENT");
  assert.equal(result.source, "amazon_ads_postgres");
});

test("structure freshness is conservative across states, missing Profiles and plan-only success", async () => {
  const profile = (id: string) => ({
    id, authorizationId: "auth-a", profileId: `amazon-${id}`, region: "NA", countryCode: "US", marketplaceId: "US", currencyCode: "USD", timezone: "UTC", sellerAccountId: "seller-a",
    authorization: { id: "auth-a", name: "fixture", status: "CONNECTED" }, seller: { displayName: "fixture" },
    syncPlans: [{ id: `plan-${id}`, status: "ACTIVE", lastSuccessAt: new Date("2030-01-01T00:00:00Z"), lastErrorCode: null, tasks: [] }],
  });
  const cases: Array<[string[], string]> = [
    [["CURRENT", "CURRENT"], "CURRENT"], [["SYNCING", "CURRENT"], "SYNCING"], [["RETRY_WAIT", "CURRENT"], "SYNCING"],
    [["FAILED", "CURRENT"], "FAILED"], [["BLOCKED", "CURRENT"], "FAILED"], [["STALE", "CURRENT"], "PARTIAL"],
    [["CURRENT"], "PARTIAL"], [["UNKNOWN", "CURRENT"], "PARTIAL"], [["CANCELLED", "CURRENT"], "PARTIAL"],
    [["UNKNOWN", "NEW_UNRECOGNIZED_STATUS"], "UNKNOWN"], [["CANCELLED", "CANCELED"], "PARTIAL"],
    [["WAITING_FOR_CONFIG", "CURRENT"], "SYNCING"], [[], "UNKNOWN"],
  ];
  for (const [statuses, expected] of cases) {
    const repository: AdsQueryRepository = {
      async listProfiles() { return [profile("profile-0"), profile("profile-1")]; },
      async listEntities() { return []; }, async countEntities() { return 0; },
      async listFreshness(_scope, _ids, domain, reportType) {
        assert.equal(domain, "entities"); assert.equal(reportType, undefined, "entity filter must not bypass the domain state");
        return statuses.map((status, i) => ({ profileId: `profile-${i}`, dataDomain: domain, reportType: "", status, coveredFrom: null, coveredTo: null, lastAttemptAt: null, lastSuccessAt: null, warningCodes: [], lastTaskId: null }));
      },
    };
    const result = await queryAmazonAdsData(scope, "actor", parseAdsQuery(new URLSearchParams({ kind: "entities", entityType: "SP:keyword" })), {
      repository, resolveAccess: async () => ({ allSellers: true, sellerIds: [] }), audit: async () => {},
    });
    assert.equal(result.freshness.status, expected, JSON.stringify(statuses));
    assert.equal(result.meta.coverage, expected);
    assert.equal(result.meta.lastSyncAt, null, "plan success must not manufacture data-domain success");
    assert.equal(result.syncedAt, null);
    if (!statuses.length) assert.ok(result.meta.profiles.every(p => p.freshness === "UNKNOWN"));
    assert.ok(result.meta.profiles.every(p => p.freshness !== "ACTIVE"));
  }
});
