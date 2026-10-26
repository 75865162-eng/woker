import test from "node:test";
import assert from "node:assert/strict";
import { listingNarrow } from "@/lib/sellfox/narrow-contracts";
import { listingIdentityFields, sellfoxListingImageUrl } from "@/lib/sellfox/listing-identity-fields";
import { syncSellfoxListings } from "@/lib/sellfox/listing-sync";
import { sellfoxAgentColumns, sellfoxAgentCsv } from "@/lib/sellfox/agent-read";
import { visibleColumns, visibleColumnCsv } from "@/components/sellfox/workbench-types";
import { workbenchReadSql } from "@/lib/sellfox/workbench-read";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import fixture from "./fixtures/sellfox/listing-page.json";

const image = "https://m.media-amazon.com/images/I/fixture.jpg";
const source = { ...fixture.rows[0], fnsku: " FNSKU-VERIFIED ", parentSku: " PARENT-SKU ", mainImage: image };

test("Listing identity fields preserve source casing and missing values, never infer from other identifiers", () => {
  const mapped = listingNarrow(source, "shop-fixture");
  assert.equal(mapped.fnsku, "FNSKU-VERIFIED"); assert.equal(mapped.parentSku, "PARENT-SKU"); assert.equal(mapped.mainImage, image);
  assert.deepEqual(listingIdentityFields({}), { fnsku: null, parentSku: null, mainImage: null });
  assert.deepEqual(listingIdentityFields({ fnSku: "wrong-case", parentAsin: "not-parent-sku", fnsku: " ", parentSku: null }), { fnsku: null, parentSku: null, mainImage: null });
  for (const patch of [{ fnsku: 0 }, { parentSku: [] }, { fnsku: false }]) assert.throws(() => listingIdentityFields(patch));
  assert.throws(() => listingNarrow({ ...source, shopId: "foreign" }, "shop-fixture"));
});

test("image URL only permits observed HTTPS CDN, never loads images or accepts credentials/alternate hosts", () => {
  assert.equal(sellfoxListingImageUrl(image), image);
  const queryImage = "https://m.media-amazon.com/images/I/71Test._AC_SL1500_.jpg?width=80&format=jpg";
  assert.equal(sellfoxListingImageUrl(` ${queryImage} `), queryImage);
  for (const value of [null, {}, [], [image], { url: image }, "", "javascript:alert(1)", "http://m.media-amazon.com/x", "https://m.media-amazon.com.evil.test/x", "https://evil.test/x", "https://m.media-amazon.com@evil.test/x", "https://user:pass@m.media-amazon.com/x", "https://m.media-amazon.com:8443/x", "https://127.0.0.1/x"]) assert.equal(sellfoxListingImageUrl(value), null);
  assert.equal(listingIdentityFields({ mainImage: "https://unknown.test/x" }).mainImage, null);
});

test("normal Listing transaction writes all three columns plus original payload, retry reuses capture and failure keeps current", async () => {
  let head = "old-complete-capture"; let fail = true;
  const writes = new Map<string, Record<string, unknown>>();
  const db = {
    sellfoxStore: { findMany: async () => [{ id: "local-store", externalId: "shop-fixture" }] },
    $transaction: async (callback: (tx: unknown) => Promise<void>) => {
      let nextHead = head; const pending = new Map(writes);
      await callback({
        sellfoxListingSnapshot: { upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          assert.equal(create.fnsku, "FNSKU-VERIFIED"); assert.equal(update.parentSku, "PARENT-SKU"); assert.equal(update.mainImage, image);
          assert.deepEqual(update.payload, source);
          pending.set(String(create.id), create);
        } },
        sellfoxSnapshotHead: { upsert: async ({ update }: { update: { capturedAt: Date } }) => { nextHead = update.capturedAt.toISOString(); } },
      });
      if (fail) { fail = false; throw Error("transient database failure"); }
      pending.forEach((value, key) => writes.set(key, value)); head = nextHead;
    },
  } as unknown as NonNullable<Parameters<typeof syncSellfoxListings>[1]>["db"];
  const post = (async () => ({ ...fixture, rows: [source] })) as NonNullable<Parameters<typeof syncSellfoxListings>[1]>["post"];
  const input = { organizationId: "org", workspaceId: "ws", shopExternalIds: ["shop-fixture"], capturedAt: "2026-10-25T03:00:00Z", onProgress: async () => {} };
  await assert.rejects(() => syncSellfoxListings(input, { db, post }));
  assert.equal(head, "old-complete-capture"); assert.equal(writes.size, 0);
  await syncSellfoxListings(input, { db, post }); await syncSellfoxListings(input, { db, post });
  assert.equal(head, "2026-10-25T03:00:00.000Z"); assert.equal(writes.size, 1);
});

test("narrow SQL and both CSV paths expose only promoted columns; remaining unsupported columns stay gray", () => {
  assert.deepEqual(sellfoxAgentColumns.listings.slice(-3), ["fnsku", "parentSku", "mainImage"]);
  const mapped = listingNarrow(source, "shop-fixture");
  const csv = sellfoxAgentCsv("listings", [{ ...mapped, payload: { secret: "never-export" } }]);
  assert.match(csv, /FNSKU-VERIFIED/); assert.match(csv, /PARENT-SKU/); assert.match(csv, /m.media-amazon.com/); assert.doesNotMatch(csv, /payload|never-export/);
  const columns = visibleColumns("listings", ["fnsku", "parentSku", "image", "productTags"]);
  assert.ok(columns.filter(c => ["fnsku", "parentSku", "image"].includes(c.key)).every(c => !c.unavailable));
  assert.equal(columns.find(c => c.key === "productTags")?.unavailable, undefined);
  assert.ok(visibleColumns("listings", ["salesperson"])[0].unavailable);
  assert.match(visibleColumnCsv(columns, [mapped]), /m.media-amazon.com/);
  const sql = workbenchReadSql("listings", sellfoxBrowseQuery(new URL("http://local/?shopExternalId=124687")), { organizationId: "org", workspaceId: "ws" });
  assert.match(sql.text, /s\."mainImage"/); assert.doesNotMatch(sql.text, /s\."?payload"?|SELECT p\.payload(?:\s|,)/);
  assert.ok(sql.values.includes("124687")); assert.ok(sql.values.includes("org")); assert.ok(sql.values.includes("ws"));
  assert.equal(visibleColumns("sales").find(c => c.key === "image")?.unavailable, undefined);
});
