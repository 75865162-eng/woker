// Cloud role for injected offline HTTP fixtures; no real Amazon calls.
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { before, after, test } from "node:test";
import { prisma } from "@/lib/db/prisma";
import { encryptAmazonAdsRefreshToken, encryptAmazonAdsCheckpoint, decryptAmazonAdsCheckpoint } from "@/lib/amazon-ads/credentials";
import { createSponsoredProductsReadAdapter, type AdsReadAdapter } from "@/lib/amazon-ads/sync-adapter";
import { processAmazonAdsSyncTask } from "@/lib/amazon-ads/sync-processor";
import { queryAdsEntities, parseAdsEntityQuery } from "@/lib/amazon-ads/data-query";
import { AmazonAdsConnectionError, createAmazonAdsOAuthTransport } from "@/lib/amazon-ads/oauth-contract";
import { AdsSyncError } from "@/lib/amazon-ads/sync-policy";
import { getAmazonSyncQueue, type AmazonSyncQueueJob } from "@/lib/queue/redis-queue";
import { queryAmazonAdsData, withAdsQueryReadSnapshot } from "@/lib/amazon-ads/query-service";
import { parseAdsQuery } from "@/lib/amazon-ads/query-contract";
import { createAmazonAdsRepository } from "@/lib/amazon-ads/repository";
import { amazonDataAccess } from "@/lib/amazon-sync/data-access";
import { bindAmazonAdsProfile, disconnectAmazonAdsAuthorization, finishAmazonAdsOAuth } from "@/lib/amazon-ads/authorization";

if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1") throw new Error("Disposable runner required");
const scope = { organizationId: randomUUID(), workspaceId: "main" };
const owner = randomUUID(), member = randomUUID(), siteViewer = randomUUID(), seller = randomUUID(), auth = randomUUID();
const site = "ATVPDKIKX0DER";
const credentialScope = { ...scope, authorizationId: auth };
let profile: string, plan: string, otherProfile: string, secondPlan: string;
let http = 0, refreshes = 0;
const payloads: Record<string, [string, Record<string, unknown>]> = {
  "/sp/campaigns/list": ["campaigns", { campaignId: "101", name: "Stored Alpha", state: "ARCHIVED", targetingType: "MANUAL", startDate: "2026-11-01", budget: { budget: 25, budgetType: "DAILY" } }],
  "/sp/productAds/list": ["productAds", { adId: "701", campaignId: "101", adGroupId: "201", sku: "fixture-sku", state: "ENABLED" }],
  "/sp/adGroups/list": ["adGroups", { adGroupId: "201", campaignId: "101", name: "Stored Group", defaultBid: 0.7, state: "ENABLED" }],
  "/sp/keywords/list": ["keywords", { keywordId: "301", campaignId: "101", adGroupId: "201", keywordText: "fixture keyword", matchType: "EXACT", state: "ENABLED" }],
  "/sp/targets/list": ["targetingClauses", { targetId: "401", campaignId: "101", adGroupId: "201", expression: [], resolvedExpression: [], expressionType: "MANUAL", state: "PAUSED" }],
  "/sp/negativeKeywords/list": ["negativeKeywords", { keywordId: "501", campaignId: "101", adGroupId: "201", keywordText: "negative", matchType: "NEGATIVE_EXACT", state: "ENABLED" }],
  "/sp/negativeTargets/list": ["negativeTargetingClauses", { targetId: "601", campaignId: "101", adGroupId: "201", expression: [], resolvedExpression: [], state: "ENABLED" }],
  "/sp/campaignNegativeKeywords/list": ["campaignNegativeKeywords", { keywordId: "501", campaignId: "101", keywordText: "negative", matchType: "NEGATIVE_PHRASE", state: "ENABLED" }],
  "/sp/campaignNegativeTargets/list": ["campaignNegativeTargetingClauses", { targetId: "601", campaignId: "101", expression: [], resolvedExpression: [], state: "ENABLED" }],
};
const adapter = createSponsoredProductsReadAdapter(async (url, init) => {
  http++;
  assert.equal(new URL(String(url)).host, "advertising-api-eu.amazon.com");
  assert.ok(["999", "888", "777"].includes(new Headers(init?.headers).get("Amazon-Advertising-API-Scope")!));
  const [key, row] = payloads[new URL(String(url)).pathname];
  return new Response(JSON.stringify({ [key]: [{ ...row, extendedData: { lastUpdateDateTime: "2026-11-06T01:00:00Z" } }] }));
});
const oauth = { ...createAmazonAdsOAuthTransport(), async refreshAccessToken() { refreshes++; return "fixture-access"; } };
async function newTask(p = plan, prof = profile, createdAt = new Date()) {
  return prisma.amazonAdsSyncTask.create({ data: { ...scope, id: randomUUID(), planId: p, profileId: prof, requestedByUserId: owner, planRevision: 1, idempotencyKey: randomUUID(), createdAt } });
}
async function drain(id: string, reader: AdsReadAdapter = adapter) {
  for (let i = 0; i < 20; i++) {
    const task = await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id } });
    if (task.status === "SUCCEEDED") return task;
    await processAmazonAdsSyncTask(id, task.dispatchVersion, { adapter: reader, oauth });
  }
  throw new Error("Task did not complete");
}
before(async () => {
  process.env.AMAZON_ADS_SYNC_ENABLED = "true";
  process.env.AMAZON_ADS_SYNC_SCOPES = JSON.stringify([[scope.organizationId, scope.workspaceId]]);
  await prisma.organization.create({ data: { id: scope.organizationId, name: "Fixture", slug: scope.organizationId } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Fixture" } });
  for (const [id, role] of [[owner, "owner"], [member, "operations"], [siteViewer, "viewer"]] as const) await prisma.user.create({ data: { id, name: "Fixture", email: `${id}@fixture.invalid`, passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role } } } });
  await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: "operations", name: "Fixture", description: "Fixture", permissions: { operations: ["view"], workspace: ["view"] } } });
  await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: "viewer", name: "Ads viewer", description: "Fixture settings reader", permissions: { settings: ["view"], operations: ["view"], workspace: ["view"] } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: seller, accountKey: seller, displayName: "Fixture store", marketplaceCode: "US" } });
  await prisma.amazonAdsAuthorization.create({ data: { ...scope, id: auth, name: "Fixture Ads", consentRegion: "EU", status: "CONNECTED", credentialsCiphertext: encryptAmazonAdsRefreshToken("fixture-token", credentialScope), authorizedByUserId: owner } });
  for (const external of ["999", "888"]) {
    const prof = await prisma.amazonAdsProfile.create({ data: { ...scope, id: randomUUID(), authorizationId: auth, region: "EU", profileId: external, countryCode: "US", marketplaceId: external === "999" ? site : "A2EUQ1WTGCTBG2", sellerAccountId: seller, currencyCode: "USD", timezone: "America/Los_Angeles", accountInfo: {} } });
    const p = await prisma.amazonAdsSyncPlan.create({ data: { ...scope, id: randomUUID(), profileId: prof.id, actorUserId: owner, sellerAccountId: seller, authorizationRevision: 1, status: "ACTIVE" } });
    if (external === "999") { profile = prof.id; plan = p.id; } else { otherProfile = prof.id; secondPlan = p.id; }
  }
  await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId: member, sellerAccountId: seller, marketplaceIds: [site], actions: ["view"] } });
  await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId: siteViewer, sellerAccountId: seller, marketplaceIds: [site], actions: ["view"] } });
});
after(async () => { await getAmazonSyncQueue().close(); await prisma.$disconnect(); });

async function assertEntityResponseWithheld(change: () => Promise<unknown>, restore: () => Promise<unknown>, actor = owner) {
  const repository = createAmazonAdsRepository();
  let audits = 0;
  try {
    await assert.rejects(() => queryAmazonAdsData(scope, actor, parseAdsQuery(new URLSearchParams({ kind: "entities", internalProfileId: profile, pageSize: "1" })), {
      repository: { ...repository, async listEntities(where, input) {
        const rows = await repository.listEntities(where, input);
        assert.ok(rows.length, "fixture must read actual stored rows before changing the boundary");
        await change();
        return rows;
      } },
      resolveAccess: (scope, actor) => amazonDataAccess(scope, actor),
      audit: async () => { audits++; },
    }), error => error instanceof Error && "status" in error && error.status === 403);
    assert.equal(audits, 0, "a denied response must not be recorded as a successful read");
  } finally { await restore(); }
}

