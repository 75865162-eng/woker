import assert from "node:assert/strict";
import test from "node:test";
import { adsReportWindows, adsScopeEnabled, adsSyncFailureStatus, adsSyncKey, adsSyncScopes, parseAdsCheckpoint } from "@/lib/amazon-ads/sync-policy";
import { amazonAdsTokenExpiryNotice } from "@/lib/amazon-ads/token-expiry";
import { adsReadAdapterReady, createSponsoredProductsAdGroupReader, createSponsoredProductsCampaignNegativeKeywordReader, createSponsoredProductsCampaignNegativeTargetReader, createSponsoredProductsCampaignReader, createSponsoredProductsKeywordReader, createSponsoredProductsNegativeKeywordReader, createSponsoredProductsNegativeTargetReader, createSponsoredProductsTargetReader, pendingAdsReadAdapter, validateAdsPage } from "@/lib/amazon-ads/sync-adapter";
import { adsClientIdHash } from "@/lib/amazon-ads/api-budget";
import { parseReportingV1Envelope } from "@/lib/amazon-ads/reporting-contract";

test("Ads automatic sync is opt-in and limited to configured organization/workspace pairs", () => {
  const env = { AMAZON_ADS_SYNC_ENABLED: "true", AMAZON_ADS_SYNC_SCOPES: '[["org-a","workspace-1"],["org-b","workspace-2"]]' };
  assert.equal(adsSyncScopes({ ...env, AMAZON_ADS_SYNC_ENABLED: "false" }).length, 0);
  assert.equal(adsSyncScopes(env).length, 2);
  assert.equal(adsSyncScopes({ ...env, AMAZON_ADS_SYNC_SCOPES: '[["org-a","workspace-1"], ["org-b"]]' }).length, 0);
  assert.equal(adsSyncScopes({ ...env, AMAZON_ADS_SYNC_SCOPES: '[["org-a","workspace-1"], ["org-a","workspace-1"]]' }).length, 1);
  assert.equal(adsScopeEnabled({ organizationId: "org-a", workspaceId: "workspace-1" }, env), true);
  assert.equal(adsScopeEnabled({ organizationId: "org-a", workspaceId: "workspace-2" }, env), false);
});

test("Ads report ranges split deterministically and enforce bounded dates", () => {
  assert.deepEqual(adsReportWindows("2026-01-30", "2026-02-02", 2), [
    { from: "2026-01-30", to: "2026-01-31" },
    { from: "2026-02-01", to: "2026-02-02" },
  ]);
  assert.throws(() => adsReportWindows("2026-02-02", "2026-01-30", 2));
  assert.throws(() => adsReportWindows("2026-01-01", "2027-01-01", 0));
});

test("Ads refresh-token reminders derive 60/30/7-day and expired states without persisted reminder rows", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const at = (days: number) => new Date(now.getTime() + days * 86400000);
  assert.equal(amazonAdsTokenExpiryNotice(at(61), now), null);
  assert.deepEqual(amazonAdsTokenExpiryNotice(at(60), now), { level: "WITHIN_60_DAYS", daysRemaining: 60 });
  assert.deepEqual(amazonAdsTokenExpiryNotice(at(30), now), { level: "WITHIN_30_DAYS", daysRemaining: 30 });
  assert.deepEqual(amazonAdsTokenExpiryNotice(at(7), now), { level: "WITHIN_7_DAYS", daysRemaining: 7 });
  assert.deepEqual(amazonAdsTokenExpiryNotice(at(0), now), { level: "EXPIRED", daysRemaining: 0 });
  assert.deepEqual(amazonAdsTokenExpiryNotice(at(-1), now), { level: "EXPIRED", daysRemaining: 0 });
  assert.deepEqual(amazonAdsTokenExpiryNotice(at(7.01).toISOString(), now), { level: "WITHIN_30_DAYS", daysRemaining: 8 });
  assert.deepEqual(amazonAdsTokenExpiryNotice(at(30.01), now), { level: "WITHIN_60_DAYS", daysRemaining: 31 });
  assert.equal(amazonAdsTokenExpiryNotice(at(60.01), now), null);
  assert.deepEqual(amazonAdsTokenExpiryNotice(null, now), { level: "UNKNOWN", daysRemaining: null });
  assert.deepEqual(amazonAdsTokenExpiryNotice(undefined, now), { level: "UNKNOWN", daysRemaining: null });
  assert.deepEqual(amazonAdsTokenExpiryNotice("invalid", now), { level: "UNKNOWN", daysRemaining: null });
  assert.equal(amazonAdsTokenExpiryNotice(at(7), new Date("invalid")), null);
});

