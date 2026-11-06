import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";
import type { StorageDriver } from "@/lib/storage/types";
import type { SyncScope } from "@/lib/amazon-sync/policy";
import { amazonDataAccess, sellerAccessWhere } from "@/lib/amazon-sync/data-access";
import { encryptAmazonAdsCheckpoint } from "./credentials";
import { AdsQueryError } from "./query-contract";
import { assertReportScopeDigest, reportScopeDigest } from "./report-scope";
import { campaignReportManifest, campaignReportRequest, parseCampaignReport, isolatedCampaignReportLimits, type CampaignReportSpec } from "./campaign-report-contract";
import { stageAdsReportBatch, publishAdsReportVersion, type AdsReportFence } from "./report-publication";

/** No default HTTP implementation: this entry point cannot send a live Amazon request. */
export interface IsolatedReportTransport {
  evidence: "ISOLATED_FIXTURE_ONLY";
  create(request: ReturnType<typeof campaignReportRequest>, signal: AbortSignal): Promise<Response>;
  poll(reportId: string, signal: AbortSignal): Promise<Response>;
  download(url: string, signal: AbortSignal): Promise<Response>;
}
type Phase = "CREATE" | "POLL" | "DOWNLOAD" | "STAGE" | "PUBLISH" | "COMPLETE";
export type AcquisitionState = {
  version: 1; phase: Phase; spec: CampaignReportSpec; deadline: string;
  scopeDigest: string;
  calls: { create: number; poll: number; download: number };
  evidenceFileIds: string[]; nextPollAt?: string;
  reserved?: { operation: "create" | "poll" | "download"; fence: number; owner: string };
  urlCiphertext?: string; expectedRows?: number;
};
type Options = { manifest: ReturnType<typeof campaignReportManifest>; acquisition: AcquisitionState };
const asJson = (value: unknown) => value as Prisma.InputJsonValue;
const sha256 = (buffer: Buffer | string) => createHash("sha256").update(buffer).digest("hex");
function sameConfiguration(value: unknown, spec: CampaignReportSpec) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const expected = campaignReportRequest(spec).configuration;
  const actual = value as Record<string, unknown>;
  return Object.keys(actual).length === Object.keys(expected).length && Object.entries(expected).every(([key, field]) => JSON.stringify(actual[key]) === JSON.stringify(field));
}
function offline(transport?: IsolatedReportTransport) {
  const database = new URL(process.env.DATABASE_URL ?? "http://fixture.invalid");
  const root = process.env.UPLOAD_DIR;
  if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || database.hostname !== "127.0.0.1" || database.pathname !== "/amazon_sync_test" || process.env.STORAGE_DRIVER !== "local" || !root || !root.startsWith("/") || (transport && transport.evidence !== "ISOLATED_FIXTURE_ONLY")) throw new AdsQueryError("ADS_REPORT_ACQUISITION_OFFLINE_ONLY", 403);
}
async function live(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, fence: AdsReportFence) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-report:${fence.taskId}`}, 0))`;
  const task = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, id: fence.taskId, requestedByUserId: actor, trigger: "isolated-report", status: "RUNNING", dispatchVersion: fence.dispatchVersion, fenceVersion: fence.fenceVersion, leaseOwner: fence.leaseOwner, leaseExpiresAt: { gt: new Date() }, plan: { status: "ACTIVE" } } });
  if (!task) throw new AdsQueryError("ADS_REPORT_FENCE_LOST", 409);
  const access = await amazonDataAccess(scope, actor, tx, "sync");
  const sellers = await tx.sellerAccount.findMany({ where: { ...scope, status: "active" }, select: { id: true } });
  const profile = await tx.amazonAdsProfile.findFirst({ where: { ...scope, ...sellerAccessWhere(access), id: task.profileId, authorization: { status: "CONNECTED" }, AND: [{ sellerAccountId: { in: sellers.map(row => row.id) } }] } });
  if (!profile) throw new AdsQueryError("ADS_REPORT_PROFILE_FORBIDDEN", 403);
  const plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: task.planId, revision: task.planRevision, profileId: profile.id, sellerAccountId: profile.sellerAccountId ?? "", status: "ACTIVE" }, include: { profile: { include: { authorization: true } } } });
  if (!plan || plan.authorizationRevision !== plan.profile.authorization.revision || (plan.profile.authorization.refreshTokenExpiresAt && plan.profile.authorization.refreshTokenExpiresAt <= new Date())) throw new AdsQueryError("ADS_REPORT_PLAN_CHANGED", 409);
  const request = await tx.amazonAdsReportRequest.findUnique({ where: { organizationId_workspaceId_idempotencyKey: { ...scope, idempotencyKey: `publication:${task.id}` } } });
  if (request) {
    const options = request.requestOptions as unknown as Options;
    assertReportScopeDigest(options.acquisition?.scopeDigest, reportScopeDigest(task, profile, plan.authorizationRevision, options.manifest));
  }
  return { task, profile, authorizationRevision: plan.authorizationRevision };
}

