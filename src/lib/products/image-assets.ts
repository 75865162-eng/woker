import type { Product } from "@/lib/products/types";

export function getProductListImage(product: Pick<Product, "images">) {
  const image = product.images[0]?.trim();

  return image || "";
}