test("Ads checkpoints validate stage, cursor and page count", () => {
  assert.deepEqual(parseAdsCheckpoint(null), { stage: 0, cursor: null, pages: 0 });
  assert.deepEqual(parseAdsCheckpoint({ stage: 2, cursor: "next", pages: 4 }), { stage: 2, cursor: "next", pages: 4 });
  assert.throws(() => parseAdsCheckpoint({ stage: 99, cursor: null, pages: 0 }));
  assert.throws(() => parseAdsCheckpoint({ stage: 0, cursor: "", pages: -1 }));
});

test("Ads adapter rejects incomplete pages and never fabricates data before its contract is implemented", () => {
  assert.equal(adsReadAdapterReady(), false);
  assert.throws(() => pendingAdsReadAdapter.assertImplemented(), { code: "ADS_READ_ADAPTER_NOT_IMPLEMENTED" });
  assert.throws(() => validateAdsPage({ entities: [], nextCursor: null, complete: false }, null));
  assert.deepEqual(validateAdsPage({ entities: [{ entityType: "SP:campaign", externalId: "123", payload: { name: "fixture" } }], nextCursor: null, complete: true }, null).entities.length, 1);
  assert.throws(() => validateAdsPage({ entities: [{ entityType: "SP:campaign", externalId: "123", payload: {} }], nextCursor: "same", complete: true }, "same"));
});

test("SP campaign reader builds a regional read-only request and preserves the next page cursor", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const reader = createSponsoredProductsCampaignReader(async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ campaigns: [{ campaignId: "123", name: "fixture", state: "ENABLED", targetingType: "MANUAL", startDate: "2026-01-01", budget: { budget: 20, budgetType: "DAILY" }, extendedData: { lastUpdateDateTime: "2026-11-05T12:00:00Z" } }], nextToken: "cursor-2", totalResults: 1 }));
  });
  const page = await reader.readPage({ region: "EU", profileId: "998877", clientId: "client-fixture", accessToken: "token-fixture", cursor: "cursor-1" });
  assert.equal(calls[0].url, "https://advertising-api-eu.amazon.com/sp/campaigns/list");
  assert.equal(calls[0].init?.method, "POST");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("Amazon-Advertising-API-ClientId"), "client-fixture");
  assert.equal(headers.get("Amazon-Advertising-API-Scope"), "998877");
  assert.equal(headers.get("Authorization"), "Bearer token-fixture");
  assert.equal(headers.get("Content-Type"), "application/vnd.spCampaign.v3+json");
  assert.equal(headers.get("Accept"), "application/vnd.spCampaign.v3+json");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { includeExtendedDataFields: true, nextToken: "cursor-1" });
  assert.deepEqual(page, {
    entities: [{ entityType: "SP:campaign", externalId: "123", state: "ENABLED", payload: { campaignId: "123", name: "fixture", state: "ENABLED", targetingType: "MANUAL", startDate: "2026-01-01", budget: { budget: 20, budgetType: "DAILY" }, extendedData: { lastUpdateDateTime: "2026-11-05T12:00:00Z" } }, sourceUpdatedAt: "2026-11-05T12:00:00Z" }],
    nextCursor: "cursor-2",
    complete: true,
  });
  assert.equal(adsReadAdapterReady(), false);
});

