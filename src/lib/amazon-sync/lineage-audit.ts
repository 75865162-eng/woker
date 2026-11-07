import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { SyncScope } from "./policy";
/** Caller must start a READ ONLY, REPEATABLE READ transaction. No SKU/ASIN inference. */
export async function auditAmazonLineage(tx: Prisma.TransactionClient, scope: SyncScope) {
  const anomalies = await tx.$queryRaw<Array<{ domain: string; id: string; reason: string }>>(Prisma.sql`
    WITH rows AS (
      SELECT 'inventory' AS domain, id, "organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "syncRunId" AS run, NULL::text AS "rowSourceId" FROM "AmazonInventorySnapshot"
      WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}
      UNION ALL SELECT 'catalog', id, "organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "sourceRunId", NULL::text FROM "AmazonCatalogSnapshot"
      WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}
      UNION ALL SELECT 'sales_traffic', id, "organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "syncRunId", "sourceId" FROM "AmazonSalesTrafficSnapshot"
      WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}
    ) SELECT r.domain, r.id, CASE
      WHEN r."sellerAccountId" IS NULL OR t.id IS NULL OR s.id IS NULL THEN 'MISSING_LINEAGE'
      WHEN r."sellerAccountId" <> s."sellerAccountId" OR r."marketplaceId" <> s."marketplaceId" OR r.domain <> s.resource OR (r.domain = 'sales_traffic' AND r."rowSourceId" IS DISTINCT FROM s.id) THEN 'SOURCE_SCOPE_MISMATCH'
      WHEN t.resource <> r.domain OR t.status <> 'SUCCEEDED' OR t."finishedAt" IS NULL OR t.stage = 'PURGED' THEN 'UNPUBLISHED_OR_MISMATCHED_RUN'
      WHEN t."executionVersion" <> 2 THEN 'LEGACY_UNVERIFIED'
      WHEN a."identityVerifiedAt" IS NULL OR i.id IS NULL THEN 'IDENTITY_UNVERIFIED'
      WHEN t."frozenScope"->>'amazonSellerId' IS DISTINCT FROM a."amazonSellerId" THEN 'HISTORICAL_IDENTITY_UNVERIFIED'
      ELSE 'VERIFIED' END AS reason
    FROM rows r LEFT JOIN "AmazonSyncRun" t ON t.id = r.run AND t."organizationId" = r."organizationId" AND t."workspaceId" = r."workspaceId"
    LEFT JOIN "AmazonSyncDataSource" s ON s.id = t."sourceId" AND s."organizationId" = r."organizationId" AND s."workspaceId" = r."workspaceId"
    LEFT JOIN "AmazonSpApiAuthorization" a ON a.id = s."authorizationId" AND a."organizationId" = r."organizationId" AND a."workspaceId" = r."workspaceId"
    LEFT JOIN "AmazonSellerIdentity" i ON i."organizationId" = r."organizationId" AND i."workspaceId" = r."workspaceId" AND i."sellerAccountId" = r."sellerAccountId" AND i."marketplaceId" = r."marketplaceId" AND i."authorizationId" = a.id AND i."amazonSellerId" = a."amazonSellerId" AND i.region = a."awsRegion"
    ORDER BY r.domain, r.id LIMIT 10001`);
  const conflicts = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*) FROM (SELECT "sellerAccountId", "marketplaceId" FROM "AmazonSyncDataSource" WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} GROUP BY "sellerAccountId", "marketplaceId" HAVING count(DISTINCT "authorizationId") > 1) c`);
  const counts: Record<string, number> = {};
  for (const row of anomalies.slice(0, 10000)) counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  return { mode: "READ_ONLY", scope, scannedRows: Math.min(anomalies.length, 10000), truncated: anomalies.length > 10000, counts, conflictingSourceBindings: Number(conflicts[0]?.count ?? 0), pendingReview: anomalies.slice(0, 10000).filter(r => r.reason !== "VERIFIED").map(r => ({ domain: r.domain, referenceHash: createHash("sha256").update(`${scope.organizationId}:${scope.workspaceId}:${r.domain}:${r.id}`).digest("hex"), reason: r.reason })), policy: "No backfill or ownership inference; review references against original authorization/run evidence." };
}
