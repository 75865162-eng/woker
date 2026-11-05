export type AdsQueryKind = "entities" | "reports";
export type AdsSortDirection = "asc" | "desc";

export interface AdsQueryInput {
  kind: AdsQueryKind;
  profileRecordId?: string;
  sellerAccountId?: string;
  authorizationId?: string;
  marketplaceId?: string;
  entityType?: string;
  reportType?: string;
  adProduct?: string;
  campaignId?: string;
  adGroupId?: string;
  targetingId?: string;
  advertisedAsin?: string;
  searchTerm?: string;
  placement?: string;
  externalId?: string;
  state?: string;
  search?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDirection: AdsSortDirection;
}

export class AdsQueryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "AdsQueryError";
  }
}

export function parseAdsQuery(params: URLSearchParams, now = new Date()): AdsQueryInput {
  assertUnambiguousAdsParams(params);
  const kind = params.get("kind") ?? "entities";
  if (kind !== "entities" && kind !== "reports") throw new AdsQueryError("Ads 数据类型无效。");
  if (kind === "entities" && (params.has("from") || params.has("to"))) throw new AdsQueryError("结构数据没有报告日期维度，请切换日报事实。");

  const page = parseBoundedInteger(params.get("page"), 1, 1, 10000, "页码");
  const pageSize = parseBoundedInteger(params.get("pageSize"), 50, 1, 100, "每页数量");
  const sortDirection = params.get("sortDirection") ?? params.get("direction") ?? "desc";
  if (sortDirection !== "asc" && sortDirection !== "desc") throw new AdsQueryError("排序方向无效。");

  const defaultSort = kind === "entities" ? "name" : "reportDate";
  const sortBy = readText(params, "sortBy") ?? readText(params, "sort") ?? defaultSort;
  const entitySorts = new Set(["name", "entityType", "externalId", "state", "syncedAt", "sourceUpdatedAt", "budgetAmount", "bid"]);
  const reportSorts = new Set(["reportDate", "campaignId", "adGroupId", "impressions", "clicks", "spend", "orders", "sales", "searchTerm"]);
  if (!(kind === "entities" ? entitySorts : reportSorts).has(sortBy)) throw new AdsQueryError("排序字段不受支持。");

  const today = now.toISOString().slice(0, 10);
  const to = parseDate(readText(params, "to") ?? today, "结束日期");
  const from = parseDate(readText(params, "from") ?? shiftDate(to, -29), "开始日期");
  if (from > to) throw new AdsQueryError("报表日期范围倒置。");
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86400_000) {
    throw new AdsQueryError("报表日期范围最多 367 天。");
  }

  return {
    kind,
    profileRecordId: readText(params, "profileRecordId") ?? readText(params, "internalProfileId") ?? readText(params, "profileId"),
    sellerAccountId: readText(params, "sellerAccountId"),
    authorizationId: readText(params, "authorizationId"),
    marketplaceId: readText(params, "marketplaceId"),
    entityType: readText(params, "entityType"),
    reportType: readText(params, "reportType"),
    adProduct: readText(params, "adProduct"),
    campaignId: readText(params, "campaignId"),
    adGroupId: readText(params, "adGroupId"),
    targetingId: readText(params, "targetingId"),
    advertisedAsin: readText(params, "advertisedAsin"),
    searchTerm: readText(params, "searchTerm"),
    placement: readText(params, "placement"),
    externalId: readText(params, "externalId"),
    state: readText(params, "state"),
    search: readText(params, "search"),
    from,
    to,
    page,
    pageSize,
    sortBy,
    sortDirection,
  };
}

/** Reject conflicting aliases/repeated values before any scope or SQL is constructed. */
export function assertUnambiguousAdsParams(params: URLSearchParams) {
  for (const key of new Set(params.keys())) {
    if (new Set(params.getAll(key).map(value => value.trim())).size > 1) throw new AdsQueryError("查询参数重复且冲突。");
  }
  for (const aliases of [["profileRecordId", "internalProfileId", "profileId"], ["sortBy", "sort"], ["sortDirection", "direction"]]) {
    const values = aliases.map(key => params.get(key)?.trim()).filter((value): value is string => !!value);
    if (new Set(values).size > 1) throw new AdsQueryError("查询参数别名冲突。");
  }
}

function parseBoundedInteger(value: string | null, fallback: number, min: number, max: number, label: string) {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new AdsQueryError(`${label}无效。`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new AdsQueryError(`${label}超出允许范围。`);
  return number;
}

function readText(params: URLSearchParams, key: string) {
  const value = params.get(key)?.trim();
  if (!value) return undefined;
  if (value.length > (key === "search" ? 120 : 200)) throw new AdsQueryError("筛选条件过长。");
  return value;
}

function parseDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AdsQueryError(`${label}格式无效。`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new AdsQueryError(`${label}格式无效。`);
  return value;
}

function shiftDate(day: string, delta: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
