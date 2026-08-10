export function isIgnoredProductSku(sku: string) {
  return sku.trim().toLowerCase().startsWith("amzn.gr.");
}
