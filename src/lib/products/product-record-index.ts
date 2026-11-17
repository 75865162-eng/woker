import type { Product } from "@/lib/products/types";
import { hasIncompleteOperationsProgress } from "@/lib/products/operations-progress";
import { getProductWorkflowStage, normalizeAssigneeList } from "@/lib/products/workflow";

export type ProductRecordIndex = {
  chineseName: string;
  englishName: string;
  asin: string;
  status: string;
  supplierName: string;
  purchasePrice: number;
  selectionOwner: string;
  opsAssignee: string;
  designerAssignee: string;
  workflowStage: string;
  workflowDueAt: Date | null;
  operationsProgressIncomplete: boolean;
};

export class ProductPurchasePriceValidationError extends Error {
  constructor() {
    super("采购价格缺失或无效，请填写后再保存商品。");
    this.name = "ProductPurchasePriceValidationError";
  }
}

export function requireProductPurchasePrice(product: Pick<Product, "purchasePrice">): number {
  const value = product.purchasePrice;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProductPurchasePriceValidationError();
  }
  return value;
}

export function buildProductRecordIndex(product: Product): ProductRecordIndex {
  const workflowStage = getProductWorkflowStage(product);

  return {
    chineseName: product.chineseName,
    englishName: product.englishName,
    asin: product.asin,
    status: product.status,
    supplierName: product.supplierName,
    purchasePrice: requireProductPurchasePrice(product),
    selectionOwner: product.selectionOwner || product.developer || "",
    opsAssignee: normalizeAssigneeList(product.opsAssignee, product.opsAssignees).join(","),
    designerAssignee: normalizeAssigneeList(product.designerAssignee, product.designerAssignees).join(","),
    workflowStage,
    workflowDueAt: product.workflowDueAt ? new Date(product.workflowDueAt) : null,
    operationsProgressIncomplete: hasIncompleteOperationsProgress(product.operationsProgress),
  };
}
