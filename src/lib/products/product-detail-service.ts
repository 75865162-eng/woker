import { prisma } from "@/lib/db/prisma";
import type { Product } from "@/lib/products/types";
import { getProductListImage, safeProductImageUrl } from "@/lib/products/image-assets";
import { productRecordPayloadToProduct } from "@/lib/products/product-projection";

export type ProductDetailDTO = {
  product: Product;
  productCenter: {
    master: {
      id: string;
      sku: string;
      chineseName: string;
      englishName: string;
      status: string;
      sourceRevision: number;
      sourceUpdatedAt: string | null;
    };
    variants: Array<{
      id: string;
      sku: string;
      asin: string;
      variantName: string;
      attributes: unknown;
      status: string;
      sourceRevision: number;
    }>;
    listings: Array<{
      id: string;
      listingKey: string;
      sku: string;
      asin: string;
      listingStatus: string;
      title: string;
      currency: string;
      price: number | null;
      inventory: number | null;
      fulfillmentType: string;
      marketplaceCode: string | null;
      sellerAccountKey: string | null;
      sourceRevision: number;
    }>;
    suppliers: Array<{
      id: string;
      supplierId: string;
      name: string;
      supplierSku: string;
      productUrl: string;
      isPrimary: boolean;
      purchaseLeadTime: string;
      moq: number | null;
      sourceRevision: number;
    }>;
    costs: Array<{
      id: string;
      costType: string;
      amount: number;
      currency: string;
      effectiveAt: string | null;
      sourceRevision: number;
    }>;
    media: Array<{
      id: string;
      fileId: string | null;
      mediaType: string;
      role: string;
      url: string;
      thumbUrl: string;
      originalUrl: string;
      fileName: string;
      mimeType: string;
      size: number | null;
      sortOrder: number;
      sourceRevision: number;
    }>;
  } | null;
  summary: {
    productRecordId: string;
    organizationId: string;
    workspaceId: string;
    accountId: string;
    marketplace: string;
    sku: string;
    asin: string;
    chineseName: string;
    englishName: string;
    source: string;
    primaryImageUrl: string;
    status: string;
    supplierName: string;
    purchasePrice: number;
    selectionOwner: string;
    opsAssignee: string;
    designerAssignee: string;
    currentOwner: string;
    workflowStage: string;
    workflowDueAt: string | null;
    isOverdue: boolean;
    operationsProgressIncomplete: boolean;
    sourceRevision: number;
    projectionVersion: number;
    sourceUpdatedAt: string | null;
  } | null;
  text: {
    language: string;
    developer: string;
    supplierUrl: string;
    specs: string;
    purchaseLeadTime: string;
    keywords: string;
    note: string;
    cancelReason: string;
    hsCode: string;
    sourceRevision: number;
    projectionVersion: number;
    sourceUpdatedAt: string | null;
  } | null;
  workflow: {
    status: Product["status"];
    stage: Product["workflowStage"] | null;
    currentOwner: string;
    dueAt: string | null;
    isOverdue: boolean;
    history: Product["workflowHistory"];
  };
  media: {
    primaryImageUrl: string;
    imageAssets: Product["imageAssets"];
    conclusionExcelFile: Product["conclusionExcelFile"];
    videoPlan: Product["videoPlan"];
  };
  metrics: null;
  projection: {
    status: "ready" | "pending" | "processing" | "failed";
    sourceRevision: number;
    summaryRevision: number | null;
    textRevision: number | null;
    listSummaryRevision: number | null;
    productCenterRevision: number | null;
    projectionVersion: number;
  };
};

export function getProductProjectionStatus(input: {
  sourceRevision: number;
  summaryRevision?: number | null;
  textRevision?: number | null;
  listSummaryRevision?: number | null;
  productCenterRevision?: number | null;
  stateStatus?: "ready" | "pending" | "processing" | "failed" | null;
  stateSourceRevision?: number | null;
}) {
  const stateMatchesSourceRevision =
    input.stateSourceRevision == null || input.stateSourceRevision === input.sourceRevision;
  if (
    stateMatchesSourceRevision
    && (input.stateStatus === "failed" || input.stateStatus === "processing" || input.stateStatus === "pending")
  ) {
    return input.stateStatus;
  }
  const ready =
    input.summaryRevision === input.sourceRevision &&
    input.textRevision === input.sourceRevision &&
    input.listSummaryRevision === input.sourceRevision &&
    input.productCenterRevision === input.sourceRevision;

  return ready ? "ready" : "pending";
}

