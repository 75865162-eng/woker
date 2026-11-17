import { prisma } from "@/lib/db/prisma";
import { enqueueProductOutboxEvent } from "@/lib/queue";
import { saveProductAggregate } from "@/lib/products/product-aggregate-service";
import { invalidateProductListResponseCaches, invalidateProductListSummaryCaches } from "@/lib/products/product-list-cache";
import type { Product } from "@/lib/products/types";
import type { CurrentUser } from "@/lib/auth/session";
import { stripAmazonProductObservations } from "@/lib/products/amazon-field-policy";
import { ProductRecordRevisionConflictError } from "@/lib/products/product-record-repository";
import { InvalidProductStatusError } from "@/lib/products/status-machine";
import { ProductManagementError } from "@/lib/products/management-contract";
import { ProductPurchasePriceValidationError, requireProductPurchasePrice } from "@/lib/products/product-record-index";
import type { WorkspaceScopeInput } from "@/lib/workspace/scope";

export class ProductWritePermissionError extends Error {
  constructor(action: "create" | "edit") {
    super(action === "create" ? "当前账号没有新增商品的权限。" : "当前账号没有编辑该商品的权限。");
    this.name = "ProductWritePermissionError";
  }
}

export function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== "object") return false;
  const product = value as Partial<Product>;
  return Boolean(product.id && product.sku && typeof product.chineseName === "string");
}

export function normalizeProduct(product: Product): Product {
  return {
    ...stripAmazonProductObservations(product),
    id: product.id || `prod-${product.sku}`,
    sku: product.sku.trim(),
    competitorAsins: Array.isArray(product.competitorAsins) ? product.competitorAsins : [],
    images: Array.isArray(product.images) ? product.images : [],
  };
}

function requiresConclusionExcel(product: Product) {
  return product.status === "canceled" || product.status === "listed";
}

export async function saveProductRequest(input: {
  product: Product;
  user: CurrentUser;
  scope: WorkspaceScopeInput;
  canEditProducts: boolean;
  canCreateProducts: boolean;
}) {
  const { product, user, scope, canEditProducts, canCreateProducts } = input;
  requireProductPurchasePrice(product);
  const persisted = await prisma.$transaction(async (tx) => {
    const existingRecord = await tx.productRecord.findUnique({
      where: { organizationId_workspaceId_sku: { organizationId: user.organizationId, workspaceId: scope.workspaceId, sku: product.sku } },
    });
    if (existingRecord && !canEditProducts) throw new ProductWritePermissionError("edit");
    if (!existingRecord && !canCreateProducts) throw new ProductWritePermissionError("create");

    const existingProduct = existingRecord?.payload as Partial<Product> | undefined;
    const requestedRevision = typeof product.revision === "number" && Number.isInteger(product.revision) ? product.revision : undefined;
    const productToSave: Product = { ...product, id: existingRecord?.id ?? product.id, videoPlan: product.videoPlan ?? existingProduct?.videoPlan };
    if (requiresConclusionExcel(productToSave) && !productToSave.conclusionExcelFile?.id) {
      throw new Error("状态为已取消或已上架时，请先上传结论 Excel 表。");
    }

    const saved = await saveProductAggregate(tx, {
      product: productToSave,
      user,
      scope: { ...scope, organizationId: user.organizationId },
      expectedRevision: requestedRevision,
      existingRecord,
    });
    return { productToSave: saved.product, outboxEventId: saved.outboxEventId, projectionEventId: saved.projectionEventId };
  });

  void Promise.all([
    enqueueProductOutboxEvent(persisted.outboxEventId),
    enqueueProductOutboxEvent(persisted.projectionEventId),
  ]).catch((error) => {
    console.warn("[api/products] product outbox enqueue failed", {
      eventId: persisted.outboxEventId,
      sku: persisted.productToSave.sku,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  await invalidateProductListResponseCaches(`${user.organizationId}:${scope.workspaceId}:`).catch((error) => {
    console.warn("[api/products] product cache invalidation failed", {
      sku: persisted.productToSave.sku,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  invalidateProductListSummaryCaches(`${user.organizationId}:${scope.workspaceId}:`);
  return persisted.productToSave;
}

export function productWriteErrorStatus(error: unknown): { status: number; body: Record<string, unknown> } | undefined {
  if (error instanceof ProductManagementError) return { status: error.status, body: { error: error.message } };
  if (error instanceof ProductRecordRevisionConflictError) {
    return { status: 409, body: { error: error.message, conflict: true, currentRevision: error.currentRevision } };
  }
  if (error instanceof InvalidProductStatusError) {
    return { status: 400, body: { error: error.message, code: "INVALID_PRODUCT_STATUS_TRANSITION" } };
  }
  if (error instanceof ProductWritePermissionError) return { status: 403, body: { error: error.message } };
  if (error instanceof ProductPurchasePriceValidationError) return { status: 400, body: { error: error.message } };
  return undefined;
}
