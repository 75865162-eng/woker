import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertAmazonScopeAdmin } from "./data-access";
import { recordReportQualityIssue } from "./quality-issues";
import { createHash } from "node:crypto";
import { approvedContext } from "./approved-context";
import { digest, targetEnvironment, unseal } from "./approval-policy";
import { parseDomainReport, type DomainReportResource } from "./domain-reports";
import { markReportRowAttribution, persistReportAttributionMarkers, reportVerifiedRowWhere, recoveredReportAttributionProof } from "./report-row-attribution";
import { SyncInputError, type SyncScope, activeTaskStatuses } from "./policy";

export async function readReportAttributionPreview(scope: SyncScope, actor: string, params: URLSearchParams) {
  await assertAmazonScopeAdmin(scope, actor);
  const sourceId = params.get("sourceId");
  if (!sourceId || sourceId.length > 200 || params.getAll("sourceId").length !== 1) throw new SyncInputError("归属恢复预览须指定唯一 sourceId。");
  const preview = await prisma.$transaction(tx => previewReportAttribution(tx, scope, sourceId), { timeout: 30000 });
  const audit = params.get("audit") === "1"
    ? await prisma.$transaction(tx => auditReportAttribution(tx, scope, sourceId, params.get("includeRows") === "1"), { timeout: 120000 })
    : undefined;
  await assertAmazonScopeAdmin(scope, actor);
  return {
    manifest: preview.manifest,
    recoveryDigest: preview.recoveryDigest,
    command: { action: "recover-report", id: sourceId, revision: preview.source.revision, attributionOnly: true, recoveryDigest: preview.recoveryDigest },
    started: false,
    rawValuesIncluded: false,
    ...(audit ? { audit } : {}),
  };
}

async function auditReportAttribution(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string, includeRows: boolean) {
  const maxIncludedRows = 5000;
  let includedRows = 0;
  let rowsTruncated = false;
  const preview = await previewReportAttribution(tx, scope, sourceId);
  const source = preview.source;
  const documents = await tx.amazonSyncReportDocument.findMany({
    where: { ...scope, sourceId, resource: source.resource },
    select: { id: true, reportId: true, reportType: true, sourceRunId: true, sellerAccountId: true, amazonSellerId: true, marketplaceId: true, contentSha256: true, rowCount: true, status: true },
    orderBy: { id: "asc" },
  });
  const results = [];
  for (const document of documents) {
    const raw = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: document.sourceRunId, resource: source.resource, bodySha256: document.contentSha256 } })
      ?? await tx.amazonSyncRawPage.findFirst({ where: { ...scope, resource: source.resource, bodySha256: document.contentSha256, task: { sourceId } } });
    if (!raw) {
      results.push({ documentId: document.id, reportId: document.reportId, rowCount: document.rowCount, status: document.status, integrity: "RAW_ARCHIVE_MISSING" });
      continue;
    }
    const archived = unseal(raw.rawCiphertext, scope, `${raw.taskId}:${raw.page}`, `amazon-${source.resource}-raw.v1`) as { rawText?: unknown };
    if (typeof archived.rawText !== "string" || createHash("sha256").update(archived.rawText).digest("hex") !== document.contentSha256) {
      results.push({ documentId: document.id, reportId: document.reportId, rowCount: document.rowCount, status: document.status, integrity: "RAW_HASH_MISMATCH", rawPage: raw.page, rawTaskId: raw.taskId });
      continue;
    }
    const parsed = parseDomainReport(source.resource as DomainReportResource, archived.rawText);
    const metadata = raw.requestMetadata && typeof raw.requestMetadata === "object" && !Array.isArray(raw.requestMetadata) ? raw.requestMetadata as Record<string, unknown> : {};
    const task = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: document.sourceRunId, sourceId }, select: { resource: true, frozenScope: true, authorizationRevision: true, stage: true, status: true } });
    const integrity = parsed.rowCount === document.rowCount ? "ROW_COUNT_MATCH" : "ROW_COUNT_MISMATCH";
    const counts = { VERIFIED: 0, MISSING_EVIDENCE: 0, CONFLICTING_EVIDENCE: 0, OUT_OF_SCOPE: 0, ROW_HASH_MISMATCH: 0 };
    const lines = [];
    for (let offset = 0; offset < parsed.rows.length; offset += 500) {
      const batch = parsed.rows.slice(offset, offset + 500);
      const stored = await tx.amazonSyncReportRow.findMany({ where: { ...scope, sourceId, reportDocumentId: document.id, rowNumber: { in: batch.map(row => row.rowNumber) } }, select: { rowNumber: true, rowHash: true } });
      const storedHashes = new Map(stored.map(row => [row.rowNumber, row.rowHash]));
      const marked = await markReportRowAttribution(tx, scope, source, batch);
      for (let index = 0; index < batch.length; index++) {
        const row = batch[index];
        const classified = marked[index];
        const hashMatches = storedHashes.get(row.rowNumber) === row.rowHash;
        const status = hashMatches ? classified.fields.__siteEvidenceStatus : "ROW_HASH_MISMATCH";
        counts[status as keyof typeof counts]++;
        if (includeRows && includedRows < maxIncludedRows) {
          includedRows++;
          lines.push({
            rowNumber: row.rowNumber,
            rowHash: row.rowHash,
            status,
            sourceEvidence: {
              marketplaceId: row.fields["marketplace-id"] ?? null,
              marketplaceName: row.fields["marketplace-name"] ?? null,
              store: row.fields.store ?? null,
              orderId: row.orderId ?? null,
              sellerSku: row.sellerSku ?? null,
              asin: row.asin ?? null,
              verifiedOrderItemStatus: classified.fields.__orderItemEvidenceStatus ?? null,
              verifiedMarketplaceId: classified.fields.__verifiedMarketplaceId || null,
            },
          });
        } else if (includeRows) {
          rowsTruncated = true;
        }
      }
    }
    results.push({
      documentId: document.id, reportId: document.reportId, reportType: document.reportType,
      rowCount: document.rowCount, status: document.status, contentSha256: document.contentSha256,
      sourceRunId: document.sourceRunId, taskStatus: task?.status ?? "TASK_MISSING", taskStage: task?.stage ?? null,
      sellerAccountId: document.sellerAccountId, amazonSellerId: document.amazonSellerId,
      marketplaceId: document.marketplaceId, taskResource: task?.resource ?? null,
      taskAuthorizationRevision: task?.authorizationRevision ?? null,
      taskMarketplaceId: (task?.frozenScope as Record<string, unknown> | null)?.marketplaceId ?? null,
      taskSellerId: (task?.frozenScope as Record<string, unknown> | null)?.amazonSellerId ?? null,
      rawTaskId: raw.taskId, rawPage: raw.page, rawSha256: raw.bodySha256,
      rawMarketplaceId: metadata.marketplaceId ?? null, rawReportId: metadata.reportId ?? null,
      rawReportType: metadata.reportType ?? null, rawMarketplaceIds: metadata.marketplaceIds ?? null,
      integrity, parsedRows: parsed.rowCount, attributionCounts: counts,
      ...(includeRows ? { rows: lines } : {}),
    });
  }
  return { sourceId, resource: source.resource, sellerAccountId: source.sellerAccountId, amazonSellerId: source.authorization.amazonSellerId, marketplaceId: source.marketplaceId, policy: "verified-site-v2", rowsIncluded: includeRows, includedRowCount: includedRows, rowsTruncated, maxIncludedRows, documents: results };
}