test("SP campaign reader rejects malformed fixtures and classifies HTTP failures without exposing bodies", async () => {
  const makeReader = (response: Response) => createSponsoredProductsCampaignReader(async () => response);
  const input = { region: "NA" as const, profileId: "123", clientId: "fixture", accessToken: "fixture", cursor: null };
  await assert.rejects(makeReader(new Response(JSON.stringify({ campaigns: [{ campaignId: "not-numeric" }] }))).readPage(input), { code: "ADS_CAMPAIGN_RESPONSE_INVALID" });
  await assert.rejects(makeReader(new Response(JSON.stringify({ campaigns: [], nextToken: "same" }))).readPage({ ...input, cursor: "same" }), { code: "ADS_CAMPAIGN_RESPONSE_INVALID" });

  for (const status of [401, 403]) {
    await assert.rejects(makeReader(new Response("sensitive upstream details", { status })).readPage(input), (error: unknown) => {
      assert.equal((error as { code: string }).code, `ADS_CAMPAIGN_HTTP_${status}`);
      assert.equal((error as { retryable: boolean }).retryable, false);
      assert.equal((error as Error).message.includes("sensitive"), false);
      return true;
    });
  }
  await assert.rejects(makeReader(new Response("sensitive upstream details", { status: 429, headers: { "Retry-After": "12" } })).readPage(input), (error: unknown) => {
    assert.equal((error as { retryable: boolean }).retryable, true);
    assert.equal((error as { retryAfterMs: number }).retryAfterMs, 12000);
    assert.equal((error as Error).message.includes("sensitive"), false);
    return true;
  });
  await assert.rejects(makeReader(new Response("sensitive upstream details", { status: 503 })).readPage(input), (error: unknown) => {
    assert.equal((error as { retryable: boolean }).retryable, true);
    assert.equal((error as Error).message.includes("sensitive"), false);
    return true;
  });
  await assert.rejects(createSponsoredProductsCampaignReader(async () => { throw new Error("network fixture secret"); }).readPage(input), { code: "ADS_CAMPAIGN_NETWORK_FAILED" });
});

test("SP ad group reader preserves campaign parent IDs and validates its v3 contract", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const reader = createSponsoredProductsAdGroupReader(async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ adGroups: [{ adGroupId: "456", campaignId: "123", name: "fixture group", state: "PAUSED", defaultBid: 0.83, extendedData: { lastUpdateDateTime: "2026-11-05T10:00:00Z" } }], nextToken: null, totalResults: 1 }));
  });
  const page = await reader.readPage({ region: "FE", profileId: "789", clientId: "client-fixture", accessToken: "token-fixture", cursor: null });
  assert.equal(request?.url, "https://advertising-api-fe.amazon.com/sp/adGroups/list");
  const headers = new Headers(request?.init?.headers);
  assert.equal(headers.get("Content-Type"), "application/vnd.spAdGroup.v3+json");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), { includeExtendedDataFields: true });
  assert.deepEqual(page, {
    entities: [{ entityType: "SP:ad-group", externalId: "456", parentExternalId: "123", state: "PAUSED", payload: { adGroupId: "456", campaignId: "123", name: "fixture group", state: "PAUSED", defaultBid: 0.83, extendedData: { lastUpdateDateTime: "2026-11-05T10:00:00Z" } }, sourceUpdatedAt: "2026-11-05T10:00:00Z" }],
    nextCursor: null,
    complete: true,
  });
  assert.equal(adsReadAdapterReady(), false);
  await assert.rejects(createSponsoredProductsAdGroupReader(async () => new Response(JSON.stringify({ adGroups: [{ adGroupId: "456", name: "orphan", state: "ENABLED", defaultBid: 1 }] }))).readPage({ region: "NA", profileId: "789", clientId: "fixture", accessToken: "fixture", cursor: null }), { code: "ADS_AD_GROUP_RESPONSE_INVALID" });
});