/** Start only an explicitly created isolated task; no scheduler, plan or credentials are changed. */
export async function initializeIsolatedCampaignReport(scope: SyncScope, actor: string, fence: AdsReportFence, spec: CampaignReportSpec) {
  offline();
  const manifest = campaignReportManifest(spec);
  return prisma.$transaction(async tx => {
    const { task, profile, authorizationRevision } = await live(tx, scope, actor, fence);
    if (task.requestedFrom?.toISOString().slice(0,10) !== spec.from || task.requestedTo?.toISOString().slice(0,10) !== spec.to || profile.currencyCode !== spec.currencyCode || profile.timezone !== spec.timezone) throw new AdsQueryError("ADS_REPORT_PROFILE_CONTRACT_MISMATCH");
    const prior = await tx.amazonAdsReportRequest.findUnique({ where: { organizationId_workspaceId_idempotencyKey: { ...scope, idempotencyKey: `publication:${task.id}` } } });
    if (prior) {
      const stored = prior.requestOptions as unknown as Options;
      if (!stored.acquisition || JSON.stringify(campaignReportRequest(stored.acquisition.spec)) !== JSON.stringify(campaignReportRequest(spec)) || stored.acquisition.spec.currencyCode !== spec.currencyCode || stored.acquisition.spec.timezone !== spec.timezone) throw new AdsQueryError("ADS_REPORT_CONTRACT_CHANGED", 409);
      return { requestId: prior.id, versionId: prior.versionId };
    }
    const version = await tx.amazonAdsReportVersion.create({ data: { id: randomUUID(), ...scope, profileId: task.profileId, sourceTaskId: task.id, requestedFrom: task.requestedFrom, requestedTo: task.requestedTo } });
    const acquisition: AcquisitionState = { version: 1, phase: "CREATE", spec, scopeDigest: reportScopeDigest(task, profile, authorizationRevision, manifest), deadline: new Date(Date.now()+15*60000).toISOString(), calls: { create: 0, poll: 0, download: 0 }, evidenceFileIds: [] };
    const request = await tx.amazonAdsReportRequest.create({ data: { id: randomUUID(), ...scope, profileId: task.profileId, sourceTaskId: task.id, versionId: version.id, idempotencyKey: `publication:${task.id}`, apiVersion: manifest.apiVersion, reportType: manifest.reportType, adProduct: manifest.adProduct, requestedFrom: new Date(spec.from), requestedTo: new Date(spec.to), requestOptions: asJson({ manifest, acquisition }), status: "ISOLATED_CREATE" } });
    return { requestId: request.id, versionId: version.id };
  });
}

async function boundedBody(response: Response, limit: number) {
  if (!response.ok || response.status !== 200 || response.redirected) { await response.body?.cancel(); throw new AdsQueryError("ADS_REPORT_HTTP_OR_REDIRECT_REJECTED"); }
  const announced = response.headers.get("content-length");
  if (announced !== null && (!/^\d+$/.test(announced) || Number(announced) > limit)) { await response.body?.cancel(); throw new AdsQueryError("ADS_REPORT_BODY_LIMIT"); }
  const reader = response.body?.getReader();
  if (!reader) throw new AdsQueryError("ADS_REPORT_BODY_MISSING");
  const chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new AdsQueryError("ADS_REPORT_BODY_LIMIT");
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  if (announced !== null && size !== Number(announced)) throw new AdsQueryError("ADS_REPORT_BODY_SIZE_MISMATCH");
  return Buffer.concat(chunks);
}
function fixtureUrl(value: unknown) {
  if (typeof value !== "string") throw new AdsQueryError("ADS_REPORT_DOWNLOAD_URL_REJECTED");
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".invalid") || url.username || url.password || url.port || url.hash) throw new AdsQueryError("ADS_REPORT_DOWNLOAD_URL_REJECTED");
  return value;
}

