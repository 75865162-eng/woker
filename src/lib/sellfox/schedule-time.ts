/** Persisted enqueue time, rather than completion time, determines the next slot. */
export const sellfoxScheduleIntervals = { stores: 480, inventory: 180, sales: 1440, performance: 1440, listings: 1440, ads_report: 1440, ads_targeting: 1440, ads_search_term: 1440 } as const;
type ScheduleClock = { resource: string; intervalMinutes: number; lastEnqueuedAt: Date | null };
const DAY = 86_400_000;
const SHANGHAI_OFFSET = 8 * 3_600_000;

export function nextSellfoxScheduleAt(schedule: ScheduleClock, now = new Date()): Date {
  if (["sales", "performance", "listings", "ads_report", "ads_targeting", "ads_search_term"].includes(schedule.resource)) {
    const localDay = Math.floor((now.getTime() + SHANGHAI_OFFSET) / DAY);
    const todaySlot = localDay * DAY - SHANGHAI_OFFSET + 390 * 60_000;
    const lastDay = schedule.lastEnqueuedAt ? Math.floor((schedule.lastEnqueuedAt.getTime() + SHANGHAI_OFFSET) / DAY) : -Infinity;
    // Before today's slot wait for 06:30; after it, catch up once if not enqueued today.
    if (lastDay >= localDay) return new Date((lastDay + 1) * DAY - SHANGHAI_OFFSET + 390 * 60_000);
    return new Date(Math.max(todaySlot, now.getTime()));
  }
  return new Date(Math.max(now.getTime(), schedule.lastEnqueuedAt ? schedule.lastEnqueuedAt.getTime() + schedule.intervalMinutes * 60_000 : now.getTime()));
}

export function isSellfoxScheduleDue(schedule: ScheduleClock, now = new Date()) {
  return nextSellfoxScheduleAt(schedule, now).getTime() <= now.getTime();
}

export function sellfoxSyncScopeLock(organizationId: string, workspaceId: string, resource: string) {
  return JSON.stringify(["sellfox-sync", organizationId, workspaceId, resource]);
}

/** Previous completed northern winter starts Nov 1; retained forever, one bounded chunk per day. */
export function defaultSellfoxBackfillStart(now = new Date()) {
  const local = new Date(now.getTime() + SHANGHAI_OFFSET);
  const year = local.getUTCFullYear() - (local.getUTCMonth() < 3 ? 2 : 1);
  return `${year}-11-01`;
}
export function sellfoxBackfillWindow(start: string, yesterday: string, chunkDays = 7) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(yesterday) || !Number.isInteger(chunkDays) || chunkDays < 1 || chunkDays > 90) throw new Error("销量补数窗口无效。");
  if (start > yesterday) return {};
  const to = new Date(Math.min(Date.parse(`${start}T00:00:00Z`) + (chunkDays - 1) * DAY, Date.parse(`${yesterday}T00:00:00Z`))).toISOString().slice(0, 10);
  return { backfillFrom: start, backfillTo: to };
}
