import assert from "node:assert/strict";
import test from "node:test";
import { clearGalleryImageAt, galleryImageRowCount, reserveGalleryUploadRows } from "../src/lib/listing-ai/gallery-upload-slots";

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

test("gallery shows exactly one trailing empty row including pending images", () => {
  const image = { name: "image", url: "/image" };
  const blank = { name: "", url: "" };
  assert.equal(galleryImageRowCount([[], []]), 1);
  assert.equal(galleryImageRowCount([[image, image], []]), 3);
  assert.equal(galleryImageRowCount([[image], Array(5).fill(image)]), 6);
  assert.equal(galleryImageRowCount([[image, blank, blank]]), 2);
  assert.equal(galleryImageRowCount([[]], [4]), 6);
  const images = [image, image, image];
  assert.deepEqual(clearGalleryImageAt(images, 1), [image, blank, image]);
  assert.equal(images[1], image);
  assert.equal(galleryImageRowCount([clearGalleryImageAt(images, 2)]), 3);
  assert.equal(galleryImageRowCount([clearGalleryImageAt([image], 0)]), 1);
});
