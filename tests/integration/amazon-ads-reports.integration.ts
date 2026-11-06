import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { prisma } from "@/lib/db/prisma";
import { stageAdsReportBatch, publishAdsReportVersion, setAdsReportVersionVisibility, type AdsReportManifest, type AdsReportFence } from "@/lib/amazon-ads/report-publication";
import { queryPublishedAdsReports } from "@/lib/amazon-ads/report-query";
import { queryAmazonAdsData } from "@/lib/amazon-ads/query-service";
import { parseAdsQuery } from "@/lib/amazon-ads/query-contract";
import { manageMcpCredential, authenticateAmazonMcp, invokeAmazonMcp } from "@/lib/amazon-sync/mcp";
import { gzipSync } from "node:zlib";
import { initializeIsolatedCampaignReport, processIsolatedCampaignReport, type IsolatedReportTransport, type AcquisitionState } from "@/lib/amazon-ads/report-acquisition";
import { campaignReportRequest, type CampaignReportSpec } from "@/lib/amazon-ads/campaign-report-contract";
import { getStorageDriver } from "@/lib/storage";
import { decryptAmazonAdsCheckpoint } from "@/lib/amazon-ads/credentials";
import { Prisma } from "@prisma/client";

if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1") throw new Error("Disposable runner required");
const scope = { organizationId: randomUUID(), workspaceId: "report-audit" }, actor = randomUUID(), seller = randomUUID();
const auth = randomUUID(), profile = randomUUID(), plan = randomUUID(), site = "ATVPDKIKX0DER";
let token = "", reportToken = "";
const originalFetch = globalThis.fetch;
async function read(campaignId?: string) {
  return queryPublishedAdsReports(scope, actor, parseAdsQuery(new URLSearchParams({ kind: "reports", profileId: profile, from: "2026-11-01", to: "2026-11-01", ...(campaignId ? { campaignId } : {}) }), new Date("2026-11-06T00:00:00Z")));
}
async function mcp() { return invokeAmazonMcp(await authenticateAmazonMcp(`Bearer ${token}`), "data_query", { table: "ads_report_daily" }) as Promise<{ data: { total: number } }>; }
before(async () => {
  globalThis.fetch = async () => { throw new Error("Real HTTP forbidden"); };
  await prisma.organization.create({ data: { id: scope.organizationId, name: "fixture", slug: scope.organizationId } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "fixture" } });
  await prisma.user.create({ data: { id: actor, name: "fixture", email: `${actor}@fixture.invalid`, passwordHash: "unused", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: seller, accountKey: seller, displayName: "fixture", marketplaceCode: "US" } });
  const spAuth = randomUUID();
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: spAuth, name: "fixture", amazonSellerId: "AUDITFIXTURE", awsRegion: "us-east-1", endpoint: "https://fixture.invalid", credentialsCiphertext: "fixture", status: "CONFIGURED", identityVerifiedAt: new Date(), updatedByUserId: actor } });
  await prisma.amazonSellerIdentity.create({ data: { ...scope, id: randomUUID(), sellerAccountId: seller, marketplaceId: site, authorizationId: spAuth, amazonSellerId: "AUDITFIXTURE", region: "us-east-1", verifiedAt: new Date() } });
  await prisma.amazonSyncDataSource.create({ data: { ...scope, id: randomUUID(), authorizationId: spAuth, sellerAccountId: seller, marketplaceId: site, resource: "catalog", freshnessMinutes: 360 } });
  await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId: actor, sellerAccountId: seller, marketplaceIds: [site], actions: ["view"], mcpEnabled: true } });
  token = (await manageMcpCredential(scope, actor, { action: "create", name: "old generic read fixture", tools: ["data_query"], scopes: [{ sellerAccountId: seller, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 86400000).toISOString() })).token!;
  reportToken = (await manageMcpCredential(scope, actor, { action: "create", name: "explicit Ads fixture", tools: ["amazon.ads.reports.list"], scopes: [{ sellerAccountId: seller, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 86400000).toISOString() })).token!;
  await prisma.amazonAdsAuthorization.create({ data: { ...scope, id: auth, name: "fixture", consentRegion: "NA", status: "CONNECTED", credentialsCiphertext: "unused", authorizedByUserId: actor } });
  await prisma.amazonAdsProfile.create({ data: { ...scope, id: profile, authorizationId: auth, region: "NA", profileId: "999999", countryCode: "US", marketplaceId: site, sellerAccountId: seller, currencyCode: "USD", timezone: "America/Los_Angeles", accountInfo: {} } });
  await prisma.amazonAdsSyncPlan.create({ data: { ...scope, id: plan, profileId: profile, sellerAccountId: seller, actorUserId: actor, authorizationRevision: 1 } });
  for (const [name, key, status, publishedAt] of [["old", "shared", "PUBLISHED", "2026-11-02"], ["new", "shared", "PUBLISHED", "2026-11-03"], ["legacy", "legacy", "LEGACY", "2026-11-04"], ["staging", "staging", "STAGING", "2026-11-05"]]) {
    const task = randomUUID(), version = randomUUID();
    await prisma.amazonAdsSyncTask.create({ data: { ...scope, id: task, planId: plan, profileId: profile, requestedByUserId: actor, planRevision: 1, idempotencyKey: task, status: "SUCCEEDED", finishedAt: new Date(`${publishedAt}T00:00:00Z`) } });
    if (status !== "LEGACY") await prisma.amazonAdsReportVersion.create({ data: { ...scope, id: version, profileId: profile, sourceTaskId: task, status, publishedAt: status === "PUBLISHED" ? new Date(`${publishedAt}T00:00:00Z`) : null, rowCount: 1 } });
    await prisma.amazonAdsReportFact.create({ data: { ...scope, id: randomUUID(), profileId: profile, sourceTaskId: task, versionId: status === "LEGACY" ? null : version, reportType: "fixture_campaign", adProduct: "SPONSORED_PRODUCTS", reportDate: new Date("2026-11-01T00:00:00Z"), factKey: key, campaignId: name, impressions: BigInt(10), clicks: BigInt(1), spend: "1.25", orders: null, sales: null, units: null, currencyCode: "USD", apiVersion: "fixture-contract-only", rawDimensions: {}, syncedAt: new Date(`${publishedAt}T00:00:00Z`) } });
  }
});
after(async () => { globalThis.fetch = originalFetch; await prisma.$disconnect(); });

