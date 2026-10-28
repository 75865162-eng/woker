export const sellfoxSyncResources = ["stores", "inventory", "sales", "performance", "hourly", "listings", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const;
export type SellfoxSyncResource = (typeof sellfoxSyncResources)[number];

export function sellfoxSyncDisabledReason(resource: string): string | null {
  if (!isSellfoxSyncResource(resource)) return "此赛狐数据域尚未接入。";
  // Listing/product verified live; additional CPC reports enabled with strict provisional XLSX contracts.

  return null;
}

export class SellfoxSyncUnavailableError extends Error {
  constructor(resource: string) {
    super(sellfoxSyncDisabledReason(resource) ?? "赛狐数据域不可用。");
    this.name = "SellfoxSyncUnavailableError";
  }
}

export function isSellfoxSyncResource(value: unknown): value is SellfoxSyncResource {
  return typeof value === "string" && sellfoxSyncResources.includes(value as SellfoxSyncResource);
}

export function isSellfoxDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function nextSellfoxPage(rowsOnPage: number, pageNo: number, totalPages: number | null, pageSize = 100, maxPages = 10_000) {
  if (totalPages !== null && pageNo >= totalPages) return null;
  if (rowsOnPage < pageSize) {
    if (totalPages !== null && pageNo < totalPages) throw new SellfoxSyncInputError("赛狐分页未达到声明的末页，响应不完整。");
    return null;
  }
  if (pageNo >= maxPages) throw new SellfoxSyncInputError("赛狐分页达到安全上限，任务未完整同步。");
  return pageNo + 1;
}

export class SellfoxSyncInputError extends Error {
  constructor(message: string) { super(message); this.name = "SellfoxSyncInputError"; }
}

export function sellfoxDateAt(now: Date, offsetDays = 0) {
  return new Date(now.getTime() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

/** Normalize once when creating the run; retries must reuse these exact dates. */
export function normalizeSellfoxDates(resource: SellfoxSyncResource, input: Record<string, unknown>, now = new Date()) {
  let startDate = input.startDate; let endDate = input.endDate;
  if (input.dateRange !== undefined) {
    const range = input.dateRange;
    if (!range || typeof range !== "object" || Array.isArray(range) || startDate !== undefined || endDate !== undefined) {
      throw new SellfoxSyncInputError("dateRange 必须是 { from, to }，且不能与 startDate/endDate 同时使用。");
    }
    startDate = (range as Record<string, unknown>).from;
    endDate = (range as Record<string, unknown>).to;
    if (startDate === undefined && endDate === undefined) throw new SellfoxSyncInputError("日期范围不能为空。");
  }
  const reportDate = input.reportDate;
  for (const value of [reportDate, startDate, endDate]) {
    if (value !== undefined && !isSellfoxDate(value)) throw new SellfoxSyncInputError("日期必须使用有效 YYYY-MM-DD 格式。");
  }
  if (reportDate !== undefined && (startDate !== undefined || endDate !== undefined)) {
    throw new SellfoxSyncInputError("reportDate 不能与日期范围同时使用。");
  }
  if (resource === "inventory" || resource === "listings") {
    const today = sellfoxDateAt(now);
    if (startDate !== undefined || endDate !== undefined || (reportDate !== undefined && reportDate !== today)) {
      throw new SellfoxSyncInputError("库存和 Listing 只能采集当前状态，不能指定历史日期或日期范围。");
    }
    return { reportDate: today };
  }
  if (resource === "stores") return {};
  const from = String(startDate ?? endDate ?? reportDate ?? sellfoxDateAt(now, -1));
  const to = String(endDate ?? startDate ?? reportDate ?? from);
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days < 1 || days > 90) throw new SellfoxSyncInputError("日期范围最多 90 个自然日，结束日期不得早于开始日期。");
  if (resource === "hourly") {
    if (days !== 1 || from < sellfoxDateAt(now, -59) || from > sellfoxDateAt(now)) {
      throw new SellfoxSyncInputError("小时样本只能指定最近 60 天内的单日。");
    }
    return { reportDate: from };
  }
  return { startDate: from, endDate: to };
}

export function sellfoxReportDates(start: string, end: string) {
  if (!isSellfoxDate(start) || !isSellfoxDate(end)) throw new SellfoxSyncInputError("报表日期无效。");
  const count = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
  if (count < 1 || count > 90) throw new SellfoxSyncInputError("日期范围最多 90 个自然日。");
  return Array.from({ length: count }, (_, index) => new Date(Date.parse(`${start}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));
}