/** One bounded operation per dispatch. Counters are committed BEFORE transport invocation. */
export async function processIsolatedCampaignReport(scope: SyncScope, actor: string, fence: AdsReportFence, transport: IsolatedReportTransport) {
  offline(transport);
  const completed = await prisma.amazonAdsSyncTask.findFirst({ where: { ...scope, id: fence.taskId, requestedByUserId: actor, trigger: "isolated-report", status: "SUCCEEDED", stage: "COMPLETED_ISOLATED_REPORT", dispatchVersion: fence.dispatchVersion, fenceVersion: fence.fenceVersion } });
  if (completed) return { phase: "COMPLETE" as Phase, ...await publishAdsReportVersion(scope, actor, fence) };
  const request = await prisma.$transaction(async tx => {
    const { task } = await live(tx, scope, actor, fence);
    const row = await tx.amazonAdsReportRequest.findUniqueOrThrow({ where: { organizationId_workspaceId_idempotencyKey: { ...scope, idempotencyKey: `publication:${task.id}` } } });
    const options = row.requestOptions as unknown as Options;
    const state = options.acquisition;
    if (!state || state.version !== 1) throw new AdsQueryError("ADS_REPORT_ACQUISITION_NOT_INITIALIZED");
    if (Date.parse(state.deadline) <= Date.now()) throw new AdsQueryError("ADS_REPORT_DEADLINE_EXCEEDED");
    if (state.reserved) {
      // A crash after create might have created a report. Never reissue the create request.
      if (state.reserved.operation === "create") throw new AdsQueryError("ADS_REPORT_CREATE_RESULT_UNKNOWN", 409);
      if (state.reserved.fence === fence.fenceVersion && state.reserved.owner === fence.leaseOwner) throw new AdsQueryError("ADS_REPORT_OPERATION_IN_FLIGHT", 409);
      delete state.reserved; // A replacement fence can retry only read-only poll/download.
    }
    if (state.nextPollAt && Date.parse(state.nextPollAt) > Date.now()) throw new AdsQueryError("ADS_REPORT_POLL_NOT_DUE", 409);
    const operation = state.phase === "CREATE" ? "create" : state.phase === "POLL" ? "poll" : state.phase === "DOWNLOAD" ? "download" : null;
    if (operation) {
      const limit = { create: 1, poll: 10, download: 3 }[operation];
      if (state.calls[operation] >= limit) throw new AdsQueryError("ADS_REPORT_REQUEST_BUDGET_EXCEEDED");
      state.calls[operation]++;
      state.reserved = { operation, fence: fence.fenceVersion, owner: fence.leaseOwner };
      await tx.amazonAdsReportRequest.update({ where: { id: row.id }, data: { requestOptions: asJson(options) } });
      await tx.amazonAdsSyncTask.update({ where: { id: task.id }, data: { apiRequests: { increment: 1 } } });
    }
    return { ...row, options, operation };
  });
  const state = request.options.acquisition;
  const signal = AbortSignal.timeout(5000);
  if (state.phase === "STAGE") {
    const bytes = await readAcquiredDocument(scope, request.id, request.profileId);
    const facts = parseCampaignReport(bytes, state.spec);
    await stageAdsReportBatch(scope, actor, fence, request.options.manifest, facts);
    await commit("PUBLISH");
    return { phase: "PUBLISH" as Phase };
  }
  if (state.phase === "PUBLISH") {
    const result = await publishAdsReportVersion(scope, actor, fence);
    return { phase: "COMPLETE" as Phase, ...result };
  }
  if (state.phase === "COMPLETE") return { phase: "COMPLETE" as Phase };
  try {
    let requestEvidence: Buffer | undefined;
    let responseEvidence: Buffer | undefined;
    // timeout covers both transport and body, including injected transports that ignore signal.
    const work = async () => {
      if (request.operation === "download") {
        const { decryptAmazonAdsCheckpoint } = await import("./credentials");
        const profile = await prisma.amazonAdsProfile.findUniqueOrThrow({ where: { id: request.profileId }, select: { authorizationId: true } });
        const download = decryptAmazonAdsCheckpoint<{ url: string; expiresAt: string; size: number }>(state.urlCiphertext ?? null, { ...scope, authorizationId: profile.authorizationId }, fence.taskId);
        if (!download || Date.parse(download.expiresAt) <= Date.now()) throw new AdsQueryError("ADS_REPORT_DOWNLOAD_EXPIRED");
        const bytes = await boundedBody(await transport.download(fixtureUrl(download.url), signal), isolatedCampaignReportLimits.compressedBytes);
        if (bytes.length !== download.size) throw new AdsQueryError("ADS_REPORT_BODY_SIZE_MISMATCH");
        const facts = parseCampaignReport(bytes, state.spec);
        await commit("STAGE", { bytes, rows: facts.length });
      } else {
        const operationRequest = request.operation === "create" ? campaignReportRequest(state.spec) : { reportId: request.remoteRequestId! };
        const response = request.operation === "create" ? await transport.create(operationRequest as ReturnType<typeof campaignReportRequest>, signal) : await transport.poll(request.remoteRequestId!, signal);
        const bytes = await boundedBody(response, 64 * 1024);
        let body: Record<string, unknown>;
        try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new AdsQueryError("ADS_REPORT_ENVELOPE_INVALID"); }
        if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.reportId !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(body.reportId) || !["PENDING", "PROCESSING", "COMPLETED", "FAILED"].includes(String(body.status)) || body.startDate !== state.spec.from || body.endDate !== state.spec.to || !sameConfiguration(body.configuration, state.spec) || (request.remoteRequestId && body.reportId !== request.remoteRequestId)) throw new AdsQueryError("ADS_REPORT_ENVELOPE_CONTRACT_MISMATCH");
        if (body.status === "FAILED") throw new AdsQueryError("ADS_REPORT_UPSTREAM_FAILED");
        if (body.status === "COMPLETED") {
          fixtureUrl(body.url);
          if (typeof body.urlExpiresAt !== "string" || !Number.isFinite(Date.parse(body.urlExpiresAt)) || Date.parse(body.urlExpiresAt) <= Date.now()) throw new AdsQueryError("ADS_REPORT_DOWNLOAD_EXPIRED");
          if (typeof body.fileSize !== "number" || !Number.isSafeInteger(body.fileSize) || body.fileSize < 1 || body.fileSize > isolatedCampaignReportLimits.compressedBytes) throw new AdsQueryError("ADS_REPORT_BODY_LIMIT");
        }
        requestEvidence = Buffer.from(JSON.stringify(operationRequest));
        responseEvidence = bytes;
        await commit(body.status === "COMPLETED" ? "DOWNLOAD" : "POLL", { envelope: body, requestEvidence, responseEvidence });
      }
    };
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT"));
      signal.addEventListener("abort", abort, { once: true });
      work().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  } catch (error) {
    await prisma.$transaction(async tx => {
      await live(tx, scope, actor, fence);
      // Do not erase reservation after unknown create outcome; read-only retries consume budget.
      if (request.operation !== "create") delete state.reserved;
      await tx.amazonAdsReportRequest.update({ where: { id: request.id }, data: { requestOptions: asJson(request.options), errorCode: request.operation === "create" ? "ADS_REPORT_CREATE_RESULT_UNKNOWN" : "ADS_REPORT_ACQUISITION_FAILED" } });
    });
    throw error instanceof AdsQueryError ? error : new AdsQueryError("ADS_REPORT_ACQUISITION_FAILED");
  }
  return { phase: state.phase };

  async function commit(phase: Phase, input: { envelope?: Record<string, unknown>; requestEvidence?: Buffer; responseEvidence?: Buffer; bytes?: Buffer; rows?: number } = {}) {
    if (signal.aborted) throw new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT");
    const options = structuredClone(request.options);
    const after = options.acquisition;
    await prisma.$transaction(async tx => {
      const { profile } = await live(tx, scope, actor, fence);
      const current = await tx.amazonAdsReportRequest.findUniqueOrThrow({ where: { id: request.id } });
      const persisted = (current.requestOptions as unknown as Options).acquisition;
      if (persisted.phase !== state.phase || (request.operation && (persisted.reserved?.operation !== state.reserved?.operation || persisted.reserved?.fence !== state.reserved?.fence || persisted.reserved?.owner !== state.reserved?.owner))) throw new AdsQueryError("ADS_REPORT_OPERATION_CONFLICT", 409);
      if (input.envelope) {
        // Preserve exact request/response body bytes while keeping signed URLs encrypted at rest.
        const encrypted = encryptAmazonAdsCheckpoint({
          requestBase64: input.requestEvidence?.toString("base64"),
          responseBase64: input.responseEvidence?.toString("base64"),
          contentType: "application/json",
          observedAt: new Date().toISOString(),
        }, { ...scope, authorizationId: profile.authorizationId }, fence.taskId);
        const evidence = await saveFile(tx, scope, actor, request.id, Buffer.from(encrypted), "application/octet-stream", "response.encrypted");
        after.evidenceFileIds.push(evidence.id);
        if (phase === "DOWNLOAD") after.urlCiphertext = encryptAmazonAdsCheckpoint({ url: input.envelope.url, expiresAt: input.envelope.urlExpiresAt, size: input.envelope.fileSize }, { ...scope, authorizationId: profile.authorizationId }, fence.taskId);
        if (phase === "POLL") after.nextPollAt = new Date(Date.now()+60000).toISOString();
        else delete after.nextPollAt;
      }
      if (input.bytes) {
        const file = await saveFile(tx, scope, actor, request.id, input.bytes, "application/gzip", "report.json.gz");
        await tx.amazonAdsReportDocument.upsert({ where: { organizationId_workspaceId_requestId_partIndex: { ...scope, requestId: request.id, partIndex: 0 } }, create: { id: randomUUID(), ...scope, profileId: request.profileId, requestId: request.id, partIndex: 0, format: "GZIP_JSON", compression: "GZIP", status: "VALIDATED", storageFileId: file.id, contentSha256: file.contentHash, byteSize: BigInt(input.bytes.length), rowCount: input.rows, downloadedAt: new Date() }, update: {} });
        after.expectedRows = input.rows;
        delete after.urlCiphertext;
      }
      after.phase = phase; delete after.reserved;
      await tx.amazonAdsReportRequest.update({ where: { id: request.id }, data: { requestOptions: asJson(options), remoteRequestId: input.envelope ? String(input.envelope.reportId) : current.remoteRequestId, status: `ISOLATED_${phase}`, lastPolledAt: request.operation === "poll" ? new Date() : current.lastPolledAt, errorCode: null } });
      if (signal.aborted) throw new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT");
    }, { timeout: 15000 });
    Object.keys(state).forEach(key => { delete (state as unknown as Record<string, unknown>)[key]; });
    Object.assign(state, after);
  }
}

