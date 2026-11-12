import assert from "node:assert/strict";
import test from "node:test";
import { fieldIdentity, scanArchivedFields } from "../src/lib/amazon-sync/field-scan";
import { implementedFieldMapping } from "../src/lib/amazon-sync/field-mappings";

test("field identity distinguishes versions, source, case and escaped paths", () => {
  const id = fieldIdentity("SP_API", "orders", "v1", "/a~1b");
  assert.equal(id, fieldIdentity("SP_API", "orders", "v1", "/a~1b"));
  for (const args of [["SP_API", "orders", "v2", "/a~1b"], ["ADS_API", "orders", "v1", "/a~1b"], ["SP_API", "orders", "v1", "/a/b"], ["SP_API", "Orders", "v1", "/a~1b"]]) assert.notEqual(fieldIdentity(...args as [string, string, string, string]), id);
});

test("JSON scan preserves missing versus null without collecting sample values", () => {
  const result = scanArchivedFields('{"rows":[{"amount":null},{},{"amount":"12345678901234567890.1234"}]}', "JSON");
  assert.equal(result.complete, true);
  const amount = result.fields.find(field => field.path === "/rows/*/amount")!;
  assert.equal(amount.observations, 2);
  assert.equal(amount.nulls, 1);
  assert.deepEqual(amount.types, ["null", "string"]);
  assert.equal(JSON.stringify(result).includes("12345678901234567890"), false);
});

test("TSV keeps original header case and whitespace, escaped paths, and empty-string counts", () => {
  const result = scanArchivedFields(' Currency \ta/b\t~x\nUSD\t\t42\n\tvalue\t0\n', "REPORT");
  assert.equal(result.complete, true);
  assert.deepEqual(result.fields.map(field => field.path), ["/columns/ Currency ", "/columns/a~1b", "/columns/~0x"]);
  assert.equal(result.emptyStrings["/columns/ Currency "], 1);
  assert.equal(result.fields[0].nulls, 0);
  assert.equal(result.fields[0].observations, 2);
});

test("malformed report/JSON never claims complete scan", () => {
  for (const [text, format] of [["{bad", "JSON"], ["a\ta\n1\t2", "REPORT"], ["a\tb\n1", "REPORT"]] as const) assert.equal(scanArchivedFields(text, format).complete, false);
});

test("order mappings are versioned and never confuse purchase and update times", () => {
  assert.equal(implementedFieldMapping("orders", "searchOrders", "2026-01-01", "/orders/*/createdTime")?.targetColumn, "createdTime");
  assert.equal(implementedFieldMapping("orders", "searchOrders", "2026-01-01", "/orders/*/lastUpdatedTime")?.targetColumn, "sourceUpdatedAt");
  assert.equal(implementedFieldMapping("orders", "searchOrders", "v0", "/orders/*/createdTime"), null);
  assert.equal(implementedFieldMapping("orders", "searchOrders", "2026-01-01", "/orders/*/buyerInfo"), null);
  assert.equal(implementedFieldMapping("orders", "getOrder", "2026-01-01", "/order/orderItems/*/product/sellerSku")?.targetColumn, "sellerSku");
  assert.equal(implementedFieldMapping("orders", "getOrder", "2026-01-01", "/order/orderItems/*/proceeds/proceedsTotal/amount")?.targetColumn, "proceedsOriginal");
  assert.equal(implementedFieldMapping("orders", "searchOrders", "2026-01-01", "/order/orderItems/*/product/sellerSku"), null);
});

test("settlement currency aliases stay distinct from report total amounts", () => {
  for (const header of ["currency", " Currency-Unit ", "currency-code"]) assert.equal(implementedFieldMapping("settlements", "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", "2021-06-30", `/columns/${header}`)?.targetColumn, "currencyCode");
  assert.equal(implementedFieldMapping("settlements", "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", "2021-06-30", "/columns/total-amount"), null);
});


