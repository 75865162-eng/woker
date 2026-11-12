import assert from "node:assert/strict";
import test from "node:test";
import { analyzeReimbursementRecovery } from "../src/lib/amazon-sync/reimbursement-analysis";

const page = (records: Array<Record<string, unknown>>, page = 1, pageCount = 1, total = records.length, coverageStatus = "COMPLETE") => ({
  records, page, pageCount, total, hasMore: page < pageCount, coverageStatus,
});

test("recovery analysis traverses all pages, groups exact totals by report/currency and never guesses event links", () => {
  const result = analyzeReimbursementRecovery({
    events: { pages: [page([{ sellerSku: "S", businessDate: "2026-10-01", eventType: "Lost", unreconciledQuantityOriginal: "2", reportId: "E1", rowNumber: 1, eventReferenceId: "R1" }], 1, 2, 2), page([{ sellerSku: "S", businessDate: "2026-10-02", eventType: "Lost", unreconciledQuantityOriginal: "-1", reportId: "E1", rowNumber: 2 }], 2, 2, 2)] },
    payments: { pages: [page([
      { sellerSku: "S", reimbursementId: "R1", orderId: "ORDER-1", reimbursementQuantityOriginal: "1", cashQuantityOriginal: "1", inventoryQuantityOriginal: "0", amountTotalOriginal: "10.005", currencyCode: "USD", reportId: "P1" },
      { sellerSku: "S", reimbursementId: "R2", reimbursementQuantityOriginal: "2", cashQuantityOriginal: "0", inventoryQuantityOriginal: "2", amountTotalOriginal: "2.1", currencyCode: "USD", reportId: "P1" },
    ])] },
    finance: { pages: [page([{ transactionId: "T1", transactionType: "Reimbursement", originalAmount: "12.105", currency: "USD", orderId: "ORDER-1" }])] },
  });
  assert.equal(result.status, "ANALYZED_WITH_UNMATCHED_RECORDS"); assert.equal(result.queryComplete, true);
  assert.deepEqual(result.events.unreconciledQuantityByReportAndEventType, [{ reportId: "E1", eventType: "Lost", original: "1", missingRows: 0, invalidRows: 0, absoluteOriginal: "3" }]);
  assert.deepEqual(result.payments.amountTotals.byCurrencyAndReport, [{ reportId: "P1", currency: "USD", amountOriginal: "12.105", rows: 2, invalidRows: 0 }]);
  assert.deepEqual(result.payments.reimbursementQuantityByReport[0], { reportId: "P1", original: "3", missingRows: 0, invalidRows: 0 });
  assert.deepEqual(result.payments.cashQuantityByReport[0], { reportId: "P1", original: "1", missingRows: 0, invalidRows: 0 });
  assert.equal(result.classifications.unmatched, 2);
  assert.equal(result.classifications.paid, 0); assert.equal(result.classifications.partiallyPaid, 0); assert.equal(result.classifications.unpaid, 0);
  assert.equal(result.events.records[0].paymentStatus, "UNABLE_TO_CONFIRM");
  assert.equal((result.events.records[0].evidence as Record<string, unknown>).reportId, "E1");
  assert.equal(result.payments.records[0].recoveryStatus, "UNMATCHED");
  assert.deepEqual(result.evidenceRefs.events[0], { reportId: "E1", rowNumber: 1 });
  assert.deepEqual(result.evidenceRefs.payments[0], { reportId: "P1" });
  assert.deepEqual(result.evidenceRefs.finance[0], { transactionId: "T1" });
  assert.deepEqual(result.payments.records[0].financeCrossCheck, {
    status: "ORDER_ID_MATCH_NEEDS_REVIEW", basis: "EXACT_ORDER_ID_NOT_EVENT_PROOF",
    candidates: [{ transactionId: "T1", transactionType: "Reimbursement", originalAmount: "12.105", currency: "USD", evidence: { transactionId: "T1" } }],
  });
});

test("finance transactions are not cross-referenced by SKU when the order ID is missing", () => {
  const result = analyzeReimbursementRecovery({
    events: { pages: [page([])] },
    payments: { pages: [page([{ sellerSku: "S", orderId: null, cashQuantityOriginal: "1", inventoryQuantityOriginal: "0", amountTotalOriginal: "4.00", currencyCode: "USD" }])] },
    finance: { pages: [page([{ sellerSku: "S", orderId: "ORDER-1", transactionId: "T1", originalAmount: "4.00", currency: "USD" }])] },
  });
  assert.equal(result.payments.records[0].financeCrossCheck.status, "NO_ORDER_LEVEL_FINANCE_MATCH");
  assert.equal(result.classifications.paid, 0);
  assert.equal(result.classifications.unpaid, 0);
});

