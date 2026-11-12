// Cloud role for injected offline HTTP fixtures; no real Amazon calls.
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { prisma } from "@/lib/db/prisma";
import { encryptAmazonAdsCheckpoint, decryptAmazonAdsCheckpoint } from "@/lib/amazon-ads/credentials";
import { createReportingV1Transport, type ReportingV1CreateReport } from "@/lib/amazon-ads/reporting-v1-transport";
import { downloadIsolatedReportingV1Part, initializeIsolatedReportingV1, processIsolatedReportingV1, type IsolatedReportingV1Transport } from "@/lib/amazon-ads/reporting-v1-acquisition";

if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1") throw new Error("Disposable runner required");
after(async () => { await prisma.$disconnect(); });
const credentials = { clientId: "fixture-client", accessToken: "fixture-access" };
const report: ReportingV1CreateReport = { format: "GZIP_JSON", periods: [{ datePeriod: { startDate: "2026-11-01", endDate: "2026-11-01" } }], query: { fields: ["fixture.field"] } };
async function fixture() {
  const scope = { organizationId: randomUUID(), workspaceId: "reporting-v1" };
  const actor = randomUUID(), seller = randomUUID(), auth = randomUUID(), profile = randomUUID(), plan = randomUUID(), task = randomUUID();
  await prisma.organization.create({ data: { id: scope.organizationId, name: "fixture", slug: scope.organizationId } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "fixture" } });
  await prisma.user.create({ data: { id: actor, name: "fixture", email: `${actor}@fixture.invalid`, passwordHash: "unused", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: seller, accountKey: seller, displayName: "fixture", marketplaceCode: "US" } });
  await prisma.amazonAdsAuthorization.create({ data: { ...scope, id: auth, name: "fixture", consentRegion: "NA", status: "CONNECTED", credentialsCiphertext: "unused", authorizedByUserId: actor } });
  await prisma.amazonAdsProfile.create({ data: { ...scope, id: profile, authorizationId: auth, region: "NA", profileId: "999999", advertiserAccountId: "fixture-advertiser", advertiserAccountRevision: 1, countryCode: "US", marketplaceId: "ATVPDKIKX0DER", sellerAccountId: seller, currencyCode: "USD", timezone: "America/Los_Angeles", accountInfo: {} } });
  await prisma.amazonAdsSyncPlan.create({ data: { ...scope, id: plan, profileId: profile, sellerAccountId: seller, actorUserId: actor, authorizationRevision: 1 } });
  const fence = { taskId: task, leaseOwner: randomUUID(), dispatchVersion: 1, fenceVersion: 1 };
  await prisma.amazonAdsSyncTask.create({ data: { ...scope, id: task, profileId: profile, planId: plan, requestedByUserId: actor, planRevision: 1, idempotencyKey: task, trigger: "isolated-reporting-v1", status: "RUNNING", fenceVersion: 1, requestedFrom: new Date("2026-11-01"), requestedTo: new Date("2026-11-01"), leaseOwner: fence.leaseOwner, leaseExpiresAt: new Date(Date.now() + 60000) } });
  let calls = 0;
  let response = () => envelope("PENDING");
  const transport: IsolatedReportingV1Transport = Object.assign(createReportingV1Transport(async () => { calls++; return new Response(JSON.stringify(response()), { status: 207 }); }), { evidence: "ISOLATED_FIXTURE_ONLY" as const });
  const initialize = () => initializeIsolatedReportingV1(scope, actor, fence, report, credentials.clientId);
  const step = () => processIsolatedReportingV1(scope, actor, fence, transport, credentials);
  const row = () => prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: task } });
  async function checkpoint() {
    const current = await row();
    return decryptAmazonAdsCheckpoint<{ calls: { create: number; poll: number; download: number }; reserved?: unknown; nextPollAt?: string; parts?: unknown[]; phase: string }>(current.checkpointCiphertext, { ...scope, authorizationId: auth }, task)!;
  }
  async function due() {
    const state = await checkpoint();
    state.nextPollAt = new Date(Date.now() - 1000).toISOString();
    await prisma.amazonAdsSyncTask.update({ where: { id: task }, data: { checkpointCiphertext: encryptAmazonAdsCheckpoint(state, { ...scope, authorizationId: auth }, task) } });
  }
  return { scope, actor, seller, auth, profile, plan, task, fence, transport, initialize, step, row, checkpoint, due, calls: () => calls, respond: (fn: typeof response) => { response = fn; } };
}
function envelope(status: "PENDING" | "COMPLETED") {
  return { success: [{ index: 0, report: { ...structuredClone(report), reportId: "fixture-remote-report", status, creationDateTime: "2026-11-06T00:00:00Z", lastUpdatedDateTime: "2026-11-06T00:00:01Z", ...(status === "COMPLETED" ? { completedReportParts: [{ url: "https://download.fixture.invalid/report?signature=fixture-private", sizeInBytes: 7, urlExpirationDateTime: "2099-01-01T00:00:00Z" }, { url: "https://download.fixture.invalid/part2?signature=fixture-private", sizeInBytes: 3, urlExpirationDateTime: "2099-01-01T00:00:00Z" }] } : {}) } }] };
}

