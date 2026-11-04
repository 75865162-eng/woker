import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "@/lib/amazon-sync/change-approval";
import * as mutations from "@/lib/amazon-sync/service";
import type { SyncScope } from "@/lib/amazon-sync/policy";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { tickSyncCenter } from "@/lib/amazon-sync/scheduler";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { publishedSnapshotScopes, readOverview } from "@/lib/amazon-sync/read";

const connection = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.AMAZON_SYNC_TEST_REDIS_DISPOSABLE !== "1") throw new Error("Dedicated disposable Redis acknowledgement is required; test clears its queue.");
if (!["127.0.0.1", "localhost"].includes(new URL(process.env.REDIS_URL ?? "http://invalid").hostname)) throw new Error("Integration Redis must be localhost.");
if (!["127.0.0.1", "localhost"].includes(connection.hostname) || connection.pathname !== "/amazon_sync_test") throw new Error("Integration test requires isolated localhost /amazon_sync_test database; refusing other targets.");
const scope = { organizationId: `sync-fixture-${randomUUID()}`, workspaceId: "sync-test" }, other = { organizationId: `sync-fixture-${randomUUID()}`, workspaceId: "sync-test" };
const actor = randomUUID(), approver = randomUUID(), store = randomUUID(), storeB = randomUUID();
const originalFetch = globalThis.fetch;
let transport: (url: URL) => Response | Promise<Response> = () => Response.json({ payload: { inventorySummaries: [] } });
let sourceId = "", secondSource = "", authId = "";
const fixtureInventory = (sku: string) => ({ lastUpdatedTime: "2026-11-01T00:00:00Z", sellerSku: sku, condition: "NewItem", asin: "ASIN", inventoryDetails: { fulfillableQuantity: 3, inboundWorkingQuantity: 0, inboundShippedQuantity: 1, inboundReceivingQuantity: 0, reservedQuantity: { totalReservedQuantity: 0 }, unfulfillableQuantity: { totalUnfulfillableQuantity: 0 }, researchingQuantity: { totalResearchingQuantity: 0 } } });
async function approved(target: SyncScope, user: string, command: Record<string, unknown>) {
  const row = await requestChange(target, user, command), id = String(row.id);
  assert.equal((await decideChange(target, approver, id, "APPROVED", "isolated fixture")).status, "APPROVED");
  await applyChange(target, user, id);
  return prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id } });
}
async function saveAuthorization(target: SyncScope, user: string, body: Record<string, unknown>) { const change = await approved(target, user, { ...body, action: "save-authorization" }); return prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: change.targetId } }); }
async function validateAuthorization(target: SyncScope, user: string, id: string) { return approved(target, user, { action: "validate-authorization", id }); }
async function saveSource(target: SyncScope, user: string, body: Record<string, unknown>) { const change = await approved(target, user, { ...body, action: "save-source" }); return prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: change.targetId } }); }
async function savePlan(target: SyncScope, user: string, body: Record<string, unknown>) { const change = await approved(target, user, { ...body, action: "save-plan" }); return prisma.amazonSyncSchedule.findUniqueOrThrow({ where: { id: change.targetId } }); }
async function requestTasks(target: SyncScope, user: string, body: Record<string, unknown>) { const change = await approved(target, user, { ...body, action: "run" }); return prisma.amazonSyncRun.findMany({ where: { ...target, executionApprovalId: change.id } }); }
async function controlTask(target: SyncScope, user: string, id: string, control: unknown) { return approved(target, user, { action: "control-task", id, control }); }
async function runTask(id: string) { const r = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } }); await prisma.amazonSyncApiBudget.deleteMany({ where: { organizationId: r.organizationId, workspaceId: r.workspaceId } }); await processSyncCenterTask(r.id, r.dispatchVersion); return prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } }); }
async function request(source = sourceId) { const [r] = await requestTasks(scope, actor, { sourceIds: [source], idempotencyKey: randomUUID() }); return r; }
async function failCurrent(id: string) { await prisma.amazonSyncRun.update({ where: { id }, data: { status: "FAILED", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } }); }
before(async () => {
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 18).toString("base64");
  process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify([[scope.organizationId, scope.workspaceId], [other.organizationId, other.workspaceId]]);
  process.env.QUEUE_DRIVER = "redis";
  await prisma.organization.createMany({ data: [{ id: scope.organizationId, name: "Fixture A", slug: scope.organizationId }, { id: other.organizationId, name: "Fixture B", slug: other.organizationId }] });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "API fixture" } });
  await prisma.user.create({ data: { id: actor, email: `${actor}@fixture.invalid`, name: "Fixture operator", passwordHash: "not-a-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.user.create({ data: { id: approver, email: `${approver}@fixture.invalid`, name: "Fixture approver", passwordHash: "not-a-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.createMany({ data: [{ id: store, ...scope, accountKey: "store", displayName: "Fixture A", marketplaceCode: "US" }, { id: storeB, ...scope, accountKey: "store-b", displayName: "Fixture B", marketplaceCode: "CA" }] });
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.ok(["api.amazon.com", "sellingpartnerapi-na.amazon.com"].includes(url.hostname), "Only mocked official endpoints are allowed");
    if (url.hostname === "api.amazon.com") return Response.json({ access_token: "fixture-token", expires_in: 3600 });
    if (url.pathname.includes("marketplaceParticipations")) return Response.json({ payload: [{ marketplace: { id: "ATVPDKIKX0DER", countryCode: "US" }, participation: { isParticipating: true } }, { marketplace: { id: "A2EUQ1WTGCTBG2", countryCode: "CA" }, participation: { isParticipating: true } }] });
    return transport(url);
  };
  const a = await saveAuthorization(scope, actor, { name: "Fixture Auth", amazonSellerId: "FIXTURE_SELLER", region: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh" });
  authId = a.id; await validateAuthorization(scope, actor, authId);
  sourceId = (await saveSource(scope, actor, { authorizationId: authId, sellerAccountId: store, marketplaceId: "ATVPDKIKX0DER", resource: "inventory", enabled: true })).id;
  secondSource = (await saveSource(scope, actor, { authorizationId: authId, sellerAccountId: storeB, marketplaceId: "A2EUQ1WTGCTBG2", resource: "inventory", enabled: true })).id;
});
after(async () => { globalThis.fetch = originalFetch; await getAmazonSyncQueue().close(); await prisma.$disconnect(); });

test("DB constraints enforce tenant authorization/store isolation and one active task", async () => {
  await assert.rejects(() => saveSource(other, actor, { authorizationId: authId, sellerAccountId: store, marketplaceId: "ATVPDKIKX0DER", resource: "inventory", enabled: true }));
  await assert.rejects(() => prisma.amazonSyncDataSource.create({ data: { ...other, id: randomUUID(), authorizationId: authId, sellerAccountId: store, marketplaceId: "ATVPDKIKX0DER", resource: "inventory", freshnessMinutes: 360 } }));
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => request()));
  const runs = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  assert.equal(runs.length, 1); assert.equal(results.filter(result => result.status === "rejected").length, 3);
  await assert.rejects(() => prisma.amazonSyncRun.create({ data: { ...scope, id: randomUUID(), sourceId, executionVersion: 2, requestedByUserId: actor, resource: "inventory", status: "WAITING" } }));
  await failCurrent(runs[0].id);
});
test("complete empty scope publishes a fresh zero-row manifest and preserves the other marketplace", async () => {
  transport = () => Response.json({ payload: { inventorySummaries: [] } });
  const a = await request(), b = await request(secondSource);
  assert.equal((await runTask(a.id)).status, "SUCCEEDED");
  assert.equal((await runTask(b.id)).status, "SUCCEEDED");
  const heads = await publishedSnapshotScopes(scope, "inventory", actor); assert.equal(heads.length, 2);
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sourceId } }); assert.equal(source.rowCount, 0); assert.equal(source.activeRunId, a.id); assert.ok(source.lastSuccessAt);
  const { readTaskSnapshot } = await import("@/lib/amazon-sync/snapshots");
  const empty = await readTaskSnapshot(scope, new URLSearchParams({ id: a.id }), actor);
  assert.equal(empty.pagination.total, 0); assert.deepEqual(empty.snapshotRows, []);
});
test("pagination failure retains old head, safe checkpoint, retry and deduplication", async () => {
  const old = (await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sourceId } })).activeRunId;
  transport = url => url.searchParams.get("nextToken") ? Response.json({ message: "fixture private upstream" }, { status: 503 }) : Response.json({ payload: { inventorySummaries: [fixtureInventory("SKU-1")] }, pagination: { nextToken: "fixture-sensitive-next" } });
  const task = await request(); const failed = await runTask(task.id);
  assert.equal(failed.status, "RETRY_WAIT"); assert.equal(failed.pagesCompleted, 1); assert.ok(failed.checkpointCiphertext); assert.ok(!failed.checkpointCiphertext.includes("fixture-sensitive-next"));
  assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sourceId } })).activeRunId, old);
  await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { nextAttemptAt: new Date() } });
  await prisma.amazonSyncApiBudget.deleteMany({ where: scope });
  transport = url => { assert.equal(url.searchParams.get("nextToken"), "fixture-sensitive-next"); return Response.json({ payload: { inventorySummaries: [fixtureInventory("SKU-1"), fixtureInventory("SKU-2")] } }); };
  const completed = await runTask(task.id); assert.equal(completed.status, "SUCCEEDED"); assert.equal(completed.insertedCount, 2); assert.equal(completed.skippedCount, 1); assert.equal(completed.attempts, 2);
  const logs = JSON.stringify(await prisma.amazonSyncTaskLog.findMany({ where: { taskId: task.id } })); assert.ok(!logs.includes("fixture-sensitive-next")); assert.ok(!logs.includes("fixture private"));
});
test("cancel/pause controls persist and a queued stale generation cannot execute", async () => {
  const task = await request(); await controlTask(scope, actor, task.id, "pause"); assert.equal((await runTask(task.id)).status, "PAUSED");
  await controlTask(scope, actor, task.id, "resume");
  const live = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
  await processSyncCenterTask(task.id, live.dispatchVersion - 1); assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).attempts, 0);
  await controlTask(scope, actor, task.id, "cancel"); assert.equal((await runTask(task.id)).status, "CANCELLED");
});
test("per-scope checkpoints survive worker interruption and stale publisher is fenced", async () => {
  await prisma.amazonSyncApiBudget.deleteMany({ where: scope });
  let release: () => void = () => {}, requested: () => void = () => {};
  const entered = new Promise<void>(r => { requested = r; }), gate = new Promise<void>(r => { release = r; });
  transport = async () => { requested(); await gate; return Response.json({ payload: { inventorySummaries: [fixtureInventory("STALE-WORKER")] } }); };
  const task = await request(), work = runTask(task.id); await entered;
  await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
  await tickSyncCenter(); release(); await work;
  const recovered = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } }); assert.notEqual(recovered.status, "SUCCEEDED"); assert.ok(recovered.fenceVersion > 1);
  await prisma.amazonSyncApiBudget.deleteMany({ where: scope });
  transport = () => Response.json({ payload: { inventorySummaries: [fixtureInventory("RECOVERED")] } });
  const completed = await runTask(task.id); assert.equal(completed.status, "SUCCEEDED");
  assert.equal(await prisma.amazonInventorySnapshot.count({ where: { syncRunId: task.id, sellerSku: "STALE-WORKER" } }), 0);
});
test("invalid page/loop and revoked domain prevent publication; manual retry restarts snapshot", async () => {
  await prisma.amazonSyncApiBudget.deleteMany({ where: scope });
  transport = () => Response.json({ payload: { inventorySummaries: [{}] } });
  const task = await request(); assert.equal((await runTask(task.id)).status, "FAILED");
  await controlTask(scope, actor, task.id, "retry");
  transport = () => Response.json({ payload: { inventorySummaries: [] } }); assert.equal((await runTask(task.id)).status, "SUCCEEDED");
  const next = await request(); await prisma.user.update({ where: { id: actor }, data: { status: "disabled" } }); assert.equal((await runTask(next.id)).status, "BLOCKED");
  await prisma.user.update({ where: { id: actor }, data: { status: "active" } });
});
test("approved policies cannot auto-run; explicit execution and Redis loss retain dispatch intent", async () => {
  const plan = await savePlan(scope, actor, { name: "Fixture hourly", resource: "inventory", enabled: false, intervalMinutes: 60, sourceIds: [secondSource], priority: 1 });
  await assert.rejects(() => savePlan(scope, actor, { name: "Automatic execution denied", resource: "inventory", enabled: true, intervalMinutes: 60, sourceIds: [secondSource] }));
  await assert.rejects(() => savePlan(scope, actor, { id: plan.id, revision: 0, name: "stale", resource: "inventory", enabled: false, intervalMinutes: 60, sourceIds: [secondSource] }));
  await prisma.amazonSyncSchedule.update({ where: { id: plan.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
  await tickSyncCenter();
  assert.equal(await prisma.amazonSyncRun.count({ where: { scheduleId: plan.id } }), 0);
  await requestTasks(scope, actor, { planId: plan.id, sourceIds: [secondSource] }); await tickSyncCenter();
  const task = await prisma.amazonSyncRun.findFirstOrThrow({ where: { scheduleId: plan.id } }); assert.equal(task.status, "QUEUED"); assert.equal(task.priority, 1);
  const queue = getAmazonSyncQueue(); await queue.obliterate({ force: true }); await tickSyncCenter();
  assert.ok(await queue.getJob(`adc-${task.id}-${task.dispatchVersion}`));
  await failCurrent(task.id);
});
test("approval cannot be replayed or bypassed and task ownership is checked", async () => {
  await assert.rejects(() => mutations.requestTasks(scope, actor, { sourceIds: [sourceId], idempotencyKey: "bypass" }), /APPROVAL_REQUIRED/);
  const change = await approved(scope, actor, { action: "run", sourceIds: [sourceId] });
  const task = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionApprovalId: change.id } });
  await assert.rejects(() => applyChange(scope, actor, change.id));
  assert.equal(await prisma.amazonSyncRun.count({ where: { ...scope, executionApprovalId: change.id } }), 1);
  await assert.rejects(() => controlTask(other, actor, task.id, "cancel")); await controlTask(scope, actor, task.id, "cancel");
  const overview = await readOverview(scope, new URLSearchParams({ sellerAccountId: store }), actor); assert.equal(overview.sources.length, 1); assert.equal(overview.sources[0].sellerAccountId, store);
});

