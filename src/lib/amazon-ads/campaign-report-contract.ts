import { gunzipSync } from "node:zlib";
import { TextDecoder } from "node:util";
import type { AdsReportManifest, AdsStagingFact } from "./report-publication";
import { AdsQueryError } from "./query-contract";

/** Public documentation evidence, not authorization to issue a live report request. */
export const campaignReportEvidence = {
  checkedAt: "2026-11-06",
  urls: [
    "https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/report-types/campaign",
    "https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/get-started",
    "https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/quickstart",
  ],
  apiVersion: "reporting-v3", reportType: "spCampaigns", maxDays: 31, retentionDays: 95,
  deprecationDate: "2027-06-30", liveEnabled: false,
  unresolved: ["V1_ADVERTISER_ACCOUNT_BINDING", "LIVE_PROFILE_ACCEPTANCE", "DOWNLOAD_HOST_ALLOWLIST", "ATTRIBUTION_FINALIZATION_SLA"],
} as const;

export type CampaignReportSpec = {
  from: string; to: string; currencyCode: string; timezone: string;
  attributionDays: 1 | 7 | 14 | 30;
};
export function campaignReportManifest(spec: CampaignReportSpec): AdsReportManifest {
  const date = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new AdsQueryError("ADS_CAMPAIGN_REPORT_DATE_INVALID");
    return Date.parse(value);
  };
  const days = (date(spec.to) - date(spec.from)) / 86400000 + 1;
  if (days < 1 || days > campaignReportEvidence.maxDays || ![1, 7, 14, 30].includes(spec.attributionDays)) throw new AdsQueryError("ADS_CAMPAIGN_REPORT_RANGE_OR_ATTRIBUTION_INVALID");
  if (!/^[A-Z]{3}$/.test(spec.currencyCode)) throw new AdsQueryError("ADS_CAMPAIGN_REPORT_CURRENCY_INVALID");
  try { new Intl.DateTimeFormat("en", { timeZone: spec.timezone }); } catch { throw new AdsQueryError("ADS_CAMPAIGN_REPORT_TIMEZONE_INVALID"); }
  return { evidence: "ISOLATED_FIXTURE_ONLY", apiVersion: campaignReportEvidence.apiVersion, reportType: campaignReportEvidence.reportType, adProduct: "SPONSORED_PRODUCTS", from: spec.from, to: spec.to, currencyCode: spec.currencyCode, timezone: spec.timezone, attributionWindow: `${spec.attributionDays}d`, dimensions: ["campaignId"], metrics: ["impressions", "clicks", "spend", "orders", "sales", "units"] };
}

export function campaignReportRequest(spec: CampaignReportSpec) {
  campaignReportManifest(spec);
  return { startDate: spec.from, endDate: spec.to, configuration: {
    adProduct: "SPONSORED_PRODUCTS", groupBy: ["campaign"],
    columns: ["date", "campaignId", "campaignBudgetCurrencyCode", "impressions", "clicks", "cost", `purchases${spec.attributionDays}d`, `sales${spec.attributionDays}d`, `unitsSoldClicks${spec.attributionDays}d`],
    reportTypeId: "spCampaigns", timeUnit: "DAILY", format: "GZIP_JSON",
  } };
}

export type CampaignReportLimits = { compressedBytes: number; uncompressedBytes: number; rows: number };
export const isolatedCampaignReportLimits: CampaignReportLimits = { compressedBytes: 1024 * 1024, uncompressedBytes: 8 * 1024 * 1024, rows: 1000 };

/** Bounded single GZIP_JSON document. V3 is single-file; never invent V1 multipart semantics. */
export function parseCampaignReport(buffer: Buffer, spec: CampaignReportSpec, limits: CampaignReportLimits = isolatedCampaignReportLimits): AdsStagingFact[] {
  campaignReportManifest(spec);
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1) || limits.rows > 1000 || limits.compressedBytes > isolatedCampaignReportLimits.compressedBytes || limits.uncompressedBytes > isolatedCampaignReportLimits.uncompressedBytes) throw new AdsQueryError("ADS_CAMPAIGN_REPORT_LIMITS_INVALID");
  if (!buffer.length || buffer.length > limits.compressedBytes) throw new AdsQueryError("ADS_REPORT_COMPRESSED_LIMIT");
  let rows: unknown;
  try { rows = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(gunzipSync(buffer, { maxOutputLength: limits.uncompressedBytes }))); }
  catch { throw new AdsQueryError("ADS_REPORT_GZIP_OR_JSON_INVALID"); }
  if (!Array.isArray(rows) || !rows.length || rows.length > limits.rows) throw new AdsQueryError("ADS_REPORT_EMPTY_OR_ROW_LIMIT");
  const keys = new Set<string>();
  const columns = new Set(campaignReportRequest(spec).configuration.columns);
  const integer = (value: unknown) => {
    if (value == null) return null;
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) throw new AdsQueryError("ADS_REPORT_INTEGER_PRECISION_INVALID");
    const text = String(value);
    if (!/^(0|[1-9]\d*)$/.test(text) || BigInt(text) > BigInt("9223372036854775807")) throw new AdsQueryError("ADS_REPORT_INTEGER_INVALID");
    return text;
  };
  const decimal = (value: unknown) => {
    if (value == null) return null;
    // Large numeric JSON amounts may already have rounded; require strings above this safe bound.
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0 || value > 1_000_000)) throw new AdsQueryError("ADS_REPORT_DECIMAL_PRECISION_INVALID");
    const text = String(value);
    if (!/^\d{1,14}(\.\d{1,6})?$/.test(text)) throw new AdsQueryError("ADS_REPORT_DECIMAL_INVALID");
    return text;
  };
  return rows.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdsQueryError("ADS_REPORT_ROW_INVALID");
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some(key => !columns.has(key))) throw new AdsQueryError("ADS_REPORT_UNEXPECTED_COLUMN");
    const campaignId = integer(row.campaignId);
    if (!campaignId || campaignId === "0" || typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0,10) !== row.date || row.date < spec.from || row.date > spec.to) throw new AdsQueryError("ADS_REPORT_GRAIN_OR_DATE_INVALID");
    if (row.campaignBudgetCurrencyCode !== spec.currencyCode) throw new AdsQueryError("ADS_REPORT_CURRENCY_MISMATCH");
    const key = `${row.date}:${campaignId}`;
    if (keys.has(key)) throw new AdsQueryError("ADS_REPORT_DUPLICATE_GRAIN");
    keys.add(key);
    return { reportDate: row.date, dimensions: { campaignId }, impressions: integer(row.impressions), clicks: integer(row.clicks), spend: decimal(row.cost), orders: integer(row[`purchases${spec.attributionDays}d`]), sales: decimal(row[`sales${spec.attributionDays}d`]), units: integer(row[`unitsSoldClicks${spec.attributionDays}d`]) };
  });
}
