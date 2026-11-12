// Cloud role for injected offline HTTP fixtures; no real Amazon calls.
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
import assert from "node:assert/strict";
import test from "node:test";
import { AmazonSpApiClient } from "../src/lib/amazon/sp-api-client";
import { getAmazonSpApiServerConfiguration } from "../src/lib/amazon/sp-api-config";
import { parseObservationPolicy, type AnalyticsPolicy, type BuyBoxHistoryPolicy } from "../src/lib/amazon-sync/observation-policy";
import { advanceObservation, initialObservationState, parseObservationState } from "../src/lib/amazon-sync/observation-machine";
import { parseNotificationSubscriptions } from "../src/lib/amazon-sync/notifications";
import { automaticBrandCandidates, automaticBrandHistoryCandidates, latestClosedBrandWindow, assertAutomaticBrandTask } from "../src/lib/amazon-sync/automatic-brand";
import { brandWindowKey } from "../src/lib/amazon-sync/brand-collection";
import { nextBuyBoxDay, assertBuyBoxTaskPolicy } from "../src/lib/amazon-sync/buy-box-history";
import { rawResponseEnvelope } from "../src/lib/amazon-sync/raw-fields";
import { registeredSpApiSchemas } from "../src/lib/amazon-sync/official-schema";
import { registeredWorkerHealth } from "../src/lib/runtime/worker-health";

const common = { applicationId: "fixture-app", maxRequests: 100, maxRows: 1000, requestsPerSecond: .01 };
const config = getAmazonSpApiServerConfiguration({ AMAZON_SP_API_LWA_CLIENT_ID: "fixture-client", AMAZON_SP_API_LWA_CLIENT_SECRET: "fixture-secret", AMAZON_SP_API_REFRESH_TOKEN: "fixture-refresh", AMAZON_SP_API_AWS_ACCESS_KEY_ID: "fixture", AMAZON_SP_API_AWS_SECRET_ACCESS_KEY: "fixture" });
const context = { marketplaceId: "ATVPDKIKX0DER", sellerId: "fixture", rawBody: "{}" };
const subscription = { subscriptionId: "subscription", payloadVersion: "1.0", destinationId: "private-destination", processingDirective: { filterExpression: "PRIVATE_FILTER" } };

test("notifications paginate each type, reject loops and keep seller scope explicit", () => {
  const p = parseObservationPolicy({ ...common, resource: "notifications", notificationTypes: ["ORDER_CHANGE", "ANY_OFFER_CHANGED"] });
  let state = initialObservationState(p);
  const first = advanceObservation(p, state, { payload: { subscriptions: [subscription], nextToken: "page2" } }, context);
  assert.equal(first.rows[0].facts.scope, "SELLER_SUBSCRIPTION"); assert.equal(first.rows[0].facts.marketplaceIds, null);
  assert.equal(first.rows[0].facts.eventDeliveryVerified, false); assert.ok(!JSON.stringify(first.rows).includes("PRIVATE_FILTER"));
  assert.ok(!JSON.stringify(first.rows).includes("private-destination"));
  assert.equal(first.state.planIndex, 0); state = first.state;
  assert.throws(() => advanceObservation(p, state, { payload: { subscriptions: [], nextToken: "page2" } }, context));
  state = advanceObservation(p, state, { payload: { subscriptions: [] } }, context).state;
  assert.equal(state.planIndex, 1); assert.equal(state.token, undefined);
  state = advanceObservation(p, state, { payload: { subscriptions: [] } }, context).state;
  assert.equal(state.stage, "COMPLETE"); assert.deepEqual(parseObservationState(state, p), state);
  assert.throws(() => parseObservationState({ ...state, planIndex: 0 }, p));
  assert.throws(() => parseNotificationSubscriptions({ payload: {} }, "ORDER_CHANGE"));
  assert.throws(() => parseNotificationSubscriptions({ payload: { subscriptions: [subscription, subscription] } }, "ORDER_CHANGE"));
});

