import { Prisma, type WmsReservation } from "@prisma/client";
import type { Tx } from "./repository";
import type { WmsScope } from "./contracts";
import { queryStockContexts } from "./stock-context-query";
import { reservationProgress } from "./reservation-view";

export const reservationStatusFilters = ["ACTIVE", "AWAITING_PICK", "PARTIALLY_PICKED", "AWAITING_DISPATCH", "CLOSED"] as const;
export type ReservationStatusFilter = typeof reservationStatusFilters[number];

/** Filter quantities before LIMIT so completed documents cannot hide pending work. */
export function queryReservations(tx: Tx, scope: WmsScope, filters: { balanceId?: string; number?: string; warehouseId?: string; locationId?: string; lotId?: string; barcode?: string; lotCode?: string; workflowStatus: ReservationStatusFilter }, limit: number, after?: { id: string; time: string }) {
  const remaining = Prisma.sql`("requestedQty" - "releasedQty" - "dispatchedQty")`;
  const predicates: Record<ReservationStatusFilter, Prisma.Sql> = {
    ACTIVE: Prisma.sql`${remaining} > 0`,
    AWAITING_PICK: Prisma.sql`${remaining} > 0 AND "pickedQty" = 0`,
    PARTIALLY_PICKED: Prisma.sql`"pickedQty" > 0 AND "pickedQty" < ${remaining}`,
    AWAITING_DISPATCH: Prisma.sql`${remaining} > 0 AND "pickedQty" = ${remaining}`,
    CLOSED: Prisma.sql`${remaining} = 0`,
  };
  return tx.$queryRaw<WmsReservation[]>(Prisma.sql`
    SELECT * FROM "WmsReservation"
    WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}
      AND (${predicates[filters.workflowStatus]})
      ${filters.warehouseId || filters.locationId || filters.lotId || filters.barcode || filters.lotCode ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM "WmsStockBalance" b JOIN "WmsLot" l
          ON l.id = b."lotId" AND l."organizationId" = b."organizationId" AND l."workspaceId" = b."workspaceId"
        WHERE b.id = "WmsReservation"."balanceId" AND b."organizationId" = ${scope.organizationId} AND b."workspaceId" = ${scope.workspaceId}
          ${filters.warehouseId ? Prisma.sql`AND b."warehouseId" = ${filters.warehouseId}` : Prisma.empty}
          ${filters.locationId ? Prisma.sql`AND b."locationId" = ${filters.locationId}` : Prisma.empty}
          ${filters.lotId ? Prisma.sql`AND b."lotId" = ${filters.lotId}` : Prisma.empty}
          ${filters.barcode ? Prisma.sql`AND l.barcode = ${filters.barcode}` : Prisma.empty}
          ${filters.lotCode ? Prisma.sql`AND l."lotCode" = ${filters.lotCode}` : Prisma.empty}
      )` : Prisma.empty}
      ${filters.balanceId ? Prisma.sql`AND "balanceId" = ${filters.balanceId}` : Prisma.empty}
      ${filters.number ? Prisma.sql`AND "number" = ${filters.number}` : Prisma.empty}
      ${after ? Prisma.sql`AND ("createdAt" > ${new Date(after.time)} OR ("createdAt" = ${new Date(after.time)} AND id > ${after.id}))` : Prisma.empty}
    ORDER BY "createdAt" ASC, id ASC LIMIT ${limit + 1}`);
}

/** Enrich only the visible page in one scoped query, without reading ProductRecord. */
export async function presentReservations(tx: Tx, scope: WmsScope, reservations: readonly WmsReservation[]) {
  if (!reservations.length) return [];
  const stockByBalance = await queryStockContexts(tx, scope, reservations.map(row => row.balanceId));
  return reservations.map(reservation => ({ ...reservation, ...reservationProgress(reservation), stock: stockByBalance.get(reservation.balanceId) ?? null }));
}
