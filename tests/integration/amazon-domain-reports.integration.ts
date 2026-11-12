// Cloud role for injected offline task fixtures; no real Amazon calls.
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
import { callSyncChatTool } from "@/lib/lili/sync-chat-server";
import { decryptCheckpoint, encryptCheckpoint } from "@/lib/amazon-sync/checkpoint";
import { readActualFieldCoverage } from "@/lib/amazon-sync/actual-field-coverage";
import { domainReportTypes, parseDomainReport } from "@/lib/amazon-sync/domain-reports";
import { readSyncCoverage } from "@/lib/amazon-sync/coverage";
import { comparePersistedField, recordDomainReportFieldPersistence, recordSettlementFieldPersistence } from "@/lib/amazon-sync/field-persistence-evidence";
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
import { readFieldRegistry, registerArchivedFields } from "@/lib/amazon-sync/field-registry";
import { unseal } from "@/lib/amazon-sync/approval-policy";
import { archiveResponse } from "@/lib/amazon-sync/response-evidence";
import { authenticateAmazonMcp, invokeAmazonMcp, manageMcpCredential } from "@/lib/amazon-sync/mcp";
import { previewFieldArchiveRecovery, readFieldArchiveRecoveryPreview, archiveScanPages } from "@/lib/amazon-sync/field-archive-recovery";
import { normalizeCommand } from "@/lib/amazon-sync/approval-policy";
import { previewSettlementCurrencyRepair, readSettlementCurrencyRepairPreview } from "@/lib/amazon-sync/settlement-currency-repair";
import { readReportAttributionPreview } from "@/lib/amazon-sync/report-attribution-recovery";
import { createTask } from "@/lib/amazon-sync/service";
import { automaticPlanKey } from "@/lib/amazon-sync/automatic-schedule";
import { domainReportHistoryCursorDigest } from "@/lib/amazon-sync/domain-reports";
import { recoverAutomaticFailures } from "@/lib/amazon-sync/automatic-recovery";

if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1" || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw new Error("Disposable offline database required");
const site = "ATVPDKIKX0DER", otherSite = "A2EUQ1WTGCTBG2", region = "domain-reports-fixture-region", scopes: Array<[string, string]> = [];
before(() => { process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 73).toString("base64"); endpoints[region] = "https://domain-reports.fixture.invalid"; });
after(async () => { delete endpoints[region]; await prisma.$disconnect(); });

async function fresh(resource: "settlements" | "inventory_events" | "reimbursements" | "inventory_age" | "mfn_returns" = "settlements", multi?: "all" | "anchor", missingAttribution = false, archiveOnly = false, ranged = false) {
  const scope = { organizationId: `domain-report-fixture-${randomUUID()}`, workspaceId: "domain-report-test" };
  scopes.push([scope.organizationId, scope.workspaceId]); process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify(scopes);
  const actor = randomUUID(), approver = randomUUID(), store = randomUUID(), authorizationId = randomUUID();
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Domain reports fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Domain reports fixture" } });
  for (const id of [actor, approver]) await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: "Fixture", passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: store, accountKey: store, displayName: "Domain reports fixture", marketplaceCode: "FX" } });
  await prisma.amazonDataAccessGrant.createMany({ data: [actor, approver].map(userId => ({ ...scope, id: randomUUID(), userId, sellerAccountId: store, marketplaceIds: [site], actions: ["view", "sync"] })) });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authorizationId, name: "Domain reports fixture", identityVerifiedAt: new Date(), amazonSellerId: "fixture-domain-seller", awsRegion: region, endpoint: endpoints[region], status: "CONFIGURED", approvedRoles: ["Finance and Accounting", "Amazon Fulfillment", "Inventory and Order Tracking"], rolesAttestedAt: new Date(), marketplaceParticipations: [{ marketplaceId: site, countryCode: "FX" }, ...(multi ? [{ marketplaceId: otherSite, countryCode: "CA" }] : [])], updatedByUserId: actor, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId }) } });
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
    "fixture-reimbursements": `approval-date\treimbursement-id\tsku\tasin\tamount-total\tcurrency-unit\tquantity-reimbursed-total\tstore\n${from}\tfixture-reimbursement\tfixture-sku\tB012345678\t12345678901234567890.123400\tUSD\t2\t${missingAttribution ? "" : "Amazon.com"}`,
    "fixture-inventory_age": `snapshot-date\tsku\tasin\tavailable\n${from}\tfixture-sku\tB012345678\t7`,
    "fixture-mfn_returns": `order-id\torder-item-id\torder-date\treturn-request-date\treturn-request-status\tasin\tmerchant-sku\treturn-quantity\treturn-reason\trefunded-amount\tcurrency-code\ttracking-id\nfixture-order\tfixture-item\t${from}\t${from}\tApproved\tB012345678\tfixture-sku\t2\tUnwanted\t12345678901234567890.123400\tUSD\tprivate-tracking`,
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
      assert.equal(payload.reportType, domainReportTypes[resource]); assert.deepEqual(payload.marketplaceIds, [site]);
      if (resource !== "inventory_age") { assert.equal(payload.dataStartTime, `${from}T00:00:00Z`); assert.equal(payload.dataEndTime, `${to}T23:59:59Z`); }
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
        ? Response.json({ reportId, reportType: domainReportTypes[resource], marketplaceIds: multi ? [site, otherSite] : [site], processingStatus: "DONE", reportDocumentId: reportId, createdTime: "2026-11-04T12:00:00Z", dataStartTime: ledgerWindow.value?.dataStartTime, dataEndTime: ledgerWindow.value?.dataEndTime })
        : Response.json({ reportId, reportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", marketplaceIds: multi ? [site, otherSite] : [site], processingStatus: "DONE", reportDocumentId: reportId, createdTime: reportId.endsWith("1") ? "2026-10-01T12:00:00Z" : "2026-10-08T12:00:00Z" });
    }
    if (url.pathname.startsWith("/reports/2021-06-30/documents/")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      return Response.json({ reportDocumentId: id, url: `https://download.fixture.invalid/${id}` });
    }
    throw new Error(`Unexpected fixture request ${url.pathname}`);
  };
  async function approvedRun(targetSourceId = source.id) {
    const request = await approved({ action: "run", sourceIds: [targetSourceId], ...(resource === "inventory_events" ? { dateFrom: from, dateTo: to, eventType: "Adjustments" } : resource === "reimbursements" || resource === "mfn_returns" ? { dateFrom: from, dateTo: to } : {}) });
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
  return { scope, actor, authorizationId, source, secondSource, calls, reportRows, approved, approvedRun, slice, finish, competingWorkers, from, to };
}

