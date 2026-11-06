import type { Prisma } from "@prisma/client";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";
import { assertAmazonScopeAdmin } from "./data-access";
import { digest } from "./approval-policy";
import { SyncInputError, type SyncScope } from "./policy";
import { parseSettlementPolicy, type SettlementBinding } from "./settlements";

export async function settlementScope(tx: Prisma.TransactionClient, scope: SyncScope, source: { authorizationId: string; marketplaceId: string; settlementPolicy: unknown }, actors: string[]) {
  const policy = parseSettlementPolicy(source.settlementPolicy);
  // Full originals may contain unbound sites. Only live organization admins can collect them.
  for (const actor of new Set(actors)) await assertAmazonScopeAdmin(scope, actor, tx);
  const auth = await tx.amazonSpApiAuthorization.findFirstOrThrow({ where: { ...scope, id: source.authorizationId } });
  const sites = extractMarketplaceParticipations({ payload: auth.marketplaceParticipations });
  if (!auth.amazonSellerId.trim() || (!policy.collectionMarketplaceIds.includes(source.marketplaceId) || policy.archiveOnlyMarketplaceIds.includes(source.marketplaceId)) || policy.collectionMarketplaceIds.some(id => !policy.archiveOnlyMarketplaceIds.includes(id) && !sites.some(site => site.marketplaceId === id))) throw new SyncInputError("结算采集范围缺少已验证的卖家身份或参与站点。", 403);
  const sources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: auth.id, resource: "settlements", marketplaceId: { in: policy.collectionMarketplaceIds.filter(id => !policy.archiveOnlyMarketplaceIds.includes(id)) }, enabled: true }, select: { id: true, revision: true, sellerAccountId: true, marketplaceId: true }, orderBy: { id: "asc" }, take: 201 });
  if (sources.length > 200 || new Set(sources.map(s => s.marketplaceId)).size !== sources.length) throw new SyncInputError("结算站点绑定存在冲突。", 409);
  const bindings: SettlementBinding[] = sources.map(({ id, ...row }) => ({ sourceId: id, ...row }));
  return { policy, bindings };
}
export function assertFrozenSettlementScope(current: unknown, frozen: unknown) {
  if (digest(current) !== digest(frozen)) throw new SyncInputError("结算采集范围或店铺绑定已变更，须重新审批；检查点保留。", 409);
}
