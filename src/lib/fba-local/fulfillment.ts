import { reservationProgress } from "@/lib/wms/reservation-view";

type Line = { quantity: number; reservation: { requestedQty: number; releasedQty: number; dispatchedQty: number; pickedQty: number } | null };

/** Local warehouse progress only; dispatch never implies Amazon receipt. */
export function planFulfillment(status: string, lines: Line[]) {
  const totals = { plannedQty: 0, unreservedQty: 0, reservedQty: 0, unpickedQty: 0, pickedQty: 0, dispatchedQty: 0, releasedQty: 0 };
  for (const line of lines) {
    totals.plannedQty += line.quantity;
    if (!line.reservation) { totals.unreservedQty += line.quantity; continue; }
    const reservation = line.reservation;
    const progress = reservationProgress(reservation);
    totals.reservedQty += progress.remainingQty;
    totals.unpickedQty += progress.unpickedQty;
    totals.pickedQty += reservation.pickedQty;
    totals.dispatchedQty += reservation.dispatchedQty;
    totals.releasedQty += reservation.releasedQty;
  }
  const stage = status === "CANCELLED" ? "CANCELLED"
    : totals.dispatchedQty === totals.plannedQty && totals.plannedQty > 0 ? "DISPATCHED"
    : totals.releasedQty === totals.plannedQty && totals.plannedQty > 0 ? "RELEASED"
    : totals.releasedQty > 0 ? "SHORTFALL"
    : totals.dispatchedQty > 0 ? "PARTIALLY_DISPATCHED"
    : totals.unreservedQty === totals.plannedQty ? "NEEDS_RESERVATION"
    : totals.unreservedQty > 0 ? "PARTIALLY_RESERVED"
    : totals.unpickedQty === 0 ? "AWAITING_DISPATCH"
    : totals.pickedQty > 0 ? "PARTIALLY_PICKED" : "AWAITING_PICK";
  return { stage, ...totals };
}
