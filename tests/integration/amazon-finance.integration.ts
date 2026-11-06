import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "@/lib/amazon-sync/change-approval";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { encryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { endpoints } from "@/lib/amazon-sync/policy";
import { decryptCheckpoint } from "@/lib/amazon-sync/checkpoint";
import { digest, unseal } from "@/lib/amazon-sync/approval-policy";
import { readFinance } from "@/lib/amazon-sync/finance-query";
import { previewFinanceReplay } from "@/lib/amazon-sync/finance-recovery";
import { automaticMarketplaces, automaticPlanKey } from "@/lib/amazon-sync/automatic-schedule";
import { listSources, readTasks } from "@/lib/amazon-sync/read";
if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1" || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw new Error("Disposable offline database required");
const raw = (name: string) => readFileSync(new URL(`../fixtures/amazon/finance/${name}.json`, import.meta.url), "utf8");
const policy = JSON.parse(raw("policy")), site = "fixture-site-a", region = "finance-fixture-region";
const scopes: Array<[string, string]> = [];
before(() => { process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 51).toString("base64"); endpoints[region] = "https://finance.fixture.invalid"; });
after(async () => { delete endpoints[region]; await prisma.$disconnect(); });
async function fresh() {
  const scope = { organizationId: `finance-fixture-${randomUUID()}`, workspaceId: "finance-test" };
  scopes.push([scope.organizationId, scope.workspaceId]); process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify(scopes);
  const actor = randomUUID(), approver = randomUUID(), store = randomUUID(), authId = randomUUID();
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Finance fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Finance fixture" } });
  for (const id of [actor, approver]) await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: "Fixture", passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: store, accountKey: store, displayName: "Finance fixture", marketplaceCode: "FX" } });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authId, name: "Finance fixture", amazonSellerId: "fixture-seller", awsRegion: region, endpoint: endpoints[region], status: "CONFIGURED", approvedRoles: ["Finance and Accounting"], rolesAttestedAt: new Date(), marketplaceParticipations: policy.marketplaces.map((m: { marketplaceId: string }) => ({ marketplaceId: m.marketplaceId, countryCode: "FX" })), updatedByUserId: actor, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId: authId }) } });
  async function approved(command: Record<string, unknown>) {
    const request = await requestChange(scope, actor, command), id = String(request.id);
    await decideChange(scope, approver, id, "APPROVED", "offline fixture"); await applyChange(scope, actor, id);
    return prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id } });
  }
  for (const m of policy.marketplaces) await approved({ action: "save-source", authorizationId: authId, sellerAccountId: store, marketplaceId: m.marketplaceId, resource: "catalog", freshnessMinutes: 60, enabled: true });
  const financePolicy = { ...policy, applicationId: `fixture-${authId}` };
  const change = await approved({ action: "save-source", authorizationId: authId, sellerAccountId: store, marketplaceId: site, resource: "finance", freshnessMinutes: 60, enabled: true, financePolicy });
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: change.targetId } });
  const calls: URL[] = []; let fault = 0, faultPage: string | null = "fixture-page-2", override: string | null = null;
  const transport = async (input: string | URL) => {
    const url = new URL(String(input)); calls.push(url);
    assert.ok(["lwa.fixture.invalid", "finance.fixture.invalid"].includes(url.hostname));
    if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    assert.equal(url.pathname, "/finances/2024-06-19/transactions");
    assert.equal(url.searchParams.has("marketplaceId"), false);
    assert.equal(url.searchParams.get("postedAfter"), "2026-11-01T00:00:00.000Z");
    assert.equal(url.searchParams.get("postedBefore"), "2026-11-02T00:00:00.000Z");
    if (fault && url.searchParams.get("nextToken") === faultPage) return new Response('{"message":"fixture-secret fixture-access fixture-private-description"}', { status: fault, headers: { "retry-after": "1", "x-amzn-RequestId": "fixture-error-id" } });
    return new Response(override ?? raw(url.searchParams.has("nextToken") ? "page-2" : "page-1"), { headers: { "x-amzn-RequestId": "fixture-request-id", "x-amzn-RateLimit-Limit": "0.5" } });
  };
  async function request() { const grant = await approved({ action: "run", sourceIds: [source.id] }); return prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionApprovalId: grant.id } }); }
  async function slice(id: string, fetcher = transport) { const run = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } }); await processSyncCenterTask(id, run.dispatchVersion, { clientOptions: { fetch: fetcher, tokenEndpoint: "https://lwa.fixture.invalid/token" } }); return prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } }); }
  return { scope, actor, approver, store, authId, source, financePolicy, calls, approved, request, slice, setFault: (status: number, page: string | null = "fixture-page-2") => { fault = status; faultPage = page; }, setBody: (body: string | null) => { override = body; } };
}