export async function getProductDetail(input: {
  organizationId: string;
  workspaceId: string;
  sku: string;
}): Promise<ProductDetailDTO | null> {
  const record = await prisma.productRecord.findUnique({
    where: {
      organizationId_workspaceId_sku: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        sku: input.sku,
      },
    },
    select: {
      payload: true,
      revision: true,
      summary: {
        select: {
          productRecordId: true,
          organizationId: true,
          workspaceId: true,
          accountId: true,
          marketplace: true,
          sku: true,
          asin: true,
          chineseName: true,
          englishName: true,
          source: true,
          primaryImageUrl: true,
          status: true,
          supplierName: true,
          purchasePrice: true,
          selectionOwner: true,
          opsAssignee: true,
          designerAssignee: true,
          currentOwner: true,
          workflowStage: true,
          workflowDueAt: true,
          isOverdue: true,
          operationsProgressIncomplete: true,
          sourceRevision: true,
          projectionVersion: true,
          sourceUpdatedAt: true,
        },
      },
      texts: {
        where: {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          language: "default",
        },
        select: {
          language: true,
          developer: true,
          supplierUrl: true,
          specs: true,
          purchaseLeadTime: true,
          keywords: true,
          note: true,
          cancelReason: true,
          hsCode: true,
          sourceRevision: true,
          projectionVersion: true,
          sourceUpdatedAt: true,
        },
        take: 1,
      },
      projectionStates: {
        select: {
          projectionName: true,
          status: true,
          sourceRevision: true,
          projectionVersion: true,
        },
      },
      productMaster: {
        select: {
          id: true,
          organizationId: true,
          workspaceId: true,
          sku: true,
          chineseName: true,
          englishName: true,
          status: true,
          sourceRevision: true,
          sourceUpdatedAt: true,
          variants: {
            where: {
              organizationId: input.organizationId,
              workspaceId: input.workspaceId,
            },
            select: {
              id: true,
              sku: true,
              asin: true,
              variantName: true,
              attributes: true,
              status: true,
              sourceRevision: true,
            },
          },
          listings: {
            where: {
              organizationId: input.organizationId,
              workspaceId: input.workspaceId,
            },
            select: {
              id: true,
              listingKey: true,
              sku: true,
              asin: true,
              listingStatus: true,
              title: true,
              currency: true,
              price: true,
              inventory: true,
              fulfillmentType: true,
              sourceRevision: true,
              marketplace: { select: { code: true } },
              sellerAccount: { select: { accountKey: true } },
            },
          },
          suppliers: {
            where: {
              organizationId: input.organizationId,
              workspaceId: input.workspaceId,
            },
            select: {
              id: true,
              supplierId: true,
              supplierSku: true,
              productUrl: true,
              isPrimary: true,
              purchaseLeadTime: true,
              moq: true,
              sourceRevision: true,
              supplier: { select: { name: true } },
            },
          },
          costs: {
            where: {
              organizationId: input.organizationId,
              workspaceId: input.workspaceId,
            },
            select: {
              id: true,
              costType: true,
              amount: true,
              currency: true,
              effectiveAt: true,
              sourceRevision: true,
            },
          },
          media: {
            where: {
              organizationId: input.organizationId,
              workspaceId: input.workspaceId,
            },
            select: {
              id: true,
              fileId: true,
              mediaType: true,
              role: true,
              url: true,
              thumbUrl: true,
              originalUrl: true,
              fileName: true,
              mimeType: true,
              size: true,
              sortOrder: true,
              sourceRevision: true,
            },
            orderBy: { sortOrder: "asc" },
          },
        },
      },
    },
  });

  if (!record) {
    return null;
  }
  const product = productRecordPayloadToProduct(record.payload);
  const text = record.texts[0] ?? null;
  const summary = record.summary ?? null;
  const productMaster = record.productMaster
    && record.productMaster.organizationId === input.organizationId
    && record.productMaster.workspaceId === input.workspaceId
    ? record.productMaster
    : null;
  const projectionStates = new Map(record.projectionStates.map((state) => [state.projectionName, state]));
  const summaryState = projectionStates.get("summary");
  const textState = projectionStates.get("text");
  const listState = projectionStates.get("list_summary");
  const productCenterState = projectionStates.get("product_center");
  const currentRevisionStates = [summaryState, textState, listState, productCenterState]
    .filter((state) => state && (state.sourceRevision == null || state.sourceRevision === record.revision));
  const projectionState =
    currentRevisionStates.find((state) => state?.status === "failed")
    ?? currentRevisionStates.find((state) => state?.status === "processing")
    ?? currentRevisionStates.find((state) => state?.status === "pending")
    ?? null;
  const projectionStatus = getProductProjectionStatus({
    sourceRevision: record.revision,
    summaryRevision: summary?.sourceRevision,
    textRevision: text?.sourceRevision,
    listSummaryRevision: listState?.sourceRevision,
    productCenterRevision: productCenterState?.sourceRevision,
    stateStatus: projectionState?.status ?? null,
    stateSourceRevision: projectionState?.sourceRevision ?? null,
  });
  const projectedProduct = text && text.sourceRevision === record.revision
    ? {
        ...product,
        developer: text.developer,
        supplierUrl: text.supplierUrl,
        specs: text.specs,
        purchaseLeadTime: text.purchaseLeadTime,
        keywords: text.keywords,
        note: text.note,
        cancelReason: text.cancelReason,
        hsCode: text.hsCode,
      }
    : product;

  return {
    product: {
      ...projectedProduct,
      revision: record.revision,
    },
    productCenter: productMaster
      ? {
          master: {
            id: productMaster.id,
            sku: productMaster.sku,
            chineseName: productMaster.chineseName,
            englishName: productMaster.englishName,
            status: productMaster.status,
            sourceRevision: productMaster.sourceRevision,
            sourceUpdatedAt: productMaster.sourceUpdatedAt?.toISOString() ?? null,
          },
          variants: productMaster.variants,
          listings: productMaster.listings.map((listing) => ({
            ...listing,
            marketplaceCode: listing.marketplace?.code ?? null,
            sellerAccountKey: listing.sellerAccount?.accountKey ?? null,
            marketplace: undefined,
            sellerAccount: undefined,
          })),
          suppliers: productMaster.suppliers.map((link) => ({
            id: link.id,
            supplierId: link.supplierId,
            name: link.supplier.name,
            supplierSku: link.supplierSku,
            productUrl: link.productUrl,
            isPrimary: link.isPrimary,
            purchaseLeadTime: link.purchaseLeadTime,
            moq: link.moq,
            sourceRevision: link.sourceRevision,
          })),
          costs: productMaster.costs.map((cost) => ({
            ...cost,
            effectiveAt: cost.effectiveAt?.toISOString() ?? null,
          })),
          media: productMaster.media,
        }
      : null,
    summary: summary
      ? {
          ...summary,
          workflowDueAt: summary.workflowDueAt?.toISOString() ?? null,
          sourceUpdatedAt: summary.sourceUpdatedAt?.toISOString() ?? null,
        }
      : null,
    text: text
      ? {
          ...text,
          sourceUpdatedAt: text.sourceUpdatedAt?.toISOString() ?? null,
        }
      : null,
    workflow: {
      status: projectedProduct.status,
      stage: projectedProduct.workflowStage ?? null,
      currentOwner: projectedProduct.currentOwner ?? "",
      dueAt: projectedProduct.workflowDueAt ?? null,
      isOverdue: Boolean(projectedProduct.isOverdue),
      history: projectedProduct.workflowHistory ?? [],
    },
    media: {
      primaryImageUrl: safeProductImageUrl(summary?.primaryImageUrl) || getProductListImage(projectedProduct),
      imageAssets: projectedProduct.imageAssets ?? [],
      conclusionExcelFile: projectedProduct.conclusionExcelFile,
      videoPlan: projectedProduct.videoPlan,
    },
    metrics: null,
    projection: {
      status: projectionStatus,
      sourceRevision: record.revision,
      summaryRevision: summary?.sourceRevision ?? null,
      textRevision: text?.sourceRevision ?? null,
      listSummaryRevision: listState?.sourceRevision ?? null,
      productCenterRevision: productCenterState?.sourceRevision ?? null,
      projectionVersion: Math.max(
        summary?.projectionVersion ?? 0,
        text?.projectionVersion ?? 0,
        summaryState?.projectionVersion ?? 0,
        textState?.projectionVersion ?? 0,
        listState?.projectionVersion ?? 0,
        productCenterState?.projectionVersion ?? 0,
      ),
    },
  };
}
