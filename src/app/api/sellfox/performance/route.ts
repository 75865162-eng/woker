import { readSellfoxWorkbench } from "@/lib/sellfox/workbench-read";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { sellfoxBrowseQuery, SellfoxBrowseError } from "@/lib/sellfox/browse-query";
import { sellfoxBrowseStoreIds } from "@/lib/sellfox/browse-store-scope";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view", request);
    if (!permission.ok) return permission.response;

    const scope = workspaceScopeFromRequest(request);
    const url = new URL(request.url);
    const query = sellfoxBrowseQuery(url, "performance");
    await sellfoxBrowseStoreIds(query, permission.user.organizationId, scope.workspaceId);
    return NextResponse.json(await readSellfoxWorkbench("performance", query, { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof SellfoxBrowseError ? error.message : "读取赛狐销售利润失败，请稍后重试。" }, { status: error instanceof SellfoxBrowseError ? error.status : 500 });
  }
}
