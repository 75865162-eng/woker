import { Prisma } from "@prisma/client";
import type { Tx } from "./repository";
import type { WmsScope } from "./contracts";
import { scoped } from "./access";

export const receiptWorkFilters = ["PENDING_QC", "PENDING_PUTAWAY", "HAS_REJECTED", "SHORT_RECEIVED"] as const;
export type ReceiptWorkFilter = typeof receiptWorkFilters[number];

/** Filter line quantities before pagination. A receipt can belong to several
 * queues (for example pending QC and pending putaway after partial inspection).
 * Caller holds a repeatable-read snapshot for the ID and line reads. */
export async function queryReceiptWork(tx: Tx, scope: WmsScope, filters: {
  workflowStatus: ReceiptWorkFilter; warehouseId?: string; id?: string; number?: string; sourceReference?: string; status?: string; barcode?: string; lotCode?: string;
}, limit: number, after?: { id: string; time: string }) {
  const predicates: Record<ReceiptWorkFilter, Prisma.Sql> = {
    PENDING_QC: Prisma.sql`l."receivedQty"::bigint > l."acceptedQty"::bigint + l."rejectedQty"::bigint`,
    PENDING_PUTAWAY: Prisma.sql`l."acceptedQty" > l."putawayQty"`,
    HAS_REJECTED: Prisma.sql`l."rejectedQty" > l."returnedQty"`,
    SHORT_RECEIVED: Prisma.sql`l."expectedQty" > l."receivedQty"`,
  };
  const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT r.id FROM "WmsReceipt" r
    WHERE r."organizationId"=${scope.organizationId} AND r."workspaceId"=${scope.workspaceId}
      AND r.status IN ('RECEIVED', 'INSPECTED', 'PUTAWAY')
      ${filters.warehouseId ? Prisma.sql`AND r."warehouseId"=${filters.warehouseId}` : Prisma.empty}
      ${filters.id ? Prisma.sql`AND r.id=${filters.id}` : Prisma.empty}
      ${filters.number ? Prisma.sql`AND r.number=${filters.number}` : Prisma.empty}
      ${filters.sourceReference ? Prisma.sql`AND r."sourceReference"=${filters.sourceReference}` : Prisma.empty}
      ${filters.status ? Prisma.sql`AND r.status=${filters.status}` : Prisma.empty}
      AND EXISTS (SELECT 1 FROM "WmsReceiptLine" l
        WHERE l."organizationId"=r."organizationId" AND l."workspaceId"=r."workspaceId"
          AND l."receiptId"=r.id AND (${predicates[filters.workflowStatus]})
          ${filters.barcode || filters.lotCode ? Prisma.sql`AND EXISTS (SELECT 1 FROM "WmsLot" lot
            WHERE lot."organizationId"=l."organizationId" AND lot."workspaceId"=l."workspaceId" AND lot.id=l."lotId"
              ${filters.barcode ? Prisma.sql`AND lot.barcode=${filters.barcode}` : Prisma.empty}
              ${filters.lotCode ? Prisma.sql`AND lot."lotCode"=${filters.lotCode}` : Prisma.empty})` : Prisma.empty})
      ${after ? Prisma.sql`AND (r."createdAt">${new Date(after.time)} OR (r."createdAt"=${new Date(after.time)} AND r.id>${after.id}))` : Prisma.empty}
    ORDER BY r."createdAt" ASC, r.id ASC LIMIT ${limit + 1}`);
  if (!ids.length) return [];
  return tx.wmsReceipt.findMany({ where: { ...scoped(scope), id: { in: ids.map(row => row.id) } }, include: { lines: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}
