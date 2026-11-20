import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { resolveSellfoxVisibleStoreIds } from "@/lib/sellfox/store-access";
import { readDimensionAnalysis } from "@/lib/sellfox/dimension-analysis";
import {
  normalizeSellfoxCacheQuery, overviewStoreScopeParts, readThroughSellfox, sellfoxCacheKey,
} from "@/lib/sellfox/result-cache";

export const runtime = "nodejs";

/** 维度名单对 ProductDaily 快照写入最敏感，复用 performance 版本源。 */
async function dimensionsVersion(organizationId: string, workspaceId: string): Promise<string> {
  try {
    const rows = await prisma.$queryRaw<Array<{ v: Date | string | null }>>(Prisma.sql`
      SELECT max("syncedAt") AS v FROM "SellfoxProductDailySnapshot"
      WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}`);
    const value = rows[0]?.v;
    return value ? new Date(value).toISOString() : "__empty__";
  } catch { return "__empty__"; }
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view", request);
    if (!permission.ok) return permission.response;
    const scope = workspaceScopeFromRequest(request);
    const common = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };

    // 与主工作台 / overview 同源的店铺级数据权限，三态互不串数据。
    const authorizedStoreIds = await resolveSellfoxVisibleStoreIds(
      { id: permission.user.id, role: permission.user.role },
      common,
    );
    const parts = overviewStoreScopeParts(authorizedStoreIds);
    const key = sellfoxCacheKey(
      common.organizationId, common.workspaceId, "dimensions",
      normalizeSellfoxCacheQuery({ storeIds: parts.storeKeyPart }),
    );

    const result = await readThroughSellfox(
      key, "dimensions",
      () => dimensionsVersion(common.organizationId, common.workspaceId),
      () => readDimensionAnalysis(common, authorizedStoreIds ?? undefined),
      { isEmpty: (body) => {
        const b = body as { coverage?: { stores?: number; people?: number } };
        return (b.coverage?.stores ?? 0) === 0 && (b.coverage?.people ?? 0) === 0;
      } },
    );
    return NextResponse.json({ ...result.body, cache: { status: result.cache, cachedAt: result.cachedAt } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error && error.name === "SellfoxBrowseError" ? error.message : "读取赛狐维度分析失败，请稍后重试。" },
      { status: 500 },
    );
  }
}
