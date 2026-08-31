import { Prisma } from "@prisma/client";
import { hasIncompleteOperationsProgress } from "@/lib/products/operations-progress";
import type { Product, ProductListItem, ProductListSummary, ProductStatus, ProductWorkflowStage } from "@/lib/products/types";
import { getProductWorkflowStage } from "@/lib/products/workflow";

export type ProductListSource = "dashboard" | "sellfox" | "all";

export function splitMultiValue(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const sellfoxProductSourceWhere: Prisma.ProductRecordWhereInput = {
  OR: [
    { id: { startsWith: "sellfox-", mode: "insensitive" } },
    {
      payload: {
        path: ["note"],
        string_contains: "赛狐在线产品 API",
        mode: "insensitive",
      },
    },
  ],
};

export function applyProductSourceFilter(where: Prisma.ProductRecordWhereInput, source?: ProductListSource | null) {
  const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];

  if (source === "sellfox") {
    return {
      ...where,
      AND: [...existingAnd, sellfoxProductSourceWhere],
    };
  }

  if (source === "dashboard") {
    return {
      ...where,
      AND: [...existingAnd, { NOT: sellfoxProductSourceWhere }],
    };
  }

  return where;
}

export function hasStandardProductStatus(value: string | null): value is ProductStatus {
  return Boolean(
    value &&
      [
        "pending",
        "developing",
        "ops_review",
        "design_in_progress",
        "listing_confirming",
        "listed",
        "canceled",
        "delisted",
        "patent_risk",
      ].includes(value),
  );
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
  minPrice?: number;
  maxPrice?: number;
}) {
  const closedStatuses: ProductStatus[] = ["listed", "canceled", "delisted", "patent_risk"];
  const and: Prisma.ProductRecordWhereInput[] = [];
  const where: Prisma.ProductRecordWhereInput = {
    organizationId: input.user.organizationId,
    workspaceId: input.workspaceId,
  };

  if (input.search) {
    and.push({
      OR: [
        { sku: { contains: input.search, mode: "insensitive" } },
        { id: { contains: input.search, mode: "insensitive" } },
        { chineseName: { contains: input.search, mode: "insensitive" } },
        { englishName: { contains: input.search, mode: "insensitive" } },
      ],
    });
  }

  if (input.asin) where.asin = { contains: input.asin, mode: "insensitive" };
  if (input.supplierName) where.supplierName = { contains: input.supplierName, mode: "insensitive" };
  if (input.opsAssignees.length) where.opsAssignee = { in: input.opsAssignees };
  if (input.selectionOwners.length) where.selectionOwner = { in: input.selectionOwners };
  if (input.designerAssignees.length) where.designerAssignee = { in: input.designerAssignees };
  if (Number.isFinite(input.minPrice) || Number.isFinite(input.maxPrice)) {
    where.purchasePrice = {
      ...(Number.isFinite(input.minPrice) ? { gte: input.minPrice } : {}),
      ...(Number.isFinite(input.maxPrice) ? { lte: input.maxPrice } : {}),
    };
  }

  if (input.status === "operations_progress") {
    where.operationsProgressIncomplete = true;
  } else if (input.status === "overdue") {
    where.status = { notIn: closedStatuses };
    and.push({
      OR: [
        { workflowDueAt: { lt: new Date() } },
        { createdAt: { lt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } },
      ],
    });
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
  status: string;
  selectionOwner: string;
  opsAssignee: string;
  designerAssignee: string;
  workflowStage: string;
  updatedAt: Date;
}): ProductListItem {
  const status = normalizeProductStatus(record.status);
  const workflowStage = normalizeWorkflowStage(record.workflowStage);
  const currentStage = getProductWorkflowStage({
    status,
    developer: "",
    selectionOwner: record.selectionOwner,
    opsAssignee: record.opsAssignee,
    designerAssignee: record.designerAssignee,
    workflowStage,
  });
  const currentOwner =
    currentStage === "ops_confirming"
      ? record.opsAssignee
      : currentStage === "design_in_progress" || currentStage === "design_review"
        ? record.designerAssignee
        : record.selectionOwner;

  return {
    id: record.id,
    sku: record.sku,
    chineseName: record.chineseName,
    englishName: record.englishName,
    status,
    currentOwner,
    updatedAt: record.updatedAt.toISOString(),
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
