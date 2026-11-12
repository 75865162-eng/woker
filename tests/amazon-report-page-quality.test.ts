import assert from "node:assert/strict";
import test from "node:test";
import { reportPageQuality } from "../src/lib/amazon-sync/report-page-quality";
import { reportBusinessFields } from "../src/lib/amazon-sync/report-business-fields";
import { enrichDatasetResult, datasetForTable, normalizeDatasetQuery } from "../src/lib/amazon-sync/mcp-datasets";

test("page quality preserves zeros and isolates missing currency from historical coverage", () => {
  const rows = [{ businessDate: "2026-11-02", sellerSku: "SKU", reimbursementId: "R", reimbursementQuantityOriginal: "0", amountOriginal: "0.00", currencyCode: null }];
  const quality = reportPageQuality("reimbursements", rows);
  assert.equal(quality.status, "CURRENCY_MISSING"); assert.equal(quality.currencyMissingRows, 1);
  assert.deepEqual(quality.missingFields, [{ field: "currencyCode", missingRows: 1 }]);
  const result = enrichDatasetResult({ data: { items: rows, total: 40 }, meta: { page: { page: 1, pageSize: 1, hasNext: true }, fieldQuality: quality, reportCoverage: { coverageStatus: "HISTORY_INCOMPLETE" } } },
    { dataset: datasetForTable("reimbursements"), requestId: "fixture", toolVersion: "2.0.0", filters: { from: "2026-11-01", to: "2026-11-08" }, scopePairs: [] });
  assert.deepEqual(result.missingFields, ["currencyCode"]); assert.equal(result.coverageStatus, "HISTORY_INCOMPLETE");
  assert.equal(result.dataCompleteness.fieldStatus, "CURRENCY_MISSING"); assert.equal(result.hasMore, true);
  assert.deepEqual(result.observedDataRange, { from: "2026-11-02", to: "2026-11-02", basis: "RETURNED_PAGE_ONLY", datedRows: 1 });
  assert.equal(result.dataRange?.from, "2026-11-01");
});

test("empty pages never count as complete and present event fields do not verify eligibility", () => {
  const empty = reportPageQuality("inventory_events", []);
  assert.equal(empty.status, "NOT_OBSERVED"); assert.equal(empty.observedRange, null);
  assert.equal(empty.emptyMeansNoBusinessEvents, false); assert.equal(empty.historicalUniverseComplete, false);
  for (const [quantity, status] of [["-2", "UNRECONCILED_REPORTED"], ["2", "UNRECONCILED_REPORTED"], ["0", "RECONCILED_REPORTED"], ["2.5", "PARSE_FAILED"], ["", "NOT_RETURNED"]]) {
    const event = reportBusinessFields("inventory_events", { "unreconciled-quantity": quantity });
    assert.equal(event.reconciliationStatus, status); assert.equal(event.claimEligibility, "NOT_VERIFIED");
  }
  const age = reportPageQuality("inventory_age", [{ businessDate: "2026-11-01", sellerSku: "SKU", ageBuckets: {}, availableQuantityOriginal: "0" }]);
  assert.deepEqual(age.missingFields, [{ field: "ageBuckets", missingRows: 1 }]);
});

test("report filter schema accepts exact identities only for supported datasets", () => {
  const events = normalizeDatasetQuery(datasetForTable("inventory_events"), { fnSku: "FN", eventReferenceId: "REF", eventType: "Adjustments", reason: "M", disposition: "SELLABLE", unreconciledQuantity: "-2" });
  assert.equal(events.filters.eventReferenceId, "REF");
  assert.equal(events.filters.unreconciledQuantity, "-2");
  assert.equal(normalizeDatasetQuery(datasetForTable("reimbursements"), { reimbursementId: "R" }).filters.reimbursementId, "R");
  assert.throws(() => normalizeDatasetQuery(datasetForTable("inventory_events"), { reimbursementId: "R" }));
  assert.throws(() => normalizeDatasetQuery(datasetForTable("reimbursements"), { eventReferenceId: "REF" }));
  assert.throws(() => normalizeDatasetQuery(datasetForTable("reimbursements"), { unreconciledQuantity: "2" }));
});

test("report field presence cannot certify malformed quantities as usable data", () => {
  const quality = reportPageQuality("inventory_events", [{ eventQuantityOriginal: "-2", reconciledQuantityOriginal: "0", unreconciledQuantityOriginal: "2.5" }]);
  assert.equal(quality.status, "PARSE_FAILED");
  assert.deepEqual(quality.invalidFields, [{ field: "unreconciledQuantityOriginal", invalidRows: 1 }]);
  const payment = reportPageQuality("reimbursements", [{ reimbursementQuantityOriginal: "0", cashQuantityOriginal: 0, inventoryQuantityOriginal: "-1" }]);
  assert.deepEqual(payment.invalidFields, [{ field: "cashQuantityOriginal", invalidRows: 1 }, { field: "inventoryQuantityOriginal", invalidRows: 1 }]);
  assert.equal(reportPageQuality("inventory_age", [{ ageBuckets: { "inv-age-0-to-90-days": "1,000" }, availableQuantityOriginal: "0" }]).status, "PARSE_FAILED");
  assert.equal(reportPageQuality("inventory_events", [{ unreconciledQuantityOriginal: "-000" }]).invalidFields.length, 0);
  assert.equal(reportPageQuality("inventory_events", [{ unreconciledQuantityOriginal: null }]).invalidFields.length, 0);
});
