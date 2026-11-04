import type { Prisma } from "@prisma/client";
import { amazonDataAccess, sellerAccessWhere } from "@/lib/amazon-sync/data-access";
import { SyncInputError, type SyncScope } from "@/lib/amazon-sync/policy";

/** Resolve inside the caller's transaction. No permissions or heads cached across calls. */
export async function amazonPublishedReadScope(db: Prisma.TransactionClient, scope: SyncScope, actor: string) {
  const access = await amazonDataAccess(scope, actor, db);
  const sources = await db.amazonSyncDataSource.findMany({
    where: { ...scope, ...sellerAccessWhere(access), enabled: true, seller: { status: "active" }, publishedRun: { status: "SUCCEEDED", executionVersion: 2 }, activeRunId: { not: null } },
    select: { id: true, activeRunId: true, sellerAccountId: true, marketplaceId: true, resource: true }, take: 201,
  });
  if (sources.length > 200) throw new SyncInputError("数据源超过安全范围。", 409);
  return sources;
}