test("listing adapter rejects malformed pagination and publishes only a validated catalog", async () => {
  const source = await saveSource(scope, actor, { authorizationId: authId, sellerAccountId: store, marketplaceId: "ATVPDKIKX0DER", resource: "catalog", enabled: true });
  transport = () => Response.json({ items: [], pagination: { nextToken: 123 } });
  const broken = await request(source.id); assert.equal((await runTask(broken.id)).status, "FAILED");
  transport = () => Response.json({ numberOfResults: 25, items: [{ sku: "TRUNCATED-SKU" }] });
  const truncated = await request(source.id); assert.equal((await runTask(truncated.id)).status, "FAILED");
  assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId, null);
  const good = await request(source.id);
  transport = () => Response.json({ items: [{ sku: "LISTING-SKU", summaries: [{ marketplaceId: "ATVPDKIKX0DER", asin: "LISTING-ASIN", status: ["BUYABLE"] }] }] });
  assert.equal((await runTask(good.id)).status, "SUCCEEDED");
  const rows = await prisma.amazonCatalogSnapshot.findMany({ where: { sourceRunId: good.id } }); assert.equal(rows.length, 1); assert.equal(rows[0].sourceUpdatedAt, null); assert.equal(rows[0].dataVersion, 1);
});
test("looping pagination and authorization revision changes cannot advance a published head", async () => {
  await prisma.amazonSyncApiBudget.deleteMany({ where: scope });
  transport = () => Response.json({ payload: { inventorySummaries: [] }, pagination: { nextToken: "loop" } });
  const old = (await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sourceId } })).activeRunId;
  const looping = await request(); assert.equal((await runTask(looping.id)).status, "FAILED");
  assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sourceId } })).activeRunId, old);
  const task = await request(); await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { authorizationRevision: 0 } });
  assert.equal((await runTask(task.id)).status, "BLOCKED"); assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sourceId } })).activeRunId, old);
});
test("bounded 1k/5k/10k fixture snapshots and page reads record capacity evidence", { timeout: 120000 }, async () => {
  const { performance } = await import("node:perf_hooks"), { writeFile } = await import("node:fs/promises");
  const evidence: unknown[] = [];
  const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
  for (const count of [1000, 5000, 10000]) {
    await prisma.amazonSyncApiBudget.deleteMany({ where: scope });
    transport = url => { const page = Number(url.searchParams.get("nextToken") ?? 0), offset = page * 1000;
      return Response.json({ payload: { inventorySummaries: Array.from({ length: Math.min(1000, count - offset) }, (_, i) => fixtureInventory(`CAP-${offset + i}`)) }, ...(offset + 1000 < count ? { pagination: { nextToken: String(page + 1) } } : {}) }); };
    const task = await request(), start = performance.now(), slices: number[] = [];
    let status = task.status;
    while (["WAITING", "QUEUED"].includes(status)) { const s = performance.now(), result = await runTask(task.id); slices.push(performance.now() - s); status = result.status; }
    assert.equal(status, "SUCCEEDED");
    const row = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sourceId } }); assert.equal(row.rowCount, count);
    assert.equal((await prisma.amazonInventorySnapshot.findFirstOrThrow({ where: { syncRunId: task.id } })).sourceUpdatedAt?.toISOString(), "2026-11-01T00:00:00.000Z");
    const reads: number[] = [];
    for (let i = 0; i < 40; i++) { const before = performance.now(); await prisma.amazonInventorySnapshot.findMany({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, syncRunId: task.id }, orderBy: { sellerSku: "asc" }, take: 50, skip: (i % 10) * 50 }); reads.push(performance.now() - before); }
    evidence.push({ rows: count, taskDurationMs: performance.now() - start, slices: slices.length, sliceMs: slices, readSamples: reads.length, readP50Ms: percentile(reads, .5), readP95Ms: percentile(reads, .95), readP99Ms: percentile(reads, .99), rssBytes: process.memoryUsage().rss });
  }
  const result = { environment: "disposable localhost PostgreSQL 16 (1 CPU/512 MiB) + Redis 7; mocked Amazon; no browser/network production SLA", capturedAt: new Date().toISOString(), evidence };
  if (process.env.AMAZON_SYNC_BENCHMARK_OUTPUT) await writeFile(process.env.AMAZON_SYNC_BENCHMARK_OUTPUT, JSON.stringify(result, null, 2) + "\n");
  console.log(`CAPACITY ${JSON.stringify(result)}`);
});

