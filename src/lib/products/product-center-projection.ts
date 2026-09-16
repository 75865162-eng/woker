import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Product, ProductFileAsset, ProductImageAsset } from "@/lib/products/types";
import {
  getProductRecordCurrentOwner,
  getProductRecordSource,
} from "@/lib/products/list-query";

type ProductCenterProjectionInput = {
  product: Product;
  organizationId: string;
  workspaceId: string;
  accountId: string;
  marketplace: string;
  sourceRevision: number;
  sourceUpdatedAt?: Date | null;
};

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha1").update(value).digest("hex").slice(0, 24)}`;
}

function normalizedSupplierName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function marketplaceCode(value: string) {
  return value.trim().toUpperCase();
}

function titleOf(product: Product) {
  return product.englishName.trim() || product.chineseName.trim();
}

export function createProductListingKey(input: {
  accountId: string;
  marketplace: string;
  sku: string;
}) {
  return [
    input.accountId.trim() || "default-account",
    marketplaceCode(input.marketplace) || "default-marketplace",
    input.sku,
  ].join(":");
}

function imageAssetToMedia(input: {
  asset: ProductImageAsset;
  productMasterId: string;
  productRecordId: string;
  organizationId: string;
  workspaceId: string;
  sourceRevision: number;
  sourceUpdatedAt?: Date | null;
  sortOrder: number;
}) {
  return {
    id: stableId("pm", `${input.productRecordId}:image:${input.asset.id}:${input.sortOrder}`),
    productMasterId: input.productMasterId,
    productRecordId: input.productRecordId,
    fileId: input.asset.id.startsWith("product-image-") ? null : input.asset.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    mediaType: "image" as const,
    role: input.sortOrder === 0 ? "main" : "gallery",
    url: input.asset.downloadUrl ?? input.asset.thumbUrl,
    thumbUrl: input.asset.thumbUrl,
    originalUrl: input.asset.originalUrl,
    fileName: input.asset.name,
    mimeType: input.asset.mimeType,
    size: input.asset.size,
    sortOrder: input.sortOrder,
    sourceRevision: input.sourceRevision,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
  };
}

function fileAssetToMedia(input: {
  asset: ProductFileAsset;
  role: string;
  productMasterId: string;
  productRecordId: string;
  organizationId: string;
  workspaceId: string;
  sourceRevision: number;
  sourceUpdatedAt?: Date | null;
  sortOrder: number;
}) {
  return {
    id: stableId("pm", `${input.productRecordId}:${input.role}:${input.asset.id}`),
    productMasterId: input.productMasterId,
    productRecordId: input.productRecordId,
    fileId: input.asset.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    mediaType: "workbook" as const,
    role: input.role,
    url: input.asset.downloadUrl,
    thumbUrl: "",
    originalUrl: input.asset.downloadUrl,
    fileName: input.asset.name,
    mimeType: input.asset.mimeType,
    size: input.asset.size,
    sortOrder: input.sortOrder,
    sourceRevision: input.sourceRevision,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
  };
}

