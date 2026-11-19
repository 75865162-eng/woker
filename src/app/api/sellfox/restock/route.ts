import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { SellfoxBrowseError, sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import { sellfoxBrowseStoreIds } from "@/lib/sellfox/browse-store-scope";
import { readSellfoxRestockCached } from "@/lib/sellfox/restock-read";
import { sellfoxDateAt } from "@/lib/sellfox/sync-contract";
import { aliasSellfoxReplicaParams } from "@/lib/sellfox/replica-query";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view", request);
    if (!permission.ok) return permission.response;
    const scope = workspaceScopeFromRequest(request);
    const url = aliasSellfoxReplicaParams(new URL(request.url));
    const query = sellfoxBrowseQuery(url);
    const storeIds = await sellfoxBrowseStoreIds(query, permission.user.organizationId, scope.workspaceId, { id: permission.user.id, role: permission.user.role });
    // source=materialized 是显式灰度开关；默认 live 完全保持既有行为。
    // 物化快照必须版本新鲜且经离线对账 0 差异才被读取，否则透明回退 live。
    const sourceMode = url.searchParams.get("source") === "materialized" ? "materialized" : "live";
    return NextResponse.json(await readSellfoxRestockCached(query, { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId }, storeIds, sellfoxDateAt(new Date()), sourceMode));
  } catch (error) {
    return NextResponse.json({ error: error instanceof SellfoxBrowseError ? error.message : "读取补货建议失败，请稍后重试。" }, { status: error instanceof SellfoxBrowseError ? error.status : 500 });
  }
}
