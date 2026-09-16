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

export function buildProductRecordIndex(product: Product): ProductRecordIndex {
  const workflowStage = getProductWorkflowStage(product);

  return {
    chineseName: product.chineseName,
    englishName: product.englishName,
    asin: product.asin,
    status: product.status,
    supplierName: product.supplierName,
    purchasePrice: product.purchasePrice,
    selectionOwner: product.selectionOwner || product.developer || "",
    opsAssignee: normalizeAssigneeList(product.opsAssignee, product.opsAssignees).join(","),
    designerAssignee: normalizeAssigneeList(product.designerAssignee, product.designerAssignees).join(","),
    workflowStage,
    workflowDueAt: product.workflowDueAt ? new Date(product.workflowDueAt) : null,
    operationsProgressIncomplete: hasIncompleteOperationsProgress(product.operationsProgress),
  };
}
