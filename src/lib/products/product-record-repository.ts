import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Product } from "@/lib/products/types";
import {
  getProductRecordCurrentOwner,
  getProductRecordIsOverdue,
  getProductRecordSource,
  isProductOperationsProgressIncomplete,
} from "@/lib/products/list-query";
import { getProductWorkflowStage, normalizeAssigneeList } from "@/lib/products/workflow";
import { productRecordPayloadToProduct } from "@/lib/products/product-projection";
import {
  assertKnownProductStatus,
  assertProductStatusTransition,
} from "@/lib/products/status-machine";

type ProductDbClient = Prisma.TransactionClient | PrismaClient;

export type ProductRecordScope = {
  organizationId: string;
  workspaceId: string;
  accountId: string;
  marketplace: string;
};

export type ProductRecordUser = {
  id: string;
  organizationId: string;
  name?: string;
};

export class ProductRecordRevisionConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super("商品已被其他用户更新，请刷新后再保存。");
    this.name = "ProductRevisionConflictError";
  }
}

export function createProductRecordData(
  product: Product,
  user: ProductRecordUser,
  scope: ProductRecordScope,
) {
  return {
    userId: user.id,
    accountId: scope.accountId,
    marketplace: scope.marketplace,
    payload: product as unknown as Prisma.InputJsonValue,
    chineseName: product.chineseName,
    englishName: product.englishName,
    asin: product.asin,
    status: product.status,
    source: getProductRecordSource(),
    supplierName: product.supplierName,
    purchasePrice: product.purchasePrice,
    selectionOwner: product.selectionOwner || product.developer || "",
    opsAssignee: product.opsAssignee || normalizeAssigneeList(undefined, product.opsAssignees).join("、"),
    designerAssignee: product.designerAssignee || normalizeAssigneeList(undefined, product.designerAssignees).join("、"),
    currentOwner: getProductRecordCurrentOwner(product),
    workflowStage: getProductWorkflowStage(product),
    workflowDueAt: product.workflowDueAt ? new Date(product.workflowDueAt) : null,
    isOverdue: getProductRecordIsOverdue(product),
    operationsProgressIncomplete: isProductOperationsProgressIncomplete(product),
  };
}

export async function findProductRecordBySku(
  client: ProductDbClient,
  scope: Pick<ProductRecordScope, "organizationId" | "workspaceId">,
  sku: string,
) {
  return client.productRecord.findUnique({
    where: {
      organizationId_workspaceId_sku: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        sku: sku.trim(),
      },
    },
  });
}

export async function saveProductRecord(
  tx: Prisma.TransactionClient,
  input: {
    product: Product;
    user: ProductRecordUser;
    scope: ProductRecordScope;
    expectedRevision?: number;
    allowStatusRollback?: boolean;
    existingRecord?: Awaited<ReturnType<typeof findProductRecordBySku>> | null;
  },
) {
  const existingRecord =
    input.existingRecord === undefined
      ? await findProductRecordBySku(tx, input.scope, input.product.sku)
      : input.existingRecord;

  if (existingRecord && input.expectedRevision === undefined) {
    throw new ProductRecordRevisionConflictError(existingRecord.revision);
  }
  if (existingRecord && input.expectedRevision !== existingRecord.revision) {
    throw new ProductRecordRevisionConflictError(existingRecord.revision);
  }

  const existingProduct = existingRecord ? productRecordPayloadToProduct(existingRecord.payload) : undefined;
  if (input.allowStatusRollback) {
    assertKnownProductStatus(input.product.status);
  } else {
    assertProductStatusTransition(existingProduct?.status, input.product.status);
  }
  const nextRevision = existingRecord ? existingRecord.revision + 1 : 1;
  const productToSave: Product = {
    ...input.product,
    id: existingRecord?.id ?? randomUUID(),
    revision: nextRevision,
    videoPlan: input.product.videoPlan ?? existingProduct?.videoPlan,
  };
  const recordData = createProductRecordData(productToSave, input.user, input.scope);

  if (existingRecord) {
    const updated = await tx.productRecord.updateMany({
      where: {
        organizationId: input.scope.organizationId,
        workspaceId: input.scope.workspaceId,
        sku: productToSave.sku,
        revision: existingRecord.revision,
      },
      data: {
        ...recordData,
        revision: nextRevision,
      },
    });

    if (updated.count !== 1) {
      const current = await findProductRecordBySku(tx, input.scope, productToSave.sku);
      throw new ProductRecordRevisionConflictError(current?.revision ?? existingRecord.revision);
    }
  } else {
    try {
      await tx.productRecord.create({
        data: {
          id: productToSave.id,
          organizationId: input.scope.organizationId,
          workspaceId: input.scope.workspaceId,
          sku: productToSave.sku,
          revision: nextRevision,
          ...recordData,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const current = await findProductRecordBySku(tx, input.scope, productToSave.sku);
        throw new ProductRecordRevisionConflictError(current?.revision ?? nextRevision);
      }
      throw error;
    }
  }

  const savedRecord = await findProductRecordBySku(tx, input.scope, productToSave.sku);
  if (!savedRecord) {
    throw new Error("商品保存后无法读取商品事实记录。");
  }

  const projectionEvent = await tx.productOutboxEvent.create({
    data: {
      organizationId: input.scope.organizationId,
      userId: input.user.id,
      workspaceId: input.scope.workspaceId,
      accountId: input.scope.accountId,
      marketplace: input.scope.marketplace,
      eventType: "product_projection_requested",
      entityType: "product",
      entityId: savedRecord.id,
      payload: {
        productRecordId: savedRecord.id,
        revision: savedRecord.revision,
        projectionVersion: 1,
      },
    },
  });

  const savedProduct = {
    ...productToSave,
    id: savedRecord.id,
    revision: savedRecord.revision,
  };

  return {
    record: savedRecord,
    existingProduct,
    product: savedProduct,
    projectionEventId: projectionEvent.id,
  };
}
