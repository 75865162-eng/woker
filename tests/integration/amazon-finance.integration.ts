// Cloud role for injected offline task fixtures; no real Amazon calls.
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
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
import { recoverFinanceParserFailures } from "@/lib/amazon-sync/finance-parser-recovery";
import { financeParser } from "@/lib/amazon-sync/finance-parser";
import { archiveResponse } from "@/lib/amazon-sync/response-evidence";
import { recordReportParseEvidence } from "@/lib/amazon-sync/report-parse-evidence";
import { automaticMarketplaces, automaticPlanKey } from "@/lib/amazon-sync/automatic-schedule";
import { listSources, readTasks } from "@/lib/amazon-sync/read";
import { createTask, scopeLock } from "@/lib/amazon-sync/service";
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
  await prisma.amazonDataAccessGrant.createMany({ data: [actor, approver].map(userId => ({ ...scope, id: randomUUID(), userId, sellerAccountId: store })) });
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

async function financeHistoryReplayTask(f: Awaited<ReturnType<typeof fresh>>, window: { from: string; to: string }) {
  const schedule = await prisma.amazonSyncSchedule.create({ data: { ...f.scope, id: randomUUID(), resource: "finance", executionVersion: 2,
    planKey: automaticPlanKey(f.source.id), name: "Finance history replay fixture", revision: 1, mode: "incremental", intervalMinutes: 60,
    enabled: true, updatedByUserId: f.actor, nextRunAt: new Date() } });
  await prisma.amazonSyncPlanTarget.create({ data: { ...f.scope, scheduleId: schedule.id, sourceId: f.source.id } });
  return prisma.$transaction(async tx => {
    await scopeLock(tx, f.scope);
    return createTask(tx, f.scope, f.actor, f.source.id, { key: `finance-history:${randomUUID()}`, trigger: "schedule", scheduleId: schedule.id,
      scheduleRevision: schedule.revision, financeWindow: window, financeHistoryReplay: true });
  });
}

test("Finance history replay inserts gaps without overwriting existing transactions or the forward cursor", async () => {
  const f = await fresh(), forward = await f.request();
  await f.slice(forward.id); assert.equal((await f.slice(forward.id)).status, "SUCCEEDED");
  const cursorBefore = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
  const recordBefore = await prisma.amazonFinanceRecord.findUniqueOrThrow({ where: { organizationId_workspaceId_sellerAccountId_transactionId: { ...f.scope, sellerAccountId: f.store, transactionId: "fixture-tx-1" } } });
  const frozen = (forward.frozenScope as { financeWindow: { from: string; to: string } }).financeWindow;
  const addedMarketplaces = policy.marketplaces.map((m: { marketplaceId: string }) => m.marketplaceId).filter((id: string) => !automaticMarketplaces.has(id));
  for (const id of policy.marketplaces.map((m: { marketplaceId: string }) => m.marketplaceId)) automaticMarketplaces.add(id);
  try {
    const replay = await financeHistoryReplayTask(f, frozen);
    f.setBody(raw("page-1").replace("9007199254740993.123456789012345678901234567890", "1.00"));
    assert.equal((await f.slice(replay.id)).status, "WAITING");
    f.setBody(null);
    assert.equal((await f.slice(replay.id)).status, "SUCCEEDED");
    const recordAfter = await prisma.amazonFinanceRecord.findUniqueOrThrow({ where: { id: recordBefore.id } });
    assert.equal(recordAfter.rowHash, recordBefore.rowHash);
    assert.equal(recordAfter.sourceRunId, recordBefore.sourceRunId);
    assert.equal(recordAfter.observationSequence, recordBefore.observationSequence);
    const cursorAfter = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: f.source.id } });
    assert.equal(cursorAfter.status, cursorBefore.status); assert.equal(cursorAfter.watermarkFrom.getTime(), cursorBefore.watermarkFrom.getTime());
    assert.equal(cursorAfter.watermarkTo.getTime(), cursorBefore.watermarkTo.getTime()); assert.equal(cursorAfter.nextTokenCiphertext, cursorBefore.nextTokenCiphertext);
    assert.equal(cursorAfter.activeRunId, cursorBefore.activeRunId);
    assert.equal(cursorAfter.captureSequence, cursorBefore.captureSequence + 2);
  } finally { for (const id of addedMarketplaces) automaticMarketplaces.delete(id); }
});

