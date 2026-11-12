import { GET as productCenterRead } from "@/app/api/products/route";
import { readAmazonProductsForSkus } from "@/lib/operations/amazon-products";
import { createServer } from "node:http";
import { GET as replenishmentRead } from "@/app/api/operations/replenishment/route";
import { GET as readinessRead } from "@/app/api/operations/readiness/route";
import { GET as freshnessRead } from "@/app/api/operations/freshness/route";
import { runOpsCommand, parseOpsArgs, assertOpsReadAccess } from "@/lib/operations/cli";
import { GET as legacyInventoryRead } from "@/app/api/operations/inventory/snapshots/route";
import { GET as legacyProductsRead } from "@/app/api/operations/products/route";
import { GET as productImageRead } from "@/app/api/operations/products/images/[fileId]/route";
import { readBrandAnalytics, readBrandAsins, readBrandAsinAnalysis } from "@/lib/amazon-sync/brand-analytics-query";
import { AmazonReadError } from "@/lib/amazon-sync/read-account";
import { GET as exportRead } from "@/app/api/operations/sync-center/exports/route";
import { assertExportJobAccess, processSalesExport } from "@/lib/amazon-sync/exports";
import { getStorageDriver } from "@/lib/storage";
import { Prisma } from "@prisma/client";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { createSession } from "@/lib/auth/session";
import { GET as erpRead, POST as erpSubmit } from "@/app/api/operations/sync-center/route";
import { POST as approvalAction } from "@/app/api/operations/sync-center/approvals/route";
import { POST as cloudExecute } from "@/app/api/internal/amazon/execution/route";
import { createCloudRelayEnvelope, cloudRelaySignature, verifyCloudRelayEnvelope } from "@/lib/amazon/cloud-relay-protocol";
import { GET as adsRead } from "@/app/api/integrations/amazon/ads/data/route";
import { POST as nativeMcp } from "@/app/api/mcp/amazon/route";
import { handleLiliRequest } from "@/lib/lili/api";
import { mcpTokenHash, authenticateAmazonMcp, invokeAmazonMcp, listDiscoverableAmazonMcpTools } from "@/lib/amazon-sync/mcp";
import { readFinance } from "@/lib/amazon-sync/finance-query";
import { createErpResearchTransport, runtimeToolsForUser } from "@/lib/lili/runtime-server";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as liliRoute } from "@/app/api/lili/[...path]/route";
import { hashPassword } from "@/lib/auth/password";
import { createRuntimeTools } from "@/lib/lili/runtime-tools";
import { digest, seal } from "@/lib/amazon-sync/approval-policy";
import { readArchivedBusinessData } from "@/lib/amazon-sync/archive-business-query";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { processAmazonAdsSyncTask } from "@/lib/amazon-ads/sync-processor";
import { tickSyncCenter } from "@/lib/amazon-sync/scheduler";
import { AmazonCloudExecutionError } from "@/lib/amazon/execution-role";
import { publishFinanceReplica } from "@/lib/amazon-sync/finance-replica";
import type { FinanceReplica } from "@/lib/amazon-sync/finance-replica-contract";
import { publishOrderReplica } from "@/lib/amazon-sync/order-replica";
import type { OrderReplica } from "@/lib/amazon-sync/order-replica-contract";
import { publishAdsReportReplica } from "@/lib/amazon-ads/report-replica";
import type { AdsReportReplica } from "@/lib/amazon-ads/report-replica-contract";
import { publishAdsEntityReplica } from "@/lib/amazon-ads/entity-replica";
import type { AdsEntityReplica } from "@/lib/amazon-ads/entity-replica-contract";
import { POST as pullReplica } from "@/app/api/operations/sync-center/replica/route";
import { publishInventoryReplica, publishSnapshotReplica } from "@/lib/amazon-sync/inventory-replica";
import type { InventoryReplica, CatalogReplica } from "@/lib/amazon-sync/inventory-replica-contract";

if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw new Error("Disposable offline runner required");
const scope = { organizationId: randomUUID(), workspaceId: "default" };
const user = randomUUID(), sellerA = randomUUID(), sellerB = randomUUID(), grant = randomUUID();
const site = "ATVPDKIKX0DER", auth = randomUUID(), profile = randomUUID(), adsAuth = randomUUID();
const token = "amcp_" + "a".repeat(43), credential = randomUUID();
let cookie = "";
let archiveSource = "", archiveTask = "";
const args = { sellerAccountId: sellerA, marketplaceId: site };
const url = (path: string, values: Record<string, string>) => "http://fixture" + path + "?" + new URLSearchParams({ workspaceId: scope.workspaceId, ...values });
before(async () => {
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 67).toString("base64");
  process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify([[scope.organizationId, scope.workspaceId]]);
  await prisma.organization.create({ data: { id: scope.organizationId, name: "Account access fixture", slug: scope.organizationId } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Fixture" } });
  await prisma.user.create({ data: { id: user, name: "Fixture reader", email: `${user}@fixture.invalid`, passwordHash: "not-a-login", memberships: { create: { organizationId: scope.organizationId, role: "viewer" } } } });
  await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: "viewer", name: "No module permissions", description: "Fixture", permissions: {} } });
  for (const id of [sellerA, sellerB]) await prisma.sellerAccount.create({ data: { ...scope, id, accountKey: id, displayName: "Fixture", marketplaceCode: "US" } });
  await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: grant, userId: user, sellerAccountId: sellerA, actions: [], marketplaceIds: ["unrelated-legacy-site"], mcpEnabled: false } });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: auth, name: "Fixture", amazonSellerId: "FIXTURE-SELLER", awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", credentialsCiphertext: "never-decrypted", updatedByUserId: user, status: "CONFIGURED", identityVerifiedAt: new Date() } });
  await prisma.amazonSellerIdentity.create({ data: { ...scope, id: randomUUID(), sellerAccountId: sellerA, marketplaceId: site, amazonSellerId: "FIXTURE-SELLER", region: "us-east-1", authorizationId: auth, verifiedAt: new Date() } });
  for (const resource of ["inventory", "finance"]) {
    const source = randomUUID(), run = randomUUID();
    await prisma.amazonSyncDataSource.create({ data: { ...scope, id: source, authorizationId: auth, sellerAccountId: sellerA, marketplaceId: site, resource, freshnessMinutes: 60,
      financePolicy: resource === "finance" ? { version: 1, marketplaces: [{ marketplaceId: site, timeZone: "America/Los_Angeles" }], lookbackDays: 7, safetyDelayHours: 48, maxRequests: 10, maxPages: 10 } : undefined } });
    await prisma.amazonSyncRun.create({ data: { ...scope, id: run, sourceId: source, resource, mode: resource === "finance" ? "incremental" : "snapshot", requestedByUserId: user, executionVersion: 2, status: "SUCCEEDED", finishedAt: new Date() } });
    await prisma.amazonSyncDataSource.update({ where: { id: source }, data: { activeRunId: run, lastSuccessAt: new Date() } });
    if (resource === "inventory") await prisma.amazonInventorySnapshot.create({ data: { ...scope, id: randomUUID(), sellerAccountId: sellerA, marketplaceId: site, sellerSku: "FIXTURE-SKU", fulfillableQuantity: 7, syncRunId: run, capturedAt: new Date() } });
    else await prisma.amazonFinanceRecord.create({ data: { ...scope, id: randomUUID(), sourceId: source, sourceRunId: run, sellerAccountId: sellerA, amazonSellerId: "FIXTURE-SELLER", transactionId: "fixture-transaction", marketplaceId: site, marketplaceTimeZone: "America/Los_Angeles", attributionStatus: "ATTRIBUTED", postedAt: new Date(), classification: "Sales", originalAmount: "12.34", amount: "12.34", currency: "USD", conversionStatus: "UNCONVERTED", observationSequence: 1, rowHash: digest("fixture"), capturedAt: new Date() } });
    if (resource === "inventory") {
      archiveSource = source; archiveTask = run;
      const rawBody = '{"payload":{"futureRows":[{"futureMetric":1.2300,"unknown":{"flag":true},"accessToken":"never-return"},{"futureMetric":2},null]},"nextToken":"never-return"}';
      await prisma.amazonSyncRawPage.create({ data: { ...scope, taskId: run, page: 1, resource, requestMetadata: {}, capturedAt: new Date(), bodySha256: digest(rawBody), rawCiphertext: seal({ rawBody }, scope, `${run}:1`, `amazon-${resource}-raw.v1`) } });
    }
  }
  await prisma.amazonAdsAuthorization.create({ data: { ...scope, id: adsAuth, name: "Fixture Ads", credentialsCiphertext: "never-decrypted", consentRegion: "NA", authorizedByUserId: user } });
  await prisma.amazonAdsProfile.create({ data: { ...scope, id: profile, authorizationId: adsAuth, sellerAccountId: sellerA, profileId: "fixture-profile", region: "NA", countryCode: "US", marketplaceId: site, accountInfo: {} } });
  const plan = randomUUID(), task = randomUUID();
  await prisma.amazonAdsSyncPlan.create({ data: { ...scope, id: plan, profileId: profile, actorUserId: user, sellerAccountId: sellerA, authorizationRevision: 1 } });
  await prisma.amazonAdsSyncTask.create({ data: { ...scope, id: task, planId: plan, planRevision: 1, idempotencyKey: randomUUID(), profileId: profile, trigger: "fixture", requestedByUserId: user, status: "SUCCEEDED", stage: "COMPLETED_SP_STRUCTURE" } });
  await prisma.amazonAdsEntityRecord.create({ data: { ...scope, id: randomUUID(), profileId: profile, entityType: "SP:keyword", externalId: "fixture-keyword", payload: { keywordText: "fixture", futureMetric: "1.234", placement: { extra: true, accessToken: "must-not-leak" } }, bid: "0.42", sourceTaskId: task } });
  await prisma.amazonMcpCredential.create({ data: { ...scope, id: credential, userId: user, name: "No independent grants", tokenHash: mcpTokenHash(token), tokenPrefix: token.slice(0, 12), tools: [], scopes: [], createdByUserId: user, expiresAt: new Date(Date.now() + 3600_000) } });
  const session = await createSession(user);
  cookie = `${session.sessionCookie.name}=${session.sessionCookie.value}`;
});
after(async () => { await prisma.$disconnect(); });

test("ERP real route handlers read assigned inventory and finance with no module permissions", async () => {
  const inventory = await erpRead(new Request(url("/api/operations/sync-center", { ...args, section: "data", table: "inventory" }), { headers: { cookie } }));
  assert.equal(inventory.status, 200, await inventory.clone().text());
  assert.equal((await inventory.json()).data.items[0].sellerSku, "FIXTURE-SKU");
  const finance = await erpRead(new Request(url("/api/operations/sync-center", { ...args, section: "finance" }), { headers: { cookie } }));
  assert.equal(finance.status, 200, await finance.clone().text());
  assert.equal((await finance.json()).rows[0].originalAmount, "12.34");
  const ads = await adsRead(new Request(url("/api/integrations/amazon/ads/data", { ...args, kind: "entities" }), { headers: { cookie } }));
  assert.equal(ads.status, 200, await ads.clone().text());
  assert.match(await ads.text(), /futureMetric/);
  const rejected = await erpRead(new Request(url("/api/operations/sync-center", { ...args, sellerAccountId: sellerB, section: "finance" }), { headers: { cookie } }));
  assert.equal(rejected.status, 403);
});

test("native MCP discovers all reads and returns full ad business fields without tool grants", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  const tools = await listDiscoverableAmazonMcpTools(identity);
  assert.ok(tools.some(tool => tool.name === "finance_get_transactions"));
  assert.ok(tools.some(tool => tool.name === "amazon.ads.entities.list"));
  assert.ok(!tools.some(tool => tool.name === "data_sync_start"));
  const response = await nativeMcp(new Request("http://fixture/api/mcp/amazon", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "amazon.ads.entities.list", arguments: args } }) }));
  assert.equal(response.status, 200, await response.clone().text());
  const output = JSON.parse((await response.json()).result.content[0].text);
  assert.equal(output.data.items[0].fields.futureMetric, "1.234");
  assert.deepEqual(output.data.items[0].fields.placement, { extra: true });
  await assert.rejects(invokeAmazonMcp(identity, "amazon.inventory.list", { ...args, sellerAccountId: sellerB }));
});

test("ERP session Lili invokes the same MCP gateway without creating personal credentials", async () => {
  const erp = await createErpResearchTransport({ ...scope, userId: user });
  assert.ok(erp.transport, erp.reason);
  const registry = await erp.transport.listTools();
  assert.ok(registry.some(tool => tool.name === "amazon.ads.entities.list"));
  const discovered = await createRuntimeTools([{ id: "erp", transport: erp.transport, isReadOnly: tool => tool.annotations?.readOnlyHint === true }]).discover();
  assert.equal(discovered.providers[0].status, "connected", JSON.stringify(discovered.providers));
  await createRuntimeTools([{ id: "erp", transport: erp.transport, isReadOnly: tool => tool.annotations?.readOnlyHint === true }]).call("erp__amazon.ads.entities.list", args, new AbortController().signal);
  const before = await prisma.amazonMcpCredential.count({ where: { ...scope, userId: user } });
  const request = new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "erp__amazon.ads.entities.list", arguments: args } }) });
  const response = await handleLiliRequest(request, ["mcp"]);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.result.isError, false, JSON.stringify(body));
  assert.match(body.result.content[0].text, /futureMetric/);
  assert.equal(await prisma.amazonMcpCredential.count({ where: { ...scope, userId: user } }), before);
  const logs = await prisma.auditLog.findMany({ where: { organizationId: scope.organizationId, action: "amazon.mcp.tool.succeeded" } });
  assert.ok(logs.length > 0 && logs.every(log => log.userId === user));
});

test("ERP, native MCP and Lili share archive reads under the current account assignment", async () => {
  const input = { ...args, sourceId: archiveSource, taskId: archiveTask, rawPage: 1, pointer: "/payload/futureRows", pageSize: 1 };
  const values = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value)]));
  const response = await erpRead(new Request(url("/api/operations/sync-center", { ...values, section: "archive-data" }), { headers: { cookie } }));
  assert.equal(response.status, 200, await response.clone().text());
  const erp = await response.json();
  assert.equal(erp.data.items[0].futureMetric, "1.2300");
  assert.equal(erp.pagination.hasNext, true);
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  const native = await invokeAmazonMcp(identity, "amazon.data.archive.read", input) as Awaited<ReturnType<typeof readArchivedBusinessData>>;
  assert.deepEqual(JSON.parse(JSON.stringify(native.data)), erp.data);
  assert.deepEqual(JSON.parse(JSON.stringify(native.meta)), erp.meta);
  const erpTransport = await createErpResearchTransport({ ...scope, userId: user });
  const runtime = createRuntimeTools([{ id: "erp", transport: erpTransport.transport, isReadOnly: tool => tool.annotations?.readOnlyHint === true }]);
  const lili = await runtime.call("erp__amazon.data.archive.read", input, new AbortController().signal);
  assert.deepEqual(JSON.parse(JSON.stringify(lili)), JSON.parse(JSON.stringify(native)));
  const liliResponse = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "erp__amazon.data.archive.read", arguments: input } }) }), ["mcp"]);
  const liliBody = await liliResponse.json();
  assert.equal(liliBody.result.isError, false, JSON.stringify(liliBody));
  assert.deepEqual(JSON.parse(liliBody.result.content[0].text), JSON.parse(JSON.stringify(native)));
  assert.doesNotMatch(JSON.stringify(native), /never-return|rawCiphertext/);
  await assert.rejects(readArchivedBusinessData(scope, new URLSearchParams({ ...values, sellerAccountId: sellerB }), user), /未分配|不属于/);
  await assert.rejects(readArchivedBusinessData(scope, new URLSearchParams({ ...values, taskId: randomUUID() }), user), /任务不可访问/);
  const next = await readArchivedBusinessData(scope, new URLSearchParams({ ...values, page: "2" }), user);
  assert.equal((next.data.items[0] as { futureMetric: string }).futureMetric, "2");
  const nullValue = await invokeAmazonMcp(identity, "amazon.data.archive.read", { ...input, pointer: "/payload/futureRows/2" }) as Awaited<ReturnType<typeof readArchivedBusinessData>>;
  assert.deepEqual(nullValue.data.items, [null]);
});

test("official authorization failures return explicit errors instead of empty data", async () => {
  await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "REVOKED" } });
  try {
    await assert.rejects(readFinance(scope, new URLSearchParams(args), user), /官方授权/);
    await assert.rejects(readArchivedBusinessData(scope, new URLSearchParams({ ...args, sourceId: archiveSource, taskId: archiveTask, rawPage: "1" }), user), /官方授权/);
    const identity = await authenticateAmazonMcp(`Bearer ${token}`);
    await assert.rejects(invokeAmazonMcp(identity, "amazon.inventory.list", args), /官方授权/);
  } finally { await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } }); }
});

test("local mode keeps ERP/MCP/Lili reads available without claiming official sync tasks", async () => {
  const priorRole = process.env.AMAZON_API_EXECUTION_ROLE, priorQueue = process.env.QUEUE_DRIVER;
  const task = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: archiveTask } });
  process.env.AMAZON_API_EXECUTION_ROLE = "local";
  process.env.QUEUE_DRIVER = "redis";
  try {
    const response = await erpRead(new Request(url("/api/operations/sync-center", { ...args, section: "finance" }), { headers: { cookie } }));
    assert.equal(response.status, 200, await response.clone().text());
    const identity = await authenticateAmazonMcp(`Bearer ${token}`);
    const native = await invokeAmazonMcp(identity, "amazon.ads.entities.list", args) as { data: { total: number } };
    assert.equal(native.data.total, 1);
    const archive = await invokeAmazonMcp(identity, "amazon.data.archive.read", { ...args, sourceId: archiveSource, taskId: archiveTask, rawPage: 1, pointer: "/payload/futureRows", pageSize: 1 }) as Awaited<ReturnType<typeof readArchivedBusinessData>>;
    assert.equal((archive.data.items[0] as { futureMetric: string }).futureMetric, "1.2300");
    const lili = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "erp__amazon.ads.entities.list", arguments: args } }) }), ["mcp"]);
    assert.equal((await lili.json()).result.isError, false);
    await prisma.amazonSyncRun.update({ where: { id: archiveTask }, data: { status: "RUNNING", leaseOwner: "offline-fixture-expired", leaseExpiresAt: new Date(0) } });
    const before = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: archiveTask } });
    const result = await tickSyncCenter(new Date(), { taskIds: [archiveTask], exportIds: [] });
    assert.equal(result?.examined, 0);
    assert.equal(result?.expiredLeases, 0);
    await assert.rejects(processSyncCenterTask(archiveTask, 1), AmazonCloudExecutionError);
    await assert.rejects(processAmazonAdsSyncTask("fixture-task", 1), AmazonCloudExecutionError);
    const after = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: archiveTask } });
    assert.deepEqual(after, before);
  } finally {
    await prisma.amazonSyncRun.update({ where: { id: archiveTask }, data: { status: task.status, leaseOwner: task.leaseOwner, leaseExpiresAt: task.leaseExpiresAt } });
    if (priorRole === undefined) delete process.env.AMAZON_API_EXECUTION_ROLE; else process.env.AMAZON_API_EXECUTION_ROLE = priorRole;
    if (priorQueue === undefined) delete process.env.QUEUE_DRIVER; else process.env.QUEUE_DRIVER = priorQueue;
  }
});

