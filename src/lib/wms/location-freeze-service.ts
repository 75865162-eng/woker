import { scoped } from "./access";
import { WmsError, type WmsCommandInput, type WmsScope } from "./contracts";
import type { Tx } from "./repository";

/** Location operation lock, independent of stock quantity buckets and reservations. */
export async function validateLocationFreeze(tx: Tx, scope: WmsScope, input: WmsCommandInput) {
  if (input.payload.action !== "LOCATION_FREEZE" && input.payload.action !== "LOCATION_UNFREEZE") throw new WmsError("非库位冻结动作。", 400);
  // Lock parents before the location, matching activeLocation/catalog writes.
  // FOR UPDATE conflicts with every inventory operation's FOR SHARE gate.
  await tx.$queryRaw`SELECT l.id FROM "WmsLocation" l
    JOIN "WmsArea" a ON a.id=l."areaId"
    JOIN "WmsWarehouse" w ON w.id=l."warehouseId"
    WHERE l."organizationId"=${scope.organizationId} AND l."workspaceId"=${scope.workspaceId}
      AND l.id=${input.aggregateId} FOR SHARE OF a,w`;
  await tx.$queryRaw`SELECT id FROM "WmsLocation"
    WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId}
      AND id=${input.aggregateId} FOR UPDATE`;
  const location = await tx.wmsLocation.findFirst({ where: { ...scoped(scope), id: input.aggregateId }, include: { area: { include: { warehouse: true } } } });
  if (!location) throw new WmsError("库位不存在。", 404);
  if (location.revision !== input.expectedRevision) throw new WmsError("库位已变更，请重新申请。");
  if (location.frozen === (input.payload.action === "LOCATION_FREEZE")) throw new WmsError("库位冻结状态已变化，请刷新。");
  // Unfreezing remains possible for a disabled empty location; it does not enable it.
  if (input.payload.action === "LOCATION_FREEZE" && (!location.enabled || !location.area.enabled || !location.area.warehouse.enabled)) throw new WmsError("只能冻结已启用的库位。", 422);
  return location;
}

export async function executeLocationFreeze(tx: Tx, scope: WmsScope, input: WmsCommandInput) {
  const location = await validateLocationFreeze(tx, scope, input);
  const updated = await tx.wmsLocation.update({ where: { id: location.id }, data: {
    frozen: input.payload.action === "LOCATION_FREEZE", revision: { increment: 1 },
  } });
  return updated.revision;
}
