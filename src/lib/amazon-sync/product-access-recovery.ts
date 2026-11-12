import type { Prisma } from "@prisma/client";
import { AmazonSpApiClient, AmazonSpApiError, type AmazonRequestEvent } from "@/lib/amazon/sp-api-client";
import { decryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { approvedContext } from "./approved-context";
import { digest, seal, targetEnvironment } from "./approval-policy";
import { parseObservationPolicy } from "./observation-policy";
import { productAccessEvidence } from "./product-access-evidence";
import { parseProductDetail } from "./product-observations";
import { reserveOrderToken } from "./orders-rate-limit";
import { activeTaskStatuses, officialEndpoint, SyncInputError, type SyncScope } from "./policy";

/** One parsed catalog read renews capability evidence, never business scope. */
export async function previewProductAccessRecovery(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string, taskId: string) {
  const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId, resource: "catalog_items", enabled: true }, include: { authorization: true } });
  const run = await tx.amazonSyncRun.findFirstOrThrow({ where: { ...scope, id: taskId, sourceId, resource: "catalog_items", executionVersion: 2 } });
  const frozen = run.frozenScope as Prisma.JsonObject;
  if (!["FAILED", "BLOCKED", "PAUSED", "CANCELLED"].includes(run.status) || ["PURGED", "BINDING_DISABLED"].includes(run.stage) || run.leaseOwner || run.leaseExpiresAt || source.authorization.status !== "CONFIGURED"
    || frozen.sourceRevision !== source.revision || frozen.authorizationId !== source.authorizationId || frozen.authorizationRevision !== source.authorization.revision
    || frozen.sellerAccountId !== source.sellerAccountId || frozen.marketplaceId !== source.marketplaceId || frozen.amazonSellerId !== source.authorization.amazonSellerId
    || frozen.region !== source.authorization.awsRegion || frozen.endpoint !== source.authorization.endpoint || digest(frozen) !== run.frozenScopeDigest
    || digest(frozen.domainPolicy) !== digest(source.domainPolicy)) throw new SyncInputError("目录能力续验须停止原任务，并保持原范围、策略与授权版本。", 409);
  if (await tx.amazonSyncRun.count({ where: { ...scope, sourceId, id: { not: taskId }, status: { in: activeTaskStatuses } } })) throw new SyncInputError("目录来源存在其他活动任务。", 409);
  const policy = parseObservationPolicy(source.domainPolicy, "catalog_items");
  if (policy.resource !== "catalog_items") throw new SyncInputError("目录策略无效。");
  const row = await tx.amazonDomainObservation.findFirstOrThrow({ where: { ...scope, sourceId, sourceRunId: taskId, kind: "CATALOG_DETAIL", asin: { not: null } }, orderBy: { id: "asc" }, select: { id: true, asin: true } });
  const manifestIds = (frozen.productManifest as Prisma.JsonObject | undefined)?.ids;
  if (!row.asin || !(policy.asins.includes(row.asin) || Array.isArray(manifestIds) && manifestIds.includes(row.asin))) throw new SyncInputError("续验 ASIN 不属于原任务清单。", 409);
  const manifest = { sourceId, taskId, sourceRevision: source.revision, authorizationRevision: source.authorization.revision, policyDigest: digest(policy), frozenDigest: run.frozenScopeDigest,
    checkpointDigest: digest(run.checkpointCiphertext), pages: run.pagesCompleted, inserted: run.insertedCount, probeAsin: row.asin, probeRecordId: row.id, businessScopeChanged: false };
  return { source, run, frozen, policy, manifest, recoveryDigest: digest(manifest) };
}

