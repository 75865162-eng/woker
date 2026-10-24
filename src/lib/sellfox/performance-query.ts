import { Prisma } from "@prisma/client";
import { defaultSellfoxReportDate } from "@/lib/sellfox/product-performance";

export function performanceQuery(url: URL, organizationId: string, workspaceId: string): Prisma.SellfoxProductDailySnapshotWhereInput {
  const storeId = url.searchParams.get("storeId")?.trim();
  const reportDate = url.searchParams.get("reportDate")?.trim();
  const from = url.searchParams.get("from")?.trim();
  const to = url.searchParams.get("to")?.trim();
  const search = url.searchParams.get("search")?.trim();

  return {
    organizationId,
    workspaceId,
    ...(from || to ? { reportDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : { reportDate: reportDate || defaultSellfoxReportDate() }),
    ...(storeId ? { storeId } : {}),
    ...(search
      ? {
          OR: ["sku", "msku", "asin", "title"].map((field) => ({ [field]: { contains: search, mode: "insensitive" } })),
        }
      : {}),
  };
}