test("archived settlement fields are durable, idempotent, private and queryable as observations", async () => {
  const f = await fresh();
  const run = await f.finish((await f.approvedRun()).id);
  assert.equal(run.status, "SUCCEEDED");
  const raws = await prisma.amazonSyncRawPage.findMany({ where: { ...f.scope, taskId: run.id, resource: "settlements", page: { gt: 0 } } });
  assert.ok(raws.length);
  const observationCount = () => prisma.amazonFieldObservation.count({ where: { ...f.scope, rawTaskId: run.id } });
  const before = await observationCount();
  assert.ok(before > 0);
  for (const raw of raws) {
    const text = unseal(raw.rawCiphertext, f.scope, `${run.id}:${raw.page}`, "amazon-settlements-raw.v1").rawText;
    if (typeof text !== "string") continue;
    await prisma.$transaction(tx => registerArchivedFields(tx, run, raw.page, text, "REPORT"));
  }
  assert.equal(await observationCount(), before);
  const data = await readFieldRegistry(f.scope, new URLSearchParams({ sourceId: f.source.id }), f.actor);
  assert.ok(data.rows.some(row => row.sourcePath === "/columns/currency"));
  assert.ok(data.rows.every(row => !row.structuredPersistenceVerified && !row.queryAcceptanceVerified));
  assert.ok(data.rows.every(row => row.persistenceEvidence.length === 0));
  assert.ok(data.rows.some(row => row.mappingStatus === "UNMAPPED"));
  assert.ok(data.rows.some(row => row.mappingStatus === "MAPPED"));
  assert.equal(data.coverage.structuredPersistedFields, null);
  await assert.rejects(() => prisma.$transaction(async tx => {
    await archiveResponse(tx, run, 777, { operation: "fixture-rollback", apiVersion: "fixture" }, '{"neverCommitted":null}');
    throw new Error("ROLLBACK_FIXTURE");
  }), /ROLLBACK_FIXTURE/);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { ...f.scope, taskId: run.id, page: 777 } }), 0);
  assert.equal(await observationCount(), before);
  assert.equal(JSON.stringify(data).includes("private@example.invalid"), false);
  const field = await prisma.amazonFieldRegistry.findFirstOrThrow({ where: { ...f.scope } });
  await assert.rejects(() => prisma.amazonFieldObservation.create({ data: { ...f.scope, workspaceId: "wrong-workspace", id: randomUUID(), fieldRegistryId: field.id, rawTaskId: run.id, rawPage: raws[0].page, scannerVersion: "cross-scope", observedTypes: [], scanComplete: true, observedAt: new Date() } }));
  await assert.rejects(() => readFieldRegistry(f.scope, new URLSearchParams({ sourceId: f.source.id }), f.actor, []), /不可访问/);
  await prisma.amazonSellerIdentity.create({ data: { ...f.scope, id: randomUUID(), sellerAccountId: f.source.sellerAccountId, marketplaceId: site,
    amazonSellerId: "fixture-domain-seller", region, authorizationId: f.authorizationId, verifiedAt: new Date() } });
  await prisma.amazonDataAccessGrant.updateMany({ where: { ...f.scope, userId: f.actor, sellerAccountId: f.source.sellerAccountId }, data: { marketplaceIds: [site], actions: ["view"], mcpEnabled: true } });
  const made = await manageMcpCredential(f.scope, f.actor, { action: "create", name: "Field catalogue fixture", scopes: [{ sellerAccountId: f.source.sellerAccountId, marketplaceIds: [site] }], tools: ["amazon.fields.catalog", "amazon.fields.coverage"], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp(`Bearer ${made.token}`);
  const mcpResult = await invokeAmazonMcp(identity, "amazon.fields.catalog", { sellerAccountId: f.source.sellerAccountId, marketplaceId: site, sourceId: f.source.id });
  assert.ok(JSON.stringify(mcpResult).includes("OBSERVED_RAW_FIELDS_ONLY"));
  const mcpCoverage = await invokeAmazonMcp(identity, "amazon.fields.coverage", { sellerAccountId: f.source.sellerAccountId, marketplaceId: site, sourceId: f.source.id });
  assert.ok(JSON.stringify(mcpCoverage).includes("rowsWithAmountMissingCurrency"));
  await assert.rejects(() => invokeAmazonMcp(identity, "amazon.fields.coverage", { sellerAccountId: f.source.sellerAccountId, marketplaceId: otherSite, sourceId: f.source.id }));
  await prisma.amazonDataAccessGrant.updateMany({ where: { ...f.scope, userId: f.actor }, data: { mcpEnabled: false } });
  assert.ok(await invokeAmazonMcp(identity, "amazon.fields.catalog", { sellerAccountId: f.source.sellerAccountId, marketplaceId: site, sourceId: f.source.id }));
  assert.ok(await invokeAmazonMcp(identity, "amazon.fields.coverage", { sellerAccountId: f.source.sellerAccountId, marketplaceId: site, sourceId: f.source.id }));
});

test("approved currency repair preserves original facts and rejects stale row-state digests", async () => {
  const f = await fresh();
  const run = await f.finish((await f.approvedRun()).id);
  assert.equal(run.status, "SUCCEEDED");
  const documents = await prisma.amazonSyncReportDocument.findMany({ where: { ...f.scope, sourceId: f.source.id } });
  assert.ok(documents.length);
  const before = await prisma.amazonSyncReportRow.findMany({ where: { ...f.scope, sourceId: f.source.id }, orderBy: { id: "asc" } });
  assert.ok(before.length);
  await prisma.amazonSyncReportRow.updateMany({ where: { ...f.scope, sourceId: f.source.id }, data: { currencyCode: null, currencySource: null, currencySourceRowNumber: null } });
  await prisma.amazonSettlementRow.updateMany({ where: { ...f.scope, sourceId: f.source.id }, data: { currencyCode: null, currencySource: null, currencySourceRowNumber: null } });
  const ids = documents.map(doc => doc.id);
  const preview = await prisma.$transaction(tx => previewSettlementCurrencyRepair(tx, f.scope, f.source.id, ids));
  const request = await f.approved({ action: "recover-report", id: f.source.id, revision: f.source.revision, recoveryDigest: preview.recoveryDigest, currencyOnly: true, reportDocumentIds: ids });
  assert.equal(request.status, "APPLIED");
  const after = await prisma.amazonSyncReportRow.findMany({ where: { ...f.scope, sourceId: f.source.id }, orderBy: { id: "asc" } });
  const identity = (rows: typeof before) => rows.map(row => [row.id, row.rowNumber, row.rowHash, row.amountOriginal]);
  assert.deepEqual(identity(after), identity(before));
  assert.ok(after.every(row => row.currencyCode === "USD" && row.currencySource === "ROW"));
  const canonical = await prisma.amazonSettlementRow.findMany({ where: { ...f.scope, sourceId: f.source.id } });
  assert.ok(canonical.every(row => row.currencyCode === "USD"));
  const stale = await prisma.$transaction(tx => previewSettlementCurrencyRepair(tx, f.scope, f.source.id, ids));
  await prisma.amazonSyncReportRow.update({ where: { id: after[0].id }, data: { currencyCode: null, currencySource: null, currencySourceRowNumber: null } });
  await assert.rejects(() => requestChange(f.scope, f.actor, { action: "recover-report", id: f.source.id, revision: f.source.revision, recoveryDigest: stale.recoveryDigest, currencyOnly: true, reportDocumentIds: ids }), /清单已变化/);
});

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

