import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseFinancePolicy, parseFinancePage, attributeFinanceTransaction, convertFinanceMoney, nextFinanceWindow, assertFinanceRoles, financeWindowFromFrozen } from "@/lib/amazon-sync/finance";
import { normalizeCommand } from "@/lib/amazon-sync/approval-policy";
import { AmazonSpApiClient } from "@/lib/amazon/sp-api-client";
import { sourceAccessWhere } from "@/lib/amazon-sync/data-access";
const raw = (name: string) => readFileSync(new URL(`./fixtures/amazon/finance/${name}.json`, import.meta.url), "utf8");
const policy = parseFinancePolicy(JSON.parse(raw("policy")));
const window = { from: "2026-11-01T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" };
const page = () => parseFinancePage(raw("page-1"), window);

test("finance retains exact wire decimals, offset UTC and real identifiers", () => {
  const row = page().transactions[0];
  assert.equal(row.amount.original, "9007199254740993.123456789012345678901234567890");
  assert.equal(row.postedAt.toISOString(), "2026-11-01T01:00:00.000Z");
  assert.equal(row.orderId, "fixture-order-1"); assert.equal(row.rawStatus, "Released");
  assert.equal(convertFinanceMoney(row.amount, row.postedAt, policy).amount, "10133099161583617.26");
  const rows = parseFinancePage(raw("page-2"), window).transactions;
  assert.equal(rows[0].amount.original, "-1.2300"); assert.equal(rows[0].classification, "NON_ORDER");
  assert.equal(rows[1].amount.original, "3e-8"); assert.equal(rows[1].rawStatus, null);
  assert.equal(convertFinanceMoney(rows[0].amount, rows[0].postedAt, policy).status, "UNCONVERTED");
});
test("finance uses actual site, quarantines missing/conflicting sites, rejects seller/site overflow", () => {
  const row = page().transactions[0];
  assert.equal(attributeFinanceTransaction(row, "fixture-seller", policy).marketplaceId, "fixture-site-b");
  assert.equal(attributeFinanceTransaction({ ...row, metadataMarketplaceId: null, detailsMarketplaceId: null }, "fixture-seller", policy).reason, "MISSING_MARKETPLACE");
  assert.equal(attributeFinanceTransaction({ ...row, metadataMarketplaceId: "fixture-site-a" }, "fixture-seller", policy).reason, "CONFLICTING_MARKETPLACE");
  for (const patch of [{ sellingPartnerId: null }, { sellingPartnerId: "other" }, { metadataMarketplaceId: "outside" }]) assert.throws(() => attributeFinanceTransaction({ ...row, ...patch }, "fixture-seller", policy), /批准|卖家/);
  assert.deepEqual(sourceAccessWhere({ allSellers: false, sellerIds: ["fixture"] }).resource, { not: "finance" });
});
for (const [name, transform] of Object.entries({
  "missing transaction ID": (s: string) => s.replace('"fixture-tx-1"', 'null'),
  "string amount": (s: string) => s.replace('9007199254740993.123456789012345678901234567890', '"1.2"'),
  "too precise": (s: string) => s.replace('9007199254740993.123456789012345678901234567890', '1e-31'),
  "too large": (s: string) => s.replace('9007199254740993.123456789012345678901234567890', '1e35'),
  "duplicate decoded key": (s: string) => s.replace('"currencyCode":"EUR"', '"currencyCode":"EUR","currency\\u0043ode":"USD"'),
  "invalid calendar": (s: string) => s.replace('2026-11-01T03:00:00+02:00', '2026-02-30T03:00:00+02:00'),
  "window upper exclusive": (s: string) => s.replace('2026-11-01T03:00:00+02:00', window.to),
  "invalid trailing JSON": (s: string) => s + "null",
  "deep data": (s: string) => s.replace('"fixture-private-description"', '['.repeat(66) + '0' + ']'.repeat(66)),
})) test(`finance rejects ${name} without reflecting private response`, () => {
  assert.throws(() => parseFinancePage(transform(raw("page-1")), window), e => e instanceof Error && !e.message.includes("fixture-private-description") && !e.message.includes("currencyAmount"));
});
test("empty pages retain token; null token completes; duplicate transactions reject", () => {
  assert.equal(parseFinancePage('{"payload":{"transactions":[],"nextToken":"fixture-next"}}', window).nextToken, "fixture-next");
  assert.equal(parseFinancePage('{"payload":{"transactions":[],"nextToken":null}}', window).nextToken, undefined);
  const v = JSON.parse(raw("page-2"));v.payload.transactions.push(v.payload.transactions[0]);
  assert.throws(() => parseFinancePage(JSON.stringify(v), window), /重复/);
});
test("finance policy freezes windows and refuses unapproved scope, FX ambiguity or role", () => {
  assert.throws(() => parseFinancePolicy({ ...policy, sellerWide: false }));
  assert.throws(() => parseFinancePolicy({ ...policy, requestsPerSecond: 1 }));
  assert.throws(() => parseFinancePolicy({ ...policy, fx: { ...policy.fx, rates: [policy.fx!.rates[0], policy.fx!.rates[0]] } }));
  assert.throws(() => assertFinanceRoles({ approvedRoles: [], rolesAttestedAt: new Date() }), /Finance and Accounting/);
  assert.throws(() => assertFinanceRoles({ approvedRoles: ["Finance and Accounting"], rolesAttestedAt: null }));
  assertFinanceRoles({ approvedRoles: ["Finance and Accounting"], rolesAttestedAt: new Date() });
  const next = nextFinanceWindow(policy, { watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), status: "SUCCEEDED" }, new Date("2026-11-05T00:00:00Z"));
  assert.equal(next.from, "2026-11-01T23:00:00.000Z");
  assert.deepEqual(nextFinanceWindow(policy, { watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), status: "FAILED" }, new Date()), window);
  assert.deepEqual(financeWindowFromFrozen(window), window);
  assert.equal(normalizeCommand({ action: "run", sourceIds: ["fixture"], financeWindows: { fixture: window } }).financeWindows, undefined);
});
test("Finances v2024-06-19 preserves raw bytes and filters across nextToken, omits site", async () => {
  const urls: URL[] = [];
  const client = new AmazonSpApiClient({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "", region: "fixture-region", endpoint: "https://finance.fixture.invalid" }, { tokenEndpoint: "https://lwa.fixture.invalid/token", fetch: async input => {
    const url = new URL(String(input)); urls.push(url);
    return url.hostname === "lwa.fixture.invalid" ? Response.json({ access_token: "fixture-access", expires_in: 3600 }) : new Response(raw("page-1"));
  } });
  const result = await client.listTransactions({ postedAfter: window.from, postedBefore: window.to, nextToken: "fixture-next" });
  assert.equal(result.rawBody, raw("page-1"));
  assert.equal(urls[1].pathname, "/finances/2024-06-19/transactions");
  assert.equal(urls[1].searchParams.get("postedAfter"), window.from);
  assert.equal(urls[1].searchParams.get("postedBefore"), window.to);
  assert.equal(urls[1].searchParams.get("nextToken"), "fixture-next");
  assert.equal(urls[1].searchParams.has("marketplaceId"), false);
});
test("finance refresh is single flight across instances and renews at expires_in minus five minutes", async () => {
  let instant = new Date(window.to), refreshes = 0;
  const config = { lwaClientId: "fixture-finance-client", lwaClientSecret: "fixture-finance-secret", refreshToken: "fixture-finance-refresh", awsAccessKeyId: "", awsSecretAccessKey: "", region: "fixture-region", endpoint: "https://finance.fixture.invalid" };
  const options = { cacheScope: "fixture-finance-refresh-scope", tokenEndpoint: "https://lwa.fixture.invalid/token", now: () => instant, fetch: async (input: string | URL) => {
    if (new URL(String(input)).hostname === "lwa.fixture.invalid") { refreshes++; return Response.json({ access_token: "fixture-finance-access", expires_in: 3600 }); }
    return new Response('{"payload":{"transactions":[]}}');
  } };
  const request = () => new AmazonSpApiClient(config, options).listTransactions({ postedAfter: window.from, postedBefore: window.to });
  await Promise.all(Array.from({ length: 20 }, request)); assert.equal(refreshes, 1);
  instant = new Date(instant.getTime() + 55 * 60000);
  await Promise.all([request(), request(), request()]); assert.equal(refreshes, 2);
});