test("report API must exclude legacy and superseded facts before totals and dimension filters", async () => {
  const result = await read();
  assert.equal(result.total, 1, "only latest published fact is readable; legacy/staging must be excluded");
  assert.equal((await read("old")).total, 0, "a dimension filter must not resurrect superseded facts");
});
test("report freshness must ignore newer unpublished rows", async () => {
  const result = await read();
  assert.equal(result.freshness.profiles[0]?.coveredTo, "2026-11-01");
  assert.equal(result.freshness.profiles[0]?.lastSuccessAt, "2026-11-03T00:00:00.000Z");
});
test("old generic MCP credential must not acquire report-domain access implicitly", async () => {
  await assert.rejects(mcp, /不可访问|未授权|NOT_ALLOWED/);
});
test("Ads report MCP must exclude disconnected authorization", async () => {
  await prisma.amazonAdsAuthorization.update({ where: { id: auth }, data: { status: "DISCONNECTED" } });
  try { const result = await invokeAmazonMcp(await authenticateAmazonMcp(`Bearer ${reportToken}`), "amazon.ads.reports.list", { from: "2026-11-01", to: "2026-11-01" }) as { data: { total: number } }; assert.equal(result.data.total, 0); }
  finally { await prisma.amazonAdsAuthorization.update({ where: { id: auth }, data: { status: "CONNECTED" } }); }
});

const manifest: AdsReportManifest = { evidence: "ISOLATED_FIXTURE_ONLY", reportType: "fixture_campaign", adProduct: "SPONSORED_PRODUCTS", apiVersion: "fixture-contract-only", currencyCode: "USD", attributionWindow: "7d", timezone: "America/Los_Angeles", from: "2026-11-01", to: "2026-11-01", dimensions: ["campaignId"], metrics: ["impressions", "clicks", "spend", "orders", "sales", "units"] };
const acquisitionSpec: CampaignReportSpec = { from: "2026-11-01", to: "2026-11-01", currencyCode: "USD", timezone: "America/Los_Angeles", attributionDays: 7 };
function acquisitionTransport(campaignId: string, cost = "1.250000") {
  const bytes = gzipSync(JSON.stringify([{ date: acquisitionSpec.from, campaignId, campaignBudgetCurrencyCode: "USD", impressions: 100, clicks: 10, cost, purchases7d: 0, sales7d: null, unitsSoldClicks7d: null }]));
  const calls = { create: 0, poll: 0, download: 0 };
  const id = randomUUID();
  const envelopes = new Map<string, Record<string, unknown>>();
  const envelope = (status: string) => {
    if (!envelopes.has(status)) envelopes.set(status, { reportId: id, status, startDate: acquisitionSpec.from, endDate: acquisitionSpec.to, configuration: campaignReportRequest(acquisitionSpec).configuration, ...(status === "COMPLETED" ? { url: "https://download.fixture.invalid/report?signature=fixture-only", urlExpiresAt: new Date(Date.now()+3600000).toISOString(), fileSize: bytes.length } : {}) });
    return envelopes.get(status)!;
  };
  const transport: IsolatedReportTransport = {
    evidence: "ISOLATED_FIXTURE_ONLY",
    async create(request) { calls.create++; assert.deepEqual(request, campaignReportRequest(acquisitionSpec)); return Response.json(envelope("PENDING")); },
    async poll(reportId) { calls.poll++; assert.equal(reportId, id); return Response.json(envelope("COMPLETED")); },
    async download(url) { calls.download++; assert.match(url, /download\.fixture\.invalid/); return new Response(bytes, { headers: { "Content-Length": String(bytes.length) } }); },
  };
  return { transport, calls, envelope, bytes };
}
async function acquisitionRow(taskId: string) {
  return prisma.amazonAdsReportRequest.findUniqueOrThrow({ where: { organizationId_workspaceId_idempotencyKey: { ...scope, idempotencyKey: `publication:${taskId}` } } });
}
async function editAcquisition(taskId: string, edit: (state: AcquisitionState) => void) {
  const row = await acquisitionRow(taskId);
  const options = row.requestOptions as unknown as { acquisition: AcquisitionState };
  edit(options.acquisition);
  await prisma.amazonAdsReportRequest.update({ where: { id: row.id }, data: { requestOptions: options as unknown as Prisma.InputJsonValue } });
}
async function ingestCampaign(campaignId: string, cost = "1.250000") {
  const fence = await runningReport(true);
  const fixture = acquisitionTransport(campaignId, cost);
  const initialized = await initializeIsolatedCampaignReport(scope, actor, fence, acquisitionSpec);
  assert.deepEqual(await initializeIsolatedCampaignReport(scope, actor, fence, acquisitionSpec), initialized);
  assert.equal((await processIsolatedCampaignReport(scope, actor, fence, fixture.transport)).phase, "POLL");
  await assert.rejects(() => processIsolatedCampaignReport(scope, actor, fence, fixture.transport), /POLL_NOT_DUE/);
  await editAcquisition(fence.taskId, state => { state.nextPollAt = "2000-01-01T00:00:00Z"; });
  for (const phase of ["DOWNLOAD", "STAGE", "PUBLISH", "COMPLETE"]) assert.equal((await processIsolatedCampaignReport(scope, actor, fence, fixture.transport)).phase, phase);
  assert.equal((await processIsolatedCampaignReport(scope, actor, fence, fixture.transport)).phase, "COMPLETE");
  assert.deepEqual(fixture.calls, { create: 1, poll: 1, download: 1 });
  return { fence, fixture, initialized };
}

