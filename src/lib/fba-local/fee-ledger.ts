import { createHash } from 'node:crypto';
import type { FbaLocalPlan } from '@prisma/client';
import { scoped } from '@/lib/wms/access';
import type { WmsScope } from '@/lib/wms/contracts';
import { WmsError } from '@/lib/wms/contracts';
import type { Tx } from '@/lib/wms/repository';
import { requireText, strictKeys } from '@/lib/wms/rules';
import { reconcileCosts } from '@/lib/finance/rules';
import { allocateLocalCost, type CostLine, readLocalCost } from './cost-allocation';
import { object } from './rules';
import { validateCostHierarchy } from './cost-hierarchy-service';

export const feeTypes = ['OCEAN', 'AIR', 'FUEL', 'CUSTOMS', 'CLEARANCE', 'INSURANCE', 'TRUCKING', 'OTHER'] as const;
export function hasCostDifference(reconciliation: ReturnType<typeof reconcileCosts>) { return reconciliation.lines.some(line => line.difference !== '0.000000'); }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function parseFeeRecord(raw: unknown, lines: readonly CostLine[]) {
  const value = object(raw);
  strictKeys(value, ['number', 'feeType', 'idempotencyKey', 'allocation']);
  const number = requireText(value.number, '费用编号');
  const idempotencyKey = requireText(value.idempotencyKey, '幂等键');
  if (!feeTypes.includes(value.feeType as typeof feeTypes[number])) throw new WmsError('费用类型无效。', 400);
  const estimate = allocateLocalCost(value.allocation, lines);
  if (estimate.stage !== 'ESTIMATE') throw new WmsError('费用归集须先保存预估，再确认实际账单。', 400);
  return { number, feeType: value.feeType as typeof feeTypes[number], idempotencyKey, estimate };
}
export function parseForwarderBill(raw: unknown, lines: readonly CostLine[], estimate: ReturnType<typeof readLocalCost>) {
  const value = object(raw);
  strictKeys(value, ['feeId', 'number', 'forwarder', 'forwarderOrderId', 'idempotencyKey', 'allocation']);
  const feeId = requireText(value.feeId, '费用 ID');
  const number = requireText(value.number, '货代账单号');
  const forwarder = requireText(value.forwarder, '货代');
  const idempotencyKey = requireText(value.idempotencyKey, '幂等键');
  const actual = allocateLocalCost(value.allocation, lines);
  if (actual.stage !== 'ACTUAL') throw new WmsError('确认账单须提供实际费用。', 400);
  if (actual.currency !== estimate.currency) throw new WmsError('预估与实际币种须一致，不能自动换汇。', 400);
  const forwarderOrderId = value.forwarderOrderId === undefined || value.forwarderOrderId === null ? null : requireText(value.forwarderOrderId,'委托单 ID');
  return { feeId, number, forwarder, forwarderOrderId, idempotencyKey, actual, reconciliation: reconcileCosts(estimate, actual) };
}

/** Called only after the plan lock and live WMS/account/ownership checks in the application service. */
export async function writeFeeLedger(tx: Tx, scope: WmsScope, plan: FbaLocalPlan & { lines: CostLine[] }, action: string, raw: unknown, expectedRevision: number) {
  if (plan.status === 'CANCELLED') throw new WmsError('已取消计划不能新增费用或确认账单。', 409);
  const identity = scoped(scope);
  let result: { feeId: string; billId?: string; adjustmentId?: string | null };
  let detail: Record<string, string>;
  if (action === 'CREATE_FEE_RECORD') {
    const input = parseFeeRecord(raw, plan.lines);
    const requestHash = hash(input);
    const prior = await tx.fbaLocalFee.findFirst({ where: { ...identity, planId: plan.id, idempotencyKey: input.idempotencyKey } });
    if (prior) {
      if (prior.requestHash !== requestHash || prior.createdBy !== scope.actorUserId) throw new WmsError('费用幂等键已用于其他内容。', 409);
      return { feeId: prior.id, revision: plan.revision };
    }
    if (plan.revision !== expectedRevision) throw new WmsError('计划版本已变化，请刷新后录费。', 409);
    await validateCostHierarchy(tx,scope,plan,input.estimate);
    if (await tx.fbaLocalFee.count({ where: { ...identity, planId: plan.id } }) >= 100) throw new WmsError('每个计划最多归集 100 笔费用。', 422);
    const fee = await tx.fbaLocalFee.create({ data: { ...identity, id: crypto.randomUUID(), planId: plan.id, ...input, requestHash, createdBy: scope.actorUserId } });
    result = { feeId: fee.id }; detail = { feeId: fee.id, number: fee.number };
  } else {
    const feeId = requireText(object(raw).feeId, '费用 ID');
    const fee = await tx.fbaLocalFee.findFirst({ where: { ...identity, planId: plan.id, id: feeId } });
    if (!fee) throw new WmsError('费用不存在或不属于当前计划。', 404);
    const input = parseForwarderBill(raw, plan.lines, readLocalCost(fee.estimate, plan.lines));
    if (input.forwarderOrderId) {
      const order = await tx.fbaLocalForwarderOrder.findFirst({where:{...identity,id:input.forwarderOrderId,planId:plan.id}});
      if (!order || order.status==='CANCELLED' || order.forwarder!==input.forwarder) throw new WmsError('委托单不属于当前计划、已取消或货代不一致。',409);
    }
    const requestHash = hash(input);
    const prior = await tx.fbaLocalForwarderBill.findFirst({ where: { ...identity, feeId }, include: { adjustment: true } });
    if (prior) {
      if (prior.idempotencyKey !== input.idempotencyKey || prior.requestHash !== requestHash || prior.createdBy !== scope.actorUserId) throw new WmsError('该费用账单已确认，不可覆盖。', 409);
      return { feeId, billId: prior.id, adjustmentId: prior.adjustment?.id ?? null, revision: plan.revision };
    }
    if (plan.revision !== expectedRevision) throw new WmsError('计划版本已变化，请刷新后对账。', 409);
    await validateCostHierarchy(tx,scope,plan,input.actual);
    const { reconciliation, actual, number, forwarder, forwarderOrderId, idempotencyKey } = input;
    const bill = await tx.fbaLocalForwarderBill.create({ data: { ...identity, id: crypto.randomUUID(), feeId, number, forwarder, forwarderOrderId, idempotencyKey, actual, reconciliation, requestHash, createdBy: scope.actorUserId } });
    const adjustment = !hasCostDifference(reconciliation) ? null : await tx.fbaLocalCostAdjustment.create({ data: { ...identity, id: crypto.randomUUID(), billId: bill.id, currency: reconciliation.currency, difference: reconciliation.difference } });
    result = { feeId, billId: bill.id, adjustmentId: adjustment?.id ?? null }; detail = { feeId, billId: bill.id, difference: reconciliation.difference };
  }
  const updated = await tx.fbaLocalPlan.update({ where: { id: plan.id }, data: { revision: { increment: 1 } } });
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: `fba-local.${action === 'CREATE_FEE_RECORD' ? 'fee.create' : 'bill.confirm'}`, entityType: 'FbaLocalPlan', entityId: plan.id, metadata: { workspaceId: scope.workspaceId, detail: { ...detail, revision: updated.revision } } } });
  return { ...result, revision: updated.revision };
}
