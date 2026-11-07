import { createSession } from "@/lib/auth/session";
import { POST as credentialPost } from "@/app/api/operations/amazon-mcp/route";
import { PATCH as storePatch } from "@/app/api/operations/amazon-stores/route";
import { POST as oauthStart } from "@/app/api/integrations/amazon/sp-api/oauth/start/route";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { manageMcpCredential, authenticateAmazonMcp, invokeAmazonMcp, listMcpSkillTableOptions, listDiscoverableAmazonMcpTools, getMcpSettingsSnapshot } from "@/lib/amazon-sync/mcp";
import { amazonDataAccess, assertSellerMarketplaceAccess } from "@/lib/amazon-sync/data-access";
import { POST } from "@/app/api/mcp/amazon/route";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";
import { requestChange, decideChange, applyChange } from "@/lib/amazon-sync/change-approval";
import { auditAmazonLineage } from "@/lib/amazon-sync/lineage-audit";
import { readTaskSnapshot } from "@/lib/amazon-sync/snapshots";
import { publishedSnapshotScopes } from "@/lib/amazon-sync/read";
import { renameAmazonStore, listAmazonStores } from "@/lib/amazon-sync/stores";
import { assertExportJobAccess } from "@/lib/amazon-sync/exports";
import { startAmazonOAuth, finishAmazonOAuth } from "@/lib/amazon-sync/oauth";
import { handleLiliRequest } from "@/lib/lili/api";
import { prismaResearchRepository } from "@/lib/selection-research/prisma-repository";
import type { Run } from "@/lib/selection-research/types";

