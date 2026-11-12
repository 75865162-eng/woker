// Cloud role for injected offline task fixtures; no real Amazon calls.
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
import { readOrderFulfillmentRecoveryHistory, readOrderFulfillmentRecoveryPages, readOrderFulfillmentRecoveryPreview, applyOrderFulfillmentRecovery } from "@/lib/amazon-sync/order-fulfillment-recovery";
import { inspectOrderRecovery, orderRecoveryReadiness } from "@/lib/amazon-sync/orders-recovery";
import { readReportParseEvidence } from "@/lib/amazon-sync/report-parse-evidence";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "@/lib/amazon-sync/change-approval";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { encryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { decryptCheckpoint } from "@/lib/amazon-sync/checkpoint";
import { endpoints } from "@/lib/amazon-sync/policy";
import { digest, unseal } from "@/lib/amazon-sync/approval-policy";
import { orderBucketKey } from "@/lib/amazon-sync/orders-rate-limit";
import { Prisma } from "@prisma/client";
import { readOrders, readOrderItems } from "@/lib/amazon-sync/orders-query";
import { listSources } from "@/lib/amazon-sync/read";
import { tickSyncCenter, enqueueDueAutomaticPlans } from "@/lib/amazon-sync/scheduler";
import { createTask, scopeLock } from "@/lib/amazon-sync/service";
import { automaticMarketplaces, automaticPlanKey, automaticResourceIntervalMinutes } from "@/lib/amazon-sync/automatic-schedule";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { readDataset } from "@/lib/amazon-sync/dataset-query";
import { manageMcpCredential, authenticateAmazonMcp, invokeAmazonMcp, listDiscoverableAmazonMcpTools } from "@/lib/amazon-sync/mcp";
import type { querySpApiDataset } from "@/lib/amazon-sync/sp-api-data-query";
import { orderWindowFromFrozen, parseOrderSyncPolicy } from "@/lib/amazon-sync/orders";
import { callSyncChatTool } from "@/lib/lili/sync-chat-server";

function orderCoverage(result: { meta: Record<string, unknown> }) {
  assert.ok(result.meta.orderCoverage, "order coverage must survive the generic query envelope");
  return result.meta.orderCoverage as NonNullable<Awaited<ReturnType<typeof querySpApiDataset>>["orderCoverage"]>;
}

function comparableOrderCoverage(result: { meta: Record<string, unknown> }) {
  const coverage = structuredClone(orderCoverage(result));
  if (coverage.recoveryTask?.progress) {
    assert.ok(Number.isFinite(Date.parse(coverage.recoveryTask.progress.checkedAt)), "diagnostic has its own evaluation timestamp");
    coverage.recoveryTask.progress.checkedAt = "INDEPENDENT_READ_TIME";
  }
  return coverage;
}

if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1" || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw new Error("Disposable offline database required");
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/amazon/orders/${name}.json`, import.meta.url), "utf8"));
let site = "fixture-marketplace";
const policy = fixture("policy"), region = "fixture-region";
const scopes: Array<[string, string]> = [];
const calls: Array<{ path: string; page: string | null }> = [];
let fault = 0, failPage = "fixture-next-page-2", failCommit = false;
let detailFault = 0, failedDetail = "fixture-order-2", failDetailCommit = false;
before(() => {
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 41).toString("base64");
  endpoints[region] = "https://spapi.fixture.invalid";
  endpoints["fixture-other-region"] = "https://spapi-other.fixture.invalid";
});
after(async () => { delete endpoints[region]; delete endpoints["fixture-other-region"]; await getAmazonSyncQueue().close(); await prisma.$disconnect(); });

async function fresh(withDetails = false, localContinuity = false) {
  const sourcePolicy = withDetails ? fixture("policy-details") : policy;
  const scope = { organizationId: `orders-fixture-${randomUUID()}`, workspaceId: "orders-test" };
  if(localContinuity){scope.organizationId="amazon-live-local";scope.workspaceId="default";}
  scopes.push([scope.organizationId, scope.workspaceId]); process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify(scopes);
  const actor = randomUUID(), approver = randomUUID(), store = randomUUID(), authId = randomUUID();
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Orders fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Orders fixture" } });
  for (const id of [actor, approver]) await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: "Fixture", passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: store, accountKey: store, displayName: "Orders fixture", marketplaceCode: "FX" } });
  await prisma.amazonDataAccessGrant.createMany({ data: [actor, approver].map(userId => ({ ...scope, id: randomUUID(), userId, sellerAccountId: store, marketplaceIds: [site], actions: ["view", "sync"] })) });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authId, name: "Orders fixture", amazonSellerId: `fixture-seller-${authId}`, awsRegion: region, endpoint: endpoints[region], status: "CONFIGURED", identityVerifiedAt: new Date(), identityEvidence: "OFFLINE_FIXTURE", approvedRoles: [...sourcePolicy.requiredRoles, ...(sourcePolicy.details?.requiredRoles ?? [])], rolesAttestedAt: new Date(), marketplaceParticipations: [{ marketplaceId: site, countryCode: "FX" }], updatedByUserId: actor, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId: authId }) } });
  async function approved(command: Record<string, unknown>) {
    const request = await requestChange(scope, actor, command), id = String(request.id);
    assert.equal((await decideChange(scope, approver, id, "APPROVED", "offline fixture")).status, "APPROVED");
    await applyChange(scope, actor, id);
    return prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id } });
  }
  const change = await approved({ action: "save-source", authorizationId: authId, sellerAccountId: store, marketplaceId: site, resource: "orders", freshnessMinutes: 60, enabled: true, orderPolicy: { ...sourcePolicy, applicationId: `fixture-${authId}` } });
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: change.targetId } });
  async function request() {
    const grant = await approved({ action: "run", sourceIds: [source.id] });
    return prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionApprovalId: grant.id } });
  }
  const fetcher = async (input: string | URL) => {
    const url = new URL(String(input));
    assert.ok(["lwa.fixture.invalid", "spapi.fixture.invalid"].includes(url.hostname));
    if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    if (url.pathname.startsWith("/orders/2026-01-01/orders/")) {
      const orderId = decodeURIComponent(url.pathname.split("/").at(-1)!);
      calls.push({ path: url.pathname, page: null });
      if (detailFault && (failedDetail === "*" || orderId === failedDetail)) return Response.json({ message: "fixture-private-buyer fixture-secret fixture-access" }, { status: detailFault, headers: { "x-amzn-RequestId": "fixture-detail-error", "retry-after": "1" } });
      if (failDetailCommit) {
        await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION fixture_reject_detail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture commit failure'; END $$`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_reject_detail BEFORE UPDATE ON "AmazonOrderDetailWork" FOR EACH ROW EXECUTE FUNCTION fixture_reject_detail()`);
      }
      assert.ok(["fixture-order-1", "fixture-order-2"].includes(orderId));
      return Response.json(fixture(orderId === "fixture-order-1" ? "detail-1" : "detail-2"), { headers: { "x-amzn-RequestId": "fixture-detail-ok", "x-amzn-RateLimit-Limit": "0.25" } });
    }
    assert.equal(url.pathname, "/orders/2026-01-01/orders");
    const page = url.searchParams.get("paginationToken"); calls.push({ path: url.pathname, page });
    if (fault && (failPage === "*" || page === failPage)) return Response.json({ message: "fixture-secret fixture-access fixture-private" }, { status: fault, headers: { "retry-after": "1", "x-amzn-RequestId": "fixture-request-error" } });
    if (failCommit) {
      // Simulate a database write failure after successful HTTP. The page/cursor
      // transaction must roll back together. No production state participates.
      await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION fixture_reject_order_page() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture commit failure'; END $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_reject_order_page BEFORE INSERT ON "AmazonSyncRawPage" FOR EACH ROW EXECUTE FUNCTION fixture_reject_order_page()`);
    }
    return Response.json(fixture(page ? "page-2" : "page-1"), { headers: { "x-amzn-RequestId": "fixture-request-ok", "x-amzn-RateLimit-Limit": "0.0056" } });
  };
  async function slice(id: string, transport = fetcher) {
    const run = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
    await processSyncCenterTask(id, run.dispatchVersion, { clientOptions: { fetch: transport, tokenEndpoint: "https://lwa.fixture.invalid/token" } });
    return prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
  }
  return { scope, actor, approver, store, authId, source, approved, request, slice, fetcher };
}

function emptyOrderWindow(f: Awaited<ReturnType<typeof fresh>>) {
  return async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/orders/2026-01-01/orders") {
      calls.push({ path: url.pathname, page: null });
      return Response.json({ orders: [] });
    }
    return f.fetcher(input);
  };
}

test("orders full approval → two pages → UTC records, encrypted raw and scoped idempotency", async () => {
  const f = await fresh(); fault = 0; calls.length = 0;
  const task = await f.request();
  assert.equal(task.mode, "incremental");
  assert.equal((await f.slice(task.id)).status, "WAITING");
  const partial = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(partial.lastSuccessAt, null); assert.equal(decryptCheckpoint(partial.nextTokenCiphertext, f.scope, partial.id), "fixture-next-page-2");
  const partialView = await readOrders(f.scope, new URLSearchParams(), f.actor);
  assert.equal(partialView.pagination.total, 1); assert.equal(partialView.sources[0].resourceCursor?.status, "RUNNING");
  assert.ok(!JSON.stringify(partialView).includes("nextTokenCiphertext"));
  const done = await f.slice(task.id); assert.equal(done.status, "SUCCEEDED");
  assert.equal(done.insertedCount, 2); assert.equal(done.skippedCount, 1); assert.equal(done.pagesCompleted, 2);
  const rows = await prisma.amazonOrderRecord.findMany({ where: { ...f.scope, sourceId: f.source.id }, orderBy: { amazonOrderId: "asc" } });
  assert.equal(rows.length, 2); assert.equal(rows[1].createdTime.toISOString(), "2026-10-31T20:00:00.000Z");
  assert.equal(rows[1].rawStatus, null); assert.equal(rows[1].normalizedStatus, null);
  const view = await readOrders(f.scope, new URLSearchParams({ amazonOrderId: rows[1].amazonOrderId }), f.actor);
  assert.equal(view.pagination.total, 1); assert.equal(view.sources[0].resourceCursor?.status, "SUCCEEDED");
  await assert.rejects(() => readOrders(f.scope, new URLSearchParams({ marketplaceId: "wrong-fixture-marketplace" }), f.actor), /尚未接入请求的数据来源/);
  const archived = await prisma.amazonSyncRawPage.findMany({ where: { taskId: task.id }, orderBy: { page: "asc" } });
  assert.equal(archived.length, 2);
  assert.deepEqual(JSON.parse(String(unseal(archived[0].rawCiphertext, f.scope, `${task.id}:1`, "amazon-orders-raw.v1").rawBody)), fixture("page-1"));
  assert.ok(!archived[0].rawCiphertext.includes("fixture-order-1"));
  assert.ok(!JSON.stringify(archived[0].requestMetadata).includes("fixture-next-page-2"));
  await f.slice(task.id); assert.equal(await prisma.amazonOrderRecord.count({ where: f.scope }), 2);
  assert.equal(calls.length, 2);
  // Replaying the same approved batch into a fresh task remains a business-key upsert.
  await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { status: "FAILED", activeRunId: null } });
  const replay = await f.request(); await f.slice(replay.id); await f.slice(replay.id);
  assert.equal(await prisma.amazonOrderRecord.count({ where: f.scope }), 2);
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: replay.id } })).skippedCount, 3);
});

test("page 2 failure, process restart and manual retry preserve committed cursor and rows", async () => {
  const f = await fresh(); fault = 0; calls.length = 0;
  const task = await f.request(); await f.slice(task.id);
  fault = 500; failPage = "fixture-next-page-2";
  const failed = await f.slice(task.id); assert.equal(failed.status, "RETRY_WAIT");
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(cursor.lastSuccessAt, null); assert.equal(await prisma.amazonOrderRecord.count({ where: f.scope }), 1);
  // No sleep: advance only the fixture task's persisted retry eligibility.
  await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { nextAttemptAt: new Date(0), status: "FAILED" } });
  await f.approved({ action: "control-task", id: task.id, control: "retry" });
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).pagesCompleted, 1);
  fault = 0;
  assert.equal((await f.slice(task.id)).status, "SUCCEEDED");
  assert.deepEqual(calls.map(c => c.page), [null, "fixture-next-page-2", "fixture-next-page-2"]);
});

test("first committed order page is readable through ERP and personal MCP before the window finishes", async () => {
  const f = await fresh(); fault = 0; calls.length = 0;
  const task = await f.request(); await f.slice(task.id);
  const pair = { sellerAccountId: f.store, marketplaceId: site };
  for (const query of ["table=orders", `table=orders&sellerAccountId=${f.store}`, `table=orders&marketplaceId=${site}`,
    `table=orders&sellerAccountId=${f.store}&sellerAccountId=other&marketplaceId=${site}`,
    `table=orders&sellerAccountId=${f.store}&marketplaceId=${site}&marketplaceId=other`,
    `table=orders&sellerAccountId=${f.store}&marketplaceId=${site}&sellerAccountIds=other`]) {
    await assert.rejects(() => readDataset(f.scope, new URLSearchParams(query), f.actor), /账号|范围/);
  }
  const erp = await readDataset(f.scope, new URLSearchParams({ table: "orders", ...pair }), f.actor);
  assert.equal(erp.data.total, 1); assert.equal("completeness" in erp.meta ? erp.meta.completeness : null, "PAGE_COMMITTED");
  assert.equal(orderCoverage(erp).detailsEnabled, false);
  assert.equal(orderCoverage(erp).historicalBackfillEnabled, false);
  assert.equal(orderCoverage(erp).historicalBackfill, null);
  assert.equal(orderCoverage(erp).historicalBackfillWindow, null);
  assert.deepEqual(orderCoverage(erp).moneyRequest, { proceedsRequested: false, basis: "CURRENT_SOURCE_POLICY" });
  assert.deepEqual(orderCoverage(erp).money, { field: "grandTotalOriginal", returned: 1, present: 0, missing: 1 });
  assert.equal(orderCoverage(erp).window?.listComplete, false);
  assert.deepEqual(orderCoverage(erp).page, { returned: 1, detailsCurrent: 0, detailsMissingOrStale: 1 });
  assert.ok(erp.warnings.some(w => w.includes("不能解释为零")));
  assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } })).activeRunId, null);
  const auth = await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { identityVerifiedAt: new Date(), identityEvidence: "OFFLINE_FIXTURE" } });
  await prisma.amazonSellerIdentity.create({ data: { ...f.scope, id: randomUUID(), ...pair, authorizationId: f.authId, amazonSellerId: auth.amazonSellerId!, region, verifiedAt: new Date() } });
  await prisma.amazonDataAccessGrant.updateMany({ where: { ...f.scope, userId: f.actor, sellerAccountId: f.store }, data: { marketplaceIds: [site], actions: ["view"], mcpEnabled: true } });
  const credential = await manageMcpCredential(f.scope, f.actor, { action: "create", name: "offline first-page reader", scopes: [{ sellerAccountId: f.store, marketplaceIds: [site] }], tools: ["data_query"], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp(`Bearer ${credential.token!}`);
  const result = await invokeAmazonMcp(identity, "data_query", { table: "orders", ...pair }) as typeof erp;
  assert.equal(result.data.total, 1); assert.equal("completeness" in result.meta ? result.meta.completeness : null, "PAGE_COMMITTED");
  assert.deepEqual(comparableOrderCoverage(result), comparableOrderCoverage(erp));
  assert.ok(!JSON.stringify(result).includes("Ciphertext"));
  await assert.rejects(() => invokeAmazonMcp(identity, "data_query", { table: "orders", ...pair, marketplaceId: "other" }), /数据来源|接入/);
  assert.equal(calls.length, 1, "database and MCP reads never request Amazon");
});