test("subscription adapter sends one type and preserves raw bytes without write operations", async () => {
  const paths: string[] = [];
  const raw = JSON.stringify({ payload: { subscriptions: [subscription] }, futureField: 1 });
  const client = new AmazonSpApiClient(config, { fetch: async (input, init) => {
    const url = new URL(String(input)); paths.push(url.pathname);
    if (paths.length === 1) return Response.json({ access_token: "fixture", expires_in: 3600 });
    assert.equal(init?.method, "GET"); assert.equal(url.pathname, "/notifications/v1/subscriptions");
    assert.deepEqual(url.searchParams.getAll("notificationTypes"), ["ORDER_CHANGE"]);
    assert.equal(url.searchParams.get("pageSize"), "100"); assert.equal(url.searchParams.get("nextToken"), "opaque+token");
    return new Response(raw);
  } });
  assert.equal((await client.getNotificationSubscriptions({ notificationType: "ORDER_CHANGE", nextToken: "opaque+token" })).rawBody, raw);
  assert.equal(paths.length, 2);
});

test("live control check after token acquisition prevents the seller request", async () => {
  let checks = 0, requests = 0;
  const client = new AmazonSpApiClient(config, { beforeRequest: async () => { if (++checks === 2) throw new Error("fixture revoked"); }, fetch: async () => { requests++; return Response.json({ access_token: "fixture", expires_in: 3600 }); } });
  await assert.rejects(client.getNotificationSubscriptions({ notificationType: "ORDER_CHANGE" }), /fixture revoked/);
  assert.equal(requests, 1);
});

test("HTTP failure archive receives original error body but never LWA credentials", async () => {
  const evidence: string[] = [];
  const client = new AmazonSpApiClient(config, { onErrorResponse: async e => { evidence.push(e.rawBody); }, fetch: async input => String(input).includes("auth/o2/token") ? Response.json({ access_token: "PRIVATE_TOKEN", expires_in: 3600 }) : new Response('{"errors":[{"code":"Unauthorized","message":"scope"}],"future":true}', { status: 403 }) });
  await assert.rejects(client.getNotificationSubscriptions({ notificationType: "ORDER_CHANGE" }));
  assert.equal(evidence.length, 1); assert.ok(evidence[0].includes('"future":true')); assert.ok(!evidence[0].includes("PRIVATE_TOKEN"));
  const denied = new AmazonSpApiClient(config, { onErrorResponse: async e => { evidence.push(e.rawBody); }, fetch: async () => new Response('{"secret":"PRIVATE_LWA_ERROR"}', { status: 400 }) });
  await assert.rejects(denied.getNotificationSubscriptions({ notificationType: "ORDER_CHANGE" })); assert.equal(evidence.length, 1);
});

test("Brand discovers all executable complete periods with bounded ASIN batches and honest eligibility", () => {
  const now = new Date("2026-11-07T20:00:00Z");
  const p = parseObservationPolicy({ ...common, resource: "brand_analytics", automaticDiscovery: true, reportKind: "search_terms", reportPeriod: "DAY", asins: [], from: "2026-07-01", to: "2026-07-01", marketplaceTimeZone: "America/Los_Angeles", brandEligibilityAttested: false }) as AnalyticsPolicy;
  assert.equal(p.brandEligibilityAttested, false);
  const candidates = automaticBrandCandidates(p, ["B123456789"], now);
  assert.equal(new Set(candidates.map(x => `${x.reportKind}/${x.reportPeriod}`)).size, 17);
  for (const candidate of candidates) { assert.doesNotThrow(() => parseObservationPolicy(candidate)); assert.doesNotThrow(() => assertAutomaticBrandTask(p, candidate, now)); }
  assert.equal(new Set(automaticBrandCandidates(p, [], now).map(x => x.reportKind)).size, 3);
  assert.deepEqual(latestClosedBrandWindow("2026-11-01", "WEEK"), { from: "2026-10-25", to: "2026-10-31" });
  assert.deepEqual(latestClosedBrandWindow("2026-01-01", "QUARTER"), { from: "2025-10-01", to: "2025-12-31" });
  const ids = Array.from({ length: 19 }, (_, i) => `B${String(i).padStart(9, "0")}`);
  assert.equal(automaticBrandCandidates(p, ids, now).filter(x => x.reportKind === "search_query" && x.reportPeriod === "WEEK").length, 2);
  assert.throws(() => assertAutomaticBrandTask(p, { ...candidates[0], maxRequests: 101 }, now));
});

