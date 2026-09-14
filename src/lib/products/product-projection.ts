import type { Prisma } from "@prisma/client";
import type { Product } from "@/lib/products/types";
import {
  getProductRecordCurrentOwner,
  getProductRecordIsOverdue,
  getProductRecordSource,
  isProductOperationsProgressIncomplete,
} from "@/lib/products/list-query";
import { getProductWorkflowStage, normalizeAssigneeList } from "@/lib/products/workflow";
import { projectProductCenter } from "@/lib/products/product-center-projection";
import { getProductListImage } from "@/lib/products/image-assets";

export const productProjectionVersion = 1;
export const productProjectionNames = ["summary", "text", "list_summary", "product_center"] as const;
export type ProductProjectionName = (typeof productProjectionNames)[number];

export function shouldApplyProjectionRevision(currentRevision: number | null | undefined, incomingRevision: number) {
  return currentRevision == null || incomingRevision >= currentRevision;
}

export function buildProductSummaryProjection(input: {
  product: Product;
  organizationId: string;
  workspaceId: string;
  accountId: string;
  marketplace: string;
  sourceRevision: number;
  sourceCreatedAt?: Date | null;
  sourceUpdatedAt?: Date | null;
}) {
  const product = input.product;
  const productForDateDerivedFields = input.sourceCreatedAt
    ? { ...product, createdAt: input.sourceCreatedAt.toISOString() }
    : product;
  const workflowStage = getProductWorkflowStage(product);

  return {
    productRecordId: product.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    accountId: input.accountId,
    marketplace: input.marketplace,
    sku: product.sku,
    asin: product.asin,
    chineseName: product.chineseName,
    englishName: product.englishName,
    source: getProductRecordSource(),
    primaryImageUrl: getProductListImage(product),
    status: product.status,
    supplierName: product.supplierName,
    purchasePrice: product.purchasePrice,
    selectionOwner: product.selectionOwner || product.developer || "",
    opsAssignee: product.opsAssignee || normalizeAssigneeList(undefined, product.opsAssignees).join("、"),
    designerAssignee: product.designerAssignee || normalizeAssigneeList(undefined, product.designerAssignees).join("、"),
    currentOwner: getProductRecordCurrentOwner(product),
    workflowStage,
    workflowDueAt: product.workflowDueAt ? new Date(product.workflowDueAt) : null,
    isOverdue: getProductRecordIsOverdue(productForDateDerivedFields),
    operationsProgressIncomplete: isProductOperationsProgressIncomplete(product),
    sourceRevision: input.sourceRevision,
    projectionVersion: productProjectionVersion,
    createdAt: input.sourceCreatedAt ?? new Date(),
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
  };
}

export function buildProductTextProjection(input: {
  product: Product;
  organizationId: string;
  workspaceId: string;
  sourceRevision: number;
  sourceUpdatedAt?: Date | null;
  language?: string;
}) {
  const product = input.product;

  return {
    productRecordId: product.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    language: input.language ?? "default",
    developer: product.developer ?? "",
    supplierUrl: product.supplierUrl ?? "",
    specs: product.specs ?? "",
    purchaseLeadTime: product.purchaseLeadTime ?? "",
    keywords: product.keywords ?? "",
    note: product.note ?? "",
    cancelReason: product.cancelReason ?? "",
    hsCode: product.hsCode ?? "",
    sourceRevision: input.sourceRevision,
    projectionVersion: productProjectionVersion,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
  };
}

export async function projectProduct(
  tx: Prisma.TransactionClient,
  input: {
    product: Product;
    organizationId: string;
    workspaceId: string;
    accountId: string;
    marketplace: string;
    sourceRevision: number;
    sourceCreatedAt?: Date | null;
    sourceUpdatedAt?: Date | null;
  },
) {
  const summary = buildProductSummaryProjection(input);
  const text = buildProductTextProjection(input);
  const currentSummary = await tx.productSummaryRecord.findUnique({
    where: { productRecordId: summary.productRecordId },
    select: { sourceRevision: true },
  });
  const currentText = await tx.productTextRecord.findUnique({
    where: {
      organizationId_workspaceId_productRecordId_language: {
        organizationId: text.organizationId,
        workspaceId: text.workspaceId,
        productRecordId: text.productRecordId,
        language: text.language,
      },
    },
    select: { sourceRevision: true },
  });

  const summaryResult = !shouldApplyProjectionRevision(currentSummary?.sourceRevision, summary.sourceRevision)
    ? "skipped"
    : await writeSummaryWithRevisionGuard(tx, summary);
  const textResult = !shouldApplyProjectionRevision(currentText?.sourceRevision, text.sourceRevision)
    ? "skipped"
    : await writeTextWithRevisionGuard(tx, text);
  const productCenterResult = await projectProductCenter(tx, input);

  return {
    summary,
    text,
    summaryResult,
    textResult,
    productCenterResult,
  };
}

