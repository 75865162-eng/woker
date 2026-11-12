import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertFinanceParserRecoveryAccess } from "./processor";
import { scopeLock, syncIncrementalCursorStatus } from "./service";
import { digest } from "./approval-policy";
import { decryptCheckpoint } from "./checkpoint";
import { FinanceParseError, financeWindowFromFrozen, parseFinancePolicy } from "./finance";
import { financeParser, financeParserCanRecover, parseFinanceResponse } from "./finance-parser";
import { replayResponse } from "./response-evidence";
import { recordReportParseEvidence } from "./report-parse-evidence";
import type { SyncScope } from "./policy";

/** A bounded scan of failed, cursor-owned originals. Existing authority is
 * rechecked; this never renews an approval, resets a token or requests Amazon. */
export async function recoverFinanceParserFailures(scopes: SyncScope[], now = new Date(), options?: { taskIds?: string[]; dryRun?: boolean }) {
  const result = { examined: 0, recovered: 0, deferred: 0, candidates: [] as Array<{ taskId: string; page: number; rawSha256: string; parserVersion: string; recordsParsed: number }> };
  if (!scopes.length) return result;
  const runs = await prisma.amazonSyncRun.findMany({ where: { OR: scopes, resource: "finance", executionVersion: 2, status: "FAILED", control: null, leaseOwner: null, leaseExpiresAt: null,
    resourceCursors: { some: { resource: "finance", status: "FAILED" } },
    // Explicit inspection and read-only previews may inspect a named failure
    // immediately. Periodic scans respect the durable retry/inspection clock.
    ...(!options?.taskIds && !options?.dryRun ? { nextAttemptAt: { lte: now } } : {}),
    ...(options?.taskIds ? { id: { in: options.taskIds } } : {}) }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 25 });
  for (const candidate of runs) {
    result.examined++;
    try {
      const recovered = await prisma.$transaction(async tx => {
        if (options?.dryRun) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const scope = { organizationId: candidate.organizationId, workspaceId: candidate.workspaceId };
        await scopeLock(tx, scope);
        const run = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: candidate.id, status: "FAILED", control: null, leaseOwner: null, leaseExpiresAt: null, dispatchVersion: candidate.dispatchVersion,
          ...(!options?.taskIds && !options?.dryRun ? { nextAttemptAt: { lte: now } } : {}) } });
        if (!run) return null;
        const source = await assertFinanceParserRecoveryAccess(tx, run), page = run.pagesCompleted + 1;
        const previous = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, entityId: run.id, action: "amazon.sync.report.parse-checkpoint",
          AND: [{ metadata: { path: ["workspaceId"], equals: scope.workspaceId } }, { metadata: { path: ["rawPage"], equals: page } }, { metadata: { path: ["phase"], equals: "ATTEMPT_FAILED" } }] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        const version = (previous?.metadata as { parserVersion?: string } | null)?.parserVersion ?? null;
        if (!financeParserCanRecover(version, run.error)) return null;
        const cursor = await tx.amazonSyncResourceCursor.findFirst({ where: { ...scope, sourceId: source.id, activeRunId: run.id, resource: "finance", status: "FAILED" } });
        const window = financeWindowFromFrozen((run.frozenScope as { financeWindow?: unknown }).financeWindow), policyDigest = digest(parseFinancePolicy(source.financePolicy));
        if (!cursor || cursor.watermarkFrom.toISOString() !== window.from || cursor.watermarkTo.toISOString() !== window.to || cursor.detailPolicyDigest !== policyDigest || decryptCheckpoint(run.checkpointCiphertext, scope, run.id) !== decryptCheckpoint(cursor.nextTokenCiphertext, scope, cursor.id)) return null;
        const replay = cursor.reportStateCiphertext ? JSON.parse(decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id) ?? "null") as { replayApprovalId?: string; window?: { from?: string; to?: string } } | null : null;
        const replayId = replay?.window?.from === window.from && replay.window.to === window.to ? replay.replayApprovalId : undefined;
        const token = decryptCheckpoint(cursor.nextTokenCiphertext, scope, cursor.id), pageTokenHash = replayId ? digest([window, policyDigest, token ?? null, replayId]) : digest([window, policyDigest, token ?? null]);
        const identity = { apiVersion: financeParser.apiVersion, operation: financeParser.sourceCode, window, pageTokenHash, policyDigest };
        const raw = await replayResponse(run, page, identity, tx);
        if (raw === null) return null;
        let parsed: ReturnType<typeof parseFinanceResponse>;
        try { parsed = parseFinanceResponse(raw, { sourceCode: identity.operation, apiVersion: identity.apiVersion, responseType: "JSON" }, window); }
        catch (error) {
          if (error instanceof FinanceParseError && !options?.dryRun) await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage: page, phase: "ATTEMPT_FAILED", rowsCommitted: 0, checkedAt: now, failureCode: error.code, replayed: true, finance: { diagnostic: { code: error.code, offset: error.offset, path: error.path } } });
          return null;
        }
        const original = await tx.amazonSyncRawPage.findUniqueOrThrow({ where: { taskId_page: { taskId: run.id, page } } });
        const recoveryId = digest([scope, "finance-parser-recovery", run.id, page, original.bodySha256, financeParser.version]);
        if (await tx.auditLog.findUnique({ where: { id: recoveryId }, select: { id: true } })) return null;
        const evidence = { taskId: run.id, page, rawSha256: original.bodySha256, parserVersion: parsed.parser.version, recordsParsed: parsed.page.transactions.length };
        if (options?.dryRun) return evidence;
        await tx.auditLog.create({ data: { id: recoveryId, organizationId: scope.organizationId, userId: run.requestedByUserId, action: "amazon.sync.finance.parser-recovery", entityType: "AmazonSyncRun", entityId: run.id,
          metadata: { ...scope, sourceId: source.id, ...evidence, previousParserVersion: version, originalPreserved: true, checkpointPreserved: true, existingExecutionApprovalId: run.executionApprovalId } as Prisma.InputJsonValue } });
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "WAITING", error: null, finishedAt: null, nextAttemptAt: now, dispatchVersion: { increment: 1 }, maxAttempts: Math.max(run.maxAttempts, run.attempts + 1) } });
        await syncIncrementalCursorStatus(tx, run, "WAITING");
        return evidence;
      }, { timeout: 60000 });
      if (recovered) { result.candidates.push(recovered); if (!options?.dryRun) result.recovered++; continue; }
      result.deferred++;
    } catch { result.deferred++; }
    // Invalid authority, incompatible parsers and damaged archives must not
    // monopolize every bounded scan. This only postpones inspection; it never
    // renews an approval or changes the task, raw page or cursor identity.
    if (!options?.dryRun) {
      try {
        await prisma.amazonSyncRun.updateMany({ where: { id: candidate.id, organizationId: candidate.organizationId, workspaceId: candidate.workspaceId,
          dispatchVersion: candidate.dispatchVersion, fenceVersion: candidate.fenceVersion, status: "FAILED", control: null,
          leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: { lte: now } },
          data: { nextAttemptAt: new Date(now.getTime() + 15 * 60_000) } });
      } catch { /* The durable failure remains available after DB recovery. */ }
    }
  }
  return result;
}
