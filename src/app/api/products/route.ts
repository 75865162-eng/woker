import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";
import { prisma } from "@/lib/db/prisma";
import type { Product } from "@/lib/products/types";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

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

function requiresConclusionExcel(product: Product) {
  return product.status === "canceled" || product.status === "listed";
}

function clampPageSize(value: string | null) {
  const pageSize = Number(value) || 50;
  return Math.min(Math.max(pageSize, 1), 200);
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("products", "view", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const url = new URL(request.url);
    const scope = workspaceScopeFromRequest(request);
    const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
    const pageSize = clampPageSize(url.searchParams.get("pageSize"));
    const search = url.searchParams.get("search")?.trim();
    const where: Prisma.ProductRecordWhereInput = {
      organizationId: user.organizationId,
      workspaceId: scope.workspaceId,
      ...(search
        ? {
            OR: [
              { sku: { contains: search, mode: "insensitive" } },
              { id: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    let total = 0;
    let records: Array<{ payload: Prisma.JsonValue }> = [];

    try {
      [total, records] = await Promise.all([
        prisma.productRecord.count({ where }),
        prisma.productRecord.findMany({
          where,
          orderBy: {
            updatedAt: "desc",
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
    } catch (error) {
      if (!isDatabaseUnavailableError(error)) {
        throw error;
      }

      return NextResponse.json(
        {
          products: [],
          pagination: {
            page,
            pageSize,
            total: 0,
            pageCount: 1,
          },
          error: "数据库暂时不可用，商品列表已切换为空数据。",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      products: records.map((record) => record.payload as unknown as Product),
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load products.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("products", "edit", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as { product?: unknown; workspaceId?: unknown; accountId?: unknown; marketplace?: unknown };

    if (!isProduct(body.product)) {
      return NextResponse.json({ error: "Invalid product payload." }, { status: 400 });
    }

    const product = normalizeProduct(body.product);
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const existingRecord = await prisma.productRecord.findUnique({
      where: {
        organizationId_workspaceId_sku: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          sku: product.sku,
        },
      },
    });
    const existingProduct = existingRecord?.payload as Partial<Product> | undefined;
    const productToSave: Product = {
      ...product,
      videoPlan: product.videoPlan ?? existingProduct?.videoPlan,
    };

    if (requiresConclusionExcel(productToSave) && !productToSave.conclusionExcelFile?.id) {
      return NextResponse.json({ error: "状态为已取消或已上架时，请先上传结论 Excel 表。" }, { status: 400 });
    }

    await prisma.productRecord.upsert({
      where: {
        organizationId_workspaceId_sku: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          sku: productToSave.sku,
        },
      },
      create: {
        id: productToSave.id,
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        sku: productToSave.sku,
        payload: productToSave as unknown as Prisma.InputJsonValue,
      },
      update: {
        userId: user.id,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        payload: productToSave as unknown as Prisma.InputJsonValue,
      },
    });
    await recordDataChangeVersion({
      user,
      entityType: "product",
      entityId: productToSave.sku,
      action: "product_save",
      summary: `${productToSave.sku} ${productToSave.chineseName}`,
      payload: productToSave as unknown as Prisma.InputJsonValue,
      scope,
    });

    return NextResponse.json({ product: productToSave });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save product.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