test("nine real adapter collections persist via worker, checkpoint, queue and remain Profile isolated", async () => {
  const task = await newTask();
  const done = await drain(task.id);
  assert.equal(done.stage, "COMPLETED_SP_STRUCTURE"); assert.equal(done.apiRequests, 9); assert.equal(done.processedCount, 9);
  const attempts = await prisma.amazonAdsSyncAttempt.findMany({ where: { ...scope, taskId: task.id }, orderBy: { attemptNumber: "asc" } });
  assert.equal(attempts.length, 9);
  assert.ok(attempts.every(attempt => attempt.status === "SUCCEEDED" && attempt.apiRequests === 1 && attempt.processedCount === 1));
  assert.equal((await prisma.amazonAdsSyncDomainState.findUniqueOrThrow({ where: { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: profile, dataDomain: "entities", reportType: "" } } })).status, "CURRENT");
  assert.equal(await prisma.amazonAdsEntityRecord.count({ where: { ...scope, profileId: profile } }), 9);
  await drain((await newTask(secondPlan, otherProfile)).id);
  assert.equal(await prisma.amazonAdsEntityRecord.count({ where: scope }), 18);
  const data = await queryAdsEntities(scope, member, new URLSearchParams({ pageSize: "2", sort: "externalId", direction: "desc" }));
  assert.equal(data.total, 9); assert.equal(data.rows.length, 2); assert.ok(data.rows.every(r => r.profileId === profile && r.amazonProfileId === "999"));
  const forbidden = await queryAdsEntities(scope, member, new URLSearchParams({ internalProfileId: otherProfile })); assert.equal(forbidden.total, 0);
  assert.equal((await queryAdsEntities(scope, member, new URLSearchParams({ campaignId: "101", adGroupId: "201" }))).total, 6);
  assert.equal((await queryAdsEntities(scope, member, new URLSearchParams({ search: "Stored Alpha", state: "ARCHIVED" }))).total, 1);
  assert.equal((await queryAdsEntities(scope, member, new URLSearchParams({ entityType: "SP:campaign-negative-keyword" }))).rows[0].parentExternalId, "101");
  assert.throws(() => parseAdsEntityQuery(new URLSearchParams({ sort: "payload" })), /排序/);
  assert.throws(() => parseAdsEntityQuery(new URLSearchParams({ from: "2026-01-01" })), /日期/);
});

test("429 retains checkpoint, retries and duplicate dispatch does not commit twice", async () => {
  const task = await newTask();
  const lastSuccessBefore = await prisma.amazonAdsSyncDomainState.findUnique({ where: { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: profile, dataDomain: "entities", reportType: "" } }, select: { lastSuccessAt: true } });
  await assert.rejects(processAmazonAdsSyncTask(task.id, 1, { oauth, adapter: { assertImplemented() {}, async readPage() { throw new AdsSyncError("ADS_CAMPAIGN_HTTP_429", true, 100); } } }));
  const failed = await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(failed.status, "RETRY_WAIT"); assert.equal(failed.checkpointCiphertext, null);
  assert.equal((await prisma.amazonAdsSyncAttempt.findUniqueOrThrow({ where: { organizationId_workspaceId_taskId_attemptNumber: { ...scope, taskId: task.id, attemptNumber: 1 } } })).status, "RETRY_WAIT");
  const failedDomain = await prisma.amazonAdsSyncDomainState.findUniqueOrThrow({ where: { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: profile, dataDomain: "entities", reportType: "" } } });
  assert.equal(failedDomain.status, "RETRY_WAIT");
  assert.equal(failedDomain.lastSuccessAt?.toISOString() ?? null, lastSuccessBefore?.lastSuccessAt?.toISOString() ?? null);
  assert.equal((await prisma.amazonAdsSyncAttempt.findUniqueOrThrow({ where: { organizationId_workspaceId_taskId_attemptNumber: { ...scope, taskId: task.id, attemptNumber: 1 } } })).apiRequests, 1);
  await prisma.amazonAdsSyncTask.update({ where: { id: task.id }, data: { nextAttemptAt: new Date(0) } });
  await prisma.amazonAdsApiBudget.updateMany({ data: { nextRequestAt: new Date(0) } });
  await Promise.all([processAmazonAdsSyncTask(task.id, failed.dispatchVersion, { oauth, adapter }), processAmazonAdsSyncTask(task.id, failed.dispatchVersion, { oauth, adapter })]);
  const progress = await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: task.id } }); assert.equal(progress.apiRequests, 1);
  assert.equal(await prisma.amazonAdsSyncAttempt.count({ where: { ...scope, taskId: task.id } }), 2);
  await drain(task.id);
});

test("expired lease fences page commit and report checkpoint fails before token refresh", async () => {
  const task = await newTask(); const before = http;
  await processAmazonAdsSyncTask(task.id, 1, { oauth, adapter: { assertImplemented() {}, async readPage(input) { await prisma.amazonAdsSyncTask.update({ where: { id: task.id }, data: { leaseExpiresAt: new Date(0) } }); return adapter.readPage(input); } } });
  assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: task.id } })).status, "BLOCKED");
  assert.equal(http, before + 1);
  await prisma.amazonAdsSyncPlan.update({ where: { id: plan }, data: { status: "ACTIVE" } });
  const report = await newTask();
  await prisma.amazonAdsSyncTask.update({ where: { id: report.id }, data: { checkpointCiphertext: encryptAmazonAdsCheckpoint({ stage: 5, cursor: null, pages: 0 }, credentialScope, report.id) } });
  const refreshBefore = refreshes;
  await processAmazonAdsSyncTask(report.id, 1, { oauth, adapter });
  assert.equal(refreshes, refreshBefore);
  assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: report.id } })).errorCode, "ADS_REPORT_ADAPTER_NOT_IMPLEMENTED");
});

test("older tasks cannot overwrite newer current snapshots or infer deletion", async () => {
  await prisma.amazonAdsSyncPlan.update({ where: { id: plan }, data: { status: "ACTIVE" } });
  const task = await newTask(plan, profile, new Date(0));
  await drain(task.id);
  const rows = await prisma.amazonAdsEntityRecord.findMany({ where: { ...scope, profileId: profile } });
  assert.ok(rows.every(row => row.sourceTaskId !== task.id));
  assert.equal(rows.length, 9);
  const cp = decryptAmazonAdsCheckpoint<{ stage: number }>((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: task.id } })).checkpointCiphertext, credentialScope, task.id);
  assert.equal(cp?.stage, 5);
});

test("authenticated data API returns server totals, bounded filters and denies missing sessions", async () => {
  const { GET } = await import("../../src/app/api/integrations/amazon/ads/data/route");
  const { createSession } = await import("../../src/lib/auth/session");
  assert.equal((await GET(new Request("http://localhost/api/integrations/amazon/ads/data"))).status, 401);
  const session = await createSession(owner);
  const headers = { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}`, "x-workspace-id": scope.workspaceId };
  const request = (query: string) => GET(new Request(`http://localhost/api/integrations/amazon/ads/data?${query}`, { headers }));
  const response = await request(`internalProfileId=${profile}&pageSize=2&sort=externalId`);
  assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.total, 9); assert.equal(result.rows.length, 2); assert.equal(result.source, "amazon_ads_postgres");
  assert.equal((await request("page=1.5")).status, 400);
  assert.equal((await request("sort=credentialsCiphertext")).status, 400);
  assert.equal((await request("from=2026-01-01")).status, 400);
  const unknown = await request("internalProfileId=foreign"); assert.equal(unknown.status, 403);
  const { GET: syncStatus } = await import("../../src/app/api/integrations/amazon/ads/sync/route");
  const syncResponse = await syncStatus(new Request("http://localhost/api/integrations/amazon/ads/sync", { headers }));
  assert.equal(syncResponse.status, 200);
  const syncPayload = await syncResponse.json() as { plans: Array<{ profileId: string; tasks: Array<{ attemptRuns: Array<{ apiRequests: number }> }> }>; freshness: Array<{ profileId: string; dataDomain: string }> };
  assert.ok(syncPayload.plans.every(row => [profile, otherProfile].includes(row.profileId)));
  assert.ok(syncPayload.freshness.every(row => [profile, otherProfile].includes(row.profileId)));
  assert.ok(JSON.stringify(syncPayload).includes("attemptRuns"));
  assert.ok(!JSON.stringify(syncPayload).includes("checkpointCiphertext"));
  assert.ok(!JSON.stringify(syncPayload).includes("leaseOwner"));
  const viewerSession = await createSession(siteViewer);
  const viewerHeaders = { cookie: `${viewerSession.sessionCookie.name}=${viewerSession.sessionCookie.value}`, "x-workspace-id": scope.workspaceId };
  const { GET: listAdsProfiles } = await import("../../src/app/api/integrations/amazon/ads/profiles/route");
  const profileListResponse = await listAdsProfiles(new Request("http://localhost/api/integrations/amazon/ads/profiles", { headers: viewerHeaders }));
  assert.equal(profileListResponse.status, 200);
  const profileList = await profileListResponse.json() as { profiles: Array<{ profileId: string }>; sellers: Array<{ id: string }> };
  assert.deepEqual(profileList.profiles.map(item => item.profileId), ["999"]);
  assert.deepEqual(profileList.sellers.map(item => item.id), [seller]);
  const scopedSync = await syncStatus(new Request(`http://localhost/api/integrations/amazon/ads/sync?profileId=${profile}&status=SUCCEEDED&page=1&pageSize=1`, { headers: viewerHeaders }));
  assert.equal(scopedSync.status, 200);
  const scopedPayload = await scopedSync.json() as { plans: Array<{ profileId: string }>; taskHistory: Array<{ profileId: string; status: string }>; taskPagination: { page: number; pageSize: number; total: number; hasMore: boolean } };
  assert.ok(scopedPayload.plans.every(row => row.profileId === profile));
  assert.equal(scopedPayload.taskHistory.length, 1);
  assert.ok(scopedPayload.taskHistory.every(row => row.profileId === profile && row.status === "SUCCEEDED"));
  assert.equal(scopedPayload.taskPagination.page, 1); assert.equal(scopedPayload.taskPagination.pageSize, 1);
  assert.ok(scopedPayload.taskPagination.total >= 1);
  const hiddenSync = await syncStatus(new Request(`http://localhost/api/integrations/amazon/ads/sync?profileId=${otherProfile}`, { headers: viewerHeaders }));
  assert.equal(hiddenSync.status, 200);
  const hiddenPayload = await hiddenSync.json() as { plans: Array<{ profileId: string }>; taskHistory: Array<{ profileId: string }>; taskPagination: { total: number } };
  assert.deepEqual(hiddenPayload.plans, []); assert.deepEqual(hiddenPayload.taskHistory, []); assert.equal(hiddenPayload.taskPagination.total, 0);
  assert.equal((await syncStatus(new Request("http://localhost/api/integrations/amazon/ads/sync?status=not-a-state", { headers: viewerHeaders }))).status, 400);
  assert.equal((await syncStatus(new Request("http://localhost/api/integrations/amazon/ads/sync?pageSize=101", { headers: viewerHeaders }))).status, 400);
});

