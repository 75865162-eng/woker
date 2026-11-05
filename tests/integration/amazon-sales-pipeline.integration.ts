import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { Worker, type Job } from "bullmq";
import { prisma } from "@/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "@/lib/amazon-sync/change-approval";
import { rangeFromFrozen } from "@/lib/amazon-sync/date-range";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { processSalesExport } from "@/lib/amazon-sync/exports";
import { tickSyncCenter } from "@/lib/amazon-sync/scheduler";
import { createSession } from "@/lib/auth/session";
import { getStorageDriver } from "@/lib/storage";
import { amazonSyncQueueName, createRedisConnectionOptions, getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { GET, POST } from "@/app/api/operations/sync-center/route";
import { GET as getExport, POST as postExport } from "@/app/api/operations/sync-center/exports/route";

// Requires separate execution approval: real disposable DB/Redis/files, mock Amazon only.
const database = new URL(process.env.DATABASE_URL ?? "http://invalid"), redis = new URL(process.env.REDIS_URL ?? "http://invalid");
const uploadRoot = path.resolve(process.env.UPLOAD_DIR ?? ".");
if (process.env.AMAZON_SYNC_TEST_REDIS_DISPOSABLE !== "1" || !["127.0.0.1", "localhost"].includes(database.hostname) || database.pathname !== "/amazon_sync_test" || !["127.0.0.1", "localhost"].includes(redis.hostname) || process.env.STORAGE_DRIVER !== "local" || !uploadRoot.startsWith(path.join(tmpdir(), "amazon-sync-integration-")) || path.basename(uploadRoot) !== "uploads") throw new Error("Use the approved disposable runner; refusing other database, Redis or storage targets");
type Payload = { runId: string; dispatchVersion?: number; exportId?: string; fence?: number };
const scope = { organizationId: `pipeline-${randomUUID()}`, workspaceId: "pipeline" };
const foreign = { organizationId: `foreign-${randomUUID()}`, workspaceId: "pipeline" };
const actor = randomUUID(), approver = randomUUID(), foreignActor = randomUUID(), sellerId = randomUUID(), site = "ATVPDKIKX0DER";
const originalFetch = globalThis.fetch;
let sourceId = "", worker: Worker<Payload> | undefined, apiCalls = 0, reportCount = 0, partial = false;
let range: ReturnType<typeof rangeFromFrozen>;
const cookies = new Map<string, string>();
const reportRequests: unknown[] = [];
function request(url: string, user = actor, body?: unknown, workspaceId = scope.workspaceId) {
  return new Request(`http://localhost${url}`, { method: body ? "POST" : "GET", headers: { cookie: cookies.get(user) ?? "", "x-workspace-id": workspaceId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function approve(id: string) {
  const decision = await decideChange(scope, approver, id, "APPROVED", "isolated fixture");
  assert.equal(decision.status, "APPROVED");
  await applyChange(scope, actor, id);
}
async function configure(command: Record<string, unknown>) {
  const change = await requestChange(scope, actor, command), id = String(change.id);
  await approve(id);
  return prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id } });
}
async function requestedTask() {
  const response = await POST(request("/api/operations/sync-center", actor, { action: "run", sourceIds: [sourceId], datePreset: "yesterday" }));
  assert.equal(response.status, 202);
  const changeId = String((await response.json()).changeRequest.id);
  assert.equal(await prisma.amazonSyncRun.count({ where: { ...scope, executionApprovalId: changeId } }), 0, "approval request must not create execution intent");
  await approve(changeId);
  const task = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionApprovalId: changeId } });
  range = rangeFromFrozen(task.frozenScope);
  return task;
}
async function consume(id: string, exporting = false) {
  assert.ok(worker);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Fixture queue slice timed out")), 10000);
    const matches = (job?: Job<Payload>) => exporting ? job?.data.exportId === id : job?.data.runId === id;
    const completed = (job: Job<Payload>) => { if (matches(job)) finish(); };
    const failed = (job: Job<Payload> | undefined, error: Error) => { if (matches(job)) finish(error); };
    function finish(error?: Error) { clearTimeout(timer); worker!.off("completed", completed); worker!.off("failed", failed); worker!.off("error", finish); if (error) reject(error); else resolve(); }
    worker!.on("completed", completed); worker!.on("failed", failed); worker!.on("error", finish);
    void tickSyncCenter(new Date(), { taskIds: exporting ? [] : [id], exportIds: exporting ? [id] : [] }).catch(finish);
  });
}
async function finishReport(id: string) {
  for (let slice = 0; slice < 4; slice++) {
    const task = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
    if (["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "BLOCKED"].includes(task.status)) return task;
    // Only fixture scheduling clocks/budgets are advanced; approval and execution code remain intact.
    await prisma.amazonSyncRun.update({ where: { id }, data: { nextAttemptAt: new Date() } });
    await prisma.amazonSyncApiBudget.deleteMany({ where: scope });
    await consume(id);
  }
  return prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
}
before(async () => {
  process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify([[scope.organizationId, scope.workspaceId], [foreign.organizationId, foreign.workspaceId]]);
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 32).toString("base64"); process.env.QUEUE_DRIVER = "redis";
  await prisma.organization.createMany({ data: [scope, foreign].map(s => ({ id: s.organizationId, name: "Fixture", slug: s.organizationId })) });
  await prisma.workspaceScope.createMany({ data: [scope, foreign].map(s => ({ organizationId: s.organizationId, id: s.workspaceId, name: "Fixture" })) });
  for (const [id, organizationId] of [[actor, scope.organizationId], [approver, scope.organizationId], [foreignActor, foreign.organizationId]]) {
    await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: "Fixture", passwordHash: "not-a-login", memberships: { create: { organizationId, role: "owner" } } } });
    const session = await createSession(id); cookies.set(id, `${session.sessionCookie.name}=${session.sessionCookie.value}`);
  }
  await prisma.sellerAccount.create({ data: { ...scope, id: sellerId, accountKey: "fixture", displayName: "Fixture Seller", marketplaceCode: "US" } });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); apiCalls++;
    if (url.hostname === "api.amazon.com" && url.pathname === "/auth/o2/token") return Response.json({ access_token: "fixture-token", expires_in: 3600 });
    if (url.hostname === "sellingpartnerapi-na.amazon.com") {
      if (url.pathname.includes("marketplaceParticipations")) return Response.json({ payload: [{ marketplace: { id: site, countryCode: "US" }, participation: { isParticipating: true } }] });
      if (url.pathname.startsWith("/listings/2021-08-01/items/")) return Response.json({ items: [] });
      if (url.pathname === "/reports/2021-06-30/reports" && init?.method === "POST") { const body = JSON.parse(String(init.body)); assert.equal(body.dataStartTime, range.startAt); assert.equal(body.dataEndTime, range.reportEndAt); reportRequests.push(body); return Response.json({ reportId: `report-${++reportCount}` }); }
      if (url.pathname.startsWith("/reports/2021-06-30/reports/")) return Response.json({ reportId: `report-${reportCount}`, reportType: "GET_SALES_AND_TRAFFIC_REPORT", marketplaceIds: [site], processingStatus: "DONE", reportDocumentId: "fixture-document" });
      if (url.pathname === "/reports/2021-06-30/documents/fixture-document") return Response.json({ reportDocumentId: "fixture-document", url: "https://fixture.s3.us-east-1.amazonaws.com/report" });
    }
    if (url.hostname === "fixture.s3.us-east-1.amazonaws.com" && url.pathname === "/report") {
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return Response.json({ reportSpecification: { reportType: "GET_SALES_AND_TRAFFIC_REPORT", marketplaceIds: [site], dataStartTime: range.startAt, dataEndTime: range.reportEndAt, reportOptions: { dateGranularity: "DAY", asinGranularity: "CHILD" } }, salesAndTrafficByDate: partial ? [] : [{ date: range.from, salesByDate: { unitsOrdered: 2, totalOrderItems: 1, orderedProductSales: { amount: 20, currencyCode: "USD" } }, trafficByDate: { sessions: 10, pageViews: 15 } }] });
    }
    throw new Error("Unmocked external HTTP forbidden");
  };
  const auth = await configure({ action: "save-authorization", name: "Fixture", amazonSellerId: "fixture-seller", region: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh" });
  await configure({ action: "validate-authorization", id: auth.targetId });
  const src = await configure({ action: "save-source", authorizationId: auth.targetId, sellerAccountId: sellerId, marketplaceId: site, resource: "sales_traffic", enabled: true }); sourceId = src.targetId;
  worker = new Worker<Payload>(amazonSyncQueueName, async job => {
    if (job.name === "export-amazon-sales") { assert.ok(job.data.exportId); assert.ok(Number.isInteger(job.data.fence)); await processSalesExport(job.data.exportId, job.data.fence!); }
    else { assert.ok(Number.isInteger(job.data.dispatchVersion)); await processSyncCenterTask(job.data.runId, job.data.dispatchVersion!); }
  }, { connection: createRedisConnectionOptions(), concurrency: 1 });
  await worker.waitUntilReady();
});
after(async () => { await worker?.close(); await getAmazonSyncQueue().close(); await prisma.$disconnect(); globalThis.fetch = originalFetch; });

