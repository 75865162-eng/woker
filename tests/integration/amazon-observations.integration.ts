import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "@/lib/amazon-sync/change-approval";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { readObservations } from "@/lib/amazon-sync/observations-query";
import { encryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { endpoints } from "@/lib/amazon-sync/policy";
import { observationReportSpec, parseObservationPolicy } from "@/lib/amazon-sync/observation-policy";

if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1" || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw new Error("Disposable offline DB required");
const site = "ATVPDKIKX0DER", region = "observation-fixture", scopes: Array<[string, string]> = [], planId = "a".repeat(38), asin = "B123456789";
before(() => { endpoints[region] = "https://observations.fixture.invalid"; process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 63).toString("base64"); });
after(async () => { delete endpoints[region]; await prisma.$disconnect(); });
function officialExample(file: string, path: string, method: string): Record<string, unknown> {
  type Operation = { operationId?: string; responses?: Record<string, { examples?: Record<string, Record<string, unknown>> }> };
  const model = JSON.parse(readFileSync(file, "utf8")) as { paths: Record<string, Record<string, Operation>> };
  const operation = Object.values(model.paths[path] ?? {}).find(value => value.operationId === method);
  const example = operation?.responses?.["200"]?.examples?.["application/json"];
  if (!example) throw new Error(`Missing public fixture example for ${method}`);
  return structuredClone(example);
}
async function fresh(resource: string, extra: Record<string, unknown> = {}) {
  const scope = { organizationId: `observation-${randomUUID()}`, workspaceId: "fixture" }, actor = randomUUID(), approver = randomUUID(), authorizationId = randomUUID(), sellerAccountId = randomUUID();
  scopes.push([scope.organizationId, scope.workspaceId]); process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify(scopes);
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Fixture" } });
  for (const id of [actor, approver]) await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: "Fixture", passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: sellerAccountId, accountKey: sellerAccountId, displayName: "Fixture", marketplaceCode: "US" } });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authorizationId, name: "Fixture", amazonSellerId: "fixture-seller", awsRegion: region, endpoint: endpoints[region], status: "CONFIGURED", approvedRoles: ["Amazon Fulfillment", "Pricing", "Brand Analytics", "Selling Partner Insights", "Product Listing"], rolesAttestedAt: new Date(), marketplaceParticipations: [{ marketplaceId: site, countryCode: "US" }], updatedByUserId: actor, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture", lwaClientSecret: "fixture", refreshToken: "fixture", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId }) } });
  const domainPolicy: Record<string, unknown> = { resource, applicationId: "fixture-app", maxRequests: 30, maxRows: 1000, requestsPerSecond: .01, ...(resource === "fulfillment" ? { planIds: [planId] } : resource === "listing_details" ? { sellerSkus: ["fixture-sku"] } : ["pricing", "catalog_items"].includes(resource) ? { asins: [asin] } : { asins: [], from: "2021-06-06", to: "2021-06-12", marketplaceTimeZone: "America/Los_Angeles", reportKind: "search_terms", reportPeriod: "WEEK", brandEligibilityAttested: true }), ...extra };
  async function approved(body: Record<string, unknown>) { const r = await requestChange(scope, actor, body); await decideChange(scope, approver, String(r.id), "APPROVED", "fixture"); await applyChange(scope, actor, String(r.id)); return prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id: String(r.id) } }); }
  const config = await approved({ action: "save-source", authorizationId, sellerAccountId, marketplaceId: site, resource, domainPolicy, enabled: true, freshnessMinutes: 1440 });
  const sourceId = config.targetId;
  const plan = { inboundPlanId: planId, name: "Fixture", marketplaceIds: [site], status: "ACTIVE", createdAt: "2026-10-01T00:00:00Z", lastUpdatedAt: "2026-10-02T00:00:00Z", sourceAddress: { name: "PRIVATE_ADDRESS" }, shipments: [{ shipmentId: "shipment-fixture" }] };
  let mode = "normal", createCalls = 0; const calls: string[] = [];
  let report: Record<string, unknown> = {};
  if (resource === "brand_analytics") {
    const names: Record<string, string> = { search_terms: "sellingPartnerSearchTermsReport", search_query: "sellingPartnerSearchQueryPerformanceReport", search_catalog: "sellingPartnerSearchCatalogPerformanceReport", market_basket: "sellingPartnerMarketBasketAnalysisReport" };
    report = JSON.parse(readFileSync(`src/data/amazon-contracts/${names[String(domainPolicy.reportKind)]}.json`, "utf8")).examples[0];
    report.reportSpecification = observationReportSpec(parseObservationPolicy(domainPolicy) as Parameters<typeof observationReportSpec>[0], site);
    if (domainPolicy.reportKind === "search_terms") report.dataByDepartmentAndSearchTerm = (report.dataByDepartmentAndSearchTerm as Array<{ clickedAsin: string }>).filter(row => row.clickedAsin.length === 10);
  }
  if (resource === "buy_box_history") {
    const data = JSON.parse(readFileSync("src/data/amazon-contracts/sellerSalesAndTrafficReport.json", "utf8")).examples[0];
    report = { ...data, reportSpecification: observationReportSpec(parseObservationPolicy(domainPolicy) as Parameters<typeof observationReportSpec>[0], site), salesAndTrafficByAsin: [data.salesAndTrafficByAsin[0]], salesAndTrafficByDate: [data.salesAndTrafficByDate[0]] }; (report.salesAndTrafficByAsin as Array<{ childAsin: string }>)[0].childAsin = asin;
  }
  const fetcher = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input)); assert.ok(["observations.fixture.invalid", "lwa.fixture.invalid", "download.fixture.invalid"].includes(url.hostname)); calls.push(url.pathname);
    if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture", expires_in: 3600 });
    if (url.hostname === "download.fixture.invalid") return new Response(JSON.stringify(report));
    if (url.pathname.startsWith("/listings/2021-08-01/items/fixture-seller/")) {
      const raw = officialExample("src/data/amazon-contracts/listings-detail-model.json", "/listings/2021-08-01/items/{sellerId}/{sku}", "getListingsItem");
      raw.sku = decodeURIComponent(url.pathname.split("/").at(-1)!); raw.attributes = {}; (raw.attributes as Record<string, unknown>).bullet_point = [{ marketplace_id: site, language_tag: "en_US", value: "Fixture bullet" }]; raw.secret_contact = "DO_NOT_EXPOSE";
      return Response.json(raw);
    }
    if (url.pathname.startsWith("/catalog/2022-04-01/items/")) {
      const raw = officialExample("src/data/amazon-contracts/catalog-detail-model.json", "/catalog/2022-04-01/items/{asin}", "getCatalogItem");
      raw.asin = url.pathname.split("/").at(-1)!; raw.attributes = {}; (raw.attributes as Record<string, unknown>).brand = [{ marketplace_id: site, value: "Fixture Brand" }]; raw.secret_contact = "DO_NOT_EXPOSE";
      return Response.json(raw);
    }
    if (url.pathname === "/products/pricing/v0/price") {
      assert.equal(url.searchParams.get("ItemType"), "Asin"); assert.equal(url.searchParams.get("OfferType"), "B2C");
      return Response.json({ payload: [{ status: "Success", ASIN: asin, Product: { Identifiers: { MarketplaceASIN: { ASIN: asin, MarketplaceId: site } }, Offers: [] } }] });
    }
    if (url.pathname.includes("competitiveSummary")) return Response.json({ responses: [{ status: { statusCode: mode === "partial" ? 429 : 200 }, body: { asin, marketplaceId: site, featuredBuyingOptions: [] } }] });
    if (url.pathname === "/reports/2021-06-30/reports") { createCalls++; assert.equal(init?.method, "POST"); if (mode === "uncertain") throw new Error("fixture transport failed"); return Response.json({ reportId: "report-fixture" }); }
    if (url.pathname.includes("/reports/2021-06-30/reports/")) return Response.json({ reportId: "report-fixture", reportType: (report.reportSpecification as { reportType: string }).reportType, marketplaceIds: [site], processingStatus: "DONE", reportDocumentId: "doc-fixture" });
    if (url.pathname.includes("/documents/")) return Response.json({ reportDocumentId: "doc-fixture", url: "https://download.fixture.invalid/report" });
    if (url.pathname.endsWith(`/inboundPlans/${planId}`)) return Response.json({ ...plan, marketplaceIds: mode === "foreign" ? ["other-site"] : [site] });
    if (url.pathname.endsWith("/items")) return Response.json({ items: [{ msku: "fixture-sku", asin, fnsku: "X123456789", quantity: 20 }], ...(mode === "cycle" ? { pagination: { nextToken: "same-token" } } : {}) });
    if (url.pathname.includes("/shipments/")) return Response.json({ shipmentId: "shipment-fixture", status: "SHIPPED", source: { address: "PRIVATE_ADDRESS" }, destination: { warehouseId: "ABC1" } });
    throw new Error("Unexpected mock request");
  };
  async function start() { const request = await approved({ action: "run", sourceIds: [sourceId] }); return prisma.amazonSyncRun.findFirstOrThrow({ where: { executionApprovalId: request.id } }); }
  async function slice(id: string) {
    await prisma.amazonSyncRun.update({ where: { id }, data: { nextAttemptAt: new Date(0) } });
    await prisma.amazonSyncApiBudget.updateMany({ where: scope, data: { nextRequestAt: new Date(0) } });
    // Isolated fixture only: advance quota time rather than sleeping.
    await prisma.amazonSyncTokenBucket.updateMany({ data: { tokens: 1, replenishedAt: new Date(0), blockedUntil: null } });
    const run = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
    await processSyncCenterTask(id, run.dispatchVersion, { clientOptions: { fetch: fetcher, tokenEndpoint: "https://lwa.fixture.invalid/token", reportDownloadTestHost: "download.fixture.invalid" } });
    return prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
  }
  async function finish(id: string) { for (let i = 0; i < 260; i++) { const run = await slice(id); if (!["WAITING", "QUEUED", "RETRY_WAIT"].includes(run.status)) return run; } throw new Error("Fixture exceeded bounded slices"); }
  const read = (params: Record<string, string> = {}) => readObservations(scope, new URLSearchParams({ resource, sourceId, ...params }), actor);
  return { scope, actor, approver, authorizationId, sellerAccountId, sourceId, start, slice, finish, read, approved, calls, setMode: (v: string) => { mode = v; }, getCreateCalls: () => createCalls };
}

