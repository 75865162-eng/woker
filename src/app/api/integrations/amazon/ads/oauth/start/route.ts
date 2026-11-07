import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { startAmazonAdsOAuth } from "@/lib/amazon-ads/authorization";
import type { AdsRegion } from "@/lib/amazon-ads/oauth-contract";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const permission = await requireApiPermission("settings", "edit", request);
  if (!permission.ok) return NextResponse.json({ error: "Forbidden." }, { status: permission.response.status, headers: { "Cache-Control": "no-store" } });
  try {
    const body = await boundedJsonObject(request, 1024);
    if (typeof body.region !== "string") return NextResponse.json({ error: "请选择 Amazon Ads 登录区域。" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    return NextResponse.json(await startAmazonAdsOAuth(scope, permission.user.id, body.region as AdsRegion), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法开始 Amazon Ads 授权。" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
