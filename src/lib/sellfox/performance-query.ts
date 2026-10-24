import type { Prisma } from "@prisma/client";
import { sellfoxBrowseQuery, sellfoxSnapshotWhere } from "@/lib/sellfox/browse-query";

export function performanceQuery(url: URL, organizationId: string, workspaceId: string): Prisma.SellfoxProductDailySnapshotWhereInput {
  const query = sellfoxBrowseQuery(url);
  return { ...sellfoxSnapshotWhere(query, organizationId, workspaceId, undefined, true), ...(query.storeId ? { storeId: query.storeId } : {}) };
}