test("isolated acquisition goes from transport to raw file, published query and MCP, then retains attribution revisions", async () => {
  const first = await ingestCampaign("7001");
  const firstRequest = await acquisitionRow(first.fence.taskId);
  const state = (firstRequest.requestOptions as unknown as { acquisition: AcquisitionState }).acquisition;
  assert.equal(state.phase, "COMPLETE");
  assert.deepEqual(state.calls, first.fixture.calls);
  assert.equal(JSON.stringify(firstRequest).includes("signature=fixture-only"), false);
  assert.equal(state.urlCiphertext, undefined);
  const evidence = await prisma.fileObject.findMany({ where: { ...scope, id: { in: state.evidenceFileIds } } });
  assert.equal(evidence.length, 2);
  for (const file of evidence) {
    const index = state.evidenceFileIds.indexOf(file.id);
    const encrypted = (await getStorageDriver().getBuffer(file.storageKey)).toString();
    assert.equal(encrypted.includes("signature=fixture-only"), false);
    const restored = decryptAmazonAdsCheckpoint<{ requestBase64: string; responseBase64: string }>(encrypted, { ...scope, authorizationId: auth }, first.fence.taskId);
    assert.ok(restored);
    const requestBytes = Buffer.from(restored.requestBase64, "base64");
    const responseBytes = Buffer.from(restored.responseBase64, "base64");
    const requestBody = index === 0 ? campaignReportRequest(acquisitionSpec) : { reportId: first.fixture.envelope("PENDING").reportId };
    const responseBody = index === 0 ? first.fixture.envelope("PENDING") : first.fixture.envelope("COMPLETED");
    assert.deepEqual(requestBytes, Buffer.from(JSON.stringify(requestBody)));
    assert.deepEqual(responseBytes, Buffer.from(JSON.stringify(responseBody)));
    assert.throws(() => decryptAmazonAdsCheckpoint(encrypted, { ...scope, authorizationId: auth }, "wrong-task"));
  }
  const document = await prisma.amazonAdsReportDocument.findFirstOrThrow({ where: { requestId: firstRequest.id } });
  const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: document.storageFileId! } });
  assert.deepEqual(await getStorageDriver().getBuffer(file.storageKey), first.fixture.bytes);
  const second = await ingestCampaign("7001", "2.500000");
  const actual = await read("7001");
  assert.equal(actual.total, 1); assert.equal(actual.rows[0].spend, "2.5");
  assert.equal(actual.rows[0].orders, "0"); assert.equal(actual.rows[0].sales, null);
  assert.equal(actual.rows[0].versionId, second.initialized.versionId);
  assert.equal(actual.rows[0].sourceTaskId, second.fence.taskId);
  assert.equal(actual.totals[0].spend, "2.5");
  const result = await invokeAmazonMcp(await authenticateAmazonMcp(`Bearer ${reportToken}`), "amazon.ads.reports.list", { from: acquisitionSpec.from, to: acquisitionSpec.to, campaignId: "7001" }) as { data: { total: number; items: Array<{ spend: string; sourceTaskId: string }> } };
  assert.equal(result.data.total, 1); assert.equal(result.data.items[0].spend, "2.5");
  assert.equal(result.data.items[0].sourceTaskId, second.fence.taskId);
  assert.equal(await prisma.amazonAdsReportFact.count({ where: { ...scope, campaignId: "7001" } }), 2);
});

test("unknown create outcome is persisted and cannot issue a second create", async () => {
  const fence = await runningReport(true); let calls = 0;
  await initializeIsolatedCampaignReport(scope, actor, fence, acquisitionSpec);
  const transport = acquisitionTransport("7002").transport;
  transport.create = async () => { calls++; throw new Error("fixture socket lost: do not expose upstream text"); };
  await assert.rejects(() => processIsolatedCampaignReport(scope, actor, fence, transport), /ACQUISITION_FAILED/);
  await assert.rejects(() => processIsolatedCampaignReport(scope, actor, fence, transport), /CREATE_RESULT_UNKNOWN/);
  assert.equal(calls, 1);
  assert.equal((await acquisitionRow(fence.taskId)).errorCode, "ADS_REPORT_CREATE_RESULT_UNKNOWN");
  assert.equal(await prisma.amazonAdsReportFact.count({ where: { ...scope, sourceTaskId: fence.taskId } }), 0);
});

