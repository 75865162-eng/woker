import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "@/lib/amazon-sync/approval-policy";
import { parseInventoryReplica, inventoryReplicaLimit } from "@/lib/amazon-sync/inventory-replica-contract";
const fixture = () => {
  const body = { version: 1, sourceId: "source", sellerAccountId: "seller", marketplaceId: "site", amazonSellerId: "official-seller", cloudRunId: "run", publishedAt: "2026-11-10T00:00:00.000Z", rows: [{ sellerSku: "sku", asin: "asin", fnSku: "fnsku", condition: "NewItem", fulfillableQuantity: 7, inboundWorkingQuantity: 1, inboundShippedQuantity: 2, inboundReceivingQuantity: 3, reservedQuantity: 4, unfulfillableQuantity: 5, researchingQuantity: 6, dataVersion: 1, capturedAt: "2026-11-09T00:00:00.000Z", createdAt: "2026-11-09T00:00:00.000Z", sourceUpdatedAt: null }] };
  return { ...body, digest: digest(body) };
};
const signed = (value: ReturnType<typeof fixture>) => { const { digest: unused, ...body } = value; void unused; return { ...body, digest: digest(body) }; };
test("inventory replica preserves every structured business field and null date", () => {
  const value = fixture();
  assert.deepEqual(parseInventoryReplica(value), value);
  assert.equal(parseInventoryReplica(value).rows[0].fnSku, "fnsku");
  assert.equal(parseInventoryReplica(value).rows[0].sourceUpdatedAt, null);
  assert.equal(parseInventoryReplica(signed({ ...value, rows: [] })).rows.length, 0);
});
test("inventory replica rejects corrupt data, duplicate business keys and partial capacity", () => {
  const value = fixture();
  assert.throws(() => parseInventoryReplica({ ...value, rows: [{ ...value.rows[0], fulfillableQuantity: 99 }] }));
  assert.throws(() => parseInventoryReplica(signed({ ...value, rows: [value.rows[0], value.rows[0]] })));
  assert.throws(() => parseInventoryReplica(signed({ ...value, rows: Array.from({ length: inventoryReplicaLimit + 1 }, (_, index) => ({ ...value.rows[0], sellerSku: `sku-${index}` })) })));
  assert.throws(() => parseInventoryReplica(signed({ ...value, rows: [{ ...value.rows[0], capturedAt: "invalid" }] })));
  assert.throws(() => parseInventoryReplica(signed({ ...value, rows: [{ ...value.rows[0], fulfillableQuantity: 1.5 }] })));
});
test("new replica schemas and unknown fields fail explicitly instead of silently dropping fields", () => {
  const value = fixture();
  assert.throws(() => parseInventoryReplica({ ...value, version: 2 }));
  assert.throws(() => parseInventoryReplica({ ...value, rows: [{ ...value.rows[0], futureMetric: "preserve-me" }] }));
  assert.throws(() => parseInventoryReplica({ ...value, accessToken: "secret" }));
});

test("catalog replica preserves unknown nested attributes, field sources and nulls", async () => {
  const { parseCatalogReplica } = await import("@/lib/amazon-sync/inventory-replica-contract");
  const value = catalogFixture();
  assert.deepEqual(parseCatalogReplica(value), value);
  assert.deepEqual(parseCatalogReplica(value).rows[0].listingAttributes, { future_metric: [{ value: "1.2300", nested: { extra: true } }] });
});
function catalogFixture() {
  const { rows, digest: unused, ...common } = fixture();
  void unused;
  const { sellerSku, asin, dataVersion, sourceUpdatedAt, capturedAt, createdAt } = rows[0];
  const body = { ...common, resource: "catalog" as const, rows: [{ sellerSku, asin, dataVersion, sourceUpdatedAt, capturedAt, createdAt, listingStatus: null, fulfillmentType: "AFN", listingAttributes: { future_metric: [{ value: "1.2300", nested: { extra: true } }] }, fieldSources: { future: { api: "fixture", observed: true } } }] };
  return { ...body, digest: digest(body) };
}
test("catalog replica rejects wrong schemas, secrets, duplicate SKUs and corruption", async () => {
  const { parseCatalogReplica, parseSnapshotReplica } = await import("@/lib/amazon-sync/inventory-replica-contract");
  const value = catalogFixture();
  const sign = (value: unknown) => { const { digest: unused, ...body } = value as Record<string, unknown>; void unused; return { ...body, digest: digest(body) }; };
  assert.throws(() => parseSnapshotReplica(value, "inventory"));
  assert.throws(() => parseCatalogReplica(fixture()));
  assert.throws(() => parseCatalogReplica(sign({ ...value, rows: [value.rows[0], value.rows[0]] })));
  assert.throws(() => parseCatalogReplica(sign({ ...value, rows: [{ ...value.rows[0], listingAttributes: { nested: { refreshToken: "secret" } } }] })));
  assert.throws(() => parseCatalogReplica(sign({ ...value, rows: [{ ...value.rows[0], futureColumn: "unknown-schema" }] })));
  assert.throws(() => parseCatalogReplica({ ...value, rows: [] }));
});
