import { isInventoryReport, inventoryReportTypes, inventoryReportParserVersion } from "./inventory-report-contracts";
import { orderParserVersion } from "./orders";
import { listingSummaryParserVersion } from "@/lib/amazon/catalog";
import { isInventoryAgeBucket } from "./report-business-fields";
/** Executable parser inventory, not an assertion of official completeness or
 * live acceptance. L0 identity remains source/version/path, L1 names are separate. */
export type FieldMapping = { fieldId: string; targetTable: string; targetColumn: string; dataType: string; nullable: boolean; timeSemantics: string | null; currencyRequired: boolean; parserVersion: string; transform: string };
export function implementedFieldMapping(resource: string, sourceCode: string, apiVersion: string, path: string): FieldMapping | null {
  if (resource === "long_term_storage_fees" && sourceCode === "GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA" && apiVersion === "2021-06-30" && path.startsWith("/columns/")) {
    const header = path.slice(9).replace(/~1/g, "/").replace(/~0/g, "~");
    return { fieldId: resource + "." + header, targetTable: "AmazonSyncReportRow", targetColumn: "fields." + header, dataType: "STRING", nullable: false, timeSemantics: "SOURCE_SNAPSHOT_DATE_WITHIN_REQUEST_MONTH", currencyRequired: false, parserVersion: "domain-reports.v2", transform: "parseDomainReport:exact-source-header-and-cell;empty-string-preserved" };
  }
  if (resource === "removal_shipment_report" && sourceCode === "GET_FBA_FULFILLMENT_REMOVAL_SHIPMENT_DETAIL_DATA" && apiVersion === "2021-06-30" && path.startsWith("/columns/")) {
    const header = path.slice(9).replace(/~1/g, "/").replace(/~0/g, "~");
    return { fieldId: resource + "." + header, targetTable: "AmazonSyncReportRow", targetColumn: "fields." + header, dataType: "STRING", nullable: false, timeSemantics: "SOURCE_SHIPMENT_DATE;REQUEST_FILTER_UNCONFIRMED", currencyRequired: false, parserVersion: "domain-reports.v2", transform: "parseDomainReport:exact-source-header-and-cell;empty-string-preserved" };
  }
  if (resource === "fba_shipments" && sourceCode === "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL" && apiVersion === "2021-06-30" && path.startsWith("/columns/")) {
    const header = path.slice(9).replace(/~1/g, "/").replace(/~0/g, "~").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return { fieldId: resource + "." + header, targetTable: "AmazonSyncReportRow", targetColumn: "fields." + header, dataType: "STRING", nullable: false, timeSemantics: "REQUEST_SHIPMENT_DATE_WINDOW", currencyRequired: false, parserVersion: "domain-reports.v2", transform: "parseDomainReport:official-non-pii-column-allowlist;exact-source-cell" };
  }
  if (resource === "fba_customer_sales" && sourceCode === "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA" && apiVersion === "2021-06-30" && path.startsWith("/columns/")) {
    const header = path.slice(9).replace(/~1/g, "/").replace(/~0/g, "~").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!["shipment-date", "sku", "fnsku", "asin", "fulfillment-center-id", "quantity", "amazon-order-id", "currency", "item-price-per-unit", "shipping-price", "gift-wrap-price", "points-granted"].includes(header)) return null;
    return { fieldId: resource + "." + header, targetTable: "AmazonSyncReportRow", targetColumn: "fields." + header, dataType: "STRING", nullable: false, timeSemantics: "SOURCE_SHIPMENT_DATE;LATEST_REQUESTED_SNAPSHOT", currencyRequired: false, parserVersion: "domain-reports.v2", transform: "parseDomainReport:official-non-pii-column-allowlist;exact-source-cell" };
  }
  if (resource === "removal_order_report" && sourceCode === "GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA" && apiVersion === "2021-06-30" && path.startsWith("/columns/")) {
    const header = path.slice(9).replace(/~1/g, "/").replace(/~0/g, "~");
    return { fieldId: resource + "." + header, targetTable: "AmazonSyncReportRow", targetColumn: "fields." + header, dataType: "STRING", nullable: false, timeSemantics: "REQUEST_DATE_WINDOW", currencyRequired: false, parserVersion: "domain-reports.v2", transform: "parseDomainReport:exact-source-header-and-cell;empty-string-preserved" };
  }
  if (resource === "catalog" && sourceCode === "searchListingsItems" && apiVersion === "2021-08-01") {
    const key = path.startsWith("/items/*/summaries/*/") ? path.slice("/items/*/summaries/*/".length) : "";
    if (["itemName", "productType", "conditionType"].includes(key)) return {
      fieldId: `listing.summary.${key}`, targetTable: "AmazonCatalogSnapshot", targetColumn: "listingAttributes", dataType: "STRING", nullable: true,
      timeSemantics: null, currencyRequired: false, parserVersion: listingSummaryParserVersion,
      transform: `extractCatalogPage:unique-target-marketplace-summary;listingAttributes.${key};bounded-trimmed-source-text;missing-not-inferred`,
    };
  }
  if (resource === "orders" && apiVersion === "2026-01-01" && ["searchOrders", "getOrder"].includes(sourceCode)) {
    const prefix = sourceCode === "searchOrders" ? "/orders/*/" : "/order/";
    const fields: Record<string, [string, string, string, boolean, string | null]> = {
      orderId: ["order.amazon_order_id", "amazonOrderId", "STRING", false, null],
      createdTime: ["order.purchase_date", "createdTime", "TIMESTAMPTZ", false, "PURCHASE_TIME"],
      lastUpdatedTime: ["order.last_update_date", "sourceUpdatedAt", "TIMESTAMPTZ", false, "AMAZON_LAST_UPDATE_TIME"],
      "fulfillment/fulfillmentStatus": ["order.order_status", "rawStatus", "STRING", true, null],
    };
    // searchOrders currently persists only base order facts. Do not claim its
    // optional amounts/items are structured merely because the schema lists them.
    if (sourceCode === "getOrder") {
      const detailFields: Record<string, [string, string, string, string, boolean, boolean]> = {
        "fulfillment/fulfilledBy": ["order.fulfilled_by", "AmazonOrderRecord", "fulfilledBy", "STRING", true, false],
        "fulfillment/fulfillmentServiceLevel": ["order.fulfillment_service_level", "AmazonOrderRecord", "fulfillmentServiceLevel", "STRING", true, false],
        "proceeds/grandTotal/amount": ["order.grand_total", "AmazonOrderRecord", "grandTotalOriginal", "DECIMAL_TEXT", true, true],
        "proceeds/grandTotal/currencyCode": ["order.currency", "AmazonOrderRecord", "currencyCode", "STRING", true, false],
        "orderItems/*/orderItemId": ["order_item.id", "AmazonOrderItemRecord", "orderItemId", "STRING", false, false],
        "orderItems/*/product/asin": ["order_item.asin", "AmazonOrderItemRecord", "asin", "STRING", true, false],
        "orderItems/*/product/sellerSku": ["order_item.seller_sku", "AmazonOrderItemRecord", "sellerSku", "STRING", true, false],
        "orderItems/*/quantityOrdered": ["order_item.quantity_ordered", "AmazonOrderItemRecord", "quantityOrdered", "INTEGER", false, false],
        "orderItems/*/proceeds/proceedsTotal/amount": ["order_item.proceeds", "AmazonOrderItemRecord", "proceedsOriginal", "DECIMAL_TEXT", true, true],
        "orderItems/*/proceeds/proceedsTotal/currencyCode": ["order_item.currency", "AmazonOrderItemRecord", "currencyCode", "STRING", true, false],
      };
      const detail = path.startsWith(prefix) ? detailFields[path.slice(prefix.length)] : undefined;
      if (detail) return { fieldId: detail[0], targetTable: detail[1], targetColumn: detail[2], dataType: detail[3], nullable: detail[4], timeSemantics: null, currencyRequired: detail[5], parserVersion: orderParserVersion, transform: detail[5] ? "parseOrderDetail.parseOrderMoney:exact-decimal-string;paired-currency;missing-is-null" : "parseOrderDetail" };
    }
    const match = path.startsWith(prefix) ? fields[path.slice(prefix.length)] : undefined;
    if (match) return { fieldId: match[0], targetTable: "AmazonOrderRecord", targetColumn: match[1], dataType: match[2], nullable: match[3], timeSemantics: match[4], currencyRequired: false, parserVersion: orderParserVersion, transform: "parseOrderPage" };

  }
  if (isInventoryReport(resource) && sourceCode === inventoryReportTypes[resource] && apiVersion === "2021-06-30" && path.startsWith("/columns/")) {
    const header = path.slice(9).replace(/~1/g, "/").replace(/~0/g, "~");
    return { fieldId: resource + "." + header, targetTable: "AmazonSyncReportRow", targetColumn: "fields." + header, dataType: "STRING",
      nullable: false, timeSemantics: "CURRENT_SNAPSHOT_ONLY", currencyRequired: false, parserVersion: inventoryReportParserVersion,
      transform: "parseInventoryReport:exact-source-header-and-cell;empty-string-preserved;no-numeric-coercion" };
  }
  const reports: Record<string, string> = { settlements: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", reimbursements: "GET_FBA_REIMBURSEMENTS_DATA", inventory_events: "GET_LEDGER_DETAIL_VIEW_DATA", inventory_age: "GET_FBA_INVENTORY_PLANNING_DATA" };
  if (apiVersion !== "2021-06-30" || !reports[resource] || reports[resource] !== sourceCode || !path.startsWith("/columns/")) return null;
  // Matches parseDomainReport's header normalization exactly. Aliases stay
  // independent L0 fields; this describes the parser's precedence, not a merge.
  const header = path.slice(9).replace(/~1/g, "/").replace(/~0/g, "~").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const columns: Record<string, [string, string, string]> = {
    currency: ["currency", "currencyCode", "STRING"], "currency-unit": ["currency", "currencyCode", "STRING"], "currency-code": ["currency", "currencyCode", "STRING"],
    amount: ["amount", "amountOriginal", "DECIMAL_TEXT"], "amount-total": ["amount", "amountOriginal", "DECIMAL_TEXT"], "amount-per-unit": ["amount", "amountOriginal", "DECIMAL_TEXT"],
    "order-id": ["amazon_order_id", "orderId", "STRING"], "amazon-order-id": ["amazon_order_id", "orderId", "STRING"],
    sku: ["seller_sku", "sellerSku", "STRING"], "seller-sku": ["seller_sku", "sellerSku", "STRING"], asin: ["asin", "asin", "STRING"],
  };
  if (resource === "inventory_events") columns.msku = ["seller_sku", "sellerSku", "STRING"];
  if (resource !== "settlements") {
    for (const quantity of resource === "inventory_events" ? ["quantity-purchased", "quantity-reimbursed-total", "quantity", "reconciled-quantity", "unreconciled-quantity"] : ["quantity-purchased", "quantity-reimbursed-total"]) {
      columns[quantity] = ["quantity", "quantityOriginal", "DECIMAL_TEXT"];
    }
  }
  if (resource === "inventory_events") {
    columns["reconciled-quantity"] = ["reconciled_quantity", "fields.reconciled-quantity", "STRING"];
    columns["unreconciled-quantity"] = ["unreconciled_quantity", "fields.unreconciled-quantity", "STRING"];
  }
  const match = columns[header];
  const savedCells: Record<string, readonly string[]> = {
    reimbursements: ["fnsku", "reimbursement-id", "reason", "quantity-reimbursed-cash", "quantity-reimbursed-inventory", "original-reimbursement-id", "original-reimbursement-type"],
    inventory_events: ["fnsku", "event-type", "reference-id", "reason", "disposition", "fulfillment-center", "fulfillment-center-id", "country"],
    inventory_age: ["fnsku", "available"],
  };
  if (match?.[1].startsWith("fields.") || !match && (savedCells[resource]?.includes(header) || resource === "inventory_age" && isInventoryAgeBucket(header))) return {
    fieldId: `${resource}.${header.replace(/-/g, "_")}`, targetTable: "AmazonSyncReportRow", targetColumn: `fields.${header}`,
    dataType: "STRING", nullable: true, timeSemantics: null, currencyRequired: false, parserVersion: "domain-reports.v2",
    transform: "parseDomainReport:safeFields;exact-normalized-header;trimmed-source-text;missing-is-null;no-numeric-coercion",
  };
  // Settlement header totals are not a transaction amount mapping.
  if (!match || resource === "settlements" && ["amount-total", "amount-per-unit"].includes(header)) return null;
  return { fieldId: `${resource}.${match[0]}`, targetTable: resource === "settlements" ? "AmazonSettlementRow" : "AmazonSyncReportRow", targetColumn: match[1], dataType: match[2], nullable: true, timeSemantics: null,
    currencyRequired: match[0] === "amount", parserVersion: resource === "settlements" ? "settlements.v3" : "domain-reports.v2", transform: resource === "settlements" ? "parseDomainReport:amount-only;currency-first-non-empty(currency,currency-unit,currency-code);unique-same-settlement-header-fallback;conflict-is-null" : "parseDomainReport.optional:first-non-empty;amount-before-amount-total-before-total-amount-before-amount-per-unit;currency-before-currency-unit-before-currency-code" };
}
