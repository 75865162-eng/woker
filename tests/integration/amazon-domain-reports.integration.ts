import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "@/lib/amazon-sync/change-approval";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { encryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { endpoints } from "@/lib/amazon-sync/policy";
import { digest } from "@/lib/amazon-sync/approval-policy";
import { readDomainReports } from "@/lib/amazon-sync/domain-reports-query";

if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1" || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw new Error("Disposable offline database required");
const site = "fixture-domain-marketplace", region = "domain-reports-fixture-region", scopes: Array<[string, string]> = [];
before(() => { process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 73).toString("base64"); endpoints[region] = "https://domain-reports.fixture.invalid"; });
after(async () => { delete endpoints[region]; await prisma.$disconnect(); });

async function fresh(resource: "settlements" | "inventory_events" = "settlements") {
  const scope = { organizationId: `domain-report-fixture-${randomUUID()}`, workspaceId: "domain-report-test" };
  scopes.push([scope.organizationId, scope.workspaceId]); process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify(scopes);
  const actor = randomUUID(), approver = randomUUID(), store = randomUUID(), authorizationId = randomUUID();
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Domain reports fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Domain reports fixture" } });
  for (const id of [actor, approver]) await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: "Fixture", passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: store, accountKey: store, displayName: "Domain reports fixture", marketplaceCode: "FX" } });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authorizationId, name: "Domain reports fixture", amazonSellerId: "fixture-domain-seller", awsRegion: region, endpoint: endpoints[region], status: "CONFIGURED", approvedRoles: ["Finance and Accounting", "Amazon Fulfillment"], rolesAttestedAt: new Date(), marketplaceParticipations: [{ marketplaceId: site, countryCode: "FX" }], updatedByUserId: actor, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId }) } });
  async function approved(command: Record<string, unknown>) {
    const request = await requestChange(scope, actor, command), id = String(request.id);
    await decideChange(scope, approver, id, "APPROVED", "offline fixture"); await applyChange(scope, actor, id);
    return prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id } });
  }
  const configured = await approved({ action: "save-source", authorizationId, sellerAccountId: store, marketplaceId: site, resource, freshnessMinutes: 60, enabled: true });
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: configured.targetId } });
  const calls: URL[] = [];
  const today = new Date().toISOString().slice(0, 10), to = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10), from = new Date(Date.parse(`${to}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);
  const ledgerWindow: { value: { dataStartTime: string; dataEndTime: string; eventType: string } | null } = { value: null };
  const eventReport = "Date\tFNSKU\tASIN\tMSKU\tTitle\tEvent Type\tReference ID\tQuantity\tFulfillment Center\tDisposition\tReason\tCountry\tReconciled Quantity\tUnreconciled Quantity\tDate and Time\tBuyer Email\n11/02/2026\tfixture-fnsku\tB012345678\tfixture-sku\tSample product\tAdjustments\tfixture-adjustment\t-2\tPHX7\tSELLABLE\tWAREHOUSE_DAMAGE\tUS\t-2\t0\t11/02/2026 08:30:00 PST\tprivate@example.invalid";
  const reportRows: Record<string, string> = {
    "fixture-settlement-1": "settlement-start-date\tsettlement-id\ttransaction-type\tamount-type\tamount-description\tamount\tcurrency\torder-id\tseller-sku\tasin\tbuyer-email\n2026-10-01\tfixture-settlement-1\tOrder\tItemPrice\tPrincipal\t12.34\tUSD\tfixture-order-1\tfixture-sku-1\tfixture-asin-1\tprivate@example.invalid",
    "fixture-settlement-2": "settlement-start-date\tsettlement-id\ttransaction-type\tamount-type\tamount-description\tamount\tcurrency\torder-id\tseller-sku\tasin\tbuyer-email\n2026-10-08\tfixture-settlement-2\tRefund\tItemPrice\tPrincipal\t-2.00\tUSD\tfixture-order-2\tfixture-sku-2\tfixture-asin-2\tother@example.invalid",
    "fixture-inventory-ledger": eventReport.replace("11/02/2026", new Date(`${from}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC" })),
  };
  const fetcher = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push(url);
    if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    assert.ok(["domain-reports.fixture.invalid", "download.fixture.invalid"].includes(url.hostname));
    if (url.hostname === "download.fixture.invalid") return new Response(reportRows[url.pathname.split("/").at(-1)!]);
    if (url.pathname === "/reports/2021-06-30/reports" && init?.method === "POST") {
      const payload = JSON.parse(String(init.body)) as { reportType: string; marketplaceIds: string[]; dataStartTime: string; dataEndTime: string; reportOptions?: { eventType?: string } };
      assert.equal(payload.reportType, "GET_LEDGER_DETAIL_VIEW_DATA"); assert.deepEqual(payload.marketplaceIds, [site]);
      assert.equal(payload.dataStartTime, `${from}T00:00:00Z`); assert.equal(payload.dataEndTime, `${to}T23:59:59Z`);
      assert.equal(payload.reportOptions?.eventType, "Adjustments");
      ledgerWindow.value = { dataStartTime: payload.dataStartTime, dataEndTime: payload.dataEndTime, eventType: payload.reportOptions?.eventType ?? "" };
      return Response.json({ reportId: "fixture-inventory-ledger" });
    }
    if (url.pathname === "/reports/2021-06-30/reports" && url.searchParams.has("nextToken")) {
      assert.equal(url.searchParams.size, 1);
      return Response.json({ reports: [{ reportId: "fixture-settlement-2", reportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", marketplaceIds: [site], createdTime: "2026-10-08T12:00:00Z" }] });
    }
    if (url.pathname === "/reports/2021-06-30/reports" && url.searchParams.has("reportTypes")) {
      assert.equal(url.searchParams.get("reportTypes"), "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2");
      assert.equal(url.searchParams.get("marketplaceIds"), site);
      return Response.json({ reports: [{ reportId: "fixture-settlement-1", reportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", marketplaceIds: [site], createdTime: "2026-10-01T12:00:00Z" }], nextToken: "fixture-next-page" });
    }
    if (url.pathname.startsWith("/reports/2021-06-30/reports/")) {
      const reportId = decodeURIComponent(url.pathname.split("/").at(-1)!);
      return resource === "inventory_events"
        ? Response.json({ reportId, reportType: "GET_LEDGER_DETAIL_VIEW_DATA", marketplaceIds: [site], processingStatus: "DONE", reportDocumentId: reportId, createdTime: "2026-11-04T12:00:00Z", dataStartTime: ledgerWindow.value?.dataStartTime, dataEndTime: ledgerWindow.value?.dataEndTime })
        : Response.json({ reportId, reportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", marketplaceIds: [site], processingStatus: "DONE", reportDocumentId: reportId, createdTime: reportId.endsWith("1") ? "2026-10-01T12:00:00Z" : "2026-10-08T12:00:00Z" });
    }
    if (url.pathname.startsWith("/reports/2021-06-30/documents/")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      return Response.json({ reportDocumentId: id, url: `https://download.fixture.invalid/${id}` });
    }
    throw new Error(`Unexpected fixture request ${url.pathname}`);
  };
  async function approvedRun() {
    const request = await approved({ action: "run", sourceIds: [source.id], ...(resource === "inventory_events" ? { dateFrom: from, dateTo: to, eventType: "Adjustments" } : {}) });
    return prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionApprovalId: request.id } });
  }
  async function slice(id: string) {
    await prisma.amazonSyncRun.update({ where: { id }, data: { nextAttemptAt: new Date(0) } });
    await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId }, data: { nextRequestAt: new Date(0) } });
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
  return { scope, actor, authorizationId, source, calls, approved, approvedRun, slice, finish, competingWorkers, from, to };
}

test("two concurrent workers claim one report task and issue one Amazon request", async () => {
  const fixture = await fresh(), run = await fixture.approvedRun();
  const result = await fixture.competingWorkers(run.id);
  assert.equal(result.status, "WAITING");
  assert.equal(result.stage, "SETTLEMENT_DISCOVERY");
  assert.equal(fixture.calls.filter(url => url.hostname === "domain-reports.fixture.invalid" && url.pathname === "/reports/2021-06-30/reports").length, 1);
});

test("settlement discovery resumes pagination and publishes every report without exposing PII", async () => {
  const fixture = await fresh(), run = await fixture.approvedRun();
  const result = await fixture.finish(run.id);
  assert.equal(result.status, "SUCCEEDED", JSON.stringify({ status: result.status, stage: result.stage, error: result.error, attempts: result.attempts, apiRequests: result.apiRequests, calls: fixture.calls.map(url => `${url.hostname}${url.pathname}${url.search}`) }));
  assert.equal(result.processedCount, 2);
  assert.equal(result.insertedCount, 2);
  assert.deepEqual((result.summary as { coverage: { reportIds: string[] } }).coverage.reportIds, ["fixture-settlement-1", "fixture-settlement-2"]);
  const view = await readDomainReports(fixture.scope, new URLSearchParams({ resource: "settlements" }), fixture.actor);
  assert.equal(view.pagination.total, 2);
  assert.deepEqual(view.documents.map(document => document.reportId).sort(), ["fixture-settlement-1", "fixture-settlement-2"]);
  assert.ok(!JSON.stringify(view).includes("@example.invalid"));
  assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: fixture.source.id } })).rowCount, 2);
  const listings = fixture.calls.filter(url => url.pathname === "/reports/2021-06-30/reports");
  assert.equal(listings.length, 2);
  assert.equal(listings[1].searchParams.size, 1);
});