test("durable budgets, deadline, scope and fixture guard stop before any transport request", async () => {
  const fence = await runningReport(true), fixture = acquisitionTransport("7003");
  await initializeIsolatedCampaignReport(scope, actor, fence, acquisitionSpec);
  await editAcquisition(fence.taskId, state => { state.calls.create = 1; });
  await assert.rejects(() => processIsolatedCampaignReport(scope, actor, fence, fixture.transport), /BUDGET/);
  await editAcquisition(fence.taskId, state => { state.calls.create = 0; state.deadline = "2000-01-01T00:00:00Z"; });
  await assert.rejects(() => processIsolatedCampaignReport(scope, actor, fence, fixture.transport), /DEADLINE/);
  await assert.rejects(() => processIsolatedCampaignReport({ ...scope, workspaceId: "another" }, actor, fence, fixture.transport), /FENCE/);
  const old = process.env.AMAZON_SYNC_OFFLINE_FIXTURE; delete process.env.AMAZON_SYNC_OFFLINE_FIXTURE;
  try { await assert.rejects(() => processIsolatedCampaignReport(scope, actor, fence, fixture.transport), /OFFLINE_ONLY/); }
  finally { process.env.AMAZON_SYNC_OFFLINE_FIXTURE = old; }
  assert.deepEqual(fixture.calls, { create: 0, poll: 0, download: 0 });
});

test("unapproved download host, expired URL and mismatched response contract never advance", async () => {
  for (const patch of [
    { url: "https://s3.amazonaws.com/not-approved" }, { url: "https://fixture.invalid@127.0.0.1/private" },
    { urlExpiresAt: "2000-01-01T00:00:00Z" }, { startDate: "2026-10-31" },
    { configuration: { format: "PARTITIONED_GZIP_JSON" } },
  ]) {
    const fence = await runningReport(true), fixture = acquisitionTransport("7004");
    await initializeIsolatedCampaignReport(scope, actor, fence, acquisitionSpec);
    fixture.transport.create = async () => Response.json({ ...fixture.envelope("COMPLETED"), ...patch });
    await assert.rejects(() => processIsolatedCampaignReport(scope, actor, fence, fixture.transport));
    assert.equal((await acquisitionRow(fence.taskId)).status, "ISOLATED_CREATE");
    assert.equal(fixture.calls.download, 0);
    assert.equal(await prisma.amazonAdsReportFact.count({ where: { ...scope, sourceTaskId: fence.taskId } }), 0);
  }
});

test("download truncation, corrupt storage and premature publish stay blocked", async () => {
  const fence = await runningReport(true), fixture = acquisitionTransport("7005");
  const init = await initializeIsolatedCampaignReport(scope, actor, fence, acquisitionSpec);
  fixture.transport.create = async () => Response.json(fixture.envelope("COMPLETED"));
  await processIsolatedCampaignReport(scope, actor, fence, fixture.transport);
  fixture.transport.download = async () => new Response(fixture.bytes.subarray(0, -1));
  await assert.rejects(() => processIsolatedCampaignReport(scope, actor, fence, fixture.transport), /SIZE_MISMATCH/);
  fixture.transport.download = async () => new Response(fixture.bytes);
  await processIsolatedCampaignReport(scope, actor, fence, fixture.transport);
  await assert.rejects(() => publishAdsReportVersion(scope, actor, fence), /EMPTY|INCOMPLETE/);
  const document = await prisma.amazonAdsReportDocument.findFirstOrThrow({ where: { requestId: init.requestId } });
  const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: document.storageFileId! } });
  await getStorageDriver().putBuffer({ key: file.storageKey, buffer: Buffer.from("corrupted fixture") });
  await assert.rejects(() => processIsolatedCampaignReport(scope, actor, fence, fixture.transport), /INTEGRITY/);
  await getStorageDriver().putBuffer({ key: file.storageKey, buffer: Buffer.concat([fixture.bytes, Buffer.alloc(1024 * 1024)]) });
  await assert.rejects(() => processIsolatedCampaignReport(scope, actor, fence, fixture.transport), /FILE_READ_REJECTED/);
  assert.equal((await prisma.amazonAdsReportVersion.findUniqueOrThrow({ where: { id: init.versionId! } })).status, "STAGING");
});

test("fenced replacement resumes reads but stale dispatch and revoked Profile cannot commit", async () => {
  const fence = await runningReport(true), fixture = acquisitionTransport("7006");
  await initializeIsolatedCampaignReport(scope, actor, fence, acquisitionSpec);
  await processIsolatedCampaignReport(scope, actor, fence, fixture.transport);
  await editAcquisition(fence.taskId, state => { delete state.nextPollAt; state.reserved = { operation: "poll", fence: fence.fenceVersion, owner: fence.leaseOwner }; state.calls.poll = 1; });
  await assert.rejects(() => processIsolatedCampaignReport(scope, actor, fence, fixture.transport), /IN_FLIGHT/);
  const replacement = { ...fence, fenceVersion: fence.fenceVersion+1, leaseOwner: "replacement-fixture" };
  await prisma.amazonAdsSyncTask.update({ where: { id: fence.taskId }, data: { fenceVersion: replacement.fenceVersion, leaseOwner: replacement.leaseOwner } });
  await assert.rejects(() => processIsolatedCampaignReport(scope, actor, fence, fixture.transport), /FENCE/);
  const originalPoll = fixture.transport.poll;
  fixture.transport.poll = async (id, signal) => { const response = await originalPoll(id, signal); await prisma.amazonAdsAuthorization.update({ where: { id: auth }, data: { status: "DISCONNECTED" } }); return response; };
  try { await assert.rejects(() => processIsolatedCampaignReport(scope, actor, replacement, fixture.transport), /FORBIDDEN/); }
  finally { await prisma.amazonAdsAuthorization.update({ where: { id: auth }, data: { status: "CONNECTED" } }); }
  assert.equal((await acquisitionRow(fence.taskId)).status, "ISOLATED_POLL");
  assert.equal(await prisma.amazonAdsReportFact.count({ where: { sourceTaskId: fence.taskId } }), 0);
});