test("MCP orders request stays approval-only, prevents duplicate execution and reads collected details", async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false; calls.length = 0;
  const pair = { sellerAccountId: f.store, marketplaceId: site };
  const auth = await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { identityVerifiedAt: new Date(), identityEvidence: "OFFLINE_FIXTURE" } });
  await prisma.amazonSellerIdentity.create({ data: { ...f.scope, id: randomUUID(), ...pair, authorizationId: f.authId, amazonSellerId: auth.amazonSellerId!, region, verifiedAt: new Date() } });
  const grant = await prisma.amazonDataAccessGrant.findFirstOrThrow({ where: { ...f.scope, userId: f.actor, sellerAccountId: f.store } });
  await prisma.amazonDataAccessGrant.update({ where: { id: grant.id }, data: { marketplaceIds: [site], actions: ["view", "sync"], mcpEnabled: true } });
  const credential = await manageMcpCredential(f.scope, f.actor, { action: "create", name: "offline orders request", scopes: [{ sellerAccountId: f.store, marketplaceIds: [site] }], tools: ["data_query", "data_sync_start"], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp(`Bearer ${credential.token!}`);
  const catalog = await listDiscoverableAmazonMcpTools(identity, "2025-06-18");
  const syncTool = catalog.find(tool => tool.name === "data_sync_start");
  assert.ok(syncTool, "an orders-only account must discover the request tool");
  assert.ok(JSON.stringify(syncTool.inputSchema).includes('"orders"'));
  for (const args of [
    { resource: "orders", ...pair, dateFrom: "2026-01-01" },
    { resource: "orders", ...pair, marketplaceId: "other" },
    { resource: "orders", marketplaceId: site },
  ]) await assert.rejects(() => invokeAmazonMcp(identity, "data_sync_start", args));
  const request = async () => await invokeAmazonMcp(identity, "data_sync_start", { resource: "orders", ...pair }) as { data: { approvalRequired: boolean; started: boolean; changeRequest: { id: string; status: string } } };
  const first = await request(), duplicate = await request();
  assert.equal(first.data.approvalRequired, true); assert.equal(first.data.started, false);
  assert.equal(first.data.changeRequest.status, "REQUESTED");
  assert.equal(await prisma.amazonSyncRun.count({ where: f.scope }), 0);
  assert.equal(calls.length, 0);
  const firstId = first.data.changeRequest.id, duplicateId = duplicate.data.changeRequest.id;
  await decideChange(f.scope, f.approver, firstId, "APPROVED", "offline MCP request");
  await applyChange(f.scope, f.actor, firstId);
  await assert.rejects(() => applyChange(f.scope, f.actor, firstId));
  await decideChange(f.scope, f.approver, duplicateId, "APPROVED", "offline duplicate request");
  await assert.rejects(() => applyChange(f.scope, f.actor, duplicateId), /活动任务/);
  assert.equal(await prisma.amazonSyncRun.count({ where: f.scope }), 1);
  assert.equal(calls.length, 0, "approval and application do not directly call Amazon");
  const task = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...f.scope, executionApprovalId: firstId } });
  for (let i = 0; i < 4; i++) await f.slice(task.id);
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status, "SUCCEEDED");
  const result = await invokeAmazonMcp(identity, "data_query", { table: "orders", ...pair }) as Awaited<ReturnType<typeof readDataset>>;
  assert.equal(result.data.total, 2);
  assert.deepEqual(orderCoverage(result).page, { returned: 2, detailsCurrent: 2, detailsMissingOrStale: 0 });
  assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 2);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: task.id } }), 4);
  await prisma.amazonDataAccessGrant.update({ where: { id: grant.id }, data: { actions: ["view"] } });
  await assert.rejects(request, /授权|不可访问/);
  assert.ok(!(await listDiscoverableAmazonMcpTools(identity, "2025-06-18")).some(tool => tool.name === "data_sync_start"));
});

for (const recoveryStatus of ["FAILED", "PAUSED"] as const) test(`MCP recovers the exact ${recoveryStatus} order task through chat approval and preserves its cursor`, async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false; calls.length = 0;
  const pair = { sellerAccountId: f.store, marketplaceId: site };
  const auth = await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { identityVerifiedAt: new Date(), identityEvidence: "OFFLINE_FIXTURE" } });
  await prisma.amazonSellerIdentity.create({ data: { ...f.scope, id: randomUUID(), ...pair, authorizationId: f.authId, amazonSellerId: auth.amazonSellerId!, region, verifiedAt: new Date() } });
  await prisma.amazonDataAccessGrant.updateMany({ where: { ...f.scope, userId: f.actor, sellerAccountId: f.store }, data: { marketplaceIds: [site], actions: ["view", "sync"], mcpEnabled: true } });
  const credential = await manageMcpCredential(f.scope, f.actor, { action: "create", name: "offline order retry", scopes: [{ sellerAccountId: f.store, marketplaceIds: [site] }], tools: ["data_query", "data_sync_status", "data_sync_start", "workflow_sync_review", "workflow_sync_confirm"], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp(`Bearer ${credential.token!}`);
  const task = await f.request(); await f.slice(task.id);
  if (recoveryStatus === "FAILED") {
    detailFault = 403; failedDetail = "fixture-order-1";
    assert.equal((await f.slice(task.id)).status, recoveryStatus);
  } else {
    await f.approved({ action: "control-task", id: task.id, control: "pause" });
  }
  const saved = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const previousRequests = calls.length;
  const status = await invokeAmazonMcp(identity, "data_sync_status", pair) as { data: { items: Array<{ resource: string; latestTask: { id: string; status: string; stage: string; attempts: number; maxAttempts: number; apiRequests: number; detailsCompletedCount: number; operatorAction: string | null } }> } };
  const failed = status.data.items.find(item => item.resource === "orders")!.latestTask;
  const stored = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(failed.id, task.id); assert.equal(failed.status, recoveryStatus); assert.equal(failed.stage, stored.stage);
  assert.equal(failed.attempts, stored.attempts); assert.equal(failed.maxAttempts, stored.maxAttempts);
  assert.equal(failed.apiRequests, stored.apiRequests); assert.equal(failed.detailsCompletedCount, stored.detailsCompletedCount);
  if (recoveryStatus === "FAILED") assert.ok(failed.operatorAction?.includes("申请恢复"));
  for (const key of ["error", "summary", "checkpointCiphertext", "leaseOwner", "frozenScope"]) assert.equal(Object.hasOwn(failed, key), false);
  assert.equal(calls.length, previousRequests, "status query never dispatches recovery or Amazon requests");
  await assert.rejects(() => invokeAmazonMcp(identity, "data_sync_start", { ...pair, resource: "orders", taskId: randomUUID() }), /范围/);
  const response = await invokeAmazonMcp(identity, "data_sync_start", { ...pair, resource: "orders", taskId: task.id }) as { data: { started: boolean; changeRequest: { id: string; operation: string; status: string } } };
  assert.equal(response.data.started, false); assert.equal(response.data.changeRequest.operation, "control-task");
  assert.equal(response.data.changeRequest.status, "REQUESTED");
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status, recoveryStatus);
  assert.equal(calls.length, previousRequests);
  const id = response.data.changeRequest.id;
  const chatRequest = new Request("http://localhost/api/lili/mcp", { headers: { authorization: `Bearer ${credential.token!}` } });
  const preview = await callSyncChatTool(chatRequest, "workflow_sync_review", { workspaceId: f.scope.workspaceId, requestId: id });
  assert.equal(preview.request?.operation, "control-task");
  const requestRow = await prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id } });
  assert.equal((requestRow.afterSummary as Prisma.JsonObject).control, recoveryStatus === "PAUSED" ? "resume" : "retry");
  await callSyncChatTool(chatRequest, "workflow_sync_confirm", { workspaceId: f.scope.workspaceId, requestId: id, expectedDigest: requestRow.changeDigest, expectedRevision: requestRow.baseRevision, userConfirmation: "批准本次隔离测试的指定订单任务恢复" });
  const resumed = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(resumed.watermarkFrom.getTime(), saved.watermarkFrom.getTime()); assert.equal(resumed.watermarkTo.getTime(), saved.watermarkTo.getTime());
  assert.equal(resumed.nextTokenCiphertext, saved.nextTokenCiphertext);
  assert.equal(await prisma.amazonSyncRun.count({ where: f.scope }), 1);
  detailFault = 0;
  for (let i = 0; i < 3; i++) await f.slice(task.id);
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status, "SUCCEEDED");
  const result = await invokeAmazonMcp(identity, "data_query", { ...pair, table: "orders" }) as Awaited<ReturnType<typeof readDataset>>;
  assert.deepEqual(orderCoverage(result).page, { returned: 2, detailsCurrent: 2, detailsMissingOrStale: 0 });
  assert.equal(calls.filter(call => call.path.endsWith("/orders") && call.page === null).length, 1, "committed first page is not requested again");
  await assert.rejects(() => invokeAmazonMcp(identity, "data_sync_start", { ...pair, resource: "orders", taskId: task.id }), /不能申请重试/);
});

test("changing an existing source cannot reset its seller/application quota", async () => {
  const f = await fresh();
  await assert.rejects(() => f.approved({ action: "save-source", authorizationId: f.authId, sellerAccountId: f.store, marketplaceId: site, resource: "orders", freshnessMinutes: 60, enabled: true, orderPolicy: { ...policy, applicationId: "fixture-other-app" } }), /应用标识/);
  const unchanged = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } });
  assert.equal((unchanged.orderPolicy as Prisma.JsonObject).applicationId, `fixture-${f.authId}`);
});

test("400/403/404 never retry; 429/500 schedule bounded retries and preserve request IDs", async () => {
  for (const status of [400, 403, 404, 429, 500]) {
    const f = await fresh(); const task = await f.request(); fault = status; failPage = "*"; calls.length = 0;
    const result = await f.slice(task.id);
    assert.equal(result.status, [429, 500].includes(status) ? "RETRY_WAIT" : "FAILED");
    assert.equal(calls.length, 1); assert.equal(result.failedCount, 1);
    if (status === 429) { assert.equal(result.throttles, 1); assert.ok(result.nextAttemptAt > new Date()); }
    const logs = await prisma.amazonSyncTaskLog.findMany({ where: { taskId: task.id } });
    assert.ok(logs.some(l => l.requestId === "fixture-request-error"));
    const text = JSON.stringify({ logs, error: result.error });
    for (const secret of ["fixture-access", "fixture-secret", "fixture-private", "fixture-refresh"]) assert.ok(!text.includes(secret));
  }
  fault = 0; failPage = "fixture-next-page-2";
});

test("seller/marketplace/region/roles mismatch emits no HTTP at all", async () => {
  for (const mismatch of ["seller", "marketplace", "region"]) {
    const f = await fresh(), task = await f.request(); calls.length = 0; let allHttp = 0;
    if (mismatch === "roles") await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { approvedRoles: [] } });
    else if (mismatch === "region") await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { awsRegion: "fixture-other-region", endpoint: endpoints["fixture-other-region"] } });
    else {
      const frozen: Prisma.InputJsonObject = { ...(task.frozenScope as Prisma.JsonObject), [mismatch === "seller" ? "amazonSellerId" : "marketplaceId"]: "wrong-fixture-identity" };
      await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { frozenScope: frozen, frozenScopeDigest: digest(frozen) } });
    }
    await processSyncCenterTask(task.id, task.dispatchVersion, { clientOptions: { tokenEndpoint: "https://lwa.fixture.invalid/token", fetch: async () => { allHttp++; throw new Error("Unexpected HTTP"); } } });
    assert.equal(allHttp, 0);
    assert.ok(["BLOCKED", "FAILED"].includes((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status));
  }
});

test("page transaction rolls back business rows and cursor on archive write failure", async () => {
  const f = await fresh(), task = await f.request(); fault = 0; failCommit = true;
  try {
    assert.equal((await f.slice(task.id)).status, "FAILED");
    assert.equal(await prisma.amazonOrderRecord.count({ where: f.scope }), 0);
    assert.equal(await prisma.amazonSyncPage.count({ where: { taskId: task.id } }), 0);
    const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
    assert.equal(cursor.nextTokenCiphertext, null); assert.equal(cursor.lastSuccessAt, null);
  } finally {
    failCommit = false;
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fixture_reject_order_page ON "AmazonSyncRawPage"');
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS fixture_reject_order_page()");
  }
});

test("disabling an order binding fences orphan jobs and leaves recoverable cursor", async () => {
  const f = await fresh(), task = await f.request(); fault = 0; await f.slice(task.id); calls.length = 0;
  await f.approved({ action: "save-source", authorizationId: f.authId, sellerAccountId: f.store, marketplaceId: site, resource: "orders", freshnessMinutes: 60, enabled: false });
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status, "CANCELLED");
  await processSyncCenterTask(task.id, task.dispatchVersion, { clientOptions: { fetch: async () => { throw new Error("Unexpected HTTP"); }, tokenEndpoint: "https://lwa.fixture.invalid/token" } });
  assert.equal(calls.length, 0);
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(cursor.status, "CANCELLED"); assert.ok(cursor.nextTokenCiphertext);
});

test("P2 single orders job fills details across pages, stores exact money and encrypts all PII", async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; calls.length = 0;
  const run = await f.request();
  assert.ok((run.frozenScope as Prisma.JsonObject).orderPolicy);
  await f.slice(run.id); // list page 1, durable work before advancing
  assert.equal(await prisma.amazonOrderDetailWork.count({ where: { ...f.scope, status: "PENDING" } }), 1);
  await f.slice(run.id); // detail 1
  await f.slice(run.id); // list page 2 (duplicate order 1 already complete)
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(cursor.listComplete, true); assert.equal(cursor.lastSuccessAt, null); assert.equal(cursor.status, "RUNNING");
  assert.equal((await readOrders(f.scope, new URLSearchParams(), f.actor)).detailsComplete, false);
  const done = await f.slice(run.id);
  assert.equal(done.status, "SUCCEEDED"); assert.equal(done.pagesCompleted, 2); assert.equal(done.detailsCompletedCount, 2);
  const rows = await prisma.amazonOrderRecord.findMany({ where: f.scope, include: { items: true } });
  assert.equal(rows.length, 2); assert.equal(rows[0].grandTotalOriginal, fixture("detail-1").order.proceeds.grandTotal.amount);
  assert.ok(rows[0].grandTotalAmount?.equals(rows[0].grandTotalOriginal!));
  assert.equal(rows[0].items[0].proceedsOriginal, "12.3400"); assert.equal(rows[0].items[0].proceedsAmount?.toString(), "12.34");
  const raw = String(unseal(rows[0].detailCiphertext!, f.scope, rows[0].id, "amazon-order-detail.v1").rawBody);
  assert.ok(raw.includes("fixture-private-gift") && raw.includes("fixture-private-buyer"));
  assert.throws(() => unseal(rows[0].detailCiphertext!, { ...f.scope, workspaceId: "other-fixture" }, rows[0].id, "amazon-order-detail.v1"));
  const logs = await prisma.amazonSyncTaskLog.findMany({ where: { taskId: run.id } });
  const view = await readOrders(f.scope, new URLSearchParams(), f.actor);
  assert.equal(view.detailsComplete, true); assert.ok(view.rows.every(r => r.detailsCurrent));
  for (const text of [JSON.stringify(rows), JSON.stringify(logs), JSON.stringify(view), JSON.stringify(done.summary)]) {
    for (const secret of ["fixture-private", "fixture-access", "fixture-refresh", "fixture-secret"]) assert.ok(!text.includes(secret));
  }
  assert.ok(!JSON.stringify(view).includes("detailCiphertext"));
  const coverage = (done.summary as Prisma.JsonObject).coverage as Prisma.JsonObject;
  assert.equal(coverage.piiCollected, null); assert.equal(coverage.rawMayContainPii, true);
  const bucket = await prisma.amazonSyncTokenBucket.findUniqueOrThrow({ where: { bucketKey: orderBucketKey(`fixture-seller-${f.authId}`, `fixture-${f.authId}`, "getOrder") } });
  assert.equal(bucket.observedLimit, 0.25);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id } }), 4);
  assert.equal(calls.filter(c => c.path.endsWith("/orders")).length, 2);
  assert.equal(calls.filter(c => !c.path.endsWith("/orders")).length, 2);
  // Replay identical batch: same facts/items/work, no repeat detail fetch.
  await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { status: "FAILED", activeRunId: null, listComplete: false } });
  const replay = await f.request(); await f.slice(replay.id); assert.equal((await f.slice(replay.id)).status, "SUCCEEDED");
  assert.equal(await prisma.amazonOrderRecord.count({ where: f.scope }), 2);
  assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 2);
  assert.equal(await prisma.amazonOrderDetailWork.count({ where: f.scope }), 2);
  assert.equal(calls.filter(c => !c.path.endsWith("/orders")).length, 2);
});

test("P2 failure after final list page resumes only pending detail under a new execution approval", async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; calls.length = 0;
  const task = await f.request(); await f.slice(task.id); await f.slice(task.id); await f.slice(task.id);
  detailFault = 500; failedDetail = "fixture-order-2";
  assert.equal((await f.slice(task.id)).status, "RETRY_WAIT");
  await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { status: "FAILED", nextAttemptAt: new Date(0) } });
  detailFault = 0;
  const restart = await f.request(); const result = await f.slice(restart.id);
  assert.equal(result.status, "SUCCEEDED"); assert.equal(result.pagesCompleted, 0); assert.equal(result.detailsCompletedCount, 1);
  assert.equal(calls.filter(c => c.path.endsWith("/orders")).length, 2);
  assert.equal(calls.filter(c => c.path.endsWith("fixture-order-2")).length, 2);
});