test("V1 initializes idempotently and acquires a multipart receipt without publication or plaintext URLs", async () => {
  const f = await fixture();
  assert.deepEqual(await f.initialize(), await f.initialize());
  assert.equal(f.calls(), 0);
  assert.equal((await f.step()).phase, "POLL");
  assert.deepEqual((await f.checkpoint()).calls, { create: 1, poll: 0, download: 0 });
  await f.due(); f.respond(() => envelope("COMPLETED"));
  assert.deepEqual(await f.step(), { phase: "ACQUIRED", partCount: 2 });
  assert.equal((await f.row()).errorCode, null);
  assert.equal((await f.checkpoint()).parts?.length, 2);
  const stored = await prisma.amazonAdsReportRequest.findFirstOrThrow({ where: { ...f.scope, sourceTaskId: f.task } });
  assert.equal(JSON.stringify(stored).includes("fixture-private"), false);
  assert.equal(JSON.stringify(await f.row()).includes("fixture-private"), false);
  assert.equal(await prisma.amazonAdsReportFact.count({ where: f.scope }), 0);
  assert.equal(await prisma.amazonAdsReportVersion.count({ where: f.scope }), 0);
  assert.equal((await prisma.amazonAdsSyncPlan.findUniqueOrThrow({ where: { id: f.plan } })).lastSuccessAt, null);
});

test("concurrent dispatch cannot issue duplicate create requests", async () => {
  const f = await fixture(); await f.initialize();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
  const create = f.transport.create;
  f.transport.create = async input => { started(); await gate; return create(input); };
  const pending = f.step();
  try { await ready; await assert.rejects(f.step(), { message: "ADS_REPORT_CREATE_RESULT_UNKNOWN" }); }
  finally { release(); }
  await pending;
  assert.equal(f.calls(), 1);
});

test("a lost create response blocks and cannot be reissued after a replacement fence", async () => {
  const f = await fixture(); await f.initialize();
  let creates = 0;
  f.transport.create = async () => { creates++; throw new Error("private network details"); };
  await assert.rejects(f.step(), { message: "ADS_REPORT_CREATE_RESULT_UNKNOWN" });
  assert.equal((await f.row()).status, "BLOCKED");
  assert.equal((await f.checkpoint()).calls.create, 1);
  f.fence.fenceVersion++;
  await prisma.amazonAdsSyncTask.update({ where: { id: f.task }, data: { status: "RUNNING", fenceVersion: f.fence.fenceVersion, leaseOwner: f.fence.leaseOwner, leaseExpiresAt: new Date(Date.now() + 60000) } });
  await assert.rejects(f.step(), { message: "ADS_REPORT_CREATE_RESULT_UNKNOWN" });
  assert.equal(creates, 1);
});

