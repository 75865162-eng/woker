/** Presentation limits only; the transactional application service remains authoritative. */
export type StockAction = "SKU_CONVERT" | "RESERVE" | "TRANSFER" | "PICK" | "UNPICK" | "DISPATCH" | "RELEASE";
export const stockActionLabels: Record<StockAction, string> = { SKU_CONVERT: "SKU 转换", RESERVE: "预占", TRANSFER: "调拨", PICK: "拣货", UNPICK: "取消拣货", DISPATCH: "出库", RELEASE: "释放预占" };
export function stockActionLimit(item: Record<string, unknown>, action: StockAction): number | null {
  if (item.stock && typeof item.stock === "object" && "locationFrozen" in item.stock && item.stock.locationFrozen === true) return 0;
  const keys = action === "SKU_CONVERT" || action === "RESERVE" || action === "TRANSFER" ? ["onHand", "pendingQc", "pendingPutaway", "rejected", "reserved"] : ["requestedQty", "releasedQty", "dispatchedQty", "pickedQty"];
  if (keys.some(key => typeof item[key] !== "number" || !Number.isSafeInteger(item[key]) || (item[key] as number) < 0)) return null;
  const n = (key: string) => item[key] as number;
  const limit = action === "SKU_CONVERT" || action === "RESERVE" || action === "TRANSFER" ? n("onHand") - n("pendingQc") - n("pendingPutaway") - n("rejected") - n("reserved")
    : action === "PICK" || action === "RELEASE" ? n("requestedQty") - n("releasedQty") - n("dispatchedQty") - n("pickedQty") : n("pickedQty");
  return limit < 0 ? null : limit;
}