async function writeSummaryWithRevisionGuard(
  tx: Prisma.TransactionClient,
  summary: ReturnType<typeof buildProductSummaryProjection>,
) {
  const updated = await tx.productSummaryRecord.updateMany({
    where: {
      productRecordId: summary.productRecordId,
      sourceRevision: { lte: summary.sourceRevision },
    },
    data: summary,
  });
  if (updated.count) return "updated" as const;

  try {
    await tx.productSummaryRecord.create({ data: summary });
    return "updated" as const;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "P2002") {
      throw error;
    }
    const retry = await tx.productSummaryRecord.updateMany({
      where: {
        productRecordId: summary.productRecordId,
        sourceRevision: { lte: summary.sourceRevision },
      },
      data: summary,
    });
    return retry.count ? "updated" as const : "skipped" as const;
  }
}

async function writeTextWithRevisionGuard(
  tx: Prisma.TransactionClient,
  text: ReturnType<typeof buildProductTextProjection>,
) {
  const updated = await tx.productTextRecord.updateMany({
    where: {
      organizationId: text.organizationId,
      workspaceId: text.workspaceId,
      productRecordId: text.productRecordId,
      language: text.language,
      sourceRevision: { lte: text.sourceRevision },
    },
    data: text,
  });
  if (updated.count) return "updated" as const;

  try {
    await tx.productTextRecord.create({ data: text });
    return "updated" as const;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "P2002") {
      throw error;
    }
    const retry = await tx.productTextRecord.updateMany({
      where: {
        organizationId: text.organizationId,
        workspaceId: text.workspaceId,
        productRecordId: text.productRecordId,
        language: text.language,
        sourceRevision: { lte: text.sourceRevision },
      },
      data: text,
    });
    return retry.count ? "updated" as const : "skipped" as const;
  }
}

export async function projectProductRecord(
  tx: Prisma.TransactionClient,
  record: {
    id: string;
    organizationId: string;
    workspaceId: string;
    accountId: string;
    marketplace: string;
    revision: number;
    createdAt: Date;
    updatedAt: Date;
    payload: Prisma.JsonValue;
  },
) {
  const currentRecord = await lockProductRecordForProjection(tx, record);

  return {
    ...(await projectProduct(tx, {
      product: {
        ...productRecordPayloadToProduct(currentRecord.payload),
        id: currentRecord.id,
        revision: currentRecord.revision,
      },
      organizationId: currentRecord.organizationId,
      workspaceId: currentRecord.workspaceId,
      accountId: currentRecord.accountId,
      marketplace: currentRecord.marketplace,
      sourceRevision: currentRecord.revision,
      sourceCreatedAt: currentRecord.createdAt,
      sourceUpdatedAt: currentRecord.updatedAt,
    })),
    sourceRevision: currentRecord.revision,
  };
}

export async function lockProductRecordForProjection(
  tx: Prisma.TransactionClient,
  record: {
    id: string;
    organizationId: string;
    workspaceId: string;
  },
) {
  // The ProductRecord is the source of truth. Lock it before projecting so
  // concurrent outbox events cannot write an older snapshot after a newer one.
  await tx.$queryRaw<{ locked: number }[]>`
    SELECT 1::int AS "locked"
    FROM "ProductRecord"
    WHERE "id" = ${record.id}
      AND "organizationId" = ${record.organizationId}
      AND "workspaceId" = ${record.workspaceId}
    FOR UPDATE
  `;
  const currentRecord = await tx.productRecord.findFirst({
    where: {
      id: record.id,
      organizationId: record.organizationId,
      workspaceId: record.workspaceId,
    },
    select: {
      id: true,
      organizationId: true,
      workspaceId: true,
      accountId: true,
      marketplace: true,
      revision: true,
      createdAt: true,
      updatedAt: true,
      payload: true,
    },
  });
  if (!currentRecord) {
    throw new Error("Product record not found for projection.");
  }
  return currentRecord;
}

export function productRecordPayloadToProduct(payload: Prisma.JsonValue): Product {
  return payload as unknown as Product;
}
