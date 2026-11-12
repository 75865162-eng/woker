import { authorizeWms, scoped } from '@/lib/wms/access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import type { Tx } from '@/lib/wms/repository';
import type { FinanceSource } from '@/lib/finance/source-rules';
import { object } from './rules';
import { authorizeFbaAccount } from './account-access';

/** Reviewed rule evidence only. Formal book, subjects and posting are validated by Finance. */
export async function readFbaFinanceSource(tx: Tx, scope: WmsScope, id: string): Promise<FinanceSource> {
  await authorizeWms(tx, scope, 'view');
  const draft = await tx.fbaLocalFinanceDraft.findFirst({ where: { ...scoped(scope), id }, include: { adjustment: { include: { bill: { include: { fee: { include: { plan: true } } } } } } } });
  if (!draft) throw new WmsError('费用核算来源不存在。', 404);
  const plan = draft.adjustment.bill.fee.plan;
  await tx.$queryRaw`SELECT id FROM "FbaLocalPlan" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${plan.id} FOR SHARE`;
  await authorizeFbaAccount(tx, scope, plan.sellerAccountId, plan.marketplaceId);
  const currentPlan = await tx.fbaLocalPlan.findFirstOrThrow({ where: { ...scoped(scope), id: plan.id } });
  if (currentPlan.status === 'CANCELLED' || draft.status !== 'RULES_REVIEWED' || !draft.reviewedBy || !draft.reviewedAt) throw new WmsError('仅有效计划中已独立复核的费用核算草稿可转入总账。', 409);
  const voucher = object(draft.voucher);
  if (!Array.isArray(voucher.lines) || typeof voucher.currency !== 'string' || typeof voucher.date !== 'string') throw new WmsError('来源核算分录不完整。', 422);
  return {
    kind: 'FBA_ADJUSTMENT', id, sourceKey: `FBA-ADJUSTMENT:${draft.adjustmentId}`,
    currency: voucher.currency, sourceDate: voucher.date,
    lines: voucher.lines.map(raw => {
      const line = object(raw);
      if (typeof line.accountId !== 'string' || typeof line.debit !== 'string' || typeof line.credit !== 'string') throw new WmsError('来源核算分录无效。', 422);
      return { account: line.accountId, debit: line.debit, credit: line.credit };
    }),
    evidence: { planId: plan.id, adjustmentId: draft.adjustmentId, requestHash: draft.requestHash, reviewedBy: draft.reviewedBy, reviewedAt: draft.reviewedAt.toISOString() },
  };
}
