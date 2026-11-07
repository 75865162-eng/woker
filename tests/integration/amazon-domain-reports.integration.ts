import assert from "node:assert/strict";
import { storeSettlementPart, readSettlementParts } from "@/lib/amazon-sync/settlement-download-parts";
import { decodeReportParts } from "@/lib/amazon/report-download-range";
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
const site = "ATVPDKIKX0DER", otherSite = "A2EUQ1WTGCTBG2", region = "domain-reports-fixture-region", scopes: Array<[string, string]> = [];
before(() => { process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 73).toString("base64"); endpoints[region] = "https://domain-reports.fixture.invalid"; });
after(async () => { delete endpoints[region]; await prisma.$disconnect(); });

async function fresh(resource: "settlements" | "inventory_events" = "settlements", multi?: "all" | "anchor", missingAttribution = false, archiveOnly = false, ranged = false) {
  const scope = { organizationId: `domain-report-fixture-${randomUUID()}`, workspaceId: "domain-report-test" };
  scopes.push([scope.organizationId, scope.workspaceId]); process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify(scopes);
  const actor = randomUUID(), approver = randomUUID(), store = randomUUID(), authorizationId = randomUUID();
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Domain reports fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Domain reports fixture" } });
  for (const id of [actor, approver]) await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: "Fixture", passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: store, accountKey: store, displayName: "Domain reports fixture", marketplaceCode: "FX" } });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authorizationId, name: "Domain reports fixture", identityVerifiedAt: new Date(), amazonSellerId: "fixture-domain-seller", awsRegion: region, endpoint: endpoints[region], status: "CONFIGURED", approvedRoles: ["Finance and Accounting", "Amazon Fulfillment"], rolesAttestedAt: new Date(), marketplaceParticipations: [{ marketplaceId: site, countryCode: "FX" }, ...(multi ? [{ marketplaceId: otherSite, countryCode: "CA" }] : [])], updatedByUserId: actor, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId }) } });
  async function approved(command: Record<string, unknown>) {
    const request = await requestChange(scope, actor, command), id = String(request.id);
    await decideChange(scope, approver, id, "APPROVED", "offline fixture"); await applyChange(scope, actor, id);
    return prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id } });
  }
  const configured = await approved({ action: "save-source", authorizationId, sellerAccountId: store, marketplaceId: site, resource, freshnessMinutes: 60, enabled: true, ...(archiveOnly ? { domainPolicy: { mode: "seller-archive-only", version: 1, publication: "quarantined" } } : {}), ...(multi ? { settlementPolicy: { collectionMarketplaceIds: multi === "all" ? [site, otherSite] : [site] } } : {}) });
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: configured.targetId } });
  const secondSource = multi === "all" ? await approved({ action: "save-source", authorizationId, sellerAccountId: store, marketplaceId: otherSite, resource, freshnessMinutes: 60, enabled: true, settlementPolicy: { collectionMarketplaceIds: [site, otherSite] } }) : null;
  const calls: URL[] = [];
  const today = new Date().toISOString().slice(0, 10), to = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10), from = new Date(Date.parse(`${to}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);
  const ledgerWindow: { value: { dataStartTime: string; dataEndTime: string; eventType: string } | null } = { value: null };
  const eventReport = "Date\tFNSKU\tASIN\tMSKU\tTitle\tEvent Type\tReference ID\tQuantity\tFulfillment Center\tDisposition\tReason\tCountry\tReconciled Quantity\tUnreconciled Quantity\tDate and Time\tStore\tBuyer Email\n11/02/2026\tfixture-fnsku\tB012345678\tfixture-sku\tSample product\tAdjustments\tfixture-adjustment\t-2\tPHX7\tSELLABLE\tWAREHOUSE_DAMAGE\tUS\t-2\t0\t11/02/2026 08:30:00 PST\tAmazon.com\tprivate@example.invalid";
  const reportRows: Record<string, string> = {
    "fixture-settlement-1": "settlement-start-date\tsettlement-id\ttransaction-type\tamount-type\tamount-description\tamount\tcurrency\torder-id\tseller-sku\tasin\tbuyer-email\n2026-10-01\tfixture-settlement-1\tOrder\tItemPrice\tPrincipal\t12.34\tUSD\tfixture-order-1\tfixture-sku-1\tfixture-asin-1\tprivate@example.invalid",
    "fixture-settlement-2": "settlement-start-date\tsettlement-id\ttransaction-type\tamount-type\tamount-description\tamount\tcurrency\torder-id\tseller-sku\tasin\tbuyer-email\n2026-10-08\tfixture-settlement-2\tRefund\tItemPrice\tPrincipal\t-2.00\tUSD\tfixture-order-2\tfixture-sku-2\tfixture-asin-2\tother@example.invalid",
    "fixture-inventory-ledger": eventReport.replace("11/02/2026", new Date(`${from}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC" })),
  };
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
      const payload = JSON.parse(String(init.body)) as { reportType: string; marketplaceIds: string[]; dataStartTime: string; dataEndTime: string; reportOptions?: { eventType?: string } };
      assert.equal(payload.reportType, "GET_LEDGER_DETAIL_VIEW_DATA"); assert.deepEqual(payload.marketplaceIds, [site]);
      assert.equal(payload.dataStartTime, `${from}T00:00:00Z`); assert.equal(payload.dataEndTime, `${to}T23:59:59Z`);
      assert.equal(payload.reportOptions?.eventType, "Adjustments");
      ledgerWindow.value = { dataStartTime: payload.dataStartTime, dataEndTime: payload.dataEndTime, eventType: payload.reportOptions?.eventType ?? "" };
      return Response.json({ reportId: "fixture-inventory-ledger" });
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
      return resource === "inventory_events"
        ? Response.json({ reportId, reportType: "GET_LEDGER_DETAIL_VIEW_DATA", marketplaceIds: multi ? [site, otherSite] : [site], processingStatus: "DONE", reportDocumentId: reportId, createdTime: "2026-11-04T12:00:00Z", dataStartTime: ledgerWindow.value?.dataStartTime, dataEndTime: ledgerWindow.value?.dataEndTime })
        : Response.json({ reportId, reportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", marketplaceIds: multi ? [site, otherSite] : [site], processingStatus: "DONE", reportDocumentId: reportId, createdTime: reportId.endsWith("1") ? "2026-10-01T12:00:00Z" : "2026-10-08T12:00:00Z" });
    }
    if (url.pathname.startsWith("/reports/2021-06-30/documents/")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      return Response.json({ reportDocumentId: id, url: `https://download.fixture.invalid/${id}` });
    }
    throw new Error(`Unexpected fixture request ${url.pathname}`);
  };
  async function approvedRun(targetSourceId = source.id) {
    const request = await approved({ action: "run", sourceIds: [targetSourceId], ...(resource === "inventory_events" ? { dateFrom: from, dateTo: to, eventType: "Adjustments" } : {}) });
    return prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionApprovalId: request.id } });
  }
  async function slice(id: string, preserveBudget = false) {
    await prisma.amazonSyncRun.update({ where: { id }, data: { nextAttemptAt: new Date(0) } });
    if (!preserveBudget) await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId }, data: { nextRequestAt: new Date(0) } });
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
  return { scope, actor, authorizationId, source, secondSource, calls, approved, approvedRun, slice, finish, competingWorkers, from, to };
}