test("P2 detail 400/403/404 do not retry; 429 and 500 retain pending work with bounded retry", async () => {
  for (const status of [400, 403, 404, 429, 500]) {
    const f = await fresh(true); fault = 0; detailFault = 0; const task = await f.request(); await f.slice(task.id);
    calls.length = 0; detailFault = status; failedDetail = "*";
    const result = await f.slice(task.id);
    assert.equal(result.status, [429, 500].includes(status) ? "RETRY_WAIT" : "FAILED");
    assert.equal(calls.length, 1); assert.equal(result.failedCount, 1); assert.equal(result.detailsCompletedCount, 0);
    assert.equal(await prisma.amazonOrderDetailWork.count({ where: { ...f.scope, status: "PENDING" } }), 1);
    const checkpoints = await readReportParseEvidence(f.scope, new URLSearchParams({ taskId: task.id }), f.actor);
    const evidence = checkpoints.events.map(e => e.evidence as Prisma.JsonObject).filter(e => e.operation === "getOrder");
    assert.equal(evidence.length, 0, "HTTP errors are archived but are not parsed business responses");
    const logs = await prisma.amazonSyncTaskLog.findMany({ where: { taskId: task.id } });
    assert.ok(logs.some(l => l.event === "getOrder" && l.requestId === "fixture-detail-error"));
    assert.ok(!JSON.stringify({ logs, error: result.error }).includes("fixture-private"));
    const visible = await readOrders(f.scope, new URLSearchParams({ sellerAccountId: f.store, marketplaceId: site }), f.actor);
    const recovery = visible.sources[0].recoveryTask!;
    assert.equal(recovery.id, task.id); assert.equal(recovery.stage, "FETCHING_DETAILS");
    assert.equal(recovery.status, result.status); assert.equal(recovery.lastHttpErrorStatus, status);
    assert.equal(recovery.detailsCompletedCount, 0); assert.equal(recovery.canRequestRetry, ![429, 500].includes(status));
    assert.ok(recovery.failureReason); assert.ok(!JSON.stringify(recovery).includes("fixture-private"));
    assert.ok(!JSON.stringify(recovery).includes("Ciphertext")); assert.ok(!JSON.stringify(recovery).includes("frozenScope"));
    const generic = await readDataset(f.scope, new URLSearchParams({ table: "orders", sellerAccountId: f.store, marketplaceId: site }), f.actor);
    assert.equal(orderCoverage(generic).recoveryTask?.id, task.id);
    const hidden = await fresh();
    await assert.rejects(() => readOrders(hidden.scope, new URLSearchParams({ sellerAccountId: f.store, marketplaceId: site }), hidden.actor), /未分配/);
    if (status === 429) {
      assert.equal(result.throttles, 1); assert.ok(result.nextAttemptAt > new Date());
      const bucket = await prisma.amazonSyncTokenBucket.findUniqueOrThrow({ where: { bucketKey: orderBucketKey(`fixture-seller-${f.authId}`, `fixture-${f.authId}`, "getOrder") } });
      assert.ok(bucket.blockedUntil && bucket.blockedUntil > new Date());
    }
    if (status === 500) {
      // Advance fixture eligibility, never sleep; retries stop at maxAttempts.
      for (let i = 1; i < result.maxAttempts; i++) {
        await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { nextAttemptAt: new Date(0) } });
        const retried = await f.slice(task.id);
        assert.equal(retried.status, i === result.maxAttempts - 1 ? "FAILED" : "RETRY_WAIT");
      }
    }
  }
  detailFault = 0;
});

test("P2 detail authorization and identity changes fail before any HTTP, including LWA", async () => {
  for (const mismatch of ["seller", "marketplace", "region", "policy"]) {
    const f = await fresh(true); fault = 0; detailFault = 0; const task = await f.request(); await f.slice(task.id);
    if (mismatch === "roles") await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { approvedRoles: policy.requiredRoles } });
    else if (mismatch === "policy") await prisma.amazonSyncDataSource.update({ where: { id: f.source.id }, data: { orderPolicy: { ...fixture("policy-details"), applicationId: `fixture-${f.authId}`, details: { ...fixture("policy-details").details, purpose: "changed.fixture" } } } });
    else if (mismatch === "region") await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { awsRegion: "fixture-other-region", endpoint: endpoints["fixture-other-region"] } });
    else {
      const frozen: Prisma.InputJsonObject = { ...(task.frozenScope as Prisma.JsonObject), [mismatch === "seller" ? "amazonSellerId" : "marketplaceId"]: "wrong-fixture-identity" };
      await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { frozenScope: frozen, frozenScopeDigest: digest(frozen) } });
    }
    let http = 0; const result = await f.slice(task.id, async () => { http++; throw new Error("Unexpected fixture HTTP"); });
    assert.equal(http, 0); assert.ok(["FAILED", "BLOCKED"].includes(result.status));
    assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 0);
  }
});

test("exhausted detail lease resumes through approved retry without re-reading committed pages or items", async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false; calls.length = 0;
  const task = await f.request();
  await f.slice(task.id); await f.slice(task.id); await f.slice(task.id);
  const before = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(before.detailsCompletedCount, 1); assert.equal(before.stage, "FETCHING_DETAILS");
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const rawCount = await prisma.amazonSyncRawPage.count({ where: { taskId: task.id } });
  await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { status: "RUNNING", leaseOwner: "fixture-interrupted-worker", leaseExpiresAt: new Date(0), attempts: before.maxAttempts } });
  const previousDriver = process.env.QUEUE_DRIVER;
  try {
    process.env.QUEUE_DRIVER = "redis";
    await tickSyncCenter(new Date(), { taskIds: [task.id], exportIds: [] });
  } finally {
    if (previousDriver === undefined) delete process.env.QUEUE_DRIVER;
    else process.env.QUEUE_DRIVER = previousDriver;
  }
  const failed = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(failed.status, "FAILED"); assert.equal(failed.stage, "FETCHING_DETAILS");
  const readiness = await prisma.$transaction(tx => orderRecoveryReadiness(tx, failed));
  assert.equal(readiness?.state, "CHECKPOINT_VALID");
  assert.equal(readiness?.checkpoint?.pendingDetails, 1);
  assert.equal(readiness?.checkpoint?.detailsCompleted, 1);
  assert.equal(readiness?.checkpoint?.archivedResponses, rawCount);
  assert.equal(readiness?.checkpoint?.nextOperation, "getOrder");
  assert.equal(readiness?.approvalRequired, true); assert.equal(readiness.started, false);
  assert.equal((await prisma.$transaction(tx => orderRecoveryReadiness(tx, { ...failed, stage: "PURGED" })))?.reason, "CHECKPOINT_PURGED");
  assert.ok(!/cursorDigest|Ciphertext|fixture-order|frozenScope/.test(JSON.stringify(readiness)));
  assert.deepEqual(await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } }), failed, "preview never changes task counters or approvals");
  const saved = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(saved.nextTokenCiphertext, cursor.nextTokenCiphertext); assert.equal(saved.listComplete, true);
  const failedView = await readDataset(f.scope, new URLSearchParams({ table: "orders", sellerAccountId: f.store, marketplaceId: site }), f.actor);
  assert.equal(orderCoverage(failedView).window?.status, "FAILED");
  assert.equal(orderCoverage(failedView).window?.detailsComplete, false);
  assert.deepEqual(orderCoverage(failedView).page, { returned: 2, detailsCurrent: 1, detailsMissingOrStale: 1 });
  assert.ok(failedView.warnings.some(w => w.includes("未采集或已过期")));
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: task.id } }), rawCount);
  const previousCalls = calls.length;
  await processSyncCenterTask(task.id, before.dispatchVersion, { clientOptions: { fetch: async () => { throw new Error("stale worker must not call HTTP"); } } });
  await f.approved({ action: "control-task", id: task.id, control: "retry" });
  const done = await f.slice(task.id);
  assert.equal(done.status, "SUCCEEDED", done.error ?? ""); assert.equal(done.detailsCompletedCount, 2);
  assert.equal(await prisma.$transaction(tx => orderRecoveryReadiness(tx, done)), null);
  assert.equal(done.pagesCompleted, before.pagesCompleted);
  assert.deepEqual(calls.slice(previousCalls).map(call => call.path), ["/orders/2026-01-01/orders/fixture-order-2"]);
  assert.equal(await prisma.amazonOrderRecord.count({ where: f.scope }), 2);
  assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 2);
  const view = await readOrders(f.scope, new URLSearchParams(), f.actor); assert.equal(view.detailsComplete, true);
  const recoveredView = await readDataset(f.scope, new URLSearchParams({ table: "orders", sellerAccountId: f.store, marketplaceId: site }), f.actor);
  assert.equal(orderCoverage(recoveredView).window?.status, "SUCCEEDED");
  assert.equal(orderCoverage(recoveredView).window?.detailsComplete, true);
  assert.deepEqual(orderCoverage(recoveredView).page, { returned: 2, detailsCurrent: 2, detailsMissingOrStale: 0 });
  assert.ok(!recoveredView.warnings.some(w => w.includes("未采集或已过期") || w.includes("尚未完成")));
});

test("P2 detail commit failure rolls back items/encrypted payload/work; retry completes same pending item", async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; const task = await f.request(); await f.slice(task.id);
  failDetailCommit = true;
  try {
    assert.equal((await f.slice(task.id, async input => {
      const response = await f.fetcher(input), body = await response.json();
      body.order.fulfillment.fulfilledBy = "AMAZON";
      body.order.fulfillment.fulfillmentServiceLevel = "Standard";
      return Response.json(body, { headers: response.headers });
    })).status, "FAILED");
    const row = await prisma.amazonOrderRecord.findFirstOrThrow({ where: f.scope });
    assert.equal(row.detailCiphertext, null); assert.equal(row.detailsUpdatedAt, null);
    assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 0);
    assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: task.id } }), 2, "detail original survives a rolled-back fact transaction");
    assert.equal(await prisma.amazonOrderDetailWork.count({ where: { ...f.scope, status: "PENDING" } }), 1);
    const checkpoints = await readReportParseEvidence(f.scope, new URLSearchParams({ taskId: task.id }), f.actor);
    const evidence = checkpoints.events.map(e => e.evidence as Prisma.JsonObject).filter(e => e.operation === "getOrder");
    assert.deepEqual(evidence.map(e => e.phase).sort(), ["ARCHIVED", "ATTEMPT_FAILED"]);
    assert.ok(evidence.every(e => e.rowsCommitted === 0));
    assert.ok(!JSON.stringify(checkpoints).includes("fixture-private"));
    assert.equal(checkpoints.rawBodyIncluded, false);
    assert.equal(checkpoints.oldArchivesBackfilled, false);
  } finally {
    failDetailCommit = false;
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fixture_reject_detail ON "AmazonOrderDetailWork"');
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS fixture_reject_detail()");
  }
  const beforeRetry = calls.filter(c => c.path.endsWith("fixture-order-1")).length;
  const bucketKey = orderBucketKey(`fixture-seller-${f.authId}`, `fixture-${f.authId}`, "getOrder");
  const blocked = await prisma.amazonSyncTokenBucket.update({ where: { bucketKey }, data: { tokens: 0, blockedUntil: new Date(Date.now() + 3600000) } });
  await f.approved({ action: "control-task", id: task.id, control: "retry" });
  await f.slice(task.id);
  assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 1, "archive replay commits facts even while Amazon quota is blocked");
  const replayedOrder = await prisma.amazonOrderRecord.findFirstOrThrow({ where: f.scope });
  assert.equal(replayedOrder.fulfilledBy, "AMAZON"); assert.equal(replayedOrder.fulfillmentServiceLevel, "Standard");
  assert.deepEqual(await prisma.amazonSyncTokenBucket.findUniqueOrThrow({ where: { bucketKey } }), blocked, "archive replay leaves upstream quota untouched");
  const checkpoints = await readReportParseEvidence(f.scope, new URLSearchParams({ taskId: task.id }), f.actor);
  assert.equal(checkpoints.scope, "REGISTERED_ORDER_PARSER_CHECKPOINTS_ONLY");
  const replayEvidence = checkpoints.events.map(e => e.evidence as Prisma.JsonObject).find(e => e.operation === "getOrder" && e.phase === "ROWS_COMMITTED");
  assert.ok(replayEvidence);
  assert.equal(replayEvidence.replayed, true);
  assert.equal(replayEvidence.parserVersion, "orders.2026-01-01.v2");
  assert.equal(replayEvidence.schemaVersion, "orders.non-pii.v2");
  assert.equal(replayEvidence.officialSchemaVersion, null);
  assert.equal(replayEvidence.rowsCommitted, 1);
  assert.equal(replayEvidence.rowKind, "ORDER_ITEM");
  const original = await prisma.amazonSyncRawPage.findUniqueOrThrow({ where: { taskId_page: { taskId: task.id, page: Number(replayEvidence.rawPage) } } });
  assert.equal(replayEvidence.rawSha256, original.bodySha256);
  const foreign = await fresh();
  await assert.rejects(() => readReportParseEvidence(foreign.scope, new URLSearchParams({ taskId: task.id }), foreign.actor), /不可访问/);
  assert.equal(calls.filter(c => c.path.endsWith("fixture-order-1")).length, beforeRetry, "retry reuses the authenticated detail original without HTTP");
  await prisma.amazonSyncTokenBucket.update({ where: { bucketKey }, data: { tokens: 10, blockedUntil: null } });
  await f.slice(task.id); assert.equal((await f.slice(task.id)).status, "SUCCEEDED");
});

test("approved core detail transition backfills existing orders without rewriting completed list cursors", async () => {
  const f = await fresh(); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false; calls.length = 0;
  const first = await f.request(); await f.slice(first.id);
  await prisma.amazonSyncTokenBucket.updateMany({ data: { tokens: 20, replenishedAt: new Date(0) } });
  const completed = await f.slice(first.id); assert.equal(completed.status, "SUCCEEDED");
  const oldCursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 0);
  const { orderAccessEvidence } = await import("@/lib/amazon-sync/order-access-evidence");
  const proof = orderAccessEvidence({ ...f.scope, authorizationId: f.authId, authorizationRevision: 1, marketplaceId: site }, { status: 200, parsed: true, requestId: "fixture-proof" });
  const details = { includedData: [], requiredRoles: ["Inventory and Order Tracking"], purpose: "order_items", requestsPerSecond: .2, burst: 1, maxOrders: 5000, backfillExisting: true, accessEvidence: proof };
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { approvedRoles: [], rolesAttestedAt: null } });
  await f.approved({ action: "save-source", revision: 1, authorizationId: f.authId, sellerAccountId: f.store, marketplaceId: site, resource: "orders", enabled: true, freshnessMinutes: 60, orderPolicy: { ...(f.source.orderPolicy as Prisma.JsonObject), details } });
  const publicSources = await listSources(f.scope, { resource: "orders" }, f.actor);
  assert.ok(!JSON.stringify(publicSources).includes(proof));
  assert.equal((publicSources[0].orderPolicy as { details: { accessEvidence: string } }).details.accessEvidence, "API_ACCESS_EVIDENCE_REDACTED");
  await prisma.amazonOrderRecord.updateMany({ where: f.scope, data: { amazonSellerId: "" } });
  const second = await f.request();
  // The new list window is committed before historical details use capacity.
  const transport = emptyOrderWindow(f);
  assert.equal((await f.slice(second.id, transport)).detailsCompletedCount, 0);
  const progress = await f.slice(second.id, transport);
  assert.equal(progress.detailsCompletedCount, 1);
  assert.equal(calls.at(-1)?.path.startsWith("/orders/2026-01-01/orders/"), true);
  assert.ok(await prisma.amazonOrderItemRecord.count({ where: f.scope }) > 0);
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(cursor.watermarkFrom.toISOString(), new Date(oldCursor.watermarkTo.getTime() - policy.overlapSeconds * 1000).toISOString());
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: first.id } })).status, "SUCCEEDED");
  assert.equal((await readOrders(f.scope, new URLSearchParams(), f.actor)).sources[0].detailsEnabled, true);
  const coreData = await readDataset(f.scope, new URLSearchParams({ table: "order_items", sellerAccountId: f.store, marketplaceId: site }), f.actor);
  assert.equal(orderCoverage(coreData).detailsEnabled, true);
  assert.equal(orderCoverage(coreData).moneyRequest.proceedsRequested, false);
  assert.ok(coreData.warnings.some(w => w.includes("策略未请求 PROCEEDS")));
});