test("a real BullMQ worker consumes persisted dispatch and publishes only after processing", { timeout: 20000 }, async () => {
  const { Worker } = await import("bullmq");
  const { createRedisConnectionOptions, amazonSyncQueueName } = await import("@/lib/queue/redis-queue");
  const queue = getAmazonSyncQueue(); await queue.obliterate({ force: true });
  transport = () => Response.json({ payload: { inventorySummaries: [] } });
  const task = await request();
  const worker = new Worker<{ runId: string; dispatchVersion: number }>(amazonSyncQueueName, job => processSyncCenterTask(job.data.runId, job.data.dispatchVersion), { connection: createRedisConnectionOptions(), concurrency: 1 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const finished = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Fixture worker did not complete the persisted task")), 15000);
      worker.on("completed", job => { if (job.data.runId === task.id) resolve(); });
      worker.on("failed", (job, error) => { if (job?.data.runId === task.id) reject(error); });
      worker.on("error", reject);
    });
    await tickSyncCenter(); await finished;
    assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status, "SUCCEEDED");
    assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sourceId } })).activeRunId, task.id);
  } finally { if (timer) clearTimeout(timer); await worker.close(); }
});

test("authenticated API to real queue/worker to seller-bound snapshot completes with credential rotation", { timeout: 30000 }, async () => {
  const { GET, POST } = await import("@/app/api/operations/sync-center/route");
  const { POST: approvalPost } = await import("@/app/api/operations/sync-center/approvals/route");
  const { createSession } = await import("@/lib/auth/session");
  const { Worker } = await import("bullmq");
  const { createRedisConnectionOptions, amazonSyncQueueName } = await import("@/lib/queue/redis-queue");
  process.env.AUTH_DRIVER = "database";
  const session = await createSession(actor);
  const approverSession = await createSession(approver);
  const headers = { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}`, "content-type": "application/json", "x-workspace-id": scope.workspaceId };
  const post = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/operations/sync-center", { method: "POST", headers, body: JSON.stringify(body) }));
  const get = (query: string) => GET(new Request(`http://localhost/api/operations/sync-center?${query}`, { headers }));
  const appliedPost = async (body: Record<string, unknown>, expectedStatus = 200) => {
    const response = await post(body); assert.equal(response.status, 202);
    const { changeRequest } = await response.json();
    assert.ok(!JSON.stringify(changeRequest).includes("fixture-b-secret"));
    const decision = await approvalPost(new Request("http://localhost/api/operations/sync-center/approvals", { method: "POST", headers: { ...headers, cookie: `${approverSession.sessionCookie.name}=${approverSession.sessionCookie.value}` }, body: JSON.stringify({ id: changeRequest.id, decision: "APPROVED" }) }));
    assert.equal(decision.status, 200);
    const applied = await approvalPost(new Request("http://localhost/api/operations/sync-center/approvals", { method: "POST", headers, body: JSON.stringify({ id: changeRequest.id, decision: "APPLY" }) }));
    assert.equal(applied.status, expectedStatus);
    return changeRequest as { id: string; targetId: string };
  };
  const auth = await appliedPost({ action: "save-authorization", name: "Seller B private", amazonSellerId: "SELLER_B_DISTINCT", region: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", lwaClientId: "fixture-b-client", lwaClientSecret: "fixture-b-secret", refreshToken: "fixture-b-refresh" });
  const authorization = { id: auth.targetId };
  await appliedPost({ action: "validate-authorization", id: authorization.id });
  const sourceResponse = await appliedPost({ action: "save-source", authorizationId: authorization.id, sellerAccountId: storeB, marketplaceId: "ATVPDKIKX0DER", resource: "inventory", enabled: true });
  const source = { id: sourceResponse.targetId };
  transport = () => Response.json({ payload: { inventorySummaries: [fixtureInventory("SELLER-B-ONLY")] } });
  const credentialFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "api.amazon.com") {
      assert.equal(new URLSearchParams(String(init?.body)).get("refresh_token"), "fixture-b-refresh");
      return Response.json({ access_token: "seller-b-access-only", expires_in: 3600 });
    }
    if (url.pathname.includes("/fba/inventory/")) assert.equal(new Headers(init?.headers).get("x-amz-access-token"), "seller-b-access-only");
    return credentialFetch(input, init);
  };
  const created = await appliedPost({ action: "run", sourceIds: [source.id] });
  const { id } = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionApprovalId: created.id } });
  assert.equal((await get(`section=snapshots&id=${id}`)).status, 409);
  const queue = getAmazonSyncQueue(); await queue.obliterate({ force: true });
  const worker = new Worker<{ runId: string; dispatchVersion: number }>(amazonSyncQueueName, job => processSyncCenterTask(job.data.runId, job.data.dispatchVersion), { connection: createRedisConnectionOptions(), concurrency: 1 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const complete = new Promise<void>((resolve, reject) => { timer = setTimeout(() => reject(new Error("API fixture worker timed out")), 15000); worker.on("completed", job => { if (job.data.runId === id) resolve(); }); worker.on("error", reject); });
    await tickSyncCenter(); await complete;
  } finally { if (timer) clearTimeout(timer); await worker.close(); globalThis.fetch = credentialFetch; }
  const detail = await get(`section=task&id=${id}`); assert.equal(detail.status, 200); assert.equal((await detail.json()).task.status, "SUCCEEDED");
  const snapshot = await get(`section=snapshots&id=${id}`); assert.equal(snapshot.status, 200); const data = await snapshot.json();
  assert.equal(data.snapshot.amazonSellerId, "SELLER_B_DISTINCT"); assert.equal(data.snapshot.sellerAccountId, storeB); assert.equal(data.snapshot.marketplaceId, "ATVPDKIKX0DER"); assert.equal(data.snapshotRows[0].sellerSku, "SELLER-B-ONLY");
  const { readTaskSnapshot } = await import("@/lib/amazon-sync/snapshots");
  await assert.rejects(() => readTaskSnapshot(other, new URLSearchParams({ id }), actor), /任务不存在|不可访问/);
  const foreignActor = randomUUID();
  await prisma.user.create({ data: { id: foreignActor, name: "Other tenant actor", email: `${foreignActor}@fixture.invalid`, passwordHash: "not-a-login", memberships: { create: { organizationId: other.organizationId, role: "owner" } } } });
  await prisma.workspaceScope.create({ data: { organizationId: other.organizationId, id: other.workspaceId, name: "Other tenant" } });
  const foreignSession = await createSession(foreignActor);
  assert.equal((await GET(new Request(`http://localhost/api/operations/sync-center?section=snapshots&id=${id}`, { headers: { "x-workspace-id": other.workspaceId, cookie: `${foreignSession.sessionCookie.name}=${foreignSession.sessionCookie.value}` } }))).status, 404);
  assert.equal((await GET(new Request(`http://localhost/api/operations/sync-center?section=settings&workspaceId=${scope.workspaceId}`, { headers: { ...headers, "x-workspace-id": "foreign" } }))).status, 403);
  assert.equal((await GET(new Request(`http://localhost/api/operations/sync-center?section=snapshots&id=${id}&workspaceId=foreign`, { headers: { cookie: headers.cookie } }))).status, 403);
  await prisma.amazonSyncRun.update({ where: { id }, data: { stage: "PURGED" } });
  assert.equal((await get(`section=snapshots&id=${id}`)).status, 410);
  await prisma.amazonSyncRun.update({ where: { id }, data: { stage: "COMPLETED" } });
  await prisma.amazonSpApiAuthorization.update({ where: { id: authorization.id }, data: { status: "DISABLED" } });
  await appliedPost({ action: "validate-authorization", id: authorization.id }, 409);
  const beforeRotation = await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: authorization.id } });
  await appliedPost({ action: "save-authorization", id: authorization.id, revision: beforeRotation.revision, name: "Seller B renewed", amazonSellerId: "SELLER_B_DISTINCT", region: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", refreshToken: "fixture-rotated-refresh" });
  assert.equal((await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: authorization.id } })).revision, beforeRotation.revision + 1);
  transport = () => Response.json({}, { status: 403 });
  // Participation responses are intercepted separately; emulate a rejection at the client transport.
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async input => String(input).includes("marketplaceParticipations") ? Response.json({ message: "private-upstream-token" }, { status: 403 }) : savedFetch(input);
  try { await appliedPost({ action: "validate-authorization", id: authorization.id }, 409); }
  finally { globalThis.fetch = savedFetch; }
  const connections = await get("section=connections"), connectionsText = await connections.text();
  assert.ok(connectionsText.includes("AUTH_REJECTED")); assert.ok(!connectionsText.includes("private-upstream-token")); assert.ok(!connectionsText.includes("fixture-rotated-refresh"));
  await appliedPost({ action: "validate-authorization", id: authorization.id });
  globalThis.fetch = async (input, init) => String(input).includes("api.amazon.com/auth/o2/token") ? Response.json({ error: "invalid_grant", error_description: "fixture-rotated-refresh" }, { status: 400 }) : savedFetch(input, init);
  try {
    await appliedPost({ action: "validate-authorization", id: authorization.id }, 409);
    const rejected = await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: authorization.id } });
    assert.equal(rejected.status, "ERROR"); assert.equal(rejected.validationErrorCode, "AUTH_REJECTED");
    await appliedPost({ action: "run", sourceIds: [source.id] }, 409);
  } finally { globalThis.fetch = savedFetch; }
  await appliedPost({ action: "validate-authorization", id: authorization.id });
  const blockedTask = await appliedPost({ action: "run", sourceIds: [source.id] });
  const { id: blockedId } = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionApprovalId: blockedTask.id } });
  await assert.rejects(() => prisma.workspaceScope.delete({ where: { organizationId_id: { organizationId: scope.organizationId, id: scope.workspaceId } } }), (error: unknown) => (error as { code?: string }).code === "P2003");
  await prisma.amazonSyncDataSource.update({ where: { id: source.id }, data: { revision: { increment: 1 } } });
  assert.equal((await runTask(blockedId)).status, "BLOCKED");
  assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId, id);
});