test("Ads-only account works independently of SP-API, and revoked Ads authorization is explicit", async () => {
  await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "REVOKED" } });
  try {
    const identity = await authenticateAmazonMcp(`Bearer ${token}`);
    const data = await invokeAmazonMcp(identity, "amazon.ads.entities.list", args) as { data: { total: number } };
    assert.equal(data.data.total, 1);
    const generic = await invokeAmazonMcp(identity, "data_query", { ...args, module: "amazon_ads", dataType: "entities" }) as { data: { total: number } };
    assert.equal(generic.data.total, 1);
    const catalog = await invokeAmazonMcp(identity, "data_list_tables", args) as { data: { datasets: Array<{ name: string }> } };
    assert.ok(catalog.data.datasets.some(dataset => dataset.name === "ads_entities"));
    await prisma.amazonAdsAuthorization.update({ where: { id: adsAuth }, data: { status: "REVOKED" } });
    await assert.rejects(invokeAmazonMcp(identity, "amazon.ads.entities.list", args), /Ads 官方授权/);
    const response = await adsRead(new Request(url("/api/integrations/amazon/ads/data", { ...args, kind: "entities" }), { headers: { cookie } }));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "AMAZON_AUTHORIZATION_INVALID");
  } finally {
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
    await prisma.amazonAdsAuthorization.update({ where: { id: adsAuth }, data: { status: "CONNECTED" } });
  }
});

test("local ERP forwards original-user sync requests and human decisions; cloud claims once", async () => {
  const priorFetch = globalThis.fetch, priorRole = process.env.AMAZON_API_EXECUTION_ROLE;
  const priorUrl = process.env.AMAZON_CLOUD_EXECUTOR_URL, priorSecret = process.env.AMAZON_CLOUD_BRIDGE_SECRET;
  const reviewer = randomUUID();
  await prisma.user.create({ data: { id: reviewer, name: "Fixture reviewer", email: `${reviewer}@fixture.invalid`, passwordHash: "not-a-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId: reviewer, sellerAccountId: sellerA } });
  const reviewerSession = await createSession(reviewer);
  const reviewerCookie = `${reviewerSession.sessionCookie.name}=${reviewerSession.sessionCookie.value}`;
  await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: { operations: ["view", "create"] } } });
  await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { actions: ["view", "sync"], marketplaceIds: [site] } });
  process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://cloud.fixture.invalid";
  process.env.AMAZON_CLOUD_BRIDGE_SECRET = "offline-fixture-cloud-relay-secret-with-32-bytes";
  process.env.AMAZON_API_EXECUTION_ROLE = "local";
  let requests = 0;
  let firstRequest: Request | undefined;
  let loseNextResponse = false;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://cloud.fixture.invalid/api/internal/amazon/execution");
    requests++;
    const forwarded = new Request(String(input), init);
    firstRequest ??= forwarded.clone();
    // In-process transport, one disposable DB; this is not a two-server deployment.
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    try {
      const response = await cloudExecute(forwarded);
      if (loseNextResponse) { loseNextResponse = false; throw new Error("fixture lost response after durable cloud commit"); }
      return response;
    }
    finally { process.env.AMAZON_API_EXECUTION_ROLE = "local"; }
  };
  const callApproval = (id: string, decision: string, authCookie = cookie) => approvalAction(new Request(url("/api/operations/sync-center/approvals", {}), { method: "POST", headers: { cookie: authCookie, "content-type": "application/json" }, body: JSON.stringify({ id, decision }) }));
  try {
    const response = await erpSubmit(new Request(url("/api/operations/sync-center", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "run", sourceIds: [archiveSource] }) }));
    assert.equal(response.status, 202, await response.clone().text());
    const id = (await response.json()).changeRequest.id as string;
    assert.match(id, /^cloud-run-/);
    assert.ok(firstRequest);
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    const duplicate = await cloudExecute(firstRequest.clone());
    process.env.AMAZON_API_EXECUTION_ROLE = "local";
    assert.equal(duplicate.status, 200, await duplicate.clone().text());
    assert.equal((await duplicate.json()).changeRequest.id, id);
    assert.equal(await prisma.amazonDataCenterChangeRequest.count({ where: { ...scope, id } }), 1);
    assert.equal((await callApproval(id, "APPLY")).status, 403);
    const approved = await callApproval(id, "APPROVED", reviewerCookie);
    assert.equal(approved.status, 200, await approved.clone().text());
    loseNextResponse = true;
    const uncertain = await callApproval(id, "APPLY");
    assert.equal(uncertain.status, 502);
    assert.equal((await uncertain.json()).code, "CLOUD_RESULT_UNKNOWN");
    assert.equal(await prisma.amazonSyncRun.count({ where: { ...scope, executionApprovalId: id } }), 1);
    const applied = await callApproval(id, "APPLY");
    assert.equal(applied.status, 200, await applied.clone().text());
    const body = await applied.json();
    assert.equal(body.executionLocation, "cloud");
    assert.equal(body.amazonExecutionCompleted, false);
    assert.equal(body.tasks.length, 1);
    assert.equal(body.tasks[0].requestedByUserId, user);
    const replay = await callApproval(id, "APPLY");
    assert.equal(replay.status, 200, await replay.clone().text());
    assert.equal((await replay.json()).tasks[0].id, body.tasks[0].id);
    assert.equal(await prisma.amazonSyncRun.count({ where: { ...scope, executionApprovalId: id } }), 1);
    const listing = await erpRead(new Request(url("/api/operations/sync-center", { section: "approvals" }), { headers: { cookie } }));
    assert.equal(listing.status, 200, await listing.clone().text());
    assert.equal((await listing.json()).cloudExecution, "CONNECTED");
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    assert.equal((await callApproval(id, "APPLY")).status, 403);
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    // The receiver independently rejects revocation even with a valid service signature.
    const signed = createCloudRelayEnvelope(scope, user, { kind: "apply", id });
    const signature = cloudRelaySignature(signed);
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    const rejected = await cloudExecute(new Request(signed.audience, { method: "POST", headers: { "content-type": "application/json", "x-amazon-cloud-signature": signature }, body: JSON.stringify(signed) }));
    assert.equal(rejected.status, 403);
    assert.ok(requests >= 5);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorRole === undefined) delete process.env.AMAZON_API_EXECUTION_ROLE; else process.env.AMAZON_API_EXECUTION_ROLE = priorRole;
    if (priorUrl === undefined) delete process.env.AMAZON_CLOUD_EXECUTOR_URL; else process.env.AMAZON_CLOUD_EXECUTOR_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.AMAZON_CLOUD_BRIDGE_SECRET; else process.env.AMAZON_CLOUD_BRIDGE_SECRET = priorSecret;
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true, actions: [], marketplaceIds: ["unrelated-legacy-site"] } });
  }
});

test("cloud inventory snapshot publishes atomically into existing local ERP/MCP reads", async () => {
  const priorRole = process.env.AMAZON_API_EXECUTION_ROLE, priorUrl = process.env.AMAZON_CLOUD_EXECUTOR_URL, priorSecret = process.env.AMAZON_CLOUD_BRIDGE_SECRET, priorFetch = globalThis.fetch;
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: archiveSource } });
  let received: InventoryReplica | undefined;
  const call = () => pullReplica(new Request(url("/api/operations/sync-center/replica", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ sourceId: archiveSource }) }));
  process.env.AMAZON_API_EXECUTION_ROLE = "local";
  process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://cloud.fixture.invalid";
  process.env.AMAZON_CLOUD_BRIDGE_SECRET = "offline-fixture-replica-secret-with-32-bytes";
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://cloud.fixture.invalid/api/internal/amazon/execution");
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    try {
      // Single disposable DB, in-process HTTP handlers; not a deployed two-host test.
      const response = await cloudExecute(new Request(String(input), init));
      if (response.ok) received = (await response.clone().json()).replica;
      return response;
    } finally { process.env.AMAZON_API_EXECUTION_ROLE = "local"; }
  };
  try {
    assert.equal((await call()).status, 403); // Import is an operator action, not a read side effect.
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: { operations: ["create"] } } });
    await prisma.amazonSyncDataSource.update({ where: { id: archiveSource }, data: { lastSuccessAt: new Date(0) } });
    const response = await call();
    assert.equal(response.status, 200, await response.clone().text());
    const receipt = await response.json();
    assert.equal(receipt.scope, "structured-inventory");
    assert.equal(receipt.cloudRunId, archiveTask);
    assert.equal(receipt.amazonApiCalled, false);
    assert.equal(receipt.rowCount, 1);
    assert.match(receipt.localRunId, /^replica-/);
    assert.ok(received);
    const local = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: archiveSource } });
    assert.equal(local.activeRunId, receipt.localRunId);
    const id = await authenticateAmazonMcp(`Bearer ${token}`);
    const mcp = await invokeAmazonMcp(id, "amazon.inventory.list", args);
    assert.ok(JSON.stringify(mcp).includes("FIXTURE-SKU"));
    const erp = await erpRead(new Request(url("/api/operations/sync-center", { ...args, section: "data", table: "inventory" }), { headers: { cookie } }));
    assert.equal(erp.status, 200, await erp.clone().text());
    assert.equal((await erp.json()).data.items[0].fulfillableQuantity, 7);
    const lili = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 41, method: "tools/call", params: { name: "erp__amazon.inventory.list", arguments: args } }) }), ["mcp"]);
    const liliBody = await lili.json();
    assert.ok(!liliBody.error && !liliBody.result?.isError, JSON.stringify(liliBody));
    assert.ok(JSON.stringify(liliBody).includes("FIXTURE-SKU"));
    const replay = await publishInventoryReplica(scope, user, received, { sourceId: archiveSource, activeRunId: local.activeRunId, revision: local.revision });
    assert.equal(replay.replayed, true);
    assert.equal(await prisma.amazonInventorySnapshot.count({ where: { syncRunId: receipt.localRunId } }), 1);
    const { digest: checksum, ...body } = received;
    void checksum;
    const newer = { ...body, cloudRunId: "fixture-atomic-rollback", publishedAt: new Date(Date.parse(body.publishedAt) + 1000).toISOString(), rows: [body.rows[0], { ...body.rows[0], sellerSku: "SECOND-FIXTURE-SKU" }] };
    const nextRunId = `replica-${digest([scope, archiveSource, newer.cloudRunId])}`;
    const collisionId = `${nextRunId}:1`;
    // Deliberate primary-key failure after creating the run, inside this fixture only.
    await prisma.amazonInventorySnapshot.create({ data: { ...scope, id: collisionId, syncRunId: "fixture-collision", sellerAccountId: sellerA, marketplaceId: site, sellerSku: "FIXTURE-COLLISION", capturedAt: new Date() } });
    try {
      await assert.rejects(publishInventoryReplica(scope, user, { ...newer, digest: digest(newer) }, { sourceId: archiveSource, activeRunId: local.activeRunId, revision: local.revision }));
      assert.equal(await prisma.amazonSyncRun.count({ where: { id: nextRunId } }), 0);
      assert.equal(await prisma.amazonInventorySnapshot.count({ where: { syncRunId: nextRunId } }), 0);
      assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: archiveSource } })).activeRunId, receipt.localRunId);
    } finally { await prisma.amazonInventorySnapshot.delete({ where: { id: collisionId } }); }
    await assert.rejects(publishInventoryReplica(scope, user, { ...newer, digest: digest(newer) }, { sourceId: archiveSource, activeRunId: archiveTask, revision: local.revision }), /已变化/);
    const foreign = { ...body, sellerAccountId: sellerB };
    await assert.rejects(publishInventoryReplica(scope, user, { ...foreign, digest: digest(foreign) }, { sourceId: archiveSource, activeRunId: local.activeRunId, revision: local.revision }), /绑定不一致/);
    await assert.rejects(publishInventoryReplica(scope, user, { ...received, rows: [] }, { sourceId: archiveSource, activeRunId: local.activeRunId, revision: local.revision }), /完整性/);
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    await assert.rejects(publishInventoryReplica(scope, user, received, { sourceId: archiveSource, activeRunId: local.activeRunId, revision: local.revision }));
    assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: archiveSource } })).activeRunId, receipt.localRunId);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorRole === undefined) delete process.env.AMAZON_API_EXECUTION_ROLE; else process.env.AMAZON_API_EXECUTION_ROLE = priorRole;
    if (priorUrl === undefined) delete process.env.AMAZON_CLOUD_EXECUTOR_URL; else process.env.AMAZON_CLOUD_EXECUTOR_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.AMAZON_CLOUD_BRIDGE_SECRET; else process.env.AMAZON_CLOUD_BRIDGE_SECRET = priorSecret;
    await prisma.amazonSyncDataSource.update({ where: { id: archiveSource }, data: { activeRunId: source.activeRunId, lastSuccessAt: source.lastSuccessAt, rowCount: source.rowCount } });
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
  }
});

test("cloud catalog replica preserves nested attributes for ERP, native MCP and session Lili", async () => {
  const priorRole = process.env.AMAZON_API_EXECUTION_ROLE, priorUrl = process.env.AMAZON_CLOUD_EXECUTOR_URL, priorSecret = process.env.AMAZON_CLOUD_BRIDGE_SECRET, priorFetch = globalThis.fetch;
  const sourceId = randomUUID(), cloudRunId = randomUUID();
  const capturedAt = new Date(), expected = { sourceId, activeRunId: cloudRunId, revision: 1 };
  let received: CatalogReplica | undefined;
  await prisma.amazonSyncDataSource.create({ data: { ...scope, id: sourceId, authorizationId: auth, sellerAccountId: sellerA, marketplaceId: site, resource: "catalog", freshnessMinutes: 60 } });
  await prisma.amazonSyncRun.create({ data: { ...scope, id: cloudRunId, sourceId, resource: "catalog", requestedByUserId: user, executionVersion: 2, status: "SUCCEEDED", finishedAt: capturedAt } });
  await prisma.amazonSyncDataSource.update({ where: { id: sourceId }, data: { activeRunId: cloudRunId, lastSuccessAt: new Date(0) } });
  const attributes = { item_name: [{ value: "Fixture catalog title", language_tag: "en_US" }], future_attribute: [{ value: "1.2300", nested: { extra: true, accessToken: "never-replicate-secret" } }] };
  const fields = { future_attribute: { api: "Listings Items", path: "/attributes/future_attribute" } };
  await prisma.amazonCatalogSnapshot.createMany({ data: [
    { ...scope, id: randomUUID(), sourceRunId: cloudRunId, sellerAccountId: sellerA, marketplaceId: site, sellerSku: "CATALOG-FIXTURE", asin: "FIXTURE-ASIN", listingStatus: "BUYABLE", fulfillmentType: "AFN", listingAttributes: attributes, fieldSources: fields, capturedAt },
    { ...scope, id: randomUUID(), sourceRunId: cloudRunId, sellerAccountId: sellerA, marketplaceId: site, sellerSku: "NULL-ATTRIBUTES-FIXTURE", fieldSources: {}, capturedAt },
  ] });
  process.env.AMAZON_API_EXECUTION_ROLE = "local";
  process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://cloud.fixture.invalid";
  process.env.AMAZON_CLOUD_BRIDGE_SECRET = "offline-fixture-catalog-secret-with-32-bytes";
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://cloud.fixture.invalid/api/internal/amazon/execution");
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    try {
      // Actual route handlers against one disposable DB; no deployed hosts or Amazon API.
      const response = await cloudExecute(new Request(String(input), init));
      if (response.ok) received = (await response.clone().json()).replica;
      return response;
    } finally { process.env.AMAZON_API_EXECUTION_ROLE = "local"; }
  };
  const call = (resource = "catalog") => pullReplica(new Request(url("/api/operations/sync-center/replica", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ sourceId, resource }) }));
  try {
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: { operations: ["create"] } } });
    assert.equal((await call("finance")).status, 409);
    assert.equal((await call("inventory")).status, 409);
    const response = await call();
    assert.equal(response.status, 200, await response.clone().text());
    const receipt = await response.json();
    assert.equal(receipt.scope, "structured-catalog");
    assert.equal(receipt.cloudRunId, cloudRunId);
    assert.equal(receipt.rowCount, 2);
    assert.equal(receipt.amazonApiCalled, false);
    assert.ok(received);
    assert.ok(!JSON.stringify(received).includes("never-replicate-secret"));
    const rows = await prisma.amazonCatalogSnapshot.findMany({ where: { ...scope, sourceRunId: receipt.localRunId }, orderBy: { sellerSku: "asc" } });
    assert.deepEqual(rows[0].fieldSources, fields);
    assert.equal((rows[0].listingAttributes as { future_attribute: Array<{ value: string }> }).future_attribute[0].value, "1.2300");
    assert.equal(rows[1].listingAttributes, null);
    assert.equal(rows[1].listingStatus, null);
    assert.equal(rows[0].capturedAt.toISOString(), capturedAt.toISOString());
    const replay = await publishSnapshotReplica(scope, user, received, expected, "catalog");
    assert.equal(replay.replayed, true);
    const alteredBody = { ...received, rows: received.rows.map(row => ({ ...row, asin: "CHANGED" })) };
    const { digest: unused, ...altered } = alteredBody; void unused;
    await assert.rejects(publishSnapshotReplica(scope, user, { ...altered, digest: digest(altered) }, expected, "catalog"), /内容发生变化/);
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    // All three read entrances work for the assigned user with no module/tool grants.
    const erp = await erpRead(new Request(url("/api/operations/sync-center", { ...args, section: "snapshots", id: receipt.localRunId }), { headers: { cookie } }));
    assert.equal(erp.status, 200, await erp.clone().text());
    const erpBody = await erp.json();
    assert.ok(JSON.stringify(erpBody).includes("1.2300"));
    const identity = await authenticateAmazonMcp(`Bearer ${token}`);
    const native = await invokeAmazonMcp(identity, "amazon.catalog.list", args);
    assert.ok(JSON.stringify(native).includes("1.2300"));
    const lili = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 51, method: "tools/call", params: { name: "erp__amazon.catalog.list", arguments: args } }) }), ["mcp"]);
    const liliBody = await lili.json();
    assert.ok(!liliBody.error && !liliBody.result?.isError, JSON.stringify(liliBody));
    assert.ok(JSON.stringify(liliBody).includes("1.2300"));
    assert.ok(!JSON.stringify([erpBody, native, liliBody]).includes("never-replicate-secret"));
    await assert.rejects(invokeAmazonMcp(identity, "amazon.catalog.list", { ...args, sellerAccountId: sellerB }));
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    await assert.rejects(invokeAmazonMcp(identity, "amazon.catalog.list", args));
    const signed = createCloudRelayEnvelope(scope, user, { kind: "catalog-replica", sourceId });
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    const rejected = await cloudExecute(new Request(signed.audience, { method: "POST", headers: { "content-type": "application/json", "x-amazon-cloud-signature": cloudRelaySignature(signed) }, body: JSON.stringify(signed) }));
    assert.equal(rejected.status, 403);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorRole === undefined) delete process.env.AMAZON_API_EXECUTION_ROLE; else process.env.AMAZON_API_EXECUTION_ROLE = priorRole;
    if (priorUrl === undefined) delete process.env.AMAZON_CLOUD_EXECUTOR_URL; else process.env.AMAZON_CLOUD_EXECUTOR_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.AMAZON_CLOUD_BRIDGE_SECRET; else process.env.AMAZON_CLOUD_BRIDGE_SECRET = priorSecret;
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
  }
});

