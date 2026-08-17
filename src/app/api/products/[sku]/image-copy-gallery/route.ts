import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import {
  normalizeProductImageCopyGallery,
  type ProductImageCopyGalleryDraft,
} from "@/lib/products/image-copy-gallery";

export const runtime = "nodejs";

function normalizeSku(sku: string) {
  return sku.trim().toUpperCase();
}

export async function GET(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const permission = await requireApiPermission(request, "products", "view");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const { sku } = await params;
    const scope = workspaceScopeFromRequest(request);
    const normalizedSku = normalizeSku(sku);
    const record = await prisma.productImageCopyGalleryRecord.findUnique({
      where: {
        organizationId_workspaceId_sku: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          sku: normalizedSku,
        },
      },
    });

    return NextResponse.json({
      gallery: normalizeProductImageCopyGallery(record?.payload as Partial<ProductImageCopyGalleryDraft> | null, 3),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load image copy gallery.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const permission = await requireApiPermission(request, "products", "edit");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const { sku } = await params;
    const normalizedSku = normalizeSku(sku);
    const body = (await request.json()) as { gallery?: Partial<ProductImageCopyGalleryDraft>; workspaceId?: unknown; accountId?: unknown; marketplace?: unknown };
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const gallery = normalizeProductImageCopyGallery(body.gallery, 3);

    await prisma.productImageCopyGalleryRecord.upsert({
      where: {
        organizationId_workspaceId_sku: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          sku: normalizedSku,
        },
      },
      create: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        sku: normalizedSku,
        payload: gallery as unknown as Prisma.InputJsonValue,
      },
      update: {
        userId: user.id,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        payload: gallery as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ gallery });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save image copy gallery.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