test("isolated publication rechecks plan revision after staging even through direct publication", async () => {
  const fence = await runningReport(true), fixture = acquisitionTransport("7007");
  await initializeIsolatedCampaignReport(scope, actor, fence, acquisitionSpec);
  const completed = fixture.envelope("COMPLETED");
  completed.configuration = Object.fromEntries(Object.entries(completed.configuration as Record<string, unknown>).reverse()) as typeof completed.configuration;
  fixture.transport.create = async () => Response.json(completed);
  for (const phase of ["DOWNLOAD", "STAGE", "PUBLISH"]) assert.equal((await processIsolatedCampaignReport(scope, actor, fence, fixture.transport)).phase, phase);
  await prisma.amazonAdsSyncPlan.update({ where: { id: plan }, data: { revision: 2 } });
  try { await assert.rejects(() => publishAdsReportVersion(scope, actor, fence), /PLAN_CHANGED/); }
  finally { await prisma.amazonAdsSyncPlan.update({ where: { id: plan }, data: { revision: 1 } }); }
  assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: fence.taskId } })).status, "RUNNING");
  assert.equal((await read("7007")).total, 0);
});

test("equal-revision authorization rebind blocks transport and direct publication", async () => {
  const fence = await runningReport(true), fixture = acquisitionTransport("7008");
  await initializeIsolatedCampaignReport(scope, actor, fence, acquisitionSpec);
  const replacementAuth = randomUUID();
  await prisma.amazonAdsAuthorization.create({ data: { ...scope, id: replacementAuth, name: "fixture replacement", consentRegion: "NA", status: "CONNECTED", credentialsCiphertext: "unused", authorizedByUserId: actor } });
  await prisma.amazonAdsProfile.update({ where: { id: profile }, data: { authorizationId: replacementAuth } });
  try {
    await assert.rejects(() => processIsolatedCampaignReport(scope, actor, fence, fixture.transport), /FROZEN_SCOPE/);
    assert.deepEqual(fixture.calls, { create: 0, poll: 0, download: 0 });
  } finally { await prisma.amazonAdsProfile.update({ where: { id: profile }, data: { authorizationId: auth } }); }
  fixture.transport.create = async () => Response.json(fixture.envelope("COMPLETED"));
  for (const phase of ["DOWNLOAD", "STAGE", "PUBLISH"]) assert.equal((await processIsolatedCampaignReport(scope, actor, fence, fixture.transport)).phase, phase);
  await prisma.amazonAdsProfile.update({ where: { id: profile }, data: { authorizationId: replacementAuth } });
  try {
    await assert.rejects(() => publishAdsReportVersion(scope, actor, fence), /FROZEN_SCOPE/);
    assert.equal((await prisma.amazonAdsReportVersion.findFirstOrThrow({ where: { sourceTaskId: fence.taskId } })).status, "STAGING");
    assert.equal((await read("7008")).total, 0);
  } finally { await prisma.amazonAdsProfile.update({ where: { id: profile }, data: { authorizationId: auth } }); }
});

