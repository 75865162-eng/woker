import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { AdsQueryError, parseAdsQuery } from "@/lib/amazon-ads/query-contract";
import { queryAmazonAdsData } from "@/lib/amazon-ads/query-service";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const permission = await requireApiPermission("workspace", "view", request);
  if (!permission.ok) return NextResponse.json({ error: "Forbidden." }, { status: permission.response.status, headers });

  try {
    const params = new URL(request.url).searchParams;
    const scope = {
      organizationId: permission.user.organizationId,
      workspaceId: workspaceScopeFromRequest(request).workspaceId,
    };
    const input = parseAdsQuery(params);
    const result = await queryAmazonAdsData(scope, permission.user.id, input);
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof AdsQueryError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof SyncInputError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    return NextResponse.json({ error: "无法读取 Amazon Ads 数据。" }, { status: 500, headers });
  }
}
