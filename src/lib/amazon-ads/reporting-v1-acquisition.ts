import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getStorageDriver } from "@/lib/storage";
import { prisma } from "@/lib/db/prisma";
import type { SyncScope } from "@/lib/amazon-sync/policy";
import { amazonDataAccess, sellerAccessWhere } from "@/lib/amazon-sync/data-access";
import { assertIsolatedReportEnvironment } from "./report-acquisition";
import { encryptAmazonAdsCheckpoint, decryptAmazonAdsCheckpoint } from "./credentials";
import { AdsQueryError } from "./query-contract";
import { assertReportDeadline } from "./report-deadline";
import type { AdsReportFence } from "./report-publication";
import { ReportReadRetryError, reportReadRetryAt } from "./report-retry";
import { assertReportingV1ReceiptMatches, snapshotReportingV1CreateReport, type ReportingV1CreateReport, type ReportingV1Part, type ReportingV1Transport } from "./reporting-v1-transport";
import type { AdsRegion } from "./oauth-contract";

const trigger = "isolated-reporting-v1";
const evidence = "ISOLATED_FIXTURE_ONLY";
/** Isolated protocol acquisition only: no production factory, queue hook or fact publication. */
export type IsolatedReportingV1Transport = ReportingV1Transport & { evidence: "ISOLATED_FIXTURE_ONLY" };
type State = {
  version: 2; phase: "CREATE" | "POLL" | "ACQUIRED" | "DOWNLOADING" | "RAW_STORED"; scopeDigest: string;
  clientIdHash: string; report: ReportingV1CreateReport; deadline: string; calls: { create: number; poll: number; download: number };
  reserved?: { operation: "create" | "poll" | "download"; partIndex?: number; fence: number; owner: string; id: string };
  reportId?: string; nextPollAt?: string; parts?: ReportingV1Part[]; downloadedParts?: Array<{ partIndex: number; fileId: string; contentSha256: string; byteSize: number }>; downloadAttempts?: number[];
};
const maxPartBytes = 8 * 1024 * 1024;
const maxReportBytes = 32 * 1024 * 1024;
async function boundedStorage<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AdsQueryError("ADS_REPORT_STORAGE_TIMEOUT")), 20000); });
  try { return await Promise.race([Promise.resolve().then(work), timeout]); }
  finally { clearTimeout(timer); }
}
const json = (value: unknown) => value as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(code: string): never { throw new AdsQueryError(code, 409); }
function offline(transport?: IsolatedReportingV1Transport) {
  assertIsolatedReportEnvironment();
  if (transport && transport.evidence !== evidence) fail("ADS_REPORT_V1_OFFLINE_ONLY");
}
function readState(value: State | null): State {
  if (!value || value.version !== 2 || !["CREATE", "POLL", "ACQUIRED", "DOWNLOADING", "RAW_STORED"].includes(value.phase)
    || typeof value.scopeDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.scopeDigest)
    || !value.calls || !Number.isSafeInteger(value.calls.create) || value.calls.create < 0 || value.calls.create > 1
    || !Number.isSafeInteger(value.calls.poll) || value.calls.poll < 0 || value.calls.poll > 10
    || !Number.isSafeInteger(value.calls.download) || value.calls.download < 0 || value.calls.download > 300
    || (value.phase !== "CREATE" && (typeof value.reportId !== "string" || !value.reportId || value.calls.create !== 1))
    || (value.nextPollAt !== undefined && (typeof value.nextPollAt !== "string" || !Number.isFinite(Date.parse(value.nextPollAt))))) fail("ADS_REPORT_V1_CHECKPOINT_INVALID");
  if (typeof value.clientIdHash !== "string" || !/^[a-f0-9]{64}$/.test(value.clientIdHash)) fail("ADS_REPORT_V1_CHECKPOINT_INVALID");
  snapshotReportingV1CreateReport(value.report);
  assertReportDeadline(value.deadline);
  if (value.reserved) {
    const r = value.reserved;
    if (!["create", "poll", "download"].includes(r.operation) || (r.operation === "download" ? "DOWNLOADING" : r.operation.toUpperCase()) !== value.phase || value.calls[r.operation] < 1
      || !Number.isSafeInteger(r.fence) || r.fence < 0 || typeof r.owner !== "string" || !r.owner || typeof r.id !== "string" || !r.id) fail("ADS_REPORT_V1_CHECKPOINT_INVALID");
  }
  if (!Array.isArray(value.parts) || value.parts.length > 100
    || Array.from(value.parts).some(part => !part || !Number.isSafeInteger(part.sizeInBytes) || part.sizeInBytes < 0 || typeof part.url !== "string" || part.url.length > 65536 || typeof part.urlExpirationDateTime !== "string" || !Number.isFinite(Date.parse(part.urlExpirationDateTime))) || !Array.isArray(value.downloadedParts) || value.downloadedParts.length > value.parts.length
    || !Array.isArray(value.downloadAttempts) || value.downloadAttempts.length !== value.parts.length || value.downloadAttempts.some(count => !Number.isSafeInteger(count) || count < 0 || count > 3)
    || value.downloadAttempts.reduce((sum, count) => sum + count, 0) !== value.calls.download
    || new Set(value.downloadedParts.map(part => part.partIndex)).size !== value.downloadedParts.length
    || value.downloadedParts.some(part => !Number.isSafeInteger(part.partIndex) || part.partIndex < 0 || part.partIndex >= value.parts!.length || !/^[a-f0-9]{64}$/.test(part.contentSha256) || !Number.isSafeInteger(part.byteSize) || part.byteSize !== value.parts![part.partIndex].sizeInBytes || typeof part.fileId !== "string" || !part.fileId)) fail("ADS_REPORT_V1_CHECKPOINT_INVALID");
  if (value.reserved?.operation === "download" && (!Number.isSafeInteger(value.reserved.partIndex) || value.reserved.partIndex! < 0 || value.reserved.partIndex! >= value.parts.length)) fail("ADS_REPORT_V1_CHECKPOINT_INVALID");
  if (["CREATE", "POLL"].includes(value.phase) && (value.parts.length || value.calls.download || value.downloadedParts.length)) fail("ADS_REPORT_V1_CHECKPOINT_INVALID");
  if (value.downloadedParts.some(part => value.downloadAttempts![part.partIndex] < 1)) fail("ADS_REPORT_V1_CHECKPOINT_INVALID");
  if (value.phase === "RAW_STORED" && value.downloadedParts.length !== value.parts.length) fail("ADS_REPORT_V1_CHECKPOINT_INVALID");
  return value;
}
async function context(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, fence: AdsReportFence) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-report:${fence.taskId}`}, 0))`;
  await tx.$queryRaw`SELECT "id" FROM "AmazonAdsSyncTask" WHERE "id" = ${fence.taskId} AND "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} FOR UPDATE`;
  const task = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, id: fence.taskId, trigger, requestedByUserId: actor, status: "RUNNING", dispatchVersion: fence.dispatchVersion, fenceVersion: fence.fenceVersion, leaseOwner: fence.leaseOwner, leaseExpiresAt: { gt: new Date() } } });
  if (!task) return fail("ADS_REPORT_FENCE_LOST");
  // Freeze identity/config rows through the reserve/commit transaction, not across HTTP.
  await tx.$queryRaw`SELECT "id" FROM "AmazonAdsProfile" WHERE "id" = ${task.profileId} AND "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} FOR SHARE`;
  await tx.$queryRaw`SELECT a."id" FROM "AmazonAdsAuthorization" a JOIN "AmazonAdsProfile" p ON p."authorizationId" = a."id" AND p."organizationId" = a."organizationId" AND p."workspaceId" = a."workspaceId" WHERE p."id" = ${task.profileId} FOR SHARE OF a`;
  await tx.$queryRaw`SELECT "id" FROM "AmazonAdsSyncPlan" WHERE "id" = ${task.planId} AND "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} FOR SHARE`;
  const access = await amazonDataAccess(scope, actor, tx, "sync");
  const profile = await tx.amazonAdsProfile.findFirst({ where: { ...scope, ...sellerAccessWhere(access), id: task.profileId, authorization: { status: "CONNECTED" } }, include: { authorization: true } });
  if (!profile || !profile.sellerAccountId || !profile.advertiserAccountId || !["NA", "EU", "FE"].includes(profile.region)) return fail("ADS_REPORT_PROFILE_FORBIDDEN");
  const seller = await tx.sellerAccount.findFirst({ where: { ...scope, id: profile.sellerAccountId, status: "active" } });
  const plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: task.planId, profileId: profile.id, revision: task.planRevision, status: "ACTIVE", sellerAccountId: profile.sellerAccountId, authorizationRevision: profile.authorization.revision } });
  if (!seller || !plan || (profile.authorization.refreshTokenExpiresAt && profile.authorization.refreshTokenExpiresAt <= new Date())) return fail("ADS_REPORT_PLAN_CHANGED");
  const scopeDigest = hash([task.id, task.organizationId, task.workspaceId, actor, task.planId, task.planRevision, plan.actorUserId, task.requestedFrom?.toISOString(), task.requestedTo?.toISOString(), profile.id, profile.profileId, profile.region, profile.authorizationId, profile.authorization.revision, profile.advertiserAccountId, profile.advertiserAccountRevision, profile.sellerAccountId, profile.marketplaceId, profile.currencyCode, profile.timezone]);
  const cryptoScope = { ...scope, authorizationId: profile.authorizationId };
  const state = task.checkpointCiphertext ? readState(decryptAmazonAdsCheckpoint<State>(task.checkpointCiphertext, cryptoScope, task.id)) : null;
  if (state && task.apiRequests !== state.calls.create + state.calls.poll + state.calls.download) return fail("ADS_REPORT_V1_CHECKPOINT_INVALID");
  if (state && state.scopeDigest !== scopeDigest) return fail("ADS_REPORT_FROZEN_SCOPE_CHANGED");
  const request = await tx.amazonAdsReportRequest.findUnique({ where: { organizationId_workspaceId_idempotencyKey: { ...scope, idempotencyKey: `v1-protocol:${task.id}` } } });
  const options = request?.requestOptions as { evidence?: unknown; contractSha256?: unknown; scopeDigest?: unknown } | undefined;
  if (request && (!state || request.apiVersion !== "ads-reporting-v1" || request.sourceTaskId !== task.id || request.profileId !== profile.id || request.versionId !== null || request.adProduct !== "UNVERIFIED" || request.reportType !== "UNVERIFIED_PROTOCOL_FIXTURE" || request.requestedFrom.toISOString().slice(0, 10) !== state.report.periods[0].datePeriod.startDate || request.requestedTo.toISOString().slice(0, 10) !== state.report.periods[0].datePeriod.endDate || request.remoteRequestId !== (state.reportId ?? null)
    || !options || options.evidence !== evidence || options.contractSha256 !== hash(state.report) || options.scopeDigest !== scopeDigest
    || !["ISOLATED_V1_CREATE", "ISOLATED_V1_POLL", "ISOLATED_V1_ACQUIRED", "ISOLATED_V1_DOWNLOADING", "ISOLATED_V1_RAW_STORED"].includes(request.status)
    || request.status !== `ISOLATED_V1_${state.phase === "CREATE" ? "CREATE" : state.phase === "POLL" ? "POLL" : state.phase === "ACQUIRED" ? "ACQUIRED" : state.phase === "DOWNLOADING" ? "DOWNLOADING" : "RAW_STORED"}`)) return fail("ADS_REPORT_V1_CHECKPOINT_INVALID");
  return { task, profile, scopeDigest, cryptoScope, state, request };
}
function encrypt(state: State, scope: { organizationId: string; workspaceId: string; authorizationId: string }, taskId: string) {
  return encryptAmazonAdsCheckpoint(state, scope, taskId);
}
/** Requires an explicitly created fixture task with a valid lease. Never creates/activates a plan. */
export async function initializeIsolatedReportingV1(scope: SyncScope, actor: string, fence: AdsReportFence, input: ReportingV1CreateReport, clientId: string) {
  offline();
  const report = snapshotReportingV1CreateReport(input);
  if (!clientId || clientId.length > 512 || /[\r\n]/.test(clientId)) fail("ADS_REPORT_V1_AUTH_INVALID");
  return prisma.$transaction(async tx => {
    const c = await context(tx, scope, actor, fence);
    if (c.task.requestedFrom?.toISOString().slice(0, 10) !== report.periods[0].datePeriod.startDate || c.task.requestedTo?.toISOString().slice(0, 10) !== report.periods[0].datePeriod.endDate) return fail("ADS_REPORT_PROFILE_CONTRACT_MISMATCH");
    if (c.request) {
      if (hash(c.state!.report) !== hash(report) || c.state!.clientIdHash !== hash(clientId)) return fail("ADS_REPORT_CONTRACT_CHANGED");
      return { requestId: c.request.id };
    }
    if (c.state || c.task.apiRequests !== 0) return fail("ADS_REPORT_V1_CHECKPOINT_INVALID");
    const state: State = { version: 2, phase: "CREATE", scopeDigest: c.scopeDigest, clientIdHash: hash(clientId), report, deadline: new Date(Date.now() + 15 * 60000).toISOString(), calls: { create: 0, poll: 0, download: 0 }, parts: [], downloadedParts: [], downloadAttempts: [] };
    const request = await tx.amazonAdsReportRequest.create({ data: { ...scope, id: randomUUID(), profileId: c.profile.id, sourceTaskId: c.task.id, idempotencyKey: `v1-protocol:${c.task.id}`, apiVersion: "ads-reporting-v1", reportType: "UNVERIFIED_PROTOCOL_FIXTURE", adProduct: "UNVERIFIED", requestedFrom: new Date(report.periods[0].datePeriod.startDate), requestedTo: new Date(report.periods[0].datePeriod.endDate), status: "ISOLATED_V1_CREATE", requestOptions: json({ evidence, contractSha256: hash(report), scopeDigest: c.scopeDigest }) } });
    await tx.amazonAdsSyncTask.update({ where: { id: c.task.id }, data: { checkpointCiphertext: encrypt(state, c.cryptoScope, c.task.id), stage: "REPORT_V1_CREATE" } });
    return { requestId: request.id };
  });
}

