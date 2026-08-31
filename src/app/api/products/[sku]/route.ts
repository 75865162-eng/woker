import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import type { Product } from "@/lib/products/types";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function normalizeSku(sku: string) {
  return sku.trim().toUpperCase();
}

export async function GET(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const permission = await requireApiPermission("products", "view", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const { sku } = await params;
    const scope = workspaceScopeFromRequest(request);
    const record = await prisma.productRecord.findUnique({
      where: {
        organizationId_workspaceId_sku: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          sku: normalizeSku(sku),
        },
      },
      select: {
        payload: true,
      },
    });

    if (!record) {
      return NextResponse.json({ error: "商品不存在。" }, { status: 404 });
    }

    return NextResponse.json({ product: record.payload as unknown as Product });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load product.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