for (const oldPending of [false, true]) test(`backfill repairs stale details and leaves current details alone (old pending work: ${oldPending})`, async () => {
  const f = await fresh(); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false; calls.length = 0;
  const first = await f.request(); await f.slice(first.id); await f.slice(first.id);
  const { orderAccessEvidence } = await import("@/lib/amazon-sync/order-access-evidence");
  const proof = orderAccessEvidence({ ...f.scope, authorizationId: f.authId, authorizationRevision: 1, marketplaceId: site }, { status: 200, parsed: true, requestId: "fixture-stale-repair" });
  const details = { includedData: [], requiredRoles: ["Inventory and Order Tracking"], purpose: "order_items", requestsPerSecond: .2, burst: 1, maxOrders: 5000, backfillExisting: true, accessEvidence: proof };
  await f.approved({ action: "save-source", revision: 1, authorizationId: f.authId, sellerAccountId: f.store, marketplaceId: site, resource: "orders", enabled: true, freshnessMinutes: 60, orderPolicy: { ...(f.source.orderPolicy as Prisma.JsonObject), details } });
  const updatedSource = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } });
  const policyDigest = digest(parseOrderSyncPolicy(updatedSource.orderPolicy).details);
  const records = await prisma.amazonOrderRecord.findMany({ where: f.scope, orderBy: { amazonOrderId: "asc" } });
  for (const row of records) await prisma.amazonOrderRecord.update({ where: { id: row.id }, data: {
    detailPolicyDigest: policyDigest,
    detailsUpdatedAt: row.amazonOrderId === "fixture-order-1" ? new Date(row.sourceUpdatedAt.getTime() - 1000) : row.sourceUpdatedAt,
  } });
  const before = await readOrders(f.scope, new URLSearchParams(), f.actor);
  assert.equal(before.rows.find(row => row.amazonOrderId === "fixture-order-1")?.detailsCurrent, false);
  assert.equal(before.rows.find(row => row.amazonOrderId === "fixture-order-2")?.detailsCurrent, true);
  const oldCursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const workKey = { sourceId: f.source.id, amazonOrderId: records[0].amazonOrderId, listedUpdatedAt: records[0].sourceUpdatedAt, policyDigest };
  if (oldPending) await prisma.amazonOrderDetailWork.create({ data: {
    id: digest(workKey), ...f.scope, ...workKey, orderRecordId: records[0].id,
    watermarkFrom: oldCursor.watermarkFrom, watermarkTo: oldCursor.watermarkTo, status: "PENDING",
  } });
  const next = await f.request(), requestsBefore = calls.length;
  const transport = emptyOrderWindow(f);
  await f.slice(next.id, transport);
  const repaired = await f.slice(next.id, transport);
  assert.equal(repaired.detailsCompletedCount, 1, repaired.error ?? "");
  assert.deepEqual(calls.slice(requestsBefore).map(call => call.path), ["/orders/2026-01-01/orders", "/orders/2026-01-01/orders/fixture-order-1"]);
  assert.equal(await prisma.amazonOrderDetailWork.count({ where: { ...f.scope, amazonOrderId: "fixture-order-2" } }), 0);
  const adopted = await prisma.amazonOrderDetailWork.findUniqueOrThrow({ where: { id: digest(workKey) } });
  const activeCursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(adopted.status, "SUCCEEDED");
  assert.equal(adopted.watermarkFrom.getTime(), activeCursor.watermarkFrom.getTime());
  assert.equal(adopted.watermarkTo.getTime(), activeCursor.watermarkTo.getTime());
  assert.equal(await prisma.amazonOrderDetailWork.count({ where: f.scope }), 1);
  const after = await readDataset(f.scope, new URLSearchParams({ table: "orders", sellerAccountId: f.store, marketplaceId: site }), f.actor);
  assert.deepEqual(orderCoverage(after).page, { returned: 2, detailsCurrent: 2, detailsMissingOrStale: 0 });
  const row = await prisma.amazonOrderRecord.findUniqueOrThrow({ where: { id: records[0].id } });
  assert.ok(row.detailCiphertext); assert.equal(row.detailsUpdatedAt?.getTime(), row.sourceUpdatedAt.getTime());
  assert.equal(await prisma.amazonOrderItemRecord.count({ where: { ...f.scope, orderRecordId: row.id } }), 1);
  await processSyncCenterTask(next.id, next.dispatchVersion, { clientOptions: { fetch: async () => { throw new Error("stale dispatch must not request Amazon"); } } });
  assert.equal(calls.length, requestsBefore + 2);
  assert.equal(await prisma.amazonOrderItemRecord.count({ where: { ...f.scope, orderRecordId: row.id } }), 1);
});

test("a listed order adopts its earlier pending detail without enabling historical backfill", async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false; calls.length = 0;
  const task = await f.request();
  const sourcePolicy = parseOrderSyncPolicy(f.source.orderPolicy);
  assert.equal(sourcePolicy.details?.backfillExisting, undefined);
  const orderId = "fixture-order-1", recordId = randomUUID();
  const listedUpdatedAt = new Date("2026-11-01T00:10:00Z"), policyDigest = digest(sourcePolicy.details);
  await prisma.amazonOrderRecord.create({ data: {
    ...f.scope, id: recordId, sourceId: f.source.id, sourceRunId: task.id,
    sellerAccountId: f.store, amazonSellerId: `fixture-seller-${f.authId}`, marketplaceId: site,
    amazonOrderId: orderId, createdTime: new Date("2026-10-31T20:00:00Z"), sourceUpdatedAt: listedUpdatedAt,
    rawStatus: "UNSHIPPED", normalizedStatus: "ready", marketplaceTimeZone: "Etc/UTC", capturedAt: new Date(),
  } });
  const workKey = { sourceId: f.source.id, amazonOrderId: orderId, listedUpdatedAt, policyDigest };
  const workId = digest(workKey);
  await prisma.amazonOrderDetailWork.create({ data: { ...f.scope, id: workId, ...workKey, orderRecordId: recordId,
    watermarkFrom: new Date("2026-10-31T23:00:00Z"), watermarkTo: new Date("2026-11-01T00:00:00Z") } });
  await f.slice(task.id);
  const adopted = await prisma.amazonOrderDetailWork.findUniqueOrThrow({ where: { id: workId } });
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(adopted.watermarkFrom.getTime(), cursor.watermarkFrom.getTime());
  assert.equal(adopted.watermarkTo.getTime(), cursor.watermarkTo.getTime());
  assert.equal((await f.slice(task.id)).detailsCompletedCount, 1);
  assert.equal(await prisma.amazonOrderDetailWork.count({ where: f.scope }), 1);
  assert.equal((await prisma.amazonOrderDetailWork.findUniqueOrThrow({ where: { id: workId } })).status, "SUCCEEDED");
  assert.equal(await prisma.amazonOrderItemRecord.count({ where: { ...f.scope, orderRecordId: recordId } }), 1);
  assert.deepEqual(calls.map(call => call.path), ["/orders/2026-01-01/orders", "/orders/2026-01-01/orders/fixture-order-1"]);
});

test('continuity grants cannot authorize an unrelated tenant', async()=>{
 const f=await fresh(true);fault=0;detailFault=0;failCommit=false;failDetailCommit=false;
 const {continuityAction,continuityPolicyDigest}=await import('@/lib/amazon-sync/continuity-policy');
 const {continuityEvidence,continuityOrderTurn}=await import('@/lib/amazon-sync/continuity-access');
 const {orderAccessEvidence}=await import('@/lib/amazon-sync/order-access-evidence');
 const prior=process.env.AMAZON_DATA_CENTER_ENVIRONMENT;process.env.AMAZON_DATA_CENTER_ENVIRONMENT='local';
 try{
  // Production-like policy functions must reject unrelated fixture tenants.
  const source=await prisma.amazonSyncDataSource.findUniqueOrThrow({where:{id:f.source.id},include:{authorization:true}});
  const proof=orderAccessEvidence({...f.scope,authorizationId:f.authId,authorizationRevision:1,marketplaceId:site},{status:200,parsed:true,requestId:'renewal-fixture'});
  await prisma.auditLog.create({data:{organizationId:f.scope.organizationId,userId:f.actor,action:continuityAction,idempotencyKey:'amazon-continuity-v1:'+source.id,entityId:source.id,metadata:{...f.scope,enabled:true,authorizationId:f.authId,authorizationRevision:1,marketplaceId:site,resource:'orders',policyDigest:continuityPolicyDigest(source.orderPolicy),accessEvidence:proof}}});
  assert.equal(await continuityEvidence(prisma,source),undefined);
  assert.equal(await continuityOrderTurn(prisma,source,'unrelated'),true);
  const before=digest(source.orderPolicy);
  assert.equal(continuityPolicyDigest({details:{includedData:[],accessEvidence:'old'}}),continuityPolicyDigest({details:{includedData:[],accessEvidence:'new'}}));
  assert.equal(digest(source.orderPolicy),before);
 }finally{if(prior===undefined)delete process.env.AMAZON_DATA_CENTER_ENVIRONMENT;else process.env.AMAZON_DATA_CENTER_ENVIRONMENT=prior;}
});


test('local renewal keeps frozen policy and cursor; revoked grant fails closed',async()=>{
 const previous=process.env.AMAZON_DATA_CENTER_ENVIRONMENT;
 process.env.AMAZON_DATA_CENTER_ENVIRONMENT='local';site='ATVPDKIKX0DER';
 try{
  const f=await fresh(true,true);fault=0;detailFault=0;failCommit=false;failDetailCommit=false;
  const first=await f.request();await f.slice(first.id,async(input)=>{const url=new URL(String(input));if(url.hostname==='lwa.fixture.invalid')return Response.json({access_token:'fixture',expires_in:3600});const page=fixture('page-1');const wire=JSON.stringify(page).replaceAll('fixture-marketplace',site);return new Response(wire,{headers:{'x-amzn-RequestId':'first-fixture'}});});
  const {orderAccessEvidence}=await import('@/lib/amazon-sync/order-access-evidence');
  const {continuityAction,continuityPolicyDigest}=await import('@/lib/amazon-sync/continuity-policy');
  const {maintainContinuity}=await import('@/lib/amazon-sync/continuity');
  const {continuityEvidence}=await import('@/lib/amazon-sync/continuity-access');
  const expired=orderAccessEvidence({...f.scope,authorizationId:f.authId,authorizationRevision:1,marketplaceId:site},{status:200,parsed:true,requestId:'old'},new Date(Date.now()-2*86400000));
  const p={...(f.source.orderPolicy as Prisma.JsonObject),details:{includedData:[],requiredRoles:['Inventory and Order Tracking'],purpose:'operations_order_items',requestsPerSecond:.2,burst:1,maxOrders:5000,backfillExisting:true,accessEvidence:expired}};
  await prisma.amazonSyncDataSource.update({where:{id:f.source.id},data:{orderPolicy:p}});
  await prisma.amazonSpApiAuthorization.update({where:{id:f.authId},data:{approvedRoles:[],rolesAttestedAt:null}});
  const before=await prisma.amazonSyncResourceCursor.findUniqueOrThrow({where:{sourceId:f.source.id}});
  const grant=await prisma.auditLog.create({data:{organizationId:f.scope.organizationId,userId:f.actor,action:continuityAction,idempotencyKey:'amazon-continuity-v1:'+f.source.id,entityId:f.source.id,metadata:{...f.scope,enabled:true,authorizationId:f.authId,authorizationRevision:1,marketplaceId:site,resource:'orders',policyDigest:continuityPolicyDigest(p),resumePlan:false}}});
  await prisma.amazonSyncTokenBucket.updateMany({data:{tokens:1,replenishedAt:new Date(0),blockedUntil:null}});
  let probes=0;
  await maintainContinuity([f.scope],new Date(),{tokenEndpoint:'https://lwa.fixture.invalid/token',fetch:async(input)=>{const url=new URL(String(input));if(url.hostname==='lwa.fixture.invalid')return Response.json({access_token:'fixture',expires_in:3600});assert.ok(url.pathname.startsWith('/orders/2026-01-01/orders/'));probes++;return new Response(JSON.stringify(fixture('detail-1')).replaceAll('fixture-marketplace',site),{headers:{'x-amzn-RequestId':'renewed-fixture'}});}});
  assert.equal(probes,1);
  const source=await prisma.amazonSyncDataSource.findUniqueOrThrow({where:{id:f.source.id},include:{authorization:true}});
  const proof=await continuityEvidence(prisma,source);assert.ok(proof&&proof!==expired);
  assert.deepEqual(source.orderPolicy,p);assert.equal(source.revision,f.source.revision);
  const after=await prisma.amazonSyncResourceCursor.findUniqueOrThrow({where:{sourceId:f.source.id}});assert.deepEqual(after,before);
  const {continuityOrderTurn,continuityProbeDue}=await import('@/lib/amazon-sync/continuity-access');
  const secondId=randomUUID(),secondRun=randomUUID(),secondSite='A2EUQ1WTGCTBG2';
  await prisma.amazonSyncDataSource.create({data:{...f.scope,id:secondId,authorizationId:f.authId,sellerAccountId:f.store,marketplaceId:secondSite,resource:'orders',enabled:true,freshnessMinutes:60,orderPolicy:p}});
  const original=await prisma.amazonSyncRun.findUniqueOrThrow({where:{id:first.id}});
  await prisma.amazonSyncRun.create({data:{...f.scope,id:secondRun,sourceId:secondId,resource:'orders',requestedByUserId:f.actor,executionVersion:2,authorizationRevision:1,status:'WAITING',stage:'FETCHING',mode:'incremental',idempotencyKey:secondRun,frozenScope:original.frozenScope!,frozenScopeDigest:original.frozenScopeDigest,startedAt:new Date(Date.now()+1000)}});
  await prisma.amazonSyncResourceCursor.create({data:{...f.scope,id:randomUUID(),sourceId:secondId,resource:'orders',amazonSellerId:source.authorization.amazonSellerId,marketplaceId:secondSite,watermarkFrom:before.watermarkFrom,watermarkTo:before.watermarkTo,status:'RUNNING',listComplete:false}});
  await prisma.amazonSyncRun.update({where:{id:first.id},data:{stage:'FETCHING'}});
  assert.equal(await continuityOrderTurn(prisma,source,first.id),false);
  await prisma.amazonSyncTaskLog.create({data:{...f.scope,id:randomUUID(),taskId:secondRun,attempt:1,event:'searchOrders',stage:'REQUEST',createdAt:new Date(Date.now()+1000)}});
  assert.equal(await continuityOrderTurn(prisma,source,first.id),true);
  // An empty marketplace's new run retains its source's last actual request;
  // it must not return to the front on every new historical window.
  await prisma.amazonSyncRun.update({where:{id:secondRun},data:{status:'SUCCEEDED'}});
  const replacementRun=randomUUID();
  await prisma.amazonSyncRun.create({data:{...f.scope,id:replacementRun,sourceId:secondId,resource:'orders',requestedByUserId:f.actor,executionVersion:2,authorizationRevision:1,status:'WAITING',stage:'FETCHING',mode:'incremental',idempotencyKey:replacementRun,frozenScope:original.frozenScope!,frozenScopeDigest:original.frozenScopeDigest,startedAt:new Date(Date.now()+2000)}});
  assert.equal(await continuityOrderTurn(prisma,source,first.id),true,'fairness persists across empty-window generations');
  await prisma.auditLog.create({data:{organizationId:f.scope.organizationId,userId:f.actor,action:continuityAction,idempotencyKey:'amazon-continuity-v1:'+secondId,entityId:secondId,metadata:{...f.scope,enabled:true,authorizationId:f.authId,authorizationRevision:1,marketplaceId:secondSite,resource:'orders',policyDigest:continuityPolicyDigest(p)}}});
  assert.equal(await continuityProbeDue(prisma,source),false,'empty sibling must not stall work');
  const originalOrder=await prisma.amazonOrderRecord.findFirstOrThrow({where:{sourceId:f.source.id}});
  await prisma.amazonOrderRecord.create({data:{...originalOrder,id:randomUUID(),sourceId:secondId,sourceRunId:secondRun,marketplaceId:secondSite}});
  assert.equal(await continuityProbeDue(prisma,source),true,'due sibling probe reserves shared operation slot');
  await prisma.auditLog.update({where:{idempotencyKey:'amazon-continuity-v1:'+secondId},data:{metadata:{enabled:false}}});
  assert.equal(await continuityProbeDue(prisma,source),false);
  await prisma.auditLog.update({where:{id:grant.id},data:{metadata:{enabled:false}}});assert.equal(await continuityEvidence(prisma,source),undefined);
  const inventoryId=randomUUID(),planId=randomUUID();
  await prisma.amazonSyncDataSource.create({data:{...f.scope,id:inventoryId,authorizationId:f.authId,sellerAccountId:f.store,marketplaceId:secondSite,resource:'inventory_age',enabled:true,freshnessMinutes:60}});
  await prisma.amazonSyncSchedule.create({data:{...f.scope,id:planId,resource:'inventory_age',executionVersion:2,planKey:'auto-v1:'+inventoryId,name:'Fixture recovery',revision:2,mode:'incremental',intervalMinutes:60,enabled:false,updatedByUserId:f.actor,nextRunAt:new Date()}});
  await prisma.amazonSyncPlanTarget.create({data:{...f.scope,scheduleId:planId,sourceId:inventoryId}});
  const recoveryGrant=await prisma.auditLog.create({data:{organizationId:f.scope.organizationId,userId:f.actor,action:continuityAction,idempotencyKey:'amazon-continuity-v1:'+inventoryId,entityId:inventoryId,metadata:{...f.scope,enabled:true,authorizationId:f.authId,authorizationRevision:1,marketplaceId:secondSite,resource:'inventory_age',policyDigest:continuityPolicyDigest(null),reportRecoveryResume:{planId,pausedRevision:2,sourceRevision:1,day:'2026-11-07'}}}});
  await maintainContinuity([f.scope]);
  assert.equal((await prisma.amazonSyncSchedule.findUniqueOrThrow({where:{id:planId}})).enabled,true,'restore interrupted maintenance pause');
  const recoveredGrant=await prisma.auditLog.findUniqueOrThrow({where:{id:recoveryGrant.id}});
  assert.equal((recoveredGrant.metadata as Prisma.JsonObject).reportRecoveryResume,undefined);
  await prisma.amazonSyncSchedule.update({where:{id:planId},data:{enabled:false,revision:{increment:1}}});
  await maintainContinuity([f.scope],new Date(Date.now()+120000));
  assert.equal((await prisma.amazonSyncSchedule.findUniqueOrThrow({where:{id:planId}})).enabled,false,'later manual pause must persist');
  const base={...(f.source.orderPolicy as Prisma.JsonObject)};delete base.details;
  await prisma.amazonSyncDataSource.update({where:{id:f.source.id},data:{orderPolicy:base}});
  await prisma.amazonSyncRun.update({where:{id:first.id},data:{status:'SUCCEEDED'}});
  await prisma.amazonSyncResourceCursor.update({where:{sourceId:f.source.id},data:{status:'SUCCEEDED',listComplete:true}});
  const completedCursor=await prisma.amazonSyncResourceCursor.findUniqueOrThrow({where:{sourceId:f.source.id}});
  const orderPlan=randomUUID();
  await prisma.amazonSyncSchedule.create({data:{...f.scope,id:orderPlan,resource:'orders',executionVersion:2,planKey:'auto-v1:'+f.source.id,name:'Fixture order transition',revision:1,mode:'incremental',intervalMinutes:60,enabled:true,updatedByUserId:f.actor,nextRunAt:new Date()}});
  await prisma.amazonSyncPlanTarget.create({data:{...f.scope,scheduleId:orderPlan,sourceId:f.source.id}});
  await prisma.auditLog.update({where:{id:grant.id},data:{metadata:{...f.scope,enabled:true,authorizationId:f.authId,authorizationRevision:1,marketplaceId:site,resource:'orders',policyDigest:continuityPolicyDigest(base),accessEvidence:proof,proofExpiresAt:new Date(Date.now()+86400000).toISOString(),resumePlan:true}}});
  await maintainContinuity([f.scope]);
  const transitioned=await prisma.amazonSyncDataSource.findUniqueOrThrow({where:{id:f.source.id}});
  assert.equal(transitioned.revision,2,'complete boundary enables details via approved service');
  assert.equal(((transitioned.orderPolicy as Prisma.JsonObject).details as Prisma.JsonObject).backfillExisting,true);
  assert.equal((await prisma.amazonSyncSchedule.findUniqueOrThrow({where:{id:orderPlan}})).enabled,true);
  assert.deepEqual(await prisma.amazonSyncResourceCursor.findUniqueOrThrow({where:{sourceId:f.source.id}}),completedCursor);
  const transitionMetadata=(await prisma.auditLog.findUniqueOrThrow({where:{id:grant.id}})).metadata as Prisma.JsonObject;
  assert.equal(transitionMetadata.policyDigest,continuityPolicyDigest(transitioned.orderPolicy));
  assert.equal(transitionMetadata.resumePlan,false);


 }finally{site='fixture-marketplace';if(previous===undefined)delete process.env.AMAZON_DATA_CENTER_ENVIRONMENT;else process.env.AMAZON_DATA_CENTER_ENVIRONMENT=previous;}
});


