import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { Queue } from "bullmq";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { initializeIsolatedCampaignReport, type IsolatedReportTransport } from "@/lib/amazon-ads/report-acquisition";
import { controlIsolatedReport, runIsolatedReportDispatch, tickIsolatedReports, type ReportDispatch } from "@/lib/amazon-ads/report-runtime";
import { campaignReportRequest } from "@/lib/amazon-ads/campaign-report-contract";
import { startIsolatedReportWorker, isolatedReportQueueName, reportDispatchJobId } from "@/lib/amazon-ads/report-worker";

if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1") throw new Error("Disposable runner required");
after(async () => { await prisma.$disconnect(); });

async function until(check: () => Promise<boolean>, description: string) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await check()) return; await delay(25); }
  throw new Error(`Fixture timeout: ${description}`);
}
async function fixture(existingScope?: { organizationId: string; workspaceId: string }) {
  const scope = existingScope ?? { organizationId: randomUUID(), workspaceId: "report-worker" };
  const actor = randomUUID(), seller = randomUUID(), auth = randomUUID(), profile = randomUUID(), plan = randomUUID(), task = randomUUID();
  const spec = { from: "2026-11-01", to: "2026-11-01", currencyCode: "USD", timezone: "America/Los_Angeles", attributionDays: 7 as const };
  if (!existingScope) {
    await prisma.organization.create({ data: { id: scope.organizationId, name: "fixture", slug: scope.organizationId } });
    await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "fixture" } });
  }
  await prisma.user.create({ data: { id: actor, name: "fixture", email: `${actor}@fixture.invalid`, passwordHash: "unused", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: seller, accountKey: seller, displayName: "fixture", marketplaceCode: "US" } });
  await prisma.amazonAdsAuthorization.create({ data: { ...scope, id: auth, name: "fixture", consentRegion: "NA", status: "CONNECTED", credentialsCiphertext: "unused", authorizedByUserId: actor } });
  await prisma.amazonAdsProfile.create({ data: { ...scope, id: profile, authorizationId: auth, region: "NA", profileId: "999999", countryCode: "US", marketplaceId: "ATVPDKIKX0DER", sellerAccountId: seller, currencyCode: spec.currencyCode, timezone: spec.timezone, accountInfo: {} } });
  await prisma.amazonAdsSyncPlan.create({ data: { ...scope, id: plan, profileId: profile, sellerAccountId: seller, actorUserId: actor, authorizationRevision: 1 } });
  const fence = { taskId: task, leaseOwner: randomUUID(), dispatchVersion: 1, fenceVersion: 0 };
  await prisma.amazonAdsSyncTask.create({ data: { ...scope, id: task, profileId: profile, planId: plan, requestedByUserId: actor, planRevision: 1, idempotencyKey: task, trigger: "isolated-report", stage: "REPORTS_ISOLATED", status: "RUNNING", requestedFrom: new Date(spec.from), requestedTo: new Date(spec.to), leaseOwner: fence.leaseOwner, leaseExpiresAt: new Date(Date.now() + 60000) } });
  await initializeIsolatedCampaignReport(scope, actor, fence, spec);
  await controlIsolatedReport(scope, actor, task, "pause");
  await controlIsolatedReport(scope, actor, task, "resume");
  const bytes = gzipSync(JSON.stringify([{ date: spec.from, campaignId: "9101", campaignBudgetCurrencyCode: "USD", impressions: 100, clicks: 10, cost: "1.25", purchases7d: 1, sales7d: "5.00", unitsSoldClicks7d: 1 }]));
  const reportId = randomUUID(), calls = { create: 0, poll: 0, download: 0 };
  const envelope = { reportId, status: "COMPLETED", startDate: spec.from, endDate: spec.to, configuration: campaignReportRequest(spec).configuration, url: "https://download.fixture.invalid/report", urlExpiresAt: new Date(Date.now() + 3600000).toISOString(), fileSize: bytes.length };
  const transport: IsolatedReportTransport = {
    evidence: "ISOLATED_FIXTURE_ONLY",
    async create() { calls.create++; return Response.json(envelope); },
    async poll() { calls.poll++; return Response.json(envelope); },
    async download() { calls.download++; return new Response(bytes); },
  };
  const row = () => prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: task } });
  const start = () => startIsolatedReportWorker({ scope, transport, intervalMs: 100 });
  return { scope, actor, task, row, calls, transport, envelope, start, spec };
}
function queue(scope: { organizationId: string; workspaceId: string }) {
  return new Queue(isolatedReportQueueName(scope), { connection: { url: process.env.REDIS_URL!, maxRetriesPerRequest: null } });
}