test("task detail API paginates attempts and exposes only scoped report provenance fields", async () => {
  const { GET } = await import("../../src/app/api/integrations/amazon/ads/sync/route");
  const { createSession } = await import("../../src/lib/auth/session");
  const session = await createSession(siteViewer);
  const headers = { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}`, "x-workspace-id": scope.workspaceId };
  const task = await newTask(plan, profile);
  await prisma.amazonAdsSyncTask.update({ where: { id: task.id }, data: { status: "FAILED", finishedAt: new Date(), checkpointCiphertext: "checkpoint-secret-marker", leaseOwner: "worker-secret-marker", errorMessage: "raw-error-secret-marker" } });
  await prisma.amazonAdsSyncAttempt.createMany({ data: [1, 2, 3].map(attemptNumber => ({ id: randomUUID(), ...scope, profileId: profile, taskId: task.id, attemptNumber, stage: `stage-${attemptNumber}`, status: attemptNumber === 3 ? "FAILED" : "SUCCEEDED", safeErrorSummary: "Ads 同步未完成；已保留检查点。", apiRequests: attemptNumber, processedCount: attemptNumber })) });
  const versionId = randomUUID();
  await prisma.amazonAdsReportVersion.create({ data: { id: versionId, ...scope, profileId: profile, sourceTaskId: task.id, status: "PUBLISHED", requestedFrom: new Date("2026-11-01T00:00:00.000Z"), requestedTo: new Date("2026-11-01T00:00:00.000Z"), rowCount: 1, publishedAt: new Date() } });
  const reportRequest = await prisma.amazonAdsReportRequest.create({ data: { id: randomUUID(), ...scope, profileId: profile, sourceTaskId: task.id, versionId, idempotencyKey: randomUUID(), apiVersion: "v3", reportType: "spCampaigns", adProduct: "SPONSORED_PRODUCTS", requestedFrom: new Date("2026-11-01T00:00:00.000Z"), requestedTo: new Date("2026-11-01T00:00:00.000Z"), requestOptions: { privateMarker: "request-options-secret-marker" }, remoteRequestId: "remote-id-secret-marker", status: "COMPLETED" } });
  await prisma.amazonAdsReportDocument.create({ data: { id: randomUUID(), ...scope, profileId: profile, requestId: reportRequest.id, partIndex: 0, format: "GZIP_JSON", compression: "GZIP", status: "DOWNLOADED", storageFileId: "storage-file-secret-marker", contentSha256: "hash-secret-marker", byteSize: BigInt(1024), rowCount: 1, downloadedAt: new Date() } });
  const request = (page: number, pageSize = 2) => GET(new Request(`http://localhost/api/integrations/amazon/ads/sync?taskId=${task.id}&attemptPage=${page}&attemptPageSize=${pageSize}`, { headers }));
  const first = await request(1);
  assert.equal(first.status, 200);
  const firstText = await first.text();
  const firstPayload = JSON.parse(firstText) as { taskDetail: { attemptRuns: Array<{ attemptNumber: number }>; attemptPagination: { total: number; hasMore: boolean }; reportRequests: Array<{ status: string; documents: Array<{ status: string; byteSize: string | null }> }>; reportVersions: Array<{ status: string }> } };
  assert.deepEqual(firstPayload.taskDetail.attemptRuns.map(attempt => attempt.attemptNumber), [1, 2]);
  assert.equal(firstPayload.taskDetail.attemptPagination.total, 3); assert.equal(firstPayload.taskDetail.attemptPagination.hasMore, true);
  assert.equal(firstPayload.taskDetail.reportRequests[0].status, "COMPLETED");
  assert.deepEqual(firstPayload.taskDetail.reportRequests[0].documents.map(document => [document.status, document.byteSize]), [["DOWNLOADED", "1024"]]);
  assert.deepEqual(firstPayload.taskDetail.reportVersions.map(version => version.status), ["PUBLISHED"]);
  for (const secret of ["checkpoint-secret-marker", "worker-secret-marker", "raw-error-secret-marker", "request-options-secret-marker", "remote-id-secret-marker", "storage-file-secret-marker", "hash-secret-marker"]) assert.ok(!firstText.includes(secret), `detail response must omit ${secret}`);
  const second = await request(2);
  const secondPayload = await second.json() as { taskDetail: { attemptRuns: Array<{ attemptNumber: number }>; attemptPagination: { hasMore: boolean } } };
  assert.equal(second.status, 200); assert.deepEqual(secondPayload.taskDetail.attemptRuns.map(attempt => attempt.attemptNumber), [3]); assert.equal(secondPayload.taskDetail.attemptPagination.hasMore, false);
  assert.equal((await request(1, 51)).status, 400);
  const hiddenTask = await newTask(secondPlan, otherProfile);
  await prisma.amazonAdsSyncTask.update({ where: { id: hiddenTask.id }, data: { status: "FAILED", finishedAt: new Date() } });
  const hidden = await GET(new Request(`http://localhost/api/integrations/amazon/ads/sync?taskId=${hiddenTask.id}`, { headers }));
  assert.equal(hidden.status, 404, "Profile outside the viewer's Marketplace grant is hidden");
});