test("seller-only collection completes its cursor and separate watermark without publishing site facts", async () => {
  const fixture = await fresh("inventory_events", undefined, true, true);
  await fixture.approved({ action: "save-source", id: fixture.source.id, revision: fixture.source.revision, authorizationId: fixture.authorizationId, sellerAccountId: fixture.source.sellerAccountId, marketplaceId: site, resource: "inventory_events", freshnessMinutes: 60, enabled: true, domainPolicy: { mode: "seller-archive-only", version: 1, publication: "quarantined" } });
  const run = await fixture.approvedRun();
  assert.deepEqual((run.frozenScope as { sellerArchivePolicy: unknown }).sellerArchivePolicy, { mode: "seller-archive-only", version: 1, publication: "quarantined" });
  const result = await fixture.finish(run.id);
  assert.equal(result.status, "SUCCEEDED", result.error ?? "collection failed");
  assert.equal(result.stage, "ARCHIVED_SITE_PENDING");
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: fixture.source.id }, include: { resourceCursor: true } });
  assert.equal(source.lastSuccessAt, null);
  assert.equal(source.activeRunId, null);
  assert.equal(source.rowCount, 0);
  assert.equal(source.resourceCursor?.status, "SUCCEEDED");
  assert.equal(source.resourceCursor?.lastSuccessAt, null);
  assert.equal((source.coverage as { archiveCollection: { published: boolean; rows: number } }).archiveCollection.published, false);
  assert.equal((source.coverage as { archiveCollection: { rows: number } }).archiveCollection.rows, 1);
  const document = await prisma.amazonSyncReportDocument.findFirstOrThrow({ where: { sourceId: source.id } });
  assert.equal(document.status, "STAGED"); assert.equal(document.publishedAt, null);
  const view = await readDomainReports(fixture.scope, new URLSearchParams({ resource: "inventory_events" }), fixture.actor);
  assert.equal(view.pagination.total, 0); assert.equal(view.documents.length, 0);
  assert.equal(fixture.calls.filter(url => url.hostname === "download.fixture.invalid").length, 1);
});