export async function previewReportAttribution(tx: Prisma.TransactionClient, scope: SyncScope, id: string) {
  const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id }, include: { authorization: true, resourceCursor: true } });
  if (!["inventory_events", "reimbursements"].includes(source.resource)) throw new SyncInputError("归属恢复仅限库存事件与赔偿。");
  if (await tx.amazonSyncRun.count({ where: { ...scope, sourceId: id, status: { in: activeTaskStatuses } } }) || await tx.amazonSyncSchedule.count({ where: { ...scope, enabled: true, targets: { some: { sourceId: id } } } })) throw new SyncInputError("归属恢复前须暂停计划并排空任务。", 409);
  const documents = await tx.amazonSyncReportDocument.findMany({ where: { ...scope, sourceId: id, resource: source.resource }, select: { id: true, sourceRunId: true, contentSha256: true, rowCount: true, status: true }, orderBy: { id: "asc" }, take: 101 });
  if (documents.length > 100) throw new SyncInputError("归属恢复超出单次100份报告限制。", 409);
  const manifest = { sourceId: id, revision: source.revision, authorizationRevision: source.authorization.revision, documents, cursorDigest: digest(source.resourceCursor), policy: "verified-site-v2" };
  return { source, documents, manifest, recoveryDigest: digest(manifest) };
}
export async function applyReportAttribution(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  const u = new URL(process.env.DATABASE_URL ?? "invalid:");
  if (targetEnvironment() !== "local" || u.hostname !== "127.0.0.1" || u.port !== "55439" || u.pathname !== "/amazon_sync_live_local" || scope.organizationId !== "amazon-live-local" || scope.workspaceId !== "default") throw new SyncInputError("仅限已批准独立本机环境。", 403);
  const { tx, approvalId } = approvedContext(scope, "recover-report");
  const p = await previewReportAttribution(tx, scope, String(command.id));
  if (p.recoveryDigest !== command.recoveryDigest || p.source.revision !== command.revision) throw new SyncInputError("归属清单已变化。", 409);
  let verified = 0, isolated = 0;
  for (const document of p.documents) {
    const raw = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: document.sourceRunId, resource: p.source.resource, bodySha256: document.contentSha256 } });
    // Resumed documents may refer to an older archive task, still scoped to the source.
    const archive = raw ?? await tx.amazonSyncRawPage.findFirst({ where: { ...scope, resource: p.source.resource, bodySha256: document.contentSha256, task: { sourceId: p.source.id } } });
    if (!archive) throw new SyncInputError("归属恢复缺少原始加密证据。", 409);
    const evidence = unseal(archive.rawCiphertext, scope, `${archive.taskId}:${archive.page}`, `amazon-${p.source.resource}-raw.v1`) as { rawText: string };
    if (typeof evidence.rawText !== "string" || createHash("sha256").update(evidence.rawText).digest("hex") !== document.contentSha256) throw new SyncInputError("原件摘要校验失败。", 409);
    const parsed = parseDomainReport(p.source.resource as DomainReportResource, evidence.rawText);
    const total = parsed.rowCount;
    if (total !== document.rowCount) throw new SyncInputError("原件总行数与报告不一致。", 409);
    const storedCount = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: p.source.id, reportDocumentId: document.id } });
    if (storedCount !== total) throw new SyncInputError("报告结构化行数与原件不一致，须先从原件恢复解析，不能仅更新归属证明。", 409);
    let count = 0;
    for (let offset = 0; offset < total; offset += 500) {
      const batch = parsed.rows.slice(offset, offset + 500);
      const stored = await tx.amazonSyncReportRow.findMany({ where: { ...scope, sourceId: p.source.id, reportDocumentId: document.id, rowNumber: { in: batch.map(row => row.rowNumber) } }, select: { rowNumber: true, rowHash: true } });
      const hashes = new Map(stored.map(row => [row.rowNumber, row.rowHash]));
      if (stored.length !== batch.length || batch.some(row => hashes.get(row.rowNumber) !== row.rowHash)) throw new SyncInputError("报告结构化行摘要与原件不一致，拒绝生成完整归属证明。", 409);
      const marked = await markReportRowAttribution(tx, scope, p.source, batch);
      count += marked.filter(r => r.fields.__siteEvidenceStatus === "VERIFIED").length;
      await persistReportAttributionMarkers(tx, scope, p.source.id, document.id, marked);
    }
    const storedVerified = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: p.source.id, reportDocumentId: document.id, ...reportVerifiedRowWhere(p.source.resource, p.source.marketplaceId) } });
    if (storedVerified !== count) throw new SyncInputError("报告归属标记写入数量与重核结果不一致。", 409);
    // The entire original and every stored row hash were checked above. Publish
    // its verified subset; readers still require the per-row marketplace marker.
    if (count > 0 && document.status !== "PUBLISHED") await tx.amazonSyncReportDocument.update({ where: { id: document.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    const reportIdentity = await tx.amazonSyncReportDocument.findUniqueOrThrow({ where: { id: document.id }, select: { reportId: true } });
    await recordReportQualityIssue(tx, scope, actor, { sourceId: p.source.id, taskId: document.sourceRunId, reportId: reportIdentity.reportId, code: "SKU_ATTRIBUTION_PENDING", affectedRows: total - count, affectedFields: ["marketplaceId", "sellerSku", "asin"], rawSha256: document.contentSha256, checkedAt: new Date() });
    verified += count; isolated += total - count;
  }
  const visibleRows = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: p.source.id, document: { status: "PUBLISHED" }, ...reportVerifiedRowWhere(p.source.resource, p.source.marketplaceId) } });
  const priorCoverage = p.source.coverage && typeof p.source.coverage === "object" && !Array.isArray(p.source.coverage) ? p.source.coverage : {};
  const rowAttribution = isolated > 0 && visibleRows > 0
    ? { status: "PARTIAL", version: "verified-site-rows.v1", complete: false, verifiedRows: visibleRows, parsedRows: verified + isolated }
    : recoveredReportAttributionProof(p.documents.length, verified, isolated);
  await tx.amazonSyncDataSource.update({ where: { id: p.source.id }, data: { rowCount: visibleRows, coverage: { ...priorCoverage, attributionPolicy: "verified-site-v2", quarantinedRows: isolated, verifiedRows: verified, historicalComplete: false, rowAttribution, priorCoverage: p.source.coverage, checkedAt: new Date().toISOString() } } });
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.report.attribution-reconciled", entityType: "AmazonSyncDataSource", entityId: p.source.id, metadata: { workspaceId: scope.workspaceId, approvalId, manifest: p.manifest, verified, isolated, visibleRows, originalRowsPreserved: true, cursorPreserved: true, taskPreserved: true } } });
  return { id: p.source.id, verified, isolated, visibleRows, cursorPreserved: true };
}
