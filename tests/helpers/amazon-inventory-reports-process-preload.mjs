// Registered Worker fixture: only mocked Amazon responses and disposable DB/Redis.
import "./amazon-offline-network-guard.mjs";
import { readFileSync, appendFileSync, existsSync, writeFileSync } from "node:fs";
const file = process.env.AMAZON_INVENTORY_REPORTS_PROCESS_FIXTURE;
if (!file || process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1") throw Error("Inventory Reports fixture required");
const fixture = JSON.parse(readFileSync(file, "utf8"));
const NativeDate = globalThis.Date;
globalThis.Date = new Proxy(NativeDate, {
  construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [NativeDate.now() + Number(readFileSync(fixture.clock, "utf8"))], newTarget); },
  get(target, key) { return key === "now" ? () => NativeDate.now() + Number(readFileSync(fixture.clock, "utf8")) : Reflect.get(target, key); },
});
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === "api.amazon.com") return Response.json({ access_token: "fixture", expires_in: 3600 });
  if (!["sellingpartnerapi-na.amazon.com", "inventory-fixture.s3.amazonaws.com"].includes(url.hostname)) throw Error("Unexpected fixture host");
  appendFileSync(fixture.calls, JSON.stringify({ path: url.pathname, method: init.method ?? "GET" }) + "\n");
  if (url.hostname === "inventory-fixture.s3.amazonaws.com") {
    if (!existsSync(fixture.release)) { writeFileSync(fixture.held, "held"); await new Promise(() => {}); }
    if (fixture.resource === "recommended_removals") return new Response("snapshot-date\tsku\tfnsku\tasin\tsellable-quantity\tsellable-removal-quantity\tunsellable-quantity\n" + Array.from({ length: 601 }, (_, i) => [fixture.day, "fixture-sku-" + i, "fn-" + i, "B012345678", "9007199254740993123", "2", "0"].join("\t")).join("\n"));
    if (fixture.resource === "long_term_storage_fees") return new Response("snapshot-date\tsku\tfnsku\tasin\tqty-charged\tamount-charged\tcurrency\tsurcharge-age-tier\n" + Array.from({ length: 601 }, (_, i) => [fixture.feeDate, "fixture-sku-" + i, "fn-" + i, "B012345678", "5", "123456789.123400", "USD", "365+"].join("\t")).join("\n"));
    if (fixture.resource === "removal_shipment_report") return new Response("request-date\torder-id\tshipment-date\tsku\tfnsku\tshipped-quantity\ttracking-number\n" + Array.from({ length: 601 }, (_, i) => [fixture.day, "removal-" + i, fixture.day, "fixture-sku-" + i, "fn-" + i, "5", "000" + i].join("\t")).join("\n"));
    if (fixture.resource === "fba_shipments") return new Response("amazon-order-id\tshipment-id\tshipment-item-id\tshipment-date\tsku\tquantity-shipped\tcurrency\titem-price\tbuyer-email\tship-address-1\n" + Array.from({ length: 601 }, (_, i) => ["order-" + i, "shipment-" + i, "item-" + i, fixture.day, "fixture-sku-" + i, "5", "USD", "12.3400", "private@example.invalid", "1 Main St"].join("\t")).join("\n"));
    if (fixture.resource === "fba_overage_fees") return new Response("charged_date\tcountry_code\tstorage_type\tcharge_rate\tstorage_usage_volume\tstorage_limit_volume\toverage_volume\tvolume_unit\tcharged_fee_amount\tcurrency_code\n" + Array.from({ length: 601 }, (_, i) => [fixture.day, "US", "STANDARD-" + i, "1.2500", "12.5", "10", "2.5", "cubic_feet", "123456789.123400", "USD"].join("\t")).join("\n"));
    if (fixture.resource === "fee_preview") return new Response("sku\tfnsku\tasin\tamazon-store\tfulfilled-by\tcurrency\testimated-fee-total\testimated-referral-fee-per-unit\textra\n" + Array.from({ length: 601 }, (_, i) => ["fixture-sku-" + i, "fn-" + i, "B012345678", "Amazon.com", "AMAZON", "USD", "123456789.123400", "2.2500", "retained"].join("\t")).join("\n"));
    return new Response("sku\tfnsku\tasin\treserved_qty\textra\n" + Array.from({ length: 601 }, (_, i) => ["fixture-sku-" + i, "fn-" + i, "B012345678", "5", "retained"].join("\t")).join("\n"));
  }
  if (url.pathname === "/reports/2021-06-30/reports" && init.method === "POST") {
    const body = JSON.parse(String(init.body));
    if (body.reportType !== fixture.reportType || body.marketplaceIds[0] !== fixture.marketplace) throw Error("Invalid report request");
    if (fixture.resource === "long_term_storage_fees") {
      if (body.dataStartTime !== fixture.feeWindow.dataStartTime || body.dataEndTime !== fixture.feeWindow.dataEndTime) throw Error("Invalid monthly fee window");
    } else if (fixture.resource === "removal_shipment_report") {
      if (body.dataStartTime !== `${fixture.day}T00:00:00Z` || body.dataEndTime !== `${fixture.day}T23:59:59Z`) throw Error("Invalid removal request window");
    } else if (fixture.resource === "fba_shipments") {
      if (body.dataStartTime !== `${fixture.fbaFrom}T00:00:00Z` || body.dataEndTime !== `${fixture.fbaTo}T23:59:59Z`) throw Error("Invalid FBA shipment request window");
    } else if (fixture.resource === "fee_preview") {
      if (Date.parse(body.dataEndTime) - Date.parse(body.dataStartTime) !== 72 * 60 * 60_000) throw Error("Invalid fee preview request window");
    } else if (body.dataStartTime !== undefined || body.dataEndTime !== undefined) throw Error("Invalid snapshot request");
    return Response.json({ reportId: "fixture-process-report" });
  }
  if (url.pathname === "/reports/2021-06-30/reports/fixture-process-report") return Response.json({ reportId: "fixture-process-report", reportType: fixture.reportType, marketplaceIds: [fixture.marketplace], processingStatus: "DONE", reportDocumentId: "fixture-process-document", ...(fixture.resource === "fba_shipments" ? { dataStartTime: `${fixture.fbaFrom}T00:00:00Z`, dataEndTime: `${fixture.fbaTo}T23:59:59Z` } : {}) });
  if (url.pathname === "/reports/2021-06-30/documents/fixture-process-document") return Response.json({ reportDocumentId: "fixture-process-document", url: "https://inventory-fixture.s3.amazonaws.com/report" });
  throw Error("Unexpected fixture operation");
};
const interval = globalThis.setInterval;
globalThis.setInterval = (callback, delay, ...args) => interval(callback, delay === 30000 ? 500 : delay, ...args);
