import type { WmsReceipt, WmsReceiptLine } from "@prisma/client";
import type { Tx } from "./repository";
import type { WmsScope } from "./contracts";
import { scoped } from "./access";
import type { ReceiptLocationContext } from "./receipt-view";

/** Enrich only the visible receipts using scoped WMS catalog data. */
export async function presentReceipts(tx: Tx, scope: WmsScope, receipts: readonly (WmsReceipt & { lines: WmsReceiptLine[] })[]) {
  if (!receipts.length) return [];
  const lots = await tx.wmsLot.findMany({
    where: { ...scoped(scope), id: { in: [...new Set(receipts.flatMap(receipt => receipt.lines.map(line => line.lotId)))] } },
    select: { id: true, lotCode: true, barcode: true },
  });
  const locations = await tx.wmsLocation.findMany({
    where: { ...scoped(scope), id: { in: [...new Set(receipts.map(receipt => receipt.receivingLocationId))] } },
    select: { id: true, code: true, warehouseId: true, area: { select: { warehouse: { select: { code: true, name: true } } } } },
  });
  const lotById = new Map(lots.map(({ id, ...lot }) => [id, lot]));
  const locationById = new Map<string, ReceiptLocationContext>(locations.map(location => [location.id, {
    locationId: location.id, locationCode: location.code, warehouseId: location.warehouseId,
    warehouseCode: location.area.warehouse.code, warehouseName: location.area.warehouse.name,
  }]));
  return receipts.map(receipt => ({ ...receipt, receivingLocation: locationById.get(receipt.receivingLocationId) ?? null,
    lines: receipt.lines.map(line => ({ ...line, lot: lotById.get(line.lotId) ?? null })),
  }));
}