test("Ads objects relay retains full fields and exact money for ERP, MCP and Lili without SP authorization", async () => {
  const priorRole = process.env.AMAZON_API_EXECUTION_ROLE, priorUrl = process.env.AMAZON_CLOUD_EXECUTOR_URL, priorSecret = process.env.AMAZON_CLOUD_BRIDGE_SECRET, priorFetch = globalThis.fetch;
  const target = randomUUID(), plan = randomUUID(), task = randomUUID();
  const finishedAt = new Date();
  await prisma.amazonAdsProfile.create({ data: { ...scope, id: target, authorizationId: adsAuth, sellerAccountId: sellerA, profileId: "replica-fixture-profile", region: "NA", countryCode: "US", marketplaceId: site, currencyCode: "USD", timezone: "America/Los_Angeles", accountInfo: {} } });
  await prisma.amazonAdsSyncPlan.create({ data: { ...scope, id: plan, profileId: target, actorUserId: user, sellerAccountId: sellerA, authorizationRevision: 1, status: "PAUSED" } });
  await prisma.amazonAdsSyncTask.create({ data: { ...scope, id: task, planId: plan, profileId: target, requestedByUserId: user, idempotencyKey: randomUUID(), planRevision: 1, status: "SUCCEEDED", stage: "COMPLETED_SP_STRUCTURE", finishedAt } });
  await prisma.amazonAdsEntityRecord.create({ data: { ...scope, id: randomUUID(), profileId: target, entityType: "SP:keyword", externalId: "replica-keyword", keywordText: "Replica keyword", bid: "0.420001", budgetAmount: "12345678901234.123456", payload: { keywordText: "Replica keyword", futureMetric: "1.2300", nested: { extra: true, accessToken: "never-replicate-ads-secret" } }, sourceTaskId: task } });
  let received: AdsEntityReplica | undefined;
  process.env.AMAZON_API_EXECUTION_ROLE = "local";
  process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://cloud.fixture.invalid";
  process.env.AMAZON_CLOUD_BRIDGE_SECRET = "offline-fixture-ads-replica-secret-with-32-bytes";
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://cloud.fixture.invalid/api/internal/amazon/execution");
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    try {
      // Route-handler integration with one disposable DB, not a deployed two-host acceptance.
      const response = await cloudExecute(new Request(String(input), init));
      if (response.ok) received = (await response.clone().json()).replica;
      return response;
    } finally { process.env.AMAZON_API_EXECUTION_ROLE = "local"; }
  };
  const call = () => pullReplica(new Request(url("/api/operations/sync-center/replica", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ resource: "ads-entities", profileRecordId: target }) }));
  const query = { ...args, internalProfileId: target };
  try {
    assert.equal((await call()).status, 403);
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: { operations: ["create"] } } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "REVOKED" } });
    const response = await call();
    assert.equal(response.status, 200, await response.clone().text());
    const receipt = await response.json();
    assert.equal(receipt.scope, "ads-entities");
    assert.equal(receipt.rowCount, 1);
    assert.equal(receipt.amazonApiCalled, false);
    assert.ok(received);
    assert.ok(!JSON.stringify(received).includes("never-replicate-ads-secret"));
    const row = await prisma.amazonAdsEntityRecord.findFirstOrThrow({ where: { ...scope, profileId: target }, include: { sourceTask: true } });
    assert.equal(row.bid?.toFixed(), "0.420001");
    assert.equal(row.budgetAmount?.toFixed(), "12345678901234.123456");
    assert.equal(row.sourceTask.trigger, "cloud-replica");
    assert.equal(row.sourceTask.requestedByUserId, user);
    assert.equal(row.sourceTask.finishedAt?.toISOString(), finishedAt.toISOString());
    assert.equal(await prisma.amazonAdsSyncTask.count({ where: { ...scope, profileId: target, status: { in: ["WAITING", "QUEUED", "RUNNING"] } } }), 0);
    const replay = await publishAdsEntityReplica(scope, user, received, { profileRecordId: target, fingerprint: "unused-on-exact-replay" });
    assert.equal(replay.replayed, true);
    assert.equal(await prisma.amazonAdsEntityRecord.count({ where: { ...scope, profileId: target } }), 1);
    const { digest: unused, ...body } = received; void unused;
    const foreign = { ...body, sellerAccountId: sellerB };
    await assert.rejects(publishAdsEntityReplica(scope, user, { ...foreign, digest: digest(foreign) }, { profileRecordId: target, fingerprint: "fixture" }), /绑定不一致/);
    const changed = { ...body, rows: body.rows.map(item => ({ ...item, bid: "0.43" })) };
    await assert.rejects(publishAdsEntityReplica(scope, user, { ...changed, digest: digest(changed) }, { profileRecordId: target, fingerprint: "outdated" }), /已变化/);
    // A captured cloud snapshot models independent cloud data while the local
    // projection contains an obsolete object. This is still an offline fixture.
    const nextBody = { ...body, exportedAt: new Date(Date.parse(body.exportedAt) + 1000).toISOString(), rows: [{ ...body.rows[0], bid: "0.430001" }, { ...body.rows[0], externalId: "new-replica-keyword" }] };
    const nextReplica = { ...nextBody, digest: digest(nextBody) };
    globalThis.fetch = async (_input, init) => {
      const envelope = JSON.parse(String(init?.body));
      assert.equal(envelope.actorUserId, user);
      assert.equal(envelope.operation.profileRecordId, target);
      return Response.json({ requestId: envelope.requestId, executionLocation: "cloud", replica: nextReplica });
    };
    await prisma.amazonAdsEntityRecord.create({ data: { ...scope, id: randomUUID(), profileId: target, entityType: "SP:keyword", externalId: "obsolete-local-keyword", payload: {}, sourceTaskId: row.sourceTaskId } });
    const collisionId = `ads-entity-${digest([scope, target, "SP:keyword", "new-replica-keyword"])}`;
    const original = await prisma.amazonAdsEntityRecord.findFirstOrThrow({ where: { ...scope, profileId: profile } });
    await prisma.amazonAdsEntityRecord.create({ data: { ...scope, id: collisionId, profileId: profile, entityType: "SP:keyword", externalId: "fixture-collision", payload: {}, sourceTaskId: original.sourceTaskId } });
    const tasksBefore = await prisma.amazonAdsSyncTask.count({ where: { ...scope, profileId: target } });
    try {
      const failed = await call();
      assert.equal(failed.status, 500);
      assert.equal(await prisma.amazonAdsEntityRecord.count({ where: { ...scope, profileId: target, externalId: "obsolete-local-keyword" } }), 1);
      assert.equal((await prisma.amazonAdsEntityRecord.findFirstOrThrow({ where: { ...scope, profileId: target, externalId: "replica-keyword" } })).bid?.toFixed(), "0.420001");
      assert.equal(await prisma.amazonAdsSyncTask.count({ where: { ...scope, profileId: target } }), tasksBefore);
    } finally { await prisma.amazonAdsEntityRecord.delete({ where: { id: collisionId } }); }
    const refreshed = await call();
    assert.equal(refreshed.status, 200, await refreshed.clone().text());
    assert.equal(await prisma.amazonAdsEntityRecord.count({ where: { ...scope, profileId: target } }), 2);
    assert.equal(await prisma.amazonAdsEntityRecord.count({ where: { ...scope, profileId: target, externalId: "obsolete-local-keyword" } }), 0);
    assert.equal((await prisma.amazonAdsEntityRecord.findFirstOrThrow({ where: { ...scope, profileId: target, externalId: "replica-keyword" } })).bid?.toFixed(), "0.430001");
    await assert.rejects(publishAdsEntityReplica(scope, user, received, { profileRecordId: target, fingerprint: "old-version" }), /更新版本替代/);
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    const erp = await adsRead(new Request(url("/api/integrations/amazon/ads/data", { ...query, kind: "entities" }), { headers: { cookie } }));
    assert.equal(erp.status, 200, await erp.clone().text());
    const erpBody = await erp.json();
    assert.ok(JSON.stringify(erpBody).includes("1.2300"));
    const identity = await authenticateAmazonMcp(`Bearer ${token}`);
    const native = await invokeAmazonMcp(identity, "amazon.ads.entities.list", query);
    assert.ok(JSON.stringify(native).includes("1.2300"));
    const lili = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 61, method: "tools/call", params: { name: "erp__amazon.ads.entities.list", arguments: query } }) }), ["mcp"]);
    const liliBody = await lili.json();
    assert.ok(!liliBody.error && !liliBody.result?.isError, JSON.stringify(liliBody));
    assert.ok(JSON.stringify(liliBody).includes("1.2300"));
    assert.ok(!JSON.stringify([erpBody, native, liliBody]).includes("never-replicate-ads-secret"));
    await assert.rejects(invokeAmazonMcp(identity, "amazon.ads.entities.list", { ...query, sellerAccountId: sellerB }));
    await prisma.amazonAdsAuthorization.update({ where: { id: adsAuth }, data: { status: "REVOKED" } });
    const expired = await adsRead(new Request(url("/api/integrations/amazon/ads/data", { ...query, kind: "entities" }), { headers: { cookie } }));
    assert.equal((await expired.json()).code, "AMAZON_AUTHORIZATION_INVALID");
    await prisma.amazonAdsAuthorization.update({ where: { id: adsAuth }, data: { status: "CONNECTED" } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    await assert.rejects(invokeAmazonMcp(identity, "amazon.ads.entities.list", query));
    const signed = createCloudRelayEnvelope(scope, user, { kind: "ads-entities-replica", profileRecordId: target });
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    const rejected = await cloudExecute(new Request(signed.audience, { method: "POST", headers: { "content-type": "application/json", "x-amazon-cloud-signature": cloudRelaySignature(signed) }, body: JSON.stringify(signed) }));
    assert.equal(rejected.status, 403);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorRole === undefined) delete process.env.AMAZON_API_EXECUTION_ROLE; else process.env.AMAZON_API_EXECUTION_ROLE = priorRole;
    if (priorUrl === undefined) delete process.env.AMAZON_CLOUD_EXECUTOR_URL; else process.env.AMAZON_CLOUD_EXECUTOR_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.AMAZON_CLOUD_BRIDGE_SECRET; else process.env.AMAZON_CLOUD_BRIDGE_SECRET = priorSecret;
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
    await prisma.amazonAdsAuthorization.update({ where: { id: adsAuth }, data: { status: "CONNECTED" } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
  }
});

test("published Ads report versions relay exact metrics without losing history or unknown dimensions", async () => {
  const priorRole = process.env.AMAZON_API_EXECUTION_ROLE, priorUrl = process.env.AMAZON_CLOUD_EXECUTOR_URL, priorSecret = process.env.AMAZON_CLOUD_BRIDGE_SECRET, priorFetch = globalThis.fetch;
  const target = randomUUID(), plan = randomUUID(), versionIds = [randomUUID(), randomUUID(), randomUUID()].sort();
  const tasks = [randomUUID(), randomUUID(), randomUUID()];
  const reportDate = new Date("2026-11-01T00:00:00.000Z"), publishedAt = new Date("2026-11-02T01:00:00.000Z");
  await prisma.amazonAdsProfile.create({ data: { ...scope, id: target, authorizationId: adsAuth, sellerAccountId: sellerA, profileId: "report-replica-fixture", region: "NA", countryCode: "US", marketplaceId: site, currencyCode: "USD", timezone: "America/Los_Angeles", accountInfo: {} } });
  await prisma.amazonAdsSyncPlan.create({ data: { ...scope, id: plan, profileId: target, actorUserId: user, sellerAccountId: sellerA, authorizationRevision: 1, status: "PAUSED" } });
  for (let index = 0; index < 3; index++) {
    await prisma.amazonAdsSyncTask.create({ data: { ...scope, id: tasks[index], planId: plan, profileId: target, requestedByUserId: user, idempotencyKey: tasks[index], planRevision: 1, status: "SUCCEEDED", stage: "COMPLETED_REPORT", finishedAt: publishedAt } });
    await prisma.amazonAdsReportVersion.create({ data: { ...scope, id: versionIds[index], profileId: target, sourceTaskId: tasks[index], status: "PUBLISHED", requestedFrom: reportDate, requestedTo: reportDate, rowCount: index === 0 ? 2 : index === 1 ? 1 : 0, publishedAt } });
  }
  const fact = (versionIndex: number, factKey: string, spend: string, clicks: bigint | null) => ({ ...scope, id: randomUUID(), profileId: target, versionId: versionIds[versionIndex], sourceTaskId: tasks[versionIndex], reportType: "fixture-campaign", adProduct: "SP", reportDate, factKey, campaignId: "fixture-campaign", impressions: BigInt("9007199254740993"), clicks, spend, orders: BigInt(1), sales: "10.000001", units: null, currencyCode: "USD", attributionWindow: "7d", apiVersion: "fixture-report-v1", rawDimensions: { futureMetric: "1.2300", nested: { extra: true, accessToken: "never-replicate-report-secret" } }, syncedAt: publishedAt });
  await prisma.amazonAdsReportFact.createMany({ data: [fact(0, "same-fact", "1.000001", BigInt(2)), fact(0, "history-only-fact", "2.000001", BigInt(3)), fact(1, "same-fact", "12345678901234.123456", null)] });
  process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://cloud.fixture.invalid";
  process.env.AMAZON_CLOUD_BRIDGE_SECRET = "offline-fixture-ads-report-secret-with-32-bytes";
  const query = { ...args, internalProfileId: target, from: "2026-11-01", to: "2026-11-01" };
  try {
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    const signed = createCloudRelayEnvelope(scope, user, { kind: "ads-reports-replica", profileRecordId: target });
    const exported = await cloudExecute(new Request(signed.audience, { method: "POST", headers: { "content-type": "application/json", "x-amazon-cloud-signature": cloudRelaySignature(signed) }, body: JSON.stringify(signed) }));
    assert.equal(exported.status, 200, await exported.clone().text());
    const replica = (await exported.json()).replica as AdsReportReplica;
    assert.equal(replica.versions.length, 3);
    assert.ok(!JSON.stringify(replica).includes("never-replicate-report-secret"));
    // Retain the actual cloud route's published payload, then materialize an
    // empty local version store in this disposable DB. No deployed hosts involved.
    await prisma.amazonAdsReportFact.deleteMany({ where: { ...scope, profileId: target, versionId: { in: versionIds } } });
    await prisma.amazonAdsReportVersion.deleteMany({ where: { ...scope, id: { in: versionIds } } });
    process.env.AMAZON_API_EXECUTION_ROLE = "local";
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), signed.audience);
      const envelope = verifyCloudRelayEnvelope(JSON.parse(String(init?.body)), new Headers(init?.headers).get("x-amazon-cloud-signature"));
      assert.equal(envelope.actorUserId, user);
      assert.deepEqual(envelope.operation, { kind: "ads-reports-replica", profileRecordId: target });
      return Response.json({ requestId: envelope.requestId, executionLocation: "cloud", replica });
    };
    const call = () => pullReplica(new Request(url("/api/operations/sync-center/replica", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ resource: "ads-reports", profileRecordId: target }) }));
    assert.equal((await call()).status, 403);
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: { operations: ["create"] } } });
    // Fail after the first version has been inserted: the transaction must undo
    // its tasks, facts, version and audit, preserving the pre-import state.
    const collisionId = `ads-report-replica-${digest([scope, target, versionIds[1]])}:fact:0`;
    await prisma.amazonAdsReportFact.create({ data: { ...fact(0, "fixture-collision", "1", BigInt(1)), id: collisionId, versionId: null } });
    try {
      assert.equal((await call()).status, 500);
      assert.equal(await prisma.amazonAdsReportVersion.count({ where: { ...scope, id: { in: versionIds } } }), 0);
      assert.equal(await prisma.amazonAdsSyncTask.count({ where: { ...scope, profileId: target, trigger: "cloud-report-replica" } }), 0);
    } finally { await prisma.amazonAdsReportFact.delete({ where: { id: collisionId } }); }
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "REVOKED" } });
    const response = await call();
    assert.equal(response.status, 200, await response.clone().text());
    const receipt = await response.json();
    assert.equal(receipt.importedVersions, 3); assert.equal(receipt.factCount, 3); assert.equal(receipt.amazonApiCalled, false);
    const replay = await call();
    assert.equal(replay.status, 200, await replay.clone().text());
    assert.equal((await replay.json()).replayed, true);
    assert.equal(await prisma.amazonAdsReportFact.count({ where: { ...scope, profileId: target } }), 3);
    const newest = await prisma.amazonAdsReportVersion.findUniqueOrThrow({ where: { id: versionIds[1] } });
    assert.equal(newest.publishedAt?.toISOString(), publishedAt.toISOString());
    assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: newest.sourceTaskId } })).trigger, "cloud-report-replica");
    const { digest: unused, ...body } = replica; void unused;
    const altered = { ...body, versions: body.versions.map((version, index) => index ? version : { ...version, facts: version.facts.map(row => ({ ...row, spend: "99" })) }) };
    await assert.rejects(publishAdsReportReplica(scope, user, { ...altered, digest: digest(altered) }, target), /内容发生变化/);
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    const erp = await adsRead(new Request(url("/api/integrations/amazon/ads/data", { ...query, kind: "reports" }), { headers: { cookie } }));
    assert.equal(erp.status, 200, await erp.clone().text());
    const erpBody = await erp.json();
    assert.equal(erpBody.rows.length, 2); // Newest fact replaces only the same observed key; empty version deletes nothing.
    const current = erpBody.rows.find((row: { factKey: string }) => row.factKey === "same-fact");
    assert.equal(current.versionId, versionIds[1]);
    assert.equal(current.spend, "12345678901234.123456"); assert.equal(current.impressions, "9007199254740993"); assert.equal(current.clicks, null); assert.equal(current.cpc, null);
    assert.equal(current.rawDimensions.futureMetric, "1.2300");
    const identity = await authenticateAmazonMcp(`Bearer ${token}`);
    const native = await invokeAmazonMcp(identity, "amazon.ads.reports.list", query);
    assert.ok(JSON.stringify(native).includes("12345678901234.123456")); assert.ok(JSON.stringify(native).includes("1.2300"));
    const lili = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 71, method: "tools/call", params: { name: "erp__amazon.ads.reports.list", arguments: query } }) }), ["mcp"]);
    const liliBody = await lili.json();
    assert.ok(!liliBody.error && !liliBody.result?.isError, JSON.stringify(liliBody));
    assert.ok(JSON.stringify(liliBody).includes("12345678901234.123456")); assert.ok(JSON.stringify(liliBody).includes("1.2300"));
    assert.ok(!JSON.stringify([erpBody, native, liliBody]).includes("never-replicate-report-secret"));
    await assert.rejects(invokeAmazonMcp(identity, "amazon.ads.reports.list", { ...query, sellerAccountId: sellerB }));
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    await assert.rejects(invokeAmazonMcp(identity, "amazon.ads.reports.list", query));
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    const denied = await cloudExecute(new Request(signed.audience, { method: "POST", headers: { "content-type": "application/json", "x-amazon-cloud-signature": cloudRelaySignature(signed) }, body: JSON.stringify(signed) }));
    assert.equal(denied.status, 403);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorRole === undefined) delete process.env.AMAZON_API_EXECUTION_ROLE; else process.env.AMAZON_API_EXECUTION_ROLE = priorRole;
    if (priorUrl === undefined) delete process.env.AMAZON_CLOUD_EXECUTOR_URL; else process.env.AMAZON_CLOUD_EXECUTOR_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.AMAZON_CLOUD_BRIDGE_SECRET; else process.env.AMAZON_CLOUD_BRIDGE_SECRET = priorSecret;
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
  }
});