test("partial attribution reads only verified site rows and never exposes the quarantined remainder", async () => {
  const f = await fresh("inventory_events");
  await f.finish((await f.approvedRun()).id);
  const row = await prisma.amazonSyncReportRow.findFirstOrThrow({ where: { ...f.scope, sourceId: f.source.id } });
  await prisma.amazonSyncReportRow.create({ data: { ...row, id: randomUUID(), rowNumber: row.rowNumber + 100, rowHash: "quarantined-row", fields: { ...row.fields as object, __siteEvidenceVersion: "verified-site-v2", __siteEvidenceStatus: "VERIFIED", __verifiedMarketplaceId: otherSite } } });
  await prisma.amazonSyncDataSource.update({ where: { id: f.source.id }, data: { coverage: { rowAttribution: { status: "PARTIAL", version: "verified-site-rows.v1", complete: false, verifiedRows: 1, parsedRows: 2 } } } });
  const view = await readDomainReports(f.scope, new URLSearchParams({ resource: "inventory_events", sourceId: f.source.id }), f.actor);
  assert.equal(view.pagination.total, 1);
  assert.equal(view.rows[0].id, row.id);
  assert.equal(await prisma.amazonSyncReportRow.count({ where: { sourceId: f.source.id } }), 2);
  const coverage = await readSyncCoverage(f.scope, new URLSearchParams({ sellerAccountId: f.source.sellerAccountId, marketplaceId: site }), f.actor);
  const sourceCoverage = coverage.sources.find(source => source.sourceId === f.source.id);
  assert.equal(sourceCoverage?.visibleRows, 1);
  assert.equal(sourceCoverage?.published, true);
  assert.equal(sourceCoverage?.status, "ATTRIBUTION_PENDING");
  assert.equal(sourceCoverage?.complete, false);
  assert.equal(sourceCoverage?.history.complete, false);
});
test("seller-only archived reports produce a bounded attribution approval request without publishing", async () => {
  const fixture = await fresh("inventory_events", undefined, true, true);
  const run = await fixture.finish((await fixture.approvedRun()).id);
  assert.equal(run.stage, "ARCHIVED_SITE_PENDING");
  const params = new URLSearchParams({ sourceId: fixture.source.id });
  const preview = await readReportAttributionPreview(fixture.scope, fixture.actor, params);
  assert.equal(preview.started, false);
  assert.equal(preview.rawValuesIncluded, false);
  assert.equal(preview.manifest.documents.length, 1);
  assert.equal(preview.manifest.documents[0].rowCount, 1);
  assert.equal(JSON.stringify(preview).includes("private@example.invalid"), false);
  assert.equal(preview.command.attributionOnly, true);
  const change = await requestChange(fixture.scope, fixture.actor, preview.command);
  assert.equal(change.status, "REQUESTED");
  assert.equal((await prisma.amazonSyncReportDocument.findFirstOrThrow({ where: { sourceId: fixture.source.id } })).status, "STAGED");
  assert.equal(await prisma.amazonSyncReportRow.count({ where: { sourceId: fixture.source.id, fields: { path: ["__siteEvidenceStatus"], equals: "VERIFIED" } } }), 0);
  await assert.rejects(() => readReportAttributionPreview(fixture.scope, randomUUID(), params));
  const duplicate = new URLSearchParams(params); duplicate.append("sourceId", fixture.source.id);
  await assert.rejects(() => readReportAttributionPreview(fixture.scope, fixture.actor, duplicate), /唯一/);
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
  await assert.rejects(readDomainReports(unauthorized.scope, new URLSearchParams({ resource: "settlements", sourceId: fixture.source.id }), unauthorized.actor), /不可访问|不属于当前账号/);
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


test("historical field recovery is bounded, approved, private and idempotent", async () => {
  assert.deepEqual(archiveScanPages([2, -1, 1]), [-1, 1, 2]);
  for (const pages of [[], [0], [1, 1], [1.5], [Number.MAX_SAFE_INTEGER + 1], Array.from({ length: 11 }, (_, i) => i + 1)]) assert.throws(() => archiveScanPages(pages));
  assert.throws(() => normalizeCommand({ action: "recover-report", fieldScanOnly: true, currencyOnly: true }));
  assert.throws(() => normalizeCommand({ action: "recover-report", fieldScanOnly: true, reportWindow: {} }));
  const f = await fresh();
  const run = await f.finish((await f.approvedRun()).id);
  assert.equal(run.status, "SUCCEEDED");
  const raw = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { ...f.scope, taskId: run.id, page: { gt: 0 } }, orderBy: { page: "asc" } });
  const factsBefore = await prisma.amazonSyncReportRow.findMany({ where: { ...f.scope }, orderBy: { id: "asc" } });
  const callsBefore = f.calls.length;
  // Only this disposable fixture's observations are removed to model an old archive.
  await prisma.amazonFieldObservation.deleteMany({ where: { ...f.scope, rawTaskId: run.id, rawPage: raw.page } });
  const params = new URLSearchParams({ sourceId: f.source.id, taskId: run.id, rawPages: String(raw.page) });
  const preview = await readFieldArchiveRecoveryPreview(f.scope, f.actor, params);
  assert.equal(preview.started, false);
  assert.equal(preview.rawValuesIncluded, false);
  assert.equal(JSON.stringify(preview).includes("private@example.invalid"), false);
  await assert.rejects(() => prisma.$transaction(tx => previewFieldArchiveRecovery(tx, f.scope, f.source.id, run.id, [999999])), /范围不完整/);
  await assert.rejects(() => prisma.$transaction(tx => previewFieldArchiveRecovery(tx, { ...f.scope, workspaceId: "foreign" }, f.source.id, run.id, [raw.page])));
  assert.equal((await f.approved(preview.command)).status, "APPLIED");
  const count = await prisma.amazonFieldObservation.count({ where: { ...f.scope, rawTaskId: run.id, rawPage: raw.page } });
  assert.ok(count > 0);
  const configVersions = await prisma.amazonDataCenterConfigVersion.count({ where: { ...f.scope } });
  await f.approved(preview.command);
  assert.equal(await prisma.amazonDataCenterConfigVersion.count({ where: { ...f.scope } }), configVersions);
  assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } })).revision, f.source.revision);
  assert.deepEqual(await prisma.amazonSyncRawPage.findUniqueOrThrow({ where: { taskId_page: { taskId: raw.taskId, page: raw.page } } }), raw);
  assert.equal(await prisma.amazonFieldObservation.count({ where: { ...f.scope, rawTaskId: run.id, rawPage: raw.page } }), count);
  assert.deepEqual(await prisma.amazonSyncReportRow.findMany({ where: { ...f.scope }, orderBy: { id: "asc" } }), factsBefore);
  assert.equal(f.calls.length, callsBefore);
  await prisma.amazonSyncRawPage.update({ where: { taskId_page: { taskId: raw.taskId, page: raw.page } }, data: { bodySha256: "tampered-fixture" } });
  await assert.rejects(() => readFieldArchiveRecoveryPreview(f.scope, f.actor, params), /摘要校验失败/);
  await prisma.amazonSyncRawPage.update({ where: { taskId_page: { taskId: raw.taskId, page: raw.page } }, data: { bodySha256: raw.bodySha256, requestMetadata: { changed: true } } });
  await assert.rejects(() => requestChange(f.scope, f.actor, preview.command), /清单已变化/);
});

