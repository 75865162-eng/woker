import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { WmsError } from "@/lib/wms/contracts";
import { readSettlementSkuPivot } from "@/lib/amazon-sync/settlement-sku-pivot";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireApiPermission("operations", "view", request);
  if (!auth.ok) return auth.response;
  try {
    const scope = { organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: auth.user.id };
    return NextResponse.json(await readSettlementSkuPivot(scope, new URL(request.url).searchParams), { headers });
  } catch (error) {
    if (error instanceof WmsError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    console.error("[operations.settlement-sku-pivot]", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return NextResponse.json({ error: "结算 SKU 透视暂不可用。" }, { status: 500, headers });
  }
}
