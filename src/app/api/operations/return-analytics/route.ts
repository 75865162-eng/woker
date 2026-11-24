import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { readReturnAnalytics } from "@/lib/amazon-sync/return-analytics";
import type { SyncScope } from "@/lib/amazon-sync/policy";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireApiPermission("operations", "view", request);
  if (!auth.ok) return auth.response;
  try {
    const scope: SyncScope = {
      organizationId: auth.user.organizationId,
      workspaceId: workspaceScopeFromRequest(request).workspaceId,
    };
    const params = new URL(request.url).searchParams;
    const result = await readReturnAnalytics(scope, params, auth.user.id);
    return NextResponse.json({ ...result, source: "AmazonReturnRecord(single published report) × AmazonOrderItemRecord(same window)" }, { headers });
  } catch (error) {
    console.error("[operations.return-analytics]", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return NextResponse.json({ error: "退货归因报表暂不可用。" }, { status: 500, headers });
  }
}
