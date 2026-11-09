import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { AmazonSpApiClient } from "@/lib/amazon/sp-api-client";
import { decryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { preflightIdentityRecovery } from "./identity-recovery";
import { digest, targetEnvironment, unseal } from "./approval-policy";
import { parseFinancePage } from "./finance";
import { assertAmazonScopeAdmin } from "./data-access";
import { assertChangePermission } from "./change-approval";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";
import { requiredText, SyncInputError, type SyncScope } from "./policy";
import { scopeLock } from "./service";

/** Separate apply step; never called by preflight or scheduler. Historical
 * facts, frozen scopes and checkpoint ciphertext are deliberately untouched. */
export async function performIdentityAdoption(scope: SyncScope, actor: string, approvalId: string, command: Record<string, unknown>) {
  const target = new URL(process.env.DATABASE_URL ?? "invalid:");
  if (targetEnvironment() !== "local" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.port !== "55439" || target.pathname !== "/amazon_sync_live_local" || scope.organizationId !== "amazon-live-local" || scope.workspaceId !== "default") throw new SyncInputError("身份接管仅允许已审阅的独立本机环境。", 403);
  const id = requiredText(command.id, "授权 ID"), sellerId = requiredText(command.amazonSellerId, "Seller ID"), reviewedAt = new Date(requiredText(command.reviewedAt, "预审时间"));
  const check = async (tx: Parameters<typeof preflightIdentityRecovery>[0]) => {
    await assertChangePermission(scope, actor, "adopt-identity", tx);
    const grant = await tx.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id: approvalId, operation: "adopt-identity", targetId: id, baseRevision: command.revision as number, status: "APPLYING", targetEnvironment: "local", expiresAt: { gt: new Date() } } });
    if (!grant?.approvedByUserId) throw new SyncInputError("身份接管执行审批无效。", 403);
    const envelope = await tx.amazonDataCenterSealedCommand.findFirst({ where: { ...scope, id: approvalId } });
    if (!envelope || digest(envelope.ciphertext) !== grant.payloadDigest || digest(unseal(envelope.ciphertext, scope, approvalId, "local")) !== digest(command)) throw new SyncInputError("身份接管载荷与批准内容不符。", 403);
    await assertChangePermission(scope, grant.approvedByUserId, "approve", tx);
    await assertAmazonScopeAdmin(scope, grant.approvedByUserId, tx);
    if (!Number.isFinite(reviewedAt.getTime()) || Date.now() - reviewedAt.getTime() > 3600000 || reviewedAt.getTime() > Date.now()) throw new SyncInputError("身份恢复预审已过期。", 409);
    const report = await preflightIdentityRecovery(tx, scope, id, sellerId, reviewedAt);
    if (report.manifestDigest !== command.manifestDigest || report.manifest.authorization.revision !== command.revision || report.manifest.plans.some(p => p.enabled) || report.blockers.some(b => b !== "HISTORICAL_FACT_ATTRIBUTION_NOT_ATTESTED")) throw new SyncInputError("身份恢复清单变化或存在阻断；原数据未修改。", 409);
    if (await tx.amazonSyncRun.count({ where: { ...scope, sourceId: { in: report.manifest.sources.map(s => s.id) }, OR: [{ status: "RUNNING" }, { leaseExpiresAt: { gt: new Date() } }] } })) throw new SyncInputError("在途租约尚未退出。", 409);
    return { report, grant };
  };
    const initial = await prisma.$transaction(async tx => { await scopeLock(tx, scope); return check(tx); }, { timeout: 20000 });
  const auth = await prisma.amazonSpApiAuthorization.findFirstOrThrow({ where: { ...scope, id, revision: command.revision as number, status: "CONFIGURED" } });
  const client = new AmazonSpApiClient({ ...decryptAmazonSpApiCredentials(auth.credentialsCiphertext, { ...scope, authorizationId: id }), region: auth.awsRegion, endpoint: auth.endpoint });
  const sites = extractMarketplaceParticipations(await client.getMarketplaceParticipations());
  const marketplaceIds = [...new Set(initial.report.manifest.sources.map(s => s.marketplaceId))].sort();
  const reviewedIdentityMarketplaces = new Set(["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2", "A1AM78C64UM0Y8", "A2Q3Y263D00KWC"]);
  if (!marketplaceIds.length || marketplaceIds.some(site => !reviewedIdentityMarketplaces.has(site))) throw new SyncInputError("身份接管超出已审阅四站范围。", 403);
  const requests: Array<{ operation: string; marketplaceId?: string; success: boolean }> = [];
  const probeEnd = new Date(Date.now() - 5 * 60000);
  const probeWindow = { from: new Date(probeEnd.getTime() - 30 * 86400000).toISOString(), to: probeEnd.toISOString() };
  const finance = parseFinancePage((await client.listTransactions({ postedAfter: probeWindow.from, postedBefore: probeWindow.to })).rawBody, probeWindow);
  if (!finance.transactions.length || finance.transactions.some(row => row.sellingPartnerId !== sellerId)) throw new SyncInputError("财务响应未提供一致的当前卖家身份，接管停止。", 409);
  requests.push({ operation: "listTransactions", success: true });
  for (const marketplaceId of marketplaceIds) {
    if (!sites.some(s => s.marketplaceId === marketplaceId)) throw new SyncInputError("身份核验站点与批准来源不符。", 409);
    const payload = await client.searchListingsItems({ sellerId, marketplaceId }) as { items?: unknown; numberOfResults?: unknown };
    if (!payload || !Array.isArray(payload.items) || typeof payload.numberOfResults !== "number" || !Number.isSafeInteger(payload.numberOfResults) || payload.numberOfResults < 0) throw new SyncInputError("卖家范围核验响应无效。", 409);
    requests.push({ operation: "searchListingsItems", marketplaceId, success: true });
  }
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope);
    const { report, grant } = await check(tx);
    const verifiedAt = new Date();
    const changed = await tx.amazonSpApiAuthorization.updateMany({ where: { ...scope, id, revision: command.revision as number, amazonSellerId: report.manifest.authorization.amazonSellerId, credentialsCiphertext: auth.credentialsCiphertext }, data: { amazonSellerId: sellerId, identityVerifiedAt: verifiedAt, identityEvidence: "API_SCOPE_PROBE_CURRENT_IDENTITY_ONLY", revision: { increment: 1 }, updatedByUserId: actor } });
    if (changed.count !== 1) throw new SyncInputError("授权已变化，接管未应用。", 409);
    for (const source of report.manifest.sources) await tx.amazonSellerIdentity.upsert({ where: { organizationId_workspaceId_sellerAccountId_marketplaceId: { ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId } }, create: { ...scope, id: randomUUID(), sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, amazonSellerId: sellerId, region: auth.awsRegion, authorizationId: id, verifiedAt }, update: { verifiedAt } });
    // Cursors retain IDs, watermarks, active tasks and encrypted progress. Old
    // tasks remain terminal/frozen; replacement tasks need their own approval.
    await tx.amazonSyncResourceCursor.updateMany({ where: { ...scope, sourceId: { in: report.manifest.sources.map(s => s.id) }, amazonSellerId: auth.amazonSellerId }, data: { amazonSellerId: sellerId } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.identity.adopted", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, approvalId, manifestDigest: report.manifestDigest, marketplaceIds, requests, historicalFactsRemainUnverified: true, frozenTasksUnchanged: true, checkpointCiphertextUnchanged: true } } });
    await tx.amazonDataCenterConfigVersion.create({ data: { ...scope, id: randomUUID(), targetEnvironment: "local", entityType: "CredentialChange", entityId: id, revision: auth.revision + 1, summary: { action: "adopt-identity", historicalFactsRemainUnverified: true, marketplaceIds }, approvalId, changeDigest: grant.changeDigest } });
    await tx.amazonDataCenterSealedCommand.delete({ where: { organizationId_workspaceId_id: { ...scope, id: approvalId } } });
    await tx.amazonDataCenterChangeRequest.update({ where: { id: approvalId }, data: { status: "APPLIED", appliedAt: verifiedAt } });
    await tx.amazonDataCenterChangeRequest.updateMany({ where: { ...scope, id: { not: approvalId }, targetId: id, status: { in: ["REQUESTED", "APPROVED"] } }, data: { status: "STALE" } });
    return { applied: true, changeRequestId: approvalId, authorizationId: id, historicalFactsRemainUnverified: true, plansRemainPaused: true };
  });
}
