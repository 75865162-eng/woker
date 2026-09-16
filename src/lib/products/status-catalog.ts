import type { ProductStatus } from "@/lib/products/types";

export const productStatusValues = [
  "pending",
  "developing",
  "ops_review",
  "design_in_progress",
  "listing_confirming",
  "listed",
  "canceled",
  "delisted",
  "patent_risk",
] as const satisfies readonly ProductStatus[];

export function isProductStatus(value: string): value is ProductStatus {
  return (productStatusValues as readonly string[]).includes(value);
}
