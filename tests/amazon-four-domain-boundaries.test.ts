// Cloud role for injected offline HTTP fixtures; no real Amazon calls.
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
import assert from "node:assert/strict";
import test from "node:test";
import { AmazonSpApiClient, AmazonSpApiError } from "../src/lib/amazon/sp-api-client";
import { assertDomainReportReady, assertSettlementDiscoveryAvailable, domainReportRunWindow, domainReportTypes, parseDomainReport, parseGetReportsPage, readTsv, reimbursementRunWindow } from "../src/lib/amazon-sync/domain-reports";
import { latestClosedReimbursementWindow, nextAutomaticSettlementDiscovery } from "../src/lib/amazon-sync/automatic-schedule";
import { assertFinanceRequestWindow, financeRetentionFloor, newFinanceRetentionStart, previewFinanceRetentionRecovery } from "../src/lib/amazon-sync/finance";

const now = new Date("2026-11-06T12:00:00Z");
test("real ledger quote convention accepts interior title quotes without relaxing other report parsers", () => {
  const text = '"Date"\t"MSKU"\t"Title"\t"Event Type"\t"Quantity"\n"11/03/2026"\t"fixture-sku"\t"Example "Design" title"\t"Shipments"\t"-2"';
  assert.throws(() => [...readTsv(text)]);
  const parsed = parseDomainReport("inventory_events", text);
  assert.equal(parsed.rowCount, 1);
  assert.equal(parsed.rows[0].sellerSku, "fixture-sku");
  assert.equal(parsed.rows[0].quantityOriginal, "-2");
  assert.equal(parseDomainReport("inventory_events", text.replace('Example "Design" title', 'Example "Design"')).rows[0].quantityOriginal, "-2");
  assert.equal(parseDomainReport("inventory_events", text.replace('Example "Design" title', 'Example ""Design"" title')).rows[0].quantityOriginal, "-2");
  assert.throws(() => parseDomainReport("inventory_events", text.replace('"-2"', '"-2')));
});
test("new reimbursement scope uses 30 closed UTC dates and rejects inconsistent frozen timestamps", () => {
  const window = latestClosedReimbursementWindow(now);
  assert.equal(window.from, "2026-10-07");
  assert.equal(window.to, "2026-11-05");
  assert.deepEqual(reimbursementRunWindow(window, now), window);
  assert.throws(() => reimbursementRunWindow({ ...window, from: "2026-10-06" }, now));
  assert.throws(() => reimbursementRunWindow({ ...window, dataEndTime: "2026-11-06T23:59:59Z" }, now));
  assert.throws(() => reimbursementRunWindow({ from: "2026-02-30", to: "2026-03-01" }, now));
  assert.equal(domainReportRunWindow("reimbursements", undefined, now), null);
  const tsv = "approval-date\treimbursement-id\tamount\n2026-10-01\tr-1\t2";
  assert.doesNotThrow(() => parseDomainReport("reimbursements", tsv));
  assert.throws(() => parseDomainReport("reimbursements", tsv, { reimbursementWindow: window }));
});

test("settlement queue margin remains visible and expired windows stop without mutation", () => {
  const initial = nextAutomaticSettlementDiscovery(now);
  const frozen = domainReportRunWindow("settlements", initial, now)!;
  assert.ok("createdSince" in frozen);
  assert.deepEqual(frozen.retentionGap, initial.retentionGap);
  assertSettlementDiscoveryAvailable(frozen, new Date(now.getTime() + 3600000));
  assert.throws(() => assertSettlementDiscoveryAvailable(frozen, new Date(now.getTime() + 86400000)), /SETTLEMENT_DISCOVERY_EXPIRED/);
  assert.equal(frozen.createdSince, initial.createdSince);
  assert.throws(() => domainReportRunWindow("settlements", { ...initial, retentionGap: { ...initial.retentionGap, to: initial.createdUntil } }, now));
});

test("multi-site settlement reports cannot become single-site facts", () => {
  const response = { reports: [{ reportId: "fixture-r", reportType: domainReportTypes.settlements, marketplaceIds: ["fixture-site", "other-site"] }] };
  assert.throws(() => parseGetReportsPage(response, domainReportTypes.settlements, "fixture-site"), /SETTLEMENT_MULTI_MARKETPLACE/);
  assert.throws(() => parseGetReportsPage(response, domainReportTypes.settlements, "unbound-site"));
  for (const status of ["FATAL", "CANCELLED"]) assert.throws(() => assertDomainReportReady(status, "diagnostic-document"), new RegExp(`REPORT_${status}`));
  assert.throws(() => assertDomainReportReady("DONE", ""), /REPORT_DOCUMENT_UNAVAILABLE/);
  assert.doesNotThrow(() => assertDomainReportReady("DONE", "fixture-doc"));
});

