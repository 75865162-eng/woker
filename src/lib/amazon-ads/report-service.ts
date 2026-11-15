import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { amazonDataAccess, sellerAccessWhere } from "@/lib/amazon-sync/data-access";
import type { SyncScope } from "@/lib/amazon-sync/policy";
import { isAdsRegion } from "./sync-adapter";
import { assertAdsSettingsManager } from "./authorization";
import { decryptAmazonAdsRefreshToken, decryptAmazonAdsCheckpoint, encryptAmazonAdsCheckpoint } from "./credentials";
import { createAmazonAdsOAuthTransport, type AmazonAdsOAuthTransport } from "./oauth-contract";
import { AdsQueryError } from "./query-contract";
import { ReportReadRetryError } from "./report-retry";
import { createSpReportTransport, type SpReportTransport } from "./reporting-v3-transport";
import {
  defaultSpReportLimits, isDateOnly, parseSpReportFile, spReportDefinition, spReportRequest, spReportWindow,
  spReportTypeIds, type SpReportRequest, type SpReportType,
} from "./sp-report-types";

export { spReportWindow };

/** 报表采集触发器。结构同步的 trigger 集合保持不变，报表任务必须可区分。 */
export const spReportTrigger = "sp-report";
export const spReportApiVersion = "reporting-v3";
export const spReportAdProduct = "SPONSORED_PRODUCTS";
const attributionWindow = "7d";
const leaseMs = 180_000;
const maxPolls = 30;
const maxCreateAttempts = 3;

export type ReportCheckpoint = {
  v: 1;
  type: SpReportType;
  from: string;
  to: string;
  columns: "full" | "core";
  phase: "CREATE" | "POLL" | "DOWNLOAD" | "PUBLISH" | "DONE";
  request: SpReportRequest;
  calls: { create: number; poll: number; download: number };
  reportId?: string;
  urlCiphertext?: string;
  nextAttemptAt?: string;
  rowCount?: number;
  versionId?: string;
  mergedRows?: number;
  ignoredColumns?: string[];
  warnings?: string[];
};

export type ReportPipelineDeps = {
  transport?: SpReportTransport;
  oauth?: AmazonAdsOAuthTransport;
  accessToken?: string;
  clientId?: string;
  now?: () => Date;
};

function config(now: Date) {
  return {
    clientId: process.env.AMAZON_ADS_LWA_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.AMAZON_ADS_LWA_CLIENT_SECRET?.trim() ?? "",
    now,
  };
}

/** 默认开启；显式 off 才停。真实请求仍需云端执行角色与有效授权。 */
export function spReportPipelineEnabled(env: Record<string, string | undefined> = process.env) {
  return (env.AMAZON_ADS_REPORTING_MODE ?? "live").toLowerCase() !== "off";
}

function assertReportPipeline() {
  if (!spReportPipelineEnabled()) throw new AdsQueryError("ADS_REPORT_PIPELINE_DISABLED", 403);
}

const json = (value: unknown) => value as Prisma.InputJsonValue;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

function readCheckpoint(value: unknown): ReportCheckpoint {
  const state = value as ReportCheckpoint | null;
  if (!state || state.v !== 1 || !spReportTypeIds.includes(state.type) || !isDateOnly(state.from) || !isDateOnly(state.to) || state.from > state.to
    || !["CREATE", "POLL", "DOWNLOAD", "PUBLISH", "DONE"].includes(state.phase) || !state.request || !state.calls
    || !Number.isSafeInteger(state.calls.create) || state.calls.create < 0 || state.calls.create > maxCreateAttempts
    || !Number.isSafeInteger(state.calls.poll) || state.calls.poll < 0 || state.calls.poll > maxPolls
    || !Number.isSafeInteger(state.calls.download) || state.calls.download < 0 || state.calls.download > 3) throw new AdsQueryError("ADS_REPORT_CHECKPOINT_INVALID");
  spReportRequest(state.type, state.from, state.to, state.columns);
  return state;
}

function checkpointAad(taskId: string) {
  return taskId;
}
function urlAad(taskId: string) {
  return `${taskId}:download-url`;
}

type ScopeTask = Prisma.AmazonAdsSyncTaskGetPayload<{ include: { plan: true } }>;

