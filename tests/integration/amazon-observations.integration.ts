// Cloud role for injected offline task fixtures; no real Amazon calls.
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
import { readDataset } from "@/lib/amazon-sync/dataset-query";
import { brandFairTurn } from "@/lib/amazon-sync/brand-fairness";
import { seal, unseal, digest } from "@/lib/amazon-sync/approval-policy";
import { initialObservationState } from "@/lib/amazon-sync/observation-machine";
import type { Prisma } from "@prisma/client";
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
import { withApprovedChange } from "@/lib/amazon-sync/approved-context";
import { controlTask } from "@/lib/amazon-sync/service";
import { automaticBrandCandidates, latestClosedBrandWindow } from "@/lib/amazon-sync/automatic-brand";
import { localDate, shiftDate } from "@/lib/amazon-sync/date-range";
import { manageMcpCredential, authenticateAmazonMcp, invokeAmazonMcp } from "@/lib/amazon-sync/mcp";
import { callSyncChatTool } from "@/lib/lili/sync-chat-server";

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
  await prisma.amazonDataAccessGrant.createMany({ data: [actor, approver].map(userId => ({ ...scope, id: randomUUID(), userId, sellerAccountId, marketplaceIds: [site], actions: ["view", "sync"] })) });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authorizationId, name: "Fixture", amazonSellerId: "fixture-seller", awsRegion: region, endpoint: endpoints[region], status: "CONFIGURED", identityVerifiedAt: new Date(), approvedRoles: ["Amazon Fulfillment", "Pricing", "Brand Analytics", "Selling Partner Insights", "Product Listing"], rolesAttestedAt: new Date(), marketplaceParticipations: [{ marketplaceId: site, countryCode: "US" }], updatedByUserId: actor, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture", lwaClientSecret: "fixture", refreshToken: "fixture", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId }) } });
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
    if (url.hostname === "download.fixture.invalid") {
      const body = structuredClone(report);
      if (mode === "catalog-null") {
        for (const row of body.dataByAsin as Array<{ impressionData: { impressionMedianPrice: unknown } }>) row.impressionData.impressionMedianPrice = null;
      }
      if (mode === "sqp-null" || mode === "sqp-invalid") {
        for (const row of body.dataByAsin as Array<Record<string, Record<string, unknown>>>) {
          for (const [group, names] of Object.entries({ cartAddData: ["asinCartAddShare", "totalMedianCartAddPrice", "asinMedianCartAddPrice"], purchaseData: ["asinPurchaseShare", "totalMedianPurchasePrice", "asinMedianPurchasePrice"] })) for (const name of names) row[group][name] = null;
          row.impressionData.asinImpressionShare = 5.26;
          row.clickData.totalClickRate = 100;
          if (mode === "sqp-invalid") row.purchaseData.asinPurchaseCount = null;
        }
      }
      return new Response(JSON.stringify(body));
    }
    if (url.pathname.startsWith("/listings/2021-08-01/items/fixture-seller/")) {
      const raw = officialExample("src/data/amazon-contracts/listings-detail-model.json", "/listings/2021-08-01/items/{sellerId}/{sku}", "getListingsItem");
      raw.sku = decodeURIComponent(url.pathname.split("/").at(-1)!); raw.attributes = {}; (raw.attributes as Record<string, unknown>).bullet_point = [{ marketplace_id: site, language_tag: "en_US", value: "Fixture bullet" }]; raw.secret_contact = "DO_NOT_EXPOSE";
      return Response.json(raw);
    }
    if (url.pathname.startsWith("/catalog/2022-04-01/items/")) {
      if (mode === "catalog-missing" && url.pathname.endsWith("/B987654321")) return Response.json({ errors: [{ code: "NotFound", message: "fixture missing object" }] }, { status: 404 });
      const raw = officialExample("src/data/amazon-contracts/catalog-detail-model.json", "/catalog/2022-04-01/items/{asin}", "getCatalogItem");
      raw.asin = url.pathname.split("/").at(-1)!; raw.attributes = {}; (raw.attributes as Record<string, unknown>).brand = [{ marketplace_id: site, value: "Fixture Brand" }]; raw.secret_contact = "DO_NOT_EXPOSE";
      return Response.json(raw);
    }
    if (url.pathname === "/notifications/v1/subscriptions") {
      assert.equal(init?.method, "GET");
      if ((mode === "notification-forbidden" || mode === "notification-last-page-forbidden" && url.searchParams.has("nextToken")) && url.searchParams.get("notificationTypes") === "ORDER_CHANGE") return Response.json({ errors: [{ code: "Unauthorized", message: "fixture type denied" }] }, { status: 403 });
      const next = url.searchParams.get("nextToken");
      return Response.json({ payload: { subscriptions: next ? [] : [{ subscriptionId: `sub-${url.searchParams.get("notificationTypes")}`, payloadVersion: "1.0", destinationId: "PRIVATE_DESTINATION", processingDirective: { filterExpression: "PRIVATE_FILTER" } }], ...(next ? {} : { nextToken: "fixture-second-page" }) } });
    }
    if (url.pathname === "/products/pricing/v0/price") {
      assert.equal(url.searchParams.get("ItemType"), "Asin"); assert.equal(url.searchParams.get("OfferType"), "B2C");
      return Response.json({ payload: [{ status: "Success", ASIN: asin, Product: { Identifiers: { MarketplaceASIN: { ASIN: asin, MarketplaceId: site } }, Offers: [] } }] });
    }
    if (url.pathname.includes("competitiveSummary")) return Response.json({ responses: [{ status: { statusCode: mode === "partial" ? 429 : 200 }, body: { asin, marketplaceId: site, featuredBuyingOptions: [] } }] });
    if (url.pathname === "/reports/2021-06-30/reports") {
      if (resource === "brand_analytics" && (domainPolicy.collection || domainPolicy.automaticDiscovery || domainPolicy.reportKind === "repeat_purchase")) {
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
  for (const item of items) { const facts = item.facts as { declaredQuantity: string; inTransitQuantity: null }; assert.equal(facts.declaredQuantity, "20"); assert.equal(facts.inTransitQuantity, null); }
  const filtered = { inboundPlanId: planId, shipmentId: "shipment-fixture", pageSize: "1" };
  const first = await f.read(filtered); assert.equal(first.pagination.total, 2); assert.equal(first.rows.length, 1);
  const second = await f.read({ ...filtered, page: "2" }); assert.equal(second.rows.length, 1); assert.notEqual(first.rows[0].id, second.rows[0].id);
  assert.equal((await f.read({ ...filtered, page: "3" })).rows.length, 0);
  assert.equal((await f.read({ inboundPlanId: planId })).pagination.total, 4);
  assert.equal((await f.read({ ...filtered, inboundPlanId: "another-plan" })).pagination.total, 0, "plan and shipment filters intersect before counting");
  assert.equal((await f.read({ shipmentId: "missing-shipment" })).rows.length, 0);
  await assert.rejects(f.read({ shipmentId: "bad/identifier" }), /标识无效/);
  const raw = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: run.id } }); assert.ok(!raw.rawCiphertext.includes("PRIVATE_ADDRESS"));
  const other = await fresh("fulfillment"); await assert.rejects(() => readObservations(other.scope, new URLSearchParams({ resource: "fulfillment", sourceId: f.sourceId }), other.actor));
});
test("inbound resumes the archived discovery page crossing 100 plans without another HTTP call", async () => {
  const f = await fresh("fulfillment", { planIds: [], discoverPlans: true, maxRequests: 1000 });
  const run = await f.start();
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId } });
  const policy = parseObservationPolicy(source.domainPolicy, "fulfillment");
  const id = (index: number) => String(index).padStart(38, "0");
  const state = { ...initialObservationState(policy), requests: 16, discoveredPlanIds: Array.from({ length: 95 }, (_, i) => id(i)), token: "page-16", priorTokens: ["page-15"] };
  const rawBody = JSON.stringify({ inboundPlans: Array.from({ length: 6 }, (_, i) => ({ inboundPlanId: id(i + 95), marketplaceIds: [site], name: "", status: "ACTIVE", createdAt: "2025-01-01T00:00:00Z", lastUpdatedAt: "2025-01-01T00:00:00Z" })), pagination: { nextToken: "page-17" } });
  await prisma.amazonSyncRun.update({ where: { id: run.id }, data: { stage: "FETCHING", pagesCompleted: 15, checkpointCiphertext: seal({ state }, f.scope, run.id, "amazon-observation-state.v1") } });
  await prisma.amazonSyncRawPage.create({ data: { ...f.scope, taskId: run.id, resource: "fulfillment", page: 16, requestMetadata: { operation: "listInboundPlans" }, bodySha256: digest(rawBody), rawCiphertext: seal({ rawBody }, f.scope, `${run.id}:16`, "amazon-observation-raw.v1"), capturedAt: new Date() } });
  const result = await f.slice(run.id);
  assert.equal(result.status, "WAITING", result.error ?? "");
  assert.equal(result.pagesCompleted, 16);
  assert.equal(result.apiRequests, 0); assert.equal(f.calls.length, 0);
  const next = unseal(result.checkpointCiphertext!, f.scope, run.id, "amazon-observation-state.v1").state as typeof state;
  assert.equal(next.discoveredPlanIds.length, 101); assert.equal(next.token, "page-17");
  assert.equal(next.requests, 16); assert.equal(next.planIndex, 0);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id } }), 1);
  await processSyncCenterTask(run.id, run.dispatchVersion, { clientOptions: { fetch: async () => { throw new Error("duplicate dispatch must not call HTTP"); } } });
  const duplicate = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(duplicate.checkpointCiphertext, result.checkpointCiphertext);
  assert.equal(duplicate.pagesCompleted, 16);
  assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId } })).activeRunId, null);
});
test("inbound item occurrences preserve different quantities from the archived response without another HTTP call", async () => {
  const f = await fresh("fulfillment"), run = await f.start();
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId } });
  const policy = parseObservationPolicy(source.domainPolicy, "fulfillment");
  const state = { ...initialObservationState(policy), stage: "PLAN_ITEMS", requests: 2 };
  const rawBody = JSON.stringify({ items: [{ msku: "same-sku", quantity: 60 }, { msku: "same-sku", quantity: 30 }] });
  await prisma.amazonSyncRun.update({ where: { id: run.id }, data: { stage: "FETCHING", pagesCompleted: 1, checkpointCiphertext: seal({ state }, f.scope, run.id, "amazon-observation-state.v1") } });
  await prisma.amazonSyncRawPage.create({ data: { ...f.scope, taskId: run.id, resource: "fulfillment", page: 2, requestMetadata: { operation: "listInboundPlanItems" }, bodySha256: digest(rawBody), rawCiphertext: seal({ rawBody }, f.scope, `${run.id}:2`, "amazon-observation-raw.v1"), capturedAt: new Date() } });
  const result = await f.slice(run.id);
  assert.equal(result.status, "WAITING");
  assert.equal(result.pagesCompleted, 2);
  const rows = await prisma.amazonDomainObservation.findMany({ where: { sourceRunId: run.id }, orderBy: { businessKey: "asc" } });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => (row.facts as Prisma.JsonObject).declaredQuantity).sort(), [30, 60]);
  assert.ok(rows.every(row => (row.facts as Prisma.JsonObject).sourceRawPage === 2));
  assert.equal(result.apiRequests, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id } }), 1);
  assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId } })).activeRunId, null);
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
  await prisma.amazonSyncRun.create({ data: { ...f.scope, id: headId, sourceId: upstreamId, requestedByUserId: f.actor, resource: "catalog", executionVersion: 2, authorizationRevision: 1, status: "SUCCEEDED", stage: "COMPLETED", finishedAt: new Date(), paginationComplete: true, idempotencyKey: headId, mode: "snapshot", frozenScope: { authorizationId: f.authorizationId, authorizationRevision: 1, amazonSellerId: "fixture-seller" }, summary: { coverage: { type: "complete_snapshot", paginationComplete: true } } } });
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
test("automatic brand approval resumes older complete periods without recreating failed recent tasks", async () => {
  const now = new Date(), today = localDate(now, "America/Los_Angeles"), from = shiftDate(today, -10);
  const f = await fresh("brand_analytics", { automaticDiscovery: true, reportKind: "search_terms", reportPeriod: "DAY", from, to: from, brandEligibilityAttested: false });
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId }, include: { authorization: true } });
  const policy = parseObservationPolicy(source.domainPolicy, "brand_analytics"); assert.equal(policy.resource, "brand_analytics");
  if (policy.resource !== "brand_analytics") throw new Error("Fixture policy mismatch");
  const priorIds: string[] = [];
  for (const domainPolicy of automaticBrandCandidates(policy, [], now).filter(candidate => candidate.from >= from)) {
    const id = randomUUID(); priorIds.push(id);
    await prisma.amazonSyncRun.create({ data: { ...f.scope, id, sourceId: f.sourceId, requestedByUserId: f.actor, resource: "brand_analytics", mode: "report", executionVersion: 2, status: "FAILED", stage: "REPORT_CREATING", finishedAt: now, idempotencyKey: id, error: "fixture previous attempt retained", frozenScope: { sourceRevision: source.revision, authorizationId: source.authorizationId, authorizationRevision: source.authorization.revision, domainPolicy } } });
  }
  const run = await f.start();
  const selected = (run.frozenScope as { domainPolicy: { from: string; to: string; automaticDiscovery?: boolean; brandEligibilityAttested: boolean } }).domainPolicy;
  const yesterday = latestClosedBrandWindow(today, "DAY").from;
  assert.equal(selected.from, shiftDate(yesterday, -1)); assert.equal(selected.to, selected.from);
  assert.equal(selected.automaticDiscovery, undefined); assert.equal(selected.brandEligibilityAttested, false);
  assert.equal((await f.finish(run.id)).status, "SUCCEEDED");
  assert.equal(await prisma.amazonSyncRun.count({ where: { id: { in: priorIds }, status: "FAILED", error: "fixture previous attempt retained" } }), priorIds.length);
  assert.equal(f.getCreateCalls(), 1);
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
  await assert.rejects(() => readBrandAnalytics(f.scope, new URLSearchParams({ sourceId: f.sourceId, reportKind: "repeat_purchase", runId: sqp.run!.id }), f.actor), /不可访问|不属于当前账号/);
  const foreign = await fresh("brand_analytics");
  await assert.rejects(() => readBrandAnalytics(foreign.scope, new URLSearchParams({ sourceId: f.sourceId }), foreign.actor), /不可访问|不属于当前账号/);
  await assert.rejects(() => readBrandAsins(foreign.scope, f.sourceId, foreign.actor), /不可访问|不属于当前账号/);
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
  assert.equal((await readBrandAsinAnalysis(f.scope, p, reader)).products[id].brand, "Scoped Brand");
  await prisma.amazonDataAccessGrant.update({ where: { id: grant.id }, data: { enabled: false } });
  await assert.rejects(() => readBrandAsinAnalysis(f.scope, p, reader), /没有已分配/);
  const daily = await readBrandAsinAnalysis(f.scope, new URLSearchParams({ ...Object.fromEntries(p), reportPeriod: "DAY" }), f.actor);
  assert.equal(daily.reports.filter(r => r.unavailable).length, 3);
  await prisma.amazonSyncDataSource.update({ where: { id: detailId }, data: { revision: { increment: 1 } } });
  assert.equal((await readBrandAnalytics(f.scope, p, f.actor)).products[id].brand, null);
  const foreign = await fresh("brand_analytics");
  await assert.rejects(() => readBrandAsinAnalysis(foreign.scope, p, foreign.actor), /不可访问|不属于当前账号/);
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
  // Simulate the plan backoff left behind by a failed report before its retry.
  await prisma.amazonSyncSchedule.update({ where: { id: plan.id }, data: { nextRunAt: new Date(Date.now() + 86_400_000) } });
  f.setMode("empty"); assert.equal((await f.finish(first.id)).status, "SUCCEEDED");
  assert.ok((await prisma.amazonSyncSchedule.findUniqueOrThrow({ where: { id: plan.id } })).nextRunAt! <= new Date());
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId }, include: { authorization: true } });
  const coverage = await readBrandCollection(prisma, f.scope, source); assert.equal(coverage!.items[0].status, "EMPTY"); assert.equal(coverage!.completed, 1);
  await enqueueDueAutomaticPlans([f.scope], new Date());
  const second = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...f.scope, scheduleId: plan.id, id: { not: first.id } } });
  f.setMode("uncertain"); assert.equal((await f.finish(second.id)).status, "FAILED");
  const creates = f.getCreateCalls(); assert.equal(creates, 2);
  await prisma.amazonSyncSchedule.update({ where: { id: plan.id }, data: { nextRunAt: new Date(0) } });
  await enqueueDueAutomaticPlans([f.scope], new Date());
  assert.equal(await prisma.amazonSyncRun.count({ where: f.scope }), 2); assert.equal(f.getCreateCalls(), creates);
  assert.equal((await readBrandCollection(prisma, f.scope, source))!.complete, false);
});
test("brand publication never resumes an explicitly disabled collection plan", async () => {
  const collection = { from: "2025-01-05", to: "2025-01-11", asins: [], maxTasks: 10, selections: [{ reportKind: "repeat_purchase", reportPeriod: "WEEK" }] };
  const f = await fresh("brand_analytics", { collection });
  const saved = await f.approved({ action: "save-plan", name: "Fixture paused brand backfill", resource: "brand_analytics", enabled: true, mode: "snapshot", intervalMinutes: 1440, sourceIds: [f.sourceId], retentionDays: 3650 });
  const plan = await prisma.amazonSyncSchedule.findUniqueOrThrow({ where: { id: saved.targetId } });
  await f.approved({ action: "save-plan", id: plan.id, revision: plan.revision, name: plan.name, resource: "brand_analytics", enabled: false, mode: "snapshot", intervalMinutes: 1440, sourceIds: [f.sourceId], retentionDays: 3650 });
  const run = await f.start(); f.setMode("empty");
  assert.equal((await f.finish(run.id)).status, "SUCCEEDED");
  const after = await prisma.amazonSyncSchedule.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(after.enabled, false); assert.equal(after.nextRunAt, null);
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

// Cloned contenders exist only in this disposable fixture and are never executed.
test("brand fairness filters persisted contenders and skips invalid frozen grants", async () => {
  const f = await fresh("brand_analytics"), run = await f.start();
  const policy = parseObservationPolicy((run.frozenScope as { domainPolicy: unknown }).domainPolicy, "brand_analytics") as Parameters<typeof brandFairTurn>[2];
  const now = new Date(), older = new Date(run.startedAt.getTime() - 1000);
  const originalSource = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId } });
  const peerSource = await prisma.amazonSyncDataSource.create({ data: { ...originalSource, id: randomUUID(), marketplaceId: "fixture-second-site", orderPolicy: undefined, financePolicy: undefined, returnsPolicy: undefined, domainPolicy: originalSource.domainPolicy as Prisma.InputJsonValue, settlementPolicy: undefined, coverage: undefined } });
  const peer = await prisma.amazonSyncRun.create({ data: { ...run, sourceId: peerSource.id, id: randomUUID(), idempotencyKey: null, startedAt: older, frozenScope: run.frozenScope as Prisma.InputJsonValue, summary: undefined } });
  const turn = (validate: Parameters<typeof brandFairTurn>[4] = async () => {}) => prisma.$transaction(tx => brandFairTurn(tx, run, policy, "createReport", validate, now));
  assert.equal((await turn()).allowed, false);
  await prisma.amazonSyncDataSource.update({ where: { id: peerSource.id }, data: { enabled: false } });
  assert.equal((await turn()).allowed, true, "disabled source");
  await prisma.amazonSyncDataSource.update({ where: { id: peerSource.id }, data: { enabled: true } });
  await prisma.amazonSyncRun.update({ where: { id: peer.id }, data: { nextAttemptAt: new Date(now.getTime() + 120_001) } });
  assert.equal((await turn()).allowed, true, "future retry outside lookahead");
  await prisma.amazonSyncRun.update({ where: { id: peer.id }, data: { nextAttemptAt: now } });
  assert.equal((await turn(async () => { throw new Error("revoked approval"); })).allowed, true);
  for (const status of ["SUCCEEDED", "FAILED", "CANCELLED", "PAUSED"]) {
    await prisma.amazonSyncRun.update({ where: { id: peer.id }, data: { status } });
    assert.equal((await turn()).allowed, true, status);
  }
  await prisma.amazonSyncRun.update({ where: { id: peer.id }, data: { status: "WAITING", control: "pause" } });
  assert.equal((await turn()).allowed, true);
  await prisma.amazonSyncRun.update({ where: { id: peer.id }, data: { control: null, frozenScope: { ...(run.frozenScope as Prisma.JsonObject), domainPolicy: { ...policy, applicationId: "other-app" } } as Prisma.InputJsonValue } });
  assert.equal((await turn()).allowed, true);
  const state = { ...initialObservationState(policy), stage: "POLL", reportId: "fixture" };
  await prisma.amazonSyncRun.update({ where: { id: peer.id }, data: { frozenScope: run.frozenScope as Prisma.InputJsonValue, checkpointCiphertext: seal({ state }, f.scope, peer.id, "amazon-observation-state.v1") } });
  assert.equal((await turn()).allowed, true, "different operation");
  await prisma.amazonSyncRun.update({ where: { id: peer.id }, data: { checkpointCiphertext: seal({ state: { ...initialObservationState(policy), requests: policy.maxRequests } }, f.scope, peer.id, "amazon-observation-state.v1") } });
  assert.equal((await turn()).allowed, true, "exhausted budget");
  await prisma.amazonSyncRun.update({ where: { id: peer.id }, data: { checkpointCiphertext: null } });
  await prisma.amazonSyncTaskLog.create({ data: { ...f.scope, id: randomUUID(), attempt: 1, taskId: peer.id, stage: "REQUEST", event: "createReport", createdAt: now } });
  assert.equal((await turn()).allowed, true, "actual request rotates turn");
});

