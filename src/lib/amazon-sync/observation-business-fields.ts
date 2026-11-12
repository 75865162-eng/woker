import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { parseAmazonBusinessJson } from "./business-data";
import { SyncInputError, type SyncScope } from "./policy";

/** Enrich an authorized page without decoding stored numeric tokens as Number.
 * The caller rechecks its live account assignment after this read.
 */
export async function observationBusinessFields<T extends { id: string; sourceId: string; sourceRunId: string; facts: Prisma.JsonValue }>(scope: SyncScope, rows: T[], db: Prisma.TransactionClient = prisma) {
  if (!rows.length) return [];
  if (rows.length > 1000) throw new SyncInputError("观察字段读取超过单页容量。", 409);
  const values = await db.$queryRaw<Array<{ id: string; sourceId: string; sourceRunId: string; factsText: string }>>(Prisma.sql`
    SELECT id, "sourceId", "sourceRunId", facts::text AS "factsText"
    FROM "AmazonDomainObservation"
    WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}
      AND id IN (${Prisma.join(rows.map(row => row.id))})`);
  const byId = new Map(values.map(row => [row.id, row]));
  return rows.map(row => {
    const value = byId.get(row.id);
    if (!value || value.sourceId !== row.sourceId || value.sourceRunId !== row.sourceRunId) throw new SyncInputError("观察记录在查询期间发生变化。", 409);
    return { ...row, facts: parseAmazonBusinessJson(value.factsText) };
  });
}
