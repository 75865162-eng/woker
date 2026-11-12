import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncScope } from '@/lib/amazon-sync/policy';
import { SyncInputError } from '@/lib/amazon-sync/policy';
import { amazonDataAccess, assertAmazonAction } from '@/lib/amazon-sync/data-access';
import { amazonAdsAccountReadAccess } from './read-access';
import { adsEntityBusinessFields } from './business-fields';
import { adsBusinessFingerprint, adsBusinessPatchFields, assertAdsDraftTransition, parseAdsBusinessPatch } from './change-contract';
import { AdsQueryError } from './query-contract';

function required(value: unknown, max = 200) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AdsQueryError('广告变更参数无效。'); return value.trim(); }
async function access(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, profileId: string, write = false) {
  await amazonAdsAccountReadAccess(scope, actor, { profileRecordId: profileId }, tx);
  if (write) {
    await assertAmazonAction(scope, actor, 'edit', tx, 'settings');
    const permission = await amazonDataAccess(scope, actor, tx, 'edit');
    const profile = await tx.amazonAdsProfile.findFirst({ where: { ...scope, id: profileId }, select: { sellerAccountId: true, marketplaceId: true } });
    if (!profile?.sellerAccountId || !permission.allSellers && !permission.sellerIds.includes(profile.sellerAccountId) || permission.scopes && !permission.scopes.some(row => row.sellerAccountId === profile.sellerAccountId && (!row.marketplaceIds.length || !!profile.marketplaceId && row.marketplaceIds.includes(profile.marketplaceId)))) throw new AdsQueryError('广告变更范围未授权。', 403);
  }
}
const json = (value: unknown) => value as Prisma.InputJsonValue;
export async function queryAdsBusinessChanges(scope: SyncScope, actor: string, params: URLSearchParams) {
  const profileId = required(params.get('profileRecordId'));
  const externalId = params.get('externalId') || undefined, entityType = params.get('entityType') || undefined;
  const raw = params.get('page') ?? '1', page = Number(raw);
  if (!/^\d+$/.test(raw) || page < 1 || page > 10000) throw new AdsQueryError('页码无效。');
  const snapshot = await prisma.$transaction(async tx => {
    await access(tx, scope, actor, profileId);
    const binding = await tx.amazonAdsProfile.findFirstOrThrow({ where: { ...scope, id: profileId }, select: { sellerAccountId: true, marketplaceId: true, authorizationId: true, authorization: { select: { revision: true } } } });
    const where = { ...scope, profileId, ...(externalId ? { externalId: required(externalId) } : {}), ...(entityType ? { entityType: required(entityType) } : {}) };
    const [drafts, history] = await Promise.all([
      tx.amazonAdsChangeDraft.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 50, take: 51 }),
      tx.amazonAdsEntityHistory.findMany({ where: { ...where, sourceTask: { status: 'SUCCEEDED' } }, orderBy: [{ observedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 50, take: 51 }),
    ]);
    let canManage = false;
    try { await access(tx, scope, actor, profileId, true); canManage = true; }
    catch (error) { if (!(error instanceof SyncInputError) && !(error instanceof AdsQueryError) && !(error instanceof Error && 'status' in error && error.status === 403)) throw error; }
    return { binding, data: { drafts: drafts.slice(0, 50).map(draft => ({ ...draft, availableActions: canManage ? ['submit', 'approve', 'reject', 'cancel'].filter(action => { try { assertAdsDraftTransition(draft.status, action, actor, draft.createdBy); return action === 'cancel' || draft.expiresAt > new Date(); } catch { return false; } }) : [] })), history: history.slice(0, 50), page, hasMore: drafts.length > 50 || history.length > 50, editableFields: canManage && entityType ? adsBusinessPatchFields(entityType) : [], historyCoverage: 'OBSERVED_SNAPSHOT_CHANGES', historyRecordingEnabled: process.env.AMAZON_ADS_ENTITY_HISTORY_ENABLED === '1', execution: { enabled: false, blocker: 'WRITE_OPERATION_CONTRACT_NOT_VERIFIED' } } };
  });
  // Withhold persisted evidence if assignment, identity or authorization changed during SQL.
  await prisma.$transaction(async tx => {
    await access(tx, scope, actor, profileId);
    const binding = await tx.amazonAdsProfile.findFirstOrThrow({ where: { ...scope, id: profileId }, select: { sellerAccountId: true, marketplaceId: true, authorizationId: true, authorization: { select: { revision: true } } } });
    if (adsBusinessFingerprint(binding) !== adsBusinessFingerprint(snapshot.binding)) throw new AdsQueryError('广告账号绑定已变化，请刷新。', 403);
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: 'amazon.ads.changes.read', entityType: 'AmazonAdsProfile', entityId: profileId, metadata: { workspaceId: scope.workspaceId, page } } });
  });
  return snapshot.data;
}
export async function mutateAdsBusinessChange(scope: SyncScope, actor: string, body: Record<string, unknown>) {
  const action = required(body.action), profileId = required(body.profileRecordId);
  const allowed = action === 'create' ? ['action', 'profileRecordId', 'entityType', 'externalId', 'patch', 'reason', 'requestKey'] : ['action', 'profileRecordId', 'id', 'revision', 'reason'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new AdsQueryError('广告变更包含未定义字段。');
  return prisma.$transaction(async tx => {
    await access(tx, scope, actor, profileId, true);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-sync:${profileId}`},0))`;
    await access(tx, scope, actor, profileId, true);
    let draft;
    if (action === 'create') {
      const entityType = required(body.entityType), externalId = required(body.externalId), reason = required(body.reason, 2000), requestKey = required(body.requestKey);
      const patch = parseAdsBusinessPatch(entityType, body.patch);
      const existing = await tx.amazonAdsChangeDraft.findFirst({ where: { ...scope, profileId, createdBy: actor, requestKey } });
      if (existing) {
        if (existing.entityType !== entityType || existing.externalId !== externalId || existing.reason !== reason || adsBusinessFingerprint(existing.patch) !== adsBusinessFingerprint(patch)) throw new AdsQueryError('相同申请键的内容已变化。', 409);
        return { draft: existing, reused: true, executionEnabled: false };
      }
      const entity = await tx.amazonAdsEntityRecord.findFirst({ where: { ...scope, profileId, entityType, externalId, sourceTask: { status: 'SUCCEEDED' } } });
      if (!entity) throw new AdsQueryError('缺少已完成采集的原广告实体。', 409);
      const before = { state: entity.state, ...adsEntityBusinessFields(entity) }, snapshotHash = adsBusinessFingerprint(before);
      draft = await tx.amazonAdsChangeDraft.create({ data: { ...scope, id: randomUUID(), profileId, entityType, externalId, requestKey, before: json(before), patch: json(patch), snapshotHash, reason, createdBy: actor, expiresAt: new Date(Date.now() + 86400_000) } });
    } else {
      if (!['submit', 'approve', 'reject', 'cancel'].includes(action)) throw new AdsQueryError('广告真实执行尚缺已核实的写接口契约，不能将草稿当作已执行。', 409);
      const id = required(body.id);
      if (!Number.isInteger(body.revision)) throw new AdsQueryError('缺少广告草稿版本。', 409);
      const current = await tx.amazonAdsChangeDraft.findFirst({ where: { ...scope, profileId, id } });
      if (!current || current.revision !== body.revision) throw new AdsQueryError('广告草稿不存在或版本已变化。', 409);
      const status = assertAdsDraftTransition(current.status, action, actor, current.createdBy);
      if (action !== 'cancel') {
        if (current.expiresAt <= new Date()) throw new AdsQueryError('广告草稿已过期。', 409);
        await access(tx, scope, current.createdBy, profileId, true);
        const entity = await tx.amazonAdsEntityRecord.findFirst({ where: { ...scope, profileId, entityType: current.entityType, externalId: current.externalId, sourceTask: { status: 'SUCCEEDED' } } });
        if (!entity || adsBusinessFingerprint({ state: entity.state, ...adsEntityBusinessFields(entity) }) !== current.snapshotHash) throw new AdsQueryError('广告原实体已变化，请重新建立草稿。', 409);
      }
      const reason = action === 'reject' ? required(body.reason, 2000) : typeof body.reason === 'string' ? body.reason.slice(0, 2000) : null;
      draft = await tx.amazonAdsChangeDraft.update({ where: { id }, data: { status, revision: { increment: 1 }, ...(['approve', 'reject'].includes(action) ? { reviewedBy: actor } : {}), decisionReason: reason } });
    }
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: `amazon.ads.change.${action}`, entityType: 'AmazonAdsChangeDraft', entityId: draft.id, metadata: { workspaceId: scope.workspaceId, profileId, revision: draft.revision, executionEnabled: false } } });
    return { draft, reused: false, executionEnabled: false };
  });
}