test("order_items pages actual item rows and shares scoped ERP/MCP readers without sibling leakage", async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false; calls.length = 0;
  const exactAmount = "9007199254740993.123456789012345678901234567890";
  const transport = async (input: string | URL) => {
    const response = await f.fetcher(input);
    if (!String(input).includes("/orders/fixture-order-1")) return response;
    const body = await response.json();
    body.order.fulfillment.fulfilledBy = "AMAZON";
    body.order.fulfillment.fulfillmentServiceLevel = "Standard";
    body.order.orderItems.push({ orderItemId: "fixture-item-1b", quantityOrdered: 3,
      product: { asin: "fixture-asin-b", sellerSku: "fixture-sku-b" },
      proceeds: { proceedsTotal: { amount: exactAmount, currencyCode: "XXX" } } });
    body.order.orderItems.push({ orderItemId: "fixture-item-1c", quantityOrdered: 1,
      product: { asin: "fixture-asin-c", sellerSku: "fixture-sku-c" } });
    return Response.json(body, { headers: response.headers });
  };
  const task = await f.request();
  for (let i = 0; i < 4; i++) await f.slice(task.id, transport);
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status, "SUCCEEDED");
  const mappings = await prisma.amazonFieldMappingVersion.findMany({ where: { ...f.scope, targetTable: "AmazonOrderItemRecord" } });
  assert.deepEqual([...new Set(mappings.map(m => m.targetColumn))].sort(), ["asin", "currencyCode", "orderItemId", "proceedsOriginal", "quantityOrdered", "sellerSku"].sort());
  assert.ok(mappings.every(m => m.status === "IMPLEMENTED_NOT_ACCEPTED"), "mapping registration is not live acceptance");
  const pair = { sellerAccountId: f.store, marketplaceId: site };
  const query = (filters: Record<string, string> = {}) => new URLSearchParams({ table: "order_items", ...pair, ...filters });
  const items = (result: Awaited<ReturnType<typeof readDataset>>) => result.data.items as Awaited<ReturnType<typeof readOrderItems>>["rows"];
  const first = await readDataset(f.scope, query({ amazonOrderId: "fixture-order-1", pageSize: "1" }), f.actor);
  assert.equal(first.data.total, 3); assert.equal(items(first).length, 1);
  const second = await readDataset(f.scope, query({ amazonOrderId: "fixture-order-1", pageSize: "1", page: "2" }), f.actor);
  assert.equal(items(second)[0].orderItemId, "fixture-item-1b");
  assert.equal(items(second)[0].proceedsOriginal, exactAmount);
  assert.equal(items(second)[0].fulfilledBy, "AMAZON");
  assert.equal(items(second)[0].fulfillmentServiceLevel, "Standard");
  const fulfillmentPage = await readDataset(f.scope, query({ fulfilledBy: "AMAZON", fulfillmentServiceLevel: "Standard", pageSize: "1", page: "2" }), f.actor);
  assert.equal(fulfillmentPage.data.total, 3); assert.equal(items(fulfillmentPage).length, 1);
  assert.equal(items(fulfillmentPage)[0].orderItemId, "fixture-item-1b");
  for (const filters of [{ fulfilledBy: "SELLER" }, { fulfilledBy: "amazon" }, { fulfilledBy: "AMAZON", fulfillmentServiceLevel: "DifferentService" }] as Record<string, string>[]) {
    assert.equal((await readDataset(f.scope, query(filters), f.actor)).data.total, 0);
  }
  const fulfilledOrders = await readOrders(f.scope, new URLSearchParams({ ...pair, fulfilledBy: "AMAZON", fulfillmentServiceLevel: "Standard" }), f.actor);
  assert.equal(fulfilledOrders.pagination.total, 1); assert.equal(fulfilledOrders.rows[0].amazonOrderId, "fixture-order-1");
  const storedFulfillment = await prisma.amazonOrderRecord.findFirstOrThrow({ where: { ...f.scope, amazonOrderId: "fixture-order-1" } });
  assert.equal(storedFulfillment.fulfilledBy, "AMAZON"); assert.equal(storedFulfillment.fulfillmentServiceLevel, "Standard");
  const otherOrder = await readOrderItems(f.scope, new URLSearchParams({ ...pair, amazonOrderId: "fixture-order-2" }), f.actor);
  assert.equal(otherOrder.rows[0].fulfilledBy, null); assert.equal(otherOrder.rows[0].fulfillmentServiceLevel, null);
  const fulfillmentMappings = await prisma.amazonFieldMappingVersion.findMany({ where: { ...f.scope, targetTable: "AmazonOrderRecord", targetColumn: { in: ["fulfilledBy", "fulfillmentServiceLevel"] } } });
  assert.equal(fulfillmentMappings.length, 2);
  assert.ok(fulfillmentMappings.every(m => m.status === "IMPLEMENTED_NOT_ACCEPTED" && (m.transformRule as Prisma.JsonObject).parserVersion === "orders.2026-01-01.v2"));
  assert.deepEqual(orderCoverage(second).page, { returned: 1, detailsCurrent: 1, detailsMissingOrStale: 0 });
  const third = await readDataset(f.scope, query({ orderItemId: "fixture-item-1c" }), f.actor);
  assert.equal(third.data.total, 1); assert.equal(items(third)[0].proceedsOriginal, null);
  assert.equal(items(third)[0].detailsCurrent, true);
  assert.equal(orderCoverage(third).moneyRequest.proceedsRequested, true);
  assert.ok(!third.warnings.some(w => w.includes("策略未请求 PROCEEDS")));
  assert.deepEqual(orderCoverage(third).money, { field: "proceedsOriginal", returned: 1, present: 0, missing: 1 });
  assert.ok(third.warnings.some(w => w.includes("明细有效不代表收入数据完整")));
  assert.deepEqual(orderCoverage(second).money, { field: "proceedsOriginal", returned: 1, present: 1, missing: 0 });
  assert.ok(!second.warnings.some(w => w.includes("明细有效不代表收入数据完整")));
  assert.equal(items(third)[0].currencyCode, null);
  for (const filter of [{ sellerSku: "fixture-sku-b" }, { asin: "fixture-asin-b" }] as Record<string, string>[]) {
    const filtered = await readDataset(f.scope, query(filter), f.actor);
    assert.equal(filtered.data.total, 1); assert.equal(items(filtered)[0].orderItemId, "fixture-item-1b");
  }
  assert.equal((await readDataset(f.scope, query({ sellerSku: "fixture-sku", asin: "fixture-asin-b" }), f.actor)).data.total, 0);
  assert.equal((await readDataset(f.scope, query({ from: "2026-11-02", to: "2026-11-03" }), f.actor)).data.total, 0);
  await assert.rejects(() => readOrderItems(f.scope, new URLSearchParams({ ...pair, marketplaceId: "other" }), f.actor), /数据源不属于当前账号|账号未分配|尚未接入请求的数据来源/);
  await assert.rejects(() => readOrderItems(f.scope, new URLSearchParams({ ...pair, sellerAccountId: "other" }), f.actor), /未分配/);
  await assert.rejects(() => readDataset(f.scope, new URLSearchParams({ table: "order_items" }), f.actor), /账号|范围/);
  const auth = await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { identityVerifiedAt: new Date(), identityEvidence: "OFFLINE_FIXTURE" } });
  await prisma.amazonSellerIdentity.create({ data: { ...f.scope, id: randomUUID(), ...pair, authorizationId: f.authId, amazonSellerId: auth.amazonSellerId!, region, verifiedAt: new Date() } });
  const grant = await prisma.amazonDataAccessGrant.findFirstOrThrow({ where: { ...f.scope, userId: f.actor, sellerAccountId: f.store } });
  await prisma.amazonDataAccessGrant.update({ where: { id: grant.id }, data: { marketplaceIds: [site], actions: ["view"], mcpEnabled: true } });
  const credential = await manageMcpCredential(f.scope, f.actor, { action: "create", name: "offline item reader", scopes: [{ sellerAccountId: f.store, marketplaceIds: [site] }], tools: ["data_query"], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp(`Bearer ${credential.token!}`);
  const result = await invokeAmazonMcp(identity, "data_query", { table: "order_items", ...pair, sellerSku: "fixture-sku-b" }) as Awaited<ReturnType<typeof readDataset>>;
  assert.equal(result.data.total, 1); assert.equal(items(result)[0].proceedsOriginal, exactAmount);
  assert.deepEqual((result as unknown as { evidenceRefs: unknown[] }).evidenceRefs, [{ sourceId: f.source.id, syncRunId: items(result)[0].sourceRunId }]);
  assert.equal(items(result)[0].fulfilledBy, "AMAZON"); assert.equal(items(result)[0].fulfillmentServiceLevel, "Standard");
  assert.ok(!/Ciphertext|fixture-private|detailPolicyDigest/.test(JSON.stringify(result)));
  await assert.rejects(() => invokeAmazonMcp(identity, "data_query", { table: "order_items", ...pair, marketplaceId: "other" }), /数据来源|接入/);
  // Fixed tools have their own grants and bind the dataset on the server.
  const fixedCredential = await manageMcpCredential(f.scope, f.actor, { action: "create", name: "offline fixed order reader", scopes: [{ sellerAccountId: f.store, marketplaceIds: [site] }], tools: ["get_orders", "get_order_items"], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const fixedIdentity = await authenticateAmazonMcp(`Bearer ${fixedCredential.token!}`);
  const discoverable = (await listDiscoverableAmazonMcpTools(fixedIdentity)).map(tool => tool.name);
  assert.ok(discoverable.includes("get_orders") && discoverable.includes("get_order_items"));
  const fixedItems = await invokeAmazonMcp(fixedIdentity, "get_order_items", { ...pair, sellerSku: "fixture-sku-b" }) as typeof result;
  assert.deepEqual(fixedItems.data, result.data);
  const fulfillmentMcp = await invokeAmazonMcp(fixedIdentity, "get_order_items", { ...pair, fulfilledBy: "AMAZON", fulfillmentServiceLevel: "Standard", pageSize: 1, page: 2 }) as typeof result;
  assert.equal(fulfillmentMcp.data.total, 3); assert.equal(items(fulfillmentMcp)[0].orderItemId, "fixture-item-1b");
  const noFulfillmentMcp = await invokeAmazonMcp(fixedIdentity, "get_orders", { ...pair, fulfilledBy: "AMAZON", fulfillmentServiceLevel: "DifferentService" }) as typeof result;
  assert.equal(noFulfillmentMcp.data.total, 0);
  // Only this runner's disposable database: reproduce an older deployed schema.
  await prisma.$executeRawUnsafe('ALTER TABLE "AmazonOrderRecord" RENAME COLUMN "fulfilledBy" TO "fixture_legacy_fulfilledBy"');
  try {
    for (const read of [readOrders, readOrderItems]) {
      await assert.rejects(() => read(f.scope, new URLSearchParams(pair), f.actor), /SCHEMA_UPGRADE_REQUIRED:/);
    }
    const { POST } = await import("@/app/api/mcp/amazon/route");
    const response = await POST(new Request("http://fixture.invalid/api/mcp/amazon", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${fixedCredential.token!}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_orders", arguments: pair } }),
    }));
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error.data.businessCode, "SCHEMA_UPGRADE_REQUIRED");
    assert.ok(!/fixture_legacy|SELECT|postgres|Ciphertext/.test(JSON.stringify(body)));
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "AmazonOrderRecord" RENAME COLUMN "fixture_legacy_fulfilledBy" TO "fulfilledBy"');
  }
  assert.equal((await readOrders(f.scope, new URLSearchParams(pair), f.actor)).pagination.total, 2);
  assert.deepEqual(comparableOrderCoverage(fixedItems), comparableOrderCoverage(result));
  const fixedPage = await invokeAmazonMcp(fixedIdentity, "get_order_items", { ...pair, amazonOrderId: "fixture-order-1", pageSize: 1, page: 2 }) as typeof result;
  assert.equal(fixedPage.data.total, 3); assert.equal(items(fixedPage)[0].orderItemId, "fixture-item-1b");
  assert.equal(items(fixedPage)[0].proceedsOriginal, exactAmount);
  const fixedMissing = await invokeAmazonMcp(fixedIdentity, "get_order_items", { ...pair, orderItemId: "fixture-item-1c" }) as typeof result;
  assert.equal(items(fixedMissing)[0].proceedsOriginal, null);
  assert.ok(fixedMissing.warnings.some(w => w.includes("明细有效不代表收入数据完整")));
  const erpOrders = await readDataset(f.scope, new URLSearchParams({ table: "orders", ...pair }), f.actor);
  const fixedOrders = await invokeAmazonMcp(fixedIdentity, "get_orders", pair) as typeof result;
  assert.deepEqual(fixedOrders.data, erpOrders.data);
  assert.deepEqual(comparableOrderCoverage(fixedOrders), comparableOrderCoverage(erpOrders));
  const fixedDataset = await invokeAmazonMcp(fixedIdentity, "data_query", { ...pair, table: "orders" }) as typeof erpOrders;
  assert.deepEqual(fixedDataset.data, erpOrders.data);
  for (const tool of ["get_orders", "get_order_items"]) {
    const inherited = await invokeAmazonMcp(identity, tool, tool === "get_orders" ? pair : { ...pair, sellerSku: "fixture-sku-b" }) as typeof result;
    assert.deepEqual(inherited.data, tool === "get_orders" ? fixedOrders.data : fixedItems.data);
    for (const args of [{}, { sellerAccountId: f.store }, { ...pair, sellerAccountId: "other" }, { ...pair, marketplaceId: "other" },
      { ...pair, sellerAccountIds: [f.store] }, ...["orders", "inventory", "finance", "ads_report_daily"].map(table => ({ ...pair, table })),
      { ...pair, module: "amazon_ads", dataType: "reports" }, { ...pair, sql: "SELECT 1" }, { ...pair, pageSize: 51 }]) {
      await assert.rejects(() => invokeAmazonMcp(fixedIdentity, tool, args));
    }
  }
  const queryAudits = await prisma.auditLog.findMany({ where: { organizationId: f.scope.organizationId, action: "amazon.mcp.tool.succeeded" } });
  for (const [tool, response] of [["get_orders", fixedOrders], ["get_order_items", fixedItems]] as const) {
    const requestId = (response.meta as { requestId?: string }).requestId;
    assert.ok(requestId);
    assert.ok(queryAudits.some(log => (log.metadata as Prisma.JsonObject)?.tool === tool && (log.metadata as Prisma.JsonObject)?.requestId === requestId));
  }
  assert.ok(!JSON.stringify(queryAudits).includes(fixedCredential.token!));
  // A parent refresh makes all of its stored item rows stale until detail repair.
  await prisma.amazonOrderRecord.updateMany({ where: { ...f.scope, amazonOrderId: "fixture-order-1" }, data: { sourceUpdatedAt: new Date("2026-11-02T00:00:00Z") } });
  const stale = await readDataset(f.scope, query({ orderItemId: "fixture-item-1b" }), f.actor);
  assert.deepEqual(orderCoverage(stale).page, { returned: 1, detailsCurrent: 0, detailsMissingOrStale: 1 });
  assert.ok(stale.warnings.some(w => w.includes("已过期")));
  const fixedStale = await invokeAmazonMcp(fixedIdentity, "get_order_items", { ...pair, orderItemId: "fixture-item-1b" }) as typeof result;
  assert.deepEqual(orderCoverage(fixedStale).page, orderCoverage(stale).page);
  assert.ok(fixedStale.warnings.some(w => w.includes("已过期")));
  await prisma.amazonDataAccessGrant.update({ where: { id: grant.id }, data: { mcpEnabled: false } });
  assert.equal((await invokeAmazonMcp(identity, "data_query", { table: "order_items", ...pair }) as typeof result).data.total, 4);
  assert.equal((await invokeAmazonMcp(fixedIdentity, "get_orders", pair) as typeof result).data.total, 2);
  assert.equal((await invokeAmazonMcp(fixedIdentity, "get_order_items", pair) as typeof result).data.total, 4);
  assert.equal(calls.length, 4, "ERP and MCP queries never call Amazon");
});