test("poll rechecks the complete frozen contract and rejects changed fields", async () => {
  const f = await fixture(); await f.initialize(); await f.step(); await f.due();
  f.respond(() => { const value = envelope("COMPLETED"); value.success[0].report.query.fields = ["other.field"]; return value; });
  await assert.rejects(f.step(), { message: "ADS_REPORT_V1_RECEIPT_MISMATCH" });
  assert.equal((await f.row()).status, "BLOCKED");
});

test("Retry-After and consumed poll budget persist between independent dispatch calls", async () => {
  const f = await fixture(); await f.initialize(); await f.step(); await f.due();
  const { ReportReadRetryError } = await import("@/lib/amazon-ads/report-retry");
  const retryAt = Date.now() + 120000;
  f.transport.retrieve = async () => { throw new ReportReadRetryError("ADS_REPORT_THROTTLED", retryAt); };
  await assert.rejects(f.step(), { message: "ADS_REPORT_THROTTLED" });
  assert.equal((await f.row()).status, "RUNNING");
  assert.equal(Date.parse((await f.checkpoint()).nextPollAt!), retryAt);
  assert.deepEqual((await f.checkpoint()).calls, { create: 1, poll: 1, download: 0 });
  await assert.rejects(f.step(), { message: "ADS_REPORT_POLL_NOT_DUE" });
});

test("scope, account revision, client ID and authorization changes stop before HTTP", async () => {
  for (const change of ["scope", "account", "client", "authorization", "authRevision", "user", "grant", "seller"] as const) {
    const f = await fixture(); await f.initialize();
    if (change === "account") await prisma.amazonAdsProfile.update({ where: { id: f.profile }, data: { advertiserAccountRevision: { increment: 1 } } });
    if (change === "authorization") await prisma.amazonAdsAuthorization.update({ where: { id: f.auth }, data: { status: "REVOKED" } });
    if (change === "authRevision") await prisma.amazonAdsAuthorization.update({ where: { id: f.auth }, data: { revision: { increment: 1 } } });
    if (change === "grant") await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: f.scope.organizationId, userId: f.actor } }, data: { role: "viewer" } });
    if (change === "seller") await prisma.sellerAccount.update({ where: { id: f.seller }, data: { status: "inactive" } });
    if (change === "user") await prisma.user.update({ where: { id: f.actor }, data: { status: "disabled" } });
    await assert.rejects(processIsolatedReportingV1(change === "scope" ? { ...f.scope, workspaceId: "foreign" } : f.scope, f.actor, f.fence, f.transport, change === "client" ? { ...credentials, clientId: "other" } : credentials));
    assert.equal(f.calls(), 0);
  }
});

test("scope changes or fence takeover during HTTP prevent stale response commit", async () => {
  for (const change of ["account", "fence"] as const) {
    const f = await fixture(); await f.initialize();
    const create = f.transport.create;
    f.transport.create = async input => {
      if (change === "account") await prisma.amazonAdsProfile.update({ where: { id: f.profile }, data: { advertiserAccountRevision: { increment: 1 } } });
      else await prisma.amazonAdsSyncTask.update({ where: { id: f.task }, data: { fenceVersion: { increment: 1 } } });
      return create(input);
    };
    await assert.rejects(f.step(), { message: change === "account" ? "ADS_REPORT_FROZEN_SCOPE_CHANGED" : "ADS_REPORT_FENCE_LOST" });
    assert.equal((await prisma.amazonAdsReportRequest.findFirstOrThrow({ where: { sourceTaskId: f.task } })).remoteRequestId, null);
  }
});

test("a malformed encrypted checkpoint and expired deadline cannot reset budgets", async () => {
  const f = await fixture(); await f.initialize();
  await prisma.amazonAdsSyncTask.update({ where: { id: f.task }, data: { checkpointCiphertext: "corrupted" } });
  await assert.rejects(f.step()); assert.equal(f.calls(), 0);
  const g = await fixture(); await g.initialize();
  const current = await g.row();
  const state = decryptAmazonAdsCheckpoint<Record<string, unknown>>(current.checkpointCiphertext, { ...g.scope, authorizationId: g.auth }, g.task)!;
  state.deadline = "2000-01-01T00:00:00Z";
  await prisma.amazonAdsSyncTask.update({ where: { id: g.task }, data: { checkpointCiphertext: encryptAmazonAdsCheckpoint(state, { ...g.scope, authorizationId: g.auth }, g.task) } });
  await assert.rejects(g.step(), { message: "ADS_REPORT_DEADLINE_EXCEEDED" }); assert.equal(g.calls(), 0);
});


