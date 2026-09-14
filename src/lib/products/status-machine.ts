import type { ProductStatus } from "@/lib/products/types";
import { isProductStatus, productStatusValues } from "@/lib/products/status-catalog";

const transitions: Record<ProductStatus, readonly ProductStatus[]> = {
  pending: ["pending", "developing", "ops_review", "canceled", "patent_risk"],
  developing: ["developing", "pending", "ops_review", "canceled", "patent_risk"],
  ops_review: ["ops_review", "developing", "design_in_progress", "listing_confirming", "canceled", "patent_risk"],
  design_in_progress: ["design_in_progress", "ops_review", "listing_confirming", "canceled", "patent_risk"],
  listing_confirming: ["listing_confirming", "design_in_progress", "listed", "canceled", "patent_risk"],
  listed: ["listed", "delisted", "patent_risk"],
  canceled: ["canceled"],
  delisted: ["delisted", "developing", "listing_confirming", "patent_risk"],
  patent_risk: ["patent_risk", "developing", "canceled"],
};

export class InvalidProductStatusError extends Error {
  constructor(
    public readonly from: string | null,
    public readonly to: string,
  ) {
    super(from ? `商品状态不允许从 ${from} 变更为 ${to}。` : `商品初始状态不允许为 ${to}。`);
    this.name = "InvalidProductStatusError";
  }
}

export function assertKnownProductStatus(status: string): asserts status is ProductStatus {
  if (!isProductStatus(status)) {
    throw new InvalidProductStatusError(null, status);
  }
}

export function canTransitionProductStatus(from: ProductStatus | null | undefined, to: string) {
  if (!isProductStatus(to)) return false;
  if (!from) return to === "pending" || to === "developing" || to === "ops_review";
  if (!isProductStatus(from)) return false;
  return transitions[from].includes(to);
}

export function assertProductStatusTransition(from: ProductStatus | null | undefined, to: string): asserts to is ProductStatus {
  assertProductStatusTransitionWithOptions(from, to);
}

export function assertProductStatusTransitionWithOptions(
  from: ProductStatus | null | undefined,
  to: string,
  options?: { allowRollback?: boolean },
): asserts to is ProductStatus {
  assertKnownProductStatus(to);
  if (options?.allowRollback) return;
  if (from && !isProductStatus(from)) {
    throw new InvalidProductStatusError(from, to);
  }
  if (!canTransitionProductStatus(from, to)) {
    throw new InvalidProductStatusError(from ?? null, to);
  }
}

export function getProductStatusTransitions(from: ProductStatus | null | undefined) {
  if (!from) return productStatusValues.filter((status) => canTransitionProductStatus(null, status));
  return transitions[from];
}
