/** Persisted enqueue time, rather than completion time, determines the next slot. */
export const sellfoxScheduleIntervals = { stores: 480, inventory: 180, sales: 1440, performance: 1440 } as const;
type ScheduleClock = { resource: string; intervalMinutes: number; lastEnqueuedAt: Date | null };
const DAY = 86_400_000;
const SHANGHAI_OFFSET = 8 * 3_600_000;

export function nextSellfoxScheduleAt(schedule: ScheduleClock, now = new Date()): Date {
  if (schedule.resource === "sales" || schedule.resource === "performance") {
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