test("settlement partial evidence is encrypted, scoped and cannot publish incomplete data", async () => {
  const fixture = await fresh(), run = await fixture.approvedRun();
  const part = { bytes: Buffer.from("safe-fixture"), offset: 0, total: 12, etag: '"fixture"', charset: "utf-8", compressionAlgorithm: null };
  const state = await prisma.$transaction(tx => storeSettlementPart(tx, fixture.scope, run.id, "fixture-document", part));
  const stored = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: run.id } });
  assert.equal(stored.rawCiphertext.includes("safe-fixture"), false);
  assert.equal(await prisma.amazonSettlementReport.count({ where: fixture.scope }), 0);
  const read = await prisma.$transaction(tx => readSettlementParts(tx, fixture.scope, fixture.source.id, state, "fixture-document"));
  assert.equal(decodeReportParts(read), "safe-fixture");
  await assert.rejects(prisma.$transaction(tx => readSettlementParts(tx, fixture.scope, "foreign-source", state, "fixture-document")));
  await assert.rejects(prisma.$transaction(tx => readSettlementParts(tx, fixture.scope, fixture.source.id, state, "changed-document")));
  await prisma.amazonSyncRawPage.update({ where: { taskId_page: { taskId: run.id, page: stored.page } }, data: { bodySha256: "tampered" } });
  await assert.rejects(prisma.$transaction(tx => readSettlementParts(tx, fixture.scope, fixture.source.id, state, "fixture-document")));
});

