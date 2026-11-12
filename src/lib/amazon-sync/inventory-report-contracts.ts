import contracts from "@/data/amazon-contracts/inventory-reports-p01.json";
import type { NormalizedDomainReport } from "./domain-reports";
import { createHash } from "node:crypto";
import { SyncInputError } from "./policy";

export const inventoryReportTypes = {
  fba_fulfilled_inventory: "GET_AFN_INVENTORY_DATA",
  fba_inventory_by_country: "GET_AFN_INVENTORY_DATA_BY_COUNTRY",
  storage_fees: "GET_FBA_STORAGE_FEE_CHARGES_DATA",
  fba_inventory_report: "GET_FBA_MYI_ALL_INVENTORY_DATA",
  reserved_inventory: "GET_RESERVED_INVENTORY_DATA",
  stranded_inventory: "GET_STRANDED_INVENTORY_UI_DATA",
  recommended_removals: "GET_FBA_RECOMMENDED_REMOVAL_DATA",
  fba_overage_fees: "GET_FBA_OVERAGE_FEE_CHARGES_DATA",
  fee_preview: "GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA",
} as const;
export type InventoryReportResource = keyof typeof inventoryReportTypes;
export const inventoryReportResources = Object.keys(inventoryReportTypes) as InventoryReportResource[];
export const isInventoryReport = (resource: string): resource is InventoryReportResource => Object.hasOwn(inventoryReportTypes, resource);
export const fbaInventoryByCountryMarketplaceIds = ["A1PA6795UKMFR9", "A1RKKUPIHCS9HS", "A13V1IB3VIYZZH", "A1F83G8C2ARO7P", "APJ6JRA9NG5V4", "A1805IZSGTT6HS", "A2NODRKZP88ZB9", "A1C3SOZRARQ6R3", "AMEN7PMS3EDWL"] as const;
export function fbaInventoryByCountryMarketplaceAllowed(marketplaceId: string) { return (fbaInventoryByCountryMarketplaceIds as readonly string[]).includes(marketplaceId); }
export const inventoryReportContract = (resource: InventoryReportResource) => contracts.find(row => row.resource === resource)!;
export const inventoryReportParserVersion = "inventory-reports.tsv.v1";
const required = {
  fba_fulfilled_inventory: ["seller-sku", "fulfillment-channel-sku", "asin", "Quantity Available"],
  fba_inventory_by_country: ["seller-sku", "fulfillment-channel-sku", "asin", "condition-type", "country", "quantity-for-local-fulfillment"],
  storage_fees: ["asin", "fnsku", "month_of_charge", "estimated_monthly_storage_fee", "currency"],
  fba_inventory_report: ["sku", "fnsku", "asin", "afn-fulfillable-quantity"],
  reserved_inventory: ["sku", "fnsku", "asin", "reserved_qty"],
  stranded_inventory: ["sku", "fnsku", "asin", "stranded-reason", "fulfillable-qty"],
  recommended_removals: ["snapshot-date", "sku", "fnsku", "asin", "sellable-quantity", "sellable-removal-quantity", "unsellable-quantity"],
  fba_overage_fees: ["charged_date", "country_code", "storage_type", "charge_rate", "storage_usage_volume", "storage_limit_volume", "overage_volume", "volume_unit", "charged_fee_amount", "currency_code"],
  fee_preview: ["sku", "fnsku", "asin", "amazon-store", "fulfilled-by", "currency", "estimated-fee-total", "estimated-referral-fee-per-unit"],
} as const;
export const recommendedRemovalQuantityFields = ["sellable-quantity", "sellable-121-180-days", "sellable-181-270-days", "sellable-271-365-days", "sellable-365+-days", "sellable-removal-quantity", "unsellable-quantity", "unsellable-0-7-days", "unsellable-8-60-days", "unsellable-61-90-days"] as const;
export function recommendationFieldName(name: string) { return name.replace(/ \(available in the (?:US, JP, and EU|US|JP|EU) stores\)$/i, ""); }
/** A report is a versioned snapshot. Preserve exact source column names and
 * values, including empty strings and unknown columns. Never turn blank into 0,
 * parse decimal cells through Number, or invent past inventory balances. */
