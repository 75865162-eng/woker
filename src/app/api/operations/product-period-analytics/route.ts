import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { readProductPeriodAnalytics } from "@/lib/amazon-sync/product-period-analytics";
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
    const result = await readProductPeriodAnalytics(scope, params, auth.user.id);
    return NextResponse.json({ ...result, source: "AmazonSalesTrafficProductSnapshot(last 90d product-day)" }, { headers });
  } catch (error) {
    console.error("[operations.product-period-analytics]", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return NextResponse.json({ error: "商品多周期销量宽表暂不可用。" }, { status: 500, headers });
  }
}