async function runningReport(isolated = false): Promise<AdsReportFence> {
  const taskId = randomUUID(), leaseOwner = randomUUID();
  await prisma.amazonAdsSyncTask.create({ data: { ...scope, id: taskId, planId: plan, profileId: profile, requestedByUserId: actor, planRevision: 1, idempotencyKey: taskId, trigger: isolated ? "isolated-report" : "schedule", status: "RUNNING", stage: "REPORTS_ISOLATED", requestedFrom: new Date("2026-11-01T00:00:00Z"), requestedTo: new Date("2026-11-01T00:00:00Z"), leaseOwner, leaseExpiresAt: new Date(Date.now()+60000) } });
  return { taskId, leaseOwner, dispatchVersion: 1, fenceVersion: 0 };
}
test("staging stays hidden; duplicate facts, atomic publish, revisions and rollback preserve history", async () => {
  const fence = await runningReport();
  const fact = { reportDate: "2026-11-01", dimensions: { campaignId: "publish-campaign" }, impressions: "10", clicks: "0", spend: "1.250000", orders: null, sales: null };
  const staged = await stageAdsReportBatch(scope, actor, fence, manifest, [fact, fact]);
  assert.equal(staged.rowCount, 1); assert.equal((await read("publish-campaign")).total, 0);
  assert.equal((await stageAdsReportBatch(scope, actor, fence, manifest, [fact])).versionId, staged.versionId);
  await assert.rejects(() => stageAdsReportBatch(scope, actor, fence, { ...manifest, attributionWindow: "14d" }, [fact]), /CONTRACT_CHANGED/);
  const done = await publishAdsReportVersion(scope, actor, fence);
  assert.equal(done.rowCount, 1); assert.deepEqual(await publishAdsReportVersion(scope, actor, fence), done);
  assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: fence.taskId } })).status, "SUCCEEDED");
  const first = await read("publish-campaign");
  const firstRow = first.rows[0] as { spend: string | null; clicks: string | null; sales: string | null };
  assert.equal(first.total, 1); assert.equal(firstRow.spend, "1.25"); assert.equal(firstRow.clicks, "0"); assert.equal(firstRow.sales, null);
  const newer = await runningReport();
  const next = await stageAdsReportBatch(scope, actor, newer, manifest, [{ ...fact, spend: "2.50" }]);
  await publishAdsReportVersion(scope, actor, newer);
  const afterNewPublish = await read("publish-campaign");
  assert.equal(afterNewPublish.total, 1); assert.equal((afterNewPublish.rows[0] as { spend: string | null }).spend, "2.5");
  await setAdsReportVersionVisibility(scope, actor, next.versionId, false);
  assert.equal(((await read("publish-campaign")).rows[0] as { spend: string | null }).spend, "1.25");
  await setAdsReportVersionVisibility(scope, actor, next.versionId, true);
  assert.equal(((await read("publish-campaign")).rows[0] as { spend: string | null }).spend, "2.5");
  assert.equal(await prisma.amazonAdsReportFact.count({ where: { ...scope, versionId: { in: [staged.versionId, next.versionId] } } }), 2);
});
test("canceled/failed, stale fence, invalid and empty report batches cannot publish", async () => {
  const fact = { reportDate: "2026-11-01", dimensions: { campaignId: "blocked-campaign" }, spend: "0" };
  const fence = await runningReport();
  await assert.rejects(() => stageAdsReportBatch(scope, actor, fence, manifest, []), /BATCH_BOUNDS/);
  await assert.rejects(() => stageAdsReportBatch(scope, actor, fence, manifest, [{ ...fact, spend: "NaN" }]), /METRIC_INVALID/);
  await assert.rejects(() => stageAdsReportBatch(scope, actor, fence, manifest, [fact, { ...fact, reportDate: "2026-11-02" }]), /OUT_OF_RANGE/);
  assert.equal(await prisma.amazonAdsReportVersion.count({ where: { ...scope, sourceTaskId: fence.taskId } }), 0);
  const staged = await stageAdsReportBatch(scope, actor, fence, manifest, [fact]);
  await assert.rejects(() => publishAdsReportVersion(scope, actor, { ...fence, fenceVersion: 99 }), /FENCE_LOST/);
  for (const status of ["CANCELED", "FAILED"]) {
    await prisma.amazonAdsSyncTask.update({ where: { id: fence.taskId }, data: { status } });
    await assert.rejects(() => publishAdsReportVersion(scope, actor, fence), /FENCE_LOST/);
    assert.equal((await read("blocked-campaign")).total, 0);
  }
  await prisma.amazonAdsSyncTask.update({ where: { id: fence.taskId }, data: { status: "RUNNING" } });
  await prisma.amazonAdsReportFact.updateMany({ where: { versionId: staged.versionId }, data: { currencyCode: "EUR" } });
  await assert.rejects(() => publishAdsReportVersion(scope, actor, fence), /VALIDATION_FAILED/);
  assert.equal((await prisma.amazonAdsReportVersion.findUniqueOrThrow({ where: { id: staged.versionId } })).status, "STAGING");
  assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: fence.taskId } })).status, "RUNNING");
});
test("publish and restore reject every stored metric outside the declared contract", async () => {
  for (const metric of ["impressions", "clicks", "orders", "units", "spend", "sales"] as const) {
    const fence = await runningReport();
    const declared = metric === "impressions" ? "clicks" : "impressions";
    const partial: AdsReportManifest = { ...manifest, metrics: [declared] };
    const staged = await stageAdsReportBatch(scope, actor, fence, partial, [{ reportDate: manifest.from, dimensions: { campaignId: `contract-${metric}` }, [declared]: "1" }]);
    const where = { ...scope, versionId: staged.versionId };
    await prisma.amazonAdsReportFact.updateMany({ where, data: { [metric]: "1" } });
    await assert.rejects(() => publishAdsReportVersion(scope, actor, fence), /METRIC_NOT_IN_CONTRACT/);
    assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: fence.taskId } })).status, "RUNNING");
    assert.equal((await read(`contract-${metric}`)).total, 0);
    await prisma.amazonAdsReportFact.updateMany({ where, data: { [metric]: null } });
    await publishAdsReportVersion(scope, actor, fence);
    await setAdsReportVersionVisibility(scope, actor, staged.versionId, false);
    await prisma.amazonAdsReportFact.updateMany({ where, data: { [metric]: "1" } });
    await assert.rejects(() => setAdsReportVersionVisibility(scope, actor, staged.versionId, true), /METRIC_NOT_IN_CONTRACT/);
    assert.equal((await prisma.amazonAdsReportVersion.findUniqueOrThrow({ where: { id: staged.versionId } })).status, "WITHDRAWN");
    assert.equal((await read(`contract-${metric}`)).total, 0);
  }
});