test("settlement scheduler preserves an unfinished audited window across queue delays", () => {
  const initial = nextAutomaticSettlementDiscovery(now);
  const cursor = { status: "FAILED", watermarkFrom: new Date(initial.createdSince), watermarkTo: new Date(initial.createdUntil) };
  const later = new Date(now.getTime() + 3600_000);
  assert.deepEqual(nextAutomaticSettlementDiscovery(later, cursor), initial);
  assert.deepEqual(nextAutomaticSettlementDiscovery(later, { ...cursor, status: "SUCCEEDED" }), nextAutomaticSettlementDiscovery(later));
  assert.throws(() => assertSettlementDiscoveryAvailable(nextAutomaticSettlementDiscovery(new Date(now.getTime() + 2 * 86_400_000), cursor), new Date(now.getTime() + 2 * 86_400_000)), /EXPIRED/);
});

test("finance rolling retention handles leap days and preserves recovery blockers", () => {
  assert.equal(financeRetentionFloor(new Date("2024-02-29T10:00:00Z")).toISOString(), "2022-02-28T10:00:00.000Z");
  const old = { from: "2024-11-06T10:00:00.000Z", to: "2024-12-06T10:00:00.000Z" };
  assert.throws(() => assertFinanceRequestWindow(old, now), /FINANCE_RETENTION_EXPIRED/);
  const start = newFinanceRetentionStart(old.from, now);
  assert.equal(start.initialFrom, "2024-11-07T12:00:00.000Z");
  assert.equal(start.retentionGap?.from, old.from);
  for (const progress of [
    { hasNextToken: true, pages: 0, records: 0, hasCheckpoint: false },
    { hasNextToken: false, pages: 1, records: 0, hasCheckpoint: false },
    { hasNextToken: false, pages: 0, records: 1, hasCheckpoint: false },
    { hasNextToken: false, pages: 0, records: 0, hasCheckpoint: true },
  ]) {
    const recovery = previewFinanceRetentionRecovery(old, now, progress);
    assert.equal(recovery.proposed, null);
    assert.equal(recovery.advancesCursor, false);
  }
  assert.equal(old.from, "2024-11-06T10:00:00.000Z");
});

test("finance raw-only errors retain safe InvalidInput diagnostics and redact credentials", async () => {
  const client = new AmazonSpApiClient({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "", region: "fixture-region", endpoint: "https://fixture.invalid" }, {
    tokenEndpoint: "https://lwa.fixture.invalid/token",
    fetch: async input => new URL(String(input)).hostname === "lwa.fixture.invalid"
      ? Response.json({ access_token: "fixture-access", expires_in: 3600 })
      : Response.json({ errors: [{ code: "InvalidInput", message: "Start date cannot be before 2 years from now fixture-secret" }] }, { status: 400, headers: { "x-amzn-requestid": "fixture-request-id" } }),
  });
  await assert.rejects(client.listTransactions({ postedAfter: "2024-11-01T00:00:00.000Z", postedBefore: "2024-11-02T00:00:00.000Z" }), error => {
    assert.ok(error instanceof AmazonSpApiError);
    assert.equal(error.upstreamCode, "InvalidInput");
    assert.equal(error.requestId, "fixture-request-id");
    assert.match(error.message, /2 years/);
    assert.ok(!error.message.includes("fixture-secret"));
    assert.equal(error.retryable, false);
    return true;
  });
});

test("invalid ledger marketplace and calendar boundaries cause zero network calls", async () => {
  let requests = 0;
  const client = new AmazonSpApiClient({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "", region: "fixture-region", endpoint: "https://fixture.invalid" }, { fetch: async () => { requests++; throw new Error("network should not run"); } });
  const window = { from: "2026-10-01T00:00:00Z", to: "2026-10-31T23:59:59Z", eventType: "" };
  for (const marketplaceId of ["", " ", "A,B", "A\nB"]) await assert.rejects(client.createInventoryLedgerReport({ ...window, marketplaceId }));
  await assert.rejects(client.createInventoryLedgerReport({ ...window, marketplaceId: "M", from: "2026-02-30T00:00:00Z" }));
  await assert.rejects(client.createInventoryLedgerReport({ ...window, marketplaceId: "M", to: "2026-11-01T23:59:59Z" }));
  assert.equal(requests, 0);
});

test("reimbursement timestamps retain original value and use the closed UTC approval day", () => {
  const text = "approval-date\treimbursement-id\tamount-total\n2026-11-01T23:30:00-02:00\tfixture\t1.00";
  const parsed = parseDomainReport("reimbursements", text, { reimbursementWindow: { from: "2026-11-02", to: "2026-11-02", dataStartTime: "2026-11-02T00:00:00Z", dataEndTime: "2026-11-02T23:59:59Z" } });
  assert.equal(parsed.rows[0].businessDate, "2026-11-02");
  assert.equal(parsed.rows[0].businessDateRaw, "2026-11-01T23:30:00-02:00");
  assert.throws(() => parseDomainReport("reimbursements", text.replace("2026-11-01", "2026-02-30")));
});