test("Finance history replay refuses a changed forward cursor before requesting Amazon", async () => {
  const f = await fresh(), forward = await f.request();
  await f.slice(forward.id); assert.equal((await f.slice(forward.id)).status, "SUCCEEDED");
  const frozen = (forward.frozenScope as { financeWindow: { from: string; to: string } }).financeWindow;
  const addedMarketplaces = policy.marketplaces.map((m: { marketplaceId: string }) => m.marketplaceId).filter((id: string) => !automaticMarketplaces.has(id));
  for (const id of policy.marketplaces.map((m: { marketplaceId: string }) => m.marketplaceId)) automaticMarketplaces.add(id);
  try {
    const replay = await financeHistoryReplayTask(f, frozen);
    await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { nextTokenCiphertext: "stale-forward-version" } });
    f.calls.length = 0;
    assert.equal((await f.slice(replay.id)).status, "FAILED");
    assert.equal(f.calls.length, 0);
  } finally { for (const id of addedMarketplaces) automaticMarketplaces.delete(id); }
});

async function legacyParserFailure() {
  const f=await fresh(),task=await f.request();
  await f.slice(task.id);
  const run=await prisma.amazonSyncRun.findUniqueOrThrow({where:{id:task.id}}),cursor=await prisma.amazonSyncResourceCursor.findUniqueOrThrow({where:{sourceId:f.source.id}});
  const token=decryptCheckpoint(cursor.nextTokenCiphertext,f.scope,cursor.id);
  const window={from:cursor.watermarkFrom.toISOString(),to:cursor.watermarkTo.toISOString()};
  const body=`{"newUnmappedDetails":${JSON.stringify(Array(100000).fill(null))},${raw('page-2').trim().slice(1)}`;
  await prisma.$transaction(async tx=>{
    await archiveResponse(tx,run,2,{apiVersion:'2024-06-19',operation:'listTransactions',window,pageTokenHash:digest([window,cursor.detailPolicyDigest,token]),policyDigest:cursor.detailPolicyDigest!},body);
    await tx.amazonSyncRun.update({where:{id:task.id},data:{status:'FAILED',error:'财务响应不是安全、有效的 JSON。',finishedAt:new Date(),nextAttemptAt:new Date(0)}});
    await tx.amazonSyncResourceCursor.update({where:{sourceId:f.source.id},data:{status:'FAILED'}});
  });
  return {...f,task,run,cursor,body};
}

test("parser upgrade automatically replays a large archived response, validates rows and advances once",async()=>{
  const f=await legacyParserFailure();
  const original=await prisma.amazonSyncRawPage.findUniqueOrThrow({where:{taskId_page:{taskId:f.task.id,page:2}}});
  const calls=f.calls.length;
  const recovered=await recoverFinanceParserFailures([f.scope]);
  assert.equal(recovered.recovered,1,JSON.stringify(recovered));assert.equal(recovered.candidates[0].page,2);
  assert.equal((await prisma.amazonSyncResourceCursor.findUniqueOrThrow({where:{sourceId:f.source.id}})).nextTokenCiphertext,f.cursor.nextTokenCiphertext);
  assert.equal((await f.slice(f.task.id,async()=>{throw Error('Original replay must not request Amazon');})).status,'SUCCEEDED');
  assert.equal(f.calls.length,calls);
  assert.equal(await prisma.amazonFinanceRecord.count({where:f.scope}),3);
  const done=await prisma.amazonSyncRun.findUniqueOrThrow({where:{id:f.task.id}});
  assert.equal(done.pagesCompleted,2);assert.equal(done.insertedCount,3);assert.equal(done.processedCount,3);
  const cursor=await prisma.amazonSyncResourceCursor.findUniqueOrThrow({where:{sourceId:f.source.id}});
  assert.equal(cursor.status,'SUCCEEDED');assert.equal(cursor.nextTokenCiphertext,null);assert.equal(cursor.captureSequence,f.cursor.captureSequence+1);
  await processSyncCenterTask(done.id,done.dispatchVersion-1,{clientOptions:{fetch:async()=>{throw Error('Duplicate dispatch must not request Amazon');}}});
  assert.equal(await prisma.amazonFinanceRecord.count({where:f.scope}),3);
  const reread=await prisma.amazonSyncRawPage.findUniqueOrThrow({where:{taskId_page:{taskId:f.task.id,page:2}}});
  assert.equal(reread.bodySha256,original.bodySha256);assert.equal(reread.rawCiphertext,original.rawCiphertext);
  assert.equal(unseal(reread.rawCiphertext,f.scope,`${f.task.id}:2`,'amazon-finance-raw.v1').rawBody,f.body);
  const evidence=await prisma.auditLog.findFirstOrThrow({where:{organizationId:f.scope.organizationId,entityId:f.task.id,action:'amazon.sync.report.parse-checkpoint',AND:[{metadata:{path:['rawPage'],equals:2}},{metadata:{path:['phase'],equals:'ROWS_COMMITTED'}}]}});
  const parseEvidence=evidence.metadata as {parserVersion:string;replayed:boolean};
  assert.equal(parseEvidence.parserVersion,financeParser.version);assert.equal(parseEvidence.replayed,true);
  assert.equal(await prisma.auditLog.count({where:{organizationId:f.scope.organizationId,entityId:f.task.id,action:'amazon.sync.report.parse-checkpoint',metadata:{path:['phase'],equals:'PUBLISHED'}}}),1);
  const fields=await prisma.amazonFieldRegistry.findMany({where:{...f.scope,observations:{some:{rawTaskId:f.task.id,rawPage:2}}}});
  const unknown=fields.find(field=>unseal(field.sourcePathCiphertext,f.scope,field.id,'amazon-field-path.v1').sourcePath==='/newUnmappedDetails');
  assert.ok(unknown);assert.equal(unknown.mappingStatus,'UNMAPPED');
  assert.equal((await recoverFinanceParserFailures([f.scope])).recovered,0);
});