test("worker refuses non-fixture environments, non-disposable Redis and invalid intervals before startup", async () => {
  const input = { scope: { organizationId: "fixture", workspaceId: "fixture" }, transport: { evidence: "ISOLATED_FIXTURE_ONLY" } as IsolatedReportTransport };
  for (const key of ["AMAZON_SYNC_OFFLINE_FIXTURE", "AMAZON_SYNC_TEST_REDIS_DISPOSABLE"]) {
    const saved = process.env[key]; delete process.env[key];
    try { await assert.rejects(() => startIsolatedReportWorker(input), /OFFLINE_ONLY|DISPOSABLE_REDIS_REQUIRED/); }
    finally { process.env[key] = saved; }
  }
  await assert.rejects(() => startIsolatedReportWorker({ ...input, intervalMs: 0 }), /INTERVAL_INVALID/);
});

test("two automatic worker services share a scoped queue and publish without manual phase driving", { timeout: 20000 }, async () => {
  const f = await fixture();
  const workers = await Promise.all([f.start(), f.start()]);
  try {
    assert.equal(workers[0].queueName, workers[1].queueName);
    await until(async () => (await f.row()).status === "SUCCEEDED", "automatic publication");
    assert.deepEqual(f.calls, { create: 1, poll: 0, download: 1 });
    assert.equal(await prisma.amazonAdsReportVersion.count({ where: { ...f.scope, sourceTaskId: f.task, status: "PUBLISHED" } }), 1);
    assert.equal(await prisma.amazonAdsReportFact.count({ where: { ...f.scope, sourceTaskId: f.task } }), 1);
  } finally { await Promise.all(workers.map(worker => worker.close())); }
});

test("multiple service instances enforce a queue-wide two-operation ceiling across Profiles", { timeout: 20000 }, async () => {
  const f = await fixture(), second = await fixture(f.scope), third = await fixture(f.scope);
  let active = 0, peak = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const create = f.transport.create;
  f.transport.create = async (...args) => {
    active++; peak = Math.max(peak, active);
    try { await gate; return await create(...args); } finally { active--; }
  };
  const services = await Promise.all([f.start(), f.start(), f.start()]);
  try {
    await until(async () => active === 2, "two active Profiles");
    await delay(50);
    assert.equal(peak, 2);
    release();
    await until(async () => (await Promise.all([f.row(), second.row(), third.row()])).every(row => row.status === "SUCCEEDED"), "three Profile publications");
    assert.equal(peak, 2);
    assert.deepEqual(f.calls, { create: 3, poll: 0, download: 3 });
  } finally { release(); await Promise.all(services.map(service => service.close())); }
});

test("shutdown waits in-flight operation, stops scanning, and restart resumes the stored report", { timeout: 20000 }, async () => {
  const f = await fixture();
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const create = f.transport.create;
  f.transport.create = async (...args) => { started(); await gate; return create(...args); };
  const worker = await f.start();
  let closed = false;
  try {
    await ready;
    const closing = worker.close().then(() => { closed = true; });
    await delay(50);
    assert.equal(closed, false, "close must wait for the active request");
    assert.equal((await worker.tick()).outcome, "stopping");
    release(); await closing; await worker.close();
    assert.equal((await f.row()).status, "WAITING");
    assert.deepEqual(f.calls, { create: 1, poll: 0, download: 0 });
    const replacement = await f.start();
    try { await until(async () => (await f.row()).status === "SUCCEEDED", "restart publication"); }
    finally { await replacement.close(); }
    assert.deepEqual(f.calls, { create: 1, poll: 0, download: 1 });
  } finally { release(); await worker.close(); }
});

