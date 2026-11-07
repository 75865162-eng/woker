import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { campaignReportManifest, campaignReportRequest, parseCampaignReport, type CampaignReportSpec } from "../src/lib/amazon-ads/campaign-report-contract";

const spec: CampaignReportSpec = { from: "2026-11-01", to: "2026-11-02", currencyCode: "USD", timezone: "America/Los_Angeles", attributionDays: 7 };
const row = { date: spec.from, campaignId: 101, campaignBudgetCurrencyCode: "USD", impressions: 100, clicks: 10, cost: 1.25, purchases7d: 0, sales7d: null, unitsSoldClicks7d: null };
const parse = (rows: unknown) => parseCampaignReport(gzipSync(JSON.stringify(rows)), spec);

test("campaign daily request pins grain, explicit attribution and documented range", () => {
  const request = campaignReportRequest(spec);
  assert.deepEqual(request.configuration.groupBy, ["campaign"]);
  assert.equal(request.configuration.reportTypeId, "spCampaigns");
  assert.ok(request.configuration.columns.includes("purchases7d"));
  assert.equal(campaignReportManifest(spec).evidence, "ISOLATED_FIXTURE_ONLY");
  assert.throws(() => campaignReportRequest({ ...spec, to: "2026-12-02" }), /RANGE/);
  assert.throws(() => campaignReportRequest({ ...spec, from: "2026-02-30" }), /DATE/);
});
test("gzip mapping preserves zero, null, decimal strings and safe IDs", () => {
  assert.deepEqual(parse([row]), [{ reportDate: spec.from, dimensions: { campaignId: "101" }, impressions: "100", clicks: "10", spend: "1.25", orders: "0", sales: null, units: null }]);
  const facts = parse([{ ...row, campaignId: "9223372036854775807", impressions: "9007199254740993", cost: "12345678901234.123456" }]);
  assert.equal(facts[0].impressions, "9007199254740993");
  assert.equal(facts[0].spend, "12345678901234.123456");
  const oneDay = { ...spec, attributionDays: 1 as const };
  assert.ok(campaignReportRequest(oneDay).configuration.columns.includes("sales1d"));
});
test("unsafe source numbers, wrong grain/currency/attribution and duplicates are rejected", () => {
  for (const invalid of [
    { ...row, campaignId: 9007199254740992 }, { ...row, impressions: 1.5 },
    { ...row, cost: -1 }, { ...row, cost: 1000001 }, { ...row, date: "2026-10-31" },
    { ...row, campaignBudgetCurrencyCode: "CAD" }, { ...row, campaignBudgetCurrencyCode: null },
    { ...row, adGroupId: "1" }, { ...row, purchases14d: 1 },
  ]) assert.throws(() => parse([invalid]));
  assert.throws(() => parse([row, row]), /DUPLICATE_GRAIN/);
  assert.throws(() => parse([]), /EMPTY/);
});
test("compressed, uncompressed and row bounds apply before staging", () => {
  assert.throws(() => parseCampaignReport(Buffer.from("bad gzip"), spec), /GZIP/);
  const bytes = gzipSync(JSON.stringify([row]));
  assert.throws(() => parseCampaignReport(bytes, spec, { compressedBytes: 1, uncompressedBytes: 1000, rows: 1 }), /COMPRESSED/);
  assert.throws(() => parseCampaignReport(bytes, spec, { compressedBytes: 1000, uncompressedBytes: 10, rows: 1 }), /GZIP/);
  assert.throws(() => parseCampaignReport(gzipSync(JSON.stringify([row, { ...row, campaignId: 102 }])), spec, { compressedBytes: 1000, uncompressedBytes: 1000, rows: 1 }), /ROW_LIMIT/);
});
