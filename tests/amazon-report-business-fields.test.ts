import assert from "node:assert/strict";
import test from "node:test";
import { reportBusinessFields, isInventoryAgeBucket } from "../src/lib/amazon-sync/report-business-fields";
import { parseDomainReport } from "../src/lib/amazon-sync/domain-reports";

test("report projection retains signed quantities and source identities without inferring eligibility", () => {
  const event = reportBusinessFields("inventory_events", { fnsku: "F1", "event-type": "Adjustments", "reference-id": "REF1", quantity: "-2", "unreconciled-quantity": "0", reason: "WAREHOUSE_DAMAGE" });
  assert.equal(event.fnSku, "F1"); assert.equal(event.eventReferenceId, "REF1");
  assert.equal(event.eventQuantityOriginal, "-2"); assert.equal(event.unreconciledQuantityOriginal, "0");
  assert.equal(event.reconciledQuantityOriginal, null); assert.equal("claimEligible" in event, false);
  const payment = reportBusinessFields("reimbursements", { "reimbursement-id": "R1", "quantity-reimbursed-total": "0", "amount-total": "1.234,50", "amount-per-unit": "  " });
  assert.equal(payment.reimbursementId, "R1"); assert.equal(payment.reimbursementQuantityOriginal, "0");
  assert.equal(payment.amountTotalOriginal, "1.234,50"); assert.equal(payment.amountPerUnitOriginal, null);
  assert.equal("reimbursementStatus" in payment, false);
});

test("age parser persists observed numeric bucket columns without exposing arbitrary source data", () => {
  const source = "snapshot-date\tsku\tavailable\tinv-age-181-to-210-days\tinv-age-181-to-270-days\tinventory-age-366-plus-days\tinv-age-buyer-email\tbuyer-email\n2026-11-01\tSKU1\t4\t0\t2\t3\tprivate\tsecret@example.invalid";
  const row = parseDomainReport("inventory_age", source).rows[0];
  const age = reportBusinessFields("inventory_age", row.fields);
  assert.equal(age.availableQuantityOriginal, "4");
  assert.deepEqual(age.ageBuckets, { "inv-age-181-to-210-days": "0", "inv-age-181-to-270-days": "2", "inventory-age-366-plus-days": "3" });
  assert.equal(age.ageBucketSemantics, "SOURCE_BUCKETS_MAY_OVERLAP_DO_NOT_SUM");
  assert.ok(!JSON.stringify(row.fields).includes("private")); assert.ok(!JSON.stringify(row.fields).includes("secret"));
  assert.equal(isInventoryAgeBucket("inv-age-buyer-email"), false);
  assert.deepEqual(reportBusinessFields("inventory_age", null).ageBuckets, {});
  const bucketOnly = parseDomainReport("inventory_age", "snapshot-date\tsku\tinv-age-181-to-210-days\n2026-11-01\tSKU1\t0");
  assert.equal(bucketOnly.rows[0].fields["inv-age-181-to-210-days"], "0");
});

test("reimbursement parser retains separate cash and inventory compensation and original references", () => {
  const source = "approval-date\treimbursement-id\tsku\tamount-total\tquantity-reimbursed-cash\tquantity-reimbursed-inventory\tquantity-reimbursed-total\toriginal-reimbursement-id\toriginal-reimbursement-type\tbuyer-email\n2026-11-01\tR2\tSKU1\t19.9900\t0\t2\t2\tR1\tInventory\tprivate@example.invalid";
  const row = parseDomainReport("reimbursements", source).rows[0];
  const payment = reportBusinessFields("reimbursements", row.fields);
  assert.equal(payment.cashQuantityOriginal, "0"); assert.equal(payment.inventoryQuantityOriginal, "2");
  assert.equal(payment.originalReimbursementId, "R1"); assert.equal(payment.originalReimbursementType, "Inventory");
  assert.equal(row.currencyCode, null); assert.equal(payment.amountTotalOriginal, "19.9900");
  assert.ok(!JSON.stringify(row.fields).includes("private@example.invalid"));
});
