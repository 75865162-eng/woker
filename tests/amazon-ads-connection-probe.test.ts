import assert from "node:assert/strict";
import test from "node:test";
import { probeAmazonAdsConnection } from "../src/lib/amazon-ads/connection-probe";
import { AmazonAdsConnectionError, type AmazonAdsOAuthTransport } from "../src/lib/amazon-ads/oauth-contract";
import { createSponsoredProductsReadAdapter, type AdsReadAdapter } from "../src/lib/amazon-ads/sync-adapter";

const input = { region: "NA" as const, clientId: "fixture-client", clientSecret: "fixture-secret", refreshToken: "fixture-refresh", maxRequests: 4 };
function fixture() {
  const calls: string[] = [];
  const oauth: AmazonAdsOAuthTransport = {
    async exchangeAuthorizationCode() { throw new Error("unused"); },
    async refreshAccessToken() { calls.push("refresh"); return "fixture-access"; },
    async listProfiles() { calls.push("profiles"); return [{ profileId: "101", countryCode: "US", currencyCode: "USD", timezone: "America/Los_Angeles" }]; },
  };
  const structures: Pick<AdsReadAdapter, "readPage"> = { async readPage(request) {
    calls.push(request.stage);
    assert.equal(request.profileId, "101");
    assert.equal(request.cursor, null);
    return { complete: true, nextCursor: null, entities: [{ entityType: request.stage === "campaigns" ? "SP:campaign" : "SP:ad-group", externalId: "202", payload: {} }] };
  } };
  const authorized: string[] = [];
  return { calls, authorized, ports: { oauth, structures, async authorize(op: { stage: string }) { authorized.push(op.stage); } } };
}

test("first connection probe uses at most four requests, checks every operation and never claims persistence", async () => {
  const f = fixture();
  const result = await probeAmazonAdsConnection(input, f.ports);
  assert.equal(result.status, "READ_COMPLETE");
  assert.equal(result.persisted, false);
  assert.equal(result.apiRequests, 4);
  assert.deepEqual(f.calls, ["refresh", "profiles", "campaigns", "ad-groups"]);
  assert.deepEqual(f.authorized, f.calls);
  assert.equal(result.reads.length, 2);
  assert.equal(result.selectedProfileId, "101");
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|fixture-refresh|fixture-access|payload|nextCursor/);
});

test("budget exhaustion and revoked access prevent subsequent requests while preserving partial observations", async () => {
  const limited = fixture();
  const result = await probeAmazonAdsConnection({ ...input, maxRequests: 3 }, limited.ports);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.failure?.code, "ADS_CONNECTION_PROBE_BUDGET_EXHAUSTED");
  assert.equal(result.reads.length, 1);
  assert.deepEqual(limited.calls, ["refresh", "profiles", "campaigns"]);
  const revoked = fixture();
  revoked.ports.authorize = async op => { if (op.stage === "ad-groups") throw new Error("secret scope token"); };
  const denied = await probeAmazonAdsConnection(input, revoked.ports);
  assert.equal(denied.apiRequests, 3);
  assert.equal(denied.failure?.code, "ADS_CONNECTION_PROBE_FAILED");
  assert.equal(denied.failure?.stage, "ad-groups");
  assert.doesNotMatch(JSON.stringify(denied), /secret scope token/);
});

test("ambiguous, missing and inaccessible Profiles never trigger entity reads", async () => {
  const f = fixture();
  f.ports.oauth.listProfiles = async () => [{ profileId: "101", countryCode: "US" }, { profileId: "102", countryCode: "CA" }];
  assert.equal((await probeAmazonAdsConnection(input, f.ports)).status, "PROFILE_SELECTION_REQUIRED");
  assert.deepEqual(f.calls, ["refresh"]);
  assert.equal((await probeAmazonAdsConnection({ ...input, profileId: "999" }, f.ports)).failure?.code, "ADS_CONNECTION_PROBE_PROFILE_NOT_DISCOVERED");
  f.ports.oauth.listProfiles = async () => [];
  assert.equal((await probeAmazonAdsConnection(input, f.ports)).failure?.code, "ADS_CONNECTION_PROBE_NO_PROFILES");
});

test("pagination is reported as partial; no follow-up page, token or raw payload is returned", async () => {
  const f = fixture();
  f.ports.structures.readPage = async request => {
    f.calls.push(request.stage);
    return { complete: true, nextCursor: "private-cursor", entities: [] };
  };
  const result = await probeAmazonAdsConnection(input, f.ports);
  assert.equal(result.status, "READ_PARTIAL");
  assert.ok(result.reads.every(read => read.hasMore));
  assert.equal(result.apiRequests, 4);
  assert.doesNotMatch(JSON.stringify(result), /private-cursor/);
});

test("throttle evidence is returned without retry and invalid requests spend no budget", async () => {
  const f = fixture();
  f.ports.oauth.refreshAccessToken = async () => { f.calls.push("refresh"); throw new AmazonAdsConnectionError("REFRESH", "NA", "HTTP_429", 429, 90000); };
  const result = await probeAmazonAdsConnection(input, f.ports);
  assert.deepEqual(result.failure, { stage: "refresh", code: "ADS_CONNECTION_REFRESH_HTTP_429", retryable: true, retryAfterMs: 90000 });
  assert.equal(result.apiRequests, 1);
  for (const maxRequests of [0, 5, 1.5, NaN]) await assert.rejects(probeAmazonAdsConnection({ ...input, maxRequests }, f.ports), { code: "ADS_CONNECTION_PROBE_INPUT_INVALID" });
  assert.deepEqual(f.calls, ["refresh"]);
});

test("connection probe composes the existing real SP readers with injected HTTP only", async () => {
  const f = fixture();
  const paths: string[] = [];
  f.ports.structures = createSponsoredProductsReadAdapter(async (url, init) => {
    paths.push(String(url));
    assert.equal(new Headers(init?.headers).get("Amazon-Advertising-API-Scope"), "101");
    return String(url).endsWith("/sp/campaigns/list")
      ? Response.json({ campaigns: [{ campaignId: "200", name: "fixture", startDate: "2026-11-01", state: "ENABLED", targetingType: "MANUAL", budget: { budget: 10, budgetType: "DAILY" } }] })
      : Response.json({ adGroups: [{ campaignId: "200", adGroupId: "300", name: "fixture group", state: "ENABLED", defaultBid: 0.5 }] });
  });
  const result = await probeAmazonAdsConnection(input, f.ports);
  assert.equal(result.status, "READ_COMPLETE");
  assert.deepEqual(result.reads.map(read => read.externalIds), [["200"], ["300"]]);
  assert.deepEqual(paths, ["https://advertising-api.amazon.com/sp/campaigns/list", "https://advertising-api.amazon.com/sp/adGroups/list"]);
});

test("invalid domain output is blocked and caller mutation cannot change the selected environment", async () => {
  const f = fixture();
  const mutable = { ...input };
  f.ports.oauth.refreshAccessToken = async () => { mutable.region = "EU" as "NA"; mutable.maxRequests = 100; return "fixture-access"; };
  f.ports.structures.readPage = async request => {
    assert.equal(request.region, "NA");
    return { complete: true, nextCursor: null, entities: [{ entityType: "SP:keyword", externalId: "1", payload: {} }] };
  };
  const result = await probeAmazonAdsConnection(mutable, f.ports);
  assert.equal(result.failure?.code, "ADS_CONNECTION_PROBE_ENTITY_TYPE_INVALID");
  assert.equal(result.apiRequests, 3);
  assert.equal(result.reads.length, 0);
});