if (process.env.AMAZON_SYNC_TEST_REDIS_DISPOSABLE !== "1" || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw new Error("Disposable runner required");
const scope = { organizationId: randomUUID(), workspaceId: "main" }, other = { organizationId: randomUUID(), workspaceId: "main" };
const actor = randomUUID(), peer = randomUUID(), owner = randomUUID(), sellerA = randomUUID(), sellerB = randomUUID();
const site = "ATVPDKIKX0DER", ca = "A2EUQ1WTGCTBG2";
let grantId = "", token = "", credentialId = "", runA = "";
const originalFetch = globalThis.fetch;
const tools = ["amazon.stores.list", "amazon.inventory.list", "amazon.inventory.summary", "amazon.catalog.list", "amazon.sales.list", "amazon.sync.status", "amazon.history.read", "amazon.sales.export", "data_list_tables", "data_describe_table", "data_query", "data_sync_status", "data_sync_start"];
const readTools = tools.filter(tool => tool !== "amazon.history.read" && tool !== "data_sync_start");
async function call(tool: string, args = {}, bearer = token) { return invokeAmazonMcp(await authenticateAmazonMcp(`Bearer ${bearer}`), tool, args); }
async function seed(sellerAccountId: string, qty: number) {
  const auth = randomUUID(), amazonSellerId = `SELLER${qty}FIXTURE`;
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: auth, name: "synthetic", amazonSellerId, awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", credentialsCiphertext: "not-real", updatedByUserId: owner, status: "CONFIGURED", identityVerifiedAt: new Date(), identityEvidence: "FIXTURE" } });
  await prisma.amazonSellerIdentity.create({ data: { ...scope, id: randomUUID(), sellerAccountId, marketplaceId: site, amazonSellerId, region: "us-east-1", authorizationId: auth, verifiedAt: new Date() } });
  let inventory = "";
  for (const resource of ["inventory", "catalog", "sales_traffic"]) {
    const sourceId = randomUUID(), runId = randomUUID();
    await prisma.amazonSyncDataSource.create({ data: { ...scope, id: sourceId, authorizationId: auth, sellerAccountId, marketplaceId: site, resource, freshnessMinutes: 360, enabled: true, rowCount: 1 } });
    await prisma.amazonSyncRun.create({ data: { ...scope, id: runId, sourceId, resource, mode: resource === "sales_traffic" ? "date_range" : "snapshot", requestedByUserId: owner, executionVersion: 2, status: "SUCCEEDED", finishedAt: new Date() } });
    await prisma.amazonSyncDataSource.update({ where: { id: sourceId }, data: { activeRunId: runId, lastSuccessAt: new Date() } });
    if (resource === "inventory") { inventory = runId; await prisma.amazonInventorySnapshot.create({ data: { ...scope, id: randomUUID(), sellerAccountId, marketplaceId: site, sellerSku: "SAME-SKU", fulfillableQuantity: qty, syncRunId: runId, capturedAt: new Date() } }); }
    if (resource === "catalog") await prisma.amazonCatalogSnapshot.create({ data: { ...scope, id: randomUUID(), sellerAccountId, marketplaceId: site, sellerSku: "SAME-SKU", sourceRunId: runId, fieldSources: {}, capturedAt: new Date() } });
    if (resource === "sales_traffic") await prisma.amazonSalesTrafficSnapshot.create({ data: { ...scope, id: randomUUID(), sellerAccountId, marketplaceId: site, sourceId, syncRunId: runId, businessDate: new Date().toISOString().slice(0, 10), reportId: "fixture", documentId: "fixture", metrics: { unitsOrdered: qty }, quality: "VALID", capturedAt: new Date() } });
  }
  return inventory;
}
before(async () => {
  globalThis.fetch = async () => { throw new Error("External HTTP forbidden in fixtures"); };
  for (const s of [scope, other]) { await prisma.organization.create({ data: { id: s.organizationId, name: "Fixture", slug: s.organizationId } }); await prisma.workspaceScope.create({ data: { organizationId: s.organizationId, id: s.workspaceId, name: "Fixture" } }); }
  for (const [id, role] of [[actor, "operations"], [peer, "operations"], [owner, "owner"]] as const) await prisma.user.create({ data: { id, name: "Fixture", email: `${id}@fixture.invalid`, passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role } } } });
  await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: "operations", name: "Fixture", description: "Fixture", permissions: { operations: ["view", "create", "edit", "export"] } } });
  for (const id of [sellerA, sellerB]) await prisma.sellerAccount.create({ data: { ...scope, id, accountKey: id, displayName: "ERP custom name", marketplaceCode: "US" } });
  runA = await seed(sellerA, 3); await seed(sellerB, 999);
  grantId = (await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId: actor, sellerAccountId: sellerA, marketplaceIds: [site], actions: ["view", "export"], mcpEnabled: true } })).id;
  await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId: peer, sellerAccountId: sellerB, marketplaceIds: [site], actions: ["view"], mcpEnabled: true } });
  const created = await manageMcpCredential(scope, actor, { action: "create", name: "own fixture", scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], tools, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  token = created.token!; credentialId = created.credential.id;
});
after(async () => { globalThis.fetch = originalFetch; await prisma.$disconnect(); });
test("MCP personal hash only; metadata never includes plaintext", async () => {
  const row = await prisma.amazonMcpCredential.findUniqueOrThrow({ where: { id: credentialId } });
  assert.notEqual(row.tokenHash, token); assert.equal(row.tokenHash.length, 64); assert.ok(!JSON.stringify(row).includes(token));
});
test("Lili research bearer uses real PostgreSQL grants, ownership, revocation and audit without external calls", async () => {
  const role = await prisma.organizationRosterRole.findUniqueOrThrow({ where: { organizationId_id: { organizationId: scope.organizationId, id: "operations" } } });
  const permissions = { ...(role.permissions as Record<string, Prisma.InputJsonValue>), agents: ["view", "create", "edit", "export"] };
  const rpc = async (bearer: string, method: string, params?: unknown) => handleLiliRequest(new Request("http://localhost/api/lili/mcp", { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), ["mcp"]);
  const grant = { action: "create", name: "isolated Lili research", tools: ["data_query", "research_read", "research_step"], scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 60_000).toISOString() };
  try {
    const publicRequest = new Request("http://localhost/api/lili/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const publicCatalog = await (await handleLiliRequest(publicRequest, ["mcp"])).json();
    assert.equal(publicCatalog.result.scope, "anonymous-definitions");
    assert.ok(publicCatalog.result.tools.every((tool: { name: string }) => !tool.name.startsWith("erp__")));
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "operations" } }, data: { permissions } });
    assert.equal((await rpc(token, "tools/list")).status, 200, "existing ERP grant works without adding research rights");
    const made = await manageMcpCredential(scope, actor, grant);
    const listed = await (await rpc(made.token!, "tools/list")).json();
    assert.deepEqual(listed.result.tools.filter((t: { name: string }) => t.name.startsWith("research_")).map((t: { name: string }) => t.name), ["research_prepare", "research_read", "research_step"]);
    const now = new Date().toISOString();
    const run: Run = { version: 1, id: randomUUID(), revision: 0, scope: { ...scope, ownerId: actor }, mode: "live", budgetMode: "mock_unlimited", erpCredentialId: made.credential.id, requirement: "ISOLATED DATABASE FIXTURE ONLY", marketplace: "US", createdAt: now, updatedAt: now, status: "WAITING_FOR_USER", stage: 1, skills: [], registry: [], policies: {}, limits: {}, calls: [], actions: [], decisions: [], results: [], gate: { id: randomUUID(), kind: "NICHE", reason: "fixture only" } };
    await prismaResearchRepository().create(run);
    const args = { runId: run.id, workspaceId: scope.workspaceId };
    const response = await rpc(made.token!, "tools/call", { name: "research_read", arguments: args });
    assert.equal(response.status, 200);
    const read = JSON.parse((await response.json()).result.content[0].text);
    assert.equal(read.run.id, run.id); assert.equal(read.nextAction.kind, "HUMAN_REVIEW");
    assert.equal((await rpc(made.token!, "tools/call", { name: "research_read", arguments: { ...args, workspaceId: "other" } })).status, 403);
    assert.equal((await rpc(made.token!, "tools/call", { name: "research_approve", arguments: args })).status, 403);
    assert.equal((await rpc(made.token!, "tools/call", { name: "sellersprite__product_search", arguments: {} })).status, 403);
    const alternate = await manageMcpCredential(scope, actor, grant);
    const crossCredential = JSON.parse((await (await rpc(alternate.token!, "tools/call", { name: "research_read", arguments: args })).json()).result.content[0].text);
    assert.equal(crossCredential.status, 404);
    await prisma.agentExecution.update({ where: { id: run.id }, data: { requestedByUserId: peer } });
    const crossOwner = JSON.parse((await (await rpc(made.token!, "tools/call", { name: "research_read", arguments: args })).json()).result.content[0].text);
    assert.equal(crossOwner.status, 404);
    await prisma.agentExecution.update({ where: { id: run.id }, data: { requestedByUserId: actor } });
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "operations" } }, data: { permissions: { ...permissions, agents: [] } } });
    assert.equal((await rpc(made.token!, "tools/list")).status, 403, "current role revocation is immediate");
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "operations" } }, data: { permissions } });
    await prisma.amazonMcpCredential.update({ where: { id: made.credential.id }, data: { expiresAt: new Date(0) } });
    assert.equal((await rpc(made.token!, "tools/list")).status, 401);
    await prisma.amazonMcpCredential.update({ where: { id: made.credential.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
    await manageMcpCredential(scope, actor, { action: "revoke", id: made.credential.id, revision: made.credential.revision });
    assert.equal((await rpc(made.token!, "tools/list")).status, 401);
    const saved = await prismaResearchRepository().read(run.id, run.scope);
    assert.deepEqual(saved.run.decisions, []); assert.equal(saved.run.status, "WAITING_FOR_USER");
    const logs = await prisma.auditLog.findMany({ where: { ...{ organizationId: scope.organizationId }, entityId: made.credential.id, action: { startsWith: "lili.mcp." } } });
    assert.ok(logs.some(log => log.action === "lili.mcp.succeeded")); assert.ok(logs.some(log => log.action === "lili.mcp.denied"));
    assert.ok(!JSON.stringify(logs).includes(made.token!));
  } finally {
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "operations" } }, data: { permissions: role.permissions as Prisma.InputJsonValue } });
  }
});
test("all real MCP read tools and identical SKUs stay inside seller A", async () => {
  for (const tool of readTools) {
    const args = tool === "data_describe_table" || tool === "data_query" ? { table: "inventory" } : {};
    const result = await call(tool, args); assert.ok(!JSON.stringify(result).includes(sellerB), tool);
  }
  const rows = await call("amazon.inventory.list") as { rows: { sellerSku: string; fulfillableQuantity: number }[] };
  assert.equal(rows.rows.length, 1); assert.equal(rows.rows[0].sellerSku, "SAME-SKU"); assert.equal(rows.rows[0].fulfillableQuantity, 3);
});
test("generic Skill table catalog and queries expose only published authorized facts", async () => {
  const catalog = await call("data_list_tables") as { data: { items: Array<{ name: string; schemaStatus: string }> }; meta: { isSandbox: boolean } };
  assert.deepEqual(catalog.data.items.map(table => table.name).sort(), ["inventory", "listings", "sales_traffic_daily"]);
  assert.ok(catalog.data.items.every(table => table.schemaStatus === "application_schema_confirmed_source_sample_pending")); assert.equal(catalog.meta.isSandbox, false);
  const schema = await call("data_describe_table", { table: "inventory" }) as { data: { table: { fields: Array<{ name: string }> } } };
  assert.ok(schema.data.table.fields.some(field => field.name === "fulfillableQuantity"));
  const inventory = await call("data_query", { table: "inventory", filters: { sellerSku: "SAME-SKU" }, pageSize: 10 }) as { data: { items: Array<{ fulfillableQuantity: number }>; total: number }; meta: { source: string; page: { hasNext: boolean } } };
  assert.equal(inventory.data.total, 1); assert.equal(inventory.data.items[0].fulfillableQuantity, 3); assert.equal(inventory.meta.source, "AmazonInventorySnapshot"); assert.equal(inventory.meta.page.hasNext, false);
  const listings = await call("data_query", { table: "listings" }) as { data: { total: number } };
  assert.equal(listings.data.total, 1);
  const sales = await call("data_query", { table: "sales_traffic_daily" }) as { data: { total: number; items: Array<{ metrics: { unitsOrdered: number } }> }; meta: { warnings: string[] } };
  assert.equal(sales.data.total, 1); assert.equal(sales.data.items[0].metrics.unitsOrdered, 3); assert.ok(sales.meta.warnings.some(warning => warning.includes("不含 ASIN/SKU")));
  await assert.rejects(() => call("data_query", { table: "sales_traffic_asin" }), /SCHEMA_UNVERIFIED/);
  await assert.rejects(() => call("data_query", { table: "inventory", filters: { arbitraryColumn: "x" } }), /FIELD_NOT_MAPPED/);
  await assert.rejects(() => call("data_query", { table: "inventory", sellerAccountId: sellerB }), /数据范围不可访问/);
});
test("unified dataset locators preserve rows and expose bounded, scoped metadata", async () => {
  for (const [table, module, dataType] of [["inventory", "amazon_sync", "inventory"], ["listings", "amazon_sync", "listings"], ["sales_traffic_daily", "amazon_sync", "sales_traffic_daily"]]) {
    const legacy = await call("data_query", { table }) as { data: unknown; meta: { source: string } };
    const current = await call("data_query", { module, dataType }) as { data: unknown; pagination: { total: number }; meta: { source: string; dataset: { id: string }; scope: { pairs: unknown[] }; requestId: string; toolVersion: string } };
    assert.deepEqual(current.data, legacy.data);
    assert.equal(current.meta.source, legacy.meta.source);
    assert.equal(current.meta.dataset.id, table);
    assert.deepEqual(current.meta.scope.pairs, [{ sellerAccountId: sellerA, marketplaceId: site }]);
    assert.ok(current.meta.requestId);
    assert.equal(current.meta.toolVersion, "1.1.0");
    const described = await call("data_describe_table", { module, dataType }) as { data: { table: { maxPageSize: number; dateSemantics: string } } };
    assert.equal(described.data.table.maxPageSize, 1000);
    assert.ok(described.data.table.dateSemantics);
  }
  await assert.rejects(() => call("data_query", { table: "inventory", module: "amazon_sync", dataType: "listings" }), /定位参数冲突/);
  await assert.rejects(() => call("data_query", { module: "amazon_sync" }), /完整module/);
  await assert.rejects(() => call("data_query", { module: "amazon_sync", dataType: "sales_traffic_daily", filters: { asin: "B000FIXTURE" } }), /FIELD_NOT_MAPPED/);
  await assert.rejects(() => call("data_query", { table: "inventory", sellerSku: "A", filters: { sellerSku: "B" } }), /筛选参数或别名冲突/);
  await assert.rejects(() => call("data_query", { table: "inventory", sellerAccountId: "" }), /不可访问/);
  const empty = await call("data_query", { table: "inventory", sellerSku: "MISSING" }) as { data: { total: number }; meta: { resultStatus: string } };
  assert.equal(empty.data.total, 0); assert.equal(empty.meta.resultStatus, "EMPTY_RESULT");
});
test("snapshot sorting and page counts apply the same supported filters to rows and totals", async () => {
  const original = await prisma.amazonInventorySnapshot.findFirstOrThrow({ where: { ...scope, syncRunId: runA } });
  const extra = await prisma.amazonInventorySnapshot.create({ data: { ...scope, id: randomUUID(), sellerAccountId: sellerA, marketplaceId: site, sellerSku: "ZZZ-FIXTURE", fulfillableQuantity: 0, syncRunId: runA, capturedAt: original.capturedAt } });
  try {
    const first = await call("data_query", { module: "amazon_sync", dataType: "inventory", pageSize: 1, sortBy: "sellerSku", sortDirection: "desc" }) as { data: { total: number; items: Array<{ sellerSku: string }> }; pagination: { hasNext: boolean; pageCount: number } };
    assert.equal(first.data.total, 2); assert.equal(first.data.items[0].sellerSku, "ZZZ-FIXTURE");
    assert.equal(first.pagination.hasNext, true); assert.equal(first.pagination.pageCount, 2);
    const second = await call("data_query", { table: "inventory", page: 2, pageSize: 1, filters: { sortBy: "sellerSku", sortDirection: "desc" } }) as typeof first;
    assert.equal(second.data.total, 2); assert.equal(second.data.items[0].sellerSku, "SAME-SKU");
    assert.equal(second.pagination.hasNext, false);
  } finally { await prisma.amazonInventorySnapshot.delete({ where: { id: extra.id } }); }
});
test("sales exactMetrics preserves PostgreSQL JSON numeric text without replacing legacy metrics", async () => {
  const row = await prisma.amazonSalesTrafficSnapshot.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA } });
  try {
    await prisma.$executeRaw`UPDATE "AmazonSalesTrafficSnapshot" SET metrics = ${'{"unitsOrdered":9007199254740993,"totalOrderItems":0,"sessions":null,"orderedProductSales":{"amount":9007199254740993.123456,"currencyCode":"USD"}}'}::jsonb WHERE id = ${row.id}`;
    const result = await call("data_query", { module: "amazon_sync", dataType: "sales_traffic_daily" }) as { data: { items: Array<{ metrics: { unitsOrdered: number }; exactMetrics: { unitsOrdered: string; totalOrderItems: string; sessions: null; orderedProductSales: { amount: string; currencyCode: string } } }> } };
    const item = result.data.items[0];
    assert.equal(typeof item.metrics.unitsOrdered, "number");
    assert.equal(item.exactMetrics.unitsOrdered, "9007199254740993");
    assert.equal(item.exactMetrics.totalOrderItems, "0");
    assert.equal(item.exactMetrics.sessions, null);
    assert.equal(item.exactMetrics.orderedProductSales.amount, "9007199254740993.123456");
    assert.equal(item.exactMetrics.orderedProductSales.currencyCode, "USD");
  } finally { await prisma.amazonSalesTrafficSnapshot.update({ where: { id: row.id }, data: { metrics: row.metrics as Prisma.InputJsonValue } }); }
});
test("ERP Skill setup reports live published availability within current seller grants", async () => {
  const tables = await listMcpSkillTableOptions(scope, actor);
  const inventory = tables.find(table => table.name === "inventory")!;
  assert.equal(inventory.available, true);
  assert.equal(inventory.sourceCount, 1);
  assert.equal(inventory.rowCount, 1);
  assert.equal(inventory.freshness, "ok");
  assert.equal(tables.find(table => table.name === "listings")?.available, true);
  assert.equal(tables.find(table => table.name === "sales_traffic_daily")?.available, true);
  assert.ok(!JSON.stringify(tables).includes(sellerB));
});
test("Ads Skill report table exposes only the latest successful published version in authorized scope", async () => {
  const auth = randomUUID(), profileA = randomUUID(), profileB = randomUUID(), plan = randomUUID();
  const adsAuthorization = await prisma.amazonAdsAuthorization.create({ data: { ...scope, id: auth, name: "fixture", credentialsCiphertext: "fixture", consentRegion: "NA", authorizedByUserId: owner } });
  await prisma.amazonAdsProfile.create({ data: { ...scope, id: profileA, authorizationId: adsAuthorization.id, region: "NA", profileId: `10${Date.now()}`, countryCode: "US", marketplaceId: site, currencyCode: "USD", accountInfo: {}, sellerAccountId: sellerA } });
  await prisma.amazonAdsProfile.create({ data: { ...scope, id: profileB, authorizationId: adsAuthorization.id, region: "NA", profileId: `20${Date.now()}`, countryCode: "US", marketplaceId: site, currencyCode: "USD", accountInfo: {}, sellerAccountId: sellerB } });
  await prisma.amazonAdsSyncPlan.create({ data: { ...scope, id: plan, profileId: profileA, actorUserId: owner, sellerAccountId: sellerA, authorizationRevision: 1 } });
  const reportTask = async (id: string, status: "SUCCEEDED" | "FAILED", profileId: string, suffix: string) => {
    const taskId = randomUUID(), versionId = randomUUID();
    await prisma.amazonAdsSyncTask.create({ data: { ...scope, id: taskId, planId: plan, profileId, requestedByUserId: owner, idempotencyKey: `${suffix}-${taskId}`, planRevision: 1, status } });
    await prisma.amazonAdsReportVersion.create({ data: { ...scope, id: versionId, profileId, sourceTaskId: taskId, status: status === "SUCCEEDED" ? "PUBLISHED" : "STAGING", requestedFrom: new Date("2026-11-01T00:00:00Z"), requestedTo: new Date("2026-11-01T00:00:00Z"), rowCount: suffix === "new" ? 2 : 1, publishedAt: status === "SUCCEEDED" ? new Date(Date.now() + (suffix === "new" ? 1000 : 0)) : null } });
    await prisma.amazonAdsReportFact.create({ data: { ...scope, id, profileId, versionId, reportType: "sp_campaigns", adProduct: "SPONSORED_PRODUCTS", reportDate: new Date("2026-11-01T00:00:00Z"), factKey: "a".repeat(64), campaignId: suffix === "old" ? "retired-campaign" : suffix === "new" ? "current-campaign" : null, impressions: BigInt(suffix === "new" ? 20 : 10), clicks: BigInt(1), spend: "1.250000", orders: BigInt(1), sales: "5.000000", units: BigInt(1), currencyCode: "USD", apiVersion: "fixture-v1", sourceTaskId: taskId, rawDimensions: {} } });
    if (suffix === "new") await prisma.amazonAdsReportFact.create({ data: { ...scope, id: randomUUID(), profileId, versionId, reportType: "sp_campaigns", adProduct: "SPONSORED_PRODUCTS", reportDate: new Date("2026-11-01T00:00:00Z"), factKey: "b".repeat(64), campaignId: "incomplete-campaign", impressions: null, clicks: null, spend: null, orders: null, sales: null, units: null, currencyCode: "USD", apiVersion: "fixture-v1", sourceTaskId: taskId, rawDimensions: {} } });
    return versionId;
  };
  await reportTask(randomUUID(), "SUCCEEDED", profileA, "old");
  await reportTask(randomUUID(), "SUCCEEDED", profileA, "new");
  await reportTask(randomUUID(), "FAILED", profileA, "failed");
  await reportTask(randomUUID(), "SUCCEEDED", profileB, "foreign");
  const reportCredential = await manageMcpCredential(scope, actor, { action: "create", name: "explicit Ads reports", tools: [...tools, "amazon.ads.reports.list"], scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], expiresAt: new Date(Date.now()+60000).toISOString() });
  const adsCall = (tool: string, args = {}) => call(tool, args, reportCredential.token!);
  const legacyCatalog = await call("data_list_tables") as { data: { items: Array<{ name: string }> } };
  assert.ok(!legacyCatalog.data.items.some(table => table.name === "ads_report_daily"));
  await assert.rejects(() => call("data_query", { table: "ads_report_daily" }), /Ads 报表工具未授权/);
  const catalog = await adsCall("data_list_tables") as { data: { items: Array<{ name: string }> } };
  assert.ok(catalog.data.items.some(table => table.name === "ads_report_daily"));
  const availability = await listMcpSkillTableOptions(scope, actor);
  const availableAds = availability.find(table => table.name === "ads_report_daily");
  assert.ok(availableAds); assert.equal(availableAds.sourceCount, 1); assert.equal(availableAds.rowCount, null);
  const schema = await adsCall("data_describe_table", { table: "ads_report_daily" }) as { data: { table: { fields: Array<{ name: string; nullable?: boolean }> } } };
  assert.ok(schema.data.table.fields.some(field => field.name === "spend" && field.nullable));
  const result = await adsCall("data_query", { table: "ads_report_daily", filters: { from: "2026-11-01", to: "2026-11-01", campaignId: "current-campaign" } }) as { data: { total: number; items: Array<{ impressions: string; currencyCode: string }> }; meta: { currency: string } };
  assert.equal(result.data.total, 1);
  assert.equal(result.data.items[0].impressions, "20");
  assert.equal(result.data.items[0].currencyCode, "USD");
  assert.equal(result.meta.currency, "per_row");
  const stale = await adsCall("data_query", { table: "ads_report_daily", filters: { campaignId: "retired-campaign" } }) as { data: { total: number } };
  assert.equal(stale.data.total, 0);
  await assert.rejects(() => adsCall("data_query", { table: "ads_report_daily", filters: { from: "2020-01-01" } }), /367 天/);
  const incomplete = await adsCall("data_query", { table: "ads_report_daily", filters: { campaignId: "incomplete-campaign" } }) as { data: { items: Array<{ impressions: string | null; spend: string | null; sales: string | null }> } };
  assert.deepEqual(incomplete.data.items[0] && [incomplete.data.items[0].impressions, incomplete.data.items[0].spend, incomplete.data.items[0].sales], [null, null, null]);
  assert.ok(!JSON.stringify(result).includes(sellerB));
  const filters = { from: "2026-11-01", to: "2026-11-01", campaignId: "current-campaign", sortBy: "spend", sortDirection: "desc" };
  const generic = await adsCall("data_query", { module: "amazon_ads", dataType: "report_daily", filters, pageSize: 2 }) as { data: unknown; totals: unknown; meta: { publishedVersionIds: string[] } };
  const dedicated = await adsCall("amazon.ads.reports.list", { ...filters, pageSize: 2 }) as typeof generic;
  assert.deepEqual(generic.data, dedicated.data);
  assert.deepEqual(generic.totals, dedicated.totals);
  assert.equal(generic.totals, null, "unknown attribution windows must not be aggregated as comparable totals");
  assert.deepEqual(generic.meta.publishedVersionIds, dedicated.meta.publishedVersionIds);
  await assert.rejects(() => adsCall("data_query", { module: "amazon_ads", dataType: "report_daily", pageSize: 101 }), /分页参数/);
});
test("generic sync request remains pending approval and requires the MCP sync grant", async () => {
  await assert.rejects(() => call("data_sync_start", { resource: "inventory" }), /授权|不可访问/);
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { actions: ["view", "export", "sync"] } });
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  const beforeRuns = await prisma.amazonSyncRun.count({ where: scope });
  try {
    const response = await call("data_sync_start", { resource: "inventory", sellerAccountId: sellerA }) as { data: { approvalRequired: boolean; started: boolean; changeRequest: { status: string } } };
    assert.equal(response.data.approvalRequired, true); assert.equal(response.data.started, false); assert.equal(response.data.changeRequest.status, "REQUESTED");
    assert.equal(await prisma.amazonSyncRun.count({ where: scope }), beforeRuns);
  } finally {
    await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { actions: ["view", "export"] } });
  }
});
test("seller tampering and unknown seller have identical errors on every tool", async () => {
  for (const tool of tools.filter(tool => tool !== "data_sync_start")) for (const id of [sellerB, randomUUID()]) await assert.rejects(() => call(tool, { sellerAccountId: id }), /数据范围不可访问/);
});
test("site tampering and every multi-seller request are checked", async () => {
  await assert.rejects(() => call("amazon.inventory.list", { marketplaceId: ca }), /不可访问/);
  await assert.rejects(() => call("amazon.inventory.list", { sellerAccountIds: [sellerA, sellerB] }), /不可访问/);
});
test("workspace, organization, user and actual Seller ID injection denied", async () => {
  for (const key of ["workspaceId", "organizationId", "userId", "amazonSellerId"]) await assert.rejects(() => call("amazon.stores.list", { [key]: other.organizationId }), /不可访问/);
});
test("aggregate and export contain exactly authorized quantities", async () => {
  const sum = await call("amazon.inventory.summary") as { summary: { _sum: { fulfillableQuantity: number } } }; assert.equal(sum.summary._sum.fulfillableQuantity, 3);
  const output = await call("amazon.sales.export") as { rowCount: number; content: string }; assert.equal(output.rowCount, 1); assert.equal(JSON.parse(output.content).metrics.unitsOrdered, 3);
});
test("history is scoped and unpublished/unknown history never leaks", async () => {
  const result = await call("amazon.history.read", { taskId: runA }); assert.ok(JSON.stringify(result).includes("SAME-SKU"));
  const foreign = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, source: { sellerAccountId: sellerB } } });
  await assert.rejects(() => call("amazon.history.read", { taskId: foreign.id }), /不可访问/);
});
test("ERP revocation invalidates an already authenticated identity immediately", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: false } });
  await assert.rejects(() => invokeAmazonMcp(identity, "amazon.inventory.list", {}), /授权|不可访问/);
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: true } });
});
test("credential revocation rechecked even with cached identity", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { status: "REVOKED" } });
  await assert.rejects(() => invokeAmazonMcp(identity, "amazon.inventory.list", {}), /不可访问/);
  await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { status: "ACTIVE" } });
});
test("site and export/sync actions cannot inherit view grants", async () => {
  await assert.rejects(() => assertSellerMarketplaceAccess(scope, actor, sellerA, site, prisma, "sync"));
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { actions: ["view"] } });
  await assert.rejects(() => call("amazon.sales.export"));
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { actions: ["view", "export"] } });
});
test("role grants union with user grants but credential scope remains a ceiling", async () => {
  const roleGrant = await prisma.amazonRoleDataAccessGrant.create({ data: { ...scope, id: randomUUID(), roleId: "operations", sellerAccountId: sellerB, marketplaceIds: [site], actions: ["view"], mcpEnabled: true } });
  assert.ok((await amazonDataAccess(scope, actor)).sellerIds.includes(sellerB));
  await assert.rejects(() => call("amazon.inventory.list", { sellerAccountId: sellerB }));
  await prisma.amazonRoleDataAccessGrant.delete({ where: { id: roleGrant.id } });
});
test("admin cannot cross organizations or mint implicit MCP superuser", async () => {
  await assert.rejects(() => amazonDataAccess(other, owner));
  await assert.rejects(() => manageMcpCredential(scope, owner, { action: "create", name: "bad", scopes: [{ sellerAccountId: sellerB, marketplaceIds: [site] }], tools, expiresAt: new Date(Date.now() + 86400000).toISOString() }));
});
test("unverified identity and invalid published head fail closed", async () => {
  const identity = await prisma.amazonSellerIdentity.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA } });
  await prisma.amazonSpApiAuthorization.update({ where: { id: identity.authorizationId }, data: { identityVerifiedAt: null } });
  await assert.rejects(() => call("amazon.inventory.list"));
  await prisma.amazonSpApiAuthorization.update({ where: { id: identity.authorizationId }, data: { identityVerifiedAt: new Date() } });
  await prisma.amazonSyncRun.update({ where: { id: runA }, data: { status: "FAILED" } });
  assert.equal((await call("amazon.inventory.list") as { rows: unknown[] }).rows.length, 0);
  await prisma.amazonSyncRun.update({ where: { id: runA }, data: { status: "SUCCEEDED" } });
  const original = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: runA } });
  try {
    for (const patch of [{ finishedAt: null }, { stage: "PURGED", finishedAt: original.finishedAt }]) {
      await prisma.amazonSyncRun.update({ where: { id: runA }, data: patch });
      assert.equal((await call("amazon.inventory.list") as { rows: unknown[] }).rows.length, 0);
      assert.equal((await call("amazon.inventory.summary") as { summary: { _count: { _all: number } } }).summary._count._all, 0);
      assert.equal((await publishedSnapshotScopes(scope, "inventory", actor)).length, 0);
    }
  } finally {
    await prisma.amazonSyncRun.update({ where: { id: runA }, data: { finishedAt: original.finishedAt, stage: original.stage } });
  }
});
test("no permission cache crosses two operator credentials", async () => {
  const made = await manageMcpCredential(scope, peer, { action: "create", name: "peer", scopes: [{ sellerAccountId: sellerB, marketplaceIds: [site] }], tools: ["amazon.inventory.list"], expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const b = await call("amazon.inventory.list", {}, made.token!); assert.ok(JSON.stringify(b).includes(sellerB)); assert.ok(!JSON.stringify(b).includes(sellerA));
  const a = await call("amazon.inventory.list"); assert.ok(!JSON.stringify(a).includes(sellerB));
});
test("real JSON-RPC Route authenticates bearer, rejects origin and hides failures", async () => {
  const request = (authorization: string, origin?: string) => new Request("http://localhost/api/mcp/amazon", { method: "POST", headers: { authorization, "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const listed = await POST(request(`Bearer ${token}`)); assert.equal(listed.status, 200);
  const body = await listed.json() as { result: { tools: Array<{ name: string; inputSchema: { anyOf?: Array<{ required: string[] }> } }> } };
  assert.ok(body.result.tools.some(tool => tool.name === "data_query" && tool.inputSchema.anyOf?.some(option => option.required.includes("table"))));
  const unavailable = await POST(new Request("http://localhost/api/mcp/amazon", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "data_query", arguments: { table: "sales_traffic_asin" } } }) }));
  assert.equal(unavailable.status, 409);
  assert.equal((await unavailable.json() as { error: { code: string } }).error.code, "SCHEMA_UNVERIFIED");
  assert.equal((await POST(request("Bearer invalid"))).status, 401);
  assert.equal((await POST(request(`Bearer ${token}`, "https://evil.invalid"))).status, 403);
});

test("cookie-free MCP discovery and database reads traverse middleware without weakening bearer auth", async () => {
  const request = async (method: string, params: Record<string, unknown> = {}, bearer = token) => {
    const input = new NextRequest("http://localhost/api/mcp/amazon", {
      method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const gate = await middleware(input);
    assert.equal(gate.headers.get("x-middleware-next"), "1");
    return POST(input);
  };
  assert.equal((await request("initialize", { protocolVersion: "2025-06-18" })).status, 200);
  const catalog = await (await request("tools/list")).json();
  assert.ok(catalog.result.tools.some((entry: { name: string }) => entry.name === "amazon.inventory.list"));
  const response = await request("tools/call", { name: "amazon.inventory.list", arguments: { sellerAccountId: sellerA, marketplaceId: site } });
  assert.equal(response.status, 200);
  const output = JSON.parse((await response.json()).result.content[0].text);
  assert.ok(output.rows.length > 0);
  assert.ok(output.rows.every((row: { sellerAccountId: string; marketplaceId: string }) => row.sellerAccountId === sellerA && row.marketplaceId === site));
  assert.equal((await request("tools/list", {}, "invalid")).status, 401);
  assert.equal((await request("tools/call", { name: "amazon.inventory.list", arguments: {} }, "invalid")).status, 401);
});

test("disabled ERP users, inactive sellers and disconnected SP-API authorization cannot reuse an MCP identity", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA } });
  const authorization = await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: source.authorizationId } });
  try {
    await prisma.user.update({ where: { id: actor }, data: { status: "disabled" } });
    await assert.rejects(() => authenticateAmazonMcp(`Bearer ${token}`));
    await assert.rejects(() => invokeAmazonMcp(identity, "amazon.inventory.list", {}));
    await prisma.user.update({ where: { id: actor }, data: { status: "active" } });
    await prisma.sellerAccount.update({ where: { id: sellerA }, data: { status: "inactive" } });
    assert.deepEqual(await listDiscoverableAmazonMcpTools(identity), []);
    await assert.rejects(() => invokeAmazonMcp(identity, "amazon.inventory.list", {}));
    await prisma.sellerAccount.update({ where: { id: sellerA }, data: { status: "active" } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: authorization.id }, data: { status: "NOT_CONFIGURED" } });
    assert.deepEqual(await listDiscoverableAmazonMcpTools(identity), []);
    await assert.rejects(() => invokeAmazonMcp(identity, "amazon.inventory.list", {}));
  } finally {
    await prisma.user.update({ where: { id: actor }, data: { status: "active" } });
    await prisma.sellerAccount.update({ where: { id: sellerA }, data: { status: "active" } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: authorization.id }, data: { status: authorization.status } });
  }
});
test("dataset errors preserve legacy codes while distinguishing unpublished, unverified and invalid queries", async () => {
  const request = (args: Record<string, unknown>) => new Request("http://localhost/api/mcp/amazon", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "data_query", arguments: args } }),
  });
  const invalid = await (await POST(request({ table: "inventory", sellerSku: "PRIVATE_FIXTURE", filters: { sellerSku: "OTHER" } }))).json();
  assert.equal(invalid.error.data.businessCode, "FILTER_CONFLICT");
  assert.equal(invalid.error.code, -32602);
  assert.ok(invalid.error.data.requestId);
  assert.ok(!JSON.stringify(invalid).includes("PRIVATE_FIXTURE"));
  const unverified = await (await POST(request({ table: "sales_traffic_asin" }))).json();
  assert.equal(unverified.error.code, "SCHEMA_UNVERIFIED");
  assert.equal(unverified.error.data.businessCode, "SCHEMA_UNVERIFIED");
  try {
    await prisma.amazonSyncRun.update({ where: { id: runA }, data: { status: "FAILED" } });
    const response = await POST(request({ module: "amazon_sync", dataType: "inventory" }));
    const unpublished = await response.json();
    assert.equal(response.status, 403);
    assert.equal(unpublished.error.code, "TABLE_NOT_ALLOWED");
    assert.equal(unpublished.error.data.businessCode, "DATASET_UNPUBLISHED");
    assert.equal(unpublished.error.data.dataAvailability, "NO_PUBLISHED_SOURCE");
  } finally { await prisma.amazonSyncRun.update({ where: { id: runA }, data: { status: "SUCCEEDED" } }); }
});
test("MCP audit captures safe Gateway classification, version, duration and supports failure filtering", async () => {
  const request = new Request("http://localhost/api/mcp/amazon", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "amazon.inventory.list", arguments: { filters: {} } } }) });
  const response = await POST(request);
  assert.equal(response.status, 400);
  const failure = await response.json();
  assert.equal(failure.error.data.businessCode, "INVALID_INPUT");
  await call("amazon.inventory.list");
  const rejected = await getMcpSettingsSnapshot(scope, actor, { callLogFailureClass: "SCHEMA_VALIDATION", callLogTool: "amazon.inventory.list" });
  const rejectedLog = rejected.callLogs[0] as Record<string, unknown>;
  assert.equal(rejected.callLogs.length, 1);
  assert.equal(rejectedLog.failureClass, "SCHEMA_VALIDATION");
  assert.equal(rejectedLog.toolVersion, "1.0.0");
  assert.equal(rejectedLog.gatewayStatus, "FAILED");
  assert.ok(typeof rejectedLog.durationMs === "number");
  const succeeded = await getMcpSettingsSnapshot(scope, actor, { callLogStatus: "SUCCEEDED", callLogTool: "amazon.inventory.list" });
  const succeededLog = succeeded.callLogs[0] as Record<string, unknown>;
  assert.equal(succeededLog.gatewayStatus, "SUCCEEDED");
  assert.equal(succeededLog.failureClass, null);
  assert.ok(typeof succeededLog.durationMs === "number");
  assert.ok(!JSON.stringify([rejected.callLogs, succeeded.callLogs]).includes(token));
});
test("discovery refreshes action grants, personal tool scope and seller/site pairs", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  const names = async () => (await listDiscoverableAmazonMcpTools(identity, "2025-06-18")).map(tool => tool.name);
  const credential = await prisma.amazonMcpCredential.findUniqueOrThrow({ where: { id: credentialId } });
  const grant = await prisma.amazonDataAccessGrant.findUniqueOrThrow({ where: { id: grantId } });
  try {
    const original = await names();
    assert.ok(original.includes("data_query"));
    assert.ok(original.includes("amazon.sales.export"));
    assert.ok(!original.includes("data_sync_start"));
    assert.ok(!original.includes("amazon.ads.reports.list"));
    await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { actions: ["view", "sync"] } });
    const withSync = await names();
    assert.ok(withSync.includes("data_sync_start"));
    assert.ok(!withSync.includes("amazon.sales.export"));
    await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { tools: ["data_query"] } });
    assert.deepEqual(await names(), ["data_query"]);
    await assert.rejects(() => invokeAmazonMcp(identity, "amazon.inventory.list", {}), /不可访问/);
    await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { scopes: [{ sellerAccountId: sellerA, marketplaceIds: [ca] }] } });
    assert.deepEqual(await names(), []);
    await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { tools: credential.tools, scopes: credential.scopes! } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { mcpEnabled: false } });
    assert.deepEqual(await names(), []);
    await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { status: "REVOKED" } });
    await assert.rejects(names, /不可访问/);
  } finally {
    await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { tools: credential.tools, scopes: credential.scopes!, status: credential.status } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { actions: grant.actions, mcpEnabled: grant.mcpEnabled } });
  }
});
test("newer protocol adds versioned object outputs while preserving legacy text and array contracts", async () => {
  const request = (method: string, params = {}) => new Request("http://localhost/api/mcp/amazon", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const listed = await (await POST(request("tools/list"))).json();
  const query = listed.result.tools.find((tool: { name: string }) => tool.name === "data_query");
  assert.equal(query._meta["erp/toolVersion"], "1.1.0");
  assert.equal(query._meta["erp/dataAvailability"], "NOT_CHECKED");
  assert.equal(query.outputSchema.type, "object");
  assert.equal(listed.result.tools.find((tool: { name: string }) => tool.name === "amazon.stores.list").outputSchema, undefined);
  const response = await (await POST(request("tools/call", { name: "data_query", arguments: { table: "inventory" } }))).json();
  assert.deepEqual(response.result.structuredContent, JSON.parse(response.result.content[0].text));
  const array = await (await POST(request("tools/call", { name: "amazon.stores.list" }))).json();
  assert.ok(Array.isArray(JSON.parse(array.result.content[0].text)));
  assert.equal(array.result.structuredContent, undefined);
});
test("discovery withholds capabilities when grants or credentials are revoked during source SQL", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  for (const target of ["grant", "credential"]) {
    let release = () => {}, acquired = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const lock = prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('LOCK TABLE "AmazonSyncDataSource" IN ACCESS EXCLUSIVE MODE');
      acquired(); await gate;
    }, { timeout: 10000 });
    await ready;
    const pending = listDiscoverableAmazonMcpTools(identity).then(value => ({ value, error: null }), error => ({ value: null, error }));
    try {
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%AmazonSyncDataSource%' AND query LIKE 'SELECT%') AS waiting`;
          if (rows[0].waiting) { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(waiting, "discovery must reach the disposable source-table lock");
        if (target === "grant") await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: false } });
        else await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { status: "REVOKED" } });
      } finally { release(); await lock; }
      const result = await pending;
      if (target === "grant") assert.deepEqual(result.value, []);
      else { assert.ok(result.error); assert.equal(result.value, null); }
    } finally {
      await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: true } });
      await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { status: "ACTIVE" } });
    }
  }
});
test("discovery records an isolated serial latency sample without weakening authorization", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  const samples: number[] = [];
  const legacySamples: number[] = [];
  await listDiscoverableAmazonMcpTools(identity);
  for (let index = 0; index < 20; index++) {
    const beforeLegacy = performance.now();
    tools.filter(name => identity.tools.includes(name));
    legacySamples.push(performance.now() - beforeLegacy);
    const start = performance.now();
    const result = await listDiscoverableAmazonMcpTools(identity);
    samples.push(performance.now() - start);
    assert.ok(!result.some(tool => tool.name === "data_sync_start"));
  }
  const percentiles = (values: number[]) => {
    values.sort((a, b) => a - b);
    return Object.fromEntries([50, 95, 99].map(percentile => [`p${percentile}Ms`, Number(values[Math.ceil(values.length * percentile / 100) - 1].toFixed(3))]));
  };
  console.log("MCP_DISCOVERY_FIXTURE_BENCHMARK", JSON.stringify({ samples: samples.length, concurrency: 1, toolCount: tools.length, legacyFilterOnly: percentiles(legacySamples), liveDiscoveryOnly: percentiles(samples), authenticationAndProtocolAuditIncluded: false, sqlCount: "not_instrumented", productionBenchmark: false }));
});
test("rotation, disable and expiry reject former credentials; audit excludes secrets", async () => {
  const old = await prisma.amazonMcpCredential.findUniqueOrThrow({ where: { id: credentialId } });
  const rotated = await manageMcpCredential(scope, actor, { action: "rotate", id: old.id, revision: old.revision });
  await assert.rejects(() => authenticateAmazonMcp(`Bearer ${token}`));
  token = rotated.token!; credentialId = rotated.credential.id;
  await manageMcpCredential(scope, actor, { action: "disable", id: credentialId, revision: rotated.credential.revision });
  await assert.rejects(() => authenticateAmazonMcp(`Bearer ${token}`));
  await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { status: "ACTIVE", expiresAt: new Date(0) } });
  await assert.rejects(() => authenticateAmazonMcp(`Bearer ${token}`));
  const logs = await prisma.auditLog.findMany({ where: { organizationId: scope.organizationId } });
  assert.ok(logs.some(l => l.action === "amazon.mcp.tool.denied")); assert.ok(!JSON.stringify(logs).includes(token));
});
test("OAuth state is actor-bound, single-use and expires before any external call", async () => {
  Object.assign(process.env, { AMAZON_SP_API_APPLICATION_ID: "fixture", AMAZON_SP_API_LWA_CLIENT_ID: "fixture", AMAZON_SP_API_LWA_CLIENT_SECRET: "fixture", AMAZON_SP_API_OAUTH_REDIRECT_URI: "http://localhost/api/integrations/amazon/sp-api/oauth/callback" });
  const started = await startAmazonOAuth(scope, owner, "us-east-1");
  const state = new URL(started.consentUrl).searchParams.get("state")!;
  await assert.rejects(() => finishAmazonOAuth(actor, new URLSearchParams({ state })), /会话无效/);
  await assert.rejects(() => finishAmazonOAuth(owner, new URLSearchParams({ state, error: "access_denied" })));
  await assert.rejects(() => finishAmazonOAuth(owner, new URLSearchParams({ state })), /会话无效/);
});
test("OAuth happy path uses real client with mocked official HTTP, is idempotent and preserves ERP names", async () => {
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  let sellerId = "OAUTHSELLER123";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.amazon.com/auth/o2/token") {
      const grant = new URLSearchParams(String(init?.body)).get("grant_type");
      return Response.json(grant === "authorization_code" ? { refresh_token: "fixture-refresh-only" } : { access_token: "fixture-access-only", expires_in: 3600 });
    }
    if (url.startsWith("https://sellingpartnerapi-na.amazon.com/sellers/v1/marketplaceParticipations")) return Response.json({ payload: [{ marketplace: { id: site, countryCode: "US" }, participation: { isParticipating: true } }] });
    if (url.startsWith(`https://sellingpartnerapi-na.amazon.com/listings/2021-08-01/items/${sellerId}?`)) return Response.json({ items: [] });
    throw new Error("Unexpected external URL blocked");
  };
  async function authorize() { const start = await startAmazonOAuth(scope, owner, "us-east-1"); return finishAmazonOAuth(owner, new URLSearchParams({ state: new URL(start.consentUrl).searchParams.get("state")!, selling_partner_id: sellerId, spapi_oauth_code: "fixture-code" })); }
  const first = await authorize();
  const identity = await prisma.amazonSellerIdentity.findFirstOrThrow({ where: { ...scope, amazonSellerId: sellerId } });
  await prisma.sellerAccount.update({ where: { id: identity.sellerAccountId }, data: { displayName: "User custom name" } });
  const second = await authorize(); assert.equal(first.authorizationId, second.authorizationId);
  assert.equal(await prisma.amazonSellerIdentity.count({ where: { ...scope, amazonSellerId: sellerId } }), 1);
  assert.equal((await prisma.sellerAccount.findUniqueOrThrow({ where: { id: identity.sellerAccountId } })).displayName, "User custom name");
  const old = await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: first.authorizationId } });
  assert.ok(old.identityVerifiedAt); assert.ok(!old.credentialsCiphertext.includes("fixture-refresh-only"));
  sellerId = "TAMPEREDSELLER";
  globalThis.fetch = async input => String(input) === "https://api.amazon.com/auth/o2/token" ? Response.json({ refresh_token: "fixture" }) : Response.json({ errors: [{ code: "Unauthorized" }] }, { status: 403 });
  await assert.rejects(authorize);
  assert.equal((await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: first.authorizationId } })).credentialsCiphertext, old.credentialsCiphertext);
  globalThis.fetch = async () => { throw new Error("External HTTP forbidden"); };
});

