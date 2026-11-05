import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { finishAmazonAdsOAuth } from "@/lib/amazon-ads/authorization";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const permission = await requireApiPermission("settings", "edit", request);
  if (!permission.ok) return NextResponse.json({ error: "请使用发起授权的管理员账号登录后重试。" }, { status: 401, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  try {
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    await finishAmazonAdsOAuth({ scope, actor: permission.user.id, params: new URL(request.url).searchParams });
    return new Response(null, { status: 303, headers: { Location: "/amazon-ads/accounts", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Amazon Ads 授权失败。" }, { status: 400, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
}