test("deterministic dispatch IDs deduplicate queued messages and invalid messages never reach transport", { timeout: 20000 }, async () => {
  const f = await fixture(), q = queue(f.scope);
  try {
    const data = { taskId: f.task, dispatchVersion: (await f.row()).dispatchVersion };
    const jobId = reportDispatchJobId(data);
    await Promise.all(Array.from({ length: 10 }, () => q.add("report-step", data, { jobId, removeOnComplete: true })));
    assert.equal(await q.getWaitingCount(), 1);
    await q.add("unknown-job", data, { removeOnFail: true });
    await q.add("report-step", { taskId: f.task, dispatchVersion: -1 }, { removeOnFail: true });
    const events: string[] = [];
    const worker = await startIsolatedReportWorker({ scope: f.scope, transport: f.transport, intervalMs: 100, onEvent: event => { events.push(event); } });
    try {
      await until(async () => (await f.row()).status === "SUCCEEDED", "deduplicated publication");
      assert.deepEqual(f.calls, { create: 1, poll: 0, download: 1 });
      assert.equal(events.filter(event => event === "dispatch_failed").length, 2);
    } finally { await worker.close(); }
  } finally { await q.close(); }
});

test("scheduler admission defers a full queue and restarts from PostgreSQL when capacity returns", { timeout: 20000 }, async () => {
  const f = await fixture(), q = queue(f.scope);
  await q.pause();
  try {
    for (let index = 0; index < 100; index++) await q.add("report-step", { taskId: `missing-${index}`, dispatchVersion: 1 }, { removeOnComplete: true });
    const worker = await f.start();
    try {
      assert.equal((await worker.tick()).outcome, "capacity");
      assert.equal(f.calls.create, 0);
      assert.equal((await f.row()).status, "WAITING");
      await q.resume();
      await until(async () => (await f.row()).status === "SUCCEEDED", "publication after capacity returns");
      assert.deepEqual(f.calls, { create: 1, poll: 0, download: 1 });
    } finally { await worker.close(); }
  } finally { await q.close(); }
});

test("worker scope cannot consume another organization task", { timeout: 20000 }, async () => {
  const f = await fixture(), foreign = await fixture(), q = queue(f.scope);
  await controlIsolatedReport(f.scope, f.actor, f.task, "pause");
  await q.add("report-step", { taskId: foreign.task, dispatchVersion: (await foreign.row()).dispatchVersion }, { removeOnComplete: true });
  const worker = await f.start();
  try {
    await until(async () => await q.getWaitingCount() === 0 && await q.getActiveCount() === 0, "foreign message rejected");
    assert.equal((await foreign.row()).status, "WAITING");
    assert.deepEqual(f.calls, { create: 0, poll: 0, download: 0 });
    assert.notEqual(isolatedReportQueueName(f.scope), isolatedReportQueueName(foreign.scope));
  } finally { await worker.close(); await q.close(); }
});

test("automatic retry honors persisted Retry-After and shutdown preserves the waiting task", { timeout: 20000 }, async () => {
  const f = await fixture();
  f.transport.create = async () => { f.calls.create++; return Response.json({ ...f.envelope, status: "PENDING" }); };
  f.transport.poll = async () => { f.calls.poll++; return new Response("private upstream error", { status: 429, headers: { "retry-after": "120" } }); };
  const worker = await f.start();
  try {
    await until(async () => f.calls.create === 1 && (await f.row()).status === "WAITING", "pending report");
    const request = await prisma.amazonAdsReportRequest.findFirstOrThrow({ where: { ...f.scope, sourceTaskId: f.task } });
    const options = request.requestOptions as unknown as { acquisition: { nextPollAt?: string } };
    delete options.acquisition.nextPollAt;
    await prisma.amazonAdsReportRequest.update({ where: { id: request.id }, data: { requestOptions: options as unknown as Prisma.InputJsonValue } });
    await prisma.amazonAdsSyncTask.update({ where: { id: f.task }, data: { nextAttemptAt: new Date(0) } });
    await until(async () => (await f.row()).status === "RETRY_WAIT", "persisted throttle wait");
    assert.ok((await f.row()).nextAttemptAt.getTime() > Date.now() + 110000);
    await worker.tick();
    assert.equal(f.calls.poll, 1);
    await worker.close();
    assert.equal((await f.row()).status, "RETRY_WAIT");
    assert.equal(JSON.stringify(await f.row()).includes("private upstream error"), false);
  } finally { await worker.close(); }
});