test("order page recovery replays encrypted original while search quota is blocked", async () => {
  const f = await fresh(); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false; calls.length = 0;
  const task = await f.request();
  await prisma.$executeRawUnsafe("CREATE FUNCTION fixture_reject_order_fact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture fact commit failure'; END $$");
  await prisma.$executeRawUnsafe('CREATE TRIGGER fixture_reject_order_fact BEFORE INSERT ON "AmazonOrderRecord" FOR EACH ROW EXECUTE FUNCTION fixture_reject_order_fact()');
  try {
    assert.equal((await f.slice(task.id)).status, "FAILED");
    assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: task.id } }), 1);
    assert.equal(await prisma.amazonOrderRecord.count({ where: f.scope }), 0);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fixture_reject_order_fact ON "AmazonOrderRecord"');
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS fixture_reject_order_fact()");
  }
  const bucketKey = orderBucketKey(`fixture-seller-${f.authId}`, `fixture-${f.authId}`);
  const blocked = await prisma.amazonSyncTokenBucket.update({ where: { bucketKey }, data: { tokens: 0, blockedUntil: new Date(Date.now() + 3600000) } });
  await f.approved({ action: "control-task", id: task.id, control: "retry" });
  const replayed = await f.slice(task.id);
  assert.equal(replayed.pagesCompleted, 1);
  const checkpoint = await readReportParseEvidence(f.scope, new URLSearchParams({ taskId: task.id }), f.actor);
  const evidence = checkpoint.events.map(e => e.evidence as Prisma.JsonObject);
  assert.equal(evidence.filter(e => e.phase === "ARCHIVED").length, 1, "replay does not recreate or relabel the archive");
  const committed = evidence.find(e => e.phase === "ROWS_COMMITTED");
  assert.ok(committed); assert.equal(committed.replayed, true);
  assert.equal(committed.operation, "searchOrders"); assert.equal(committed.rowKind, "ORDER");
  assert.equal(committed.rowsCommitted, 1); assert.equal(committed.processedRows, 1);
  assert.equal(await prisma.amazonOrderRecord.count({ where: f.scope }), 1);
  assert.equal(calls.length, 1, "replay does not repeat the successful search request");
  assert.deepEqual(await prisma.amazonSyncTokenBucket.findUniqueOrThrow({ where: { bucketKey } }), blocked);
  // The next page needs Amazon and must still obey the original quota block.
  await f.slice(task.id);
  assert.equal(calls.length, 1);
  await prisma.amazonSyncTokenBucket.update({ where: { bucketKey }, data: { tokens: 20, blockedUntil: null } });
  await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { nextAttemptAt: new Date(0) } });
  assert.equal((await f.slice(task.id)).status, "SUCCEEDED");
  assert.equal(calls.length, 2);
  assert.equal(await prisma.amazonOrderRecord.count({ where: f.scope }), 2);
});


test("approved PROCEEDS upgrade backfills core-only orders without duplicate facts or PII datasets", async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false; calls.length = 0;
  const { orderAccessEvidence } = await import("@/lib/amazon-sync/order-access-evidence");
  const context = { ...f.scope, authorizationId: f.authId, authorizationRevision: 1, marketplaceId: site };
  const coreProof = orderAccessEvidence(context, { status: 200, parsed: true, requestId: "fixture-core-probe" });
  const base = parseOrderSyncPolicy(f.source.orderPolicy);
  const corePolicy = { ...base, details: { ...base.details!, includedData: [], accessEvidence: coreProof, backfillExisting: true } };
  const sourceCommand = { action: "save-source", authorizationId: f.authId, sellerAccountId: f.store, marketplaceId: site, resource: "orders", enabled: true, freshnessMinutes: 60 };
  await f.approved({ ...sourceCommand, revision: 1, orderPolicy: corePolicy });
  const coreTransport = async (input: string | URL) => {
    const response = await f.fetcher(input);
    if (!new URL(String(input)).pathname.startsWith("/orders/2026-01-01/orders/")) return response;
    assert.equal(new URL(String(input)).searchParams.has("includedData"), false);
    const body = await response.json(); delete body.order.proceeds;
    for (const item of body.order.orderItems) delete item.proceeds;
    return Response.json(body, { headers: response.headers });
  };
  const first = await f.request();
  for (let i = 0; i < 4; i++) await f.slice(first.id, coreTransport);
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: first.id } })).status, "SUCCEEDED");
  assert.equal(await prisma.amazonOrderRecord.count({ where: { ...f.scope, grandTotalOriginal: null } }), 2);
  const pair = { sellerAccountId: f.store, marketplaceId: site };
  const before = await readDataset(f.scope, new URLSearchParams({ table: "order_items", ...pair }), f.actor);
  assert.equal(orderCoverage(before).moneyRequest.proceedsRequested, false);
  const upgrade = { ...corePolicy, details: { ...corePolicy.details, includedData: ["PROCEEDS"] } };
  await assert.rejects(() => f.approved({ ...sourceCommand, revision: 2, orderPolicy: upgrade }), /数据范围/);
  assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } })).revision, 2);
  const proceedsProof = orderAccessEvidence({ ...context, includedData: ["PROCEEDS"] }, { status: 200, parsed: true, requestId: "fixture-proceeds-probe" });
  upgrade.details.accessEvidence = proceedsProof;
  await f.approved({ ...sourceCommand, revision: 2, orderPolicy: upgrade });
  const transport = async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/orders/2026-01-01/orders") {
      calls.push({ path: url.pathname, page: null });
      return Response.json({ orders: [] });
    }
    if (url.pathname.startsWith("/orders/2026-01-01/orders/")) assert.equal(url.searchParams.get("includedData"), "PROCEEDS");
    return f.fetcher(input);
  };
  const requestCount = calls.length, next = await f.request();
  for (let i = 0; i < 3; i++) await f.slice(next.id, transport);
  const completed = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: next.id } });
  assert.equal(completed.status, "SUCCEEDED"); assert.equal(completed.detailsCompletedCount, 2);
  assert.equal(calls.length - requestCount, 3);
  assert.equal(calls[requestCount].path, "/orders/2026-01-01/orders");
  assert.ok(calls.slice(requestCount + 1).every(call => call.path.startsWith("/orders/2026-01-01/orders/")), "current list window precedes historical detail backfill");
  assert.equal(await prisma.amazonOrderRecord.count({ where: f.scope }), 2);
  assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 2);
  const after = await readDataset(f.scope, new URLSearchParams({ table: "order_items", ...pair }), f.actor);
  assert.equal(orderCoverage(after).moneyRequest.proceedsRequested, true);
  assert.equal(orderCoverage(after).money.present, 2); assert.equal(orderCoverage(after).money.missing, 0);
  assert.ok(!JSON.stringify(after).includes("fixture-private"));
  const auth = await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { identityVerifiedAt: new Date(), identityEvidence: "OFFLINE_FIXTURE" } });
  await prisma.amazonSellerIdentity.create({ data: { ...f.scope, id: randomUUID(), ...pair, authorizationId: f.authId, amazonSellerId: auth.amazonSellerId!, region, verifiedAt: new Date() } });
  await prisma.amazonDataAccessGrant.updateMany({ where: { ...f.scope, userId: f.actor, sellerAccountId: f.store }, data: { marketplaceIds: [site], actions: ["view"], mcpEnabled: true } });
  const credential = await manageMcpCredential(f.scope, f.actor, { action: "create", name: "offline proceeds reader", scopes: [{ sellerAccountId: f.store, marketplaceIds: [site] }], tools: ["data_query"], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp(`Bearer ${credential.token!}`);
  const mcp = await invokeAmazonMcp(identity, "data_query", { table: "order_items", ...pair }) as Awaited<ReturnType<typeof readDataset>>;
  assert.equal(mcp.data.total, 2);
  assert.deepEqual(orderCoverage(mcp).money, orderCoverage(after).money);
  assert.ok(mcp.data.items.every(item => (item as { proceedsOriginal: string }).proceedsOriginal === "12.3400"));
  const originals = await prisma.amazonSyncRawPage.findMany({ where: { taskId: next.id, page: { gt: 1000 } } });
  assert.equal(originals.length, 2);
  assert.ok(originals.every(raw => JSON.stringify((raw.requestMetadata as Prisma.JsonObject).includedData) === '["PROCEEDS"]'));
  const archivesBefore = await prisma.amazonSyncRawPage.count({ where: { taskId: next.id } });
  await f.slice(next.id, transport);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: next.id } }), archivesBefore);
});


test("historical backlog cannot consume current-window detail budget and catches up in later windows", async () => {
  const f = await fresh(); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false; calls.length = 0;
  const initial = await f.request(); await f.slice(initial.id); await f.slice(initial.id);
  const base = parseOrderSyncPolicy(f.source.orderPolicy);
  await f.approved({ action: "save-source", revision: 1, authorizationId: f.authId, sellerAccountId: f.store, marketplaceId: site, resource: "orders", enabled: true, freshnessMinutes: 60,
    orderPolicy: { ...base, details: { includedData: [], requiredRoles: [], purpose: "order_items", requestsPerSecond: .2, burst: 20, maxOrders: 1, backfillExisting: true } } });
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const updatedTime = new Date(cursor.watermarkTo.getTime() + 1000).toISOString();
  const transport = async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/orders/2026-01-01/orders") {
      calls.push({ path: url.pathname, page: null });
      const row = fixture("page-1").orders[0]; row.lastUpdatedTime = updatedTime;
      return Response.json({ orders: [row] });
    }
    const response = await f.fetcher(input);
    if (!url.pathname.endsWith("/fixture-order-1")) return response;
    const body = await response.json(); body.order.lastUpdatedTime = updatedTime;
    return Response.json(body, { headers: response.headers });
  };
  const next = await f.request(), requestsBefore = calls.length;
  assert.equal((await f.slice(next.id, transport)).status, "WAITING");
  assert.equal(calls[requestsBefore].path, "/orders/2026-01-01/orders");
  assert.equal((await f.slice(next.id, transport)).status, "SUCCEEDED");
  assert.equal(calls[requestsBefore + 1].path, "/orders/2026-01-01/orders/fixture-order-1");
  assert.equal(await prisma.amazonOrderDetailWork.count({ where: { ...f.scope, sourceId: f.source.id } }), 1);
  const params = new URLSearchParams({ table: "orders", sellerAccountId: f.store, marketplaceId: site });
  const partial = await readDataset(f.scope, params, f.actor);
  assert.deepEqual(orderCoverage(partial).historicalBackfill, { enabled: true, selected: 0, deferred: true });
  assert.equal(orderCoverage(partial).historicalBackfillBasis, "LAST_PUBLISHED_WINDOW");
  assert.equal(orderCoverage(partial).historicalBackfillEnabled, true);
  const publishedWindow = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.deepEqual(orderCoverage(partial).historicalBackfillWindow, { from: publishedWindow.watermarkFrom.toISOString(), to: publishedWindow.watermarkTo.toISOString() });
  assert.ok(partial.warnings.some(w => w.includes("历史订单明细仍有积压")));
  assert.equal(orderCoverage(partial).window?.status, "SUCCEEDED");
  const followup = await f.request(), empty = emptyOrderWindow(f);
  assert.equal((await f.slice(followup.id, empty)).status, "WAITING");
  const inProgress = await readDataset(f.scope, params, f.actor);
  assert.deepEqual(orderCoverage(inProgress).historicalBackfillWindow, orderCoverage(partial).historicalBackfillWindow, "prior published backfill evidence retains its original window");
  assert.notEqual(new Date(orderCoverage(inProgress).window!.from).toISOString(), orderCoverage(inProgress).historicalBackfillWindow!.from, "current cursor must not relabel historical evidence");
  assert.equal((await f.slice(followup.id, empty)).status, "SUCCEEDED");
  const complete = await readDataset(f.scope, params, f.actor);
  assert.deepEqual(orderCoverage(complete).historicalBackfill, { enabled: true, selected: 1, deferred: false });
  assert.equal(orderCoverage(complete).page.detailsCurrent, 2);
  assert.equal(await prisma.amazonOrderRecord.count({ where: f.scope }), 2);
  assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 2);
});


test("approved Orders retry binds durable detail progress and rejects changed or missing cursor without HTTP", async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false; calls.length = 0;
  const task = await f.request(); await f.slice(task.id);
  detailFault = 400; failedDetail = "*";
  const failed = await f.slice(task.id); assert.equal(failed.status, "FAILED"); detailFault = 0;
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const rawBefore = await prisma.amazonSyncRawPage.findMany({ where: { ...f.scope, taskId: task.id }, orderBy: { page: "asc" } });
  const countBefore = calls.length;
  const command = { action: "control-task", id: task.id, control: "retry" };
  const requested = await requestChange(f.scope, f.actor, command);
  const evidence = ((requested.beforeSummary as { current: { orderRecovery: Record<string, unknown> } }).current).orderRecovery;
  assert.equal(evidence.pendingDetails, 1); assert.equal(evidence.pagesCompleted, 1);
  assert.equal(evidence.nextOperation, "getOrder"); assert.equal(evidence.restartsFromBeginning, false);
  assert.ok(!JSON.stringify(evidence).includes("fixture-order")); assert.ok(!JSON.stringify(evidence).includes("Ciphertext"));
  assert.equal(calls.length, countBefore);
  await decideChange(f.scope, f.approver, String(requested.id), "APPROVED", "isolated checkpoint retry");
  // Only the disposable fixture cursor changes between approval and apply.
  await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { watermarkFrom: new Date(cursor.watermarkFrom.getTime() + 1000) } });
  const invalid = await prisma.$transaction(tx => orderRecoveryReadiness(tx, failed));
  assert.equal(invalid?.state, "BLOCKED"); assert.equal(invalid?.reason, "CHECKPOINT_INVALID"); assert.equal(invalid?.checkpoint, null);
  await assert.rejects(() => applyChange(f.scope, f.actor, String(requested.id)), /游标|变化|失效/);
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status, "FAILED");
  await assert.rejects(() => requestChange(f.scope, f.actor, command), /游标/);
  await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { watermarkFrom: cursor.watermarkFrom, status: "SUCCEEDED" } });
  await assert.rejects(() => requestChange(f.scope, f.actor, command), /已完成/);
  await prisma.amazonSyncResourceCursor.delete({ where: { sourceId: f.source.id } });
  await assert.rejects(() => requestChange(f.scope, f.actor, command), /游标缺失/);
  await prisma.amazonSyncResourceCursor.create({ data: cursor });
  const collisionId = randomUUID();
  await prisma.amazonSyncRun.create({ data: { ...f.scope, id: collisionId, sourceId: f.source.id, resource: "orders", requestedByUserId: f.actor,
    executionVersion: 2, status: "PAUSED", stage: "FETCHING", idempotencyKey: collisionId, mode: "incremental", authorizationRevision: failed.authorizationRevision,
    frozenScope: failed.frozenScope!, frozenScopeDigest: failed.frozenScopeDigest } });
  const collision = await prisma.$transaction(tx => orderRecoveryReadiness(tx, failed));
  assert.equal(collision?.reason, "ACTIVE_TASK_EXISTS"); assert.equal(collision?.checkpoint, null);
  await prisma.amazonSyncRun.update({ where: { id: collisionId }, data: { status: "CANCELLED" } });
  assert.equal(calls.length, countBefore);
  assert.deepEqual(await prisma.amazonSyncRawPage.findMany({ where: { ...f.scope, taskId: task.id }, orderBy: { page: "asc" } }), rawBefore);
  await f.approved(command);
  const afterApproval = await readOrders(f.scope, new URLSearchParams({ sellerAccountId: f.store, marketplaceId: site }), f.actor);
  assert.equal(afterApproval.sources[0].recoveryTask?.recoveryOutcome?.state, "AWAITING_PROGRESS");
  assert.equal(afterApproval.sources[0].recoveryTask?.recoveryOutcome?.pendingDetails, 1);
  const resumed = await f.slice(task.id); assert.equal(resumed.detailsCompletedCount, 1);
  const advancedView = await readOrders(f.scope, new URLSearchParams({ sellerAccountId: f.store, marketplaceId: site }), f.actor);
  assert.equal(advancedView.sources[0].recoveryTask?.recoveryOutcome?.state, "ADVANCED");
  assert.equal(advancedView.sources[0].recoveryTask?.recoveryOutcome?.detailsAdvanced, 1);
  assert.equal(advancedView.sources[0].recoveryTask?.recoveryOutcome?.pendingDetails, 0);
  assert.ok(calls[countBefore].path.endsWith("/fixture-order-1"), "resume starts with pending getOrder rather than relisting committed page");
  await f.slice(task.id); const completed = await f.slice(task.id);
  assert.equal(completed.status, "SUCCEEDED"); assert.equal(completed.pagesCompleted, 2); assert.equal(completed.detailsCompletedCount, 2);
  const recoveryView = await readOrders(f.scope, new URLSearchParams({ sellerAccountId: f.store, marketplaceId: site }), f.actor);
  assert.equal(recoveryView.sources[0].recoveryTask?.id, task.id);
  assert.equal(recoveryView.sources[0].recoveryTask?.lastHttpErrorStatus, null);
  assert.equal(recoveryView.sources[0].recoveryTask?.failureReason, null);
  assert.equal(recoveryView.sources[0].recoveryTask?.canRequestRetry, false);
  const outcome = recoveryView.sources[0].recoveryTask?.recoveryOutcome;
  assert.ok(outcome);
  assert.equal(outcome.state, "WINDOW_COMPLETED"); assert.equal(outcome.detailsAdvanced, 2); assert.equal(outcome.pagesAdvanced, 1); assert.equal(outcome.pendingDetails, 0);
  assert.equal(outcome.historicalUniverseComplete, false);
  assert.ok(!JSON.stringify(outcome).includes("fixture-order"));
  const genericOutcome = await readDataset(f.scope, new URLSearchParams({ table: "orders", sellerAccountId: f.store, marketplaceId: site }), f.actor);
  assert.deepEqual(orderCoverage(genericOutcome).recoveryTask?.recoveryOutcome, outcome);
  assert.equal(await prisma.amazonOrderRecord.count({ where: f.scope }), 2);
  assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 2);
});