test("a replacement fence can retry an interrupted read without reissuing create", async () => {
  const f = await fixture(); await f.initialize(); await f.step(); await f.due();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
  const retrieve = f.transport.retrieve;
  f.transport.retrieve = async input => { started(); await gate; return retrieve(input); };
  const old = f.step();
  // Attach a handler immediately, so a rejected stale response cannot be unhandled.
  const rejected = assert.rejects(old, { message: "ADS_REPORT_FENCE_LOST" });
  try {
    await ready;
    f.fence.fenceVersion++;
    await prisma.amazonAdsSyncTask.update({ where: { id: f.task }, data: { fenceVersion: f.fence.fenceVersion } });
    f.transport.retrieve = retrieve;
    f.respond(() => envelope("COMPLETED"));
    assert.equal((await f.step()).phase, "ACQUIRED");
  } finally { release(); }
  await rejected;
  assert.deepEqual((await f.checkpoint()).calls, { create: 1, poll: 2, download: 0 });
});

test("poll budgets and excessive Retry-After block instead of resetting work", async () => {
  const f = await fixture(); await f.initialize(); await f.step();
  for (let index = 0; index < 10; index++) { await f.due(); await f.step(); }
  await f.due();
  await assert.rejects(f.step(), { message: "ADS_REPORT_REQUEST_BUDGET_EXCEEDED" });
  assert.deepEqual((await f.checkpoint()).calls, { create: 1, poll: 10, download: 0 });
  assert.equal(f.calls(), 11);
  const g = await fixture(); await g.initialize(); await g.step(); await g.due();
  const { ReportReadRetryError } = await import("@/lib/amazon-ads/report-retry");
  g.transport.retrieve = async () => { throw new ReportReadRetryError("ADS_REPORT_THROTTLED", Infinity); };
  await assert.rejects(g.step(), { message: "ADS_REPORT_THROTTLED" });
  assert.equal((await g.row()).status, "BLOCKED");
});

test("V1 entry refuses production mode and non-fixture transports before DB operations", async () => {
  const f = await fixture(); await f.initialize();
  const marker = process.env.AMAZON_SYNC_OFFLINE_FIXTURE;
  try {
    delete process.env.AMAZON_SYNC_OFFLINE_FIXTURE;
    await assert.rejects(f.step(), { message: "ADS_REPORT_ACQUISITION_OFFLINE_ONLY" });
  } finally { process.env.AMAZON_SYNC_OFFLINE_FIXTURE = marker; }
  await assert.rejects(processIsolatedReportingV1(f.scope, f.actor, f.fence, { ...f.transport, evidence: "LIVE" } as never, credentials), { message: "ADS_REPORT_V1_OFFLINE_ONLY" });
  assert.equal(f.calls(), 0);
});


test("plaintext contract corruption is detected before transport or budget consumption", async () => {
  const f = await fixture(); await f.initialize();
  await prisma.amazonAdsReportRequest.updateMany({ where: { ...f.scope, sourceTaskId: f.task }, data: { requestOptions: { evidence: "ISOLATED_FIXTURE_ONLY", contractSha256: "changed", scopeDigest: "changed" } } });
  await assert.rejects(f.step(), { message: "ADS_REPORT_V1_CHECKPOINT_INVALID" });
  assert.equal(f.calls(), 0);
  assert.deepEqual((await f.checkpoint()).calls, { create: 0, poll: 0, download: 0 });
});

async function acquiredFixture() {
  const f = await fixture();
  await f.initialize(); f.respond(() => envelope("COMPLETED")); await f.step();
  let downloads = 0;
  const http = createReportingV1Transport(async url => {
    downloads++;
    return new Response(String(url).includes("/part2") ? "two" : "fixture");
  }, ["download.fixture.invalid"]);
  f.transport.download = http.download;
  const download = () => downloadIsolatedReportingV1Part(f.scope, f.actor, f.fence, f.transport);
  return { ...f, download, downloads: () => downloads };
}

