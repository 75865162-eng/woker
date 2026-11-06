import type { Prisma } from "@prisma/client";
import { digest } from "./approval-policy";
import { decryptCheckpoint } from "./checkpoint";
import { activeTaskStatuses, optionalAmazonSellerId, officialEndpoint, SyncInputError, type SyncScope } from "./policy";
import { previewFinanceRetentionRecovery } from "./finance";

/** Read-only takeover planning. Caller supplies a READ ONLY / REPEATABLE READ
 * transaction. A candidate ID is an input, never persisted proof of identity.
 * No approval, API request, task control, or ownership backfill is performed. */
export async function preflightIdentityRecovery(tx: Prisma.TransactionClient, scope: SyncScope, authorizationId: string, candidateSellerId: string, now = new Date()) {
  const sellerId = optionalAmazonSellerId(candidateSellerId);
  if (!sellerId) throw new SyncInputError("须提供已通过 API 核验的候选 Seller ID。");
  const auth = await tx.amazonSpApiAuthorization.findFirstOrThrow({ where: { ...scope, id: authorizationId }, select: { id: true, revision: true, amazonSellerId: true, awsRegion: true, endpoint: true, identityVerifiedAt: true, status: true, updatedAt: true } });
  officialEndpoint(auth.awsRegion, auth.endpoint);
  const blockers = new Set<string>();
  if (auth.amazonSellerId && auth.amazonSellerId !== sellerId) blockers.add("EXISTING_SELLER_ID_CONFLICT");
  if (auth.status !== "CONFIGURED") blockers.add("AUTHORIZATION_NOT_CONFIGURED");
  const sources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId }, select: { id: true, revision: true, sellerAccountId: true, marketplaceId: true, resource: true }, orderBy: { id: "asc" }, take: 101 });
  if (sources.length > 100) throw new SyncInputError("身份预审超过 100 个来源上限，须缩小范围。", 409);
  const sourceIds = sources.map(source => source.id);
  const runs = await tx.amazonSyncRun.findMany({ where: { ...scope, sourceId: { in: sourceIds } }, select: { id: true, sourceId: true, resource: true, executionVersion: true, status: true, authorizationRevision: true, frozenScope: true, frozenScopeDigest: true, dispatchVersion: true, fenceVersion: true, leaseExpiresAt: true, pagesCompleted: true, processedCount: true, insertedCount: true, skippedCount: true, checkpointCiphertext: true }, orderBy: { id: "asc" }, take: 10001 });
  if (runs.length > 10000) throw new SyncInputError("身份预审超过 10000 个任务上限，禁止使用截断结果接管。", 409);
  const plans = await tx.amazonSyncSchedule.findMany({ where: { ...scope, targets: { some: { sourceId: { in: sourceIds } } } }, select: { id: true, revision: true, enabled: true, targets: { select: { sourceId: true } } }, orderBy: { id: "asc" }, take: 101 });
  if (plans.length > 100) throw new SyncInputError("身份预审计划数量超过上限。", 409);
  const cursors = await tx.amazonSyncResourceCursor.findMany({ where: { ...scope, sourceId: { in: sourceIds } }, orderBy: { sourceId: "asc" } });
  const bindings = await tx.amazonSellerIdentity.findMany({ where: { ...scope, OR: [{ authorizationId }, { amazonSellerId: sellerId, region: auth.awsRegion }, { sellerAccountId: { in: sources.map(s => s.sellerAccountId) }, marketplaceId: { in: sources.map(s => s.marketplaceId) } }] }, select: { authorizationId: true, sellerAccountId: true, amazonSellerId: true, marketplaceId: true, region: true } });
  for (const binding of bindings) if (binding.authorizationId !== auth.id || binding.amazonSellerId !== sellerId || binding.region !== auth.awsRegion || !sources.some(s => s.sellerAccountId === binding.sellerAccountId && s.marketplaceId === binding.marketplaceId)) blockers.add("IDENTITY_BINDING_CONFLICT");
  if (await tx.amazonSpApiAuthorization.count({ where: { ...scope, id: { not: auth.id }, amazonSellerId: sellerId, awsRegion: auth.awsRegion } })) blockers.add("SELLER_AUTHORIZATION_CONFLICT");
  if (await tx.amazonSyncDataSource.count({ where: { ...scope, authorizationId: { not: auth.id }, OR: sources.map(s => ({ sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId })) } })) blockers.add("CROSS_AUTHORIZATION_SOURCE_BINDING");
  for (const source of sources) if (new Set(sources.filter(s => s.marketplaceId === source.marketplaceId).map(s => s.sellerAccountId)).size > 1) blockers.add("MULTIPLE_SELLERS_PER_MARKETPLACE");
  for (const run of runs) {
    const frozen = run.frozenScope as Record<string, unknown> | null;
    const source = sources.find(s => s.id === run.sourceId);
    if (run.executionVersion !== 2 || !frozen || digest(frozen) !== run.frozenScopeDigest || frozen.authorizationId !== auth.id || frozen.sourceId !== source?.id || frozen.sellerAccountId !== source?.sellerAccountId || frozen.marketplaceId !== source?.marketplaceId || frozen.resource !== source?.resource || frozen.authorizationRevision !== run.authorizationRevision || frozen.amazonSellerId !== auth.amazonSellerId) blockers.add("HISTORICAL_RUN_SCOPE_REQUIRES_REVIEW");
    if (run.authorizationRevision !== auth.revision) blockers.add("HISTORICAL_CREDENTIAL_REVISION_REQUIRES_REVIEW");
    if (run.status === "RUNNING" || (run.leaseExpiresAt && run.leaseExpiresAt > now)) blockers.add("RUNNING_LEASE_MUST_DRAIN");
  }
  for (const cursor of cursors) {
    if (cursor.amazonSellerId !== auth.amazonSellerId || !sources.some(s => s.id === cursor.sourceId && s.resource === cursor.resource && s.marketplaceId === cursor.marketplaceId)) blockers.add("CURSOR_SCOPE_CONFLICT");
    let reconciled = false;
    if (cursor.status === "FAILED" && !cursor.nextTokenCiphertext && cursor.reportStateCiphertext && ["reimbursements", "inventory_age"].includes(cursor.resource)) {
      const state = JSON.parse(decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id) ?? "{}");
      if (typeof state.recoveryApprovalId === "string" && state.polls === 0 && Object.keys(state).length === 2) {
        const audit = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, entityId: cursor.sourceId, action: "amazon.sync.report.recovered", metadata: { path: ["approvalId"], equals: state.recoveryApprovalId } } });
        const proof = audit?.metadata as Record<string, unknown> | undefined;
        const original = proof?.originalCursor as Record<string, unknown> | undefined;
        const oldRun = runs.find(r => r.id === cursor.activeRunId);
        const grant = await tx.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id: state.recoveryApprovalId, operation: "recover-report", targetId: cursor.sourceId, status: "APPLIED" } });
        reconciled = !!grant && proof?.workspaceId === scope.workspaceId && original?.id === cursor.id && original?.activeRunId === cursor.activeRunId && proof?.originalRunId === oldRun?.id && oldRun?.status === "FAILED" && oldRun.pagesCompleted === 0 && proof?.originalCheckpointDigest === digest(oldRun.checkpointCiphertext) && proof?.replacementStateDigest === digest(cursor.reportStateCiphertext) && proof?.remoteTerminalStatus === (cursor.resource === "reimbursements" ? "FATAL" : "CANCELLED");
      }
    }
    if (!reconciled && ["FAILED", "BLOCKED"].includes(cursor.status) && cursor.resource === "inventory_events" && !cursor.nextTokenCiphertext && cursor.reportStateCiphertext) {
      const state = JSON.parse(decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id) ?? "{}");
      const run = runs.find(item => item.id === cursor.activeRunId);
      if (typeof state.reportId === "string" && typeof state.documentId === "string" && run && run.status === cursor.status && run.checkpointCiphertext === cursor.reportStateCiphertext) {
        const audit = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, entityId: cursor.sourceId, action: "amazon.sync.report.reconciled", metadata: { path: ["cursorDigest"], equals: digest(cursor.reportStateCiphertext) } } });
        const proof = audit?.metadata as Record<string, unknown> | undefined;
        const grant = await tx.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id: String(proof?.approvalId ?? ""), operation: "recover-report", targetId: cursor.sourceId, status: "APPLIED" } });
        const progress = proof?.partialProgress as Record<string, unknown> | null;
        const progressAligned = progress ? progress.pagesCompleted === run.pagesCompleted && progress.offset === state.offset : run.pagesCompleted === 0 && !state.archiveTaskId && !state.offset;
        reconciled = !!grant && proof?.workspaceId === scope.workspaceId && proof?.resource === "inventory_events" && proof?.marketplaceId === cursor.marketplaceId && proof?.runId === run.id && proof?.cursorId === cursor.id && proof?.cursorDigest === digest(cursor.reportStateCiphertext) && proof?.checkpointDigest === digest(run.checkpointCiphertext) && proof?.reportIdDigest === digest(state.reportId) && proof?.documentIdDigest === digest(state.documentId) && proof?.reportType === "GET_LEDGER_DETAIL_VIEW_DATA" && proof?.remoteTerminalStatus === "DONE" && proof?.cursorPreserved === true && proof?.taskPreserved === true && progressAligned;
      }
    }
    if (!reconciled && cursor.status !== "SUCCEEDED" && (cursor.nextTokenCiphertext || cursor.reportStateCiphertext || runs.some(run => run.id === cursor.activeRunId && (run.pagesCompleted > 0 || run.checkpointCiphertext)))) blockers.add("UNFINISHED_CURSOR_PROGRESS_REQUIRES_RECONCILIATION");
  }
  if (plans.some(plan => plan.targets.some(t => !sourceIds.includes(t.sourceId)))) blockers.add("PLAN_CONTAINS_OTHER_AUTHORIZATION");
  const activeRuns = runs.filter(run => activeTaskStatuses.includes(run.status));
  if (activeRuns.length) blockers.add("ACTIVE_TASKS_REQUIRE_AUDITED_FENCE_AND_RESUME");
  // Current API identity alone cannot retroactively certify old rows.
  if (runs.length && !auth.identityVerifiedAt) blockers.add("HISTORICAL_FACT_ATTRIBUTION_NOT_ATTESTED");
  const finance = [];
  for (const cursor of cursors.filter(c => c.resource === "finance" && c.status !== "SUCCEEDED")) {
    const runIds = runs.filter(r => r.sourceId === cursor.sourceId).map(r => r.id);
    const [pages, rawPages, records] = await Promise.all([tx.amazonSyncPage.count({ where: { ...scope, taskId: { in: runIds } } }), tx.amazonSyncRawPage.count({ where: { ...scope, taskId: { in: runIds } } }), tx.amazonFinanceRecord.count({ where: { ...scope, sourceId: cursor.sourceId } })]);
    const proposal = previewFinanceRetentionRecovery({ from: cursor.watermarkFrom.toISOString(), to: cursor.watermarkTo.toISOString() }, now, { hasNextToken: !!cursor.nextTokenCiphertext, pages: Math.max(pages, rawPages, ...runs.filter(r => r.sourceId === cursor.sourceId).map(r => r.pagesCompleted)), records, hasCheckpoint: !!cursor.reportStateCiphertext || runs.some(r => r.sourceId === cursor.sourceId && !!r.checkpointCiphertext) });
    finance.push({ sourceId: cursor.sourceId, cursorId: cursor.id, ...proposal });
  }
  const manifest = { scope, authorization: auth, candidateSellerId: sellerId, sources, plans, tasks: runs.map(run => ({ id: run.id, sourceId: run.sourceId, resource: run.resource, status: run.status, authorizationRevision: run.authorizationRevision, frozenScopeDigest: run.frozenScopeDigest, dispatchVersion: run.dispatchVersion, fenceVersion: run.fenceVersion, leaseExpiresAt: run.leaseExpiresAt, pagesCompleted: run.pagesCompleted, hasCheckpoint: !!run.checkpointCiphertext, checkpointDigest: digest(run.checkpointCiphertext) })), cursors: cursors.map(({ nextTokenCiphertext, reportStateCiphertext, ...cursor }) => ({ ...cursor, hasNextToken: !!nextTokenCiphertext, hasReportState: !!reportStateCiphertext, progressDigest: digest([nextTokenCiphertext, reportStateCiphertext]) })), finance };
  // Canonical digest operates on JSON values: serialize Date objects first.
  return { mode: "READ_ONLY", capturedAt: now.toISOString(), readyToApply: false, approvalRequired: true, blockers: [...blockers].sort(), manifestDigest: digest(JSON.parse(JSON.stringify(manifest))), manifest, allowedNextStep: "REVIEW_MANIFEST_BEFORE_SEPARATE_APPROVAL", prohibitedChanges: ["REWRITE_FROZEN_TASKS", "INFER_HISTORICAL_OWNERSHIP", "ERASE_CHECKPOINTS", "ATTEST_BUSINESS_ROLES"] };
}
