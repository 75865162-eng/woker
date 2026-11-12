import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import { publishedSnapshotScopes } from "@/lib/amazon-sync/read";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAmazonReadSession } from "@/lib/auth/amazon-read-session";
import { amazonAccountReadAccess, AmazonReadError } from "@/lib/amazon-sync/read-account";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { readAmazonProductsForSkus } from "@/lib/operations/amazon-products";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const permission = await requireAmazonReadSession(request);
  if (!permission.ok) return permission.response;
  const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
  const params = new URL(request.url).searchParams;
  const page = Math.min(100000, Math.max(1, Math.floor(Number(params.get("page")) || 1)));
  const sku = params.get("sku")?.trim().slice(0, 200);
  try {
    if (!process.env.DATABASE_URL) return NextResponse.json({ rows: [], page, hasNextPage: false, status: "NOT_SYNCED" });
    await auditAmazonDataRead(scope, permission.user.id, "products", permission.user.role);
    const access = await amazonAccountReadAccess(scope, permission.user.id, params);
    params.set("sellerAccountId", access.sellerIds[0]);
    const target = { sellerAccountId: access.sellerIds[0], ...(params.get("marketplaceId") ? { marketplaceId: params.get("marketplaceId")! } : {}) };
    const [catalogHeads, inventoryHeads] = await Promise.all([publishedSnapshotScopes(scope, "catalog", permission.user.id, target), publishedSnapshotScopes(scope, "inventory", permission.user.id, target)]);
    const predicate = (heads: typeof catalogHeads, field: "sourceRunId" | "syncRunId") => heads.length ? Prisma.sql`(${Prisma.join(heads.map(h => Prisma.sql`(${Prisma.raw(`"${field}"`)} = ${h.runId} AND "sellerAccountId" = ${h.sellerAccountId} AND "marketplaceId" = ${h.marketplaceId})`), " OR ")})` : Prisma.sql`FALSE`;
    const keys = await prisma.$queryRaw<Array<{ sellerSku: string }>>`
      SELECT DISTINCT "sellerSku" FROM (
        SELECT "sellerSku" FROM "AmazonCatalogSnapshot" WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} AND ${predicate(catalogHeads, "sourceRunId")}
        UNION
        SELECT "sellerSku" FROM "AmazonInventorySnapshot" WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} AND ${predicate(inventoryHeads, "syncRunId")} AND "sellerAccountId" IS NOT NULL
      ) rows WHERE (${sku ?? ""} = '' OR strpos(lower("sellerSku"), lower(${sku ?? ""})) > 0)
      ORDER BY "sellerSku" LIMIT 51 OFFSET ${(page - 1) * 50}
    `;
    const rows = await readAmazonProductsForSkus(scope.organizationId, scope.workspaceId, keys.slice(0, 50).map((row) => row.sellerSku), permission.user.id, target, true);
    await amazonAccountReadAccess(scope, permission.user.id, params);
    return NextResponse.json({ rows, page, hasNextPage: keys.length > 50, status: rows.length ? "AVAILABLE" : "NOT_SYNCED" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[operations.products.read]", { name: error instanceof Error ? error.name : "UnknownError", code: (error as { code?: string })?.code });
    return NextResponse.json({ error: error instanceof SyncInputError ? error.message : "Amazon 商品快照读取失败。", ...(error instanceof AmazonReadError ? { code: error.businessCode } : {}) }, { status: error instanceof SyncInputError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