test("store rename keeps immutable identity, checks CAS and records audit", async () => {
  const before = await prisma.sellerAccount.findUniqueOrThrow({ where: { id: sellerA } });
  const identities = await prisma.amazonSellerIdentity.findMany({ where: { ...scope, sellerAccountId: sellerA } });
  await renameAmazonStore(scope, owner, { id: sellerA, updatedAt: before.updatedAt.toISOString(), displayName: "Renamed ERP store" });
  assert.deepEqual(await prisma.amazonSellerIdentity.findMany({ where: { ...scope, sellerAccountId: sellerA } }), identities);
  await assert.rejects(() => renameAmazonStore(scope, owner, { id: sellerA, updatedAt: before.updatedAt.toISOString(), displayName: "stale" }));
  await assert.rejects(() => listAmazonStores(other, owner));
  assert.equal(await prisma.auditLog.count({ where: { entityId: sellerA, action: "amazon.store.renamed" } }), 1);
});
test("read-only lineage report identifies legacy orphan without guessing SKU ownership", async () => {
  const runId = randomUUID();
  await prisma.amazonSyncRun.create({ data: { ...scope, id: runId, requestedByUserId: owner, resource: "inventory", status: "SUCCEEDED" } });
  await prisma.amazonInventorySnapshot.create({ data: { ...scope, id: randomUUID(), syncRunId: runId, sellerSku: "SAME-SKU", marketplaceId: site, fulfillableQuantity: 777, capturedAt: new Date() } });
  const report = await prisma.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; return auditAmazonLineage(tx, scope); });
  assert.equal(report.counts.MISSING_LINEAGE, 1); assert.ok(report.pendingReview.every(r => r.referenceHash.length === 64));
  assert.ok(!JSON.stringify(report).includes("SAME-SKU"));
});
test("lineage audit and historical reads reject mismatched and unfinished runs", async () => {
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA, resource: "inventory" } });
  for (const patch of [{ resource: "catalog" }, { status: "FAILED" }, { finishedAt: null }, { stage: "PURGED" }]) {
    const runId = randomUUID(), rowId = randomUUID();
    await prisma.amazonSyncRun.create({ data: { ...scope, id: runId, sourceId: source.id, requestedByUserId: owner, resource: "inventory", executionVersion: 2, status: "SUCCEEDED", finishedAt: new Date(), ...patch } });
    await prisma.amazonInventorySnapshot.create({ data: { ...scope, id: rowId, sellerAccountId: sellerA, marketplaceId: site, syncRunId: runId, sellerSku: "CORRUPT-LINEAGE", capturedAt: new Date() } });
    try {
      await assert.rejects(() => readTaskSnapshot(scope, new URLSearchParams({ id: runId }), actor));
      const report = await prisma.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`; return auditAmazonLineage(tx, scope); });
      assert.equal(report.counts.UNPUBLISHED_OR_MISMATCHED_RUN, 1);
    } finally {
      await prisma.amazonInventorySnapshot.delete({ where: { id: rowId } });
      await prisma.amazonSyncRun.delete({ where: { id: runId } });
    }
  }
});
test("async export creation scope rejects revoked site at execution/download boundary", async () => {
  process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify([[scope.organizationId, scope.workspaceId]]);
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA, resource: "sales_traffic" } });
  const frozen = { _scopeSourceIds: [source.id], _scopeSellerIds: [sellerA], _scopeAll: false };
  await assertExportJobAccess(prisma, scope, actor, frozen);
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { marketplaceIds: [ca] } });
  await assert.rejects(() => assertExportJobAccess(prisma, scope, actor, frozen));
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { marketplaceIds: [site] } });
});

test("user and role grants support independent and admin self approval before application", async () => {
  const approver = randomUUID();
  await prisma.user.create({ data: { id: approver, name: "Approver", email: `${approver}@fixture.invalid`, passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  for (const subject of [{ userId: actor, revision: (await prisma.amazonDataAccessGrant.findUniqueOrThrow({ where: { id: grantId } })).revision }, { roleId: "operations", revision: 0 }]) {
    const change = await requestChange(scope, owner, { action: "save-access-grant", ...subject, sellerAccountId: sellerA, actions: ["view"], marketplaceIds: [site], mcpEnabled: false, enabled: true });
    const id = String(change.id);
    await decideChange(scope, "roleId" in subject ? owner : approver, id, "APPROVED", "Fixture explicit confirmation");
    await applyChange(scope, owner, id);
    assert.equal((await prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id } })).status, "APPLIED");
  }
  assert.equal((await prisma.amazonDataAccessGrant.findUniqueOrThrow({ where: { id: grantId } })).mcpEnabled, false);
});
test("MCP response is withheld when ERP access is revoked while the actual snapshot SQL waits", async () => {
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { mcpEnabled: true, actions: ["view", "export"] } });
  const made = await manageMcpCredential(scope, actor, { action: "create", name: "inflight", scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], tools: ["amazon.inventory.list"], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp(`Bearer ${made.token}`);
  let release = () => {}, acquired = () => {};
  const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { acquired = r; });
  const lock = prisma.$transaction(async tx => { await tx.$executeRawUnsafe('LOCK TABLE "AmazonInventorySnapshot" IN ACCESS EXCLUSIVE MODE'); acquired(); await gate; }, { timeout: 10000 });
  await ready;
  const pending = invokeAmazonMcp(identity, "amazon.inventory.list", {}).then(value => ({ value, error: null }), error => ({ value: null, error }));
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%AmazonInventorySnapshot%' AND query LIKE 'SELECT%') AS waiting`;
      if (rows[0].waiting) { waiting = true; break; }
      await new Promise(r => setTimeout(r, 10));
    }
    assert.ok(waiting, "the real snapshot SQL must reach the held PostgreSQL table lock");
    await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: false } });
  } finally { release(); await lock; }
  const result = await pending; assert.ok(result.error); assert.equal(result.value, null);
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: true } });
});

