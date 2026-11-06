import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, sellerAccessWhere } from "@/lib/amazon-sync/data-access";
import type { SyncScope } from "@/lib/amazon-sync/policy";
import { AdsQueryError } from "./query-contract";
import type { AcquisitionState } from "./report-acquisition";
import { assertReportScopeDigest, reportScopeDigest } from "./report-scope";

/** Offline-only manifest. No specific live Amazon report contract is enabled by this module. */
export type AdsReportManifest = { evidence: "ISOLATED_FIXTURE_ONLY"; reportType: string; adProduct: string; apiVersion: string; currencyCode: string; attributionWindow: string; timezone: string; from: string; to: string; dimensions: Array<"campaignId" | "adGroupId" | "targetingId" | "advertisedAsin" | "searchTerm" | "placement">; metrics: Array<"impressions" | "clicks" | "orders" | "units" | "spend" | "sales"> };
export type AdsReportFence = { taskId: string; dispatchVersion: number; fenceVersion: number; leaseOwner: string };
export type AdsStagingFact = { reportDate: string; dimensions: Partial<Record<"campaignId" | "adGroupId" | "targetingId" | "advertisedAsin" | "searchTerm" | "placement", string>>; impressions?: string | null; clicks?: string | null; spend?: string | null; orders?: string | null; sales?: string | null; units?: string | null };
const integerMetrics = ["impressions", "clicks", "orders", "units"] as const;
const dimensionFields = ["campaignId", "adGroupId", "targetingId", "advertisedAsin", "searchTerm", "placement"] as const;
function offlineOnly() { if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1") throw new AdsQueryError("ADS_REPORT_PUBLICATION_NOT_ENABLED", 403); }
function date(value: string) { const d = new Date(`${value}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== value) throw new AdsQueryError("ADS_REPORT_DATE_INVALID"); return d; }
function validateManifest(manifest: AdsReportManifest) {
  if (manifest.evidence !== "ISOLATED_FIXTURE_ONLY" || [manifest.reportType, manifest.adProduct, manifest.apiVersion, manifest.currencyCode, manifest.attributionWindow, manifest.timezone].some(s => typeof s !== "string" || !s || s.length > 200)) throw new AdsQueryError("ADS_REPORT_CONTRACT_UNVERIFIED");
  if (!Array.isArray(manifest.dimensions) || !manifest.dimensions.length || manifest.dimensions.some(key => !dimensionFields.includes(key)) || new Set(manifest.dimensions).size !== manifest.dimensions.length || !Array.isArray(manifest.metrics) || !manifest.metrics.length || manifest.metrics.some(key => ![...integerMetrics, "spend", "sales"].includes(key)) || new Set(manifest.metrics).size !== manifest.metrics.length) throw new AdsQueryError("ADS_REPORT_FIELDS_UNVERIFIED");
  if (!/^[A-Z]{3}$/.test(manifest.currencyCode)) throw new AdsQueryError("ADS_REPORT_CURRENCY_INVALID");
  try { new Intl.DateTimeFormat("en", { timeZone: manifest.timezone }); } catch { throw new AdsQueryError("ADS_REPORT_TIMEZONE_INVALID"); }
  const from = date(manifest.from), to = date(manifest.to);
  if (from > to || to.getTime()-from.getTime() > 366*86400000) throw new AdsQueryError("ADS_REPORT_RANGE_INVALID");
}
function dimensions(fact: AdsStagingFact) {
  if (!fact.dimensions || Object.entries(fact.dimensions).some(([key, value]) => !dimensionFields.includes(key as typeof dimensionFields[number]) || typeof value !== "string" || !value || value.length > 2000)) throw new AdsQueryError("ADS_REPORT_DIMENSIONS_INVALID");
  if (!Object.keys(fact.dimensions).length) throw new AdsQueryError("ADS_REPORT_GRAIN_UNVERIFIED");
  return Object.fromEntries(dimensionFields.filter(key => fact.dimensions[key] !== undefined).map(key => [key, fact.dimensions[key]!]));
}
function factKey(manifest: AdsReportManifest, fact: AdsStagingFact) {
  const keys = Object.keys(dimensions(fact));
  if (keys.length !== manifest.dimensions.length || manifest.dimensions.some(key => !keys.includes(key))) throw new AdsQueryError("ADS_REPORT_GRAIN_MISMATCH");
  if ([...integerMetrics, "spend", "sales"].some(key => fact[key as keyof AdsStagingFact] != null && !manifest.metrics.includes(key as AdsReportManifest["metrics"][number]))) throw new AdsQueryError("ADS_REPORT_METRIC_NOT_IN_CONTRACT");
  return createHash("sha256").update(JSON.stringify([manifest.reportType, manifest.adProduct, manifest.apiVersion, manifest.currencyCode, manifest.attributionWindow, fact.reportDate, dimensions(fact)])).digest("hex"); }
function numeric(fact: AdsStagingFact) {
  const result: Record<string, bigint | Prisma.Decimal | null> = {};
  for (const key of integerMetrics) {
    const value = fact[key];
    if (value != null && (typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) > BigInt("9223372036854775807"))) throw new AdsQueryError("ADS_REPORT_METRIC_INVALID");
    result[key] = value == null ? null : BigInt(value);
  }
  for (const key of ["spend", "sales"] as const) {
    const value = fact[key];
    if (value != null && (typeof value !== "string" || !/^\d{1,14}(\.\d{1,6})?$/.test(value))) throw new AdsQueryError("ADS_REPORT_METRIC_INVALID");
    result[key] = value == null ? null : new Prisma.Decimal(value);
  }
  return result;
}
async function assertProfile(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, profileId: string) {
  const access = await amazonDataAccess(scope, actor, tx);
  const sellers = await tx.sellerAccount.findMany({ where: { ...scope, status: "active" }, select: { id: true } });
  const profile = await tx.amazonAdsProfile.findFirst({ where: { ...scope, ...sellerAccessWhere(access), id: profileId, sellerAccountId: { in: access.allSellers ? sellers.map(s => s.id) : sellers.filter(s => access.sellerIds.includes(s.id)).map(s => s.id) }, authorization: { status: "CONNECTED" } }, select: { id: true, currencyCode: true, timezone: true } });
  if (!profile) throw new AdsQueryError("ADS_REPORT_PROFILE_FORBIDDEN", 403);
  return profile;
}
async function liveTask(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, fence: AdsReportFence) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-report:${fence.taskId}`}, 0))`;
  const task = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, id: fence.taskId, dispatchVersion: fence.dispatchVersion, fenceVersion: fence.fenceVersion, leaseOwner: fence.leaseOwner, leaseExpiresAt: { gt: new Date() }, status: "RUNNING" } });
  if (!task) throw new AdsQueryError("ADS_REPORT_FENCE_LOST", 409);
  const profile = await assertProfile(tx, scope, actor, task.profileId);
  if (task.trigger === "isolated-report") {
    if (task.requestedByUserId !== actor) throw new AdsQueryError("ADS_REPORT_PROFILE_FORBIDDEN", 403);
    const access = await amazonDataAccess(scope, actor, tx, "sync");
    const plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: task.planId, revision: task.planRevision, profileId: task.profileId, status: "ACTIVE", profile: { ...sellerAccessWhere(access) } }, include: { profile: { include: { authorization: true } } } });
    if (!plan || plan.sellerAccountId !== plan.profile.sellerAccountId || plan.authorizationRevision !== plan.profile.authorization.revision || (plan.profile.authorization.refreshTokenExpiresAt && plan.profile.authorization.refreshTokenExpiresAt <= new Date())) throw new AdsQueryError("ADS_REPORT_PLAN_CHANGED", 409);
    const request = await tx.amazonAdsReportRequest.findUnique({ where: { organizationId_workspaceId_idempotencyKey: { ...scope, idempotencyKey: `publication:${task.id}` } } });
    const options = request?.requestOptions as unknown as { manifest?: AdsReportManifest; acquisition?: AcquisitionState } | undefined;
    if (!options?.manifest) throw new AdsQueryError("ADS_REPORT_MANIFEST_MISSING");
    assertReportScopeDigest(options.acquisition?.scopeDigest, reportScopeDigest(task, plan.profile, plan.authorizationRevision, options.manifest));
  }
  return { ...task, profile };
}

export async function stageAdsReportBatch(scope: SyncScope, actor: string, fence: AdsReportFence, manifest: AdsReportManifest, facts: AdsStagingFact[]) {
  offlineOnly(); validateManifest(manifest);
  if (facts.length < 1 || facts.length > 1000) throw new AdsQueryError("ADS_REPORT_BATCH_BOUNDS");
  // Validate the entire batch before any write; a bad row cannot partially stage the page.
  const normalized = facts.map(fact => {
    date(fact.reportDate);
    if (fact.reportDate < manifest.from || fact.reportDate > manifest.to) throw new AdsQueryError("ADS_REPORT_ROW_OUT_OF_RANGE");
    return { fact, key: factKey(manifest, fact), dimensions: dimensions(fact), metrics: numeric(fact) };
  });
  return prisma.$transaction(async tx => {
    const task = await liveTask(tx, scope, actor, fence);
    if (task.profile.currencyCode !== manifest.currencyCode || task.profile.timezone !== manifest.timezone) throw new AdsQueryError("ADS_REPORT_PROFILE_CONTRACT_MISMATCH");
    if (task.requestedFrom?.toISOString().slice(0,10) !== manifest.from || task.requestedTo?.toISOString().slice(0,10) !== manifest.to) throw new AdsQueryError("ADS_REPORT_TASK_RANGE_MISMATCH");
    const prior = await tx.amazonAdsReportVersion.findUnique({ where: { organizationId_workspaceId_sourceTaskId: { ...scope, sourceTaskId: task.id } } });
    if (prior && prior.status !== "STAGING") throw new AdsQueryError("ADS_REPORT_VERSION_IMMUTABLE", 409);
    const version = prior ?? await tx.amazonAdsReportVersion.create({ data: { id: randomUUID(), ...scope, profileId: task.profileId, sourceTaskId: task.id, requestedFrom: task.requestedFrom, requestedTo: task.requestedTo } });
    const request = await tx.amazonAdsReportRequest.upsert({ where: { organizationId_workspaceId_idempotencyKey: { ...scope, idempotencyKey: `publication:${task.id}` } }, create: { id: randomUUID(), ...scope, profileId: task.profileId, sourceTaskId: task.id, versionId: version.id, idempotencyKey: `publication:${task.id}`, apiVersion: manifest.apiVersion, reportType: manifest.reportType, adProduct: manifest.adProduct, requestedFrom: date(manifest.from), requestedTo: date(manifest.to), requestOptions: { manifest }, status: "ISOLATED_STAGING" }, update: {} });
    if (JSON.stringify((request.requestOptions as { manifest: unknown }).manifest) !== JSON.stringify(manifest)) {
      // PostgreSQL jsonb may reorder object keys; compare canonical per-field values instead.
      const stored = (request.requestOptions as { manifest: Record<string, unknown> }).manifest;
      if (Object.entries(manifest).some(([key, value]) => JSON.stringify(stored[key]) !== JSON.stringify(value)) || Object.keys(stored).length !== Object.keys(manifest).length) throw new AdsQueryError("ADS_REPORT_CONTRACT_CHANGED", 409);
    }
    for (const row of normalized) {
      const values = { campaignId: row.dimensions.campaignId ?? null, adGroupId: row.dimensions.adGroupId ?? null, targetingId: row.dimensions.targetingId ?? null, advertisedAsin: row.dimensions.advertisedAsin ?? null, searchTerm: row.dimensions.searchTerm ?? null, placement: row.dimensions.placement ?? null, ...row.metrics };
      const key = { ...scope, versionId: version.id, reportType: manifest.reportType, adProduct: manifest.adProduct, reportDate: date(row.fact.reportDate), factKey: row.key };
      await tx.amazonAdsReportFact.upsert({ where: { organizationId_workspaceId_versionId_reportType_adProduct_reportDate_factKey: key }, create: { id: randomUUID(), ...key, profileId: task.profileId, sourceTaskId: task.id, currencyCode: manifest.currencyCode, attributionWindow: manifest.attributionWindow, apiVersion: manifest.apiVersion, rawDimensions: row.dimensions, ...values }, update: { ...values, rawDimensions: row.dimensions } });
    }
    return { versionId: version.id, rowCount: await tx.amazonAdsReportFact.count({ where: { ...scope, versionId: version.id } }), status: "STAGING" };
  }, { timeout: 20000 });
}

async function validateStored(tx: Prisma.TransactionClient, scope: SyncScope, versionId: string, profileId: string, sourceTaskId: string) {
  const request = await tx.amazonAdsReportRequest.findFirst({ where: { ...scope, versionId, profileId, sourceTaskId }, select: { id: true, requestOptions: true, requestedFrom: true, requestedTo: true, apiVersion: true, reportType: true, adProduct: true } });
  const manifest = (request?.requestOptions as { manifest?: AdsReportManifest } | undefined)?.manifest;
  if (!manifest) throw new AdsQueryError("ADS_REPORT_MANIFEST_MISSING");
  validateManifest(manifest);
  const profile = await tx.amazonAdsProfile.findFirst({ where: { ...scope, id: profileId }, select: { currencyCode: true, timezone: true } });
  if (!profile || profile.currencyCode !== manifest.currencyCode || profile.timezone !== manifest.timezone || request!.requestedFrom.toISOString().slice(0,10) !== manifest.from || request!.requestedTo.toISOString().slice(0,10) !== manifest.to || request!.apiVersion !== manifest.apiVersion || request!.reportType !== manifest.reportType || request!.adProduct !== manifest.adProduct) throw new AdsQueryError("ADS_REPORT_MANIFEST_DRIFT");
  const count = await tx.amazonAdsReportFact.count({ where: { ...scope, versionId } });
  if (!count || count > 100000) throw new AdsQueryError("ADS_REPORT_EMPTY_OR_EXCESSIVE_VERSION");
  const acquisition = (request!.requestOptions as unknown as { acquisition?: AcquisitionState }).acquisition;
  if (acquisition) {
    if (acquisition.version !== 1 || !["PUBLISH", "COMPLETE"].includes(acquisition.phase) || acquisition.reserved || acquisition.expectedRows !== count) throw new AdsQueryError("ADS_REPORT_ACQUISITION_INCOMPLETE");
    const docs = await tx.amazonAdsReportDocument.findMany({ where: { ...scope, requestId: request!.id, profileId } });
    if (docs.length !== 1 || docs[0].status !== "VALIDATED" || docs[0].rowCount !== count || !docs[0].contentSha256 || !docs[0].byteSize || !docs[0].storageFileId) throw new AdsQueryError("ADS_REPORT_DOCUMENT_NOT_READY");
    if (!await tx.fileObject.findFirst({ where: { ...scope, id: docs[0].storageFileId, contentHash: docs[0].contentSha256, size: Number(docs[0].byteSize), status: "done" } })) throw new AdsQueryError("ADS_REPORT_FILE_SCOPE_OR_HASH_MISMATCH");
    if (!acquisition.evidenceFileIds.length || await tx.fileObject.count({ where: { ...scope, id: { in: acquisition.evidenceFileIds }, status: "done", mimeType: "application/octet-stream" } }) !== acquisition.evidenceFileIds.length) throw new AdsQueryError("ADS_REPORT_EVIDENCE_MISSING");
  }
  let cursor: string | undefined;
  for (;;) {
    const rows = await tx.amazonAdsReportFact.findMany({ where: { ...scope, versionId }, orderBy: { id: "asc" }, take: 1000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const row of rows) {
      const fact: AdsStagingFact = { reportDate: row.reportDate.toISOString().slice(0,10), dimensions: row.rawDimensions as AdsStagingFact["dimensions"] };
      // Rebuild the complete stored row before checking the declared metric contract.
      for (const key of [...integerMetrics, "spend", "sales"] as const) fact[key] = row[key]?.toString() ?? null;
      if (row.profileId !== profileId || row.sourceTaskId !== sourceTaskId || row.reportType !== manifest.reportType || row.adProduct !== manifest.adProduct || row.apiVersion !== manifest.apiVersion || row.currencyCode !== manifest.currencyCode || row.attributionWindow !== manifest.attributionWindow || fact.reportDate < manifest.from || fact.reportDate > manifest.to || row.factKey !== factKey(manifest, fact)) throw new AdsQueryError("ADS_REPORT_STORED_VALIDATION_FAILED");
      numeric(fact);
      if (dimensionFields.some(key => row[key] !== (fact.dimensions[key] ?? null))) throw new AdsQueryError("ADS_REPORT_DIMENSION_DRIFT");
    }
    if (rows.length < 1000) break;
    cursor = rows[rows.length-1].id;
  }
  return count;
}
export async function publishAdsReportVersion(scope: SyncScope, actor: string, fence: AdsReportFence) {
  offlineOnly();
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-report:${fence.taskId}`}, 0))`;
    const prior = await tx.amazonAdsReportVersion.findUnique({ where: { organizationId_workspaceId_sourceTaskId: { ...scope, sourceTaskId: fence.taskId } }, include: { sourceTask: true } });
    if (prior?.status === "PUBLISHED" && prior.sourceTask.status === "SUCCEEDED" && prior.sourceTask.dispatchVersion === fence.dispatchVersion && prior.sourceTask.fenceVersion === fence.fenceVersion) {
      await assertProfile(tx, scope, actor, prior.profileId); return { versionId: prior.id, rowCount: prior.rowCount, status: "PUBLISHED" };
    }
    const task = await liveTask(tx, scope, actor, fence);
    if (!prior || prior.status !== "STAGING") throw new AdsQueryError("ADS_REPORT_VERSION_NOT_STAGING", 409);
    const count = await validateStored(tx, scope, prior.id, task.profileId, task.id);
    const changed = await tx.amazonAdsSyncTask.updateMany({ where: { ...scope, id: task.id, status: "RUNNING", dispatchVersion: fence.dispatchVersion, fenceVersion: fence.fenceVersion, leaseOwner: fence.leaseOwner, leaseExpiresAt: { gt: new Date() } }, data: { status: "SUCCEEDED", stage: "COMPLETED_ISOLATED_REPORT", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
    if (changed.count !== 1) throw new AdsQueryError("ADS_REPORT_FENCE_LOST", 409);
    await tx.amazonAdsReportVersion.update({ where: { id: prior.id }, data: { status: "PUBLISHED", rowCount: count, publishedAt: new Date() } });
    const request = await tx.amazonAdsReportRequest.findFirst({ where: { ...scope, versionId: prior.id, profileId: task.profileId, sourceTaskId: task.id } });
    const options = request?.requestOptions as unknown as { acquisition?: AcquisitionState };
    if (options?.acquisition) {
      options.acquisition.phase = "COMPLETE";
      await tx.amazonAdsReportRequest.update({ where: { id: request!.id }, data: { status: "ISOLATED_COMPLETE", completedAt: new Date(), requestOptions: options as unknown as Prisma.InputJsonObject } });
    }
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.ads.report.publish", entityType: "AmazonAdsReportVersion", entityId: prior.id, metadata: { workspaceId: scope.workspaceId, profileId: prior.profileId, rowCount: count, evidence: "ISOLATED_FIXTURE_ONLY" } } });
    return { versionId: prior.id, rowCount: count, status: "PUBLISHED" };
  }, { timeout: 20000 });
}

/** Local fixture rollback only. Preserve original publication order and all facts. */
export async function setAdsReportVersionVisibility(scope: SyncScope, actor: string, versionId: string, visible: boolean) {
  offlineOnly();
  return prisma.$transaction(async tx => {
    const identity = await tx.amazonAdsReportVersion.findFirst({ where: { ...scope, id: versionId }, select: { sourceTaskId: true } });
    if (!identity) throw new AdsQueryError("ADS_REPORT_VERSION_FORBIDDEN", 403);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-report:${identity.sourceTaskId}`}, 0))`;
    const version = await tx.amazonAdsReportVersion.findFirst({ where: { ...scope, id: versionId, sourceTaskId: identity.sourceTaskId }, include: { sourceTask: true } });
    if (!version) throw new AdsQueryError("ADS_REPORT_VERSION_FORBIDDEN", 403);
    await assertProfile(tx, scope, actor, version.profileId);
    if (!["PUBLISHED", "WITHDRAWN"].includes(version.status) || version.sourceTask.status !== "SUCCEEDED" || !version.publishedAt) throw new AdsQueryError("ADS_REPORT_VISIBILITY_INVALID", 409);
    if (visible && await validateStored(tx, scope, version.id, version.profileId, version.sourceTaskId) !== version.rowCount) throw new AdsQueryError("ADS_REPORT_ROW_COUNT_DRIFT");
    await tx.amazonAdsReportVersion.update({ where: { id: version.id }, data: { status: visible ? "PUBLISHED" : "WITHDRAWN" } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: visible ? "amazon.ads.report.restore" : "amazon.ads.report.withdraw", entityType: "AmazonAdsReportVersion", entityId: version.id, metadata: { workspaceId: scope.workspaceId, profileId: version.profileId, retainedRowCount: version.rowCount } } });
    return { versionId, status: visible ? "PUBLISHED" : "WITHDRAWN" };
  }, { timeout: 20000 });
}