test("brand processor yields a newer site to an approved older site under the same quota", async () => {
  const f = await fresh("brand_analytics"), first = await f.start();
  const ca = "A2EUQ1WTGCTBG2";
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authorizationId }, data: { marketplaceParticipations: [{ marketplaceId: site, countryCode: "US" }, { marketplaceId: ca, countryCode: "CA" }] } });
  const policy = (first.frozenScope as { domainPolicy: Prisma.InputJsonValue }).domainPolicy;
  const source = await f.approved({ action: "save-source", authorizationId: f.authorizationId, sellerAccountId: f.sellerAccountId, marketplaceId: ca, resource: "brand_analytics", domainPolicy: policy, enabled: true, freshnessMinutes: 1440 });
  const approval = await f.approved({ action: "run", sourceIds: [source.targetId] });
  const second = await prisma.amazonSyncRun.findFirstOrThrow({ where: { executionApprovalId: approval.id } });
  assert.equal((await f.slice(second.id)).status, "WAITING");
  assert.equal(f.getCreateCalls(), 0);
  await f.slice(first.id);
  assert.equal(f.getCreateCalls(), 1);
  await f.slice(second.id);
  assert.equal(f.getCreateCalls(), 2, "other operation cannot hold the create turn");
});


test("brand SQP download retry preserves original report and budget while publishing nullable metrics", async () => {
  const f = await fresh("brand_analytics", { reportKind: "search_query", from: "2025-01-05", to: "2025-01-11", asins: [asin, "B987654321"] });
  f.setMode("sqp-invalid");
  const run = await f.start(), failed = await f.finish(run.id);
  assert.equal(failed.status, "FAILED"); assert.ok(failed.checkpointCiphertext);
  assert.equal((await f.read()).rows.length, 0);
  f.setMode("sqp-null");
  await f.approved({ action: "control-task", id: run.id, control: "retry" });
  const retry = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(retry.checkpointCiphertext, failed.checkpointCiphertext);
  assert.equal(retry.apiRequests, failed.apiRequests);
  const done = await f.finish(run.id);
  assert.equal(done.status, "SUCCEEDED", done.error ?? ""); assert.ok(done.apiRequests > failed.apiRequests);
  assert.equal(f.getCreateCalls(), 1);
  const result = await f.read(); assert.equal(result.rows.length, 2);
  for (const row of result.rows) {
    assert.equal((row.facts as Record<string, unknown>).shareUnit, "AMAZON_NATIVE_SQP");
    const facts = row.facts as Record<string, Record<string, unknown>>;
    assert.equal(facts.impressionData.asinImpressionShare, "5.26");
    assert.equal(facts.clickData.totalClickRate, "100");
    for (const key of ["asinPurchaseShare", "totalMedianPurchasePrice", "asinMedianPurchasePrice"]) assert.equal(facts.purchaseData[key], null);
    for (const key of ["asinCartAddShare", "totalMedianCartAddPrice", "asinMedianCartAddPrice"]) assert.equal(facts.cartAddData[key], null);
  }
});


