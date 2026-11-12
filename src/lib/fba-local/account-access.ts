import { amazonAccountReadAccess } from "@/lib/amazon-sync/read-account";
import type { WmsScope } from "@/lib/wms/contracts";
import { WmsError } from "@/lib/wms/contracts";
import type { Tx } from "@/lib/wms/repository";

/** Reuse the account read contract; this does not grant Amazon mutation authority. */
export async function authorizeFbaAccount(tx: Tx, scope: WmsScope, sellerAccountId: string, marketplaceId: string) {
  // Locks serialize committed revocation/status changes with local inventory handoff.
  await tx.$queryRaw`SELECT g.id FROM "AmazonDataAccessGrant" g JOIN "SellerAccount" s ON s.id=g."sellerAccountId"
    WHERE g."organizationId"=${scope.organizationId} AND g."workspaceId"=${scope.workspaceId}
    AND g."userId"=${scope.actorUserId} AND g."sellerAccountId"=${sellerAccountId} FOR SHARE OF g,s`;
  await tx.$queryRaw`SELECT a.id FROM "AmazonSpApiAuthorization" a JOIN "AmazonSyncDataSource" s ON s."authorizationId"=a.id
    WHERE s."organizationId"=${scope.organizationId} AND s."workspaceId"=${scope.workspaceId}
    AND s."sellerAccountId"=${sellerAccountId} AND s."marketplaceId"=${marketplaceId} FOR SHARE OF a,s`;
  await amazonAccountReadAccess(scope, scope.actorUserId, new URLSearchParams({ sellerAccountId, marketplaceId }), tx);
  const identities = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "AmazonSellerIdentity"
    WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId}
    AND "sellerAccountId"=${sellerAccountId} AND "marketplaceId"=${marketplaceId} FOR SHARE`;
  if (!identities.length) throw new WmsError("账号与 Amazon 站点身份尚未核实。", 409);
}
