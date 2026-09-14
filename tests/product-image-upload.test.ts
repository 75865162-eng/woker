import assert from "node:assert/strict";
import test from "node:test";
import {
  selectProductImageFiles,
  uploadProductImageFile,
} from "@/components/products/product-attachment-upload";
import { getProductAssetDownloadUrl, getProductListImage, getProductOriginalImage } from "@/lib/products/image-assets";

function createImageFile(name = "hero.png", size = 10) {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

test("product image selection respects the remaining ten-image limit", () => {
  const files = Array.from({ length: 5 }, (_, index) => createImageFile(`hero-${index + 1}.png`));

  assert.equal(selectProductImageFiles(files, 0).length, 5);
  assert.equal(selectProductImageFiles(files, 8).length, 2);
  assert.equal(selectProductImageFiles(files, 10).length, 0);
  assert.equal(selectProductImageFiles(files, 3, 4).length, 1);
});

test("product image upload rejects non-image files before making a request", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response();
  }) as typeof fetch;

  try {
    await assert.rejects(
      uploadProductImageFile(new File(["text"], "notes.txt", { type: "text/plain" })),
      /仅支持图片文件/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("product image upload maps the API thumbnail fallback", async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = (async (_input, init) => {
    requests.push(init ?? {});
    return new Response(
      JSON.stringify({
        asset: {
          id: "file-image-1",
          name: "hero.png",
          mimeType: "image/png",
          size: 10,
          storageType: "local",
          uploadedAt: "2026-09-13T00:00:00.000Z",
          thumbUrl: "",
          originalUrl: "/api/assets/hero.png",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const asset = await uploadProductImageFile(createImageFile());
    assert.equal(asset.id, "file-image-1");
    assert.equal(asset.thumbUrl, "/api/assets/hero.png");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, "POST");
    assert.ok(requests[0]?.body instanceof FormData);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("product list image prefers persisted thumbnails and falls back to protected asset downloads", () => {
  const baseAsset = {
    id: "file-image-1",
    name: "hero.png",
    mimeType: "image/png",
    size: 10,
    storageType: "local" as const,
    uploadedAt: "2026-09-14T00:00:00.000Z",
    thumbUrl: "/api/assets/hero-thumb.webp",
    originalUrl: "/api/assets/hero.png",
  };

  assert.equal(getProductListImage({ imageAssets: [baseAsset] }), "/api/assets/hero-thumb.webp");
  assert.equal(
    getProductListImage({ imageAssets: [{ ...baseAsset, thumbUrl: "" }] }),
    "/api/products/file-assets/file-image-1/download",
  );
  assert.equal(
    getProductListImage({ imageAssets: [{ ...baseAsset, thumbUrl: "", thumbFileId: "file-thumb-1" }] }),
    "/api/products/file-assets/file-thumb-1/download",
  );
  assert.equal(
    getProductListImage({ imageAssets: [{ ...baseAsset, id: "", thumbUrl: "" }] }),
    "/api/assets/hero.png",
  );
  assert.equal(
    getProductListImage({ imageAssets: [{ ...baseAsset, id: "product-image-legacy-1", thumbUrl: "", originalUrl: "/api/assets/legacy.png" }] }),
    "/api/assets/legacy.png",
  );
  assert.equal(
    getProductListImage({ imageAssets: [{ ...baseAsset, id: "product-image-legacy-1", thumbUrl: "", originalUrl: "data:image/png;base64,abc" }] }),
    "",
  );
  assert.equal(
    getProductListImage({ imageAssets: [{ ...baseAsset, thumbUrl: "", originalUrl: "data:image/png;base64,abc" }] }),
    "/api/products/file-assets/file-image-1/download",
  );
  assert.equal(
    getProductListImage({
      imageAssets: [
        { ...baseAsset, id: "", thumbUrl: "data:image/png;base64,abc", originalUrl: "data:image/png;base64,abc" },
        { ...baseAsset, id: "file-image-2", thumbUrl: "/api/assets/hero-2-thumb.webp" },
      ],
    }),
    "/api/assets/hero-2-thumb.webp",
  );
});

test("product original image never returns embedded data URLs and keeps file references usable", () => {
  assert.equal(
    getProductOriginalImage({
      imageAssets: [{
        id: "file-image-1",
        name: "hero.png",
        mimeType: "image/png",
        size: 10,
        storageType: "local",
        uploadedAt: "2026-09-14T00:00:00.000Z",
        thumbUrl: "data:image/png;base64,abc",
        originalUrl: "data:image/png;base64,abc",
        thumbFileId: "file-thumb-1",
      }],
    }),
    "/api/products/file-assets/file-image-1/download",
  );
});

test("product image preview prefers the persisted storage URL over the scoped file download route", () => {
  assert.equal(
    getProductAssetDownloadUrl({
      id: "file-image-1",
      thumbFileId: "file-thumb-1",
      thumbUrl: "/api/assets/hero-thumb.webp",
      previewUrl: "/api/assets/hero-preview.webp",
      originalUrl: "/api/assets/hero.png",
      downloadUrl: "/api/products/file-assets/file-image-1/download",
    }),
    "/api/assets/hero-preview.webp",
  );
});

test("legacy image arrays remain available when structured image assets are absent", () => {
  assert.equal(
    getProductListImage({
      images: ["data:image/png;base64,legacy", "https://example.com/legacy-thumb.webp"],
    }),
    "https://example.com/legacy-thumb.webp",
  );
});
