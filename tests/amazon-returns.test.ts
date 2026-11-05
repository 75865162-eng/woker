import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { parseReturnPolicy, parseReturnReport, nextReturnWindow, assertReturnRoles, returnPollDelay, returnWindowFromFrozen, returnReportTypes } from "@/lib/amazon-sync/returns";
import { AmazonSpApiClient } from "@/lib/amazon/sp-api-client";
import { normalizeCommand } from "@/lib/amazon-sync/approval-policy";
const file = (name: string) => readFileSync(new URL(`./fixtures/amazon/returns/${name}`, import.meta.url), "utf8");
const policy = parseReturnPolicy(JSON.parse(file("policy.json"))), window = { from: "2026-11-01T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" };
test("FBA TSV retains keys, reason/null/unknown/UTC, hashes private content without projecting it", () => {
  const first = parseReturnReport(file("report.tsv"), window, policy);
  assert.equal(first.total, 3); assert.equal(first.complete, false); assert.equal(first.rows[0].quantity, 2);
  assert.equal(first.rows[0].sellerSku, "fixture sku 1"); assert.equal(first.rows[0].returnAt.toISOString(), "2026-11-01T01:00:00.000Z");
  const second = parseReturnReport(file("report.tsv"), window, policy, 1); assert.equal(second.rows[0].rowHash, first.rows[0].rowHash);
  const final = parseReturnReport(file("report.tsv"), window, policy, 2); assert.equal(final.complete, true); assert.equal(final.rows[0].reasonCode, "FUTURE_REASON"); assert.equal(final.rows[0].rawStatus, null);
  assert.ok(!JSON.stringify([first, final]).includes("fixture-private-comment")); assert.ok(!JSON.stringify(first).includes("fixture private product"));
  assert.equal(parseReturnReport(file("empty.tsv"), window, policy).total, 0);
});
for (const [name, transform] of Object.entries({
  "bad quantity": (s: string) => s.replace('\t2\t', '\t1.5\t'),
  "ambiguous timezone": (s: string) => s.replace('2026-11-01T03:00:00+02:00', '2026-11-01T03:00:00'),
  "out of window": (s: string) => s.replace('2026-11-01T03:00:00+02:00', window.to),
  "invalid calendar": (s: string) => s.replace('2026-11-01T03:00:00+02:00', '2026-02-30T03:00:00Z'),
  "duplicate column": (s: string) => s.replace('customer-comments', 'product-name'),
  "missing column": (s: string) => s.replace('reason\tstatus', 'other\tstatus'),
  "invalid quoting": (s: string) => s + '"private',
})) test(`FBA rejects ${name} without leaking source`, () => {
  assert.throws(() => parseReturnReport(transform(file("report.tsv")), window, policy), e => e instanceof Error && !e.message.includes("fixture-private"));
});
test("return scope policy and window are explicit and bounded", () => {
  assert.throws(() => parseReturnPolicy({ ...policy, reportType: "UNVERIFIED" }));
  assert.throws(() => parseReturnPolicy({ ...policy, batchSize: 501 }));
  assert.throws(() => parseReturnPolicy({ ...policy, budgets: { ...policy.budgets, createReport: { requestsPerSecond: 1, burst: 1 } } }));
  assert.throws(() => assertReturnRoles({ approvedRoles: [], rolesAttestedAt: new Date() }));
  assertReturnRoles({ approvedRoles: ["Amazon Fulfillment"], rolesAttestedAt: new Date() });
  assertReturnRoles({ approvedRoles: ["Pricing"], rolesAttestedAt: new Date() });
  assert.equal(nextReturnWindow(policy, null, new Date("2026-11-05T00:00:00Z")).from, window.from);
  assert.deepEqual(returnWindowFromFrozen(window), window); assert.equal(returnPollDelay(policy, 2, () => 0), 4000);
  assert.equal(normalizeCommand({ action: "run", sourceIds: ["fixture"], returnWindows: { fixture: window } }).returnWindows, undefined);
});
test("existing Reports transport creates FBA enum report and downloads bounded plain/gzip TSV without auth", async () => {
  for (const zipped of [false, true]) {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const client = new AmazonSpApiClient({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "", region: "fixture-region", endpoint: "https://spapi.fixture.invalid" }, { tokenEndpoint: "https://lwa.fixture.invalid/token", reportDownloadTestHost: "download.fixture.invalid", fetch: async (input, init) => {
      const url = new URL(String(input)); requests.push({ path: url.pathname, init });
      if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
      if (url.pathname === "/reports/2021-06-30/reports") { assert.equal(JSON.parse(String(init?.body)).reportType, returnReportTypes.FBA_RECEIVED); return Response.json({ reportId: "fixture-report" }); }
      assert.equal(init?.headers, undefined); assert.equal(init?.redirect, "error");
      return new Response(zipped ? gzipSync(file("report.tsv")) : file("report.tsv"));
    } });
    await client.createReport({ reportType: returnReportTypes.FBA_RECEIVED, marketplaceId: "fixture-marketplace", ...window });
    const text = await client.downloadReportText({ url: "https://download.fixture.invalid/document?fixture-signed-value", ...(zipped ? { compressionAlgorithm: "GZIP" } : {}) });
    assert.equal(text.replace(/^\ufeff/, ''), file("report.tsv").replace(/^\ufeff/, ''));
    assert.equal(requests.length, 3);
    await assert.rejects(client.downloadReportText({ url: "https://not-storage.fixture.invalid/document" }));
  }
});

test("return report labels retain unknown values including spaces", () => {
  const report = file("report.tsv").replaceAll("FUTURE_REASON", "Future reason value").replaceAll("SELLABLE", "Future disposition");
  const rows = parseReturnReport(report, window, { ...policy, batchSize: 500 }).rows;
  assert.equal(rows[0].disposition, "Future disposition"); assert.equal(rows[2].reasonCode, "Future reason value");
});