test("report read query and rows remain scoped after staged work and never return encrypted raw envelopes", async () => {
  const fixture = await fresh(), run = await fixture.approvedRun();
  const result = await fixture.finish(run.id);
  assert.equal(result.status, "SUCCEEDED", JSON.stringify({ status: result.status, stage: result.stage, error: result.error, attempts: result.attempts, apiRequests: result.apiRequests, calls: fixture.calls.map(url => `${url.hostname}${url.pathname}${url.search}`) }));
  const unauthorized = await fresh();
  await assert.rejects(readDomainReports(unauthorized.scope, new URLSearchParams({ resource: "settlements", sourceId: fixture.source.id }), unauthorized.actor), /不可访问/);
  const rows = await prisma.amazonSyncReportRow.findMany({ where: fixture.scope });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => !JSON.stringify(row.fields).includes("@example.invalid")));
  assert.ok(!JSON.stringify(await readDomainReports(fixture.scope, new URLSearchParams({ resource: "settlements" }), fixture.actor)).includes("rawCiphertext"));
  assert.ok(await prisma.amazonSyncRawPage.findFirst({ where: { taskId: run.id, resource: "settlements", bodySha256: { not: "" } } }));
  assert.ok(digest([fixture.scope, fixture.source.id, "fixture-settlement-1"]));
});

