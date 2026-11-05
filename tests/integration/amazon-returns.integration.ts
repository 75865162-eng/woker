import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { prisma } from "@/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "@/lib/amazon-sync/change-approval";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { encryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { endpoints } from "@/lib/amazon-sync/policy";
import { decryptCheckpoint } from "@/lib/amazon-sync/checkpoint";
import { parseReturnState } from "@/lib/amazon-sync/returns";
import { digest, unseal } from "@/lib/amazon-sync/approval-policy";
import { readReturns } from "@/lib/amazon-sync/returns-query";
if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1" || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw new Error("Disposable offline database required");
const raw = (name: string) => readFileSync(new URL(`../fixtures/amazon/returns/${name}`, import.meta.url), "utf8");
const policy = JSON.parse(raw("policy.json")), site = "fixture-marketplace", region = "returns-fixture-region";
const scopes: Array<[string, string]> = [];
before(() => { process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 61).toString("base64"); endpoints[region] = "https://returns.fixture.invalid"; });
after(async () => { delete endpoints[region]; await prisma.$disconnect(); });
async function fresh() {
  const scope = { organizationId: `returns-fixture-${randomUUID()}`, workspaceId: "returns-test" };
  scopes.push([scope.organizationId, scope.workspaceId]); process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify(scopes);
  const actor = randomUUID(), approver = randomUUID(), store = randomUUID(), authId = randomUUID();
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Returns fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Returns fixture" } });
  for (const id of [actor, approver]) await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: "Fixture", passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: store, accountKey: store, displayName: "Returns fixture", marketplaceCode: "FX" } });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authId, name: "Returns fixture", amazonSellerId: "fixture-seller", awsRegion: region, endpoint: endpoints[region], status: "CONFIGURED", approvedRoles: ["Amazon Fulfillment"], rolesAttestedAt: new Date(), marketplaceParticipations: [{ marketplaceId: site, countryCode: "FX" }], updatedByUserId: actor, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId: authId }) } });
  async function approved(command: Record<string, unknown>) {
    const request = await requestChange(scope, actor, command), id = String(request.id);
    await decideChange(scope, approver, id, "APPROVED", "offline fixture"); await applyChange(scope, actor, id);
    return prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id } });
  }
  const change = await approved({ action: "save-source", authorizationId: authId, sellerAccountId: store, marketplaceId: site, resource: "returns", freshnessMinutes: 60, enabled: true, returnsPolicy: { ...policy, applicationId: `fixture-${authId}` } });
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: change.targetId } });
  const calls: URL[] = []; let fault = 0, faultStage = "poll", documentStatus = "DONE", mismatch = false, empty = false, changed = false;
  let reportId = "fixture-report", documentId = "fixture-document";
  const fetcher = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push(url);
    assert.ok(["lwa.fixture.invalid", "returns.fixture.invalid", "download.fixture.invalid"].includes(url.hostname));
    if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    const stage = url.hostname === "download.fixture.invalid" ? "download" : init?.method === "POST" ? "create" : url.pathname.includes("/documents/") ? "document" : "poll";
    if (fault && stage === faultStage) return new Response('{"message":"fixture-secret fixture-access fixture-private-comment"}', { status: fault, headers: { "x-amzn-RequestId": "fixture-error-request", "retry-after": "1" } });
    if (stage === "create") { const b = JSON.parse(String(init?.body)); assert.deepEqual(b.marketplaceIds, [site]); assert.equal(b.reportType, policy.reportType); return Response.json({ reportId }, { headers: { "x-amzn-RequestId": "fixture-create-id" } }); }
    if (stage === "poll") return Response.json({ reportId, reportType: policy.reportType, marketplaceIds: [mismatch ? "fixture-other-site" : site], dataStartTime: "2026-11-01T00:00:00Z", dataEndTime: "2026-11-02T00:00:00Z", processingStatus: documentStatus, reportDocumentId: documentId });
    if (stage === "document") return Response.json({ reportDocumentId: documentId, url: "https://download.fixture.invalid/document?fixture-signed-value", compressionAlgorithm: "GZIP" });
    assert.equal(init?.headers, undefined); assert.equal(init?.redirect, "error");
    return new Response(gzipSync(empty ? raw("empty.tsv") : changed ? raw("report.tsv").replace('2026-11-01T03:00:00+02:00', 'ambiguous-time') : raw("report.tsv")));
  };
  async function request() { const grant = await approved({ action: "run", sourceIds: [source.id] }); return prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionApprovalId: grant.id } }); }
  async function slice(id: string, transport = fetcher) {
    // Advance only disposable fixture scheduling/budget fields, never sleep.
    await prisma.amazonSyncRun.update({ where: { id }, data: { nextAttemptAt: new Date(0) } });
    await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId: authId }, data: { nextRequestAt: new Date(0) } });
    await prisma.amazonSyncTokenBucket.updateMany({ where: { bucketKey: { in: ["createReport", "getReport", "getReportDocument"].map(op => digest([`${op}.2021-06-30`, "fixture-seller", `fixture-${authId}`])) } }, data: { blockedUntil: null } });
    const run = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
    await processSyncCenterTask(id, run.dispatchVersion, { clientOptions: { fetch: transport, tokenEndpoint: "https://lwa.fixture.invalid/token", reportDownloadTestHost: "download.fixture.invalid" } });
    return prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
  }
  async function finish(id: string) { let r = await slice(id); for (let i = 0; i < 12 && r.status === "WAITING"; i++) r = await slice(id); return r; }
  async function state() { const c = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: source.id } }); return { cursor: c, state: parseReturnState(decryptCheckpoint(c.reportStateCiphertext, scope, c.id)) }; }
  return { scope, actor, approver, store, authId, source, calls, approved, request, slice, finish, state, setFault: (v: number, stage = "poll") => { fault = v; faultStage = stage; }, setPending: (v: string) => { documentStatus = v; }, setMismatch: () => { mismatch = true; }, setEmpty: () => { empty = true; }, setInvalid: () => { changed = true; }, newReport: () => { reportId = "fixture-report-2"; documentId = "fixture-document-2"; } };
}
test("Reports lifecycle publishes a single report with UTC, reason dimension, encrypted TSV and idempotent batches", async () => {
  const f = await fresh(), run = await f.request();
  await f.slice(run.id); await f.slice(run.id); await f.slice(run.id); // create, manifest, download/archive
  assert.equal((await readReturns(f.scope, new URLSearchParams(), f.actor)).pagination.total, 0);
  assert.equal((await f.finish(run.id)).status, "SUCCEEDED");
  const records = await prisma.amazonReturnRecord.findMany({ where: f.scope, orderBy: { amazonOrderId: "asc" }, include: { reason: true } });
  assert.equal(records.length, 2); assert.equal(records[0].quantity, 2); assert.equal(records[0].returnAt.toISOString(), "2026-11-01T01:00:00.000Z");
  assert.equal(records[1].reason?.code, "FUTURE_REASON"); assert.equal(records[1].rawStatus, null);
  const task = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } }); assert.equal(task.skippedCount, 1);
  const view = await readReturns(f.scope, new URLSearchParams(), f.actor); assert.equal(view.pagination.total, 2); assert.equal(view.rows[0].orderMatched, false);
  const archive = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: run.id, resource: "returns" } });
  assert.equal((unseal(archive.rawCiphertext, f.scope, `${run.id}:1`, "amazon-returns-raw.v1") as { rawText: string }).rawText.replace(/^\ufeff/, ''), raw("report.tsv").replace(/^\ufeff/, ''));
  const plain = JSON.stringify(view) + JSON.stringify(records) + JSON.stringify(await prisma.amazonSyncTaskLog.findMany({ where: { taskId: run.id } }));
  for (const value of ["fixture-secret", "fixture-access", "fixture-private-comment", "fixture private product", "fixture-signed-value"]) assert.ok(!plain.includes(value));
  assert.equal(f.calls.filter(u => u.hostname === "lwa.fixture.invalid").length, 1);
  const orderPolicy = JSON.parse(readFileSync(new URL("../fixtures/amazon/orders/policy.json", import.meta.url), "utf8"));
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { approvedRoles: ["Amazon Fulfillment", ...orderPolicy.requiredRoles] } });
  const orderSource = await f.approved({ action: "save-source", authorizationId: f.authId, sellerAccountId: f.store, marketplaceId: site, resource: "orders", freshnessMinutes: 60, enabled: true, orderPolicy });
  const execution = await f.approved({ action: "run", sourceIds: [orderSource.targetId] });
  const orderRun = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...f.scope, executionApprovalId: execution.id } });
  const externalOrder = records[0].amazonOrderId;
  await prisma.amazonOrderRecord.create({ data: { ...f.scope, id: randomUUID(), sourceId: orderSource.targetId, sourceRunId: orderRun.id, sellerAccountId: f.store, amazonSellerId: "fixture-seller", marketplaceId: site, amazonOrderId: externalOrder, createdTime: new Date("2026-11-01T00:00:00Z"), sourceUpdatedAt: new Date("2026-11-01T00:00:00Z"), marketplaceTimeZone: "UTC", capturedAt: new Date() } });
  const matched = await readReturns(f.scope, new URLSearchParams({ orderId: externalOrder, asin: records[0].asin }), f.actor);
  assert.equal(matched.pagination.total, 1); assert.equal(matched.rows[0].orderMatched, true);
});
test("404 polling is pending and resumes existing report; batch interruption/new run retains raw and offset", async () => {
  const f = await fresh(), first = await f.request(); await f.slice(first.id); f.setFault(404);
  assert.equal((await f.slice(first.id)).status, "WAITING"); assert.equal((await f.state()).state.polls, 1);
  f.setFault(0); await f.slice(first.id); await f.slice(first.id); await f.slice(first.id);
  assert.equal((await f.state()).state.offset, 1);
  await f.approved({ action: "control-task", id: first.id, control: "cancel" }); await f.slice(first.id);
  const next = await f.request(); f.calls.length = 0;
  assert.equal((await f.finish(next.id)).status, "SUCCEEDED"); assert.equal(f.calls.length, 0);
  assert.equal(await prisma.amazonReturnRecord.count({ where: f.scope }), 2);
  assert.equal((await readReturns(f.scope, new URLSearchParams(), f.actor)).pagination.total, 2);
});
test("same report raw replay is idempotent; different reports never accumulate in default query", async () => {
  const f = await fresh(), run = await f.request(); await f.finish(run.id);
  const saved = await f.state(); saved.state.offset = 0;
  const { encryptCheckpoint } = await import("@/lib/amazon-sync/checkpoint");
  await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { status: "FAILED", reportStateCiphertext: encryptCheckpoint(JSON.stringify(saved.state), f.scope, saved.cursor.id) } });
  const replay = await f.request(); await f.finish(replay.id); assert.equal(await prisma.amazonReturnRecord.count({ where: f.scope }), 2);
  await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { status: "FAILED", reportStateCiphertext: null } }); f.newReport();
  const next = await f.request(); await f.finish(next.id);
  assert.equal(await prisma.amazonReturnRecord.count({ where: f.scope }), 4);
  const view = await readReturns(f.scope, new URLSearchParams(), f.actor); assert.equal(view.pagination.total, 2); assert.equal(view.reportId, "fixture-report-2");
});
for (const status of [400, 403, 429, 500]) test(`return poll ${status} follows bounded retry contract`, async () => {
  const f = await fresh(), run = await f.request(); await f.slice(run.id); f.setFault(status);
  const r = await f.slice(run.id); assert.equal(r.status, [429, 500].includes(status) ? "RETRY_WAIT" : "FAILED");
  assert.equal(r.throttles, status === 429 ? 1 : 0); assert.ok(!r.error?.includes("fixture-secret"));
  if (status === 429) assert.ok((await prisma.amazonSyncTokenBucket.findFirstOrThrow({ where: { bucketKey: digest(["getReport.2021-06-30", "fixture-seller", `fixture-${f.authId}`]), blockedUntil: { not: null } } })).blockedUntil! > new Date());
  if (status === 500) { await f.slice(run.id); assert.equal((await f.slice(run.id)).status, "FAILED"); }
});
test("404/pending retries stop at configured polling limit", async () => {
  const f = await fresh(), run = await f.request(); await f.slice(run.id); f.setFault(404);
  let result = await f.slice(run.id); for (let i = 0; i < 9 && result.status === "WAITING"; i++) result = await f.slice(run.id);
  assert.equal(result.status, "FAILED"); assert.equal(f.calls.filter(u => u.pathname.endsWith('/reports')).length, 1);
});
test("uncertain create never automatically recreates report", async () => {
  const f = await fresh(), run = await f.request(); f.setFault(500, "create");
  assert.equal((await f.slice(run.id)).status, "FAILED"); assert.equal((await f.state()).state.creating, true);
  f.setFault(0); const retry = await f.request(); f.calls.length = 0;
  assert.equal((await f.slice(retry.id)).status, "FAILED"); assert.equal(f.calls.length, 0);
});
for (const status of [403, 404]) test(`signed download ${status} expiry refreshes metadata without re-create or disabling LWA authorization`, async () => {
  const f = await fresh(), run = await f.request(); await f.slice(run.id); await f.slice(run.id); f.setFault(status, "download");
  assert.equal((await f.slice(run.id)).status, "WAITING"); assert.equal((await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: f.authId } })).status, "CONFIGURED");
  f.setFault(0); assert.equal((await f.finish(run.id)).status, "SUCCEEDED"); assert.equal(f.calls.filter(u => u.pathname.endsWith('/reports')).length, 1);
});
for (const field of ["seller", "marketplace", "region", "roles"]) test(`return ${field} mismatch sends no HTTP`, async () => {
  const f = await fresh(), run = await f.request();
  const data = field === "seller" ? { amazonSellerId: "wrong-fixture" } : field === "marketplace" ? { marketplaceParticipations: [] } : field === "region" ? { awsRegion: "wrong-fixture-region" } : { approvedRoles: [] };
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data });
  assert.equal((await f.slice(run.id)).status, "BLOCKED"); assert.equal(f.calls.length, 0);
});
test("wrong report manifest and invalid TSV never publish", async () => {
  for (const fault of ["manifest", "tsv"]) {
    const f = await fresh(), run = await f.request(); if (fault === "manifest") f.setMismatch(); else f.setInvalid();
    assert.equal((await f.finish(run.id)).status, "FAILED"); assert.equal(await prisma.amazonReturnRecord.count({ where: f.scope }), 0);
  }
});
test("empty report is complete zero evidence, not a missing-date failure", async () => {
  const f = await fresh(), run = await f.request(); f.setEmpty(); assert.equal((await f.finish(run.id)).status, "SUCCEEDED");
  const view = await readReturns(f.scope, new URLSearchParams(), f.actor); assert.equal(view.pagination.total, 0); assert.equal(view.reportId, "fixture-report");
});
test("batch write rollback preserves cursor and source disable cancels pending returns", async () => {
  const f = await fresh(), run = await f.request(); await f.slice(run.id); await f.slice(run.id); await f.slice(run.id);
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION fixture_reject_return() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_reject_return BEFORE INSERT ON "AmazonReturnRecord" FOR EACH ROW EXECUTE FUNCTION fixture_reject_return()`);
  try { assert.equal((await f.slice(run.id)).status, "FAILED"); assert.equal((await f.state()).state.offset, 0); assert.equal(await prisma.amazonReturnRecord.count({ where: f.scope }), 0); }
  finally { await prisma.$executeRawUnsafe('DROP TRIGGER fixture_reject_return ON "AmazonReturnRecord"'); await prisma.$executeRawUnsafe('DROP FUNCTION fixture_reject_return()'); }
  await f.approved({ action: "control-task", id: run.id, control: "retry" });
  await f.approved({ action: "save-source", authorizationId: f.authId, sellerAccountId: f.store, marketplaceId: site, resource: "returns", enabled: false });
  assert.equal((await f.slice(run.id)).status, "CANCELLED"); assert.ok((await f.state()).state.archiveTaskId);
});

test("pending report states do not recreate and can complete later", async () => {
  const f = await fresh(), run = await f.request(); await f.slice(run.id);
  for (const value of ["IN_QUEUE", "IN_PROGRESS"]) { f.setPending(value); assert.equal((await f.slice(run.id)).status, "WAITING"); }
  f.setPending("DONE"); assert.equal((await f.finish(run.id)).status, "SUCCEEDED");
  assert.equal(f.calls.filter(u => u.pathname.endsWith('/reports')).length, 1);
});
test("returns reads enforce live membership and exact seller/site grants", async () => {
  const f = await fresh(), run = await f.request(); await f.finish(run.id);
  const other = await fresh();
  await assert.rejects(readReturns(other.scope, new URLSearchParams({ sourceId: f.source.id }), other.actor), /不可访问/);
  await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: f.scope.organizationId, userId: f.actor } }, data: { role: "operations" } });
  await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: f.scope.organizationId, id: "operations" } }, data: { permissions: { operations: ["view"] } } });
  const grant = await prisma.amazonDataAccessGrant.create({ data: { ...f.scope, id: randomUUID(), userId: f.actor, sellerAccountId: f.store, marketplaceIds: ["fixture-other-site"], actions: ["view"] } });
  assert.equal((await readReturns(f.scope, new URLSearchParams(), f.actor)).sources.length, 0);
  await assert.rejects(readReturns(f.scope, new URLSearchParams({ sourceId: f.source.id }), f.actor), /不可访问/);
  await prisma.amazonDataAccessGrant.update({ where: { id: grant.id }, data: { marketplaceIds: [site] } });
  assert.equal((await readReturns(f.scope, new URLSearchParams(), f.actor)).pagination.total, 2);
  await prisma.amazonDataAccessGrant.update({ where: { id: grant.id }, data: { enabled: false } });
  await assert.rejects(readReturns(f.scope, new URLSearchParams(), f.actor), /授权/);
});
test("role revoked during download prevents raw archive and facts from committing", async () => {
  const f = await fresh(), run = await f.request(); await f.slice(run.id); await f.slice(run.id);
  const result = await f.slice(run.id, async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    if (url.hostname === "returns.fixture.invalid") return Response.json({ reportDocumentId: "fixture-document", url: "https://download.fixture.invalid/document" });
    assert.equal(url.hostname, "download.fixture.invalid");
    await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { approvedRoles: [] } });
    return new Response(raw("report.tsv"));
  });
  assert.equal(result.status, "FAILED");
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id } }), 0);
  assert.equal(await prisma.amazonReturnRecord.count({ where: f.scope }), 0);
});