test("orders and item projections relay page-committed facts without copying private envelopes or sync cursors", async () => {
  const priorRole = process.env.AMAZON_API_EXECUTION_ROLE, priorUrl = process.env.AMAZON_CLOUD_EXECUTOR_URL, priorSecret = process.env.AMAZON_CLOUD_BRIDGE_SECRET, priorFetch = globalThis.fetch;
  const sourceId = randomUUID(), run = randomUUID(), ids = ["ORDER-REPLICA-1", "ORDER-REPLICA-2"];
  const createdTime = new Date("2026-11-01T00:00:00.000Z"), sourceUpdatedAt = new Date("2026-11-02T00:00:00.000Z");
  await prisma.amazonSyncDataSource.create({ data: { ...scope, id: sourceId, authorizationId: auth, sellerAccountId: sellerA, marketplaceId: site, resource: "orders", freshnessMinutes: 60 } });
  await prisma.amazonSyncRun.create({ data: { ...scope, id: run, sourceId, resource: "orders", mode: "incremental", requestedByUserId: user, executionVersion: 2, status: "RUNNING", stage: "PAGE_COMMIT" } });
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sourceId } });
  for (const amazonOrderId of ids) {
    const id = randomUUID();
    await prisma.amazonOrderRecord.create({ data: { ...scope, id, sourceId, sourceRunId: run, sellerAccountId: sellerA, amazonSellerId: "FIXTURE-SELLER", marketplaceId: site, amazonOrderId, createdTime, sourceUpdatedAt, rawStatus: "FUTURE_STATUS", normalizedStatus: null, marketplaceTimeZone: "America/Los_Angeles", capturedAt: sourceUpdatedAt, detailsUpdatedAt: sourceUpdatedAt, fulfilledBy: "AMAZON", fulfillmentServiceLevel: "Standard", grandTotalOriginal: "1.2300", grandTotalAmount: "1.23", currencyCode: "USD", detailCiphertext: "never-transfer-encrypted-private-envelope" } });
    await prisma.amazonOrderItemRecord.create({ data: { ...scope, sourceId, orderRecordId: id, orderItemId: "item", sellerSku: "ORDER-REPLICA-SKU", quantityOrdered: 2, proceedsOriginal: "0.000000000000000000000000000001", proceedsAmount: "0.000000000000000000000000000001", currencyCode: "USD" } });
  }
  process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://cloud.fixture.invalid";
  process.env.AMAZON_CLOUD_BRIDGE_SECRET = "offline-fixture-order-relay-secret-with-32-bytes";
  try {
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    const signed = createCloudRelayEnvelope(scope, user, { kind: "orders-replica", sourceId });
    const exported = await cloudExecute(new Request(signed.audience, { method: "POST", headers: { "content-type": "application/json", "x-amazon-cloud-signature": cloudRelaySignature(signed) }, body: JSON.stringify(signed) }));
    assert.equal(exported.status, 200, await exported.clone().text());
    let replica = (await exported.json()).replica as OrderReplica;
    const originalReplica = replica;
    assert.equal(replica.rows.length, 2);
    assert.equal(replica.rows[0].items[0].proceedsAmount, "0.000000000000000000000000000001");
    assert.ok(!JSON.stringify(replica).includes("never-transfer-encrypted-private-envelope"));
    assert.ok(!JSON.stringify(replica).includes("detailCiphertext"));
    // Captured cloud route payload, staged into an empty local projection inside
    // one disposable DB. This is not independent-host or real Amazon acceptance.
    await prisma.amazonOrderItemRecord.deleteMany({ where: { ...scope, sourceId } });
    await prisma.amazonOrderRecord.deleteMany({ where: { ...scope, sourceId } });
    process.env.AMAZON_API_EXECUTION_ROLE = "local";
    globalThis.fetch = async (_input, init) => {
      const envelope = verifyCloudRelayEnvelope(JSON.parse(String(init?.body)), new Headers(init?.headers).get("x-amazon-cloud-signature"));
      assert.equal(envelope.actorUserId, user); assert.deepEqual(envelope.operation, { kind: "orders-replica", sourceId });
      return Response.json({ requestId: envelope.requestId, executionLocation: "cloud", replica });
    };
    const call = () => pullReplica(new Request(url("/api/operations/sync-center/replica", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ resource: "orders", sourceId }) }));
    assert.equal((await call()).status, 403);
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: { operations: ["create"] } } });
    const collisionId = digest({ ...scope, sellerAccountId: sellerA, marketplaceId: site, amazonOrderId: ids[1] });
    await prisma.amazonOrderRecord.create({ data: { ...scope, id: collisionId, sourceId, sourceRunId: run, sellerAccountId: sellerA, amazonSellerId: "FIXTURE-SELLER", marketplaceId: site, amazonOrderId: "fixture-collision", createdTime, sourceUpdatedAt, marketplaceTimeZone: "America/Los_Angeles", capturedAt: sourceUpdatedAt } });
    try {
      assert.equal((await call()).status, 500);
      assert.equal(await prisma.amazonOrderRecord.count({ where: { ...scope, sourceId, amazonOrderId: { in: ids } } }), 0);
      assert.equal(await prisma.amazonSyncRun.count({ where: { ...scope, sourceId, trigger: "cloud-replica" } }), 0);
    } finally { await prisma.amazonOrderRecord.delete({ where: { id: collisionId } }); }
    const imported = await call();
    assert.equal(imported.status, 200, await imported.clone().text());
    assert.equal((await imported.json()).inserted, 2);
    const replay = await call();
    assert.equal(replay.status, 200); assert.equal((await replay.json()).replayed, true);
    assert.equal(await prisma.amazonOrderItemRecord.count({ where: { ...scope, sourceId } }), 2);
    assert.equal(await prisma.amazonSyncResourceCursor.count({ where: { ...scope, sourceId } }), 0);
    const after = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sourceId } });
    assert.equal(after.activeRunId, source.activeRunId); assert.equal(after.lastSuccessAt?.toISOString(), source.lastSuccessAt?.toISOString());
    const local = await prisma.amazonOrderRecord.findFirstOrThrow({ where: { ...scope, sourceId }, include: { task: true } });
    assert.equal(local.task.stage, "REPLICA_PAGE_COMMITTED"); assert.equal(local.detailCiphertext, null);
    await prisma.amazonOrderRecord.update({ where: { id: local.id }, data: { detailCiphertext: "preserved-local-encrypted-evidence", detailHash: "preserved-original-hash" } });
    const { digest: unused, ...body } = originalReplica; void unused;
    const newerBody = { ...body, rows: body.rows.map(row => ({ ...row, sourceUpdatedAt: "2026-11-03T00:00:00.000Z", detailsUpdatedAt: "2026-11-03T00:00:00.000Z", rawStatus: "SHIPPED", items: row.items.map(item => ({ ...item, quantityOrdered: 3 })) })) };
    replica = { ...newerBody, digest: digest(newerBody) };
    const refreshed = await call();
    assert.equal(refreshed.status, 200, await refreshed.clone().text());
    const evidence = await prisma.amazonOrderRecord.findUniqueOrThrow({ where: { id: local.id } });
    assert.equal(evidence.detailCiphertext, "preserved-local-encrypted-evidence");
    assert.equal(evidence.detailHash, "preserved-original-hash");
    const conflict = { ...newerBody, rows: newerBody.rows.map(row => ({ ...row, rawStatus: "CONFLICT" })) };
    await assert.rejects(publishOrderReplica(scope, user, { ...conflict, digest: digest(conflict) }, { sourceId, revision: source.revision }), /同一订单版本出现冲突/);
    const older = { ...body, rows: body.rows.map(row => ({ ...row, capturedAt: "2026-11-04T00:00:00.000Z" })) };
    const skipped = await publishOrderReplica(scope, user, { ...older, digest: digest(older) }, { sourceId, revision: source.revision });
    assert.equal(skipped.skipped, 2);
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    const query = { ...args, sourceId, from: "2026-11-01", to: "2026-11-03" };
    const erp = await erpRead(new Request(url("/api/operations/sync-center", { ...query, section: "orders" }), { headers: { cookie } }));
    assert.equal(erp.status, 200, await erp.clone().text());
    const erpBody = await erp.json();
    assert.equal(erpBody.rows.length, 2); assert.equal(erpBody.rows[0].rawStatus, "SHIPPED"); assert.equal(erpBody.rows[0].items[0].quantityOrdered, 3); assert.equal(erpBody.rows[0].grandTotalOriginal, "1.2300");
    assert.equal(erpBody.detailsComplete, false); assert.equal(erpBody.completeness, "PAGE_COMMITTED");
    const itemRead = await erpRead(new Request(url("/api/operations/sync-center", { ...query, section: "orders", itemsOnly: "true" }), { headers: { cookie } }));
    assert.equal(itemRead.status, 200, await itemRead.clone().text());
    const identity = await authenticateAmazonMcp(`Bearer ${token}`);
    const native = await invokeAmazonMcp(identity, "orders_search", query);
    assert.ok(JSON.stringify(native).includes("ORDER-REPLICA-SKU"));
    const itemMcp = await invokeAmazonMcp(identity, "orders_get_items", query);
    assert.ok(JSON.stringify(itemMcp).includes("0.000000000000000000000000000001"));
    const lili = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 81, method: "tools/call", params: { name: "erp__orders_search", arguments: query } }) }), ["mcp"]);
    const liliBody = await lili.json();
    assert.ok(!liliBody.error && !liliBody.result?.isError, JSON.stringify(liliBody)); assert.ok(JSON.stringify(liliBody).includes("ORDER-REPLICA-SKU"));
    await assert.rejects(invokeAmazonMcp(identity, "orders_search", { ...query, sellerAccountId: sellerB }));
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    await assert.rejects(invokeAmazonMcp(identity, "orders_search", query));
  } finally {
    globalThis.fetch = priorFetch;
    if (priorRole === undefined) delete process.env.AMAZON_API_EXECUTION_ROLE; else process.env.AMAZON_API_EXECUTION_ROLE = priorRole;
    if (priorUrl === undefined) delete process.env.AMAZON_CLOUD_EXECUTOR_URL; else process.env.AMAZON_CLOUD_EXECUTOR_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.AMAZON_CLOUD_BRIDGE_SECRET; else process.env.AMAZON_CLOUD_BRIDGE_SECRET = priorSecret;
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
  }
});

test("finance replica retains exact money and quarantine counts through ERP, native MCP and Lili session calls", async () => {
  const priorRole = process.env.AMAZON_API_EXECUTION_ROLE, priorUrl = process.env.AMAZON_CLOUD_EXECUTOR_URL, priorSecret = process.env.AMAZON_CLOUD_BRIDGE_SECRET, priorFetch = globalThis.fetch;
  const run = randomUUID(), capturedAt = new Date("2026-11-02T00:00:00.000Z"), tiny = "0.000000000000000000000000000001";
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, resource: "finance", sellerAccountId: sellerA } });
  const sourceId = source.id;
  await prisma.amazonSyncRun.create({ data: { ...scope, id: run, sourceId, resource: "finance", mode: "incremental", requestedByUserId: user, executionVersion: 2, status: "RUNNING", stage: "PAGE_COMMIT" } });
  const base = { ...scope, sourceId, sourceRunId: run, sellerAccountId: sellerA, amazonSellerId: "FIXTURE-SELLER", postedAt: capturedAt, capturedAt, observationSequence: 2 };
  await prisma.amazonFinanceRecord.createMany({ data: [
    { ...base, id: randomUUID(), transactionId: "FIN-REPLICA-A", marketplaceId: site, marketplaceTimeZone: "America/Los_Angeles", attributionStatus: "ATTRIBUTED", classification: "NON_ORDER", transactionType: "FUTURE_TYPE", originalAmount: "1e-30", amount: tiny, currency: "USD", convertedAmount: "12345678901234567890123456789012345.123456789012345678901234567890", convertedCurrency: "CNY", conversionStatus: "CONVERTED", fxEvidence: { futureEvidence: { extra: "1.2300", accessToken: "never-transfer-fx-secret" } }, rowHash: digest("finance-a") },
    { ...base, id: randomUUID(), transactionId: "FIN-REPLICA-B", marketplaceId: "A2EUQ1WTGCTBG2", marketplaceTimeZone: "America/Toronto", attributionStatus: "ATTRIBUTED", classification: "NON_ORDER", originalAmount: "-2.3400", amount: "-2.34", currency: "CAD", conversionStatus: "UNCONVERTED", rowHash: digest("finance-b") },
    { ...base, id: randomUUID(), transactionId: "FIN-REPLICA-Q", attributionStatus: "QUARANTINED", quarantineReason: "UNKNOWN_SITE", classification: "UNATTRIBUTED", conversionStatus: "QUARANTINED", rowHash: digest("finance-q") },
  ] });
  const quarantined = await prisma.amazonFinanceRecord.findFirstOrThrow({ where: { ...scope, sourceId, transactionId: "FIN-REPLICA-Q" } });
  await prisma.amazonFinanceQuarantine.create({ data: { ...scope, recordId: quarantined.id, ciphertext: "never-transfer-quarantine-envelope", createdAt: capturedAt } });
  process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://cloud.fixture.invalid";
  process.env.AMAZON_CLOUD_BRIDGE_SECRET = "offline-fixture-finance-secret-with-32-bytes";
  try {
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    const signed = createCloudRelayEnvelope(scope, user, { kind: "finance-replica", sourceId });
    const exported = await cloudExecute(new Request(signed.audience, { method: "POST", headers: { "content-type": "application/json", "x-amazon-cloud-signature": cloudRelaySignature(signed) }, body: JSON.stringify(signed) }));
    assert.equal(exported.status, 200, await exported.clone().text());
    const replica = (await exported.json()).replica as FinanceReplica;
    assert.equal(replica.rows.length, 4); assert.equal(replica.rows[0].amount, tiny);
    assert.ok(!JSON.stringify(replica).includes("never-transfer"));
    // Stage a real cloud handler payload into an empty projection in a disposable
    // DB. This verifies handlers, not independently deployed hosts or Amazon API.
    await prisma.amazonFinanceQuarantine.deleteMany({ where: { ...scope, recordId: quarantined.id } });
    await prisma.amazonFinanceRecord.deleteMany({ where: { ...scope, sourceId } });
    process.env.AMAZON_API_EXECUTION_ROLE = "local";
    globalThis.fetch = async (_input, init) => {
      const envelope = verifyCloudRelayEnvelope(JSON.parse(String(init?.body)), new Headers(init?.headers).get("x-amazon-cloud-signature"));
      assert.equal(envelope.actorUserId, user); assert.deepEqual(envelope.operation, { kind: "finance-replica", sourceId });
      return Response.json({ requestId: envelope.requestId, executionLocation: "cloud", replica });
    };
    const call = () => pullReplica(new Request(url("/api/operations/sync-center/replica", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ resource: "finance", sourceId }) }));
    assert.equal((await call()).status, 403);
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: { operations: ["create"] } } });
    const collisionId = digest({ ...scope, sellerAccountId: sellerA, transactionId: "FIN-REPLICA-B" });
    await prisma.amazonFinanceRecord.create({ data: { ...base, id: collisionId, transactionId: "fixture-finance-collision", attributionStatus: "QUARANTINED", quarantineReason: "UNKNOWN_SITE", classification: "UNATTRIBUTED", conversionStatus: "QUARANTINED", rowHash: digest("collision") } });
    try {
      assert.equal((await call()).status, 500);
      assert.equal(await prisma.amazonFinanceRecord.count({ where: { ...scope, sourceId, transactionId: { in: replica.rows.map(row => row.transactionId) } } }), 0);
      assert.equal(await prisma.amazonSyncRun.count({ where: { ...scope, sourceId, trigger: "cloud-replica" } }), 0);
    } finally { await prisma.amazonFinanceRecord.delete({ where: { id: collisionId } }); }
    const imported = await call(); assert.equal(imported.status, 200, await imported.clone().text());
    assert.equal((await imported.json()).inserted, 4);
    const replay = await call(); assert.equal(replay.status, 200, await replay.clone().text()); assert.equal((await replay.json()).replayed, true);
    const stored = await prisma.amazonFinanceRecord.findFirstOrThrow({ where: { ...scope, sourceId, transactionId: "FIN-REPLICA-A" }, include: { task: true } });
    assert.equal(stored.amount!.toFixed(), tiny);
    assert.equal(stored.convertedAmount!.toFixed(), replica.rows[0].convertedAmount);
    assert.deepEqual(stored.fxEvidence, { futureEvidence: { extra: "1.2300" } });
    assert.equal(stored.task.stage, "REPLICA_PAGE_COMMITTED"); assert.equal(stored.task.requestedByUserId, user);
    assert.equal(await prisma.amazonFinanceQuarantine.count({ where: { ...scope, record: { sourceId } } }), 0);
    assert.equal(await prisma.amazonSyncResourceCursor.count({ where: { ...scope, sourceId } }), 0);
    const after = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sourceId } });
    assert.equal(after.activeRunId, source.activeRunId); assert.equal(after.lastSuccessAt?.toISOString(), source.lastSuccessAt?.toISOString());
    const { digest: unused, ...body } = replica; void unused;
    const conflict = { ...body, rows: body.rows.map(row => ({ ...row, rawStatus: row.attributionStatus === "ATTRIBUTED" ? "CONFLICT" : null })) };
    await assert.rejects(publishFinanceReplica(scope, user, { ...conflict, digest: digest(conflict) }, { sourceId, revision: source.revision }), /同一财务观察版本/);
    const older = { ...body, rows: body.rows.map(row => ({ ...row, observationSequence: 1 })) };
    assert.equal((await publishFinanceReplica(scope, user, { ...older, digest: digest(older) }, { sourceId, revision: source.revision })).skipped, 4);
    const newer = { ...body, rows: body.rows.map(row => ({ ...row, observationSequence: 3, rowHash: digest([row.rowHash, 3]) })) };
    assert.equal((await publishFinanceReplica(scope, user, { ...newer, digest: digest(newer) }, { sourceId, revision: source.revision })).updated, 4);
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    const query = { sellerAccountId: sellerA, sourceId, from: "2026-11-01", to: "2026-11-03" };
    const erp = await erpRead(new Request(url("/api/operations/sync-center", { ...query, section: "finance" }), { headers: { cookie } }));
    assert.equal(erp.status, 200, await erp.clone().text());
    const erpBody = await erp.json(); assert.equal(erpBody.rows.length, 2); assert.equal(erpBody.quarantinedCount, 1); assert.equal(erpBody.financialFinal, false);
    assert.ok(JSON.stringify(erpBody).includes("-2.3400")); assert.ok(!JSON.stringify(erpBody).includes("ciphertext"));
    const identity = await authenticateAmazonMcp(`Bearer ${token}`);
    const nativeQuery = { ...query, marketplaceId: site };
    const native = await invokeAmazonMcp(identity, "finance_get_transactions", nativeQuery);
    assert.ok(JSON.stringify(native).includes("1e-30"));
    const lili = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 91, method: "tools/call", params: { name: "erp__finance_get_transactions", arguments: nativeQuery } }) }), ["mcp"]);
    const liliBody = await lili.json(); assert.ok(!liliBody.error && !liliBody.result?.isError, JSON.stringify(liliBody)); assert.ok(JSON.stringify(liliBody).includes("FIN-REPLICA-A"));
    await assert.rejects(invokeAmazonMcp(identity, "finance_get_transactions", { ...nativeQuery, sellerAccountId: sellerB }));
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "REVOKED" } });
    const invalidAuth = await erpRead(new Request(url("/api/operations/sync-center", { ...query, section: "finance" }), { headers: { cookie } }));
    assert.equal(invalidAuth.status, 409);
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    await assert.rejects(invokeAmazonMcp(identity, "finance_get_transactions", nativeQuery));
    const revoked = await erpRead(new Request(url("/api/operations/sync-center", { ...query, section: "finance" }), { headers: { cookie } })); assert.equal(revoked.status, 403);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorRole === undefined) delete process.env.AMAZON_API_EXECUTION_ROLE; else process.env.AMAZON_API_EXECUTION_ROLE = priorRole;
    if (priorUrl === undefined) delete process.env.AMAZON_CLOUD_EXECUTOR_URL; else process.env.AMAZON_CLOUD_EXECUTOR_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.AMAZON_CLOUD_BRIDGE_SECRET; else process.env.AMAZON_CLOUD_BRIDGE_SECRET = priorSecret;
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
  }
});

