import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { roleCanPerformAction, defaultRolePermissionMap } from "@/lib/accounts/permissions";
import { normalizeRolePermissions } from "@/lib/accounts/role-permissions-utils";
import { encryptAmazonAdsRefreshToken } from "./credentials";
import { createAmazonAdsOAuthTransport, lwaConsentHosts, type AdsRegion, type AmazonAdsOAuthTransport, type AmazonAdsProfilePayload } from "./oauth-contract";
import { missingAmazonAdsProfileIds } from "./profile-reconciliation";
import { ensureAdsPlan } from "./sync-service";

export type AdsAuthScope = { organizationId: string; workspaceId: string };
const regions: AdsRegion[] = ["NA", "EU", "FE"];
const stateHash = (value: string) => createHash("sha256").update(value).digest("hex");

function oauthSettings(environment: Record<string, string | undefined> = process.env) {
  const clientId = environment.AMAZON_ADS_LWA_CLIENT_ID?.trim();
  const clientSecret = environment.AMAZON_ADS_LWA_CLIENT_SECRET?.trim();
  const redirectUri = environment.AMAZON_ADS_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Amazon Ads OAuth 服务端配置未完成。");
  let url: URL;
  try { url = new URL(redirectUri); } catch { throw new Error("Amazon Ads OAuth 回调地址无效。"); }
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.search || url.hash || url.pathname !== "/api/integrations/amazon/ads/oauth/callback") throw new Error("Amazon Ads OAuth 回调地址无效。");
  return { clientId, clientSecret, redirectUri };
}

export async function assertAdsSettingsManager(scope: AdsAuthScope, actor: string, db: typeof prisma | Prisma.TransactionClient = prisma) {
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor } }, include: { user: { select: { status: true } } } });
  if (!member || member.user.status !== "active" || !await db.workspaceScope.findUnique({ where: { organizationId_id: { organizationId: scope.organizationId, id: scope.workspaceId } }, select: { id: true } })) throw new Error("Amazon Ads 数据范围不可访问。");
  const permissions = { ...defaultRolePermissionMap };
  for (const role of await db.organizationRosterRole.findMany({ where: { organizationId: scope.organizationId }, select: { id: true, permissions: true } })) permissions[role.id] = { ...(permissions[role.id] ?? {}), ...normalizeRolePermissions(role.permissions) };
  if (!roleCanPerformAction(member.role, "settings", "edit", permissions)) throw new Error("当前账号没有管理 Amazon Ads 授权的权限。");
}