test("a changed historical parse result cannot overwrite business facts or advance its checkpoint",async()=>{
 const f=await legacyParserFailure();
 await prisma.$transaction(tx=>recordReportParseEvidence(tx,f.run,{rawTaskId:f.task.id,rawPage:2,phase:'ROWS_COMMITTED',rowsCommitted:0,checkedAt:new Date(),finance:{resultDigest:'previous-reviewed-result'}}));
 assert.equal((await recoverFinanceParserFailures([f.scope])).recovered,1);
 const result=await f.slice(f.task.id,async()=>{throw Error('Historical replay must not request Amazon');});
 assert.equal(result.status,'FAILED');assert.match(result.error!,/人工审阅/);
 assert.equal(await prisma.amazonFinanceRecord.count({where:f.scope}),1);
 const cursor=await prisma.amazonSyncResourceCursor.findUniqueOrThrow({where:{sourceId:f.source.id}});
 assert.equal(cursor.nextTokenCiphertext,f.cursor.nextTokenCiphertext);assert.equal(cursor.captureSequence,f.cursor.captureSequence);
});

test("current-version parse failure records location, preserves cursor, and is not retried indefinitely",async()=>{
 const f=await fresh(),task=await f.request();f.setBody('{"private-secret":]}');
 assert.equal((await f.slice(task.id)).status,'FAILED');
 const cursor=await prisma.amazonSyncResourceCursor.findUniqueOrThrow({where:{sourceId:f.source.id}});
 assert.equal(cursor.captureSequence,0);assert.equal(await prisma.amazonFinanceRecord.count({where:f.scope}),0);
 const evidence=await prisma.auditLog.findFirstOrThrow({where:{organizationId:f.scope.organizationId,entityId:task.id,action:'amazon.sync.report.parse-checkpoint',metadata:{path:['phase'],equals:'ATTEMPT_FAILED'}}});
 const diagnostic=(evidence.metadata as {diagnostic:{code:string;offset:number}}).diagnostic;assert.equal(diagnostic.code,'JSON_SYNTAX');assert.ok(diagnostic.offset>0);assert.ok(!JSON.stringify(evidence.metadata).includes('private-secret'));
 const inspectionAt = new Date(Date.now() + 15 * 60_000);
 const inspected = await recoverFinanceParserFailures([f.scope], inspectionAt);
 assert.equal(inspected.examined,1);assert.equal(inspected.recovered,0);
 assert.equal((await recoverFinanceParserFailures([f.scope], inspectionAt)).examined,0);
 assert.equal((await prisma.amazonSyncResourceCursor.findUniqueOrThrow({where:{sourceId:f.source.id}})).captureSequence,0);
});

test("automatic parser recovery cannot resume paused work or a revoked source",async()=>{
 for(const mode of ['paused','revoked']as const){const f=await legacyParserFailure();
  if(mode==='paused')await prisma.amazonSyncRun.update({where:{id:f.task.id},data:{status:'PAUSED'}});
  else await prisma.amazonSyncDataSource.update({where:{id:f.source.id},data:{enabled:false}});
  assert.equal((await recoverFinanceParserFailures([f.scope])).recovered,0);
  assert.equal(await prisma.amazonFinanceRecord.count({where:f.scope}),1);
 }
});

