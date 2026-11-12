import { authorizeWms, scoped } from './access';
import { WmsError, type WmsScope } from './contracts';
import type { Tx } from './repository';
import type { FinanceSource } from '@/lib/finance/source-rules';

/** Read immutable cost entries; never accept a browser-supplied voucher or cost. */
export async function readWmsFinanceSource(tx: Tx, scope: WmsScope, id: string): Promise<FinanceSource> {
  await authorizeWms(tx, scope, 'view');
  await tx.$queryRaw`SELECT id FROM "WmsFinanceDraft" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR SHARE`;
  const draft = await tx.wmsFinanceDraft.findFirst({ where: { ...scoped(scope), id }, include: { command: true, entries: { orderBy: { movementId: 'asc' },include:{movement:{include:{balance:{include:{lot:true}}}}} } } });
  if (!draft) throw new WmsError('库存核算来源不存在。', 404);
  if (draft.status !== 'DRAFT' || !draft.entries.length) throw new WmsError('库存来源尚未完成计价。', 409);
  const currencies = new Set(draft.entries.map(entry => entry.currency));
  if (currencies.size !== 1) throw new WmsError('库存来源包含多个币种，须先分别核算。', 422);
  return {
    kind: 'WMS_COMMAND', id, sourceKey: `WMS-COMMAND:${draft.commandId}`,
    currency: draft.entries[0].currency, sourceDate: draft.command.createdAt.toISOString().slice(0, 10),
    lines: draft.entries.flatMap(entry => [
      { account: entry.debitAccount, debit: entry.amount.toFixed(6), credit: '0.000000' },
      { account: entry.creditAccount, debit: '0.000000', credit: entry.amount.toFixed(6) },
    ]),
    evidence: { commandId: draft.commandId, revision: draft.revision, entries: draft.entries.map(entry => ({ movementId: entry.movementId, productRecordId:entry.movement.balance.lot.productRecordId,lotId:entry.movement.balance.lotId,batchNo:entry.movement.balance.lot.lotCode,warehouseId:entry.movement.balance.warehouseId,ruleId: entry.ruleId, quantity: entry.quantity, unitCost: entry.unitCost.toFixed(6), amount: entry.amount.toFixed(6) })) },
  };
}