test("unstarted Orders retry can follow its previous completed window without stealing an unfinished cursor", async () => {
  const f = await fresh(); fault = 0; detailFault = 0;
  const first = await f.request(); await f.slice(first.id); await f.slice(first.id);
  const next = await f.request();
  const saved = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const before = await prisma.$transaction(tx => inspectOrderRecovery(tx, next));
  assert.equal(before.nextOperation, "searchOrders"); assert.equal(before.listComplete, false);
  await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { status: "FAILED" } });
  await assert.rejects(() => prisma.$transaction(tx => inspectOrderRecovery(tx, next)), /游标/);
  await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { status: saved.status } });
});


test("detail gap filters count before pagination and historical backfill reopens stale successful work", async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false;
  const task = await f.request(); for (let i = 0; i < 4; i++) await f.slice(task.id);
  const pair = { sellerAccountId: f.store, marketplaceId: site };
  const query = (detailsStatus: string, table = "orders", extra: Record<string, string> = {}) => new URLSearchParams({ table, ...pair, detailsStatus, ...extra });
  const current = await readDataset(f.scope, query("CURRENT", "orders", { pageSize: "1" }), f.actor);
  assert.equal(current.data.total, 2); assert.equal(current.data.items.length, 1);
  assert.equal((await readDataset(f.scope, query("MISSING_OR_STALE"), f.actor)).data.total, 0);
  const row = await prisma.amazonOrderRecord.findFirstOrThrow({ where: { ...f.scope, amazonOrderId: "fixture-order-1" } });
  // Restore only this disposable projection to a stale timestamp. Its old durable
  // work marker remains SUCCEEDED, as can happen after projection recovery.
  await prisma.amazonOrderRecord.update({ where: { id: row.id }, data: { detailsUpdatedAt: new Date(row.sourceUpdatedAt.getTime() - 1000) } });
  const gap = await readDataset(f.scope, query("MISSING_OR_STALE", "orders", { pageSize: "1" }), f.actor);
  assert.equal(gap.data.total, 1);
  const gapRow = gap.data.items[0] as { amazonOrderId: string; detailsCurrent: boolean };
  assert.equal(gapRow.amazonOrderId, "fixture-order-1"); assert.equal(gapRow.detailsCurrent, false);
  assert.equal((await readDataset(f.scope, query("CURRENT"), f.actor)).data.total, 1);
  assert.equal((await readDataset(f.scope, query("MISSING_OR_STALE", "order_items"), f.actor)).data.total, 1);
  assert.equal((await readDataset(f.scope, query("CURRENT", "order_items"), f.actor)).data.total, 1);
  assert.equal((await readDataset(f.scope, query("MISSING_OR_STALE", "orders", { page: "2", pageSize: "1" }), f.actor)).data.items.length, 0);
  await assert.rejects(() => readOrders(f.scope, query("INVALID"), f.actor), /明细状态/);
  const duplicate = query("CURRENT"); duplicate.append("detailsStatus", "MISSING_OR_STALE");
  await assert.rejects(() => readOrderItems(f.scope, duplicate, f.actor), /明细状态/);
  const restricted = await fresh();
  await assert.rejects(() => readOrders(restricted.scope, new URLSearchParams(pair), restricted.actor), /未分配/);
  await f.approved({ action: "save-source", revision: 1, authorizationId: f.authId, sellerAccountId: f.store, marketplaceId: site, resource: "orders", enabled: true, freshnessMinutes: 60,
    orderPolicy: { ...parseOrderSyncPolicy(f.source.orderPolicy), details: { ...parseOrderSyncPolicy(f.source.orderPolicy).details!, backfillExisting: true } } });
  // Policy changes create fresh work identities. Complete that upgrade first,
  // then make one row stale under the unchanged policy to exercise reopening.
  const upgrade = await f.request(), empty = emptyOrderWindow(f);
  await f.slice(upgrade.id, empty); await f.slice(upgrade.id, empty); await f.slice(upgrade.id, empty);
  const upgraded = await prisma.amazonOrderRecord.findUniqueOrThrow({ where: { id: row.id } });
  await prisma.amazonOrderRecord.update({ where: { id: row.id }, data: { detailsUpdatedAt: new Date(upgraded.sourceUpdatedAt.getTime() - 1000) } });
  const workCount = await prisma.amazonOrderDetailWork.count({ where: f.scope });
  const retry = await f.request(); const allocated = await f.slice(retry.id, empty);
  assert.equal(allocated.status, "WAITING");
  assert.equal(await prisma.amazonOrderDetailWork.count({ where: { ...f.scope, status: "PENDING" } }), 1);
  assert.equal(await prisma.amazonOrderDetailWork.count({ where: f.scope }), workCount, "reuse the existing durable identity");
  assert.equal((await f.slice(retry.id, empty)).status, "SUCCEEDED");
  assert.equal((await readDataset(f.scope, query("MISSING_OR_STALE"), f.actor)).data.total, 0);
  assert.equal((await readDataset(f.scope, query("CURRENT"), f.actor)).data.total, 2);
  assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 2);
  const listOnly = await restricted.request(); await restricted.slice(listOnly.id); await restricted.slice(listOnly.id);
  assert.equal((await readDataset(restricted.scope, new URLSearchParams({ table: "orders", sellerAccountId: restricted.store, marketplaceId: site, detailsStatus: "CURRENT" }), restricted.actor)).data.total, 0);
  assert.equal((await readDataset(restricted.scope, new URLSearchParams({ table: "orders", sellerAccountId: restricted.store, marketplaceId: site, detailsStatus: "MISSING_OR_STALE" }), restricted.actor)).data.total, 2);
});


test("a repeated list version reopens successful work when the live detail projection is stale", async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false;
  const nearBoundary = "2026-11-01T00:59:00.000Z";
  const initialTransport = async (input: string | URL) => {
    const response = await f.fetcher(input);
    if (!new URL(String(input)).pathname.startsWith("/orders/")) return response;
    const body = await response.json();
    if (Array.isArray(body.orders)) for (const order of body.orders) if (order.orderId === "fixture-order-1") order.lastUpdatedTime = nearBoundary;
    if (new URL(String(input)).pathname.endsWith("/fixture-order-1")) body.order.lastUpdatedTime = nearBoundary;
    return Response.json(body, { headers: response.headers });
  };
  const first = await f.request(); for (let i = 0; i < 4; i++) await f.slice(first.id, initialTransport);
  const row = await prisma.amazonOrderRecord.findFirstOrThrow({ where: { ...f.scope, amazonOrderId: "fixture-order-1" } });
  await prisma.amazonOrderRecord.update({ where: { id: row.id }, data: { detailsUpdatedAt: new Date(row.sourceUpdatedAt.getTime() - 1000) } });
  const before = await prisma.amazonOrderDetailWork.count({ where: f.scope });
  const transport = async (input: string | URL) => {
    if (new URL(String(input)).pathname === "/orders/2026-01-01/orders") {
      const listed = fixture("page-1").orders[0]; listed.lastUpdatedTime = nearBoundary;
      return Response.json({ orders: [listed] });
    }
    return initialTransport(input);
  };
  const task = await f.request(); const allocated = await f.slice(task.id, transport); assert.equal(allocated.status, "WAITING", allocated.error ?? "");
  const work = await prisma.amazonOrderDetailWork.findFirstOrThrow({ where: { ...f.scope, orderRecordId: row.id, status: "PENDING" } });
  assert.equal(work.completedAt, null);
  assert.equal((await f.slice(task.id, transport)).status, "SUCCEEDED");
  assert.equal(await prisma.amazonOrderDetailWork.count({ where: f.scope }), before);
  assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 2);
  assert.equal((await readOrders(f.scope, new URLSearchParams({ sellerAccountId: f.store, marketplaceId: site, detailsStatus: "MISSING_OR_STALE" }), f.actor)).pagination.total, 0);
});


test("order progress uses durable commits, hides leases and detects dispatch stalls without changing tasks", async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false;
  const task = await f.request(); await f.slice(task.id);
  const params = new URLSearchParams({ sellerAccountId: f.store, marketplaceId: site });
  const readProgress = async () => (await readOrders(f.scope, params, f.actor)).sources[0].recoveryTask!.progress;
  const before = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
  const recent = await readProgress(); assert.equal(recent.progressBasis, "COMMITTED_PAGE_OR_DETAIL"); assert.equal(recent.state, "READY");
  assert.deepEqual(await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } }), before, "diagnostic is read-only");
  const old = new Date(Date.now() - 3600000);
  await prisma.amazonSyncTaskLog.updateMany({ where: { ...f.scope, taskId: task.id, event: { in: ["ORDER_PAGE_COMMITTED", "ORDER_DETAIL_COMMITTED", "ORDER_WINDOW_COMPLETED"] } }, data: { createdAt: old } });
  await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { updatedAt: old, nextAttemptAt: old } });
  assert.equal((await readProgress()).state, "POSSIBLE_STALL");
  await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { updatedAt: old, nextAttemptAt: new Date(Date.now() + 3600000) } });
  assert.equal((await readProgress()).state, "SCHEDULED_WAIT");
  await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { status: "RUNNING", leaseExpiresAt: old } });
  assert.equal((await readProgress()).state, "LEASE_RECOVERY_REQUIRED");
  const safe = (await readOrders(f.scope, params, f.actor)).sources[0].recoveryTask!;
  assert.ok(!JSON.stringify(safe).includes("leaseExpiresAt")); assert.ok(!JSON.stringify(safe).includes("frozenScope")); assert.ok(!JSON.stringify(safe).includes("Ciphertext"));
  await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { status: before.status, leaseExpiresAt: before.leaseExpiresAt, nextAttemptAt: before.nextAttemptAt } });
});

test("scheduler recovers missing leases after grace and honors approved pause/cancel before retry budget", async () => {
  const driverBefore = process.env.QUEUE_DRIVER; process.env.QUEUE_DRIVER = "redis";
  try {
    for (const mode of ["missing-recent", "missing-old", "pause", "cancel"] as const) {
      const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false;
      const task = await f.request(); await f.slice(task.id);
      const before = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
      const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
      const originals = await prisma.amazonSyncRawPage.findMany({ where: { ...f.scope, taskId: task.id } });
      const now = new Date(), old = new Date(now.getTime() - 3600000);
      await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { status: "RUNNING", leaseOwner: "fixture-interrupted-worker", leaseExpiresAt: mode.startsWith("missing") ? null : old,
        updatedAt: mode === "missing-recent" ? now : old, attempts: mode === "pause" || mode === "cancel" ? before.maxAttempts : before.attempts } });
      if (mode === "pause" || mode === "cancel") await f.approved({ action: "control-task", id: task.id, control: mode });
      const interrupted = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
      const callsBefore = calls.length;
      const result = await tickSyncCenter(now, { taskIds: [task.id], exportIds: [] });
      const recovered = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
      assert.equal(calls.length, callsBefore, "scheduler never makes Amazon requests");
      if (mode === "missing-recent") {
        assert.equal(result?.expiredLeases, 0); assert.equal(recovered.status, "RUNNING"); assert.equal(recovered.fenceVersion, interrupted.fenceVersion);
        continue;
      }
      const expected = mode === "pause" ? "PAUSED" : mode === "cancel" ? "CANCELLED" : "RETRY_WAIT";
      assert.equal(recovered.status, expected); assert.equal(recovered.control, null);
      assert.equal(recovered.fenceVersion, interrupted.fenceVersion + 1); assert.equal(recovered.dispatchVersion, interrupted.dispatchVersion + 1);
      assert.equal(recovered.pagesCompleted, before.pagesCompleted); assert.equal(recovered.detailsCompletedCount, before.detailsCompletedCount);
      assert.equal(recovered.leaseOwner, null); assert.equal(recovered.leaseExpiresAt, null);
      const saved = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
      assert.equal(saved.status, expected); assert.equal(saved.nextTokenCiphertext, cursor.nextTokenCiphertext);
      assert.equal(saved.watermarkFrom.getTime(), cursor.watermarkFrom.getTime()); assert.equal(saved.watermarkTo.getTime(), cursor.watermarkTo.getTime());
      assert.deepEqual(await prisma.amazonSyncRawPage.findMany({ where: { ...f.scope, taskId: task.id } }), originals);
      const log = await prisma.amazonSyncTaskLog.findFirstOrThrow({ where: { taskId: task.id, event: "LEASE_EXPIRED" } });
      assert.equal(log.code, mode === "pause" ? "PAUSE_REQUESTED" : mode === "cancel" ? "CANCEL_REQUESTED" : "LEASE_MISSING");
      await processSyncCenterTask(task.id, interrupted.dispatchVersion, { clientOptions: { fetch: async () => { throw new Error("stale Worker must not request HTTP"); } } });
      assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status, expected);
      if (mode === "missing-old") {
        const continued = await f.slice(task.id);
        assert.equal(continued.detailsCompletedCount, 1);
        assert.equal(continued.pagesCompleted, before.pagesCompleted, "missing-lease recovery continues pending detail without relisting");
      }
      if (mode === "pause") {
        await f.approved({ action: "control-task", id: task.id, control: "resume" });
        assert.equal((await f.slice(task.id)).detailsCompletedCount, 1);
      }
    }
  } finally {
    if (driverBefore === undefined) delete process.env.QUEUE_DRIVER; else process.env.QUEUE_DRIVER = driverBefore;
  }
});