test("confirmed rejected pagination can replay the same window through approval without deleting evidence", async t => {
  for (const { marketplaceId } of policy.marketplaces) automaticMarketplaces.add(marketplaceId);
  t.after(() => { for (const { marketplaceId } of policy.marketplaces) automaticMarketplaces.delete(marketplaceId); });
  const f = await fresh(), first = await f.request();
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { identityVerifiedAt: new Date() } });
  await f.slice(first.id);
  const rejected = await f.slice(first.id, async input => new URL(String(input)).hostname === "lwa.fixture.invalid" ? Response.json({ access_token: "fixture-access", expires_in: 3600 }) : Response.json({ errors: [{ code: "InvalidInput", message: "NextToken expired" }] }, { status: 400 }));
  assert.equal(rejected.status, "FAILED");
  const original = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const preview = await prisma.$transaction(tx => previewFinanceReplay(tx, f.scope, f.source.id));
  await f.approved({ action: "recover-finance-window", id: f.source.id, revision: preview.source.revision, recoveryDigest: preview.recoveryDigest, sameWindowReplay: true });
  const reset = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(reset.nextTokenCiphertext, null);
  assert.equal(reset.watermarkFrom.getTime(), original.watermarkFrom.getTime());
  assert.equal(reset.watermarkTo.getTime(), original.watermarkTo.getTime());
  assert.equal(reset.captureSequence, original.captureSequence);
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: first.id } })).checkpointCiphertext, rejected.checkpointCiphertext);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: first.id } }), 1);
  const replay = await f.request();
  const page = await f.slice(replay.id); assert.equal(page.status, "WAITING", page.error ?? ""); assert.equal(page.skippedCount, 1);
  const done = await f.slice(replay.id); assert.equal(done.status, "SUCCEEDED", done.error ?? "");
  assert.equal(await prisma.amazonFinanceRecord.count({ where: f.scope }), 3);
  assert.equal(await prisma.amazonSyncPage.count({ where: f.scope }), 3);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: f.scope.organizationId, action: "amazon.sync.finance.same_window_replay" } }), 1);
});

test("generic finance 400 never authorizes resetting a committed cursor", async () => {
  const f = await fresh(), task = await f.request();
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { identityVerifiedAt: new Date() } });
  await f.slice(task.id); f.setFault(400); await f.slice(task.id);
  await assert.rejects(prisma.$transaction(tx => previewFinanceReplay(tx, f.scope, f.source.id)), /未确认分页/);
});

test("automatic finance retry uses the intact original plan without inventing role attestation", async t => {
  for (const { marketplaceId } of policy.marketplaces) automaticMarketplaces.add(marketplaceId);
  t.after(() => { for (const { marketplaceId } of policy.marketplaces) automaticMarketplaces.delete(marketplaceId); });
  const f = await fresh(), task = await f.request();
  await f.slice(task.id); f.setFault(400); await f.slice(task.id);
  const plan = await prisma.amazonSyncSchedule.create({ data: { ...f.scope, id: randomUUID(), resource: "finance", executionVersion: 2, planKey: automaticPlanKey(f.source.id), mode: "incremental", enabled: true, updatedByUserId: f.actor } });
  await prisma.amazonSyncPlanTarget.create({ data: { ...f.scope, scheduleId: plan.id, sourceId: f.source.id } });
  const frozen = { ...(task.frozenScope as Record<string, unknown>), scheduleId: plan.id, scheduleRevision: plan.revision };
  await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, frozenScope: frozen, frozenScopeDigest: digest(frozen) } });
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { approvedRoles: [], rolesAttestedAt: null } });
  const before = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
  await f.approved({ action: "control-task", id: task.id, control: "retry" });
  const after = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(after.trigger, "schedule"); assert.equal(after.scheduleRevision, plan.revision);
  assert.equal(after.checkpointCiphertext, before.checkpointCiphertext); assert.equal(after.pagesCompleted, before.pagesCompleted);
  assert.deepEqual((await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: f.authId } })).approvedRoles, []);
  f.setFault(0); assert.equal((await f.slice(task.id)).status, "SUCCEEDED");
});

