import { createHash } from "node:crypto";
import { prisma } from "../src/lib/db/prisma";
import { unseal, digest } from "../src/lib/amazon-sync/approval-policy";
import { parseDomainReport } from "../src/lib/amazon-sync/domain-reports";
import { scanArchivedFields } from "../src/lib/amazon-sync/field-scan";

// Operator-only report. Runtime is preloaded by database-bootstrap; no alternate
// dotenv, migrations, network requests, writes or automatic identity selection.
async function main() {
  if (process.argv.slice(2).join(" ") !== "--report-only") throw new Error("REPORT_ONLY_REQUIRED");
  const target = new URL(process.env.DATABASE_URL ?? "");
  if (target.hostname !== "127.0.0.1" || target.port !== "55439" || target.pathname !== "/amazon_sync_live_local") throw new Error("REVIEWED_LOCAL_TARGET_REQUIRED");
  const scopes: unknown = JSON.parse(process.env.AMAZON_SYNC_CENTER_SCOPES ?? "null");
  if (!Array.isArray(scopes) || scopes.length !== 1 || !Array.isArray(scopes[0]) || scopes[0].length !== 2 || scopes[0].some(value => typeof value !== "string" || !value || value === "*")) throw new Error("SINGLE_CONFIGURED_SCOPE_REQUIRED");
  const scope = { organizationId: scopes[0][0] as string, workspaceId: scopes[0][1] as string };
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '20s'`;
    const tables = await tx.$queryRaw<Array<{ registry: string | null; observations: string | null }>>`SELECT to_regclass('"AmazonFieldRegistry"')::text AS registry, to_regclass('"AmazonFieldObservation"')::text AS observations`;
    const sources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, resource: "settlements" }, select: { id: true, revision: true, authorizationId: true, authorization: { select: { revision: true, status: true } } } });
    const sourceIds = sources.map(source => source.id);
    const totalRows = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: { in: sourceIds } } });
    const missingCurrency = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: { in: sourceIds }, OR: [{ currencyCode: null }, { currencyCode: "" }] } });
    const documents = await tx.amazonSyncReportDocument.findMany({ where: { ...scope, resource: "settlements", sourceId: { in: sourceIds }, rows: { some: { businessDate: { gte: "2026-10-10", lte: "2026-11-08" } } } }, orderBy: { capturedAt: "desc" }, take: 51,
      select: { id: true, sourceId: true, sourceRunId: true, reportId: true, reportType: true, rowCount: true, contentSha256: true, source: { select: { authorizationId: true, sellerAccountId: true } } } });
    const relatedPlans = await tx.amazonSyncSchedule.findMany({ where: { ...scope, targets: { some: { sourceId: { in: sourceIds } } } },
      select: { id: true, revision: true, enabled: true, resource: true, targets: { select: { sourceId: true } } } });
    const readiness = await Promise.all(sources.map(async source => ({ sourceId: source.id, revision: source.revision, authorizationId: source.authorizationId,
      authorizationRevision: source.authorization.revision, authorizationStatus: source.authorization.status,
      enabledSchedules: await tx.amazonSyncSchedule.count({ where: { ...scope, enabled: true, targets: { some: { sourceId: source.id } } } }),
      activeTasks: await tx.amazonSyncRun.count({ where: { ...scope, sourceId: source.id, status: { in: ["QUEUED", "RUNNING", "WAITING", "RETRY_WAIT"] } } }),
      reportDocumentIds: documents.filter(doc => doc.sourceId === source.id).map(doc => doc.id) })));
    const publishedRows = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: { in: sourceIds }, document: { status: "PUBLISHED", resource: "settlements" } } });
    const persistenceEvidenceEvents = await tx.auditLog.count({ where: { organizationId: scope.organizationId, action: "amazon.sync.fields.persistence-checked",
      AND: [{ metadata: { path: ["workspaceId"], equals: scope.workspaceId } }, { OR: sourceIds.map(id => ({ metadata: { path: ["sourceId"], equals: id } })) }] } });
    const fields = tables[0]?.registry && tables[0]?.observations ? {
      status: "AVAILABLE", observed: await tx.amazonFieldRegistry.count({ where: { ...scope, observations: { some: { ...scope, raw: { task: { sourceId: { in: sourceIds } } } } } } }),
    } : { status: "MIGRATION_NOT_APPLIED", observed: null };
    const reports = [];
    for (const doc of documents.slice(0, 50)) {
      const raws = await tx.amazonSyncRawPage.findMany({ where: { ...scope, resource: "settlements", bodySha256: doc.contentSha256, task: { source: { authorizationId: doc.source.authorizationId, sellerAccountId: doc.source.sellerAccountId } }, requestMetadata: { path: ["reportId"], equals: doc.reportId } }, take: 20 });
      const raw = raws.find(raw => raw.bodySha256 === doc.contentSha256);
      if (!raw) { reports.push({ reportReference: digest(doc.reportId), status: "RAW_NOT_FOUND", storedRows: doc.rowCount }); continue; }
      const text = unseal(raw.rawCiphertext, scope, `${raw.taskId}:${raw.page}`, "amazon-settlements-raw.v1").rawText;
      if (typeof text !== "string" || createHash("sha256").update(text).digest("hex") !== raw.bodySha256) { reports.push({ reportReference: digest(doc.reportId), status: "RAW_INTEGRITY_FAILED" }); continue; }
      let parsed: ReturnType<typeof parseDomainReport>;
      try { parsed = parseDomainReport("settlements", text); } catch { reports.push({ reportReference: digest(doc.reportId), status: "CURRENT_PARSER_REJECTED", rawSha256: raw.bodySha256 }); continue; }
      const stored = await tx.amazonSyncReportRow.findMany({ where: { ...scope, reportDocumentId: doc.id, sourceId: doc.sourceId }, select: { rowNumber: true, rowHash: true, currencyCode: true, amountOriginal: true, businessDate: true } });
      const byNumber = new Map(stored.map(row => [row.rowNumber, row]));
      let hashMismatches = 0, absentFromSiteProjection = 0, currencyRecoverable = 0, currencyStillMissing = 0, amountChanges = 0, targetCurrencyRecoverable = 0;
      for (const row of parsed.rows) {
        const original = byNumber.get(row.rowNumber);
        if (!original) absentFromSiteProjection++;
        else if (original.rowHash !== row.rowHash) hashMismatches++;
        if (original && original.amountOriginal !== row.amountOriginal) amountChanges++;
        if (!row.currencyCode) currencyStillMissing++;
        if (original && !original.currencyCode && row.currencyCode) {
          currencyRecoverable++;
          if (original.businessDate && original.businessDate >= "2026-10-10" && original.businessDate <= "2026-11-08") targetCurrencyRecoverable++;
        }
      }
      const fields = scanArchivedFields(text, "REPORT");
      const currencyRows = parsed.rows.filter(row => row.currencyCode && row.currencySource === "ROW");
      const currencyReportScopeEvidence = { explicitCurrencyRows: currencyRows.length,
        currencyRowsWithTransactionType: currencyRows.filter(row => row.transactionType).length,
        currencyRowsWithSettlementId: currencyRows.filter(row => row.fields["settlement-id"]).length,
        currencyRowsWithReportTotal: currencyRows.filter(row => row.fields["total-amount"]).length,
        rowsWithSettlementId: parsed.rows.filter(row => row.fields["settlement-id"]).length,
        distinctSettlementIds: new Set(parsed.rows.map(row => row.fields["settlement-id"]).filter(Boolean)).size,
        distinctExplicitCurrencies: new Set(currencyRows.map(row => row.currencyCode)).size };

      reports.push({ reportReference: digest(doc.reportId), reportType: doc.reportType, rawSha256: raw.bodySha256, status: "READ_ONLY_REPARSED",
        archivedRows: parsed.rowCount, storedRows: stored.length, rowHashMismatches: hashMismatches, absentFromSiteProjection, amountChanges,
        currencyRecoverable, targetCurrencyRecoverable, currencyStillMissing, currencyReportScopeEvidence, observedFields: fields.fields.length, fieldScanComplete: fields.complete,
        currencyHeaders: parsed.headers.filter(header => ["currency", "currency-unit", "currency-code"].includes(header)),
        actualFrom: parsed.rows.flatMap(row => row.businessDate ? [row.businessDate] : []).sort()[0] ?? null,
        actualTo: parsed.rows.flatMap(row => row.businessDate ? [row.businessDate] : []).sort().at(-1) ?? null });
    }
    return { observedAt: new Date().toISOString(), mode: "READ_ONLY_EXISTING_ARCHIVES", sourceCount: sources.length, legacyStructuredRows: totalRows,
      legacyRowsMissingCurrency: missingCurrency, publishedQueryableRows: publishedRows, fieldRegistry: fields, persistenceEvidenceEvents,
      officialFieldCount: null, fieldCoveragePercent: null, readiness, relatedPlans, reports, documentsTruncated: documents.length > 50, targetBusinessDates: { from: "2026-10-10", to: "2026-11-08" },
      scope: "LEGACY_SITE_REPORT_DOCUMENTS_ONLY", sellerLevelArchivesAudited: false,
      amazonRequests: 0, databaseWrites: 0, currenciesInferred: 0, liveApiAcceptance: "NOT_RUN" };
  }, { timeout: 60000, isolationLevel: "RepeatableRead" });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
main().catch(() => { process.stderr.write("Settlement read-only audit failed; target details and raw values omitted.\n"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
