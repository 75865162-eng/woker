import type { Prisma } from "@prisma/client";
import { assertAmazonAction, assertSellerMarketplaceAccess } from "@/lib/amazon-sync/data-access";
import { SyncInputError, type SyncScope } from "@/lib/amazon-sync/policy";

export async function assertReplenishmentAccess(db: Prisma.TransactionClient, scope: SyncScope, actor: string, sellerAccountId: string, marketplaceId: string, historicalStoreId?: string, action: "view" | "edit" = "edit") {
  scope = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  await assertAmazonAction(scope, actor, action, db);
  await assertSellerMarketplaceAccess(scope, actor, sellerAccountId, marketplaceId, db, action);
  if (historicalStoreId) {
    await assertAmazonAction(scope, actor, "view", db, "sellfox");
    if (!await db.sellfoxStore.findFirst({ where: { ...scope, id: historicalStoreId }, select: { id: true } })) throw new SyncInputError("数据范围不可访问。", 403);
  }
}