test("mapping upgrades append immutable versions and unchanged scans reuse the latest", async () => {
  const f = await fresh();
  const run = await f.finish((await f.approvedRun()).id);
  const raw = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { ...f.scope, taskId: run.id, page: { gt: 0 } }, orderBy: { page: "asc" } });
  const text = unseal(raw.rawCiphertext, f.scope, `${run.id}:${raw.page}`, "amazon-settlements-raw.v1").rawText;
  assert.equal(typeof text, "string");
  const mapping = await prisma.amazonFieldMappingVersion.findFirstOrThrow({ where: { ...f.scope } });
  // Simulate a prior installed rule only in this disposable fixture.
  await prisma.amazonFieldMappingVersion.update({ where: { id: mapping.id }, data: { transformRule: { parserVersion: "fixture-previous" } } });
  await prisma.$transaction(tx => registerArchivedFields(tx, run, raw.page, String(text), "REPORT"));
  const versions = await prisma.amazonFieldMappingVersion.findMany({ where: { ...f.scope, fieldRegistryId: mapping.fieldRegistryId }, orderBy: { mappingVersion: "asc" } });
  assert.deepEqual(versions.map(item => item.mappingVersion), [1, 2]);
  assert.deepEqual(versions[0].transformRule, { parserVersion: "fixture-previous" });
  await prisma.$transaction(tx => registerArchivedFields(tx, run, raw.page, String(text), "REPORT"));
  assert.equal(await prisma.amazonFieldMappingVersion.count({ where: { ...f.scope, fieldRegistryId: mapping.fieldRegistryId } }), 2);
});