test("settlement range checkpoint resumes assembly without metadata quota and publishes only complete originals", async t => {
  process.env.AMAZON_SETTLEMENT_RANGE_LOCAL = "1"; t.after(() => { delete process.env.AMAZON_SETTLEMENT_RANGE_LOCAL; });
  const fixture = await fresh("settlements", "all", false, false, true), run = await fixture.approvedRun();
  let state = await fixture.slice(run.id);
  for (let i = 0; i < 15 && state.stage !== "SETTLEMENT_DOWNLOAD_PART"; i++) state = await fixture.slice(run.id);
  assert.equal(state.stage, "SETTLEMENT_DOWNLOAD_PART", state.error ?? "");
  assert.equal(await prisma.amazonSettlementReport.count({ where: { ...fixture.scope, status: "PUBLISHED" } }), 0);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id, resource: "settlement_download_part" } }), 1);
  await prisma.amazonSyncApiBudget.updateMany({ where: { ...fixture.scope, operation: "getReportDocument" }, data: { nextRequestAt: new Date(Date.now() + 60000) } });
  const metadataCalls = fixture.calls.filter(url => url.pathname.startsWith("/reports/2021-06-30/documents/")).length;
  state = await fixture.slice(run.id, true);
  assert.equal(state.stage, "SETTLEMENT_DOWNLOAD_PART");
  assert.equal(fixture.calls.filter(url => url.pathname.startsWith("/reports/2021-06-30/documents/")).length, metadataCalls);
  assert.equal(await prisma.amazonSettlementReport.count({ where: { ...fixture.scope, status: "PUBLISHED" } }), 0);
  await prisma.amazonSyncApiBudget.updateMany({ where: { ...fixture.scope, operation: "getReportDocument" }, data: { nextRequestAt: new Date(Date.now() + 60000) } });
  const calls = fixture.calls.length;
  state = await fixture.slice(run.id, true);
  assert.equal(state.stage, "SETTLEMENT_ARCHIVED", state.error ?? ""); assert.equal(fixture.calls.length, calls);
  assert.equal((await fixture.finish(run.id)).status, "SUCCEEDED");
  assert.equal(await prisma.amazonSettlementReport.count({ where: { ...fixture.scope, status: "PUBLISHED" } }), 2);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id, resource: "settlement_download_part" } }), 3);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id, resource: "settlements" } }), 2);
});

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
  const sourceBefore = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: fixture.source.id } });
  await prisma.amazonSyncDataSource.update({ where: { id: fixture.source.id }, data: { coverage: { rowAttribution: { status: "VERIFIED", version: "explicit-report-row.v1", complete: false } } } });
  const pending = await readDomainReports(fixture.scope, new URLSearchParams({ resource: "inventory_events" }), fixture.actor);
  assert.equal(pending.pagination.total, 0);
  assert.equal(pending.documents.length, 0);
  assert.equal(pending.source?.lastSuccessAt, null);
  await prisma.amazonSyncDataSource.update({ where: { id: fixture.source.id }, data: { coverage: sourceBefore.coverage! } });
  assert.equal((await readDomainReports(fixture.scope, new URLSearchParams({ resource: "inventory_events" }), fixture.actor)).pagination.total, 1);
  await prisma.amazonSyncReportRow.update({ where: { id: view.rows[0].id }, data: { fields: { country: "US", "currency-unit": "USD" } } });
  assert.equal((await readDomainReports(fixture.scope, new URLSearchParams({ resource: "inventory_events" }), fixture.actor)).pagination.total, 0);
  assert.equal(await prisma.amazonSyncReportRow.count({ where: { sourceId: fixture.source.id } }), 1);
  assert.equal(fixture.calls.filter(url => url.pathname === "/reports/2021-06-30/reports").length, 1);
});


test("seller settlement archive is shared once; site projections and quarantine remain isolated", async () => {
  const fixture = await fresh("settlements", "all"), run = await fixture.approvedRun();
  const first = await fixture.finish(run.id);
  assert.equal(first.status, "SUCCEEDED", first.error ?? "");
  const second = await fixture.approvedRun(fixture.secondSource!.targetId);
  const result = await fixture.finish(second.id);
  assert.equal(result.status, "SUCCEEDED", result.error ?? "");
  assert.equal(await prisma.amazonSettlementReport.count({ where: fixture.scope }), 2);
  assert.equal(fixture.calls.filter(url => url.hostname === "download.fixture.invalid").length, 2);
  const reports = await prisma.amazonSettlementReport.findMany({ where: fixture.scope });
  assert.ok(reports.every(r => r.rawTaskId === run.id && r.status === "PUBLISHED"));
  const quarantined = await prisma.amazonSettlementRow.findMany({ where: { ...fixture.scope, attributionStatus: { not: "ATTRIBUTED" } } });
  assert.equal(quarantined.length, 2);
  assert.ok(quarantined.every(r => r.fields === null && r.sourceId === null && r.amountOriginal === null && r.orderId === null));
  for (const [sourceId, name] of [[fixture.source.id, "Amazon.com"], [fixture.secondSource!.targetId, "Amazon.ca"]]) {
    const view = await readDomainReports(fixture.scope, new URLSearchParams({ resource: "settlements", sourceId }), fixture.actor);
    assert.equal(view.pagination.total, 2);
    assert.ok(view.rows.every(r => (r.fields as Record<string, string>)["marketplace-name"] === name));
    assert.ok(!JSON.stringify(view).includes("@example.invalid"));
  }
  await assert.rejects(prisma.amazonSettlementRow.update({ where: { id: quarantined[0].id }, data: { amountOriginal: "1" } }));
});

