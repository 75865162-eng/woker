import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { readBrandAnalytics, readBrandAsins, readBrandAsinAnalysis } from "@/lib/amazon-sync/brand-analytics-query";
import { readBrandCollection } from "@/lib/amazon-sync/brand-collection-query";
import { enqueueDueAutomaticPlans } from "@/lib/amazon-sync/scheduler";
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
after(async () => { delete endpoints[region]; await getAmazonSyncQueue().close(); await prisma.$disconnect(); });
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
    const names: Record<string, string> = { search_terms: "sellingPartnerSearchTermsReport", search_query: "sellingPartnerSearchQueryPerformanceReport", search_catalog: "sellingPartnerSearchCatalogPerformanceReport", market_basket: "sellingPartnerMarketBasketAnalysisReport", repeat_purchase: "sellingPartnerRepeatPurchaseReport" };
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
    if (url.pathname === "/reports/2021-06-30/reports") {
      if (resource === "brand_analytics" && (domainPolicy.collection || domainPolicy.reportKind === "repeat_purchase")) {
        const spec = JSON.parse(String(init?.body));
        const names: Record<string, string> = { GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT: "sellingPartnerSearchTermsReport", GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT: "sellingPartnerSearchQueryPerformanceReport", GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT: "sellingPartnerSearchCatalogPerformanceReport", GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT: "sellingPartnerMarketBasketAnalysisReport", GET_BRAND_ANALYTICS_REPEAT_PURCHASE_REPORT: "sellingPartnerRepeatPurchaseReport" };
        const example = JSON.parse(readFileSync(`src/data/amazon-contracts/${names[spec.reportType]}.json`, "utf8")).examples[0];
        report = { ...example, reportSpecification: spec };
        if (spec.reportType === "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT") report.dataByDepartmentAndSearchTerm = example.dataByDepartmentAndSearchTerm.filter((r: { clickedAsin: string }) => r.clickedAsin.length === 10).slice(0, 1);
        else {
          const template = example.dataByAsin[0];
          const ids = String(spec.reportOptions.asin ?? spec.reportOptions.asins ?? template.asin).split(" ");
          report.dataByAsin = mode === "empty" ? [] : ids.map(asin => ({ ...template, asin, startDate: spec.dataStartTime, endDate: spec.dataEndTime }));
        }
      }
      createCalls++; assert.equal(init?.method, "POST"); if (mode === "uncertain") throw new Error("fixture transport failed"); return Response.json({ reportId: "report-fixture" }); }
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
  if (resource === "listing_details") {
    const published = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId } });
    const pendingId = "00000000-pending-" + randomUUID();
    await prisma.amazonSyncDataSource.create({ data: { ...f.scope, id: pendingId, authorizationId: f.authorizationId, sellerAccountId: f.sellerAccountId, marketplaceId: "fixture-pending-site", resource, enabled: true, freshnessMinutes: 1440, domainPolicy: published.domainPolicy! } });
    const defaultRead = await readObservations(f.scope, new URLSearchParams({ resource }), f.actor);
    assert.equal(defaultRead.source?.id, f.sourceId);
    assert.equal(defaultRead.rows.length, 1);
    assert.equal((await readObservations(f.scope, new URLSearchParams({ resource, sourceId: pendingId }), f.actor)).rows.length, 0);
    assert.equal((await readObservations(f.scope, new URLSearchParams({ resource, marketplaceId: "fixture-pending-site" }), f.actor)).rows.length, 0);
  }
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
test("brand finite collection survives independent publications, merges ASIN batches and scopes all five kinds", async () => {
  const asins = Array.from({ length: 19 }, (_, i) => `B${String(i).padStart(9, "0")}`);
  const collection = { from: "2025-01-05", to: "2025-01-18", asins, maxTasks: 100, selections: ["search_terms", "search_query", "search_catalog", "market_basket", "repeat_purchase"].map(reportKind => ({ reportKind, reportPeriod: "WEEK" })) };
  const f = await fresh("brand_analytics", { collection });
  const source = () => prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId }, include: { authorization: true } });
  assert.equal((await readBrandCollection(prisma, f.scope, await source()))!.total, 14);
  for (let i = 0; i < 14; i++) {
    const run = await f.start();
    const frozen = run.frozenScope as { domainPolicy: { collection?: unknown; from: string; to: string } };
    assert.equal(frozen.domainPolicy.collection, undefined);
    const done = await f.finish(run.id); assert.equal(done.status, "SUCCEEDED", done.error ?? "");
  }
  const result = await readBrandCollection(prisma, f.scope, await source()); assert.equal(result!.complete, true); assert.equal(result!.completed, 14);
  await assert.rejects(f.start, /全部完成/);
  const sqp = await readBrandAnalytics(f.scope, new URLSearchParams({ sourceId: f.sourceId, reportKind: "search_query", from: "2025-01-12", to: "2025-01-18" }), f.actor);
  assert.equal(sqp.pagination.total, 19); assert.equal(sqp.batchCount, 2);
  const repeat = await readBrandAnalytics(f.scope, new URLSearchParams({ sourceId: f.sourceId, reportKind: "repeat_purchase" }), f.actor);
  assert.equal(repeat.rows.length, 1); assert.equal((repeat.rows[0].facts as { orders: string }).orders, "1256");
  await assert.rejects(() => readBrandAnalytics(f.scope, new URLSearchParams({ sourceId: f.sourceId, reportKind: "repeat_purchase", runId: sqp.run!.id }), f.actor), /不可访问/);
  const foreign = await fresh("brand_analytics");
  await assert.rejects(() => readBrandAnalytics(foreign.scope, new URLSearchParams({ sourceId: f.sourceId }), foreign.actor), /不可访问/);
  await assert.rejects(() => readBrandAsins(foreign.scope, f.sourceId, foreign.actor), /不可访问/);
});
test("brand ASIN association preserves metrics across multiple SKUs and isolates metadata versions, sites and tenants", async () => {
  const f = await fresh("brand_analytics", { reportKind: "repeat_purchase" });
  const run = await f.start(); assert.equal((await f.finish(run.id)).status, "SUCCEEDED");
  const initial = await readBrandAnalytics(f.scope, new URLSearchParams({ sourceId: f.sourceId, reportKind: "repeat_purchase" }), f.actor);
  const id = initial.rows[0].asin!;
  const catalogId = randomUUID(), catalogRunId = randomUUID(), detailId = randomUUID(), detailRunId = randomUUID();
  for (const [sourceId, resource, taskId] of [[catalogId, "catalog", catalogRunId], [detailId, "catalog_items", detailRunId]]) {
    await prisma.amazonSyncDataSource.create({ data: { ...f.scope, id: sourceId, authorizationId: f.authorizationId, sellerAccountId: f.sellerAccountId, marketplaceId: site, resource, enabled: true, freshnessMinutes: 1440 } });
    await prisma.amazonSyncRun.create({ data: { ...f.scope, id: taskId, sourceId, requestedByUserId: f.actor, resource, executionVersion: 2, status: "SUCCEEDED", stage: "COMPLETED", finishedAt: new Date(), frozenScope: { authorizationId: f.authorizationId, authorizationRevision: 1, sourceRevision: 1 } } });
    await prisma.amazonSyncDataSource.update({ where: { id: sourceId }, data: { activeRunId: taskId, coverage: { type: "complete_snapshot", paginationComplete: true } } });
  }
  await prisma.amazonCatalogSnapshot.createMany({ data: ["sku-a", "sku-b"].map(sellerSku => ({ ...f.scope, id: randomUUID(), sellerAccountId: f.sellerAccountId, marketplaceId: site, sellerSku, asin: id, sourceRunId: catalogRunId, fieldSources: {}, capturedAt: new Date() })) });
  await prisma.amazonDomainObservation.create({ data: { ...f.scope, id: randomUUID(), sourceId: detailId, sourceRunId: detailRunId, kind: "CATALOG_DETAIL", businessKey: "fixture-product", asin: id, facts: { summaries: [{ marketplaceId: "other-site", itemName: "PRIVATE_OTHER_SITE", brandName: "OTHER" }, { marketplaceId: site, itemName: "Scoped product", brandName: "Scoped Brand" }] }, capturedAt: new Date() } });
  const p = new URLSearchParams({ sourceId: f.sourceId, reportKind: "repeat_purchase", asin: id });
  const linked = await readBrandAnalytics(f.scope, p, f.actor);
  assert.equal(linked.pagination.total, 1); assert.equal((linked.rows[0].facts as { orders: string }).orders, "1256");
  assert.deepEqual(linked.products[id].skus, ["sku-a", "sku-b"]); assert.equal(linked.products[id].brand, "Scoped Brand");
  assert.equal(linked.products[id].title, "Scoped product"); assert.ok(!JSON.stringify(linked).includes("PRIVATE_OTHER_SITE"));
  const analysis = await readBrandAsinAnalysis(f.scope, p, f.actor);
  assert.equal(analysis.reports.length, 5); assert.equal(analysis.reports.find(r => r.reportKind === "repeat_purchase")!.result!.pagination.total, 1);
  assert.deepEqual(analysis.products[id].skus, ["sku-a", "sku-b"]);
  assert.equal(analysis.products[id].thumbnailUrl, null);
  assert.ok(!analysis.productWarnings.some(w => w.includes("主图存储尚未就绪")));
  const reader = randomUUID(), role = "viewer";
  await prisma.organizationRosterRole.upsert({ where: { organizationId_id: { organizationId: f.scope.organizationId, id: role } }, create: { organizationId: f.scope.organizationId, id: role, name: "Fixture reader", description: "Fixture", permissions: { operations: ["view"] } }, update: { permissions: { operations: ["view"] } } });
  await prisma.user.create({ data: { id: reader, email: `${reader}@fixture.invalid`, name: "Fixture reader", passwordHash: "not-login", memberships: { create: { organizationId: f.scope.organizationId, role } } } });
  const grant = await prisma.amazonDataAccessGrant.create({ data: { ...f.scope, id: randomUUID(), userId: reader, sellerAccountId: f.sellerAccountId, marketplaceIds: [site], actions: ["view"] } });
  assert.equal((await readBrandAsinAnalysis(f.scope, p, reader)).products[id].brand, "Scoped Brand");
  await prisma.amazonDataAccessGrant.update({ where: { id: grant.id }, data: { marketplaceIds: ["other-site"] } });
  await assert.rejects(() => readBrandAsinAnalysis(f.scope, p, reader), /不可访问/);
  const daily = await readBrandAsinAnalysis(f.scope, new URLSearchParams({ ...Object.fromEntries(p), reportPeriod: "DAY" }), f.actor);
  assert.equal(daily.reports.filter(r => r.unavailable).length, 3);
  await prisma.amazonSyncDataSource.update({ where: { id: detailId }, data: { revision: { increment: 1 } } });
  assert.equal((await readBrandAnalytics(f.scope, p, f.actor)).products[id].brand, null);
  const foreign = await fresh("brand_analytics");
  await assert.rejects(() => readBrandAsinAnalysis(foreign.scope, p, foreign.actor), /不可访问/);
  await assert.rejects(() => readBrandAsinAnalysis(f.scope, new URLSearchParams({ sourceId: f.sourceId, asin: "invalid" }), f.actor), /有效 ASIN/);
});
test("brand scheduled backfill is explicit, resumes from DB and does not replay uncertain creates", async () => {
  const collection = { from: "2025-01-05", to: "2025-01-11", asins: [], maxTasks: 10, selections: [{ reportKind: "repeat_purchase", reportPeriod: "WEEK" }, { reportKind: "market_basket", reportPeriod: "WEEK" }] };
  const f = await fresh("brand_analytics", { collection });
  assert.equal(await prisma.amazonSyncSchedule.count({ where: f.scope }), 0);
  const approved = await f.approved({ action: "save-plan", name: "Fixture finite brand backfill", resource: "brand_analytics", enabled: true, mode: "snapshot", intervalMinutes: 1440, sourceIds: [f.sourceId], retentionDays: 3650 });
  const plan = await prisma.amazonSyncSchedule.findUniqueOrThrow({ where: { id: approved.targetId } });
  await enqueueDueAutomaticPlans([f.scope], new Date());
  const first = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...f.scope, scheduleId: plan.id } });
  f.setMode("empty"); assert.equal((await f.finish(first.id)).status, "SUCCEEDED");
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId }, include: { authorization: true } });
  const coverage = await readBrandCollection(prisma, f.scope, source); assert.equal(coverage!.items[0].status, "EMPTY"); assert.equal(coverage!.completed, 1);
  await prisma.amazonSyncSchedule.update({ where: { id: plan.id }, data: { nextRunAt: new Date(0) } });
  await enqueueDueAutomaticPlans([f.scope], new Date());
  const second = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...f.scope, scheduleId: plan.id, id: { not: first.id } } });
  f.setMode("uncertain"); assert.equal((await f.finish(second.id)).status, "FAILED");
  const creates = f.getCreateCalls(); assert.equal(creates, 2);
  await prisma.amazonSyncSchedule.update({ where: { id: plan.id }, data: { nextRunAt: new Date(0) } });
  await enqueueDueAutomaticPlans([f.scope], new Date());
  assert.equal(await prisma.amazonSyncRun.count({ where: f.scope }), 2); assert.equal(f.getCreateCalls(), creates);
  assert.equal((await readBrandCollection(prisma, f.scope, source))!.complete, false);
});
test("uncertain report create is never replayed across retries", async () => {
  const f = await fresh("brand_analytics"); f.setMode("uncertain"); const run = await f.start(); const done = await f.finish(run.id); assert.equal(done.status, "FAILED"); assert.equal(f.getCreateCalls(), 1);
  await f.approved({ action: "control-task", id: run.id, control: "retry" }); assert.equal((await f.finish(run.id)).status, "FAILED"); assert.equal(f.getCreateCalls(), 1);
});
test("revoked account permissions prevent resumed requests and preserve staged invisibility", async () => {
  const f = await fresh("fulfillment"), run = await f.start(); await f.slice(run.id); const before = f.calls.length;
  await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: f.scope.organizationId, userId: f.actor } }, data: { role: "viewer" } });
  assert.equal((await f.finish(run.id)).status, "BLOCKED"); assert.equal(f.calls.length, before);
  assert.equal((await readObservations(f.scope, new URLSearchParams({ resource: "fulfillment", sourceId: f.sourceId }), f.approver)).rows.length, 0);
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
