import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AmazonSpApiClient } from "@/lib/amazon/sp-api-client";
import { encryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";
import { assertAmazonAction, assertAmazonScopeAdmin } from "./data-access";
import { mcpTokenHash } from "./mcp";
import { endpoints, requiredText, SyncInputError, type SyncScope } from "./policy";
import { scopeLock } from "./service";
import { ensureAmazonSyncInitialized } from "./scheduler";

const consentHosts: Record<string, string> = { "us-east-1": "sellercentral.amazon.com", "eu-west-1": "sellercentral-europe.amazon.com", "us-west-2": "sellercentral.amazon.co.jp" };
function appSettings() {
  const applicationId = requiredText(process.env.AMAZON_SP_API_APPLICATION_ID, "Amazon application ID");
  const clientId = requiredText(process.env.AMAZON_SP_API_LWA_CLIENT_ID, "LWA client ID", 1000);
  const clientSecret = requiredText(process.env.AMAZON_SP_API_LWA_CLIENT_SECRET, "LWA client secret", 16384);
  const redirectUri = requiredText(process.env.AMAZON_SP_API_OAUTH_REDIRECT_URI, "OAuth redirect URI", 1000);
  const url = new URL(redirectUri);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== "/api/integrations/amazon/sp-api/oauth/callback") throw new SyncInputError("OAuth redirect URI 配置无效。", 503);
  return { applicationId, clientId, clientSecret, redirectUri };
}
async function assertManager(scope: SyncScope, actor: string, tx: Prisma.TransactionClient = prisma) {
  await assertAmazonScopeAdmin(scope, actor, tx); await assertAmazonAction(scope, actor, "edit", tx, "settings");
}
export async function startAmazonOAuth(scope: SyncScope, actor: string, region: string) {
  await assertManager(scope, actor);
  if (!consentHosts[region]) throw new SyncInputError("区域无效。");
  const settings = appSettings(), state = randomBytes(32).toString("base64url"), id = randomUUID();
  await prisma.$transaction(async tx => {
    await assertManager(scope, actor, tx);
    await tx.amazonOAuthAttempt.create({ data: { ...scope, id, userId: actor, stateHash: mcpTokenHash(state), region, redirectUri: settings.redirectUri, expiresAt: new Date(Date.now() + 10 * 60000) } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.oauth.started", entityType: "AmazonOAuthAttempt", entityId: id, metadata: { workspaceId: scope.workspaceId, region } } });
  });
  const url = new URL(`https://${consentHosts[region]}/apps/authorize/consent`);
  url.search = new URLSearchParams({ application_id: settings.applicationId, state, redirect_uri: settings.redirectUri }).toString();
  return { consentUrl: url.toString(), expiresInSeconds: 600 };
}

/** Seller ID is supplied by Amazon OAuth, then checked against a seller-scoped Listings
 * request. Sellers marketplaceParticipations alone is NEVER treated as Seller ID evidence. */
export async function finishAmazonOAuth(actor: string, params: URLSearchParams) {
  const state = requiredText(params.get("state"), "state", 200);
  const attempt = await prisma.amazonOAuthAttempt.findUnique({ where: { stateHash: mcpTokenHash(state) } });
  if (!attempt || attempt.userId !== actor || attempt.status !== "PENDING" || attempt.expiresAt <= new Date()) throw new SyncInputError("授权会话无效或已过期。", 403);
  const scope = { organizationId: attempt.organizationId, workspaceId: attempt.workspaceId };
  await assertManager(scope, actor);
  const settings = appSettings();
  if (attempt.redirectUri !== settings.redirectUri) throw new SyncInputError("授权配置已变化，请重新开始。", 409);
  const claimed = await prisma.amazonOAuthAttempt.updateMany({ where: { id: attempt.id, status: "PENDING", expiresAt: { gt: new Date() } }, data: { status: "EXCHANGING" } });
  if (!claimed.count) throw new SyncInputError("授权会话无效或已过期。", 403);
  try {
    const sellerId = requiredText(params.get("selling_partner_id"), "Amazon Seller ID", 32);
    if (!/^[A-Z0-9]{8,32}$/.test(sellerId) || params.has("error")) throw new SyncInputError("Amazon 未完成授权。", 409);
    const code = requiredText(params.get("spapi_oauth_code"), "OAuth code", 4096);
    const response = await fetch("https://api.amazon.com/auth/o2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: settings.redirectUri, client_id: settings.clientId, client_secret: settings.clientSecret }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new SyncInputError("Amazon 授权交换失败。", 409);
    const text = await response.text(); if (Buffer.byteLength(text) > 64000) throw new SyncInputError("Amazon 响应无效。", 409);
    const payload = JSON.parse(text) as Record<string, unknown>;
    const refreshToken = requiredText(payload.refresh_token, "refresh token", 16384);
    const credentials = { lwaClientId: settings.clientId, lwaClientSecret: settings.clientSecret, refreshToken, awsAccessKeyId: "", awsSecretAccessKey: "" };
    const client = new AmazonSpApiClient({ ...credentials, region: attempt.region, endpoint: endpoints[attempt.region] });
    const sites = extractMarketplaceParticipations(await client.getMarketplaceParticipations());
    if (!sites.length || sites.length > 30) throw new SyncInputError("Amazon 未返回可用站点。", 409);
    // A valid token plus an arbitrary typed Seller ID must not pass identity validation.
    for (const site of sites) {
      const listing = await client.searchListingsItems({ sellerId, marketplaceId: site.marketplaceId });
      if (!listing || typeof listing !== "object" || !Array.isArray((listing as { items?: unknown }).items)) throw new SyncInputError("无法验证卖家范围。", 409);
    }
    const completed = await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertManager(scope, actor, tx);
      if (!await tx.amazonOAuthAttempt.findFirst({ where: { id: attempt.id, status: "EXCHANGING", expiresAt: { gt: new Date() } }, select: { id: true } })) throw new SyncInputError("授权会话已过期。", 403);
      const existing = await tx.amazonSpApiAuthorization.findUnique({ where: { organizationId_workspaceId_amazonSellerId_awsRegion: { ...scope, amazonSellerId: sellerId, awsRegion: attempt.region } } });
      if (existing && !existing.identityVerifiedAt && await tx.amazonSyncRun.count({ where: { ...scope, source: { authorizationId: existing.id } } })) throw new SyncInputError("旧授权含待核查历史数据，须先完成归属核查。", 409);
      const id = existing?.id ?? randomUUID(), now = new Date();
      const data = { credentialsCiphertext: encryptAmazonSpApiCredentials(credentials, { ...scope, authorizationId: id }), status: "CONFIGURED", marketplaceParticipations: sites as Prisma.InputJsonValue, lastValidatedAt: now, identityVerifiedAt: now, identityEvidence: "OAUTH_SELLER_SCOPE_PROBE", authorizedByUserId: actor, updatedByUserId: actor };
      if (existing) await tx.amazonSpApiAuthorization.update({ where: { id, revision: existing.revision }, data: { ...data, revision: { increment: 1 } } });
      else await tx.amazonSpApiAuthorization.create({ data: { ...scope, id, name: `Amazon ${sellerId}`, amazonSellerId: sellerId, awsRegion: attempt.region, endpoint: endpoints[attempt.region], ...data } });
      await tx.amazonSellerIdentity.deleteMany({ where: { ...scope, authorizationId: id, marketplaceId: { notIn: sites.map(s => s.marketplaceId) } } });
      for (const site of sites) {
        const identity = await tx.amazonSellerIdentity.findUnique({ where: { organizationId_workspaceId_amazonSellerId_marketplaceId_region: { ...scope, amazonSellerId: sellerId, marketplaceId: site.marketplaceId, region: attempt.region } } });
        let sellerAccountId = identity?.sellerAccountId;
        if (identity && identity.authorizationId !== id) throw new SyncInputError("卖家身份绑定冲突。", 409);
        if (!sellerAccountId) {
          const oldSources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: id, marketplaceId: site.marketplaceId }, select: { sellerAccountId: true }, take: 201 });
          const sellerIds = [...new Set(oldSources.map(s => s.sellerAccountId))];
          if (sellerIds.length > 1) throw new SyncInputError("旧数据源身份映射冲突。", 409);
          sellerAccountId = sellerIds[0];
          if (sellerAccountId && await tx.amazonSyncDataSource.findFirst({ where: { ...scope, sellerAccountId, marketplaceId: site.marketplaceId, authorizationId: { not: id } }, select: { id: true } })) throw new SyncInputError("旧数据源身份映射冲突。", 409);
          if (!sellerAccountId) sellerAccountId = (await tx.sellerAccount.create({ data: { ...scope, id: randomUUID(), accountKey: `amazon:${sellerId}:${attempt.region}:${site.marketplaceId}`, displayName: `Amazon ${site.countryCode || site.marketplaceId} · ${sellerId}`, marketplaceCode: site.countryCode || site.marketplaceId } })).id;
          await tx.amazonSellerIdentity.create({ data: { ...scope, id: randomUUID(), sellerAccountId, amazonSellerId: sellerId, marketplaceId: site.marketplaceId, region: attempt.region, authorizationId: id, verifiedAt: now } });
        } else await tx.amazonSellerIdentity.update({ where: { id: identity!.id }, data: { verifiedAt: now } });
      }
      await tx.amazonOAuthAttempt.update({ where: { id: attempt.id, status: "EXCHANGING" }, data: { status: "COMPLETE" } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.oauth.completed", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, amazonSellerId: sellerId, marketplaceIds: sites.map(s => s.marketplaceId), identityEvidence: "OAUTH_SELLER_SCOPE_PROBE" } } });
      return { authorizationId: id, sellerId, marketplaces: sites.map(s => s.marketplaceId) };
    });
    let automaticSync: Awaited<ReturnType<typeof ensureAmazonSyncInitialized>>;
    try { automaticSync = await ensureAmazonSyncInitialized(scope, completed.authorizationId); }
    catch {
      console.error(`[amazon-sync-center] automatic initialization deferred for authorization ${completed.authorizationId}`);
      automaticSync = { status: "deferred", sourceCount: 0, planCount: 0, taskCount: 0 };
    }
    return { ...completed, automaticSync };
  } catch {
    await prisma.$transaction(async tx => {
      await tx.amazonOAuthAttempt.updateMany({ where: { id: attempt.id, status: "EXCHANGING" }, data: { status: "FAILED" } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.oauth.failed", entityType: "AmazonOAuthAttempt", entityId: attempt.id, metadata: { workspaceId: scope.workspaceId, reason: "AUTHORIZATION_NOT_COMMITTED" } } });
    });
    throw new SyncInputError("授权未完成；请检查应用授权范围，旧凭证和历史数据未被覆盖。", 409);
  }
}
