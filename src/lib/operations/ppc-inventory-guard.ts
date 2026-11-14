import type { PerformanceRow } from "@/lib/types";
import { prisma } from "@/lib/db/prisma";
import { adsMetricsFromRows, buildConstraintFromReplenishmentPlan, type PlanConstraintEconomics } from "@/lib/ads-inventory/from-replenishment";
import type { ConstraintResult } from "@/lib/ads-inventory/constraint";

/**
 * Resolves the ads x inventory constraint for a PPC run from the SKU's newest
 * replenishment plan. The plan is the single source of demand and stock facts, so
 * the ad layer can never disagree with the replenishment page.
 */

export type PpcInventoryScope = { organizationId: string; workspaceId: string };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function resolvePpcSellerSku(body: unknown): string | null {
  const record = asRecord(body);
  if (!record) return null;
  const direct = asString(record.sellerSku);
  if (direct) return direct;
  const context = asRecord(record.productContext);
  return context ? asString(context.sellerSku) : null;
}

function readEconomics(body: unknown): PlanConstraintEconomics {
  const record = asRecord(asRecord(body)?.productEconomics);
  return {
    unitPrice: asNumber(record?.unitPrice),
    unitCost: asNumber(record?.unitCost),
    grossMarginPct: asNumber(record?.grossMarginPct),
    targetNetMarginPct: asNumber(record?.targetNetMarginPct) ?? undefined,
    currency: asString(record?.currency),
  };
}

function readRows(body: unknown): PerformanceRow[] {
  const rows = asRecord(body)?.performanceRows;
  return Array.isArray(rows) ? (rows as PerformanceRow[]) : [];
}

/** `undefined` means "no SKU declared": the PPC report stays exactly as it was. */
export function createPpcInventoryConstraintResolver(input: {
  body: unknown;
  scope: PpcInventoryScope;
  now?: Date;
}): (() => Promise<ConstraintResult | null>) | undefined {
  const sellerSku = resolvePpcSellerSku(input.body);
  if (!sellerSku) return undefined;

  return async () => {
    const now = input.now ?? new Date();
    const plan = await prisma.amazonReplenishmentPlan.findFirst({
      where: {
        organizationId: input.scope.organizationId,
        workspaceId: input.scope.workspaceId,
        sellerSku,
      },
      orderBy: { generatedAt: "desc" },
      select: { generatedAt: true, result: true, inputSnapshot: true },
    });
    const asOf = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);

    return buildConstraintFromReplenishmentPlan({
      sku: sellerSku,
      asOf,
      now,
      plan,
      ads: adsMetricsFromRows({ rows: readRows(input.body), windowDays: asNumber(asRecord(input.body)?.adsWindowDays) }),
      economics: readEconomics(input.body),
    });
  };
}
