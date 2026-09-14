import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { getProductDetail } from "@/lib/products/product-detail-service";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const permission = await requireApiPermission("products", "view", request);
    if (!permission.ok) {
      return permission.response;
    }

    const { user } = permission;
    const { sku } = await params;
    const scope = workspaceScopeFromRequest(request);
    const detail = await getProductDetail({
      organizationId: user.organizationId,
      workspaceId: scope.workspaceId,
      sku: sku.trim(),
    });

    if (!detail) {
      return NextResponse.json({ error: "商品不存在。" }, { status: 404 });
    }

    return NextResponse.json(detail, {
      headers: {
        "Cache-Control": detail.projection.status !== "ready"
          ? "no-store"
          : "private, max-age=0, stale-while-revalidate=30",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load product detail.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
