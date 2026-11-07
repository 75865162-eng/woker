import assert from "node:assert/strict";
import test from "node:test";
import { amazonImageUrl, createAmazonImageThumbnail, extractAmazonMainImage } from "@/lib/amazon-sync/catalog-images";
import sharp from "sharp";

test("Amazon image URLs accept only the HTTPS Amazon image CDN", () => {
  assert.equal(amazonImageUrl("https://m.media-amazon.com/images/I/main.jpg"), "https://m.media-amazon.com/images/I/main.jpg");
  assert.equal(amazonImageUrl("http://m.media-amazon.com/image.jpg"), null);
  assert.equal(amazonImageUrl("https://example.com/image.jpg"), null);
  assert.equal(amazonImageUrl("https://m.media-amazon.com.evil.test/image.jpg"), null);
  assert.equal(amazonImageUrl("https://user@m.media-amazon.com/image.jpg"), null);
});

test("catalog projection picks the smallest main image for the requested marketplace", () => {
  const result = extractAmazonMainImage({
      asin: "B000000001",
      sellerSku: null,
      facts: {
        summaries: [{ marketplaceId: "SITE-A", itemName: "Item A" }, { marketplaceId: "SITE-B", itemName: "Item B" }],
        images: [
          { marketplaceId: "SITE-A", images: [
            { variant: "PT01", link: "https://m.media-amazon.com/other.jpg", width: 150, height: 150 },
            { variant: "MAIN", link: "https://m.media-amazon.com/large.jpg", width: 1200, height: 1200 },
            { variant: "MAIN", link: "https://m.media-amazon.com/small.jpg", width: 300, height: 300 },
          ] },
          { marketplaceId: "SITE-B", images: [{ variant: "MAIN", link: "https://m.media-amazon.com/site-b.jpg", width: 300, height: 300 }] },
        ],
      },
  }, "SITE-A", "catalog_items");
  assert.deepEqual(result, { asin: "B000000001", title: "Item A", sourceUrl: "https://m.media-amazon.com/small.jpg", width: 300, height: 300 });
});

test("listing summary image is the fallback and invalid ASINs are ignored", () => {
  const result = extractAmazonMainImage({ asin: "B000000002", sellerSku: "sku", facts: { summaries: [{ marketplaceId: "SITE-A", itemName: "Listing", mainImage: { link: "https://m.media-amazon.com/listing.jpg", width: 150, height: 150 } }] } }, "SITE-A", "listing_details");
  assert.equal(result?.sourceUrl, "https://m.media-amazon.com/listing.jpg");
  assert.equal(extractAmazonMainImage({ asin: "invalid", sellerSku: null, facts: {} }, "SITE-A", "catalog_items"), null);
});

test("catalog dimensions accept decimal projection strings and skip invalid image URLs", () => {
  const result = extractAmazonMainImage({ asin: "B000000003", sellerSku: null, facts: { images: [{ marketplaceId: "SITE-A", images: [
    { variant: "MAIN", link: "https://example.com/invalid.jpg", width: "10", height: "10" },
    { variant: "MAIN", link: "https://m.media-amazon.com/large.jpg", width: "1200", height: "1200" },
    { variant: "MAIN", link: "https://m.media-amazon.com/small.jpg", width: "300", height: "300" },
  ] }] } }, "SITE-A", "catalog_items");
  assert.equal(result?.sourceUrl, "https://m.media-amazon.com/small.jpg");
  assert.equal(result?.width, 300);
  assert.equal(result?.height, 300);
});

test("persistent image derivative is an exact 150 by 150 WebP", async () => {
  const source = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
  const thumbnail = await createAmazonImageThumbnail(source);
  const metadata = await sharp(thumbnail).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 150);
  assert.equal(metadata.height, 150);
});
