import { SyncInputError } from "./policy";

// Business reporting zones, not the browser/server zone. Unknown sites fail closed.
const zones: Record<string, string> = {
  ATVPDKIKX0DER: "America/Los_Angeles", A2EUQ1WTGCTBG2: "America/Los_Angeles", A1AM78C64UM0Y8: "America/Los_Angeles", A2Q3Y263D00KWC: "America/Sao_Paulo",
  A1PA6795UKMFR9: "Europe/Berlin", A1RKKUPIHCS9HS: "Europe/Madrid", A13V1IB3VIYZZH: "Europe/Paris",
  A1F83G8C2ARO7P: "Europe/London", APJ6JRA9NG5V4: "Europe/Rome", A1VC38T7YXB528: "Asia/Tokyo",
  A1805IZSGTT6HS: "Europe/Amsterdam", A2NODRKZP88ZB9: "Europe/Stockholm", A33AVAJ2PDY3EV: "Europe/Istanbul", A17E79C6D8DWNP: "Asia/Riyadh", A2VIGQ35RCS4UG: "Asia/Dubai",
  A39IBJ37TRP1C6: "Australia/Sydney", A19VAU5U5O7RUS: "Asia/Singapore", A21TJRUUN4KGV: "Asia/Kolkata",
};
export function reportTimeZone(marketplaceId: string): string { const zone = zones[marketplaceId]; if (!zone) throw new SyncInputError("该站点业务时区尚未核验。"); return zone; }
export type RequestedRange = { from: string; to: string; timeZone: string; startAt: string; endExclusive: string; dateField: "report_business_date"; endInclusive: true; reportEndAt: string; periodClosed: boolean };
export function businessDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new SyncInputError("业务日期无效。");
  return value;
}
export function shiftDate(date: string, days: number) { return new Date(Date.parse(businessDate(date)) + days * 86400000).toISOString().slice(0, 10); }
export function localDate(now: Date, timeZone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function zonedMidnight(date: string, timeZone: string): string {
  const desired = Date.parse(businessDate(date));
  let instant = desired;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
    const p = Object.fromEntries(parts.map(v => [v.type, v.value]));
    const represented = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    const delta = desired - represented;
    if (!delta) return new Date(instant).toISOString();
    instant += delta;
  }
  throw new SyncInputError("该站点日期无法转换为业务时区。");
}
export function resolveRequestedRange(marketplaceId: string, input: Record<string, unknown>, now = new Date()): RequestedRange {
  const timeZone = zones[marketplaceId];
  if (!timeZone) throw new SyncInputError("该 Marketplace 尚未核验报告业务时区，不能申请日期同步。");
  const today = localDate(now, timeZone), preset = input.datePreset ?? "custom";
  let from: string, to: string;
  switch (preset) {
    case "today": from = to = today; break;
    case "yesterday": from = to = shiftDate(today, -1); break;
    case "last7": from = shiftDate(today, -6); to = today; break;
    case "last30": from = shiftDate(today, -29); to = today; break;
    case "thisMonth": from = `${today.slice(0, 7)}-01`; to = today; break;
    case "lastMonth": to = shiftDate(`${today.slice(0, 7)}-01`, -1); from = `${to.slice(0, 7)}-01`; break;
    case "custom": from = businessDate(input.dateFrom); to = businessDate(input.dateTo); break;
    default: throw new SyncInputError("未知日期预设。");
  }
  if (from > to || to > today) throw new SyncInputError("日期范围倒置或包含未来日期。");
  // Conservative first rollout: 31 days per report, within the documented two-year history.
  if (from < shiftDate(today, -730) || Date.parse(to) - Date.parse(from) > 30 * 86400000) throw new SyncInputError("销售流量每次最多 31 天，历史范围最多 730 天。");
  const endExclusive = zonedMidnight(shiftDate(to, 1), timeZone);
  return { reportEndAt: new Date(Math.min(now.getTime(), Date.parse(endExclusive) - 1000)).toISOString(), periodClosed: to < today, from, to, timeZone, startAt: zonedMidnight(from, timeZone), endExclusive, dateField: "report_business_date", endInclusive: true };
}
export function rangeFromFrozen(value: unknown): RequestedRange {
  const range = (value as { requestedRange?: RequestedRange } | null)?.requestedRange;
  if (!range || range.dateField !== "report_business_date" || range.endInclusive !== true || businessDate(range.from) > businessDate(range.to)) throw new SyncInputError("任务未冻结有效业务日期范围。");
  return range;
}
