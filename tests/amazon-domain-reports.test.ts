// Cloud role for injected offline HTTP fixtures; no real Amazon calls.
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
import assert from "node:assert/strict";
import test from "node:test";
import { AmazonSpApiClient } from "../src/lib/amazon/sp-api-client";
import { assertDomainReportRoles, domainReportRunWindow, inventoryEventRunWindow, mfnReturnsRunWindow, parseDomainReport, parseGetReportsPage } from "../src/lib/amazon-sync/domain-reports";

test("domain report parser preserves source strings and returns bounded batches with total count", () => {
  const source = "approval-date\treimbursement-id\tsku\tamount\tcurrency\tbuyer-email\tnote\n2026-01-02\tr-1\tA-1\t1.234,50\tEUR\tprivate@example.invalid\t\"first\tline\nsecond\"\n2026-01-03\tr-2\tA-2\t5.00\tUSD\tother@example.invalid\tok";
  const page = parseDomainReport("reimbursements", source, { offset: 1, limit: 1 });
  assert.equal(page.rowCount, 2);
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].amountOriginal, "5.00");
  assert.equal(page.rows[0].rowNumber, 2);
  assert.equal("note" in page.rows[0].fields, false);
  assert.ok(!JSON.stringify(page.rows).includes("@example.invalid"));
  assert.equal(parseDomainReport("reimbursements", source, { limit: 0 }).rowCount, 2);
});

test("settlement parser normalizes source headers and preserves currency-code attribution", () => {
  const source = "Settlement Start Date\tSettlement Id\tTransaction Type\tAmount Type\tAmount Description\tAmount\tCurrency Code\tOrder Id\n2026-01-02\tr-1\tOrder\tItemPrice\tPrincipal\t12.34\tUSD\to-1";
  const row = parseDomainReport("settlements", source).rows[0];
  assert.equal(row.amountOriginal, "12.34");
  assert.equal(row.currencyCode, "USD");
  assert.equal(row.orderId, "o-1");
  assert.equal(row.fields["currency-code"], "USD");
});

test("domain report parser rejects incomplete identity, facts, and impossible business dates", () => {
  assert.throws(() => parseDomainReport("reimbursements", "approval-date\treimbursement-id\torder-id\tsku\tasin\tamount\n2026-01-02\t\t\t\t\t4.00"));
  assert.throws(() => parseDomainReport("reimbursements", "approval-date\treimbursement-id\tsku\tamount\n2026-01-02\tr-1\tA-1\t"));
  assert.throws(() => parseDomainReport("reimbursements", "approval-date\treimbursement-id\tsku\tamount\n2026-02-30\tr-1\tA-1\t4.00"));
  assert.doesNotThrow(() => parseDomainReport("inventory_age", "snapshot-date\tsku\tinv-age-0-to-90-days\n2026-01-02\tA-1\t5"));
});

test("domain report identity aliases are independently accepted when Amazon varies headers", () => {
  assert.doesNotThrow(() => parseDomainReport("reimbursements", "approval-date\torder-id\tamount\n2026-01-02\to-1\t4.00"));
  assert.doesNotThrow(() => parseDomainReport("reimbursements", "approval-date\tamazon-order-id\tamount\n2026-01-02\to-1\t4.00"));
  assert.doesNotThrow(() => parseDomainReport("reimbursements", "approval-date\tseller-sku\tamount\n2026-01-02\tA-1\t4.00"));
  assert.doesNotThrow(() => parseDomainReport("inventory_age", "snapshot-date\tseller-sku\tavailable\n2026-01-02\tA-1\t5"));
});

test("settlement report discovery validates identity and retains creation time", () => {
  const page = parseGetReportsPage({ reports: [{ reportId: "r-1", reportType: "T", marketplaceIds: ["M"], createdTime: "2026-01-02T03:04:05Z" }], nextToken: "next" }, "T", "M");
  assert.equal(page.reports[0].createdTime, "2026-01-02T03:04:05.000Z");
  assert.equal(page.nextToken, "next");
  assert.throws(() => parseGetReportsPage({ reports: [{ reportId: "r-1", reportType: "wrong", marketplaceIds: ["M"] }] }, "T", "M"));
});

test("report windows and attested roles are enforced", () => {
  assert.throws(() => domainReportRunWindow("settlements", { createdSince: "2025-01-01T00:00:00Z", createdUntil: "2025-05-01T00:00:00Z" }));
  assert.doesNotThrow(() => assertDomainReportRoles("settlements", { approvedRoles: ["Finance and Accounting"], rolesAttestedAt: null }));
});