test("finance replica pages exceed 500 facts with bounded batches, replay, tamper and generation fences", async () => {
  const priorRole = process.env.AMAZON_API_EXECUTION_ROLE, priorUrl = process.env.AMAZON_CLOUD_EXECUTOR_URL, priorSecret = process.env.AMAZON_CLOUD_BRIDGE_SECRET, priorFetch = globalThis.fetch;
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, resource: "finance", sellerAccountId: sellerA } });
  const sourceId = source.id, run = randomUUID(), capturedAt = new Date("2026-11-05T00:00:00.000Z");
  await prisma.amazonSyncRun.create({ data: { ...scope, id: run, sourceId, resource: "finance", mode: "incremental", requestedByUserId: user, executionVersion: 2, status: "SUCCEEDED", stage: "PAGE_COMMIT" } });
  const records = Array.from({ length: 1001 }, (_, index) => ({ ...scope, id: randomUUID(), sourceId, sourceRunId: run, sellerAccountId: sellerA, amazonSellerId: "FIXTURE-SELLER", transactionId: `PAGED-${String(index).padStart(4, "0")}`, marketplaceId: site, marketplaceTimeZone: "America/Los_Angeles", attributionStatus: "ATTRIBUTED", classification: "NON_ORDER", originalAmount: "0.000000000000000000000000000001", amount: "0.000000000000000000000000000001", currency: "USD", conversionStatus: "UNCONVERTED", observationSequence: 4, rowHash: digest(index), postedAt: capturedAt, capturedAt }));
  await prisma.amazonFinanceRecord.createMany({ data: records });
  process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://cloud.fixture.invalid";
  process.env.AMAZON_CLOUD_BRIDGE_SECRET = "offline-fixture-finance-page-secret-with-32-bytes";
  const cloudPage = async (cursor?: string) => {
    const envelope = createCloudRelayEnvelope(scope, user, { kind: "finance-replica-page", sourceId, ...(cursor === undefined ? {} : { cursor }) });
    return cloudExecute(new Request(envelope.audience, { method: "POST", headers: { "content-type": "application/json", "x-amazon-cloud-signature": cloudRelaySignature(envelope) }, body: JSON.stringify(envelope) }));
  };
  try {
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    const largeEvidence = { futureEvidence: "x".repeat(260 * 1024) };
    await prisma.amazonFinanceRecord.updateMany({ where: { id: { in: records.slice(0, 2).map(row => row.id) } }, data: { conversionStatus: "CONVERTED", convertedAmount: "1.23", convertedCurrency: "CNY", fxEvidence: largeEvidence } });
    const bounded = await cloudPage(); assert.equal(bounded.status, 200, await bounded.clone().text());
    const boundedBody = await bounded.json();
    assert.ok(boundedBody.nextCursor); assert.ok(boundedBody.replica.rows.length < 500);
    assert.equal(boundedBody.replica.rows.find((row: { transactionId: string }) => row.transactionId === records[0].transactionId).fxEvidence.futureEvidence.length, 260 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(boundedBody)) < 512 * 1024);
    await prisma.amazonFinanceRecord.updateMany({ where: { id: { in: records.slice(0, 2).map(row => row.id) } }, data: { conversionStatus: "UNCONVERTED", convertedAmount: null, convertedCurrency: null, fxEvidence: Prisma.DbNull } });
    const first = await cloudPage(); assert.equal(first.status, 200, await first.clone().text());
    type Page = { replica: FinanceReplica; nextCursor: string | null; totalRows: number; generation: string; sourceRevision: number; transferComplete: boolean };
    const page1 = await first.json() as Page;
    assert.equal(page1.replica.rows.length, 500); assert.equal(page1.transferComplete, false); assert.ok(page1.nextCursor);
    assert.equal((await cloudPage(page1.nextCursor + "x")).status, 409);
    await prisma.amazonFinanceRecord.update({ where: { id: records[0].id }, data: { capturedAt: new Date("2099-11-06T00:00:00.000Z") } });
    assert.equal((await cloudPage(page1.nextCursor)).status, 409);
    await prisma.amazonFinanceRecord.update({ where: { id: records[0].id }, data: { capturedAt } });
    const second = await cloudPage(page1.nextCursor); assert.equal(second.status, 200, await second.clone().text());
    const page2 = await second.json() as Page; assert.equal(page2.replica.rows.length, 500); assert.ok(page2.nextCursor);
    const third = await cloudPage(page2.nextCursor); assert.equal(third.status, 200, await third.clone().text());
    const page3 = await third.json() as Page;
    assert.equal(page3.transferComplete, true); assert.equal(page3.nextCursor, null);
    const ids = [page1, page2, page3].flatMap(page => page.replica.rows.map(row => row.transactionId));
    assert.equal(new Set(ids).size, page1.totalRows); assert.equal(ids.length, page1.totalRows);
    // Only fixture rows are removed to stage the captured cloud pages in this
    // disposable DB. No real Amazon service or independently deployed host used.
    await prisma.amazonFinanceRecord.deleteMany({ where: { ...scope, sourceId, transactionId: { in: records.map(row => row.transactionId) } } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    assert.equal((await cloudPage(page1.nextCursor)).status, 403);
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    process.env.AMAZON_API_EXECUTION_ROLE = "local";
    globalThis.fetch = async (_input, init) => {
      const envelope = verifyCloudRelayEnvelope(JSON.parse(String(init?.body)), new Headers(init?.headers).get("x-amazon-cloud-signature"));
      assert.equal(envelope.actorUserId, user); assert.equal(envelope.operation.kind, "finance-replica-page");
      const cursor = (envelope.operation as { cursor?: string }).cursor;
      const page = cursor === undefined ? page1 : cursor === page1.nextCursor ? page2 : cursor === page2.nextCursor ? page3 : null;
      assert.ok(page);
      return Response.json({ ...page, requestId: envelope.requestId, executionLocation: "cloud" });
    };
    const localPage = (cursor?: string) => pullReplica(new Request(url("/api/operations/sync-center/replica", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ sourceId, resource: "finance", paginated: true, ...(cursor === undefined ? {} : { cursor }) }) }));
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: { operations: ["create"] } } });
    for (const cursor of [undefined, undefined, page1.nextCursor, page2.nextCursor]) {
      const imported = await localPage(cursor!); assert.equal(imported.status, 200, await imported.clone().text());
      const receipt = await imported.json(); assert.equal(receipt.amazonApiCalled, false);
      assert.equal(receipt.transferComplete, cursor === page2.nextCursor);
    }
    assert.equal(await prisma.amazonFinanceRecord.count({ where: { ...scope, sourceId, transactionId: { in: records.map(row => row.transactionId) } } }), 1001);
    const identity = await authenticateAmazonMcp(`Bearer ${token}`);
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    const native = await invokeAmazonMcp(identity, "finance_get_transactions", { sellerAccountId: sellerA, marketplaceId: site, sourceId, from: "2026-11-05", to: "2026-11-06", pageSize: 10 });
    assert.ok(JSON.stringify(native).includes("PAGED-"));
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: { operations: ["create"] } } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    await assert.rejects(invokeAmazonMcp(identity, "finance_get_transactions", { sellerAccountId: sellerA, marketplaceId: site, sourceId }));
    assert.equal((await localPage(page1.nextCursor!)).status, 403);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorRole === undefined) delete process.env.AMAZON_API_EXECUTION_ROLE; else process.env.AMAZON_API_EXECUTION_ROLE = priorRole;
    if (priorUrl === undefined) delete process.env.AMAZON_CLOUD_EXECUTOR_URL; else process.env.AMAZON_CLOUD_EXECUTOR_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.AMAZON_CLOUD_BRIDGE_SECRET; else process.env.AMAZON_CLOUD_BRIDGE_SECRET = priorSecret;
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
  }
});

test("order pages transfer over 500 orders with whole item sets and detect item changes without timestamp changes", async () => {
  const priorRole = process.env.AMAZON_API_EXECUTION_ROLE, priorUrl = process.env.AMAZON_CLOUD_EXECUTOR_URL, priorSecret = process.env.AMAZON_CLOUD_BRIDGE_SECRET, priorFetch = globalThis.fetch;
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, resource: "orders", sellerAccountId: sellerA } });
  const sourceId = source.id, run = randomUUID(), capturedAt = new Date("2026-11-05T00:00:00.000Z");
  await prisma.amazonSyncRun.create({ data: { ...scope, id: run, sourceId, resource: "orders", mode: "incremental", requestedByUserId: user, executionVersion: 2, status: "SUCCEEDED", stage: "PAGE_COMMIT" } });
  const records = Array.from({ length: 1001 }, (_, index) => ({ ...scope, id: randomUUID(), sourceId, sourceRunId: run, sellerAccountId: sellerA, amazonSellerId: "FIXTURE-SELLER", marketplaceId: site, amazonOrderId: `ORDER-PAGED-${String(index).padStart(4, "0")}`, createdTime: capturedAt, sourceUpdatedAt: capturedAt, capturedAt, detailsUpdatedAt: capturedAt, marketplaceTimeZone: "America/Los_Angeles", rawStatus: "FUTURE_STATUS", grandTotalOriginal: "0.000000000000000000000000000001", grandTotalAmount: "0.000000000000000000000000000001", currencyCode: "USD", detailCiphertext: "never-transfer-page-private-envelope" }));
  await prisma.amazonOrderRecord.createMany({ data: records });
  await prisma.amazonOrderItemRecord.createMany({ data: records.flatMap(record => Array.from({ length: 3 }, (_, index) => ({ ...scope, sourceId, orderRecordId: record.id, orderItemId: `item-${index}`, quantityOrdered: 2, sellerSku: "PAGE-ITEM-SKU", proceedsOriginal: "0.000000000000000000000000000001", proceedsAmount: "0.000000000000000000000000000001", currencyCode: "USD" }))) });
  process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://cloud.fixture.invalid";
  process.env.AMAZON_CLOUD_BRIDGE_SECRET = "offline-fixture-order-page-secret-with-32-bytes";
  const cloudPage = async (cursor?: string) => {
    const envelope = createCloudRelayEnvelope(scope, user, { kind: "orders-replica-page", sourceId, ...(cursor === undefined ? {} : { cursor }) });
    return cloudExecute(new Request(envelope.audience, { method: "POST", headers: { "content-type": "application/json", "x-amazon-cloud-signature": cloudRelaySignature(envelope) }, body: JSON.stringify(envelope) }));
  };
  try {
    process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
    const oversized = Array.from({ length: 1001 }, (_, index) => ({ ...scope, sourceId, orderRecordId: records[0].id, orderItemId: `oversized-${index}`, quantityOrdered: 1 }));
    await prisma.amazonOrderItemRecord.createMany({ data: oversized });
    assert.equal((await cloudPage()).status, 409);
    await prisma.amazonOrderItemRecord.deleteMany({ where: { ...scope, orderRecordId: records[0].id, orderItemId: { in: oversized.map(item => item.orderItemId) } } });
    type Page = { replica: OrderReplica; nextCursor: string | null; totalRows: number; generation: string; sourceRevision: number; transferComplete: boolean };
    const first = await cloudPage(); assert.equal(first.status, 200, await first.clone().text());
    const original = await first.json() as Page;
    assert.ok(original.nextCursor); assert.ok(original.replica.rows.length < 500);
    const firstItems = original.replica.rows.reduce((count, row) => count + row.items.length, 0);
    assert.ok(firstItems <= 1000);
    await prisma.amazonOrderItemRecord.update({ where: { orderRecordId_orderItemId: { orderRecordId: records[0].id, orderItemId: "item-0" } }, data: { quantityOrdered: 3 } });
    assert.equal((await cloudPage(original.nextCursor)).status, 409);
    const pages: Array<{ cursor?: string; page: Page }> = [];
    let cursor: string | undefined;
    do {
      const response = await cloudPage(cursor); assert.equal(response.status, 200, await response.clone().text());
      const page = await response.json() as Page;
      assert.ok(page.replica.rows.length <= 500);
      assert.ok(page.replica.rows.reduce((count, row) => count + row.items.length, 0) <= 1000);
      assert.ok(!JSON.stringify(page).includes("never-transfer-page-private-envelope"));
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < 512 * 1024);
      pages.push({ cursor, page }); cursor = page.nextCursor ?? undefined;
      assert.ok(pages.length < 10);
    } while (cursor);
    assert.ok(pages.length > 2);
    const ids = pages.flatMap(({ page }) => page.replica.rows.map(row => row.amazonOrderId));
    assert.equal(ids.length, pages[0].page.totalRows); assert.equal(new Set(ids).size, ids.length);
    assert.equal((await cloudPage(pages[0].page.nextCursor + "x")).status, 409);
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    assert.equal((await cloudPage(pages[0].page.nextCursor!)).status, 403);
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    // Stage cloud payloads into empty local fixture projections in one disposable
    // DB; this is not a deployed-host or real Amazon acceptance test.
    await prisma.amazonOrderItemRecord.deleteMany({ where: { ...scope, sourceId, orderRecordId: { in: records.map(record => record.id) } } });
    await prisma.amazonOrderRecord.deleteMany({ where: { ...scope, sourceId, id: { in: records.map(record => record.id) } } });
    process.env.AMAZON_API_EXECUTION_ROLE = "local";
    globalThis.fetch = async (_input, init) => {
      const envelope = verifyCloudRelayEnvelope(JSON.parse(String(init?.body)), new Headers(init?.headers).get("x-amazon-cloud-signature"));
      assert.equal(envelope.actorUserId, user); assert.equal(envelope.operation.kind, "orders-replica-page");
      const part = pages.find(item => item.cursor === (envelope.operation as { cursor?: string }).cursor); assert.ok(part);
      return Response.json({ ...part.page, requestId: envelope.requestId, executionLocation: "cloud" });
    };
    const localPage = (cursor?: string) => pullReplica(new Request(url("/api/operations/sync-center/replica", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ sourceId, resource: "orders", paginated: true, ...(cursor === undefined ? {} : { cursor }) }) }));
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: { operations: ["create"] } } });
    for (const part of [pages[0], ...pages]) {
      const response = await localPage(part.cursor); assert.equal(response.status, 200, await response.clone().text());
      const receipt = await response.json(); assert.equal(receipt.amazonApiCalled, false);
      assert.equal(receipt.transferComplete, part.page.transferComplete);
    }
    const imported = await prisma.amazonOrderRecord.findMany({ where: { ...scope, sourceId, amazonOrderId: { in: records.map(record => record.amazonOrderId) } }, include: { items: true } });
    assert.equal(imported.length, 1001); assert.equal(imported.reduce((count, order) => count + order.items.length, 0), 3003);
    assert.ok(imported.every(order => order.items.length === 3 && order.detailCiphertext === null));
    assert.equal(imported.find(order => order.amazonOrderId === records[0].amazonOrderId)!.items.find(item => item.orderItemId === "item-0")!.quantityOrdered, 3);
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    const query = { sellerAccountId: sellerA, marketplaceId: site, sourceId, from: "2026-11-05", to: "2026-11-06", pageSize: 10 };
    const erp = await erpRead(new Request(url("/api/operations/sync-center", { ...query, pageSize: "10", section: "orders" }), { headers: { cookie } }));
    assert.equal(erp.status, 200, await erp.clone().text()); assert.equal((await erp.json()).pagination.total, 1001);
    const identity = await authenticateAmazonMcp(`Bearer ${token}`);
    assert.ok(JSON.stringify(await invokeAmazonMcp(identity, "orders_get_items", query)).includes("PAGE-ITEM-SKU"));
    const lili = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 101, method: "tools/call", params: { name: "erp__orders_search", arguments: query } }) }), ["mcp"]);
    const liliBody = await lili.json(); assert.ok(!liliBody.error && !liliBody.result?.isError, JSON.stringify(liliBody)); assert.ok(JSON.stringify(liliBody).includes("PAGE-ITEM-SKU"));
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: { operations: ["create"] } } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    assert.equal((await localPage(pages[0].page.nextCursor!)).status, 403);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorRole === undefined) delete process.env.AMAZON_API_EXECUTION_ROLE; else process.env.AMAZON_API_EXECUTION_ROLE = priorRole;
    if (priorUrl === undefined) delete process.env.AMAZON_CLOUD_EXECUTOR_URL; else process.env.AMAZON_CLOUD_EXECUTOR_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.AMAZON_CLOUD_BRIDGE_SECRET; else process.env.AMAZON_CLOUD_BRIDGE_SECRET = priorSecret;
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
  }
});