test("parser recovery defers a full blocked batch and publishes the next archived task without HTTP", async () => {
  const f = await legacyParserFailure();
  const now = new Date(), old = new Date(now.getTime() - 60_000);
  const blocked: string[] = [];
  // Each failed cursor owns its task. Invalid execution authority must be
  // preserved, rather than requiring an operator to remove these candidates.
  for (let index = 0; index < 25; index++) {
    const sourceId = randomUUID(), id = randomUUID(), authorizationId = randomUUID(), marketplaceId = `blocked-parser-${index}`;
    await prisma.amazonSpApiAuthorization.create({ data: { ...f.scope, id: authorizationId, name: "Blocked parser fixture",
      amazonSellerId: `blocked-seller-${index}`, credentialsCiphertext: "unusable-fixture", awsRegion: region,
      endpoint: endpoints[region], status: "DISABLED", updatedByUserId: f.actor } });
    await prisma.amazonSyncDataSource.create({ data: { ...f.scope, id: sourceId, authorizationId,
      sellerAccountId: f.store, marketplaceId, resource: "finance", enabled: false, freshnessMinutes: 60 } });
    await prisma.amazonSyncRun.create({ data: { ...f.scope, id, requestedByUserId: f.actor, sourceId,
      resource: "finance", executionVersion: 2, mode: "incremental", status: "FAILED", error: "incompatible parser fixture",
      nextAttemptAt: old, updatedAt: old } });
    await prisma.amazonSyncResourceCursor.create({ data: { ...f.scope, id: randomUUID(), sourceId,
      resource: "finance", amazonSellerId: "fixture-seller", marketplaceId, activeRunId: id, status: "FAILED",
      watermarkFrom: f.cursor.watermarkFrom, watermarkTo: f.cursor.watermarkTo } });
    blocked.push(id);
  }
  const before = await prisma.amazonSyncRun.findMany({ where: { id: { in: blocked } }, orderBy: { id: "asc" } });
  const preview = await recoverFinanceParserFailures([f.scope], now, { dryRun: true });
  assert.equal(preview.examined, 25); assert.equal(preview.recovered, 0);
  assert.deepEqual(await prisma.amazonSyncRun.findMany({ where: { id: { in: blocked } }, orderBy: { id: "asc" } }), before);
  const first = await recoverFinanceParserFailures([f.scope], now);
  assert.equal(first.examined, 25); assert.equal(first.deferred, 25); assert.equal(first.recovered, 0);
  const failures = await prisma.amazonSyncRun.findMany({ where: { id: { in: blocked } } });
  for (const run of failures) {
    assert.equal(run.status, "FAILED"); assert.equal(run.dispatchVersion, 0); assert.equal(run.attempts, 0);
    assert.equal(run.nextAttemptAt.getTime(), now.getTime() + 15 * 60_000);
    assert.equal(run.error, "incompatible parser fixture");
  }
  const next = await recoverFinanceParserFailures([f.scope], now);
  assert.equal(next.examined, 1); assert.equal(next.recovered, 1); assert.equal(next.candidates[0].taskId, f.task.id);
  assert.equal((await recoverFinanceParserFailures([f.scope], now)).examined, 0);
  assert.equal((await f.slice(f.task.id, async () => { throw Error("Archived parser recovery must not request Amazon"); })).status, "SUCCEEDED");
  assert.equal(await prisma.amazonFinanceRecord.count({ where: f.scope }), 3);
  assert.equal(await prisma.amazonSyncResourceCursor.count({ where: { ...f.scope, activeRunId: { in: blocked }, status: "FAILED" } }), 25);
});

test("precise Finance UTC queries filter before pagination and preserve original batch and money", async () => {
  const f = await fresh(), task = await f.request();
  await f.slice(task.id); await f.slice(task.id);
  const params = new URLSearchParams({ sellerAccountId: f.store, marketplaceId: site, sourceRunId: task.id, fromTimestamp: "2026-11-01T02:00:00.000Z", toTimestamp: "2026-11-01T02:00:00.001Z", pageSize: "1" });
  const included = await readFinance(f.scope, params, f.actor);
  assert.equal(included.pagination.total, 1); assert.equal(included.rows[0].transactionId, "fixture-tx-2");
  assert.equal(included.rows[0].originalAmount, "-1.2300"); assert.equal(included.rows[0].currency, "USD"); assert.equal(included.rows[0].sourceRunId, task.id);
  params.set("page", "2"); assert.equal((await readFinance(f.scope, params, f.actor)).rows.length, 0);
  params.set("page", "1"); params.set("fromTimestamp", "2026-11-01T01:00:00Z"); params.set("toTimestamp", "2026-11-01T02:00:00Z");
  assert.equal((await readFinance(f.scope, params, f.actor)).pagination.total, 0, "exclusive end excludes exactly 02:00; the other-site 01:00 record stays hidden");
  params.set("from", "2026-11-01"); await assert.rejects(readFinance(f.scope, params, f.actor), /不能同时/);
});

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
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: first.id } }), 2);
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: first.id, page: { lt: 0 } } }), 1, "rejected token response remains encrypted evidence");
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

