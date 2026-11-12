import { SyncInputError } from "./policy";

export type LongTermStorageFeeWindow = { from: string; to: string; dataStartTime: string; dataEndTime: string };

/** Exact calendar month, ending at the next month boundary. No retention inferred. */
export function longTermStorageFeeRunWindow(value: unknown, now = new Date()): LongTermStorageFeeWindow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("长期仓储费报告须冻结完整月份。");
  const row = value as Record<string, unknown>;
  if (typeof row.from !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(row.from)) throw new SyncInputError("长期仓储费窗口须从月初开始。");
  const start = new Date(`${row.from}T00:00:00Z`);
  const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
  const to = new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10);
  const currentMonth = now.toISOString().slice(0, 7) + "-01";
  if (row.to !== to || end.getTime() > Date.parse(`${currentMonth}T00:00:00Z`)) throw new SyncInputError("长期仓储费仅接受单个已闭合 UTC 月份。");
  const window = { from: row.from, to, dataStartTime: `${row.from}T00:00:00Z`, dataEndTime: end.toISOString().replace(".000Z", "Z") };
  if ((row.dataStartTime !== undefined && row.dataStartTime !== window.dataStartTime) || (row.dataEndTime !== undefined && row.dataEndTime !== window.dataEndTime)) throw new SyncInputError("长期仓储费时间戳须相隔一个完整月份。");
  return window;
}

export function latestClosedStorageFeeMonth(now = new Date()): LongTermStorageFeeWindow {
  const end = new Date(now.toISOString().slice(0, 7) + "-01T00:00:00Z");
  const start = new Date(end); start.setUTCMonth(start.getUTCMonth() - 1);
  return longTermStorageFeeRunWindow({ from: start.toISOString().slice(0, 10), to: new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10) }, now);
}

export function nextStorageFeeMonth(cursor: { watermarkFrom: Date; watermarkTo: Date; status: string } | null, now: Date): LongTermStorageFeeWindow {
  const latest = latestClosedStorageFeeMonth(now);
  if (!cursor) return latest;
  const original = longTermStorageFeeRunWindow({ from: cursor.watermarkFrom.toISOString().slice(0, 10), to: new Date(cursor.watermarkTo.getTime() - 86_400_000).toISOString().slice(0, 10), dataStartTime: cursor.watermarkFrom.toISOString().replace(".000Z", "Z"), dataEndTime: cursor.watermarkTo.toISOString().replace(".000Z", "Z") }, now);
  if (cursor.status !== "SUCCEEDED") return original;
  const from = original.dataEndTime.slice(0, 10);
  if (from > latest.from) return latest;
  const end = new Date(`${from}T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1);
  return longTermStorageFeeRunWindow({ from, to: new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10) }, now);
}
