import { WmsError } from '@/lib/wms/contracts';
import { amountUnits, itemAmount } from './open-item-rules';

type Line = { subjectId: string; debit: string; credit: string };
export function purchaseBridgePlan(input: { kind: 'PAYABLE' | 'PAYMENT'; supplierId: string; currency: string; sourceCurrency: string; subjectId: string; mappedSubject: string | undefined; expected: Line[]; actual: Line[] }) {
  if (input.currency !== input.sourceCurrency || input.subjectId !== input.mappedSubject) throw new WmsError('采购币种或往来科目与已过账来源映射不一致。', 422);
  const canonical = (lines: Line[]) => lines.map(line => `${line.subjectId}:${amountUnits(line.debit)}:${amountUnits(line.credit)}`).sort();
  if (JSON.stringify(canonical(input.expected)) !== JSON.stringify(canonical(input.actual))) throw new WmsError('凭证分录与来源映射不一致，不能桥接采购往来。', 409);
  const amount = itemAmount(input.kind, input.actual.filter(line => line.subjectId === input.subjectId));
  return { kind: input.kind, counterparty: `supplier:${input.supplierId}`, amount };
}