test("SIGKILL after durable create/download reservation blocks unknown creates and resumes bounded reads", { timeout: 30000 }, async () => {
  for (const stopAt of ["create", "download"] as const) {
    const f = await fixture();
    if (stopAt === "download") await runIsolatedReportDispatch(f.scope, { taskId: f.task, dispatchVersion: (await f.row()).dispatchVersion }, f.transport);
    const child = spawn(process.execPath, ["--import", resolve("tests/helpers/amazon-offline-network-guard.mjs"), "--import", "tsx", resolve("tests/helpers/amazon-ads-report-worker-child.ts")], {
      env: process.env, stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    const exited = once(child, "exit");
    try {
      const message = once(child, "message", { signal: AbortSignal.timeout(10000) });
      child.send({ scope: f.scope, stopAt });
      const [received] = await message;
      assert.deepEqual(received, { operation: stopAt });
      child.kill("SIGKILL");
      const [, signal] = await exited;
      assert.equal(signal, "SIGKILL");
      // Advance only the disposable DB lease, avoiding a 60-second wall-clock sleep.
      await prisma.amazonAdsSyncTask.update({ where: { id: f.task }, data: { leaseExpiresAt: new Date(0) } });
      const replacement = await f.start();
      try {
        await until(async () => (await f.row()).status === (stopAt === "create" ? "BLOCKED" : "SUCCEEDED"), `SIGKILL ${stopAt} recovery`);
        if (stopAt === "create") {
          assert.equal((await f.row()).errorCode, "ADS_REPORT_CREATE_RESULT_UNKNOWN");
          assert.deepEqual(f.calls, { create: 0, poll: 0, download: 0 });
        } else {
          assert.deepEqual(f.calls, { create: 1, poll: 0, download: 1 });
          const request = await prisma.amazonAdsReportRequest.findFirstOrThrow({ where: { ...f.scope, sourceTaskId: f.task } });
          assert.equal((request.requestOptions as unknown as { acquisition: { calls: { download: number } } }).acquisition.calls.download, 2);
        }
      } finally { await replacement.close(); }
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; }
  }
});

test("over one scan of inactive-plan tasks cannot starve an active plan", async () => {
  const suspended = await fixture(), active = await fixture(suspended.scope);
  const original = await suspended.row();
  await prisma.amazonAdsSyncPlan.update({ where: { id: original.planId }, data: { status: "PAUSED" } });
  await prisma.amazonAdsSyncTask.update({ where: { id: original.id }, data: { nextAttemptAt: new Date(0) } });
  await prisma.amazonAdsSyncTask.createMany({ data: Array.from({ length: 101 }, () => {
    const id = randomUUID(); return { ...original, id, idempotencyKey: id, nextAttemptAt: new Date(0) };
  }) });
  const messages: ReportDispatch[] = [];
  const result = await tickIsolatedReports(suspended.scope, async job => { messages.push(job); });
  assert.equal(result.rowFailures, 0);
  assert.deepEqual(messages.map(job => job.taskId), [active.task]);
  assert.equal((await suspended.row()).status, "WAITING");
  assert.equal(await prisma.amazonAdsSyncTask.count({ where: { ...suspended.scope, planId: original.planId, status: "WAITING" } }), 102);
});

test("missing leases recover with a fresh fence; unknown create reservations block before enqueue", async () => {
  for (const unknown of [false, true]) {
    const f = await fixture(), before = await f.row();
    await prisma.amazonAdsSyncTask.update({ where: { id: f.task }, data: { status: "RUNNING", leaseOwner: "lost-worker", leaseExpiresAt: null } });
    await prisma.amazonAdsSyncAttempt.create({ data: { ...f.scope, id: randomUUID(), taskId: f.task, profileId: before.profileId, attemptNumber: before.dispatchVersion, stage: before.stage, status: "RUNNING" } });
    if (unknown) {
      const request = await prisma.amazonAdsReportRequest.findFirstOrThrow({ where: { ...f.scope, sourceTaskId: f.task } });
      const options = request.requestOptions as unknown as { acquisition: { calls: { create: number }; reserved?: unknown } };
      options.acquisition.calls.create = 1;
      options.acquisition.reserved = { operation: "create", fence: before.fenceVersion, owner: "lost-worker" };
      await prisma.amazonAdsReportRequest.update({ where: { id: request.id }, data: { requestOptions: options as unknown as Prisma.InputJsonValue } });
    }
    const messages: ReportDispatch[] = [];
    const result = await tickIsolatedReports(f.scope, async job => { messages.push(job); });
    const after = await f.row();
    assert.ok(after.fenceVersion > before.fenceVersion);
    assert.equal(after.leaseOwner, null);
    assert.equal(await prisma.amazonAdsSyncAttempt.count({ where: { ...f.scope, taskId: f.task, status: "RUNNING" } }), 0);
    if (unknown) {
      assert.equal(result.blocked, 1); assert.equal(after.errorCode, "ADS_REPORT_CREATE_RESULT_UNKNOWN");
      assert.equal(messages.length, 0); assert.equal(after.status, "BLOCKED");
    } else {
      assert.equal(after.dispatchVersion, before.dispatchVersion + 1);
      assert.equal(messages.length, 1);
      await runIsolatedReportDispatch(f.scope, messages[0], f.transport);
      assert.equal(f.calls.create, 1);
      await controlIsolatedReport(f.scope, f.actor, f.task, "cancel");
    }
  }
});

test("locked task rolls back in isolation while healthy tasks continue and locked task remains recoverable", { timeout: 20000 }, async () => {
  const locked = await fixture(), healthy = await fixture(locked.scope);
  await prisma.amazonAdsSyncTask.update({ where: { id: locked.task }, data: { nextAttemptAt: new Date(0) } });
  let ready!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const held = prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-report:${locked.task}`}, 0))`;
    ready(); await gate;
  }, { timeout: 10000 });
  const messages: ReportDispatch[] = [];
  try {
    await entered;
    const result = await tickIsolatedReports(locked.scope, async job => { messages.push(job); });
    assert.equal(result.rowFailures, 1);
    assert.deepEqual(messages.map(job => job.taskId), [healthy.task]);
    assert.equal((await locked.row()).status, "WAITING");
  } finally { release(); await held; }
  await tickIsolatedReports(locked.scope, async job => { messages.push(job); });
  assert.ok(messages.some(job => job.taskId === locked.task));
});

