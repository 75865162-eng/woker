import { prisma } from "@/lib/db/prisma";
import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * P1 3.2 — materialize the current-listing view into the flattened profile table.
 *
 * The profile is a cache of `sellfox_listing_current`, never a new source of truth.
 * We replace the rows for the affected (org, workspace, stores) from the view itself,
 * so the口径 is identical by construction. Runs after a successful listing sync.
 * Scope is always org + workspace + explicit store ids — no cross-tenant writes.
 *
 * Two parameterized statements are issued in sequence inside one transaction supplied
 * by the caller (or an implicit one for the default client): DELETE the affected stores,
 * then re-INSERT the current head rows from the view.
 */
export type ListingProfileDb = {
  $executeRaw: PrismaClient["$executeRaw"];
};

const profileColumns = [
  "id", "organizationId", "workspaceId", "storeId", "sourceKey", "capturedAt", "asin", "msku", "sku",
  "parentAsin", "title", "status", "price", "currency", "fulfillable", "sales7", "sales14", "sales30",
  "revenue7", "revenue14", "revenue30", "adSpend7", "adSpend14", "adSpend30", "sourceUpdatedAt",
  "shopExternalId", "name", "marketplace", "fnsku", "parentSku", "mainImage", "brand", "amazonBrand",
  "productTags", "openDate", "firstSaleDate", "bsrCategory", "buyBoxWinner", "fulfillment", "rating",
  "ratingCount", "bsrRank", "purchaseCost", "fbaFees", "referralFee", "totalFee", "headTripCost",
  "reservedQty", "shippingPrice", "profitPrice", "profitRate", "listingQuantity", "unsellable",
  "warehousing", "productTagNames", "ratingValue", "dxmPublishState", "developer", "spu",
] as const;

/** The exact column projection shared by the view and the profile table. */
export function listingProfileColumnList() {
  return profileColumns.map((c) => `"${c}"`).join(",");
}

/**
 * Build the parameterized DELETE+INSERT statements. Exported as pure builders so tests
 * can assert the SQL text (tenant scope, no cross-store writes) without a database.
 */
export function listingProfileRefreshStatements(
  organizationId: string,
  workspaceId: string,
  storeIds: string[],
) {
  const cols = listingProfileColumnList();
  const colsAdditional = '"headCapturedAt","syncedAt"';
  const sourceCols = [...profileColumns.map((c) => `v."${c}"`), "v.\"capturedAt\"", "v.\"capturedAt\""].join(",");
  return {
    delete: Prisma.sql`DELETE FROM "SellfoxListingProfile" p WHERE p."organizationId"=${organizationId} AND p."workspaceId"=${workspaceId} AND p."storeId" = ANY(${storeIds}::text[])`,
    insert: Prisma.sql`INSERT INTO "SellfoxListingProfile" (${Prisma.raw(cols)},${Prisma.raw(colsAdditional)}) SELECT ${Prisma.raw(sourceCols)} FROM sellfox_listing_current v WHERE v."organizationId"=${organizationId} AND v."workspaceId"=${workspaceId} AND v."storeId" = ANY(${storeIds}::text[])`,
  };
}

export async function refreshSellfoxListingProfile(
  input: { organizationId: string; workspaceId: string; storeIds: string[] },
  db: ListingProfileDb = prisma,
): Promise<{ refreshed: number }> {
  if (!input.storeIds.length) return { refreshed: 0 };
  const statements = listingProfileRefreshStatements(input.organizationId, input.workspaceId, input.storeIds);
  await db.$executeRaw(statements.delete);
  await db.$executeRaw(statements.insert);
  return { refreshed: input.storeIds.length };
}
