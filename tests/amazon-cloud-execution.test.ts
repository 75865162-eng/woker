import assert from "node:assert/strict";
import test, { beforeEach, after } from "node:test";
import { AmazonCloudExecutionError, amazonCloudExecutionEnabled, assertAmazonCloudExecution } from "@/lib/amazon/execution-role";
import { AmazonSpApiClient } from "@/lib/amazon/sp-api-client";
import { getAmazonSpApiServerConfiguration } from "@/lib/amazon/sp-api-config";
import { createAmazonAdsOAuthTransport } from "@/lib/amazon-ads/oauth-contract";
import { createSponsoredProductsCampaignReader } from "@/lib/amazon-ads/sync-adapter";
import { createReportingV1Transport } from "@/lib/amazon-ads/reporting-v1-transport";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { processAmazonAdsSyncTask } from "@/lib/amazon-ads/sync-processor";
import { startAmazonOAuth, finishAmazonOAuth } from "@/lib/amazon-sync/oauth";
import { startAmazonAdsOAuth, finishAmazonAdsOAuth } from "@/lib/amazon-ads/authorization";

const previous = process.env.AMAZON_API_EXECUTION_ROLE;
beforeEach(() => { delete process.env.AMAZON_API_EXECUTION_ROLE; });
after(() => { if (previous === undefined) delete process.env.AMAZON_API_EXECUTION_ROLE; else process.env.AMAZON_API_EXECUTION_ROLE = previous; });
const blocked = (error: unknown) => error instanceof AmazonCloudExecutionError && error.code === "CLOUD_EXECUTION_REQUIRED" && error.status === 409 && !error.retryable;
const config = getAmazonSpApiServerConfiguration({ AMAZON_SP_API_LWA_CLIENT_ID: "fixture-client", AMAZON_SP_API_LWA_CLIENT_SECRET: "fixture-secret", AMAZON_SP_API_REFRESH_TOKEN: "fixture-refresh" });

test("only explicit server cloud configuration permits official execution", () => {
  for (const role of [undefined, "local", "production", "CLOUD", "unknown"]) {
    if (role === undefined) delete process.env.AMAZON_API_EXECUTION_ROLE; else process.env.AMAZON_API_EXECUTION_ROLE = role;
    assert.equal(amazonCloudExecutionEnabled(), false);
    assert.throws(assertAmazonCloudExecution, blocked);
  }
  process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
  assert.equal(amazonCloudExecutionEnabled(), true);
  assert.doesNotThrow(assertAmazonCloudExecution);
});

test("local SP-API, token refresh and both report download paths send zero requests", async () => {
  let requests = 0, budgetChecks = 0;
  const client = new AmazonSpApiClient(config, { fetch: async () => { requests++; throw new Error("Offline fixture must not dispatch"); }, beforeRequest: async () => { budgetChecks++; } });
  await assert.rejects(client.getMarketplaceParticipations(), blocked);
  await assert.rejects(client.downloadReportText({ url: "https://fixture.s3.amazonaws.com/report" }), blocked);
  await assert.rejects(client.downloadReportPart({ url: "https://fixture.s3.amazonaws.com/report" }, { offset: 0 }), blocked);
  assert.equal(requests, 0); assert.equal(budgetChecks, 0);
});

test("local Ads OAuth, profiles, entities and reports never dispatch or report uncertain writes", async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => { requests++; throw new Error("Offline fixture must not dispatch"); };
  const oauth = createAmazonAdsOAuthTransport(fetcher);
  await assert.rejects(oauth.refreshAccessToken({ region: "NA", refreshToken: "fixture", clientId: "fixture", clientSecret: "fixture" }), blocked);
  await assert.rejects(oauth.listProfiles({ region: "NA", clientId: "fixture", accessToken: "fixture" }), blocked);
  await assert.rejects(createSponsoredProductsCampaignReader(fetcher).readPage({ region: "NA", profileId: "123", clientId: "fixture", accessToken: "fixture", cursor: null }), blocked);
  const reporting = createReportingV1Transport(fetcher, ["fixture.s3.amazonaws.com"]);
  await assert.rejects(reporting.retrieve({ region: "NA", clientId: "fixture", accessToken: "fixture", reportId: "fixture-report" }), blocked);
  await assert.rejects(reporting.create({ region: "NA", clientId: "fixture", accessToken: "fixture", advertiserAccountId: "fixture-account", report: { format: "GZIP_JSON", periods: [{ datePeriod: { startDate: "2026-11-01", endDate: "2026-11-01" } }], query: { fields: ["fixture.field"] } } }), blocked);
  await assert.rejects(reporting.download({ url: "https://fixture.s3.amazonaws.com/report", expiresAt: new Date(Date.now() + 60000).toISOString(), maxBytes: 100, expectedBytes: 10 }), blocked);
  assert.equal(requests, 0);
});

test("local OAuth and worker entry points reject before touching the database or claiming a job", async () => {
  const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace" };
  await assert.rejects(startAmazonOAuth(scope, "fixture-user", "us-east-1"), blocked);
  await assert.rejects(finishAmazonOAuth("fixture-user", new URLSearchParams()), blocked);
  await assert.rejects(startAmazonAdsOAuth(scope, "fixture-user", "NA"), blocked);
  await assert.rejects(finishAmazonAdsOAuth({ scope, actor: "fixture-user", params: new URLSearchParams() }), blocked);
  await assert.rejects(processSyncCenterTask("fixture-task", 1), blocked);
  await assert.rejects(processAmazonAdsSyncTask("fixture-task", 1), blocked);
});

test("cloud role is checked again after asynchronous preflight, before dispatch", async () => {
  let requests = 0;
  process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
  const client = new AmazonSpApiClient(config, { beforeRequest: async () => { process.env.AMAZON_API_EXECUTION_ROLE = "local"; }, fetch: async () => { requests++; throw new Error("Must not dispatch"); } });
  await assert.rejects(client.getMarketplaceParticipations(), blocked);
  assert.equal(requests, 0);
});
