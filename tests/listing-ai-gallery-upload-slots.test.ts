import assert from "node:assert/strict";
import test from "node:test";
import { reserveGalleryUploadRows } from "../src/lib/listing-ai/gallery-upload-slots";

test("repeated uploads reserve different rows without overwriting saved or pending images", () => {
  const images = [{ name: "saved", url: "", assetId: "assets/saved" }];
  const first = reserveGalleryUploadRows(images, [], 3);
  assert.deepEqual(first, [1, 2, 3]);
  assert.deepEqual(reserveGalleryUploadRows(images, first, 2), [4, 5]);
  assert.deepEqual(reserveGalleryUploadRows(images, first, 1, 2), []);
  assert.deepEqual(reserveGalleryUploadRows(images, first, 1, 6), [6]);
});
test("empty and failed slots can be retried and gallery size is bounded", () => {
  assert.deepEqual(reserveGalleryUploadRows([{ name: "", url: "" }], [], 1), [0]);
  assert.deepEqual(reserveGalleryUploadRows([], Array.from({ length: 200 }, (_, i) => i), 1), []);
});
