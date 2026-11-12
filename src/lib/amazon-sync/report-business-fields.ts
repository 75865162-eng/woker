import { recommendationFieldName, recommendedRemovalQuantityFields } from "./inventory-report-contracts";
/** Saved report cells only; no inference, numeric coercion or cross-row joins. */
export function isInventoryAgeBucket(name: string) {
  return /^(?:inv|inventory)-age-\d{1,4}-(?:to-\d{1,4}|plus)-days$/.test(name);
}

export function reportBusinessFields(resource: string, value: unknown): Record<string, unknown> {
  const fields = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const cell = (...names: string[]) => {
    for (const name of names) {
      const value = fields[name];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  if (resource === "recommended_removals") return { fnSku: cell("fnsku"), snapshotDateRaw: cell("snapshot-date"), condition: cell("condition"), quantities: Object.fromEntries(Object.entries(fields).filter(([name]) => recommendedRemovalQuantityFields.includes(recommendationFieldName(name) as typeof recommendedRemovalQuantityFields[number])).map(([name, value]) => [recommendationFieldName(name), value])), snapshotSemantics: "CURRENT_SNAPSHOT_DO_NOT_SUM_VERSIONS", recommendationExecutionStatus: "NOT_EXECUTED" };
  if (resource === "long_term_storage_fees") return { fnSku: cell("fnsku"), chargedQuantityOriginal: cell("qty-charged"), amountChargedOriginal: cell("amount-charged"), currencyCode: cell("currency"), perUnitVolumeOriginal: cell("per-unit-volume"), volumeUnit: cell("volume-unit"), country: cell("country"), condition: cell("condition"), surchargeAgeTier: cell("surcharge-age-tier"), surchargeRateOriginal: cell("rate-surcharge"), historySemantics: "SOURCE_CHARGES_SINGLE_REQUEST_MONTH_DO_NOT_SUM_VERSIONS" };
  if (resource === "removal_shipment_report") return { fnSku: cell("fnsku"), removalOrderId: cell("order-id"), requestDateRaw: cell("request-date"), shipmentDateRaw: cell("shipment-date"), disposition: cell("disposition"), shippedQuantityOriginal: cell("shipped-quantity"), carrier: cell("carrier"), trackingNumber: cell("tracking-number"), shipmentStatus: cell("shipment-status"), removalOrderType: cell("removal-order-type"), historySemantics: "RETURNED_SHIPMENTS_ONLY_REQUEST_FILTER_UNCONFIRMED" };
  if (resource === "fba_shipments") return { shipmentId: cell("shipment-id"), shipmentItemId: cell("shipment-item-id"), orderItemId: cell("amazon-order-item-id", "merchant-order-item-id"), shipmentDateRaw: cell("shipment-date"), shippedQuantityOriginal: cell("quantity-shipped"), carrier: cell("carrier"), trackingNumber: cell("tracking-number"), fulfillmentCenterId: cell("fulfillment-center-id"), fulfillmentChannel: cell("fulfillment-channel"), historySemantics: "REQUESTED_OVERLAPPING_30_DAY_WINDOWS_LATEST_WINDOW_ONLY" };
  if (resource === "fba_customer_sales") return { shipmentDateRaw: cell("shipment-date"), fnSku: cell("fnsku"), fulfillmentCenterId: cell("fulfillment-center-id"), quantityOriginal: cell("quantity"), currencyCode: cell("currency"), itemPricePerUnitOriginal: cell("item-price-per-unit"), shippingPriceOriginal: cell("shipping-price"), giftWrapPriceOriginal: cell("gift-wrap-price"), pointsGrantedOriginal: cell("points-granted"), historySemantics: "LATEST_REQUESTED_SNAPSHOT_NO_HISTORICAL_WINDOW_DEFINED" };
  if (resource === "mfn_returns") return { returnRequestDateRaw: cell("return-request-date"), returnRequestStatus: cell("return-request-status"), returnReason: cell("return-reason"), returnType: cell("return-type"), resolution: cell("resolution"), labelCostOriginal: cell("label-cost"), refundedAmountOriginal: cell("refunded-amount"), currencyCode: cell("currency-code"), historySemantics: "LATEST_ROLLING_60_DAY_REPORT_WINDOW_ONLY" };
  if (resource === "storage_fees") return { fnSku: cell("fnsku"), monthOfCharge: cell("month_of_charge"), estimatedMonthlyStorageFeeOriginal: cell("estimated_monthly_storage_fee"), currencyCode: cell("currency"), quantityOnHandAverageOriginal: cell("average_quantity_on_hand"), snapshotSemantics: "LATEST_REPORTED_MONTHLY_ESTIMATE_DO_NOT_SUM_VERSIONS" };
  if (resource === "fba_overage_fees") return { chargedDate: cell("charged_date"), countryCode: cell("country_code"), storageType: cell("storage_type"), chargeRateOriginal: cell("charge_rate"), storageUsageVolumeOriginal: cell("storage_usage_volume"), storageLimitVolumeOriginal: cell("storage_limit_volume"), overageVolumeOriginal: cell("overage_volume"), volumeUnit: cell("volume_unit"), estimatedChargedFeeAmountOriginal: cell("charged_fee_amount"), currencyCode: cell("currency_code"), historySemantics: "REQUESTED_ESTIMATE_SNAPSHOT_ONLY_NOT_POSTED_CHARGE" };
  if (resource === "fee_preview") return { amazonStore: cell("amazon-store"), fulfilledBy: cell("fulfilled-by"), yourPriceOriginal: cell("your-price"), salesPriceOriginal: cell("sales-price"), estimatedTotalFeeOriginal: cell("estimated-fee-total"), estimatedReferralFeePerUnitOriginal: cell("estimated-referral-fee-per-unit"), currencyCode: cell("currency"), historySemantics: "CURRENT_FEE_ESTIMATE_SNAPSHOT_ONLY_NOT_POSTED_CHARGE" };
  if (resource === "removal_order_report") return { removalOrderId: cell("order-id"), orderSource: cell("order-source"), orderType: cell("order-type"), orderStatus: cell("order-status"), serviceSpeed: cell("service-speed"), disposition: cell("disposition"), requestedQuantityOriginal: cell("requested-quantity"), cancelledQuantityOriginal: cell("cancelled-quantity"), disposedQuantityOriginal: cell("disposed-quantity"), shippedQuantityOriginal: cell("shipped-quantity"), inProcessQuantityOriginal: cell("in-process-quantity"), removalFeeOriginal: cell("removal-fee"), currencyCode: cell("currency"), historySemantics: "REQUEST_DATE_WINDOWED" };
  if (resource === "fba_inventory_by_country") return { fnSku: cell("fulfillment-channel-sku"), country: cell("country"), localFulfillmentQuantityOriginal: cell("quantity-for-local-fulfillment"), snapshotSemantics: "CURRENT_MCI_COUNTRY_SNAPSHOT_DO_NOT_SUM_VERSIONS" };
  if (["fba_fulfilled_inventory", "fba_inventory_report", "reserved_inventory", "stranded_inventory"].includes(resource)) return { fnSku: cell("fnsku", "fulfillment-channel-sku"), quantities: Object.fromEntries(Object.entries(fields).filter(([key]) => /quantity|qty|^reserved_/i.test(key))), snapshotSemantics: "CURRENT_SNAPSHOT_DO_NOT_SUM_VERSIONS" };
  const unreconciled = cell("unreconciled-quantity");
  const reconciliationStatus = unreconciled === null ? "NOT_RETURNED"
    : !/^-?\d{1,9}$/.test(unreconciled) ? "PARSE_FAILED"
    : Number(unreconciled) === 0 ? "RECONCILED_REPORTED" : "UNRECONCILED_REPORTED";
  const identity = { fnSku: cell("fnsku"), fulfillmentCenterId: cell("fulfillment-center-id", "fulfillment-center"), country: cell("country") };
  if (resource === "inventory_events") return { ...identity, eventType: cell("event-type"), eventReferenceId: cell("reference-id"),
    reconciliationStatus, claimEligibility: "NOT_VERIFIED",
    disposition: cell("disposition"), reason: cell("reason", "reason-code"),
    eventQuantityOriginal: cell("quantity"), reconciledQuantityOriginal: cell("reconciled-quantity"), unreconciledQuantityOriginal: cell("unreconciled-quantity") };
  if (resource === "reimbursements") return { ...identity, reimbursementId: cell("reimbursement-id"), reason: cell("reason", "reason-code"),
    cashQuantityOriginal: cell("quantity-reimbursed-cash"), inventoryQuantityOriginal: cell("quantity-reimbursed-inventory"),
    originalReimbursementId: cell("original-reimbursement-id"), originalReimbursementType: cell("original-reimbursement-type"),
    reimbursementQuantityOriginal: cell("quantity-reimbursed-total"), amountPerUnitOriginal: cell("amount-per-unit"), amountTotalOriginal: cell("amount-total", "total-amount") };
  if (resource === "inventory_age") return { ...identity, availableQuantityOriginal: cell("available"),
    ageBuckets: Object.fromEntries(Object.entries(fields).filter(([key, value]) => isInventoryAgeBucket(key) && typeof value === "string")),
    ageBucketSemantics: "SOURCE_BUCKETS_MAY_OVERLAP_DO_NOT_SUM" };
  return {};
}