test("inventory events validate a closed bounded report window and event allowlist", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  assert.deepEqual(inventoryEventRunWindow({ from: "2026-10-01", to: "2026-10-31", eventType: "Adjustments" }, now), {
    from: "2026-10-01", to: "2026-10-31", dataStartTime: "2026-10-01T00:00:00Z", dataEndTime: "2026-10-31T23:59:59Z", eventType: "Adjustments",
  });
  for (const value of [
    { from: "2026-11-05", to: "2026-11-05", eventType: "" },
    { from: "2026-10-01", to: "2026-11-01", eventType: "" },
    { from: "2025-01-01", to: "2025-01-01", eventType: "" },
    { from: "2026-10-01", to: "2026-10-02", eventType: "NotAnEvent" },
  ]) assert.throws(() => inventoryEventRunWindow(value, now));
});

test("inventory ledger rows preserve signed units and safe adjustment fields only", () => {
  const raw = "Date\tFNSKU\tASIN\tMSKU\tTitle\tEvent Type\tReference ID\tQuantity\tFulfillment Center\tDisposition\tReason\tCountry\tReconciled Quantity\tUnreconciled Quantity\tDate and Time\tBuyer Email\n11/03/2026\tfixture-fn\tB012345678\tfixture-sku\tSample product\tAdjustments\tfixture-ref\t-2\tPHX7\tSELLABLE\tWAREHOUSE_DAMAGE\tUS\t-2\t0\t11/03/2026 08:30:00 PST\tprivate@example.invalid";
  const report = parseDomainReport("inventory_events", raw, { inventoryEventWindow: inventoryEventRunWindow({ from: "2026-11-01", to: "2026-11-04", eventType: "Adjustments" }, new Date("2026-11-05T12:00:00Z")) });
  assert.equal(report.dateField, "date");
  assert.equal(report.rows[0].businessDate, "2026-11-03");
  assert.equal(report.rows[0].sellerSku, "fixture-sku");
  assert.equal(report.rows[0].quantityOriginal, "-2");
  assert.equal(report.rows[0].transactionType, "Adjustments");
  assert.equal(report.rows[0].fields["reference-id"], "fixture-ref");
  assert.ok(!JSON.stringify(report.rows).includes("@example.invalid"));
  assert.throws(() => parseDomainReport("inventory_events", raw.replace("\t-2\tPHX7", "\t2.5\tPHX7")));
  assert.throws(() => parseDomainReport("inventory_events", raw, { inventoryEventWindow: inventoryEventRunWindow({ from: "2026-11-04", to: "2026-11-04", eventType: "Adjustments" }, new Date("2026-11-05T12:00:00Z")) }));
});

test("ledger all-events default omits empty reportOptions and preserves explicit filters", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const client = new AmazonSpApiClient({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "", region: "fixture-region", endpoint: "https://spapi.fixture.invalid" }, {
    tokenEndpoint: "https://lwa.fixture.invalid/token",
    fetch: async (input, init) => {
      if (new URL(String(input)).hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ reportId: "fixture-report" });
    },
  });
  const range = { marketplaceId: "fixture-marketplace", from: "2026-11-01T00:00:00Z", to: "2026-11-02T23:59:59Z" };
  await client.createInventoryLedgerReport({ ...range, eventType: "" });
  await client.createInventoryLedgerReport({ ...range, eventType: "Adjustments" });
  assert.equal(Object.hasOwn(bodies[0], "reportOptions"), false);
  assert.deepEqual(bodies[1].reportOptions, { eventType: "Adjustments" });
  assert.equal(bodies[0].dataStartTime, range.from);
  assert.equal(bodies[0].dataEndTime, range.to);
  assert.deepEqual(bodies[0].marketplaceIds, [range.marketplaceId]);
});

test("getReports first page applies frozen filters and continuation sends only nextToken", async () => {
  const urls: URL[] = [];
  const client = new AmazonSpApiClient({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "", region: "fixture-region", endpoint: "https://spapi.fixture.invalid" }, {
    tokenEndpoint: "https://lwa.fixture.invalid/token",
    fetch: async input => {
      const url = new URL(String(input)); urls.push(url);
      if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
      return Response.json({ reports: [] });
    },
  });
  const range = { reportType: "fixture-report", marketplaceId: "fixture-marketplace", createdSince: "2026-10-01T00:00:00.000Z", createdUntil: "2026-11-01T00:00:00.000Z" };
  await client.getReports(range);
  await client.getReports({ ...range, nextToken: "fixture-page-token" });
  const first = urls[1].searchParams, next = urls[2].searchParams;
  assert.equal(first.get("reportTypes"), "fixture-report");
  assert.equal(first.get("marketplaceIds"), "fixture-marketplace");
  assert.equal(first.get("createdSince"), range.createdSince);
  assert.equal(first.get("createdUntil"), range.createdUntil);
  assert.equal(first.get("pageSize"), "100");
  assert.deepEqual([...next.entries()], [["nextToken", "fixture-page-token"]]);
});

