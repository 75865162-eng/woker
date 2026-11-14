import { prisma } from "@/lib/db/prisma";
import { refreshDueReplenishmentPlans } from "@/lib/operations/replenishment-service";

/**
 * One-shot replenishment cycle for cron / manual acceptance runs.
 * Same entry the worker calls, so a scheduled run and a manual run cannot diverge.
 */
async function main() {
  const started = Date.now();
  try {
    await refreshDueReplenishmentPlans(new Date());
    const plans = await prisma.amazonReplenishmentPlan.findMany({
      orderBy: { generatedAt: "desc" },
      take: 20,
      select: { sellerSku: true, generatedAt: true, lastError: true, result: true },
    });
    const rows = plans.map((plan) => {
      const result = (plan.result ?? {}) as Record<string, unknown>;
      return {
        sellerSku: plan.sellerSku,
        generatedAt: plan.generatedAt.toISOString(),
        status: typeof result.status === "string" ? result.status : null,
        dailyDemandP50: typeof result.dailyDemand === "number" ? result.dailyDemand : null,
        agingDays: typeof result.agingDays === "number" ? result.agingDays : null,
        stockout: typeof result.estimatedStockoutDate === "string" ? result.estimatedStockoutDate : null,
        suggestedQuantity: typeof result.suggestedQuantity === "number" ? result.suggestedQuantity : null,
        urgency: typeof result.urgency === "string" ? result.urgency : null,
        lastError: plan.lastError,
      };
    });
    console.log(JSON.stringify({ ok: true, durationMs: Date.now() - started, plans: rows.length, rows }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, durationMs: Date.now() - started, error: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main();