test("brand parser recovery reuses the original verified archive without network or budget changes", async () => {
  const f = await fresh("brand_analytics", { reportKind: "search_query", from: "2025-01-05", to: "2025-01-11", asins: [asin, "B987654321"] });
  f.setMode("sqp-invalid");
  const run = await f.start(), failed = await f.finish(run.id);
  assert.equal(failed.status, "FAILED");
  const page = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { ...f.scope, taskId: run.id, requestMetadata: { path: ["operation"], equals: "downloadReportDocument" } } });
  const archiveKey = run.id + ":" + page.page;
  const report = JSON.parse(unseal(page.rawCiphertext, f.scope, archiveKey, "amazon-observation-raw.v1").rawBody as string);
  for (const row of report.dataByAsin) row.purchaseData.asinPurchaseCount = 0;
  // Simulate an original archive accepted by a repaired parser in this fixture.
  const rawBody = JSON.stringify(report);
  await prisma.amazonSyncRawPage.update({ where: { taskId_page: { taskId: run.id, page: page.page } }, data: { bodySha256: digest(rawBody), rawCiphertext: seal({ rawBody }, f.scope, archiveKey, "amazon-observation-raw.v1") } });
  await f.approved({ action: "control-task", id: run.id, control: "retry" });
  const calls = f.calls.length;
  const done = await f.finish(run.id);
  assert.equal(done.status, "SUCCEEDED", done.error ?? "");
  assert.equal(done.apiRequests, failed.apiRequests);
  assert.equal(f.calls.length, calls);
  assert.equal(f.getCreateCalls(), 1);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { ...f.scope, taskId: run.id } }), await prisma.amazonSyncRawPage.count({ where: { ...f.scope, taskId: run.id, page: { lte: page.page } } }));
});

