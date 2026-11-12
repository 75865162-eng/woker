import test from "node:test";
import assert from "node:assert/strict";
import { parseDomainReport, assertDomainReportRoles, domainReportTypes, fbaShipmentsRunWindow, removalOrderRunWindow } from "@/lib/amazon-sync/domain-reports";
import { nextAutomaticRemovalOrderWindow } from "@/lib/amazon-sync/automatic-schedule";
import { inventoryReportResources, inventoryReportTypes, inventoryReportContract } from "@/lib/amazon-sync/inventory-report-contracts";
import { automaticAdapter } from "@/lib/amazon-sync/automatic-adapters";
import { datasetForTable } from "@/lib/amazon-sync/mcp-datasets";
import { reportBusinessFields } from "@/lib/amazon-sync/report-business-fields";
import { automaticMarketplaceAllowed } from "@/lib/amazon-sync/automatic-schedule";

test("FBA fulfilled shipments windows, parser, PII exclusion and automatic publication contract", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const window = fbaShipmentsRunWindow({ from: "2026-10-11", to: "2026-11-09" }, now);
  const text = "amazon-order-id\tshipment-id\tshipment-item-id\tshipment-date\tsku\tquantity-shipped\tcurrency\titem-price\tcarrier\ttracking-number\tbuyer-email\tship-address-1\tfuture-column\norder-1\tship-1\titem-1\t2026-11-08T12:00:00Z\tsku-1\t9007199254740993123\tUSD\t12345678901234567890.123400\tCarrier\t0000123\tprivate@example.invalid\t1 Main St\tunknown";
  const parsed = parseDomainReport("fba_shipments", text, { fbaShipmentsWindow: window });
  const row = parsed.rows[0];
  assert.equal(row.businessDate, "2026-11-08");
  assert.equal(row.quantityOriginal, "9007199254740993123");
  assert.equal(row.fields["item-price"], "12345678901234567890.123400");
  assert.equal(row.fields.carrier, "Carrier");
  assert.equal("buyer-email" in row.fields, false);
  assert.equal("ship-address-1" in row.fields, false);
  assert.equal("future-column" in row.fields, false);
  assert.equal(automaticAdapter("fba_shipments")?.executionKind, "domain_report");
  assert.equal(datasetForTable("fba_shipments").publicationPolicy, "latest_published_report_or_explicit_report_version");
  assert.throws(() => fbaShipmentsRunWindow({ from: "2026-10-01", to: "2026-10-31" }, now));
  assert.throws(() => fbaShipmentsRunWindow({ from: "2026-11-10", to: "2026-11-10" }, now));
  assert.throws(() => parseDomainReport("fba_shipments", text.replace("2026-11-08T12:00:00Z", "2026-09-08T12:00:00Z"), { fbaShipmentsWindow: window }));
  assert.throws(() => assertDomainReportRoles("fba_shipments", { approvedRoles: ["Finance and Accounting"], rolesAttestedAt: now }));
  assert.doesNotThrow(() => assertDomainReportRoles("fba_shipments", { approvedRoles: ["Inventory and Order Tracking"], rolesAttestedAt: now }));
});

test("FBA customer shipment sales is an automatic PII-filtered latest snapshot report", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const text = [
    "shipment-date\tsku\tfnsku\tasin\tfulfillment-center-id\tquantity\tamazon-order-id\tcurrency\titem-price-per-unit\tshipping-price\tgift-wrap-price\tpoints-granted\tship-city\tship-state\tship-postal-code",
    "2026-11-09T12:30:00Z\tSKU-1\tFNSKU-1\tB000000001\tONT8\t2\tORDER-1\tUSD\t12.3400\t0.00\t1.25\t0\tSeattle\tWA\t98101",
  ].join("\n");
  const parsed = parseDomainReport("fba_customer_sales", text);
  assert.equal(domainReportTypes.fba_customer_sales, "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA");
  assert.equal(parsed.rowCount, 1);
  assert.equal(parsed.rows[0].quantityOriginal, "2");
  assert.equal(parsed.rows[0].amountOriginal, "12.3400");
  assert.equal(parsed.rows[0].fields["shipping-price"], "0.00");
  assert.equal("ship-city" in parsed.rows[0].fields, false);
  assert.equal("ship-state" in parsed.rows[0].fields, false);
  assert.equal("ship-postal-code" in parsed.rows[0].fields, false);
  assert.equal(automaticAdapter("fba_customer_sales")?.plannerKind, "snapshot");
  assert.equal(datasetForTable("fba_customer_sales").publicationPolicy, "latest_published_report_or_explicit_report_version");
  assert.doesNotThrow(() => assertDomainReportRoles("fba_customer_sales", { approvedRoles: ["Amazon Fulfillment"], rolesAttestedAt: now }));
  assert.throws(() => assertDomainReportRoles("fba_customer_sales", { approvedRoles: ["Pricing"], rolesAttestedAt: now }));
  assert.throws(() => parseDomainReport("fba_customer_sales", text.replace("\t2\tORDER-1", "\t2.5\tORDER-1")));
});
test("multi-country inventory scheduling is limited to registered European marketplaces", () => {
  assert.equal(automaticMarketplaceAllowed("fba_inventory_by_country", "A1PA6795UKMFR9"), true);
  assert.equal(automaticMarketplaceAllowed("fba_inventory_by_country", "ATVPDKIKX0DER"), false);
  assert.equal(automaticAdapter("fba_inventory_by_country")?.intervalMinutes, 60);
});

