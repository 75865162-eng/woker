import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess } from "@/lib/amazon-sync/data-access";
import { AmazonReadError } from "@/lib/amazon-sync/read-account";
import { SyncInputError, type SyncScope } from "@/lib/amazon-sync/policy";

/** Ads authorization is independent of SP-API; no SP-API source is required. */
export async function amazonAdsAccountReadAccess(scope: SyncScope, actor: string, input: { sellerAccountId?: string; marketplaceId?: string; profileRecordId?: string; internalProfileId?: string; authorizationId?: string }, db: Prisma.TransactionClient = prisma) {
  const access = await amazonDataAccess(scope, actor, db);
  let sellerAccountId = input.sellerAccountId;
  const profileId = input.profileRecordId ?? input.internalProfileId;
  if (sellerAccountId && !access.sellerIds.includes(sellerAccountId)) throw new SyncInputError("Amazon 账号未分配给当前用户。", 403);
  if (profileId) {
    const profile = await db.amazonAdsProfile.findFirst({ where: { ...scope, id: profileId, sellerAccountId: { in: access.sellerIds } }, select: { sellerAccountId: true } });
    if (!profile?.sellerAccountId || sellerAccountId && profile.sellerAccountId !== sellerAccountId) throw new SyncInputError("广告 Profile 不属于当前账号。", 403);
    sellerAccountId = profile.sellerAccountId;
  }
  if (!sellerAccountId && access.sellerIds.length === 1) sellerAccountId = access.sellerIds[0];
  if (!sellerAccountId) throw new AmazonReadError("ACCOUNT_SCOPE_REQUIRED", "请选择单个 Amazon 账号后查询广告。", 400);
  const profiles = await db.amazonAdsProfile.findMany({ where: { ...scope, sellerAccountId,
    ...(profileId ? { id: profileId } : {}), ...(input.marketplaceId ? { marketplaceId: input.marketplaceId } : {}), ...(input.authorizationId ? { authorizationId: input.authorizationId } : {}),
  }, select: { authorization: { select: { status: true } } }, take: 501 });
  if (profiles.length > 500) throw new SyncInputError("广告 Profile 超过安全上限。", 409);
  if (!profiles.length) throw new AmazonReadError("DATA_SOURCE_NOT_CONFIGURED", "当前账号尚未接入所选广告 Profile。");
  if (profiles.some(profile => profile.authorization.status !== "CONNECTED")) throw new AmazonReadError("AMAZON_AUTHORIZATION_INVALID", "Amazon Ads 官方授权已失效，请重新连接该账号。");
  return { allSellers: false, sellerIds: [sellerAccountId] };
}