export async function startAmazonAdsOAuth(scope: AdsAuthScope, actor: string, region: AdsRegion) {
  if (!regions.includes(region)) throw new Error("Amazon Ads 登录区域无效。");
  await assertAdsSettingsManager(scope, actor);
  const settings = oauthSettings();
  const state = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await assertAdsSettingsManager(scope, actor, tx);
    await tx.amazonAdsOAuthAttempt.updateMany({ where: { ...scope, userId: actor, status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
    await tx.amazonAdsOAuthAttempt.create({ data: { id, ...scope, userId: actor, region, stateHash: stateHash(state), redirectUri: settings.redirectUri, expiresAt: new Date(now.getTime() + 10 * 60_000) } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.ads.oauth.started", entityType: "AmazonAdsOAuthAttempt", entityId: id, metadata: { workspaceId: scope.workspaceId } } });
  });
  const consent = new URL(lwaConsentHosts[region]);
  consent.search = new URLSearchParams({ client_id: settings.clientId, scope: "advertising::campaign_management", response_type: "code", redirect_uri: settings.redirectUri, state }).toString();
  return { consentUrl: consent.toString(), expiresInSeconds: 600 };
}

function normalizedProfile(profile: AmazonAdsProfilePayload, region: AdsRegion) {
  return {
    id: randomUUID(), region, profileId: String(profile.profileId), countryCode: profile.countryCode,
    marketplaceId: profile.accountInfo?.marketplaceStringId ?? null,
    currencyCode: profile.currencyCode ?? null, timezone: profile.timezone ?? null,
    accountInfo: (profile.accountInfo ?? {}) as Prisma.InputJsonObject,
  };
}

export async function finishAmazonAdsOAuth(input: { scope: AdsAuthScope; actor: string; params: URLSearchParams; transport?: AmazonAdsOAuthTransport }) {
  await assertAdsSettingsManager(input.scope, input.actor);
  const state = input.params.get("state") ?? "";
  const attempt = state ? await prisma.amazonAdsOAuthAttempt.findUnique({ where: { stateHash: stateHash(state) } }) : null;
  const now = new Date();
  if (!attempt || attempt.userId !== input.actor || attempt.organizationId !== input.scope.organizationId || attempt.workspaceId !== input.scope.workspaceId || attempt.status !== "PENDING" || attempt.expiresAt <= now) throw new Error("Amazon Ads 授权会话无效或已过期。");
  if (input.params.has("error")) {
    await prisma.amazonAdsOAuthAttempt.updateMany({ where: { id: attempt.id, status: "PENDING" }, data: { status: "FAILED" } });
    throw new Error("Amazon Ads 授权未完成。请在 Amazon 授权页面确认访问权限后重试。");
  }
  const code = input.params.get("code") ?? "";
  if (!code || code.length > 4096) throw new Error("Amazon Ads 授权响应无效。");
  const settings = oauthSettings();
  if (settings.redirectUri !== attempt.redirectUri) throw new Error("Amazon Ads OAuth 配置已变化，请重新开始授权。");
  const claimed = await prisma.amazonAdsOAuthAttempt.updateMany({ where: { id: attempt.id, status: "PENDING", expiresAt: { gt: now } }, data: { status: "EXCHANGING" } });
  if (!claimed.count) throw new Error("Amazon Ads 授权会话已被处理或已过期。");

  try {
    const transport = input.transport ?? createAmazonAdsOAuthTransport();
    const consentRegion = attempt.region as AdsRegion;
    if (!regions.includes(consentRegion)) throw new Error("Amazon Ads OAuth region is invalid.");
    const tokens = await transport.exchangeAuthorizationCode({ region: consentRegion, code, redirectUri: settings.redirectUri, clientId: settings.clientId, clientSecret: settings.clientSecret });
    const discovered: Array<ReturnType<typeof normalizedProfile>> = [];
    const successfulRegions: AdsRegion[] = [];
    for (const region of regions) {
      try {
        const profiles = await transport.listProfiles({ region, clientId: settings.clientId, accessToken: tokens.accessToken });
        successfulRegions.push(region);
        discovered.push(...profiles.map((profile) => normalizedProfile(profile, region)));
      } catch {
        // Keep profiles from healthy regions; a regional outage must not erase that region's prior rows.
      }
    }
    if (!successfulRegions.length) throw new Error("Amazon Ads Profile discovery was unavailable in all regions.");

    return await prisma.$transaction(async (tx) => {
      await assertAdsSettingsManager(input.scope, input.actor, tx);
      const attemptNow = await tx.amazonAdsOAuthAttempt.findFirst({ where: { id: attempt.id, ...input.scope, userId: input.actor, status: "EXCHANGING", expiresAt: { gt: new Date() } }, select: { id: true } });
      if (!attemptNow) throw new Error("Amazon Ads 授权会话已过期。");

      const priorProfiles = discovered.length ? await tx.amazonAdsProfile.findMany({ where: { ...input.scope, profileId: { in: discovered.map((profile) => profile.profileId) } }, select: { authorizationId: true }, take: 501 }) : [];
      if (priorProfiles.length > 500) throw new Error("Amazon Ads Profile 范围超过安全上限。");
      const priorAuthorizationIds = [...new Set(priorProfiles.map((profile) => profile.authorizationId))];
      if (priorAuthorizationIds.length > 1) throw new Error("多个既有 Amazon Ads 授权包含相同 Profile，请先完成账户归属核对。");
      const prior = priorAuthorizationIds.length ? await tx.amazonAdsAuthorization.findFirst({ where: { ...input.scope, id: priorAuthorizationIds[0] } }) : null;
      const authorizationId = prior?.id ?? randomUUID();
      const credentialsCiphertext = encryptAmazonAdsRefreshToken(tokens.refreshToken, { ...input.scope, authorizationId });
      const accountName = discovered.map((profile) => (profile.accountInfo as Record<string, unknown>).name).find((name): name is string => typeof name === "string" && Boolean(name.trim()));
      const displayName = accountName ?? prior?.name ?? "Amazon Ads 授权";
      const authData = { name: displayName, credentialsCiphertext, consentRegion, status: discovered.length ? "CONNECTED" : "NO_PROFILES", revision: { increment: 1 }, authorizedByUserId: input.actor, refreshTokenExpiresAt: new Date(Date.now() + 365 * 86400_000), lastValidatedAt: new Date(), validationErrorCode: null };
      if (prior) await tx.amazonAdsAuthorization.update({ where: { id: prior.id }, data: authData });
      else await tx.amazonAdsAuthorization.create({ data: { ...input.scope, id: authorizationId, name: displayName, credentialsCiphertext, consentRegion, status: discovered.length ? "CONNECTED" : "NO_PROFILES", authorizedByUserId: input.actor, refreshTokenExpiresAt: new Date(Date.now() + 365 * 86400_000), lastValidatedAt: new Date() } });

      for (const profile of discovered) {
        const key = { organizationId_workspaceId_authorizationId_region_profileId: { ...input.scope, authorizationId, region: profile.region, profileId: profile.profileId } };
        const saved = await tx.amazonAdsProfile.upsert({ where: key, create: { ...input.scope, ...profile, authorizationId }, update: { countryCode: profile.countryCode, marketplaceId: profile.marketplaceId, currencyCode: profile.currencyCode, timezone: profile.timezone, accountInfo: profile.accountInfo, lastDiscoveredAt: new Date() } });
        await ensureAdsPlan(tx, input.scope, saved.id, input.actor);
      }
      const existingProfiles = await tx.amazonAdsProfile.findMany({ where: { ...input.scope, authorizationId, region: { in: successfulRegions } }, select: { id: true, region: true, profileId: true } });
      const missingProfileIds = missingAmazonAdsProfileIds(existingProfiles, discovered, successfulRegions);
      if (missingProfileIds.length) {
        const plans = await tx.amazonAdsSyncPlan.findMany({ where: { ...input.scope, profileId: { in: missingProfileIds } }, select: { id: true } });
        const planIds = plans.map((plan) => plan.id);
        if (planIds.length) {
          const finishedAt = new Date();
          await tx.amazonAdsSyncPlan.updateMany({ where: { ...input.scope, id: { in: planIds }, status: { not: "BLOCKED" } }, data: { status: "BLOCKED", revision: { increment: 1 }, lastErrorCode: "ADS_PROFILE_NOT_DISCOVERED" } });
          await tx.amazonAdsSyncTask.updateMany({
            where: { ...input.scope, planId: { in: planIds }, status: { in: ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"] } },
            data: { status: "CANCELLED", fenceVersion: { increment: 1 }, dispatchVersion: { increment: 1 }, errorCode: "ADS_PROFILE_NOT_DISCOVERED", errorMessage: "Profile 未在最近一次成功发现中返回；历史数据已保留，同步已停止。", finishedAt, leaseOwner: null, leaseExpiresAt: null },
          });
        }
      }
      await tx.amazonAdsOAuthAttempt.update({ where: { id: attempt.id }, data: { status: "COMPLETE" } });
      await tx.auditLog.create({ data: { organizationId: input.scope.organizationId, userId: input.actor, action: "amazon.ads.oauth.completed", entityType: "AmazonAdsAuthorization", entityId: authorizationId, metadata: { workspaceId: input.scope.workspaceId, profileCount: discovered.length, regions: successfulRegions } } });
      return { authorizationId, profileCount: discovered.length, regions: successfulRegions };
    });
  } catch {
    await prisma.amazonAdsOAuthAttempt.updateMany({ where: { id: attempt.id, status: "EXCHANGING" }, data: { status: "FAILED" } });
    throw new Error("Amazon Ads 授权或 Profile 发现失败。未向前端返回上游凭证或原始响应。");
  }
}

export async function listAmazonAdsProfiles(scope: AdsAuthScope) {
  return prisma.amazonAdsProfile.findMany({ where: scope, orderBy: [{ countryCode: "asc" }, { profileId: "asc" }], take: 1000,
    select: { id: true, authorizationId: true, region: true, profileId: true, countryCode: true, marketplaceId: true, currencyCode: true, timezone: true, accountInfo: true, sellerAccountId: true, lastDiscoveredAt: true, authorization: { select: { name: true, status: true, lastValidatedAt: true, refreshTokenExpiresAt: true } }, syncPlans: { take: 1, select: { id: true, status: true, nextRunAt: true, lastSuccessAt: true, lastErrorCode: true, tasks: { take: 1, orderBy: { createdAt: "desc" }, select: { status: true, stage: true, processedCount: true, errorCode: true } } } } } });
}

export async function bindAmazonAdsProfile(scope: AdsAuthScope, actor: string, profileId: string, sellerAccountId: string | null) {
  return prisma.$transaction(async (tx) => {
    await assertAdsSettingsManager(scope, actor, tx);
    const profile = await tx.amazonAdsProfile.findFirst({ where: { ...scope, profileId }, select: { id: true, countryCode: true, marketplaceId: true, sellerAccountId: true } });
    if (!profile) throw new Error("Amazon Ads Profile 不存在。");
    if (sellerAccountId) {
      const seller = await tx.sellerAccount.findFirst({ where: { ...scope, id: sellerAccountId, status: "active" }, select: { id: true, marketplaceCode: true } });
      if (!seller) throw new Error("ERP 店铺不存在或已停用。");
      const sellerCountry = seller.marketplaceCode.trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(sellerCountry) && sellerCountry !== profile.countryCode && sellerCountry !== profile.marketplaceId) throw new Error("ERP 店铺 Marketplace 与 Ads Profile 不匹配。");
    }
    const updated = await tx.amazonAdsProfile.update({ where: { id: profile.id }, data: { sellerAccountId } });
    await ensureAdsPlan(tx, scope, updated.id, actor);
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.ads.profile.binding.changed", entityType: "AmazonAdsProfile", entityId: profile.id, metadata: { workspaceId: scope.workspaceId, profileId, sellerAccountId, previousSellerAccountId: profile.sellerAccountId } } });
    return updated;
  });
}