/** 创建（或复用）某类型某窗口的报表任务。幂等，不激活计划、不改授权。 */
export async function ensureSpReportTask(
  scope: SyncScope,
  planId: string,
  type: SpReportType,
  window: { from: string; to: string },
) {
  assertReportPipeline();
  if (!isDateOnly(window.from) || !isDateOnly(window.to) || window.from > window.to) throw new AdsQueryError("ADS_REPORT_DATE_RANGE_INVALID");
  return prisma.$transaction(async tx => {
    const plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: planId }, include: { profile: { include: { authorization: true } } } });
    if (!plan) throw new AdsQueryError("ADS_REPORT_PLAN_NOT_FOUND", 404);
    if (plan.status !== "ACTIVE" || !plan.profile.sellerAccountId || plan.profile.authorization.status !== "CONNECTED") throw new AdsQueryError("ADS_REPORT_PLAN_NOT_READY", 409);
    const idempotencyKey = `sp-report:${plan.id}:${plan.revision}:${type}:${window.from}:${window.to}`;
    const found = await tx.amazonAdsSyncTask.findUnique({ where: { organizationId_workspaceId_idempotencyKey: { ...scope, idempotencyKey } } });
    if (found) return { taskId: found.id, created: false, status: found.status };
    const created = await tx.amazonAdsSyncTask.create({ data: {
      ...scope, id: randomUUID(), planId: plan.id, profileId: plan.profileId, requestedByUserId: plan.actorUserId,
      idempotencyKey, planRevision: plan.revision, trigger: spReportTrigger, stage: "REPORT_CREATE",
      requestedFrom: new Date(`${window.from}T00:00:00Z`), requestedTo: new Date(`${window.to}T00:00:00Z`),
    } });
    const state: ReportCheckpoint = {
      v: 1, type, from: window.from, to: window.to, columns: "full", phase: "CREATE",
      request: spReportRequest(type, window.from, window.to, "full"),
      calls: { create: 0, poll: 0, download: 0 },
    };
    const authorizationScope = { ...scope, authorizationId: plan.profile.authorizationId };
    await tx.amazonAdsSyncTask.update({ where: { id: created.id }, data: { checkpointCiphertext: encryptAmazonAdsCheckpoint(state, authorizationScope, checkpointAad(created.id)) } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: plan.actorUserId, action: "amazon.ads.report.task.created", entityType: "AmazonAdsSyncTask", entityId: created.id, metadata: { workspaceId: scope.workspaceId, profileId: plan.profileId, reportType: type, from: window.from, to: window.to, mode: spReportApiVersion } } });
    return { taskId: created.id, created: true, status: created.status };
  });
}

/** 为一个计划补齐五类报表任务（缺哪类建哪类）。 */
export async function ensureSpReportTasksForPlan(scope: SyncScope, planId: string, now = new Date()) {
  const plan = await prisma.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: planId }, select: { id: true, reportLookbackDays: true } });
  if (!plan) throw new AdsQueryError("ADS_REPORT_PLAN_NOT_FOUND", 404);
  const created: string[] = [];
  const existing: string[] = [];
  for (const type of spReportTypeIds) {
    const window = spReportWindow(type, now, plan.reportLookbackDays);
    const result = await ensureSpReportTask(scope, plan.id, type, window);
    (result.created ? created : existing).push(`${type}:${result.taskId}`);
  }
  return { created, existing };
}

type Claim = {
  task: ScopeTask;
  profile: Prisma.AmazonAdsProfileGetPayload<{ include: { authorization: true } }>;
  fence: { taskId: string; dispatchVersion: number; fenceVersion: number; leaseOwner: string };
  state: ReportCheckpoint;
};

