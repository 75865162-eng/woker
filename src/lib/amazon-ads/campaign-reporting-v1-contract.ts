import { AdsQueryError } from "./query-contract";
import type { ReportingV1CreateReport } from "./reporting-v1-transport";

/** Official field evidence for the first SP Campaign daily report. */
export const campaignReportingV1Evidence = Object.freeze({
  checkedAt: "2026-11-06",
  urls: [
    "https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/quickstart",
    "https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/overview",
    "https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/dimensions/level-of-detail/campaign",
    "https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/metrics/amazon-retail-conversions/purchases",
    "https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/metrics/costs-and-fees/costs",
  ],
  adProduct: "SPONSORED_PRODUCTS",
  attribution: "SP_DEFAULT_LOOKBACK_SELLER_7D_VENDOR_14D",
  unresolved: ["DOWNLOADED_JSON_ROW_ENCODING", "LIVE_PROFILE_ACCEPTANCE", "DOWNLOAD_HOST_ALLOWLIST"],
} as const);

export const campaignReportingV1Fields = Object.freeze([
  "date.value",
  "campaign.id",
  "campaign.name",
  "budgetCurrency.value",
  "metric.impressions",
  "metric.clicks",
  "metric.totalCost",
  "metric.purchases",
  "metric.sales",
  "metric.unitsSold",
]);

function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Builds the frozen minimal request; it does not call Amazon or infer downloaded row shape. */
export function campaignReportingV1Request(from: string, to: string): ReportingV1CreateReport {
  if (!isDateOnly(from) || !isDateOnly(to) || from > to) throw new AdsQueryError("ADS_REPORT_V1_CAMPAIGN_DATE_RANGE_INVALID");
  return {
    format: "GZIP_JSON",
    periods: [{ datePeriod: { startDate: from, endDate: to } }],
    query: { fields: [...campaignReportingV1Fields] },
  };
}
