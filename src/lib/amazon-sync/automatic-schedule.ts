import { createHash } from "node:crypto";
import { localDate, shiftDate, type RequestedRange, resolveRequestedRange } from "./date-range";
import { nextReturnWindow, type ReturnPolicy } from "./returns";

export const automaticResources = ["catalog", "inventory", "orders", "sales_traffic", "finance", "returns", "settlements", "reimbursements", "inventory_age", "inventory_events", "fulfillment", "listing_details", "catalog_items", "pricing"] as const;
export const automaticMarketplaces = new Set(["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2"]);
export const automaticIntervalMinutes = 1440;
export const automaticBackfillDays = 730;
export const automaticInventoryEventBackfillDays = 540;
export const automaticReportDiscoveryDays = 90;

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

export function nextAutomaticReturnWindow(policy: ReturnPolicy, cursor: { watermarkFrom: Date; watermarkTo: Date; status: string } | null, now: Date) {
  return nextReturnWindow({ ...policy, windowMinutes: Math.min(policy.windowMinutes, 30 * 24 * 60) }, cursor, now);
}

export function nextAutomaticInventoryEventWindow(cursor: { watermarkFrom: Date; watermarkTo: Date; status: string } | null, now: Date) {
  const yesterday = shiftDate(now.toISOString().slice(0, 10), -1);
  const oldest = shiftDate(yesterday, -(automaticInventoryEventBackfillDays - 1));
  const from = cursor?.status === "SUCCEEDED" ? shiftDate(cursor.watermarkTo.toISOString().slice(0, 10), 1) : oldest;
  if (cursor && cursor.status !== "SUCCEEDED") {
    const frozenFrom = cursor.watermarkFrom.toISOString().slice(0, 10);
    const frozenTo = cursor.watermarkTo.toISOString().slice(0, 10);
    return { from: frozenFrom, to: frozenTo, dataStartTime: `${frozenFrom}T00:00:00Z`, dataEndTime: `${frozenTo}T23:59:59Z`, eventType: "" };
  }
  const to = from > yesterday ? yesterday : [shiftDate(from, 30), yesterday].sort()[0];
  if (from > to) return null;
  return { from, to, dataStartTime: `${from}T00:00:00Z`, dataEndTime: `${to}T23:59:59Z`, eventType: "" };
}

export function nextAutomaticSettlementDiscovery(now: Date) {
  const createdUntil = now.toISOString();
  const createdSince = new Date(now.getTime() - automaticReportDiscoveryDays * 86_400_000).toISOString();
  return { createdSince, createdUntil };
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