test("MCP response is withheld when a source binding revision changes during snapshot SQL", async () => {
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA, resource: "inventory" } });
  const fresh = await manageMcpCredential(scope, actor, { action: "create", name: "binding race", scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], tools: ["amazon.inventory.list"], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp(`Bearer ${fresh.token}`);
  let release = () => {}, acquired = () => {};
  const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { acquired = r; });
  const lock = prisma.$transaction(async tx => { await tx.$executeRawUnsafe('LOCK TABLE "AmazonInventorySnapshot" IN ACCESS EXCLUSIVE MODE'); acquired(); await gate; }, { timeout: 10000 });
  await ready;
  const pending = invokeAmazonMcp(identity, "amazon.inventory.list", {}).then(value => ({ value, error: null }), error => ({ value: null, error }));
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%AmazonInventorySnapshot%' AND query LIKE 'SELECT%') AS waiting`;
      if (rows[0].waiting) { waiting = true; break; }
      await new Promise(r => setTimeout(r, 10));
    }
    assert.ok(waiting, "snapshot SQL should wait on the disposable fixture lock");
    await prisma.amazonSyncDataSource.update({ where: { id: source.id }, data: { revision: { increment: 1 } } });
  } finally { release(); await lock; }
  const result = await pending; assert.ok(result.error); assert.equal(result.value, null);
});

