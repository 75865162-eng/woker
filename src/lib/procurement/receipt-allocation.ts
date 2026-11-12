export type PurchaseQuantityLine = { productRecordId: string; expectedQty: number };
export type ReceiptQuantityLine = { productRecordId: string; expectedQty: number; acceptedQty: number };
export type PurchaseReceiptQuantity = { status: string; lines: ReceiptQuantityLine[] };

export function remainingPurchaseQuantities(orderLines: PurchaseQuantityLine[], receipts: PurchaseReceiptQuantity[]) {
  const remaining = new Map(orderLines.map(line => [line.productRecordId, line.expectedQty]));
  for (const receipt of receipts) {
    if (!["CANCELLED", "DRAFT", "RECEIVED", "INSPECTED", "PUTAWAY"].includes(receipt.status)) return null;
    if (receipt.status === "CANCELLED") continue;
    for (const line of receipt.lines) {
      if (!remaining.has(line.productRecordId)) return null;
      const fulfilled = receipt.status === "PUTAWAY" ? line.acceptedQty : line.expectedQty;
      remaining.set(line.productRecordId, (remaining.get(line.productRecordId) ?? 0) - fulfilled);
    }
  }
  return remaining;
}
