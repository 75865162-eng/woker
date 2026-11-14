/**
 * 积分周期计算。全部按组织时区的自然月，不依赖服务器本地时区。
 * 纯函数，便于单测。
 */

export const defaultPointsTimezone = "Asia/Shanghai";
export const hardcodedBaseQuota = 50;
export const hardcodedCarryoverCap = 50;

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour") % 24, pick("minute"), pick("second"));

  return asUtc - date.getTime();
}

/** 把"某时区的本地年月日时"换算成 UTC 时刻。跨 DST 时做两次修正。 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  const firstOffset = timeZoneOffsetMs(new Date(guess), timeZone);
  const first = guess - firstOffset;
  const secondOffset = timeZoneOffsetMs(new Date(first), timeZone);

  return new Date(guess - secondOffset);
}

/** 返回 YYYY-MM，按给定时区的自然月。 */
export function periodKeyOf(at: Date, timeZone: string = defaultPointsTimezone): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";

  return `${year}-${month}`;
}

/** 给定时区当天 00:00 的 UTC 时刻，用于每日免费次数计次。 */
export function startOfDayInZone(at: Date, timeZone: string = defaultPointsTimezone): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);

  const year = Number(parts.find((part) => part.type === "year")?.value ?? "1970");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "1");

  return zonedTimeToUtc(year, month, day, 0, timeZone);
}

/** 周期的起止时刻：start 含、end 含（= 下月起点前 1 毫秒）。 */
export function periodRange(period: string, timeZone: string = defaultPointsTimezone): { start: Date; end: Date } {
  const [yearText, monthText] = period.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error(`Invalid points period: ${period}`);
  }

  const start = zonedTimeToUtc(year, month, 1, 0, timeZone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextStart = zonedTimeToUtc(nextYear, nextMonth, 1, 0, timeZone);

  return { start, end: new Date(nextStart.getTime() - 1) };
}

export function previousPeriodKey(period: string): string {
  const [yearText, monthText] = period.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (month === 1) return `${year - 1}-12`;

  return `${year}-${String(month - 1).padStart(2, "0")}`;
}

export function nextPeriodKey(period: string): string {
  const [yearText, monthText] = period.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (month === 12) return `${year + 1}-01`;

  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** 结转额度 = min(上月 BASE 剩余, 结转上限)，且不为负。 */
export function computeCarryover(baseRemaining: number, carryoverCap: number): number {
  const safeRemaining = Number.isFinite(baseRemaining) ? Math.max(0, Math.trunc(baseRemaining)) : 0;
  const safeCap = Number.isFinite(carryoverCap) ? Math.max(0, Math.trunc(carryoverCap)) : 0;

  return Math.min(safeRemaining, safeCap);
}

/** 格式化周期为中文标签，用于 UI。 */
export function formatPeriodLabel(period: string): string {
  const [year, month] = period.split("-");

  return `${year} 年 ${Number(month)} 月`;
}