test("multipart download encrypts raw files, commits exactly one part per dispatch and blocks fact publication", async () => {
  const f = await acquiredFixture();
  assert.deepEqual(await f.download(), { phase: "DOWNLOADING", downloadedParts: 1, partCount: 2 });
  const firstState = await f.checkpoint();
  assert.equal(firstState.calls.download, 1);
  assert.equal((await f.row()).status, "RUNNING");
  assert.deepEqual(await f.download(), { phase: "RAW_STORED", downloadedParts: 2, partCount: 2 });
  assert.equal(f.downloads(), 2);
  assert.equal((await f.row()).errorCode, "ADS_REPORT_V1_JSON_FRAMING_UNVERIFIED");
  const { getStorageDriver } = await import("@/lib/storage");
  const documents = await prisma.amazonAdsReportDocument.findMany({ where: f.scope, orderBy: { partIndex: "asc" } });
  assert.equal(documents.length, 2);
  const cryptoScope = { ...f.scope, authorizationId: f.auth };
  for (const doc of documents) {
    assert.equal(doc.status, "ISOLATED_V1_ENCRYPTED_RAW");
    assert.equal(doc.rowCount, null);
    const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: doc.storageFileId! } });
    const stored = await getStorageDriver().getBoundedBuffer!(file.storageKey, 1024 * 1024);
    assert.equal(stored.toString().includes("fixture"), false);
    const content = decryptAmazonAdsCheckpoint<{ bytesBase64: string; contentSha256: string; byteSize: number }>(stored.toString(), cryptoScope, JSON.stringify([f.task, doc.requestId, doc.partIndex]))!;
    assert.equal(Buffer.from(content.bytesBase64, "base64").toString(), doc.partIndex === 0 ? "fixture" : "two");
    assert.equal(content.contentSha256, doc.contentSha256);
    assert.equal(BigInt(content.byteSize), doc.byteSize);
    assert.throws(() => decryptAmazonAdsCheckpoint(stored.toString(), cryptoScope, JSON.stringify([f.task, doc.requestId, doc.partIndex + 1])));
  }
  assert.equal(await prisma.amazonAdsReportFact.count({ where: f.scope }), 0);
  assert.equal(await prisma.amazonAdsReportVersion.count({ where: f.scope }), 0);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: f.scope.organizationId, action: "amazon.ads.report.v1_part_stored" } }), 2);
  await assert.rejects(f.download(), { message: "ADS_REPORT_FENCE_LOST" });
  assert.equal(f.downloads(), 2);
});

test("concurrent downloads share one persisted reservation", async () => {
  const f = await acquiredFixture();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
  const download = f.transport.download;
  f.transport.download = async input => { started(); await gate; return download(input); };
  const pending = f.download();
  try { await ready; await assert.rejects(f.download(), { message: "ADS_REPORT_OPERATION_IN_FLIGHT" }); }
  finally { release(); }
  await pending;
  assert.equal(f.downloads(), 1);
  assert.equal(await prisma.amazonAdsReportDocument.count({ where: f.scope }), 1);
});

test("download retries retain per-part budget and do not repeat an already committed part", async () => {
  const f = await acquiredFixture();
  await f.download();
  const download = f.transport.download;
  f.transport.download = async () => { throw new Error("fixture read failure"); };
  await assert.rejects(f.download(), { message: "ADS_REPORT_DOWNLOAD_FAILED" });
  assert.equal((await f.checkpoint()).calls.download, 2);
  await assert.rejects(f.download(), { message: "ADS_REPORT_POLL_NOT_DUE" });
  await f.due(); f.transport.download = download;
  assert.equal((await f.download()).phase, "RAW_STORED");
  assert.equal(f.downloads(), 2);
  assert.equal((await f.checkpoint()).calls.download, 3);
});

