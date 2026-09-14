import { Prisma } from "@prisma/client";
import { hasIncompleteOperationsProgress } from "@/lib/products/operations-progress";
import type { Product, ProductListItem, ProductListSummary, ProductStatus, ProductWorkflowStage } from "@/lib/products/types";
import { getCurrentWorkflowAssignee, isProductWorkflowOverdue } from "@/lib/products/workflow";
import { isProductStatus } from "@/lib/products/status-catalog";

export type ProductListSource = "dashboard" | "all";

export function splitMultiValue(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function applyProductSourceFilter(where: Prisma.ProductSummaryRecordWhereInput, source?: ProductListSource | null) {
  if (source === "dashboard") {
    return {
      ...where,
      source: "dashboard",
    };
  }

  return where;
}

export function getProductRecordSource(): Exclude<ProductListSource, "all"> {
  return "dashboard";
}

export function getProductRecordCurrentOwner(product: Product) {
  return getCurrentWorkflowAssignee(product);
}

export function getProductRecordIsOverdue(product: Product) {
  return isProductWorkflowOverdue(product);
}

export function hasStandardProductStatus(value: string | null): value is ProductStatus {
  return Boolean(value && isProductStatus(value));
}

export function createProductListWhere(input: {
  user: { organizationId: string };
  workspaceId: string;
  source?: ProductListSource;
  search?: string;
  asin?: string;
  status?: string | null;
  supplierName?: string;
  opsAssignees: string[];
  selectionOwners: string[];
  designerAssignees: string[];
  mySkuOwner?: string;
  minPrice?: number;
  maxPrice?: number;
}) {
  const closedStatuses: ProductStatus[] = ["listed", "canceled", "delisted", "patent_risk"];
  const and: Prisma.ProductSummaryRecordWhereInput[] = [];
  const where: Prisma.ProductSummaryRecordWhereInput = {
    organizationId: input.user.organizationId,
    workspaceId: input.workspaceId,
  };

  if (input.search) {
    and.push({
      OR: [
        { sku: { contains: input.search, mode: "insensitive" } },
        { productRecordId: { contains: input.search, mode: "insensitive" } },
        { chineseName: { contains: input.search, mode: "insensitive" } },
        { englishName: { contains: input.search, mode: "insensitive" } },
      ],
    });
  }

  if (input.asin) where.asin = { contains: input.asin, mode: "insensitive" };
  if (input.supplierName) where.supplierName = { contains: input.supplierName, mode: "insensitive" };
  if (input.opsAssignees.length) {
    and.push({
      OR: input.opsAssignees.map((assignee) => ({ opsAssignee: { contains: assignee, mode: "insensitive" as const } })),
    });
  }
  if (input.selectionOwners.length) where.selectionOwner = { in: input.selectionOwners };
  if (input.designerAssignees.length) {
    and.push({
      OR: input.designerAssignees.map((assignee) => ({ designerAssignee: { contains: assignee, mode: "insensitive" as const } })),
    });
  }
  if (input.mySkuOwner) {
    and.push({
      OR: [
        { selectionOwner: { contains: input.mySkuOwner, mode: "insensitive" } },
        { currentOwner: { contains: input.mySkuOwner, mode: "insensitive" } },
        { opsAssignee: { contains: input.mySkuOwner, mode: "insensitive" } },
        { designerAssignee: { contains: input.mySkuOwner, mode: "insensitive" } },
      ],
    });
  }
  if (Number.isFinite(input.minPrice) || Number.isFinite(input.maxPrice)) {
    where.purchasePrice = {
      ...(Number.isFinite(input.minPrice) ? { gte: input.minPrice } : {}),
      ...(Number.isFinite(input.maxPrice) ? { lte: input.maxPrice } : {}),
    };
  }

  if (input.status === "operations_progress") {
    where.operationsProgressIncomplete = true;
  } else if (input.status === "development_phase") {
    where.status = { in: ["pending", "developing"] };
  } else if (input.status === "overdue") {
    where.status = { notIn: closedStatuses };
    where.isOverdue = true;
  } else {
    const standardStatus = input.status ?? null;
    if (hasStandardProductStatus(standardStatus)) {
      where.status = standardStatus;
    }
  }

  if (and.length) {
    where.AND = and;
  }

  return applyProductSourceFilter(where, input.source);
}

export function normalizeProductStatus(value: string): ProductStatus {
  return hasStandardProductStatus(value) ? value : "pending";
}

export function normalizeWorkflowStage(value: string): ProductWorkflowStage | undefined {
  return ["selection_pending", "ops_confirming", "design_in_progress", "design_review", "done", "blocked"].includes(value)
    ? (value as ProductWorkflowStage)
    : undefined;
}

export function createProductListItem(record: {
  id: string;
  sku: string;
  chineseName: string;
  englishName: string;
  image?: string;
  asin?: string;
  status: string;
  selectionOwner: string;
  opsAssignee: string;
  designerAssignee: string;
  currentOwner?: string;
  workflowStage: string;
  createdAt?: Date;
  updatedAt: Date;
  purchasePrice?: number;
  supplierName?: string;
  specs?: string;
  keywords?: string;
  note?: string;
  workflowDueAt?: Date | null;
  isOverdue?: boolean;
}): ProductListItem {
  const status = normalizeProductStatus(record.status);
  const workflowStage = normalizeWorkflowStage(record.workflowStage);

  return {
    id: record.id,
    sku: record.sku,
    chineseName: record.chineseName,
    englishName: record.englishName,
    image: record.image,
    asin: record.asin,
    status,
    currentOwner: record.currentOwner ?? "",
    isOverdue: record.isOverdue,
    updatedAt: record.updatedAt.toISOString(),
    createdAt: record.createdAt?.toISOString(),
    purchasePrice: record.purchasePrice,
    supplierName: record.supplierName,
    specs: record.specs,
    keywords: record.keywords,
    note: record.note,
    selectionOwner: record.selectionOwner,
    opsAssignee: record.opsAssignee,
    designerAssignee: record.designerAssignee,
    workflowStage,
    workflowDueAt: record.workflowDueAt?.toISOString(),
  };
}

export function createProductListSummary(input: {
  total: number;
  developing: number;
  opsReview: number;
  designInProgress: number;
  operationsProgress: number;
  overdue: number;
}): ProductListSummary {
  return input;
}

export function isProductOperationsProgressIncomplete(product: Pick<Product, "operationsProgress">) {
  return hasIncompleteOperationsProgress(product.operationsProgress);
}