test("brand catalog publishes unavailable impression median price as unknown", async () => {
  const f = await fresh("brand_analytics", { reportKind: "search_catalog", from: "2025-01-05", to: "2025-01-11", asins: [asin, "B987654321"] });
  f.setMode("catalog-null"); const run = await f.start(), done = await f.finish(run.id);
  assert.equal(done.status, "SUCCEEDED", done.error ?? "");
  const result = await f.read(); assert.equal(result.rows.length, 2);
  for (const row of result.rows) assert.equal((row.facts as { impressionData: { impressionMedianPrice: unknown } }).impressionData.impressionMedianPrice, null);
});


test("notifications read-only discovery persists pages and protects seller-wide publication", async () => {
  const f = await fresh("notifications", { notificationTypes: ["ORDER_CHANGE", "ANY_OFFER_CHANGED"] });
  const run = await f.start(); await f.slice(run.id);
  assert.equal((await f.read()).rows.length, 0);
  const checkpoint = (await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } })).checkpointCiphertext;
  assert.ok(checkpoint);
  await f.approved({ action: "control-task", id: run.id, control: "pause" });
  await f.approved({ action: "control-task", id: run.id, control: "resume" });
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } })).checkpointCiphertext, checkpoint);
  assert.equal((await f.finish(run.id)).status, "SUCCEEDED");
  const result = await f.read(); assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every(row => (row.facts as { scope: string }).scope === "SELLER_SUBSCRIPTION"));
  assert.ok(!JSON.stringify(result).includes("PRIVATE_DESTINATION")); assert.ok(!JSON.stringify(result).includes("PRIVATE_FILTER"));
  assert.equal(f.getCreateCalls(), 0);
  const head = result.run!.id;
  f.setMode("notification-last-page-forbidden"); const next = await f.start();
  const partial = await f.finish(next.id); assert.equal(partial.status, "PARTIAL_SUCCESS"); assert.equal(partial.failedCount, 1);
  assert.equal((await f.read()).run!.id, head);
  assert.ok(await prisma.amazonSyncRawPage.count({ where: { taskId: next.id, page: { lt: 0 } } }));
  const failedState = unseal(partial.checkpointCiphertext!, f.scope, next.id, "amazon-observation-state.v1").state as { notificationFailures: Array<{ token?: string }> };
  assert.equal(failedState.notificationFailures[0].token, "fixture-second-page");
  const beforeRetry = f.calls.filter(path => path === "/notifications/v1/subscriptions").length;
  f.setMode("normal"); await f.approved({ action: "control-task", id: next.id, control: "retry" });
  assert.equal((await f.finish(next.id)).status, "SUCCEEDED");
  assert.equal(f.calls.filter(path => path === "/notifications/v1/subscriptions").length - beforeRetry, 1, "only the failed continuation is requested");
  assert.equal((await f.read()).run!.id, next.id); assert.equal((await f.read()).rows.length, 2);
  const reader = randomUUID();
  await prisma.user.create({ data: { id: reader, email: `${reader}@fixture.invalid`, name: "Fixture", passwordHash: "none", memberships: { create: { organizationId: f.scope.organizationId, role: "viewer" } } } });
  await prisma.amazonDataAccessGrant.create({ data: { ...f.scope, id: randomUUID(), userId: reader, sellerAccountId: f.sellerAccountId, marketplaceIds: [site], actions: ["view"] } });
  assert.equal((await readObservations(f.scope, new URLSearchParams({ resource: "notifications", sourceId: f.sourceId }), reader)).rows.length, 2);
});

