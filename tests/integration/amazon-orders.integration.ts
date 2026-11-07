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
import { readOrders } from "@/lib/amazon-sync/orders-query";
import { listSources } from "@/lib/amazon-sync/read";

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
after(async () => { delete endpoints[region]; delete endpoints["fixture-other-region"]; await prisma.$disconnect(); });

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
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authId, name: "Orders fixture", amazonSellerId: `fixture-seller-${authId}`, awsRegion: region, endpoint: endpoints[region], status: "CONFIGURED", approvedRoles: [...sourcePolicy.requiredRoles, ...(sourcePolicy.details?.requiredRoles ?? [])], rolesAttestedAt: new Date(), marketplaceParticipations: [{ marketplaceId: site, countryCode: "FX" }], updatedByUserId: actor, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId: authId }) } });
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
  return { scope, actor, approver, store, authId, source, approved, request, slice };
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
  assert.equal((await readOrders(f.scope, new URLSearchParams({ marketplaceId: "wrong-fixture-marketplace" }), f.actor)).pagination.total, 0);
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
    const logs = await prisma.amazonSyncTaskLog.findMany({ where: { taskId: task.id } });
    assert.ok(logs.some(l => l.event === "getOrder" && l.requestId === "fixture-detail-error"));
    assert.ok(!JSON.stringify({ logs, error: result.error }).includes("fixture-private"));
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

test("P2 detail commit failure rolls back items/encrypted payload/work; retry completes same pending item", async () => {
  const f = await fresh(true); fault = 0; detailFault = 0; const task = await f.request(); await f.slice(task.id);
  failDetailCommit = true;
  try {
    assert.equal((await f.slice(task.id)).status, "FAILED");
    const row = await prisma.amazonOrderRecord.findFirstOrThrow({ where: f.scope });
    assert.equal(row.detailCiphertext, null); assert.equal(row.detailsUpdatedAt, null);
    assert.equal(await prisma.amazonOrderItemRecord.count({ where: f.scope }), 0);
    assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: task.id } }), 1);
    assert.equal(await prisma.amazonOrderDetailWork.count({ where: { ...f.scope, status: "PENDING" } }), 1);
  } finally {
    failDetailCommit = false;
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fixture_reject_detail ON "AmazonOrderDetailWork"');
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS fixture_reject_detail()");
  }
  const restart = await f.request(); await f.slice(restart.id); await f.slice(restart.id); assert.equal((await f.slice(restart.id)).status, "SUCCEEDED");
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
  // First slice handles old records before fetching the new list window.
  const progress = await f.slice(second.id);
  assert.equal(progress.detailsCompletedCount, 1);
  assert.equal(calls.at(-1)?.path.startsWith("/orders/2026-01-01/orders/"), true);
  assert.ok(await prisma.amazonOrderItemRecord.count({ where: f.scope }) > 0);
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(cursor.watermarkFrom.toISOString(), new Date(oldCursor.watermarkTo.getTime() - policy.overlapSeconds * 1000).toISOString());
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: first.id } })).status, "SUCCEEDED");
  assert.equal((await readOrders(f.scope, new URLSearchParams(), f.actor)).sources[0].detailsEnabled, true);
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