test("different reports are not netted together and localized or currency-less amounts stay out of totals", () => {
  const result = analyzeReimbursementRecovery({
    events: { pages: [page([
      { reportId: "E1", eventType: "Lost", unreconciledQuantityOriginal: "4" },
      { reportId: "E2", eventType: "Lost", unreconciledQuantityOriginal: "-4" },
    ])] },
    payments: { pages: [page([
      { reportId: "P1", amountTotalOriginal: "1.234,50", currencyCode: "EUR", cashQuantityOriginal: "0", inventoryQuantityOriginal: "0" },
      { reportId: "P2", amountTotalOriginal: "7.00", currencyCode: null, cashQuantityOriginal: "1", inventoryQuantityOriginal: "0" },
    ])] },
    finance: { pages: [page([], 1, 0, 0, "NOT_RETURNED")] },
  });
  assert.deepEqual(result.events.unreconciledQuantityByReportAndEventType.map(row => row.original), ["4", "-4"]);
  assert.deepEqual(result.payments.amountTotals.byCurrencyAndReport, [{ reportId: "P1", currency: "EUR", amountOriginal: null, rows: 0, invalidRows: 1 }]);
  assert.equal(result.payments.amountTotals.missingCurrencyRows, 1);
  assert.equal(result.queryComplete, false); assert.equal(result.status, "PARTIAL_DATA");
  assert.ok(result.warnings.includes("finance:SOURCE_OR_COVERAGE_BLOCKED"));
  assert.ok(result.warnings.includes("finance:EMPTY_RESULT_REQUIRES_COVERAGE_REVIEW"));
});

test("missing page breaks traversal even when every observed page looks successful", () => {
  const result = analyzeReimbursementRecovery({
    events: { pages: [page([], 1, 2, 10, "HISTORY_INCOMPLETE")] },
    payments: { pages: [page([], 1, 0, 0, "NOT_RETURNED")] },
    finance: { pages: [], error: "NOT_AUTHORIZED" },
  });
  assert.equal(result.queryComplete, false);
  assert.equal(result.coverage.events.traversed, false);
  assert.equal(result.events.total, 10);
  assert.equal(result.classifications.unpaid, 0);
  assert.equal(result.events.unreconciledQuantityByReportAndEventType.length, 0);
});

test("declared totals cannot make a short page traversal look complete", () => {
  const result = analyzeReimbursementRecovery({
    events: { pages: [page([{ unreconciledQuantityOriginal: "1", reportId: "E1" }], 1, 1, 2)] },
    payments: { pages: [page([])] },
    finance: { pages: [page([])] },
  });
  assert.equal(result.queryComplete, false);
  assert.equal(result.status, "PARTIAL_DATA");
  assert.equal(result.coverage.events.returnedRows, 1);
  assert.equal(result.coverage.events.recordCountMatchesTotal, false);
  assert.ok(result.warnings.includes("events:ROW_COUNT_DOES_NOT_MATCH_TOTAL"));
});

test("failed publication, malformed fields and unknown coverage cannot certify a completed analysis", () => {
  for (const coverageStatus of ["PARSE_FAILED", "PERSISTENCE_FAILED", "QUERY_FAILED", "CURRENCY_MISSING", "NO_PUBLISHED_REPORT", "ATTRIBUTION_PENDING", "UNRECOGNIZED_STATE", ""]) {
    const result = analyzeReimbursementRecovery({
      events: { pages: [page([{ reportId: "E1", unreconciledQuantityOriginal: "2" }], 1, 1, 1, coverageStatus)] },
      payments: { pages: [page([], 1, 0, 0, "COMPLETE")] },
      finance: { pages: [page([], 1, 0, 0, "COMPLETE")] },
    });
    assert.equal(result.status, "PARTIAL_DATA", coverageStatus);
    assert.equal(result.queryComplete, false, coverageStatus);
    assert.ok(result.warnings.includes("events:SOURCE_OR_COVERAGE_BLOCKED"), coverageStatus);
    assert.equal(result.classifications.unpaid, 0);
    assert.equal(result.events.records[0].paymentStatus, "UNABLE_TO_CONFIRM");
  }
});

test("complete pagination over incomplete history remains partial", () => {
  const result = analyzeReimbursementRecovery({
    events: { pages: [page([{ reportId: "E1", unreconciledQuantityOriginal: "2" }], 1, 1, 1, "HISTORY_INCOMPLETE")] },
    payments: { pages: [page([])] },
    finance: { pages: [page([])] },
  });
  assert.equal(result.coverage.events.traversed, true);
  assert.equal(result.queryComplete, false);
  assert.equal(result.status, "PARTIAL_DATA");
  assert.ok(result.warnings.includes("events:HISTORY_INCOMPLETE"));
});