test("site sync grants cannot control seller-wide notification tasks", async () => {
  const f = await fresh("notifications", { notificationTypes: ["ORDER_CHANGE"] });
  const run = await f.start(), operator = randomUUID(), role = "operations";
  await prisma.organizationRosterRole.create({ data: { organizationId: f.scope.organizationId, id: role, name: "Fixture operator", description: "Fixture", permissions: { operations: ["view", "create", "edit"] } } });
  await prisma.user.create({ data: { id: operator, email: `${operator}@fixture.invalid`, name: "Fixture", passwordHash: "none", memberships: { create: { organizationId: f.scope.organizationId, role } } } });
  await prisma.amazonDataAccessGrant.create({ data: { ...f.scope, id: randomUUID(), userId: operator, sellerAccountId: f.sellerAccountId, marketplaceIds: [site], actions: ["view", "sync"] } });
  for (const [action, status] of [["pause", "WAITING"], ["cancel", "WAITING"], ["resume", "PAUSED"], ["retry", "FAILED"], ["retry", "PARTIAL_SUCCESS"]] as const) {
    await prisma.amazonSyncRun.update({ where: { id: run.id }, data: { status } });
    const before = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } });
    await assert.rejects(prisma.$transaction(tx => withApprovedChange({ tx, scope: f.scope, action: "control-task", approvalId: "fixture-approved", commandSourceIds: [f.sourceId] }, () => controlTask(f.scope, operator, run.id, action))), { status: 403 });
    assert.deepEqual(await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } }), before);
  }
});