test("SP keyword, target and both levels of negative readers preserve parent identity and v3 fields", async () => {
  const cases = [
    { reader: createSponsoredProductsKeywordReader, path: "/sp/keywords/list", media: "application/vnd.spKeyword.v3+json", collection: "keywords", payload: { keywordId: "601", campaignId: "101", adGroupId: "201", keywordText: "fixture keyword", matchType: "EXACT", state: "ENABLED", bid: 0.7 }, entityType: "SP:keyword" },
    { reader: createSponsoredProductsTargetReader, path: "/sp/targets/list", media: "application/vnd.spTargetingClause.v3+json", collection: "targetingClauses", payload: { targetId: "602", campaignId: "101", adGroupId: "202", expression: [{ type: "ASIN_SAME_AS", value: "B000000001" }], resolvedExpression: [], expressionType: "MANUAL", state: "PAUSED", bid: 0.9 }, entityType: "SP:target" },
    { reader: createSponsoredProductsNegativeKeywordReader, path: "/sp/negativeKeywords/list", media: "application/vnd.spNegativeKeyword.v3+json", collection: "negativeKeywords", payload: { keywordId: "603", campaignId: "102", adGroupId: "203", keywordText: "fixture negative", matchType: "NEGATIVE_PHRASE", state: "ENABLED" }, entityType: "SP:negative-keyword" },
    { reader: createSponsoredProductsNegativeTargetReader, path: "/sp/negativeTargets/list", media: "application/vnd.spNegativeTargetingClause.v3+json", collection: "negativeTargetingClauses", payload: { targetId: "604", campaignId: "102", adGroupId: "204", expression: [{ type: "ASIN_SAME_AS", value: "B000000002" }], resolvedExpression: [], state: "ENABLED" }, entityType: "SP:negative-target" },
    { reader: createSponsoredProductsCampaignNegativeKeywordReader, path: "/sp/campaignNegativeKeywords/list", media: "application/vnd.spCampaignNegativeKeyword.v3+json", collection: "campaignNegativeKeywords", payload: { keywordId: "605", campaignId: "103", keywordText: "campaign negative", matchType: "NEGATIVE_EXACT", state: "PAUSED" }, entityType: "SP:campaign-negative-keyword" },
    { reader: createSponsoredProductsCampaignNegativeTargetReader, path: "/sp/campaignNegativeTargets/list", media: "application/vnd.spCampaignNegativeTargetingClause.v3+json", collection: "campaignNegativeTargetingClauses", payload: { targetId: "606", campaignId: "104", expression: [{ type: "ASIN_SAME_AS", value: "B000000003" }], resolvedExpression: [], state: "ENABLED" }, entityType: "SP:campaign-negative-target" },
  ] as const;
  for (const item of cases) {
    let request: { url: string; init?: RequestInit } | undefined;
    const reader = item.reader(async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ [item.collection]: [{ ...item.payload, extendedData: { lastUpdateDateTime: "2026-11-06T10:00:00Z" } }], nextToken: "cursor-next", totalResults: 1 }));
    });
    const page = await reader.readPage({ region: "NA", profileId: "1234", clientId: "client-fixture", accessToken: "token-fixture", cursor: null });
    assert.equal(request?.url, `https://advertising-api.amazon.com${item.path}`);
    const headers = new Headers(request?.init?.headers);
    assert.equal(headers.get("Content-Type"), item.media);
    assert.deepEqual(JSON.parse(String(request?.init?.body)), { includeExtendedDataFields: true });
    assert.deepEqual(page.entities[0], {
      entityType: item.entityType, externalId: "keywordId" in item.payload ? item.payload.keywordId : item.payload.targetId,
      parentExternalId: "adGroupId" in item.payload ? item.payload.adGroupId : item.payload.campaignId, state: item.payload.state,
      payload: { ...item.payload, extendedData: { lastUpdateDateTime: "2026-11-06T10:00:00Z" } }, sourceUpdatedAt: "2026-11-06T10:00:00Z",
    });
    assert.equal(page.nextCursor, "cursor-next");
  }
  assert.equal(adsReadAdapterReady(), false);
});

test("SP object readers fail closed on invalid IDs, enums and parent relationships", async () => {
  const input = { region: "NA" as const, profileId: "123", clientId: "fixture", accessToken: "fixture", cursor: null };
  await assert.rejects(createSponsoredProductsKeywordReader(async () => new Response(JSON.stringify({ keywords: [{ keywordId: "601", campaignId: "101", adGroupId: "bad", keywordText: "x", matchType: "EXACT", state: "ENABLED" }] }))).readPage(input), { code: "ADS_KEYWORD_RESPONSE_INVALID" });
  await assert.rejects(createSponsoredProductsTargetReader(async () => new Response(JSON.stringify({ targetingClauses: [{ targetId: "602", campaignId: "101", adGroupId: "202", expression: [], resolvedExpression: [], expressionType: "FUTURE", state: "ENABLED" }] }))).readPage(input), { code: "ADS_TARGET_RESPONSE_INVALID" });
  await assert.rejects(createSponsoredProductsNegativeKeywordReader(async () => new Response(JSON.stringify({ negativeKeywords: [{ keywordId: "603", campaignId: "101", adGroupId: "203", keywordText: "x", matchType: "EXACT", state: "ENABLED" }] }))).readPage(input), { code: "ADS_NEGATIVE_KEYWORD_RESPONSE_INVALID" });
  await assert.rejects(createSponsoredProductsNegativeTargetReader(async () => new Response(JSON.stringify({ negativeTargetingClauses: [{ targetId: "604", campaignId: "102", adGroupId: "204", expression: [], resolvedExpression: [], state: "ENABLED" }], nextToken: "same" }))).readPage({ ...input, cursor: "same" }), { code: "ADS_NEGATIVE_TARGET_RESPONSE_INVALID" });
  await assert.rejects(createSponsoredProductsCampaignNegativeKeywordReader(async () => new Response(JSON.stringify({ campaignNegativeKeywords: [{ keywordId: "605", campaignId: "101", keywordText: "x", matchType: "EXACT", state: "ENABLED" }] }))).readPage(input), { code: "ADS_CAMPAIGN_NEGATIVE_KEYWORD_RESPONSE_INVALID" });
  await assert.rejects(createSponsoredProductsCampaignNegativeTargetReader(async () => new Response(JSON.stringify({ campaignNegativeTargetingClauses: [{ targetId: "606", campaignId: "invalid", expression: [], resolvedExpression: [], state: "ENABLED" }] }))).readPage(input), { code: "ADS_CAMPAIGN_NEGATIVE_TARGET_RESPONSE_INVALID" });
});