test("settlement persistence evidence reads back exact batches without promoting full acceptance", async () => {
  const f = await fresh("settlements", "all");
  const run = await f.finish((await f.approvedRun()).id);
  assert.equal(run.status, "SUCCEEDED");
  const events = await prisma.auditLog.findMany({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.fields.persistence-checked" } });
  assert.equal(events.length, 4);
  for (const event of events) {
    const evidence = event.metadata as Record<string, unknown>;
    assert.equal(evidence.status, "PASSED");
    assert.equal(evidence.checkedRows, 1);
    assert.equal(evidence.nonNullRows, 1);
    assert.equal(evidence.historicalUniverseComplete, false);
    assert.equal(evidence.queryAcceptanceVerified, false);
    assert.equal(evidence.mappingVersion, 1);
  }
  assert.equal(JSON.stringify(events).includes("private@example.invalid"), false);
  const catalogue = await readFieldRegistry(f.scope, new URLSearchParams({ sourceId: f.source.id }), f.actor);
  assert.ok(catalogue.rows.some(row => row.persistenceEvidence.length > 0));
  assert.ok(catalogue.rows.every(row => !row.structuredPersistenceVerified && !row.queryAcceptanceVerified));
  assert.equal(catalogue.coverage.structuredPersistedFields, null);
  const document = await prisma.amazonSettlementReport.findFirstOrThrow({ where: { ...f.scope } });
  const rows = await prisma.amazonSettlementRow.findMany({ where: { ...f.scope, reportDocumentId: document.id, sourceId: f.source.id } });
  const input = { sourceId: f.source.id, reportDocumentId: document.id, rawTaskId: document.rawTaskId!, rawPage: document.rawPage!, rows };
  await prisma.$transaction(tx => recordSettlementFieldPersistence(tx, f.scope, f.actor, input));
  assert.equal(await prisma.auditLog.count({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.fields.persistence-checked" } }), 4);
  await prisma.amazonSettlementRow.update({ where: { id: rows[0].id }, data: { currencyCode: null, currencySource: null, currencySourceRowNumber: null } });
  await assert.rejects(() => prisma.$transaction(async tx => {
    await recordSettlementFieldPersistence(tx, f.scope, f.actor, input);
    throw new Error("FIELD_EVIDENCE_ROLLBACK");
  }), /FIELD_EVIDENCE_ROLLBACK/);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.fields.persistence-checked" } }), 4);
  const check = await prisma.$transaction(tx => recordSettlementFieldPersistence(tx, f.scope, f.actor, input));
  assert.equal(check.passed, false);
  const failed = await prisma.auditLog.findMany({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.fields.persistence-checked", metadata: { path: ["status"], equals: "FAILED" } } });
  assert.equal(failed.length, 1);
  assert.equal((failed[0].metadata as Record<string, unknown>).mismatchRows, 1);
  const partial = await readFieldRegistry(f.scope, new URLSearchParams({ sourceId: f.source.id }), f.actor);
  assert.ok(partial.rows.some(row => row.persistenceEvidence.some(event => (event.evidence as Record<string, unknown>).status === "FAILED")));
  assert.ok(partial.rows.every(row => !row.structuredPersistenceVerified));
  // A wrong site/source cannot certify these rows.
  await assert.rejects(() => prisma.$transaction(tx => recordSettlementFieldPersistence(tx, { ...f.scope, workspaceId: "wrong" }, f.actor, input)), /范围不一致/);
  assert.deepEqual(comparePersistedField([], [], "currencyCode"), { checkedRows: 0, matchedRows: 0, nullRows: 0, nonNullRows: 0, missingRows: 0, mismatchRows: 0, status: "NO_ROWS" });
});


for (const resource of ["inventory_events", "reimbursements", "inventory_age"] as const) test(`${resource} readback records bounded evidence with explicit site qualification`, async () => {
  const f = await fresh(resource);
  if (resource === "reimbursements") {
    const lines = f.reportRows["fixture-reimbursements"].split("\n");
    f.reportRows["fixture-reimbursements"] = `${lines[0]}\tquantity-reimbursed-cash\tquantity-reimbursed-inventory\toriginal-reimbursement-id\n${lines[1]}\t0\t2\tfixture-original`;
  }
  const run = await f.finish((await f.approvedRun()).id);
  assert.equal(run.status, "SUCCEEDED");
  const events = await prisma.auditLog.findMany({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.fields.persistence-checked" } });
  assert.ok(events.length > 0);
  for (const event of events) {
    const metadata = event.metadata as Record<string, unknown>;
    assert.equal(metadata.status, "PASSED"); assert.equal(metadata.checkedRows, 1);
    assert.equal(metadata.siteQualification, resource === "inventory_age" ? "NOT_VERIFIED" : "VERIFIED_ROW_MARKERS");
    assert.equal(metadata.queryAcceptanceVerified, false); assert.equal(metadata.historicalUniverseComplete, false);
  }
  const columns = events.map(event => (event.metadata as Record<string, unknown>).targetColumn);
  assert.ok(columns.includes("sellerSku")); assert.ok(columns.includes("asin"));
  if (resource === "inventory_events") {
    assert.ok(columns.includes("quantityOriginal"));
    assert.ok(columns.includes("fields.reconciled-quantity"));
    assert.ok(columns.includes("fields.unreconciled-quantity"));
    const before = await prisma.amazonSyncReportRow.findFirstOrThrow({ where: f.scope });
    await prisma.amazonSyncReportRow.update({ where: { id: before.id }, data: { fields: { ...(before.fields as Record<string, string>), "unreconciled-quantity": "tampered" } } });
    const doc = await prisma.amazonSyncReportDocument.findFirstOrThrow({ where: f.scope });
    const raw = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { ...f.scope, taskId: run.id, page: { gt: 0 } } });
    const result = await prisma.$transaction(tx => recordDomainReportFieldPersistence(tx, f.scope, f.actor, { sourceId: f.source.id, resource, reportDocumentId: doc.id, rawTaskId: raw.taskId, rawPage: raw.page, rows: [{ ...before, fields: before.fields as Record<string, string> }] }));
    assert.equal(result.passed, false);
    await prisma.amazonSyncReportRow.update({ where: { id: before.id }, data: { fields: before.fields! } });
    events.push(...await prisma.auditLog.findMany({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.fields.persistence-checked", metadata: { path: ["status"], equals: "FAILED" } } }));
  }
  if (resource === "reimbursements") {
    for (const column of ["amountOriginal", "currencyCode", "quantityOriginal", "fields.quantity-reimbursed-cash", "fields.quantity-reimbursed-inventory", "fields.original-reimbursement-id"]) assert.ok(columns.includes(column));
    const stored = await prisma.amazonSyncReportRow.findFirstOrThrow({ where: f.scope });
    assert.equal((stored.fields as Record<string, string>)["quantity-reimbursed-cash"], "0");
    assert.equal((stored.fields as Record<string, string>)["quantity-reimbursed-inventory"], "2");
  }
  const view = await readFieldRegistry(f.scope, new URLSearchParams({ sourceId: f.source.id }), f.actor);
  assert.ok(view.rows.some(row => row.persistenceEvidence.length > 0));
  assert.ok(view.rows.every(row => !row.structuredPersistenceVerified));
  assert.equal(JSON.stringify(view).includes("12345678901234567890.123400"), false);
  const document = await prisma.amazonSyncReportDocument.findFirstOrThrow({ where: { ...f.scope } });
  const archive = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { ...f.scope, taskId: run.id, page: { gt: 0 } } });
  const stored = await prisma.amazonSyncReportRow.findMany({ where: { ...f.scope, reportDocumentId: document.id } });
  const rows = stored.map(row => ({ ...row, fields: row.fields as Record<string, string> }));
  const input = { sourceId: f.source.id, resource, reportDocumentId: document.id, rawTaskId: archive.taskId, rawPage: archive.page, rows };
  const repeat = await prisma.$transaction(tx => recordDomainReportFieldPersistence(tx, f.scope, f.actor, input));
  assert.ok(repeat.passed);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.fields.persistence-checked" } }), events.length);
  await prisma.amazonSyncReportRow.update({ where: { id: stored[0].id }, data: { sellerSku: "changed-fixture-sku" } });
  const mismatch = await prisma.$transaction(tx => recordDomainReportFieldPersistence(tx, f.scope, f.actor, input));
  assert.equal(mismatch.passed, false);
  await assert.rejects(() => prisma.$transaction(tx => recordDomainReportFieldPersistence(tx, { ...f.scope, workspaceId: "foreign" }, f.actor, input)), /范围不一致/);
});

test("MFN returns complete the isolated Reports archive, parse, publish and ERP query lifecycle", async () => {
  const f = await fresh("mfn_returns");
  const run = await f.finish((await f.approvedRun()).id);
  assert.equal(run.status, "SUCCEEDED");
  assert.ok(f.calls.some(url => url.pathname === "/reports/2021-06-30/reports"));
  const raw = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { ...f.scope, taskId: run.id, resource: "mfn_returns", page: { gt: 0 } } });
  assert.ok(raw.bodySha256);
  const rawPayload = JSON.stringify(unseal(raw.rawCiphertext, f.scope, `${run.id}:${raw.page}`, "amazon-mfn_returns-raw.v1"));
  assert.ok(rawPayload.includes("private-tracking"));
  const document = await prisma.amazonSyncReportDocument.findFirstOrThrow({ where: { ...f.scope, sourceId: f.source.id, resource: "mfn_returns" } });
  assert.equal(document.status, "PUBLISHED");
  const rows = await prisma.amazonSyncReportRow.findMany({ where: { ...f.scope, sourceId: f.source.id, reportDocumentId: document.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountOriginal, "12345678901234567890.123400");
  assert.equal((rows[0].fields as Record<string, unknown>)["return-request-status"], "Approved");
  assert.equal(JSON.stringify(rows).includes("private-tracking"), false);
  const view = await readDomainReports(f.scope, new URLSearchParams({ resource: "mfn_returns", sourceId: f.source.id }), f.actor);
  assert.equal(view.pagination.total, 1);
  assert.equal(view.rows[0].id, rows[0].id);
});

for (const resource of ["inventory_events", "reimbursements"] as const) test(`${resource} unqualified rows do not acquire persistence acceptance`, async () => {
  const f = await fresh(resource, undefined, true);
  const run = await f.finish((await f.approvedRun()).id);
  assert.equal(run.status, "BLOCKED");
  assert.equal(await prisma.auditLog.count({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.fields.persistence-checked" } }), 0);
});


test("a single ledger quantity column receives exact evidence and incomplete scans cannot certify fields", async () => {
  const f = await fresh("inventory_events");
  const lines = f.reportRows["fixture-inventory-ledger"].split("\n").map(line => line.split("\t"));
  const keep = lines[0].map((name, index) => ["Reconciled Quantity", "Unreconciled Quantity"].includes(name) ? -1 : index).filter(index => index >= 0);
  f.reportRows["fixture-inventory-ledger"] = lines.map(cells => keep.map(index => cells[index]).join("\t")).join("\n");
  const run = await f.finish((await f.approvedRun()).id);
  assert.equal(run.status, "SUCCEEDED");
  const events = await prisma.auditLog.findMany({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.fields.persistence-checked" } });
  assert.ok(events.some(event => (event.metadata as Record<string, unknown>).targetColumn === "quantityOriginal"));
  const doc = await prisma.amazonSyncReportDocument.findFirstOrThrow({ where: f.scope });
  const archive = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { ...f.scope, taskId: run.id } });
  const stored = await prisma.amazonSyncReportRow.findMany({ where: { ...f.scope, reportDocumentId: doc.id } });
  await prisma.amazonFieldObservation.updateMany({ where: { ...f.scope, rawTaskId: archive.taskId, rawPage: archive.page }, data: { scanComplete: false } });
  const check = await prisma.$transaction(tx => recordDomainReportFieldPersistence(tx, f.scope, f.actor, { sourceId: f.source.id, resource: "inventory_events", reportDocumentId: doc.id,
    rawTaskId: archive.taskId, rawPage: archive.page, rows: stored.map(row => ({ ...row, fields: row.fields as Record<string, string> })) }));
  assert.equal(check.checkedFields, 0);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.fields.persistence-checked" } }), events.length);
});


test("readback conflict stops report publication and retains the original and failure checkpoint", async () => {
  const f = await fresh("inventory_age");
  const run = await f.approvedRun();
  let document = await prisma.amazonSyncReportDocument.findFirst({ where: f.scope });
  for (let i = 0; i < 12 && !document; i++) {
    await f.slice(run.id);
    document = await prisma.amazonSyncReportDocument.findFirst({ where: f.scope });
  }
  assert.ok(document);
  const parsed = parseDomainReport("inventory_age", f.reportRows["fixture-inventory_age"]);
  const row = parsed.rows[0];
  await prisma.amazonSyncReportRow.create({ data: { ...f.scope, id: digest([document.id, row.rowNumber]), sourceId: f.source.id, reportDocumentId: document.id,
    reportId: document.reportId, ...row, sellerSku: "conflicting-fixture-sku" } });
  const result = await f.finish(run.id);
  assert.equal(result.status, "FAILED");
  assert.match(result.error!, /REPORT_FIELD_PERSISTENCE_MISMATCH/);
  assert.equal((await prisma.amazonSyncReportDocument.findUniqueOrThrow({ where: { id: document.id } })).status, "STAGED");
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { ...f.scope, taskId: run.id } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.fields.persistence-checked" } }), 0);
  assert.ok(await prisma.auditLog.findFirst({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.report.parse-checkpoint", metadata: { path: ["phase"], equals: "ATTEMPT_FAILED" } } }));
});


test("settlement header currency replay closes actual query gaps and independently repairs seller rows", async () => {
  const f = await fresh("settlements", "all");
  for (const id of ["fixture-settlement-1", "fixture-settlement-2"]) {
    const headers = ["settlement-id", "settlement-start-date", "transaction-type", "amount-type", "amount-description", "amount", "total-amount", "currency", "marketplace-name"];
    f.reportRows[id] = [headers.join("\t"), [id, "2026-10-01", "", "", "", "", "10.00", "USD", ""].join("\t"),
      ...["Amazon.com", "Amazon.ca", ""].map(siteName => [id, "2026-10-01", "Order", "ItemPrice", "Principal", "1.00", "", "", siteName].join("\t"))].join("\n");
  }
  const run = await f.finish((await f.approvedRun()).id);
  assert.equal(run.status, "SUCCEEDED");
  const initial = await prisma.amazonSyncReportRow.findMany({ where: { ...f.scope, sourceId: f.source.id }, orderBy: { id: "asc" } });
  assert.equal(initial.length, 2);
  await prisma.amazonSyncReportRow.updateMany({ where: { ...f.scope, sourceId: f.source.id }, data: { currencyCode: null, currencySource: null, currencySourceRowNumber: null } });
  await prisma.amazonSettlementRow.updateMany({ where: { ...f.scope, sourceId: f.source.id }, data: { currencyCode: null, currencySource: null, currencySourceRowNumber: null } });
  const params = new URLSearchParams({ sourceId: f.source.id });
  const before = await readActualFieldCoverage(f.scope, params, f.actor);
  assert.equal(before.business.rowsWithAmountMissingCurrency, 2);
  assert.equal(before.query.visibleRows, 2);
  const docs = await prisma.amazonSyncReportDocument.findMany({ where: { ...f.scope, sourceId: f.source.id } });
  const previewParams = new URLSearchParams({ sourceId: f.source.id, reportDocumentIds: docs.map(doc => doc.id).join(",") });
  const preview = await readSettlementCurrencyRepairPreview(f.scope, f.actor, previewParams);
  assert.equal(preview.started, false); assert.equal(preview.rawValuesIncluded, false);
  const calls = f.calls.length;
  await f.approved(preview.command);
  const after = await readActualFieldCoverage(f.scope, params, f.actor);
  assert.equal(after.business.rowsWithAmountMissingCurrency, 0);
  assert.equal(after.query.visibleRows, before.query.visibleRows);
  const queried = await readDomainReports(f.scope, new URLSearchParams({ sourceId: f.source.id, resource: "settlements" }), f.actor);
  assert.ok(queried.rows.every(row => row.currencyCode === "USD"));
  const stored = await prisma.amazonSyncReportRow.findMany({ where: { ...f.scope, sourceId: f.source.id }, orderBy: { id: "asc" } });
  assert.deepEqual(stored.map(row => [row.id, row.rowNumber, row.rowHash, row.amountOriginal]), initial.map(row => [row.id, row.rowNumber, row.rowHash, row.amountOriginal]));
  assert.ok(stored.every(row => row.currencySource === "SETTLEMENT_HEADER" && row.currencySourceRowNumber === 1));
  assert.ok(after.persistence.fieldsWithPassedBatch > 0);
  assert.equal(after.settlementReplays.recent.length, 1);
  const replay = after.settlementReplays.recent[0].metadata as Record<string, unknown>;
  assert.equal((replay.readback as Array<Record<string, unknown>>).every(item => item.siteReadbackVerified === true), true);
  // Reproduce the previously missed case: site is correct, seller facts blank.
  await prisma.amazonSettlementRow.updateMany({ where: { ...f.scope, sourceId: f.source.id }, data: { currencyCode: null, currencySource: null, currencySourceRowNumber: null } });
  const second = await readSettlementCurrencyRepairPreview(f.scope, f.actor, previewParams);
  assert.ok(second.manifest.documents.every(doc => doc.currencyPatches === 0 && doc.canonicalCurrencyPatches === 1));
  await f.approved(second.command);
  assert.equal(await prisma.amazonSettlementRow.count({ where: { ...f.scope, sourceId: f.source.id, currencyCode: null } }), 0);
  const noChanges = await readSettlementCurrencyRepairPreview(f.scope, f.actor, previewParams);
  await f.approved(noChanges.command);
  assert.equal(f.calls.length, calls);
  assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } })).revision, f.source.revision);
  await assert.rejects(() => readActualFieldCoverage(f.scope, params, f.actor, []), /不可访问/);
  await assert.rejects(() => readActualFieldCoverage(f.scope, new URLSearchParams({ sourceId: f.source.id, from: "bad" }), f.actor), /日期/);
});

for (const resource of ["reimbursements", "inventory_events"] as const) test(`MCP resumes paused ${resource} from archived row 500 without report HTTP`, async () => {
  const f = await fresh(resource);
  const key = resource === "reimbursements" ? "fixture-reimbursements" : "fixture-inventory-ledger";
  const [header, row] = f.reportRows[key].split("\n");
  f.reportRows[key] = [header, ...Array.from({ length: 501 }, (_, i) => row.replace(resource === "reimbursements" ? "fixture-reimbursement" : "fixture-adjustment", `fixture-row-${i}`))].join("\n");
  const pair = { sellerAccountId: f.source.sellerAccountId, marketplaceId: site };
  await prisma.amazonSellerIdentity.create({ data: { ...f.scope, id: randomUUID(), ...pair, authorizationId: f.authorizationId, amazonSellerId: "fixture-domain-seller", region, verifiedAt: new Date() } });
  await prisma.amazonDataAccessGrant.updateMany({ where: { ...f.scope, userId: f.actor, sellerAccountId: pair.sellerAccountId }, data: { marketplaceIds: [site], actions: ["view", "sync"], mcpEnabled: true } });
  const credential = await manageMcpCredential(f.scope, f.actor, { action: "create", name: "offline report resume", scopes: [{ sellerAccountId: pair.sellerAccountId, marketplaceIds: [site] }], tools: ["data_query", "data_sync_start", "workflow_sync_review", "workflow_sync_confirm"], expiresAt: new Date(Date.now() + 120000).toISOString() });
  const identity = await authenticateAmazonMcp(`Bearer ${credential.token!}`);
  const run = await f.approvedRun();
  let current = run;
  for (let i = 0; i < 12 && current.processedCount === 0; i++) current = await f.slice(run.id);
  assert.equal(current.processedCount, 500); assert.equal(current.status, "WAITING");
  await f.approved({ action: "control-task", id: run.id, control: "pause" });
  const stopped = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } });
  const original = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: run.id, resource } });
  const requests = f.calls.length;
  const response = await invokeAmazonMcp(identity, "data_sync_start", { ...pair, resource, taskId: run.id }) as { data: { started: boolean; changeRequest: { id: string } } };
  assert.equal(response.data.started, false);
  const request = new Request("http://localhost/api/lili/mcp", { headers: { authorization: `Bearer ${credential.token!}` } });
  const requestId = response.data.changeRequest.id;
  await callSyncChatTool(request, "workflow_sync_review", { workspaceId: f.scope.workspaceId, requestId });
  const approval = await prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
  const recovery = (approval.beforeSummary as { current: { reportRecovery: { offset: number; archivedDocumentReused: boolean } } }).current.reportRecovery;
  assert.equal(recovery.offset, 500); assert.equal(recovery.archivedDocumentReused, true);
  await callSyncChatTool(request, "workflow_sync_confirm", { workspaceId: f.scope.workspaceId, requestId, expectedDigest: approval.changeDigest, expectedRevision: approval.baseRevision, userConfirmation: "批准本次离线夹具任务从已归档第500行继续" });
  const resumed = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(resumed.checkpointCiphertext, stopped.checkpointCiphertext);
  assert.equal(resumed.processedCount, 500); assert.equal(resumed.apiRequests, stopped.apiRequests);
  const done = await f.finish(run.id);
  assert.equal(done.status, "SUCCEEDED", done.error ?? ""); assert.equal(done.insertedCount, 501);
  assert.equal(f.calls.length, requests); // Archived documents may now be expired: never fetch them again.
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id, resource } }), 1);
  assert.equal((await prisma.amazonSyncRawPage.findUniqueOrThrow({ where: { taskId_page: { taskId: run.id, page: original.page } } })).rawCiphertext, original.rawCiphertext);
  const erp = await readDomainReports(f.scope, new URLSearchParams({ resource, sourceId: f.source.id, page: "11", pageSize: "50" }), f.actor);
  assert.equal(erp.pagination.total, 501); assert.equal(erp.rows.length, 1);
  const last = await invokeAmazonMcp(identity, "data_query", { ...pair, table: resource, pageSize: 50, page: 11 }) as { total: number; records: unknown[]; hasMore: boolean };
  assert.equal(last.total, 501); assert.equal(last.records.length, 1); assert.equal(last.hasMore, false);
});

