import type { Prisma } from "@prisma/client";
import { assertAmazonScopeAdmin, assertSellerMarketplaceAccess } from "./data-access";
import { assertFinanceRoles, parseFinancePolicy } from "./finance";
import { officialEndpoint, SyncInputError, type SyncScope } from "./policy";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";

/** Explicit seller-wide scope approved in P3. The source marketplace is only an
 * administrative anchor; every participating site needs an enabled ERP binding.
 * Admin membership does not replace that explicit policy or site evidence.
 */
export async function assertFinanceScope(tx: Prisma.TransactionClient, scope: SyncScope, source: { authorizationId: string; sellerAccountId: string; marketplaceId: string; financePolicy: unknown }, actors: string[]) {
  scope = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  for (const actor of actors) await assertAmazonScopeAdmin(scope, actor, tx);
  const policy = parseFinancePolicy(source.financePolicy);
  const auth = await tx.amazonSpApiAuthorization.findFirst({ where: { ...scope, id: source.authorizationId, status: "CONFIGURED" } });
  if (!auth?.amazonSellerId) throw new SyncInputError("财务卖家授权未验证。", 403);
  officialEndpoint(auth.awsRegion, auth.endpoint); assertFinanceRoles(auth);
  const approved = policy.marketplaces.map(m => m.marketplaceId).sort();
  const verified = [...new Set(extractMarketplaceParticipations({ payload: auth.marketplaceParticipations }).map(m => m.marketplaceId))].sort();
  if (!approved.includes(source.marketplaceId) || JSON.stringify(approved) !== JSON.stringify(verified)) throw new SyncInputError("卖家级财务策略必须覆盖且仅覆盖所有已验证参与站点；请重新审阅范围。", 403);
  for (const marketplaceId of approved) {
    const binding = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, authorizationId: auth.id, sellerAccountId: source.sellerAccountId, marketplaceId, enabled: true, seller: { status: "active" } }, select: { id: true } });
    // The anchor source may be new; its binding is created by this approved change.
    if (!binding && marketplaceId !== source.marketplaceId) throw new SyncInputError("财务批准站点缺少同一 ERP 店铺的有效绑定。", 403);
    if (binding) for (const actor of actors) await assertSellerMarketplaceAccess(scope, actor, source.sellerAccountId, marketplaceId, tx, "sync");
  }
  return { policy, auth };
}
