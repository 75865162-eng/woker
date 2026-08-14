import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { defaultSellfoxReportDate, syncSellfoxProductDailySnapshots } from "@/lib/sellfox/product-performance";

function previousDate(value: string) {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

async function main() {
  const daysPerRun = Math.min(Math.max(Number(process.env.SELLFOX_BACKFILL_DAYS_PER_RUN) || 1, 1), 7);
  const emptyStopDays = Math.max(Number(process.env.SELLFOX_BACKFILL_EMPTY_DAYS) || 7, 1);
  const scopes = await prisma.sellfoxStore.findMany({ distinct: ["organizationId", "workspaceId"], select: { organizationId: true, workspaceId: true } });

  for (const scope of scopes) {
      const organization = { id: scope.organizationId };
      const workspace = { id: scope.workspaceId };
      let state = await prisma.sellfoxProductBackfillState.upsert({
        where: { organizationId_workspaceId: { organizationId: organization.id, workspaceId: workspace.id } },
        create: { organizationId: organization.id, workspaceId: workspace.id, nextReportDate: defaultSellfoxReportDate() },
        update: {},
      });
      if (state.status === "completed") continue;

      for (let day = 0; day < daysPerRun; day += 1) {
        try {
          const result = await syncSellfoxProductDailySnapshots({ organizationId: organization.id, workspaceId: workspace.id, reportDate: state.nextReportDate });
          const emptyDayStreak = result.synced === 0 ? state.emptyDayStreak + 1 : 0;
          const status = emptyDayStreak >= emptyStopDays ? "completed" : "running";
          state = await prisma.sellfoxProductBackfillState.update({
            where: { id: state.id },
            data: { nextReportDate: previousDate(state.nextReportDate), emptyDayStreak, status, lastError: null, lastRunAt: new Date(), ...(status === "completed" ? { completedAt: new Date() } : {}) },
          });
          console.log(`[sellfox-backfill] ${organization.id}/${workspace.id} ${result.reportDate}: ${result.synced} rows`);
          if (status === "completed") break;
        } catch (error) {
          await prisma.sellfoxProductBackfillState.update({ where: { id: state.id }, data: { status: "running", lastError: error instanceof Error ? error.message : "Unknown backfill error", lastRunAt: new Date() } });
          throw error;
        }
      }
  }
}

void main().finally(() => prisma.$disconnect());