test("cancellation closes only the latest attempt and fences a stale dispatch", async () => {
  const { POST: controlSync } = await import("../../src/app/api/integrations/amazon/ads/sync/route");
  const { createSession } = await import("../../src/lib/auth/session");
  const session = await createSession(owner);
  const headers = { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}`, "x-workspace-id": scope.workspaceId, "content-type": "application/json" };
  const task = await newTask();
  await prisma.amazonAdsSyncTask.update({ where: { id: task.id }, data: { status: "RUNNING", dispatchVersion: 2, fenceVersion: 7, leaseOwner: "fixture-worker", leaseExpiresAt: new Date(Date.now() + 60_000), startedAt: new Date() } });
  await prisma.amazonAdsSyncAttempt.createMany({ data: [
    { id: randomUUID(), ...scope, profileId: task.profileId, taskId: task.id, attemptNumber: 1, stage: "campaigns", status: "SUCCEEDED", finishedAt: new Date() },
    { id: randomUUID(), ...scope, profileId: task.profileId, taskId: task.id, attemptNumber: 2, stage: "ad-groups", status: "RUNNING" },
  ] });
  const domainKey = { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: task.profileId, dataDomain: "entities", reportType: "" } };
  const originalDomain = await prisma.amazonAdsSyncDomainState.findUniqueOrThrow({ where: domainKey });
  const lastSuccessAt = originalDomain.lastSuccessAt ?? new Date("2026-11-05T00:00:00.000Z");
  await prisma.amazonAdsSyncDomainState.update({ where: domainKey, data: { status: "CURRENT", lastSuccessAt, lastTaskId: task.id, warningCodes: [] } });
  const beforeRequests = http;
  try {
    const response = await controlSync(new Request("http://localhost/api/integrations/amazon/ads/sync", { method: "POST", headers, body: JSON.stringify({ action: "cancel", taskId: task.id }) }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, taskId: task.id, status: "CANCELLED", alreadyFinished: false });
    const cancelled = await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(cancelled.status, "CANCELLED"); assert.equal(cancelled.dispatchVersion, 3); assert.equal(cancelled.fenceVersion, 8);
    assert.equal(cancelled.leaseOwner, null); assert.equal(cancelled.leaseExpiresAt, null); assert.ok(cancelled.finishedAt);
    const attempts = await prisma.amazonAdsSyncAttempt.findMany({ where: { ...scope, taskId: task.id }, orderBy: { attemptNumber: "asc" } });
    assert.equal(attempts[0].status, "SUCCEEDED", "completed attempt history is immutable");
    assert.equal(attempts[1].status, "CANCELLED"); assert.ok(attempts[1].finishedAt); assert.equal(attempts[1].retryAt, null);
    const freshness = await prisma.amazonAdsSyncDomainState.findUniqueOrThrow({ where: domainKey });
    assert.equal(freshness.status, "STALE"); assert.equal(freshness.lastSuccessAt?.toISOString(), lastSuccessAt.toISOString());
    assert.ok(freshness.warningCodes.includes("ADS_TASK_CANCELLED")); assert.equal(freshness.lastTaskId, task.id);
    await processAmazonAdsSyncTask(task.id, 2, { oauth, adapter });
    assert.equal(http, beforeRequests, "a stale dispatch must stop before refreshing credentials or calling the API");
    const repeated = await controlSync(new Request("http://localhost/api/integrations/amazon/ads/sync", { method: "POST", headers, body: JSON.stringify({ action: "cancel", taskId: task.id }) }));
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), { ok: true, taskId: task.id, status: "CANCELLED", alreadyFinished: true });
  } finally {
    await prisma.amazonAdsSyncDomainState.update({ where: domainKey, data: { status: originalDomain.status, lastSuccessAt: originalDomain.lastSuccessAt, lastAttemptAt: originalDomain.lastAttemptAt, lastTaskId: originalDomain.lastTaskId, coveredFrom: originalDomain.coveredFrom, coveredTo: originalDomain.coveredTo, warningCodes: originalDomain.warningCodes } });
    await prisma.amazonAdsSyncAttempt.deleteMany({ where: { ...scope, taskId: task.id } });
    await prisma.amazonAdsSyncTask.delete({ where: { id: task.id } });
  }
});

test("real BullMQ worker consumes persisted structure dispatch and completes all nine collections", async () => {
  const { Worker } = await import("bullmq");
  const { createRedisConnectionOptions, getAmazonSyncQueueName } = await import("../../src/lib/queue/redis-queue");
  const { runAdsPlanNow } = await import("../../src/lib/amazon-ads/sync-service");
  const queue = getAmazonSyncQueue();
  await queue.drain();
  const taskErrors: unknown[] = [];
  const worker = new Worker(getAmazonSyncQueueName(), async job => {
    if (job.data.adsTaskId) await processAmazonAdsSyncTask(job.data.adsTaskId, job.data.adsDispatchVersion, { adapter, oauth });
  }, { connection: createRedisConnectionOptions(), concurrency: 2 });
  worker.on("error", error => taskErrors.push(error));
  try {
    const result = await runAdsPlanNow(scope, owner, plan);
    const done = await new Promise<Awaited<ReturnType<typeof newTask>>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("BullMQ fixture timed out")), 10000);
      const check = async () => {
        const task = await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: result.taskId } });
        if (task.status === "SUCCEEDED") { clearTimeout(timer); resolve(task); }
      };
      worker.on("completed", () => { void check().catch(reject); });
      void check().catch(reject);
    });
    assert.equal(done.apiRequests, 9); assert.equal(done.stage, "COMPLETED_SP_STRUCTURE");
    assert.deepEqual(taskErrors, []);
  } finally { await worker.close(); }
});

test("binding a ready Profile persists an initial task and the existing worker consumes it", async () => {
  const { Worker } = await import("bullmq");
  const { createRedisConnectionOptions, getAmazonSyncQueueName } = await import("../../src/lib/queue/redis-queue");
  const { tickAmazonAds } = await import("../../src/lib/amazon-ads/sync-scheduler");
  const externalProfileId = "777";
  const boundProfile = await prisma.amazonAdsProfile.create({ data: {
    ...scope, id: randomUUID(), authorizationId: auth, region: "EU", profileId: externalProfileId,
    countryCode: "US", marketplaceId: site, currencyCode: "USD", timezone: "America/Los_Angeles", accountInfo: {},
  } });
  let closeWorker: (() => Promise<void>) | undefined;
  try {
    await bindAmazonAdsProfile(scope, owner, externalProfileId, seller);
    const boundPlan = await prisma.amazonAdsSyncPlan.findUniqueOrThrow({ where: { organizationId_workspaceId_profileId: { ...scope, profileId: boundProfile.id } } });
    assert.equal(boundPlan.status, "ACTIVE");
    const initialTask = await prisma.amazonAdsSyncTask.findFirstOrThrow({ where: { ...scope, planId: boundPlan.id, idempotencyKey: `initial-structure:${boundPlan.id}:${boundPlan.revision}` } });
    assert.equal(initialTask.status, "WAITING");
    assert.equal(initialTask.trigger, "schedule");
    assert.equal(initialTask.requestedFrom, null);
    assert.equal(initialTask.requestedTo, null);
    assert.ok(boundPlan.nextRunAt.getTime() > Date.now(), "the first task reserves the next daily structure run");

    await getAmazonSyncQueue().drain();
    const worker = new Worker<AmazonSyncQueueJob>(getAmazonSyncQueueName(), async job => {
      if (job.data.adsTaskId && typeof job.data.adsDispatchVersion === "number") await processAmazonAdsSyncTask(job.data.adsTaskId, job.data.adsDispatchVersion, { adapter, oauth });
    }, { connection: createRedisConnectionOptions(), concurrency: 2 });
    closeWorker = () => worker.close();
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Initial Ads sync fixture timed out")), 10000);
      worker!.on("failed", (job, error) => {
        if (job?.data.adsTaskId !== initialTask.id) return;
        clearTimeout(timer);
        reject(error);
      });
      worker.on("completed", async job => {
        if (job.data.adsTaskId !== initialTask.id) return;
        try {
          const persisted = await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: initialTask.id } });
          if (persisted.status !== "SUCCEEDED") return;
          clearTimeout(timer);
          resolve();
        } catch (error) { clearTimeout(timer); reject(error); }
      });
    });
    await prisma.amazonAdsApiBudget.updateMany({ data: { nextRequestAt: new Date(0), leaseOwner: null, leaseExpiresAt: null } });
    await prisma.amazonAdsSyncPlan.updateMany({ where: { ...scope, status: "ACTIVE" }, data: { nextRunAt: new Date(Date.now() + 86400000) } });
    await tickAmazonAds();
    await done;
    const persisted = await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: initialTask.id } });
    assert.equal(persisted.stage, "COMPLETED_SP_STRUCTURE");
    assert.equal(persisted.apiRequests, 9);
    assert.equal(await prisma.amazonAdsEntityRecord.count({ where: { ...scope, profileId: boundProfile.id } }), 9);
    await tickAmazonAds(new Date(Date.now() + 1000));
    assert.equal(await prisma.amazonAdsSyncTask.count({ where: { ...scope, planId: boundPlan.id } }), 1, "a completed initial pass must not immediately enqueue a duplicate daily pass");
    await prisma.amazonAdsSyncPlan.updateMany({ where: { ...scope, id: { not: boundPlan.id }, status: "ACTIVE" }, data: { nextRunAt: new Date(Date.now() + 4 * 86400000) } });
    const currentPlan = await prisma.amazonAdsSyncPlan.findUniqueOrThrow({ where: { id: boundPlan.id } });
    const dueAt = new Date(currentPlan.nextRunAt.getTime() + 1000);
    await tickAmazonAds(dueAt);
    const dailyTask = await prisma.amazonAdsSyncTask.findFirstOrThrow({ where: { ...scope, planId: boundPlan.id, trigger: "scheduled-structure" } });
    assert.ok(["WAITING", "QUEUED", "RUNNING", "SUCCEEDED"].includes(dailyTask.status));
    await tickAmazonAds(dueAt);
    assert.equal(await prisma.amazonAdsSyncTask.count({ where: { ...scope, planId: boundPlan.id } }), 2, "repeated scheduler ticks must not create duplicate daily tasks");
  } finally {
    await closeWorker?.();
    const boundPlan = await prisma.amazonAdsSyncPlan.findFirst({ where: { ...scope, profileId: boundProfile.id } });
    if (boundPlan) {
      await prisma.amazonAdsSyncDomainState.deleteMany({ where: { ...scope, profileId: boundProfile.id } });
      await prisma.amazonAdsEntityRecord.deleteMany({ where: { ...scope, profileId: boundProfile.id } });
      await prisma.amazonAdsSyncAttempt.deleteMany({ where: { ...scope, profileId: boundProfile.id } });
      await prisma.amazonAdsSyncTask.deleteMany({ where: { ...scope, planId: boundPlan.id } });
      await prisma.amazonAdsSyncPlan.delete({ where: { id: boundPlan.id } });
    }
    await prisma.amazonAdsProfile.delete({ where: { id: boundProfile.id } });
  }
});

test("OAuth Profile discovery automatically creates an isolated account and initial sync task", async () => {
  const externalProfileId = "555";
  const attemptId = randomUUID();
  const reconnectAttemptId = randomUUID();
  const state = randomUUID();
  const stateHash = createHash("sha256").update(state).digest("hex");
  const redirectUri = "http://127.0.0.1/api/integrations/amazon/ads/oauth/callback";
  const previousRedirectUri = process.env.AMAZON_ADS_OAUTH_REDIRECT_URI;
  process.env.AMAZON_ADS_OAUTH_REDIRECT_URI = redirectUri;
  await prisma.amazonAdsOAuthAttempt.create({ data: {
    ...scope, id: attemptId, userId: owner, region: "EU", stateHash, redirectUri,
    expiresAt: new Date(Date.now() + 60000),
  } });
  let discoveredAuthorizationId: string | undefined;
  let discoveredProfileId: string | undefined;
  let sameAuthorizationProfileId: string | undefined;
  let sameAuthorizationPlanId: string | undefined;
  let unrelatedAuthId: string | undefined;
  let unrelatedProfileId: string | undefined;
  let unrelatedPlanId: string | undefined;
  try {
    const result = await finishAmazonAdsOAuth({ scope, actor: owner, params: new URLSearchParams({ state, code: "fixture-code" }), transport: {
      async exchangeAuthorizationCode() { return { refreshToken: "fixture-refresh-token", accessToken: "fixture-access-token" }; },
      async refreshAccessToken() { return "fixture-access-token"; },
      async listProfiles({ region }) { return region === "EU" ? [{ profileId: externalProfileId, countryCode: "US", currencyCode: "USD", timezone: "America/Los_Angeles", accountInfo: { marketplaceStringId: site, type: "seller", name: "Fixture discovered account" } }] : []; },
    } });
    discoveredAuthorizationId = result.authorizationId;
    assert.equal(result.profileCount, 1);
    const discovered = await prisma.amazonAdsProfile.findFirstOrThrow({ where: { ...scope, authorizationId: result.authorizationId, region: "EU", profileId: externalProfileId } });
    discoveredProfileId = discovered.id;
    assert.ok(discovered.sellerAccountId, "discovery automatically assigns an isolated Ads account when no verified Seller identity exists");

    const discoveredPlan = await prisma.amazonAdsSyncPlan.findUniqueOrThrow({ where: { organizationId_workspaceId_profileId: { ...scope, profileId: discovered.id } } });
    assert.equal(discoveredPlan.status, "ACTIVE");
    const initialTask = await prisma.amazonAdsSyncTask.findFirstOrThrow({ where: { ...scope, planId: discoveredPlan.id } });
    assert.equal(initialTask.status, "WAITING");
    assert.equal(initialTask.idempotencyKey, `initial-structure:${discoveredPlan.id}:${discoveredPlan.revision}`);

    const plan = await prisma.amazonAdsSyncPlan.findUniqueOrThrow({ where: { organizationId_workspaceId_profileId: { ...scope, profileId: discovered.id } } });
    assert.equal(plan.status, "ACTIVE");
    const tasks = await prisma.amazonAdsSyncTask.findMany({ where: { ...scope, planId: plan.id } });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, "WAITING");
    assert.equal(tasks[0].idempotencyKey, `initial-structure:${plan.id}:${plan.revision}`);

    await disconnectAmazonAdsAuthorization(scope, owner, result.authorizationId);
    assert.equal((await prisma.amazonAdsAuthorization.findUniqueOrThrow({ where: { id: result.authorizationId } })).status, "DISCONNECTED");
    assert.equal((await prisma.amazonAdsSyncPlan.findUniqueOrThrow({ where: { id: plan.id } })).status, "PAUSED");
    assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: tasks[0].id } })).status, "CANCELLED");

    const reconnectState = randomUUID();
    await prisma.amazonAdsOAuthAttempt.create({ data: { ...scope, id: reconnectAttemptId, userId: owner, region: "EU", stateHash: createHash("sha256").update(reconnectState).digest("hex"), redirectUri, expiresAt: new Date(Date.now() + 60000) } });
    const reconnected = await finishAmazonAdsOAuth({ scope, actor: owner, params: new URLSearchParams({ state: reconnectState, code: "fixture-reconnect-code" }), transport: {
      async exchangeAuthorizationCode() { return { refreshToken: "fixture-refresh-token-2", accessToken: "fixture-access-token-2" }; },
      async refreshAccessToken() { return "fixture-access-token-2"; },
      async listProfiles({ region }) { return region === "EU" ? [{ profileId: externalProfileId, countryCode: "US", currencyCode: "USD", timezone: "America/Los_Angeles", accountInfo: { marketplaceStringId: site, type: "seller", name: "Fixture discovered account" } }] : []; },
    } });
    assert.equal(reconnected.authorizationId, result.authorizationId);
    assert.equal((await prisma.amazonAdsAuthorization.findUniqueOrThrow({ where: { id: result.authorizationId } })).status, "CONNECTED");
    const resumedPlan = await prisma.amazonAdsSyncPlan.findUniqueOrThrow({ where: { id: plan.id } });
    assert.equal(resumedPlan.status, "ACTIVE");
    const resumedTask = await prisma.amazonAdsSyncTask.findFirstOrThrow({ where: { ...scope, planId: plan.id, status: "WAITING" } });
    assert.notEqual(resumedTask.idempotencyKey, tasks[0].idempotencyKey);
    sameAuthorizationProfileId = randomUUID();
    sameAuthorizationPlanId = randomUUID();
    await prisma.amazonAdsProfile.create({ data: { ...scope, id: sameAuthorizationProfileId, authorizationId: result.authorizationId, region: "EU", profileId: "557", countryCode: "US", marketplaceId: site, sellerAccountId: seller, accountInfo: {} } });
    await prisma.amazonAdsSyncPlan.create({ data: { ...scope, id: sameAuthorizationPlanId, profileId: sameAuthorizationProfileId, actorUserId: owner, sellerAccountId: seller, authorizationRevision: 1, status: "ACTIVE" } });
    const sameAuthorizationTask = await newTask(sameAuthorizationPlanId, sameAuthorizationProfileId);
    unrelatedAuthId = randomUUID();
    unrelatedProfileId = randomUUID();
    unrelatedPlanId = randomUUID();
    const unrelatedTaskId = randomUUID();
    await prisma.amazonAdsAuthorization.create({ data: { ...scope, id: unrelatedAuthId, name: "Unrelated Ads", consentRegion: "EU", status: "CONNECTED", credentialsCiphertext: encryptAmazonAdsRefreshToken("unrelated-fixture-token", { ...scope, authorizationId: unrelatedAuthId }), authorizedByUserId: owner } });
    await prisma.amazonAdsProfile.create({ data: { ...scope, id: unrelatedProfileId, authorizationId: unrelatedAuthId, region: "EU", profileId: "556", countryCode: "US", marketplaceId: site, sellerAccountId: seller, accountInfo: {} } });
    await prisma.amazonAdsSyncPlan.create({ data: { ...scope, id: unrelatedPlanId, profileId: unrelatedProfileId, actorUserId: owner, sellerAccountId: seller, authorizationRevision: 1, status: "ACTIVE" } });
    await prisma.amazonAdsSyncTask.create({ data: { ...scope, id: unrelatedTaskId, planId: unrelatedPlanId, profileId: unrelatedProfileId, requestedByUserId: owner, planRevision: 1, idempotencyKey: randomUUID() } });
    const historicalEntityId = randomUUID();
    await prisma.amazonAdsEntityRecord.create({ data: { ...scope, id: historicalEntityId, profileId: discoveredProfileId, entityType: "SP:campaign", externalId: "historical-campaign", payload: { campaignId: "historical-campaign", name: "Stored before reauth" }, sourceTaskId: tasks[0].id } });
    await processAmazonAdsSyncTask(resumedTask.id, resumedTask.dispatchVersion, { adapter, oauth: { ...oauth, async refreshAccessToken() { throw new AmazonAdsConnectionError("REFRESH", "EU", "HTTP_401", 401); } } });
    assert.equal((await prisma.amazonAdsAuthorization.findUniqueOrThrow({ where: { id: result.authorizationId } })).status, "REAUTH_REQUIRED");
    assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: resumedTask.id } })).errorCode, "ADS_CONNECTION_REFRESH_HTTP_401");
    assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: sameAuthorizationTask.id } })).status, "CANCELLED");
    assert.equal((await prisma.amazonAdsSyncPlan.findUniqueOrThrow({ where: { id: sameAuthorizationPlanId } })).status, "BLOCKED");
    assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: unrelatedTaskId } })).status, "WAITING");
    assert.equal((await prisma.amazonAdsSyncPlan.findUniqueOrThrow({ where: { id: unrelatedPlanId } })).status, "ACTIVE");
    assert.deepEqual((await prisma.amazonAdsEntityRecord.findUniqueOrThrow({ where: { id: historicalEntityId } })).payload, { campaignId: "historical-campaign", name: "Stored before reauth" }, "reauthorization must preserve already collected entities");
    await prisma.amazonAdsSyncTask.deleteMany({ where: { ...scope, planId: unrelatedPlanId } });
    await prisma.amazonAdsSyncPlan.delete({ where: { id: unrelatedPlanId } });
    await prisma.amazonAdsProfile.delete({ where: { id: unrelatedProfileId } });
    await prisma.amazonAdsAuthorization.delete({ where: { id: unrelatedAuthId } });
    await prisma.amazonAdsSyncTask.deleteMany({ where: { ...scope, planId: sameAuthorizationPlanId } });
    await prisma.amazonAdsSyncPlan.delete({ where: { id: sameAuthorizationPlanId } });
    await prisma.amazonAdsProfile.delete({ where: { id: sameAuthorizationProfileId } });
  } finally {
    if (unrelatedPlanId) {
      await prisma.amazonAdsSyncTask.deleteMany({ where: { ...scope, planId: unrelatedPlanId } });
      await prisma.amazonAdsSyncPlan.deleteMany({ where: { ...scope, id: unrelatedPlanId } });
    }
    if (unrelatedProfileId) await prisma.amazonAdsProfile.deleteMany({ where: { ...scope, id: unrelatedProfileId } });
    if (unrelatedAuthId) await prisma.amazonAdsAuthorization.deleteMany({ where: { ...scope, id: unrelatedAuthId } });
    if (sameAuthorizationPlanId) {
      await prisma.amazonAdsSyncTask.deleteMany({ where: { ...scope, planId: sameAuthorizationPlanId } });
      await prisma.amazonAdsSyncPlan.deleteMany({ where: { ...scope, id: sameAuthorizationPlanId } });
    }
    if (sameAuthorizationProfileId) await prisma.amazonAdsProfile.deleteMany({ where: { ...scope, id: sameAuthorizationProfileId } });
    if (discoveredProfileId) {
      const plan = await prisma.amazonAdsSyncPlan.findFirst({ where: { ...scope, profileId: discoveredProfileId } });
      if (plan) {
        await prisma.amazonAdsSyncDomainState.deleteMany({ where: { ...scope, profileId: discoveredProfileId } });
        await prisma.amazonAdsEntityRecord.deleteMany({ where: { ...scope, profileId: discoveredProfileId } });
        await prisma.amazonAdsSyncAttempt.deleteMany({ where: { ...scope, profileId: discoveredProfileId } });
        await prisma.amazonAdsSyncTask.deleteMany({ where: { ...scope, planId: plan.id } });
        await prisma.amazonAdsSyncPlan.delete({ where: { id: plan.id } });
      }
      await prisma.amazonAdsProfile.delete({ where: { id: discoveredProfileId } });
    }
    if (discoveredAuthorizationId) await prisma.amazonAdsAuthorization.delete({ where: { id: discoveredAuthorizationId } });
    await prisma.amazonAdsOAuthAttempt.deleteMany({ where: { ...scope, id: { in: [attemptId, reconnectAttemptId] } } });
    if (previousRedirectUri === undefined) delete process.env.AMAZON_ADS_OAUTH_REDIRECT_URI;
    else process.env.AMAZON_ADS_OAUTH_REDIRECT_URI = previousRedirectUri;
  }
});

test("scheduler recovers expired leases with a new fence and pause cancels pending tasks", async () => {
  const { tickAmazonAds } = await import("../../src/lib/amazon-ads/sync-scheduler");
  const { controlAdsPlan } = await import("../../src/lib/amazon-ads/sync-service");
  const task = await newTask();
  await prisma.amazonAdsSyncAttempt.create({ data: { id: randomUUID(), ...scope, profileId: task.profileId, taskId: task.id, attemptNumber: 1, stage: task.stage, status: "RUNNING" } });
  const checkpoint = encryptAmazonAdsCheckpoint({ stage: 1, cursor: "fixture-page", pages: 1 }, credentialScope, task.id);
  await prisma.amazonAdsSyncTask.update({ where: { id: task.id }, data: { status: "RUNNING", fenceVersion: 3, leaseOwner: "expired", leaseExpiresAt: new Date(0), checkpointCiphertext: checkpoint } });
  await tickAmazonAds();
  const recovered = await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(recovered.dispatchVersion, 2); assert.equal(recovered.fenceVersion, 4); assert.equal(recovered.checkpointCiphertext, checkpoint);
  assert.equal(recovered.status, "QUEUED");
  assert.equal((await prisma.amazonAdsSyncAttempt.findUniqueOrThrow({ where: { organizationId_workspaceId_taskId_attemptNumber: { ...scope, taskId: task.id, attemptNumber: 1 } } })).status, "RETRY_WAIT");
  const before = refreshes;
  await processAmazonAdsSyncTask(task.id, 1, { oauth, adapter }); assert.equal(refreshes, before);
  await controlAdsPlan(scope, owner, plan, "pause");
  assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: task.id } })).status, "CANCELLED");
  assert.equal((await prisma.amazonAdsSyncAttempt.findUniqueOrThrow({ where: { organizationId_workspaceId_taskId_attemptNumber: { ...scope, taskId: task.id, attemptNumber: 1 } } })).status, "CANCELLED");
  await processAmazonAdsSyncTask(task.id, recovered.dispatchVersion, { oauth, adapter }); assert.equal(refreshes, before);
});

test("structure dispatch, recovery, retry and cancellation preserve report task boundaries", async () => {
  const { tickAmazonAds } = await import("../../src/lib/amazon-ads/sync-scheduler");
  const { cancelAdsTask, controlAdsPlan } = await import("../../src/lib/amazon-ads/sync-service");
  const priorPlan = await prisma.amazonAdsSyncPlan.findUniqueOrThrow({ where: { id: plan } });
  await prisma.amazonAdsSyncPlan.update({ where: { id: plan }, data: { status: "ACTIVE", nextRunAt: new Date(Date.now() + 86400000) } });
  const domainWhere = { ...scope, profileId: profile, dataDomain: "entities", reportType: "" };
  const beforeDomain = await prisma.amazonAdsSyncDomainState.findFirstOrThrow({ where: domainWhere });
  const ids: string[] = [];
  const beforeRequests = http, beforeRefreshes = refreshes;
  try {
    for (const [trigger, stage, status, dated, evidence] of [
      ["isolated-report", "REPORTS_ISOLATED", "RUNNING", true, false],
      ["isolated-report", "REPORTS_ISOLATED", "RETRY_WAIT", true, false],
      ["future-report", "DISCOVER", "WAITING", false, false],
      ["manual-retry", "DISCOVER", "WAITING", false, true],
      ["schedule", "DISCOVER", "WAITING", true, false],
    ] as const) {
      const task = await newTask(); ids.push(task.id);
      await prisma.amazonAdsSyncTask.update({ where: { id: task.id }, data: { trigger, stage, status, leaseOwner: status === "RUNNING" ? "report-fixture" : null, leaseExpiresAt: status === "RUNNING" ? new Date(0) : null, nextAttemptAt: new Date(0), ...(dated ? { requestedFrom: new Date("2026-11-01"), requestedTo: new Date("2026-11-01") } : {}) } });
      if (evidence) await prisma.amazonAdsReportRequest.create({ data: { id: randomUUID(), ...scope, profileId: profile, sourceTaskId: task.id, idempotencyKey: task.id, apiVersion: "fixture-only", reportType: "fixture_campaign", adProduct: "SPONSORED_PRODUCTS", requestedFrom: new Date("2026-11-01"), requestedTo: new Date("2026-11-01"), requestOptions: { acquisition: { calls: { create: 1 }, phase: "POLL" } } } });
      const before = await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: task.id } });
      await processAmazonAdsSyncTask(task.id, task.dispatchVersion, { oauth, adapter });
      await tickAmazonAds();
      assert.deepEqual(await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: task.id } }), before);
      assert.equal(await getAmazonSyncQueue().getJob(`ads-${task.id}-${task.dispatchVersion}`), undefined);
    }
    assert.equal(http, beforeRequests); assert.equal(refreshes, beforeRefreshes);
    assert.deepEqual(await prisma.amazonAdsSyncDomainState.findFirstOrThrow({ where: domainWhere }), beforeDomain);
    const report = ids[0];
    await prisma.amazonAdsSyncTask.update({ where: { id: report }, data: { status: "FAILED", createdAt: new Date(Date.now() + 100000) } });
    const failed = await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: report } });
    await assert.rejects(() => controlAdsPlan(scope, owner, plan, "retry"), /不属于结构同步/);
    assert.deepEqual(await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: report } }), failed);
    await prisma.amazonAdsSyncTask.update({ where: { id: ids[3] }, data: { status: "FAILED", createdAt: new Date(Date.now() + 200000) } });
    const mislabeled = await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: ids[3] } });
    await assert.rejects(() => controlAdsPlan(scope, owner, plan, "retry"), /不属于结构同步/);
    assert.deepEqual(await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: ids[3] } }), mislabeled);
    // Cancellation may fence any task, but a report must not alter entity freshness.
    await cancelAdsTask(scope, owner, ids[1]);
    assert.equal((await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: ids[1] } })).status, "CANCELLED");
    assert.deepEqual(await prisma.amazonAdsSyncDomainState.findFirstOrThrow({ where: domainWhere }), beforeDomain);
    await controlAdsPlan(scope, owner, plan, "pause");
    assert.deepEqual(await prisma.amazonAdsSyncDomainState.findFirstOrThrow({ where: domainWhere }), beforeDomain);
    const request = await prisma.amazonAdsReportRequest.findFirstOrThrow({ where: { sourceTaskId: ids[3] } });
    assert.deepEqual(request.requestOptions, { acquisition: { calls: { create: 1 }, phase: "POLL" } });
  } finally {
    await prisma.amazonAdsSyncTask.updateMany({ where: { id: { in: ids } }, data: { status: "CANCELLED" } });
    await prisma.amazonAdsSyncPlan.update({ where: { id: plan }, data: { status: priorPlan.status, revision: priorPlan.revision, nextRunAt: priorPlan.nextRunAt } });
  }
});

test("structure query withholds rows, totals and metadata after grant revocation", async () => {
  await assertEntityResponseWithheld(
    () => prisma.amazonDataAccessGrant.updateMany({ where: { ...scope, userId: member }, data: { enabled: false } }),
    () => prisma.amazonDataAccessGrant.updateMany({ where: { ...scope, userId: member }, data: { enabled: true } }), member,
  );
});

test("structure query rechecks disconnected auth, unbound Profile and inactive seller", async () => {
  await assertEntityResponseWithheld(
    () => prisma.amazonAdsAuthorization.update({ where: { id: auth }, data: { status: "DISCONNECTED" } }),
    () => prisma.amazonAdsAuthorization.update({ where: { id: auth }, data: { status: "CONNECTED" } }),
  );
  await assertEntityResponseWithheld(
    () => prisma.amazonAdsProfile.update({ where: { id: profile }, data: { sellerAccountId: null } }),
    () => prisma.amazonAdsProfile.update({ where: { id: profile }, data: { sellerAccountId: seller } }),
  );
  await assertEntityResponseWithheld(
    () => prisma.sellerAccount.update({ where: { id: seller }, data: { status: "inactive" } }),
    () => prisma.sellerAccount.update({ where: { id: seller }, data: { status: "active" } }),
  );
});

test("structure query rejects binding changes even when both stores are visible to the actor", async () => {
  const secondSeller = randomUUID();
  await prisma.sellerAccount.create({ data: { ...scope, id: secondSeller, accountKey: secondSeller, displayName: "Second fixture", marketplaceCode: "US" } });
  await assertEntityResponseWithheld(
    () => prisma.amazonAdsProfile.update({ where: { id: profile }, data: { sellerAccountId: secondSeller } }),
    () => prisma.amazonAdsProfile.update({ where: { id: profile }, data: { sellerAccountId: seller } }),
  );
  await assertEntityResponseWithheld(
    () => prisma.amazonAdsProfile.update({ where: { id: profile }, data: { marketplaceId: "A2EUQ1WTGCTBG2" } }),
    () => prisma.amazonAdsProfile.update({ where: { id: profile }, data: { marketplaceId: site } }),
  );
});

test("authenticated structure API paginates actual rows and withholds reads revoked during SQL", async () => {
  const { GET } = await import("../../src/app/api/integrations/amazon/ads/data/route");
  const { createSession } = await import("../../src/lib/auth/session");
  const session = await createSession(member);
  const headers = { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}`, "x-workspace-id": scope.workspaceId };
  const url = `http://localhost/api/integrations/amazon/ads/data?kind=entities&internalProfileId=${profile}&pageSize=1&sortBy=externalId&sortDirection=asc`;
  const response = await GET(new Request(url, { headers }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, 9); assert.equal(body.rows.length, 1); assert.equal(body.pagination.hasMore, true);
  assert.equal(body.rows[0].internalProfileId, profile); assert.equal(body.rows[0].amazonProfileId, "999");
  let release = () => {}, ready = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; }), acquired = new Promise<void>(resolve => { ready = resolve; });
  const lock = prisma.$transaction(async tx => { await tx.$executeRawUnsafe('LOCK TABLE "AmazonAdsEntityRecord" IN ACCESS EXCLUSIVE MODE'); ready(); await gate; }, { timeout: 15000 });
  await acquired;
  const pending = GET(new Request(url, { headers }));
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%AmazonAdsEntityRecord%' AND query LIKE 'SELECT%') AS waiting`;
      if (rows[0].waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, "the request must reach the actual blocked entity query");
    await prisma.amazonDataAccessGrant.updateMany({ where: { ...scope, userId: member }, data: { enabled: false } });
  } finally { release(); await lock; }
  try {
    const denied = await pending;
    assert.equal(denied.status, 403);
    const deniedBody = await denied.json();
    for (const key of ["rows", "data", "total", "meta", "freshness"]) assert.equal(deniedBody[key], undefined);
  } finally { await prisma.amazonDataAccessGrant.updateMany({ where: { ...scope, userId: member }, data: { enabled: true } }); }
});

