import { latestClosedStorageFeeMonth } from "@/lib/amazon-sync/long-term-storage-fees";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { requestChange, decideChange, applyChange } from "@/lib/amazon-sync/change-approval";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { encryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { endpoints } from "@/lib/amazon-sync/policy";
import { domainReportTypes } from "@/lib/amazon-sync/domain-reports";
import { inventoryReportResources } from "@/lib/amazon-sync/inventory-report-contracts";
import { readDomainReports } from "@/lib/amazon-sync/domain-reports-query";
import { authenticateAmazonMcp, invokeAmazonMcp, manageMcpCredential } from "@/lib/amazon-sync/mcp";
import { createErpResearchTransport } from "@/lib/lili/runtime-server";
import { ensureAmazonSyncInitialized } from "@/lib/amazon-sync/scheduler";
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1" || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw new Error("Disposable offline database required");
const site = "ATVPDKIKX0DER", otherSite = "A2EUQ1WTGCTBG2", region = "domain-reports-fixture-region", scopes: Array<[string, string]> = [];
before(() => { process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 73).toString("base64"); endpoints[region] = "https://domain-reports.fixture.invalid"; });
after(async () => { delete endpoints[region]; await getAmazonSyncQueue().close(); await prisma.$disconnect(); });

async function fresh(resource: "settlements" | "inventory_events" | "reimbursements" | "inventory_age" | "long_term_storage_fees" | "removal_shipment_report" | "removal_order_report" | "fba_shipments" | "fba_customer_sales" | "fba_inventory_by_country" | "storage_fees" | "fba_fulfilled_inventory" | "fba_inventory_report" | "reserved_inventory" | "stranded_inventory" | "recommended_removals" | "fba_overage_fees" | "fee_preview" = "settlements", multi?: "all" | "anchor", missingAttribution = false, archiveOnly = false, ranged = false) {
  const marketplaceId = resource === "fba_inventory_by_country" ? "A1PA6795UKMFR9" : site;
  const scope = { organizationId: `domain-report-fixture-${randomUUID()}`, workspaceId: "domain-report-test" };
  scopes.push([scope.organizationId, scope.workspaceId]); process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify(scopes);
  const actor = randomUUID(), approver = randomUUID(), store = randomUUID(), authorizationId = randomUUID();
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Domain reports fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Domain reports fixture" } });
  for (const id of [actor, approver]) await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: "Fixture", passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: store, accountKey: store, displayName: "Domain reports fixture", marketplaceCode: "FX" } });
  await prisma.amazonDataAccessGrant.createMany({ data: [actor, approver].map(userId => ({ ...scope, id: randomUUID(), userId, sellerAccountId: store, marketplaceIds: [marketplaceId, otherSite], actions: ["view", "sync"] })) });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authorizationId, name: "Domain reports fixture", identityVerifiedAt: new Date(), amazonSellerId: "fixture-domain-seller", awsRegion: region, endpoint: endpoints[region], status: "CONFIGURED", lastValidatedAt: new Date(), approvedRoles: ["Finance and Accounting", "Amazon Fulfillment"], rolesAttestedAt: new Date(), marketplaceParticipations: [{ marketplaceId, countryCode: resource === "fba_inventory_by_country" ? "DE" : "FX" }, ...(multi ? [{ marketplaceId: otherSite, countryCode: "CA" }] : [])], updatedByUserId: actor, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId }) } });
  async function approved(command: Record<string, unknown>) {
    const request = await requestChange(scope, actor, command), id = String(request.id);
    await decideChange(scope, approver, id, "APPROVED", "offline fixture"); await applyChange(scope, actor, id);
    return prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id } });
  }
  const configured = await approved({ action: "save-source", authorizationId, sellerAccountId: store, marketplaceId, resource, freshnessMinutes: 60, enabled: true, ...(archiveOnly ? { domainPolicy: { mode: "seller-archive-only", version: 1, publication: "quarantined" } } : {}), ...(multi && resource === "settlements" ? { settlementPolicy: { collectionMarketplaceIds: multi === "all" ? [site, otherSite] : [site] } } : {}) });
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: configured.targetId } });
  const secondSource = multi === "all" ? await approved({ action: "save-source", authorizationId, sellerAccountId: store, marketplaceId: otherSite, resource, freshnessMinutes: 60, enabled: true, ...(resource === "settlements" ? { settlementPolicy: { collectionMarketplaceIds: [site, otherSite] } } : {}) }) : null;
  const calls: URL[] = []; let reportCreateCount = 0;
  const today = new Date().toISOString().slice(0, 10), to = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10), from = new Date(Date.parse(`${to}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10), fbaTo = new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10), fbaFrom = new Date(Date.parse(`${fbaTo}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);
  const removalDay = to;
  const feeWindow = latestClosedStorageFeeMonth();
  const feeDate = feeWindow.from.slice(0, 7) + "-15";
  const ledgerWindow: { value: { dataStartTime: string; dataEndTime: string; eventType: string } | null } = { value: null };
  const eventReport = "Date\tFNSKU\tASIN\tMSKU\tTitle\tEvent Type\tReference ID\tQuantity\tFulfillment Center\tDisposition\tReason\tCountry\tReconciled Quantity\tUnreconciled Quantity\tDate and Time\tStore\tBuyer Email\n11/02/2026\tfixture-fnsku\tB012345678\tfixture-sku\tSample product\tAdjustments\tfixture-adjustment\t-2\tPHX7\tSELLABLE\tWAREHOUSE_DAMAGE\tUS\t-2\t0\t11/02/2026 08:30:00 PST\tAmazon.com\tprivate@example.invalid";
  const reportRows: Record<string, string> = {
    "fixture-settlement-1": "settlement-start-date\tsettlement-id\ttransaction-type\tamount-type\tamount-description\tamount\tcurrency\torder-id\tseller-sku\tasin\tbuyer-email\n2026-10-01\tfixture-settlement-1\tOrder\tItemPrice\tPrincipal\t12.34\tUSD\tfixture-order-1\tfixture-sku-1\tfixture-asin-1\tprivate@example.invalid",
    "fixture-settlement-2": "settlement-start-date\tsettlement-id\ttransaction-type\tamount-type\tamount-description\tamount\tcurrency\torder-id\tseller-sku\tasin\tbuyer-email\n2026-10-08\tfixture-settlement-2\tRefund\tItemPrice\tPrincipal\t-2.00\tUSD\tfixture-order-2\tfixture-sku-2\tfixture-asin-2\tother@example.invalid",
    "fixture-reimbursements": `approval-date\treimbursement-id\tsku\tasin\tamount-total\tcurrency-unit\tquantity-reimbursed-total\tstore\n${from}\tfixture-reimbursement\tfixture-sku\tB012345678\t12345678901234567890.123400\tUSD\t2\t${missingAttribution ? "" : "Amazon.com"}`,
    "fixture-inventory_age": `snapshot-date\tsku\tasin\tavailable\n${from}\tfixture-sku\tB012345678\t7`,
    "fixture-inventory-ledger": eventReport.replace("11/02/2026", new Date(`${from}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC" })),
  };
  Object.assign(reportRows, {
    "fixture-recommended_removals": `snapshot-date\tsku\tfnsku\tasin\tcondition\tsellable-quantity\tsellable-removal-quantity\tunsellable-quantity\tsellable-365+-days\textra
${today}\tfixture-sku\tfn1\tB012345678\tNew\t9007199254740993123\t2\t0\t3\tunknown`,
    "fixture-fba_overage_fees": `charged_date\tcountry_code\tstorage_type\tcharge_rate\tstorage_usage_volume\tstorage_limit_volume\toverage_volume\tvolume_unit\tcharged_fee_amount\tcurrency_code\textra
${today}\tUS\tSTANDARD\t1.2500\t12.5\t10\t2.5\tcubic_feet\t12345678901234567890.123400\tUSD\tunknown`,
    "fixture-fee_preview": "sku\tfnsku\tasin\tamazon-store\tfulfilled-by\tcurrency\testimated-fee-total\testimated-referral-fee-per-unit\tproduct-size-tier\textra\nfixture-sku\tfn1\tB012345678\tAmazon.com\tAMAZON\tUSD\t12345678901234567890.123400\t2.2500\tLarge Standard-Size\tunknown",
    "fixture-long_term_storage_fees": `snapshot-date\tsku\tfnsku\tasin\tqty-charged\tamount-charged\tcurrency\tsurcharge-age-tier\trate-surcharge\tunknown_field
${feeDate}\tfixture-sku\tfn1\tB012345678\t9007199254740993123\t12345678901234567890.123400\tUSD\t365+\t1.2500\t`,
    "fixture-fba_shipments": `amazon-order-id\tshipment-id\tshipment-item-id\tshipment-date\tsku\tquantity-shipped\tcurrency\titem-price\tcarrier\ttracking-number\tbuyer-email\tship-address-1\textra
fixture-order\tfixture-shipment\tfixture-item\t${fbaTo}\tfixture-sku\t9007199254740993123\tUSD\t12345678901234567890.123400\tCarrier\t000123\tprivate@example.invalid\t1 Main St\tunknown`,
    "fixture-fba_customer_sales": `shipment-date\tsku\tfnsku\tasin\tfulfillment-center-id\tquantity\tamazon-order-id\tcurrency\titem-price-per-unit\tshipping-price\tgift-wrap-price\tpoints-granted\tship-city\tship-state\tship-postal-code
2026-11-09T12:30:00Z\tfixture-sku\tfn1\tB012345678\tONT8\t9007199254740993123\tfixture-order\tUSD\t12345678901234567890.123400\t0.00\t1.25\t0\tSeattle\tWA\t98101`,
    "fixture-removal_shipment_report": `request-date\torder-id\tshipment-date\tsku\tfnsku\tdisposition\tshipped-quantity\tcarrier\ttracking-number\tremoval-order-type\tunknown_field
${from}\tremoval-1\t${to}\tfixture-sku\tfn1\tSELLABLE\t9007199254740993123\tFixture Carrier\t00012345678901234567890\tReturn\tkeep`,
    "fixture-removal_order_report": `request-date\torder-id\tsku\tfnsku\trequested-quantity\tremoval-fee\tcurrency\torder-status\tunknown_field
${removalDay}\tremoval-1\tfixture-sku\tfn1\t9007199254740993123\t12345678901234567890.123400\tUSD\tPending\tkeep`,
    "fixture-storage_fees": "asin\tfnsku\tproduct_name\taverage_quantity_on_hand\tmonth_of_charge\tcurrency\testimated_monthly_storage_fee\nB012345678\tfn1\tfixture-sku\t1.25\t2026-10\tUSD\t12345678901234567890.123400",
    "fixture-fba_fulfilled_inventory": "seller-sku\tfulfillment-channel-sku\tasin\tcondition-type\tWarehouse-Condition-code\tQuantity Available\nfixture-sku\tfn1\tB012345678\tNew\tSELLABLE\t7",
    "fixture-fba_inventory_report": "sku\tfnsku\tasin\tafn-fulfillable-quantity\tyour-price\textra\nfixture-sku\tfn1\tB012345678\t9007199254740993123\t123456789.123456789\t",
    "fixture-fba_inventory_by_country": "seller-sku\tfulfillment-channel-sku\tasin\tcondition-type\tcountry\tquantity-for-local-fulfillment\textra\nfixture-sku\tfn1\tB012345678\tNew\tDE\t9007199254740993123\tunknown",
    "fixture-reserved_inventory": "sku\tfnsku\tasin\treserved_qty\treserved_customerorders\textra\nfixture-sku\tfn1\tB012345678\t5\t3\tunknown",
    "fixture-stranded_inventory": "sku\tfnsku\tasin\tstranded-reason\tfulfillable-qty\textra\nfixture-sku\tfn1\tB012345678\tLISTING_ERROR\t2\tunknown",
  });
  if (missingAttribution) reportRows["fixture-inventory-ledger"] = reportRows["fixture-inventory-ledger"].replace("Amazon.com", "");
  if (multi) for (const id of ["fixture-settlement-1", "fixture-settlement-2"]) reportRows[id] = "settlement-id\tsettlement-start-date\ttransaction-type\tamount-type\tamount-description\tamount\tcurrency\tmarketplace-name\tbuyer-email\n" + ["Amazon.com", "Amazon.ca", ""].map(name => `${id}\t2026-10-01\tOrder\tItemPrice\tPrincipal\t1.00\tUSD\t${name}\tprivate@example.invalid`).join("\n");
  if (ranged) {
    const lines = reportRows["fixture-settlement-1"].split(String.fromCharCode(10));
    reportRows["fixture-settlement-1"] = [lines[0], ...Array.from({ length: 3000 }, () => lines[1])].join(String.fromCharCode(10));
  }
  const fetcher = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push(url);
    if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    assert.ok(["domain-reports.fixture.invalid", "download.fixture.invalid"].includes(url.hostname));
    if (url.hostname === "download.fixture.invalid") {
      const body = reportRows[url.pathname.split("/").at(-1)!];
      if (!ranged) return new Response(body);
      const bytes = Buffer.from(body), headers = new Headers(init?.headers);
      const range = /^bytes=([0-9]+)-([0-9]+)$/.exec(headers.get("range") ?? ""); assert.ok(range);
      const offset = Number(range[1]), end = Math.min(Number(range[2]), bytes.length - 1);
      assert.equal(headers.has("authorization"), false); if (offset) assert.equal(headers.get("if-match"), '"fixture-part"');
      return new Response(bytes.subarray(offset, end + 1), { status: 206, headers: { "content-range": `bytes ${offset}-${end}/${bytes.length}`, "content-length": String(end - offset + 1), etag: '"fixture-part"' } });
    }
    if (url.pathname === "/reports/2021-06-30/reports" && init?.method === "POST") {
      reportCreateCount++;
      const payload = JSON.parse(String(init.body)) as { reportType: string; marketplaceIds: string[]; dataStartTime: string; dataEndTime: string; reportOptions?: { eventType?: string } };
      assert.equal(payload.reportType, domainReportTypes[resource]); assert.deepEqual(payload.marketplaceIds, [marketplaceId]);
      if (resource === "long_term_storage_fees") { assert.equal(payload.dataStartTime, feeWindow.dataStartTime); assert.equal(payload.dataEndTime, feeWindow.dataEndTime); }
      else if (resource === "fee_preview") { assert.equal(Date.parse(payload.dataEndTime) - Date.parse(payload.dataStartTime), 72 * 60 * 60_000); assert.equal(payload.dataEndTime.endsWith("Z"), true); }
      else if (resource === "fba_shipments") { assert.equal(payload.dataStartTime, `${fbaFrom}T00:00:00Z`); assert.equal(payload.dataEndTime, `${fbaTo}T23:59:59Z`); }
      else if (["removal_order_report", "removal_shipment_report"].includes(resource)) { assert.equal(payload.dataStartTime, `${to}T00:00:00Z`); assert.equal(payload.dataEndTime, `${to}T23:59:59Z`); }
      else if (!["inventory_age", "storage_fees", "fba_fulfilled_inventory", "fba_inventory_report", "reserved_inventory", "stranded_inventory", "recommended_removals", "fba_customer_sales", "fba_inventory_by_country", "fba_overage_fees"].includes(resource)) { assert.equal(payload.dataStartTime, `${from}T00:00:00Z`); assert.equal(payload.dataEndTime, `${to}T23:59:59Z`); }
      if (resource === "inventory_events") assert.equal(payload.reportOptions?.eventType, "Adjustments");
      ledgerWindow.value = { dataStartTime: payload.dataStartTime, dataEndTime: payload.dataEndTime, eventType: payload.reportOptions?.eventType ?? "" };
      return Response.json({ reportId: resource === "inventory_events" ? "fixture-inventory-ledger" : `fixture-${resource}` });
    }
    if (url.pathname === "/reports/2021-06-30/reports" && url.searchParams.has("nextToken")) {
      assert.equal(url.searchParams.size, 1);
      return Response.json({ reports: [{ reportId: "fixture-settlement-2", reportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", marketplaceIds: multi ? [site, otherSite] : [site], createdTime: "2026-10-08T12:00:00Z" }] });
    }
    if (url.pathname === "/reports/2021-06-30/reports" && url.searchParams.has("reportTypes")) {
      assert.equal(url.searchParams.get("reportTypes"), "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2");
      assert.ok((multi ? [site, otherSite] : [site]).includes(url.searchParams.get("marketplaceIds")!));
      return Response.json({ reports: [{ reportId: "fixture-settlement-1", reportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", marketplaceIds: multi ? [site, otherSite] : [site], createdTime: "2026-10-01T12:00:00Z" }], nextToken: "fixture-next-page" });
    }
    if (url.pathname.startsWith("/reports/2021-06-30/reports/")) {
      const reportId = decodeURIComponent(url.pathname.split("/").at(-1)!);
      return resource !== "settlements"
        ? Response.json({ reportId, reportType: domainReportTypes[resource], marketplaceIds: multi && resource !== "fee_preview" ? [site, otherSite] : [marketplaceId], processingStatus: "DONE", reportDocumentId: reportId, createdTime: "2026-11-04T12:00:00Z", dataStartTime: ledgerWindow.value?.dataStartTime, dataEndTime: ledgerWindow.value?.dataEndTime })
        : Response.json({ reportId, reportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", marketplaceIds: multi ? [site, otherSite] : [site], processingStatus: "DONE", reportDocumentId: reportId, createdTime: reportId.endsWith("1") ? "2026-10-01T12:00:00Z" : "2026-10-08T12:00:00Z" });
    }
    if (url.pathname.startsWith("/reports/2021-06-30/documents/")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      return Response.json({ reportDocumentId: id, url: `https://download.fixture.invalid/${id}` });
    }
    throw new Error(`Unexpected fixture request ${url.pathname}`);
  };
  async function approvedRun(targetSourceId = source.id) {
    const request = await approved({ action: "run", sourceIds: [targetSourceId], ...(resource === "long_term_storage_fees" ? { dateFrom: feeWindow.from, dateTo: feeWindow.to } : resource === "inventory_events" ? { dateFrom: from, dateTo: to, eventType: "Adjustments" } : ["removal_order_report", "removal_shipment_report"].includes(resource) ? { dateFrom: to, dateTo: to } : resource === "fba_shipments" ? { dateFrom: fbaFrom, dateTo: fbaTo } : resource === "reimbursements" ? { dateFrom: from, dateTo: to } : {}) });
    return prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionApprovalId: request.id } });
  }
  async function slice(id: string, preserveBudget = false) {
    await prisma.amazonSyncRun.update({ where: { id }, data: { nextAttemptAt: new Date(0) } });
    if (!preserveBudget) await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId, operation: { not: "feePreviewDaily" } }, data: { nextRequestAt: new Date(0) } });
    const run = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
    await processSyncCenterTask(id, run.dispatchVersion, { clientOptions: { fetch: fetcher, tokenEndpoint: "https://lwa.fixture.invalid/token", reportDownloadTestHost: "download.fixture.invalid" } });
    return prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
  }
  async function finish(id: string) {
    let run = await slice(id);
    for (let i = 0; i < 40 && run.status === "WAITING"; i++) run = await slice(id);
    return run;
  }
  async function competingWorkers(id: string) {
    const live = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
    const runtime = { clientOptions: { fetch: fetcher, tokenEndpoint: "https://lwa.fixture.invalid/token", reportDownloadTestHost: "download.fixture.invalid" } };
    await Promise.all([processSyncCenterTask(id, live.dispatchVersion, runtime), processSyncCenterTask(id, live.dispatchVersion, runtime)]);
    return prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
  }
  return { scope, actor, approver, authorizationId, source, secondSource, marketplaceId, calls, reportRows, reportCreateCount: () => reportCreateCount, approved, approvedRun, slice, finish, competingWorkers, from, to, today, feeWindow, feeDate, fbaFrom, fbaTo };
}
for (const resource of [...inventoryReportResources, "removal_order_report" as const, "removal_shipment_report" as const, "long_term_storage_fees" as const, "fba_shipments" as const, "fba_customer_sales" as const]) {
  test(resource + ": lifecycle, exact cells, ERP/MCP/Lili and isolation", async () => {
    const f = await fresh(resource), run = await f.approvedRun();
    const params = new URLSearchParams({ resource, sourceId: f.source.id, sellerAccountId: f.source.sellerAccountId, marketplaceId: f.marketplaceId });
    assert.equal((await readDomainReports(f.scope, params, f.actor)).rows.length, 0);
    const done = await f.finish(run.id);
    assert.equal(done.status, "SUCCEEDED", done.error ?? "");
    const data = await readDomainReports(f.scope, params, f.actor);
    assert.equal(data.rows.length, 1);
    const rowFields = data.rows[0].fields as Record<string, unknown>;
    if ("extra" in rowFields) assert.equal(rowFields.extra, resource === "fba_inventory_report" ? "" : "unknown");
    assert.equal(data.rows[0].businessDate, resource === "recommended_removals" || resource === "fba_overage_fees" ? f.today : resource === "long_term_storage_fees" ? f.feeDate : resource === "fba_shipments" ? f.fbaTo : resource === "fba_customer_sales" ? "2026-11-09" : ["removal_order_report", "removal_shipment_report"].includes(resource) ? f.to : null);
    if (resource === "fba_shipments") {
      assert.equal(data.rows[0].amountOriginal, "12345678901234567890.123400");
      assert.equal(data.rows[0].quantityOriginal, "9007199254740993123");
      assert.equal("buyer-email" in rowFields, false);
      assert.equal("ship-address-1" in rowFields, false);
      assert.equal(rowFields.carrier, "Carrier");
    }
    if (resource === "fba_customer_sales") {
      assert.equal(data.rows[0].quantityOriginal, "9007199254740993123");
      assert.equal(data.rows[0].amountOriginal, "12345678901234567890.123400");
      assert.equal("ship-city" in rowFields, false);
      assert.equal("ship-state" in rowFields, false);
      assert.equal("ship-postal-code" in rowFields, false);
      assert.equal((done.summary as { coverage: { historicalComplete: boolean; historyWindow: null } }).coverage.historicalComplete, false);
    }
    if (resource === "fba_inventory_report") {
      assert.equal(data.rows[0].amountOriginal, "123456789.123456789");
      assert.equal(data.rows[0].quantityOriginal, "9007199254740993123");
    }
    if (resource === "removal_shipment_report") {
      assert.equal(data.rows[0].quantityOriginal, "9007199254740993123");
      assert.equal(rowFields["tracking-number"], "00012345678901234567890");
      assert.equal(rowFields.unknown_field, "keep");
      assert.equal(rowFields["request-date"], f.from);
    }
    if (resource === "long_term_storage_fees") {
      assert.equal(data.rows[0].amountOriginal, "12345678901234567890.123400");
      assert.equal(data.rows[0].quantityOriginal, "9007199254740993123");
      assert.equal(rowFields.unknown_field, "");
    }
    if (resource === "recommended_removals") {
      assert.equal(data.rows[0].businessDate, f.today);
      assert.equal(data.rows[0].quantityOriginal, null);
      assert.equal(rowFields.extra, "unknown");
    }
    if (resource === "storage_fees") { assert.equal(data.rows[0].amountOriginal, "12345678901234567890.123400"); assert.equal(data.rows[0].currencyCode, "USD"); }
    if (resource === "fba_overage_fees") { assert.equal(data.rows[0].amountOriginal, "12345678901234567890.123400"); assert.equal(rowFields.extra, "unknown"); assert.equal(data.rows[0].transactionType, "STANDARD"); assert.match(JSON.stringify(done.summary), /ESTIMATE_SNAPSHOT/); assert.match(JSON.stringify(done.summary), /NOT_POSTED_CHARGE/); }
    if (resource === "fee_preview") { assert.equal(data.rows[0].amountOriginal, "12345678901234567890.123400"); assert.equal(data.rows[0].currencyCode, "USD"); assert.equal(rowFields.extra, "unknown"); assert.match(JSON.stringify(done.summary), /ESTIMATED_FBA_FEES_NOT_POSTED_CHARGES/); }
    assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id } }), 1);
    assert.equal(await prisma.amazonSyncReportDocument.count({ where: { sourceId: f.source.id, status: "PUBLISHED" } }), 1);
    const head = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } });
    if (!["removal_order_report", "removal_shipment_report", "long_term_storage_fees", "fba_shipments", "fba_customer_sales"].includes(resource)) assert.equal((head.coverage as { historyApplicable: boolean }).historyApplicable, false);
    else assert.equal((head.coverage as { historicalComplete: boolean }).historicalComplete, false);
    const pair = { sellerAccountId: f.source.sellerAccountId, marketplaceId: f.marketplaceId, table: resource };
    const credential = await manageMcpCredential(f.scope, f.actor, { action: "create", name: "reports fixture", scopes: [{ sellerAccountId: f.source.sellerAccountId, marketplaceIds: [f.marketplaceId] }], tools: ["data_query"], expiresAt: new Date(Date.now() + 60000).toISOString() });
    const identity = await authenticateAmazonMcp("Bearer " + credential.token!);
    const response = await invokeAmazonMcp(identity, "data_query", pair) as { records: unknown[] };
    assert.equal(response.records.length, 1);
    const erp = await createErpResearchTransport({ ...f.scope, userId: f.actor });
    assert.ok(erp.transport);
    const lili = await erp.transport.callTool("data_query", pair, new AbortController().signal);
    assert.ok(JSON.stringify(lili).includes(resource === "fba_overage_fees" ? "12345678901234567890.123400" : "fixture-sku"));
    await assert.rejects(() => invokeAmazonMcp(identity, "data_query", { ...pair, sellerAccountId: randomUUID() }));
    await assert.rejects(() => invokeAmazonMcp(identity, "data_query", { ...pair, marketplaceId: otherSite }));
    await assert.rejects(() => readDomainReports({ ...f.scope, organizationId: randomUUID() }, params, f.actor));
    const calls = f.calls.length;
    await f.competingWorkers(run.id);
    assert.equal(f.calls.length, calls);
    assert.equal(await prisma.amazonSyncReportRow.count({ where: { sourceId: f.source.id } }), 1);

  });
}
test("automatic discovery checks roles, creates report plans and tasks idempotently", async () => {
  const f = await fresh("reserved_inventory");
  await prisma.amazonSyncDataSource.delete({ where: { id: f.source.id } });
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authorizationId }, data: { awsRegion: "us-east-1", endpoint: endpoints["us-east-1"], lastValidatedAt: new Date(), approvedRoles: [], rolesAttestedAt: null } });
  await ensureAmazonSyncInitialized(f.scope, f.authorizationId);
  assert.equal(await prisma.amazonSyncDataSource.count({ where: { ...f.scope, resource: { in: inventoryReportResources } } }), 0);
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authorizationId }, data: { approvedRoles: ["Amazon Fulfillment"], rolesAttestedAt: new Date() } });
  await ensureAmazonSyncInitialized(f.scope, f.authorizationId);
  await ensureAmazonSyncInitialized(f.scope, f.authorizationId);
  for (const resource of [...inventoryReportResources.filter(resource => resource !== "fba_inventory_by_country"), "removal_order_report" as const, "removal_shipment_report" as const, "long_term_storage_fees" as const, "fba_shipments" as const, "fba_customer_sales" as const]) {
    assert.equal(await prisma.amazonSyncDataSource.count({ where: { ...f.scope, resource } }), 1);
    const plan = await prisma.amazonSyncSchedule.findFirstOrThrow({ where: { ...f.scope, resource } });
    assert.equal(plan.intervalMinutes, resource === "storage_fees" || resource === "recommended_removals" || resource === "fba_overage_fees" || resource === "fee_preview" || ["removal_order_report", "removal_shipment_report", "long_term_storage_fees", "fba_shipments", "fba_customer_sales"].includes(resource) ? 1440 : 60);
    assert.equal(plan.mode, "incremental");
    assert.equal(await prisma.amazonSyncRun.count({ where: { ...f.scope, resource, trigger: "schedule" } }), 1);
  }
});
test("FBA fee preview enforces the seller daily request limit across marketplaces", async () => {
  const f = await fresh("fee_preview", "all");
  const feeSources = await prisma.amazonSyncDataSource.findMany({ where: { ...f.scope, authorizationId: f.authorizationId, resource: "fee_preview", enabled: true }, orderBy: { marketplaceId: "asc" }, select: { id: true } });
  const firstSourceIndex = Math.floor(Date.now() / 86_400_000) % feeSources.length;
  const first = await f.approvedRun(feeSources[firstSourceIndex].id);
  const done = await f.finish(first.id);
  assert.equal(done.status, "SUCCEEDED", done.error ?? "");
  assert.equal(f.reportCreateCount(), 1);
  const secondSourceId = feeSources[(firstSourceIndex + 1) % feeSources.length].id;
  const second = await f.approvedRun(secondSourceId);
  const waiting = await f.slice(second.id);
  assert.equal(waiting.status, "WAITING");
  assert.ok(waiting.nextAttemptAt && waiting.nextAttemptAt.getTime() >= Date.now() + 23 * 60 * 60_000, `nextAttemptAt=${waiting.nextAttemptAt?.toISOString() ?? "null"}; stage=${waiting.stage}; error=${waiting.error ?? "none"}`);
  assert.equal(f.reportCreateCount(), 1);
  assert.equal(await prisma.amazonSyncReportDocument.count({ where: { sourceId: secondSourceId } }), 0);
});
test("multi-country inventory discovery is EU-scoped and creates a snapshot plan", async () => {
  const f = await fresh("fba_inventory_by_country");
  await prisma.amazonSyncDataSource.delete({ where: { id: f.source.id } });
  await ensureAmazonSyncInitialized(f.scope, f.authorizationId);
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...f.scope, resource: "fba_inventory_by_country" } });
  const plan = await prisma.amazonSyncSchedule.findFirstOrThrow({ where: { ...f.scope, resource: "fba_inventory_by_country" } });
  assert.equal(source.marketplaceId, f.marketplaceId);
  assert.equal(plan.intervalMinutes, 60);
  assert.equal(plan.mode, "incremental");
  const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...f.scope, sourceId: source.id, trigger: "schedule" } });
  assert.ok(await getAmazonSyncQueue().getJob(`adc-${run.id}-${run.dispatchVersion}`));
});
test("invalid schema retains archive and retry never duplicates report request", async () => {
  const f = await fresh("reserved_inventory");
  f.reportRows["fixture-reserved_inventory"] = "sku\tfnsku\tasin\treserved_qty\nx\tfn1\tB012345678\tNaN";
  const run = await f.approvedRun(), failed = await f.finish(run.id);
  assert.equal(failed.status, "FAILED");
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id } }), 1);
  assert.equal(await prisma.amazonSyncReportDocument.count({ where: { sourceId: f.source.id, status: "PUBLISHED" } }), 0);
  const calls = f.calls.length;
  await f.approved({ action: "control-task", id: run.id, control: "retry" });
  await f.finish(run.id);
  assert.equal(f.calls.length, calls);
});
for (const resource of ["reserved_inventory", "fba_inventory_by_country", "removal_order_report", "removal_shipment_report", "long_term_storage_fees", "recommended_removals", "fba_shipments", "fba_overage_fees", "fee_preview"] as const) for (const stage of ["parse-checkpoint", "insert", "publish"] as const) {
  test(resource + ": " + stage + ": failure resumes original and publishes exactly once", async () => {
    const f = await fresh(resource), run = await f.approvedRun();
    for (let i = 0; i < 6; i++) {
      const current = await f.slice(run.id);
      if (current.stage === "REPORT_PARSING") break;
    }
    const table = stage === "parse-checkpoint" ? "AuditLog" : stage === "insert" ? "AmazonSyncReportRow" : "AmazonSyncReportDocument";
    const when = stage === "parse-checkpoint" ? 'NEW."action" = \'amazon.sync.report.parse-checkpoint\' AND NEW."metadata"->>\'phase\' = \'PUBLISHED\'' : stage === "publish" ? 'NEW."status" = \'PUBLISHED\'' : "true";
    // Fault injection only in this disposable fixture, never an existing DB.
    await prisma.$executeRawUnsafe('CREATE FUNCTION inventory_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ' + when + ' THEN RAISE EXCEPTION \'fixture stage interruption\'; END IF; RETURN NEW; END $$');
    await prisma.$executeRawUnsafe('CREATE TRIGGER inventory_fixture_failure BEFORE ' + (stage === "publish" ? "UPDATE" : "INSERT") + ' ON "' + table + '" FOR EACH ROW EXECUTE FUNCTION inventory_fixture_fail()');
    try {
      const broken = await f.finish(run.id);
      assert.notEqual(broken.status, "SUCCEEDED");
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER inventory_fixture_failure ON "' + table + '"');
      await prisma.$executeRawUnsafe("DROP FUNCTION inventory_fixture_fail()");
    }
    let current = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } });
    if (["FAILED", "BLOCKED"].includes(current.status)) await f.approved({ action: "control-task", id: run.id, control: "retry" });
    current = await f.finish(run.id);
    assert.equal(current.status, "SUCCEEDED", current.error ?? "");
    assert.equal(f.calls.filter(u => u.hostname === "download.fixture.invalid").length, 1);
    assert.equal(await prisma.amazonSyncReportRow.count({ where: { sourceId: f.source.id } }), 1);
    assert.equal(await prisma.amazonSyncReportDocument.count({ where: { sourceId: f.source.id, status: "PUBLISHED" } }), 1);
  });
}
for (const resource of ["reserved_inventory", "removal_shipment_report", "long_term_storage_fees", "recommended_removals", "fba_shipments", "fba_overage_fees", "fee_preview"] as const) test(resource + ": registered Worker SIGKILL recovers same Reports identity, batches and publishes 601 rows", { timeout: 120000 }, async () => {
  const f = await fresh(resource);
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authorizationId }, data: { awsRegion: "us-east-1", endpoint: endpoints["us-east-1"] } });
  const run = await f.approvedRun();
  const directory = await mkdtemp(path.join(tmpdir(), "inventory-reports-process-"));
  const fixture = { marketplace: site, resource, reportType: domainReportTypes[resource], day: resource === "fba_shipments" ? f.fbaTo : f.to, fbaFrom: resource === "fba_shipments" ? f.fbaFrom : undefined, fbaTo: resource === "fba_shipments" ? f.fbaTo : undefined, feeWindow: f.feeWindow, feeDate: f.feeDate, clock: path.join(directory, "clock"), calls: path.join(directory, "calls"), held: path.join(directory, "held"), release: path.join(directory, "release") };
  const file = path.join(directory, "fixture.json");
  await writeFile(file, JSON.stringify(fixture)); await writeFile(fixture.clock, "0"); await writeFile(fixture.calls, "");
  const env = { ...process.env, ERP_RUNTIME_MODE: "production", QUEUE_DRIVER: "redis", AMAZON_SYNC_WORKER_MODE: "approved-only", AMAZON_SYNC_WORKER_TASK_IDS: JSON.stringify([run.id]), AMAZON_SYNC_WORKER_ID: "inventory-reports-fixture-worker", AMAZON_SYNC_WORKER_NAME: "inventory-reports-fixture-worker", AMAZON_SYNC_CENTER_SCOPES: JSON.stringify([[f.scope.organizationId, f.scope.workspaceId]]), AMAZON_INVENTORY_REPORTS_PROCESS_FIXTURE: file, NODE_OPTIONS: "--import=" + pathToFileURL(path.resolve("tests/helpers/amazon-inventory-reports-process-preload.mjs")).href };
  const child = spawn(process.execPath, ["scripts/runtime/worker-manager.mjs", "amazon-sync"], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; child.stdout.on("data", x => { logs += String(x); }); child.stderr.on("data", x => { logs += String(x); });
  const until = async (fn: () => Promise<boolean>, label: string) => { const start = Date.now(); while (Date.now() - start < 60000) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(label + " " + logs); };
  try {
    await until(async () => {
      await writeFile(fixture.clock, "70000");
      await prisma.amazonSyncRun.update({ where: { id: run.id }, data: { nextAttemptAt: new Date(0) } });
      await prisma.amazonSyncApiBudget.updateMany({ where: { ...f.scope, authorizationId: f.authorizationId }, data: { nextRequestAt: new Date(0) } });
      try { await access(fixture.held); return true; } catch { return false; }
    }, "Worker did not reach held report download");
    const heartbeat = await prisma.workerHeartbeat.findUniqueOrThrow({ where: { id: "inventory-reports-fixture-worker" } });
    const pid = (heartbeat.metadata as { pid: number }).pid; assert.ok(pid > 0 && pid !== child.pid);
    process.kill(pid, "SIGKILL");
    await writeFile(fixture.release, "release"); await writeFile(fixture.clock, "400000");
    await until(async () => (await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } })).status === "SUCCEEDED", "Reports Worker did not recover");
    assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id } }), 1);
    assert.equal(await prisma.amazonSyncReportRow.count({ where: { sourceId: f.source.id } }), 601);
    const calls = (await readFile(fixture.calls, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { path: string; method: string });
    assert.equal(calls.filter(x => x.method === "POST").length, 1, "must never create replacement report after restart");
    const page = await readDomainReports(f.scope, new URLSearchParams({ resource, sourceId: f.source.id, sellerAccountId: f.source.sellerAccountId, marketplaceId: f.marketplaceId, page: "13", pageSize: "50" }), f.actor);
    assert.equal(page.pagination.total, 601); assert.equal(page.rows.length, 1);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 26000))]);
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* only this fixture group */ }
    await rm(directory, { recursive: true, force: true });
  }
});