test("automatic orders preserve unfinished manual windows and require recovery of the original task", async () => {
  const wasAllowed = automaticMarketplaces.has(site); automaticMarketplaces.add(site);
  try {
    for (const status of ["FAILED", "PAUSED", "CANCELLED", "BLOCKED"] as const) {
      const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false;
      const task = await f.request(); await f.slice(task.id);
      await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { status } });
      await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { status } });
      const now = new Date();
      const plan = await prisma.amazonSyncSchedule.create({ data: { ...f.scope, id: randomUUID(), resource: "orders", executionVersion: 2,
        planKey: automaticPlanKey(f.source.id), mode: "incremental", enabled: true, updatedByUserId: f.actor, nextRunAt: now } });
      await prisma.amazonSyncPlanTarget.create({ data: { ...f.scope, scheduleId: plan.id, sourceId: f.source.id } });
      const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
      const raw = await prisma.amazonSyncRawPage.findMany({ where: { taskId: task.id } });
      const work = await prisma.amazonOrderDetailWork.findMany({ where: { sourceId: f.source.id } });
      const original = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
      const callsBefore = calls.length;
      await enqueueDueAutomaticPlans([f.scope], now, [f.source.id]);
      assert.equal(await prisma.amazonSyncRun.count({ where: { ...f.scope, sourceId: f.source.id } }), 1, status);
      assert.deepEqual(await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } }), cursor);
      assert.deepEqual(await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } }), original);
      assert.deepEqual(await prisma.amazonSyncRawPage.findMany({ where: { taskId: task.id } }), raw);
      assert.deepEqual(await prisma.amazonOrderDetailWork.findMany({ where: { sourceId: f.source.id } }), work);
      if (status === "PAUSED") {
        assert.equal((await prisma.amazonSyncSchedule.findUniqueOrThrow({ where: { id: plan.id } })).nextRunAt!.getTime(), now.getTime() + 30_000, "paused original remains active and reserves this source without tight-loop scheduling");
      } else {
        const blocked = await prisma.auditLog.findFirstOrThrow({ where: { entityId: plan.id, action: "amazon.sync.plan.window-blocked" } });
        assert.equal((blocked.metadata as Prisma.JsonObject).code, "ORDER_WINDOW_REQUIRES_RECOVERY");
        assert.equal((blocked.metadata as Prisma.JsonObject).taskCreated, false);
        assert.equal((await prisma.amazonSyncSchedule.findUniqueOrThrow({ where: { id: plan.id } })).nextRunAt!.getTime(), now.getTime() + automaticResourceIntervalMinutes("orders") * 60_000);
      }
      await enqueueDueAutomaticPlans([f.scope], now, [f.source.id]);
      assert.equal(await prisma.auditLog.count({ where: { entityId: plan.id, action: "amazon.sync.plan.window-blocked" } }), status === "PAUSED" ? 0 : 1, "same scan does not repeatedly audit a deferred plan");
      // The transaction guard also rejects a stale scheduler candidate that
      // reaches task creation after its optimistic cursor read.
      await assert.rejects(prisma.$transaction(async tx => {
        await scopeLock(tx, f.scope);
        return createTask(tx, f.scope, f.actor, f.source.id, { key: `fixture-replacement:${randomUUID()}`, trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision,
          orderWindow: orderWindowFromFrozen((task.frozenScope as Prisma.JsonObject).orderWindow) });
      }), /ORDER_WINDOW_REQUIRES_RECOVERY/);
      assert.equal(calls.length, callsBefore, "scheduling and rejection never contact Amazon");
      if (status === "FAILED") {
        await f.approved({ action: "control-task", id: task.id, control: "retry" });
        for (let i = 0; i < 3; i++) await f.slice(task.id);
        assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status, "SUCCEEDED");
        await prisma.amazonSyncSchedule.update({ where: { id: plan.id }, data: { nextRunAt: now } });
        await enqueueDueAutomaticPlans([f.scope], now, [f.source.id]);
        const next = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: f.source.id, trigger: "schedule" } });
        assert.notEqual(next.id, task.id);
        const nextWindow = (next.frozenScope as Prisma.JsonObject).orderWindow as Prisma.JsonObject;
        assert.ok(Date.parse(String(nextWindow.to)) > cursor.watermarkTo.getTime(), "completed window allows normal forward scheduling");
        // Returning an existing task is safe even after it starts a cursor.
        await f.slice(next.id);
        const existing = await prisma.$transaction(async tx => {
          await scopeLock(tx, f.scope);
          return createTask(tx, f.scope, f.actor, f.source.id, { key: next.idempotencyKey!, trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision });
        });
        assert.equal(existing.id, next.id);
        assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: f.source.id } }), 2);
      }
    }
  } finally { if (!wasAllowed) automaticMarketplaces.delete(site); }
});

test("Orders internal history replay paginates without changing the forward cursor or publication head", async () => {
  const wasAllowed = automaticMarketplaces.has(site); automaticMarketplaces.add(site);
  try {
    const f = await fresh(); fault = 0; detailFault = 0; failCommit = false; calls.length = 0;
    const original = await f.request();
    await f.slice(original.id); await f.slice(original.id);
    const window = orderWindowFromFrozen((original.frozenScope as Prisma.JsonObject).orderWindow);
    const cursorBefore = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
    const sourceBefore = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } });
    const schedule = await prisma.amazonSyncSchedule.create({ data: { ...f.scope, id: randomUUID(), resource: "orders", executionVersion: 2,
      planKey: automaticPlanKey(f.source.id), name: "Orders history replay fixture", revision: 1, mode: "incremental", intervalMinutes: 60,
      enabled: true, updatedByUserId: f.actor, nextRunAt: new Date() } });
    await prisma.amazonSyncPlanTarget.create({ data: { ...f.scope, scheduleId: schedule.id, sourceId: f.source.id } });
    const replay = await prisma.$transaction(tx => {
      return createTask(tx, f.scope, f.actor, f.source.id, { key: `orders-history:${randomUUID()}`, trigger: "schedule", scheduleId: schedule.id,
        scheduleRevision: schedule.revision, orderWindow: window, orderHistoryReplay: true });
    });
    const replayFirst = await f.slice(replay.id);
    assert.equal(replayFirst.status, "WAITING", `${replayFirst.error ?? ""} ${JSON.stringify(replayFirst.summary)}`);
    const replaySecond = await f.slice(replay.id);
    assert.equal(replaySecond.status, "SUCCEEDED", replaySecond.error ?? "");
    const completed = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: replay.id } });
    assert.equal((completed.frozenScope as Prisma.JsonObject).orderHistoryReplay, true);
    assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: replay.id, resource: "orders" } }), 2);
    assert.deepEqual(await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } }), cursorBefore);
    const sourceAfter = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } });
    assert.equal(sourceAfter.activeRunId, sourceBefore.activeRunId);
    assert.equal(sourceAfter.lastSuccessAt?.getTime(), sourceBefore.lastSuccessAt?.getTime());
    assert.equal(sourceAfter.rowCount, sourceBefore.rowCount);
    assert.equal(await prisma.amazonOrderRecord.count({ where: { ...f.scope, sourceId: f.source.id } }), 2);
  } finally { if (!wasAllowed) automaticMarketplaces.delete(site); }
});


test("Orders recovery rechecks cursor ownership after approval before HTTP or archive replay", async () => {
  for (const owner of ["foreign-task", null, "missing-cursor"]) {
    const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false;
    const task = await f.request(); await f.slice(task.id);
    failDetailCommit = true;
    try {
      assert.equal((await f.slice(task.id)).status, "FAILED");
    } finally {
      failDetailCommit = false;
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fixture_reject_detail ON "AmazonOrderDetailWork"');
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS fixture_reject_detail()");
    }
    assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: task.id } }), 2, "successful detail response survives the failed business commit");
    await f.approved({ action: "control-task", id: task.id, control: "retry" });
    if (owner === "missing-cursor") await prisma.amazonSyncResourceCursor.delete({ where: { sourceId: f.source.id } });
    else {
      let activeRunId: string | null = null;
      if (owner === "foreign-task") {
        activeRunId = randomUUID();
        await prisma.amazonSyncRun.create({ data: { ...f.scope, id: activeRunId, sourceId: f.source.id, resource: "orders", requestedByUserId: f.actor,
          executionVersion: 2, authorizationRevision: task.authorizationRevision, status: "FAILED", mode: "incremental", idempotencyKey: activeRunId,
          frozenScope: task.frozenScope!, frozenScopeDigest: task.frozenScopeDigest } });
      }
      await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { activeRunId } });
    }
    const cursor = await prisma.amazonSyncResourceCursor.findUnique({ where: { sourceId: f.source.id } });
    const raw = await prisma.amazonSyncRawPage.findMany({ where: { taskId: task.id } });
    const work = await prisma.amazonOrderDetailWork.findMany({ where: { sourceId: f.source.id } });
    const callsBefore = calls.length;
    const rejected = await f.slice(task.id, async () => { throw new Error("lost cursor ownership must reject before any HTTP"); });
    assert.equal(rejected.status, "FAILED");
    assert.equal(rejected.pagesCompleted, 1); assert.equal(rejected.detailsCompletedCount, 0);
    assert.equal(calls.length, callsBefore);
    assert.deepEqual(await prisma.amazonSyncResourceCursor.findUnique({ where: { sourceId: f.source.id } }), cursor);
    assert.deepEqual(await prisma.amazonSyncRawPage.findMany({ where: { taskId: task.id } }), raw);
    assert.deepEqual(await prisma.amazonOrderDetailWork.findMany({ where: { sourceId: f.source.id } }), work);
    assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 0);
  }
});


async function legacyFulfillmentFixture() {
  const f = await fresh(true); fault = 0; detailFault = 0; failCommit = false; failDetailCommit = false;
  const transport = async (input: string | URL) => {
    const response = await f.fetcher(input);
    if (!new URL(String(input)).pathname.startsWith("/orders/2026-01-01/orders/")) return response;
    const body = await response.json();
    body.order.fulfillment ??= {};
    body.order.fulfillment.fulfilledBy = "AMAZON"; body.order.fulfillment.fulfillmentServiceLevel = "Standard";
    return Response.json(body, { headers: response.headers });
  };
  const task = await f.request(); for (let i = 0; i < 4; i++) await f.slice(task.id, transport);
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status, "SUCCEEDED");
  // Simulate an older parser projection while keeping its immutable originals,
  // detail hashes, versions and original collection timestamps.
  await prisma.amazonOrderRecord.updateMany({ where: f.scope, data: { fulfilledBy: null, fulfillmentServiceLevel: null } });
  const params = new URLSearchParams({ sourceId: f.source.id, taskId: task.id, rawPages: "1001,1002" });
  return { ...f, task, params };
}

test("approved order fulfillment reparse fills only missing fields from exact archived detail versions", async () => {
  const f = await legacyFulfillmentFixture();
  const before = await prisma.amazonOrderRecord.findMany({ where: f.scope, orderBy: { id: "asc" } });
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const task = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: f.task.id } });
  const items = await prisma.amazonOrderItemRecord.findMany({ where: f.scope });
  const originals = await prisma.amazonSyncRawPage.findMany({ where: { taskId: task.id }, orderBy: { page: "asc" } });
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } });
  const callsBefore = calls.length;
  const pages = await readOrderFulfillmentRecoveryPages(f.scope, f.actor, f.params);
  assert.deepEqual(pages.pages, [1001, 1002]); assert.equal(pages.hasNext, false);
  assert.deepEqual((await readOrderFulfillmentRecoveryHistory(f.scope, f.actor, f.params)).batches, []);
  const preview = await readOrderFulfillmentRecoveryPreview(f.scope, f.actor, f.params);
  assert.equal(preview.started, false); assert.equal(preview.manifest.changedRows, 2); assert.equal(preview.manifest.addedFields, 4);
  assert.equal(preview.manifest.amazonRequests, 0); assert.equal(preview.manifest.historicalUniverseComplete, false);
  assert.ok(!/fixture-private|fixture-order|9007199254740993|rawCiphertext/.test(JSON.stringify(preview)));
  assert.deepEqual(await prisma.amazonOrderRecord.findMany({ where: f.scope, orderBy: { id: "asc" } }), before, "preview never modifies business records");
  await assert.rejects(() => applyOrderFulfillmentRecovery(f.scope, f.actor, preview.command), /审批/);
  const approval = await f.approved(preview.command);
  await assert.rejects(() => applyChange(f.scope, f.actor, approval.id), /完整性|使用|已/);
  const after = await prisma.amazonOrderRecord.findMany({ where: f.scope, orderBy: { id: "asc" } });
  assert.deepEqual(after, before.map(row => ({ ...row, fulfilledBy: "AMAZON", fulfillmentServiceLevel: "Standard" })));
  assert.deepEqual(await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } }), cursor);
  assert.deepEqual(await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } }), task);
  assert.deepEqual(await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.source.id } }), source);
  assert.deepEqual(await prisma.amazonOrderItemRecord.findMany({ where: f.scope }), items);
  assert.deepEqual(await prisma.amazonSyncRawPage.findMany({ where: { taskId: task.id }, orderBy: { page: "asc" } }), originals);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.orders.fulfillment-recovered" } }), 1);
  const history = await readOrderFulfillmentRecoveryHistory(f.scope, f.actor, f.params);
  assert.equal(history.batches.length, 1); assert.equal(history.batches[0].status, "APPLIED");
  assert.deepEqual(history.batches[0].pages, [1001, 1002]); assert.equal(history.batches[0].changedRows, 2);
  assert.ok(!/fixture-private|fixture-order|rawCiphertext/.test(JSON.stringify(history)));
  assert.equal((await readOrderFulfillmentRecoveryPreview(f.scope, f.actor, f.params)).manifest.changedRows, 0);
  const erp = await readOrders(f.scope, new URLSearchParams({ sellerAccountId: f.store, marketplaceId: site }), f.actor);
  assert.ok(erp.rows.every(row => row.fulfilledBy === "AMAZON" && row.fulfillmentServiceLevel === "Standard"));
  assert.equal(calls.length, callsBefore, "reparse never calls Amazon");
  const foreign = await fresh();
  await assert.rejects(() => readOrderFulfillmentRecoveryPreview(foreign.scope, foreign.actor, f.params));
});

test("order fulfillment reparse rejects stale approvals, conflicting fields and changed raw identity", async () => {
  const f = await legacyFulfillmentFixture();
  const preview = await readOrderFulfillmentRecoveryPreview(f.scope, f.actor, f.params);
  const request = await requestChange(f.scope, f.actor, preview.command);
  await decideChange(f.scope, f.approver, String(request.id), "APPROVED", "offline fixture");
  const row = await prisma.amazonOrderRecord.findFirstOrThrow({ where: f.scope });
  await prisma.amazonOrderRecord.update({ where: { id: row.id }, data: { fulfillmentServiceLevel: "DifferentService" } });
  const callsBefore = calls.length;
  await assert.rejects(() => applyChange(f.scope, f.actor, String(request.id)), /冲突|变化/);
  assert.equal(await prisma.amazonOrderRecord.count({ where: { ...f.scope, fulfilledBy: { not: null } } }), 0, "conflicting batch never partially fills another field");
  await prisma.amazonOrderRecord.update({ where: { id: row.id }, data: { fulfillmentServiceLevel: null, sourceUpdatedAt: new Date(row.sourceUpdatedAt.getTime() + 1000) } });
  await assert.rejects(() => readOrderFulfillmentRecoveryPreview(f.scope, f.actor, f.params), /版本/);
  await prisma.amazonOrderRecord.update({ where: { id: row.id }, data: { sourceUpdatedAt: row.sourceUpdatedAt } });
  const original = await prisma.amazonSyncRawPage.findUniqueOrThrow({ where: { taskId_page: { taskId: f.task.id, page: 1001 } } });
  await prisma.amazonSyncRawPage.update({ where: { taskId_page: { taskId: f.task.id, page: 1001 } }, data: { requestMetadata: { ...(original.requestMetadata as Prisma.JsonObject), marketplaceId: "wrong" } } });
  await assert.rejects(() => readOrderFulfillmentRecoveryPreview(f.scope, f.actor, f.params), /站点/);
  await prisma.amazonSyncRawPage.update({ where: { taskId_page: { taskId: f.task.id, page: 1001 } }, data: { requestMetadata: original.requestMetadata!, bodySha256: "0".repeat(64) } });
  await assert.rejects(() => readOrderFulfillmentRecoveryPreview(f.scope, f.actor, f.params), /摘要/);
  assert.equal(calls.length, callsBefore);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.orders.fulfillment-recovered" } }), 0);
});


test("order archive page discovery is bounded, metadata-only and isolated across sparse pages", async () => {
  const f = await legacyFulfillmentFixture();
  const raw = await prisma.amazonSyncRawPage.findUniqueOrThrow({ where: { taskId_page: { taskId: f.task.id, page: 1001 } } });
  // Invalid encrypted content deliberately proves discovery never decrypts raw
  // bodies. The preview must still reject these pages before any application.
  for (let i = 0; i < 11; i++) await prisma.amazonSyncRawPage.create({ data: { ...raw, requestMetadata: raw.requestMetadata ?? Prisma.JsonNull, page: 2000 + i * 5, rawCiphertext: "offline-invalid-ciphertext" } });
  const first = await readOrderFulfillmentRecoveryPages(f.scope, f.actor, f.params);
  assert.equal(first.pages.length, 10); assert.equal(first.hasNext, true); assert.equal(first.nextCursor, 2035);
  const nextParams = new URLSearchParams(f.params); nextParams.set("after", String(first.nextCursor));
  const next = await readOrderFulfillmentRecoveryPages(f.scope, f.actor, nextParams);
  assert.deepEqual(next.pages, [2040, 2045, 2050]); assert.equal(next.nextCursor, null); assert.equal(next.hasNext, false);
  assert.equal(first.rawValuesIncluded, false); assert.equal(first.started, false);
  const invalid = new URLSearchParams(f.params); invalid.set("rawPages", "2000");
  await assert.rejects(() => readOrderFulfillmentRecoveryPreview(f.scope, f.actor, invalid));
  const foreign = await fresh();
  await assert.rejects(() => readOrderFulfillmentRecoveryPages(foreign.scope, foreign.actor, f.params));
  await assert.rejects(() => readOrderFulfillmentRecoveryHistory(foreign.scope, foreign.actor, f.params));
  for (const after of ["-1", "1.5", "2147483648", "not-a-page"]) {
    const bad = new URLSearchParams(f.params); bad.set("after", after);
    await assert.rejects(() => readOrderFulfillmentRecoveryPages(f.scope, f.actor, bad), /游标/);
  }
  await prisma.amazonSyncRun.update({ where: { id: f.task.id }, data: { status: "RUNNING" } });
  await assert.rejects(() => readOrderFulfillmentRecoveryPages(f.scope, f.actor, f.params), /已完成/);
  await assert.rejects(() => readOrderFulfillmentRecoveryHistory(f.scope, f.actor, f.params), /已完成/);
});