test("Campaign filter distinguishes a direct Campaign parent from an equal Ad Group ID", async () => {
  const source = await prisma.amazonAdsEntityRecord.findFirstOrThrow({ where: { ...scope, profileId: profile } });
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  try {
    await prisma.amazonAdsEntityRecord.createMany({ data: [
      { ...scope, id: ids[0], profileId: profile, sourceTaskId: source.sourceTaskId, entityType: "SP:keyword", externalId: "collision-keyword", parentExternalId: "101", campaignId: "different-campaign", adGroupId: "101", payload: { campaignId: "different-campaign", adGroupId: "101" } },
      { ...scope, id: ids[1], profileId: profile, sourceTaskId: source.sourceTaskId, entityType: "SP:ad-group", externalId: "legacy-child-group", parentExternalId: "101", payload: {} },
      { ...scope, id: ids[2], profileId: profile, sourceTaskId: source.sourceTaskId, entityType: "SP:campaign-negative-keyword", externalId: "legacy-campaign-negative", parentExternalId: "101", payload: {} },
    ] });
    const input = parseAdsQuery(new URLSearchParams({ kind: "entities", internalProfileId: profile, campaignId: "101", pageSize: "100" }));
    const result = await queryAmazonAdsData(scope, owner, input);
    assert.equal(result.total, 11);
    assert.ok(!result.rows.some(row => row.id === ids[0]), "equal numeric IDs do not imply a parent Campaign relationship");
    assert.ok(result.rows.some(row => row.id === ids[1]), "legacy Ad Group keeps its direct Campaign relationship");
    assert.ok(result.rows.some(row => row.id === ids[2]), "legacy Campaign negative keeps its direct Campaign relationship");
    const other = await queryAmazonAdsData(scope, owner, { ...input, campaignId: "different-campaign" });
    assert.equal(other.total, 1); assert.equal(other.rows[0].id, ids[0]);
  } finally { await prisma.amazonAdsEntityRecord.deleteMany({ where: { ...scope, id: { in: ids } } }); }
});

