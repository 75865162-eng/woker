import assert from "node:assert/strict";
import test from "node:test";
import { comparePersistedField, comparePersistedReportCell } from "../src/lib/amazon-sync/field-persistence-evidence";

const row = { rowNumber: 1, rowHash: "fixture-hash", amountOriginal: "12345678901234567890.123400", currencyCode: null };
test("report cell readback verifies exact JSON values independently from row hash", () => {
  const expected = [{ ...row, fields: { "quantity-reimbursed-cash": "0" } }];
  assert.equal(comparePersistedReportCell(expected, expected, "quantity-reimbursed-cash").status, "PASSED");
  for (const value of [0, "", null]) assert.equal(comparePersistedReportCell(expected, [{ ...row, fields: { "quantity-reimbursed-cash": value } }], "quantity-reimbursed-cash").status, "FAILED");
  assert.equal(comparePersistedReportCell(expected, [{ ...row, fields: {} }], "quantity-reimbursed-cash").mismatchRows, 1);
  assert.equal(comparePersistedReportCell(expected, [], "quantity-reimbursed-cash").missingRows, 1);
});
test("field readback preserves decimal text and distinguishes null from empty", () => {
  assert.equal(comparePersistedField([row], [row], "amountOriginal").nonNullRows, 1);
  const currency = comparePersistedField([row], [row], "currencyCode");
  assert.equal(currency.status, "PASSED"); assert.equal(currency.nullRows, 1); assert.equal(currency.nonNullRows, 0);
  assert.equal(comparePersistedField([row], [{ ...row, currencyCode: "" }], "currencyCode").status, "FAILED");
  assert.equal(comparePersistedField([row], [{ ...row, amountOriginal: "12345678901234567890.1234" }], "amountOriginal").mismatchRows, 1);
});
test("field readback requires original identity and rejects duplicate expected or stored rows", () => {
  assert.equal(comparePersistedField([row], [], "amountOriginal").missingRows, 1);
  assert.equal(comparePersistedField([row], [{ ...row, rowHash: "changed" }], "amountOriginal").mismatchRows, 1);
  assert.throws(() => comparePersistedField([row, row], [row], "amountOriginal"), /行号重复/);
  assert.throws(() => comparePersistedField([row], [row, row], "amountOriginal"), /行号重复/);
  assert.equal(comparePersistedField([], [], "amountOriginal").status, "NO_ROWS");
});