test("bad checkpoints and expired tasks become blocked without starving valid reports or being re-enqueued", async () => {
  const broken = await fixture(), expired = await fixture(broken.scope), healthy = await fixture(broken.scope);
  for (const [f, invalid] of [[broken, true], [expired, false]] as const) {
    const request = await prisma.amazonAdsReportRequest.findFirstOrThrow({ where: { ...f.scope, sourceTaskId: f.task } });
    const options = request.requestOptions as unknown as { acquisition: { deadline: string; calls: { poll: number } } };
    if (invalid) options.acquisition.calls.poll = 0.5;
    else options.acquisition.deadline = new Date(0).toISOString();
    await prisma.amazonAdsReportRequest.update({ where: { id: request.id }, data: { requestOptions: options as unknown as Prisma.InputJsonValue } });
  }
  const messages: ReportDispatch[] = [];
  const result = await tickIsolatedReports(broken.scope, async job => { messages.push(job); });
  assert.equal(result.blocked, 2); assert.equal(result.rowFailures, 0);
  assert.equal((await broken.row()).errorCode, "ADS_REPORT_CHECKPOINT_INVALID");
  assert.equal((await expired.row()).errorCode, "ADS_REPORT_DEADLINE_EXCEEDED");
  assert.deepEqual(messages.map(job => job.taskId), [healthy.task]);
  assert.equal((await tickIsolatedReports(broken.scope, async () => undefined)).blocked, 0);
});