test("Buy Box starts at earliest missing closed business day and preserves fixed scope", () => {
  const now = new Date("2026-11-08T02:00:00Z"); // still Nov 7 in Los Angeles
  assert.equal(nextBuyBoxDay("2026-11-03", "America/Los_Angeles", ["2026-11-03", "2026-11-05"], now), "2026-11-04");
  assert.equal(nextBuyBoxDay("2026-11-07", "America/Los_Angeles", [], now), null);
  assert.equal(nextBuyBoxDay("2026-11-06", "America/Los_Angeles", ["2026-11-06"], now), null);
  assert.equal(nextBuyBoxDay("2026-11-05", "America/Los_Angeles", ["2026-11-05", "2026-11-06"], now), null);
  assert.equal(nextBuyBoxDay("2026-11-05", "America/Los_Angeles", ["2026-11-05", "2026-11-06"], new Date("2026-11-09T02:00:00Z")), "2026-11-07");
  const p = parseObservationPolicy({ ...common, resource: "buy_box_history", allAsins: true, asins: [], from: "2026-11-03", to: "2026-11-03", marketplaceTimeZone: "America/Los_Angeles" }) as BuyBoxHistoryPolicy;
  assert.doesNotThrow(() => assertBuyBoxTaskPolicy(p, { ...p, from: "2026-11-06", to: "2026-11-06" }, now));
  assert.throws(() => assertBuyBoxTaskPolicy(p, { ...p, from: "2026-11-07", to: "2026-11-07" }, now));
  assert.throws(() => assertBuyBoxTaskPolicy(p, { ...p, allAsins: undefined, asins: ["B123456789"] }, now));
});

test("automatic Brand backfills complete historical periods after probing every current combination", async () => {
  const { nextAutomaticBrandPolicy } = await import("../src/lib/amazon-sync/automatic-brand");
  const now = new Date("2026-11-07T20:00:00Z");
  const p = parseObservationPolicy({ ...common, resource: "brand_analytics", automaticDiscovery: true, reportKind: "search_terms", reportPeriod: "DAY", asins: [], from: "2026-10-28", to: "2026-10-28", marketplaceTimeZone: "America/Los_Angeles" }) as AnalyticsPolicy;
  const latest = automaticBrandCandidates(p, [], now).filter(candidate => candidate.from >= p.from);
  const all = [...automaticBrandHistoryCandidates(p, [], now)];
  assert.deepEqual(all.slice(0, latest.length), latest);
  assert.equal(new Set(all.map(brandWindowKey)).size, all.length);
  for (const candidate of all) {
    assert.ok(candidate.from >= p.from && candidate.to < "2026-11-07");
    assert.doesNotThrow(() => parseObservationPolicy(candidate));
  }
  assert.ok(!all.some(candidate => candidate.reportPeriod === "MONTH" || candidate.reportPeriod === "QUARTER"), "partial edge periods are never rounded outward");
  const attempted = latest.map(domainPolicy => ({ frozenScope: { domainPolicy } }));
  const tx = { amazonSyncDataSource: { findFirstOrThrow: async () => ({ authorizationId: "auth", revision: 1, authorization: { revision: 1 } }), findFirst: async () => null }, amazonSyncRun: { findMany: async () => attempted } } as unknown as import("@prisma/client").Prisma.TransactionClient;
  const next = await nextAutomaticBrandPolicy(tx, { organizationId: "fixture", workspaceId: "fixture" }, "source", p, now);
  assert.deepEqual([next.from, next.to, next.reportPeriod], ["2026-11-05", "2026-11-05", "DAY"]);
  attempted.splice(0, attempted.length, ...all.map(domainPolicy => ({ frozenScope: { domainPolicy } })));
  await assert.rejects(nextAutomaticBrandPolicy(tx, { organizationId: "fixture", workspaceId: "fixture" }, "source", p, now), { status: 409 });
});

