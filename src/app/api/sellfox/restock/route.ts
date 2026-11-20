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
    // 默认读最近一期已对账物化快照（补货建议按日/每3h同步，无需秒级实时）；
    // 冷加载从全量重算 13s 降到 <0.5s。快照缺失/异常时数据层透明回退 live。
    // 显式 source=live 可强制走实时全量重算（对账/排障用）。
    const sourceMode = url.searchParams.get("source") === "live" ? "live" : "materialized";
    return NextResponse.json(await readSellfoxRestockCached(query, { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId }, storeIds, sellfoxDateAt(new Date()), sourceMode));
  } catch (error) {
    return NextResponse.json({ error: error instanceof SellfoxBrowseError ? error.message : "读取补货建议失败，请稍后重试。" }, { status: error instanceof SellfoxBrowseError ? error.status : 500 });
  }
}
