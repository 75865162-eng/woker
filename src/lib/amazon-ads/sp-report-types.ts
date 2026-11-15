import { gunzipSync } from "node:zlib";
import { TextDecoder } from "node:util";
import { AdsQueryError } from "./query-contract";
import type { AdsStagingFact } from "./report-publication";

/**
 * Sponsored Products 绩效报表目录（Reporting v3）。
 * 依据官方报表类型页：campaign / advertised-product / search-term / placement / targeting。
 * SP 没有独立的 placement reportTypeId，官方做法是 spCampaigns + groupBy campaignPlacement，
 * 所以这里第 4 类复用 spCampaigns，但用独立目录 ID 与独立 domain state，避免与活动报表互相覆盖。
 */
export const spReportTypeIds = ["campaign", "advertised-product", "search-term", "placement", "targeting"] as const;
export type SpReportType = (typeof spReportTypeIds)[number];

export type SpReportDefinition = {
  id: SpReportType;
  label: string;
  /** capabilities.ts 中的能力域名字，用于能力矩阵与界面标签对齐。 */
  capability: string;
  reportTypeId: string;
  groupBy: readonly string[];
  /** 完整列（文档中有明确列名的维度与指标）。 */
  columns: readonly string[];
  /** 兼容列：若 Amazon 拒绝某个可选列，只保留日期、粒度与指标重试一次。 */
  coreColumns: readonly string[];
  maxDays: number;
  retentionDays: number;
  timeUnit: "DAILY";
  format: "GZIP_JSON";
  grain: readonly (keyof AdsStagingFact["dimensions"])[];
  docs: string;
  /** 该报表是否带币种列（活动/位置报表带 campaignBudgetCurrencyCode）。 */
  currencyColumn: string | null;
};

const metricColumns = ["impressions", "clicks", "cost", "purchasesClicks", "salesClicks", "unitsSoldClicks"] as const;

export const spReportDefinitions: Readonly<Record<SpReportType, SpReportDefinition>> = Object.freeze({
  campaign: {
    id: "campaign", label: "活动绩效", capability: "campaign-performance",
    reportTypeId: "spCampaigns", groupBy: ["campaign"],
    columns: ["date", "campaignId", "campaignName", "campaignBudgetCurrencyCode", "campaignStatus", ...metricColumns],
    coreColumns: ["date", "campaignId", ...metricColumns],
    maxDays: 31, retentionDays: 95, timeUnit: "DAILY", format: "GZIP_JSON",
    grain: ["campaignId"], docs: "guides/reporting/v3/report-types/campaign", currencyColumn: "campaignBudgetCurrencyCode",
  },
  "advertised-product": {
    id: "advertised-product", label: "投放商品绩效", capability: "advertised-product-performance",
    reportTypeId: "spAdvertisedProduct", groupBy: ["advertiser"],
    columns: ["date", "campaignId", "adGroupId", "advertisedAsin", "advertisedSku", ...metricColumns],
    coreColumns: ["date", "campaignId", "adGroupId", "advertisedAsin", ...metricColumns],
    maxDays: 31, retentionDays: 95, timeUnit: "DAILY", format: "GZIP_JSON",
    grain: ["campaignId", "adGroupId", "advertisedAsin"], docs: "guides/reporting/v3/report-types/advertised-product", currencyColumn: null,
  },
  "search-term": {
    id: "search-term", label: "搜索词绩效", capability: "search-term-performance",
    reportTypeId: "spSearchTerm", groupBy: ["searchTerm"],
    columns: ["date", "campaignId", "adGroupId", "keywordId", "keyword", "keywordType", "matchType", "searchTerm", ...metricColumns],
    coreColumns: ["date", "campaignId", "adGroupId", "searchTerm", ...metricColumns],
    maxDays: 31, retentionDays: 65, timeUnit: "DAILY", format: "GZIP_JSON",
    // keywordId 收进 targetingId，保证同一搜索词在不同关键词下不被错误合并。
    grain: ["campaignId", "adGroupId", "targetingId", "searchTerm"], docs: "guides/reporting/v3/report-types/search-term", currencyColumn: null,
  },
  placement: {
    id: "placement", label: "位置绩效", capability: "placement-performance",
    reportTypeId: "spCampaigns", groupBy: ["campaignPlacement"],
    columns: ["date", "campaignId", "campaignName", "campaignBudgetCurrencyCode", "placementClassification", ...metricColumns],
    coreColumns: ["date", "campaignId", "placementClassification", ...metricColumns],
    maxDays: 31, retentionDays: 95, timeUnit: "DAILY", format: "GZIP_JSON",
    grain: ["campaignId", "placement"], docs: "guides/reporting/v3/report-types/placement", currencyColumn: "campaignBudgetCurrencyCode",
  },
  targeting: {
    id: "targeting", label: "定向绩效", capability: "targeting-performance",
    reportTypeId: "spTargeting", groupBy: ["targeting"],
    columns: ["date", "campaignId", "adGroupId", "targetingId", "targeting", "keyword", "keywordType", "matchType", ...metricColumns],
    coreColumns: ["date", "campaignId", "adGroupId", "targetingId", ...metricColumns],
    maxDays: 31, retentionDays: 95, timeUnit: "DAILY", format: "GZIP_JSON",
    grain: ["campaignId", "adGroupId", "targetingId"], docs: "guides/reporting/v3/report-types/targeting", currencyColumn: null,
  },
});

