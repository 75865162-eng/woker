import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { productDraftIdentityKey, readProductDrafts, restoreProductEdits, type ProductDraftIdentity } from "@/lib/products/product-edit-draft-repository";
import { saveProductRecord, ProductRecordRevisionConflictError } from "@/lib/products/product-record-repository";
import { collectProductAttachmentReferences } from "@/lib/products/attachment-bindings";
import type { Product } from "@/lib/products/types";

const identity: ProductDraftIdentity = { organizationId: "org", workspaceId: "workspace", userId: "user", entityId: "SKU-1", editorType: "product" };

test("draft identity isolates organization, workspace, account, entity and delimiter-like values", () => {
  const keys = new Set([productDraftIdentityKey(identity)]);
  for (const field of ["organizationId", "workspaceId", "userId", "entityId"] as const) keys.add(productDraftIdentityKey({ ...identity, [field]: `${identity[field]}:other` }));
  assert.equal(keys.size, 5);
  assert.notEqual(productDraftIdentityKey({ ...identity, userId: "a:b", entityId: "c" }), productDraftIdentityKey({ ...identity, userId: "a", entityId: "b:c" }));
  assert.throws(() => productDraftIdentityKey({ ...identity, userId: "" }), /账号/);
});

test("unavailable IndexedDB rejects explicitly instead of producing an empty successful recovery", async () => {
  await assert.rejects(readProductDrafts(identity), /IndexedDB/);
});

test("manual recovery preserves latest revision and untouched facts, and retains edited attachment ids", () => {
  const original = { revision: 1, title: "old", price: 10, assets: [{ id: "uploaded-1" }] };
  const form = { ...original, title: "my title", assets: [{ id: "uploaded-2" }] };
  const latest = { ...original, revision: 3, title: "server title", price: 20 };
  const restored = restoreProductEdits(original, form, latest);
  assert.deepEqual(restored, { revision: 3, title: "my title", price: 20, assets: [{ id: "uploaded-2" }] });
  assert.equal(original.revision, 1);
  assert.equal(form.revision, 1);
  assert.equal(latest.title, "server title");
});

test("original/thumbnail/preview attachment file ids remain binding references", () => {
  const product = { imageAssets: [{ id: "original", thumbFileId: "thumb", previewFileId: "preview", mimeType: "image/png", originalUrl: "/original" }] } as unknown as Product;
  assert.deepEqual(collectProductAttachmentReferences(product).map((item) => item.fileId).sort(), ["original", "preview", "thumb"]);
});

const product: Product = {
  id: "record", sku: "SKU-1", revision: 1, chineseName: "商品", englishName: "Product", asin: "", developer: "",
  purchasePrice: 0, status: "pending", supplierName: "", supplierUrl: "", specs: "", purchaseLeadTime: "", createdAt: "2026-10-20T00:00:00Z",
  keywords: "", note: "", cancelReason: "", hsCode: "", images: [], competitorAsins: [], productWeightG: 0, packageWeightG: 0,
  productSizeCm: { length: 0, width: 0, height: 0 }, packageSizeCm: { length: 0, width: 0, height: 0 },
};
const scope = { organizationId: "org", workspaceId: "workspace", accountId: "", marketplace: "" };
const user = { id: "user", organizationId: "org" };

test("actual write is revision-conditional: two stale snapshots allow only one update and one outbox", async () => {
  let record = { id: product.id, sku: product.sku, revision: 1, payload: product };
  const snapshot = { ...record };
  let outboxes = 0;
  const tx = {
    productRecord: {
      findUnique: async () => record,
      updateMany: async ({ where, data }: { where: { revision: number; organizationId: string; workspaceId: string; sku: string }; data: { revision: number; payload: Product } }) => {
        assert.deepEqual(where, { organizationId: scope.organizationId, workspaceId: scope.workspaceId, sku: product.sku, revision: 1 });
        if (where.revision !== record.revision) return { count: 0 };
        record = { ...record, revision: data.revision, payload: data.payload };
        return { count: 1 };
      },
    },
    productOutboxEvent: { create: async () => ({ id: `event-${++outboxes}` }) },
  } as unknown as Prisma.TransactionClient;
  const results = await Promise.allSettled([
    saveProductRecord(tx, { product, user, scope, expectedRevision: 1, existingRecord: snapshot as never }),
    saveProductRecord(tx, { product, user, scope, expectedRevision: 1, existingRecord: snapshot as never }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const failure = results.find((result) => result.status === "rejected");
  assert.ok(failure?.status === "rejected" && failure.reason instanceof ProductRecordRevisionConflictError);
  assert.equal(record.revision, 2);
  assert.equal(outboxes, 1);
});

test("missing revision cannot update an existing product and deleted products cannot be resurrected by stale edits", async () => {
  const tx = {} as Prisma.TransactionClient;
  await assert.rejects(saveProductRecord(tx, { product, user, scope, existingRecord: { revision: 1 } as never }), ProductRecordRevisionConflictError);
  await assert.rejects(saveProductRecord(tx, { product, user, scope, expectedRevision: 1, existingRecord: null }), ProductRecordRevisionConflictError);
});

test("duplicate create reports conflict without querying a PostgreSQL transaction aborted by P2002", async () => {
  const tx = { productRecord: { create: async () => { throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }); } } } as unknown as Prisma.TransactionClient;
  await assert.rejects(saveProductRecord(tx, { product, user, scope, existingRecord: null }), ProductRecordRevisionConflictError);
});
