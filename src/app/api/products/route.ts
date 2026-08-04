import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import type { Product } from "@/lib/products/types";

export const runtime = "nodejs";

function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== "object") return false;

  const product = value as Partial<Product>;
  return Boolean(product.id && product.sku && typeof product.chineseName === "string");
}

function normalizeProduct(product: Product): Product {
  return {
    ...product,
    id: product.id || `prod-${product.sku}`,
    sku: product.sku.trim(),
    competitorAsins: Array.isArray(product.competitorAsins) ? product.competitorAsins : [],
    images: Array.isArray(product.images) ? product.images : [],
  };
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const records = await prisma.productRecord.findMany({
      where: {
        organizationId: user.organizationId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return NextResponse.json({
      products: records.map((record) => record.payload),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load products.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json()) as { product?: unknown };

    if (!isProduct(body.product)) {
      return NextResponse.json({ error: "Invalid product payload." }, { status: 400 });
    }

    const product = normalizeProduct(body.product);

    await prisma.productRecord.upsert({
      where: {
        organizationId_sku: {
          organizationId: user.organizationId,
          sku: product.sku,
        },
      },
      create: {
        id: product.id,
        organizationId: user.organizationId,
        userId: user.id,
        sku: product.sku,
        payload: product as unknown as Prisma.InputJsonValue,
      },
      update: {
        userId: user.id,
        payload: product as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ product });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save product.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