test("approval to real BullMQ report worker to filtered API and stored export retains version and ownership", { timeout: 30000 }, async () => {
  const task = await requestedTask();
  assert.equal((await finishReport(task.id)).status, "SUCCEEDED"); assert.equal(reportRequests.length, 1);
  assert.equal(await prisma.amazonSalesTrafficSnapshot.count({ where: { ...scope, syncRunId: task.id } }), 1);
  const params = new URLSearchParams({ section: "sales-traffic", from: range.from, to: range.to, sellerAccountId: sellerId, marketplaceId: site, direction: "asc" });
  const response = await GET(request(`/api/operations/sync-center?${params}`)); assert.equal(response.status, 200);
  const page = await response.json(); assert.equal(page.rows.length, 1); assert.equal(page.rows[0].syncRunId, task.id); assert.equal(page.rows[0].amazonSellerId, "fixture-seller");
  const filters = Object.fromEntries([...params].filter(([key]) => key !== "section"));
  const body = { filters, asOf: page.asOf, idempotencyKey: "export-once" };
  const created = await postExport(request("/api/operations/sync-center/exports", actor, body)); assert.equal(created.status, 202);
  const job = await created.json();
  const repeated = await postExport(request("/api/operations/sync-center/exports", actor, body)); assert.equal(repeated.status, 202); assert.equal((await repeated.json()).id, job.id);
  await consume(job.id, true);
  const stored = await prisma.amazonDataExport.findUniqueOrThrow({ where: { id: job.id }, include: { file: true } });
  assert.equal(stored.status, "SUCCEEDED"); assert.equal(stored.rowCount, 1); assert.ok(stored.file);
  const download = await getExport(request(`/api/operations/sync-center/exports?id=${job.id}&download=1`)); assert.equal(download.status, 200);
  const lines = (await download.text()).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(lines[0].asOf, page.asOf); assert.equal(lines[0].filters.from, range.from);
  assert.deepEqual(lines.slice(1).map(line => { assert.equal(line.type, "data"); const row = { ...line }; delete row.type; return row; }), page.rows);
  assert.equal(await prisma.productRecord.count({ where: scope }), 0, "sync and export cannot create ERP products");
  assert.equal((await getExport(request(`/api/operations/sync-center/exports?id=${job.id}&download=1`, approver))).status, 404, "same tenant nonrequester cannot download");
  assert.equal((await getExport(request(`/api/operations/sync-center/exports?id=${job.id}&download=1`, foreignActor))).status, 404);
  assert.equal((await GET(request(`/api/operations/sync-center?${params}`, actor, undefined, "missing-workspace"))).status, 403);
  const actions = (await prisma.auditLog.findMany({ where: { entityId: job.id } })).map(row => row.action);
  for (const action of ["requested", "succeeded", "downloaded"]) assert.ok(actions.includes(`amazon.data.export.${action}`));

  partial = true;
  const incomplete = await requestedTask(); assert.equal((await finishReport(incomplete.id)).status, "PARTIAL_SUCCESS");
  assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sourceId } })).activeRunId, task.id);
  const afterPartial = await GET(request(`/api/operations/sync-center?${params}`)); assert.equal((await afterPartial.json()).rows[0].syncRunId, task.id);
  await processSyncCenterTask(task.id, task.dispatchVersion); assert.equal(reportRequests.length, 2, "stale queue replay cannot create another report");

  partial = false;
  const retry = await configure({ action: "control-task", id: incomplete.id, control: "retry" });
  assert.equal((await finishReport(incomplete.id)).status, "SUCCEEDED");
  const retried = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: incomplete.id } });
  assert.equal(retried.executionApprovalId, retry.id); const { executionExpiresAt: renewedDeadline, ...renewedScope } = retried.frozenScope as Record<string, unknown>;
  const { executionExpiresAt: priorDeadline, ...priorScope } = incomplete.frozenScope as Record<string, unknown>;
  assert.deepEqual(renewedScope, priorScope); assert.ok(String(renewedDeadline) >= String(priorDeadline));
  assert.equal(await prisma.amazonSalesTrafficSnapshot.count({ where: { ...scope, syncRunId: incomplete.id } }), 1);
  const frozenDownload = await getExport(request(`/api/operations/sync-center/exports?id=${job.id}&download=1`)); assert.equal(frozenDownload.status, 200);
  assert.deepEqual((await frozenDownload.text()).trim().split("\n").map(line => JSON.parse(line)), lines, "new publication cannot change an already frozen export");

  const pendingExport = await postExport(request("/api/operations/sync-center/exports", actor, { ...body, idempotencyKey: "revoked-before-worker" }));
  assert.equal(pendingExport.status, 202); const pendingId = (await pendingExport.json()).id;

  await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor } }, data: { role: "viewer" } });
  await consume(pendingId, true);
  const rejectedExport = await prisma.amazonDataExport.findUniqueOrThrow({ where: { id: pendingId } });
  assert.equal(rejectedExport.status, "FAILED"); assert.equal(rejectedExport.fileId, null);
  assert.equal((await getExport(request(`/api/operations/sync-center/exports?id=${job.id}&download=1`))).status, 403);
  assert.equal((await postExport(request("/api/operations/sync-center/exports", actor, { ...body, idempotencyKey: "denied" }))).status, 403);
  const beforeBlocked = apiCalls;
  await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor } }, data: { role: "owner" } });
  const blocked = await requestedTask();
  await decideChange(scope, approver, blocked.executionApprovalId!, "REVOKED", "fixture revocation");
  await processSyncCenterTask(blocked.id, blocked.dispatchVersion);
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: blocked.id } })).status, "BLOCKED"); assert.equal(apiCalls, beforeBlocked);
  const fileContent = await getStorageDriver().getBuffer(stored.file.storageKey); assert.ok(fileContent.length > 0);
});
