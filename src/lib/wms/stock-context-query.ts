import type { Tx } from "./repository";
import type { WmsScope } from "./contracts";
import { scoped } from "./access";
import type { ReservationStockContext } from "./reservation-view";
import type { WmsMovement, WmsStockBalance } from "@prisma/client";
import { availableQuantity } from "./rules";

/** Present only the visible page, using the same scoped context as picking and approvals. */
export async function presentBalances(tx: Tx, scope: WmsScope, balances: readonly WmsStockBalance[]) {
  const contexts = await queryStockContexts(tx, scope, balances.map(balance => balance.id));
  return balances.map(balance => ({ ...balance, available: availableQuantity(balance), stock: contexts.get(balance.id) ?? null }));
}

export async function presentMovements(tx: Tx, scope: WmsScope, movements: readonly WmsMovement[]) {
  const contexts = await queryStockContexts(tx, scope, movements.map(movement => movement.balanceId));
  return movements.map(movement => ({ ...movement, stock: contexts.get(movement.balanceId) ?? null }));
}

export async function queryStockContexts(tx: Tx, scope: WmsScope, balanceIds: readonly string[]) {
  if (!balanceIds.length) return new Map<string, ReservationStockContext>();
  const balances = await tx.wmsStockBalance.findMany({
    where: { ...scoped(scope), id: { in: [...new Set(balanceIds)] } },
    select: {
      id: true, warehouseId: true, locationId: true, lotId: true,
      location: { select: { code: true, frozen: true, area: { select: { warehouse: { select: { code: true, name: true } } } } } },
      lot: { select: { productRecordId: true, lotCode: true, barcode: true, product:{select:{sku:true}} } },
    },
  });
  return new Map<string, ReservationStockContext>(balances.map(balance => [balance.id, {
    warehouseId: balance.warehouseId, warehouseCode: balance.location.area.warehouse.code,
    warehouseName: balance.location.area.warehouse.name, locationId: balance.locationId,
    locationCode: balance.location.code, locationFrozen: balance.location.frozen, lotId: balance.lotId, lotCode: balance.lot.lotCode, productRecordId: balance.lot.productRecordId,
    barcode: balance.lot.barcode, sku: balance.lot.product.sku,
  }]));
}