async function claimTask(taskId: string, dispatchVersion: number, now: Date): Promise<Claim | null> {
  return prisma.$transaction(async tx => {
    const initial = await tx.amazonAdsSyncTask.findFirst({ where: { id: taskId, trigger: spReportTrigger, dispatchVersion, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] }, nextAttemptAt: { lte: now } }, include: { plan: true } });
    if (!initial) return null;
    const scope = { organizationId: initial.organizationId, workspaceId: initial.workspaceId };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-report-task:${taskId}`}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-report-profile:${initial.profileId}`}, 0))`;
    // 官方限制：每个广告主账号同时只跑 1 份报表，串行化避免 425。
    const busy = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, trigger: spReportTrigger, profileId: initial.profileId, id: { not: taskId }, status: "RUNNING", leaseExpiresAt: { gt: now } }, select: { id: true } });
    if (busy) {
      await tx.amazonAdsSyncTask.updateMany({ where: { id: taskId, dispatchVersion, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] } }, data: { status: "WAITING", nextAttemptAt: new Date(now.getTime() + 60_000) } });
      return null;
    }
    const profile = await tx.amazonAdsProfile.findFirst({ where: { ...scope, id: initial.profileId }, include: { authorization: true } });
    if (!profile || !profile.sellerAccountId || !profile.advertiserAccountId || !isAdsRegion(profile.region) || profile.authorization.status !== "CONNECTED") return null;
    const plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: initial.planId, revision: initial.planRevision, status: "ACTIVE" } });
    if (!plan) {
      await tx.amazonAdsSyncTask.updateMany({ where: { id: taskId, dispatchVersion }, data: { status: "BLOCKED", errorCode: "ADS_REPORT_PLAN_CHANGED", finishedAt: now, dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null } });
      return null;
    }
    const fenceVersion = initial.fenceVersion + 1;
    const leaseOwner = `report-${process.pid}-${randomUUID()}`;
    const changed = await tx.amazonAdsSyncTask.updateMany({ where: { id: taskId, dispatchVersion, fenceVersion: initial.fenceVersion, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] } }, data: {
      status: "RUNNING", fenceVersion, leaseOwner, leaseExpiresAt: new Date(now.getTime() + leaseMs), startedAt: initial.startedAt ?? now, errorCode: null, errorMessage: null,
    } });
    if (changed.count !== 1) return null;
    await tx.amazonAdsSyncAttempt.upsert({
      where: { organizationId_workspaceId_taskId_attemptNumber: { ...scope, taskId, attemptNumber: initial.dispatchVersion } },
      create: { id: randomUUID(), ...scope, profileId: initial.profileId, taskId, attemptNumber: initial.dispatchVersion, stage: initial.stage, status: "RUNNING" },
      update: { stage: initial.stage, status: "RUNNING", startedAt: now, finishedAt: null, retryAt: null, errorCode: null, safeErrorSummary: null },
    });
    const authorizationScope = { ...scope, authorizationId: profile.authorizationId };
    const state = readCheckpoint(decryptAmazonAdsCheckpoint(initial.checkpointCiphertext, authorizationScope, checkpointAad(taskId)));
    return { task: { ...initial, plan }, profile, fence: { taskId, dispatchVersion, fenceVersion, leaseOwner }, state };
  }, { timeout: 15000 });
}

async function resolveAccessToken(claim: Claim, deps: ReportPipelineDeps, now: Date) {
  if (deps.accessToken) return { accessToken: deps.accessToken, clientId: deps.clientId ?? "test-client" };
  const settings = config(now);
  if (!settings.clientId || !settings.clientSecret) throw new AdsQueryError("ADS_OAUTH_CONFIG_MISSING");
  const scope = { organizationId: claim.task.organizationId, workspaceId: claim.task.workspaceId, authorizationId: claim.profile.authorizationId };
  const refreshToken = decryptAmazonAdsRefreshToken(claim.profile.authorization.credentialsCiphertext, scope);
  const oauth = deps.oauth ?? createAmazonAdsOAuthTransport();
  if (!isAdsRegion(claim.profile.authorization.consentRegion)) throw new AdsQueryError("ADS_REGION_INVALID");
  const accessToken = await oauth.refreshAccessToken({ region: claim.profile.authorization.consentRegion, refreshToken, clientId: settings.clientId, clientSecret: settings.clientSecret });
  return { accessToken, clientId: settings.clientId };
}

type StepOutcome = { phase: ReportCheckpoint["phase"]; nextAttemptAt: Date; rowCount?: number; note?: string };

async function runCreate(claim: Claim, transport: SpReportTransport, credentials: { accessToken: string; clientId: string }, now: Date): Promise<StepOutcome> {
  const state = claim.state;
  if (state.calls.create >= maxCreateAttempts) throw new AdsQueryError("ADS_REPORT_CREATE_BUDGET_EXCEEDED");
  state.calls.create += 1;
  const receipt = await transport.create({
    region: claim.profile.region as "NA" | "EU" | "FE", clientId: credentials.clientId, accessToken: credentials.accessToken,
    profileId: claim.profile.profileId, advertiserAccountId: claim.profile.advertiserAccountId, request: state.request,
  });
  state.reportId = receipt.reportId;
  return { phase: "POLL", nextAttemptAt: new Date(now.getTime() + 60_000) };
}

async function runPoll(claim: Claim, transport: SpReportTransport, credentials: { accessToken: string; clientId: string }, scope: { organizationId: string; workspaceId: string; authorizationId: string }, now: Date): Promise<StepOutcome> {
  const state = claim.state;
  if (!state.reportId) throw new AdsQueryError("ADS_REPORT_CHECKPOINT_INVALID");
  if (state.calls.poll >= maxPolls) throw new AdsQueryError("ADS_REPORT_POLL_BUDGET_EXCEEDED");
  state.calls.poll += 1;
  const receipt = await transport.retrieve({
    region: claim.profile.region as "NA" | "EU" | "FE", clientId: credentials.clientId, accessToken: credentials.accessToken,
    profileId: claim.profile.profileId, reportId: state.reportId,
  });
  if (receipt.reportId !== state.reportId) throw new AdsQueryError("ADS_REPORT_ID_MISMATCH");
  if (receipt.status === "FAILED") throw new AdsQueryError("ADS_REPORT_UPSTREAM_FAILED");
  if (receipt.status === "COMPLETED") {
    if (!receipt.url) throw new AdsQueryError("ADS_REPORT_ENVELOPE_INVALID");
    state.urlCiphertext = encryptAmazonAdsCheckpoint(receipt.url, scope, urlAad(claim.task.id));
    return { phase: "DOWNLOAD", nextAttemptAt: now };
  }
  return { phase: "POLL", nextAttemptAt: new Date(now.getTime() + 60_000) };
}

async function runDownload(claim: Claim, transport: SpReportTransport, scope: { organizationId: string; workspaceId: string; authorizationId: string }, now: Date): Promise<StepOutcome> {
  const state = claim.state;
  if (!state.urlCiphertext) throw new AdsQueryError("ADS_REPORT_CHECKPOINT_INVALID");
  if (state.calls.download >= 3) throw new AdsQueryError("ADS_REPORT_DOWNLOAD_BUDGET_EXCEEDED");
  state.calls.download += 1;
  const url = decryptAmazonAdsCheckpoint<string>(state.urlCiphertext, scope, urlAad(claim.task.id));
  if (typeof url !== "string" || !url) throw new AdsQueryError("ADS_REPORT_CHECKPOINT_INVALID");
  const bytes = await transport.download({ url, maxBytes: defaultSpReportLimits.compressedBytes });
  const currencyCode = claim.profile.currencyCode;
  if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) throw new AdsQueryError("ADS_REPORT_PROFILE_CURRENCY_MISSING");
  const parsed = parseSpReportFile(state.type, bytes, { from: state.from, to: state.to, currencyCode, limits: defaultSpReportLimits });
  const dbScope = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const stored = await storeRawFile(dbScope, claim, bytes, parsed.rowCount);
  await persistFacts(dbScope, claim, parsed, currencyCode, stored);
  return { phase: "PUBLISH", nextAttemptAt: now, rowCount: parsed.facts.length, note: parsed.mergedRows ? `merged=${parsed.mergedRows}` : undefined };
}

async function storeRawFile(scope: SyncScope, claim: Claim, bytes: Buffer, rowCount: number) {
  const storage = getStorageDriver();
  const key = `amazon-ads/reports/${digest([scope.organizationId, scope.workspaceId, claim.task.id])}/part-0.gz.enc`;
  const rawSha256 = createHash("sha256").update(bytes).digest("hex");
  const encrypted = Buffer.from(encryptAmazonAdsCheckpoint({ bytesBase64: bytes.toString("base64"), contentSha256: rawSha256, byteSize: bytes.length }, { ...scope, authorizationId: claim.profile.authorizationId }, `${claim.task.id}:file`));
  const put = await storage.putBuffer({ key, buffer: encrypted, contentType: "application/octet-stream" });
  if (put.key !== key || put.size !== encrypted.length) throw new AdsQueryError("ADS_REPORT_STORAGE_MISMATCH");
  if (storage.getBoundedBuffer) {
    const persisted = await storage.getBoundedBuffer(key, encrypted.length);
    if (persisted.length !== encrypted.length || createHash("sha256").update(persisted).digest("hex") !== createHash("sha256").update(encrypted).digest("hex")) throw new AdsQueryError("ADS_REPORT_FILE_INTEGRITY_MISMATCH");
  }
  return { key, byteSize: encrypted.length, contentSha256: createHash("sha256").update(encrypted).digest("hex"), rowCount, rawBytes: bytes.length, rawSha256 };
}

async function persistFacts(
  scope: SyncScope,
  claim: Claim,
  parsed: ReturnType<typeof parseSpReportFile>,
  currencyCode: string,
  stored: { key: string; byteSize: number; contentSha256: string; rowCount: number; rawBytes: number },
) {
  const state = claim.state;
  const { from, to, type } = state;
  await prisma.$transaction(async tx => {
    const task = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, id: claim.task.id, status: "RUNNING", fenceVersion: claim.fence.fenceVersion, leaseOwner: claim.fence.leaseOwner } });
    if (!task) throw new AdsQueryError("ADS_REPORT_FENCE_LOST", 409);
    const file = await tx.fileObject.create({ data: {
      ...scope, id: randomUUID(), userId: claim.task.requestedByUserId, accountId: claim.profile.sellerAccountId!, marketplace: claim.profile.marketplaceId ?? "",
      originalName: `sp-${type}-${from}-${to}.json.gz.enc`, mimeType: "application/octet-stream", storageType: "local", status: "done",
      storageKey: stored.key, size: stored.byteSize, contentHash: stored.contentSha256,
    } });
    const version = await tx.amazonAdsReportVersion.findUnique({ where: { organizationId_workspaceId_sourceTaskId: { ...scope, sourceTaskId: claim.task.id } } })
      ?? await tx.amazonAdsReportVersion.create({ data: {
        id: randomUUID(), ...scope, profileId: claim.profile.id, sourceTaskId: claim.task.id,
        requestedFrom: new Date(`${from}T00:00:00Z`), requestedTo: new Date(`${to}T00:00:00Z`), status: "STAGING", rowCount: parsed.facts.length,
      } });
    const request = await tx.amazonAdsReportRequest.upsert({
      where: { organizationId_workspaceId_idempotencyKey: { ...scope, idempotencyKey: `sp-report:${claim.task.id}` } },
      create: {
        id: randomUUID(), ...scope, profileId: claim.profile.id, sourceTaskId: claim.task.id, versionId: version.id,
        idempotencyKey: `sp-report:${claim.task.id}`, apiVersion: spReportApiVersion, reportType: type, adProduct: spReportAdProduct,
        requestedFrom: new Date(`${from}T00:00:00Z`), requestedTo: new Date(`${to}T00:00:00Z`),
        requestOptions: json({ mode: "live-v3", reportTypeId: state.request.configuration.reportTypeId, groupBy: state.request.configuration.groupBy, columns: state.request.configuration.columns, currencyCode, timezone: claim.profile.timezone ?? "UTC", ignoredColumns: parsed.ignoredColumns, mergedRows: parsed.mergedRows }),
        remoteRequestId: state.reportId ?? null, status: "COMPLETED", completedAt: new Date(), lastPolledAt: new Date(),
      },
      update: { versionId: version.id, remoteRequestId: state.reportId ?? null, status: "COMPLETED", completedAt: new Date(), lastPolledAt: new Date(), errorCode: null },
    });
    await tx.amazonAdsReportDocument.create({ data: {
      id: randomUUID(), ...scope, profileId: claim.profile.id, requestId: request.id, partIndex: 0, format: "GZIP_JSON", compression: "GZIP",
      status: "VALIDATED", storageFileId: file.id, contentSha256: stored.contentSha256, byteSize: BigInt(stored.byteSize), rowCount: stored.rowCount, downloadedAt: new Date(),
    } });
    const chunkSize = 1000;
    for (let index = 0; index < parsed.facts.length; index += chunkSize) {
      const chunk = parsed.facts.slice(index, index + chunkSize);
      await tx.amazonAdsReportFact.createMany({ data: chunk.map(fact => ({
        id: randomUUID(), ...scope, profileId: claim.profile.id, versionId: version.id, sourceTaskId: claim.task.id,
        reportType: type, adProduct: spReportAdProduct, reportDate: new Date(`${fact.reportDate}T00:00:00Z`),
        factKey: digest([type, spReportAdProduct, spReportApiVersion, currencyCode, attributionWindow, fact.reportDate, fact.dimensions]),
        campaignId: fact.dimensions.campaignId ?? null, adGroupId: fact.dimensions.adGroupId ?? null, targetingId: fact.dimensions.targetingId ?? null,
        advertisedAsin: fact.dimensions.advertisedAsin ?? null, searchTerm: fact.dimensions.searchTerm ?? null, placement: fact.dimensions.placement ?? null,
        impressions: fact.impressions == null ? null : BigInt(fact.impressions),
        clicks: fact.clicks == null ? null : BigInt(fact.clicks),
        spend: fact.spend == null ? null : new Prisma.Decimal(fact.spend),
        orders: fact.orders == null ? null : BigInt(fact.orders),
        sales: fact.sales == null ? null : new Prisma.Decimal(fact.sales),
        units: fact.units == null ? null : BigInt(fact.units),
        currencyCode, attributionWindow, apiVersion: spReportApiVersion, rawDimensions: json(fact.dimensions),
      })), skipDuplicates: true });
    }
    state.versionId = version.id;
    state.rowCount = parsed.facts.length;
    state.mergedRows = parsed.mergedRows;
    state.ignoredColumns = parsed.ignoredColumns;
    state.warnings = parsed.facts.length ? [] : ["ADS_REPORT_EMPTY"];
  }, { timeout: 60000 });
}

async function publishVersion(scope: SyncScope, claim: Claim, now: Date) {
  const state = claim.state;
  if (!state.versionId) throw new AdsQueryError("ADS_REPORT_CHECKPOINT_INVALID");
  await prisma.$transaction(async tx => {
    const task = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, id: claim.task.id, status: "RUNNING", fenceVersion: claim.fence.fenceVersion, leaseOwner: claim.fence.leaseOwner } });
    if (!task) throw new AdsQueryError("ADS_REPORT_FENCE_LOST", 409);
    const version = await tx.amazonAdsReportVersion.findFirst({ where: { ...scope, id: state.versionId!, sourceTaskId: claim.task.id, status: "STAGING" } });
    if (!version) throw new AdsQueryError("ADS_REPORT_VERSION_NOT_STAGING", 409);
    const count = await tx.amazonAdsReportFact.count({ where: { ...scope, versionId: version.id } });
    if (count !== (state.rowCount ?? -1)) throw new AdsQueryError("ADS_REPORT_ROW_COUNT_DRIFT");
    await tx.amazonAdsReportVersion.update({ where: { id: version.id }, data: { status: "PUBLISHED", rowCount: count, publishedAt: now } });
    await tx.amazonAdsSyncTask.update({ where: { id: claim.task.id }, data: {
      status: "SUCCEEDED", stage: "REPORT_PUBLISHED", finishedAt: now, leaseOwner: null, leaseExpiresAt: null,
      processedCount: count, insertedCount: count, errorCode: null, errorMessage: null,
    } });
    await tx.amazonAdsSyncAttempt.updateMany({ where: { ...scope, taskId: claim.task.id, attemptNumber: claim.fence.dispatchVersion, status: "RUNNING" }, data: { status: "SUCCEEDED", finishedAt: now, retryAt: null, errorCode: null, processedCount: count } });
    await tx.amazonAdsSyncDomainState.upsert({
      where: { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: claim.profile.id, dataDomain: "reports", reportType: state.type } },
      create: { id: randomUUID(), ...scope, profileId: claim.profile.id, dataDomain: "reports", reportType: state.type, status: "CURRENT", lastAttemptAt: now, lastSuccessAt: now, lastTaskId: claim.task.id, warningCodes: state.warnings ?? [] },
      update: { status: "CURRENT", lastAttemptAt: now, lastSuccessAt: now, lastTaskId: claim.task.id, warningCodes: state.warnings ?? [] },
    });
    await tx.amazonAdsSyncPlan.updateMany({ where: { ...scope, id: claim.task.planId }, data: { lastSuccessAt: now, lastErrorCode: null } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: claim.task.requestedByUserId, action: "amazon.ads.report.published", entityType: "AmazonAdsReportVersion", entityId: version.id, metadata: { workspaceId: scope.workspaceId, profileId: claim.profile.id, reportType: state.type, from: state.from, to: state.to, rowCount: count, mode: spReportApiVersion } } });
  }, { timeout: 30000 });
  state.phase = "DONE";
}

/** 单步推进。一次调用最多一次远程请求 + 一次本地写入；等待中的报表不占 worker 租约。 */
export async function processAmazonAdsReportTask(taskId: string, dispatchVersion: number, deps: ReportPipelineDeps = {}) {
  assertReportPipeline();
  const now = deps.now?.() ?? new Date();
  const claim = await claimTask(taskId, dispatchVersion, now);
  if (!claim) return { outcome: "skipped" as const };
  const scope = { organizationId: claim.task.organizationId, workspaceId: claim.task.workspaceId };
  const authorizationScope = { ...scope, authorizationId: claim.profile.authorizationId };
  let next: { phase: ReportCheckpoint["phase"]; nextAttemptAt: Date } | null = null;
  let blocked: string | null = null;
  try {
    const credentials = await resolveAccessToken(claim, deps, now);
    const transport = deps.transport ?? createSpReportTransport();
    if (claim.state.phase === "CREATE") next = await runCreate(claim, transport, credentials, now);
    else if (claim.state.phase === "POLL") next = await runPoll(claim, transport, credentials, authorizationScope, now);
    else if (claim.state.phase === "DOWNLOAD") next = await runDownload(claim, transport, authorizationScope, now);
    else if (claim.state.phase === "PUBLISH") { await publishVersion(scope, claim, now); next = { phase: "DONE", nextAttemptAt: now }; }
    else next = { phase: "DONE", nextAttemptAt: now };
  } catch (error) {
    const code = error instanceof AdsQueryError && /^ADS_[A-Z0-9_]+$/.test(error.message) ? error.message : "ADS_REPORT_PIPELINE_FAILED";
    // 列被拒时降级为兼容列重试一次，避免个别可选列挡住整类报表。
    if (code === "ADS_REPORT_COLUMNS_REJECTED" && claim.state.columns === "full" && claim.state.phase === "CREATE") {
      claim.state.columns = "core";
      claim.state.request = spReportRequest(claim.state.type, claim.state.from, claim.state.to, "core");
      next = { phase: "CREATE", nextAttemptAt: now };
    } else if (error instanceof ReportReadRetryError) {
      next = { phase: claim.state.phase, nextAttemptAt: new Date(Math.max(error.retryAt, now.getTime() + 5_000)) };
      blocked = null;
      await finalize(scope, claim, claim.state, next, code, now, true);
      return { outcome: "retry" as const, code };
    } else {
      blocked = code;
    }
  }
  if (blocked) {
    await finalize(scope, claim, claim.state, null, blocked, now, false);
    return { outcome: "blocked" as const, code: blocked };
  }
  await finalize(scope, claim, claim.state, next, null, now, true);
  if (next?.phase === "DONE") return { outcome: "succeeded" as const, rowCount: claim.state.rowCount ?? 0 };
  return { outcome: "advanced" as const, phase: next?.phase ?? claim.state.phase };
}

async function finalize(
  scope: SyncScope,
  claim: Claim,
  state: ReportCheckpoint,
  next: { phase: ReportCheckpoint["phase"]; nextAttemptAt: Date } | null,
  errorCode: string | null,
  now: Date,
  retryable: boolean,
) {
  const terminal = !retryable || next?.phase === "DONE";
  if (next) {
    state.phase = next.phase;
    if (terminal) delete state.nextAttemptAt;
    else state.nextAttemptAt = next.nextAttemptAt.toISOString();
  }
  await prisma.$transaction(async tx => {
    const task = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, id: claim.task.id, fenceVersion: claim.fence.fenceVersion, leaseOwner: claim.fence.leaseOwner, status: "RUNNING" } });
    if (!task) return;
    const ciphertext = encryptAmazonAdsCheckpoint(state, { ...scope, authorizationId: claim.profile.authorizationId }, checkpointAad(claim.task.id));
    if (terminal && errorCode) {
      await tx.amazonAdsSyncTask.update({ where: { id: task.id }, data: { status: "BLOCKED", stage: `REPORT_${state.phase}`, errorCode, errorMessage: "报表采集未完成；已保留检查点与已入库数据。", checkpointCiphertext: ciphertext, dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, finishedAt: now } });
      await tx.amazonAdsSyncAttempt.updateMany({ where: { ...scope, taskId: task.id, attemptNumber: claim.fence.dispatchVersion, status: "RUNNING" }, data: { status: "BLOCKED", finishedAt: now, errorCode } });
      await tx.amazonAdsSyncDomainState.upsert({
        where: { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: claim.profile.id, dataDomain: "reports", reportType: state.type } },
        create: { id: randomUUID(), ...scope, profileId: claim.profile.id, dataDomain: "reports", reportType: state.type, status: "FAILED", lastAttemptAt: now, lastTaskId: task.id, warningCodes: [errorCode] },
        update: { status: "FAILED", lastAttemptAt: now, lastTaskId: task.id, warningCodes: [errorCode] },
      });
      await tx.amazonAdsReportRequest.updateMany({ where: { ...scope, sourceTaskId: task.id }, data: { status: "FAILED", errorCode } });
      return;
    }
    if (next?.phase === "DONE") {
      await tx.amazonAdsSyncTask.update({ where: { id: task.id }, data: { checkpointCiphertext: ciphertext, stage: "REPORT_PUBLISHED", errorCode: null } });
      return;
    }
    await tx.amazonAdsSyncTask.update({ where: { id: task.id }, data: {
      status: "WAITING", stage: `REPORT_${state.phase}`, checkpointCiphertext: ciphertext, errorCode: errorCode ?? null,
      nextAttemptAt: next?.nextAttemptAt ?? new Date(now.getTime() + 60_000), dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null,
    } });
    if (errorCode) await tx.amazonAdsSyncAttempt.updateMany({ where: { ...scope, taskId: task.id, attemptNumber: claim.fence.dispatchVersion, status: "RUNNING" }, data: { status: "RETRY_WAIT", finishedAt: now, retryAt: next?.nextAttemptAt ?? now, errorCode } });
    if (state.reportId) await tx.amazonAdsReportRequest.updateMany({ where: { ...scope, sourceTaskId: task.id }, data: { remoteRequestId: state.reportId, status: "POLLING", lastPolledAt: now } });
  }, { timeout: 20000 });
}

/** 该 Profile 是否已有可调度的报表任务（供调度器决定是否入队）。 */
export async function nextReportTaskForProfile(scope: SyncScope, profileId: string, now = new Date()) {
  const active = await prisma.amazonAdsSyncTask.findFirst({ where: { ...scope, trigger: spReportTrigger, profileId, status: "RUNNING", leaseExpiresAt: { gt: now } }, select: { id: true } });
  if (active) return null;
  const due = await prisma.amazonAdsSyncTask.findMany({ where: { ...scope, trigger: spReportTrigger, profileId, status: { in: ["WAITING", "RETRY_WAIT"] }, nextAttemptAt: { lte: now } }, orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }], take: 1, select: { id: true, dispatchVersion: true } });
  return due[0] ?? null;
}

export type ReportTypeStatus = {
  reportType: SpReportType;
  label: string;
  reportTypeId: string;
  status: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  coveredFrom: string | null;
  coveredTo: string | null;
  publishedRows: number;
  activeTask: { id: string; status: string; stage: string; errorCode: string | null; nextAttemptAt: string } | null;
  latestVersion: { id: string; rowCount: number; publishedAt: string | null; requestedFrom: string | null; requestedTo: string | null } | null;
  warningCodes: string[];
};

/** 五类报表在给定 Profile 上的采集状态。 */
export async function spReportStatus(scope: SyncScope, profileIds: string[]): Promise<ReportTypeStatus[]> {
  if (!profileIds.length) return [];
  const [states, tasks, requests] = await Promise.all([
    prisma.amazonAdsSyncDomainState.findMany({ where: { ...scope, profileId: { in: profileIds }, dataDomain: "reports" } }),
    prisma.amazonAdsSyncTask.findMany({ where: { ...scope, trigger: spReportTrigger, profileId: { in: profileIds } }, orderBy: [{ createdAt: "desc" }], take: 500, select: { id: true, status: true, stage: true, errorCode: true, nextAttemptAt: true } }),
    prisma.amazonAdsReportRequest.findMany({ where: { ...scope, profileId: { in: profileIds }, apiVersion: spReportApiVersion }, orderBy: [{ createdAt: "desc" }], take: 500, select: { id: true, reportType: true, status: true, sourceTaskId: true, versionId: true, requestedFrom: true, requestedTo: true, errorCode: true, completedAt: true } }),
  ]);
  const versionIds = requests.map(request => request.versionId).filter((id): id is string => Boolean(id));
  const versions = versionIds.length ? await prisma.amazonAdsReportVersion.findMany({ where: { ...scope, id: { in: versionIds } }, select: { id: true, rowCount: true, publishedAt: true, status: true } }) : [];
  const taskById = new Map(tasks.map(task => [task.id, task]));
  return spReportTypeIds.map(type => {
    const definition = spReportDefinition(type);
    const state = states.find(row => row.reportType === type);
    const typeRequests = requests.filter(request => request.reportType === type);
    const latest = typeRequests.find(request => request.status === "COMPLETED") ?? typeRequests[0];
    const version = latest?.versionId ? versions.find(row => row.id === latest.versionId && row.status === "PUBLISHED") ?? null : null;
    const activeTask = typeRequests.map(request => taskById.get(request.sourceTaskId)).find(task => task && ["RUNNING", "WAITING", "RETRY_WAIT"].includes(task.status)) ?? null;
    const lastRequestedTo = latest?.requestedTo ? dateOnly(latest.requestedTo) : null;
    return {
      reportType: type, label: definition.label, reportTypeId: definition.reportTypeId,
      status: state?.status ?? (version ? "CURRENT" : "MISSING"),
      lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? version?.publishedAt?.toISOString() ?? null,
      lastAttemptAt: state?.lastAttemptAt?.toISOString() ?? latest?.completedAt?.toISOString() ?? null,
      coveredFrom: state?.coveredFrom ? dateOnly(state.coveredFrom) : latest?.requestedFrom ? dateOnly(latest.requestedFrom) : null,
      coveredTo: state?.coveredTo ? dateOnly(state.coveredTo) : lastRequestedTo,
      publishedRows: version?.rowCount ?? 0,
      activeTask: activeTask ? { id: activeTask.id, status: activeTask.status, stage: activeTask.stage, errorCode: activeTask.errorCode, nextAttemptAt: activeTask.nextAttemptAt.toISOString() } : null,
      latestVersion: version ? { id: version.id, rowCount: version.rowCount, publishedAt: version.publishedAt?.toISOString() ?? null, requestedFrom: latest?.requestedFrom ? dateOnly(latest.requestedFrom) : null, requestedTo: lastRequestedTo } : null,
      warningCodes: [...new Set([...(state?.warningCodes ?? []), ...(latest?.errorCode ? [latest.errorCode] : [])])],
    };
  });
}

/** 供 API 复用：可见 Profile + 五类状态。 */
export async function reportAcquisitionOverview(scope: SyncScope, actor: string, profileRecordId?: string) {
  const access = await amazonDataAccess(scope, actor);
  const sellers = await prisma.sellerAccount.findMany({ where: { ...scope, status: "active" }, select: { id: true, displayName: true } });
  const profiles = await prisma.amazonAdsProfile.findMany({
    where: { ...scope, ...sellerAccessWhere(access), authorization: { status: "CONNECTED" }, ...(profileRecordId ? { id: profileRecordId } : {}), sellerAccountId: { in: sellers.map(seller => seller.id) } },
    select: { id: true, profileId: true, region: true, countryCode: true, marketplaceId: true, sellerAccountId: true, currencyCode: true, timezone: true, authorization: { select: { name: true, status: true } } },
    take: 50,
  });
  const statuses = await Promise.all(profiles.map(async profile => ({
    profile,
    reportTypes: await spReportStatus(scope, [profile.id]),
    plan: await prisma.amazonAdsSyncPlan.findFirst({ where: { ...scope, profileId: profile.id }, select: { id: true, status: true, revision: true, reportLookbackDays: true, intervalMinutes: true, lastSuccessAt: true, lastErrorCode: true } }),
  })));
  return {
    mode: spReportPipelineEnabled() ? "live" : "off",
    executionRole: process.env.AMAZON_API_EXECUTION_ROLE === "cloud" ? "cloud" : "local",
    oauthConfigured: Boolean(process.env.AMAZON_ADS_LWA_CLIENT_ID?.trim() && process.env.AMAZON_ADS_LWA_CLIENT_SECRET?.trim()),
    reportTypes: spReportTypeIds.map(type => {
      const definition = spReportDefinition(type);
      return { id: type, label: definition.label, capability: definition.capability, reportTypeId: definition.reportTypeId, groupBy: definition.groupBy, maxDays: definition.maxDays, retentionDays: definition.retentionDays, docs: definition.docs };
    }),
    profiles: statuses,
  };
}

/** 手动触发：为可见 Profile 补齐五类任务并立即入队（需要设置管理权限）。 */
export async function triggerSpReportSync(scope: SyncScope, actor: string, input: { profileRecordId?: string; from?: string; to?: string }) {
  assertReportPipeline();
  await assertAdsSettingsManager(scope, actor);
  const profile = await prisma.amazonAdsProfile.findFirst({ where: { ...scope, id: input.profileRecordId ?? "" }, include: { authorization: true } });
  if (!profile) throw new AdsQueryError("ADS_REPORT_PROFILE_FORBIDDEN", 403);
  const plan = await prisma.amazonAdsSyncPlan.findFirst({ where: { ...scope, profileId: profile.id }, select: { id: true, status: true, revision: true } });
  if (!plan) throw new AdsQueryError("ADS_REPORT_PLAN_NOT_FOUND", 404);
  if (plan.status !== "ACTIVE") throw new AdsQueryError("ADS_REPORT_PLAN_NOT_READY", 409);
  if (input.from || input.to) {
    if (!isDateOnly(input.from) || !isDateOnly(input.to) || input.from! > input.to!) throw new AdsQueryError("ADS_REPORT_DATE_RANGE_INVALID");
  }
  const created: Array<{ reportType: SpReportType; taskId: string; created: boolean; status: string }> = [];
  for (const type of spReportTypeIds) {
    const window = input.from && input.to ? { from: input.from, to: input.to } : spReportWindow(type, new Date(), 7);
    const result = await ensureSpReportTask(scope, plan.id, type, window);
    created.push({ reportType: type, taskId: result.taskId, created: result.created, status: result.status });
  }
  let enqueued = 0;
  try {
    const queue = getAmazonSyncQueue();
    for (const task of created) {
      const fresh = await prisma.amazonAdsSyncTask.findFirst({ where: { ...scope, id: task.taskId }, select: { dispatchVersion: true, status: true } });
      if (!fresh || !["WAITING", "RETRY_WAIT"].includes(fresh.status)) continue;
      await queue.add("process-amazon-ads-report-task", { runId: task.taskId, adsReportTaskId: task.taskId, adsReportDispatchVersion: fresh.dispatchVersion }, { jobId: `ads-report-${task.taskId}-${fresh.dispatchVersion}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
      await prisma.amazonAdsSyncTask.updateMany({ where: { ...scope, id: task.taskId, status: "WAITING", dispatchVersion: fresh.dispatchVersion }, data: { status: "QUEUED" } });
      enqueued += 1;
    }
  } catch {
    // 队列不可用时保留 WAITING 任务，调度器下一轮会重新投递。
  }
  return { planId: plan.id, profileId: profile.id, tasks: created, enqueued, executionRole: process.env.AMAZON_API_EXECUTION_ROLE === "cloud" ? "cloud" : "local" };
}