test("Profile throttle deferral is durable and does not leak into another Profile", async () => {
  const f = await fixture();
  f.transport.create = async () => { f.calls.create++; return Response.json({ ...f.envelope, reportId: randomUUID(), status: "PENDING" }); };
  f.transport.poll = async () => { f.calls.poll++; return new Response("private throttle", { status: 429, headers: { "retry-after": "60" } }); };
  const dispatch = async () => ({ taskId: f.task, dispatchVersion: (await f.row()).dispatchVersion });
  await runIsolatedReportDispatch(f.scope, await dispatch(), f.transport);
  const request = await prisma.amazonAdsReportRequest.findFirstOrThrow({ where: { ...f.scope, sourceTaskId: f.task } });
  const options = request.requestOptions as unknown as { acquisition: { nextPollAt?: string } };
  delete options.acquisition.nextPollAt;
  await prisma.amazonAdsReportRequest.update({ where: { id: request.id }, data: { requestOptions: options as unknown as Prisma.InputJsonValue } });
  await prisma.amazonAdsSyncTask.update({ where: { id: f.task }, data: { nextAttemptAt: new Date(0) } });
  await runIsolatedReportDispatch(f.scope, await dispatch(), f.transport);
  const throttle = await f.row();
  assert.equal(throttle.errorCode, "ADS_REPORT_THROTTLED");
  const sibling = randomUUID(), leaseOwner = randomUUID();
  await prisma.amazonAdsSyncTask.create({ data: { ...throttle, id: sibling, idempotencyKey: sibling, status: "RUNNING", stage: "REPORTS_ISOLATED", dispatchVersion: 1, fenceVersion: 0, leaseOwner, leaseExpiresAt: new Date(Date.now() + 60000), nextAttemptAt: new Date(0), errorCode: null, apiRequests: 0, startedAt: null, finishedAt: null } });
  await initializeIsolatedCampaignReport(f.scope, f.actor, { taskId: sibling, leaseOwner, dispatchVersion: 1, fenceVersion: 0 }, f.spec);
  await controlIsolatedReport(f.scope, f.actor, sibling, "pause");
  await controlIsolatedReport(f.scope, f.actor, sibling, "resume");
  const readSibling = () => prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: sibling } });
  await runIsolatedReportDispatch(f.scope, { taskId: sibling, dispatchVersion: (await readSibling()).dispatchVersion }, f.transport);
  assert.equal(f.calls.create, 1);
  assert.equal((await readSibling()).status, "WAITING");
  assert.ok((await readSibling()).nextAttemptAt >= throttle.nextAttemptAt);
  assert.equal(await prisma.amazonAdsSyncAttempt.count({ where: { taskId: sibling } }), 0);
  const independent = await fixture(f.scope);
  await runIsolatedReportDispatch(f.scope, { taskId: independent.task, dispatchVersion: (await independent.row()).dispatchVersion }, independent.transport);
  assert.equal(independent.calls.create, 1);
  // Only advance disposable task time to verify the cooldown is finite.
  await prisma.amazonAdsSyncTask.updateMany({ where: { id: { in: [f.task, sibling] } }, data: { nextAttemptAt: new Date(0) } });
  await runIsolatedReportDispatch(f.scope, { taskId: sibling, dispatchVersion: (await readSibling()).dispatchVersion }, f.transport);
  assert.equal(f.calls.create, 2);
  assert.equal((await readSibling()).status, "WAITING", `sibling error: ${(await readSibling()).errorCode}`);
  await controlIsolatedReport(f.scope, f.actor, sibling, "cancel");
});
