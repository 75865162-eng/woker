import { SellfoxSyncInputError } from "./sync-contract";

/** Only this host was observed in TK-US Listing V2 responses. No image fetch here. */
export function sellfoxListingImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname === "m.media-amazon.com" && !url.port && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

/** Source keys are case-sensitive: Listing fnsku differs from inventory fnSku. */
export function listingIdentityFields(row: Record<string, unknown>) {
  const text = (key: string) => {
    const value = row[key];
    if (value == null || value === "") return null;
    if (typeof value !== "string") throw new SellfoxSyncInputError(`Listing ${key} 字段类型无效。`);
    return value.trim() || null;
  };
  return { fnsku: text("fnsku"), parentSku: text("parentSku"), mainImage: sellfoxListingImageUrl(row.mainImage) };
}
