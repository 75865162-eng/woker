import type { Prisma } from "@prisma/client";
import { approvedContext } from "./approved-context";
import { digest, unseal, targetEnvironment } from "./approval-policy";
import { parseObservationPolicy } from "./observation-policy";
import { advanceObservation, initialObservationState, observationOperation } from "./observation-machine";
import type { SafeFact } from "./observation-parsers";
import { SyncInputError, type SyncScope } from "./policy";

function businessFacts(value: unknown) {
  const { sourceRawPage: _page, sourceRowNumber: _row, ...facts } = value as Record<string, unknown>;
  void _page; void _row;
  return digest(facts);
}

/** Rebuild only staged item identities. Original business fields must match an
 * authenticated occurrence exactly; no existing row is deleted or replaced. */
export async function previewInboundItemRecovery(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string, taskId: string) {
  const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId, resource: "fulfillment" }, include: { authorization: true } });
  const run = await tx.amazonSyncRun.findFirstOrThrow({ where: { ...scope, id: taskId, sourceId, resource: "fulfillment", executionVersion: 2 } });
  const frozen = run.frozenScope as Prisma.JsonObject | null;
  if (run.status !== "PAUSED" || run.leaseOwner || run.leaseExpiresAt || source.activeRunId === taskId || run.pagesCompleted > 1000
    || frozen?.sourceRevision !== source.revision || frozen.authorizationId !== source.authorizationId
    || frozen.authorizationRevision !== source.authorization.revision || frozen.amazonSellerId !== source.authorization.amazonSellerId
    || frozen.marketplaceId !== source.marketplaceId || frozen.sellerAccountId !== source.sellerAccountId
    || digest(frozen.domainPolicy) !== digest(source.domainPolicy)) throw new SyncInputError("FBA 原件补齐须暂停未发布原任务，并保持原授权与来源版本。", 409);
  const policy = parseObservationPolicy(frozen.domainPolicy, "fulfillment");
  const archives = await tx.amazonSyncRawPage.findMany({ where: { ...scope, taskId, resource: "fulfillment", page: { lte: run.pagesCompleted } }, orderBy: { page: "asc" } });
  if (archives.length !== run.pagesCompleted || !archives.length) throw new SyncInputError("FBA 已提交原件页不完整。", 409);
  let state = initialObservationState(policy), received = 0, bytes = 0;
  const expected = new Map<string, SafeFact>();
  for (const raw of archives) {
    const metadata = raw.requestMetadata as { operation?: string };
    if (raw.page !== state.requests + 1 || metadata.operation !== observationOperation(state, "fulfillment")) throw new SyncInputError("FBA 原件操作序列不一致。", 409);
    const text = unseal(raw.rawCiphertext, scope, `${taskId}:${raw.page}`, "amazon-observation-raw.v1").rawBody;
    if (typeof text !== "string" || digest(text) !== raw.bodySha256 || (bytes += Buffer.byteLength(text)) > 64 * 1024 * 1024) throw new SyncInputError("FBA 原件摘要或补齐容量不符合要求。", 409);
    state.requests = raw.page;
    const next = advanceObservation(policy, state, JSON.parse(text), { rawBody: text, marketplaceId: source.marketplaceId, sellerId: source.authorization.amazonSellerId });
    for (const fact of next.rows) {
      const key = digest([fact.kind, fact.businessKey]);
      if (expected.has(key) && digest(expected.get(key)!.facts) !== digest(fact.facts)) throw new SyncInputError("FBA 原件出现冲突业务键。", 409);
      expected.set(key, fact);
    }
    received += next.rows.length; state = next.state;
  }
  if (received > policy.maxRows) throw new SyncInputError("FBA 补齐超出原审批行数预算。", 409);
  const stored = await tx.amazonDomainObservation.findMany({ where: { ...scope, sourceId, sourceRunId: taskId }, orderBy: { id: "asc" } });
  const remaining = new Map(expected), updates = [];
  // Match current identities first, so legacy rows cannot consume their slots.
  const legacy = [];
  for (const row of stored) {
    const key = digest([row.kind, row.businessKey]), fact = remaining.get(key);
    if (fact) {
      if (digest(row.facts) !== digest(fact.facts)) throw new SyncInputError("FBA 已保存事实与原件不一致。", 409);
      remaining.delete(key);
    } else legacy.push(row);
  }
  for (const row of legacy) {
    const facts = row.facts as Record<string, unknown>;
    if (!["INBOUND_PLAN_ITEM", "INBOUND_SHIPMENT_ITEM"].includes(row.kind) || facts.sourceRawPage !== undefined || facts.sourceRowNumber !== undefined) throw new SyncInputError("FBA 存在不能补齐的历史事实。", 409);
    const match = [...remaining].find(([, fact]) => fact.kind === row.kind && businessFacts(fact.facts) === businessFacts(row.facts));
    if (!match) throw new SyncInputError("FBA 旧记录没有完全相符的原件行，拒绝覆盖。", 409);
    updates.push({ id: row.id, beforeHash: digest(row.facts), fact: match[1] }); remaining.delete(match[0]);
  }
  const additions = [...remaining.values()];
  if (additions.some(fact => !["INBOUND_PLAN_ITEM", "INBOUND_SHIPMENT_ITEM"].includes(fact.kind))) throw new SyncInputError("FBA 补齐仅限商品行，其他事实缺口须单独核对。", 409);
  const manifest = { sourceId, taskId, sourceRevision: source.revision, authorizationRevision: source.authorization.revision,
    checkpointDigest: digest(run.checkpointCiphertext), mode: "FBA_STAGED_ITEM_OCCURRENCES_V1", pages: archives.map(r => ({ page: r.page, sha256: r.bodySha256 })),
    storedDigest: digest(stored.map(r => [r.id, r.businessKey, r.facts])), expectedDigest: digest([...expected]), received, uniqueRows: expected.size,
    before: { processed: run.processedCount, inserted: run.insertedCount, skipped: run.skippedCount }, preservedRows: stored.length,
    rowsAddingProvenance: updates.length, rowsToInsert: additions.length, businessFieldsOverwritten: false, amazonRequests: 0, published: false };
  return { source, run, updates, additions, manifest, recoveryDigest: digest(manifest) };
}