test("report recovery approval rejects checkpoint drift and mismatched archive identity", async () => {
  const f = await fresh("reimbursements"), run = await f.approvedRun();
  let current = run;
  for (let i = 0; i < 8 && current.stage !== "REPORT_PARSING"; i++) current = await f.slice(run.id);
  await f.approved({ action: "control-task", id: run.id, control: "pause" });
  const command = { action: "control-task", id: run.id, control: "resume" };
  const preview = await requestChange(f.scope, f.actor, command);
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const state = JSON.parse(decryptCheckpoint(cursor.reportStateCiphertext, f.scope, cursor.id)!);
  state.polls = (state.polls ?? 0) + 1;
  const changed = encryptCheckpoint(JSON.stringify(state), f.scope, cursor.id);
  await prisma.amazonSyncResourceCursor.update({ where: { id: cursor.id }, data: { reportStateCiphertext: changed } });
  await prisma.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: changed } });
  // Existing approval service must refuse the old digest instead of dispatching.
  assert.equal((await decideChange(f.scope, f.actor, String(preview.id), "APPROVED", "offline fixture")).status, "STALE");
  const raw = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: run.id, resource: "reimbursements" } });
  await prisma.amazonSyncRawPage.update({ where: { taskId_page: { taskId: raw.taskId, page: raw.page } }, data: { requestMetadata: { reportId: "different-report" } } });
  await assert.rejects(() => requestChange(f.scope, f.actor, command), /原件身份/);
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } })).status, "PAUSED");
});

