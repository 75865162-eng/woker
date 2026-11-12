import assert from "node:assert/strict";
import test from "node:test";
import { createGallerySaveService } from "../src/lib/listing-ai/gallery-save-service";
import { galleryThumbnailUrl, galleryAssetIds, gallerySaveName, normalizeGallerySnapshot } from "../src/lib/listing-ai/gallery-snapshot";
import { createEmptyCompetitor } from "../src/lib/listing-ai/workspace-draft";
import type { GallerySaveRecord, GallerySaveRepository } from "../src/lib/listing-ai/gallery-save-repository";

function fixture() {
  return {
    competitors: Array.from({ length: 5 }, (_, i) => ({ ...createEmptyCompetitor(), title: `竞品${i}`, images: [null, { name: "图片", assetId: "assets/listing-ai/2026-11-11/fixture.png", url: "blob:temporary" }] })),
    ownImages: { structureNotes: "备注", mainImage: [], images: [], imageNotes: [null, "第二行"], sales: "", price: "", rating: "", reviewCount: "" },
    input: { asin: "ASIN", mainSellingPoint1: "卖点", variationInfo: "", currentTitle: "标题", currentBullets: "第一点\n第二点", aplusRequirements: "A+" },
    cellStyles: { "标题-mine": { redText: true, yellowBg: true, redRanges: [{ start: 1, end: 3 }] } },
  };
}

test("gallery snapshots round-trip all columns, image positions, text, notes and formatting", () => {
  const snapshot = normalizeGallerySnapshot(fixture());
  assert.equal(snapshot.competitors.length, 5);
  assert.equal(snapshot.competitors[4].title, "竞品4");
  assert.deepEqual(snapshot.competitors[0].images[0], { name: "", url: "" });
  assert.equal(snapshot.competitors[0].images[1].url, "/api/assets/assets/listing-ai/2026-11-11/fixture.png");
  assert.deepEqual(snapshot.ownImages.imageNotes, ["", "第二行"]);
  assert.deepEqual(snapshot.input, fixture().input);
  assert.deepEqual(snapshot.cellStyles, fixture().cellStyles);
  assert.deepEqual(normalizeGallerySnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
  assert.equal(galleryAssetIds(snapshot).length, 1);
});

test("gallery save rejects empty names, transient images, unsafe paths and invalid formatting", () => {
  for (const name of [" ", undefined, "x".repeat(101)]) assert.throws(() => gallerySaveName(name));
  assert.equal(gallerySaveName(" 名称 "), "名称");
  const snapshot = fixture();
  snapshot.competitors[0].images[1]!.assetId = "";
  assert.throws(() => normalizeGallerySnapshot(snapshot), /重新上传/);
  snapshot.competitors[0].images[1]!.assetId = "assets/listing-ai/../another/file.png";
  assert.throws(() => normalizeGallerySnapshot(snapshot));
  assert.throws(() => normalizeGallerySnapshot({ ...fixture(), cellStyles: { test: { redRanges: [{ start: -1, end: 1 }] } } }));
  assert.throws(() => normalizeGallerySnapshot({ ...fixture(), competitors: [] }));
});

test("service scopes every operation, updates matching names and retains server account identity", async () => {
  const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace", userId: "fixture-user" };
  const rows: GallerySaveRecord[] = [];
  const repository: GallerySaveRepository = {
    async list(actualScope, page) { assert.deepEqual(actualScope, scope); assert.equal(page, 2); return { records: rows, hasMore: false }; },
    async find(actualScope, id) { return rows.find(row => row.id === id && row.organizationId === actualScope.organizationId && row.workspaceId === actualScope.workspaceId && row.userId === actualScope.userId) ?? null; },
    async assetsAvailable(actualScope) { assert.deepEqual(actualScope, scope); return true; },
    async save(actualScope, name, savedBy, snapshot) {
      assert.deepEqual(actualScope, scope);
      const existing = rows.find(row => row.name === name && row.userId === actualScope.userId && row.organizationId === actualScope.organizationId && row.workspaceId === actualScope.workspaceId);
      const row = { ...actualScope, name, savedBy, snapshot: JSON.parse(JSON.stringify(snapshot)), id: existing?.id ?? `fixture-${rows.length}`, createdAt: new Date(existing ? "2026-11-12T00:00:00Z" : "2026-11-11T00:00:00Z") };
      if (existing) Object.assign(existing, row);
      else rows.push(row);
      return row;
    },
  };
  const service = createGallerySaveService(repository);
  await service.save(scope, "服务端账号", " 名称 ", { ...fixture(), savedBy: "伪造账号" });
  const id = rows[0].id;
  const changed = fixture();
  changed.input.currentTitle = "更新后的标题";
  await service.save(scope, "服务端账号", "名称", changed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].createdAt.toISOString(), "2026-11-12T00:00:00.000Z");
  assert.equal((await service.restore(scope, id))?.snapshot.input.currentTitle, "更新后的标题");
  await service.save(scope, "服务端账号", "新名称", fixture());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].savedBy, "服务端账号");
  assert.equal(rows[0].name, "名称");
  assert.ok(await service.restore(scope, rows[0].id));
  for (const changed of [{ userId: "other" }, { organizationId: "other" }, { workspaceId: "other" }]) {
    assert.equal(await service.restore({ ...scope, ...changed }, rows[0].id), null);
  }
  assert.equal((await service.list(scope, 2)).records.length, 2);
  repository.assetsAvailable = async () => false;
  await assert.rejects(service.save(scope, "服务端账号", "名称", fixture()), /无权访问/);
  await assert.rejects(service.restore(scope, rows[0].id), /无法完整恢复/);
  assert.equal(rows.length, 2);
});

test("history thumbnail follows image row order, skips empty slots and rejects transient or unsafe references", () => {
  const first = { assetId: "assets/listing-ai/fixture/first.png" };
  const second = { assetId: "assets/listing-ai/fixture/second.png" };
  const snapshot = { competitors: [{ images: [null, second] }, { images: [first] }], ownImages: { images: [] } };
  assert.equal(galleryThumbnailUrl(snapshot), "/api/assets/assets/listing-ai/fixture/first.png");
  assert.equal(galleryThumbnailUrl({ competitors: [{ images: [null, second] }], ownImages: { images: [first] } }), "/api/assets/assets/listing-ai/fixture/first.png");
  assert.equal(galleryThumbnailUrl({ ownImages: { images: [null, second] } }), "/api/assets/assets/listing-ai/fixture/second.png");
  assert.equal(galleryThumbnailUrl({ ownImages: { mainImage: [first], images: [] } }), null);
  for (const image of [{ url: "blob:temporary" }, { assetId: "assets/listing-ai/../private.png" }, { assetId: "assets/other/image.png" }]) {
    assert.equal(galleryThumbnailUrl({ competitors: [{ images: [image] }] }), null);
  }
  assert.equal(galleryThumbnailUrl(null), null);
  assert.equal(galleryThumbnailUrl({}), null);
});
