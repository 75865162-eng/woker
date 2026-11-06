import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { approvedContext } from "./approved-context";
import { digest, targetEnvironment, unseal } from "./approval-policy";
import { parseDomainReport, type DomainReportResource } from "./domain-reports";
import { markReportRowAttribution, persistReportAttributionMarkers, reportVerifiedRowWhere, recoveredReportAttributionProof } from "./report-row-attribution";
import { SyncInputError, type SyncScope, activeTaskStatuses } from "./policy";

export async function previewReportAttribution(tx: Prisma.TransactionClient, scope: SyncScope, id: string) {
  const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id }, include: { authorization: true, resourceCursor: true } });
  if (!["inventory_events", "reimbursements"].includes(source.resource)) throw new SyncInputError("归属恢复仅限库存事件与赔偿。");
  if (await tx.amazonSyncRun.count({ where: { ...scope, sourceId: id, status: { in: activeTaskStatuses } } }) || await tx.amazonSyncSchedule.count({ where: { ...scope, enabled: true, targets: { some: { sourceId: id } } } })) throw new SyncInputError("归属恢复前须暂停计划并排空任务。", 409);
  const documents = await tx.amazonSyncReportDocument.findMany({ where: { ...scope, sourceId: id, resource: source.resource }, select: { id: true, sourceRunId: true, contentSha256: true, rowCount: true, status: true }, orderBy: { id: "asc" }, take: 101 });
  if (documents.length > 100) throw new SyncInputError("归属恢复超出单次100份报告限制。", 409);
  const manifest = { sourceId: id, revision: source.revision, authorizationRevision: source.authorization.revision, documents, cursorDigest: digest(source.resourceCursor), policy: "verified-site-v1" };
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
    let count = 0;
    for (let offset = 0; offset < total; offset += 500) {
      const marked = await markReportRowAttribution(tx, scope, p.source, parsed.rows.slice(offset, offset + 500));
      count += marked.filter(r => r.fields.__siteEvidenceStatus === "VERIFIED").length;
      await persistReportAttributionMarkers(tx, scope, p.source.id, document.id, marked);
    }
    verified += count; isolated += total - count;
  }
  const visibleRows = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: p.source.id, document: { status: "PUBLISHED" }, ...reportVerifiedRowWhere(p.source.resource, p.source.marketplaceId) } });
  const priorCoverage = p.source.coverage && typeof p.source.coverage === "object" && !Array.isArray(p.source.coverage) ? p.source.coverage : {};
  await tx.amazonSyncDataSource.update({ where: { id: p.source.id }, data: { rowCount: visibleRows, coverage: { ...priorCoverage, attributionPolicy: "verified-site-v1", quarantinedRows: isolated, verifiedRows: verified, historicalComplete: false, rowAttribution: recoveredReportAttributionProof(p.documents.length, verified, isolated), priorCoverage: p.source.coverage, checkedAt: new Date().toISOString() } } });
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.report.attribution-reconciled", entityType: "AmazonSyncDataSource", entityId: p.source.id, metadata: { workspaceId: scope.workspaceId, approvalId, manifest: p.manifest, verified, isolated, visibleRows, originalRowsPreserved: true, cursorPreserved: true, taskPreserved: true } } });
  return { id: p.source.id, verified, isolated, visibleRows, cursorPreserved: true };
}