test("reimbursement history replay resumes from its task checkpoint without moving the forward cursor or publication head", async () => {
  const f = await fresh("reimbursements");
  const forward = await f.finish((await f.approvedRun()).id);
  assert.equal(forward.status, "SUCCEEDED");
  const cursorBefore = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const headBefore = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } });
  const scheduleId = randomUUID();
  const schedule = await prisma.amazonSyncSchedule.create({ data: { ...f.scope, id: scheduleId, resource: "reimbursements", executionVersion: 2, planKey: automaticPlanKey(f.source.id), name: "fixture auto plan", mode: "incremental", intervalMinutes: 1440, enabled: true, nextRunAt: new Date(0), updatedByUserId: f.actor } });
  await prisma.amazonSyncPlanTarget.create({ data: { ...f.scope, scheduleId, sourceId: f.source.id } });
  const window = { from: f.from, to: f.to, dataStartTime: `${f.from}T00:00:00Z`, dataEndTime: `${f.to}T23:59:59Z` };
  const replay = await prisma.$transaction(tx => createTask(tx, f.scope, f.actor, f.source.id, { key: `fixture-history-${randomUUID()}`, trigger: "schedule", scheduleId, scheduleRevision: schedule.revision, reportWindow: window, reimbursementHistoryReplay: true }));
  const frozen = replay.frozenScope as { reimbursementHistoryReplay?: boolean; reimbursementHistoryCursorDigest?: string };
  assert.equal(frozen.reimbursementHistoryReplay, true);
  assert.equal(frozen.reimbursementHistoryCursorDigest, domainReportHistoryCursorDigest(cursorBefore));
  const waiting = await f.slice(replay.id);
  assert.equal(waiting.status, "WAITING");
  await f.approved({ action: "control-task", id: replay.id, control: "pause" });
  await f.approved({ action: "control-task", id: replay.id, control: "resume" });
  const completed = await f.finish(replay.id);
  assert.equal(completed.status, "SUCCEEDED", completed.error ?? "");
  const cursorAfter = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const headAfter = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } });
  assert.equal(domainReportHistoryCursorDigest(cursorAfter), domainReportHistoryCursorDigest(cursorBefore));
  assert.equal(headAfter.activeRunId, headBefore.activeRunId);
  assert.equal(headAfter.lastSuccessAt?.toISOString(), headBefore.lastSuccessAt?.toISOString());
  const oldCoverage = Object.fromEntries(Object.entries(headBefore.coverage as Record<string, unknown>).filter(([key]) => key !== "windowCheckpoints"));
  const afterCoverage = headAfter.coverage as Record<string, unknown>;
  const replayCoverage = Object.fromEntries(Object.entries(afterCoverage).filter(([key]) => key !== "windowCheckpoints"));
  assert.deepEqual(replayCoverage, oldCoverage);
  assert.equal(((afterCoverage.windowCheckpoints as { triggerTaskId?: string }).triggerTaskId), replay.id);
  assert.ok(completed.summary && typeof completed.summary === "object" && (completed.summary as Record<string, unknown>).windowCheckpoint);
});

