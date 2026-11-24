import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { readInventoryHealth } from "@/lib/amazon-sync/inventory-health";
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
    const result = await readInventoryHealth(scope, params, auth.user.id);
    return NextResponse.json({ ...result, source: "AmazonInventorySnapshot(latest per site+sku)" }, { headers });
  } catch (error) {
    console.error("[operations.inventory-health]", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return NextResponse.json({ error: "FBA 库存健康透视暂不可用。" }, { status: 500, headers });
  }
}