export async function projectProductCenter(
  tx: Prisma.TransactionClient,
  input: ProductCenterProjectionInput,
) {
  const product = input.product;
  const sourceUpdatedAt = input.sourceUpdatedAt ?? null;
  const masterId = stableId("master", input.product.id);
  const variantId = stableId("variant", input.product.id);
  const marketplace = marketplaceCode(input.marketplace);
  const accountKey = input.accountId.trim();
  const currentMaster = await tx.productMaster.findUnique({
    where: { productRecordId: product.id },
    select: { sourceRevision: true },
  });

  if (currentMaster && currentMaster.sourceRevision > input.sourceRevision) {
    return { status: "skipped" as const, productMasterId: masterId, productVariantId: variantId };
  }

  const marketplaceRecord = marketplace
    ? await tx.marketplace.upsert({
        where: {
          organizationId_code: {
            organizationId: input.organizationId,
            code: marketplace,
          },
        },
        create: {
          organizationId: input.organizationId,
          code: marketplace,
          name: marketplace,
        },
        update: {
          name: marketplace,
          status: "active",
        },
      })
    : null;
  const sellerAccount = accountKey
    ? await tx.sellerAccount.upsert({
        where: {
          organizationId_workspaceId_accountKey_marketplaceCode: {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            accountKey,
            marketplaceCode: marketplace,
          },
        },
        create: {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          accountKey,
          displayName: accountKey,
          marketplaceCode: marketplace,
          marketplaceId: marketplaceRecord?.id,
        },
        update: {
          displayName: accountKey,
          marketplaceCode: marketplace,
          marketplaceId: marketplaceRecord?.id,
          status: "active",
        },
      })
    : null;

  await tx.productMaster.upsert({
    where: { productRecordId: product.id },
    create: {
      id: masterId,
      productRecordId: product.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      sku: product.sku,
      chineseName: product.chineseName,
      englishName: product.englishName,
      status: product.status,
      source: getProductRecordSource(),
      currentOwner: getProductRecordCurrentOwner(product),
      sourceRevision: input.sourceRevision,
      sourceUpdatedAt,
    },
    update: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      sku: product.sku,
      chineseName: product.chineseName,
      englishName: product.englishName,
      status: product.status,
      source: getProductRecordSource(),
      currentOwner: getProductRecordCurrentOwner(product),
      sourceRevision: input.sourceRevision,
      sourceUpdatedAt,
    },
  });

  await tx.productVariant.upsert({
    where: {
      organizationId_workspaceId_sku: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        sku: product.sku,
      },
    },
    create: {
      id: variantId,
      productMasterId: masterId,
      productRecordId: product.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      sku: product.sku,
      asin: product.asin,
      variantName: titleOf(product),
      attributes: {
        productSizeCm: product.productSizeCm,
        packageSizeCm: product.packageSizeCm,
        productWeightG: product.productWeightG,
        packageWeightG: product.packageWeightG,
      } as Prisma.InputJsonValue,
      status: product.status,
      sourceRevision: input.sourceRevision,
      sourceUpdatedAt,
    },
    update: {
      productMasterId: masterId,
      productRecordId: product.id,
      asin: product.asin,
      variantName: titleOf(product),
      attributes: {
        productSizeCm: product.productSizeCm,
        packageSizeCm: product.packageSizeCm,
        productWeightG: product.productWeightG,
        packageWeightG: product.packageWeightG,
      } as Prisma.InputJsonValue,
      status: product.status,
      sourceRevision: input.sourceRevision,
      sourceUpdatedAt,
    },
  });

  const listingKey = createProductListingKey({
    accountId: accountKey,
    marketplace,
    sku: product.sku,
  });
  await tx.productListing.deleteMany({
    where: {
      productRecordId: product.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      listingKey: { not: listingKey },
    },
  });
  await tx.productListing.upsert({
    where: {
      organizationId_workspaceId_listingKey: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        listingKey,
      },
    },
    create: {
      id: stableId("listing", `${input.organizationId}:${input.workspaceId}:${listingKey}`),
      productMasterId: masterId,
      productVariantId: variantId,
      productRecordId: product.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      sellerAccountId: sellerAccount?.id,
      marketplaceId: marketplaceRecord?.id,
      listingKey,
      sku: product.sku,
      asin: product.asin,
      listingStatus: product.status,
      title: titleOf(product),
      sourceRevision: input.sourceRevision,
      sourceUpdatedAt,
    },
    update: {
      productMasterId: masterId,
      productVariantId: variantId,
      productRecordId: product.id,
      sellerAccountId: sellerAccount?.id,
      marketplaceId: marketplaceRecord?.id,
      sku: product.sku,
      asin: product.asin,
      listingStatus: product.status,
      title: titleOf(product),
      sourceRevision: input.sourceRevision,
      sourceUpdatedAt,
    },
  });

  const currentSupplierId = product.supplierName.trim()
    ? stableId(
        "supplier",
        `${input.organizationId}:${normalizedSupplierName(product.supplierName)}`,
      )
    : null;
  await tx.productSupplier.deleteMany({
    where: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      productMasterId: masterId,
      ...(currentSupplierId ? { supplierId: { not: currentSupplierId } } : {}),
    },
  });

  if (product.supplierName.trim()) {
    const normalizedName = normalizedSupplierName(product.supplierName);
    const supplier = await tx.supplier.upsert({
      where: {
        organizationId_normalizedName: {
          organizationId: input.organizationId,
          normalizedName,
        },
      },
      create: {
        id: stableId("supplier", `${input.organizationId}:${normalizedName}`),
        organizationId: input.organizationId,
        name: product.supplierName.trim(),
        normalizedName,
        website: product.supplierUrl,
      },
      update: {
        name: product.supplierName.trim(),
        website: product.supplierUrl,
      },
    });

    await tx.productSupplier.upsert({
      where: {
        organizationId_workspaceId_productMasterId_supplierId: {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          productMasterId: masterId,
          supplierId: supplier.id,
        },
      },
      create: {
        id: stableId("ps", `${masterId}:${supplier.id}`),
        productMasterId: masterId,
        supplierId: supplier.id,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        productUrl: product.supplierUrl,
        isPrimary: true,
        purchaseLeadTime: product.purchaseLeadTime,
        sourceRevision: input.sourceRevision,
        sourceUpdatedAt,
      },
      update: {
        productUrl: product.supplierUrl,
        isPrimary: true,
        purchaseLeadTime: product.purchaseLeadTime,
        sourceRevision: input.sourceRevision,
        sourceUpdatedAt,
      },
    });
  }

  await tx.productCost.upsert({
    where: { id: stableId("cost", `${masterId}:${variantId}:purchase`) },
    create: {
      id: stableId("cost", `${masterId}:${variantId}:purchase`),
      productMasterId: masterId,
      productVariantId: variantId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      costType: "purchase",
      amount: product.purchasePrice,
      currency: "CNY",
      sourceRevision: input.sourceRevision,
      sourceUpdatedAt,
    },
    update: {
      amount: product.purchasePrice,
      currency: "CNY",
      sourceRevision: input.sourceRevision,
      sourceUpdatedAt,
    },
  });

  await tx.productMedia.deleteMany({
    where: {
      productRecordId: product.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
    },
  });
  const media: Prisma.ProductMediaCreateManyInput[] = [
    ...(product.imageAssets ?? []).map((asset, index) =>
      imageAssetToMedia({
        asset,
        productMasterId: masterId,
        productRecordId: product.id,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        sourceRevision: input.sourceRevision,
        sourceUpdatedAt,
        sortOrder: index,
      }),
    ),
    ...(product.conclusionExcelFile
      ? [
          fileAssetToMedia({
            asset: product.conclusionExcelFile,
            role: "conclusion",
            productMasterId: masterId,
            productRecordId: product.id,
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            sourceRevision: input.sourceRevision,
            sourceUpdatedAt,
            sortOrder: 10_000,
          }),
        ]
      : []),
  ];
  if (!media.length && product.image?.trim()) {
    media.push({
      id: stableId("pm", `${product.id}:legacy-image`),
      productMasterId: masterId,
      productRecordId: product.id,
      fileId: null,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mediaType: "image",
      role: "main",
      url: product.image.trim(),
      thumbUrl: product.image.trim(),
      originalUrl: product.image.trim(),
      fileName: "",
      mimeType: "",
      size: null,
      sortOrder: 0,
      sourceRevision: input.sourceRevision,
      sourceUpdatedAt,
    });
  }
  if (media.length) {
    await tx.productMedia.createMany({ data: media });
  }

  return { status: "updated" as const, productMasterId: masterId, productVariantId: variantId };
}
