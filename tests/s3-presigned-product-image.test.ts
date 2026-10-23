import assert from "node:assert/strict";
import test from "node:test";
import { createS3PresignedGetUrl } from "@/lib/storage/s3-storage";

test("S3 product image URLs are short-lived signed object URLs", async () => {
  const names = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  process.env.S3_ENDPOINT = "https://tenant.r2.cloudflarestorage.com";
  process.env.S3_REGION = "auto";
  process.env.S3_BUCKET = "private-product-images";
  process.env.S3_ACCESS_KEY_ID = "test-access-key";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";

  try {
    const signedUrl = new URL(await createS3PresignedGetUrl("assets/products/images/test.webp", 600));
    assert.equal(signedUrl.hostname, "private-product-images.tenant.r2.cloudflarestorage.com");
    assert.equal(signedUrl.searchParams.get("X-Amz-Expires"), "600");
    assert.ok(signedUrl.searchParams.has("X-Amz-Signature"));
    assert.match(signedUrl.pathname, /assets\/products\/images\/test\.webp$/);
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