test("visibility rechecks task state after waiting for the publication lock", async () => {
  const fence = await runningReport();
  const staged = await stageAdsReportBatch(scope, actor, fence, manifest, [{ reportDate: manifest.from, dimensions: { campaignId: "visibility-race" }, spend: "1" }]);
  await publishAdsReportVersion(scope, actor, fence);
  await setAdsReportVersionVisibility(scope, actor, staged.versionId, false);
  let release = () => {}, ready = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; }), acquired = new Promise<void>(resolve => { ready = resolve; });
  const lock = prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-report:${fence.taskId}`}, 0))`;
    ready(); await gate;
  }, { timeout: 10000 });
  await acquired;
  const pending = setAdsReportVersionVisibility(scope, actor, staged.versionId, true).then(value => ({ value, error: null }), error => ({ value: null, error }));
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock%') AS waiting`;
      if (rows[0].waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, "restore must reach the held advisory lock");
    await prisma.amazonAdsSyncTask.update({ where: { id: fence.taskId }, data: { status: "FAILED" } });
  } finally { release(); await lock; }
  const result = await pending;
  assert.match(String(result.error), /VISIBILITY_INVALID/); assert.equal(result.value, null);
  assert.equal((await prisma.amazonAdsReportVersion.findUniqueOrThrow({ where: { id: staged.versionId } })).status, "WITHDRAWN");
  assert.equal((await read("visibility-race")).total, 0);
});

test("API and explicit Ads MCP share totals, nullable fields, versions and bounded filtering", async () => {
  const input = { from: "2026-11-01", to: "2026-11-01", reportType: "fixture_campaign", pageSize: 1, page: 2, sortBy: "campaignId", sortDirection: "asc" };
  const api = await queryAmazonAdsData(scope, actor, parseAdsQuery(new URLSearchParams({ kind: "reports", ...Object.fromEntries(Object.entries(input).map(([key,value]) => [key,String(value)])) })));
  const data = await invokeAmazonMcp(await authenticateAmazonMcp(`Bearer ${reportToken}`), "amazon.ads.reports.list", input) as { data: { total: number; items: unknown[] }; meta: { page: { hasNext: boolean } } };
  assert.equal(data.data.total, api.total); assert.deepEqual(data.data.items, api.rows); assert.equal(data.data.items.length, 1);
  assert.ok(!JSON.stringify(data).includes('"rawDimensions"')); assert.ok(!JSON.stringify(data).includes('"null"'));
  await assert.rejects(async () => invokeAmazonMcp(await authenticateAmazonMcp(`Bearer ${reportToken}`), "amazon.ads.reports.list", { ...input, pageSize: 101 }));
  const outside = await queryPublishedAdsReports(scope, actor, parseAdsQuery(new URLSearchParams({ kind: "reports", profileId: "other-internal-profile", from: "2026-11-01", to: "2026-11-01" })));
  assert.equal(outside.total, 0); assert.deepEqual(outside.meta.profiles, []);
});

test("large aggregates stay exact and do not block API or MCP paginated reads", async () => {
  const fence = await runningReport();
  const reportType = "fixture_large_totals";
  const maximum = "9223372036854775807";
  await stageAdsReportBatch(scope, actor, fence, { ...manifest, reportType }, Array.from({ length: 110 }, (_, index) => ({
    reportDate: manifest.from, dimensions: { campaignId: `large-${index}` }, impressions: maximum, clicks: maximum, orders: maximum, units: maximum, spend: "99999999999999.999999", sales: null,
  })));
  await publishAdsReportVersion(scope, actor, fence);
  const params = { from: manifest.from, to: manifest.to, reportType, internalProfileId: profile, pageSize: "1" };
  const api = await queryAmazonAdsData(scope, actor, parseAdsQuery(new URLSearchParams({ kind: "reports", ...params })));
  assert.equal(api.total, 110); assert.equal(api.rows.length, 1);
  assert.ok(api.totals);
  assert.equal(api.totals.length, 1);
  for (const field of ["impressions", "clicks", "orders", "units"] as const) assert.equal(api.totals[0][field], (BigInt(maximum) * BigInt(110)).toString());
  assert.equal(api.totals[0].spend, "10999999999999999.99989"); assert.equal(api.totals[0].sales, null);
  const response = await invokeAmazonMcp(await authenticateAmazonMcp(`Bearer ${reportToken}`), "amazon.ads.reports.list", { ...params, pageSize: 1 }) as { data: { items: unknown[]; total: number } };
  assert.deepEqual(response.data.items, api.rows); assert.equal(response.data.total, 110);
});

test("revision selection and totals keep currency, API and attribution contracts separate", async () => {
  const reportType = "fixture_contract_partitions";
  const contracts = [
    { currencyCode: "USD", apiVersion: "fixture-v1", attributionWindow: "7d", spend: "2" },
    { currencyCode: "EUR", apiVersion: "fixture-v1", attributionWindow: "7d", spend: "3" },
    { currencyCode: "USD", apiVersion: "fixture-v2", attributionWindow: "7d", spend: "4" },
    { currencyCode: "USD", apiVersion: "fixture-v1", attributionWindow: "14d", spend: "5" },
  ];
  // Deliberately identical legacy fact keys: explicit contract columns must still isolate revisions.
  for (const [index, contract] of [contracts[0], ...contracts].entries()) {
    const task = randomUUID(), version = randomUUID();
    await prisma.amazonAdsSyncTask.create({ data: { ...scope, id: task, planId: plan, profileId: profile, requestedByUserId: actor, planRevision: 1, idempotencyKey: task, status: "SUCCEEDED" } });
    await prisma.amazonAdsReportVersion.create({ data: { ...scope, id: version, profileId: profile, sourceTaskId: task, status: "PUBLISHED", publishedAt: new Date(`2026-11-0${index+1}T00:00:00Z`), rowCount: 1 } });
    await prisma.amazonAdsReportFact.create({ data: { ...scope, id: randomUUID(), versionId: version, profileId: profile, sourceTaskId: task, reportType, adProduct: manifest.adProduct, reportDate: new Date(`${manifest.from}T00:00:00Z`), factKey: "same-grain", campaignId: index === 0 ? "superseded-contract" : "current-contract", ...contract, spend: index === 0 ? "999" : contract.spend, rawDimensions: {} } });
  }
  const input = parseAdsQuery(new URLSearchParams({ kind: "reports", from: manifest.from, to: manifest.to, reportType, internalProfileId: profile }));
  const result = await queryPublishedAdsReports(scope, actor, input);
  assert.equal(result.total, 4); assert.equal(result.totals.length, 4);
  const key = (row: { currencyCode: string | null; apiVersion: string; attributionWindow: string | null }) => JSON.stringify([row.currencyCode, row.apiVersion, row.attributionWindow]);
  assert.deepEqual(new Map(result.totals.map(row => [key(row), row.spend])), new Map(contracts.map(row => [key(row), row.spend])));
  assert.ok(result.totals.every(row => row.sales === null));
  assert.equal((await queryPublishedAdsReports(scope, actor, { ...input, campaignId: "superseded-contract" })).total, 0);
});