export async function applyInboundItemRecovery(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  if (targetEnvironment() !== "local" || url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/amazon_sync_live_local") throw new SyncInputError("本次 FBA 补齐仅限已批准本地数据环境。", 403);
  const { tx, approvalId } = approvedContext(scope, "recover-report");
  const p = await previewInboundItemRecovery(tx, scope, String(command.id), String(command.taskId));
  if (p.recoveryDigest !== command.recoveryDigest || p.source.revision !== command.revision) throw new SyncInputError("FBA 补齐清单已变化。", 409);
  for (const row of p.updates) await tx.amazonDomainObservation.update({ where: { id: row.id }, data: { businessKey: row.fact.businessKey, facts: row.fact.facts as Prisma.InputJsonValue } });
  if (p.additions.length) await tx.amazonDomainObservation.createMany({ data: p.additions.map(fact => ({ ...scope, id: digest([p.run.id, fact.kind, fact.businessKey]), sourceId: p.source.id, sourceRunId: p.run.id, ...fact, facts: fact.facts as Prisma.InputJsonValue, capturedAt: new Date() })) });
  const count = await tx.amazonDomainObservation.count({ where: { ...scope, sourceId: p.source.id, sourceRunId: p.run.id } });
  if (count !== p.manifest.uniqueRows) throw new SyncInputError("FBA 补齐入库数量不一致。", 409);
  await tx.amazonSyncRun.update({ where: { id: p.run.id }, data: { processedCount: p.manifest.received, insertedCount: count, skippedCount: p.manifest.received - count } });
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.inbound.items-recovered", entityType: "AmazonSyncRun", entityId: p.run.id, metadata: { workspaceId: scope.workspaceId, approvalId, manifest: p.manifest, originalRowsPreserved: true, checkpointPreserved: true } } });
  return { id: p.source.id, inserted: p.additions.length, provenanceAdded: p.updates.length, published: false };
}