test("expired, empty or over-budget manifests fail without a download", async () => {
  for (const kind of ["empty", "single", "total", "expired"] as const) {
    const f = await fixture(); await f.initialize();
    f.respond(() => {
      const receipt = envelope("COMPLETED");
      const part = receipt.success[0].report.completedReportParts![0];
      if (kind === "empty") receipt.success[0].report.completedReportParts = [];
      if (kind === "single") part.sizeInBytes = 8 * 1024 * 1024 + 1;
      if (kind === "total") receipt.success[0].report.completedReportParts = Array.from({ length: 5 }, (_, i) => ({ ...part, url: `https://download.fixture.invalid/${i}`, sizeInBytes: 8 * 1024 * 1024 }));
      return receipt;
    });
    await f.step();
    if (kind === "expired") {
      const task = await f.row();
      const state = decryptAmazonAdsCheckpoint<{ parts: Array<{ urlExpirationDateTime: string }> }>(task.checkpointCiphertext, { ...f.scope, authorizationId: f.auth }, f.task)!;
      state.parts[0].urlExpirationDateTime = "2000-01-01T00:00:00Z";
      await prisma.amazonAdsSyncTask.update({ where: { id: f.task }, data: { checkpointCiphertext: encryptAmazonAdsCheckpoint(state, { ...f.scope, authorizationId: f.auth }, f.task) } });
    }
    let calls = 0;
    f.transport.download = async () => { calls++; return Buffer.from("fixture"); };
    await assert.rejects(downloadIsolatedReportingV1Part(f.scope, f.actor, f.fence, f.transport), { message: kind === "empty" ? "ADS_REPORT_V1_EMPTY_PARTS_UNVERIFIED" : kind === "expired" ? "ADS_REPORT_DOWNLOAD_EXPIRED" : "ADS_REPORT_BODY_LIMIT" });
    assert.equal(calls, 0);
    assert.equal(await prisma.amazonAdsReportDocument.count({ where: f.scope }), 0);
  }
});

test("byte mismatch blocks before storage and preserves the consumed download attempt", async () => {
  const f = await acquiredFixture();
  f.transport.download = async () => Buffer.from("short");
  await assert.rejects(f.download(), { message: "ADS_REPORT_BODY_SIZE_MISMATCH" });
  assert.equal((await f.checkpoint()).calls.download, 1);
  assert.equal((await f.row()).status, "BLOCKED");
  assert.equal(await prisma.fileObject.count({ where: f.scope }), 0);
});

test("replacement fence can retry a lost download while stale bytes cannot commit", async () => {
  const f = await acquiredFixture();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
  const download = f.transport.download;
  f.transport.download = async input => { started(); await gate; return download(input); };
  const pending = assert.rejects(f.download(), { message: "ADS_REPORT_FENCE_LOST" });
  try {
    await ready;
    f.fence.fenceVersion++;
    await prisma.amazonAdsSyncTask.update({ where: { id: f.task }, data: { fenceVersion: f.fence.fenceVersion } });
    f.transport.download = download;
    assert.equal((await f.download()).downloadedParts, 1);
  } finally { release(); }
  await pending;
  assert.equal(await prisma.amazonAdsReportDocument.count({ where: f.scope }), 1);
  assert.equal((await f.checkpoint()).calls.download, 2);
});


test("unconfirmed storage commits retain evidence and never delete an object or attach a stale file", async () => {
  const f = await acquiredFixture();
  const { getStorageDriver } = await import("@/lib/storage");
  const storage = getStorageDriver(), originalPut = storage.putBuffer;
  let key: string | undefined;
  storage.putBuffer = async input => {
    const result = await originalPut.call(storage, input);
    key = input.key;
    await prisma.amazonAdsSyncTask.update({ where: { id: f.task }, data: { fenceVersion: { increment: 1 } } });
    return result;
  };
  try { await assert.rejects(f.download(), { message: "ADS_REPORT_FENCE_LOST" }); }
  finally { storage.putBuffer = originalPut; }
  assert.equal(await prisma.amazonAdsReportDocument.count({ where: f.scope }), 0);
  assert.equal(await prisma.fileObject.count({ where: f.scope }), 0);
  assert.ok((await storage.getBoundedBuffer!(key!, 1024 * 1024)).length > 0);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: f.scope.organizationId, action: "amazon.ads.report.v1_storage_commit_unconfirmed" } });
  assert.equal(JSON.stringify(audit.metadata).includes("fixture-private"), false);
  assert.equal((audit.metadata as { storageKey: string }).storageKey, key);
});

