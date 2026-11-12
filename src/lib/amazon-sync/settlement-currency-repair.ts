import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertAmazonScopeAdmin } from "./data-access";
import { registerArchivedFields } from "./field-registry";
import { recordSettlementFieldPersistence } from "./field-persistence-evidence";
import { createHash } from "node:crypto";
import { approvedContext } from "./approved-context";
import { digest, unseal } from "./approval-policy";
import { parseDomainReport } from "./domain-reports";
import { recordReportQualityIssue } from "./quality-issues";
import { activeTaskStatuses, SyncInputError, type SyncScope } from "./policy";

/** Existing site projections are a subset of seller originals. Validate every
 * stored row against its exact original row; never compare subset row counts
 * with the whole report or delete/reinsert facts to repair one column. */
export async function previewSettlementCurrencyRepair(tx: Prisma.TransactionClient, scope: SyncScope, id: string, documentIds: unknown) {
  if (!Array.isArray(documentIds) || !documentIds.length || documentIds.length > 10 || documentIds.some(value => typeof value !== "string" || !value || value.length > 200) || new Set(documentIds).size !== documentIds.length) throw new SyncInputError("币种重解析须指定 1–10 份报告档案。");
  const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id, resource: "settlements" }, include: { authorization: { select: { revision: true, status: true } } } });
  if (source.authorization.status !== "CONFIGURED") throw new SyncInputError("结算授权当前不可用。", 409);
  if (await tx.amazonSyncRun.count({ where: { ...scope, sourceId: id, status: { in: activeTaskStatuses } } }) || await tx.amazonSyncSchedule.count({ where: { ...scope, enabled: true, targets: { some: { sourceId: id } } } })) throw new SyncInputError("币种修复前须暂停对应计划并排空任务。", 409);
  const documents = await tx.amazonSyncReportDocument.findMany({ where: { ...scope, sourceId: id, resource: "settlements", id: { in: documentIds as string[] } }, orderBy: { id: "asc" } });
  if (documents.length !== documentIds.length) throw new SyncInputError("结算档案不属于指定来源。", 403);
  const batches = [];
  let decodedBytes = 0;
  for (const document of documents) {
    const archive = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, resource: "settlements", bodySha256: document.contentSha256,
      task: { source: { sellerAccountId: source.sellerAccountId, authorizationId: source.authorizationId } },
      requestMetadata: { path: ["reportId"], equals: document.reportId } }, orderBy: [{ capturedAt: "asc" }, { page: "asc" }] });
    if (!archive) throw new SyncInputError("结算修复缺少同授权卖家原件。", 409);
    if (archive.rawCiphertext.length > 24 * 1024 * 1024) throw new SyncInputError("结算原件超过单次修复容量。", 409);
    const text = unseal(archive.rawCiphertext, scope, `${archive.taskId}:${archive.page}`, "amazon-settlements-raw.v1").rawText;
    if (typeof text !== "string" || createHash("sha256").update(text).digest("hex") !== document.contentSha256) throw new SyncInputError("结算原件完整性校验失败。", 409);
    decodedBytes += Buffer.byteLength(text, "utf8");
    if (decodedBytes > 16 * 1024 * 1024) throw new SyncInputError("单次结算重解析总量超过 16 MiB，请缩小报告范围。", 409);
    const parsed = parseDomainReport("settlements", text);
    const byNumber = new Map(parsed.rows.map(row => [row.rowNumber, row]));
    const stored = await tx.amazonSyncReportRow.findMany({ where: { ...scope, sourceId: id, reportDocumentId: document.id },
      orderBy: { rowNumber: "asc" }, select: { id: true, rowNumber: true, rowHash: true, amountOriginal: true, currencyCode: true, currencySource: true, currencySourceRowNumber: true } });
    const patches = [];
    for (const row of stored) {
      const original = byNumber.get(row.rowNumber);
      if (!original || original.rowHash !== row.rowHash || original.amountOriginal !== row.amountOriginal) throw new SyncInputError("原件与现有明细不一致，禁止仅补币种。", 409);
      if (row.currencyCode && original.currencyCode && row.currencyCode !== original.currencyCode) throw new SyncInputError("现有币种与原件冲突，须单独审阅。", 409);
      if ((row.currencyCode === null || row.currencyCode === "") && original.currencyCode) patches.push({ id: row.id, rowNumber: row.rowNumber,
        currencyCode: original.currencyCode, currencySource: original.currencySource!, currencySourceRowNumber: original.currencySourceRowNumber! });
    }
    const canonical = await tx.amazonSettlementReport.findFirst({ where: { ...scope, authorizationId: source.authorizationId, reportId: document.reportId, contentSha256: document.contentSha256 }, select: { id: true } });
    const canonicalRows = canonical ? await tx.amazonSettlementRow.findMany({ where: { ...scope, reportDocumentId: canonical.id, sourceId: id }, orderBy: { rowNumber: "asc" },
      select: { id: true, rowNumber: true, rowHash: true, amountOriginal: true, currencyCode: true, currencySource: true, currencySourceRowNumber: true } }) : [];
    const canonicalPatches = [];
    for (const row of canonicalRows) {
      const original = byNumber.get(row.rowNumber);
      if (!original || original.rowHash !== row.rowHash || original.amountOriginal !== row.amountOriginal || row.currencyCode && original.currencyCode && row.currencyCode !== original.currencyCode) throw new SyncInputError("卖家级明细与原件不一致，禁止币种修复。", 409);
      if (!row.currencyCode && original.currencyCode) canonicalPatches.push({ id: row.id, rowNumber: row.rowNumber, currencyCode: original.currencyCode,
        currencySource: original.currencySource!, currencySourceRowNumber: original.currencySourceRowNumber! });
    }
    batches.push({ document, archive: { taskId: archive.taskId, page: archive.page }, text, parsed, patches, canonicalPatches,
      canonicalRows, canonicalId: canonical?.id ?? null,
      storedRows: stored.length, rowStateDigest: digest(stored), canonicalStateDigest: digest(canonicalRows) });
  }
  const manifest = { sourceId: source.id, revision: source.revision, authorizationId: source.authorizationId, authorizationRevision: source.authorization.revision,
    parserVersion: "settlements.v3", documents: batches.map(batch => ({ documentId: batch.document.id, reportId: batch.document.reportId, rawSha256: batch.document.contentSha256,
      documentStatus: batch.document.status, sourceRunId: batch.document.sourceRunId, rawArchive: batch.archive, storedRows: batch.storedRows,
      currencyPatches: batch.patches.length, canonicalCurrencyPatches: batch.canonicalPatches.length, rowStateDigest: batch.rowStateDigest, canonicalStateDigest: batch.canonicalStateDigest })) };
  return { source, batches, manifest, recoveryDigest: digest(manifest) };
}

