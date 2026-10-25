import { isSellfoxDate } from "./sync-contract";

const DAY = 86_400_000;
export function isSellfoxManualBackfill(summary: unknown) {
  return Boolean(summary && typeof summary === "object" && !Array.isArray(summary) && "trigger" in summary && summary.trigger === "manual_backfill");
}
export type SalesBackfillUnit = { shopExternalId: string; startDate: string; endDate: string; days: number };
/** Only contiguous uncovered days enter a run. Never republish coverage for skipped captures. */
export function planSellfoxSalesBackfill(input: {
  startDate: string; endDate: string; chunkDays: number; shopExternalIds: string[];
  coverage: { shopExternalId: string; reportDate: string }[];
}): SalesBackfillUnit[] {
  if (!isSellfoxDate(input.startDate) || !isSellfoxDate(input.endDate) || input.startDate > input.endDate || !Number.isInteger(input.chunkDays) || input.chunkDays < 1 || input.chunkDays > 90) throw new Error("补数日期或分段大小无效。");
  const start = Date.parse(`${input.startDate}T00:00:00Z`), end = Date.parse(`${input.endDate}T00:00:00Z`);
  if ((end - start) / DAY > 1095) throw new Error("单批补数范围不得超过三年。");
  if (!input.shopExternalIds.length || input.shopExternalIds.some((id) => !id.trim()) || new Set(input.shopExternalIds).size !== input.shopExternalIds.length) throw new Error("补数店铺范围无效。");
  const covered = new Set(input.coverage.map((row) => JSON.stringify([row.shopExternalId, row.reportDate])));
  const units: SalesBackfillUnit[] = [];
  const date = (time: number) => new Date(time).toISOString().slice(0, 10);
  for (const shopExternalId of [...input.shopExternalIds].sort()) {
    let unit: SalesBackfillUnit | undefined;
    for (let time = start; time <= end; time += DAY) {
      const reportDate = date(time);
      if (covered.has(JSON.stringify([shopExternalId, reportDate]))) { unit = undefined; continue; }
      if (!unit || unit.days === input.chunkDays) {
        unit = { shopExternalId, startDate: reportDate, endDate: reportDate, days: 0 };
        units.push(unit);
      }
      unit.endDate = reportDate; unit.days++;
    }
  }
  return units.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.shopExternalId.localeCompare(b.shopExternalId));
}
