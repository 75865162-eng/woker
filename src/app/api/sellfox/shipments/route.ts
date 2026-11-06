import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { SellfoxBrowseError, sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import { sellfoxBrowseStoreIds } from "@/lib/sellfox/browse-store-scope";
import { readSellfoxShipments } from "@/lib/sellfox/shipments-read";
import { aliasSellfoxReplicaParams } from "@/lib/sellfox/replica-query";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view", request);
    if (!permission.ok) return permission.response;
    const scope = workspaceScopeFromRequest(request);
    const query = sellfoxBrowseQuery(aliasSellfoxReplicaParams(new URL(request.url)));
    const storeIds = await sellfoxBrowseStoreIds(query, permission.user.organizationId, scope.workspaceId);
    return NextResponse.json(await readSellfoxShipments(query, { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId }, storeIds));
  } catch (error) {
    return NextResponse.json({ error: error instanceof SellfoxBrowseError ? error.message : "读取赛狐货件失败，请稍后重试。" }, { status: error instanceof SellfoxBrowseError ? error.status : 500 });
  }
}
