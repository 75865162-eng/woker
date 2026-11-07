import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { campaignReportingV1RowsToStaging, mapCampaignReportingV1Rows } from "../src/lib/amazon-ads/campaign-reporting-v1-parser";
import { parseReportingV1GzipJson } from "../src/lib/amazon-ads/reporting-v1-json";
import type { ReportingV1JsonValue } from "../src/lib/amazon-ads/reporting-v1-json";

const row = (overrides: Record<string, unknown> = {}) => ({
  "date.value": "2026-11-01",
  "campaign.id": "campaign-1",
  "campaign.name": "Campaign One",
  "budgetCurrency.value": "USD",
  "metric.impressions": 0,
  "metric.clicks": 3,
  "metric.totalCost": 1.250001,
  "metric.purchases": 1,
  "metric.sales": 42.5,
  "metric.unitsSold": 2,
  ...overrides,
});
const decodeRow = (value: Record<string, unknown>) => parseReportingV1GzipJson(gzipSync(Buffer.from(JSON.stringify(value)))).value;

test("Campaign v1 row decoder maps official flat dotted JSON keys and preserves metric lexemes", () => {
  const source = '{"date.value":"2026-11-01","campaign.id":"campaign-1","campaign.name":null,"budgetCurrency.value":"USD","metric.impressions":9007199254740993,"metric.clicks":3,"metric.totalCost":0,"metric.purchases":1,"metric.sales":null,"metric.unitsSold":2}';
  const parsed = parseReportingV1GzipJson(gzipSync(Buffer.from(source)));
  const result = mapCampaignReportingV1Rows([parsed.value], "2026-11-01", "2026-11-03");
  assert.deepEqual(result, [{
    reportDate: "2026-11-01", campaignId: "campaign-1", campaignName: null, currencyCode: "USD",
    impressions: "9007199254740993", clicks: "3", spend: "0", orders: "1", sales: null, units: "2",
  }]);
});

test("Campaign v1 row decoder rejects missing/unknown fields, invalid values, and repeated grain", () => {
  const missing = row();
  delete (missing as Partial<typeof missing>)["metric.clicks"];
  const values = [missing, row({ extra: "unrequested" }), row({ "date.value": "2026-02-30" }), row({ "campaign.id": "" }), row({ "budgetCurrency.value": null }), row({ "metric.impressions": -1 }), row({ "metric.totalCost": 1e-7 })];
  for (const value of values) {
    const decoded = decodeRow(value) as ReportingV1JsonValue;
    assert.throws(() => mapCampaignReportingV1Rows([decoded], "2026-11-01", "2026-11-03"));
  }
  const decoded = decodeRow(row()) as ReportingV1JsonValue;
  assert.throws(() => mapCampaignReportingV1Rows([decoded, decoded], "2026-11-01", "2026-11-03"), { message: "ADS_REPORT_V1_CAMPAIGN_DUPLICATE_GRAIN" });
  assert.throws(() => mapCampaignReportingV1Rows([decoded], "2026-11-02", "2026-11-01"), { message: "ADS_REPORT_V1_CAMPAIGN_ROW_SET_INVALID" });
});

test("Campaign v1 staging adapter preserves source metrics and zero values", () => {
  const decoded = decodeRow(row({ "metric.impressions": 0, "metric.sales": null })) as ReportingV1JsonValue;
  const parsed = mapCampaignReportingV1Rows([decoded], "2026-11-01", "2026-11-03");
  assert.deepEqual(campaignReportingV1RowsToStaging(parsed), {
    currencyCode: "USD",
    facts: [{
      reportDate: "2026-11-01", dimensions: { campaignId: "campaign-1" },
      impressions: "0", clicks: "3", spend: "1.250001", orders: "1", sales: null, units: "2",
    }],
  });
});

test("Campaign v1 staging adapter refuses mixed-currency batches", () => {
  const first = mapCampaignReportingV1Rows([decodeRow(row()) as ReportingV1JsonValue], "2026-11-01", "2026-11-03")[0];
  const second = { ...first, campaignId: "campaign-2", currencyCode: "EUR" };
  assert.throws(() => campaignReportingV1RowsToStaging([first, second]), { message: "ADS_REPORT_V1_CAMPAIGN_CURRENCY_MIXED" });
});