test("unapproved report sites stop before document metadata or original download", async () => {
  const fixture = await fresh("settlements", "anchor"), run = await fixture.approvedRun();
  const result = await fixture.finish(run.id);
  assert.notEqual(result.status, "SUCCEEDED");
  assert.ok(!fixture.calls.some(url => url.hostname === "download.fixture.invalid" || url.pathname.includes("/documents/")));
  assert.equal(await prisma.amazonSettlementReport.count({ where: fixture.scope }), 0);
});

test("two site tasks reserve one seller report and resume without duplicate rows", async () => {
  const fixture = await fresh("settlements", "all");
  const a = await fixture.approvedRun(), b = await fixture.approvedRun(fixture.secondSource!.targetId);
  // Both discover the same reports and finish metadata lookup before competing for the archive.
  for (const run of [a, b]) for (let i = 0; i < 3; i++) assert.equal((await fixture.slice(run.id)).status, "WAITING");
  await Promise.all([fixture.slice(a.id), fixture.slice(b.id)]);
  assert.equal(fixture.calls.filter(url => url.hostname === "download.fixture.invalid").length, 1);
  const owner = await prisma.amazonSettlementReport.findFirstOrThrow({ where: fixture.scope });
  const waiting = owner.sourceRunId === a.id ? b.id : a.id;
  const requestsBeforeLocalParse = fixture.calls.length;
  await prisma.amazonSyncApiBudget.updateMany({ where: { ...fixture.scope, operation: "getReportDocument" }, data: { nextRequestAt: new Date(Date.now() + 60_000) } });
  await fixture.slice(owner.sourceRunId, true);
  assert.equal(fixture.calls.length, requestsBeforeLocalParse);
  assert.equal((await prisma.amazonSettlementReport.findUniqueOrThrow({ where: { id: owner.id } })).status, "PUBLISHED");
  assert.equal((await fixture.finish(owner.sourceRunId)).status, "SUCCEEDED");
  assert.equal((await fixture.finish(waiting)).status, "SUCCEEDED");
  assert.equal(fixture.calls.filter(url => url.hostname === "download.fixture.invalid").length, 2);
  assert.equal(await prisma.amazonSettlementRow.count({ where: fixture.scope }), 6);
  assert.equal(await prisma.amazonSyncReportRow.count({ where: fixture.scope }), 4);
});

test("revoked participation after metadata lookup blocks download and preserves cursor", async () => {
  const fixture = await fresh("settlements", "all"), run = await fixture.approvedRun();
  for (let i = 0; i < 3; i++) await fixture.slice(run.id);
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: fixture.source.id } });
  const calls = fixture.calls.length;
  await prisma.amazonSpApiAuthorization.update({ where: { id: fixture.authorizationId }, data: { marketplaceParticipations: [{ marketplaceId: site, countryCode: "US" }] } });
  const result = await fixture.slice(run.id);
  assert.equal(result.status, "BLOCKED");
  assert.equal(fixture.calls.length, calls);
  assert.equal((await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: fixture.source.id } })).reportStateCiphertext, cursor.reportStateCiphertext);
});

test("warehouse-only ledger evidence blocks publication and keeps raw rows and cursor", async () => {
  const fixture = await fresh("inventory_events", undefined, true), run = await fixture.approvedRun();
  const result = await fixture.finish(run.id);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.stage, "REPORT_ATTRIBUTION_PENDING");
  assert.ok(result.checkpointCiphertext);
  assert.equal(await prisma.amazonSyncRawPage.count({where:{taskId:run.id}}),1);
  assert.equal(await prisma.amazonSyncReportRow.count({where:{sourceId:fixture.source.id}}),1);
  assert.equal(await prisma.amazonSyncReportDocument.count({where:{sourceId:fixture.source.id,status:"PUBLISHED"}}),0);
  const view = await readDomainReports(fixture.scope,new URLSearchParams({resource:"inventory_events"}),fixture.actor);
  assert.equal(view.pagination.total,0); assert.equal(view.rows.length,0); assert.equal(view.documents.length,0);
});
