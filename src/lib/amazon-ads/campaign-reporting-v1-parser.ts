import { AdsQueryError } from "./query-contract";
import { ReportingV1JsonNumber, type ReportingV1JsonValue } from "./reporting-v1-json";
import { campaignReportingV1Fields } from "./campaign-reporting-v1-contract";
import type { AdsStagingFact } from "./report-publication";

export type CampaignReportingV1Fact = {
  reportDate: string;
  campaignId: string;
  campaignName: string | null;
  currencyCode: string;
  impressions: string | null;
  clicks: string | null;
  spend: string | null;
  orders: string | null;
  sales: string | null;
  units: string | null;
};

const maxRows = 100_000;
const maxInt64 = BigInt("9223372036854775807");
const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function invalid(code: string): never {
  throw new AdsQueryError(code);
}

function record(value: ReportingV1JsonValue): Record<string, ReportingV1JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof ReportingV1JsonNumber) return invalid("ADS_REPORT_V1_CAMPAIGN_ROW_INVALID");
  return value;
}

function requiredString(row: Record<string, ReportingV1JsonValue>, field: string, nullable = false): string | null {
  const value = row[field];
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value || value.length > 2000 || /[\u0000-\u001f\u007f]/.test(value)) return invalid("ADS_REPORT_V1_CAMPAIGN_ROW_INVALID");
  return value;
}

function metric(row: Record<string, ReportingV1JsonValue>, field: string, integer: boolean): string | null {
  const value = row[field];
  if (value === null) return null;
  if (!(value instanceof ReportingV1JsonNumber)) return invalid("ADS_REPORT_V1_CAMPAIGN_METRIC_INVALID");
  const source = value.source;
  if (integer) {
    if (!/^(?:0|[1-9]\d*)$/.test(source) || BigInt(source) > maxInt64) return invalid("ADS_REPORT_V1_CAMPAIGN_METRIC_INVALID");
  } else if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(source)) {
    return invalid("ADS_REPORT_V1_CAMPAIGN_METRIC_INVALID");
  }
  return source;
}

/** Maps already-framed JSON row objects; file-level JSON/NDJSON framing remains a separate contract. */
export function mapCampaignReportingV1Rows(rows: readonly ReportingV1JsonValue[], from: string, to: string): CampaignReportingV1Fact[] {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > maxRows || !isDateOnly(from) || !isDateOnly(to) || from > to) return invalid("ADS_REPORT_V1_CAMPAIGN_ROW_SET_INVALID");
  const grains = new Set<string>();
  return rows.map(value => {
    const row = record(value);
    const keys = Object.keys(row);
    if (keys.length !== campaignReportingV1Fields.length || keys.some(key => !campaignReportingV1Fields.includes(key as typeof campaignReportingV1Fields[number]))) return invalid("ADS_REPORT_V1_CAMPAIGN_FIELDS_MISMATCH");

    const reportDate = requiredString(row, "date.value")!;
    const campaignId = requiredString(row, "campaign.id")!;
    const campaignName = requiredString(row, "campaign.name", true);
    const currencyCode = requiredString(row, "budgetCurrency.value")!;
    if (!isDateOnly(reportDate) || reportDate < from || reportDate > to) return invalid("ADS_REPORT_V1_CAMPAIGN_DATE_INVALID");
    if (!/^[A-Z]{3}$/.test(currencyCode)) return invalid("ADS_REPORT_V1_CAMPAIGN_CURRENCY_INVALID");
    const grain = JSON.stringify([reportDate, campaignId]);
    if (grains.has(grain)) return invalid("ADS_REPORT_V1_CAMPAIGN_DUPLICATE_GRAIN");
    grains.add(grain);

    return {
      reportDate,
      campaignId,
      campaignName,
      currencyCode,
      impressions: metric(row, "metric.impressions", true),
      clicks: metric(row, "metric.clicks", true),
      spend: metric(row, "metric.totalCost", false),
      orders: metric(row, "metric.purchases", true),
      sales: metric(row, "metric.sales", false),
      units: metric(row, "metric.unitsSold", true),
    };
  });
}

/** Converts parser output to the existing staging grain without publishing or inferring metrics. */
export function campaignReportingV1RowsToStaging(facts: readonly CampaignReportingV1Fact[]): { currencyCode: string; facts: AdsStagingFact[] } {
  if (!Array.isArray(facts) || facts.length < 1 || facts.length > maxRows) return invalid("ADS_REPORT_V1_CAMPAIGN_ROW_SET_INVALID");
  const currencyCode = facts[0]?.currencyCode;
  if (!currencyCode || facts.some(fact => fact.currencyCode !== currencyCode)) return invalid("ADS_REPORT_V1_CAMPAIGN_CURRENCY_MIXED");
  return {
    currencyCode,
    facts: facts.map(fact => ({
      reportDate: fact.reportDate,
      dimensions: { campaignId: fact.campaignId },
      impressions: fact.impressions,
      clicks: fact.clicks,
      spend: fact.spend,
      orders: fact.orders,
      sales: fact.sales,
      units: fact.units,
    })),
  };
}