test("source preview refuses mixed authorization domains and another seller's verified identity", async () => {
  const a = await prisma.amazonSellerIdentity.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA } });
  const b = await prisma.amazonSellerIdentity.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerB } });
  await assert.rejects(() => requestChange(scope, owner, { action: "save-source", authorizationId: b.authorizationId, sellerAccountId: sellerA, marketplaceId: site, resource: "catalog", enabled: true }), /绑定冲突/);
  const freshSeller = randomUUID(); await prisma.sellerAccount.create({ data: { ...scope, id: freshSeller, accountKey: freshSeller, displayName: "Unrelated ERP", marketplaceCode: "US" } });
  await assert.rejects(() => requestChange(scope, owner, { action: "save-source", authorizationId: a.authorizationId, sellerAccountId: freshSeller, marketplaceId: site, resource: "catalog", enabled: true }), /绑定冲突/);
});

test("bounded management routes preserve real session identity and workspace checks", async () => {
  async function request(userId: string, path: string, method: string, body: object) {
    const session = await createSession(userId);
    return new Request(`http://localhost${path}`, { method, headers: { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}`, "x-workspace-id": scope.workspaceId, "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });
  }
  const issued = await credentialPost(await request(actor, "/api/operations/amazon-mcp", "POST", { action: "create", name: "Bounded route", tools: ["amazon.inventory.list"], scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 60000).toISOString() }));
  assert.equal(issued.status, 200);
  const payload = await issued.json();
  const credential = await prisma.amazonMcpCredential.findUniqueOrThrow({ where: { id: payload.credential.id } });
  assert.equal(credential.userId, actor); assert.equal(credential.workspaceId, scope.workspaceId);
  const store = await prisma.sellerAccount.findUniqueOrThrow({ where: { id: sellerA } });
  const body = { id: sellerA, updatedAt: store.updatedAt.toISOString(), displayName: "Route validated rename" };
  assert.equal((await storePatch(await request(actor, "/api/operations/amazon-stores", "PATCH", body))).status, 403);
  assert.equal((await storePatch(await request(owner, "/api/operations/amazon-stores", "PATCH", body))).status, 200);
  const start = await oauthStart(await request(owner, "/api/integrations/amazon/sp-api/oauth/start", "POST", { region: "us-east-1" }));
  assert.equal(start.status, 200); assert.equal(new URL((await start.json()).consentUrl).hostname, "sellercentral.amazon.com");
});

test("Lili pairing is single-use, bounded, isolated, expiring and immediately revocable on PostgreSQL", async () => {
 const { createPairing, exchangePairing, revokeDevice } = await import("@/lib/lili/device-pairing");
 const role = await prisma.organizationRosterRole.findUniqueOrThrow({ where: { organizationId_id: { organizationId: scope.organizationId, id: "operations" } } });
 await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "operations" } }, data: { permissions: { ...(role.permissions as Prisma.InputJsonObject), settings: ["view", "edit"] } } });
 try {
  const parent = await manageMcpCredential(scope, actor, { action: "create", name: "Lili fixture parent", tools: ["amazon.stores.list", "data_query"], scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 60000).toISOString() });
  await assert.rejects(createPairing(scope, peer, parent.credential.id));
  const pair = await createPairing(scope, actor, parent.credential.id);
  const stored = await prisma.amazonMcpCredential.findUniqueOrThrow({ where: { id: pair.pairingId } });
  assert.notEqual(stored.tokenHash, pair.code); assert.equal(stored.tokenHash.length, 64); assert.equal(stored.status, "DISABLED");
  await assert.rejects(authenticateAmazonMcp("Bearer " + pair.code));
  const results = await Promise.allSettled([exchangePairing(pair.pairingId, pair.code, "fixture-device"), exchangePairing(pair.pairingId, pair.code, "replay")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const success = results.find(r => r.status === "fulfilled"); assert.ok(success?.status === "fulfilled");
  const device = success.value;
  const identity = await authenticateAmazonMcp("Bearer " + device.access_token);
  assert.deepEqual(identity.tools, parent.credential.tools);
  assert.equal(identity.userId, actor); assert.equal(identity.organizationId, scope.organizationId);
  await assert.rejects(invokeAmazonMcp(identity, "data_query", { table: "inventory", sellerAccountId: sellerB, marketplaceId: site }));
  await assert.rejects(invokeAmazonMcp(identity, "data_sync_start", { resource: "inventory" }));
  await assert.rejects(revokeDevice(scope, peer, device.device.id));
  await revokeDevice(scope, actor, device.device.id);
  await assert.rejects(authenticateAmazonMcp("Bearer " + device.access_token));
  const expiring = await createPairing(scope, actor, parent.credential.id);
  await prisma.amazonMcpCredential.update({ where: { id: expiring.pairingId }, data: { expiresAt: new Date(0) } });
  await assert.rejects(exchangePairing(expiring.pairingId, expiring.code, "expired"));
  const locked = await createPairing(scope, actor, parent.credential.id);
  for(let i=0;i<5;i++) await assert.rejects(exchangePairing(locked.pairingId, "A".repeat(43), "wrong"));
  await assert.rejects(exchangePairing(locked.pairingId, locked.code, "locked"));
  assert.equal((await prisma.amazonMcpCredential.findUniqueOrThrow({ where: { id: locked.pairingId } })).status, "REVOKED");
  const cancelled = await createPairing(scope, actor, parent.credential.id);
  await revokeDevice(scope, actor, cancelled.pairingId);
  await assert.rejects(exchangePairing(cancelled.pairingId, cancelled.code, "cancelled"));
  const second = await createPairing(scope, actor, parent.credential.id);
  const child = await exchangePairing(second.pairingId, second.code, "parent-revoke");
  const childIdentity = await authenticateAmazonMcp("Bearer " + child.access_token);
  await manageMcpCredential(scope, actor, { action: "revoke", id: parent.credential.id, revision: parent.credential.revision });
  await assert.rejects(authenticateAmazonMcp("Bearer " + child.access_token));
  await assert.rejects(invokeAmazonMcp(childIdentity, "data_query", { table: "inventory", sellerAccountId: sellerA, marketplaceId: site }));
 } finally { await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "operations" } }, data: { permissions: role.permissions as Prisma.InputJsonObject } }); }
});

test("Lili OAuth S256 binds redirect/client/resource, rotates refresh and rejects replay with live grants", async () => {
 const { createHash } = await import("node:crypto");
 const { createPairing, revokeDevice } = await import("@/lib/lili/device-pairing");
 const { registerLiliClient, authorizeLili, exchangeLiliToken, revokeLiliToken } = await import("@/lib/lili/oauth");
 const roleKey = { organizationId_id: { organizationId: scope.organizationId, id: "operations" } };
 const role = await prisma.organizationRosterRole.findUniqueOrThrow({ where: roleKey });
 await prisma.organizationRosterRole.update({ where: roleKey, data: { permissions: { ...(role.permissions as Prisma.InputJsonObject), settings: ["view", "edit"] } } });
 try {
  const request = new Request("http://localhost:3017/api/lili/oauth/token");
  const client = await registerLiliClient({ redirect_uris: ["http://127.0.0.1:1455/callback"] });
  await assert.rejects(registerLiliClient({ redirect_uris: ["http://evil.example/callback"] }));
  const parent = await manageMcpCredential(scope, actor, { action: "create", name: "OAuth fixture parent", tools: ["amazon.stores.list", "data_query"], scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const verifier = "v".repeat(64);
  const authorization = new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: "code", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), resource: "http://localhost:3017/api/lili/mcp", state: "unchanged-state" });
  const issue = async () => {
    const pair = await createPairing(scope, actor, parent.credential.id);
    const location = new URL(await authorizeLili(authorization, request, pair.pairingId, pair.code));
    assert.equal(location.searchParams.get("state"), "unchanged-state");
    const form = new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: client.redirect_uris[0], code: location.searchParams.get("code")!, code_verifier: verifier });
    const wrong = new URLSearchParams(form); wrong.set("code_verifier", "x".repeat(64)); await assert.rejects(exchangeLiliToken(wrong, request));
    const otherClient = new URLSearchParams(form); otherClient.set("client_id", randomUUID()); await assert.rejects(exchangeLiliToken(otherClient, request));
    const wrongResource = new URLSearchParams(form); wrongResource.set("resource", "http://localhost:3017/other"); await assert.rejects(exchangeLiliToken(wrongResource, request));
    const wrongRedirect = new URLSearchParams(form); wrongRedirect.set("redirect_uri", "http://127.0.0.1:1456/callback"); await assert.rejects(exchangeLiliToken(wrongRedirect, request));
    const issued = await exchangeLiliToken(form, request);
    await assert.rejects(exchangeLiliToken(form, request));
    return issued;
  };
  const issued = await issue();
  const identity = await authenticateAmazonMcp("Bearer " + issued.access_token);
  assert.equal(identity.userId, actor);
  await assert.rejects(authenticateAmazonMcp("Bearer " + issued.access_token, "http://localhost:3017/api/mcp/amazon"));
  await assert.rejects(invokeAmazonMcp(identity, "data_query", { table: "inventory", sellerAccountId: sellerB, marketplaceId: site }));
  await assert.rejects(invokeAmazonMcp(identity, "data_sync_start", {}));
  await prisma.amazonMcpCredential.update({ where: { id: identity.id }, data: { expiresAt: new Date(0) } });
  await assert.rejects(authenticateAmazonMcp("Bearer " + issued.access_token));
  const refreshForm = new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: issued.refresh_token });
  const refreshed = await exchangeLiliToken(refreshForm, request);
  assert.equal((await authenticateAmazonMcp("Bearer " + refreshed.access_token)).id, identity.id);
  await assert.rejects(exchangeLiliToken(refreshForm, request));
  await assert.rejects(authenticateAmazonMcp("Bearer " + refreshed.access_token));
  const revoked = await issue();
  await revokeLiliToken(new URLSearchParams({ token: revoked.refresh_token, client_id: client.client_id }));
  await assert.rejects(authenticateAmazonMcp("Bearer " + revoked.access_token));
  const deviceRevoked = await issue();
  const device = await authenticateAmazonMcp("Bearer " + deviceRevoked.access_token);
  await revokeDevice(scope, actor, device.id);
  await assert.rejects(exchangeLiliToken(new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: deviceRevoked.refresh_token }), request));
  const parentRevoked = await issue();
  await prisma.amazonMcpCredential.update({ where: { id: parent.credential.id }, data: { status: "REVOKED" } });
  await assert.rejects(exchangeLiliToken(new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: parentRevoked.refresh_token }), request));
 } finally { await prisma.organizationRosterRole.update({ where: roleKey, data: { permissions: role.permissions as Prisma.InputJsonObject } }); }
});

test("Lili market access reflects real PostgreSQL credential grants and disabled providers without external dispatch", async () => {
 const { researchBearerDependencies } = await import("@/lib/lili/research-bearer-server");
 const roleKey = { organizationId_id: { organizationId: scope.organizationId, id: "operations" } };
 const role = await prisma.organizationRosterRole.findUniqueOrThrow({ where: roleKey });
 await prisma.organizationRosterRole.update({ where: roleKey, data: { permissions: { ...(role.permissions as Prisma.InputJsonObject), agents: ["view", "edit"] } } });
 try {
  const request = new Request("http://localhost/api/lili/mcp");
  const read = await manageMcpCredential(scope, actor, { action: "create", name: "market metadata read only", tools: ["data_query"], scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const readIdentity = await authenticateAmazonMcp("Bearer " + read.token);
  assert.equal((await researchBearerDependencies.marketAccess!(readIdentity, request)).research_access, false);
  const granted = await manageMcpCredential(scope, actor, { action: "create", name: "market metadata research", tools: ["data_query", "research_step"], scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp("Bearer " + granted.token);
  const result = await researchBearerDependencies.marketAccess!(identity, request);
  assert.equal(result.research_access, false); assert.equal(result.direct_market_access, false);
  assert.equal(result.registry_checked, false); assert.deepEqual(result.paid_tools, []);
  assert.ok(Array.isArray(result.providers) && result.providers.every(p => typeof p === "object" && p !== null && !Array.isArray(p) && p.allowed === false));
  assert.ok(!JSON.stringify(result).includes("apiKey"));
 } finally { await prisma.organizationRosterRole.update({ where: roleKey, data: { permissions: role.permissions as Prisma.InputJsonObject } }); }
});

test("Lili lifecycle commands persist in AgentExecution and keep ownership and human gates", async () => {
 const roleKey = { organizationId_id: { organizationId: scope.organizationId, id: "operations" } };
 const role = await prisma.organizationRosterRole.findUniqueOrThrow({ where: roleKey });
 await prisma.organizationRosterRole.update({ where: roleKey, data: { permissions: { ...(role.permissions as Prisma.InputJsonObject), agents: ["view", "edit"] } } });
 try {
  const granted = await manageMcpCredential(scope, actor, { action: "create", name: "lifecycle fixture", tools: ["data_query", "research_read", "research_pause", "research_resume", "research_recover", "research_cancel"], scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const now = new Date().toISOString();
  const run: Run = { version: 1, id: randomUUID(), revision: 0, scope: { ...scope, ownerId: actor }, mode: "live", erpCredentialId: granted.credential.id, requirement: "ISOLATED LIFECYCLE FIXTURE", marketplace: "US", createdAt: now, updatedAt: now, status: "WAITING_FOR_USER", stage: 1, skills: [], registry: [], policies: {}, limits: {}, calls: [], actions: [], decisions: [], results: [], gate: { id: randomUUID(), kind: "NICHE", reason: "fixture" } };
  await prismaResearchRepository().create(run);
  const rpc = async (name: string, args = { runId: run.id }) => {
   const response = await handleLiliRequest(new Request("http://localhost/api/lili/mcp", { method: "POST", headers: { authorization: "Bearer " + granted.token, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), ["mcp"]);
   assert.equal(response.status, 200);
   return JSON.parse((await response.json()).result.content[0].text);
  };
  assert.ok((await rpc("research_pause")).run.pausedAt);
  const saved = (await prismaResearchRepository().read(run.id, run.scope)).run;
  assert.ok(saved.pausedAt); assert.equal(saved.gate?.id, run.gate?.id);
  const resumed = await rpc("research_resume");
  assert.equal(resumed.run.pausedAt, undefined); assert.equal(resumed.run.gate.id, run.gate?.id);
  await prisma.agentExecution.update({ where: { id: run.id }, data: { requestedByUserId: peer } });
  assert.equal((await rpc("research_pause")).status, 404);
  await prisma.agentExecution.update({ where: { id: run.id }, data: { requestedByUserId: actor } });
  const persisted = (await prismaResearchRepository().read(run.id, run.scope)).run;
  await prisma.agentExecution.update({ where: { id: run.id }, data: { status: "FAILED", output: JSON.parse(JSON.stringify({ ...persisted, status: "FAILED", failure: "fixture failure" })) } });
  const recovered = await rpc("research_recover");
  assert.equal(recovered.run.status, "RESUMABLE"); assert.equal(recovered.run.calls.length, 0);
  assert.equal((await rpc("research_cancel")).run.status, "CANCELLED");
  assert.equal((await prismaResearchRepository().read(run.id, run.scope)).run.status, "CANCELLED");
 } finally { await prisma.organizationRosterRole.update({ where: roleKey, data: { permissions: role.permissions as Prisma.InputJsonObject } }); }
});

test("Lili history paginates persisted tasks and excludes other owners, credentials and fixture runs", async () => {
 const { listCredentialResearch } = await import("@/lib/selection-research/prisma-repository");
 const { withResearchRequestAuthorization } = await import("@/lib/selection-research/request-authorization");
 const { GET: listRoute } = await import("@/app/api/selection-research/route");
 const ownerScope = { ...scope, ownerId: actor };
 const ids: string[] = [];
 for (const [ownerId, credential, mode] of [[actor, "history-own", "live"], [actor, "history-own", "live"], [peer, "history-own", "live"], [actor, "history-other", "live"], [actor, "history-own", "fixture"]] as const) {
  const now = new Date().toISOString(), id = randomUUID(); ids.push(id);
  await prismaResearchRepository().create({ version: 1, id, revision: 0, scope: { ...scope, ownerId }, mode, erpCredentialId: credential, requirement: "ISOLATED HISTORY FIXTURE", marketplace: "US", createdAt: now, updatedAt: now, status: "CREATED", stage: 1, skills: [], registry: [], policies: {}, limits: {}, calls: [], actions: [], decisions: [], results: [] });
 }
 const page = await listCredentialResearch(ownerScope, "history-own", 1, 1);
 const next = await listCredentialResearch(ownerScope, "history-own", 2, 1);
 assert.equal(page.runs.length, 1); assert.equal(page.hasNext, true);
 assert.equal(next.runs.length, 1); assert.equal(next.hasNext, false);
 assert.deepEqual(new Set([page.runs[0].id, next.runs[0].id]), new Set(ids.slice(0, 2)));
 assert.ok(!("output" in page.runs[0]));
 const user = { id: actor, organizationId: scope.organizationId, organizationName: "fixture", role: "operations", name: "fixture", email: "fixture@invalid.test" };
 const request = new Request("http://localhost/api/selection-research?workspaceId=" + scope.workspaceId + "&pageSize=1");
 const response = await withResearchRequestAuthorization(request, { credentialId: "history-own", authorize: async () => ({ ok: true, user }) }, () => listRoute(request));
 assert.equal(response.status, 200);
 const result = await response.json(); assert.equal(result.persisted, true); assert.equal(result.runs.length, 1);
 assert.equal(result.availability, undefined, "history must not read provider or AI configuration");
});

test("Lili saved evidence reads real PostgreSQL snapshots and enforces owner and credential isolation", async () => {
 const roleKey = { organizationId_id: { organizationId: scope.organizationId, id: "operations" } };
 const role = await prisma.organizationRosterRole.findUniqueOrThrow({ where: roleKey });
 await prisma.organizationRosterRole.update({ where: roleKey, data: { permissions: { ...(role.permissions as Prisma.InputJsonObject), agents: ["view"] } } });
 try {
  const command = { action: "create", name: "evidence fixture", tools: ["data_query", "research_evidence"], scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 60000).toISOString() };
  const grant = await manageMcpCredential(scope, actor, command), alternate = await manageMcpCredential(scope, actor, command);
  const now = new Date().toISOString();
  const run: Run = { version: 1, id: randomUUID(), revision: 0, scope: { ...scope, ownerId: actor }, mode: "live", erpCredentialId: grant.credential.id, requirement: "ISOLATED EVIDENCE FIXTURE", marketplace: "US", createdAt: now, updatedAt: now, status: "CREATED", stage: 1, skills: [], registry: [], policies: {}, limits: {}, calls: [], actions: [], decisions: [], results: [] };
  run.calls.push({ id: "saved-call", projectId: run.id, stage: 1, skill: "fixture", service: "erp", provider: "erp", tool: "data_query", arguments: {}, requestedAt: now, status: "SUCCEEDED", paid: false, reservedUnits: 0, billing: "FREE", retryCount: 0, inputSchema: {}, rawResponse: { fixture: "persisted evidence" } });
  await prismaResearchRepository().create(run);
  const rpc = async (bearer: string, args: Record<string, unknown>) => {
   const response = await handleLiliRequest(new Request("http://localhost/api/lili/mcp", { method: "POST", headers: { authorization: "Bearer " + bearer, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "research_evidence", arguments: { runId: run.id, ...args } } }) }), ["mcp"]);
   assert.equal(response.status, 200);
   return JSON.parse((await response.json()).result.content[0].text);
  };
  const page = await rpc(grant.token!, {}); assert.equal(page.calls[0].id, "saved-call"); assert.equal(page.calls[0].rawResponse, undefined);
  const raw = await rpc(grant.token!, { callId: "saved-call" }); assert.deepEqual(JSON.parse(raw.chunk), { fixture: "persisted evidence" });
  assert.equal((await rpc(alternate.token!, {})).status, 404);
  await prisma.agentExecution.update({ where: { id: run.id }, data: { requestedByUserId: peer } });
  assert.equal((await rpc(grant.token!, {})).status, 404);
 } finally { await prisma.organizationRosterRole.update({ where: roleKey, data: { permissions: role.permissions as Prisma.InputJsonObject } }); }
});