test("stored export files recheck single-account assignment and official OAuth before status and after cached storage reads", async () => {
  const sourceId = randomUUID(), jobId = randomUUID(), fileId = randomUUID();
  await prisma.amazonSyncDataSource.create({ data: { ...scope, id: sourceId, authorizationId: auth, sellerAccountId: sellerA, marketplaceId: site, resource: "sales_traffic", freshnessMinutes: 60 } });
  await prisma.fileObject.create({ data: { ...scope, id: fileId, userId: user, originalName: "fixture-export.jsonl", mimeType: "application/x-ndjson", size: 20, storageType: "local", storageKey: `fixture-no-file/${jobId}` } });
  const frozen = { sellerAccountId: sellerA, marketplaceId: site, _scopeSellerIds: [sellerA], _scopeSourceIds: [sourceId], _scopeAll: false };
  await prisma.amazonDataExport.create({ data: { ...scope, id: jobId, requestedByUserId: user, idempotencyKey: randomUUID(), query: frozen, cutoff: new Date(), status: "SUCCEEDED", fileId, rowCount: 1 } });
  const storage = getStorageDriver(), originalRead = storage.getBuffer;
  let storageReads = 0, revokeInStorage = false;
  storage.getBuffer = async () => {
    storageReads++;
    if (revokeInStorage) await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    return Buffer.from('{"futureBusinessField":"1.2300","nullable":null}\n');
  };
  const call = (download = true, id = jobId) => exportRead(new Request(url("/api/operations/sync-center/exports", { id, ...(download ? { download: "1" } : {}) }), { headers: { cookie } }));
  try {
    const download = await call(); assert.equal(download.status, 200, await download.clone().text());
    assert.equal(download.headers.get("cache-control"), "no-store");
    assert.ok((await download.text()).includes('"futureBusinessField":"1.2300"'));
    assert.equal((await call(false)).status, 200);
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "REVOKED" } });
    const authError = await call(); assert.equal(authError.status, 409); assert.equal((await authError.json()).code, "AMAZON_AUTHORIZATION_INVALID");
    const before = storageReads;
    assert.equal((await call(false)).status, 409); assert.equal(storageReads, before);
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
    revokeInStorage = true;
    const inflight = await call(); assert.equal(inflight.status, 403); assert.ok(!(await inflight.text()).includes("futureBusinessField"));
    revokeInStorage = false;
    // Owner role cannot reuse a cached file after its explicit account grant is revoked.
    await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: user } }, data: { role: "owner" } });
    assert.equal((await call()).status, 403); assert.equal((await call(false)).status, 403);
    await assert.rejects(prisma.$transaction(tx => assertExportJobAccess(tx, scope, user, frozen)));
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonDataExport.update({ where: { id: jobId }, data: { query: { ...frozen, _scopeSellerIds: [sellerA, sellerB] } } });
    assert.equal((await call(false)).status, 403);
    await prisma.amazonDataExport.update({ where: { id: jobId }, data: { query: { ...frozen, sellerAccountId: sellerB } } });
    assert.equal((await call(false)).status, 403);
    await prisma.amazonDataExport.update({ where: { id: jobId }, data: { query: frozen } });
    const other = randomUUID();
    await prisma.user.create({ data: { id: other, name: "Other export reader", email: `${other}@fixture.invalid`, passwordHash: "not-a-login", memberships: { create: { organizationId: scope.organizationId, role: "viewer" } } } });
    await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId: other, sellerAccountId: sellerA, actions: [], marketplaceIds: [], mcpEnabled: false } });
    const otherSession = await createSession(other), otherCookie = `${otherSession.sessionCookie.name}=${otherSession.sessionCookie.value}`;
    const foreign = await exportRead(new Request(url("/api/operations/sync-center/exports", { id: jobId, download: "1" }), { headers: { cookie: otherCookie } }));
    assert.equal(foreign.status, 404);
  } finally {
    storage.getBuffer = originalRead;
    await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: user } }, data: { role: "viewer" } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
  }
});

test("finance DTO preserves exact amounts and unknown nested evidence; generic catalog strips secrets without hiding business fields", async () => {
  const finance = await prisma.amazonFinanceRecord.findFirstOrThrow({ where: { ...scope, transactionId: "FIN-REPLICA-A" } });
  const tiny = "0.000000000000000000000000000001";
  await prisma.amazonFinanceRecord.update({ where: { id: finance.id }, data: { rawStatus: "FIELD_TEST", convertedAmount: tiny, fxEvidence: { futureMetric: "900719925474099312345", futureObject: { nullable: null, ratios: ["1.2300", null], refreshToken: "never-return-finance-secret" } } } });
  const query = { sellerAccountId: sellerA, marketplaceId: site, sourceId: finance.sourceId, rawStatus: "FIELD_TEST", from: "2026-11-01", to: "2026-11-03", pageSize: "1" };
  const erp = await erpRead(new Request(url("/api/operations/sync-center", { ...query, section: "finance" }), { headers: { cookie } }));
  assert.equal(erp.status, 200, await erp.clone().text());
  const body = await erp.json(), row = body.rows.find((item: { transactionId: string }) => item.transactionId === "FIN-REPLICA-A");
  assert.equal(row.amount, tiny); assert.equal(row.convertedAmount, tiny);
  assert.equal(row.fxEvidence.futureMetric, "900719925474099312345"); assert.equal(row.fxEvidence.futureObject.nullable, null);
  assert.ok(!JSON.stringify(body).includes("never-return-finance-secret"));
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  const mcp = await invokeAmazonMcp(identity, "finance_get_transactions", { ...query, pageSize: 1 });
  assert.ok(JSON.stringify(mcp).includes('"amount":"' + tiny + '"'));
  assert.ok(JSON.stringify(mcp).includes("900719925474099312345")); assert.ok(!JSON.stringify(mcp).includes("refreshToken"));
  const liliFields = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 111, method: "tools/call", params: { name: "erp__finance_get_transactions", arguments: { ...query, pageSize: 1 } } }) }), ["mcp"]);
  const liliFieldsBody = await liliFields.json();
  assert.ok(!liliFieldsBody.error && !liliFieldsBody.result?.isError, JSON.stringify(liliFieldsBody));
  assert.ok(JSON.stringify(liliFieldsBody).includes("900719925474099312345")); assert.ok(!JSON.stringify(liliFieldsBody).includes("never-return-finance-secret"));
  const otherSiteQuery = { sellerAccountId: sellerA, marketplaceId: "A2EUQ1WTGCTBG2", sourceId: finance.sourceId, from: "2026-11-01", to: "2026-11-03" };
  const financeSite = await invokeAmazonMcp(identity, "finance_get_transactions", otherSiteQuery);
  assert.ok(JSON.stringify(financeSite).includes("FIN-REPLICA-B"));
  const financeGeneric = await erpRead(new Request(url("/api/operations/sync-center", { ...otherSiteQuery, section: "data", table: "finance_transactions" }), { headers: { cookie } }));
  assert.equal(financeGeneric.status, 200, await financeGeneric.clone().text()); assert.ok((await financeGeneric.text()).includes("FIN-REPLICA-B"));
  const catalogSource = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, resource: "catalog", sellerAccountId: sellerA } });
  await prisma.amazonCatalogSnapshot.updateMany({ where: { ...scope, sourceRunId: catalogSource.activeRunId! }, data: { listingAttributes: { futureField: { value: "1.2300", nullable: null, clientSecret: "never-return-catalog-secret" } }, fieldSources: { futureField: { api: "fixture-api", nested: { future: true, accessToken: "never-return-source-secret" } } } } });
  const catalogQuery = { sellerAccountId: sellerA, marketplaceId: site, table: "listings", pageSize: "1" };
  const listing = await erpRead(new Request(url("/api/operations/sync-center", { ...catalogQuery, section: "data" }), { headers: { cookie } }));
  assert.equal(listing.status, 200, await listing.clone().text());
  const listingBody = await listing.json();
  assert.ok(JSON.stringify(listingBody).includes('"futureField"')); assert.ok(JSON.stringify(listingBody).includes('"fieldSources"'));
  assert.ok(!JSON.stringify(listingBody).includes("never-return-"));
  const catalogMcp = await invokeAmazonMcp(identity, "data_query", { ...catalogQuery, pageSize: 1 });
  assert.ok(JSON.stringify(catalogMcp).includes("fixture-api")); assert.ok(!JSON.stringify(catalogMcp).includes("never-return-"));
  await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
  try {
    const next = await erpRead(new Request(url("/api/operations/sync-center", { ...query, section: "finance", page: "2" }), { headers: { cookie } })); assert.equal(next.status, 403);
    const cachedListing = await erpRead(new Request(url("/api/operations/sync-center", { ...catalogQuery, section: "data", page: "2" }), { headers: { cookie } })); assert.equal(cachedListing.status, 403);
    await assert.rejects(invokeAmazonMcp(identity, "finance_get_transactions", { ...query, pageSize: 1, page: 2 }));
    await assert.rejects(invokeAmazonMcp(identity, "amazon.data.archive.read", { ...args, sourceId: archiveSource, taskId: archiveTask, rawPage: 1, page: 2 }));
  } finally { await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } }); }
});

test("snapshot history and brand readers enforce official authorization and explicit account assignment even for owners", async () => {
  const brandSource = randomUUID();
  await prisma.amazonSyncDataSource.create({ data: { ...scope, id: brandSource, authorizationId: auth, sellerAccountId: sellerA, marketplaceId: site, resource: "brand_analytics", freshnessMinutes: 60 } });
  const snapshot = () => erpRead(new Request(url("/api/operations/sync-center", { ...args, section: "snapshots", id: archiveTask }), { headers: { cookie } }));
  const brandParams = new URLSearchParams({ ...args, sourceId: brandSource, reportKind: "search_terms" });
  assert.equal((await snapshot()).status, 200);
  await readBrandAnalytics(scope, brandParams, user);
  const tampered = await erpRead(new Request(url("/api/operations/sync-center", { ...args, sellerAccountId: sellerB, section: "snapshots", id: archiveTask }), { headers: { cookie } })); assert.equal(tampered.status, 403);
  await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "REVOKED" } });
  try {
    const result = await snapshot(); assert.equal(result.status, 409); assert.equal((await result.json()).code, "AMAZON_AUTHORIZATION_INVALID");
    await assert.rejects(readBrandAnalytics(scope, brandParams, user), (error: unknown) => error instanceof AmazonReadError && error.businessCode === "AMAZON_AUTHORIZATION_INVALID");
    await assert.rejects(readBrandAsins(scope, brandSource, user), (error: unknown) => error instanceof AmazonReadError && error.businessCode === "AMAZON_AUTHORIZATION_INVALID");
    await assert.rejects(readBrandAsinAnalysis(scope, new URLSearchParams({ ...Object.fromEntries(brandParams), asin: "B000000001" }), user), (error: unknown) => error instanceof AmazonReadError && error.businessCode === "AMAZON_AUTHORIZATION_INVALID");
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
    await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: user } }, data: { role: "owner" } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    assert.equal((await snapshot()).status, 403);
    await assert.rejects(readBrandAnalytics(scope, brandParams, user));
  } finally {
    await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: user } }, data: { role: "viewer" } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
  }
});

test("revocation plus replacement assignment cannot release an inferred account's finance snapshot", async () => {
  const client = (globalThis as unknown as { prisma: typeof prisma }).prisma;
  const transaction = client.$transaction;
  const replacementGrant = randomUUID(), replacementSource = randomUUID(), replacementAuth = randomUUID();
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: replacementAuth, name: "Replacement fixture", amazonSellerId: "FIXTURE-SELLER-B", awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", credentialsCiphertext: "never-decrypted", updatedByUserId: user, status: "CONFIGURED", identityVerifiedAt: new Date() } });
  await prisma.amazonSyncDataSource.create({ data: { ...scope, id: replacementSource, authorizationId: replacementAuth, sellerAccountId: sellerB, marketplaceId: site, resource: "finance", freshnessMinutes: 60 } });
  let committed = false;
  client.$transaction = (async (...args: Parameters<typeof transaction>) => {
    const value = await transaction.apply(client, args);
    committed = true;
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: replacementGrant, userId: user, sellerAccountId: sellerB } });
    return value;
  }) as typeof transaction;
  try {
    const params = new URLSearchParams();
    await assert.rejects(readFinance(scope, params, user));
    assert.equal(params.has("sellerAccountId"), false, "reader must not mutate caller parameters");
    assert.equal(committed, true);
  } finally {
    client.$transaction = transaction;
    await prisma.amazonDataAccessGrant.deleteMany({ where: { id: replacementGrant } });
    await prisma.amazonSyncDataSource.delete({ where: { id: replacementSource } });
    await prisma.amazonSpApiAuthorization.delete({ where: { id: replacementAuth } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
  }
});

test("legacy inventory/products and cached product images inherit account grants without module permissions or signed storage redirects", async () => {
  const inventory = () => legacyInventoryRead(new Request(url("/api/operations/inventory/snapshots", args), { headers: { cookie } }));
  const products = () => legacyProductsRead(new Request(url("/api/operations/products", args), { headers: { cookie } }));
  const inventoryResult = await inventory(); assert.equal(inventoryResult.status, 200, await inventoryResult.clone().text());
  const productsResult = await products(); assert.equal(productsResult.status, 200, await productsResult.clone().text());
  const tampered = await legacyInventoryRead(new Request(url("/api/operations/inventory/snapshots", { ...args, sellerAccountId: sellerB }), { headers: { cookie } })); assert.equal(tampered.status, 403);
  const fileId = randomUUID(), blobId = randomUUID();
  await prisma.fileObject.create({ data: { ...scope, id: fileId, userId: user, originalName: "fixture-image.webp", mimeType: "image/webp", size: 4, storageType: "s3", storageKey: "fixture-image-not-stored", status: "done" } });
  await prisma.amazonCatalogImageBlob.create({ data: { ...scope, id: blobId, contentHash: digest(fileId), fileId, width: 1, height: 1, size: 4 } });
  await prisma.amazonCatalogImageReference.create({ data: { ...scope, id: randomUUID(), sellerAccountId: sellerA, marketplaceId: site, asin: "B000000001", sourceResource: "catalog_items", sourceRunId: archiveTask, sourceUrl: "https://fixture.invalid/image.webp", blobId, capturedAt: new Date() } });
  const storage = getStorageDriver(), original = storage.getBoundedBuffer;
  let revokeInStorage = false, reads = 0;
  storage.getBoundedBuffer = async () => {
    reads++;
    if (revokeInStorage) await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    return Buffer.from("RIFF");
  };
  const image = (seller = sellerA) => productImageRead(new Request(url(`/api/operations/products/images/${fileId}`, { sellerAccountId: seller, marketplaceId: site }), { headers: { cookie } }), { params: Promise.resolve({ fileId }) });
  try {
    const result = await image(); assert.equal(result.status, 200); assert.equal(result.headers.get("location"), null); assert.equal(result.headers.get("cache-control"), "no-store"); assert.equal(await result.text(), "RIFF");
    assert.equal((await image(sellerB)).status, 404); assert.equal(reads, 1);
    revokeInStorage = true;
    const inflight = await image(); assert.equal(inflight.status, 404); assert.equal(await inflight.text(), "");
    assert.equal((await inventory()).status, 403); assert.equal((await products()).status, 403);
    revokeInStorage = false;
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "REVOKED" } });
    const invalid = await inventory(); assert.equal(invalid.status, 409); assert.equal((await invalid.json()).code, "AMAZON_AUTHORIZATION_INVALID");
    assert.equal((await products()).status, 409);
    const invalidImage = await image(); assert.equal(invalidImage.status, 409); assert.equal((await invalidImage.json()).code, "AMAZON_AUTHORIZATION_INVALID");
  } finally {
    storage.getBoundedBuffer = original;
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
  }
});

