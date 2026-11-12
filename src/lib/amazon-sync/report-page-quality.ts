const requiredFields: Readonly<Record<string, readonly string[]>> = {
  removal_shipment_report: ["businessDate", "orderId", "shippedQuantityOriginal"],
  fba_shipments: ["businessDate", "orderId", "quantityOriginal"],
  fba_customer_sales: ["businessDate", "orderId", "quantityOriginal"],
  mfn_returns: ["businessDate", "orderId", "quantityOriginal"],
  fba_inventory_by_country: ["sellerSku", "asin", "quantityOriginal"],
  removal_order_report: ["businessDate", "orderId", "requestedQuantityOriginal"],
  long_term_storage_fees: ["businessDate", "sellerSku", "fnSku", "amountOriginal", "currencyCode", "chargedQuantityOriginal"],
  storage_fees: ["asin", "fnSku", "amountOriginal", "currencyCode"],
  fba_fulfilled_inventory: ["sellerSku", "asin", "fnSku", "quantities"],
  inventory_events: ["businessDate", "sellerSku", "fnSku", "eventType", "eventQuantityOriginal", "eventReferenceId", "unreconciledQuantityOriginal"],
  reimbursements: ["businessDate", "sellerSku", "reimbursementId", "reimbursementQuantityOriginal", "amountOriginal", "currencyCode"],
  fba_inventory_report: ["sellerSku", "asin", "fnSku", "quantities"],
  reserved_inventory: ["sellerSku", "asin", "fnSku", "quantities"],
  recommended_removals: ["sellerSku", "asin", "fnSku", "quantities", "snapshotDateRaw"],
  stranded_inventory: ["sellerSku", "asin", "fnSku", "quantities"],
  inventory_age: ["businessDate", "sellerSku", "ageBuckets", "availableQuantityOriginal"],
  settlements: ["businessDate", "amountOriginal", "currencyCode"],
};

/** Page observations only. Neither empty pages nor present values prove history. */
export function reportPageQuality(resource: string, rows: ReadonlyArray<Record<string, unknown>>) {
  const fields = requiredFields[resource] ?? [];
  const missing = (value: unknown) => value === null || value === undefined || typeof value === "string" && !value.trim()
    || typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
  const checks = fields.map(field => ({ field, missingRows: rows.filter(row => missing(row[field])).length }));
  const missingFields = checks.filter(check => check.missingRows > 0);
  const numericFields = resource === "inventory_events" ? ["eventQuantityOriginal", "reconciledQuantityOriginal", "unreconciledQuantityOriginal"]
    : resource === "reimbursements" ? ["reimbursementQuantityOriginal", "cashQuantityOriginal", "inventoryQuantityOriginal"]
    : resource === "inventory_age" ? ["availableQuantityOriginal"] : [];
  const validQuantity = (value: unknown) => typeof value === "string" && (resource === "inventory_events" ? /^-?\d{1,9}$/ : /^\d{1,9}$/).test(value);
  const invalidFields = numericFields.map(field => ({ field, invalidRows: rows.filter(row => !missing(row[field]) && !validQuantity(row[field])).length }))
    .filter(check => check.invalidRows > 0);
  if (resource === "inventory_age") {
    const invalidRows = rows.filter(row => row.ageBuckets && typeof row.ageBuckets === "object" && !Array.isArray(row.ageBuckets)
      && Object.values(row.ageBuckets).some(value => !missing(value) && !validQuantity(value))).length;
    if (invalidRows) invalidFields.push({ field: "ageBuckets", invalidRows });
  }
  const dates = rows.flatMap(row => typeof row.businessDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.businessDate) ? [row.businessDate] : []).sort();
  const currencyMissingRows = rows.filter(row => !missing(row.amountOriginal) && missing(row.currencyCode)).length;
  return { basis: "RETURNED_PAGE_ONLY", returnedRows: rows.length,
    status: !rows.length ? "NOT_OBSERVED" : invalidFields.length ? "PARSE_FAILED" : currencyMissingRows ? "CURRENCY_MISSING" : missingFields.length ? "NOT_RETURNED" : "PAGE_FIELDS_PRESENT",
    missingFields, invalidFields, checkedFields: fields, numericFieldsChecked: numericFields, currencyMissingRows,
    observedRange: dates.length ? { from: dates[0], to: dates[dates.length - 1], basis: "RETURNED_PAGE_ONLY", datedRows: dates.length } : null,
    historicalUniverseComplete: false, emptyMeansNoBusinessEvents: false };
}
