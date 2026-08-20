import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getProductImageCopyGalleryMineImageUrls } from "@/lib/products/image-copy-gallery";
import { buildProductRecordIndex } from "@/lib/products/product-record-index";
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

function clampPageSize(value: string | null) {
  const pageSize = Number(value) || 100;
  return Math.min(Math.max(pageSize, 1), 500);
}

function payloadStringContains(path: string[], value: string): Prisma.ProductRecordWhereInput {
  return {
    payload: {
      path,
      string_contains: value,
      mode: "insensitive",
    },
  };
}

function payloadArrayContains(path: string[], value: string): Prisma.ProductRecordWhereInput {
  return {
    payload: {
      path,
      array_contains: value,
    },
  };
}

function hasVisibleImages(images: string[] | undefined) {
  return Array.isArray(images) && images.some((image) => image.trim());
}

function mergeGalleryImages(product: Product, galleryMineImages: string[]) {
  if (hasVisibleImages(product.images) || !galleryMineImages.length) {
    return product;
  }

  return {
    ...product,
    images: galleryMineImages,
  };
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission(request, "products", "view");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const url = new URL(request.url);
    const scope = workspaceScopeFromRequest(request);
    const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
    const pageSize = clampPageSize(url.searchParams.get("pageSize"));
    const search = url.searchParams.get("search")?.trim() || url.searchParams.get("keyword")?.trim();
    const source = url.searchParams.get("source")?.trim();
    const asin = url.searchParams.get("asin")?.trim();
    const supplierName = url.searchParams.get("supplierName")?.trim();
    const status = url.searchParams.get("status")?.trim();
    const opsAssignees = url.searchParams.getAll("opsAssignee").map((value) => value.trim()).filter(Boolean);
    const selectionOwners = url.searchParams.getAll("selectionOwner").map((value) => value.trim()).filter(Boolean);
    const designerAssignees = url.searchParams.getAll("designerAssignee").map((value) => value.trim()).filter(Boolean);
    const minPriceText = url.searchParams.get("minPrice")?.trim();
    const maxPriceText = url.searchParams.get("maxPrice")?.trim();
    const minPrice = Number(minPriceText);
    const maxPrice = Number(maxPriceText);
    const hasMinPrice = Boolean(minPriceText) && Number.isFinite(minPrice);
    const hasMaxPrice = Boolean(maxPriceText) && Number.isFinite(maxPrice);
    const directStatus = status && !["all", "overdue", "operations_progress"].includes(status) ? status : "";
    const andFilters: Prisma.ProductRecordWhereInput[] = [];

    if (source === "sellfox") {
      andFilters.push({
        OR: [
          { id: { startsWith: "sellfox-", mode: "insensitive" } },
          payloadStringContains(["note"], "赛狐在线产品 API"),
        ],
      });
    }

    if (search) {
      andFilters.push({
        OR: [
          { sku: { contains: search, mode: "insensitive" } },
          { id: { contains: search, mode: "insensitive" } },
          { chineseName: { contains: search, mode: "insensitive" } },
          { englishName: { contains: search, mode: "insensitive" } },
          payloadStringContains(["keywords"], search),
          payloadStringContains(["note"], search),
        ],
      });
    }

    if (asin) {
      andFilters.push({
        OR: [
          { asin: { contains: asin, mode: "insensitive" } },
          payloadArrayContains(["competitorAsins"], asin),
        ],
      });
    }

    if (supplierName) {
      andFilters.push({ supplierName: { contains: supplierName, mode: "insensitive" } });
    }

    if (directStatus) {
      andFilters.push({ status: directStatus });
    }

    if (status === "operations_progress") {
      andFilters.push({ operationsProgressIncomplete: true });
    }

    if (status === "overdue") {
      andFilters.push({
        workflowDueAt: { lt: new Date() },
        NOT: [{ workflowStage: "done" }, { workflowStage: "blocked" }],
      });
    }

    if (opsAssignees.length) {
      andFilters.push({
        OR: opsAssignees.map((name) => ({ opsAssignee: { contains: name, mode: "insensitive" } })),
      });
    }

    if (selectionOwners.length) {
      andFilters.push({
        OR: selectionOwners.map((name) => ({ selectionOwner: { contains: name, mode: "insensitive" } })),
      });
    }

    if (designerAssignees.length) {
      andFilters.push({
        OR: designerAssignees.map((name) => ({ designerAssignee: { contains: name, mode: "insensitive" } })),
      });
    }

    if (hasMinPrice || hasMaxPrice) {
      andFilters.push({
        purchasePrice: {
          ...(hasMinPrice ? { gte: minPrice } : {}),
          ...(hasMaxPrice ? { lte: maxPrice } : {}),
        },
      });
    }

    const where: Prisma.ProductRecordWhereInput = {
      organizationId: user.organizationId,
      workspaceId: scope.workspaceId,
      ...(andFilters.length ? { AND: andFilters } : {}),
    };
    const [total, records] = await Promise.all([
      prisma.productRecord.count({ where }),
      prisma.productRecord.findMany({
        where: {
          ...where,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const skus = records.map((record) => record.sku);
    const galleryRecords = skus.length
      ? await prisma.productImageCopyGalleryRecord.findMany({
          where: {
            organizationId: user.organizationId,
            workspaceId: scope.workspaceId,
            sku: { in: skus },
          },
          select: {
            sku: true,
            payload: true,
          },
        })
      : [];
    const galleryMineImagesBySku = new Map(
      galleryRecords.map((record) => [
        record.sku,
        getProductImageCopyGalleryMineImageUrls(record.payload as Record<string, unknown> | null | undefined),
      ]),
    );

    return NextResponse.json({
      products: records.map((record) =>
        mergeGalleryImages(
          record.payload as unknown as Product,
          galleryMineImagesBySku.get(record.sku) ?? [],
        ),
      ),
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
    const permission = await requireApiPermission(request, "products", "edit");

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
    const productIndex = buildProductRecordIndex(product);

    await prisma.productRecord.upsert({
      where: {
        organizationId_workspaceId_sku: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          sku: product.sku,
        },
      },
      create: {
        id: randomUUID(),
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        sku: product.sku,
        ...productIndex,
        payload: product as unknown as Prisma.InputJsonValue,
      },
      update: {
        userId: user.id,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        ...productIndex,
        payload: product as unknown as Prisma.InputJsonValue,
      },
    });
    await recordDataChangeVersion({
      user,
      entityType: "product",
      entityId: product.sku,
      action: "product_save",
      summary: `${product.sku} ${product.chineseName}`,
      payload: product as unknown as Prisma.InputJsonValue,
      scope,
    });

    return NextResponse.json({ product });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save product.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