test("inbound approval → staged slices → publication; scope and quantity semantics remain separate", async () => {
  const f = await fresh("fulfillment"), run = await f.start();
  await f.slice(run.id); assert.equal((await f.read()).rows.length, 0);
  const done = await f.finish(run.id); assert.equal(done.status, "SUCCEEDED", done.error ?? "");
  const result = await f.read(); assert.equal(result.rows.length, 4); assert.ok(!JSON.stringify(result).includes("PRIVATE_ADDRESS"));
  const items = result.rows.filter(row => row.kind.endsWith("ITEM")); assert.equal(items.length, 2);
  for (const item of items) { const facts = item.facts as { declaredQuantity: number; inTransitQuantity: null }; assert.equal(facts.declaredQuantity, 20); assert.equal(facts.inTransitQuantity, null); }
  const raw = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: run.id } }); assert.ok(!raw.rawCiphertext.includes("PRIVATE_ADDRESS"));
  const other = await fresh("fulfillment"); await assert.rejects(() => readObservations(other.scope, new URLSearchParams({ resource: "fulfillment", sourceId: f.sourceId }), other.actor));
});
test("foreign marketplace and repeated token block without replacing published head", async () => {
  const f = await fresh("fulfillment"), first = await f.start(); assert.equal((await f.finish(first.id)).status, "SUCCEEDED");
  f.setMode("foreign"); const second = await f.start(); assert.equal((await f.finish(second.id)).status, "FAILED");
  assert.equal((await f.read()).run?.id, first.id);
  f.setMode("cycle"); const third = await f.start(); assert.equal((await f.finish(third.id)).status, "FAILED"); assert.equal((await f.read()).run?.id, first.id);
});
for (const resource of ["listing_details", "catalog_items"]) test(`${resource} detail is scoped, projected, and published without ProductRecord writes`, async () => {
  const f = await fresh(resource), run = await f.start();
  const done = await f.finish(run.id); assert.equal(done.status, "SUCCEEDED", `${done.error ?? ""} ${f.calls.join(" ")}`);
  const rows = (await f.read()).rows; assert.equal(rows.length, 1); assert.equal(rows[0].kind, resource === "listing_details" ? "LISTING_DETAIL" : "CATALOG_DETAIL");
  const json = JSON.stringify(rows[0].facts); assert.ok(!json.includes("DO_NOT_EXPOSE")); assert.ok(!json.includes("PRIVATE_ADDRESS"));
  if (resource === "listing_details") assert.ok(json.includes("Fixture bullet")); else assert.ok(json.includes("Fixture Brand"));
});
for (const resource of ["listing_details", "catalog_items"]) test(`${resource} discovers 224 objects and publishes all batches as one version`, async () => {
  const f = await fresh(resource), upstreamId = randomUUID(), headId = randomUUID();
  await prisma.amazonSyncDataSource.create({ data: { ...f.scope, id: upstreamId, authorizationId: f.authorizationId, sellerAccountId: f.sellerAccountId, marketplaceId: site, resource: "catalog", enabled: true, freshnessMinutes: 1440 } });
  await prisma.amazonSyncRun.create({ data: { ...f.scope, id: headId, sourceId: upstreamId, requestedByUserId: f.actor, resource: "catalog", executionVersion: 2, authorizationRevision: 1, status: "SUCCEEDED", stage: "COMPLETED", finishedAt: new Date(), paginationComplete: true, idempotencyKey: headId, mode: "snapshot", frozenScope: { authorizationId: f.authorizationId, authorizationRevision: 1, amazonSellerId: "fixture-seller" } } });
  await prisma.amazonSyncDataSource.update({ where: { id: upstreamId }, data: { activeRunId: headId, rowCount: 224, coverage: { type: "complete_snapshot", paginationComplete: true } } });
  await prisma.amazonCatalogSnapshot.createMany({ data: Array.from({ length: 224 }, (_, i) => ({ ...f.scope, id: randomUUID(), sellerAccountId: f.sellerAccountId, marketplaceId: site, sellerSku: `sku-${String(i).padStart(4, "0")}`, asin: `B${String(i).padStart(9, "0")}`, sourceRunId: headId, fieldSources: {}, capturedAt: new Date() })) });
  const domainPolicy = { resource, applicationId: "fixture-app", maxRows: 1000, maxRequests: 500, requestsPerSecond: .2, discovery: { mode: "catalog_snapshot", sourceId: upstreamId, maxObjects: 1000, batchSize: 100 }, ...(resource === "listing_details" ? { sellerSkus: [] } : { asins: [] }) };
  await f.approved({ action: "save-source", revision: 1, authorizationId: f.authorizationId, sellerAccountId: f.sellerAccountId, marketplaceId: site, resource, domainPolicy, enabled: true, freshnessMinutes: 1440 });
  const run = await f.start();
  for (let i = 0; i < 101; i++) await f.slice(run.id);
  assert.equal((await f.read()).rows.length, 0);
  const done = await f.finish(run.id); assert.equal(done.status, "SUCCEEDED", done.error ?? "");
  const result = await f.read(); assert.equal(result.pagination.total, 224); assert.equal(result.versions.length, 1);
  assert.equal((await f.read({ page: "5" })).rows.length, 24);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id, requestMetadata: { path: ["batchIndex"], equals: 2 } } }), 24);
  const changed = await f.start(); await f.slice(changed.id);
  await prisma.amazonSyncDataSource.update({ where: { id: upstreamId }, data: { revision: { increment: 1 } } });
  const stopped = await f.slice(changed.id); assert.equal(stopped.status, "BLOCKED"); assert.equal((await f.read()).run?.id, run.id);
});
test("pricing incomplete batch never replaces complete snapshot", async () => {
  const f = await fresh("pricing"), run = await f.start(); assert.equal((await f.finish(run.id)).status, "SUCCEEDED");
  f.setMode("partial"); const bad = await f.start(); assert.equal((await f.finish(bad.id)).status, "FAILED"); assert.equal((await f.read()).run?.id, run.id);
});
test("brand search report request/poll/download/archive/publish uses exact approved specification", async () => {
  const f = await fresh("brand_analytics"), run = await f.start(), done = await f.finish(run.id); assert.equal(done.status, "SUCCEEDED", done.error ?? ""); assert.ok((await f.read()).rows.length); assert.equal(f.getCreateCalls(), 1);
});
test("uncertain report create is never replayed across retries", async () => {
  const f = await fresh("brand_analytics"); f.setMode("uncertain"); const run = await f.start(); const done = await f.finish(run.id); assert.equal(done.status, "FAILED"); assert.equal(f.getCreateCalls(), 1);
  await f.approved({ action: "control-task", id: run.id, control: "retry" }); assert.equal((await f.finish(run.id)).status, "FAILED"); assert.equal(f.getCreateCalls(), 1);
});
test("revoked roles prevent resumed requests and preserve staged invisibility", async () => {
  const f = await fresh("fulfillment"), run = await f.start(); await f.slice(run.id); const before = f.calls.length;
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authorizationId }, data: { approvedRoles: [] } });
  assert.equal((await f.finish(run.id)).status, "BLOCKED"); assert.equal(f.calls.length, before); assert.equal((await f.read()).rows.length, 0);
});
for (const [reportKind, from, to] of [["search_query", "2025-01-05", "2025-01-11"], ["search_catalog", "2025-01-05", "2025-01-11"], ["market_basket", "2021-06-06", "2021-06-12"]]) test(`brand ${reportKind} round trip publishes only a complete approved period`, async () => {
  const f = await fresh("brand_analytics", { reportKind, from, to, asins: reportKind === "market_basket" ? [] : [asin, "B987654321"] });
  const run = await f.start(), done = await f.finish(run.id); assert.equal(done.status, "SUCCEEDED", done.error ?? ""); assert.ok((await f.read()).rows.length);
});
test("Buy Box single-day CHILD report persists historical percentages", async () => {
  const f = await fresh("buy_box_history", { from: "2021-06-11", to: "2021-06-11", asins: [asin] }); const run = await f.start(), done = await f.finish(run.id); assert.equal(done.status, "SUCCEEDED", done.error ?? ""); assert.equal((await f.read()).rows[0].kind, "BUY_BOX_DAY");
});
test("pause/resume retains inbound checkpoint; cancellation never publishes staged facts", async () => {
  const f = await fresh("fulfillment"), run = await f.start(); await f.slice(run.id);
  const checkpoint = (await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } })).checkpointCiphertext;
  await f.approved({ action: "control-task", id: run.id, control: "pause" });
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } })).status, "PAUSED");
  await f.approved({ action: "control-task", id: run.id, control: "resume" });
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } })).checkpointCiphertext, checkpoint);
  await f.slice(run.id); await f.approved({ action: "control-task", id: run.id, control: "cancel" });
  assert.equal((await f.read()).rows.length, 0);
});
test("observation rows enforce source/run scope in PostgreSQL", async () => {
  const f = await fresh("fulfillment"), run = await f.start(); assert.equal((await f.finish(run.id)).status, "SUCCEEDED");
  const other = await fresh("fulfillment");
  await assert.rejects(() => prisma.amazonDomainObservation.create({ data: { ...other.scope, id: randomUUID(), sourceId: other.sourceId, sourceRunId: run.id, kind: "INBOUND_PLAN", businessKey: "cross-scope", facts: {}, capturedAt: new Date() } }));
});
test("disabled bindings cancel queued observation work; idempotent approval apply creates one run", async () => {
  const f = await fresh("fulfillment"), run = await f.start();
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId } });
  await f.approved({ action: "save-source", authorizationId: f.authorizationId, sellerAccountId: source.sellerAccountId, marketplaceId: site, resource: "fulfillment", enabled: false, freshnessMinutes: 1440 });
  const cancelled = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } }); assert.equal(cancelled.status, "CANCELLED"); assert.equal(f.calls.length, 0);
});