export async function applyProductAccessRecovery(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  if (targetEnvironment() !== "local" || url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/amazon_sync_live_local" || scope.organizationId !== "amazon-live-local" || scope.workspaceId !== "default") throw new SyncInputError("仅限已批准本地续验环境。", 403);
  const { tx, approvalId } = approvedContext(scope, "recover-report");
  const p = await previewProductAccessRecovery(tx, scope, String(command.id), String(command.taskId));
  if (command.revision !== p.source.revision || command.recoveryDigest !== p.recoveryDigest) throw new SyncInputError("目录续验清单已变化。", 409);
  const auth = p.source.authorization, operation = "getCatalogItem", now = new Date(); officialEndpoint(auth.awsRegion, auth.endpoint);
  const key = { ...scope, authorizationId: auth.id, operation }, bucketKey = digest([`${operation}.2022-04-01`, auth.amazonSellerId, p.policy.applicationId]);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bucketKey}, 0))`;
  const budget = await tx.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: key } });
  if (budget && budget.nextRequestAt > now) throw new SyncInputError("目录接口仍在限流等待期，请稍后续验。", 409);
  const bucket = await tx.amazonSyncTokenBucket.findUnique({ where: { bucketKey } });
  const rate = Math.min(p.policy.requestsPerSecond, budget?.observedLimit ?? p.policy.requestsPerSecond);
  const reservation = reserveOrderToken(bucket, { requestsPerSecond: rate, burst: 1 }, now);
  if (!reservation.allowed) throw new SyncInputError("目录接口尚无可用限流令牌。", 409);
  await tx.amazonSyncTokenBucket.upsert({ where: { bucketKey }, create: { bucketKey, tokens: reservation.tokens, replenishedAt: reservation.replenishedAt }, update: { tokens: reservation.tokens, replenishedAt: reservation.replenishedAt } });
  const nextRequestAt = new Date(now.getTime() + Math.ceil(1000 / rate));
  await tx.amazonSyncApiBudget.upsert({ where: { organizationId_workspaceId_authorizationId_operation: key }, create: { ...key, nextRequestAt }, update: { nextRequestAt } });
  const events: AmazonRequestEvent[] = [];
  const client = new AmazonSpApiClient({ ...decryptAmazonSpApiCredentials(auth.credentialsCiphertext, { ...scope, authorizationId: auth.id }), region: auth.awsRegion, endpoint: auth.endpoint }, { requestTimeoutMs: 8000, onResponse: event => events.push(event) });
  let response: Awaited<ReturnType<AmazonSpApiClient["getCatalogDetail"]>>;
  try {
    response = await client.getCatalogDetail({ asin: p.manifest.probeAsin, marketplaceId: p.source.marketplaceId });
    if (Buffer.byteLength(response.rawBody) > 4 * 1024 * 1024) throw new SyncInputError("目录续验响应超过归档容量。", 413);
    parseProductDetail(response.rawBody, { ...p.policy, asins: [p.manifest.probeAsin] }, 0, p.source.marketplaceId);
    const received = events.findLast(item => item.operation === operation);
    if (received?.status !== 200 || !received.requestId) throw new SyncInputError("目录续验缺少成功请求记录。", 409);
  } catch (error) {
    // Commit the consumed slot and cooldown even when the read fails. A failed
    // probe must not roll back its limiter or renew capability evidence.
    const nextAt = new Date(Date.now() + Math.max(60_000, error instanceof AmazonSpApiError ? error.retryAfterMs : 0));
    await tx.amazonSyncTokenBucket.update({ where: { bucketKey }, data: { tokens: 0, blockedUntil: nextAt } });
    await tx.amazonSyncApiBudget.update({ where: { organizationId_workspaceId_authorizationId_operation: key }, data: { nextRequestAt: nextAt } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.catalog.capability-failed", entityType: "AmazonSyncRun", entityId: p.run.id,
      metadata: { workspaceId: scope.workspaceId, approvalId, operation, statusCode: error instanceof AmazonSpApiError ? error.status : null, retryAfter: nextAt.toISOString(), capabilityVerified: false, checkpointPreserved: true } } });
    return { id: p.source.id, taskId: p.run.id, capabilityVerified: false, taskStarted: false, published: false };
  }
  const event = events.findLast(item => item.operation === operation), checkedAt = new Date();
  const evidence = productAccessEvidence({ ...scope, authorizationId: auth.id, authorizationRevision: auth.revision, marketplaceId: p.source.marketplaceId, resource: "catalog_items" }, { status: event?.status ?? 0, requestId: event?.requestId ?? null, parsed: true }, checkedAt);
  const policy = { ...(p.source.domainPolicy as Prisma.JsonObject), accessEvidence: evidence }, frozen = { ...p.frozen, domainPolicy: policy };
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.catalog.capability-renewed", entityType: "AmazonSyncRun", entityId: p.run.id, metadata: {
    workspaceId: scope.workspaceId, approvalId, manifest: p.manifest, checkedAt: checkedAt.toISOString(), requestId: event!.requestId!, statusCode: 200, operation, apiVersion: "2022-04-01",
    rawSha256: digest(response.rawBody), rawCiphertext: seal({ rawBody: response.rawBody }, scope, approvalId, "amazon-catalog-capability-raw.v1"),
    originalFrozenDigest: p.run.frozenScopeDigest, renewedFrozenDigest: digest(frozen), sourceRevisionPreserved: true, checkpointPreserved: true, factsPreserved: true,
  } } });
  await tx.amazonSyncDataSource.update({ where: { id: p.source.id }, data: { domainPolicy: policy as Prisma.InputJsonValue } });
  await tx.amazonSyncRun.update({ where: { id: p.run.id }, data: { frozenScope: frozen, frozenScopeDigest: digest(frozen) } });
  return { id: p.source.id, taskId: p.run.id, capabilityVerified: true, taskStarted: false, published: false };
}
