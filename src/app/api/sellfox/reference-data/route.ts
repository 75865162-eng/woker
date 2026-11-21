import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { resolveSellfoxVisibleStoreIds } from "@/lib/sellfox/store-access";
import {
  normalizeSellfoxCacheQuery, overviewStoreScopeParts, readThroughSellfox, sellfoxCacheKey,
} from "@/lib/sellfox/result-cache";
import { readSellfoxReferenceData, sellfoxReferenceVersion } from "@/lib/sellfox/reference-data";

export const runtime = "nodejs";

/**
 * 赛狐引用数据独立接口（店铺 / 站点 / 业务员）。
 * 权限三态、租户隔离、缓存分键全部复用 overview 的成熟链路，绝不绕过。
 */
export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view", request);
    if (!permission.ok) return permission.response;

    const scope = workspaceScopeFromRequest(request);
    const where = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };
    const authorizedStoreIds = await resolveSellfoxVisibleStoreIds(
      { id: permission.user.id, role: permission.user.role },
      where,
    );
    const parts = overviewStoreScopeParts(authorizedStoreIds);
    const visibleStoreIds = parts.restrict
      ? (authorizedStoreIds?.length ? authorizedStoreIds : [])
      : undefined;

    // 引用数据不随账号/站点筛选变化，只随可见店铺集合变化；scopeKey 纳入三态分片。
    const scopeKey = normalizeSellfoxCacheQuery({
      organizationId: where.organizationId,
      workspaceId: where.workspaceId,
      storeIds: parts.storeKeyPart,
    });
    const key = sellfoxCacheKey(where.organizationId, where.workspaceId, "reference", scopeKey);

    const result = await readThroughSellfox(
      key, "reference",
      () => sellfoxReferenceVersion(where, visibleStoreIds),
      () => readSellfoxReferenceData(where, visibleStoreIds),
      { isEmpty: (body) => (body as { stores?: unknown[] }).stores?.length === 0 },
    );
    return NextResponse.json({ ...result.body, cache: { status: result.cache, cachedAt: result.cachedAt } });
  } catch {
    return NextResponse.json({ error: "读取赛狐引用数据失败，请稍后重试。" }, { status: 500 });
  }
}
