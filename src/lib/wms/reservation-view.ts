type ReservationQuantities = { requestedQty: number; releasedQty: number; dispatchedQty: number; pickedQty: number };

/** Derived from the reservation document; picking does not release reserved stock. */
export function reservationProgress(reservation: ReservationQuantities) {
  const remainingQty = reservation.requestedQty - reservation.releasedQty - reservation.dispatchedQty;
  const unpickedQty = remainingQty - reservation.pickedQty;
  const workflowStatus = remainingQty === 0 ? "CLOSED"
    : reservation.pickedQty === 0 ? "AWAITING_PICK"
    : unpickedQty === 0 ? "AWAITING_DISPATCH" : "PARTIALLY_PICKED";
  return { remainingQty, unpickedQty, workflowStatus };
}

export type ReservationStockContext = {
  sku?: string;
  productRecordId?: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  locationId: string;
  locationCode: string;
  locationFrozen: boolean;
  lotId: string;
  lotCode: string;
  barcode: string | null;
};

export type WmsLocationContext = Pick<ReservationStockContext, "warehouseId" | "warehouseCode" | "warehouseName" | "locationId" | "locationCode">;

/** Current reservation quantities for approval review, not the approved snapshot. */
export type ApprovalReservationContext = ReservationQuantities & ReturnType<typeof reservationProgress> & {
  number: string;
  revision: number;
};
