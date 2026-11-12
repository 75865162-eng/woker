import { WmsError } from '@/lib/wms/contracts';

/**
 * 发票入账口径（只做增量，不重复确认应付）：
 * - 本系统在收货计价时已按暂估口径把「货值」计入存货并贷记应付（见采购往来桥接）。
 *   发票到达只应补记「尚未暂估的部分」：价差、进项税，以及对应的应付增量。
 * - 若该采购单尚未有已过账收货计价（bookedCost = 0），发票即为首次确认，
 *   此时价差等于不含税金额，效果等同于「票到入账」。
 * - 已核准的历史发票会消耗暂估额度，避免部分开票时重复冲抵。
 */
const SCALE = BigInt(1_000_000);

function units(value: string, label: string): bigint {
  const text = String(value ?? '').trim();
  if (!/^-?[0-9]{1,16}([.][0-9]{1,6})?$/.test(text)) throw new WmsError(`${label}金额格式无效。`, 400);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
  return negative ? -result : result;
}

function text(value: bigint): string {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / SCALE}.${(absolute % SCALE).toString().padStart(6, '0')}`;
}

export type InvoicePostingInput = {
  /** 发票不含税金额 */
  net: string;
  /** 发票税额 */
  tax: string;
  /** 价税合计 */
  total: string;
  /** 该采购单已过账的收货计价金额（暂估口径） */
  bookedCost: string;
  /** 同采购单其他已核准发票的不含税合计 */
  priorInvoicedNet: string;
  /** 本张发票是否已把该采购单收货数量开完（决定暂估额度是否结清） */
  fullCoverage: boolean;
};

export type InvoicePostingPlan = {
  /** 本次可冲抵的暂估额度 */
  accruedRemaining: string;
  /** 存货价差：正数补记成本，负数冲减成本 */
  costDelta: string;
  /** 应付增量：含税额与暂估的差额 */
  payableDelta: string;
  lines: Array<{ account: string; debit: string; credit: string }>;
};

export const INVOICE_COST_ACCOUNT = 'PURCHASE_INVOICE_COST';
export const INVOICE_INPUT_VAT_ACCOUNT = 'PURCHASE_INPUT_VAT';
export const INVOICE_PAYABLE_ACCOUNT = 'PURCHASE_PAYABLE';

export function invoicePostingPlan(input: InvoicePostingInput): InvoicePostingPlan {
  const net = units(input.net, '不含税');
  const tax = units(input.tax, '税额');
  const total = units(input.total, '价税合计');
  const booked = units(input.bookedCost, '已暂估成本');
  const priorNet = units(input.priorInvoicedNet, '已开票金额');
  if (net < BigInt(0) || tax < BigInt(0) || booked < BigInt(0) || priorNet < BigInt(0)) throw new WmsError('发票金额不能为负；红字发票须走作废或贷项流程。', 422);
  if (net + tax !== total) throw new WmsError('价税合计应等于不含税金额加税额。', 422);
  const remaining = booked - priorNet > BigInt(0) ? booked - priorNet : BigInt(0);
  // 开完最后一张票即视为暂估结清：按实际票面替换暂估，多暂估的冲回、少暂估的补记。
  // 未开完则只在本张票金额内冲抵暂估，避免提前冲回尚未开票的部分。
  const accrued = input.fullCoverage ? remaining : (net < remaining ? net : remaining);
  const costDelta = net - accrued;
  const payableDelta = total - accrued;
  const lines: InvoicePostingPlan['lines'] = [];
  if (costDelta !== BigInt(0)) lines.push(costDelta > BigInt(0)
    ? { account: INVOICE_COST_ACCOUNT, debit: text(costDelta), credit: '0.000000' }
    : { account: INVOICE_COST_ACCOUNT, debit: '0.000000', credit: text(-costDelta) });
  if (tax !== BigInt(0)) lines.push({ account: INVOICE_INPUT_VAT_ACCOUNT, debit: text(tax), credit: '0.000000' });
  if (payableDelta !== BigInt(0)) lines.push(payableDelta > BigInt(0)
    ? { account: INVOICE_PAYABLE_ACCOUNT, debit: '0.000000', credit: text(payableDelta) }
    : { account: INVOICE_PAYABLE_ACCOUNT, debit: text(-payableDelta), credit: '0.000000' });
  const debit = lines.reduce((sum, line) => sum + units(line.debit, '借方'), BigInt(0));
  const credit = lines.reduce((sum, line) => sum + units(line.credit, '贷方'), BigInt(0));
  if (debit !== credit) throw new WmsError('发票入账草稿借贷不平，已拦截。', 422);
  return { accruedRemaining: text(remaining), costDelta: text(costDelta), payableDelta: text(payableDelta), lines };
}