test("a publication transaction failure rolls back task success and leaves staging invisible", async () => {
  const fence = await runningReport();
  const staged = await stageAdsReportBatch(scope, actor, fence, manifest, [{ reportDate: "2026-11-01", dimensions: { campaignId: "atomic-campaign" }, spend: "3.5" }]);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_reject_ads_publish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='PUBLISHED' THEN RAISE EXCEPTION 'fixture publication failure'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER fixture_reject_ads_publish BEFORE UPDATE ON "AmazonAdsReportVersion" FOR EACH ROW EXECUTE FUNCTION fixture_reject_ads_publish()');
  try { await assert.rejects(() => publishAdsReportVersion(scope, actor, fence)); }
  finally { await prisma.$executeRawUnsafe('DROP TRIGGER fixture_reject_ads_publish ON "AmazonAdsReportVersion"'); await prisma.$executeRawUnsafe('DROP FUNCTION fixture_reject_ads_publish()'); }
  assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: fence.taskId } })).status, "RUNNING");
  assert.equal((await prisma.amazonAdsReportVersion.findUniqueOrThrow({ where: { id: staged.versionId } })).status, "STAGING");
  assert.equal((await read("atomic-campaign")).total, 0);
  await publishAdsReportVersion(scope, actor, fence);
  assert.equal((await read("atomic-campaign")).total, 1);
});
test("Ads report response is withheld when a grant is revoked during the actual SQL read", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${reportToken}`);
  let release = () => {}, ready = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; }), acquired = new Promise<void>(resolve => { ready = resolve; });
  const lock = prisma.$transaction(async tx => { await tx.$executeRawUnsafe('LOCK TABLE "AmazonAdsReportFact" IN ACCESS EXCLUSIVE MODE'); ready(); await gate; }, { timeout: 10000 });
  await acquired;
  const pending = invokeAmazonMcp(identity, "amazon.ads.reports.list", { from: "2026-11-01", to: "2026-11-01" }).then(value => ({ value, error: null }), error => ({ value: null, error }));
  try {
    let waiting = false;
    for (let attempt=0; attempt<100; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%AmazonAdsReportFact%' AND query LIKE 'SELECT%') AS waiting`;
      if (rows[0].waiting) { waiting=true; break; }
      await new Promise(resolve => setTimeout(resolve,10));
    }
    assert.ok(waiting);
    await prisma.amazonDataAccessGrant.updateMany({ where: { ...scope, userId: actor }, data: { enabled: false } });
  } finally { release(); await lock; }
  const result = await pending;
  assert.ok(result.error); assert.equal(result.value,null);
  await prisma.amazonDataAccessGrant.updateMany({ where: { ...scope, userId: actor }, data: { enabled: true } });
});
test("offline publication guard refuses execution outside the isolated fixture environment", async () => {
  const prior = process.env.AMAZON_SYNC_OFFLINE_FIXTURE;
  delete process.env.AMAZON_SYNC_OFFLINE_FIXTURE;
  try { await assert.rejects(() => publishAdsReportVersion(scope, actor, { taskId: "unused", leaseOwner: "unused", dispatchVersion: 1, fenceVersion: 0 }), /NOT_ENABLED/); }
  finally { process.env.AMAZON_SYNC_OFFLINE_FIXTURE = prior; }
});

test("authenticated report API shares the published boundary and denies unauthenticated reads", async () => {
  const { GET } = await import("../../src/app/api/integrations/amazon/ads/data/route");
  const { createSession } = await import("../../src/lib/auth/session");
  assert.equal((await GET(new Request("http://localhost/api/integrations/amazon/ads/data?kind=reports"))).status, 401);
  const session = await createSession(actor);
  const headers = { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}`, "x-workspace-id": scope.workspaceId };
  const params = new URLSearchParams({ kind: "reports", internalProfileId: profile, from: "2026-11-01", to: "2026-11-01", campaignId: "publish-campaign" });
  const response = await GET(new Request(`http://localhost/api/integrations/amazon/ads/data?${params}`, { headers }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, 1); assert.equal(body.rows[0].spend, "2.5"); assert.equal(body.rows[0].versionStatus, "PUBLISHED");
  assert.equal(body.rows[0].rawDimensions, undefined); assert.equal(body.rows[0].sales, null);
});