test("entity filters retain domain failures and in-progress state instead of falling back to old success", async () => {
  const key = { ...scope, profileId: profile, dataDomain: "entities", reportType: "" };
  const where = { organizationId_workspaceId_profileId_dataDomain_reportType: key };
  const original = await prisma.amazonAdsSyncDomainState.findUniqueOrThrow({ where });
  try {
    for (const status of ["SYNCING", "FAILED", "UNKNOWN"]) {
      await prisma.amazonAdsSyncDomainState.update({ where, data: { status } });
      const result = await queryAmazonAdsData(scope, owner, parseAdsQuery(new URLSearchParams({ kind: "entities", internalProfileId: profile, entityType: "SP:keyword" })));
      assert.equal(result.total, 1);
      assert.equal(result.freshness.status, status);
      assert.equal(result.meta.profiles[0].freshness, status);
      const state = result.freshness.profiles[0];
      assert.ok("lastTaskId" in state); assert.equal(state.lastTaskId, original.lastTaskId);
    }
  } finally { await prisma.amazonAdsSyncDomainState.update({ where, data: { status: original.status } }); }
});

test("snapshot fallback requires a verified structure completion stage before claiming CURRENT", async () => {
  const key = { ...scope, profileId: otherProfile, dataDomain: "entities", reportType: "" };
  const where = { organizationId_workspaceId_profileId_dataDomain_reportType: key };
  const original = await prisma.amazonAdsSyncDomainState.findUniqueOrThrow({ where });
  const row = await prisma.amazonAdsEntityRecord.findFirstOrThrow({ where: { ...scope, profileId: otherProfile }, orderBy: { syncedAt: "desc" } });
  const task = await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: row.sourceTaskId } });
  const input = parseAdsQuery(new URLSearchParams({ kind: "entities", internalProfileId: otherProfile }));
  try {
    await prisma.amazonAdsSyncDomainState.delete({ where });
    await prisma.amazonAdsSyncTask.update({ where: { id: task.id }, data: { status: "SUCCEEDED", stage: "LEGACY_UNVERIFIED" } });
    const unknown = await queryAmazonAdsData(scope, owner, input);
    assert.equal(unknown.total, 9); assert.equal(unknown.freshness.status, "UNKNOWN");
    assert.equal(unknown.meta.lastSyncAt, null); assert.equal(unknown.syncedAt, null);
    const state = unknown.freshness.profiles[0];
    assert.ok("warningCodes" in state); assert.ok(state.warningCodes.includes("ENTITY_FRESHNESS_FROM_SNAPSHOT"));
    await prisma.amazonAdsSyncTask.update({ where: { id: task.id }, data: { status: "SUCCEEDED", stage: "COMPLETED_SP_STRUCTURE" } });
    assert.equal((await queryAmazonAdsData(scope, owner, input)).freshness.status, "CURRENT");
  } finally {
    await prisma.amazonAdsSyncTask.update({ where: { id: task.id }, data: { status: task.status, stage: task.stage } });
    await prisma.amazonAdsSyncDomainState.create({ data: original });
  }
});