export function isSpReportType(value: unknown): value is SpReportType {
  return typeof value === "string" && (spReportTypeIds as readonly string[]).includes(value);
}

export function spReportDefinition(type: SpReportType): SpReportDefinition {
  if (!isSpReportType(type)) throw new AdsQueryError("ADS_REPORT_TYPE_INVALID");
  return spReportDefinitions[type];
}

/** Reporting v3 请求体：POST /reporting/reports。字段顺序固定，便于冻结范围摘要。 */
export type SpReportRequest = {
  name: string;
  startDate: string;
  endDate: string;
  configuration: {
    adProduct: "SPONSORED_PRODUCTS";
    groupBy: string[];
    columns: string[];
    reportTypeId: string;
    timeUnit: "DAILY";
    format: "GZIP_JSON";
  };
};

export function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function spReportDays(from: string, to: string): number {
  if (!isDateOnly(from) || !isDateOnly(to) || from > to) throw new AdsQueryError("ADS_REPORT_DATE_RANGE_INVALID");
  return (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
}

export function spReportRequest(type: SpReportType, from: string, to: string, columns?: "full" | "core"): SpReportRequest {
  const definition = spReportDefinition(type);
  const days = spReportDays(from, to);
  if (days > definition.maxDays) throw new AdsQueryError("ADS_REPORT_RANGE_EXCEEDS_TYPE_LIMIT");
  return {
    name: `woker-${definition.reportTypeId}-${from}-${to}`,
    startDate: from,
    endDate: to,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: [...definition.groupBy],
      columns: [...(columns === "core" ? definition.coreColumns : definition.columns)],
      reportTypeId: definition.reportTypeId,
      timeUnit: definition.timeUnit,
      format: definition.format,
    },
  };
}

/** 与 Amazon 报表请求一一对应的冻结摘要，用于跨重启比对，防止同一任务被换合同。 */
export function spReportRequestDigest(request: SpReportRequest): string {
  return JSON.stringify([request.startDate, request.endDate, request.configuration.adProduct, request.configuration.groupBy, request.configuration.columns, request.configuration.reportTypeId, request.configuration.timeUnit, request.configuration.format]);
}

