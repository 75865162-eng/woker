import { nextAutomaticDayWindow, salesTrafficDayWindows } from "./automatic-day-windows";
import { createHash } from "node:crypto";
import { localDate, reportingMarketplaceIds, reportTimeZone, shiftDate, type RequestedRange, resolveRequestedRange } from "./date-range";
import { nextReturnWindow, type ReturnPolicy } from "./returns";
import { fbaInventoryByCountryMarketplaceAllowed } from "./inventory-report-contracts";

/** Resume using current revisions rather than an old frozen terminal task. */
export function automaticTaskKey(plan: { id: string; revision: number }, source: { revision: number; authorization: { revision: number } }, from: string, to?: string) {
  return "auto-v2:" + createHash("sha256").update(JSON.stringify([plan.id, plan.revision, source.revision, source.authorization.revision, from, to ?? ""])).digest("hex");
}
export function nextPlanRunAt(enabled: boolean, automatic: boolean, intervalMinutes: number, now = new Date()) {
  return enabled ? new Date(now.getTime() + (automatic ? 0 : intervalMinutes * 60_000)) : null;
}

// Regional participation and authorization are checked separately. This table
// describes executable business time zones, never seller access or API roles.
export const automaticMarketplaces = new Set(reportingMarketplaceIds);
export const brandMarketplaces = new Set([...automaticMarketplaces, "A1RKKUPIHCS9HS", "A1F83G8C2ARO7P", "A13V1IB3VIYZZH", "A1805IZSGTT6HS", "A1PA6795UKMFR9", "APJ6JRA9NG5V4", "A2NODRKZP88ZB9", "A33AVAJ2PDY3EV", "A17E79C6D8DWNP", "A2VIGQ35RCS4UG", "A21TJRUUN4KGV", "A19VAU5U5O7RUS", "A39IBJ37TRP1C6", "A1VC38T7YXB528"]);
export function automaticMarketplaceAllowed(resource: string, marketplaceId: string) {
  if (resource === "fba_inventory_by_country") return fbaInventoryByCountryMarketplaceAllowed(marketplaceId);
  return (resource === "brand_analytics" ? brandMarketplaces : automaticMarketplaces).has(marketplaceId);
}
export const automaticIntervalMinutes = 1440;
export const automaticTransientRetryAllowance = 2;
export function shouldRetrySyncFailure(input: { retryable: boolean; code: string; trigger: string; attempts: number; maxAttempts: number }) {
  if (!input.retryable) return false;
  if (input.attempts < input.maxAttempts) return true;
  return input.trigger === "schedule"
    && (input.code === "TRANSIENT" || input.code === "THROTTLE")
    && input.attempts < input.maxAttempts + automaticTransientRetryAllowance;
}
export function automaticSnapshotSlot(now: Date, intervalMinutes: number) {
  return String(Math.floor(now.getTime() / (intervalMinutes * 60_000)));
}
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

export function nextAutomaticRemovalOrderWindow(cursor: { watermarkFrom: Date; watermarkTo: Date; status: string } | null, now: Date) {
  const yesterday = shiftDate(now.toISOString().slice(0, 10), -1);
  const from = cursor?.status === "SUCCEEDED" ? shiftDate(cursor.watermarkTo.toISOString().slice(0, 10), 1) : cursor?.watermarkFrom.toISOString().slice(0, 10) ?? yesterday;
  if (from > yesterday) return null;
  return { from, to: from, dataStartTime: `${from}T00:00:00Z`, dataEndTime: `${from}T23:59:59Z` };
}

export function nextAutomaticSettlementDiscovery(now: Date, cursor?: { watermarkFrom: Date; watermarkTo: Date; status: string } | null) {
  if (cursor && cursor.status !== "SUCCEEDED") {
    const createdSince = cursor.watermarkFrom.toISOString(), createdUntil = cursor.watermarkTo.toISOString();
    const retentionFrom = new Date(cursor.watermarkTo.getTime() - automaticReportDiscoveryDays * 86_400_000).toISOString();
    return { createdSince, createdUntil, ...(retentionFrom < createdSince ? { retentionGap: { from: retentionFrom, to: createdSince, reason: "QUEUE_MARGIN" as const, complete: false as const } } : {}) };
  }
  const createdUntil = now.toISOString();
  // Leave one day for queueing. Expose the excluded interval as coverage;
  // it must not be mistaken for successfully discovered history.
  const retentionFrom = new Date(now.getTime() - automaticReportDiscoveryDays * 86_400_000).toISOString();
  const createdSince = new Date(now.getTime() - (automaticReportDiscoveryDays - 1) * 86_400_000).toISOString();
  return { createdSince, createdUntil, retentionGap: { from: retentionFrom, to: createdSince, reason: "QUEUE_MARGIN" as const, complete: false as const } };
}

export function nextAutomaticReimbursementWindow(now: Date, cursor?: { watermarkFrom: Date; watermarkTo: Date; status: string } | null) {
  const yesterday = shiftDate(now.toISOString().slice(0, 10), -1);
  const initial = shiftDate(now.toISOString().slice(0, 10), -automaticBackfillDays);
  if (cursor && cursor.status !== "SUCCEEDED") {
    if (cursor.watermarkFrom.getTime() === cursor.watermarkTo.getTime()) throw new Error("赔偿旧快照须经过批准恢复，不能覆盖原检查点。");
    const from = cursor.watermarkFrom.toISOString().slice(0, 10), to = cursor.watermarkTo.toISOString().slice(0, 10);
    return { from, to, dataStartTime: `${from}T00:00:00Z`, dataEndTime: `${to}T23:59:59Z` };
  }
  const from = cursor ? [shiftDate(cursor.watermarkTo.toISOString().slice(0, 10), 1), yesterday].sort()[0] : initial;
  const to = [shiftDate(from, 29), yesterday].sort()[0];
  return { from, to, dataStartTime: `${from}T00:00:00Z`, dataEndTime: `${to}T23:59:59Z` };
}

/** Initial validation scope approved for new sources; historic cursors retain
 * their explicit window rather than being silently moved to recent history. */
export function latestClosedReimbursementWindow(now: Date) {
  const to = shiftDate(now.toISOString().slice(0, 10), -1);
  const from = shiftDate(to, -29);
  return { from, to, dataStartTime: `${from}T00:00:00Z`, dataEndTime: `${to}T23:59:59Z` };
}

export function nextSalesTrafficRange(marketplaceId: string, now: Date, coverage: Array<{ from: string; to: string }>): { range: RequestedRange; backfill: boolean; refresh: boolean } {
  const next = nextAutomaticDayWindow(localDate(now, reportTimeZone(marketplaceId)), salesTrafficDayWindows, coverage)!;
  return { range: resolveRequestedRange(marketplaceId, { datePreset: "custom", dateFrom: next.from, dateTo: next.to }, now), backfill: next.backfill, refresh: next.mode === "refresh" };
}