test("Buy Box history uses the newest complete whole-ASIN version per day", async () => {
  const f = await fresh("buy_box_history", { allAsins: true, from: "2021-06-11", to: "2021-06-11", asins: [] });
  const first = await f.start(); assert.equal((await f.finish(first.id)).status, "SUCCEEDED");
  const second = await f.start(); assert.equal((await f.finish(second.id)).status, "SUCCEEDED");
  const result = await f.read({ from: "2021-06-10", to: "2021-06-12" });
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].sourceRunId, second.id);
  assert.deepEqual(typeof result.completeness === "object" ? result.completeness.publishedDays : [], ["2021-06-11"]);
  assert.equal((await f.read({ from: "2021-06-12", to: "2021-06-12" })).rows.length, 0);
  await assert.rejects(f.read({ from: "2021-06-12", to: "2021-06-11" }));
  await assert.rejects(f.read({ from: "2021-06-10", runId: first.id }));
});

test("Brand reader selects each ASIN once when automatic catalog batches overlap", async () => {
  const a = "B123456789", b = "B987654321", c = "B000000001";
  const f = await fresh("brand_analytics", { reportKind: "search_catalog", from: "2025-01-05", to: "2025-01-11", asins: [a, b] });
  const first = await f.start(); assert.equal((await f.finish(first.id)).status, "SUCCEEDED");
  const rows = await prisma.amazonDomainObservation.findMany({ where: { sourceRunId: first.id } });
  const secondId = randomUUID(), frozen = first.frozenScope as Prisma.JsonObject;
  await prisma.amazonSyncRun.create({ data: { ...f.scope, id: secondId, sourceId: f.sourceId, requestedByUserId: f.actor, resource: "brand_analytics", mode: "report", executionVersion: 2, status: "SUCCEEDED", stage: "COMPLETED", finishedAt: new Date(), paginationComplete: true, idempotencyKey: secondId, frozenScope: { ...frozen, domainPolicy: { ...(frozen.domainPolicy as Prisma.JsonObject), asins: [b, c] } } as Prisma.InputJsonValue } });
  const template = rows.find(row => row.asin === b)!;
  await prisma.amazonDomainObservation.createMany({ data: [b, c].map(id => ({ ...f.scope, id: randomUUID(), sourceId: f.sourceId, sourceRunId: secondId, kind: template.kind, businessKey: id, asin: id, facts: { ...(template.facts as Prisma.JsonObject), asin: id } as Prisma.InputJsonValue, capturedAt: new Date() })) });
  const result = await readBrandAnalytics(f.scope, new URLSearchParams({ sourceId: f.sourceId, reportKind: "search_catalog" }), f.actor);
  assert.equal(result.pagination.total, 3); assert.equal(new Set(result.rows.map(row => row.asin)).size, 3);
  assert.equal(result.rows.find(row => row.asin === b)!.sourceRunId, secondId);
});


for (const resource of ["catalog_items", "listing_details"]) for (const legacy of [false, true]) test(`${resource} reuses ${legacy ? "legacy" : "indexed"} explicit-object archive at the request budget`, async () => {
  const f = await fresh(resource, { maxRequests: 1 }), run = await f.start();
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId } });
  const policy = parseObservationPolicy(source.domainPolicy, resource);
  const state = { ...initialObservationState(policy), requests: 1 };
  const listing = resource === "listing_details";
  const operation = listing ? "getListingsItem" : "getCatalogItem";
  const body = officialExample(`src/data/amazon-contracts/${listing ? "listings" : "catalog"}-detail-model.json`, listing ? "/listings/2021-08-01/items/{sellerId}/{sku}" : "/catalog/2022-04-01/items/{asin}", operation);
  if (listing) body.sku = "fixture-sku"; else body.asin = asin;
  body.attributes = {};
  const rawBody = JSON.stringify(body);
  const rawCiphertext = seal({ rawBody }, f.scope, `${run.id}:1`, "amazon-observation-raw.v1");
  await prisma.amazonSyncRun.update({ where: { id: run.id }, data: { stage: "FETCHING", checkpointCiphertext: seal({ state }, f.scope, run.id, "amazon-observation-state.v1") } });
  await prisma.amazonSyncRawPage.create({ data: { ...f.scope, taskId: run.id, resource, page: 1, requestMetadata: { operation, ...(legacy ? {} : { objectIndex: 0 }) }, bodySha256: digest(rawBody), rawCiphertext, capturedAt: new Date() } });
  const done = await f.finish(run.id);
  assert.equal(done.status, "SUCCEEDED", done.error ?? "");
  assert.equal(done.apiRequests, 0); assert.equal(f.calls.length, 0);
  assert.equal(done.pagesCompleted, 1); assert.equal(done.insertedCount, 1);
  assert.equal((await f.read()).pagination.total, 1);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id } }), 1);
  assert.equal((await prisma.amazonSyncRawPage.findUniqueOrThrow({ where: { taskId_page: { taskId: run.id, page: 1 } } })).rawCiphertext, rawCiphertext);
});