/** 默认窗口：昨天为终点，按回看天数取区间，且不超过类型上限与保留期。 */
export function spReportWindow(type: SpReportType, now: Date, lookbackDays: number) {
  const definition = spReportDefinition(type);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86400000);
  const span = Math.max(1, Math.min(Math.trunc(lookbackDays) || 1, definition.maxDays));
  const start = new Date(end.getTime() - (span - 1) * 86400000);
  const earliest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (definition.retentionDays - 1) * 86400000);
  return { from: new Date(Math.max(start.getTime(), earliest.getTime())).toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export type SpReportLimits = { compressedBytes: number; uncompressedBytes: number; rows: number };
export const defaultSpReportLimits: SpReportLimits = {
  compressedBytes: 16 * 1024 * 1024,
  uncompressedBytes: 64 * 1024 * 1024,
  rows: 100_000,
};

export type SpReportParseResult = {
  facts: Array<AdsStagingFact & { currencyCode: string | null }>;
  rowCount: number;
  mergedRows: number;
  ignoredColumns: string[];
};

const maxInt64 = BigInt("9223372036854775807");

function integer(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new AdsQueryError("ADS_REPORT_INTEGER_INVALID");
    return String(value);
  }
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d*)$/.test(text) || BigInt(text) > maxInt64) throw new AdsQueryError("ADS_REPORT_INTEGER_INVALID");
  return text;
}

function decimal(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) throw new AdsQueryError("ADS_REPORT_DECIMAL_INVALID");
    // JSON 数字可能已丢失精度，只接受 6 位小数以内的可回读值。
    const text = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    if (!/^\d{1,14}(\.\d{1,6})?$/.test(text)) throw new AdsQueryError("ADS_REPORT_DECIMAL_INVALID");
    return text;
  }
  const text = String(value).trim();
  if (!/^\d{1,14}(\.\d{1,6})?$/.test(text)) throw new AdsQueryError("ADS_REPORT_DECIMAL_INVALID");
  return text;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") throw new AdsQueryError("ADS_REPORT_ROW_INVALID");
  const result = String(value).trim();
  if (!result) return null;
  if (result.length > 2000 || /[\u0000-\u001f\u007f]/.test(result)) throw new AdsQueryError("ADS_REPORT_ROW_INVALID");
  return result;
}

type Row = Record<string, unknown>;

/** 按报表类型把一行 v3 宽表映射到本地事实粒度。 */
export function mapSpReportRow(type: SpReportType, row: Row, from: string, to: string, currencyCode: string | null) {
  const definition = spReportDefinition(type);
  const reportDate = text(row.date);
  if (!isDateOnly(reportDate) || reportDate < from || reportDate > to) throw new AdsQueryError("ADS_REPORT_DATE_INVALID");
  const get = (...keys: string[]) => {
    for (const key of keys) if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
    return null;
  };
  const campaignId = text(get("campaignId"));
  const adGroupId = text(get("adGroupId"));
  const dimensions: AdsStagingFact["dimensions"] = {};
  if (campaignId) dimensions.campaignId = campaignId;
  if (adGroupId) dimensions.adGroupId = adGroupId;
  if (definition.grain.includes("advertisedAsin")) {
    const asin = text(get("advertisedAsin", "asin", "promotedAsin"));
    if (!asin) throw new AdsQueryError("ADS_REPORT_GRAIN_MISSING");
    dimensions.advertisedAsin = asin;
  }
  if (definition.grain.includes("targetingId")) {
    const targetingId = text(get("targetingId", "keywordId", "targetId"));
    if (!targetingId) throw new AdsQueryError("ADS_REPORT_GRAIN_MISSING");
    dimensions.targetingId = targetingId;
  }
  if (definition.grain.includes("searchTerm")) {
    const searchTerm = text(get("searchTerm", "query"));
    if (!searchTerm) throw new AdsQueryError("ADS_REPORT_GRAIN_MISSING");
    dimensions.searchTerm = searchTerm;
  }
  if (definition.grain.includes("placement")) {
    const placement = text(get("placementClassification", "placement"));
    if (!placement) throw new AdsQueryError("ADS_REPORT_GRAIN_MISSING");
    dimensions.placement = placement;
  }
  for (const key of definition.grain) if (!dimensions[key]) throw new AdsQueryError("ADS_REPORT_GRAIN_MISSING");
  if (definition.currencyColumn) {
    const rowCurrency = text(row[definition.currencyColumn]);
    if (rowCurrency && currencyCode && rowCurrency !== currencyCode) throw new AdsQueryError("ADS_REPORT_CURRENCY_MISMATCH");
  }
  return {
    reportDate,
    dimensions,
    impressions: integer(get("impressions")),
    clicks: integer(get("clicks")),
    spend: decimal(get("cost", "spend")),
    orders: integer(get("purchasesClicks", "purchases", "purchases7d")),
    sales: decimal(get("salesClicks", "sales", "sales7d")),
    units: integer(get("unitsSoldClicks", "unitsSold", "unitsSoldClicks7d")),
    currencyCode: definition.currencyColumn ? text(row[definition.currencyColumn]) : null,
  } satisfies AdsStagingFact & { currencyCode: string | null };
}

