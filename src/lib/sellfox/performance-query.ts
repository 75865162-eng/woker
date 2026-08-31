import { Prisma } from "@prisma/client";
import { defaultSellfoxReportDate } from "@/lib/sellfox/product-performance";

export function performanceQuery(url: URL, organizationId: string, workspaceId: string): Prisma.SellfoxProductDailySnapshotWhereInput {
  const storeId = url.searchParams.get("storeId")?.trim();
  const reportDate = url.searchParams.get("reportDate")?.trim() || defaultSellfoxReportDate();
  const search = url.searchParams.get("search")?.trim();

  return {
    organizationId,
    workspaceId,
    reportDate,
    ...(storeId ? { storeId } : {}),
    ...(search
      ? {
          OR: ["sku", "msku", "asin", "title"].map((field) => ({ [field]: { contains: search, mode: "insensitive" } })),
        }
      : {}),
  };
}
