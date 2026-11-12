import type { Prisma } from "@prisma/client";
import { sellerAccessWhere } from "@/lib/amazon-sync/data-access";
import { amazonAccountReadAccess } from "@/lib/amazon-sync/read-account";
import { SyncInputError, type SyncScope } from "@/lib/amazon-sync/policy";

/** Resolve inside the caller's transaction. No permissions or heads cached across calls. */
export async function amazonPublishedReadScope(db: Prisma.TransactionClient, scope: SyncScope, actor: string, params = new URLSearchParams()) {
  const access = await amazonAccountReadAccess(scope, actor, params, db);
  const sources = await db.amazonSyncDataSource.findMany({
    where: { ...scope, ...sellerAccessWhere(access),
      ...(params.get("marketplaceId") ? { marketplaceId: params.get("marketplaceId")! } : {}),
      enabled: true, seller: { status: "active" }, activeRunId: { not: null },
      publishedRun: { status: "SUCCEEDED", executionVersion: 2, finishedAt: { not: null }, stage: { not: "PURGED" } },
      AND: [{ OR: ["inventory", "catalog"].map(resource => ({ resource, publishedRun: { resource } })) }],
    },
    select: { id: true, activeRunId: true, sellerAccountId: true, marketplaceId: true, resource: true }, take: 201,
  });
  if (sources.length > 200) throw new SyncInputError("数据源超过安全范围。", 409);
  return sources;
}
