import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "@/lib/amazon-sync/approval-policy";
import { parseOrderReplica } from "@/lib/amazon-sync/order-replica-contract";
const sign = (input: Record<string, unknown>) => { const { digest: unused, ...body } = input; void unused; return { ...body, digest: digest(body) }; };
function fixture() {
  return sign({ version: 1, domain: "orders", sourceId: "source", sellerAccountId: "seller", amazonSellerId: "official-seller", marketplaceId: "site", rows: [{ amazonOrderId: "order", createdTime: "2026-11-01T00:00:00.000Z", sourceUpdatedAt: "2026-11-02T00:00:00.000Z", rawStatus: "FUTURE_STATUS", normalizedStatus: null, marketplaceTimeZone: "America/Los_Angeles", capturedAt: "2026-11-02T01:00:00.000Z", detailsUpdatedAt: "2026-11-02T00:00:00.000Z", detailPolicyDigest: "policy", fulfilledBy: "AMAZON", fulfillmentServiceLevel: "Standard", grandTotalOriginal: "1.2300", grandTotalAmount: "1.23", currencyCode: "USD", items: [{ orderItemId: "item", asin: null, sellerSku: "SKU", quantityOrdered: 3, proceedsOriginal: "0.000000000000000000000000000001", proceedsAmount: "0.000000000000000000000000000001", currencyCode: "USD" }], task: { id: "task", status: "RUNNING", stage: "PAGE_COMMIT", resource: "orders", sourceId: "source" } }] });
}
test("orders replica retains exact amounts, nulls, unknown statuses and page-committed task provenance", () => {
  const value = parseOrderReplica(fixture());
  assert.equal(value.rows[0].grandTotalOriginal, "1.2300");
  assert.equal(value.rows[0].items[0].proceedsAmount, "0.000000000000000000000000000001");
  assert.equal(value.rows[0].normalizedStatus, null);
  assert.equal(value.rows[0].task.status, "RUNNING");
});
test("orders replica rejects ciphertext, duplicated business IDs, binding changes and corrupt bodies", () => {
  const value = parseOrderReplica(fixture()), row = value.rows[0];
  const changeRow = (change: Record<string, unknown>) => sign({ ...value, rows: [{ ...row, ...change }] });
  assert.throws(() => parseOrderReplica({ ...value, rows: [] }));
  assert.throws(() => parseOrderReplica(changeRow({ detailCiphertext: "encrypted-secret" })));
  assert.throws(() => parseOrderReplica(changeRow({ buyer: { name: "private" } })));
  assert.throws(() => parseOrderReplica(changeRow({ task: { ...row.task, sourceId: "another" } })));
  assert.throws(() => parseOrderReplica(changeRow({ items: [row.items[0], row.items[0]] })));
  assert.throws(() => parseOrderReplica(sign({ ...value, rows: [row, row] })));
  assert.throws(() => parseOrderReplica(changeRow({ items: [{ ...row.items[0], quantityOrdered: -1 }] })));
  assert.throws(() => parseOrderReplica(changeRow({ grandTotalAmount: 1.23 })));
  assert.throws(() => parseOrderReplica(changeRow({ marketplaceTimeZone: "invalid" })));
});