const fixtures: Record<string, string> = {
  fee_preview: "sku\tfnsku\tasin\tamazon-store\tfulfilled-by\tcurrency\testimated-fee-total\testimated-referral-fee-per-unit\tproduct-size-tier\textra\nSKU-1\tFNSKU-1\tB012345678\tAmazon.com\tAMAZON\tUSD\t12345678901234567890.123400\t2.2500\tLarge Standard-Size\tunknown",
  fba_overage_fees: "charged_date\tcountry_code\tstorage_type\tcharge_rate\tstorage_usage_volume\tstorage_limit_volume\toverage_volume\tvolume_unit\tcharged_fee_amount\tcurrency_code\tfuture_field\n2026-11-10\tUS\tSTANDARD\t12345678901234567890.1234\t12.5\t10\t2.5\tcubic_feet\t98765432109876543210.123400\tUSD\tunknown",
  fba_inventory_by_country: "seller-sku\tfulfillment-channel-sku\tasin\tcondition-type\tcountry\tquantity-for-local-fulfillment\tnew-field\nmerchant-sku\tfnsku-1\tB012345678\tNew\tDE\t9007199254740993123\tunknown",
  recommended_removals: "snapshot-date\tsku\tfnsku\tasin\tcondition\tsellable-quantity\tsellable-removal-quantity\tunsellable-quantity\tsellable-365+-days\tnew-field\n2026-11-10\tsku1\tfn1\tB012345678\tNew\t9007199254740993123\t2\t0\t3\tunknown",
  storage_fees: "asin\tfnsku\tproduct_name\taverage_quantity_on_hand\tmonth_of_charge\tcurrency\testimated_monthly_storage_fee\tnew-field\nB012345678\tfn1\tfixture-sku\t1.25\t2026-10\tUSD\t12345678901234567890.123400\tunknown",
  fba_fulfilled_inventory: "seller-sku\tfulfillment-channel-sku\tasin\tcondition-type\tWarehouse-Condition-code\tQuantity Available\nmerchant-sku\tfnsku-1\tB012345678\tNew\tSELLABLE\t9007199254740993123",
  fba_inventory_report: "sku\tfnsku\tasin\tafn-fulfillable-quantity\tyour-price\tnew-field\nsku1\tfn1\tB012345678\t9007199254740993123\t123456789.123456789\t",
  reserved_inventory: "sku\tfnsku\tasin\treserved_qty\treserved_customerorders\tnew-field\nsku1\tfn1\tB012345678\t4\t3\tunknown",
  stranded_inventory: "sku\tfnsku\tasin\tstranded-reason\tfulfillable-qty\tnew-field\nsku1\tfn1\tB012345678\tLISTING_ERROR\t2\tunknown",
};
test("FBA fee preview retains exact estimates and enforces estimate-only semantics", () => {
  const parsed = parseDomainReport("fee_preview", fixtures.fee_preview);
  const row = parsed.rows[0];
  assert.equal(domainReportTypes.fee_preview, "GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA");
  assert.equal(row.amountOriginal, "12345678901234567890.123400");
  assert.equal(row.currencyCode, "USD");
  assert.equal(row.fields.extra, "unknown");
  assert.equal(reportBusinessFields("fee_preview", row.fields).historySemantics, "CURRENT_FEE_ESTIMATE_SNAPSHOT_ONLY_NOT_POSTED_CHARGE");
  assert.equal(automaticAdapter("fee_preview")?.intervalMinutes, 1440);
  assert.deepEqual(automaticAdapter("fee_preview")?.requiredAnyRoles, ["Pricing", "Amazon Fulfillment"]);
  assert.equal(datasetForTable("fee_preview").publicationPolicy, "latest_published_report_or_explicit_report_version");
  assert.throws(() => parseDomainReport("fee_preview", fixtures.fee_preview.replace("12345678901234567890.123400", "NaN")));
  assert.throws(() => parseDomainReport("fee_preview", fixtures.fee_preview + "\n" + fixtures.fee_preview.split("\n")[1]));
  assert.doesNotThrow(() => assertDomainReportRoles("fee_preview", { approvedRoles: ["Pricing"], rolesAttestedAt: new Date() }));
  assert.throws(() => assertDomainReportRoles("fee_preview", { approvedRoles: ["Finance and Accounting"], rolesAttestedAt: new Date() }));
});
test("FBA overage fees retain exact estimate fields as versioned request snapshots", () => {
  const parsed = parseDomainReport("fba_overage_fees", fixtures.fba_overage_fees);
  const row = parsed.rows[0];
  assert.equal(domainReportTypes.fba_overage_fees, "GET_FBA_OVERAGE_FEE_CHARGES_DATA");
  assert.equal(row.businessDate, "2026-11-10");
  assert.equal(row.amountOriginal, "98765432109876543210.123400");
  assert.equal(row.currencyCode, "USD");
  assert.equal(row.quantityOriginal, "2.5");
  assert.equal(row.fields.charge_rate, "12345678901234567890.1234");
  assert.equal(row.fields.future_field, "unknown");
  assert.equal(automaticAdapter("fba_overage_fees")?.requiredAnyRoles?.includes("Amazon Fulfillment"), true);
  assert.equal(datasetForTable("fba_overage_fees").publicationPolicy, "latest_published_report_or_explicit_report_version");
  assert.deepEqual(inventoryReportContract("fba_overage_fees").rawFields, ["charged_date", "country_code", "storage_type", "charge_rate", "storage_usage_volume", "storage_limit_volume", "overage_volume", "volume_unit", "charged_fee_amount", "currency_code"]);
  assert.doesNotThrow(() => assertDomainReportRoles("fba_overage_fees", { approvedRoles: ["Amazon Fulfillment"], rolesAttestedAt: new Date() }));
  assert.throws(() => assertDomainReportRoles("fba_overage_fees", { approvedRoles: ["Pricing"], rolesAttestedAt: new Date() }));
  assert.throws(() => parseDomainReport("fba_overage_fees", fixtures.fba_overage_fees.replace("\tUSD\tunknown", "\tUSD")));
  assert.throws(() => parseDomainReport("fba_overage_fees", fixtures.fba_overage_fees.replace("98765432109876543210.123400", "NaN")));
});
test("removal shipments preserve separate dates, exact quantity, tracking and unknown fields", () => {
  const text = "request-date\torder-id\tshipment-date\tsku\tfnsku\tshipped-quantity\tcarrier\ttracking-number\tshipment-status\tunknown_field\n2026-11-01\torder1\t2026-11-08\tsku1\tfn1\t9007199254740993123\tcarrier\t00012345678901234567890\tShipped\t";
  const parsed = parseDomainReport("removal_shipment_report", text, { removalOrderWindow: removalOrderRunWindow({ from: "2026-11-09", to: "2026-11-09" }, new Date("2026-11-10T12:00:00Z")) });
  const row = parsed.rows[0];
  assert.equal(row.businessDate, "2026-11-08");
  assert.equal(row.quantityOriginal, "9007199254740993123");
  assert.equal(row.fields["request-date"], "2026-11-01");
  assert.equal(row.fields["tracking-number"], "00012345678901234567890");
  assert.equal(row.fields.unknown_field, "");
  assert.equal(row.amountOriginal, null);
  assert.equal(reportBusinessFields("removal_shipment_report", row.fields).shipmentStatus, "Shipped");
  assert.equal(automaticAdapter("removal_shipment_report")?.executionKind, "domain_report");
  assert.equal(datasetForTable("removal_shipment_report").resource, "removal_shipment_report");
  assert.throws(() => parseDomainReport("removal_shipment_report", text.replace("9007199254740993123", "-1")));
  assert.throws(() => parseDomainReport("removal_shipment_report", text.replace("2026-11-08", "2026-02-30")));
  assert.throws(() => parseDomainReport("removal_shipment_report", text.replace("shipped-quantity", "missing")));
  assert.throws(() => assertDomainReportRoles("removal_shipment_report", { approvedRoles: [], rolesAttestedAt: null }));
});
test("removal order exact fields, frozen dates and invalid data", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const window = removalOrderRunWindow({ from: "2026-11-09", to: "2026-11-09" }, now);
  const text = "request-date\torder-id\tsku\trequested-quantity\tremoval-fee\tcurrency\tunknown_field\n2026-11-09\torder1\tsku1\t9007199254740993123\t12345678901234567890.123400\tUSD\t";
  const parsed = parseDomainReport("removal_order_report", text, { removalOrderWindow: window });
  assert.equal(parsed.rows[0].amountOriginal, "12345678901234567890.123400");
  assert.equal(parsed.rows[0].quantityOriginal, "9007199254740993123");
  assert.equal(parsed.rows[0].fields.unknown_field, "");
  assert.equal(parsed.rows[0].businessDate, window.from);
  assert.equal(parseDomainReport("removal_order_report", text, { offset: 1 }).rows.length, 0);
  for (const invalid of [text.replace("9007199254740993123", "-1"), text.replace("12345678901234567890.123400", "NaN"), text.replace("2026-11-09", "2026-11-08"), text.replace("2026-11-09", "2026-02-30")]) {
    assert.throws(() => parseDomainReport("removal_order_report", invalid, { removalOrderWindow: window }));
  }
  assert.throws(() => removalOrderRunWindow({ from: "2026-11-10", to: "2026-11-10" }, now));
  assert.throws(() => removalOrderRunWindow({ ...window, dataEndTime: "2026-11-09T12:00:00Z" }, now));
  assert.throws(() => assertDomainReportRoles("removal_order_report", { approvedRoles: [], rolesAttestedAt: null }));
  assert.doesNotThrow(() => assertDomainReportRoles("removal_order_report", { approvedRoles: ["Amazon Fulfillment"], rolesAttestedAt: now }));
});
test("removal order automatic window resumes failures, catches up daily and stops when caught up", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const first = nextAutomaticRemovalOrderWindow(null, now)!;
  assert.equal(first.from, "2026-11-09");
  const cursor = { watermarkFrom: new Date(first.dataStartTime), watermarkTo: new Date(first.dataEndTime), status: "FAILED" };
  assert.deepEqual(nextAutomaticRemovalOrderWindow(cursor, now), first);
  assert.equal(nextAutomaticRemovalOrderWindow({ ...cursor, status: "SUCCEEDED" }, now), null);
  assert.equal(nextAutomaticRemovalOrderWindow({ ...cursor, status: "SUCCEEDED" }, new Date("2026-11-12T12:00:00Z"))?.from, "2026-11-10");
});
for (const resource of inventoryReportResources) {
  test(resource + ": official identity, exact cells, unknowns, batching and snapshot semantics", () => {
    assert.equal(inventoryReportContract(resource).reportType, inventoryReportTypes[resource]);
    const parsed = parseDomainReport(resource, fixtures[resource]);
    assert.equal(parsed.rowCount, 1);
    assert.equal(parsed.rows[0].businessDate, resource === "recommended_removals" || resource === "fba_overage_fees" ? "2026-11-10" : null);
    if ("new-field" in parsed.rows[0].fields) assert.equal(parsed.rows[0].fields["new-field"], resource === "fba_inventory_report" ? "" : "unknown");
    assert.equal(parseDomainReport(resource, fixtures[resource], { offset: 1, limit: 500 }).rows.length, 0);
    assert.equal(automaticAdapter(resource)?.executionKind, "domain_report");
    assert.equal(automaticAdapter(resource)?.plannerKind, "snapshot");
    assert.equal(datasetForTable(resource).publicationPolicy, "latest_published_report_or_explicit_report_version");
    assert.equal(reportBusinessFields(resource, parsed.rows[0].fields).snapshotSemantics, resource === "storage_fees" ? "LATEST_REPORTED_MONTHLY_ESTIMATE_DO_NOT_SUM_VERSIONS" : resource === "fba_inventory_by_country" ? "CURRENT_MCI_COUNTRY_SNAPSHOT_DO_NOT_SUM_VERSIONS" : resource === "fba_overage_fees" || resource === "fee_preview" ? undefined : "CURRENT_SNAPSHOT_DO_NOT_SUM_VERSIONS");
    if (resource === "fba_inventory_by_country") {
      assert.equal(domainReportTypes[resource], "GET_AFN_INVENTORY_DATA_BY_COUNTRY");
      assert.equal(parsed.rows[0].quantityOriginal, "9007199254740993123");
      assert.equal(parsed.rows[0].fields.country, "DE");
      const twoCountries = fixtures[resource].replace("DE\t", "DE\t9007199254740993123\tunknown\nmerchant-sku\tfnsku-1\tB012345678\tNew\tFR\t");
      assert.equal(parseDomainReport(resource, twoCountries).rows.length, 2);
      assert.throws(() => parseDomainReport(resource, fixtures[resource].replace("DE\t", "\t")));
      assert.throws(() => parseDomainReport(resource, fixtures[resource] + "\n" + fixtures[resource].split("\n")[1]));
    }
    if (resource === "recommended_removals") {
      assert.equal(parsed.rows[0].quantityOriginal, null);
      assert.equal(parsed.dateField, "snapshot-date; CURRENT_RECOMMENDATION_SNAPSHOT");
      assert.equal((reportBusinessFields(resource, parsed.rows[0].fields).quantities as Record<string, string>)["sellable-365+-days"], "3");
      assert.equal((reportBusinessFields(resource, parsed.rows[0].fields).quantities as Record<string, string>)["sellable-121-180-days"], undefined);
      const annotated = fixtures.recommended_removals.replace("sellable-365+-days", "sellable-365+-days (available in the US, JP, and EU stores)");
      const annotatedFields = parseDomainReport(resource, annotated).rows[0].fields;
      assert.equal((reportBusinessFields(resource, annotatedFields).quantities as Record<string, string>)["sellable-365+-days"], "3");
      assert.equal(annotatedFields["sellable-365+-days (available in the US, JP, and EU stores)"], "3");
    }
    assert.throws(() => parseDomainReport(resource, fixtures[resource] + "\n" + fixtures[resource].split("\n")[1]));
    const invalidIdentity = resource === "storage_fees" || resource === "fee_preview" ? fixtures[resource].replace("B012345678", "") : resource === "fba_fulfilled_inventory" || resource === "fba_inventory_by_country" ? fixtures[resource].replace("merchant-sku", "") : resource === "fba_overage_fees" ? fixtures[resource].replace("\tUS\t", "\t\t") : fixtures[resource].replace("sku1", "");
    assert.throws(() => parseDomainReport(resource, invalidIdentity));
    assert.throws(() => assertDomainReportRoles(resource, { approvedRoles: [], rolesAttestedAt: null }));
  });
}
test("exact decimal and oversized integer cells never pass through Number", () => {
  const fee = parseDomainReport("storage_fees", fixtures.storage_fees).rows[0];
  assert.equal(fee.amountOriginal, "12345678901234567890.123400");
  assert.equal(fee.currencyCode, "USD");
  assert.equal(reportBusinessFields("storage_fees", fee.fields).monthOfCharge, "2026-10");
  const afn = parseDomainReport("fba_fulfilled_inventory", fixtures.fba_fulfilled_inventory).rows[0];
  assert.equal(afn.sellerSku, "merchant-sku");
  assert.equal(afn.quantityOriginal, "9007199254740993123");
  const row = parseDomainReport("fba_inventory_report", fixtures.fba_inventory_report).rows[0];
  assert.equal(row.amountOriginal, "123456789.123456789");
  assert.equal(row.quantityOriginal, "9007199254740993123");
  assert.throws(() => parseDomainReport("reserved_inventory", fixtures.reserved_inventory.replace("\t4\t", "\tNaN\t")));
  assert.throws(() => parseDomainReport("reserved_inventory", fixtures.reserved_inventory.replace("\t4\t", "\t-1\t")));
});