/**
 * 解析 GZIP_JSON 报表文件。只接受官方声明过的列，未知列忽略并回报；
 * 相同粒度行（例如同一 ASIN 的多个 SKU）按指标求和合并，不静默丢弃。
 */
export function parseSpReportFile(
  type: SpReportType,
  buffer: Buffer,
  input: { from: string; to: string; currencyCode: string; limits?: SpReportLimits },
): SpReportParseResult {
  const definition = spReportDefinition(type);
  const limits = input.limits ?? defaultSpReportLimits;
  const days = spReportDays(input.from, input.to);
  if (days > definition.maxDays) throw new AdsQueryError("ADS_REPORT_RANGE_EXCEEDS_TYPE_LIMIT");
  if (!/^[A-Z]{3}$/.test(input.currencyCode)) throw new AdsQueryError("ADS_REPORT_CURRENCY_INVALID");
  if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > limits.compressedBytes) throw new AdsQueryError("ADS_REPORT_COMPRESSED_LIMIT");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(gunzipSync(buffer, { maxOutputLength: limits.uncompressedBytes })));
  } catch {
    throw new AdsQueryError("ADS_REPORT_GZIP_OR_JSON_INVALID");
  }
  if (!Array.isArray(parsed)) throw new AdsQueryError("ADS_REPORT_ROW_SET_INVALID");
  if (parsed.length > limits.rows) throw new AdsQueryError("ADS_REPORT_ROW_LIMIT");
  const ignored = new Set<string>();
  const merged = new Map<string, AdsStagingFact & { currencyCode: string | null }>();
  let mergedRows = 0;
  for (const value of parsed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdsQueryError("ADS_REPORT_ROW_INVALID");
    const row = value as Row;
    for (const key of Object.keys(row)) if (!definition.columns.includes(key)) ignored.add(key);
    const fact = mapSpReportRow(type, row, input.from, input.to, input.currencyCode);
    const key = JSON.stringify([fact.reportDate, ...definition.grain.map(field => fact.dimensions[field])]);
    const prior = merged.get(key);
    if (!prior) { merged.set(key, fact); continue; }
    mergedRows += 1;
    merged.set(key, {
      ...prior,
      impressions: sumInteger(prior.impressions, fact.impressions),
      clicks: sumInteger(prior.clicks, fact.clicks),
      orders: sumInteger(prior.orders, fact.orders),
      units: sumInteger(prior.units, fact.units),
      spend: sumDecimal(prior.spend, fact.spend),
      sales: sumDecimal(prior.sales, fact.sales),
    });
  }
  return { facts: [...merged.values()], rowCount: parsed.length, mergedRows, ignoredColumns: [...ignored].sort() };
}

function sumInteger(left: string | null | undefined, right: string | null | undefined): string | null {
  if (left == null && right == null) return null;
  const total = BigInt(left ?? "0") + BigInt(right ?? "0");
  if (total > maxInt64) throw new AdsQueryError("ADS_REPORT_INTEGER_INVALID");
  return total.toString();
}

function sumDecimal(left: string | null | undefined, right: string | null | undefined): string | null {
  if (left == null && right == null) return null;
  const scaled = (value: string | null | undefined) => {
    if (value == null) return BigInt(0);
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole + fraction.padEnd(6, "0"));
  };
  const total = scaled(left) + scaled(right);
  const negative = total < BigInt(0);
  const digits = (negative ? total * BigInt(-1) : total).toString().padStart(7, "0");
  const result = `${digits.slice(0, -6)}.${digits.slice(-6)}`.replace(/0+$/, "").replace(/\.$/, "");
  return negative ? `-${result}` : result;
}
