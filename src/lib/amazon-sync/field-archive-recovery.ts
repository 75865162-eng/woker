import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertAmazonScopeAdmin } from "./data-access";
import { approvedContext } from "./approved-context";
import { digest, unseal } from "./approval-policy";
import { fieldScannerVersion, scanArchivedFields } from "./field-scan";
import { implementedFieldMapping } from "./field-mappings";
import { registerArchivedFields } from "./field-registry";
import { SyncInputError, type SyncScope } from "./policy";

export function archiveScanPages(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 10 || value.some(page => !Number.isSafeInteger(page) || page === 0) || new Set(value).size !== value.length) throw new SyncInputError("字段回扫须指定 1–10 个非零整数原件页。");
  return [...value as number[]].sort((a, b) => a - b);
}

/** Historical field discovery only. Raw bytes are immutable, observations are
 * idempotent, and an incomplete scan never becomes structured acceptance. */
export async function previewFieldArchiveRecovery(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string, taskId: string, pages: unknown) {
  const selected = archiveScanPages(pages);
  const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId }, select: { id: true, revision: true, resource: true, sellerAccountId: true, marketplaceId: true, authorizationId: true, authorization: { select: { revision: true, amazonSellerId: true, awsRegion: true } } } });
  const task = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: taskId, sourceId, resource: source.resource, executionVersion: 2 } });
  if (!task || task.stage === "PURGED") throw new SyncInputError("字段回扫任务不可访问或原件已清理。", 409);
  const raws = await tx.amazonSyncRawPage.findMany({ where: { ...scope, taskId, resource: source.resource, page: { in: selected } }, orderBy: { page: "asc" } });
  if (raws.length !== selected.length) throw new SyncInputError("字段回扫原件范围不完整。", 409);
  let bytes = 0;
  const archives = raws.map(raw => {
    // Bound ciphertext before decryption, and total decoded source afterwards.
    if (raw.rawCiphertext.length > 24 * 1024 * 1024) throw new SyncInputError("原件超过单次字段回扫容量。", 409);
    const envelope = unseal(raw.rawCiphertext, scope, `${task.id}:${raw.page}`, `amazon-${source.resource}-raw.v1`);
    const text = typeof envelope.rawBody === "string" ? envelope.rawBody : envelope.rawText;
    if (typeof text !== "string" || raw.bodySha256 !== digest(text) && raw.bodySha256 !== createHash("sha256").update(text).digest("hex")) throw new SyncInputError("字段回扫原件摘要校验失败。", 409);
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > 16 * 1024 * 1024) throw new SyncInputError("单次字段回扫解码总量超过 16 MiB，请缩小范围。", 409);
    const format = typeof envelope.rawBody === "string" ? "JSON" as const : "REPORT" as const;
    const scan = scanArchivedFields(text, format);
    const metadata = raw.requestMetadata && typeof raw.requestMetadata === "object" && !Array.isArray(raw.requestMetadata) ? raw.requestMetadata : {};
    const sourceCode = typeof metadata.reportType === "string" ? metadata.reportType : typeof metadata.operation === "string" ? metadata.operation : task.resource;
    const apiVersion = typeof metadata.apiVersion === "string" ? metadata.apiVersion : "UNSPECIFIED";
    const mappingDigest = digest(scan.fields.map(field => [field.path, implementedFieldMapping(task.resource, sourceCode, apiVersion, field.path)]));
    return { raw, text, format, mappingDigest, fieldCount: scan.fields.length, scanComplete: scan.complete, schemaHash: scan.schemaHash };
  });
  const manifest = { sourceId, sourceRevision: source.revision, authorizationId: source.authorizationId, authorizationRevision: source.authorization.revision,
    taskId, scannerVersion: fieldScannerVersion, decodedBytes: bytes,
    archives: archives.map(item => ({ page: item.raw.page, bodySha256: item.raw.bodySha256, metadataDigest: digest(item.raw.requestMetadata),
      capturedAt: item.raw.capturedAt.toISOString(), format: item.format, mappingDigest: item.mappingDigest, observedFields: item.fieldCount, scanComplete: item.scanComplete, schemaHash: item.schemaHash })),
    businessFactsModified: false, historicalUniverseComplete: false };
  return { source, task, archives, manifest, recoveryDigest: digest(manifest) };
}

export async function readFieldArchiveRecoveryPreview(scope: SyncScope, actor: string, params: URLSearchParams) {
  await assertAmazonScopeAdmin(scope, actor);
  const sourceId = params.get("sourceId"), taskId = params.get("taskId"), rawPages = params.get("rawPages");
  if (!sourceId || sourceId.length > 200 || !taskId || taskId.length > 200 || !rawPages || !/^-?\d+(?:,-?\d+){0,9}$/.test(rawPages)) throw new SyncInputError("回扫预览须指定 sourceId、taskId 和逗号分隔 rawPages。");
  const preview = await prisma.$transaction(tx => previewFieldArchiveRecovery(tx, scope, sourceId, taskId, rawPages.split(",").map(Number)), { timeout: 30000 });
  await assertAmazonScopeAdmin(scope, actor);
  return { manifest: preview.manifest, recoveryDigest: preview.recoveryDigest,
    command: { action: "recover-report", id: sourceId, revision: preview.source.revision, taskId, rawPages: preview.manifest.archives.map(item => item.page), fieldScanOnly: true, recoveryDigest: preview.recoveryDigest },
    started: false, rawValuesIncluded: false };
}

export async function applyFieldArchiveRecovery(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  const { tx, approvalId } = approvedContext(scope, "recover-report");
  const preview = await previewFieldArchiveRecovery(tx, scope, String(command.id), String(command.taskId), command.rawPages);
  if (preview.source.revision !== command.revision || preview.recoveryDigest !== command.recoveryDigest) throw new SyncInputError("字段回扫清单或来源版本已变化。", 409);
  for (const archive of preview.archives) await registerArchivedFields(tx, preview.task, archive.raw.page, archive.text, archive.format);
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.fields.archive-recovered", entityType: "AmazonSyncDataSource", entityId: preview.source.id,
    metadata: { workspaceId: scope.workspaceId, approvalId, manifest: preview.manifest, recoveryDigest: preview.recoveryDigest,
      businessFactsModified: false, historicalUniverseComplete: false, mappingBasis: "CURRENT_IMPLEMENTATION_CATALOGUE_NOT_HISTORICAL_PARSER_REPLAY" } } });
  return { id: preview.source.id, archivesScanned: preview.archives.length, businessFactsModified: false, historicalUniverseComplete: false };
}