test("real browser creates authorization, runs a queued task, retries failure and reads its snapshot", { timeout: 60000 }, async () => {
  const storeId = randomUUID();
  await prisma.sellerAccount.create({ data: { ...scope, id: storeId, accountKey: "browser-store", displayName: "Browser Fixture Store", marketplaceCode: "US" } });
  transport = () => Response.json({ payload: {} });
  const { exerciseSyncCenterBrowser } = await import("./sync-center-browser");
  await exerciseSyncCenterBrowser({ ...scope, actorId: actor, approverId: approver, storeId, setValidTransport: () => { transport = () => Response.json({ payload: { inventorySummaries: [fixtureInventory("BROWSER-SELLER-C-SKU")] } }); } });
});

test("sources and plans can be stopped after authorization becomes unavailable", async () => {
  const plan = await prisma.amazonSyncSchedule.findFirstOrThrow({ where: { ...scope, executionVersion: 2 } });
  await prisma.amazonSpApiAuthorization.update({ where: { id: authId }, data: { status: "NOT_CONFIGURED" } });
  const source = await saveSource(scope, actor, { authorizationId: authId, sellerAccountId: storeB, marketplaceId: "A2EUQ1WTGCTBG2", resource: "inventory", enabled: false });
  assert.equal(source.enabled, false);
  const paused = await savePlan(scope, actor, { id: plan.id, revision: plan.revision, name: plan.name, resource: "inventory", enabled: false, intervalMinutes: 60, sourceIds: [secondSource] });
  assert.equal(paused.enabled, false); assert.equal(paused.nextRunAt, null);
  await assert.rejects(() => saveSource(scope, actor, { authorizationId: authId, sellerAccountId: storeB, marketplaceId: "A2EUQ1WTGCTBG2", resource: "inventory", enabled: true }));
});