test("stale scheduled finance scope cannot enter automatic retry role handling", async t => {
  for (const { marketplaceId } of policy.marketplaces) automaticMarketplaces.add(marketplaceId);
  t.after(() => { for (const { marketplaceId } of policy.marketplaces) automaticMarketplaces.delete(marketplaceId); });
  const f = await fresh(), task = await f.request(); await f.slice(task.id); f.setFault(400); await f.slice(task.id);
  const plan = await prisma.amazonSyncSchedule.create({ data: { ...f.scope, id: randomUUID(), resource: "finance", executionVersion: 2, planKey: automaticPlanKey(f.source.id), mode: "incremental", enabled: true, updatedByUserId: f.actor } });
  await prisma.amazonSyncPlanTarget.create({ data: { ...f.scope, scheduleId: plan.id, sourceId: f.source.id } });
  const frozen = { ...(task.frozenScope as Record<string, unknown>), scheduleId: plan.id, scheduleRevision: plan.revision };
  await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, frozenScope: frozen, frozenScopeDigest: digest(frozen) } });
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { approvedRoles: [], rolesAttestedAt: null } });
  await prisma.amazonSyncSchedule.update({ where: { id: plan.id }, data: { revision: { increment: 1 } } });
  await assert.rejects(f.approved({ action: "control-task", id: task.id, control: "retry" }), /Finance and Accounting/);
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status, "FAILED");
});

test("seller-wide approval, actual sites, exact money, quarantine and encrypted raw", async () => {
  const f = await fresh(), task = await f.request();
  assert.equal(task.mode, "incremental");
  assert.equal((await f.slice(task.id)).status, "WAITING");
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(decryptCheckpoint(cursor.nextTokenCiphertext, f.scope, cursor.id), "fixture-page-2");
  assert.equal((await f.slice(task.id)).status, "SUCCEEDED");
  const records = await prisma.amazonFinanceRecord.findMany({ where: f.scope, orderBy: { transactionId: "asc" } });
  assert.equal(records.length, 3); assert.equal(records[0].marketplaceId, "fixture-site-b");
  assert.equal(records[0].amount!.toFixed(30), "9007199254740993.123456789012345678901234567890");
  assert.equal(records[0].convertedAmount!.toFixed(2), "10133099161583617.26");
  assert.equal(records[0].postedAt.toISOString(), "2026-11-01T01:00:00.000Z");
  assert.equal(records[1].orderId, null); assert.equal(records[1].classification, "NON_ORDER");
  assert.equal(records[2].attributionStatus, "QUARANTINED"); assert.equal(records[2].amount, null); assert.equal(records[2].marketplaceId, null);
  const q = await prisma.amazonFinanceQuarantine.findUniqueOrThrow({ where: { recordId: records[2].id } });
  assert.equal((unseal(q.ciphertext, f.scope, q.recordId, "amazon-finance-quarantine.v1") as { amount: { original: string } }).amount.original, "3e-8");
  const archive = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: task.id }, orderBy: { page: "asc" } });
  assert.equal((unseal(archive.rawCiphertext, f.scope, `${task.id}:1`, "amazon-finance-raw.v1") as { rawBody: string }).rawBody, raw("page-1"));
  const view = await readFinance(f.scope, new URLSearchParams(), f.actor);
  assert.equal(view.pagination.total, 2); assert.equal(view.quarantinedCount, 1); assert.equal(view.unconvertedCount, 1); assert.equal(view.financialFinal, false);
  const plain = JSON.stringify(view) + JSON.stringify(await prisma.amazonSyncTaskLog.findMany({ where: { taskId: task.id } }));
  for (const value of ["fixture-secret", "fixture-access", "fixture-private-description", "fixture-page-2", "nextTokenCiphertext", "ciphertext"]) assert.ok(!plain.includes(value));
  assert.equal(f.calls.filter(u => u.hostname === "lwa.fixture.invalid").length, 1);
});