test("storage readback corruption blocks and retains a redacted storage receipt", async () => {
  const f = await acquiredFixture();
  const { getStorageDriver } = await import("@/lib/storage");
  const storage = getStorageDriver(), originalGet = storage.getBoundedBuffer!;
  storage.getBoundedBuffer = async (key, limit) => { const bytes = await originalGet.call(storage, key, limit); bytes[0] ^= 1; return bytes; };
  try { await assert.rejects(f.download(), { message: "ADS_REPORT_FILE_INTEGRITY_MISMATCH" }); }
  finally { storage.getBoundedBuffer = originalGet; }
  assert.equal((await f.row()).status, "BLOCKED");
  assert.equal(await prisma.amazonAdsReportDocument.count({ where: f.scope }), 0);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: f.scope.organizationId, action: "amazon.ads.report.v1_storage_commit_unconfirmed" } }), 1);
});

test("a revoked authorization during download prevents storage", async () => {
  const f = await acquiredFixture();
  const download = f.transport.download;
  f.transport.download = async input => { const bytes = await download(input); await prisma.amazonAdsAuthorization.update({ where: { id: f.auth }, data: { status: "REVOKED" } }); return bytes; };
  await assert.rejects(f.download(), { message: "ADS_REPORT_PROFILE_FORBIDDEN" });
  assert.equal(await prisma.fileObject.count({ where: f.scope }), 0);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: f.scope.organizationId, action: "amazon.ads.report.v1_storage_commit_unconfirmed" } }), 0);
});

test("download retry exhaustion persists three attempts and blocks", async () => {
  const f = await acquiredFixture();
  f.transport.download = async () => { throw new Error("fixture network error"); };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await f.due();
    await assert.rejects(f.download(), { message: "ADS_REPORT_DOWNLOAD_FAILED" });
  }
  assert.equal((await f.row()).status, "BLOCKED");
  assert.equal((await f.checkpoint()).calls.download, 3);
  assert.equal(await prisma.amazonAdsReportDocument.count({ where: f.scope }), 0);
});


test("maximum local part size round-trips within the encrypted bounded-storage limit", async () => {
  const f = await fixture(); await f.initialize();
  const size = 8 * 1024 * 1024;
  f.respond(() => {
    const receipt = envelope("COMPLETED");
    receipt.success[0].report.completedReportParts = [{ ...receipt.success[0].report.completedReportParts![0], sizeInBytes: size }];
    return receipt;
  });
  await f.step();
  f.transport.download = async () => Buffer.alloc(size, 1);
  assert.equal((await downloadIsolatedReportingV1Part(f.scope, f.actor, f.fence, f.transport)).phase, "RAW_STORED");
  const doc = await prisma.amazonAdsReportDocument.findFirstOrThrow({ where: f.scope });
  assert.equal(doc.byteSize, BigInt(size));
  const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: doc.storageFileId! } });
  assert.ok(file.size! < 16 * 1024 * 1024);
  assert.equal(file.accountId, f.seller);
});

test("legacy v1 checkpoints are rejected without silently resetting consumed calls", async () => {
  const f = await fixture(); await f.initialize();
  const current = await f.row();
  const state = decryptAmazonAdsCheckpoint<Record<string, unknown>>(current.checkpointCiphertext, { ...f.scope, authorizationId: f.auth }, f.task)!;
  state.version = 1;
  await prisma.amazonAdsSyncTask.update({ where: { id: f.task }, data: { checkpointCiphertext: encryptAmazonAdsCheckpoint(state, { ...f.scope, authorizationId: f.auth }, f.task) } });
  await assert.rejects(f.step(), { message: "ADS_REPORT_V1_CHECKPOINT_INVALID" });
  assert.equal(f.calls(), 0);
});