test("stale scheduled finance scope blocks execution after an approved retry", async t => {
  for (const { marketplaceId } of policy.marketplaces) automaticMarketplaces.add(marketplaceId);
  t.after(() => { for (const { marketplaceId } of policy.marketplaces) automaticMarketplaces.delete(marketplaceId); });
  const f = await fresh(), task = await f.request(); await f.slice(task.id); f.setFault(400); await f.slice(task.id);
  const plan = await prisma.amazonSyncSchedule.create({ data: { ...f.scope, id: randomUUID(), resource: "finance", executionVersion: 2, planKey: automaticPlanKey(f.source.id), mode: "incremental", enabled: true, updatedByUserId: f.actor } });
  await prisma.amazonSyncPlanTarget.create({ data: { ...f.scope, scheduleId: plan.id, sourceId: f.source.id } });
  const frozen = { ...(task.frozenScope as Record<string, unknown>), scheduleId: plan.id, scheduleRevision: plan.revision };
  await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, frozenScope: frozen, frozenScopeDigest: digest(frozen) } });
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authId }, data: { approvedRoles: [], rolesAttestedAt: null } });
  await prisma.amazonSyncSchedule.update({ where: { id: plan.id }, data: { revision: { increment: 1 } } });
  await f.approved({ action: "control-task", id: task.id, control: "retry" });
  const callsBefore = f.calls.length;
  assert.equal((await f.slice(task.id)).status, "BLOCKED");
  assert.equal(f.calls.length, callsBefore);
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
for (const change of ["region", "sites", "actor", "approver", "binding"]) test(`finance ${change} mismatch blocks before any HTTP`, async () => {
  const f = await fresh(), task = await f.request();
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
  const rejected = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: task.id, page: 1 } });
  const original = unseal(rejected.rawCiphertext, f.scope, `${task.id}:1`, "amazon-finance-raw.v1").rawBody;
  assert.ok(typeof original === "string" && original.includes("fixture-outside"), "rejected response retained only in encrypted raw evidence");
});
test("approved site overflow recovery replays the original, quarantines overflow and advances the same cursor", async () => {
  const f = await fresh(), task = await f.request();
  f.setBody(raw("page-1").replaceAll("fixture-site-b", "fixture-outside"));
  assert.equal((await f.slice(task.id)).status, "FAILED");
  const original = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: task.id, page: 1 } });
  const calls = f.calls.length;
  await f.approved({ action: "control-task", id: task.id, control: "retry", quarantineOutsideFinanceScope: true });
  assert.equal((await f.slice(task.id)).status, "WAITING");
  assert.equal(f.calls.length, calls, "the rejected original is reused without any Amazon HTTP");
  const row = await prisma.amazonFinanceRecord.findFirstOrThrow({ where: { ...f.scope, sourceRunId: task.id } });
  assert.equal(row.attributionStatus, "QUARANTINED");
  assert.equal(row.quarantineReason, "OUTSIDE_APPROVED_MARKETPLACE");
  assert.equal(row.marketplaceId, null); assert.equal(row.originalAmount, null); assert.equal(row.currency, null);
  const hidden = await prisma.amazonFinanceQuarantine.findUniqueOrThrow({ where: { recordId: row.id } });
  assert.equal(unseal(hidden.ciphertext, f.scope, row.id, "amazon-finance-quarantine.v1").metadataMarketplaceId, "fixture-outside");
  assert.equal((await prisma.amazonSyncRawPage.findUniqueOrThrow({ where: { taskId_page: { taskId: task.id, page: 1 } } })).bodySha256, original.bodySha256);
  assert.equal((await readFinance(f.scope, new URLSearchParams({ sellerAccountId: f.store, marketplaceId: site }), f.actor)).rows.length, 0);
  f.setBody(null);
  assert.equal((await f.slice(task.id)).status, "SUCCEEDED");
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).processedCount, 3);
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
    await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: f.scope.organizationId, userId: f.actor } }, data: { role: "viewer" } });
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