test("structure rows, total and freshness share one snapshot across concurrent committed writes", async () => {
  const source = await prisma.amazonAdsEntityRecord.findFirstOrThrow({ where: { ...scope, profileId: profile } });
  const domainWhere = { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: profile, dataDomain: "entities", reportType: "" } };
  const domain = await prisma.amazonAdsSyncDomainState.findUniqueOrThrow({ where: domainWhere });
  const id = randomUUID();
  let written = () => {};
  const committed = new Promise<void>(resolve => { written = resolve; });
  const input = parseAdsQuery(new URLSearchParams({ kind: "entities", internalProfileId: profile, pageSize: "100" }));
  try {
    const result = await queryAmazonAdsData(scope, owner, input, {
      repository: createAmazonAdsRepository(), resolveAccess: (scope, actor) => amazonDataAccess(scope, actor), audit: async () => {},
      readSnapshot: read => withAdsQueryReadSnapshot(reader => read({ ...reader, repository: {
        ...reader.repository,
        async listEntities(where, options) {
          const rows = await reader.repository.listEntities(where, options);
          // Commit on another connection between the row read and the delayed count/state reads.
          try {
            await prisma.$transaction(async tx => {
              await tx.amazonAdsEntityRecord.create({ data: { ...scope, id, profileId: profile, sourceTaskId: source.sourceTaskId, entityType: "SP:keyword", externalId: "snapshot-new-keyword", campaignId: "101", adGroupId: "201", parentExternalId: "201", payload: {} } });
              await tx.amazonAdsSyncDomainState.update({ where: domainWhere, data: { status: "FAILED" } });
            });
          } finally { written(); }
          return rows;
        },
        async countEntities(where) { await committed; return reader.repository.countEntities(where); },
        async listFreshness(scope, ids, dataDomain, reportType) { await committed; return reader.repository.listFreshness(scope, ids, dataDomain, reportType); },
      } })),
    });
    assert.equal(result.rows.length, 9); assert.equal(result.total, 9);
    assert.ok(!result.rows.some(row => row.id === id));
    assert.equal(result.freshness.profiles[0].status, domain.status);
    // A subsequent production query sees the committed write and new domain state together.
    const next = await queryAmazonAdsData(scope, owner, input);
    assert.equal(next.rows.length, 10); assert.equal(next.total, 10); assert.equal(next.freshness.status, "FAILED");
  } finally {
    await prisma.amazonAdsEntityRecord.deleteMany({ where: { ...scope, id } });
    await prisma.amazonAdsSyncDomainState.update({ where: domainWhere, data: { status: domain.status } });
  }
});

