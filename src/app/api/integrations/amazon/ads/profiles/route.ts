import { amazonCloudExecutionEnabled } from "@/lib/amazon/execution-role";
import { cloudRelayConfigured } from "@/lib/amazon-sync/cloud-relay";
import { assertAmazonAction } from "@/lib/amazon-sync/data-access";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { prisma } from "@/lib/db/prisma";
import { bindAmazonAdsProfile, disconnectAmazonAdsAuthorization, listAmazonAdsProfiles } from "@/lib/amazon-ads/authorization";
import { hasAmazonAdsEncryptionKey } from "@/lib/amazon-ads/credentials";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import { adsReadAdapterReady } from "@/lib/amazon-ads/sync-adapter";
import { adsScopeEnabled } from "@/lib/amazon-ads/sync-policy";
import { amazonDataAccess } from "@/lib/amazon-sync/data-access";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { buildAdsProfileWhere } from "@/lib/amazon-ads/query-service";
export const runtime = "nodejs";
const jsonHeaders = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const permission = await requireApiPermission("settings", "view", request);
  if (!permission.ok) return NextResponse.json({ error: "Forbidden." }, { status: permission.response.status, headers: jsonHeaders });
  const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
  try {
    const access = await amazonDataAccess(scope, permission.user.id);
    const [profiles, sellers] = await Promise.all([
      listAmazonAdsProfiles(scope, buildAdsProfileWhere(scope, access, {})),
      prisma.sellerAccount.findMany({ where: { ...scope, status: "active", ...(access.allSellers ? {} : { id: { in: access.sellerIds } }) }, select: { id: true, displayName: true, marketplaceCode: true }, orderBy: { displayName: "asc" }, take: 500 }),
    ]);
    await auditAmazonDataRead(scope, permission.user.id, "amazon-ads-profiles", permission.user.role);
    let canImportReplica = false;
    if (!amazonCloudExecutionEnabled() && cloudRelayConfigured()) {
      try { await assertAmazonAction(scope, permission.user.id, "create"); canImportReplica = true; }
      catch (error) { if (!(error instanceof SyncInputError)) throw error; }
    }
    return NextResponse.json({ profiles, sellers, canImportReplica, oauthConfigured: Boolean(process.env.AMAZON_ADS_LWA_CLIENT_ID?.trim() && process.env.AMAZON_ADS_LWA_CLIENT_SECRET?.trim() && process.env.AMAZON_ADS_OAUTH_REDIRECT_URI?.trim() && hasAmazonAdsEncryptionKey()), autoSyncConfigured: adsScopeEnabled(scope) && adsReadAdapterReady() }, { headers: jsonHeaders });
  } catch (error) {
    if (error instanceof SyncInputError) return NextResponse.json({ error: error.message }, { status: error.status, headers: jsonHeaders });
    throw error;
  }
}

export async function POST(request: Request) {
  const permission = await requireApiPermission("settings", "edit", request);
  if (!permission.ok) return NextResponse.json({ error: "Forbidden." }, { status: permission.response.status, headers: jsonHeaders });
  try {
    const body = await boundedJsonObject(request, 2048);
    if (body.action === "disconnect" && typeof body.authorizationId === "string" && body.authorizationId.length <= 200) {
      const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request, body).workspaceId };
      return NextResponse.json(await disconnectAmazonAdsAuthorization(scope, permission.user.id, body.authorizationId), { headers: jsonHeaders });
    }
    if (!body || (typeof body.profileId !== "string" && typeof body.profileRecordId !== "string") || (typeof body.profileId === "string" && body.profileId.length > 30) || (typeof body.profileRecordId === "string" && body.profileRecordId.length > 200) || (body.sellerAccountId !== undefined && body.sellerAccountId !== null && typeof body.sellerAccountId !== "string") || (body.advertiserAccountId !== undefined && body.advertiserAccountId !== null && (typeof body.advertiserAccountId !== "string" || body.advertiserAccountId.length > 512))) return NextResponse.json({ error: "绑定参数无效。" }, { status: 400, headers: jsonHeaders });
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request, body).workspaceId };
    if (body.advertiserAccountId !== undefined && (typeof body.profileRecordId !== "string" || !body.profileRecordId || (body.expectedAdvertiserAccountId !== null && (typeof body.expectedAdvertiserAccountId !== "string" || body.expectedAdvertiserAccountId.length > 512)) || !Number.isSafeInteger(body.expectedAdvertiserAccountRevision) || Number(body.expectedAdvertiserAccountRevision) < 0)) return NextResponse.json({ error: "账户绑定需要内部 Profile ID 和当前绑定值。" }, { status: 400, headers: jsonHeaders });
    await bindAmazonAdsProfile(scope, permission.user.id, typeof body.profileId === "string" ? body.profileId : "", body.sellerAccountId as string | null | undefined, body.advertiserAccountId as string | null | undefined, typeof body.profileRecordId === "string" ? body.profileRecordId : undefined, body.expectedAdvertiserAccountId as string | null | undefined, body.expectedAdvertiserAccountRevision as number | undefined);
    return NextResponse.json({ ok: true }, { headers: jsonHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法绑定 Amazon Ads Profile。" }, { status: 400, headers: jsonHeaders });
  }
}