test("saved replenishment and readiness routes read one assigned account without module grants", async () => {
  const policyId = randomUUID();
  const inputs = { lifecycle: "NEW", productionDays: null, domesticDays: null, oceanDays: null, safetyDays: 14, reviewDays: 30, newProductDailyUnits: 1, salesHistory: [], receipts: [], seasonality: null, sourceNote: "fixture", futureInput: { precise: "9007199254740993", nullable: null, accessToken: "never-plan-secret" } };
  await prisma.amazonReplenishmentPolicy.createMany({ data: [sellerA, sellerB].map((sellerAccountId, i) => ({ ...scope, id: i ? randomUUID() : policyId, sellerAccountId, marketplaceId: site, sellerSku: "SAME-PLAN-SKU", inputs, updatedByUserId: user })) });
  await prisma.amazonReplenishmentPlan.create({ data: { ...scope, id: randomUUID(), policyId, sellerAccountId: sellerA, marketplaceId: site, sellerSku: "SAME-PLAN-SKU", policyUpdatedAt: new Date(), inputSnapshot: { future: { decimal: "0.000000000000000001", nullable: null, refreshToken: "never-plan-secret" } }, result: { status: "NEEDS_DATA", futureMetric: "9007199254740993" }, generatedAt: new Date(), nextCalculationAt: new Date() } });
  const routes = [["replenishment", replenishmentRead], ["readiness", readinessRead], ["freshness", freshnessRead]] as const;
  const call = (name: string, route: typeof replenishmentRead, account = sellerA) => route(new Request(url(`/api/operations/${name}`, { sellerAccountId: account }), { headers: { cookie } }));
  for (const [name, route] of routes) {
    const result = await call(name, route); assert.equal(result.status, 200, await result.clone().text()); assert.equal(result.headers.get("cache-control"), "no-store");
    const body = await result.json();
    if (name === "replenishment") {
      assert.equal(body.rows.length, 1); assert.equal(body.rows[0].sellerAccountId, sellerA); assert.equal(body.canEdit, false);
      assert.deepEqual(body.rows[0].inputs.futureInput, { precise: "9007199254740993", nullable: null });
      assert.deepEqual(body.rows[0].plan.inputSnapshot.future, { decimal: "0.000000000000000001", nullable: null });
      assert.equal(body.rows[0].plan.result.futureMetric, "9007199254740993"); assert.ok(!JSON.stringify(body).includes("never-plan-secret"));
    } else assert.equal(body.inventory.fulfillableQuantity, 7);
    assert.equal((await call(name, route, sellerB)).status, 403);
  }
  const secondGrant = randomUUID();
  await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: secondGrant, userId: user, sellerAccountId: sellerB } });
  try {
    const selection = await replenishmentRead(new Request(url("/api/operations/replenishment", {}), { headers: { cookie } }));
    const body = await selection.json(); assert.equal(body.accountSelectionRequired, true); assert.deepEqual(body.rows, []); assert.equal(body.sellerAccounts.length, 2);
    for (const route of [readinessRead, freshnessRead]) assert.equal((await route(new Request(url("/api/operations/readiness", {}), { headers: { cookie } }))).status, 400);
  } finally { await prisma.amazonDataAccessGrant.delete({ where: { id: secondGrant } }); }
  try {
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "REVOKED" } });
    for (const [name, route] of routes) { const response = await call(name, route); assert.equal(response.status, 409); assert.equal((await response.json()).code, "AMAZON_AUTHORIZATION_INVALID"); }
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
    await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: user } }, data: { role: "owner" } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    for (const [name, route] of routes) assert.equal((await call(name, route)).status, 403);
  } finally {
    await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: user } }, data: { role: "viewer" } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
  }
});

test("replenishment files and readiness totals cannot escape when assignment changes during reads", async () => {
  const replacementSource = randomUUID(), replacementGrant = randomUUID();
  await prisma.amazonSyncDataSource.create({ data: { ...scope, id: replacementSource, authorizationId: auth, sellerAccountId: sellerB, marketplaceId: site, resource: "inventory", freshnessMinutes: 60 } });
  const client = (globalThis as unknown as { prisma: typeof prisma }).prisma;
  const model = client.amazonReplenishmentPlan, findMany = model.findMany;
  const inventory = client.amazonInventorySnapshot, aggregate = inventory.aggregate;
  async function replaceAssignment() {
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: replacementGrant, userId: user, sellerAccountId: sellerB } });
  }
  try {
    model.findMany = (async (...values: Parameters<typeof findMany>) => { const rows = await findMany.apply(model, values); await replaceAssignment(); return rows; }) as typeof findMany;
    const denied = await replenishmentRead(new Request(url("/api/operations/replenishment", {}), { headers: { cookie } }));
    assert.equal(denied.status, 403); assert.ok(!("rows" in await denied.json()));
    model.findMany = findMany;
    await prisma.amazonDataAccessGrant.delete({ where: { id: replacementGrant } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    inventory.aggregate = (async (...values: Parameters<typeof aggregate>) => { const rows = await aggregate.apply(inventory, values); await replaceAssignment(); return rows; }) as typeof aggregate;
    const totals = await readinessRead(new Request(url("/api/operations/readiness", {}), { headers: { cookie } }));
    assert.equal(totals.status, 403); assert.ok(!("inventory" in await totals.json()));
  } finally {
    model.findMany = findMany; inventory.aggregate = aggregate;
    await prisma.amazonDataAccessGrant.deleteMany({ where: { id: replacementGrant } });
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonSyncDataSource.delete({ where: { id: replacementSource } });
  }
});

test("read-only CLI inherits account reads and revalidates outside its snapshot before printing", async () => {
  const identity = { ...scope, actorUserId: user };
  const run = (words: string[]) => prisma.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; return runOpsCommand(tx, identity, parseOpsArgs(words)); }, { isolationLevel: "RepeatableRead" });
  for (const words of [["inventory", "list"], ["inventory", "summary"], ["catalog", "list"], ["freshness"], ["sync", "runs"], ["metrics", "daily"]]) assert.ok(await run([...words, "--seller-account", sellerA]));
  const inventory = await run(["inventory", "list", "--seller-account", sellerA]) as { rows: Array<{ sellerAccountId: string; capturedAt: string }> };
  assert.equal(inventory.rows[0].sellerAccountId, sellerA); assert.match(inventory.rows[0].capturedAt, /^20/);
  await assert.rejects(run(["inventory", "list", "--seller-account", sellerB]), /未分配/);
  const secondGrant = randomUUID();
  await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: secondGrant, userId: user, sellerAccountId: sellerB } });
  try { await assert.rejects(run(["inventory", "list"]), /单个 Amazon 账号/); }
  finally { await prisma.amazonDataAccessGrant.delete({ where: { id: secondGrant } }); }
  const command = parseOpsArgs(["inventory", "list", "--seller-account", sellerA]);
  try {
    await runOpsCommand(prisma, identity, command);
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    await assert.rejects(assertOpsReadAccess(prisma, identity, command));
    await assert.rejects(run(["inventory", "list", "--seller-account", sellerA]));
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "REVOKED" } });
    await assert.rejects(run(["inventory", "list", "--seller-account", sellerA]), (error: unknown) => error instanceof AmazonReadError && error.businessCode === "AMAZON_AUTHORIZATION_INVALID");
  } finally {
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
  }
});

test("retained Lili session transport rejects expired sessions and session revocation during a query", async () => {
  const session = await createSession(user);
  const request = new Request(url("/api/lili/mcp", {}), { headers: { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
  const current = await getCurrentUserFromRequest(request); assert.ok(current);
  const runtime = await runtimeToolsForUser(current, request);
  assert.ok((await runtime.discover()).tools.some(tool => tool.name === "erp__amazon.ads.entities.list"));
  const call = () => runtime.call("erp__amazon.ads.entities.list", args, new AbortController().signal);
  await call();
  const client = (globalThis as unknown as { prisma: typeof prisma }).prisma;
  const records = client.auditLog, create = records.create;
  let queryRan = false;
  records.create = (async (...values: Parameters<typeof create>) => {
    const row = await create.apply(records, values);
    if (values[0].data.action === "amazon.mcp.tool.succeeded") {
      queryRan = true;
      await prisma.userSession.delete({ where: { id: session.session.id } });
    }
    return row;
  }) as unknown as typeof create;
  try { await assert.rejects(call(), /ERP 登录会话已失效/); assert.equal(queryRan, true); }
  finally { records.create = create; }
  await assert.rejects(call());
  assert.ok(!(await runtime.discover()).tools.some(tool => tool.name.startsWith("erp__")));
  const expired = await createSession(user);
  const expiredRequest = new Request(url("/api/lili/mcp", {}), { headers: { cookie: `${expired.sessionCookie.name}=${expired.sessionCookie.value}` } });
  const expiredUser = await getCurrentUserFromRequest(expiredRequest); assert.ok(expiredUser);
  const retained = await runtimeToolsForUser(expiredUser, expiredRequest);
  await prisma.userSession.update({ where: { id: expired.session.id }, data: { expiresAt: new Date(0) } });
  await assert.rejects(retained.call("erp__amazon.ads.entities.list", args, new AbortController().signal));
});

test("isolated browser HTTP login reaches ERP, native MCP and Lili routes with the reader identity", { timeout: 60000 }, async () => {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const password = "Fixture-only-lili-session-2026";
  await prisma.user.update({ where: { id: user }, data: { passwordHash: hashPassword(password) } });
  const credentialCount = await prisma.amazonMcpCredential.count({ where: { ...scope, userId: user } });
  const requests: Array<{ path: string; actor?: string }> = [];
  const failures: string[] = [];
  // Browser traffic goes over a real loopback HTTP socket; route handlers,
  // identity, business services and persistence are the application originals.
  // This adapter deliberately does not start Next.js or load root .env files.
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const target = new URL(incoming.url || "/", origin);
      if (target.pathname === "/") {
        outgoing.setHeader("content-type", "text/html");
        outgoing.end("<!doctype html><title>Isolated Lili HTTP session test</title>"); return;
      }
      if (target.pathname === "/favicon.ico") { outgoing.statusCode = 204; outgoing.end(); return; }
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of incoming) { length += chunk.length; if (length > 16384) throw new Error("Fixture body too large"); chunks.push(Buffer.from(chunk)); }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const request = new Request(target, { method: incoming.method, headers, ...(!["GET", "HEAD"].includes(incoming.method!) ? { body: new Uint8Array(Buffer.concat(chunks)) } : {}) });
      requests.push({ path: target.pathname, actor: (await getCurrentUserFromRequest(request))?.id });
      const response = target.pathname === "/api/auth/login" ? await login(request)
        : target.pathname.startsWith("/api/lili/") ? await liliRoute(request, { params: Promise.resolve({ path: target.pathname.slice("/api/lili/".length).split("/") }) })
        : target.pathname === "/api/mcp/amazon" ? await nativeMcp(request)
        : target.pathname === "/api/integrations/amazon/ads/data" ? await adsRead(request)
        : new Response(null, { status: 404 });
      outgoing.statusCode = response.status;
      response.headers.forEach((value, key) => { if (key !== "set-cookie") outgoing.setHeader(key, value); });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader("set-cookie", cookies);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch(() => { failures.push("HTTP fixture failed"); outgoing.statusCode = 500; outgoing.end("Fixture failed"); });
  });
  let origin = "";
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  try {
    await context.route("**/*", async route => {
      if (new URL(route.request().url()).origin !== origin) { failures.push("Browser external requests forbidden"); await route.abort(); }
      else await route.continue();
    });
    const page = await context.newPage();
    await page.goto(origin);
    const signedIn = await page.evaluate(async ({ email, password }) => {
      const result = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      return { status: result.status, body: await result.json() };
    }, { email: `${user}@fixture.invalid`, password });
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn)); assert.equal(signedIn.body.user.id, user); assert.equal(signedIn.body.user.role, "viewer");
    const cookies = await context.cookies(); assert.ok(cookies.some(cookie => cookie.httpOnly && cookie.name === "amazon_bulk_ad_session"));
    const rpc = (name: string, arguments_: Record<string, unknown>, authorization?: string) => page.evaluate(async ({ name, input, authorization, workspaceId }) => {
      const response = await fetch(`/api/lili/mcp?workspaceId=${workspaceId}`, { method: "POST", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 91, method: "tools/call", params: { name, arguments: input } }) });
      return { status: response.status, body: await response.json() };
    }, { name, input: arguments_, authorization, workspaceId: scope.workspaceId });
    const httpCall = (path: string, body?: Record<string, unknown>, authorization?: string) => page.evaluate(async ({ path, body, authorization }) => {
      const response = await fetch(path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json() };
    }, { path, body, authorization });
    const erpQuery = new URLSearchParams({ ...args, kind: "entities", workspaceId: scope.workspaceId });
    const erpResponse = await httpCall(`/api/integrations/amazon/ads/data?${erpQuery}`);
    assert.equal(erpResponse.status, 200); assert.ok(JSON.stringify(erpResponse.body).includes("futureMetric")); assert.equal(erpResponse.cacheControl, "no-store");
    const nativeArgs = { jsonrpc: "2.0", id: 93, method: "tools/call", params: { name: "amazon.ads.entities.list", arguments: args } };
    const native = await httpCall("/api/mcp/amazon", nativeArgs, `Bearer ${token}`);
    assert.equal(native.status, 200); assert.ok(JSON.stringify(native.body).includes("futureMetric"));
    const runPath = `/api/lili/tools/run?workspaceId=${scope.workspaceId}`;
    const runArgs = { name: "erp__amazon.ads.entities.list", input: args };
    const direct = await httpCall(runPath, runArgs); assert.equal(direct.status, 200); assert.equal(direct.body.ok, true); assert.equal(direct.cacheControl, "no-store");
    const directDenied = await httpCall(runPath, { ...runArgs, input: { ...args, sellerAccountId: sellerB } });
    assert.equal(directDenied.status, 403); assert.equal(directDenied.body.error, "ACCOUNT_ACCESS_DENIED"); assert.ok(!JSON.stringify(directDenied).includes("futureMetric"));
    const tasksBefore = await prisma.amazonSyncRun.count({ where: scope });
    const forbiddenWrite = await rpc("erp__data_sync_start", args); assert.equal(forbiddenWrite.body.result.isError, true);
    assert.equal(await prisma.amazonSyncRun.count({ where: scope }), tasksBefore, "session read transport cannot start a write task");
    const successful = await rpc("erp__amazon.ads.entities.list", args);
    assert.equal(successful.status, 200); assert.equal(successful.body.result.isError, false, JSON.stringify(successful)); assert.ok(JSON.stringify(successful).includes("futureMetric"));
    const finance = await rpc("erp__finance_get_transactions", args);
    assert.equal(finance.body.result.isError, false, JSON.stringify(finance)); assert.ok(JSON.stringify(finance).includes("12.34"));
    const tampered = await rpc("erp__amazon.ads.entities.list", { ...args, sellerAccountId: sellerB }); assert.equal(tampered.body.result.isError, true);
    const spoofed = await rpc("erp__amazon.ads.entities.list", { ...args, userId: "local-admin", role: "owner" }); assert.equal(spoofed.body.result.isError, true);
    const badBearer = await rpc("erp__amazon.ads.entities.list", args, "Bearer invalid-token"); assert.notEqual(badBearer.status, 200, "invalid bearer cannot fall back to browser login");
    const invalidLogin = await page.evaluate(async email => (await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "wrong" }) })).status, `${user}@fixture.invalid`); assert.equal(invalidLogin, 401);
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    const revoked = await rpc("erp__amazon.ads.entities.list", args); assert.equal(revoked.body.result.isError, true);
    const revokedErp = await httpCall(`/api/integrations/amazon/ads/data?${erpQuery}`); assert.equal(revokedErp.status, 403);
    const revokedNative = await httpCall("/api/mcp/amazon", nativeArgs, `Bearer ${token}`); assert.notEqual(revokedNative.status, 200);
    const revokedDirect = await httpCall(runPath, runArgs); assert.equal(revokedDirect.status, 403);
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "REVOKED" } });
    const oauth = await rpc("erp__finance_get_transactions", args); assert.equal(oauth.body.result.isError, true); assert.ok(JSON.stringify(oauth).includes("AMAZON_AUTHORIZATION_INVALID"));
    const directOAuth = await httpCall(runPath, { name: "erp__finance_get_transactions", input: args });
    assert.equal(directOAuth.status, 409); assert.equal(directOAuth.body.code, "AMAZON_AUTHORIZATION_INVALID"); assert.equal(directOAuth.cacheControl, "no-store");
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
    await prisma.userSession.deleteMany({ where: { userId: user } });
    const signedOut = await rpc("erp__amazon.ads.entities.list", args); assert.equal(signedOut.status, 401);
    assert.ok(requests.filter(request => request.path === "/api/lili/mcp").some(request => request.actor === user));
    assert.equal(await prisma.amazonMcpCredential.count({ where: { ...scope, userId: user } }), credentialCount);
    const audits = await prisma.auditLog.findMany({ where: { organizationId: scope.organizationId, action: "amazon.mcp.tool.succeeded" } });
    assert.ok(audits.length > 0 && audits.every(row => row.userId === user));
    assert.ok(!JSON.stringify(successful).includes("must-not-leak"));
    assert.deepEqual(failures, []);
  } finally {
    await context.close(); await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
    const replacement = await createSession(user); cookie = `${replacement.sessionCookie.name}=${replacement.sessionCookie.value}`;
  }
});