export function parseInventoryReport(resource: InventoryReportResource, iterator: Generator<string[]>, options: { offset?: number; limit?: number }): NormalizedDomainReport {
  const first = iterator.next();
  const headers: string[] | undefined = first.done ? undefined : first.value;
  const invalid = (): never => { throw new SyncInputError("INVENTORY_REPORT_SCHEMA: 报告结构或行身份无效；保留原件及旧发布版本。", 422); };
  if (first.done || !headers?.length || headers.length > 100 || headers.some(h => !h || h.length > 200 || /[\u0000-\u001f\u007f]/.test(h)) || new Set(headers).size !== headers.length || !required[resource].every(h => headers.includes(h))) return invalid();
  if (resource === "fba_overage_fees") {
    const rows: NormalizedDomainReport["rows"] = [];
    let rowCount = 0;
    const seen = new Set<string>();
    for (const cells of iterator) {
      if (++rowCount > 50000 || cells.length !== headers.length) return invalid();
      const fields = Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
      const date = fields.charged_date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || !fields.country_code.trim() || !fields.storage_type.trim() || !fields.volume_unit.trim() || fields.charged_fee_amount !== "" && !/^-?\d+(?:\.\d+)?$/.test(fields.charged_fee_amount) || !/^[A-Z]{3}$/.test(fields.currency_code)) return invalid();
      for (const name of ["charge_rate", "storage_usage_volume", "storage_limit_volume", "overage_volume"]) if (fields[name] !== "" && !/^-?\d+(?:\.\d+)?$/.test(fields[name])) return invalid();
      const key = JSON.stringify([date, fields.country_code, fields.storage_type, fields.volume_unit]);
      if (seen.has(key)) return invalid();
      seen.add(key);
      const hash = createHash("sha256").update(JSON.stringify(headers.map(h => [h, fields[h]]))).digest("hex");
      if (rowCount <= (options.offset ?? 0) || options.limit !== undefined && rows.length >= options.limit) continue;
      rows.push({ rowNumber: rowCount, rowHash: hash, businessDateRaw: date, businessDate: date, orderId: null, sellerSku: null, asin: null, transactionType: fields.storage_type, amountType: "ESTIMATED_OVERAGE_FEE", amountDescription: fields.storage_type, amountOriginal: fields.charged_fee_amount || null, currencyCode: fields.currency_code, quantityOriginal: fields.overage_volume || null, fields });
    }
    return { headers, rows, rowCount, dateField: "charged_date; estimated snapshot, not posted charge" };
  }
  if (resource === "fee_preview") {
    const rows: NormalizedDomainReport["rows"] = [];
    let rowCount = 0;
    const seen = new Set<string>();
    for (const cells of iterator) {
      if (++rowCount > 50000 || cells.length !== headers.length) return invalid();
      const fields = Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
      if (!["estimated-fee-total", "estimated-referral-fee-per-unit"].some(name => fields[name] === "" || /^-?\d+(?:\.\d+)?$/.test(fields[name]))) return invalid();
      const key = JSON.stringify([fields.sku, fields.fnsku, fields.asin, fields["amazon-store"]]);
      if ([fields.sku, fields.fnsku, fields.asin, fields["amazon-store"]].some(value => !value.trim()) || seen.has(key) || !/^[A-Z]{3}$/.test(fields.currency)) return invalid();
      for (const [name, value] of Object.entries(fields)) if (/fee|price/i.test(name) && value !== "" && !/^-?\d+(?:\.\d+)?$/.test(value)) return invalid();
      seen.add(key);
      const rowHash = createHash("sha256").update(JSON.stringify(headers.map(h => [h, fields[h]]))).digest("hex");
      if (rowCount <= (options.offset ?? 0) || options.limit !== undefined && rows.length >= options.limit) continue;
      rows.push({ rowNumber: rowCount, rowHash, businessDateRaw: null, businessDate: null, orderId: null, sellerSku: fields.sku, asin: fields.asin, transactionType: fields["fulfilled-by"] || null, amountType: "ESTIMATED_FBA_FEES", amountDescription: null, amountOriginal: fields["estimated-fee-total"] || null, currencyCode: fields.currency, quantityOriginal: null, fields });
    }
    return { headers, rows, rowCount, dateField: "capturedAt; current fee estimate snapshot, not historical charges" };
  }
  const rows: NormalizedDomainReport["rows"] = [];
  let rowCount = 0;
  const seen = new Map<string, string>();
  for (const cells of iterator) {
    if (++rowCount > 50000 || cells.length !== headers.length) return invalid();
    const fields = Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
    const sku = fields.sku ?? fields["seller-sku"] ?? null;
    const fnsku = fields.fnsku ?? fields["fulfillment-channel-sku"];
    if ((resource !== "storage_fees" && !sku?.trim()) || !fnsku?.trim() || !fields.asin?.trim()) return invalid();
    if (resource === "fba_inventory_by_country" && !fields.country.trim()) return invalid();
    const amount = fields["estimated_monthly_storage_fee"] ?? fields["your-price"] ?? null;
    if (resource === "recommended_removals") {
      const rawDate = fields["snapshot-date"], day = rawDate.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d))?$/.test(rawDate) || !Number.isFinite(Date.parse(rawDate)) || new Date(day).toISOString().slice(0, 10) !== day) return invalid();
      for (const [name, value] of Object.entries(fields)) if (recommendedRemovalQuantityFields.includes(recommendationFieldName(name) as typeof recommendedRemovalQuantityFields[number]) && value !== "" && !/^\d+$/.test(value)) return invalid();
      for (const name of ["sellable-quantity", "sellable-removal-quantity", "unsellable-quantity"]) if (!fields[name]) return invalid();
    }
    // Validate known numeric cells without losing their original precision.
    for (const [name, value] of Object.entries(fields)) {
      if (resource === "recommended_removals" || !value || !(/quantity|qty/i.test(name) || name.startsWith("reserved_"))) continue;
      if (!(resource === "storage_fees" ? /^\d+(?:\.\d+)?$/.test(value) : /^\d+$/.test(value))) return invalid();
    }
    if (amount !== null && amount !== "" && !/^-?\d+(?:\.\d+)?$/.test(amount)) return invalid();
    if (resource === "storage_fees" && (!/^\d{4}-\d{2}$/.test(fields.month_of_charge) || !/^[A-Z]{3}$/.test(fields.currency))) return invalid();
    const hash = createHash("sha256").update(JSON.stringify(headers.map(h => [h, fields[h]]))).digest("hex");
    const key = JSON.stringify([sku, fnsku, fields.asin, fields.condition ?? fields["condition-type"] ?? null, fields.program ?? null, fields.store ?? fields.country_code ?? fields.country ?? null, fields.month_of_charge ?? null]);
    if (seen.has(key)) return invalid(); // duplicate snapshot identities cannot be added twice
    seen.set(key, hash);
    if (rowCount <= (options.offset ?? 0) || options.limit !== undefined && rows.length >= options.limit) continue;
    rows.push({ rowNumber: rowCount, rowHash: hash, businessDateRaw: null, businessDate: null,
      orderId: null, sellerSku: sku, asin: fields.asin, transactionType: null,
      amountType: null, amountDescription: null, amountOriginal: amount || null, currencyCode: fields.currency ?? null,
      quantityOriginal: fields["afn-fulfillable-quantity"] ?? fields["quantity-for-local-fulfillment"] ?? fields.reserved_qty ?? fields["fulfillable-qty"] ?? fields["Quantity Available"] ?? fields.average_quantity_on_hand ?? null, fields });
  }
  if (resource === "recommended_removals") for (const row of rows) {
    row.businessDateRaw = row.fields["snapshot-date"] ?? null;
    row.businessDate = row.businessDateRaw?.slice(0, 10) ?? null;
    row.quantityOriginal = null;
  }
  return { headers, rows, rowCount, dateField: resource === "recommended_removals" ? "snapshot-date; CURRENT_RECOMMENDATION_SNAPSHOT" : "capturedAt; CURRENT_SNAPSHOT_ONLY" };
}