test("inventory ledger report freezes dates and event filter, then publishes sanitized event rows", async () => {
  const fixture = await fresh("inventory_events"), run = await fixture.approvedRun();
  const result = await fixture.finish(run.id);
  assert.equal(result.status, "SUCCEEDED", JSON.stringify({ status: result.status, stage: result.stage, error: result.error, calls: fixture.calls.map(url => `${url.hostname}${url.pathname}`) }));
  assert.equal(result.mode, "report");
  assert.equal(result.processedCount, 1);
  assert.ok(await prisma.amazonSyncRawPage.findFirst({ where: { taskId: run.id, resource: "inventory_events", bodySha256: { not: "" } } }));
  const view = await readDomainReports(fixture.scope, new URLSearchParams({ resource: "inventory_events" }), fixture.actor);
  assert.equal(view.pagination.total, 1);
  assert.equal(view.rows[0].businessDate, fixture.from);
  assert.equal(view.rows[0].sellerSku, "fixture-sku");
  assert.equal(view.rows[0].quantityOriginal, "-2");
  assert.equal(view.rows[0].transactionType, "Adjustments");
  assert.ok(!JSON.stringify(view).includes("@example.invalid"));
  assert.equal(fixture.calls.filter(url => url.pathname === "/reports/2021-06-30/reports").length, 1);
});
