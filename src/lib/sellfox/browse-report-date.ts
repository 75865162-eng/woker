import { prisma } from "@/lib/db/prisma";
import type { SellfoxBrowseQuery } from "./browse-query";
import { sellfoxDateAt } from "./sync-contract";

// Only implicit dates may move. Explicit empty days and all-history reads stay intact.
export async function resolveEffectiveReportDate(
  domain: "sales" | "performance",
  query: SellfoxBrowseQuery,
  scope: { organizationId: string; workspaceId: string },
) {
  if (query.from || query.to || query.reportDate || query.allDates) return query;
  const yesterday = sellfoxDateAt(new Date(), -1);
  const where = {
    ...scope,
    reportDate: { lte: yesterday },
    ...(query.storeId ? { storeId: query.storeId } : {}),
    SellfoxStore: {
      ...scope,
      ...(query.shopExternalIds.length ? { externalId: { in: query.shopExternalIds } } : {}),
      ...(query.site ? { marketplace: query.site } : {}),
    },
    ...(query.currency ? { currency: query.currency } : {}),
  };
  // One date-only indexed lookup also covers the usual case where yesterday exists.
  // Search/zero filters must not cause a different business day to be selected.
  const args = { where, select: { reportDate: true } as const, orderBy: { reportDate: "desc" } as const };
  const latest = domain === "performance"
    ? await prisma.sellfoxProductDailySnapshot.findFirst({ ...args, where: { ...where, onlySettle: query.onlySettle } })
    : await prisma.sellfoxSalesDailySnapshot.findFirst(args);
  return { ...query, reportDate: latest?.reportDate ?? yesterday };
}
