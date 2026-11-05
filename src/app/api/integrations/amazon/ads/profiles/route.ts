import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { prisma } from "@/lib/db/prisma";
import { bindAmazonAdsProfile, listAmazonAdsProfiles } from "@/lib/amazon-ads/authorization";
import { hasAmazonAdsEncryptionKey } from "@/lib/amazon-ads/credentials";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import { adsReadAdapterReady } from "@/lib/amazon-ads/sync-adapter";
import { adsScopeEnabled } from "@/lib/amazon-ads/sync-policy";
export const runtime = "nodejs";
const jsonHeaders = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const permission = await requireApiPermission("settings", "view", request);
  if (!permission.ok) return NextResponse.json({ error: "Forbidden." }, { status: permission.response.status, headers: jsonHeaders });
  const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
  const [profiles, sellers] = await Promise.all([
    listAmazonAdsProfiles(scope),
    prisma.sellerAccount.findMany({ where: { ...scope, status: "active" }, select: { id: true, displayName: true, marketplaceCode: true }, orderBy: { displayName: "asc" }, take: 500 }),
  ]);
  await auditAmazonDataRead(scope, permission.user.id, "amazon-ads-profiles", permission.user.role);
  return NextResponse.json({ profiles, sellers, oauthConfigured: Boolean(process.env.AMAZON_ADS_LWA_CLIENT_ID?.trim() && process.env.AMAZON_ADS_LWA_CLIENT_SECRET?.trim() && process.env.AMAZON_ADS_OAUTH_REDIRECT_URI?.trim() && hasAmazonAdsEncryptionKey()), autoSyncConfigured: adsScopeEnabled(scope) && adsReadAdapterReady() }, { headers: jsonHeaders });
}

export async function POST(request: Request) {
  const permission = await requireApiPermission("settings", "edit", request);
  if (!permission.ok) return NextResponse.json({ error: "Forbidden." }, { status: permission.response.status, headers: jsonHeaders });
  try {
    const body = await boundedJsonObject(request, 2048);
    if (!body || typeof body.profileId !== "string" || body.profileId.length > 30 || (body.sellerAccountId !== null && typeof body.sellerAccountId !== "string")) return NextResponse.json({ error: "绑定参数无效。" }, { status: 400, headers: jsonHeaders });
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request, body).workspaceId };
    await bindAmazonAdsProfile(scope, permission.user.id, body.profileId, body.sellerAccountId as string | null);
    return NextResponse.json({ ok: true }, { headers: jsonHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法绑定 Amazon Ads Profile。" }, { status: 400, headers: jsonHeaders });
  }
}