test("observation and brand reads preserve exact unknown JSON through ERP, MCP, Lili and revocation", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  const expected = { future: { largeId: "9007199254740993", money: "0.123456789123456789", nullable: null, values: [true, "2.5000"] } };
  const text = '{"future":{"largeId":9007199254740993,"money":0.123456789123456789,"nullable":null,"values":[true,2.5000],"clientSecret":"observation-secret"}}';
  const fixtures: Array<{ resource: string; sourceId: string; runId: string; id: string }> = [];
  for (const resource of ["pricing", "brand_analytics"]) {
    const existing = await prisma.amazonSyncDataSource.findFirst({ where: { ...scope, sellerAccountId: sellerA, resource } });
    const sourceId = existing?.id ?? randomUUID(), runId = randomUUID(), id = randomUUID();
    if (!existing) await prisma.amazonSyncDataSource.create({ data: { ...scope, id: sourceId, authorizationId: auth, sellerAccountId: sellerA, marketplaceId: site, resource, freshnessMinutes: 60 } });
    await prisma.amazonSyncRun.create({ data: { ...scope, id: runId, sourceId, requestedByUserId: user, resource, mode: resource === "brand_analytics" ? "report" : "snapshot", executionVersion: 2, status: "SUCCEEDED", finishedAt: new Date(), frozenScope: { sourceRevision: 1, authorizationId: auth, authorizationRevision: 1, domainPolicy: { reportKind: "search_terms", reportPeriod: "WEEK", asins: [], from: "2026-10-01", to: "2026-10-07" } } } });
    await prisma.amazonSyncDataSource.update({ where: { id: sourceId }, data: { activeRunId: runId, lastSuccessAt: new Date() } });
    for (const rowId of [id, randomUUID()]) {
      await prisma.amazonDomainObservation.create({ data: { ...scope, id: rowId, sourceId, sourceRunId: runId, kind: resource === "pricing" ? "OWN_PRICE_ASIN" : "BRAND_SEARCH_TERMS", businessKey: rowId, facts: {}, capturedAt: new Date() } });
      await prisma.$executeRaw`UPDATE "AmazonDomainObservation" SET facts = ${text}::jsonb WHERE id = ${rowId}`;
    }
    fixtures.push({ resource, sourceId, runId, id });
    const filters = { runId, ...(resource === "brand_analytics" ? { reportKind: "search_terms" } : {}) };
    const query = { ...args, sourceId, resource, ...filters };
    const erp = await erpRead(new Request(url("/api/operations/sync-center", { ...query, section: resource === "pricing" ? "observations" : "brand-analytics", pageSize: "1", page: "1" }), { headers: { cookie } }));
    assert.equal(erp.status, 200, await erp.clone().text());
    const body = await erp.json();
    assert.equal(body.rows.length, 1); assert.deepEqual(body.rows[0].facts, expected);
    assert.equal("businessFacts" in body.rows[0], false);
    assert.doesNotMatch(JSON.stringify(body), /observation-secret|factsText/);
    for (const page of [1, 2]) {
      const result = await invokeAmazonMcp(identity, "data_query", { ...args, table: resource, filters: { ...filters, sourceId }, page, pageSize: 1 }) as { data: { items: Array<{ facts: unknown }> } };
      assert.equal(result.data.items.length, 1); assert.deepEqual(result.data.items[0].facts, expected);
      assert.doesNotMatch(JSON.stringify(result), /observation-secret|factsText/);
    }
    const lili = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 90, method: "tools/call", params: { name: "erp__data_query", arguments: { ...args, table: resource, filters: { ...filters, sourceId }, pageSize: 1 } } }) }), ["mcp"]);
    const liliBody = await lili.json(); assert.equal(liliBody.result.isError, false, JSON.stringify(liliBody));
    assert.deepEqual(JSON.parse(liliBody.result.content[0].text).data.items[0].facts, expected);
    assert.doesNotMatch(JSON.stringify(liliBody), /observation-secret/);
    await assert.rejects(invokeAmazonMcp(identity, "data_query", { ...args, sellerAccountId: sellerB, table: resource, filters }));
  }
  const client = (globalThis as unknown as { prisma: typeof prisma }).prisma;
  const queryRaw = client.$queryRaw;
  let revoked = false;
  client.$queryRaw = (async (...input: Parameters<typeof queryRaw>) => {
    const result = await queryRaw.apply(client, input);
    if (!revoked) { revoked = true; await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } }); }
    return result;
  }) as typeof queryRaw;
  try {
    const fixture = fixtures[0];
    const response = await erpRead(new Request(url("/api/operations/sync-center", { ...args, ...fixture, section: "observations" }), { headers: { cookie } }));
    assert.equal(revoked, true); assert.equal(response.status, 403); assert.doesNotMatch(await response.text(), /9007199254740993/);
    for (const fixture of fixtures) await assert.rejects(invokeAmazonMcp(identity, "data_query", { ...args, table: fixture.resource, filters: { sourceId: fixture.sourceId, runId: fixture.runId, ...(fixture.resource === "brand_analytics" ? { reportKind: "search_terms" } : {}) }, page: 2, pageSize: 1 }));
  } finally {
    client.$queryRaw = queryRaw;
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
  }
  let rebound = false;
  client.$queryRaw = (async (...input: Parameters<typeof queryRaw>) => {
    const result = await queryRaw.apply(client, input);
    if (!rebound) { rebound = true; await prisma.amazonSyncDataSource.update({ where: { id: fixtures[0].sourceId }, data: { sellerAccountId: sellerB } }); }
    return result;
  }) as typeof queryRaw;
  try {
    // Caller omits sourceId: the reader must pin its initially resolved source.
    const response = await erpRead(new Request(url("/api/operations/sync-center", { ...args, resource: "pricing", runId: fixtures[0].runId, section: "observations" }), { headers: { cookie } }));
    assert.equal(rebound, true); assert.ok(response.status >= 400);
    assert.doesNotMatch(await response.text(), /9007199254740993/);
  } finally {
    client.$queryRaw = queryRaw;
    await prisma.amazonSyncDataSource.update({ where: { id: fixtures[0].sourceId }, data: { sellerAccountId: sellerA } });
  }
});

test("inventory and catalog native tools share complete ERP fields and exact historical catalog JSON", async () => {
  const inventory = await prisma.amazonInventorySnapshot.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA, sellerSku: "FIXTURE-SKU" } });
  const catalogSource = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA, resource: "catalog", activeRunId: { not: null } } });
  const catalogRow = await prisma.amazonCatalogSnapshot.findFirstOrThrow({ where: { ...scope, sourceRunId: catalogSource.activeRunId! } });
  const attributes = '{"future":{"id":9007199254740993,"amount":1.2300,"nullable":null,"list":[false,2],"refreshToken":"snapshot-secret"}}';
  await prisma.$executeRaw`UPDATE "AmazonCatalogSnapshot" SET "listingAttributes" = ${attributes}::jsonb, "fieldSources" = '{"future":{"api":"fixture","futureVersion":9007199254740993,"password":"snapshot-secret"}}'::jsonb WHERE id = ${catalogRow.id}`;
  await prisma.amazonInventorySnapshot.update({ where: { id: inventory.id }, data: { fnSku: "COMPLETE-FNSKU", condition: "NewItem", inboundWorkingQuantity: 2, inboundShippedQuantity: 3, inboundReceivingQuantity: 4, reservedQuantity: 5, unfulfillableQuantity: 6, researchingQuantity: 8, dataVersion: 2 } });
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  const expected = { future: { id: "9007199254740993", amount: "1.2300", nullable: null, list: [false, "2"] } };
  try {
    const native = await invokeAmazonMcp(identity, "amazon.inventory.list", args) as { rows: Array<Record<string, unknown>> };
    const row = native.rows.find(item => item.sellerSku === "FIXTURE-SKU")!;
    for (const [key, value] of Object.entries({ fnSku: "COMPLETE-FNSKU", condition: "NewItem", inboundWorkingQuantity: 2, inboundShippedQuantity: 3, inboundReceivingQuantity: 4, reservedQuantity: 5, unfulfillableQuantity: 6, researchingQuantity: 8, dataVersion: 2 })) assert.equal(row[key], value, key);
    const erpInventory = await erpRead(new Request(url("/api/operations/sync-center", { ...args, section: "data", table: "inventory" }), { headers: { cookie } }));
    assert.deepEqual((await erpInventory.json()).data.items.find((item: { id: string }) => item.id === inventory.id), JSON.parse(JSON.stringify(row)));
    for (const name of ["amazon.catalog.list", "data_query"] as const) {
      const result = await invokeAmazonMcp(identity, name, { ...args, ...(name === "data_query" ? { table: "listings" } : {}) }) as { rows?: Array<Record<string, unknown>>; data?: { items: Array<Record<string, unknown>> } };
      const item = (result.rows ?? result.data!.items).find(item => item.id === catalogRow.id)!;
      assert.deepEqual(item.listingAttributes, expected);
      assert.equal("businessListingAttributes" in item, false); assert.equal("businessFieldSources" in item, false);
      assert.deepEqual(item.fieldSources, { future: { api: "fixture", futureVersion: "9007199254740993" } });
      assert.equal(item.dataVersion, catalogRow.dataVersion);
      assert.doesNotMatch(JSON.stringify(result), /snapshot-secret|attributesText|fieldsText/);
    }
    const currentCatalog = await erpRead(new Request(url("/api/operations/sync-center", { ...args, section: "data", table: "listings" }), { headers: { cookie } }));
    assert.equal(currentCatalog.status, 200);
    const currentBody = await currentCatalog.json();
    assert.deepEqual(currentBody.data.items.find((item: { id: string }) => item.id === catalogRow.id).listingAttributes, expected);
    assert.doesNotMatch(JSON.stringify(currentBody), /snapshot-secret/);
    const history = await erpRead(new Request(url("/api/operations/sync-center", { ...args, section: "snapshots", id: catalogSource.activeRunId! }), { headers: { cookie } }));
    assert.equal(history.status, 200, await history.clone().text());
    const historical = await history.json();
    assert.deepEqual(historical.snapshotRows.find((item: { id: string }) => item.id === catalogRow.id).listingAttributes, expected);
    assert.doesNotMatch(JSON.stringify(historical), /snapshot-secret/);
    const lili = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 89, method: "tools/call", params: { name: "erp__amazon.catalog.list", arguments: args } }) }), ["mcp"]);
    const liliBody = await lili.json();
    assert.equal(liliBody.result.isError, false, JSON.stringify(liliBody));
    const liliResult = JSON.parse(liliBody.result.content[0].text);
    assert.deepEqual(liliResult.rows.find((item: { id: string }) => item.id === catalogRow.id).listingAttributes, expected);
    assert.doesNotMatch(JSON.stringify(liliBody), /snapshot-secret/);
    await assert.rejects(invokeAmazonMcp(identity, "amazon.inventory.list", { ...args, sellerAccountId: sellerB }));
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    await assert.rejects(invokeAmazonMcp(identity, "amazon.inventory.list", { ...args, page: 2 }));
    await assert.rejects(invokeAmazonMcp(identity, "amazon.catalog.list", { ...args, page: 2 }));
    const deniedHistory = await erpRead(new Request(url("/api/operations/sync-center", { ...args, section: "snapshots", id: catalogSource.activeRunId! }), { headers: { cookie } }));
    assert.ok(deniedHistory.status >= 400);
  } finally {
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonInventorySnapshot.update({ where: { id: inventory.id }, data: { fnSku: inventory.fnSku, condition: inventory.condition, inboundWorkingQuantity: inventory.inboundWorkingQuantity, inboundShippedQuantity: inventory.inboundShippedQuantity, inboundReceivingQuantity: inventory.inboundReceivingQuantity, reservedQuantity: inventory.reservedQuantity, unfulfillableQuantity: inventory.unfulfillableQuantity, researchingQuantity: inventory.researchingQuantity, dataVersion: inventory.dataVersion } });
    await prisma.amazonCatalogSnapshot.update({ where: { id: catalogRow.id }, data: { listingAttributes: catalogRow.listingAttributes === null ? Prisma.DbNull : catalogRow.listingAttributes, fieldSources: catalogRow.fieldSources as Prisma.InputJsonValue } });
  }
});

test("sales ERP, native MCP, Lili, pagination and generated export preserve every stored metric exactly", async () => {
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA, resource: "sales_traffic" } });
  const run = randomUUID();
  await prisma.amazonSyncRun.create({ data: { ...scope, id: run, sourceId: source.id, requestedByUserId: user, resource: "sales_traffic", mode: "date_range", executionVersion: 2, status: "SUCCEEDED", finishedAt: new Date(Date.now() - 1000) } });
  await prisma.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run, lastSuccessAt: new Date() } });
  const rawMetrics = '{"unitsOrdered":7,"future":{"id":9007199254740993,"amount":123456789.123456789,"nullable":null,"values":[true,2.5000],"accessToken":"must-not-leak"},"password":"must-not-leak"}';
  for (const businessDate of ["2026-10-08", "2026-10-09"]) {
    const id = randomUUID();
    await prisma.amazonSalesTrafficSnapshot.create({ data: { ...scope, id, sourceId: source.id, syncRunId: run, sellerAccountId: sellerA, marketplaceId: site, businessDate, reportId: "sales-fields-fixture", documentId: "sales-fields-document", metrics: {}, quality: "VALID", capturedAt: new Date() } });
    await prisma.$executeRaw`UPDATE "AmazonSalesTrafficSnapshot" SET metrics = ${rawMetrics}::jsonb WHERE id = ${id}`;
  }
  const expected = { unitsOrdered: "7", future: { id: "9007199254740993", amount: "123456789.123456789", nullable: null, values: [true, "2.5000"] } };
  const values = { ...args, from: "2026-10-08", to: "2026-10-09" };
  const erp = await erpRead(new Request(url("/api/operations/sync-center", { ...values, section: "sales-traffic" }), { headers: { cookie } }));
  assert.equal(erp.status, 200, await erp.clone().text());
  const body = await erp.json();
  assert.equal(body.rows.length, 2);
  assert.deepEqual(body.rows[0].metrics, expected);
  assert.doesNotMatch(JSON.stringify(body), /must-not-leak|metricsText|businessMetrics|exactMetrics/);
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  for (const name of ["amazon.sales.list", "amazon.sales.export"] as const) {
    const result = await invokeAmazonMcp(identity, name, values);
    assert.ok(JSON.stringify(result).includes("9007199254740993"), name);
    assert.doesNotMatch(JSON.stringify(result), /must-not-leak/);
  }
  for (const page of [1, 2]) {
    const result = await invokeAmazonMcp(identity, "data_query", { ...values, table: "sales_traffic_daily", page, pageSize: 1 });
    assert.ok(JSON.stringify(result).includes('"123456789.123456789"'));
    assert.doesNotMatch(JSON.stringify(result), /must-not-leak/);
  }
  const lili = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 88, method: "tools/call", params: { name: "erp__amazon.sales.list", arguments: values } }) }), ["mcp"]);
  const liliBody = await lili.json();
  assert.equal(liliBody.result.isError, false, JSON.stringify(liliBody));
  assert.ok(JSON.stringify(liliBody).includes("9007199254740993"));
  assert.doesNotMatch(JSON.stringify(liliBody), /must-not-leak/);
  const exportId = randomUUID();
  await prisma.amazonDataExport.create({ data: { ...scope, id: exportId, requestedByUserId: user, idempotencyKey: randomUUID(), query: { ...values, _scopeSellerIds: [sellerA], _scopeSourceIds: [source.id], _scopeAll: false }, cutoff: new Date(), status: "QUEUED" } });
  const job = await prisma.amazonDataExport.findUniqueOrThrow({ where: { id: exportId } });
  await processSalesExport(exportId, job.fence);
  assert.equal((await prisma.amazonDataExport.findUniqueOrThrow({ where: { id: exportId } })).status, "SUCCEEDED");
  const download = await exportRead(new Request(url("/api/operations/sync-center/exports", { id: exportId, download: "1" }), { headers: { cookie } }));
  assert.equal(download.status, 200);
  const exported = await download.text();
  const records = exported.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(records.length, 3);
  assert.deepEqual(records[1].metrics, expected);
  assert.doesNotMatch(exported, /must-not-leak|metricsText|businessMetrics|exactMetrics/);
  await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
  try {
    await assert.rejects(invokeAmazonMcp(identity, "data_query", { ...values, table: "sales_traffic_daily", page: 2, pageSize: 1 }));
    assert.equal((await exportRead(new Request(url("/api/operations/sync-center/exports", { id: exportId, download: "1" }), { headers: { cookie } }))).status, 403);
  } finally {
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
  }
});

test("product center overlays inherit account access and revalidate shared master cache", async () => {
  const id = randomUUID();
  await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: { products: ["view"] } } });
  await prisma.productRecord.create({ data: { ...scope, id, userId: user, sku: "FIXTURE-SKU", payload: { sku: "FIXTURE-SKU", name: "Company master", amazonSnapshots: [{ sellerAccountId: sellerB, available: 999 }] } } });
  const read = (sellerAccountId: string = sellerA) => productCenterRead(new Request(url("/api/products", { sellerAccountId, search: "FIXTURE-SKU", includeSummary: "false" }), { headers: { cookie } }));
  try {
    const response = await read();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    const body = await response.json();
    assert.equal(body.products.length, 1);
    assert.ok(body.products[0].amazonSnapshots.some((row: { sellerAccountId: string; available: number }) => row.sellerAccountId === sellerA && row.available === 7));
    assert.ok(!JSON.stringify(body.products).includes(sellerB));
    const secondGrant = randomUUID();
    await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: secondGrant, userId: user, sellerAccountId: sellerB, actions: [], mcpEnabled: false } });
    try {
      const unselected = await (await read("")).json();
      assert.equal(unselected.amazonAccounts.length, 2);
      assert.equal(unselected.products[0].amazonSnapshotErrorCode, "ACCOUNT_SCOPE_REQUIRED");
      assert.equal(unselected.products[0].amazonSnapshots, undefined);
      const selected = await (await read()).json();
      assert.ok(selected.products[0].amazonSnapshots.every((row: { sellerAccountId: string }) => row.sellerAccountId === sellerA));
    } finally {
      await prisma.amazonDataAccessGrant.delete({ where: { id: secondGrant } });
    }
    const denied = await read(sellerB);
    assert.equal(denied.headers.get("x-product-cache"), "hit");
    const deniedBody = await denied.json();
    assert.equal(deniedBody.products[0].amazonSnapshotErrorCode, "ACCOUNT_ACCESS_DENIED");
    assert.equal(deniedBody.products[0].amazonSnapshots, undefined);
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
    const revoked = await (await read()).json();
    assert.equal(revoked.products[0].amazonSnapshotErrorCode, "ACCOUNT_ACCESS_DENIED");
    assert.equal(revoked.products[0].amazonSnapshots, undefined);
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "REVOKED" } });
    const invalidAuth = await (await read()).json();
    assert.equal(invalidAuth.products[0].amazonSnapshotErrorCode, "AMAZON_AUTHORIZATION_INVALID");
    assert.equal(invalidAuth.products[0].amazonSnapshots, undefined);
    assert.deepEqual((await prisma.productRecord.findUniqueOrThrow({ where: { id } })).payload, { sku: "FIXTURE-SKU", name: "Company master", amazonSnapshots: [{ sellerAccountId: sellerB, available: 999 }] });
  } finally {
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
    await prisma.amazonSpApiAuthorization.update({ where: { id: auth }, data: { status: "CONFIGURED" } });
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "viewer" } }, data: { permissions: {} } });
  }
});

test("inferred product account remains pinned when assignment changes during a query", async () => {
  const client = (globalThis as unknown as { prisma: typeof prisma }).prisma;
  const findMany = client.amazonInventorySnapshot.findMany;
  let switched = false;
  client.amazonInventorySnapshot.findMany = (async (...input: Parameters<typeof findMany>) => {
    const rows = await findMany.apply(client.amazonInventorySnapshot, input);
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { sellerAccountId: sellerB } });
    switched = true;
    return rows;
  }) as typeof findMany;
  try {
    await assert.rejects(readAmazonProductsForSkus(scope.organizationId, scope.workspaceId, ["FIXTURE-SKU"], user), /未分配/);
    assert.equal(switched, true);
  } finally {
    client.amazonInventorySnapshot.findMany = findMany;
    await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { sellerAccountId: sellerA } });
  }
});

test("revoking an account blocks old identities, ERP reads and Lili immediately", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
  await assert.rejects(invokeAmazonMcp(identity, "amazon.inventory.list", args));
  await assert.rejects(invokeAmazonMcp(identity, "amazon.data.archive.read", { ...args, sourceId: archiveSource, taskId: archiveTask, rawPage: 1 }));
  const erp = await adsRead(new Request(url("/api/integrations/amazon/ads/data", { ...args, kind: "entities" }), { headers: { cookie } }));
  assert.equal(erp.status, 403);
  const lili = await handleLiliRequest(new Request(url("/api/lili/mcp", {}), { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "erp__amazon.ads.entities.list", arguments: args } }) }), ["mcp"]);
  const result = await lili.json();
  assert.ok(result.error || result.result?.isError);
});
