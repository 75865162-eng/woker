import { NextResponse } from "next/server";
import { requireAmazonReadSession } from "@/lib/auth/amazon-read-session";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { AmazonReadError } from "@/lib/amazon-sync/read-account";
import { readCatalogWorkbenchOverview } from "@/lib/amazon/catalog-workbench";

export const runtime = "nodejs";

/** 在线商品与库存分组概览：站点 / 店铺两级名单（可见店铺全集，与 /operations 读权限同源）。 */
export async function GET(request: Request) {
  try {
    const permission = await requireAmazonReadSession(request);
    if (!permission.ok) return permission.response;
    const scope = workspaceScopeFromRequest(request);
    const tenantScope = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };
    await auditAmazonDataRead(tenantScope, permission.user.id, "catalog-workbench", permission.user.role);
    const body = await readCatalogWorkbenchOverview(tenantScope, permission.user.id);
    return NextResponse.json({ ...body, cache: { status: "bypass", cachedAt: null } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SyncInputError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取在线商品分组失败，请稍后重试。", ...(error instanceof AmazonReadError ? { code: error.businessCode } : {}) },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
