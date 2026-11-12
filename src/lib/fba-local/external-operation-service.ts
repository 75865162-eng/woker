import { createHash } from 'node:crypto';
import type { FbaLocalPlan } from '@prisma/client';
import { scoped, authorizeWms } from '@/lib/wms/access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import type { Tx } from '@/lib/wms/repository';
import { inboundWriteReadiness } from './external-operation-contract';
import { parseExternalOperationRecord, parseExternalResolution } from './external-operation-rules';

/** Plan row is already locked by the domain service; evidence and revision commit atomically. */
export async function writeExternalOperationRecord(tx: Tx, scope: WmsScope, plan: FbaLocalPlan, action: string, raw: unknown, expectedRevision: number) {
  let recordId: string;
  if (action === 'REGISTER_EXTERNAL_UNCERTAINTY') {
    const input = parseExternalOperationRecord(raw), requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const prior = await tx.fbaExternalOperationRecord.findFirst({ where: { ...scoped(scope), planId: plan.id, idempotencyKey: input.idempotencyKey } });
    if (prior) {
      if (prior.createdBy !== scope.actorUserId || prior.requestHash !== requestHash) throw new WmsError('外部操作登记幂等键冲突。', 409);
      return { recordId: prior.id, revision: plan.revision, reused: true, remoteExecutionEnabled: false };
    }
    if (plan.status === 'CANCELLED' || plan.revision !== expectedRevision) throw new WmsError('计划已取消或版本已变化。', 409);
    if (await tx.fbaExternalOperationRecord.count({ where: { ...scoped(scope), planId: plan.id, step: input.step, status: 'RESULT_UNKNOWN' } })) throw new WmsError('此步骤已有未知结果，须核实原操作，不能登记重发。', 409);
    if (await tx.fbaExternalOperationRecord.count({ where: { ...scoped(scope), planId: plan.id } }) >= 100) throw new WmsError('每计划最多 100 条外部操作登记。', 422);
    const record = await tx.fbaExternalOperationRecord.create({ data: { id: crypto.randomUUID(), ...scoped(scope), ...input, planId: plan.id, planRevision: plan.revision, apiVersion: inboundWriteReadiness.apiVersion, requestHash, createdBy: scope.actorUserId } });
    recordId = record.id;
  } else {
    await authorizeWms(tx, scope, 'approve');
    const input = parseExternalResolution(raw);
    const prior = await tx.fbaExternalOperationRecord.findFirst({ where: { ...scoped(scope), planId: plan.id, id: input.recordId } });
    if (!prior) throw new WmsError('外部操作登记不存在。', 404);
    if (prior.createdBy === scope.actorUserId) throw new WmsError('原操作登记人不能自行核实结果。', 403);
    const status = `REVIEWED_${input.result}`;
    if (prior.status !== 'RESULT_UNKNOWN') {
      if (prior.reviewedBy !== scope.actorUserId || prior.status !== status || prior.resolutionEvidence !== input.evidence || prior.operationId !== (input.operationId ?? prior.operationId) || prior.entityId !== (input.entityId ?? prior.entityId)) throw new WmsError('已核实结果不可覆盖。', 409);
      return { recordId: prior.id, revision: plan.revision, reused: true, remoteExecutionEnabled: false };
    }
    if (plan.revision !== expectedRevision) throw new WmsError('计划版本已变化。', 409);
    if ((prior.operationId && input.operationId && prior.operationId !== input.operationId) || (prior.entityId && input.entityId && prior.entityId !== input.entityId)) throw new WmsError('核实结果不能替换原外部标识。', 409);
    recordId = prior.id;
    await tx.fbaExternalOperationRecord.update({ where: { id: prior.id }, data: { status, operationId: input.operationId ?? prior.operationId, entityId: input.entityId ?? prior.entityId, resolutionEvidence: input.evidence, reviewedBy: scope.actorUserId, reviewedAt: new Date() } });
  }
  const updated = await tx.fbaLocalPlan.update({ where: { id: plan.id }, data: { revision: { increment: 1 } } });
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, entityType: 'FbaExternalOperationRecord', entityId: recordId, action: `fba-local.${action.toLowerCase()}`, metadata: { workspaceId: scope.workspaceId, planId: plan.id, planRevision: updated.revision, evidenceType: 'INDEPENDENT_OPERATOR_REVIEW', remoteExecutionEnabled: false } } });
  return { recordId, revision: updated.revision, reused: false, remoteExecutionEnabled: false };
}
