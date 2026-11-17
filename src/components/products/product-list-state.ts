import type { Product } from "@/lib/products/types";
import type { ProductFilters } from "./product-workbench-model";
import { hasActiveProductListFilters } from "./product-workbench-cache";

export type PendingProduct = { product: Product; isNew: boolean };

export function mergeSavedProductIntoList(products: Product[], totalCount: number, pending: PendingProduct | null, input: { filters: ProductFilters; page: number; pageSize: number }) {
  if (!pending) return { products, totalCount, pending };
  const sku = pending.product.sku.trim();
  if (products.some(product => product.sku.trim() === sku)) {
    return { products: products.map(product => product.sku.trim() === sku ? pending.product : product), totalCount, pending: null };
  }
  if (pending.isNew && input.page === 1 && !hasActiveProductListFilters(input.filters)) {
    return { products: [pending.product, ...products].slice(0, input.pageSize), totalCount: totalCount + 1, pending };
  }
  return { products, totalCount, pending };
}