/** One durable create/poll step. Credentials are supplied fixture values, never refreshed here. */
export async function processIsolatedReportingV1(scope: SyncScope, actor: string, fence: AdsReportFence, transport: IsolatedReportingV1Transport, credentials: { clientId: string; accessToken: string }) {
  offline(transport);
  credentials = { clientId: credentials.clientId, accessToken: credentials.accessToken };
  const reserved = await prisma.$transaction(async tx => {
    const c = await context(tx, scope, actor, fence);
    if (!c.state || !c.request) return fail("ADS_REPORT_ACQUISITION_NOT_INITIALIZED");
    const state = c.state;
    if (state.clientIdHash !== hash(credentials.clientId)) return fail("ADS_REPORT_FROZEN_SCOPE_CHANGED");
    if (["ACQUIRED", "DOWNLOADING", "RAW_STORED"].includes(state.phase)) return fail("ADS_REPORT_V1_ALREADY_ACQUIRED");
    if (state.reserved?.operation === "create") return fail("ADS_REPORT_CREATE_RESULT_UNKNOWN");
    if (state.reserved?.fence === fence.fenceVersion && state.reserved.owner === fence.leaseOwner) return fail("ADS_REPORT_OPERATION_IN_FLIGHT");
    if (state.nextPollAt && Date.parse(state.nextPollAt) > Date.now()) return fail("ADS_REPORT_POLL_NOT_DUE");
    const operation = state.phase === "CREATE" ? "create" : "poll";
    if (state.calls[operation] >= (operation === "create" ? 1 : 10)) {
      const code = "ADS_REPORT_REQUEST_BUDGET_EXCEEDED";
      await tx.amazonAdsSyncTask.update({ where: { id: c.task.id }, data: { status: "BLOCKED", errorCode: code, leaseOwner: null, leaseExpiresAt: null, finishedAt: new Date() } });
      await tx.amazonAdsReportRequest.update({ where: { id: c.request.id }, data: { errorCode: code } });
      return { blocked: code };
    }
    state.calls[operation]++;
    state.reserved = { operation, fence: fence.fenceVersion, owner: fence.leaseOwner, id: randomUUID() };
    await tx.amazonAdsSyncTask.update({ where: { id: c.task.id }, data: { checkpointCiphertext: encrypt(state, c.cryptoScope, c.task.id), apiRequests: { increment: 1 } } });
    return { ...c, state, operation, reservation: state.reserved.id };
  });
  if (reserved.blocked !== undefined) return fail(reserved.blocked);
  try {
    const auth = { region: reserved.profile.region as AdsRegion, clientId: credentials.clientId, accessToken: credentials.accessToken };
    const signal = AbortSignal.timeout(20000);
    let listener!: () => void;
    const timeout = new Promise<never>((_, reject) => { listener = () => reject(new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT")); signal.addEventListener("abort", listener, { once: true }); });
    const work = Promise.resolve().then(() => reserved.operation === "create"
      ? transport.create({ ...auth, advertiserAccountId: reserved.profile.advertiserAccountId!, report: structuredClone(reserved.state.report), signal })
      : transport.retrieve({ ...auth, reportId: reserved.state.reportId!, signal }));
    const result = await Promise.race([work, timeout]).finally(() => signal.removeEventListener("abort", listener));
    if (result.outcome !== "success") return fail("ADS_REPORT_V1_REMOTE_REJECTED");
    assertReportingV1ReceiptMatches(result, reserved.state.report);
    if (reserved.state.reportId && result.reportId !== reserved.state.reportId) return fail("ADS_REPORT_V1_ID_MISMATCH");
    if (result.status === "FAILED") return fail("ADS_REPORT_UPSTREAM_FAILED");
    if (!["PENDING", "PROCESSING", "COMPLETED"].includes(result.status) || typeof result.reportId !== "string" || !result.reportId || result.reportId.length > 512) return fail("ADS_REPORT_ENVELOPE_INVALID");
    if (!Array.isArray(result.parts) || result.parts.length > 100) return fail("ADS_REPORT_ENVELOPE_INVALID");
    const parts = Array.from(result.parts, part => {
      if (!part || !Number.isSafeInteger(part.sizeInBytes) || part.sizeInBytes < 0 || typeof part.url !== "string" || part.url.length > 65536 || typeof part.urlExpirationDateTime !== "string" || !Number.isFinite(Date.parse(part.urlExpirationDateTime))) return fail("ADS_REPORT_ENVELOPE_INVALID");
      let url: URL;
      try { url = new URL(part.url); } catch { return fail("ADS_REPORT_ENVELOPE_INVALID"); }
      if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port) return fail("ADS_REPORT_DOWNLOAD_URL_REJECTED");
      if (result.status === "COMPLETED" && Date.parse(part.urlExpirationDateTime) <= Date.now()) return fail("ADS_REPORT_DOWNLOAD_EXPIRED");
      return { url: part.url, sizeInBytes: part.sizeInBytes, urlExpirationDateTime: part.urlExpirationDateTime };
    });
    return await prisma.$transaction(async tx => {
      const c = await context(tx, scope, actor, fence);
      if (!c.state || c.state.reserved?.id !== reserved.reservation || !c.request) return fail("ADS_REPORT_FENCE_LOST");
      const state = c.state;
      delete state.reserved;
      state.reportId = result.reportId;
      state.phase = result.status === "COMPLETED" ? "ACQUIRED" : "POLL";
      if (state.phase === "ACQUIRED") { state.parts = parts; state.downloadAttempts = parts.map(() => 0); delete state.nextPollAt; }
      else state.nextPollAt = new Date(Date.now() + 1000).toISOString();
      await tx.amazonAdsReportRequest.update({ where: { id: c.request.id }, data: { remoteRequestId: result.reportId, status: state.phase === "ACQUIRED" ? "ISOLATED_V1_ACQUIRED" : "ISOLATED_V1_POLL", lastPolledAt: reserved.operation === "poll" ? new Date() : undefined, errorCode: null } });
      await tx.amazonAdsSyncTask.update({ where: { id: c.task.id }, data: { checkpointCiphertext: encrypt(state, c.cryptoScope, c.task.id), stage: `REPORT_V1_${state.phase}`, errorCode: null } });
      return { phase: state.phase, partCount: state.parts?.length ?? 0 };
    });
  } catch (error) {
    const code = reserved.operation === "create" ? "ADS_REPORT_CREATE_RESULT_UNKNOWN" : error instanceof AdsQueryError && /^ADS_[A-Z0-9_]+$/.test(error.message) ? error.message : "ADS_REPORT_V1_OPERATION_FAILED";
    await prisma.$transaction(async tx => {
      const c = await context(tx, scope, actor, fence);
      if (!c.state || c.state.reserved?.id !== reserved.reservation || !c.request) return fail("ADS_REPORT_FENCE_LOST");
      const state = c.state;
      const retryAt = error instanceof ReportReadRetryError ? Math.max(error.retryAt, reportReadRetryAt(state.calls.poll)) : reportReadRetryAt(state.calls.poll);
      const retry = reserved.operation === "poll" && (error instanceof ReportReadRetryError || code === "ADS_REPORT_OPERATION_TIMEOUT") && state.calls.poll < 10 && Number.isFinite(retryAt) && retryAt < Date.parse(state.deadline);
      if (retry) { delete state.reserved; state.nextPollAt = new Date(retryAt).toISOString(); }
      await tx.amazonAdsReportRequest.update({ where: { id: c.request.id }, data: { errorCode: code } });
      await tx.amazonAdsSyncTask.update({ where: { id: c.task.id }, data: { checkpointCiphertext: encrypt(state, c.cryptoScope, c.task.id), errorCode: code, ...(retry ? {} : { status: "BLOCKED", leaseOwner: null, leaseExpiresAt: null, finishedAt: new Date() }) } });
    });
    throw new AdsQueryError(code);
  }
}

/** One encrypted raw part per explicit fixture dispatch. No parser or fact publication. */
export async function downloadIsolatedReportingV1Part(scope: SyncScope, actor: string, fence: AdsReportFence, transport: IsolatedReportingV1Transport) {
  offline(transport);
  const selected = await prisma.$transaction(async tx => {
    const c = await context(tx, scope, actor, fence);
    if (!c.state || !c.request || !["ACQUIRED", "DOWNLOADING"].includes(c.state.phase)) return fail("ADS_REPORT_V1_DOWNLOAD_NOT_READY");
    const state = c.state;
    if (state.reserved?.fence === fence.fenceVersion && state.reserved.owner === fence.leaseOwner) return fail("ADS_REPORT_OPERATION_IN_FLIGHT");
    if (state.nextPollAt && Date.parse(state.nextPollAt) > Date.now()) return fail("ADS_REPORT_POLL_NOT_DUE");
    const totalBytes = state.parts!.reduce((total, part) => total + part.sizeInBytes, 0);
    const partIndex = state.parts!.findIndex((_part, index) => !state.downloadedParts!.some(saved => saved.partIndex === index));
    const code = !Number.isSafeInteger(totalBytes) || totalBytes > maxReportBytes || state.parts!.some(part => part.sizeInBytes > maxPartBytes)
      ? "ADS_REPORT_BODY_LIMIT" : partIndex < 0 ? "ADS_REPORT_V1_EMPTY_PARTS_UNVERIFIED" : state.downloadAttempts![partIndex] >= 3 ? "ADS_REPORT_REQUEST_BUDGET_EXCEEDED" : null;
    if (code) {
      await tx.amazonAdsSyncTask.update({ where: { id: c.task.id }, data: { status: "BLOCKED", errorCode: code, leaseOwner: null, leaseExpiresAt: null, finishedAt: new Date() } });
      return { blocked: code };
    }
    const part = state.parts![partIndex];
    if (Date.parse(part.urlExpirationDateTime) <= Date.now()) return fail("ADS_REPORT_DOWNLOAD_EXPIRED");
    state.phase = "DOWNLOADING";
    state.calls.download++;
    state.downloadAttempts![partIndex]++;
    state.reserved = { operation: "download", partIndex, fence: fence.fenceVersion, owner: fence.leaseOwner, id: randomUUID() };
    await tx.amazonAdsSyncTask.update({ where: { id: c.task.id }, data: { checkpointCiphertext: encrypt(state, c.cryptoScope, c.task.id), apiRequests: { increment: 1 }, stage: "REPORT_V1_DOWNLOADING" } });
    await tx.amazonAdsReportRequest.update({ where: { id: c.request.id }, data: { status: "ISOLATED_V1_DOWNLOADING" } });
    return { ...c, state, part, partIndex, reservation: state.reserved.id };
  });
  if (selected.blocked !== undefined) return fail(selected.blocked);
  const storage = getStorageDriver();
  const key = `amazon-ads/reporting-v1/${hash([scope.organizationId, scope.workspaceId, fence.taskId])}/${selected.reservation}.encrypted`;
  let storageAttempted = false;
  let storageReceipt: { contentSha256: string; byteSize: number } | undefined;
  try {
    const signal = AbortSignal.timeout(20000);
    let listener!: () => void;
    const timeout = new Promise<never>((_, reject) => { listener = () => reject(new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT")); signal.addEventListener("abort", listener, { once: true }); });
    const bytes = await Promise.race([
      Promise.resolve().then(() => transport.download({ url: selected.part.url, expiresAt: selected.part.urlExpirationDateTime, maxBytes: maxPartBytes, expectedBytes: selected.part.sizeInBytes, signal })), timeout,
    ]).finally(() => signal.removeEventListener("abort", listener));
    if (!Buffer.isBuffer(bytes) || bytes.length !== selected.part.sizeInBytes || bytes.length > maxPartBytes) return fail("ADS_REPORT_BODY_SIZE_MISMATCH");
    if (Date.parse(selected.part.urlExpirationDateTime) <= Date.now()) return fail("ADS_REPORT_DOWNLOAD_EXPIRED");
    assertReportDeadline(selected.state.deadline);
    await prisma.$transaction(async tx => {
      const c = await context(tx, scope, actor, fence);
      if (c.state?.reserved?.id !== selected.reservation) return fail("ADS_REPORT_FENCE_LOST");
    });
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    // AAD extends the task identity with request/part index: ciphertext cannot be swapped across parts.
    const aadTaskId = JSON.stringify([fence.taskId, selected.request!.id, selected.partIndex]);
    const encrypted = Buffer.from(encryptAmazonAdsCheckpoint({ bytesBase64: bytes.toString("base64"), contentSha256, byteSize: bytes.length }, selected.cryptoScope, aadTaskId));
    storageReceipt = { contentSha256: createHash("sha256").update(encrypted).digest("hex"), byteSize: encrypted.length };
    storageAttempted = true;
    const stored = await boundedStorage(() => storage.putBuffer({ key, buffer: encrypted, contentType: "application/octet-stream" }));
    if (stored.key !== key || stored.size !== encrypted.length) return fail("ADS_REPORT_STORAGE_MISMATCH");
    if (!storage.getBoundedBuffer) return fail("ADS_REPORT_BOUNDED_STORAGE_REQUIRED");
    const persisted = await boundedStorage(() => storage.getBoundedBuffer!(key, 16 * 1024 * 1024));
    const encryptedSha256 = storageReceipt.contentSha256;
    if (persisted.length !== encrypted.length || createHash("sha256").update(persisted).digest("hex") !== encryptedSha256) return fail("ADS_REPORT_FILE_INTEGRITY_MISMATCH");
    return await prisma.$transaction(async tx => {
      const c = await context(tx, scope, actor, fence);
      if (!c.state || !c.request || c.state.reserved?.id !== selected.reservation) return fail("ADS_REPORT_FENCE_LOST");
      const state = c.state;
      const file = await tx.fileObject.create({ data: { ...scope, id: randomUUID(), userId: actor, accountId: c.profile.sellerAccountId!, marketplace: c.profile.marketplaceId ?? "", originalName: `part-${selected.partIndex}.encrypted`, mimeType: "application/octet-stream", storageType: "local", status: "done", storageKey: key, size: encrypted.length, contentHash: encryptedSha256 } });
      await tx.amazonAdsReportDocument.create({ data: { ...scope, id: randomUUID(), requestId: c.request.id, profileId: c.profile.id, partIndex: selected.partIndex, format: state.report.format, compression: state.report.format.includes("GZIP") ? "GZIP" : "NONE", status: "ISOLATED_V1_ENCRYPTED_RAW", storageFileId: file.id, contentSha256, byteSize: BigInt(bytes.length), downloadedAt: new Date() } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.ads.report.v1_part_stored", entityType: "AmazonAdsReportRequest", entityId: c.request.id, metadata: { workspaceId: scope.workspaceId, taskId: fence.taskId, partIndex: selected.partIndex, fileId: file.id, contentSha256, byteSize: bytes.length, evidence } } });
      state.downloadedParts!.push({ partIndex: selected.partIndex, fileId: file.id, contentSha256, byteSize: bytes.length });
      delete state.reserved;
      delete state.nextPollAt;
      const complete = state.downloadedParts!.length === state.parts!.length;
      if (complete) state.phase = "RAW_STORED";
      await tx.amazonAdsSyncTask.update({ where: { id: c.task.id }, data: { checkpointCiphertext: encrypt(state, c.cryptoScope, c.task.id), stage: `REPORT_V1_${state.phase}`, errorCode: complete ? "ADS_REPORT_V1_JSON_FRAMING_UNVERIFIED" : null, ...(complete ? { status: "BLOCKED", leaseOwner: null, leaseExpiresAt: null, finishedAt: new Date() } : {}) } });
      await tx.amazonAdsReportRequest.update({ where: { id: c.request.id }, data: { status: `ISOLATED_V1_${state.phase}`, errorCode: null } });
      return { phase: state.phase, downloadedParts: state.downloadedParts!.length, partCount: state.parts!.length };
    });
  } catch (error) {
    // A storage write and its DB commit are not atomic. Keep reviewable evidence; never guess an orphan or delete.
    if (storageAttempted) {
      try { await prisma.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.ads.report.v1_storage_commit_unconfirmed", entityType: "AmazonAdsReportRequest", entityId: selected.request!.id, metadata: { workspaceId: scope.workspaceId, taskId: fence.taskId, partIndex: selected.partIndex, storageKey: key, reservation: selected.reservation, receipt: storageReceipt, evidence } } }); }
      catch { console.warn("ADS_REPORT_V1_STORAGE_EVIDENCE_UNAVAILABLE", { taskId: fence.taskId }); }
    }
    const code = error instanceof AdsQueryError && /^ADS_[A-Z0-9_]+$/.test(error.message) ? error.message : "ADS_REPORT_DOWNLOAD_FAILED";
    await prisma.$transaction(async tx => {
      const c = await context(tx, scope, actor, fence);
      if (!c.state || !c.request || c.state.reserved?.id !== selected.reservation) return fail("ADS_REPORT_FENCE_LOST");
      const state = c.state;
      const retryAt = error instanceof ReportReadRetryError ? Math.max(error.retryAt, reportReadRetryAt(state.downloadAttempts![selected.partIndex])) : reportReadRetryAt(state.downloadAttempts![selected.partIndex]);
      const retry = !storageAttempted && (error instanceof ReportReadRetryError || ["ADS_REPORT_DOWNLOAD_FAILED", "ADS_REPORT_OPERATION_TIMEOUT"].includes(code)) && state.downloadAttempts![selected.partIndex] < 3 && Number.isFinite(retryAt) && retryAt < Math.min(Date.parse(state.deadline), Date.parse(selected.part.urlExpirationDateTime));
      if (retry) { delete state.reserved; state.nextPollAt = new Date(retryAt).toISOString(); }
      await tx.amazonAdsReportRequest.update({ where: { id: c.request.id }, data: { errorCode: code } });
      await tx.amazonAdsSyncTask.update({ where: { id: c.task.id }, data: { checkpointCiphertext: encrypt(state, c.cryptoScope, c.task.id), errorCode: code, ...(retry ? {} : { status: "BLOCKED", leaseOwner: null, leaseExpiresAt: null, finishedAt: new Date() }) } });
    });
    throw new AdsQueryError(code);
  }
}