for (const resource of ["catalog_items", "listing_details"]) test(`${resource} never reuses a committed legacy response for the next explicit object`, async () => {
  const listing = resource === "listing_details";
  const f = await fresh(resource, listing ? { sellerSkus: ["fixture-sku", "next-sku"] } : { asins: [asin, "B987654321"] });
  const run = await f.start();
  await f.slice(run.id);
  const first = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: run.id, page: 1 } });
  assert.equal((first.requestMetadata as Prisma.JsonObject).objectIndex, 0);
  // Existing archives predate objectIndex on explicit object policies.
  await prisma.amazonSyncRawPage.update({ where: { taskId_page: { taskId: run.id, page: 1 } }, data: { requestMetadata: { operation: listing ? "getListingsItem" : "getCatalogItem" } } });
  const done = await f.finish(run.id);
  assert.equal(done.status, "SUCCEEDED", done.error ?? "");
  assert.equal(done.insertedCount, 2); assert.equal(done.pagesCompleted, 2);
  assert.equal(f.calls.filter(path => path.startsWith(listing ? "/listings/" : "/catalog/")).length, 2);
  assert.equal((await f.read()).pagination.total, 2);
  assert.equal((await prisma.amazonSyncRawPage.findUniqueOrThrow({ where: { taskId_page: { taskId: run.id, page: 1 } } })).rawCiphertext, first.rawCiphertext);
});

for (const resource of ["catalog_items", "listing_details", "fulfillment"]) test(`MCP approval resumes ${resource} without recollecting committed objects`, async () => {
  const product = resource !== "fulfillment";
  const f = await fresh(resource, resource === "catalog_items" ? { asins: [asin, "B987654321"] } : resource === "listing_details" ? { sellerSkus: ["fixture-sku", "next-sku"] } : {});
  const pair = { sellerAccountId: f.sellerAccountId, marketplaceId: site };
  const auth = await prisma.amazonSpApiAuthorization.update({ where: { id: f.authorizationId }, data: { identityVerifiedAt: new Date(), identityEvidence: "OFFLINE_FIXTURE" } });
  await prisma.amazonSellerIdentity.create({ data: { ...f.scope, id: randomUUID(), ...pair, authorizationId: f.authorizationId, amazonSellerId: auth.amazonSellerId!, region, verifiedAt: new Date() } });
  await prisma.amazonDataAccessGrant.updateMany({ where: { ...f.scope, userId: f.actor, sellerAccountId: f.sellerAccountId }, data: { mcpEnabled: true } });
  const credential = await manageMcpCredential(f.scope, f.actor, { action: "create", name: "offline product resume", scopes: [{ sellerAccountId: f.sellerAccountId, marketplaceIds: [site] }], tools: ["data_query", "data_sync_start", "workflow_sync_review", "workflow_sync_confirm"], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp(`Bearer ${credential.token!}`);
  const run = await f.start(); await f.slice(run.id);
  await f.approved({ action: "control-task", id: run.id, control: product ? "cancel" : "pause" });
  const stopped = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } });
  const original = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: run.id, page: 1 } });
  const requests = f.calls.length;
  await assert.rejects(() => invokeAmazonMcp(identity, "data_sync_start", { ...pair, resource }), /taskId/);
  await assert.rejects(() => invokeAmazonMcp(identity, "data_sync_start", { ...pair, resource, taskId: randomUUID() }), /范围/);
  const response = await invokeAmazonMcp(identity, "data_sync_start", { ...pair, resource, taskId: run.id }) as { data: { started: boolean; changeRequest: { id: string } } };
  assert.equal(response.data.started, false); assert.equal(f.calls.length, requests);
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } })).status, stopped.status);
  const request = new Request("http://localhost/api/lili/mcp", { headers: { authorization: `Bearer ${credential.token!}` } });
  const requestId = response.data.changeRequest.id;
  await callSyncChatTool(request, "workflow_sync_review", { workspaceId: f.scope.workspaceId, requestId });
  const approval = await prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (product) assert.equal((((approval.beforeSummary as Prisma.JsonObject).current as Prisma.JsonObject).productRecovery as Prisma.JsonObject).recordsPreserved, 1);
  await callSyncChatTool(request, "workflow_sync_confirm", { workspaceId: f.scope.workspaceId, requestId, expectedDigest: approval.changeDigest, expectedRevision: approval.baseRevision, userConfirmation: "批准本次离线夹具指定任务按原清单恢复，保留原件和已提交记录" });
  const resumed = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(resumed.checkpointCiphertext, stopped.checkpointCiphertext);
  assert.equal(resumed.insertedCount, stopped.insertedCount); assert.equal(resumed.pagesCompleted, stopped.pagesCompleted);
  assert.equal(resumed.apiRequests, stopped.apiRequests); assert.equal(await prisma.amazonSyncRun.count({ where: f.scope }), 1);
  const done = await f.finish(run.id); assert.equal(done.status, "SUCCEEDED", done.error ?? "");
  assert.equal((await prisma.amazonSyncRawPage.findUniqueOrThrow({ where: { taskId_page: { taskId: run.id, page: 1 } } })).rawCiphertext, original.rawCiphertext);
  if (product) assert.equal(f.calls.filter(path => path.startsWith(resource === "catalog_items" ? "/catalog/" : "/listings/")).length, 2);
  const published = await invokeAmazonMcp(identity, "data_query", { ...pair, table: resource, pageSize: 1 }) as { total: number; records: unknown[] };
  assert.equal(published.total, product ? 2 : 4); assert.equal(published.records.length, 1);
  const last = await invokeAmazonMcp(identity, "data_query", { ...pair, table: resource, pageSize: 1, page: published.total }) as { total: number; records: unknown[]; hasMore: boolean };
  assert.equal(last.total, published.total); assert.equal(last.records.length, 1); assert.equal(last.hasMore, false);
});

