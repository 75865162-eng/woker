import type { Prisma } from "@prisma/client";
import { sellfoxBackfillWindow } from "./schedule-time";
import { sellfoxDateAt } from "./sync-contract";

type BackfillDb = Pick<Prisma.TransactionClient, "sellfoxSyncRun" | "sellfoxSyncSchedule" | "$queryRaw">;
export async function sellfoxScheduledBackfill(db: BackfillDb, schedule: {
  id: string; organizationId: string; workspaceId: string; resource: string; backfillNextDate: string | null;
}, now: Date, chunkDays: number) {
  if (schedule.resource !== "sales" || !schedule.backfillNextDate) return {};
  const manual = await db.sellfoxSyncRun.findFirst({ where: { organizationId: schedule.organizationId, workspaceId: schedule.workspaceId, resource: "sales", status: { in: ["queued", "running"] }, summary: { path: ["trigger"], equals: "manual_backfill" } }, select: { id: true } });
  if (manual) return {}; // Daily T-1 still runs; the independent historical batch already owns the gaps.
  const yesterday = sellfoxDateAt(now, -1);
  // Advance only over store/days already proved complete, including legitimate empty days.
  const missing = await db.$queryRaw<{ date: string }[]>`SELECT to_char(day,'YYYY-MM-DD') AS date
    FROM generate_series(${schedule.backfillNextDate}::date,${yesterday}::date,interval '1 day') day
    WHERE EXISTS (SELECT 1 FROM "SellfoxStore" s
      WHERE s."organizationId"=${schedule.organizationId} AND s."workspaceId"=${schedule.workspaceId}
        AND NOT EXISTS (SELECT 1 FROM "SellfoxSalesDayCoverage" c WHERE c."storeId"=s.id AND c."reportDate"=to_char(day,'YYYY-MM-DD')))
    ORDER BY day LIMIT 1`;
  const nextDate = missing[0]?.date ?? sellfoxDateAt(now);
  await db.sellfoxSyncSchedule.update({ where: { id: schedule.id }, data: { backfillNextDate: nextDate } });
  return sellfoxBackfillWindow(nextDate, yesterday, chunkDays);
}