test("official registry separates registered operations from adapters; unknown fields survive", () => {
  const schemas = registeredSpApiSchemas();
  assert.ok(schemas.some(s => s.operation === "getSubscriptions" && s.capability === "EXECUTABLE_ADAPTER"));
  assert.ok(schemas.some(s => s.operation === "deleteListingsItem" && s.capability === "NOT_SUPPORTED"));
  assert.equal(new Set(schemas.map(s => `${s.operation}/${s.apiVersion}`)).size, schemas.length);
  const raw = '{"payload":{"subscriptions":[]},"future":{"keep":123}}';
  const result = rawResponseEnvelope(raw, "getSubscriptions", "v1");
  assert.equal(result.rawBody, raw); assert.equal(result.fieldInventory.schemaSource, "OBSERVED_RESPONSE");
  assert.ok((result.registeredContract.unregisteredObservedFields ?? 0) > 0);
  assert.equal(result.registeredContract.officialUniverseComplete, false);
  assert.equal(result.registeredContract.contractSha256?.length, 64);
});

test("Worker recovery requires fresh successful SP-API recovery, queue, connection and version evidence", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  const recovery = { lastSuccessAt: now.toISOString(), spApi: { dispatchFailures: 0, maintenanceFailures: 0 } };
  const health = (r: unknown, extra: Record<string, unknown> = {}) => registeredWorkerHealth([{ queueName: "amazon-data-center-jobs", status: "online", lastSeenAt: now, metadata: { version: "fixture", queueReady: true, connectionIdentity: "fixture-target", recovery: r, ...extra } }], now, "fixture", "fixture-target").find(x => x.id === "amazon-sync")!;
  assert.equal(health(recovery).recoveryReady, true);
  assert.equal(health({ lastSuccessAt: now.toISOString() }).recoveryReady, null);
  assert.equal(health({ ...recovery, lastErrorAt: now.toISOString() }).recoveryReady, false);
  assert.equal(health({ ...recovery, spApi: { dispatchFailures: 0, maintenanceFailures: 1 } }).recoveryReady, false);
  assert.equal(health(recovery, { queueReady: false }).recoveryReady, false);
  assert.equal(health(recovery, { version: "old" }).recoveryReady, false);
  assert.equal(health(recovery, { connectionIdentity: "wrong" }).recoveryReady, false);
});

test("automatic Brand advances past failed report windows while preserving their original attempts", async () => {
  const { nextAutomaticBrandPolicy } = await import("../src/lib/amazon-sync/automatic-brand");
  const p = parseObservationPolicy({ ...common, resource: "brand_analytics", automaticDiscovery: true, reportKind: "search_terms", reportPeriod: "DAY", asins: [], from: "2026-07-01", to: "2026-07-01", marketplaceTimeZone: "America/Los_Angeles" }) as AnalyticsPolicy;
  const now = new Date("2026-11-07T20:00:00Z"), first = automaticBrandCandidates(p, [], now)[0];
  const tx = { amazonSyncDataSource: { findFirstOrThrow: async () => ({ authorizationId: "auth", revision: 1, authorization: { revision: 1 } }), findFirst: async () => null }, amazonSyncRun: { findMany: async () => [{ frozenScope: { domainPolicy: first } }] } } as unknown as import("@prisma/client").Prisma.TransactionClient;
  const next = await nextAutomaticBrandPolicy(tx, { organizationId: "fixture", workspaceId: "fixture" }, "source", p, now);
  assert.equal(first.reportPeriod, "DAY"); assert.equal(next.reportPeriod, "WEEK"); assert.equal(next.reportKind, "search_terms");
});

test("Buy Box failed days remain gaps but do not block later days from scheduling", async () => {
  const { nextBuyBoxPolicy } = await import("../src/lib/amazon-sync/buy-box-history");
  const policy = parseObservationPolicy({ ...common, resource: "buy_box_history", allAsins: true, asins: [], from: "2026-11-03", to: "2026-11-03", marketplaceTimeZone: "America/Los_Angeles" });
  const tx = { amazonSyncRun: { findMany: async () => [{ status: "FAILED", summary: { coverage: { complete: false } }, frozenScope: { domainPolicy: policy } }] } } as unknown as import("@prisma/client").Prisma.TransactionClient;
  const next = await nextBuyBoxPolicy(tx, { organizationId: "fixture", workspaceId: "fixture" }, { id: "source", revision: 1, authorizationId: "auth", authorization: { revision: 1 }, domainPolicy: policy }, new Date("2026-11-07T20:00:00Z"));
  assert.equal(next.from, "2026-11-04");
});
