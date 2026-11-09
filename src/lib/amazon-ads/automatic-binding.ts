import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AdsAuthScope } from "./authorization";

/** Called under adsSyncLock after the current manager has been checked.
 * Only a seller-type Profile with an exact verified SP seller/site identity is
 * joined to SP data. Other advertisers receive their own tenant-scoped store;
 * display names, countries and user-entered advertiser IDs are never identity.
 */
export async function ensureAutomaticAdsBinding(tx: Prisma.TransactionClient, scope: AdsAuthScope, profileRecordId: string) {
  const profile = await tx.amazonAdsProfile.findFirst({ where: { ...scope, id: profileRecordId }, select: { id: true, sellerAccountId: true, authorizationId: true, profileId: true, region: true, countryCode: true, marketplaceId: true, accountInfo: true } });
  if (!profile || profile.sellerAccountId) return;
  const info = profile.accountInfo as Record<string, unknown> | null;
  let sellerAccountId: string | undefined;
  if (info?.type === "seller" && typeof info.id === "string" && profile.marketplaceId) {
    const region = profile.region === "NA" ? "us-east-1" : profile.region === "EU" ? "eu-west-1" : "us-west-2";
    const authorizations = await tx.amazonSpApiAuthorization.findMany({ where: { ...scope, amazonSellerId: info.id, awsRegion: region, status: "CONFIGURED", identityVerifiedAt: { not: null } }, select: { id: true } });
    const identities = await tx.amazonSellerIdentity.findMany({ where: { ...scope, amazonSellerId: info.id, marketplaceId: profile.marketplaceId, region, authorizationId: { in: authorizations.map(auth => auth.id) } }, select: { sellerAccountId: true }, take: 2 });
    if (identities.length > 1) throw new Error("ADS_VERIFIED_SELLER_IDENTITY_AMBIGUOUS");
    if (identities[0] && await tx.sellerAccount.findFirst({ where: { ...scope, id: identities[0].sellerAccountId, status: "active" }, select: { id: true } })) sellerAccountId = identities[0].sellerAccountId;
  }
  if (!sellerAccountId) {
    const accountKey = `amazon-ads:${createHash("sha256").update(JSON.stringify([profile.authorizationId, profile.region, profile.profileId])).digest("hex")}`;
    const marketplaceCode = profile.countryCode;
    const seller = await tx.sellerAccount.upsert({ where: { organizationId_workspaceId_accountKey_marketplaceCode: { ...scope, accountKey, marketplaceCode } }, create: { ...scope, id: randomUUID(), accountKey, marketplaceCode, displayName: `Amazon Ads ${profile.region} · ${profile.profileId}` }, update: {} });
    if (seller.status !== "active") return;
    sellerAccountId = seller.id;
  }
  await tx.amazonAdsProfile.updateMany({ where: { ...scope, id: profile.id, sellerAccountId: null }, data: { sellerAccountId } });
}