/** Reuses the existing revision/digest/expiry/approval transaction. No HTTP,
 * task restart, publication change, row deletion, amount conversion or inference. */
export async function applySettlementCurrencyRepair(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  const { tx, approvalId } = approvedContext(scope, "recover-report");
  const preview = await previewSettlementCurrencyRepair(tx, scope, String(command.id), command.reportDocumentIds);
  if (preview.source.revision !== command.revision || preview.recoveryDigest !== command.recoveryDigest) throw new SyncInputError("币种修复清单或版本已变化。", 409);
  let updatedRows = 0, updatedCanonicalRows = 0;
  const readback = [];
  for (const batch of preview.batches) {
    // Group by identical provenance, bounded to 500 IDs per SQL mutation.
    const groups = new Map<string, typeof batch.patches>();
    for (const patch of batch.patches) { const key = digest([patch.currencyCode, patch.currencySource, patch.currencySourceRowNumber]); const group = groups.get(key) ?? []; group.push(patch); groups.set(key, group); }
    for (const group of groups.values()) for (let offset = 0; offset < group.length; offset += 500) {
      const patches = group.slice(offset, offset + 500), first = patches[0];
      const data = { currencyCode: first.currencyCode, currencySource: first.currencySource, currencySourceRowNumber: first.currencySourceRowNumber };
      const result = await tx.amazonSyncReportRow.updateMany({ where: { ...scope, sourceId: preview.source.id, reportDocumentId: batch.document.id,
        id: { in: patches.map(patch => patch.id) }, OR: [{ currencyCode: null }, { currencyCode: "" }] }, data });
      if (result.count !== patches.length) throw new SyncInputError("币种修复时明细已变化，整批回滚。", 409);
      updatedRows += result.count;
    }
    // Seller rows can be missing currency even when their site projection was
    // already repaired; apply their independently validated patches as well.
    const canonicalGroups = new Map<string, typeof batch.canonicalPatches>();
    for (const patch of batch.canonicalPatches) { const key = digest([patch.currencyCode, patch.currencySource, patch.currencySourceRowNumber]); const group = canonicalGroups.get(key) ?? []; group.push(patch); canonicalGroups.set(key, group); }
    for (const group of canonicalGroups.values()) for (let offset = 0; offset < group.length; offset += 500) {
      const patches = group.slice(offset, offset + 500), first = patches[0];
      const changed = await tx.amazonSettlementRow.updateMany({ where: { ...scope, sourceId: preview.source.id, reportDocumentId: batch.canonicalId!,
        id: { in: patches.map(patch => patch.id) }, OR: [{ currencyCode: null }, { currencyCode: "" }] },
        data: { currencyCode: first.currencyCode, currencySource: first.currencySource, currencySourceRowNumber: first.currencySourceRowNumber } });
      if (changed.count !== patches.length) throw new SyncInputError("卖家级币种修复数量变化，整批回滚。", 409);
      updatedCanonicalRows += changed.count;
    }
    const storedAfter = await tx.amazonSyncReportRow.findMany({ where: { ...scope, sourceId: preview.source.id, reportDocumentId: batch.document.id },
      orderBy: { rowNumber: "asc" }, select: { rowNumber: true, rowHash: true, amountOriginal: true, currencyCode: true, currencySource: true, currencySourceRowNumber: true } });
    const expected = new Map(batch.parsed.rows.map(row => [row.rowNumber, row]));
    if (storedAfter.length !== batch.storedRows || storedAfter.some(row => {
      const original = expected.get(row.rowNumber);
      return !original || original.rowHash !== row.rowHash || original.amountOriginal !== row.amountOriginal || original.currencyCode && original.currencyCode !== row.currencyCode;
    })) throw new SyncInputError("结算重解析回读不一致，整批回滚。", 409);
    const rawRun = await tx.amazonSyncRun.findFirstOrThrow({ where: { ...scope, id: batch.archive.taskId, resource: "settlements" } });
    await registerArchivedFields(tx, rawRun, batch.archive.page, batch.text, "REPORT");
    if (batch.canonicalId) {
      for (let offset = 0; offset < batch.canonicalRows.length; offset += 500) {
        const rows = batch.canonicalRows.slice(offset, offset + 500).map(row => expected.get(row.rowNumber)!);
        const checked = await recordSettlementFieldPersistence(tx, scope, actor, { sourceId: preview.source.id, reportDocumentId: batch.canonicalId,
          rawTaskId: batch.archive.taskId, rawPage: batch.archive.page, rows });
        if (!checked.passed) throw new SyncInputError("卖家级重解析回读不一致，整批回滚。", 409);
      }
    }
    readback.push({ documentId: batch.document.id, reportId: batch.document.reportId, rawTaskId: batch.archive.taskId, rawPage: batch.archive.page,
      rawSha256: batch.document.contentSha256, storedRowsChecked: storedAfter.length, amountsAndRowIdentitiesPreserved: true, siteReadbackVerified: true,
      queryAcceptanceVerified: false, canonicalDocumentPresent: !!batch.canonicalId });
    const missing = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: preview.source.id, reportDocumentId: batch.document.id, amountOriginal: { not: null }, OR: [{ currencyCode: null }, { currencyCode: "" }] } });
    await recordReportQualityIssue(tx, scope, actor, { sourceId: preview.source.id, taskId: batch.document.sourceRunId, reportId: batch.document.reportId,
      code: "CURRENCY_MISSING", affectedRows: missing, affectedFields: ["settlements.currency"], rawSha256: batch.document.contentSha256, checkedAt: new Date() });
  }
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.settlement.currency-reparsed", entityType: "AmazonSyncDataSource", entityId: preview.source.id,
    metadata: { workspaceId: scope.workspaceId, approvalId, manifest: preview.manifest, updatedRows, updatedCanonicalRows, readback, amountsPreserved: true, rowIdentitiesPreserved: true, publishedHeadPreserved: true } } });
  return { id: preview.source.id, updatedRows, updatedCanonicalRows, amountsPreserved: true, rowIdentitiesPreserved: true };
}


/** Read-only concrete repair command for the existing approval workflow. */
export async function readSettlementCurrencyRepairPreview(scope: SyncScope, actor: string, params: URLSearchParams) {
  await assertAmazonScopeAdmin(scope, actor);
  const sourceId = params.get("sourceId"), ids = params.get("reportDocumentIds");
  if (!sourceId || sourceId.length > 200 || !ids || ids.length > 2009) throw new SyncInputError("币种预览须指定 sourceId 和 reportDocumentIds。");
  const preview = await prisma.$transaction(tx => previewSettlementCurrencyRepair(tx, scope, sourceId, ids.split(",")), { timeout: 30000 });
  await assertAmazonScopeAdmin(scope, actor);
  return { manifest: preview.manifest, recoveryDigest: preview.recoveryDigest, rawValuesIncluded: false, started: false,
    command: { action: "recover-report", id: sourceId, revision: preview.source.revision, recoveryDigest: preview.recoveryDigest, currencyOnly: true,
      reportDocumentIds: preview.manifest.documents.map(doc => doc.documentId) } };
}
