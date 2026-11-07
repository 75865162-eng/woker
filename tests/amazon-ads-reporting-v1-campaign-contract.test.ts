import assert from "node:assert/strict";
import test from "node:test";
import { campaignReportingV1Evidence, campaignReportingV1Request } from "../src/lib/amazon-ads/campaign-reporting-v1-contract";

test("SP Campaign v1 daily request uses only documented compatible fields", () => {
  const request = campaignReportingV1Request("2026-11-01", "2026-11-03");
  assert.deepEqual(request, {
    format: "GZIP_JSON",
    periods: [{ datePeriod: { startDate: "2026-11-01", endDate: "2026-11-03" } }],
    query: { fields: [
      "date.value", "campaign.id", "campaign.name", "budgetCurrency.value",
      "metric.impressions", "metric.clicks", "metric.totalCost", "metric.purchases", "metric.sales", "metric.unitsSold",
    ] },
  });
  assert.equal(campaignReportingV1Evidence.adProduct, "SPONSORED_PRODUCTS");
  assert.equal(campaignReportingV1Evidence.attribution, "SP_DEFAULT_LOOKBACK_SELLER_7D_VENDOR_14D");
  assert.ok(campaignReportingV1Evidence.unresolved.includes("DOWNLOADED_JSON_ROW_ENCODING"));
});

test("SP Campaign v1 request rejects invalid and reversed dates without imposing an undocumented history limit", () => {
  for (const [from, to] of [["2026-02-30", "2026-03-01"], ["2026-11-02", "2026-11-01"], ["2026/11/01", "2026-11-01"]]) {
    assert.throws(() => campaignReportingV1Request(from, to), { message: "ADS_REPORT_V1_CAMPAIGN_DATE_RANGE_INVALID" });
  }
  assert.equal(campaignReportingV1Request("2025-01-01", "2026-11-01").periods[0].datePeriod.endDate, "2026-11-01");
});
