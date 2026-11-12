import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { parseAmazonBusinessJson } from "./business-data";
import { SyncInputError, type SyncScope } from "./policy";

/** Page-bounded enrichment inside an already authorized snapshot read.
 * Match the immutable row and run; never infer account ownership from SKU.
 */
export async function catalogBusinessFields<T extends { id: string; sourceRunId: string; sellerAccountId: string; marketplaceId: string; listingAttributes: Prisma.JsonValue; fieldSources: Prisma.JsonValue }>(scope: SyncScope, rows: T[], db: Prisma.TransactionClient = prisma) {
  if (!rows.length) return [];
  if (rows.length > 1000) throw new SyncInputError("目录字段读取超过单页容量。", 409);
  const values = await db.$queryRaw<Array<{ id: string; sourceRunId: string; sellerAccountId: string; marketplaceId: string; attributesText: string | null; fieldsText: string }>>(Prisma.sql`
    SELECT id, "sourceRunId", "sellerAccountId", "marketplaceId", "listingAttributes"::text AS "attributesText", "fieldSources"::text AS "fieldsText"
    FROM "AmazonCatalogSnapshot"
    WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}
      AND id IN (${Prisma.join(rows.map(row => row.id))})`);
  const byId = new Map(values.map(row => [row.id, row]));
  return rows.map(row => {
    const value = byId.get(row.id);
    if (!value || value.sourceRunId !== row.sourceRunId || value.sellerAccountId !== row.sellerAccountId || value.marketplaceId !== row.marketplaceId) throw new SyncInputError("目录快照在查询期间发生变化。", 409);
    return { ...row,
      listingAttributes: value.attributesText === null ? null : parseAmazonBusinessJson(value.attributesText),
      fieldSources: parseAmazonBusinessJson(value.fieldsText),
    };
  });
}
