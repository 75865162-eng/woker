import { WmsError } from '@/lib/wms/contracts';

export const openItemKinds = ['PAYABLE', 'RECEIVABLE', 'PAYMENT', 'RECEIPT'] as const;
export type OpenItemKind = typeof openItemKinds[number];
export function amountUnits(value: string): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,23})(?:\.\d{1,6})?$/.test(value)) throw new WmsError('金额须为最多六位小数的非负十进制字符串。', 400);
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, '0'));
}
export function unitsAmount(value: bigint) {
  const absolute = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? '-' : ''}${absolute / BigInt(1000000)}.${String(absolute % BigInt(1000000)).padStart(6, '0')}`;
}
export function itemKind(raw: unknown): OpenItemKind {
  if (!openItemKinds.includes(raw as OpenItemKind)) throw new WmsError('往来类型无效。', 400);
  return raw as OpenItemKind;
}
export function itemAmount(kind: OpenItemKind, lines: readonly { debit: string; credit: string }[]) {
  const net = lines.reduce((sum, line) => sum + amountUnits(line.debit) - amountUnits(line.credit), BigInt(0));
  const value = kind === 'PAYABLE' || kind === 'RECEIPT' ? -net : net;
  if (value <= BigInt(0)) throw new WmsError('凭证所选科目净额与往来类型方向不符。', 422);
  return unitsAmount(value);
}
export type MatchItem = {
  id: string; organizationId: string; workspaceId: string; bookId: string; subjectId: string;
  counterparty: string; currency: string; kind: string; amount: string; allocated: string; status: string;
};
export function planSettlement(document: MatchItem, payment: MatchItem, amount: string) {
  if (document.id === payment.id || document.status !== 'OPEN' || payment.status !== 'OPEN') throw new WmsError('核销对象须为不同的有效往来项。', 409);
  for (const key of ['organizationId', 'workspaceId', 'bookId', 'subjectId', 'counterparty', 'currency'] as const) {
    if (document[key] !== payment[key]) throw new WmsError('核销双方组织、工作区、账套、科目、往来对象及币种必须相同。', 422);
  }
  if (!((document.kind === 'PAYABLE' && payment.kind === 'PAYMENT') || (document.kind === 'RECEIVABLE' && payment.kind === 'RECEIPT'))) throw new WmsError('应付须与付款核销，应收须与收款核销。', 422);
  const value = amountUnits(amount), left = amountUnits(document.amount) - amountUnits(document.allocated), right = amountUnits(payment.amount) - amountUnits(payment.allocated);
  if (value <= BigInt(0) || value > left || value > right) throw new WmsError('核销金额须大于零且不超过双方未核销余额。', 422);
  return { amount: unitsAmount(value), documentRemaining: unitsAmount(left - value), paymentRemaining: unitsAmount(right - value) };
}
export function validFinanceDate(value: unknown, label = '日期') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new WmsError(`${label}无效。`, 400);
  return value;
}
