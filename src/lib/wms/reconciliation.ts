import { Prisma } from "@prisma/client";
import type { Tx } from "./repository";
import { scoped } from "./access";
import type { WmsScope } from "./contracts";

const buckets = ["onHand", "pendingQc", "pendingPutaway", "rejected", "reserved"] as const;
type Balance = { id: string } & Record<typeof buckets[number], number>;
type Totals = { balanceId: string; movementCount: string } & Record<typeof buckets[number], string>;
type ReservationTotal = { balanceId: string; remaining: string };

/** Run within the balance query's repeatable-read transaction so a concurrent
 * movement cannot make two correct observations appear to disagree. */
export async function reconcileBalances(tx: Tx, scope: WmsScope, balances: readonly Balance[]) {
  if (!balances.length) return [];
  const totals = await tx.$queryRaw<Totals[]>(Prisma.sql`
    SELECT "balanceId", COUNT(*)::text AS "movementCount",
      SUM("deltaOnHand")::text AS "onHand", SUM("deltaPendingQc")::text AS "pendingQc",
      SUM("deltaPendingPutaway")::text AS "pendingPutaway", SUM("deltaRejected")::text AS "rejected",
      SUM("deltaReserved")::text AS "reserved"
    FROM "WmsMovement" WHERE "organizationId"=${scoped(scope).organizationId}
      AND "workspaceId"=${scope.workspaceId} AND "balanceId" IN (${Prisma.join(balances.map(balance => balance.id))})
    GROUP BY "balanceId"`);
  const byBalance = new Map(totals.map(total => [total.balanceId, total]));
  const reservationTotals = await tx.$queryRaw<ReservationTotal[]>(Prisma.sql`
    SELECT "balanceId", SUM("requestedQty"::bigint - "releasedQty"::bigint - "dispatchedQty"::bigint)::text AS remaining
    FROM "WmsReservation" WHERE "organizationId"=${scope.organizationId}
      AND "workspaceId"=${scope.workspaceId} AND "balanceId" IN (${Prisma.join(balances.map(balance => balance.id))})
    GROUP BY "balanceId"`);
  const remainingByBalance = new Map(reservationTotals.map(total => [total.balanceId, total.remaining]));
  return balances.map(balance => {
    const total = byBalance.get(balance.id);
    const differences = buckets.flatMap(bucket => {
      const recorded = String(balance[bucket]);
      // No movements means a ledger total of zero, not an external missing observation.
      const movementTotal = total?.[bucket] ?? "0";
      return BigInt(recorded) === BigInt(movementTotal) ? [] : [{ bucket, recorded, movementTotal }];
    });
    // Picked units are still reserved until dispatch; never subtract pickedQty here.
    const reservationRemaining = remainingByBalance.get(balance.id) ?? "0";
    const reservationDifference = BigInt(balance.reserved) === BigInt(reservationRemaining) ? null : { recorded: String(balance.reserved), reservationRemaining };
    return { ...balance, reconciliationStatus: differences.length || reservationDifference ? "MISMATCH" : "MATCH", movementCount: total?.movementCount ?? "0", differences, reservationRemaining, reservationDifference };
  });
}