test("authenticated Ads API rejects ambiguous scope and sort parameters for both data domains", async () => {
  const { GET } = await import("../../src/app/api/integrations/amazon/ads/data/route");
  const { createSession } = await import("../../src/lib/auth/session");
  const session = await createSession(owner);
  const headers = { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}`, "x-workspace-id": scope.workspaceId };
  for (const kind of ["entities", "reports"]) {
    for (const query of [
      `internalProfileId=${profile}&profileId=${otherProfile}`,
      `profileRecordId=${profile}&internalProfileId=${otherProfile}`,
      `internalProfileId=${profile}&internalProfileId=${otherProfile}`,
      "page=1&page=2", "sort=state&sortBy=externalId", "direction=asc&sortDirection=desc",
    ]) {
      const response = await GET(new Request(`http://localhost/api/integrations/amazon/ads/data?kind=${kind}&${query}`, { headers }));
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.match(body.error, /冲突/);
      for (const key of ["rows", "total", "meta", "freshness"]) assert.equal(body[key], undefined);
    }
  }
  const response = await GET(new Request(`http://localhost/api/integrations/amazon/ads/data?kind=entities&profileRecordId=${profile}&internalProfileId=${profile}&profileId=${profile}`, { headers }));
  assert.equal(response.status, 200); assert.equal((await response.json()).total, 9);
});

test("advertiser account binding uses exact scoped Profile, CAS revision, audit, and leaves plan/tasks unchanged", async () => {
  const before = await prisma.amazonAdsSyncPlan.findUniqueOrThrow({ where: { id: secondPlan } });
  const accountBefore = await prisma.amazonAdsProfile.findUniqueOrThrow({ where: { id: otherProfile } });
  const tasksBefore = await prisma.amazonAdsSyncTask.count({ where: { ...scope, profileId: otherProfile } });
  await assert.rejects(bindAmazonAdsProfile(scope, member, "888", seller, "fixture-account", otherProfile, null, 0));
  await assert.rejects(bindAmazonAdsProfile({ ...scope, workspaceId: "wrong-workspace" }, owner, "888", seller, "fixture-account", otherProfile, null, 0));
  const saved = await bindAmazonAdsProfile(scope, owner, "888", seller, "fixture-account", otherProfile, accountBefore.advertiserAccountId, accountBefore.advertiserAccountRevision);
  assert.equal(saved.advertiserAccountId, "fixture-account");
  assert.equal(saved.advertiserAccountRevision, accountBefore.advertiserAccountRevision + 1);
  await assert.rejects(bindAmazonAdsProfile(scope, owner, "888", seller, "stale-account", otherProfile, accountBefore.advertiserAccountId, accountBefore.advertiserAccountRevision));
  assert.equal((await prisma.amazonAdsProfile.findUniqueOrThrow({ where: { id: otherProfile } })).advertiserAccountId, "fixture-account");
  assert.deepEqual(await prisma.amazonAdsSyncPlan.findUniqueOrThrow({ where: { id: secondPlan } }), before);
  assert.equal(await prisma.amazonAdsSyncTask.count({ where: { ...scope, profileId: otherProfile } }), tasksBefore);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: scope.organizationId, entityId: otherProfile, action: "amazon.ads.profile.binding.changed" }, orderBy: { createdAt: "desc" } });
  assert.equal((audit.metadata as { identityEvidence: string }).identityEvidence, "ADMIN_ENTERED_UNVERIFIED");
  assert.equal(JSON.stringify(audit.metadata).includes("fixture-account"), false);
  const cleared = await bindAmazonAdsProfile(scope, owner, "888", undefined, null, otherProfile, saved.advertiserAccountId, saved.advertiserAccountRevision);
  assert.equal(cleared.sellerAccountId, seller, "account-only updates preserve the current store");
  await assert.rejects(bindAmazonAdsProfile(scope, owner, "888", undefined, "stale-after-clear", otherProfile, accountBefore.advertiserAccountId, accountBefore.advertiserAccountRevision), { message: "账户绑定已被修改，请刷新后重试。" });
});

test("Product Ad pagination resumes checkpoint 6, updates the current object and remains scoped", async () => {
  const original = await prisma.amazonAdsEntityRecord.findFirstOrThrow({ where: { ...scope, profileId: profile, entityType: "SP:product-ad", externalId: "701" } });
  const originalPlan = await prisma.amazonAdsSyncPlan.findUniqueOrThrow({ where: { id: plan } });
  const task = await newTask();
  const cursors: Array<string | null> = [];
  const productAdapter = createSponsoredProductsReadAdapter(async (url, init) => {
    assert.equal(new URL(String(url)).pathname, "/sp/productAds/list");
    const body = JSON.parse(String(init?.body)); cursors.push(body.nextToken ?? null);
    return Response.json(body.nextToken
      ? { productAds: [{ adId: "702", campaignId: "101", adGroupId: "201", state: "ENABLED", asin: "B000FIXTURE" }] }
      : { productAds: [{ adId: "701", campaignId: "101", adGroupId: "201", state: "PAUSED", sku: "updated fixture sku", extendedData: { lastUpdateDateTime: "2026-11-06T02:00:00Z" } }], nextToken: "product-page2" });
  });
  try {
    await prisma.amazonAdsSyncPlan.update({ where: { id: plan }, data: { status: "ACTIVE" } });
    await prisma.amazonAdsSyncTask.update({ where: { id: task.id }, data: { stage: "product-ads", planRevision: originalPlan.revision, checkpointCiphertext: encryptAmazonAdsCheckpoint({ stage: 6, cursor: null, pages: 0 }, credentialScope, task.id) } });
    await processAmazonAdsSyncTask(task.id, 1, { adapter: productAdapter, oauth });
    const pending = await prisma.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(pending.status, "WAITING");
    assert.equal(pending.stage, "product-ads");
    assert.deepEqual(decryptAmazonAdsCheckpoint(pending.checkpointCiphertext, credentialScope, task.id), { stage: 6, cursor: "product-page2", pages: 1 });
    const done = await drain(task.id, productAdapter);
    assert.equal(done.status, "SUCCEEDED"); assert.equal(done.apiRequests, 2);
    assert.deepEqual(cursors, [null, "product-page2"]);
    const data = await queryAdsEntities(scope, member, new URLSearchParams({ internalProfileId: profile, entityType: "SP:product-ad", campaignId: "101", adGroupId: "201" }));
    assert.equal(data.total, 2);
    assert.equal(data.rows.find(row => row.externalId === "701")?.state, "PAUSED");
    assert.equal((data.rows.find(row => row.externalId === "701")?.payload as { sku: string }).sku, "updated fixture sku");
    assert.equal(await prisma.amazonAdsEntityRecord.count({ where: { ...scope, profileId: profile, entityType: "SP:product-ad", externalId: "701" } }), 1);
    assert.equal((await prisma.amazonAdsEntityRecord.findFirstOrThrow({ where: { ...scope, profileId: otherProfile, entityType: "SP:product-ad", externalId: "701" } })).state, "ENABLED");
  } finally {
    await prisma.amazonAdsEntityRecord.deleteMany({ where: { ...scope, profileId: profile, entityType: "SP:product-ad", externalId: "702" } });
    await prisma.amazonAdsEntityRecord.update({ where: { id: original.id }, data: { state: original.state, payload: original.payload as Prisma.InputJsonValue, sourceUpdatedAt: original.sourceUpdatedAt, sourceTaskId: original.sourceTaskId } });
    await prisma.amazonAdsSyncPlan.update({ where: { id: plan }, data: { status: originalPlan.status } });
  }
});