test("inventory event history replay resumes independently and preserves its forward cursor", async () => {
  const f = await fresh("inventory_events");
  const forward = await f.finish((await f.approvedRun()).id);
  assert.equal(forward.status, "SUCCEEDED");
  const cursorBefore = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const headBefore = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } });
  const scheduleId = randomUUID();
  const schedule = await prisma.amazonSyncSchedule.create({ data: { ...f.scope, id: scheduleId, resource: "inventory_events", executionVersion: 2, planKey: automaticPlanKey(f.source.id), name: "fixture auto plan", mode: "incremental", intervalMinutes: 1440, enabled: true, nextRunAt: new Date(0), updatedByUserId: f.actor } });
  await prisma.amazonSyncPlanTarget.create({ data: { ...f.scope, scheduleId, sourceId: f.source.id } });
  const window = { from: f.from, to: f.to, dataStartTime: `${f.from}T00:00:00Z`, dataEndTime: `${f.to}T23:59:59Z`, eventType: "Adjustments" };
  const replay = await prisma.$transaction(tx => createTask(tx, f.scope, f.actor, f.source.id, { key: `fixture-event-history-${randomUUID()}`, trigger: "schedule", scheduleId, scheduleRevision: schedule.revision, reportWindow: window, inventoryEventHistoryReplay: true }));
  const frozen = replay.frozenScope as { inventoryEventHistoryReplay?: boolean; inventoryEventHistoryCursorDigest?: string };
  assert.equal(frozen.inventoryEventHistoryReplay, true);
  assert.equal(frozen.inventoryEventHistoryCursorDigest, domainReportHistoryCursorDigest(cursorBefore));
  assert.equal((await f.slice(replay.id)).status, "WAITING");
  await f.approved({ action: "control-task", id: replay.id, control: "pause" });
  await f.approved({ action: "control-task", id: replay.id, control: "resume" });
  const completed = await f.finish(replay.id);
  assert.equal(completed.status, "SUCCEEDED", completed.error ?? "");
  const cursorAfter = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const headAfter = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } });
  assert.equal(domainReportHistoryCursorDigest(cursorAfter), domainReportHistoryCursorDigest(cursorBefore));
  assert.equal(headAfter.activeRunId, headBefore.activeRunId);
  assert.equal(headAfter.lastSuccessAt?.toISOString(), headBefore.lastSuccessAt?.toISOString());
  const staleReplay = await prisma.$transaction(tx => createTask(tx, f.scope, f.actor, f.source.id, { key: `fixture-event-stale-history-${randomUUID()}`, trigger: "schedule", scheduleId, scheduleRevision: schedule.revision, reportWindow: window, inventoryEventHistoryReplay: true }));
  const callsBeforeStaleRun = f.calls.length;
  await prisma.amazonSyncResourceCursor.update({ where: { id: cursorAfter.id }, data: { watermarkTo: new Date(cursorAfter.watermarkTo.getTime() + 1000) } });
  const rejected = await f.slice(staleReplay.id);
  assert.equal(rejected.status, "FAILED");
  assert.match(rejected.error ?? "", /前向游标或窗口/);
  assert.equal(f.calls.length, callsBeforeStaleRun);

  await prisma.amazonSyncResourceCursor.update({ where: { id: cursorAfter.id }, data: { watermarkTo: cursorBefore.watermarkTo } });
  const failureTime = new Date(Date.now() - 60 * 60_000);
  await prisma.amazonSyncRun.update({ where: { id: completed.id }, data: { status: "FAILED", finishedAt: failureTime, nextAttemptAt: failureTime, summary: { quality: { code: "WORKER_INTERRUPTED", status: "FAILED", retryScheduled: false, published: false } } } });
  const recovery = await recoverAutomaticFailures([f.scope], new Date());
  assert.equal(recovery.recovered, 1);
  const resumed = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: completed.id } });
  assert.equal(resumed.status, "RETRY_WAIT");
  assert.equal((resumed.summary as { automaticRecovery?: { count?: number } }).automaticRecovery?.count, 1);
  assert.equal(domainReportHistoryCursorDigest(await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } })), domainReportHistoryCursorDigest(cursorBefore));
});