test("getOrder mappings register persisted money and items without treating price as proceeds", () => {
  const mapping = (path: string) => implementedFieldMapping("orders", "getOrder", "2026-01-01", `/order/${path}`);
  assert.equal(mapping("proceeds/grandTotal/amount")?.targetColumn, "grandTotalOriginal");
  assert.equal(mapping("proceeds/grandTotal/amount")?.currencyRequired, true);
  assert.equal(mapping("orderItems/*/proceeds/proceedsTotal/amount")?.targetColumn, "proceedsOriginal");
  assert.equal(mapping("orderItems/*/proceeds/proceedsTotal/currencyCode")?.targetColumn, "currencyCode");
  for (const [path, column] of [["orderItemId", "orderItemId"], ["product/asin", "asin"], ["product/sellerSku", "sellerSku"], ["quantityOrdered", "quantityOrdered"]]) {
    const field = mapping(`orderItems/*/${path}`);
    assert.equal(field?.targetTable, "AmazonOrderItemRecord"); assert.equal(field?.targetColumn, column);
  }
  for (const path of ["orderItems/*/product/price/unitPrice/amount", "buyer/buyerName", "orderItems/*/proceeds/breakdowns/*/subtotal/amount"]) assert.equal(mapping(path), null);
  assert.equal(implementedFieldMapping("orders", "searchOrders", "2026-01-01", "/orders/*/proceeds/grandTotal/amount"), null);
  assert.equal(implementedFieldMapping("orders", "getOrder", "v0", "/order/proceeds/grandTotal/amount"), null);
});


test("inventory event MSKU and report quantity aliases map only to implemented original columns", () => {
  const map = (resource: string, source: string, path: string) => implementedFieldMapping(resource, source, "2021-06-30", `/columns/${path}`);
  assert.equal(map("inventory_events", "GET_LEDGER_DETAIL_VIEW_DATA", "MSKU")?.targetColumn, "sellerSku");
  assert.equal(map("inventory_events", "GET_LEDGER_DETAIL_VIEW_DATA", "Quantity")?.targetColumn, "quantityOriginal");
  for (const [path, key] of [["Reconciled Quantity", "reconciled-quantity"], ["Unreconciled Quantity", "unreconciled-quantity"]]) assert.equal(map("inventory_events", "GET_LEDGER_DETAIL_VIEW_DATA", path)?.targetColumn, `fields.${key}`);
  assert.equal(map("reimbursements", "GET_FBA_REIMBURSEMENTS_DATA", "quantity-reimbursed-total")?.targetColumn, "quantityOriginal");
  assert.equal(map("inventory_age", "GET_FBA_INVENTORY_PLANNING_DATA", "quantity"), null);
  assert.equal(map("reimbursements", "GET_FBA_REIMBURSEMENTS_DATA", "MSKU"), null);
});

test("report JSON mappings name individual preserved cells and reject arbitrary fields", () => {
  for (const key of ["quantity-reimbursed-cash", "quantity-reimbursed-inventory", "original-reimbursement-id", "reimbursement-id"]) {
    const mapping = implementedFieldMapping("reimbursements", "GET_FBA_REIMBURSEMENTS_DATA", "2021-06-30", `/columns/${key}`);
    assert.equal(mapping?.targetColumn, `fields.${key}`); assert.equal(mapping?.dataType, "STRING");
  }
  assert.equal(implementedFieldMapping("inventory_age", "GET_FBA_INVENTORY_PLANNING_DATA", "2021-06-30", "/columns/inv-age-181-to-210-days")?.targetColumn, "fields.inv-age-181-to-210-days");
  assert.equal(implementedFieldMapping("inventory_age", "GET_FBA_INVENTORY_PLANNING_DATA", "2021-06-30", "/columns/inv-age-buyer-email"), null);
  assert.equal(implementedFieldMapping("reimbursements", "GET_FBA_REIMBURSEMENTS_DATA", "2021-06-30", "/columns/buyer-email"), null);
});


test("fulfillment mappings describe getOrder persistence only, never inferred list fields", () => {
  for (const column of ["fulfilledBy", "fulfillmentServiceLevel"]) {
    const field = implementedFieldMapping("orders", "getOrder", "2026-01-01", `/order/fulfillment/${column}`);
    assert.equal(field?.targetTable, "AmazonOrderRecord"); assert.equal(field?.targetColumn, column);
    assert.equal(field?.nullable, true); assert.equal(field?.parserVersion, "orders.2026-01-01.v2");
    assert.equal(implementedFieldMapping("orders", "searchOrders", "2026-01-01", `/orders/*/fulfillment/${column}`), null);
  }
});
