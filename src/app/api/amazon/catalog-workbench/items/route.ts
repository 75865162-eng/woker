import { NextResponse } from "next/server";
import { requireAmazonReadSession } from "@/lib/auth/amazon-read-session";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { AmazonReadError } from "@/lib/amazon-sync/read-account";
import { readSellerCatalogItems } from "@/lib/amazon/catalog-workbench";

export const runtime = "nodejs";

/** 店铺下钻：该店铺已发布在线商品的 SKU 明细（标题/图片/刊登状态 + 关联库存 + 订单口径销量）。单账号读校验。 */
export async function GET(request: Request) {
  try {
    const permission = await requireAmazonReadSession(request);
    if (!permission.ok) return permission.response;
    const scope = workspaceScopeFromRequest(request);
    const params = new URL(request.url).searchParams;
    const sellerAccountId = params.get("sellerAccountId") ?? "";
    const marketplaceId = params.get("marketplaceId") ?? "";
    const tenantScope = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };
    await auditAmazonDataRead(tenantScope, permission.user.id, "catalog-workbench/items", permission.user.role);
    const body = await readSellerCatalogItems(tenantScope, permission.user.id, sellerAccountId, marketplaceId);
    return NextResponse.json({ ...body, cache: { status: "bypass", cachedAt: null } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SyncInputError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取店铺在线商品明细失败，请稍后重试。", ...(error instanceof AmazonReadError ? { code: error.businessCode } : {}) },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