test("catalog cancelled recovery approval rejects checkpoint drift and disabled bindings", async () => {
  const f = await fresh("catalog_items", { asins: [asin, "B987654321"] }), run = await f.start();
  await f.slice(run.id); await f.approved({ action: "control-task", id: run.id, control: "cancel" });
  const req = await requestChange(f.scope, f.actor, { action: "control-task", id: run.id, control: "retry" });
  await decideChange(f.scope, f.approver, String(req.id), "APPROVED", "fixture");
  await prisma.amazonSyncRun.update({ where: { id: run.id }, data: { pagesCompleted: { increment: 1 } } });
  const calls = f.calls.length;
  await assert.rejects(() => applyChange(f.scope, f.actor, String(req.id)));
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } })).status, "CANCELLED");
  await prisma.amazonSyncRun.update({ where: { id: run.id }, data: { pagesCompleted: { decrement: 1 }, stage: "BINDING_DISABLED" } });
  await assert.rejects(() => f.approved({ action: "control-task", id: run.id, control: "retry" }), /检查点/);
  assert.equal(f.calls.length, calls);
});

test("catalog partial retry preserves successful originals and publishes only after the missing object succeeds", async () => {
  const f = await fresh("catalog_items", { asins: [asin, "B987654321"] });
  f.setMode("catalog-missing"); const run = await f.start();
  const partial = await f.finish(run.id); assert.equal(partial.status, "PARTIAL_SUCCESS", partial.error ?? "");
  assert.equal(partial.insertedCount, 1); assert.equal((await f.read()).rows.length, 0);
  const original = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: run.id, page: 1 } });
  const calls = f.calls.filter(path => path.startsWith("/catalog/")).length;
  await f.approved({ action: "control-task", id: run.id, control: "retry" });
  const again = await f.finish(run.id); assert.equal(again.status, "PARTIAL_SUCCESS");
  assert.equal(f.calls.filter(path => path.startsWith("/catalog/")).length - calls, 1);
  assert.equal(again.insertedCount, 1); assert.equal((await f.read()).rows.length, 0);
  f.setMode("normal"); await f.approved({ action: "control-task", id: run.id, control: "retry" });
  const done = await f.finish(run.id); assert.equal(done.status, "SUCCEEDED", done.error ?? "");
  assert.equal(done.insertedCount, 2); assert.equal(done.processedCount, 2);
  assert.equal(f.calls.filter(path => path.startsWith("/catalog/")).length - calls, 2);
  assert.equal((await prisma.amazonSyncRawPage.findUniqueOrThrow({ where: { taskId_page: { taskId: original.taskId, page: original.page } } })).rawCiphertext, original.rawCiphertext);
  const published = await f.read({ pageSize: "1", page: "1" }); assert.equal(published.rows.length, 1);
  assert.equal((await f.read({ pageSize: "1", page: "2" })).rows.length, 1);
  assert.equal((await f.read({ pageSize: "1", page: "3" })).rows.length, 0);
});


test("approved catalog partial publication exposes verified rows and gaps without declaring completeness", async () => {
  const f = await fresh("catalog_items", { asins: [asin, "B987654321"] });
  f.setMode("catalog-missing"); const run = await f.start();
  const partial = await f.finish(run.id); assert.equal(partial.status, "PARTIAL_SUCCESS");
  const requests = f.calls.length;
  await f.approved({ action: "control-task", id: run.id, control: "publish-available" });
  assert.equal(f.calls.length, requests, "publishing archived facts must not request Amazon");
  const published = await f.read(); assert.equal(published.rows.length, 1);
  assert.equal(published.run?.id, run.id);
  assert.equal(typeof published.completeness, "object");
  const shared = await readDataset(f.scope, new URLSearchParams({ table: "catalog_items", sourceId: f.sourceId, sellerAccountId: f.sellerAccountId, marketplaceId: site }), f.actor);
  assert.equal(shared.total, 1); assert.ok(shared.warnings.some(warning => String(warning).includes("部分发布")));
  assert.deepEqual(shared.evidenceRefs, [{ sourceId: f.sourceId, syncRunId: run.id }]);
  assert.equal((published.run?.summary as { coverage: { complete: boolean; unavailableObjectIds: string[] } }).coverage.complete, false);
  assert.deepEqual((published.run?.summary as { coverage: { unavailableObjectIds: string[] } }).coverage.unavailableObjectIds, ["B987654321"]);
  const after = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(after.status, "PARTIAL_SUCCESS"); assert.equal(after.stage, "PARTIAL_PUBLISHED"); assert.equal(after.checkpointCiphertext, partial.checkpointCiphertext);
  assert.equal((await f.read({ page: "2" })).rows.length, 0);
  await assert.rejects(f.approved({ action: "control-task", id: run.id, control: "publish-available" }));
  f.setMode("normal"); await f.approved({ action: "control-task", id: run.id, control: "retry" });
  assert.equal((await f.finish(run.id)).status, "SUCCEEDED");
  assert.equal((await f.read()).rows.length, 2);
});

test("catalog partial publication preserves a previous complete default and rejects changed facts", async () => {
  const f = await fresh("catalog_items", { asins: [asin, "B987654321"] });
  const complete = await f.start(); assert.equal((await f.finish(complete.id)).status, "SUCCEEDED");
  f.setMode("catalog-missing"); const run = await f.start(); await f.finish(run.id);
  const row = await prisma.amazonDomainObservation.findFirstOrThrow({ where: { sourceRunId: run.id } });
  await prisma.amazonDomainObservation.update({ where: { id: row.id }, data: { facts: {} } });
  await assert.rejects(f.approved({ action: "control-task", id: run.id, control: "publish-available" }));
  await prisma.amazonDomainObservation.update({ where: { id: row.id }, data: { facts: row.facts as Prisma.InputJsonValue } });
  await f.approved({ action: "control-task", id: run.id, control: "publish-available" });
  assert.equal((await f.read()).run?.id, complete.id);
  assert.equal((await f.read({ runId: run.id })).rows.length, 1);
});