test("settlement report-header currency resolves only its explicit settlement and retains provenance", () => {
  const header = "settlement-start-date\tsettlement-id\ttransaction-type\tamount-type\tamount-description\tamount\ttotal-amount\tcurrency";
  const raw = `${header}\n2026-10-01\tS1\t\t\t\t\t50.00\tEUR\n2026-10-01\tS1\tOrder\tItemPrice\tPrincipal\t12.34\t\t\n2026-10-01\tS2\tOrder\tItemPrice\tPrincipal\t12.34\t\t`;
  const result = parseDomainReport("settlements", raw);
  assert.equal(result.rows[0].amountOriginal, null);
  assert.equal(result.rows[1].currencyCode, "EUR");
  assert.equal(result.rows[1].currencySource, "SETTLEMENT_HEADER");
  assert.equal(result.rows[1].currencySourceRowNumber, 1);
  assert.equal(result.rows[1].fields.currency, "");
  assert.equal(result.rows[2].currencyCode, null);
  const batch = parseDomainReport("settlements", raw, { offset: 1, limit: 1 });
  assert.equal(batch.rows[0].currencyCode, "EUR");
  assert.equal(batch.rows[0].rowHash, result.rows[1].rowHash);
  const conflict = raw + "\n2026-10-01\tS1\tRefund\tItemPrice\tPrincipal\t-1.00\t\tGBP";
  assert.equal(parseDomainReport("settlements", conflict, { offset: 1, limit: 1 }).rows[0].currencyCode, null);
  const duplicateHeader = raw + "\n2026-10-01\tS1\t\t\t\t\t50.00\tEUR";
  assert.equal(parseDomainReport("settlements", duplicateHeader).rows[1].currencyCode, null);
});

test("identical settlement transaction amounts and descriptions remain separate original rows", () => {
  const raw = "settlement-start-date\tsettlement-id\ttransaction-type\tamount-type\tamount-description\tamount\n2026-10-01\tS1\tOrder\tFee\tFee\t-1.00\n2026-10-01\tS1\tOrder\tFee\tFee\t-1.00";
  const parsed = parseDomainReport("settlements", raw);
  assert.equal(parsed.rowCount, 2);
  assert.deepEqual(parsed.rows.map(row => row.rowNumber), [1, 2]);
  assert.equal(parsed.rows[0].rowHash, parsed.rows[1].rowHash);
});

test("MFN returns enforce a closed 60-day window and preserve exact safe return fields", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const window = mfnReturnsRunWindow({ from: "2026-09-12", to: "2026-11-10" }, now);
  assert.deepEqual(window, { from: "2026-09-12", to: "2026-11-10", dataStartTime: "2026-09-12T00:00:00Z", dataEndTime: "2026-11-10T23:59:59Z" });
  assert.throws(() => mfnReturnsRunWindow({ from: "2026-09-11", to: "2026-11-10" }, now));
  assert.throws(() => mfnReturnsRunWindow({ from: "2026-09-12", to: "2026-11-11" }, now));

  const raw = "order-id\torder-item-id\torder-date\treturn-request-date\treturn-request-status\tasin\tmerchant-sku\treturn-quantity\treturn-reason\trefunded-amount\tcurrency-code\ttracking-id\n" +
    "order-1\titem-1\t2026-10-01\t2026-10-03\tApproved\tB012345678\tsku-1\t9007199254740993\tUnwanted\t12345678901234567890.123400\tUSD\tprivate-tracking";
  const parsed = parseDomainReport("mfn_returns", raw, { mfnReturnsWindow: window });
  assert.equal(parsed.rows[0].businessDate, "2026-10-03");
  assert.equal(parsed.rows[0].quantityOriginal, "9007199254740993");
  assert.equal(parsed.rows[0].amountOriginal, "12345678901234567890.123400");
  assert.equal(parsed.rows[0].fields["return-request-status"], "Approved");
  assert.equal("tracking-id" in parsed.rows[0].fields, false);
  assert.equal(JSON.stringify(parsed.rows).includes("private-tracking"), false);
  assert.throws(() => parseDomainReport("mfn_returns", raw.replace("2026-10-03", "2026-11-11"), { mfnReturnsWindow: window }));
  assert.doesNotThrow(() => assertDomainReportRoles("mfn_returns", { approvedRoles: ["Inventory and Order Tracking"], rolesAttestedAt: new Date() }));
  assert.throws(() => assertDomainReportRoles("mfn_returns", { approvedRoles: ["Amazon Fulfillment"], rolesAttestedAt: new Date() }));
});