test("second-page 403 retains cursor; newly approved run resumes there and replays idempotently", async () => {
  const f = await fresh(), first = await f.request();
  await f.slice(first.id); f.setFault(403);
  const failed = await f.slice(first.id); assert.equal(failed.status, "FAILED"); assert.equal(failed.failedCount, 1);
  assert.equal((await f.slice(first.id)).status, "FAILED");
  // Fixture-only simulation of explicit authorization revalidation after 403.
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { status: "CONFIGURED" } });
  f.setFault(0); f.calls.length = 0;
  const next = await f.request(); assert.equal((await f.slice(next.id)).status, "SUCCEEDED");
  assert.equal(f.calls.filter(u => u.hostname === "finance.fixture.invalid")[0].searchParams.get("nextToken"), "fixture-page-2");
  assert.equal(await prisma.amazonFinanceRecord.count({ where: f.scope }), 3);
  // Controlled fixture-only replay of the same original window, including newer
  // observation sequence. Production has no raw-replay activation endpoint.
  await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { status: "FAILED", nextTokenCiphertext: null } });
  await prisma.amazonSyncPage.deleteMany({ where: f.scope });
  const replay = await f.request(); await f.slice(replay.id); const done = await f.slice(replay.id);
  assert.equal(done.status, "SUCCEEDED"); assert.equal(done.insertedCount, 0); assert.equal(done.skippedCount, 3);
  assert.equal(await prisma.amazonFinanceRecord.count({ where: f.scope }), 3);
});
for (const status of [400, 403, 404, 429, 500]) test(`finance ${status}: finite retries and safe logs`, async () => {
  const f = await fresh(), task = await f.request(); f.setFault(status, null);
  let result = await f.slice(task.id);
  assert.equal(result.status, [429, 500].includes(status) ? "RETRY_WAIT" : "FAILED");
  assert.equal(result.apiRequests, 2); assert.equal(result.throttles, status === 429 ? 1 : 0);
  assert.ok(!result.error?.includes("fixture-secret"));
  const log = await prisma.amazonSyncTaskLog.findFirstOrThrow({ where: { taskId: task.id, statusCode: status } });
  assert.equal(log.requestId, "fixture-error-id");
  if (status === 429) {
    const bucket = await prisma.amazonSyncTokenBucket.findUniqueOrThrow({ where: { bucketKey: digest(["listTransactions.2024-06-19", "fixture-seller", f.financePolicy.applicationId]) } });
    assert.ok(bucket.blockedUntil! > new Date());
  }
  if (status === 500) for (let i = 0; i < 3 && result.status === "RETRY_WAIT"; i++) {
    await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { nextAttemptAt: new Date(0) } });
    result = await f.slice(task.id);
  }
  if (status === 500) { assert.equal(result.status, "FAILED"); assert.equal(result.attempts, 3); }
  assert.equal(await prisma.amazonFinanceRecord.count({ where: f.scope }), 0);
});
for (const change of ["roles", "region", "sites", "actor", "approver", "binding"]) test(`finance ${change} mismatch blocks before any HTTP`, async () => {
  const f = await fresh(), task = await f.request();
  if (change === "roles") await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { approvedRoles: [] } });
  if (change === "region") await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { awsRegion: "other-fixture-region" } });
  if (change === "sites") await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { marketplaceParticipations: [{ marketplaceId: site }] } });
  if (change === "actor" || change === "approver") await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: f.scope.organizationId, userId: change === "actor" ? f.actor : f.approver } }, data: { role: "operations" } });
  if (change === "binding") await prisma.amazonSyncDataSource.updateMany({ where: { ...f.scope, marketplaceId: "fixture-site-b" }, data: { enabled: false } });
  assert.equal((await f.slice(task.id)).status, "BLOCKED"); assert.equal(f.calls.length, 0);
});
for (const mismatch of ["seller", "site"]) test(`response ${mismatch} overflow fails whole page`, async () => {
  const f = await fresh(), task = await f.request();
  f.setBody(raw("page-1").replace(mismatch === "seller" ? "fixture-seller" : "fixture-site-b", "fixture-outside"));
  assert.equal((await f.slice(task.id)).status, "FAILED");
  assert.equal(await prisma.amazonFinanceRecord.count({ where: f.scope }), 0);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: task.id } }), 0);
});
test("finance page rollback preserves facts, archive and checkpoint atomically", async () => {
  const f = await fresh(), task = await f.request();
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION fixture_reject_finance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource = 'finance' THEN RAISE EXCEPTION 'fixture rollback'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_reject_finance BEFORE INSERT ON "AmazonSyncRawPage" FOR EACH ROW EXECUTE FUNCTION fixture_reject_finance()`);
  try {
    assert.equal((await f.slice(task.id)).status, "FAILED");
    assert.equal(await prisma.amazonFinanceRecord.count({ where: f.scope }), 0);
    const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
    assert.equal(cursor.captureSequence, 0); assert.equal(cursor.nextTokenCiphertext, null);
  } finally { await prisma.$executeRawUnsafe('DROP TRIGGER fixture_reject_finance ON "AmazonSyncRawPage"'); await prisma.$executeRawUnsafe('DROP FUNCTION fixture_reject_finance()'); }
});
test("empty page with token continues; missing ID fails rather than fabricate key", async () => {
  const f = await fresh(), task = await f.request();
  f.setBody('{"payload":{"transactions":[],"nextToken":"fixture-page-2"}}');
  assert.equal((await f.slice(task.id)).status, "WAITING");
  f.setBody(raw("page-2").replace('"fixture-tx-2"', 'null'));
  assert.equal((await f.slice(task.id)).status, "FAILED"); assert.equal(await prisma.amazonFinanceRecord.count({ where: f.scope }), 0);
});
test("disabling finance binding fences its task and preserves cursor", async () => {
  const f = await fresh(), task = await f.request(); await f.slice(task.id);
  await f.approved({ action: "save-source", authorizationId: f.authId, sellerAccountId: f.store, marketplaceId: site, resource: "finance", enabled: false });
  assert.equal((await f.slice(task.id)).status, "CANCELLED");
  const cursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  assert.equal(decryptCheckpoint(cursor.nextTokenCiphertext, f.scope, cursor.id), "fixture-page-2");
});
test("non-admin site grants cannot read seller-wide facts, sources or tasks", async () => {
  const f = await fresh(), task = await f.request(); await f.slice(task.id);
  const user = randomUUID();
  await prisma.user.create({ data: { id: user, email: `${user}@fixture.invalid`, name: "Member", passwordHash: "not-login", memberships: { create: { organizationId: f.scope.organizationId, role: "operations" } } } });
  await prisma.amazonDataAccessGrant.create({ data: { ...f.scope, id: randomUUID(), userId: user, sellerAccountId: f.store, marketplaceIds: [site], actions: ["view", "sync"], enabled: true } });
  await assert.rejects(readFinance(f.scope, new URLSearchParams(), user));
  assert.ok(!(await listSources(f.scope, {}, user)).some(s => s.resource === "finance"));
  assert.ok(!(await readTasks(f.scope, new URLSearchParams(), user)).rows.some(s => s.resource === "finance"));
});
test("manual retry preserves committed pages; newer observations update deferred status", async () => {
  const f = await fresh(), task = await f.request(); await f.slice(task.id); f.setFault(400);
  assert.equal((await f.slice(task.id)).status, "FAILED");
  await f.approved({ action: "control-task", id: task.id, control: "retry" });
  f.setFault(0); f.calls.length = 0;
  const done = await f.slice(task.id); assert.equal(done.status, "SUCCEEDED"); assert.equal(done.pagesCompleted, 2);
  assert.equal(f.calls.find(u => u.hostname === "finance.fixture.invalid")!.searchParams.get("nextToken"), "fixture-page-2");
  // Replay confined to the disposable fixture database. No production replay API.
  await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { status: "FAILED", nextTokenCiphertext: null } });
  await prisma.amazonSyncPage.deleteMany({ where: f.scope });
  const next = await f.request();
  f.setBody(raw("page-1").replace('"Released"', '"FUTURE_UNKNOWN_STATUS"'));
  await f.slice(next.id); f.setBody(null); await f.slice(next.id);
  const row = await prisma.amazonFinanceRecord.findFirstOrThrow({ where: { ...f.scope, transactionId: "fixture-tx-1" } });
  assert.equal(row.rawStatus, "FUTURE_UNKNOWN_STATUS"); assert.equal(row.observationSequence, 3);
  assert.equal(await prisma.amazonFinanceRecord.count({ where: f.scope }), 3);
});
test("scope revocation during HTTP prevents any business commit", async () => {
  const f = await fresh(), task = await f.request();
  const result = await f.slice(task.id, async input => {
    const url = new URL(String(input));
    if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { approvedRoles: [] } });
    return new Response(raw("page-1"));
  });
  assert.equal(result.status, "FAILED");
  assert.equal(await prisma.amazonFinanceRecord.count({ where: f.scope }), 0);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: task.id } }), 0);
});
test("financial rate-limit header lowers persistent bucket and depleted bucket yields without HTTP", async () => {
  const f = await fresh(), task = await f.request();
  await f.slice(task.id, async input => {
    const url = new URL(String(input));
    if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    return new Response(raw("page-1"), { headers: { "x-amzn-RateLimit-Limit": "0.01" } });
  });
  const bucketKey = digest(["listTransactions.2024-06-19", "fixture-seller", f.financePolicy.applicationId]);
  assert.equal((await prisma.amazonSyncTokenBucket.findUniqueOrThrow({ where: { bucketKey } })).observedLimit, .01);
  await prisma.amazonSyncTokenBucket.update({ where: { bucketKey }, data: { tokens: 0, replenishedAt: new Date() } });
  f.calls.length = 0; const waiting = await f.slice(task.id);
  assert.equal(waiting.status, "WAITING"); assert.ok(waiting.nextAttemptAt > new Date()); assert.equal(f.calls.length, 0);
});
