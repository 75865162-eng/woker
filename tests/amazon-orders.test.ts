import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AmazonSpApiClient, AmazonSpApiError } from "@/lib/amazon/sp-api-client";
import { parseOrderSyncPolicy, nextOrderWindow, orderWindowFromFrozen, parseOrderPage, parseOrderDetail, parseOrderMoney, assertOrderRoles } from "@/lib/amazon-sync/orders";
import { reserveOrderToken, orderBucketKey } from "@/lib/amazon-sync/orders-rate-limit";
import { normalizeCommand } from "@/lib/amazon-sync/approval-policy";
import { orderReadWhere } from "@/lib/amazon-sync/orders-query";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/amazon/orders/${name}.json`, import.meta.url), "utf8"));
const policy = parseOrderSyncPolicy(fixture("policy"));
const window = { from: policy.initialFrom, to: "2026-11-01T01:00:00.000Z" };
const config = { lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "", region: "fixture-region", endpoint: "https://spapi.fixture.invalid" };

test("orders policy is explicit, bounded and rejects nonadvancing overlap", () => {
  for (const patch of [{ initialFrom: "2026-02-30T00:00:00Z" }, { windowMinutes: 0 }, { marketplaceTimeZone: "invented" }, { requestsPerSecond: 1 }, { burst: 21 }, { overlapSeconds: 3600 }, { statusMapping: { SHIPPED: 1 } }]) assert.throws(() => parseOrderSyncPolicy({ ...policy, ...patch }));
  assert.throws(() => orderWindowFromFrozen({ ...window, to: window.from }));
});
test("orders freeze one window, resume incomplete cursor and overlap only after completion", () => {
  const now = new Date("2026-11-05T00:00:00Z");
  assert.deepEqual(nextOrderWindow(policy, null, now), window);
  const cursor = { watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), status: "FAILED" };
  assert.deepEqual(nextOrderWindow(policy, cursor, now), window);
  assert.equal(nextOrderWindow(policy, { ...cursor, status: "SUCCEEDED" }, now).from, "2026-11-01T00:58:00.000Z");
  assert.throws(() => nextOrderWindow(policy, null, new Date(window.from)));
});
test("orders parse UTC, null and new enum values without fabricating statuses or amounts", () => {
  const parsed = parseOrderPage(fixture("page-2"), "fixture-marketplace", policy, window);
  assert.equal(parsed.orders[1].createdTime.toISOString(), "2026-10-31T20:00:00.000Z");
  assert.equal(parsed.orders[1].rawStatus, null); assert.equal(parsed.orders[1].normalizedStatus, null);
  const unknown = fixture("page-1"); unknown.orders[0].fulfillment.fulfillmentStatus = "FUTURE_STATUS";
  assert.equal(parseOrderPage(unknown, "fixture-marketplace", policy, window).orders[0].rawStatus, "FUTURE_STATUS");
  assert.equal(parseOrderPage(unknown, "fixture-marketplace", policy, window).orders[0].normalizedStatus, null);
  const hostile = fixture("page-1"); hostile.orders[0].buyer = { buyerName: "fixture-private-buyer" }; hostile.orders[0].proceeds = { grandTotal: { amount: "9007199254740993.123456", currencyCode: "XXX" } };
  const text = JSON.stringify(parseOrderPage(hostile, "fixture-marketplace", policy, window));
  assert.ok(!text.includes("private-buyer") && !text.includes("9007199254740993"));
  for (const pagination of [null, [], false, { nextToken: 1 }]) assert.throws(() => parseOrderPage({ ...hostile, pagination }, "fixture-marketplace", policy, window));
  assert.throws(() => parseOrderPage(hostile, "other-marketplace", policy, window));
});
test("orders token bucket persists quota, blocks after burst and obeys lower observed limits", () => {
  const now = new Date(window.to); let bucket = null;
  for (let i = 0; i < 20; i++) { const r = reserveOrderToken(bucket, policy, now); assert.equal(r.allowed, true); bucket = { tokens: r.tokens, replenishedAt: now, blockedUntil: null, observedLimit: null }; }
  assert.equal(reserveOrderToken(bucket, policy, now).allowed, false);
  assert.equal(reserveOrderToken({ ...bucket!, observedLimit: 0.001 }, policy, now).nextAt.getTime() - now.getTime(), 1000000);
  assert.equal(reserveOrderToken(bucket, policy, new Date(now.getTime() + 180000)).allowed, true);
  assert.notEqual(orderBucketKey("seller-a", "app"), orderBucketKey("seller-b", "app"));
});
test("roles require explicit attestation; untrusted execution windows are removed at request boundary", () => {
  assert.doesNotThrow(() => assertOrderRoles({ approvedRoles: [], rolesAttestedAt: new Date() }, policy));
  assert.doesNotThrow(() => assertOrderRoles({ approvedRoles: policy.requiredRoles, rolesAttestedAt: null }, policy));
  assert.doesNotThrow(() => assertOrderRoles({ approvedRoles: policy.requiredRoles, rolesAttestedAt: new Date() }, policy));
  const normalized = normalizeCommand({ action: "run", sourceIds: ["s"], orderWindows: { s: window } });
  assert.ok(!("orderWindows" in normalized));
});
test("searchOrders uses new-version pagination; FULFILLMENT raw may contain PII", async () => {
  const paths: URL[] = [];
  const client = new AmazonSpApiClient(config, { tokenEndpoint: "https://lwa.fixture.invalid/token", fetch: async input => {
    const url = new URL(String(input)); paths.push(url);
    return url.hostname === "lwa.fixture.invalid" ? Response.json({ access_token: "fixture-access", expires_in: 3600 }) : Response.json(fixture("page-1"));
  } });
  const result = await client.searchOrders({ marketplaceId: "fixture-marketplace", lastUpdatedAfter: window.from, lastUpdatedBefore: window.to, paginationToken: "fixture-next-page-2" });
  assert.equal(paths[1].pathname, "/orders/2026-01-01/orders");
  assert.equal(paths[1].searchParams.get("paginationToken"), "fixture-next-page-2");
  assert.equal(paths[1].searchParams.get("includedData"), "FULFILLMENT");
  assert.equal(paths[1].searchParams.has("NextToken"), false);
  assert.deepEqual(JSON.parse(result.rawBody), result.body);
});

test("detail policy is opt-in, freezes a bounded budget and requires reviewed datasets without manual role registration", () => {
  const detailed = parseOrderSyncPolicy(fixture("policy-details"));
  assert.equal(policy.details, undefined);
  assert.ok(detailed.details?.includedData.includes("BUYER"));
  for (const patch of [{ requestsPerSecond: 1 }, { burst: 31 }, { maxOrders: 0 }, { purpose: "free text or PII" }, { includedData: ["invented"] }, { requiredRoles: ["Fixture Role"] }]) assert.throws(() => parseOrderSyncPolicy({ ...detailed, details: { ...detailed.details, ...patch } }));
  assert.doesNotThrow(() => assertOrderRoles({ approvedRoles: policy.requiredRoles, rolesAttestedAt: new Date() }, detailed));
  const withoutRoles = parseOrderSyncPolicy({ ...detailed, requiredRoles: undefined, details: { ...detailed.details, requiredRoles: undefined } });
  assert.deepEqual(withoutRoles.requiredRoles, []);
  assert.deepEqual(withoutRoles.details?.requiredRoles, []);
  assert.doesNotThrow(() => parseOrderSyncPolicy({ ...detailed, details: { ...detailed.details, requiredRoles: [] } }));
  assert.notEqual(orderBucketKey("fixture-seller", "fixture-app"), orderBucketKey("fixture-seller", "fixture-app", "getOrder"));
  let bucket = null;
  for (let i = 0; i < 30; i++) { const r = reserveOrderToken(bucket, detailed.details!, new Date(window.to)); assert.equal(r.allowed, true); bucket = { tokens: r.tokens, replenishedAt: r.replenishedAt, blockedUntil: null, observedLimit: null }; }
  assert.equal(reserveOrderToken(bucket, detailed.details!, new Date(window.to)).nextAt.getTime() - Date.parse(window.to), 2000);
});

test("getOrder uses the 2026 resource, LWA token and explicit datasets, with separate request telemetry", async () => {
  const paths: URL[] = [], events: string[] = [];
  const client = new AmazonSpApiClient(config, { tokenEndpoint: "https://lwa.fixture.invalid/token", onResponse: e => events.push(e.operation), fetch: async (input, init) => {
    const url = new URL(String(input)); paths.push(url);
    if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-detail-access", expires_in: 3600 });
    assert.equal(new Headers(init?.headers).get("x-amz-access-token"), "fixture-detail-access");
    return Response.json(fixture("detail-1"));
  } });
  const result = await client.getOrder({ orderId: "fixture/order-1", includedData: ["FULFILLMENT", "PROCEEDS"] });
  assert.equal(paths[1].pathname, "/orders/2026-01-01/orders/fixture%2Forder-1");
  assert.equal(paths[1].searchParams.get("includedData"), "FULFILLMENT,PROCEEDS");
  assert.deepEqual(events, ["LWA", "getOrder"]); assert.deepEqual(JSON.parse(result.rawBody), result.body);
  assert.equal(paths.length, 2); // No Tokens/RDT endpoint.
});

test("detail parser preserves exact money, UTC and item keys while excluding all PII", () => {
  const detailed = parseOrderSyncPolicy(fixture("policy-details"));
  const result = parseOrderDetail(fixture("detail-2"), "fixture-order-2", "fixture-marketplace", detailed, new Date("2026-11-01T00:20:00Z"));
  assert.equal(result.createdTime.toISOString(), "2026-10-31T20:00:00.000Z");
  assert.equal(result.rawStatus, null);
  assert.equal(result.grandTotal?.original, "9007199254740993.123456789012345678901234567890");
  assert.equal(result.items[0].proceeds?.original, "12.3400");
  assert.ok(!JSON.stringify(result).includes("fixture-private"));
  const missing = fixture("detail-1"); delete missing.order.buyer; delete missing.order.recipient; delete missing.order.proceeds;
  assert.equal(parseOrderDetail(missing, "fixture-order-1", "fixture-marketplace", detailed, new Date(window.from)).grandTotal, null);
  for (const mutate of [(v: ReturnType<typeof fixture>) => { v.order.orderId = "wrong"; }, (v: ReturnType<typeof fixture>) => { v.order.salesChannel.marketplaceId = "wrong"; }, (v: ReturnType<typeof fixture>) => { delete v.order.orderItems; }, (v: ReturnType<typeof fixture>) => { v.order.orderItems.push(v.order.orderItems[0]); }]) {
    const value = fixture("detail-1"); mutate(value); assert.throws(() => parseOrderDetail(value, "fixture-order-1", "fixture-marketplace", detailed, new Date(window.from)));
  }
  assert.throws(() => parseOrderDetail(fixture("detail-1"), "fixture-order-1", "fixture-marketplace", detailed, new Date(window.to)));
});

test("money rejects numeric inputs and precision loss, supports exact exponent/negative values", () => {
  for (const amount of [1.23, "NaN", "Infinity", "0.0000000000000000000000000000001", "1e35", "1e-31", "1".repeat(36), "01.2"]) assert.throws(() => parseOrderMoney({ amount, currencyCode: "XXX" }));
  for (const amount of ["-12.3400", "1.234e2", "1e-30", "0.00"]) assert.equal(parseOrderMoney({ amount, currencyCode: "XXX" })?.original, amount);
  assert.equal(parseOrderMoney(null), null);
});
test("concurrent refresh is single flight and access token expires five minutes early", async () => {
  let now = new Date(window.to), refreshes = 0;
  const client = new AmazonSpApiClient(config, { tokenEndpoint: "https://lwa.fixture.invalid/token", now: () => now, fetch: async input => {
    if (new URL(String(input)).hostname === "lwa.fixture.invalid") { refreshes++; return Response.json({ access_token: "fixture-access", expires_in: 3600 }); }
    return Response.json({ orders: [] });
  } });
  const call = () => client.searchOrders({ marketplaceId: "fixture-marketplace", lastUpdatedAfter: window.from, lastUpdatedBefore: window.to });
  await Promise.all(Array.from({ length: 20 }, call)); assert.equal(refreshes, 1);
  now = new Date(now.getTime() + 55 * 60000);
  await Promise.all([call(), call()]); assert.equal(refreshes, 2);
});
test("HTTP errors have bounded retry classifications, and raw upstream secrets never enter failures", async () => {
  for (const status of [400, 403, 404, 429, 500]) {
    const client = new AmazonSpApiClient(config, { tokenEndpoint: "https://lwa.fixture.invalid/token", fetch: async input => new URL(String(input)).hostname === "lwa.fixture.invalid" ? Response.json({ access_token: "fixture-access", expires_in: 3600 }) : Response.json({ message: "fixture-secret fixture-access" }, { status }) });
    await assert.rejects(() => client.searchOrders({ marketplaceId: "fixture-marketplace", lastUpdatedAfter: window.from, lastUpdatedBefore: window.to }), error => { assert.ok(error instanceof AmazonSpApiError); assert.equal(error.retryable, status === 429 || status === 500); assert.ok(!error.message.includes("fixture-secret") && !error.message.includes("fixture-access")); return true; });
  }
});

test("orders refresh is single flight across client instances and rotates with credential revision", async () => {
  let now = new Date(window.to), refreshes = 0;
  const options = { cacheScope: "fixture-shared-authorization-v1", tokenEndpoint: "https://lwa.fixture.invalid/token", now: () => now, fetch: async (input: string | URL) => {
    if (new URL(String(input)).hostname === "lwa.fixture.invalid") { refreshes++; return Response.json({ access_token: "fixture-shared-access", expires_in: 3600 }); }
    return Response.json({ orders: [] });
  } };
  const call = (client: AmazonSpApiClient) => client.searchOrders({ marketplaceId: "fixture-marketplace", lastUpdatedAfter: window.from, lastUpdatedBefore: window.to });
  const original = new AmazonSpApiClient(config, options);
  await Promise.all([call(original), ...Array.from({ length: 10 }, () => call(new AmazonSpApiClient(config, options)))]);
  assert.equal(refreshes, 1);
  now = new Date(now.getTime() + 55 * 60000);
  await Promise.all([call(original), call(new AmazonSpApiClient(config, options)), call(new AmazonSpApiClient(config, options))]);
  assert.equal(refreshes, 2);
  await call(new AmazonSpApiClient({ ...config, refreshToken: "fixture-rotated-refresh" }, options));
  assert.equal(refreshes, 3);
});

test("orders query intersects tenant, seller/site grants and explicit filters", () => {
  const access = { allSellers: false, sellerIds: ["allowed-seller"], scopes: [{ sellerAccountId: "allowed-seller", marketplaceIds: ["allowed-site"] }] };
  const result = orderReadWhere({ organizationId: "fixture-org", workspaceId: "fixture-ws" }, new URLSearchParams({ sellerAccountId: "forbidden-seller", marketplaceId: "forbidden-site", amazonOrderId: "fixture-order", from: "2026-11-01", to: "2026-11-02", dateField: "createdTime", sellerSku: "fixture-sku", asin: "fixture-asin" }), access);
  const text = JSON.stringify(result);
  assert.ok(text.includes('"AND"') && text.includes("allowed-seller") && text.includes("forbidden-seller") && text.includes("allowed-site") && text.includes("forbidden-site") && text.includes("fixture-sku") && text.includes("fixture-asin"));
  assert.ok(text.includes('"createdTime"') && text.includes('"items"') && text.includes('"some"'));
  assert.ok(text.includes("2026-11-03T00:00:00.000Z"));
  const updatedDate = orderReadWhere({ organizationId: "fixture-org", workspaceId: "fixture-ws" }, new URLSearchParams({ from: "2026-11-01" }), access);
  assert.ok(JSON.stringify(updatedDate).includes('"sourceUpdatedAt"'));
  for (const from of ["2026-02-30", "invalid", "2026-11-04"]) assert.throws(() => orderReadWhere({ organizationId: "fixture-org", workspaceId: "fixture-ws" }, new URLSearchParams({ from, to: "2026-11-01" }), access));
});

test("core item access evidence is operation/site/revision bound and cannot authorize optional datasets", async () => {
  const { orderAccessEvidence, assertOrderAccessEvidence } = await import("../src/lib/amazon-sync/order-access-evidence");
  const { safeState } = await import("../src/lib/amazon-sync/approval-policy");
  const prior = process.env.AMAZON_SP_API_ENCRYPTION_KEY;
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 47).toString("base64");
  try {
    const c = { organizationId: "fixture", workspaceId: "default", authorizationId: "auth", authorizationRevision: 3, marketplaceId: "site" };
    const at = new Date(), proof = orderAccessEvidence(c, { status: 200, parsed: true, requestId: "fixture-request" }, at);
    const p = parseOrderSyncPolicy({ ...policy, details: { includedData: [], requiredRoles: ["Inventory and Order Tracking"], purpose: "order_items", requestsPerSecond: .2, burst: 1, maxOrders: 5000, backfillExisting: true, accessEvidence: proof } });
    assert.doesNotThrow(() => assertOrderRoles({ approvedRoles: [], rolesAttestedAt: null }, p, false, c));
    assert.doesNotThrow(() => assertOrderRoles({ approvedRoles: [], rolesAttestedAt: null }, p));
    for (const change of [{ organizationId: "foreign" }, { workspaceId: "foreign" }, { authorizationId: "other" }, { authorizationRevision: 4 }, { marketplaceId: "other" }]) assert.throws(() => assertOrderRoles({ approvedRoles: [], rolesAttestedAt: null }, p, false, { ...c, ...change }));
    assert.throws(() => assertOrderAccessEvidence(proof, c, new Date(at.getTime() + 86400000)));
    assert.doesNotThrow(() => assertOrderRoles({ approvedRoles: [], rolesAttestedAt: null }, { ...p, details: { ...p.details!, includedData: ["PROCEEDS"] } }, false, c));
    assert.ok(!JSON.stringify(safeState(p)).includes(proof));
    assert.throws(() => parseOrderSyncPolicy({ ...p, details: { ...p.details, backfillExisting: "all" } }));
  } finally { if (prior === undefined) delete process.env.AMAZON_SP_API_ENCRYPTION_KEY; else process.env.AMAZON_SP_API_ENCRYPTION_KEY = prior; }
});

test("item browser pagination excludes base orders without items and preserves tenant scope", async () => {
  const { orderReadWhere } = await import("../src/lib/amazon-sync/orders-query");
  const where = orderReadWhere({ organizationId: "fixture", workspaceId: "default" }, new URLSearchParams({ itemsOnly: "true" }), { allSellers: true, sellerIds: [] });
  const text = JSON.stringify(where);
  assert.ok(text.includes('"items":{"some":{}}'));
  assert.ok(text.includes('"organizationId":"fixture"'));
});
