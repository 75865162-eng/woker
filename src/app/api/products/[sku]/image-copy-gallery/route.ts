import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  normalizeProductImageCopyGallery,
  type ProductImageCopyGalleryDraft,
} from "@/lib/products/image-copy-gallery";

export const runtime = "nodejs";

function normalizeSku(sku: string) {
  return sku.trim().toUpperCase();
}

export async function GET(_request: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { sku } = await params;
    const normalizedSku = normalizeSku(sku);
    const record = await prisma.productImageCopyGalleryRecord.findUnique({
      where: {
        organizationId_sku: {
          organizationId: user.organizationId,
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
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { sku } = await params;
    const normalizedSku = normalizeSku(sku);
    const body = (await request.json()) as { gallery?: Partial<ProductImageCopyGalleryDraft> };
    const gallery = normalizeProductImageCopyGallery(body.gallery, 3);

    await prisma.productImageCopyGalleryRecord.upsert({
      where: {
        organizationId_sku: {
          organizationId: user.organizationId,
          sku: normalizedSku,
        },
      },
      create: {
        organizationId: user.organizationId,
        userId: user.id,
        sku: normalizedSku,
        payload: gallery as unknown as Prisma.InputJsonValue,
      },
      update: {
        userId: user.id,
        payload: gallery as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ gallery });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save image copy gallery.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
