import { publishedSnapshotScopes } from "@/lib/amazon-sync/read";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { readAmazonProductsForSkus } from "@/lib/operations/amazon-products";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const permission = await requireApiPermission("operations", "view", request);
  if (!permission.ok) return permission.response;
  const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
  const params = new URL(request.url).searchParams;
  const page = Math.min(100000, Math.max(1, Math.floor(Number(params.get("page")) || 1)));
  const sku = params.get("sku")?.trim().slice(0, 200);
  try {
    if (!process.env.DATABASE_URL) return NextResponse.json({ rows: [], page, hasNextPage: false, status: "NOT_SYNCED" });
    const [catalogHeads, inventoryHeads] = await Promise.all([publishedSnapshotScopes(scope, "catalog"), publishedSnapshotScopes(scope, "inventory")]);
    const catalogIds = catalogHeads.map(h => h.runId), inventoryIds = inventoryHeads.map(h => h.runId);
    const keys = await prisma.$queryRaw<Array<{ sellerSku: string }>>`
      SELECT DISTINCT "sellerSku" FROM (
        SELECT "sellerSku" FROM "AmazonCatalogSnapshot" WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} AND "sourceRunId" IN (${Prisma.join(catalogIds.length ? catalogIds : ["__none__"])})
        UNION
        SELECT "sellerSku" FROM "AmazonInventorySnapshot" WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} AND "syncRunId" IN (${Prisma.join(inventoryIds.length ? inventoryIds : ["__none__"])}) AND "sellerAccountId" IS NOT NULL
      ) rows WHERE (${sku ?? ""} = '' OR strpos(lower("sellerSku"), lower(${sku ?? ""})) > 0)
      ORDER BY "sellerSku" LIMIT 51 OFFSET ${(page - 1) * 50}
    `;
    const rows = await readAmazonProductsForSkus(scope.organizationId, scope.workspaceId, keys.slice(0, 50).map((row) => row.sellerSku));
    return NextResponse.json({ rows, page, hasNextPage: keys.length > 50, status: rows.length ? "AVAILABLE" : "NOT_SYNCED" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Amazon 商品快照读取失败。" }, { status: 500 }); }
}
