import { builtinSyncRules, sellfoxScheduleIntervals as registryIntervals } from "./sync-rules";

/** 调度间隔来自同步规则注册表，新增数据域自动获得调度节奏。 */
export const sellfoxScheduleIntervals = registryIntervals;
/** 每日固定 06:30 时隙的资源：只有 24 小时节奏的日事实/当前状态类；3h 库存、12h 单据按间隔滚动。 */
const dailySlotResources = new Set(builtinSyncRules
  .filter((rule) => rule.schedulable && rule.intervalMinutes === 1440 && rule.dateMode !== "none")
  .map((rule) => rule.id));
type ScheduleClock = { resource: string; intervalMinutes: number; lastEnqueuedAt: Date | null };
const DAY = 86_400_000;
const SHANGHAI_OFFSET = 8 * 3_600_000;

export function nextSellfoxScheduleAt(schedule: ScheduleClock, now = new Date()): Date {
  if (dailySlotResources.has(schedule.resource)) {
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

/** 销量回填起点。原默认"上一个完整北方冬季 11-01"是系统自设节流；按"能拉尽拉"
 * 放开到 20 年前（覆盖任何现实卖家的经营历史）。可用 env 覆盖为更早/更晚。 */
export function defaultSellfoxBackfillStart(now = new Date()) {
  const configured = process.env.SELLFOX_FULL_HISTORY_START;
  if (configured && /^\d{4}-\d{2}-\d{2}$/.test(configured)) return configured;
  return new Date(now.getTime() - 20 * 365 * DAY).toISOString().slice(0, 10);
}
export function sellfoxBackfillWindow(start: string, yesterday: string, chunkDays = 365) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(yesterday) || !Number.isInteger(chunkDays) || chunkDays < 1 || chunkDays > 3650) throw new Error("销量补数窗口无效。");
  if (start > yesterday) return {};
  const to = new Date(Math.min(Date.parse(`${start}T00:00:00Z`) + (chunkDays - 1) * DAY, Date.parse(`${yesterday}T00:00:00Z`))).toISOString().slice(0, 10);
  return { backfillFrom: start, backfillTo: to };
}
