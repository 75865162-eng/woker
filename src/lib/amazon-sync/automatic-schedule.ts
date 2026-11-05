import { createHash } from "node:crypto";
import { localDate, shiftDate, type RequestedRange, resolveRequestedRange } from "./date-range";

export const automaticResources = ["catalog", "inventory", "orders", "sales_traffic", "finance"] as const;
export const automaticMarketplaces = new Set(["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2"]);
export const automaticIntervalMinutes = 1440;
export const automaticBackfillDays = 730;

export function automaticBackfillStart(now: Date) {
  return new Date(now.getTime() - automaticBackfillDays * 86_400_000).toISOString();
}

export function automaticPlanId(sourceId: string) {
  return `amazon-sync-auto-${createHash("sha256").update(sourceId).digest("hex").slice(0, 32)}`;
}

export function automaticPlanKey(sourceId: string) { return `auto-v1:${sourceId}`; }

export function isAutomaticResource(resource: string): resource is typeof automaticResources[number] {
  return (automaticResources as readonly string[]).includes(resource);
}

export function nextSalesTrafficRange(marketplaceId: string, now: Date, coverage: Array<{ from: string; to: string }>): { range: RequestedRange; backfill: boolean } {
  const today = localDate(now, "America/Los_Angeles");
  const latestClosed = shiftDate(today, -1);
  const initial = shiftDate(today, -730);
  let coveredThrough = shiftDate(initial, -1);
  const ordered = [...coverage].filter(r => r.from <= r.to).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  for (const item of ordered) {
    if (item.to <= coveredThrough || item.from > shiftDate(coveredThrough, 1)) continue;
    coveredThrough = item.to;
  }
  const from = coveredThrough < latestClosed ? shiftDate(coveredThrough, 1) : latestClosed;
  const to = from < latestClosed && shiftDate(from, 30) < latestClosed ? shiftDate(from, 30) : from < latestClosed ? latestClosed : from;
  const range = resolveRequestedRange(marketplaceId, { datePreset: "custom", dateFrom: from, dateTo: to }, now);
  return { range, backfill: to < latestClosed };
}
