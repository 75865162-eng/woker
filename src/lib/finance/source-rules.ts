import { createHash } from 'node:crypto';
import { WmsError } from '@/lib/wms/contracts';
import { requireText, strictKeys } from '@/lib/wms/rules';

export type FinanceSourceKind = 'WMS_OVERSEAS_CHARGE' | 'FX_REVALUATION' | 'FBA_ADJUSTMENT' | 'WMS_COMMAND' | 'WMS_INVENTORY_RISK' | 'WMS_COST_ADJUSTMENT' | 'PURCHASE_PAYMENT' | 'PURCHASE_REFUND';
export type FinanceSource = {
  kind: FinanceSourceKind; id: string; sourceKey: string; currency: string;
  sourceDate: string; lines: Array<{ account: string; debit: string; credit: string }>;
  evidence: unknown;
};
export function parseSourceIdentity(kind: unknown, id: unknown): { kind: FinanceSourceKind; id: string } {
  if (kind !== 'WMS_OVERSEAS_CHARGE' && kind !== 'FX_REVALUATION' && kind !== 'FBA_ADJUSTMENT' && kind !== 'WMS_COMMAND' && kind !== 'WMS_INVENTORY_RISK' && kind !== 'WMS_COST_ADJUSTMENT' && kind !== 'PURCHASE_PAYMENT' && kind !== 'PURCHASE_REFUND') throw new WmsError('不支持的核算来源。', 400);
  return { kind, id: requireText(id, '核算来源 ID') };
}
export function sourceFingerprint(source: FinanceSource) {
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}
export function validateSourceDate(source: FinanceSource, date: string) {
  if(source.kind==='FX_REVALUATION'&&date!==source.sourceDate)throw new WmsError('期末汇兑重估须按该期间末日入账。',422);
  if ((source.kind === 'PURCHASE_PAYMENT' || source.kind === 'PURCHASE_REFUND') && date !== source.sourceDate) {
    throw new WmsError('采购付款或退款凭证日期必须与实际收付日期一致。', 422);
  }
}
export function mapSourceLines(source: FinanceSource, currency: string, raw: unknown) {
  if (source.currency !== currency) throw new WmsError('来源币种与账套本位币不一致；须先完成有依据的换汇核算。', 422);
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) throw new WmsError('须逐项映射来源科目。', 400);
  const mapping = new Map<string, string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new WmsError('科目映射无效。', 400);
    const value = row as Record<string, unknown>;
    strictKeys(value, ['sourceAccount', 'subjectId']);
    const account = requireText(value.sourceAccount, '来源科目');
    if (mapping.has(account)) throw new WmsError('来源科目映射重复。', 400);
    mapping.set(account, requireText(value.subjectId, '正式科目 ID'));
  }
  const accounts = new Set(source.lines.map(line => line.account));
  if (mapping.size !== accounts.size || [...accounts].some(account => !mapping.has(account))) throw new WmsError('映射必须覆盖且仅覆盖全部来源科目。', 422);
  // Distinct source accounts must remain distinct in the formal ledger.
  if (new Set(mapping.values()).size !== mapping.size) throw new WmsError('不同来源科目不能合并映射为同一正式科目。', 422);
  return source.lines.filter(line => line.debit !== '0.000000' || line.credit !== '0.000000').map(line => ({ subjectId: mapping.get(line.account)!, debit: line.debit, credit: line.credit }));
}
