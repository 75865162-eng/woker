import sharp from "sharp";

export type CatalogImageObservation = {
  asin: string | null;
  sellerSku: string | null;
  facts: unknown;
};

export type AmazonMainImage = {
  asin: string;
  title: string | null;
  sourceUrl: string;
  width: number | null;
  height: number | null;
};

type ImageData = { variant?: unknown; link?: unknown; width?: unknown; height?: unknown };
type ListingSummary = { marketplaceId?: unknown; itemName?: unknown; mainImage?: ImageData };
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function positiveDimension(value: unknown): number | null {
  const dimension = typeof value === "string" && /^\d{1,5}$/.test(value) ? Number(value) : value;
  return typeof dimension === "number" && Number.isSafeInteger(dimension) && dimension > 0 && dimension <= 20_000 ? dimension : null;
}

export function amazonImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const allowedHost = url.hostname === "m.media-amazon.com" || /^images-(?:na|eu|fe)\.ssl-images-amazon\.com$/.test(url.hostname);
    return url.protocol === "https:" && allowedHost && !url.username && !url.password && !url.port ? url.toString() : null;
  } catch { return null; }
}

export function extractAmazonMainImage(
  observation: CatalogImageObservation,
  marketplaceId: string,
  resource: "catalog_items" | "listing_details",
): AmazonMainImage | null {
  if (!observation.asin || !/^[A-Z0-9]{10}$/.test(observation.asin)) return null;
  const facts = object(observation.facts);
  if (resource === "catalog_items") {
    const imageSet = list(facts.images).map(object).find(item => item.marketplaceId === marketplaceId);
    const candidates = list(imageSet?.images).map(object).filter((item): item is ImageData => item.variant === "MAIN" && !!amazonImageUrl(item.link));
    candidates.sort((a, b) => (positiveDimension(a.width) ?? Infinity) * (positiveDimension(a.height) ?? Infinity) - (positiveDimension(b.width) ?? Infinity) * (positiveDimension(b.height) ?? Infinity));
    const summary = list(facts.summaries).map(object).find(item => item.marketplaceId === marketplaceId);
    const image = candidates[0];
    const sourceUrl = amazonImageUrl(image?.link);
    if (!sourceUrl) return null;
    return { asin: observation.asin, title: typeof summary?.itemName === "string" ? summary.itemName : null, sourceUrl, width: positiveDimension(image?.width), height: positiveDimension(image?.height) };
  }
  const summary = list(facts.summaries).map(object).find(item => item.marketplaceId === marketplaceId) as ListingSummary | undefined;
  const image = object(summary?.mainImage);
  const sourceUrl = amazonImageUrl(image.link);
  if (!sourceUrl) return null;
  return { asin: observation.asin, title: typeof summary?.itemName === "string" ? summary.itemName : null, sourceUrl, width: positiveDimension(image.width), height: positiveDimension(image.height) };
}

export function extractAmazonProductTitle(factsValue: unknown, marketplaceId: string): string | null {
  const facts = object(factsValue);
  const summary = list(facts.summaries).map(object).find(item => item.marketplaceId === marketplaceId);
  return typeof summary?.itemName === "string" && summary.itemName.length <= 20_000 ? summary.itemName : null;
}

export async function createAmazonImageThumbnail(source: Buffer): Promise<Buffer> {
  const output = await sharp(source, { limitInputPixels: 20_000_000 }).rotate().resize(150, 150, { fit: "contain", background: "#ffffff" }).webp({ quality: 78 }).toBuffer();
  if (output.byteLength > 1_000_000) throw new Error("AMAZON_IMAGE_THUMBNAIL_TOO_LARGE");
  return output;
}