async function saveFile(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, requestId: string, buffer: Buffer, mimeType: string, originalName: string) {
  const contentHash = sha256(buffer);
  // Only identifiers/hashes in object keys. Signed URLs and raw tokens never become paths.
  const prefix = sha256(JSON.stringify([scope.organizationId, scope.workspaceId, requestId]));
  const key = `amazon-ads/reports/${prefix}/${contentHash}`;
  const stored = await getStorageDriver().putBuffer({ key, buffer, contentType: mimeType });
  if (stored.key !== key || stored.size !== buffer.length) throw new AdsQueryError("ADS_REPORT_STORAGE_MISMATCH");
  return tx.fileObject.create({ data: { id: randomUUID(), ...scope, userId: actor, originalName, mimeType, size: buffer.length, storageKey: key, storageType: "local", status: "done", contentHash } });
}

async function readAcquiredDocument(scope: SyncScope, requestId: string, profileId: string, storage: StorageDriver = getStorageDriver()) {
  offline();
  const document = await prisma.amazonAdsReportDocument.findFirst({ where: { ...scope, requestId, profileId, partIndex: 0, status: "VALIDATED" } });
  if (!document?.storageFileId || !document.byteSize || document.byteSize > BigInt(isolatedCampaignReportLimits.compressedBytes)) throw new AdsQueryError("ADS_REPORT_DOCUMENT_NOT_READY");
  const file = await prisma.fileObject.findFirst({ where: { ...scope, id: document.storageFileId, storageType: "local", status: "done", size: Number(document.byteSize), contentHash: document.contentSha256 } });
  if (!file) throw new AdsQueryError("ADS_REPORT_FILE_SCOPE_OR_HASH_MISMATCH");
  if (!storage.getBoundedBuffer) throw new AdsQueryError("ADS_REPORT_BOUNDED_STORAGE_REQUIRED");
  let buffer: Buffer;
  try { buffer = await storage.getBoundedBuffer(file.storageKey, isolatedCampaignReportLimits.compressedBytes); }
  catch { throw new AdsQueryError("ADS_REPORT_FILE_READ_REJECTED"); }
  if (buffer.length !== Number(document.byteSize) || sha256(buffer) !== document.contentSha256) throw new AdsQueryError("ADS_REPORT_FILE_INTEGRITY_MISMATCH");
  return buffer;
}