test("Reporting v1 envelope parser validates task state and strips temporary download URLs", () => {
  const payload = { success: [{ index: 0, report: {
    reportId: "report-fixture", status: "COMPLETED", format: "GZIP_JSON", creationDateTime: "2026-11-06T00:00:00Z",
    lastUpdatedDateTime: "2026-11-06T00:02:00Z", completedDateTime: "2026-11-06T00:02:00Z",
    periods: [{ datePeriod: { startDate: "2026-11-01", endDate: "2026-11-01" } }], query: { fields: ["campaign.id"] },
    completedReportParts: [{ url: "https://reports.example.invalid/short-lived-secret", sizeInBytes: 123, urlExpirationDateTime: "2026-11-06T01:00:00Z" }],
    warnings: [{ field: "metrics.sales", warningCodes: ["DATE_LIMITED"] }],
  } }] };
  const result = parseReportingV1Envelope(payload);
  assert.equal(result.outcome, "success");
  if (result.outcome !== "success") return;
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(result.parts, [{ sizeInBytes: 123, urlExpirationDateTime: "2026-11-06T01:00:00Z" }]);
  assert.equal(JSON.stringify(result).includes("short-lived-secret"), false);
  assert.deepEqual(result.warnings, [{ field: "metrics.sales", codes: ["DATE_LIMITED"] }]);
  assert.deepEqual(parseReportingV1Envelope({ error: [{ index: 0, errors: [{ code: "TOO_MANY_REQUESTS", message: "private upstream text" }, { code: "BAD_REQUEST", message: "private detail" }] }] }), {
    outcome: "error", errors: [{ code: "TOO_MANY_REQUESTS" }, { code: "BAD_REQUEST" }],
  });
  for (const malformed of [
    { success: [], error: [] },
    { success: [{ index: 0, report: { reportId: "x", status: "DONE" } }] },
    { success: [{ index: 0, report: { ...payload.success[0].report, completedReportParts: [{ url: "http://reports.invalid/x", sizeInBytes: 1, urlExpirationDateTime: "2026-11-06T01:00:00Z" }] } }] },
    { success: [{ index: 0, report: { ...payload.success[0].report, creationDateTime: "tomorrow" } }] },
    { success: [{ index: 0, report: { ...payload.success[0].report, completedReportParts: [{ url: "https:reports.invalid/x", sizeInBytes: 1, urlExpirationDateTime: "2026-11-06T01:00:00Z" }] } }] },
  ]) assert.throws(() => parseReportingV1Envelope(malformed), { message: "ADS_REPORT_ENVELOPE_INVALID" });
});

test("Ads request coordination stores a stable digest instead of the client ID", () => {
  const digest = adsClientIdHash("client-id-value");
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, "client-id-value");
  assert.equal(digest, adsClientIdHash("client-id-value"));
});

test("Ads sync idempotency key is stable for equivalent inputs", () => {
  assert.equal(adsSyncKey(["p1", "2026-11-01"]), adsSyncKey(["p1", "2026-11-01"]));
  assert.notEqual(adsSyncKey(["p1", "2026-11-01"]), adsSyncKey(["p2", "2026-11-01"]));
});

test("Ads task failures distinguish retryable faults, terminal scope errors, adapter gaps and exhaustion", () => {
  assert.equal(adsSyncFailureStatus({ adapterReady: true, retryable: true, exhausted: false }), "RETRY_WAIT");
  assert.equal(adsSyncFailureStatus({ adapterReady: true, retryable: false, exhausted: false }), "BLOCKED");
  assert.equal(adsSyncFailureStatus({ adapterReady: false, retryable: false, exhausted: false }), "WAITING_FOR_ADAPTER");
  assert.equal(adsSyncFailureStatus({ adapterReady: true, retryable: true, exhausted: true }), "FAILED");
});
