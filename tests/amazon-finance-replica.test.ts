import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "@/lib/amazon-sync/approval-policy";
import { parseFinanceReplica } from "@/lib/amazon-sync/finance-replica-contract";
const sign = (input: Record<string, unknown>) => { const { digest: unused, ...body } = input; void unused; return { ...body, digest: digest(body) }; };
function fixture() {
  return sign({ version: 1, domain: "finance", sourceId: "source", sellerAccountId: "seller", amazonSellerId: "official", marketplaceId: "anchor", rows: [{ transactionId: "transaction", marketplaceId: "another-site", marketplaceTimeZone: "America/Los_Angeles", attributionStatus: "ATTRIBUTED", quarantineReason: null, postedAt: "2026-11-01T00:00:00.000Z", transactionType: "FUTURE_TYPE", rawStatus: null, orderId: null, classification: "NON_ORDER", originalAmount: "1e-30", amount: "0.000000000000000000000000000001", currency: "USD", convertedAmount: "1.23", convertedCurrency: "USD", conversionStatus: "CONVERTED", fxEvidence: { futureField: { amount: "1.2300" } }, observationSequence: 1, rowHash: digest("row"), capturedAt: "2026-11-02T00:00:00.000Z", task: { id: "task", status: "RUNNING", stage: "PAGE_COMMIT", resource: "finance", sourceId: "source" } }] });
}
test("finance replica preserves exact decimals, unknown business evidence and seller-wide site attribution", () => {
  const value = parseFinanceReplica(fixture());
  assert.equal(value.rows[0].originalAmount, "1e-30");
  assert.equal(value.rows[0].amount, "0.000000000000000000000000000001");
  assert.notEqual(value.rows[0].marketplaceId, value.marketplaceId);
  assert.deepEqual(value.rows[0].fxEvidence, { futureField: { amount: "1.2300" } });
});
test("finance replica rejects credentials, corrupt versions, duplicate IDs and unsafe amounts", () => {
  const value = parseFinanceReplica(fixture()), row = value.rows[0];
  const change = (changes: Record<string, unknown>) => sign({ ...value, rows: [{ ...row, ...changes }] });
  assert.throws(() => parseFinanceReplica({ ...value, rows: [] }));
  assert.throws(() => parseFinanceReplica(change({ ciphertext: "private" })));
  assert.throws(() => parseFinanceReplica(change({ fxEvidence: { accessToken: "secret" } })));
  assert.throws(() => parseFinanceReplica(change({ amount: 0.1 })));
  assert.throws(() => parseFinanceReplica(change({ amount: "1e-30" })));
  assert.throws(() => parseFinanceReplica(change({ amount: "0." + "0".repeat(30) + "1" })));
  assert.throws(() => parseFinanceReplica(change({ originalAmount: "2" })));
  assert.throws(() => parseFinanceReplica(change({ conversionStatus: "UNCONVERTED" })));
  assert.throws(() => parseFinanceReplica(change({ observationSequence: 0 })));
  assert.throws(() => parseFinanceReplica(change({ task: { ...row.task, sourceId: "other" } })));
  assert.throws(() => parseFinanceReplica(sign({ ...value, rows: [row, row] })));
});
test("finance quarantine replica carries only safe metadata without hidden financial amounts", () => {
  const value = parseFinanceReplica(fixture());
  const row = { ...value.rows[0], attributionStatus: "QUARANTINED", quarantineReason: "UNKNOWN_SITE", marketplaceId: null, marketplaceTimeZone: null, transactionType: null, rawStatus: null, orderId: null, classification: "UNATTRIBUTED", originalAmount: null, amount: null, currency: null, convertedAmount: null, convertedCurrency: null, conversionStatus: "QUARANTINED", fxEvidence: null };
  assert.equal(parseFinanceReplica(sign({ ...value, rows: [row] })).rows[0].amount, null);
  assert.throws(() => parseFinanceReplica(sign({ ...value, rows: [{ ...row, amount: "10" }] })));
});
