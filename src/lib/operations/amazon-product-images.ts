import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { AmazonDataAccess } from "@/lib/amazon-sync/data-access";

type Scope = { organizationId: string; workspaceId: string };
type Product = { sellerAccountId: string; marketplaceId: string; asin: string };

// Parameterized reads keep additive image tables available to an already-running
// development process whose cached Prisma Client predates the generated models.
export function imageSellerPredicate(access: AmazonDataAccess): Prisma.Sql {
  if (access.allSellers) return Prisma.sql`TRUE`;
  if (!access.sellerIds.length) return Prisma.sql`FALSE`;
  const sellers = Prisma.sql`r."sellerAccountId" IN (${Prisma.join(access.sellerIds)})`;
  if (!access.scopes) return sellers;
  if (!access.scopes.length) return Prisma.sql`FALSE`;
  return Prisma.sql`(${sellers} AND (${Prisma.join(access.scopes.map(scope => Prisma.sql`(r."sellerAccountId" = ${scope.sellerAccountId} ${scope.marketplaceIds.length ? Prisma.sql`AND r."marketplaceId" IN (${Prisma.join(scope.marketplaceIds)})` : Prisma.empty})`), " OR ")}))`;
}

export async function readProductImageReferences(scope: Scope, products: Product[]) {
  if (!products.length) return [];
  if (products.length > 4000) throw new Error("Image product scope exceeds page limit");
  return prisma.$queryRaw<Array<Product & { fileId: string }>>(Prisma.sql`
    SELECT r."sellerAccountId", r."marketplaceId", r.asin, b."fileId"
    FROM "AmazonCatalogImageReference" r
    JOIN "AmazonCatalogImageBlob" b ON b.id = r."blobId" AND b."organizationId" = r."organizationId" AND b."workspaceId" = r."workspaceId"
    JOIN "FileObject" f ON f.id = b."fileId" AND f."organizationId" = b."organizationId" AND f."workspaceId" = b."workspaceId"
    WHERE r."organizationId" = ${scope.organizationId} AND r."workspaceId" = ${scope.workspaceId} AND r.variant = 'MAIN' AND f.status = 'done'
      AND (${Prisma.join(products.map(product => Prisma.sql`(r."sellerAccountId" = ${product.sellerAccountId} AND r."marketplaceId" = ${product.marketplaceId} AND r.asin = ${product.asin})`), " OR ")})
    LIMIT 4000
  `);
}

export async function readAccessibleProductImage(scope: Scope, fileId: string, access: AmazonDataAccess) {
  const rows = await prisma.$queryRaw<Array<{ contentHash: string; storageKey: string; storageType: string; status: string; mimeType: string }>>(Prisma.sql`
    SELECT b."contentHash", f."storageKey", f."storageType", f.status, f."mimeType"
    FROM "AmazonCatalogImageBlob" b
    JOIN "FileObject" f ON f.id = b."fileId" AND f."organizationId" = b."organizationId" AND f."workspaceId" = b."workspaceId"
    WHERE b."organizationId" = ${scope.organizationId} AND b."workspaceId" = ${scope.workspaceId} AND b."fileId" = ${fileId}
      AND EXISTS (SELECT 1 FROM "AmazonCatalogImageReference" r WHERE r."blobId" = b.id AND r."organizationId" = b."organizationId" AND r."workspaceId" = b."workspaceId" AND ${imageSellerPredicate(access)})
    LIMIT 1
  `);
  return rows[0] ?? null;
}
