import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import type { Product } from "@/lib/products/types";
import {
  normalizeProductVideoPlan,
  type ProductVideoPlanDraft,
} from "@/lib/products/video-plan";
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
    });
    const product = record?.payload as Partial<Product> | null;

    return NextResponse.json({
      videoPlan: normalizeProductVideoPlan(product?.videoPlan as Partial<ProductVideoPlanDraft> | null),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load product video plan.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const permission = await requireApiPermission("products", "edit", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const { sku } = await params;
    const normalizedSku = normalizeSku(sku);
    const body = (await request.json()) as { videoPlan?: Partial<ProductVideoPlanDraft>; workspaceId?: unknown; accountId?: unknown; marketplace?: unknown };
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const record = await prisma.productRecord.findUnique({
      where: {
        organizationId_workspaceId_sku: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          sku: normalizedSku,
        },
      },
    });

    if (!record) {
      return NextResponse.json({ error: "商品不存在，无法保存视频策划。" }, { status: 404 });
    }

    const product = record.payload as Partial<Product>;
    const videoPlan = normalizeProductVideoPlan(body.videoPlan);

    await prisma.productRecord.update({
      where: {
        organizationId_workspaceId_sku: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          sku: normalizedSku,
        },
      },
      data: {
        userId: user.id,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        payload: {
          ...product,
          videoPlan,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ videoPlan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save product video plan.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