test("retention remains approval-only and cannot silently delete historical or published data", async () => {
  const { maintainSyncCenter } = await import("@/lib/amazon-sync/maintenance");
  const heads = await prisma.amazonSyncDataSource.findMany({ where: scope, select: { activeRunId: true } });
  const currentIds = heads.flatMap(h => h.activeRunId ? [h.activeRunId] : []);
  const historical = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionVersion: 2, status: "SUCCEEDED", id: { notIn: currentIds } } });
  const old = new Date(Date.now() - 4000 * 86400000);
  await prisma.amazonSyncRun.updateMany({ where: { ...scope, id: { in: [historical.id, ...currentIds] } }, data: { finishedAt: old } });
  const beforePages = await prisma.amazonSyncPage.count({ where: { taskId: historical.id } });
  const beforeStage = historical.stage;
  assert.deepEqual(await maintainSyncCenter(), { cleaned: 0, approvalRequired: true });
  const purged = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: historical.id } });
  assert.equal(purged.stage, beforeStage); assert.equal(purged.status, "SUCCEEDED");
  assert.equal(await prisma.amazonSyncPage.count({ where: { taskId: historical.id } }), beforePages);
  for (const id of currentIds) assert.notEqual((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } })).stage, "PURGED");
  await assert.rejects(() => controlTask(scope, actor, historical.id, "retry"));
});
