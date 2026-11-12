import { createHash } from "node:crypto";
import { Prisma, type WmsStockBalance } from "@prisma/client";
import { scoped, json } from "./access";
import { WmsError, type WmsScope, type WmsBalanceSnapshot } from "./contracts";
import { assertBalanceInvariant } from "./rules";

export type Tx = Prisma.TransactionClient;
export async function lockKey(tx: Tx, key: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}
export async function lockAggregate(tx: Tx, scope: WmsScope, id: string, kind: "assemblyOrder" | "costRule" | "financeDraft" | "consumable" | "transferOrder" | "receipt" | "reservation" | "approval" | "balance" | "stocktake" | "outbound" | "outboundLine") {
  // Table identifiers are a closed server-side set, never caller SQL.
  const table = { assemblyOrder:"WmsAssemblyOrder", costRule:"WmsCostRule",financeDraft:"WmsFinanceDraft",consumable:"WmsOutboundConsumable", transferOrder:"WmsTransferOrder", receipt: "WmsReceipt", reservation: "WmsReservation", approval: "WmsApproval", balance: "WmsStockBalance", stocktake: "WmsStocktake", outbound: "WmsOutbound", outboundLine: "WmsOutboundLine" }[kind];
  await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`);
}
export async function activeLocation(tx: Tx, scope: WmsScope, id: string, warehouseId?: string, kind?: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; warehouseId: string; kind: string }>>`SELECT l.id, l."warehouseId", l.kind FROM "WmsLocation" l JOIN "WmsArea" a ON a.id=l."areaId" JOIN "WmsWarehouse" w ON w.id=l."warehouseId" WHERE l."organizationId"=${scope.organizationId} AND l."workspaceId"=${scope.workspaceId} AND l.id=${id} AND l.enabled AND NOT l.frozen AND a.enabled AND w.enabled FOR SHARE OF l,a,w`;
  const row = rows[0];
  if (!row || (warehouseId && row.warehouseId !== warehouseId) || (kind && row.kind !== kind)) throw new WmsError("库位不可用、已冻结或不属于指定仓库。", 422);
  return row;
}
export function balanceId(scope: WmsScope, locationId: string, lotId: string) { return createHash("sha256").update(JSON.stringify([scope.organizationId, scope.workspaceId, locationId, lotId])).digest("hex"); }
export async function ensureBalances(tx: Tx, scope: WmsScope, rows: Array<{ locationId: string; warehouseId: string; lotId: string }>) {
  const sorted = [...new Map(rows.map(row => [balanceId(scope, row.locationId, row.lotId), row])).entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [id, row] of sorted) {
    await tx.$executeRaw`INSERT INTO "WmsStockBalance" (id,"organizationId","workspaceId","warehouseId","locationId","lotId","updatedAt") VALUES (${id},${scope.organizationId},${scope.workspaceId},${row.warehouseId},${row.locationId},${row.lotId},NOW()) ON CONFLICT ("organizationId","workspaceId","locationId","lotId") DO NOTHING`;
    await lockAggregate(tx, scope, id, "balance");
  }
}
export function snapshot(b: WmsStockBalance): WmsBalanceSnapshot { return { onHand: b.onHand, pendingQc: b.pendingQc, pendingPutaway: b.pendingPutaway, rejected: b.rejected, reserved: b.reserved, revision: b.revision }; }
export async function move(tx: Tx, scope: WmsScope, commandId: string, sequence: number, balance: WmsStockBalance, delta: Partial<Omit<WmsBalanceSnapshot, "revision">>, source: { action: string; sourceType: string; sourceId: string; sourceLineId?: string }) {
  const before = snapshot(balance);
  const after = { ...before, revision: before.revision + 1 };
  for (const key of ["onHand", "pendingQc", "pendingPutaway", "rejected", "reserved"] as const) after[key] += delta[key] ?? 0;
  assertBalanceInvariant(after);
  const changed = await tx.wmsStockBalance.updateMany({ where: { ...scoped(scope), id: balance.id, revision: before.revision }, data: after });
  if (changed.count !== 1) throw new WmsError("余额已变更，请重新读取。");
  await tx.$queryRaw`SELECT id FROM "WmsLot" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${balance.lotId} FOR SHARE`;
  const lot=await tx.wmsLot.findFirstOrThrow({where:{...scoped(scope),id:balance.lotId},select:{unitVolumeCubicMeters:true}});
  const Volume=Prisma.Decimal.clone({precision:60});
  const deltaVolumeCubicMeters=lot.unitVolumeCubicMeters===null?null:new Volume(lot.unitVolumeCubicMeters.toFixed()).mul(delta.onHand??0).toFixed(9);
  return tx.wmsMovement.create({ data: { ...scoped(scope), id: crypto.randomUUID(), commandId, sequence, deltaVolumeCubicMeters, balanceId: balance.id, ...source, deltaOnHand: delta.onHand ?? 0, deltaPendingQc: delta.pendingQc ?? 0, deltaPendingPutaway: delta.pendingPutaway ?? 0, deltaRejected: delta.rejected ?? 0, deltaReserved: delta.reserved ?? 0, beforeRevision: before.revision, afterRevision: after.revision, balanceAfter: json(after), actorUserId: scope.actorUserId } });
}
